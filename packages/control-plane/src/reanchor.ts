import type { AuthorityGrant, ManagedSession, TargetSnapshot } from "./contracts.ts";
import type { EffectGuard } from "./brokers.ts";
import type { ConfirmationConsumeRequest, ConfirmationDecision, DurableConfirmationRecord } from "./confirmations.ts";
import { untrustedSummary } from "./redaction.ts";
import { sessionBindingDigest, type SessionTargetRebindResult } from "./session-registry.ts";
import { targetSnapshotDigest } from "./snapshot.ts";
import { jsonClone, sha256, stableJson, type JournalEntry, ProtectedJsonStore } from "./store.ts";
import { canonicalCoordinatorEvidence, type CoordinatorEvidenceBundle } from "./workflow-artifacts.ts";

export type ReanchorState =
  | "pending_preview"
  | "pending_confirmation"
  | "confirmed"
  | "executing"
  | "external_committed"
  | "session_rebound"
  | "ambiguous"
  | "rejected"
  | "recorded";

export type ReanchorLifecyclePhase =
  | "executing_persisted"
  | "external_effect_returned"
  | "external_committed_persisted"
  | "session_compare_and_swap_returned"
  | "session_rebound_persisted"
  | "receipt_persisted";

export interface ReanchorRequestInput {
  readonly oldTarget: TargetSnapshot;
  readonly newTarget: TargetSnapshot;
  readonly reason: string;
  readonly session: ManagedSession;
  readonly authority: AuthorityGrant;
}

export interface ReanchorRequestRecord extends ReanchorRequestInput {
  readonly version: 1;
  readonly id: string;
  readonly operationId: string;
  readonly sessionBindingDigest: string;
  readonly authorityDigest: string;
  readonly createdAt: string;
  readonly expiresAt: string;
}

export interface ReanchorPreviewContent {
  readonly summary: string;
  readonly discrepancies: readonly string[];
  readonly risks: readonly string[];
  readonly questions: readonly string[];
  /** Protected references the provider must reread after the approved cooperative stop. */
  readonly contextEvidence?: CoordinatorEvidenceBundle;
}

export interface ReanchorPreview extends ReanchorPreviewContent {
  readonly version: 1;
  readonly id: string;
  readonly requestId: string;
  readonly oldTargetSnapshotId: string;
  readonly newTargetSnapshotId: string;
  readonly observedFenceEpoch: number;
  readonly previewDigest: string;
  readonly confirmationScopeDigest: string;
  readonly createdAt: string;
  readonly confirmationExpiresAt: string;
}

export interface ReanchorConfirmation {
  readonly version: 1;
  readonly id: string;
  readonly requestId: string;
  readonly confirmationTokenDigest: string;
  readonly confirmationScopeDigest: string;
  readonly confirmedAt: string;
  readonly expiresAt: string;
}

export interface ReanchorExternalEffect {
  readonly version: 1;
  readonly requestId: string;
  readonly operationId: string;
  readonly externalEffectId: string;
  readonly acknowledgementDigest: string;
  readonly artifactDigest: string;
  readonly rereadEvidence: ReanchorProviderRereadEvidence;
  readonly summary: string;
  readonly report: ReanchorPostStopReport;
  readonly committedAt: string;
}

export interface ReanchorPostStopReport {
  readonly summary: string;
  readonly discrepancies: readonly string[];
  readonly risks: readonly string[];
  readonly questions: readonly string[];
  readonly result: "reanchored_without_resume";
}

export const reanchorRequiredRereads = [
  "original_instructions",
  "task_brief",
  "project_documentation",
  "authority",
  "current_work"
] as const;

export interface ReanchorProviderRereadEvidence {
  readonly contextDigest: string;
  readonly authorityDigest: string;
  readonly instructionDigests: readonly string[];
  readonly planDigest: string;
  readonly documentationDigests: readonly string[];
  readonly currentWorkDigest: string;
  readonly inspectedTargetSnapshotId: string;
}

export interface ReanchorProviderAcknowledgement {
  readonly schema: "sxsy-b122.reanchor-acknowledgement";
  readonly version: 1;
  readonly requestId: string;
  readonly operationId: string;
  readonly externalEffectId: string;
  readonly sessionId: string;
  readonly authorityId: string;
  readonly oldTargetSnapshotId: string;
  readonly newTargetSnapshotId: string;
  readonly cooperativeStopAcknowledged: true;
  readonly resumed: false;
  readonly artifactDigest: string;
  readonly rereadEvidence: ReanchorProviderRereadEvidence;
  readonly report: ReanchorPostStopReport;
}

export interface ReanchorSessionRebind {
  readonly version: 1;
  readonly requestId: string;
  readonly operationId: string;
  readonly sessionId: string;
  readonly oldTargetSnapshotId: string;
  readonly newTargetSnapshotId: string;
  readonly outcome: "rebound" | "already_rebound";
  readonly resultingBindingDigest: string;
  readonly resumed: false;
  readonly reboundAt: string;
}

export interface ReanchorReceipt {
  readonly version: 1;
  readonly id: string;
  readonly requestId: string;
  readonly operationId: string;
  readonly oldTargetSnapshotId: string;
  readonly newTargetSnapshotId: string;
  readonly sessionId: string;
  readonly authorityId: string;
  readonly previewDigest: string;
  readonly confirmationDigest: string;
  readonly confirmationScopeDigest: string;
  readonly externalEffectId: string;
  readonly acknowledgementDigest: string;
  readonly artifactDigest: string;
  readonly rereadEvidence: ReanchorProviderRereadEvidence;
  readonly report: ReanchorPostStopReport;
  readonly sessionRebindOutcome: "rebound" | "already_rebound";
  readonly resultingBindingDigest: string;
  readonly resumed: false;
  readonly evidenceDigest: string;
  readonly result: "reanchored_without_resume";
  readonly createdAt: string;
}

export interface ReanchorLifecycle {
  readonly request: ReanchorRequestRecord;
  readonly state: ReanchorState;
  readonly preview?: ReanchorPreview;
  readonly confirmation?: ReanchorConfirmation;
  readonly externalEffect?: ReanchorExternalEffect;
  readonly sessionRebind?: ReanchorSessionRebind;
  readonly receipt?: ReanchorReceipt;
  readonly summary?: string;
}

export interface ReanchorPreviewPort {
  /** This port is read-only. It receives immutable copies and has no apply capability. */
  preview(input: Readonly<{
    oldTarget: TargetSnapshot;
    newTarget: TargetSnapshot;
    reason: string;
    session: ManagedSession;
    authority: AuthorityGrant;
  }>): Promise<ReanchorPreviewContent>;
}

export interface ReanchorApplyRequest {
  readonly version: 1;
  readonly requestId: string;
  readonly operationId: string;
  readonly oldTargetSnapshotId: string;
  readonly newTargetSnapshotId: string;
  readonly sessionId: string;
  readonly authorityId: string;
  readonly reason: string;
  readonly previewDigest: string;
  readonly confirmationDigest: string;
  readonly confirmationScopeDigest: string;
  readonly artifactDigest: string;
  readonly provider: "claude" | "codex";
  readonly session: ManagedSession;
  readonly repositoryRoot: string;
  readonly taskId: string;
  readonly planRevision: string;
  readonly plannedFiles: readonly string[];
  readonly authority: AuthorityGrant;
  readonly oldTarget: TargetSnapshot;
  readonly newTarget: TargetSnapshot;
  readonly contextEvidence: CoordinatorEvidenceBundle;
  readonly requiredRereads: typeof reanchorRequiredRereads;
  readonly rereadEvidence: ReanchorProviderRereadEvidence;
  /** Re-anchor pauses and reports; it never silently resumes the managed agent. */
  readonly cooperativeStopRequested: true;
  readonly resumeAuthorized: false;
  /** The lifecycle never carries credentials or a network grant into the default effect boundary. */
  readonly credentials?: never;
  readonly network?: never;
}

export type ReanchorApplyOutcome =
  | Readonly<{ disposition: "committed"; acknowledgement: ReanchorProviderAcknowledgement }>
  | Readonly<{ disposition: "not_started"; summary: string }>
  | Readonly<{ disposition: "ambiguous"; summary: string }>;

export interface ReanchorApplyPort {
  apply(input: ReanchorApplyRequest): Promise<ReanchorApplyOutcome>;
}

/** Recomputed independently by every provider boundary before a dispatch lease is consumed. */
export function reanchorApplyArtifactDigest(input: Omit<ReanchorApplyRequest, "artifactDigest">): string {
  return sha256(stableJson(input));
}

/** Closed decoder shared by installed provider boundaries; it grants no authority and reveals no credentials. */
export function canonicalReanchorApplyRequest(value: unknown): ReanchorApplyRequest {
  const keys = [
    "version", "requestId", "operationId", "oldTargetSnapshotId", "newTargetSnapshotId", "sessionId", "authorityId",
    "reason", "previewDigest", "confirmationDigest", "confirmationScopeDigest", "artifactDigest", "provider", "session",
    "repositoryRoot", "taskId", "planRevision", "plannedFiles", "authority", "oldTarget", "newTarget", "contextEvidence",
    "requiredRereads", "rereadEvidence", "cooperativeStopRequested", "resumeAuthorized"
  ] as const;
  if (!isRecord(value) || !exactKeys(value, keys) || value.version !== 1
    || typeof value.requestId !== "string" || !/^reanchor:[a-f0-9]{64}$/.test(value.requestId)
    || typeof value.operationId !== "string" || value.operationId !== `reanchor-operation:${sha256(value.requestId)}`
    || typeof value.previewDigest !== "string" || !digest(value.previewDigest)
    || typeof value.confirmationDigest !== "string" || !digest(value.confirmationDigest)
    || typeof value.confirmationScopeDigest !== "string" || !digest(value.confirmationScopeDigest)
    || typeof value.artifactDigest !== "string" || !digest(value.artifactDigest)
    || (value.provider !== "claude" && value.provider !== "codex")
    || value.cooperativeStopRequested !== true || value.resumeAuthorized !== false) {
    throw new ReanchorLifecycleError("The provider Re-anchor request is open, malformed, or not an exact stop-without-resume transition.");
  }
  const exact = exactRequestInput({
    oldTarget: value.oldTarget,
    newTarget: value.newTarget,
    reason: value.reason,
    session: value.session,
    authority: value.authority
  } as ReanchorRequestInput);
  const { oldTarget, newTarget, reason, session, authority } = exact;
  if (session.provider !== value.provider || !session.taskId || !session.planRevision || !session.workspaceRoot
    || value.sessionId !== session.id || value.authorityId !== authority.id
    || value.oldTargetSnapshotId !== oldTarget.id || value.newTargetSnapshotId !== newTarget.id
    || typeof value.repositoryRoot !== "string" || normalizeRepository(value.repositoryRoot) !== normalizeRepository(oldTarget.repositoryRoot)
    || value.taskId !== session.taskId || value.planRevision !== session.planRevision
    || !Array.isArray(value.plannedFiles) || stableJson(value.plannedFiles) !== stableJson(session.plannedFiles)
    || authority.revokedAt !== undefined || !authority.allowedActions.includes("reanchor") || authority.prohibitedActions.includes("reanchor")
    || normalizeRepository(authority.repositoryRoot) !== normalizeRepository(oldTarget.repositoryRoot)
    || (authority.sessionId !== undefined && authority.sessionId !== session.id)
    || (authority.taskId !== undefined && authority.taskId !== session.taskId)
    || (authority.planRevision !== undefined && authority.planRevision !== session.planRevision)) {
    throw new ReanchorLifecycleError("The provider Re-anchor request changed its exact session, authority, repository, task, plan, or target binding.");
  }
  const contextEvidence = canonicalCoordinatorEvidence(value.contextEvidence as CoordinatorEvidenceBundle);
  if (contextEvidence.plan.originSessionId !== session.id || contextEvidence.plan.taskId !== session.taskId
    || contextEvidence.plan.revision !== session.planRevision || contextEvidence.instructions.length === 0
    || contextEvidence.documentation.length === 0 || contextEvidence.files.length === 0 || contextEvidence.tests.length === 0
    || stableJson(value.requiredRereads) !== stableJson(reanchorRequiredRereads)) {
    throw new ReanchorLifecycleError("The provider Re-anchor request does not carry every exact protected reread binding.");
  }
  const rereadEvidence: ReanchorProviderRereadEvidence = {
    contextDigest: contextEvidence.contextDigest,
    authorityDigest: sha256(stableJson(authority)),
    instructionDigests: contextEvidence.instructions.map((item) => item.digest),
    planDigest: contextEvidence.plan.digest,
    documentationDigests: contextEvidence.documentation.map((item) => item.digest),
    currentWorkDigest: sha256(stableJson({
      diffDigest: contextEvidence.diff.digest,
      fileDigests: contextEvidence.files.map((item) => item.digest),
      testDigests: contextEvidence.tests.map((item) => item.digest),
      newTarget
    })),
    inspectedTargetSnapshotId: newTarget.id
  };
  exactRereadEvidence(value.rereadEvidence, rereadEvidence);
  const material: Omit<ReanchorApplyRequest, "artifactDigest"> = {
    version: 1,
    requestId: value.requestId,
    operationId: value.operationId,
    oldTargetSnapshotId: oldTarget.id,
    newTargetSnapshotId: newTarget.id,
    sessionId: session.id,
    authorityId: authority.id,
    reason,
    previewDigest: value.previewDigest,
    confirmationDigest: value.confirmationDigest,
    confirmationScopeDigest: value.confirmationScopeDigest,
    provider: value.provider,
    session,
    repositoryRoot: oldTarget.repositoryRoot,
    taskId: session.taskId,
    planRevision: session.planRevision,
    plannedFiles: [...session.plannedFiles],
    authority,
    oldTarget,
    newTarget,
    contextEvidence,
    requiredRereads: reanchorRequiredRereads,
    rereadEvidence,
    cooperativeStopRequested: true,
    resumeAuthorized: false
  };
  if (value.artifactDigest !== reanchorApplyArtifactDigest(material)) {
    throw new ReanchorLifecycleError("The provider Re-anchor request artifact binding changed.");
  }
  return { ...material, artifactDigest: value.artifactDigest };
}

export function canonicalReanchorProviderAcknowledgement(value: unknown, request: ReanchorApplyRequest): ReanchorProviderAcknowledgement {
  const outcome = exactApplyOutcome({ disposition: "committed", acknowledgement: value }, request);
  if (outcome.disposition !== "committed") throw new ReanchorLifecycleError("The provider Re-anchor acknowledgement is not committed evidence.");
  return outcome.acknowledgement;
}

export interface ReanchorCoordinatorDependencies {
  readonly sessions: Readonly<{
    get(sessionId: string): Promise<ManagedSession | undefined>;
    compareAndSwapTarget(input: Readonly<{
      sessionId: string;
      expectedBindingDigest: string;
      oldTargetSnapshotId: string;
      newTargetSnapshotId: string;
      operationId: string;
    }>): Promise<SessionTargetRebindResult>;
  }>;
  readonly authorities: Readonly<{ get(authorityId: string): Promise<AuthorityGrant | undefined> }>;
  readonly snapshots: Readonly<{ isCurrent(target: TargetSnapshot, session: ManagedSession): Promise<boolean> }>;
  readonly containment: Readonly<{
    inspect(repositoryRoot: string): Promise<Readonly<{ allowed: boolean; fenceEpoch: number; reason: string }>>;
  }>;
  readonly effectGuard: EffectGuard;
  /** Protected current-user confirmation issuer/consumer; client booleans alone never authorize apply. */
  readonly confirmations: Readonly<{ consume(input: ConfirmationConsumeRequest): Promise<ConfirmationDecision> }>;
  readonly previewer?: ReanchorPreviewPort;
  /** Omission is the fail-closed default: no provider, credential, or network effect exists. */
  readonly applier?: ReanchorApplyPort;
}

export interface DurableReanchorCoordinatorOptions {
  readonly clock?: () => string;
  readonly requestLifetimeMs?: number;
  readonly confirmationLifetimeMs?: number;
  /** Deterministic crash seam for isolated recovery tests; production omits it. */
  readonly lifecycleProbe?: (phase: ReanchorLifecyclePhase) => Promise<void> | void;
}

export interface ReanchorConfirmationInput {
  readonly requestId: string;
  readonly currentUserConfirmed: true;
  readonly confirmationToken: string;
  readonly confirmationScopeDigest: string;
}

type ReanchorEvent =
  | Readonly<{ event: "requested"; request: ReanchorRequestRecord }>
  | Readonly<{ event: "previewed"; requestId: string; preview: ReanchorPreview }>
  | Readonly<{ event: "confirmed"; requestId: string; confirmation: ReanchorConfirmation }>
  | Readonly<{ event: "executing"; requestId: string; operationId: string; attemptId: string; startedAt: string }>
  | Readonly<{ event: "external_committed"; requestId: string; effect: ReanchorExternalEffect }>
  | Readonly<{ event: "session_rebound"; requestId: string; rebind: ReanchorSessionRebind }>
  | Readonly<{ event: "ambiguous"; requestId: string; summary: string; at: string }>
  | Readonly<{ event: "rejected"; requestId: string; summary: string; at: string }>
  | Readonly<{ event: "recorded"; requestId: string; receipt: ReanchorReceipt }>;

const legacyAmbiguitySummary = "Legacy Re-anchor provider evidence lacks the exact dual-target acknowledgement and protected session rebind; manual reconciliation is required.";

export class ReanchorLifecycleError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ReanchorLifecycleError";
  }
}

/**
 * Durable, no-replay lifecycle for moving one exact managed provider context
 * from an old TargetSnapshot to a freshly verified one. Preview is read-only;
 * the optional effect port cannot be reached without a current-user-bound
 * confirmation and final target/authority/fence/effect checks.
 */
export class DurableReanchorCoordinator {
  private readonly store: ProtectedJsonStore;
  private readonly dependencies: ReanchorCoordinatorDependencies;
  private readonly clock: () => string;
  private readonly requestLifetimeMs: number;
  private readonly confirmationLifetimeMs: number;
  private readonly lifecycleProbe?: (phase: ReanchorLifecyclePhase) => Promise<void> | void;

  constructor(store: ProtectedJsonStore, dependencies: ReanchorCoordinatorDependencies, options: DurableReanchorCoordinatorOptions = {}) {
    this.store = store;
    this.dependencies = dependencies;
    this.clock = options.clock ?? (() => new Date().toISOString());
    this.requestLifetimeMs = options.requestLifetimeMs ?? 5 * 60_000;
    this.confirmationLifetimeMs = options.confirmationLifetimeMs ?? 2 * 60_000;
    this.lifecycleProbe = options.lifecycleProbe;
    if (!Number.isSafeInteger(this.requestLifetimeMs) || this.requestLifetimeMs < 1_000 || this.requestLifetimeMs > 15 * 60_000) {
      throw new ReanchorLifecycleError("The re-anchor request lifetime is outside safe bounds.");
    }
    if (!Number.isSafeInteger(this.confirmationLifetimeMs) || this.confirmationLifetimeMs < 500 || this.confirmationLifetimeMs > this.requestLifetimeMs) {
      throw new ReanchorLifecycleError("The re-anchor confirmation lifetime is outside safe bounds.");
    }
  }

  async request(input: ReanchorRequestInput): Promise<ReanchorLifecycle> {
    const exact = exactRequestInput(input);
    const createdAt = this.now();
    const authorityDigest = sha256(stableJson(exact.authority));
    const exactSessionBindingDigest = sessionBindingDigest(exact.session);
    const material = {
      authorityDigest,
      newTarget: exact.newTarget,
      oldTarget: exact.oldTarget,
      reason: exact.reason,
      sessionBindingDigest: exactSessionBindingDigest
    };
    const id = `reanchor:${sha256(stableJson(material))}`;
    const request: ReanchorRequestRecord = {
      version: 1,
      id,
      operationId: `reanchor-operation:${sha256(id)}`,
      ...exact,
      sessionBindingDigest: exactSessionBindingDigest,
      authorityDigest,
      createdAt,
      expiresAt: new Date(Math.min(Date.parse(exact.authority.expiresAt), Date.parse(createdAt) + this.requestLifetimeMs)).toISOString()
    };
    return this.store.transaction(async (transaction) => {
      const existing = lifecycleMap(await transaction.readEntries()).get(id);
      if (existing) {
        if (!sameRequestMaterial(existing.request, request)) throw new ReanchorLifecycleError("The deterministic re-anchor request ID is bound to different protected material.");
        return cloneLifecycle(existing);
      }
      assertAuthorityActive(exact.authority, exact, createdAt);
      await transaction.append<ReanchorEvent>("reanchor.requested", { event: "requested", request });
      return { request: cloneRequest(request), state: "pending_preview" };
    });
  }

  async preview(requestId: string): Promise<ReanchorPreview> {
    const request = await this.requireRequest(requestId);
    const existing = await this.get(request.id);
    if (existing?.preview) return clonePreview(existing.preview);
    if (existing?.state !== "pending_preview") throw new ReanchorLifecycleError("The re-anchor request is not awaiting a read-only preview.");
    this.assertRequestLive(request);

    const preflight = await this.readOnlyPreflight(request);
    const content = exactPreviewContent(this.dependencies.previewer
      ? await this.dependencies.previewer.preview({
        oldTarget: cloneSnapshot(request.oldTarget),
        newTarget: cloneSnapshot(request.newTarget),
        reason: request.reason,
        session: cloneSession(request.session),
        authority: cloneAuthority(request.authority)
      })
      : defaultPreview(request));
    const createdAt = this.now();
    this.assertRequestLive(request, createdAt);
    const previewDigest = sha256(stableJson({ content, fenceEpoch: preflight.fenceEpoch, requestId: request.id }));
    const id = `reanchor-preview:${sha256(stableJson({ previewDigest, requestId: request.id }))}`;
    const confirmationExpiresAt = new Date(Math.min(Date.parse(request.expiresAt), Date.parse(createdAt) + this.confirmationLifetimeMs)).toISOString();
    const confirmationScopeDigest = sha256(stableJson({
      authorityDigest: request.authorityDigest,
      confirmationExpiresAt,
      fenceEpoch: preflight.fenceEpoch,
      newTargetSnapshotId: request.newTarget.id,
      oldTargetSnapshotId: request.oldTarget.id,
      previewDigest,
      requestId: request.id,
      sessionBindingDigest: request.sessionBindingDigest
    }));
    const preview: ReanchorPreview = {
      version: 1,
      id,
      requestId: request.id,
      oldTargetSnapshotId: request.oldTarget.id,
      newTargetSnapshotId: request.newTarget.id,
      observedFenceEpoch: preflight.fenceEpoch,
      ...content,
      previewDigest,
      confirmationScopeDigest,
      createdAt,
      confirmationExpiresAt
    };
    return this.store.transaction(async (transaction) => {
      const current = lifecycleMap(await transaction.readEntries()).get(request.id);
      if (!current) throw new ReanchorLifecycleError("The durable re-anchor request disappeared before preview recording.");
      if (current.preview) return clonePreview(current.preview);
      if (current.state !== "pending_preview" || !sameRequestMaterial(current.request, request)) {
        throw new ReanchorLifecycleError("The re-anchor request changed before preview recording.");
      }
      await transaction.append<ReanchorEvent>("reanchor.previewed", { event: "previewed", requestId: request.id, preview });
      return clonePreview(preview);
    });
  }

  async confirm(input: ReanchorConfirmationInput): Promise<ReanchorLifecycle> {
    exactConfirmationInput(input);
    const reviewed = await this.get(input.requestId);
    if (!reviewed) throw new ReanchorLifecycleError("The re-anchor confirmation names an unknown durable request.");
    if (reviewed.confirmation) {
      if (reviewed.confirmation.confirmationTokenDigest !== sha256(input.confirmationToken) || reviewed.confirmation.confirmationScopeDigest !== input.confirmationScopeDigest) {
        throw new ReanchorLifecycleError("A confirmed re-anchor request cannot be rebound to another confirmation.");
      }
      return reviewed;
    }
    if (reviewed.state !== "pending_confirmation" || !reviewed.preview) throw new ReanchorLifecycleError("The re-anchor request requires its read-only preview before confirmation.");
    const reviewedAt = this.now();
    this.assertRequestLive(reviewed.request, reviewedAt);
    if (Date.parse(reviewed.preview.confirmationExpiresAt) <= Date.parse(reviewedAt)) throw new ReanchorLifecycleError("The re-anchor confirmation window expired; preview the current state again in a new request.");
    if (input.confirmationScopeDigest !== reviewed.preview.confirmationScopeDigest) throw new ReanchorLifecycleError("The human confirmation does not match the exact re-anchor preview scope.");
    const consumed = exactConsumedConfirmation(await this.dependencies.confirmations.consume({
      token: input.confirmationToken,
      action: "reanchor",
      targetSnapshotId: reviewed.request.newTarget.id,
      sessionId: reviewed.request.session.id,
      authorityId: reviewed.request.authority.id,
      scopeDigest: input.confirmationScopeDigest
    }), input, reviewed);
    return this.store.transaction(async (transaction) => {
      const current = lifecycleMap(await transaction.readEntries()).get(input.requestId);
      if (!current) throw new ReanchorLifecycleError("The re-anchor confirmation names an unknown durable request.");
      if (current.confirmation) {
        const tokenDigest = sha256(input.confirmationToken);
        if (current.confirmation.confirmationTokenDigest !== tokenDigest || current.confirmation.confirmationScopeDigest !== input.confirmationScopeDigest) {
          throw new ReanchorLifecycleError("A confirmed re-anchor request cannot be rebound to another confirmation.");
        }
        return cloneLifecycle(current);
      }
      if (current.state !== "pending_confirmation" || !current.preview) throw new ReanchorLifecycleError("The re-anchor request requires its read-only preview before confirmation.");
      const now = this.now();
      this.assertRequestLive(current.request, now);
      if (Date.parse(current.preview.confirmationExpiresAt) <= Date.parse(now)) throw new ReanchorLifecycleError("The re-anchor confirmation window expired; preview the current state again in a new request.");
      if (Date.parse(consumed.expiresAt) <= Date.parse(now)) throw new ReanchorLifecycleError("The protected current-user confirmation expired before durable re-anchor recording.");
      if (input.confirmationScopeDigest !== current.preview.confirmationScopeDigest) throw new ReanchorLifecycleError("The human confirmation does not match the exact re-anchor preview scope.");
      const confirmation: ReanchorConfirmation = {
        version: 1,
        id: `reanchor-confirmation:${sha256(stableJson({ requestId: current.request.id, scope: input.confirmationScopeDigest }))}`,
        requestId: current.request.id,
        confirmationTokenDigest: consumed.tokenDigest,
        confirmationScopeDigest: input.confirmationScopeDigest,
        confirmedAt: consumed.consumedAt!,
        expiresAt: new Date(Math.min(Date.parse(current.preview.confirmationExpiresAt), Date.parse(consumed.expiresAt))).toISOString()
      };
      await transaction.append<ReanchorEvent>("reanchor.confirmed", { event: "confirmed", requestId: current.request.id, confirmation });
      return cloneLifecycle({ ...current, state: "confirmed", confirmation });
    });
  }

  async apply(requestId: string): Promise<ReanchorLifecycle> {
    const exactId = exactRequestId(requestId);
    const claimed = await this.claimApply(exactId);
    if (!claimed.execute) {
      if (claimed.lifecycle.state === "external_committed") return this.finalizeSessionRebind(exactId);
      if (claimed.lifecycle.state === "session_rebound") return this.finalizeReceipt(exactId);
      return claimed.lifecycle;
    }
    const lifecycle = claimed.lifecycle;
    await this.probe("executing_persisted");
    try {
      await this.finalPreEffectChecks(lifecycle);
    } catch (error) {
      return this.reject(exactId, safeFailure(error, "Final re-anchor safety checks failed; no provider effect was started."));
    }
    if (!this.dependencies.applier) {
      return this.reject(exactId, "The re-anchor apply adapter is unavailable; the default lifecycle has no credential, network, or provider mutation effect.");
    }

    let applyRequest: ReanchorApplyRequest;
    try {
      applyRequest = buildApplyRequest(lifecycle);
    } catch (error) {
      return this.reject(exactId, safeFailure(error, "The reviewed Re-anchor packet lacks protected context evidence; no provider effect was started."));
    }
    let outcome: ReanchorApplyOutcome;
    try {
      outcome = exactApplyOutcome(await this.dependencies.applier.apply(applyRequest), applyRequest);
    } catch {
      return this.markAmbiguous(exactId, "The re-anchor apply boundary threw without a trustworthy effect disposition; reconciliation is required and the effect will not be replayed.");
    }
    await this.probe("external_effect_returned");
    if (outcome.disposition === "not_started") return this.reject(exactId, outcome.summary);
    if (outcome.disposition === "ambiguous") return this.markAmbiguous(exactId, outcome.summary);

    const effect: ReanchorExternalEffect = {
      version: 1,
      requestId: lifecycle.request.id,
      operationId: lifecycle.request.operationId,
      externalEffectId: outcome.acknowledgement.externalEffectId,
      acknowledgementDigest: sha256(stableJson(outcome.acknowledgement)),
      artifactDigest: outcome.acknowledgement.artifactDigest,
      rereadEvidence: outcome.acknowledgement.rereadEvidence,
      summary: outcome.acknowledgement.report.summary,
      report: outcome.acknowledgement.report,
      committedAt: this.now()
    };
    await this.store.transaction(async (transaction) => {
      const current = lifecycleMap(await transaction.readEntries()).get(exactId);
      if (!current) throw new ReanchorLifecycleError("The executing re-anchor request disappeared before its external commit marker.");
      if (current.state === "external_committed" || current.state === "recorded") return;
      if (current.state !== "executing") throw new ReanchorLifecycleError("The re-anchor operation changed while recording its external commit marker.");
      await transaction.append<ReanchorEvent>("reanchor.external_committed", { event: "external_committed", requestId: exactId, effect });
    });
    await this.probe("external_committed_persisted");
    return this.finalizeSessionRebind(exactId);
  }

  async get(requestId: string): Promise<ReanchorLifecycle | undefined> {
    const lifecycle = lifecycleMap(await this.store.readEntries()).get(exactRequestId(requestId));
    return lifecycle ? cloneLifecycle(lifecycle) : undefined;
  }

  /**
   * Host-only final-current view used while minting the one-use provider
   * dispatch lease. A pending, settled, ambiguous, or recovered lifecycle can
   * never obtain another effect capability.
   */
  async executingApplyRequest(requestId: string): Promise<ReanchorApplyRequest | undefined> {
    const lifecycle = await this.get(requestId);
    if (!lifecycle || lifecycle.state !== "executing") return undefined;
    return jsonClone(buildApplyRequest(lifecycle));
  }

  /**
   * Restart recovery never invokes the effect port. Pending work stays pending,
   * an executing boundary becomes ambiguous, and a durable external commit is
   * finalized into its deterministic receipt without replay.
   */
  async recover(): Promise<readonly ReanchorLifecycle[]> {
    await this.store.transaction(async (transaction) => {
      const current = lifecycleMap(await transaction.readEntries());
      for (const lifecycle of current.values()) {
        if (lifecycle.state === "executing") {
          await transaction.append<ReanchorEvent>("reanchor.ambiguous", {
            event: "ambiguous",
            requestId: lifecycle.request.id,
            summary: "Recovery found an executing re-anchor boundary; an external effect may have committed, so automatic replay is forbidden.",
            at: this.now()
          });
        }
      }
    });
    const pending = [...lifecycleMap(await this.store.readEntries()).values()];
    for (const lifecycle of pending) {
      if (lifecycle.state === "external_committed") await this.finalizeSessionRebind(lifecycle.request.id);
      else if (lifecycle.state === "session_rebound") await this.finalizeReceipt(lifecycle.request.id);
    }
    return [...lifecycleMap(await this.store.readEntries()).values()].map(cloneLifecycle);
  }

  private async claimApply(requestId: string): Promise<Readonly<{ execute: boolean; lifecycle: ReanchorLifecycle }>> {
    return this.store.transaction(async (transaction) => {
      const current = lifecycleMap(await transaction.readEntries()).get(requestId);
      if (!current) throw new ReanchorLifecycleError("The re-anchor apply request names an unknown durable request.");
      if (["recorded", "rejected", "ambiguous", "executing", "external_committed", "session_rebound"].includes(current.state)) {
        return { execute: false, lifecycle: cloneLifecycle(current) };
      }
      if (current.state !== "confirmed" || !current.preview || !current.confirmation) {
        throw new ReanchorLifecycleError("The re-anchor request requires a read-only preview and exact human confirmation before apply.");
      }
      const now = this.now();
      if (Date.parse(current.request.expiresAt) <= Date.parse(now) || Date.parse(current.confirmation.expiresAt) <= Date.parse(now)) {
        const summary = "The confirmed re-anchor request expired before the provider effect; no effect was started.";
        await transaction.append<ReanchorEvent>("reanchor.rejected", { event: "rejected", requestId, summary, at: now });
        return { execute: false, lifecycle: cloneLifecycle({ ...current, state: "rejected", summary }) };
      }
      const attemptId = `reanchor-attempt:${sha256(stableJson({ operationId: current.request.operationId, requestId }))}`;
      await transaction.append<ReanchorEvent>("reanchor.executing", { event: "executing", requestId, operationId: current.request.operationId, attemptId, startedAt: now });
      return { execute: true, lifecycle: cloneLifecycle({ ...current, state: "executing" }) };
    });
  }

  private async readOnlyPreflight(request: ReanchorRequestRecord): Promise<Readonly<{ fenceEpoch: number }>> {
    await this.assertCurrentAuthority(request);
    const currentSession = await this.assertCurrentSession(request);
    if (!await this.dependencies.snapshots.isCurrent(cloneSnapshot(request.newTarget), currentSession)) {
      throw new ReanchorLifecycleError("The proposed new TargetSnapshot is stale or incomplete; no re-anchor preview was accepted.");
    }
    const containment = exactContainmentInspection(await this.dependencies.containment.inspect(request.newTarget.repositoryRoot));
    if (!containment.allowed) throw new ReanchorLifecycleError(`Containment blocks this re-anchor lifecycle: ${containment.reason}`);
    return { fenceEpoch: containment.fenceEpoch };
  }

  private async finalPreEffectChecks(lifecycle: ReanchorLifecycle): Promise<void> {
    if (!lifecycle.preview || !lifecycle.confirmation) throw new ReanchorLifecycleError("The executing re-anchor lifecycle lost its reviewed confirmation binding.");
    const now = this.now();
    this.assertRequestLive(lifecycle.request, now);
    if (Date.parse(lifecycle.confirmation.expiresAt) <= Date.parse(now)) throw new ReanchorLifecycleError("The human re-anchor confirmation expired before the final effect boundary.");
    await this.assertCurrentAuthority(lifecycle.request);
    const currentSession = await this.assertCurrentSession(lifecycle.request);
    if (!await this.dependencies.snapshots.isCurrent(cloneSnapshot(lifecycle.request.newTarget), currentSession)) {
      throw new ReanchorLifecycleError("The proposed new TargetSnapshot changed before the final re-anchor effect boundary.");
    }
    const containment = exactContainmentInspection(await this.dependencies.containment.inspect(lifecycle.request.newTarget.repositoryRoot));
    if (!containment.allowed || containment.fenceEpoch !== lifecycle.preview.observedFenceEpoch) {
      throw new ReanchorLifecycleError("The containment fence changed after preview; the re-anchor effect was not started.");
    }
    const guard = await this.dependencies.effectGuard.assertCurrent({
      action: "reanchor",
      operationId: lifecycle.request.operationId,
      target: cloneSnapshot(lifecycle.request.newTarget),
      session: currentSession,
      authority: cloneAuthority(lifecycle.request.authority)
    });
    if (!guard.allowed) throw new ReanchorLifecycleError(`The final effect guard rejected re-anchor: ${boundedText(guard.reason, "effect-guard reason", 512)}`);
  }

  private async finalPostEffectChecks(lifecycle: ReanchorLifecycle): Promise<void> {
    if (!lifecycle.preview || !lifecycle.externalEffect) throw new ReanchorLifecycleError("The committed re-anchor lifecycle lost its reviewed target or provider acknowledgement.");
    await this.assertCurrentAuthority(lifecycle.request);
    const currentSession = await this.assertCurrentOrExactlyReboundSession(lifecycle.request);
    if (!await this.dependencies.snapshots.isCurrent(cloneSnapshot(lifecycle.request.newTarget), currentSession)) {
      throw new ReanchorLifecycleError("The proposed new TargetSnapshot changed after provider acknowledgement; the session binding remains unknown.");
    }
    const containment = exactContainmentInspection(await this.dependencies.containment.inspect(lifecycle.request.newTarget.repositoryRoot));
    if (!containment.allowed || containment.fenceEpoch !== lifecycle.preview.observedFenceEpoch) {
      throw new ReanchorLifecycleError("The containment fence changed after provider acknowledgement; the session binding remains unknown.");
    }
    const guard = await this.dependencies.effectGuard.assertCurrent({
      action: "reanchor",
      operationId: lifecycle.request.operationId,
      target: cloneSnapshot(lifecycle.request.newTarget),
      session: currentSession,
      authority: cloneAuthority(lifecycle.request.authority)
    });
    if (!guard.allowed) throw new ReanchorLifecycleError(`The post-effect guard could not prove the re-anchor binding current: ${boundedText(guard.reason, "effect-guard reason", 512)}`);
  }

  private async assertCurrentAuthority(request: ReanchorRequestRecord): Promise<AuthorityGrant> {
    const current = await this.dependencies.authorities.get(request.authority.id);
    if (!current || sha256(stableJson(exactAuthority(current))) !== request.authorityDigest) {
      throw new ReanchorLifecycleError("The scoped authority changed or was revoked after the re-anchor request was created.");
    }
    assertAuthorityActive(current, request, this.now());
    return cloneAuthority(current);
  }

  private async assertCurrentSession(request: ReanchorRequestRecord): Promise<ManagedSession> {
    const current = await this.dependencies.sessions.get(request.session.id);
    if (!current || sessionBindingDigest(exactSession(current)) !== request.sessionBindingDigest
      || current.targetSnapshotId !== request.oldTarget.id || current.status === "stale" || current.status === "unreachable"
      || !current.capabilities.includes("controllable")) {
      throw new ReanchorLifecycleError("The managed session changed its exact task, adapter, authority anchor, or controllable status.");
    }
    return cloneSession(current);
  }

  private async assertCurrentOrExactlyReboundSession(request: ReanchorRequestRecord): Promise<ManagedSession> {
    const current = await this.dependencies.sessions.get(request.session.id);
    if (!current) throw new ReanchorLifecycleError("The managed session disappeared after the provider Re-anchor acknowledgement.");
    const exact = exactSession(current);
    if (exact.targetSnapshotId === request.oldTarget.id && sessionBindingDigest(exact) === request.sessionBindingDigest
      && exact.status !== "stale" && exact.status !== "unreachable" && exact.capabilities.includes("controllable")) return cloneSession(exact);
    const expectedRebound = expectedReboundSession(request);
    if (exact.targetSnapshotId !== request.newTarget.id || exact.status !== "unknown"
      || sessionBindingDigest(exact) !== sessionBindingDigest(expectedRebound)) {
      throw new ReanchorLifecycleError("The managed session is neither at the exact old binding nor at the exact no-resume Re-anchor binding.");
    }
    return cloneSession(exact);
  }

  private async reject(requestId: string, summary: string): Promise<ReanchorLifecycle> {
    const exactSummary = boundedText(summary, "re-anchor rejection summary", 512);
    return this.appendTerminal(requestId, "rejected", exactSummary);
  }

  private async markAmbiguous(requestId: string, summary: string): Promise<ReanchorLifecycle> {
    const exactSummary = boundedText(summary, "re-anchor ambiguity summary", 512);
    return this.appendTerminal(requestId, "ambiguous", exactSummary);
  }

  private async appendTerminal(requestId: string, state: "rejected" | "ambiguous", summary: string): Promise<ReanchorLifecycle> {
    return this.store.transaction(async (transaction) => {
      const current = lifecycleMap(await transaction.readEntries()).get(requestId);
      if (!current) throw new ReanchorLifecycleError("The re-anchor operation disappeared before terminal recording.");
      if (current.state === state) return cloneLifecycle(current);
      if (current.state !== "executing" && !(state === "ambiguous" && current.state === "external_committed")) throw new ReanchorLifecycleError("The re-anchor operation changed before terminal recording.");
      await transaction.append<ReanchorEvent>(`reanchor.${state}`, { event: state, requestId, summary, at: this.now() });
      return cloneLifecycle({ ...current, state, summary });
    });
  }

  private async finalizeSessionRebind(requestId: string): Promise<ReanchorLifecycle> {
    const current = await this.get(requestId);
    if (!current) throw new ReanchorLifecycleError("The re-anchor request disappeared before its protected session rebind.");
    if (current.state === "session_rebound") return this.finalizeReceipt(requestId);
    if (current.state === "recorded" || current.state === "ambiguous") return current;
    if (current.state !== "external_committed" || !current.externalEffect) throw new ReanchorLifecycleError("A protected session rebind requires one durable exact provider acknowledgement.");
    try {
      await this.finalPostEffectChecks(current);
    } catch (error) {
      return this.markAmbiguous(requestId, safeFailure(error, "Post-effect Re-anchor guards could not prove the exact target; the session binding remains unknown."));
    }
    let result: SessionTargetRebindResult;
    try {
      result = await this.dependencies.sessions.compareAndSwapTarget({
        sessionId: current.request.session.id,
        expectedBindingDigest: current.request.sessionBindingDigest,
        oldTargetSnapshotId: current.request.oldTarget.id,
        newTargetSnapshotId: current.request.newTarget.id,
        operationId: current.request.operationId
      });
    } catch {
      return this.markAmbiguous(requestId, "The protected session compare-and-swap returned no trustworthy disposition; the session binding remains unknown.");
    }
    await this.probe("session_compare_and_swap_returned");
    if ((result.outcome !== "rebound" && result.outcome !== "already_rebound") || !result.session) {
      return this.markAmbiguous(requestId, `The protected session compare-and-swap did not prove an exact rebind: ${boundedText(result.reason, "session rebind reason", 512)}`);
    }
    const reboundSession = exactSession(result.session);
    if (reboundSession.id !== current.request.session.id || reboundSession.targetSnapshotId !== current.request.newTarget.id || reboundSession.status !== "unknown"
      || reboundSession.metadata["sxsy-b122.reanchor.operationId"] !== current.request.operationId
      || reboundSession.metadata["sxsy-b122.reanchor.oldTargetSnapshotId"] !== current.request.oldTarget.id
      || reboundSession.metadata["sxsy-b122.reanchor.newTargetSnapshotId"] !== current.request.newTarget.id
      || reboundSession.metadata["sxsy-b122.reanchor.resumeAuthorized"] !== "false"
      || sessionBindingDigest(reboundSession) !== sessionBindingDigest(expectedReboundSession(current.request))) {
      return this.markAmbiguous(requestId, "The protected session compare-and-swap returned a mismatched binding; the session remains unknown.");
    }
    const rebind: ReanchorSessionRebind = {
      version: 1,
      requestId,
      operationId: current.request.operationId,
      sessionId: current.request.session.id,
      oldTargetSnapshotId: current.request.oldTarget.id,
      newTargetSnapshotId: current.request.newTarget.id,
      outcome: result.outcome,
      resultingBindingDigest: sessionBindingDigest(reboundSession),
      resumed: false,
      reboundAt: this.now()
    };
    await this.store.transaction(async (transaction) => {
      const durable = lifecycleMap(await transaction.readEntries()).get(requestId);
      if (!durable) throw new ReanchorLifecycleError("The re-anchor request disappeared while recording its session rebind.");
      if (durable.state === "session_rebound" || durable.state === "recorded") return;
      if (durable.state !== "external_committed") throw new ReanchorLifecycleError("The re-anchor lifecycle changed while recording its session rebind.");
      await transaction.append<ReanchorEvent>("reanchor.session_rebound", { event: "session_rebound", requestId, rebind });
    });
    await this.probe("session_rebound_persisted");
    return this.finalizeReceipt(requestId);
  }

  private async finalizeReceipt(requestId: string): Promise<ReanchorLifecycle> {
    const lifecycle = await this.store.transaction(async (transaction) => {
      const current = lifecycleMap(await transaction.readEntries()).get(requestId);
      if (!current) throw new ReanchorLifecycleError("The re-anchor request disappeared before receipt recording.");
      if (current.state === "recorded") return cloneLifecycle(current);
      if (current.state !== "session_rebound" || !current.externalEffect || !current.sessionRebind || !current.preview || !current.confirmation) {
        throw new ReanchorLifecycleError("A re-anchor receipt requires an exact external acknowledgement and protected session rebind.");
      }
      const receipt = buildReceipt(current);
      await transaction.append<ReanchorEvent>("reanchor.recorded", { event: "recorded", requestId, receipt });
      return cloneLifecycle({ ...current, state: "recorded", receipt, summary: receipt.result });
    });
    await this.probe("receipt_persisted");
    return lifecycle;
  }

  private async requireRequest(requestId: string): Promise<ReanchorRequestRecord> {
    const lifecycle = await this.get(requestId);
    if (!lifecycle) throw new ReanchorLifecycleError("The re-anchor request is unknown.");
    return cloneRequest(lifecycle.request);
  }

  private assertRequestLive(request: ReanchorRequestRecord, now = this.now()): void {
    if (Date.parse(request.expiresAt) <= Date.parse(now)) throw new ReanchorLifecycleError("The re-anchor request expired before its reviewed effect boundary.");
  }

  private now(): string {
    return timestamp(this.clock(), "re-anchor lifecycle clock");
  }

  private async probe(phase: ReanchorLifecyclePhase): Promise<void> {
    await this.lifecycleProbe?.(phase);
  }
}

function expectedReboundSession(request: ReanchorRequestRecord): ManagedSession {
  return {
    ...request.session,
    targetSnapshotId: request.newTarget.id,
    status: "unknown",
    metadata: {
      ...request.session.metadata,
      "sxsy-b122.reanchor.operationId": request.operationId,
      "sxsy-b122.reanchor.oldTargetSnapshotId": request.oldTarget.id,
      "sxsy-b122.reanchor.newTargetSnapshotId": request.newTarget.id,
      "sxsy-b122.reanchor.resumeAuthorized": "false"
    }
  };
}

function lifecycleMap(entries: readonly JournalEntry<unknown>[]): Map<string, ReanchorLifecycle> {
  const result = new Map<string, ReanchorLifecycle>();
  for (const entry of entries) {
    if (!entry.kind.startsWith("reanchor.")) continue;
    if (!isRecord(entry.payload)) throw new ReanchorLifecycleError("The protected journal contains a malformed re-anchor event payload.");
    const payload = entry.payload as Partial<ReanchorEvent>;
    if (entry.kind === "reanchor.requested" && payload.event === "requested" && "request" in payload) {
      const request = exactStoredRequest(payload.request);
      if (result.has(request.id)) throw new ReanchorLifecycleError("The protected journal contains a duplicate re-anchor request event.");
      result.set(request.id, { request, state: "pending_preview" });
      continue;
    }
    const requestId = "requestId" in payload && typeof payload.requestId === "string" ? exactRequestId(payload.requestId) : undefined;
    const current = requestId ? result.get(requestId) : undefined;
    if (!requestId || !current) throw new ReanchorLifecycleError("The protected journal contains an orphaned or malformed re-anchor lifecycle event.");
    switch (entry.kind) {
      case "reanchor.previewed": {
        if (payload.event !== "previewed" || !("preview" in payload) || current.state !== "pending_preview") throw invalidTransition();
        const preview = exactStoredPreview(payload.preview, current.request);
        result.set(requestId, { ...current, state: "pending_confirmation", preview });
        break;
      }
      case "reanchor.confirmed": {
        if (payload.event !== "confirmed" || !("confirmation" in payload) || current.state !== "pending_confirmation" || !current.preview) throw invalidTransition();
        const confirmation = exactStoredConfirmation(payload.confirmation, current.preview);
        result.set(requestId, { ...current, state: "confirmed", confirmation });
        break;
      }
      case "reanchor.executing":
        if (payload.event !== "executing" || current.state !== "confirmed" || !("operationId" in payload) || payload.operationId !== current.request.operationId
          || !("attemptId" in payload) || typeof payload.attemptId !== "string" || !/^reanchor-attempt:[a-f0-9]{64}$/.test(payload.attemptId)
          || !("startedAt" in payload) || typeof payload.startedAt !== "string" || !Number.isFinite(Date.parse(payload.startedAt))) throw invalidTransition();
        result.set(requestId, { ...current, state: "executing" });
        break;
      case "reanchor.external_committed": {
        if (payload.event !== "external_committed" || current.state !== "executing" || !("effect" in payload)) throw invalidTransition();
        if (isLegacyStoredEffect(payload.effect, current.request)) {
          result.set(requestId, { ...current, state: "ambiguous", summary: legacyAmbiguitySummary });
          break;
        }
        const externalEffect = exactStoredEffect(payload.effect, current);
        result.set(requestId, { ...current, state: "external_committed", externalEffect, summary: externalEffect.summary });
        break;
      }
      case "reanchor.session_rebound": {
        if (payload.event !== "session_rebound" || current.state !== "external_committed" || !("rebind" in payload)) throw invalidTransition();
        const sessionRebind = exactStoredSessionRebind(payload.rebind, current.request);
        result.set(requestId, { ...current, state: "session_rebound", sessionRebind, summary: "reanchored_without_resume" });
        break;
      }
      case "reanchor.ambiguous":
      case "reanchor.rejected": {
        const state = entry.kind === "reanchor.ambiguous" ? "ambiguous" : "rejected";
        const validSource = state === "ambiguous" ? current.state === "executing" || current.state === "external_committed" : current.state === "executing" || current.state === "confirmed";
        if (payload.event !== state || !validSource || !("summary" in payload) || typeof payload.summary !== "string"
          || !("at" in payload) || typeof payload.at !== "string" || !Number.isFinite(Date.parse(payload.at))) throw invalidTransition();
        result.set(requestId, { ...current, state, summary: boundedText(payload.summary, `stored ${state} summary`, 512) });
        break;
      }
      case "reanchor.recorded": {
        if (payload.event === "recorded" && current.state === "ambiguous" && current.summary === legacyAmbiguitySummary && "receipt" in payload) {
          exactLegacyStoredReceipt(payload.receipt, current);
          break;
        }
        if (payload.event !== "recorded" || current.state !== "session_rebound" || !("receipt" in payload)) throw invalidTransition();
        const receipt = exactStoredReceipt(payload.receipt, current);
        result.set(requestId, { ...current, state: "recorded", receipt, summary: receipt.result });
        break;
      }
      default:
        throw new ReanchorLifecycleError(`Unknown protected re-anchor event kind: ${entry.kind}`);
    }
  }
  return result;
}

function exactRequestInput(value: ReanchorRequestInput): ReanchorRequestInput {
  if (!isRecord(value) || !exactKeys(value, ["oldTarget", "newTarget", "reason", "session", "authority"])) {
    throw new ReanchorLifecycleError("A re-anchor request is a closed payload with exact old/new TargetSnapshots, reason, session, and authority fields.");
  }
  const oldTarget = exactSnapshot(value.oldTarget);
  const newTarget = exactSnapshot(value.newTarget);
  if (normalizeRepository(oldTarget.repositoryRoot) !== normalizeRepository(newTarget.repositoryRoot)) {
    throw new ReanchorLifecycleError("A re-anchor request cannot cross repository roots.");
  }
  const reason = boundedText(value.reason, "re-anchor reason", 512);
  const session = exactSession(value.session);
  if (normalizeRepository(session.workspaceRoot ?? "") !== normalizeRepository(oldTarget.repositoryRoot) || session.targetSnapshotId !== oldTarget.id
    || !session.capabilities.includes("controllable") || session.status === "stale" || session.status === "unreachable") {
    throw new ReanchorLifecycleError("Re-anchor requires one current controllable session bound to the exact old TargetSnapshot and repository.");
  }
  const authority = exactAuthority(value.authority);
  return { oldTarget, newTarget, reason, session, authority };
}

function exactStoredRequest(value: unknown): ReanchorRequestRecord {
  if (!isRecord(value) || !exactKeys(value, [
    "version", "id", "operationId", "oldTarget", "newTarget", "reason", "session", "authority",
    "sessionBindingDigest", "authorityDigest", "createdAt", "expiresAt"
  ]) || value.version !== 1 || typeof value.id !== "string" || typeof value.operationId !== "string"
    || typeof value.sessionBindingDigest !== "string" || !digest(value.sessionBindingDigest)
    || typeof value.authorityDigest !== "string" || !digest(value.authorityDigest)
    || typeof value.createdAt !== "string" || typeof value.expiresAt !== "string") {
    throw new ReanchorLifecycleError("The protected re-anchor request record is malformed.");
  }
  const input = exactRequestInput({ oldTarget: value.oldTarget, newTarget: value.newTarget, reason: value.reason, session: value.session, authority: value.authority } as ReanchorRequestInput);
  if (!/^reanchor:[a-f0-9]{64}$/.test(value.id) || value.operationId !== `reanchor-operation:${sha256(value.id)}`
    || value.sessionBindingDigest !== sessionBindingDigest(input.session) || value.authorityDigest !== sha256(stableJson(input.authority))
    || !Number.isFinite(Date.parse(value.createdAt)) || !Number.isFinite(Date.parse(value.expiresAt)) || Date.parse(value.createdAt) >= Date.parse(value.expiresAt)
    || Date.parse(value.expiresAt) > Date.parse(input.authority.expiresAt)) {
    throw new ReanchorLifecycleError("The protected re-anchor request binding is invalid.");
  }
  const expectedId = `reanchor:${sha256(stableJson({ authorityDigest: value.authorityDigest, newTarget: input.newTarget, oldTarget: input.oldTarget, reason: input.reason, sessionBindingDigest: value.sessionBindingDigest }))}`;
  if (value.id !== expectedId) throw new ReanchorLifecycleError("The protected re-anchor request ID does not match its immutable material.");
  return { version: 1, id: value.id, operationId: value.operationId, ...input, sessionBindingDigest: value.sessionBindingDigest, authorityDigest: value.authorityDigest, createdAt: value.createdAt, expiresAt: value.expiresAt };
}

function exactSnapshot(value: unknown): TargetSnapshot {
  const required = ["id", "repositoryRoot", "trackedManifest", "untrackedManifest", "submodules", "policyVersion", "environmentFingerprint", "capturedAt", "completeness", "reasons"];
  const optional = ["canonicalRemote", "branch", "defaultBranch", "detached", "upstream", "head", "indexTree"];
  if (!isRecord(value) || !allowedExactKeys(value, required, optional) || typeof value.id !== "string" || !digest(value.id)
    || typeof value.repositoryRoot !== "string" || !bounded(value.repositoryRoot, 4_096)
    || typeof value.trackedManifest !== "string" || !bounded(value.trackedManifest, 16_384)
    || typeof value.untrackedManifest !== "string" || !bounded(value.untrackedManifest, 16_384)
    || typeof value.policyVersion !== "string" || !bounded(value.policyVersion, 256)
    || typeof value.environmentFingerprint !== "string" || !bounded(value.environmentFingerprint, 16_384)
    || typeof value.capturedAt !== "string" || !Number.isFinite(Date.parse(value.capturedAt))
    || (value.completeness !== "complete" && value.completeness !== "incomplete")
    || !Array.isArray(value.reasons) || value.reasons.length > 128 || value.reasons.some((reason) => typeof reason !== "string" || !bounded(reason, 512))
    || !isRecord(value.submodules) || Object.keys(value.submodules).length > 1_024
    || Object.entries(value.submodules).some(([path, revision]) => !bounded(path, 4_096) || typeof revision !== "string" || !bounded(revision, 512))) {
    throw new ReanchorLifecycleError("A re-anchor TargetSnapshot is malformed or unbounded.");
  }
  for (const key of ["canonicalRemote", "branch", "defaultBranch", "upstream", "head", "indexTree"] as const) {
    if (value[key] !== undefined && (typeof value[key] !== "string" || !bounded(value[key] as string, 4_096))) throw new ReanchorLifecycleError(`The TargetSnapshot ${key} is malformed.`);
  }
  if (value.detached !== undefined && value.detached !== true) throw new ReanchorLifecycleError("The TargetSnapshot detached marker is malformed.");
  if (value.completeness !== "complete" || value.reasons.length !== 0) throw new ReanchorLifecycleError("Re-anchor mutation requires complete old and new TargetSnapshots without unresolved reasons.");
  const snapshot = jsonClone(value) as unknown as TargetSnapshot;
  const { id, capturedAt: _capturedAt, ...identity } = snapshot;
  if (targetSnapshotDigest(identity) !== id) throw new ReanchorLifecycleError("The TargetSnapshot content ID does not match its immutable material.");
  return snapshot;
}

function exactSession(value: unknown): ManagedSession {
  const required = ["id", "provider", "surface", "capabilities", "status", "plannedFiles", "lastHeartbeat", "adapterVersion", "metadata"];
  const optional = ["workspaceRoot", "targetSnapshotId", "taskId", "planRevision"];
  if (!isRecord(value) || !allowedExactKeys(value, required, optional) || typeof value.id !== "string" || !bounded(value.id, 512)
    || !["claude", "codex", "generic", "voice"].includes(value.provider as string)
    || !["vscode_terminal", "vscode_window", "desktop", "browser", "bridge"].includes(value.surface as string)
    || !Array.isArray(value.capabilities) || value.capabilities.length > 4 || value.capabilities.some((capability) => !["registered", "observable", "controllable", "mediated"].includes(capability as string))
    || new Set(value.capabilities).size !== value.capabilities.length
    || !["running", "verified_blocked", "verified_finished", "unreachable", "stale", "unknown"].includes(value.status as string)
    || !Array.isArray(value.plannedFiles) || value.plannedFiles.length > 4_096 || value.plannedFiles.some((path) => typeof path !== "string" || !bounded(path, 4_096))
    || typeof value.lastHeartbeat !== "string" || !Number.isFinite(Date.parse(value.lastHeartbeat))
    || typeof value.adapterVersion !== "string" || !/^[A-Za-z0-9_.+-]{1,80}$/.test(value.adapterVersion)
    || !isRecord(value.metadata) || Object.keys(value.metadata).length > 256 || Object.entries(value.metadata).some(([key, item]) => !bounded(key, 256) || typeof item !== "string" || !bounded(item, 16_384))) {
    throw new ReanchorLifecycleError("The managed session in the re-anchor request is malformed or unbounded.");
  }
  for (const key of optional) if (value[key] !== undefined && (typeof value[key] !== "string" || !bounded(value[key] as string, 4_096))) throw new ReanchorLifecycleError(`The managed session ${key} is malformed.`);
  return jsonClone(value) as unknown as ManagedSession;
}

function exactAuthority(value: unknown): AuthorityGrant {
  const required = ["id", "repositoryRoot", "allowedActions", "prohibitedActions", "expiresAt", "issuedAt", "issuedBy"];
  const optional = ["sessionId", "taskId", "planRevision", "revokedAt"];
  if (!isRecord(value) || !allowedExactKeys(value, required, optional) || typeof value.id !== "string" || !bounded(value.id, 512)
    || typeof value.repositoryRoot !== "string" || !bounded(value.repositoryRoot, 4_096)
    || !Array.isArray(value.allowedActions) || value.allowedActions.length > 256 || value.allowedActions.some((action) => typeof action !== "string" || !exactAction(action))
    || !Array.isArray(value.prohibitedActions) || value.prohibitedActions.length > 256 || value.prohibitedActions.some((action) => typeof action !== "string" || !exactAction(action))
    || typeof value.expiresAt !== "string" || !Number.isFinite(Date.parse(value.expiresAt))
    || typeof value.issuedAt !== "string" || !Number.isFinite(Date.parse(value.issuedAt))
    || typeof value.issuedBy !== "string" || !bounded(value.issuedBy, 512)) {
    throw new ReanchorLifecycleError("The scoped authority in the re-anchor request is malformed or unbounded.");
  }
  for (const key of optional) if (value[key] !== undefined && (typeof value[key] !== "string" || !bounded(value[key] as string, 512))) throw new ReanchorLifecycleError(`The scoped authority ${key} is malformed.`);
  if (new Set(value.allowedActions).size !== value.allowedActions.length || new Set(value.prohibitedActions).size !== value.prohibitedActions.length) throw new ReanchorLifecycleError("Authority action scopes must be distinct exact names.");
  return jsonClone(value) as unknown as AuthorityGrant;
}

function assertAuthorityActive(authority: AuthorityGrant, input: Pick<ReanchorRequestInput, "oldTarget" | "session">, now: string): void {
  if (authority.revokedAt || Date.parse(authority.expiresAt) <= Date.parse(now)
    || normalizeRepository(authority.repositoryRoot) !== normalizeRepository(input.oldTarget.repositoryRoot)
    || (authority.sessionId !== undefined && authority.sessionId !== input.session.id)
    || (authority.taskId !== undefined && authority.taskId !== input.session.taskId)
    || (authority.planRevision !== undefined && authority.planRevision !== input.session.planRevision)
    || authority.prohibitedActions.includes("reanchor") || !authority.allowedActions.includes("reanchor")) {
    throw new ReanchorLifecycleError("The current scoped authority does not permit this exact re-anchor request.");
  }
}

function exactPreviewContent(value: unknown): ReanchorPreviewContent {
  if (!isRecord(value) || !allowedExactKeys(value, ["summary", "discrepancies", "risks", "questions"], ["contextEvidence"])) throw new ReanchorLifecycleError("The read-only re-anchor preview returned an open or malformed payload.");
  let contextEvidence: CoordinatorEvidenceBundle | undefined;
  if (value.contextEvidence !== undefined) {
    try { contextEvidence = canonicalCoordinatorEvidence(value.contextEvidence as CoordinatorEvidenceBundle); }
    catch { throw new ReanchorLifecycleError("The read-only Re-anchor preview lacks exact digest-bound instructions, plan, documentation, and current-work evidence."); }
  }
  return {
    summary: redactProviderSummary(boundedText(value.summary, "re-anchor preview summary", 512)),
    discrepancies: boundedList(value.discrepancies, "re-anchor discrepancy").map(redactProviderSummary),
    risks: boundedList(value.risks, "re-anchor risk").map(redactProviderSummary),
    questions: boundedList(value.questions, "re-anchor question").map(redactProviderSummary),
    ...(contextEvidence ? { contextEvidence } : {})
  };
}

function defaultPreview(request: ReanchorRequestRecord): ReanchorPreviewContent {
  const discrepancies: string[] = [];
  for (const [label, oldValue, newValue] of [
    ["branch", request.oldTarget.branch, request.newTarget.branch],
    ["HEAD", request.oldTarget.head, request.newTarget.head],
    ["index tree", request.oldTarget.indexTree, request.newTarget.indexTree],
    ["tracked manifest", request.oldTarget.trackedManifest, request.newTarget.trackedManifest],
    ["untracked manifest", request.oldTarget.untrackedManifest, request.newTarget.untrackedManifest],
    ["policy version", request.oldTarget.policyVersion, request.newTarget.policyVersion],
    ["environment fingerprint", request.oldTarget.environmentFingerprint, request.newTarget.environmentFingerprint],
    ["submodule manifest", stableJson(request.oldTarget.submodules), stableJson(request.newTarget.submodules)]
  ] as const) if (oldValue !== newValue) discrepancies.push(`${label} changed between the exact old and new TargetSnapshots.`);
  return {
    summary: "Read-only re-anchor preview compared the exact old and new TargetSnapshots; automatic resume remains disabled.",
    discrepancies,
    risks: request.oldTarget.policyVersion !== request.newTarget.policyVersion ? ["The policy version changed and requires renewed review."] : [],
    questions: []
  };
}

function exactStoredPreview(value: unknown, request: ReanchorRequestRecord): ReanchorPreview {
  if (!isRecord(value) || !allowedExactKeys(value, [
    "version", "id", "requestId", "oldTargetSnapshotId", "newTargetSnapshotId", "observedFenceEpoch", "summary", "discrepancies", "risks", "questions",
    "previewDigest", "confirmationScopeDigest", "createdAt", "confirmationExpiresAt"
  ], ["contextEvidence"]) || value.version !== 1 || typeof value.id !== "string" || !/^reanchor-preview:[a-f0-9]{64}$/.test(value.id)
    || value.requestId !== request.id || value.oldTargetSnapshotId !== request.oldTarget.id || value.newTargetSnapshotId !== request.newTarget.id
    || !Number.isSafeInteger(value.observedFenceEpoch) || (value.observedFenceEpoch as number) < 0
    || typeof value.previewDigest !== "string" || !digest(value.previewDigest)
    || typeof value.confirmationScopeDigest !== "string" || !digest(value.confirmationScopeDigest)
    || typeof value.createdAt !== "string" || !Number.isFinite(Date.parse(value.createdAt))
    || typeof value.confirmationExpiresAt !== "string" || !Number.isFinite(Date.parse(value.confirmationExpiresAt))) {
    throw new ReanchorLifecycleError("The protected re-anchor preview is malformed or mismatched.");
  }
  const content = exactPreviewContent({ summary: value.summary, discrepancies: value.discrepancies, risks: value.risks, questions: value.questions, ...(value.contextEvidence !== undefined ? { contextEvidence: value.contextEvidence } : {}) });
  const expectedDigest = sha256(stableJson({ content, fenceEpoch: value.observedFenceEpoch, requestId: request.id }));
  const expectedId = `reanchor-preview:${sha256(stableJson({ previewDigest: value.previewDigest, requestId: request.id }))}`;
  const expectedScope = sha256(stableJson({
    authorityDigest: request.authorityDigest,
    confirmationExpiresAt: value.confirmationExpiresAt,
    fenceEpoch: value.observedFenceEpoch,
    newTargetSnapshotId: request.newTarget.id,
    oldTargetSnapshotId: request.oldTarget.id,
    previewDigest: value.previewDigest,
    requestId: request.id,
    sessionBindingDigest: request.sessionBindingDigest
  }));
  if (value.previewDigest !== expectedDigest || value.id !== expectedId || value.confirmationScopeDigest !== expectedScope
    || Date.parse(value.createdAt) >= Date.parse(value.confirmationExpiresAt) || Date.parse(value.confirmationExpiresAt) > Date.parse(request.expiresAt)) {
    throw new ReanchorLifecycleError("The protected re-anchor preview digest or lifetime binding is invalid.");
  }
  return { version: 1, id: value.id, requestId: request.id, oldTargetSnapshotId: request.oldTarget.id, newTargetSnapshotId: request.newTarget.id, observedFenceEpoch: value.observedFenceEpoch as number, ...content, previewDigest: value.previewDigest, confirmationScopeDigest: value.confirmationScopeDigest, createdAt: value.createdAt, confirmationExpiresAt: value.confirmationExpiresAt };
}

function exactStoredConfirmation(value: unknown, preview: ReanchorPreview): ReanchorConfirmation {
  if (!isRecord(value) || !exactKeys(value, ["version", "id", "requestId", "confirmationTokenDigest", "confirmationScopeDigest", "confirmedAt", "expiresAt"])
    || value.version !== 1 || typeof value.id !== "string" || !/^reanchor-confirmation:[a-f0-9]{64}$/.test(value.id)
    || value.requestId !== preview.requestId || typeof value.confirmationTokenDigest !== "string" || !digest(value.confirmationTokenDigest)
    || value.confirmationScopeDigest !== preview.confirmationScopeDigest || typeof value.confirmedAt !== "string" || !Number.isFinite(Date.parse(value.confirmedAt))
    || typeof value.expiresAt !== "string" || !Number.isFinite(Date.parse(value.expiresAt)) || Date.parse(value.expiresAt) > Date.parse(preview.confirmationExpiresAt)) throw new ReanchorLifecycleError("The protected re-anchor confirmation is malformed or mismatched.");
  const expectedId = `reanchor-confirmation:${sha256(stableJson({ requestId: preview.requestId, scope: preview.confirmationScopeDigest }))}`;
  if (value.id !== expectedId || Date.parse(value.confirmedAt) < Date.parse(preview.createdAt) || Date.parse(value.confirmedAt) >= Date.parse(value.expiresAt)) throw new ReanchorLifecycleError("The protected re-anchor confirmation lifetime or ID is invalid.");
  return jsonClone(value) as unknown as ReanchorConfirmation;
}

function exactConsumedConfirmation(decision: ConfirmationDecision, input: ReanchorConfirmationInput, lifecycle: ReanchorLifecycle): DurableConfirmationRecord & { readonly consumedAt: string } {
  const record = decision.record;
  if (!decision.allowed || !record) {
    throw new ReanchorLifecycleError(`The protected current-user confirmation was denied: ${boundedText(decision.reason, "confirmation decision reason", 512)}`);
  }
  if (!lifecycle.preview || record.reauthenticated !== true || record.action !== "reanchor"
    || record.targetSnapshotId !== lifecycle.request.newTarget.id || record.sessionId !== lifecycle.request.session.id
    || record.authorityId !== lifecycle.request.authority.id || record.scopeDigest !== lifecycle.preview.confirmationScopeDigest
    || record.tokenDigest !== sha256(input.confirmationToken) || typeof record.consumedAt !== "string" || !Number.isFinite(Date.parse(record.consumedAt))
    || Date.parse(record.consumedAt) < Date.parse(lifecycle.preview.createdAt) || Date.parse(record.consumedAt) >= Date.parse(lifecycle.preview.confirmationExpiresAt)
    || typeof record.expiresAt !== "string" || !Number.isFinite(Date.parse(record.expiresAt)) || Date.parse(record.expiresAt) <= Date.parse(record.consumedAt)) {
    throw new ReanchorLifecycleError("The protected confirmation is not an exact, live, reauthenticated current-user attestation for this reviewed re-anchor scope.");
  }
  return { ...record, consumedAt: record.consumedAt };
}

function exactStoredEffect(value: unknown, lifecycle: ReanchorLifecycle): ReanchorExternalEffect {
  const request = lifecycle.request;
  const expectedApply = buildApplyRequest(lifecycle);
  if (!isRecord(value) || !exactKeys(value, ["version", "requestId", "operationId", "externalEffectId", "acknowledgementDigest", "artifactDigest", "rereadEvidence", "summary", "report", "committedAt"])
    || value.version !== 1 || value.requestId !== request.id || value.operationId !== request.operationId
    || typeof value.externalEffectId !== "string" || !bounded(value.externalEffectId, 512)
    || typeof value.acknowledgementDigest !== "string" || !digest(value.acknowledgementDigest)
    || typeof value.artifactDigest !== "string" || value.artifactDigest !== expectedApply.artifactDigest
    || typeof value.summary !== "string" || !bounded(value.summary, 512)
    || typeof value.committedAt !== "string" || !Number.isFinite(Date.parse(value.committedAt))) throw new ReanchorLifecycleError("The protected re-anchor external effect marker is malformed.");
  const report = exactPostStopReport(value.report);
  const rereadEvidence = exactRereadEvidence(value.rereadEvidence, expectedApply.rereadEvidence);
  if (value.summary !== report.summary) throw new ReanchorLifecycleError("The protected re-anchor effect summary does not match its structured report.");
  const effect: ReanchorExternalEffect = {
    version: 1,
    requestId: request.id,
    operationId: request.operationId,
    externalEffectId: value.externalEffectId,
    acknowledgementDigest: value.acknowledgementDigest,
    artifactDigest: value.artifactDigest,
    rereadEvidence,
    summary: report.summary,
    report,
    committedAt: value.committedAt
  };
  if (effect.acknowledgementDigest !== sha256(stableJson(acknowledgementFromEffect(request, effect)))) {
    throw new ReanchorLifecycleError("The protected re-anchor acknowledgement digest does not match its exact dual-target evidence.");
  }
  return effect;
}

function isLegacyStoredEffect(value: unknown, request: ReanchorRequestRecord): boolean {
  if (!isRecord(value) || !allowedExactKeys(value,
    ["version", "requestId", "operationId", "externalEffectId", "summary", "committedAt"],
    ["acknowledgementDigest", "artifactDigest", "rereadEvidence"]) || "report" in value) return false;
  if (value.version !== 1 || value.requestId !== request.id || value.operationId !== request.operationId
    || typeof value.externalEffectId !== "string" || !bounded(value.externalEffectId, 512)
    || (value.acknowledgementDigest !== undefined && (typeof value.acknowledgementDigest !== "string" || !digest(value.acknowledgementDigest)))
    || (value.artifactDigest !== undefined && (typeof value.artifactDigest !== "string" || !digest(value.artifactDigest)))
    || typeof value.summary !== "string" || !bounded(value.summary, 512)
    || typeof value.committedAt !== "string" || !Number.isFinite(Date.parse(value.committedAt))) {
    throw new ReanchorLifecycleError("The legacy protected Re-anchor external effect marker is malformed or mismatched.");
  }
  return true;
}

function exactLegacyStoredReceipt(value: unknown, lifecycle: ReanchorLifecycle): void {
  if (!lifecycle.preview || !lifecycle.confirmation || !isRecord(value) || !exactKeys(value, [
    "version", "id", "requestId", "operationId", "oldTargetSnapshotId", "newTargetSnapshotId", "sessionId", "authorityId",
    "previewDigest", "confirmationDigest", "externalEffectId", "evidenceDigest", "result", "createdAt"
  ]) || value.version !== 1 || value.id !== `reanchor-receipt:${sha256(lifecycle.request.id)}`
    || value.requestId !== lifecycle.request.id || value.operationId !== lifecycle.request.operationId
    || value.oldTargetSnapshotId !== lifecycle.request.oldTarget.id || value.newTargetSnapshotId !== lifecycle.request.newTarget.id
    || value.sessionId !== lifecycle.request.session.id || value.authorityId !== lifecycle.request.authority.id
    || value.previewDigest !== lifecycle.preview.previewDigest || value.confirmationDigest !== lifecycle.confirmation.confirmationTokenDigest
    || typeof value.externalEffectId !== "string" || !bounded(value.externalEffectId, 512)
    || typeof value.evidenceDigest !== "string" || !digest(value.evidenceDigest) || value.result !== "reanchored"
    || typeof value.createdAt !== "string" || !Number.isFinite(Date.parse(value.createdAt))) {
    throw new ReanchorLifecycleError("The legacy protected Re-anchor receipt is malformed or mismatched.");
  }
}

function exactStoredSessionRebind(value: unknown, request: ReanchorRequestRecord): ReanchorSessionRebind {
  if (!isRecord(value) || !exactKeys(value, [
    "version", "requestId", "operationId", "sessionId", "oldTargetSnapshotId", "newTargetSnapshotId", "outcome",
    "resultingBindingDigest", "resumed", "reboundAt"
  ]) || value.version !== 1 || value.requestId !== request.id || value.operationId !== request.operationId
    || value.sessionId !== request.session.id || value.oldTargetSnapshotId !== request.oldTarget.id || value.newTargetSnapshotId !== request.newTarget.id
    || (value.outcome !== "rebound" && value.outcome !== "already_rebound")
    || typeof value.resultingBindingDigest !== "string" || !digest(value.resultingBindingDigest) || value.resumed !== false
    || typeof value.reboundAt !== "string" || !Number.isFinite(Date.parse(value.reboundAt))) {
    throw new ReanchorLifecycleError("The protected Re-anchor session rebind marker is malformed or mismatched.");
  }
  return jsonClone(value) as unknown as ReanchorSessionRebind;
}

function buildReceipt(lifecycle: ReanchorLifecycle): ReanchorReceipt {
  if (!lifecycle.preview || !lifecycle.confirmation || !lifecycle.externalEffect || !lifecycle.sessionRebind) throw new ReanchorLifecycleError("A deterministic re-anchor receipt requires preview, confirmation, provider acknowledgement, and session rebind evidence.");
  const material = {
    acknowledgementDigest: lifecycle.externalEffect.acknowledgementDigest,
    artifactDigest: lifecycle.externalEffect.artifactDigest,
    authorityId: lifecycle.request.authority.id,
    confirmationDigest: lifecycle.confirmation.confirmationTokenDigest,
    confirmationScopeDigest: lifecycle.confirmation.confirmationScopeDigest,
    externalEffectId: lifecycle.externalEffect.externalEffectId,
    newTargetSnapshotId: lifecycle.request.newTarget.id,
    oldTargetSnapshotId: lifecycle.request.oldTarget.id,
    operationId: lifecycle.request.operationId,
    previewDigest: lifecycle.preview.previewDigest,
    requestId: lifecycle.request.id,
    resultingBindingDigest: lifecycle.sessionRebind.resultingBindingDigest,
    report: lifecycle.externalEffect.report,
    rereadEvidence: lifecycle.externalEffect.rereadEvidence,
    resumed: false,
    sessionId: lifecycle.request.session.id,
    sessionRebindOutcome: lifecycle.sessionRebind.outcome
  };
  return {
    version: 1,
    id: `reanchor-receipt:${sha256(lifecycle.request.id)}`,
    requestId: lifecycle.request.id,
    operationId: lifecycle.request.operationId,
    oldTargetSnapshotId: lifecycle.request.oldTarget.id,
    newTargetSnapshotId: lifecycle.request.newTarget.id,
    sessionId: lifecycle.request.session.id,
    authorityId: lifecycle.request.authority.id,
    previewDigest: lifecycle.preview.previewDigest,
    confirmationDigest: lifecycle.confirmation.confirmationTokenDigest,
    confirmationScopeDigest: lifecycle.confirmation.confirmationScopeDigest,
    externalEffectId: lifecycle.externalEffect.externalEffectId,
    acknowledgementDigest: lifecycle.externalEffect.acknowledgementDigest,
    artifactDigest: lifecycle.externalEffect.artifactDigest,
    rereadEvidence: lifecycle.externalEffect.rereadEvidence,
    report: lifecycle.externalEffect.report,
    sessionRebindOutcome: lifecycle.sessionRebind.outcome,
    resultingBindingDigest: lifecycle.sessionRebind.resultingBindingDigest,
    resumed: false,
    evidenceDigest: sha256(stableJson(material)),
    result: "reanchored_without_resume",
    createdAt: timestamp(lifecycle.externalEffect.committedAt, "re-anchor receipt timestamp")
  };
}

function exactStoredReceipt(value: unknown, lifecycle: ReanchorLifecycle): ReanchorReceipt {
  if (!isRecord(value) || !exactKeys(value, [
    "version", "id", "requestId", "operationId", "oldTargetSnapshotId", "newTargetSnapshotId", "sessionId", "authorityId",
    "previewDigest", "confirmationDigest", "confirmationScopeDigest", "externalEffectId", "acknowledgementDigest", "artifactDigest", "rereadEvidence", "report", "sessionRebindOutcome", "resultingBindingDigest",
    "resumed", "evidenceDigest", "result", "createdAt"
  ]) || value.version !== 1 || typeof value.createdAt !== "string" || !Number.isFinite(Date.parse(value.createdAt))) throw new ReanchorLifecycleError("The protected re-anchor receipt is malformed.");
  const expected = buildReceipt(lifecycle);
  if (stableJson(value) !== stableJson(expected)) throw new ReanchorLifecycleError("The protected re-anchor receipt does not match its exact deterministic evidence.");
  return expected;
}

function exactConfirmationInput(value: ReanchorConfirmationInput): void {
  if (!isRecord(value) || !exactKeys(value, ["requestId", "currentUserConfirmed", "confirmationToken", "confirmationScopeDigest"])
    || value.currentUserConfirmed !== true || typeof value.requestId !== "string" || !/^reanchor:[a-f0-9]{64}$/.test(value.requestId)
    || typeof value.confirmationToken !== "string" || !/^[A-Za-z0-9_.-]{16,512}$/.test(value.confirmationToken)
    || typeof value.confirmationScopeDigest !== "string" || !digest(value.confirmationScopeDigest)) {
    throw new ReanchorLifecycleError("Re-anchor mutation requires an exact current-user confirmation bound to the reviewed scope.");
  }
}

function exactContainmentInspection(value: unknown): Readonly<{ allowed: boolean; fenceEpoch: number; reason: string }> {
  if (!isRecord(value) || !exactKeys(value, ["allowed", "fenceEpoch", "reason"]) || typeof value.allowed !== "boolean"
    || !Number.isSafeInteger(value.fenceEpoch) || (value.fenceEpoch as number) < 0 || typeof value.reason !== "string") {
    throw new ReanchorLifecycleError("The containment inspection returned a malformed fence binding.");
  }
  return { allowed: value.allowed, fenceEpoch: value.fenceEpoch as number, reason: boundedText(value.reason, "containment reason", 512) };
}

function buildApplyRequest(lifecycle: ReanchorLifecycle): ReanchorApplyRequest {
  const { request, preview, confirmation } = lifecycle;
  if (!preview || !confirmation || !preview.contextEvidence) {
    throw new ReanchorLifecycleError("Provider Re-anchor requires protected instructions, task brief, documentation, and current-work evidence from the reviewed preview.");
  }
  const session = request.session;
  if ((session.provider !== "claude" && session.provider !== "codex") || !session.workspaceRoot || !session.taskId || !session.planRevision) {
    throw new ReanchorLifecycleError("Provider Re-anchor requires one exact Claude or Codex task-bound managed session.");
  }
  const contextEvidence = canonicalCoordinatorEvidence(preview.contextEvidence);
  if (contextEvidence.plan.originSessionId !== session.id || contextEvidence.plan.taskId !== session.taskId
    || contextEvidence.plan.revision !== session.planRevision || contextEvidence.instructions.length === 0
    || contextEvidence.documentation.length === 0 || contextEvidence.files.length === 0 || contextEvidence.tests.length === 0) {
    throw new ReanchorLifecycleError("The protected Re-anchor context evidence does not match the exact session, task, and plan revision.");
  }
  const rereadEvidence: ReanchorProviderRereadEvidence = {
    contextDigest: contextEvidence.contextDigest,
    authorityDigest: request.authorityDigest,
    instructionDigests: contextEvidence.instructions.map((item) => item.digest),
    planDigest: contextEvidence.plan.digest,
    documentationDigests: contextEvidence.documentation.map((item) => item.digest),
    currentWorkDigest: sha256(stableJson({
      diffDigest: contextEvidence.diff.digest,
      fileDigests: contextEvidence.files.map((item) => item.digest),
      testDigests: contextEvidence.tests.map((item) => item.digest),
      newTarget: request.newTarget
    })),
    inspectedTargetSnapshotId: request.newTarget.id
  };
  const material = {
    version: 1 as const,
    requestId: request.id,
    operationId: request.operationId,
    oldTargetSnapshotId: request.oldTarget.id,
    newTargetSnapshotId: request.newTarget.id,
    sessionId: session.id,
    authorityId: request.authority.id,
    reason: request.reason,
    previewDigest: preview.previewDigest,
    confirmationDigest: confirmation.confirmationTokenDigest,
    confirmationScopeDigest: preview.confirmationScopeDigest,
    provider: session.provider,
    session,
    repositoryRoot: request.oldTarget.repositoryRoot,
    taskId: session.taskId,
    planRevision: session.planRevision,
    plannedFiles: [...session.plannedFiles],
    authority: request.authority,
    oldTarget: request.oldTarget,
    newTarget: request.newTarget,
    contextEvidence,
    requiredRereads: reanchorRequiredRereads,
    rereadEvidence,
    cooperativeStopRequested: true as const,
    resumeAuthorized: false as const
  };
  return { ...material, artifactDigest: reanchorApplyArtifactDigest(material) };
}

function exactApplyOutcome(value: unknown, request: ReanchorApplyRequest): ReanchorApplyOutcome {
  if (!isRecord(value) || typeof value.disposition !== "string") throw new ReanchorLifecycleError("The re-anchor apply adapter returned a malformed effect disposition.");
  if (value.disposition === "committed" && exactKeys(value, ["disposition", "acknowledgement"]) && isRecord(value.acknowledgement)) {
    const acknowledgement = value.acknowledgement;
    if (!exactKeys(acknowledgement, [
      "schema", "version", "requestId", "operationId", "externalEffectId", "sessionId", "authorityId",
      "oldTargetSnapshotId", "newTargetSnapshotId", "cooperativeStopAcknowledged", "resumed", "artifactDigest", "rereadEvidence", "report"
    ]) || acknowledgement.schema !== "sxsy-b122.reanchor-acknowledgement" || acknowledgement.version !== 1
      || acknowledgement.requestId !== request.requestId || acknowledgement.operationId !== request.operationId
      || acknowledgement.sessionId !== request.sessionId || acknowledgement.authorityId !== request.authorityId
      || acknowledgement.oldTargetSnapshotId !== request.oldTargetSnapshotId || acknowledgement.newTargetSnapshotId !== request.newTargetSnapshotId
      || acknowledgement.cooperativeStopAcknowledged !== true || acknowledgement.resumed !== false
      || acknowledgement.artifactDigest !== request.artifactDigest
      || stableJson(acknowledgement.rereadEvidence) !== stableJson(request.rereadEvidence)
      || typeof acknowledgement.externalEffectId !== "string" || !bounded(acknowledgement.externalEffectId, 512)) {
      throw new ReanchorLifecycleError("The provider Re-anchor acknowledgement did not prove the exact context reread, work inspection, target, authority, stop, and no-resume binding.");
    }
    return { disposition: "committed", acknowledgement: {
      schema: "sxsy-b122.reanchor-acknowledgement", version: 1, requestId: request.requestId, operationId: request.operationId,
      externalEffectId: acknowledgement.externalEffectId, sessionId: request.sessionId, authorityId: request.authorityId,
      oldTargetSnapshotId: request.oldTargetSnapshotId, newTargetSnapshotId: request.newTargetSnapshotId,
      cooperativeStopAcknowledged: true, resumed: false, artifactDigest: request.artifactDigest,
      rereadEvidence: exactRereadEvidence(acknowledgement.rereadEvidence, request.rereadEvidence),
      report: exactPostStopReport(acknowledgement.report)
    } };
  }
  if ((value.disposition === "not_started" || value.disposition === "ambiguous") && exactKeys(value, ["disposition", "summary"])) {
    return { disposition: value.disposition, summary: redactProviderSummary(boundedText(value.summary, "re-anchor apply summary", 512)) };
  }
  throw new ReanchorLifecycleError("The re-anchor apply adapter returned an open or inconsistent effect disposition.");
}

function acknowledgementFromEffect(request: ReanchorRequestRecord, effect: ReanchorExternalEffect): ReanchorProviderAcknowledgement {
  return {
    schema: "sxsy-b122.reanchor-acknowledgement", version: 1, requestId: request.id, operationId: request.operationId,
    externalEffectId: effect.externalEffectId, sessionId: request.session.id, authorityId: request.authority.id,
    oldTargetSnapshotId: request.oldTarget.id, newTargetSnapshotId: request.newTarget.id,
    cooperativeStopAcknowledged: true, resumed: false, artifactDigest: effect.artifactDigest,
    rereadEvidence: effect.rereadEvidence, report: effect.report
  };
}

function exactPostStopReport(value: unknown): ReanchorPostStopReport {
  if (!isRecord(value) || !exactKeys(value, ["summary", "discrepancies", "risks", "questions", "result"])
    || value.result !== "reanchored_without_resume") {
    throw new ReanchorLifecycleError("The provider Re-anchor report is open, malformed, or claims an unauthorized result.");
  }
  return {
    summary: redactProviderSummary(boundedText(value.summary, "Re-anchor report summary", 512)),
    discrepancies: boundedList(value.discrepancies, "Re-anchor report discrepancy").map(redactProviderSummary),
    risks: boundedList(value.risks, "Re-anchor report risk").map(redactProviderSummary),
    questions: boundedList(value.questions, "Re-anchor report question").map(redactProviderSummary),
    result: "reanchored_without_resume"
  };
}

function exactRereadEvidence(value: unknown, expected: ReanchorProviderRereadEvidence): ReanchorProviderRereadEvidence {
  if (!isRecord(value) || !exactKeys(value, [
    "contextDigest", "authorityDigest", "instructionDigests", "planDigest", "documentationDigests", "currentWorkDigest", "inspectedTargetSnapshotId"
  ]) || typeof value.contextDigest !== "string" || !digest(value.contextDigest)
    || typeof value.authorityDigest !== "string" || !digest(value.authorityDigest)
    || typeof value.planDigest !== "string" || !digest(value.planDigest)
    || typeof value.currentWorkDigest !== "string" || !digest(value.currentWorkDigest)
    || typeof value.inspectedTargetSnapshotId !== "string" || !digest(value.inspectedTargetSnapshotId)
    || !digestList(value.instructionDigests, 64) || !digestList(value.documentationDigests, 256)
    || stableJson(value) !== stableJson(expected)) {
    throw new ReanchorLifecycleError("The provider Re-anchor acknowledgement did not prove every exact protected reread and current-work inspection binding.");
  }
  return jsonClone(expected);
}

function redactProviderSummary(value: string): string {
  return untrustedSummary(value, 512).replace(/\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/gi, "[REDACTED]");
}

function cloneLifecycle(value: ReanchorLifecycle): ReanchorLifecycle { return jsonClone(value); }
function cloneRequest(value: ReanchorRequestRecord): ReanchorRequestRecord { return jsonClone(value); }
function clonePreview(value: ReanchorPreview): ReanchorPreview { return jsonClone(value); }
function cloneSnapshot(value: TargetSnapshot): TargetSnapshot { return jsonClone(value); }
function cloneSession(value: ManagedSession): ManagedSession { return jsonClone(value); }
function cloneAuthority(value: AuthorityGrant): AuthorityGrant { return jsonClone(value); }

function sameRequestMaterial(left: ReanchorRequestRecord, right: ReanchorRequestRecord): boolean {
  return left.id === right.id && left.operationId === right.operationId && left.authorityDigest === right.authorityDigest
    && left.sessionBindingDigest === right.sessionBindingDigest && stableJson(left.oldTarget) === stableJson(right.oldTarget)
    && stableJson(left.newTarget) === stableJson(right.newTarget) && left.reason === right.reason;
}

function exactRequestId(value: string): string {
  if (typeof value !== "string" || !/^reanchor:[a-f0-9]{64}$/.test(value)) throw new ReanchorLifecycleError("The re-anchor request ID is malformed.");
  return value;
}

function invalidTransition(): ReanchorLifecycleError { return new ReanchorLifecycleError("The protected re-anchor journal contains an invalid lifecycle transition."); }
function digest(value: string): boolean { return /^[a-f0-9]{64}$/.test(value); }
function exactAction(value: string): boolean { return !!value && value.length <= 128 && !/[\s*?\r\n\0]/.test(value); }
function bounded(value: string, limit: number): boolean { return !!value.trim() && value.length <= limit && !/[\r\n\0]/.test(value); }
function boundedText(value: unknown, label: string, limit: number): string {
  if (typeof value !== "string" || !bounded(value, limit)) throw new ReanchorLifecycleError(`The ${label} is empty, unbounded, or contains control characters.`);
  return value.trim();
}
function boundedList(value: unknown, label: string): readonly string[] {
  if (!Array.isArray(value) || value.length > 128 || value.some((item) => typeof item !== "string" || !bounded(item, 512))) throw new ReanchorLifecycleError(`The ${label} list is malformed or unbounded.`);
  return value.map((item) => item.trim());
}
function digestList(value: unknown, maximum: number): value is readonly string[] {
  return Array.isArray(value) && value.length >= 1 && value.length <= maximum
    && value.every((item) => typeof item === "string" && digest(item)) && new Set(value).size === value.length;
}
function timestamp(value: string, label: string): string {
  if (typeof value !== "string" || !Number.isFinite(Date.parse(value))) throw new ReanchorLifecycleError(`The ${label} must be an ISO timestamp.`);
  return new Date(Date.parse(value)).toISOString();
}
function normalizeRepository(value: string): string {
  const normalized = value.replaceAll("\\", "/").replace(/\/+$/, "");
  return /^[a-z]:\//i.test(normalized) ? normalized.toLowerCase() : normalized;
}
function isRecord(value: unknown): value is Record<string, unknown> { return typeof value === "object" && value !== null && !Array.isArray(value); }
function exactKeys(value: Record<string, unknown>, required: readonly string[]): boolean {
  const keys = Object.keys(value);
  return keys.length === required.length && required.every((key) => Object.prototype.hasOwnProperty.call(value, key));
}
function allowedExactKeys(value: Record<string, unknown>, required: readonly string[], optional: readonly string[]): boolean {
  const allowed = new Set([...required, ...optional]);
  return required.every((key) => Object.prototype.hasOwnProperty.call(value, key)) && Object.keys(value).every((key) => allowed.has(key));
}
function safeFailure(error: unknown, fallback: string): string {
  return error instanceof ReanchorLifecycleError ? boundedText(error.message, "re-anchor failure", 512) : fallback;
}
