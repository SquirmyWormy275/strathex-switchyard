import type { AuthorityGrant, EffectDisposition, ManagedSession, TargetSnapshot } from "./contracts.ts";
import type { CommandAction, CommandDefinition } from "./command-catalog.ts";
import type { ExecutionControl } from "./execution-control.ts";
import type { ContainmentGuard, EffectGuard } from "./brokers.ts";
import { redactRecord, untrustedSummary } from "./redaction.ts";

/** Adapter lifecycle mirrors only truthful command dispositions; long-running provider work stays reconcilable. */
export type AdapterStatus = "completed" | "unavailable" | "blocked" | "failed" | "awaiting_input" | "awaiting_confirmation" | "running" | "cancelled" | "timed_out";
export interface AdapterOutcome {
  readonly status: AdapterStatus;
  readonly summary: string;
  /** Explicitly separates a refusal before effect from an uncertain remote result. */
  readonly effectDisposition?: EffectDisposition;
  readonly data?: Readonly<Record<string, unknown>>;
}

/** Typed context crosses the adapter boundary; untrusted text is data only. */
export interface AdapterRequest {
  readonly definition: CommandDefinition;
  /** Assigned by durable dispatch; adapters must check cancellation before every provider effect. */
  readonly operationId?: string;
  readonly target?: TargetSnapshot;
  readonly session?: ManagedSession;
  readonly authority?: AuthorityGrant;
  readonly executionControl?: ExecutionControl;
  /** Host-owned final target barrier, checked before an adapter side effect. */
  readonly effectGuard?: EffectGuard;
  readonly untrustedInput?: Readonly<Record<string, string>>;
}

export interface CommandAdapter {
  readonly id: string;
  readonly kind: "desktop" | "provider" | "vscode" | "navigation" | "voice" | "generic";
  execute(request: AdapterRequest): Promise<AdapterOutcome>;
}

export type AdapterHandler = (request: AdapterRequest) => AdapterOutcome | Promise<AdapterOutcome>;

/**
 * The default adapter deliberately has no fallback. In particular, a missing
 * Claude adapter never silently redirects a request to Codex or vice versa.
 */
export class UnavailableCommandAdapter implements CommandAdapter {
  readonly id: string;
  readonly kind: CommandAdapter["kind"];
  private readonly reason: string;

  constructor(kind: CommandAdapter["kind"], reason: string, id = `unavailable-${kind}`) {
    this.kind = kind;
    this.reason = reason;
    this.id = id;
  }

  async execute(request: AdapterRequest): Promise<AdapterOutcome> {
    return { status: "unavailable", summary: `${request.definition.title} is unavailable: ${this.reason}`, effectDisposition: "not_started" };
  }
}

export class UnavailableDesktopAdapter extends UnavailableCommandAdapter {
  constructor(reason: string) { super("desktop", reason, "unavailable-desktop"); }
}

export class UnavailableProviderAdapter extends UnavailableCommandAdapter {
  constructor(reason: string) { super("provider", reason, "unavailable-provider"); }
}

/** Test-local adapter only. Handlers are opt-in and cannot invoke operating-system APIs by default. */
export class InMemoryCommandAdapter implements CommandAdapter {
  readonly kind = "generic" as const;
  readonly id: string;
  private readonly handlers = new Map<CommandAction, AdapterHandler>();

  constructor(id = "in-memory-adapter") {
    this.id = id;
  }

  register(action: CommandAction, handler: AdapterHandler): void {
    this.handlers.set(action, handler);
  }

  async execute(request: AdapterRequest): Promise<AdapterOutcome> {
    const handler = this.handlers.get(request.definition.action);
    if (!handler) return { status: "unavailable", summary: `Adapter ${this.id} has no supported capability for ${request.definition.action}.`, effectDisposition: "not_started" };
    const outcome = await handler(request);
    return {
      ...outcome,
      summary: untrustedSummary(outcome.summary),
      data: outcome.data ? redactRecord(outcome.data) : undefined
    };
  }
}

/** Routes a command to one explicitly registered adapter; it never guesses a compatible provider. */
export class AdapterRegistry {
  private readonly adapters = new Map<CommandAction, CommandAdapter>();
  private readonly containment?: ContainmentGuard;

  constructor(containment?: ContainmentGuard) {
    this.containment = containment;
  }

  register(action: CommandAction, adapter: CommandAdapter): void {
    this.adapters.set(action, adapter);
  }

  get(action: CommandAction): CommandAdapter | undefined {
    return this.adapters.get(action);
  }

  async execute(request: AdapterRequest): Promise<AdapterOutcome> {
    const adapter = this.adapters.get(request.definition.action);
    if (!adapter) return { status: "unavailable", summary: `No verified adapter is registered for ${request.definition.title}.`, effectDisposition: "not_started" };
    if (request.effectGuard && request.target) {
      const current = await request.effectGuard.assertCurrent({
        action: request.definition.action,
        operationId: request.operationId ?? "adapter-without-operation",
        target: request.target,
        ...(request.session ? { session: request.session } : {}),
        ...(request.authority ? { authority: request.authority } : {})
      });
      if (!current.allowed) return { status: "blocked", summary: current.reason, effectDisposition: "not_started" };
    }
    if (this.containment && request.target && adapterNeedsContainment(request.definition)) {
      const fence = await this.containment.check(request.target.repositoryRoot, "adapter");
      if (!fence.allowed) return { status: "blocked", summary: fence.reason, effectDisposition: "not_started" };
    }
    return adapter.execute(request);
  }
}

/**
 * Read-only UI navigation can remain visible during containment.  Any managed
 * agent/provider route or consequential adapter route must pass the durable
 * fence before the adapter receives it.
 */
function adapterNeedsContainment(definition: CommandDefinition): boolean {
  return definition.executor === "agent"
    || definition.requiresCompleteTargetSnapshot
    || definition.highConsequence
    || definition.outbound;
}
