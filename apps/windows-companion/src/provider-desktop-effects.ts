import type { EffectDisposition } from "../../../packages/control-plane/src/contracts.ts";
import { ProtectedJsonStore, type JsonValue, type JournalEntry } from "../../../packages/control-plane/src/store.ts";
import type { CommandAction } from "../../../packages/control-plane/src/command-catalog.ts";
import type { DesktopProviderId, ProviderLifecycleOutcome } from "./provider-desktop.ts";

const effectKind = "provider_desktop_effect";
const allowedActions = new Set<CommandAction>(["open_claude", "fresh_claude", "open_chatgpt", "fresh_chatgpt"]);

interface StartedEvent {
  readonly version: 1;
  readonly event: "started";
  readonly operationId: string;
  readonly action: CommandAction;
  readonly provider: DesktopProviderId;
  readonly mode: "normal" | "fresh";
}

interface SettledEvent {
  readonly version: 1;
  readonly event: "settled";
  readonly operationId: string;
  readonly action: CommandAction;
  readonly provider: DesktopProviderId;
  readonly mode: "normal" | "fresh";
  readonly status: ProviderLifecycleOutcome["status"];
  readonly effectDisposition: EffectDisposition;
  readonly summary: string;
  readonly processId?: number;
  readonly surfaceId?: string;
}

type EffectEvent = StartedEvent | SettledEvent;

export interface ProviderDesktopEffectObservation {
  readonly outcome: "committed" | "not_started" | "failed" | "cancelled" | "unresolved";
  readonly note: string;
  readonly details?: Readonly<Record<string, string>>;
}

/**
 * Authenticated, append-only boundary around desktop focus/launch effects.
 * A lone started event is intentionally ambiguous and requires operator
 * reconciliation; it is never treated as permission to replay the effect.
 */
export class DurableProviderDesktopEffectLedger {
  constructor(private readonly store: ProtectedJsonStore) {
    if (!store.hasAuthenticatedProtection) throw new Error("Provider desktop effects require authenticated durable storage.");
  }

  async begin(input: Readonly<{ operationId: string; action: CommandAction; provider: DesktopProviderId; mode: "normal" | "fresh" }>): Promise<void> {
    const event = startedEvent(input);
    await this.store.transaction(async (transaction) => {
      const history = effectHistory(await transaction.readEntries<JsonValue>(), event.operationId);
      if (history.some((item) => item.event === "settled")) throw new Error("The exact provider desktop effect is already settled and cannot be replayed.");
      const prior = history.find((item): item is StartedEvent => item.event === "started");
      if (prior) {
        if (!sameBinding(prior, event)) throw new Error("The durable provider desktop operation is bound to another effect.");
        throw new Error("The exact provider desktop effect already started and requires read-only reconciliation before any retry.");
      }
      await transaction.append<StartedEvent>(effectKind, event);
    });
  }

  async settle(
    binding: Readonly<{ operationId: string; action: CommandAction; provider: DesktopProviderId; mode: "normal" | "fresh" }>,
    outcome: ProviderLifecycleOutcome
  ): Promise<void> {
    const started = startedEvent(binding);
    const event = settledEvent(started, outcome);
    await this.store.transaction(async (transaction) => {
      const history = effectHistory(await transaction.readEntries<JsonValue>(), started.operationId);
      const priorStart = history.find((item): item is StartedEvent => item.event === "started");
      if (!priorStart || !sameBinding(priorStart, started)) throw new Error("The provider desktop effect has no exact durable start binding.");
      const priorSettle = history.find((item): item is SettledEvent => item.event === "settled");
      if (priorSettle) {
        if (JSON.stringify(priorSettle) !== JSON.stringify(event)) throw new Error("The exact provider desktop effect already has another durable result.");
        return;
      }
      await transaction.append<SettledEvent>(effectKind, event);
    });
  }

  async observeOperation(operationIdInput: string, actionInput?: string): Promise<ProviderDesktopEffectObservation> {
    const operationId = reference(operationIdInput, 256);
    const action = actionInput === undefined ? undefined : providerAction(actionInput);
    if (!operationId || (actionInput !== undefined && !action)) return unresolved("The provider desktop observation binding is invalid.");
    const history = effectHistory(await this.store.readEntries<JsonValue>(), operationId);
    const started = history.find((item): item is StartedEvent => item.event === "started" && (!action || item.action === action));
    if (!started) return { outcome: "not_started", note: "No exact durable provider desktop effect start was recorded." };
    const settled = history.find((item): item is SettledEvent => item.event === "settled" && sameBinding(item, started));
    if (!settled) return unresolved("The exact provider desktop effect began without a durable result; manual reconciliation is required before any retry.", started);
    const details = effectDetails(settled);
    if (settled.status === "completed" && settled.effectDisposition === "committed") {
      return { outcome: "committed", note: "The authenticated provider desktop ledger recorded the exact completed effect.", details };
    }
    if (settled.status === "cancelled" && settled.effectDisposition === "not_started") {
      return { outcome: "cancelled", note: "The authenticated provider desktop ledger recorded cancellation before effect.", details };
    }
    if ((settled.status === "blocked" || settled.status === "unavailable" || settled.status === "failed" || settled.status === "timed_out")
      && settled.effectDisposition === "not_started") {
      return { outcome: "failed", note: "The authenticated provider desktop ledger recorded a refusal before effect.", details };
    }
    return unresolved("The provider desktop result is effect-ambiguous; manual reconciliation is required before any retry.", settled);
  }
}

function startedEvent(input: Readonly<{ operationId: string; action: CommandAction; provider: DesktopProviderId; mode: "normal" | "fresh" }>): StartedEvent {
  const operationId = reference(input.operationId, 256);
  const action = providerAction(input.action);
  if (!operationId || !action || !desktopProvider(input.provider) || (input.mode !== "normal" && input.mode !== "fresh")) throw new Error("The provider desktop effect binding is invalid.");
  return { version: 1, event: "started", operationId, action, provider: input.provider, mode: input.mode };
}

function settledEvent(started: StartedEvent, outcome: ProviderLifecycleOutcome): SettledEvent {
  if (!["completed", "unavailable", "blocked", "failed", "cancelled", "timed_out"].includes(outcome.status)) throw new Error("The provider desktop result status is invalid.");
  const summary = safeSummary(outcome.summary);
  const effectDisposition: EffectDisposition = outcome.status === "completed" ? "committed"
    : outcome.status === "blocked" || outcome.status === "unavailable" ? "not_started" : "ambiguous";
  const processId = outcome.processId;
  const surfaceId = outcome.surfaceId === undefined ? undefined : reference(outcome.surfaceId, 512);
  if (processId !== undefined && (!Number.isSafeInteger(processId) || processId <= 0)) throw new Error("The provider desktop process identity is invalid.");
  if (outcome.surfaceId !== undefined && !surfaceId) throw new Error("The provider desktop surface identity is invalid.");
  return {
    ...started,
    event: "settled",
    status: outcome.status,
    effectDisposition,
    summary,
    ...(processId !== undefined ? { processId } : {}),
    ...(surfaceId !== undefined ? { surfaceId } : {})
  };
}

function effectHistory(entries: readonly JournalEntry<JsonValue>[], operationId: string): EffectEvent[] {
  const result: EffectEvent[] = [];
  for (const entry of entries) {
    if (entry.kind !== effectKind) continue;
    const event = parseEvent(entry.payload);
    if (event.operationId === operationId) result.push(event);
  }
  if (result.filter((item) => item.event === "started").length > 1 || result.filter((item) => item.event === "settled").length > 1) {
    throw new Error("The provider desktop effect journal contains duplicate exact-operation events.");
  }
  return result;
}

function parseEvent(value: JsonValue): EffectEvent {
  if (!plain(value) || value.version !== 1 || (value.event !== "started" && value.event !== "settled")) throw new Error("The provider desktop effect journal is malformed.");
  const operationId = reference(value.operationId, 256);
  const action = providerAction(value.action);
  const provider = desktopProvider(value.provider) ? value.provider : undefined;
  const mode = value.mode === "normal" || value.mode === "fresh" ? value.mode : undefined;
  if (!operationId || !action || !provider || !mode) throw new Error("The provider desktop effect journal binding is malformed.");
  if (value.event === "started") {
    if (!exactKeys(value, ["version", "event", "operationId", "action", "provider", "mode"])) throw new Error("The provider desktop start event contains unknown fields.");
    return { version: 1, event: "started", operationId, action, provider, mode };
  }
  const status = typeof value.status === "string" && ["completed", "unavailable", "blocked", "failed", "cancelled", "timed_out"].includes(value.status)
    ? value.status as ProviderLifecycleOutcome["status"] : undefined;
  const effectDisposition = value.effectDisposition === "not_started" || value.effectDisposition === "committed" || value.effectDisposition === "ambiguous" ? value.effectDisposition : undefined;
  const summary = typeof value.summary === "string" && value.summary === safeSummary(value.summary) ? value.summary : undefined;
  const processId = value.processId === undefined ? undefined : Number.isSafeInteger(value.processId) && (value.processId as number) > 0 ? value.processId as number : NaN;
  const surfaceId = value.surfaceId === undefined ? undefined : reference(value.surfaceId, 512);
  if (!status || !effectDisposition || !summary || Number.isNaN(processId) || (value.surfaceId !== undefined && !surfaceId)
    || !exactKeys(value, ["version", "event", "operationId", "action", "provider", "mode", "status", "effectDisposition", "summary", ...(value.processId === undefined ? [] : ["processId"]), ...(value.surfaceId === undefined ? [] : ["surfaceId"])])) {
    throw new Error("The provider desktop settled event is malformed.");
  }
  return { version: 1, event: "settled", operationId, action, provider, mode, status, effectDisposition, summary, ...(processId !== undefined ? { processId } : {}), ...(surfaceId ? { surfaceId } : {}) };
}

function sameBinding(left: Pick<EffectEvent, "operationId" | "action" | "provider" | "mode">, right: Pick<EffectEvent, "operationId" | "action" | "provider" | "mode">): boolean {
  return left.operationId === right.operationId && left.action === right.action && left.provider === right.provider && left.mode === right.mode;
}
function effectDetails(event: EffectEvent): Readonly<Record<string, string>> { return { action: event.action, provider: event.provider, mode: event.mode, manualReconciliation: "not_required", ...(event.event === "settled" && event.processId ? { processId: String(event.processId) } : {}), ...(event.event === "settled" && event.surfaceId ? { surfaceId: event.surfaceId } : {}) }; }
function unresolved(note: string, event?: EffectEvent): ProviderDesktopEffectObservation { return { outcome: "unresolved", note, details: { manualReconciliation: "required", ...(event ? { action: event.action, provider: event.provider, mode: event.mode } : {}) } }; }
function safeSummary(value: unknown): string { const summary = typeof value === "string" ? value.replace(/[\0\r\n]+/g, " ").trim().slice(0, 512) : ""; return summary || "The provider desktop operation returned no trusted summary."; }
function providerAction(value: unknown): CommandAction | undefined { return typeof value === "string" && allowedActions.has(value as CommandAction) ? value as CommandAction : undefined; }
function desktopProvider(value: unknown): value is DesktopProviderId { return value === "claude_desktop" || value === "chatgpt_desktop"; }
function reference(value: unknown, maximum: number): string | undefined { return typeof value === "string" && value.length > 0 && value.length <= maximum && value.trim() === value && !/[\0\r\n]/.test(value) ? value : undefined; }
function plain(value: unknown): value is Record<string, JsonValue> { return typeof value === "object" && value !== null && !Array.isArray(value); }
function exactKeys(value: Record<string, JsonValue>, keys: readonly string[]): boolean { const expected = new Set(keys); return Object.keys(value).length === expected.size && Object.keys(value).every((key) => expected.has(key)); }
