import type { Assignment, Control, Modifier } from "../../protocol/src/b122.ts";

export type Capability = "registered" | "observable" | "controllable" | "mediated";
export type SessionStatus = "running" | "verified_blocked" | "verified_finished" | "unreachable" | "stale" | "unknown";
export type CommandStatus = "queued" | "running" | "awaiting_input" | "awaiting_confirmation" | "cancelling" | "completed" | "failed" | "timed_out" | "unavailable" | "incomplete" | "blocked" | "cancelled";
export type OperationState = "prepared" | "executing" | "external_committed" | "recorded" | "failed" | "cancelling" | "compensating" | "cancelled";
export type ReceiptResult = "passed" | "failed" | "unavailable" | "incomplete" | "not_run";
/**
 * What is durably known about the external effect behind an outcome. Status
 * describes the user-visible command state; it must never be used to infer
 * whether a provider, network peer, or subprocess accepted an effect.
 */
export type EffectDisposition = "not_started" | "committed" | "ambiguous" | "compensated";

export interface TargetSnapshot {
  readonly id: string;
  readonly repositoryRoot: string;
  readonly canonicalRemote?: string;
  readonly branch?: string;
  /** Host-observed default branch, usually from refs/remotes/origin/HEAD. */
  readonly defaultBranch?: string;
  /** True only when Git positively observed HEAD detached from every branch. */
  readonly detached?: true;
  readonly upstream?: string;
  readonly head?: string;
  readonly indexTree?: string;
  readonly trackedManifest: string;
  readonly untrackedManifest: string;
  readonly submodules: Readonly<Record<string, string>>;
  readonly policyVersion: string;
  readonly environmentFingerprint: string;
  readonly capturedAt: string;
  readonly completeness: "complete" | "incomplete";
  readonly reasons: readonly string[];
}

export interface ManagedSession {
  readonly id: string;
  readonly provider: "claude" | "codex" | "generic" | "voice";
  readonly surface: "vscode_terminal" | "vscode_window" | "desktop" | "browser" | "bridge";
  readonly capabilities: readonly Capability[];
  readonly status: SessionStatus;
  readonly workspaceRoot?: string;
  readonly targetSnapshotId?: string;
  readonly taskId?: string;
  readonly planRevision?: string;
  readonly plannedFiles: readonly string[];
  readonly lastHeartbeat: string;
  readonly adapterVersion: string;
  readonly metadata: Readonly<Record<string, string>>;
}

export interface AuthorityGrant {
  readonly id: string;
  readonly repositoryRoot: string;
  readonly sessionId?: string;
  readonly taskId?: string;
  readonly planRevision?: string;
  readonly allowedActions: readonly string[];
  readonly prohibitedActions: readonly string[];
  readonly expiresAt: string;
  readonly revokedAt?: string;
  readonly issuedAt: string;
  readonly issuedBy: string;
}

export interface OperationRecord {
  readonly id: string;
  readonly parentId?: string;
  readonly idempotencyKey: string;
  readonly action: string;
  readonly targetSnapshotId: string;
  readonly state: OperationState;
  readonly createdAt: string;
  readonly updatedAt: string;
  readonly childIds: readonly string[];
  readonly details: Readonly<Record<string, string>>;
}

export interface ProtectedReceipt {
  readonly id: string;
  readonly operationId: string;
  readonly action: string;
  readonly targetSnapshotId: string;
  readonly authorityId?: string;
  readonly result: ReceiptResult;
  readonly completeness: "complete" | "incomplete";
  readonly evidenceDigest: string;
  readonly policyVersion: string;
  readonly toolVersions: Readonly<Record<string, string>>;
  readonly createdAt: string;
  readonly expiresAt?: string;
  readonly invalidatedBy?: string;
  readonly previousHash?: string;
  readonly hash: string;
}

export interface AuditEvent {
  readonly id: string;
  readonly action: string;
  readonly status: CommandStatus;
  readonly operationId?: string;
  readonly targetSnapshotId?: string;
  readonly at: string;
  readonly detail: string;
}

export interface CommandRequest {
  readonly assignment: Assignment;
  readonly control: Control;
  readonly modifier: Modifier;
  readonly sessionId?: string;
  readonly targetSnapshot?: TargetSnapshot;
  readonly authorityId?: string;
  readonly confirmationToken?: string;
  /** Echo of a host-computed reviewed scope; it cannot mint or broaden a token. */
  readonly confirmationScopeDigest?: string;
  readonly input?: Readonly<Record<string, string>>;
}

export interface CommandResult {
  readonly status: CommandStatus;
  readonly summary: string;
  readonly effectDisposition?: EffectDisposition;
  readonly operationId?: string;
  readonly receiptId?: string;
  readonly data?: Readonly<Record<string, unknown>>;
}
