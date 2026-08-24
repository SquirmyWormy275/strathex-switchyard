import { randomUUID } from "node:crypto";
import type { AuthorityGrant, ManagedSession, TargetSnapshot } from "./contracts.ts";
import type { CommandAction, CommandDefinition, AcceptanceGate } from "./command-catalog.ts";

export type GateEvidenceStatus = "not_evaluated" | "passed" | "failed" | "unavailable" | "incomplete";
export type PolicyStatus = "allowed" | "awaiting_confirmation" | "blocked" | "unavailable" | "incomplete";

export interface PolicyDecision {
  readonly status: PolicyStatus;
  readonly reason: string;
  readonly missingGates?: readonly AcceptanceGate[];
}

export interface PolicyPermit {
  readonly id: string;
  readonly action: CommandAction;
  /** Bound to one durable saga; a permit is never a reusable capability. */
  readonly operationId: string;
  readonly targetSnapshotId?: string;
  readonly sessionId?: string;
  readonly authorityId?: string;
  readonly expiresAt: string;
}

export interface PermitDecision extends PolicyDecision {
  readonly permit?: PolicyPermit;
}

export interface PolicySubject {
  readonly definition: CommandDefinition;
  /** Assigned by the durable operation coordinator before a permit is minted. */
  readonly operationId?: string;
  readonly target?: TargetSnapshot;
  readonly session?: ManagedSession;
  readonly authority?: AuthorityGrant;
  readonly confirmationToken?: string;
  /** Untrusted repository/provider/request data; policy intentionally never interprets it. */
  readonly untrustedInput?: Readonly<Record<string, string>>;
}

export interface ConfirmationRequest {
  readonly action: CommandAction;
  readonly targetSnapshotId?: string;
  readonly sessionId?: string;
  readonly authorityId?: string;
  readonly reason: string;
  readonly reauthenticated: boolean;
}

export interface ConfirmationRecord extends ConfirmationRequest {
  readonly id: string;
  readonly token: string;
  readonly createdAt: string;
  readonly expiresAt: string;
}

export interface PermitBinding {
  readonly action: CommandAction;
  readonly operationId: string;
  readonly targetSnapshotId?: string;
  readonly sessionId?: string;
  readonly authorityId?: string;
}

export interface PolicyEngineConfig {
  readonly version: string;
  readonly gateEvidence?: Readonly<Record<number, GateEvidenceStatus | string | undefined>>;
  /** Explicit allowlist; absent or empty means every high-consequence action remains disabled. */
  readonly highConsequenceActions?: readonly CommandAction[];
  readonly requireReauthenticationForHighConsequence?: boolean;
  readonly confirmationTtlMs?: number;
  readonly permitTtlMs?: number;
  readonly now?: () => Date;
}

interface StoredConfirmation extends ConfirmationRecord {
  readonly consumed: boolean;
}

/**
 * The policy engine is the authoritative in-memory safety decision point.
 * It never accepts repository text, CI output, or a raw keyboard event as
 * authority. Production callers replace its config with protected ledgers;
 * this implementation intentionally keeps the trust boundary explicit.
 */
export class PolicyEngine {
  private readonly config: PolicyEngineConfig;
  private readonly confirmations = new Map<string, StoredConfirmation>();
  private readonly permits = new Map<string, PolicyPermit>();
  private readonly enabledHighConsequenceActions: ReadonlySet<CommandAction>;
  private readonly now: () => Date;
  private readonly confirmationTtlMs: number;
  private readonly permitTtlMs: number;

  constructor(config: PolicyEngineConfig) {
    this.config = config;
    this.enabledHighConsequenceActions = new Set(config.highConsequenceActions ?? []);
    this.now = config.now ?? (() => new Date());
    this.confirmationTtlMs = config.confirmationTtlMs ?? 5 * 60_000;
    this.permitTtlMs = config.permitTtlMs ?? 60_000;
  }

  authorize(subject: PolicySubject): PolicyDecision {
    const { definition, target, session, authority } = subject;

    if (definition.requiresTarget && !target) {
      return { status: "unavailable", reason: `${definition.title} needs a verified target; the companion will not guess one.` };
    }
    if (definition.requiresCompleteTargetSnapshot && target?.completeness !== "complete") {
      return { status: "incomplete", reason: `${definition.title} requires a complete TargetSnapshot immediately before action.` };
    }
    if (definition.requiresCapabilities.length > 0) {
      if (!session) return { status: "unavailable", reason: `${definition.title} needs a registered session with verified capabilities.` };
      if (["unreachable", "stale", "unknown"].includes(session.status)) {
        return { status: "unavailable", reason: `Session ${session.id} is ${session.status}; capability cannot be inferred.` };
      }
      const missing = definition.requiresCapabilities.filter((capability) => !session.capabilities.includes(capability));
      if (missing.length > 0) {
        return { status: "blocked", reason: `${definition.title} requires ${missing.join(", ")}; Managed or registered routing is not equivalent to mediation.` };
      }
    }
    if (definition.requiresAuthority) {
      const authorityFailure = this.authorityFailure(definition, target, session, authority);
      if (authorityFailure) return { status: "blocked", reason: authorityFailure };
    }
    if (definition.highConsequence) {
      if (!this.enabledHighConsequenceActions.has(definition.action)) {
        return { status: "blocked", reason: `${definition.title} is not enabled by explicit high-consequence policy.` };
      }
      const missingGates = definition.acceptanceGates.filter((gate) => this.config.gateEvidence?.[gate] !== "passed");
      if (missingGates.length > 0) {
        return { status: "blocked", reason: `${definition.title} lacks trusted passing acceptance evidence.`, missingGates };
      }
    }
    if (definition.requiresConfirmation) {
      const confirmation = subject.confirmationToken ? this.confirmations.get(subject.confirmationToken) : undefined;
      if (!confirmation) return { status: "awaiting_confirmation", reason: `${definition.title} requires an explicit companion-UI confirmation.` };
      if (confirmation.consumed || this.expired(confirmation.expiresAt)) return { status: "blocked", reason: "Confirmation is expired or has already been used." };
      if (confirmation.action !== definition.action || confirmation.targetSnapshotId !== target?.id || confirmation.sessionId !== session?.id || confirmation.authorityId !== authority?.id) {
        return { status: "blocked", reason: "Confirmation does not match this exact action, target, session, and authority." };
      }
      if (definition.highConsequence && this.config.requireReauthenticationForHighConsequence && !confirmation.reauthenticated) {
        return { status: "blocked", reason: "High-consequence action requires companion-UI reauthentication." };
      }
    }
    return { status: "allowed", reason: `${definition.title} is authorized by current policy.` };
  }

  createConfirmation(request: ConfirmationRequest): ConfirmationRecord {
    const createdAt = this.now().toISOString();
    const record: StoredConfirmation = {
      ...request,
      id: randomUUID(),
      token: randomUUID(),
      createdAt,
      expiresAt: new Date(this.now().getTime() + this.confirmationTtlMs).toISOString(),
      consumed: false
    };
    this.confirmations.set(record.token, record);
    return withoutConsumed(record);
  }

  /** Creates a short-lived broker permit and consumes a matching confirmation exactly once. */
  issuePermit(subject: PolicySubject): PermitDecision {
    const decision = this.authorize(subject);
    if (decision.status !== "allowed") return decision;
    if (!subject.operationId?.trim()) return { status: "blocked", reason: "A policy permit requires a durable operation binding." };
    if (subject.definition.requiresConfirmation && subject.confirmationToken) {
      const confirmation = this.confirmations.get(subject.confirmationToken);
      if (!confirmation || confirmation.consumed) return { status: "blocked", reason: "Confirmation cannot be consumed." };
      this.confirmations.set(subject.confirmationToken, { ...confirmation, consumed: true });
    }
    const permit: PolicyPermit = {
      id: randomUUID(),
      action: subject.definition.action,
      operationId: subject.operationId,
      targetSnapshotId: subject.target?.id,
      sessionId: subject.session?.id,
      authorityId: subject.authority?.id,
      expiresAt: new Date(this.now().getTime() + this.permitTtlMs).toISOString()
    };
    this.permits.set(permit.id, permit);
    return { ...decision, permit };
  }

  /** Brokers call this before every external effect; a caller cannot forge an in-memory permit. */
  verifyPermit(permit: PolicyPermit | undefined, binding: PermitBinding): boolean {
    if (!permit) return false;
    const stored = this.permits.get(permit.id);
    return !!stored
      && stored.action === binding.action
      && stored.operationId === binding.operationId
      && stored.targetSnapshotId === binding.targetSnapshotId
      && stored.sessionId === binding.sessionId
      && stored.authorityId === binding.authorityId
      && stored.expiresAt === permit.expiresAt
      && !this.expired(stored.expiresAt);
  }

  releasePermit(permit: PolicyPermit | undefined): void {
    if (permit) this.permits.delete(permit.id);
  }

  private authorityFailure(definition: CommandDefinition, target?: TargetSnapshot, session?: ManagedSession, authority?: AuthorityGrant): string | undefined {
    if (!authority) return `${definition.title} requires a current scoped authority grant.`;
    if (authority.revokedAt) return "Authority grant has been revoked.";
    if (this.expired(authority.expiresAt)) return "Authority grant has expired.";
    if (target && authority.repositoryRoot !== target.repositoryRoot) return "Authority does not match the verified repository.";
    if (authority.sessionId && authority.sessionId !== session?.id) return "Authority does not match the selected session.";
    if (authority.taskId && authority.taskId !== session?.taskId) return "Authority does not match the selected session task.";
    if (authority.planRevision && authority.planRevision !== session?.planRevision) return "Authority does not match the selected session plan revision.";
    // Match AuthorityLedger's exact-action contract. Wildcards would make a
    // broad grant easy to smuggle through an adapter boundary.
    if (authority.prohibitedActions.includes(definition.action)) return "Authority explicitly prohibits this action.";
    if (!authority.allowedActions.includes(definition.action)) return "Authority does not allow this exact action.";
    return undefined;
  }

  private expired(value: string): boolean {
    return new Date(value).getTime() <= this.now().getTime();
  }
}

function withoutConsumed(record: StoredConfirmation): ConfirmationRecord {
  const { consumed: _consumed, ...visible } = record;
  return visible;
}
