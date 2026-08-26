import type { EffectGuard } from "../../../packages/control-plane/src/brokers.ts";
import { AuthorityLedger } from "../../../packages/control-plane/src/authority.ts";
import { commandForAction } from "../../../packages/control-plane/src/command-catalog.ts";
import { DurableConfirmationLedger } from "../../../packages/control-plane/src/confirmations.ts";
import type { ManagedSession, TargetSnapshot } from "../../../packages/control-plane/src/contracts.ts";
import {
  DurableReanchorCoordinator,
  ReanchorLifecycleError,
  type DurableReanchorCoordinatorOptions,
  type ReanchorApplyPort,
  type ReanchorLifecycle,
  type ReanchorPreview,
  type ReanchorPreviewPort,
  type ReanchorReceipt,
  type ReanchorState
} from "../../../packages/control-plane/src/reanchor.ts";
import type { TargetResolver } from "../../../packages/control-plane/src/runtime.ts";
import { sessionBindingDigest, SessionRegistry } from "../../../packages/control-plane/src/session-registry.ts";
import { TargetSnapshotLedger } from "../../../packages/control-plane/src/snapshot-ledger.ts";
import { targetSnapshotDigest } from "../../../packages/control-plane/src/snapshot.ts";
import type { ProtectedJsonStore } from "../../../packages/control-plane/src/store.ts";
import type { WindowsUserPresenceRunner } from "./windows-user-presence.ts";

export interface InstalledReanchorBeginInput {
  readonly sessionId: string;
  readonly authorityId: string;
  readonly reason: string;
}

export interface InstalledReanchorConfirmationInput {
  readonly requestId: string;
}

export interface InstalledReanchorStatus {
  readonly schema: "sxsy-b122.installed-reanchor-status";
  readonly version: 1;
  readonly requestId: string;
  readonly operationId: string;
  readonly sessionId: string;
  readonly authorityId: string;
  readonly oldTargetSnapshotId: string;
  readonly newTargetSnapshotId: string;
  readonly state: ReanchorState;
  readonly summary?: string;
  readonly discrepancies?: readonly string[];
  readonly risks?: readonly string[];
  readonly questions?: readonly string[];
  readonly confirmationScopeDigest?: string;
  readonly confirmationExpiresAt?: string;
  readonly receipt?: ReanchorReceipt;
}

export interface InstalledDurableReanchorRuntimeOptions extends DurableReanchorCoordinatorOptions {
  readonly store: ProtectedJsonStore;
  readonly sessions: SessionRegistry;
  readonly authorities: AuthorityLedger;
  readonly snapshots: TargetSnapshotLedger;
  readonly targets: TargetResolver;
  readonly containment: Readonly<{
    inspect(repositoryRoot: string): Promise<Readonly<{ allowed: boolean; fenceEpoch: number; reason: string }>>;
  }>;
  readonly effectGuard: EffectGuard;
  readonly presence: WindowsUserPresenceRunner;
  readonly previewer?: ReanchorPreviewPort;
  readonly applier?: ReanchorApplyPort;
  readonly confirmationTokenFactory?: () => string;
  readonly confirmationIdFactory?: () => string;
}

/**
 * Installed host composition for Durable Re-anchor. Client input selects only
 * a protected session and existing authority. Both snapshots, the one-time
 * confirmation, and every final guard are derived inside the companion.
 */
export class InstalledDurableReanchorRuntime {
  private readonly sessions: SessionRegistry;
  private readonly authorities: AuthorityLedger;
  private readonly snapshots: TargetSnapshotLedger;
  private readonly targets: TargetResolver;
  private readonly presence: WindowsUserPresenceRunner;
  private readonly clock: () => string;
  private readonly confirmations: DurableConfirmationLedger;
  private readonly coordinator: DurableReanchorCoordinator;

  constructor(options: InstalledDurableReanchorRuntimeOptions) {
    this.sessions = options.sessions;
    this.authorities = options.authorities;
    this.snapshots = options.snapshots;
    this.targets = options.targets;
    this.presence = options.presence;
    this.clock = options.clock ?? (() => new Date().toISOString());
    this.confirmations = new DurableConfirmationLedger(options.store, {
      clock: this.clock,
      tokenFactory: options.confirmationTokenFactory,
      idFactory: options.confirmationIdFactory,
      ttlMs: options.confirmationLifetimeMs ?? 2 * 60_000
    });
    this.coordinator = new DurableReanchorCoordinator(options.store, {
      sessions: options.sessions,
      authorities: options.authorities,
      snapshots: {
        isCurrent: (target, expectedSession) => this.isCurrentHostTarget(target, expectedSession)
      },
      containment: options.containment,
      effectGuard: options.effectGuard,
      confirmations: this.confirmations,
      previewer: options.previewer,
      applier: options.applier
    }, {
      clock: this.clock,
      requestLifetimeMs: options.requestLifetimeMs,
      confirmationLifetimeMs: options.confirmationLifetimeMs,
      lifecycleProbe: options.lifecycleProbe
    });
  }

  async begin(input: InstalledReanchorBeginInput): Promise<InstalledReanchorStatus> {
    const exact = exactBeginInput(input);
    const session = await this.requireExactSession(exact.sessionId);
    const oldTarget = await this.snapshots.get(session.targetSnapshotId!);
    if (!oldTarget || oldTarget.completeness !== "complete") {
      throw new ReanchorLifecycleError("The protected old TargetSnapshot is missing or incomplete; Re-anchor cannot infer prior state.");
    }
    if (normalizeRoot(oldTarget.repositoryRoot) !== normalizeRoot(session.workspaceRoot!)) {
      throw new ReanchorLifecycleError("The protected old TargetSnapshot is bound to a different repository than the managed session.");
    }
    const authority = await this.authorities.assertAuthorized({
      authorityId: exact.authorityId,
      repositoryRoot: oldTarget.repositoryRoot,
      sessionId: session.id,
      taskId: session.taskId,
      planRevision: session.planRevision,
      action: "reanchor",
      now: this.now()
    });
    const resolved = await this.targets.resolve({ definition: commandForAction("reanchor"), session });
    const newTarget = await this.requireAndRecordNewTarget(resolved, oldTarget, session);
    const lifecycle = await this.coordinator.request({ oldTarget, newTarget, reason: exact.reason, session, authority });
    await this.coordinator.preview(lifecycle.request.id);
    return this.requireStatus(lifecycle.request.id);
  }

  async confirmAndApply(input: InstalledReanchorConfirmationInput): Promise<InstalledReanchorStatus> {
    const exact = exactConfirmationInput(input);
    let lifecycle = await this.coordinator.get(exact.requestId);
    if (!lifecycle) throw new ReanchorLifecycleError("The installed Re-anchor request is unknown.");
    if (lifecycle.state === "pending_confirmation") {
      const preview = requirePreview(lifecycle);
      const presence = await this.presence.verify(presencePrompt(preview));
      if (!presence.verified || !presence.operator?.trim()) {
        throw new ReanchorLifecycleError("Current-user presence did not approve the exact reviewed Re-anchor transition.");
      }
      lifecycle = await this.confirmWithInternalPresence(lifecycle, preview);
    }
    if (lifecycle.state === "confirmed" || lifecycle.state === "external_committed" || lifecycle.state === "session_rebound") {
      lifecycle = await this.coordinator.apply(lifecycle.request.id);
    }
    return statusFromLifecycle(lifecycle);
  }

  async get(requestId: string): Promise<InstalledReanchorStatus | undefined> {
    const lifecycle = await this.coordinator.get(exactRequestId(requestId));
    return lifecycle ? statusFromLifecycle(lifecycle) : undefined;
  }

  async recover(): Promise<readonly InstalledReanchorStatus[]> {
    return (await this.coordinator.recover()).map(statusFromLifecycle);
  }

  private async confirmWithInternalPresence(lifecycle: ReanchorLifecycle, preview: ReanchorPreview): Promise<ReanchorLifecycle> {
    const issued = await this.confirmations.issue({
      action: "reanchor",
      targetSnapshotId: lifecycle.request.newTarget.id,
      sessionId: lifecycle.request.session.id,
      authorityId: lifecycle.request.authority.id,
      scopeDigest: preview.confirmationScopeDigest,
      reason: "Current-user presence verified the exact Re-anchor preview; automatic resume remains forbidden.",
      reauthenticated: true
    });
    return this.coordinator.confirm({
      requestId: lifecycle.request.id,
      currentUserConfirmed: true,
      confirmationToken: issued.token,
      confirmationScopeDigest: preview.confirmationScopeDigest
    });
  }

  private async requireStatus(requestId: string): Promise<InstalledReanchorStatus> {
    const lifecycle = await this.coordinator.get(requestId);
    if (!lifecycle) throw new ReanchorLifecycleError("The installed Re-anchor request disappeared from protected state.");
    return statusFromLifecycle(lifecycle);
  }

  private async requireExactSession(sessionId: string): Promise<ManagedSession> {
    const session = await this.sessions.get(sessionId);
    if (!session || !session.workspaceRoot || !session.targetSnapshotId || !session.taskId || !session.planRevision
      || session.status === "stale" || session.status === "unreachable" || !session.capabilities.includes("controllable")) {
      throw new ReanchorLifecycleError("Installed Re-anchor requires one live controllable session with exact repository, target, task, and plan bindings.");
    }
    return session;
  }

  private async requireAndRecordNewTarget(resolved: TargetSnapshot | undefined, oldTarget: TargetSnapshot, session: ManagedSession): Promise<TargetSnapshot> {
    if (!resolved || resolved.completeness !== "complete" || resolved.reasons.length !== 0) {
      throw new ReanchorLifecycleError("The trusted host resolver did not produce a complete new TargetSnapshot.");
    }
    if (normalizeRoot(resolved.repositoryRoot) !== normalizeRoot(oldTarget.repositoryRoot)
      || normalizeRoot(resolved.repositoryRoot) !== normalizeRoot(session.workspaceRoot!)) {
      throw new ReanchorLifecycleError("Installed Re-anchor cannot move a managed session across repository roots.");
    }
    if (targetSnapshotDigest(resolved) !== resolved.id) throw new ReanchorLifecycleError("The trusted host resolver returned a TargetSnapshot with an invalid content identity.");
    return this.snapshots.record(resolved);
  }

  private async isCurrentHostTarget(target: TargetSnapshot, expectedSession: ManagedSession): Promise<boolean> {
    const current = await this.sessions.get(expectedSession.id);
    if (!current || !current.workspaceRoot || sessionBindingDigest(current) !== sessionBindingDigest(expectedSession)) return false;
    try {
      const resolved = await this.targets.resolve({ definition: commandForAction("reanchor"), session: current });
      return !!resolved && resolved.completeness === "complete" && resolved.reasons.length === 0
        && normalizeRoot(resolved.repositoryRoot) === normalizeRoot(target.repositoryRoot)
        && normalizeRoot(resolved.repositoryRoot) === normalizeRoot(current.workspaceRoot)
        && targetSnapshotDigest(resolved) === resolved.id && resolved.id === target.id;
    } catch {
      return false;
    }
  }

  private now(): string {
    const value = this.clock();
    if (!Number.isFinite(Date.parse(value))) throw new ReanchorLifecycleError("The installed Re-anchor clock returned an invalid timestamp.");
    return new Date(Date.parse(value)).toISOString();
  }
}

function exactBeginInput(value: InstalledReanchorBeginInput): InstalledReanchorBeginInput {
  if (!isRecord(value) || !exactKeys(value, ["sessionId", "authorityId", "reason"])) {
    throw new ReanchorLifecycleError("Installed Re-anchor accepts one closed session, existing authority, and reason payload; snapshots and confirmation claims are host-owned.");
  }
  return {
    sessionId: reference(value.sessionId, "session id"),
    authorityId: reference(value.authorityId, "authority id"),
    reason: scrubText(value.reason, "Re-anchor reason", 512)
  };
}

function exactConfirmationInput(value: InstalledReanchorConfirmationInput): InstalledReanchorConfirmationInput {
  if (!isRecord(value) || !exactKeys(value, ["requestId"])) throw new ReanchorLifecycleError("Installed Re-anchor confirmation accepts only the protected request identity.");
  return { requestId: exactRequestId(value.requestId) };
}

function exactRequestId(value: unknown): string {
  if (typeof value !== "string" || !/^reanchor:[a-f0-9]{64}$/.test(value)) throw new ReanchorLifecycleError("The installed Re-anchor request identity is malformed.");
  return value;
}

function requirePreview(lifecycle: ReanchorLifecycle): ReanchorPreview {
  if (!lifecycle.preview || lifecycle.state !== "pending_confirmation") throw new ReanchorLifecycleError("The installed Re-anchor request has no exact reviewed preview awaiting confirmation.");
  return lifecycle.preview;
}

function presencePrompt(preview: ReanchorPreview): string {
  const value = `B122 Re-anchor old ${preview.oldTargetSnapshotId} new ${preview.newTargetSnapshotId} scope ${preview.confirmationScopeDigest}; no resume.`;
  if (value.length > 240) throw new ReanchorLifecycleError("The exact Re-anchor user-presence prompt exceeded its trusted bound.");
  return value;
}

function statusFromLifecycle(lifecycle: ReanchorLifecycle): InstalledReanchorStatus {
  const preview = lifecycle.preview;
  return {
    schema: "sxsy-b122.installed-reanchor-status",
    version: 1,
    requestId: lifecycle.request.id,
    operationId: lifecycle.request.operationId,
    sessionId: lifecycle.request.session.id,
    authorityId: lifecycle.request.authority.id,
    oldTargetSnapshotId: lifecycle.request.oldTarget.id,
    newTargetSnapshotId: lifecycle.request.newTarget.id,
    state: lifecycle.state,
    ...(lifecycle.summary ? { summary: lifecycle.summary } : {}),
    ...(preview ? {
      discrepancies: [...preview.discrepancies],
      risks: [...preview.risks],
      questions: [...preview.questions],
      confirmationScopeDigest: preview.confirmationScopeDigest,
      confirmationExpiresAt: preview.confirmationExpiresAt
    } : {}),
    ...(lifecycle.receipt ? { receipt: { ...lifecycle.receipt } } : {})
  };
}

function reference(value: unknown, field: string): string {
  if (typeof value !== "string" || !value.trim() || value.length > 512 || /[\r\n\0]/.test(value)) throw new ReanchorLifecycleError(`The installed Re-anchor ${field} is malformed.`);
  return value.trim();
}

function scrubText(value: unknown, field: string, limit: number): string {
  if (typeof value !== "string" || !value.trim() || value.length > limit || /[\r\n\0]/.test(value)) throw new ReanchorLifecycleError(`The installed ${field} is malformed.`);
  return value.trim()
    .replace(/\b(?:gh[pousr]_[A-Za-z0-9_]{8,}|github_pat_[A-Za-z0-9_]{8,})\b/g, "[REDACTED]")
    .replace(/\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/gi, "[REDACTED]");
}

function normalizeRoot(value: string): string {
  const normalized = value.replaceAll("\\", "/").replace(/\/+$/, "");
  return /^[a-z]:\//i.test(normalized) ? normalized.toLowerCase() : normalized;
}

function isRecord(value: unknown): value is Record<string, unknown> { return typeof value === "object" && value !== null && !Array.isArray(value); }
function exactKeys(value: Record<string, unknown>, required: readonly string[]): boolean {
  const keys = Object.keys(value);
  return keys.length === required.length && required.every((key) => Object.prototype.hasOwnProperty.call(value, key));
}
