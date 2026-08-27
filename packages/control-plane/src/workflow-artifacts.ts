import { randomUUID } from "node:crypto";

import { commandActionIds, type CommandAction } from "./command-catalog.ts";
import type { AuthorityGrant, EffectDisposition, ManagedSession, SessionStatus } from "./contracts.ts";
import type { HandoffPackageStore } from "./context-packages.ts";
import { redactText } from "./redaction.ts";
import { jsonClone, type JournalEntry, ProtectedJsonStore, sha256, stableJson } from "./store.ts";
import type { VoiceProvider } from "./voice.ts";

export type WorkflowArtifactAction =
  | "reanchor" | "proof" | "proof_adversarial" | "option_provider" | "option_packet"
  | "plan_expander" | "plan_approval" | "handoff" | "handoff_queue" | "handoff_immediate"
  | "focus_blocked_agent" | "focus_finished_agent" | "authority_refresh" | "authority_broadcast"
  | "bind_voice_session";
export type WorkflowArtifactStatus = "prepared" | "submitted" | "cancelling" | "acknowledged" | "rejected" | "cancelled";

export interface WorkflowEvidenceReference {
  readonly id: string;
  readonly digest: string;
  readonly source: "protected_context" | "repository" | "target_snapshot" | "receipt";
  readonly summary: string;
}
export interface WorkflowTestEvidence extends WorkflowEvidenceReference {
  readonly status: "passed" | "failed" | "unavailable" | "incomplete" | "assumed" | "not_run";
}
export interface ExistingPlanBinding {
  readonly digest: string;
  readonly revision: string;
  readonly originSessionId: string;
  readonly taskId: string;
  readonly objective: string;
  readonly steps: readonly PlanStepArtifact[];
  readonly decisions: readonly string[];
  /** Provider-authored exact transition reviewed before any Plan Approval effect starts. */
  readonly expectedTargetTransition: PlanExecutionTargetTransition;
}
export interface CoordinatorEvidenceBundle {
  readonly contextDigest: string;
  readonly instructions: readonly WorkflowEvidenceReference[];
  readonly plan: ExistingPlanBinding;
  readonly documentation: readonly WorkflowEvidenceReference[];
  readonly diff: WorkflowEvidenceReference;
  readonly files: readonly WorkflowEvidenceReference[];
  readonly tests: readonly WorkflowTestEvidence[];
}
export interface AnchorWorkflowPayload {
  readonly kind: "anchor";
  readonly evidence: CoordinatorEvidenceBundle;
  readonly cooperativeStopRequested: true;
  readonly resumeAuthorized: false;
  readonly unresolved: readonly string[];
}
export interface ProofWorkflowPayload {
  readonly kind: "proof";
  readonly evidence: CoordinatorEvidenceBundle;
  readonly claims: readonly string[];
  readonly requiredBackends: readonly string[];
  readonly independentBackendRequired: boolean;
  /** Exact host-observed provider effects. Required for adversarial proof. */
  readonly providerEffects?: readonly WorkflowProviderEffectBinding[];
}
export interface DecisionOption { readonly id: string; readonly label: string; readonly tradeoffs: readonly string[]; readonly risks: readonly string[]; }
export interface PlanStepArtifact { readonly id: string; readonly summary: string; readonly ownedFiles: readonly string[]; readonly dependencies: readonly string[]; readonly status: "proposed" | "approved" | "completed" | "blocked"; }
export interface PendingDecision { readonly id: string; readonly question: string; readonly context: string; }
export interface DecisionWorkflowPayload {
  readonly kind: "decision";
  readonly mode: "one" | "packet";
  readonly decisions: readonly PendingDecision[];
  readonly evidence: CoordinatorEvidenceBundle;
  readonly providerMayChoose: false;
}
export interface PlanExpansionWorkflowPayload { readonly kind: "plan"; readonly mode: "expand"; readonly plan: ExistingPlanBinding; readonly evidence: CoordinatorEvidenceBundle; }
export interface PlanApprovalWorkflowPayload {
  readonly kind: "plan";
  readonly mode: "approve";
  readonly plan: ExistingPlanBinding;
  readonly executorSessionId: string;
  readonly authorityId: string;
  readonly confirmationDigest: string;
  /** Exact protected plan/provider review scope consumed by the dispatcher. */
  readonly confirmationScopeDigest: string;
  /** Authority-neutral provider observation bound into the protected review. */
  readonly providerContextDigest: string;
  readonly executeOnce: true;
}
export type PlanWorkflowPayload = PlanExpansionWorkflowPayload | PlanApprovalWorkflowPayload;
export interface HandoffWorkflowPayload { readonly kind: "handoff"; readonly packageId: string; readonly route: "queue" | "immediate"; readonly sourceSessionId: string; readonly recipientSessionId: string; readonly authorityId: string; }
export interface FocusWorkflowPayload {
  readonly kind: "focus";
  readonly selectedSessionId: string;
  readonly expectedStatus: Extract<SessionStatus, "verified_blocked" | "verified_finished">;
  readonly queueCycleId: string;
  readonly cycleIndex: number;
  readonly cycleSize: number;
  readonly reason: string;
}
export interface AuthorityPendingRequest {
  readonly requestId: string;
  readonly targetSnapshotId: string;
  readonly planRevision: string;
  readonly planDigest: string;
  readonly action: CommandAction;
}
export interface AuthorityReplayPacket {
  readonly recipientSessionId: string;
  readonly grantId: string;
  readonly actions: readonly CommandAction[];
  readonly prohibitions: readonly CommandAction[];
  readonly expiresAt: string;
  readonly pendingRequest: AuthorityPendingRequest;
  readonly matchDigest: string;
  /** Exact recipient/provider dispatch boundary. Required for broadcast. */
  readonly providerEffect?: WorkflowProviderEffectBinding;
}
export interface AuthorityWorkflowPayload { readonly kind: "authority"; readonly mode: "refresh" | "broadcast"; readonly packets: readonly AuthorityReplayPacket[]; readonly acknowledgementRequired: true; }
export interface VoiceBindingWorkflowPayload { readonly kind: "voice_binding"; readonly voiceSessionId: string; readonly provider: VoiceProvider; readonly contextPackageId: string; readonly consentId: string; }

export type WorkflowArtifactPayload = AnchorWorkflowPayload | ProofWorkflowPayload | DecisionWorkflowPayload | PlanWorkflowPayload | HandoffWorkflowPayload | FocusWorkflowPayload | AuthorityWorkflowPayload | VoiceBindingWorkflowPayload;

export interface WorkflowArtifactInput {
  readonly id?: string;
  readonly action: WorkflowArtifactAction;
  readonly repositoryRoot: string;
  readonly targetSnapshotId: string;
  readonly sessionId: string;
  readonly taskId?: string;
  readonly planRevision?: string;
  /** Protected local grant selected during host-owned preparation. */
  readonly authorityId?: string;
  /** Exact protected coordinator context used to build this immutable artifact. */
  readonly coordinatorContextDigest?: string;
  readonly coordinatorContextRevision?: number;
  readonly payload: WorkflowArtifactPayload;
}

export interface WorkflowArtifact extends Omit<WorkflowArtifactInput, "id"> {
  readonly id: string;
  readonly digest: string;
  readonly status: WorkflowArtifactStatus;
  readonly operationId?: string;
  readonly providerExternalId?: string;
  /** Latest exact typed provider result, retained so UI/recovery never discards the substantive answer. */
  readonly providerResult?: WorkflowProviderResult;
  readonly providerSummary?: string;
  readonly providerResponseStatus?: WorkflowProviderResponse["status"];
  readonly providerEffectDisposition?: EffectDisposition;
  /** Durable independently-settled child effects retained across restart. */
  readonly childResults?: readonly WorkflowChildProviderResponse[];
  readonly executionAuthorized: false;
  readonly createdAt: string;
  readonly updatedAt: string;
}

export type WorkflowArtifactImmutable = Omit<WorkflowArtifact,
  "digest" | "status" | "operationId" | "providerExternalId" | "providerResult" | "providerSummary" |
  "providerResponseStatus" | "providerEffectDisposition" | "childResults" | "executionAuthorized" | "createdAt" | "updatedAt">;

export type WorkflowProviderEffectRole = "proof_backend" | "authority_recipient";

/** Immutable host-selected identity for one genuinely separate provider effect. */
export interface WorkflowProviderEffectBinding {
  readonly role: WorkflowProviderEffectRole;
  readonly provider: "claude" | "codex";
  readonly session: ManagedSession;
  readonly authority: AuthorityGrant;
  readonly adapterId: string;
  readonly adapterVersion: string;
  readonly moduleSha256: string;
  readonly providerContextDigest: string;
  readonly bindingDigest: string;
}

export type WorkflowChildProviderResult =
  | { readonly kind: "proof_backend"; readonly backend: "claude" | "codex"; readonly status: "passed" | "failed" | "unavailable"; readonly verifiedClaims: readonly string[]; readonly evidenceReferences: readonly string[] }
  | { readonly kind: "authority_recipient"; readonly recipientSessionId: string; readonly grantId: string; readonly matchDigest: string; readonly acknowledged: true };

export interface WorkflowChildProviderResponse {
  readonly schema: "sxsy-b122.workflow-child-result";
  readonly version: 1;
  readonly artifactId: string;
  readonly artifactDigest: string;
  readonly parentOperationId: string;
  readonly childOperationId: string;
  readonly action: WorkflowArtifactAction;
  readonly role: WorkflowProviderEffectRole;
  readonly bindingDigest: string;
  readonly provider: "claude" | "codex";
  readonly adapterId: string;
  readonly moduleSha256: string;
  readonly status: "completed" | "failed" | "unavailable";
  readonly effectDisposition: EffectDisposition;
  readonly summary: string;
  readonly externalId?: string;
  readonly result: WorkflowChildProviderResult;
}

/** Canonicalize and hash exactly the immutable fields protected by an artifact digest. */
export function canonicalWorkflowArtifact(input: WorkflowArtifactInput & { readonly id: string }): Readonly<{ immutable: WorkflowArtifactImmutable; digest: string }> {
  const immutable = normalizeInput(input);
  return { immutable, digest: artifactDigest(immutable) };
}

export interface DecisionProviderPacket { readonly decisionId: string; readonly options: readonly DecisionOption[]; readonly recommendationId: string; }
export interface RankedPlanAlternative { readonly rank: number; readonly id: string; readonly summary: string; readonly rationale: string; readonly risks: readonly string[]; }
export interface PlanExecutionTargetTransition {
  readonly beforeTargetSnapshotId: string;
  readonly expectedAfterTargetSnapshotId: string;
  readonly expectation: "unchanged" | "changed";
}
export interface PlanExecutionChildEffect {
  readonly id: string;
  readonly action: "plan_execution";
  readonly status: "running" | "completed" | "failed";
  readonly effectDisposition: EffectDisposition;
  readonly summary: string;
  readonly externalId?: string;
}
export type WorkflowProviderResult =
  | { readonly kind: "anchor"; readonly anchorDigest: string; readonly discrepancies: readonly string[]; readonly questions: readonly string[]; readonly resumed: false }
  | { readonly kind: "proof"; readonly verifiedClaims: readonly string[]; readonly evidenceReferences: readonly string[]; readonly backendResults: readonly { readonly backend: string; readonly status: "passed" | "failed" | "unavailable" }[] }
  | { readonly kind: "decision"; readonly decisionPacketId: string; readonly decisions: readonly DecisionProviderPacket[]; readonly userSelectionRequired: true }
  | { readonly kind: "plan"; readonly mode: "expanded"; readonly planDigest: string; readonly alternatives: readonly RankedPlanAlternative[] }
  | { readonly kind: "plan"; readonly mode: "execution_ack"; readonly planDigest: string; readonly planRevision: string; readonly originSessionId: string; readonly executorSessionId: string; readonly authorityId: string; readonly acknowledgementId: string; readonly executionStarted: true; readonly targetTransition: PlanExecutionTargetTransition; readonly childEffects: readonly PlanExecutionChildEffect[] }
  | { readonly kind: "handoff"; readonly packageId: string; readonly recipientSessionId: string; readonly acknowledged: boolean }
  | { readonly kind: "focus"; readonly selectedSessionId: string; readonly status: Extract<SessionStatus, "verified_blocked" | "verified_finished">; readonly queueCycleId: string; readonly resultDelivered: boolean }
  | { readonly kind: "authority"; readonly acknowledgements: readonly { readonly recipientSessionId: string; readonly grantId: string; readonly matchDigest: string; readonly acknowledged: true }[] }
  | { readonly kind: "voice_binding"; readonly bindingId: string; readonly active: boolean };

export interface WorkflowProviderResponse {
  readonly schema: "sxsy-b122.workflow-result";
  readonly version: 1;
  readonly artifactId: string;
  readonly artifactDigest: string;
  readonly operationId: string;
  readonly action: WorkflowArtifactAction;
  readonly status: "completed" | "failed" | "blocked" | "unavailable" | "running" | "awaiting_input" | "awaiting_confirmation";
  readonly effectDisposition: EffectDisposition;
  readonly summary: string;
  readonly externalId?: string;
  readonly result: WorkflowProviderResult;
}

interface ArtifactSavedEvent { readonly artifact: WorkflowArtifact; }

export interface WorkflowCoordinatorContextInput {
  readonly sessionId: string;
  readonly repositoryRoot: string;
  readonly targetSnapshotId: string;
  readonly authorityId: string;
  /** Monotonic provider observation revision for this exact session/target. */
  readonly sourceRevision: number;
  /** Authority-neutral provenance retained from the digest-validated provider observation. */
  readonly provenance?: WorkflowCoordinatorProvenance;
  readonly evidence: CoordinatorEvidenceBundle;
  readonly pendingDecisions: readonly PendingDecision[];
  readonly pendingRequest?: AuthorityPendingRequest;
}

export interface WorkflowCoordinatorProvenance {
  readonly provider: "claude" | "codex";
  readonly contextId: string;
  readonly observedAt: string;
  readonly adapterId: string;
  readonly adapterVersion: string;
  readonly moduleSha256: string;
  readonly providerContextDigest: string;
  readonly envelopeDigest: string;
}

export interface PlanApprovalReviewScopeInput {
  readonly sessionId: string;
  readonly targetSnapshotId: string;
  readonly repositoryRoot: string;
  readonly taskId: string;
  readonly planRevision: string;
  readonly planDigest: string;
  readonly originSessionId: string;
  readonly providerContextDigest: string;
  readonly sourceRevision: number;
}

/**
 * One canonical digest binds the current-user ceremony, prepared artifact,
 * durable confirmation, dispatcher, and provider gateway to the exact plan
 * the operator reviewed. It deliberately excludes any client-selected data.
 */
export function planApprovalReviewScopeDigest(input: PlanApprovalReviewScopeInput): string {
  return sha256(stableJson({
    action: "plan_approval",
    sessionId: identifier(input.sessionId, "plan review session"),
    targetSnapshotId: digest(input.targetSnapshotId, "plan review target"),
    repositoryRoot: text(input.repositoryRoot, "plan review repository"),
    taskId: identifier(input.taskId, "plan review task"),
    planRevision: identifier(input.planRevision, "plan review revision"),
    planDigest: digest(input.planDigest, "plan review plan digest"),
    originSessionId: identifier(input.originSessionId, "plan review origin session"),
    providerContextDigest: digest(input.providerContextDigest, "plan review provider context"),
    sourceRevision: positiveRevision(input.sourceRevision, "plan review source revision")
  }));
}

/**
 * Canonical operator-review scope for Shift Authority. The scope contains only
 * protected artifact identity plus the ordered recipient/match pairs that the
 * trusted UI presents. Full packet bodies remain covered by artifactDigest.
 */
export function authorityBroadcastReviewScopeDigest(artifact: WorkflowArtifact): string {
  if (artifact.action !== "authority_broadcast" || artifact.payload.kind !== "authority" || artifact.payload.mode !== "broadcast") {
    throw new WorkflowArtifactError("Authority Broadcast review requires one exact protected broadcast artifact.");
  }
  const authorityId = identifier(artifact.authorityId, "authority broadcast review authority");
  return sha256(stableJson({
    action: "authority_broadcast",
    artifactId: identifier(artifact.id, "authority broadcast review artifact"),
    artifactDigest: digest(artifact.digest, "authority broadcast review artifact digest"),
    sessionId: identifier(artifact.sessionId, "authority broadcast review session"),
    authorityId,
    repositoryRoot: text(artifact.repositoryRoot, "authority broadcast review repository"),
    targetSnapshotId: digest(artifact.targetSnapshotId, "authority broadcast review target"),
    packets: artifact.payload.packets.map((packet) => ({
      recipientSessionId: identifier(packet.recipientSessionId, "authority broadcast review recipient"),
      matchDigest: digest(packet.matchDigest, "authority broadcast review packet digest")
    }))
  }));
}

export interface WorkflowCoordinatorContext extends WorkflowCoordinatorContextInput {
  readonly digest: string;
  readonly capturedAt: string;
}

export type WorkflowPreparationIntent =
  | { readonly kind: "none" }
  | { readonly kind: "decision"; readonly question: string; readonly context: string }
  | { readonly kind: "handoff"; readonly recipientSessionId: string; readonly route: "default" | "queue" | "immediate" }
  | { readonly kind: "authority_broadcast"; readonly recipientSessionIds: readonly string[] }
  | { readonly kind: "plan_approval"; readonly confirmationToken: string; readonly confirmationScopeDigest: string };

export interface WorkflowPreparationRequest {
  readonly action: WorkflowArtifactAction;
  readonly session: ManagedSession;
  readonly authorityId: string;
  readonly intent: WorkflowPreparationIntent;
}

export interface WorkflowPreparationCoordinator {
  prepare(request: WorkflowPreparationRequest): Promise<WorkflowPreparationResult>;
}

export interface WorkflowPreparationResult {
  readonly payload: WorkflowArtifactPayload;
  readonly authorityId: string;
  readonly coordinatorContextDigest: string;
  readonly coordinatorContextRevision: number;
}

interface WorkflowContextSavedEvent { readonly context: WorkflowCoordinatorContext; }
interface WorkflowCycleSavedEvent { readonly key: string; readonly selectedSessionId: string; readonly queueDigest: string; readonly updatedAt: string; }

export class WorkflowArtifactError extends Error {
  constructor(message: string) { super(message); this.name = "WorkflowArtifactError"; }
}

export class WorkflowArtifactStore {
  private readonly store: ProtectedJsonStore;
  private readonly clock: () => string;
  private readonly idFactory: () => string;

  constructor(store: ProtectedJsonStore, options: Readonly<{ clock?: () => string; idFactory?: () => string }> = {}) {
    this.store = store;
    this.clock = options.clock ?? (() => new Date().toISOString());
    this.idFactory = options.idFactory ?? randomUUID;
  }

  async create(input: WorkflowArtifactInput): Promise<WorkflowArtifact> {
    rejectLegacyReanchorWorkflow(input.action);
    const now = timestamp(this.clock(), "artifact clock");
    const immutable = normalizeInput({ ...input, id: input.id ?? this.idFactory() });
    const artifact: WorkflowArtifact = {
      ...immutable,
      digest: artifactDigest(immutable),
      status: "prepared",
      executionAuthorized: false,
      createdAt: now,
      updatedAt: now
    };
    return this.store.transaction(async (transaction) => {
      const existing = artifactMap(await transaction.readEntries());
      if (existing.has(artifact.id)) throw new WorkflowArtifactError(`Workflow artifact already exists: ${artifact.id}`);
      const active = [...existing.values()].filter((entry) => entry.status === "prepared" && entry.action === artifact.action
        && entry.targetSnapshotId === artifact.targetSnapshotId && entry.sessionId === artifact.sessionId);
      if (active.length > 0) {
        if (active.length === 1 && active[0]!.digest === artifact.digest) return clone(active[0]!);
        throw new WorkflowArtifactError("One prepared workflow artifact already exists for this exact action, session, and target; cancel it explicitly before preparing a replacement.");
      }
      await transaction.append<ArtifactSavedEvent>("workflow-artifact.saved", { artifact });
      return clone(artifact);
    });
  }

  async get(id: string): Promise<WorkflowArtifact | undefined> {
    const found = artifactMap(await this.store.readEntries()).get(text(id, "artifact id"));
    return found ? clone(found) : undefined;
  }

  async list(status?: WorkflowArtifactStatus): Promise<readonly WorkflowArtifact[]> {
    return [...artifactMap(await this.store.readEntries()).values()].filter((entry) => !status || entry.status === status).map(clone);
  }

  async observeOperation(operationId: string): Promise<WorkflowArtifact | undefined> {
    const id = text(operationId, "operation id");
    const matches = [...artifactMap(await this.store.readEntries()).values()].filter((entry) => entry.operationId === id);
    if (matches.length > 1) throw new WorkflowArtifactError("Multiple workflow artifacts are bound to one operation.");
    return matches[0] ? clone(matches[0]) : undefined;
  }

  async claimForDispatch(input: Readonly<{ action: WorkflowArtifactAction; targetSnapshotId: string; sessionId: string; operationId: string; authorityId?: string }>): Promise<WorkflowArtifact | undefined> {
    rejectLegacyReanchorWorkflow(input.action);
    return this.store.transaction(async (transaction) => {
      const journal = await transaction.readEntries();
      const entries = artifactMap(journal);
      const existing = [...entries.values()].find((entry) => entry.operationId === input.operationId);
      if (existing) {
        if (existing.action !== input.action || existing.targetSnapshotId !== input.targetSnapshotId || existing.sessionId !== input.sessionId || existing.authorityId !== input.authorityId) throw new WorkflowArtifactError("The operation is already bound to a different workflow artifact scope.");
        this.assertCurrentCoordinatorBinding(existing, journal);
        return clone(existing);
      }
      const candidates = [...entries.values()].filter((entry) => entry.status === "prepared" && entry.action === input.action && entry.targetSnapshotId === input.targetSnapshotId && entry.sessionId === input.sessionId && entry.authorityId === input.authorityId);
      if (candidates.length === 0) return undefined;
      if (candidates.length !== 1) throw new WorkflowArtifactError("Multiple prepared workflow artifacts match this dispatch; explicit operator selection is required.");
      const selected = candidates[0]!;
      this.assertCurrentCoordinatorBinding(selected, journal);
      const updated: WorkflowArtifact = { ...selected, status: "submitted", operationId: text(input.operationId, "operation id"), updatedAt: timestamp(this.clock(), "artifact clock"), executionAuthorized: false };
      await transaction.append<ArtifactSavedEvent>("workflow-artifact.saved", { artifact: updated });
      return clone(updated);
    });
  }

  /**
   * Performs the final protected-artifact check immediately before an
   * installed adapter crosses its effect boundary. Claiming an artifact is
   * not sufficient because a trusted coordinator observation may advance
   * while the adapter is assembling its outbound envelope.
   */
  async assertDispatchBinding(input: Readonly<{
    artifactId: string;
    artifactDigest: string;
    action: WorkflowArtifactAction;
    targetSnapshotId: string;
    sessionId: string;
    operationId: string;
    authorityId: string;
  }>): Promise<WorkflowArtifact> {
    rejectLegacyReanchorWorkflow(input.action);
    return this.store.transaction(async (transaction) => {
      const journal = await transaction.readEntries();
      const artifact = artifactMap(journal).get(text(input.artifactId, "artifact id"));
      if (!artifact || artifact.status !== "submitted" || artifact.digest !== digest(input.artifactDigest, "artifact digest")
        || artifact.action !== workflowAction(input.action) || artifact.targetSnapshotId !== digest(input.targetSnapshotId, "target snapshot id")
        || artifact.sessionId !== text(input.sessionId, "workflow dispatch session")
        || artifact.operationId !== text(input.operationId, "workflow dispatch operation")
        || artifact.authorityId !== identifier(input.authorityId, "workflow dispatch authority")) {
        throw new WorkflowArtifactError("The submitted workflow artifact changed or no longer matches the exact final dispatch binding.");
      }
      this.assertCurrentCoordinatorBinding(artifact, journal);
      return clone(artifact);
    });
  }

  /** Records one exact child result before its saga is settled, enabling no-replay aggregate recovery. */
  async recordChildResult(response: WorkflowChildProviderResponse): Promise<WorkflowArtifact> {
    return this.store.transaction(async (transaction) => {
      const entries = artifactMap(await transaction.readEntries());
      const found = entries.get(identifier(response.artifactId, "child artifact id"));
      if (!found || !found.operationId || (found.status !== "submitted" && found.status !== "cancelling" && found.status !== "acknowledged")) {
        throw new WorkflowArtifactError("The workflow child result has no dispatchable durable parent artifact.");
      }
      const effect = workflowProviderEffect(found.payload, response.role, response.bindingDigest);
      const parsed = parseWorkflowChildProviderResponse(response, found, effect, response.childOperationId, response.role);
      const existing = found.childResults?.find((entry) => entry.bindingDigest === parsed.bindingDigest);
      if (existing) {
        if (stableJson(existing) !== stableJson(parsed)) throw new WorkflowArtifactError("The workflow child result conflicts with the durable binding receipt.");
        return clone(found);
      }
      if (found.childResults?.some((entry) => entry.childOperationId === parsed.childOperationId)) throw new WorkflowArtifactError("The workflow child operation is already bound to another provider effect.");
      const updated: WorkflowArtifact = {
        ...found,
        childResults: [...(found.childResults ?? []), parsed],
        updatedAt: timestamp(this.clock(), "artifact clock"),
        executionAuthorized: false
      };
      await transaction.append<ArtifactSavedEvent>("workflow-artifact.saved", { artifact: updated });
      return clone(updated);
    });
  }

  async cancelPrepared(input: Readonly<{ artifactId: string; sessionId: string; authorityId: string }>): Promise<WorkflowArtifact> {
    return this.store.transaction(async (transaction) => {
      const journal = await transaction.readEntries();
      const found = artifactMap(journal).get(text(input.artifactId, "artifact id"));
      if (!found || found.status !== "prepared") throw new WorkflowArtifactError("Only one exact prepared workflow artifact can be cancelled through this route.");
      if (found.sessionId !== identifier(input.sessionId, "workflow cancellation session") || found.authorityId !== identifier(input.authorityId, "workflow cancellation authority")) {
        throw new WorkflowArtifactError("Workflow cancellation does not match the artifact's exact session and authority binding.");
      }
      const updated: WorkflowArtifact = { ...found, status: "cancelled", updatedAt: timestamp(this.clock(), "artifact clock"), executionAuthorized: false };
      await transaction.append<ArtifactSavedEvent>("workflow-artifact.saved", { artifact: updated });
      return clone(updated);
    });
  }

  private assertCurrentCoordinatorBinding(artifact: WorkflowArtifact, journal: readonly JournalEntry<unknown>[]): void {
    if (artifact.coordinatorContextDigest === undefined && artifact.coordinatorContextRevision === undefined) return;
    if (!artifact.coordinatorContextDigest || !Number.isSafeInteger(artifact.coordinatorContextRevision) || (artifact.coordinatorContextRevision ?? 0) < 1) {
      throw new WorkflowArtifactError("The workflow artifact has a partial coordinator-context binding.");
    }
    const current = contextMap(journal).get(artifact.sessionId);
    if (!current || current.targetSnapshotId !== artifact.targetSnapshotId || current.digest !== artifact.coordinatorContextDigest
      || current.sourceRevision !== artifact.coordinatorContextRevision || current.authorityId !== artifact.authorityId) {
      throw new WorkflowArtifactError("The prepared workflow artifact is stale relative to the exact current coordinator context and authority.");
    }
  }

  async acknowledge(response: WorkflowProviderResponse): Promise<WorkflowArtifact> {
    return this.store.transaction(async (transaction) => {
      const found = artifactMap(await transaction.readEntries()).get(response.artifactId);
      if (!found) throw new WorkflowArtifactError("The provider response references an unknown workflow artifact.");
      const parsed = parseWorkflowProviderResponse(response, found);
      if (found.status === "acknowledged" && found.providerExternalId === parsed.externalId && found.providerResult !== undefined) return clone(found);
      if (found.status === "acknowledged" && found.providerExternalId === parsed.externalId) {
        const backfilled: WorkflowArtifact = {
          ...found,
          providerResult: parsed.result,
          providerSummary: parsed.summary,
          providerResponseStatus: parsed.status,
          providerEffectDisposition: parsed.effectDisposition,
          updatedAt: timestamp(this.clock(), "artifact clock"),
          executionAuthorized: false
        };
        await transaction.append<ArtifactSavedEvent>("workflow-artifact.saved", { artifact: backfilled });
        return clone(backfilled);
      }
      if (found.status !== "submitted" && found.status !== "cancelling") throw new WorkflowArtifactError(`Workflow artifact is already ${found.status}.`);
      const finalStatus: WorkflowArtifactStatus = parsed.status === "completed" && parsed.effectDisposition === "committed"
        ? "acknowledged"
        : found.status === "cancelling" && (parsed.effectDisposition === "not_started" || parsed.effectDisposition === "compensated")
          ? "cancelled"
          : parsed.effectDisposition === "not_started"
          ? "rejected"
          : parsed.effectDisposition === "compensated"
            ? "cancelled"
            : found.status;
      const updated: WorkflowArtifact = {
        ...found,
        status: finalStatus,
        ...(parsed.externalId ? { providerExternalId: parsed.externalId } : {}),
        providerResult: parsed.result,
        providerSummary: parsed.summary,
        providerResponseStatus: parsed.status,
        providerEffectDisposition: parsed.effectDisposition,
        updatedAt: timestamp(this.clock(), "artifact clock"),
        executionAuthorized: false
      };
      await transaction.append<ArtifactSavedEvent>("workflow-artifact.saved", { artifact: updated });
      return clone(updated);
    });
  }

  async cancel(id: string): Promise<WorkflowArtifact> {
    return this.store.transaction(async (transaction) => {
      const found = artifactMap(await transaction.readEntries()).get(text(id, "artifact id"));
      if (!found) throw new WorkflowArtifactError("Unknown workflow artifact.");
      if (found.status === "acknowledged") throw new WorkflowArtifactError("An acknowledged workflow artifact cannot be cancelled.");
      if (found.status === "cancelled" || found.status === "cancelling") return clone(found);
      const updated: WorkflowArtifact = { ...found, status: found.status === "submitted" ? "cancelling" : "cancelled", updatedAt: timestamp(this.clock(), "artifact clock"), executionAuthorized: false };
      await transaction.append<ArtifactSavedEvent>("workflow-artifact.saved", { artifact: updated });
      return clone(updated);
    });
  }

  async cancelByOperation(operationId: string): Promise<WorkflowArtifact | undefined> {
    const id = text(operationId, "operation id");
    return this.store.transaction(async (transaction) => {
      const matches = [...artifactMap(await transaction.readEntries()).values()].filter((entry) => entry.operationId === id);
      if (matches.length > 1) throw new WorkflowArtifactError("Multiple workflow artifacts are bound to one operation.");
      const found = matches[0];
      if (!found || found.status === "acknowledged" || found.status === "rejected" || found.status === "cancelled" || found.status === "cancelling") return found ? clone(found) : undefined;
      const updated: WorkflowArtifact = { ...found, status: found.status === "submitted" ? "cancelling" : "cancelled", updatedAt: timestamp(this.clock(), "artifact clock"), executionAuthorized: false };
      await transaction.append<ArtifactSavedEvent>("workflow-artifact.saved", { artifact: updated });
      return clone(updated);
    });
  }

  async cancelQueuedForRepository(repositoryRoot: string): Promise<readonly WorkflowArtifact[]> {
    const root = text(repositoryRoot, "repository root");
    return this.store.transaction(async (transaction) => {
      const candidates = [...artifactMap(await transaction.readEntries()).values()].filter((entry) => sameRepositoryRoot(entry.repositoryRoot, root) && (entry.status === "prepared" || entry.status === "submitted" || entry.status === "cancelling"));
      const updated: WorkflowArtifact[] = [];
      for (const artifact of candidates) {
        if (artifact.status === "cancelling") { updated.push(clone(artifact)); continue; }
        const next: WorkflowArtifact = { ...artifact, status: artifact.status === "submitted" ? "cancelling" : "cancelled", updatedAt: timestamp(this.clock(), "artifact clock"), executionAuthorized: false };
        await transaction.append<ArtifactSavedEvent>("workflow-artifact.saved", { artifact: next });
        updated.push(clone(next));
      }
      return updated;
    });
  }
}

/**
 * Trusted host-side source for workflow evidence. The authenticated IPC does
 * not expose a method that writes this ledger: provider/repository text may be
 * recorded as evidence, but it cannot become authority or approve a plan.
 */
export class WorkflowCoordinatorContextStore {
  private readonly store: ProtectedJsonStore;
  private readonly clock: () => string;

  constructor(store: ProtectedJsonStore, options: Readonly<{ clock?: () => string }> = {}) {
    this.store = store;
    this.clock = options.clock ?? (() => new Date().toISOString());
  }

  async record(input: WorkflowCoordinatorContextInput): Promise<WorkflowCoordinatorContext> {
    const normalized = normalizeCoordinatorContextInput(input);
    const context: WorkflowCoordinatorContext = {
      ...normalized,
      digest: sha256(stableJson(normalized)),
      capturedAt: timestamp(this.clock(), "workflow context clock")
    };
    return this.store.transaction(async (transaction) => {
      const existing = contextMap(await transaction.readEntries());
      const previous = existing.get(context.sessionId);
      if (previous && previous.targetSnapshotId === context.targetSnapshotId) {
        if (context.sourceRevision < previous.sourceRevision) throw new WorkflowArtifactError("Workflow context source revision cannot roll back.");
        if (context.sourceRevision === previous.sourceRevision) {
          if (previous.digest === context.digest) return cloneContext(previous);
          const sameProviderObservation = previous.provenance !== undefined && context.provenance !== undefined
            && previous.provenance.providerContextDigest === context.provenance.providerContextDigest;
          if (!sameProviderObservation) throw new WorkflowArtifactError("Workflow context content changed without a monotonic provider source revision.");
        }
      }
      await transaction.append<WorkflowContextSavedEvent>("workflow-context.saved", { context });
      return cloneContext(context);
    });
  }

  async current(sessionId: string, targetSnapshotId: string): Promise<WorkflowCoordinatorContext | undefined> {
    const context = contextMap(await this.store.readEntries()).get(identifier(sessionId, "workflow context session"));
    return context?.targetSnapshotId === digest(targetSnapshotId, "workflow context target") ? cloneContext(context) : undefined;
  }

  async nextFocus(input: Readonly<{ sourceSessionId: string; repositoryRoot: string; targetSnapshotId: string; expectedStatus: Extract<SessionStatus, "verified_blocked" | "verified_finished">; sessions: readonly ManagedSession[] }>): Promise<FocusWorkflowPayload> {
    const candidates = input.sessions
      .filter((session) => session.status === input.expectedStatus && session.capabilities.includes("observable") && session.workspaceRoot && sameRepositoryRoot(session.workspaceRoot, input.repositoryRoot) && session.targetSnapshotId === input.targetSnapshotId)
      .sort((left, right) => left.id.localeCompare(right.id));
    if (!candidates.length) throw new WorkflowArtifactError(`No ${input.expectedStatus.replace("verified_", "verified ")} managed session is currently proven for this exact target.`);
    // Heartbeats prove freshness but are not queue identity. Including them
    // reset repeated-press cycling after every provider observation refresh.
    const queueDigest = sha256(stableJson(candidates.map((session) => ({ id: session.id, status: session.status, targetSnapshotId: session.targetSnapshotId }))));
    const key = `${identifier(input.sourceSessionId, "focus source session")}:${input.expectedStatus}:${digest(input.targetSnapshotId, "focus target")}`;
    return this.store.transaction(async (transaction) => {
      const cycles = cycleMap(await transaction.readEntries());
      const previous = cycles.get(key);
      const previousIndex = previous?.queueDigest === queueDigest ? candidates.findIndex((session) => session.id === previous.selectedSessionId) : -1;
      const cycleIndex = (previousIndex + 1) % candidates.length;
      const selected = candidates[cycleIndex]!;
      const updatedAt = timestamp(this.clock(), "focus cycle clock");
      await transaction.append<WorkflowCycleSavedEvent>("workflow-cycle.saved", { key, selectedSessionId: selected.id, queueDigest, updatedAt });
      const reason = selected.metadata["sxsy-b122.statusReason"]?.trim() || (input.expectedStatus === "verified_blocked" ? "The provider reported this exact session as blocked without a separate reason." : "The provider reported this exact session as finished; deliver its result for triage.");
      return { kind: "focus", selectedSessionId: selected.id, expectedStatus: input.expectedStatus, queueCycleId: sha256(stableJson({ key, queueDigest, updatedAt })), cycleIndex, cycleSize: candidates.length, reason: text(reason, "focus reason") };
    });
  }
}

export interface WorkflowAuthorityLookup { get(authorityId: string): Promise<AuthorityGrant | undefined>; }
export interface WorkflowSessionLookup { list(): Promise<readonly ManagedSession[]>; get(id: string): Promise<ManagedSession | undefined>; }

/** Builds provider requests exclusively from protected coordinator state. */
export class DurableWorkflowPreparationCoordinator implements WorkflowPreparationCoordinator {
  private readonly contexts: WorkflowCoordinatorContextStore;
  private readonly sessions: WorkflowSessionLookup;
  private readonly authorities: WorkflowAuthorityLookup;
  private readonly handoffs?: HandoffPackageStore;

  constructor(contexts: WorkflowCoordinatorContextStore, sessions: WorkflowSessionLookup, authorities: WorkflowAuthorityLookup, handoffs?: HandoffPackageStore) {
    this.contexts = contexts;
    this.sessions = sessions;
    this.authorities = authorities;
    this.handoffs = handoffs;
  }

  async prepare(request: WorkflowPreparationRequest): Promise<WorkflowPreparationResult> {
    const session = request.session;
    if (!session.workspaceRoot || !session.targetSnapshotId || !session.taskId || !session.planRevision) throw new WorkflowArtifactError("Workflow preparation requires one exact task-bound managed session.");
    const context = await this.contexts.current(session.id, session.targetSnapshotId);
    if (!context || !sameRepositoryRoot(context.repositoryRoot, session.workspaceRoot) || context.evidence.plan.taskId !== session.taskId || context.evidence.plan.revision !== session.planRevision) throw new WorkflowArtifactError("Protected coordinator context is missing, stale, or bound to another task, plan, session, or target.");
    if (context.authorityId !== request.authorityId) throw new WorkflowArtifactError("Workflow context authority does not match the command preparation authority.");
    const authority = await this.requireAuthority(context, session, request.action);
    switch (request.action) {
      case "reanchor":
        requireIntent(request.intent, "none");
        return this.prepared(context, authority, { kind: "anchor", evidence: context.evidence, cooperativeStopRequested: true, resumeAuthorized: false, unresolved: context.pendingDecisions.map((decision) => decision.question) });
      case "proof":
        requireIntent(request.intent, "none");
        return this.prepared(context, authority, { kind: "proof", evidence: context.evidence, claims: proofClaims(context.evidence), requiredBackends: [session.provider], independentBackendRequired: false });
      case "proof_adversarial": {
        requireIntent(request.intent, "none");
        if (session.provider !== "claude" && session.provider !== "codex") throw new WorkflowArtifactError("Adversarial proof requires an exact Claude or Codex source provider.");
        const expectedProvider = independentProvider(session.provider);
        const candidates = (await this.sessions.list()).filter((candidate) => candidate.provider === expectedProvider && candidate.id !== session.id
          && candidate.workspaceRoot && candidate.targetSnapshotId === session.targetSnapshotId && sameRepositoryRoot(candidate.workspaceRoot, session.workspaceRoot!)
          && candidate.taskId === session.taskId && candidate.planRevision === session.planRevision && candidate.capabilities.includes("observable")
          && candidate.status !== "stale" && candidate.status !== "unreachable");
        if (candidates.length !== 1) throw new WorkflowArtifactError("Adversarial proof requires exactly one current independent provider session for the same target and plan.");
        const independent = candidates[0]!;
        const independentContext = await this.contexts.current(independent.id, independent.targetSnapshotId!);
        if (!independentContext || !sameRepositoryRoot(independentContext.repositoryRoot, context.repositoryRoot) || independentContext.evidence.plan.digest !== context.evidence.plan.digest) throw new WorkflowArtifactError("Adversarial proof independent provider lacks the exact protected evidence and plan binding.");
        const independentAuthority = await this.requireAuthority(independentContext, independent, "proof_adversarial");
        const providerEffects = [
          this.providerEffect(context, session, authority, "proof_backend"),
          this.providerEffect(independentContext, independent, independentAuthority, "proof_backend")
        ];
        if (providerEffects[0]!.adapterId === providerEffects[1]!.adapterId || providerEffects[0]!.moduleSha256 === providerEffects[1]!.moduleSha256) throw new WorkflowArtifactError("Adversarial proof provider labels alias the same adapter boundary and are not independent.");
        return this.prepared(context, authority, { kind: "proof", evidence: context.evidence, claims: proofClaims(context.evidence), requiredBackends: providerEffects.map((effect) => effect.provider), independentBackendRequired: true, providerEffects });
      }
      case "option_provider": {
        if (request.intent.kind !== "decision") throw new WorkflowArtifactError("Normal Option Provider requires only the user's question and bounded context; the provider generates the options.");
        const decision = { id: `decision:${sha256(stableJson({ question: request.intent.question, context: request.intent.context })).slice(0, 32)}`, question: text(request.intent.question, "decision question"), context: text(request.intent.context, "decision context") };
        return this.prepared(context, authority, { kind: "decision", mode: "one", decisions: [decision], evidence: context.evidence, providerMayChoose: false });
      }
      case "option_packet":
        requireIntent(request.intent, "none");
        if (context.pendingDecisions.length < 2) throw new WorkflowArtifactError("Shift Option Provider requires at least two protected pending decisions.");
        return this.prepared(context, authority, { kind: "decision", mode: "packet", decisions: context.pendingDecisions, evidence: context.evidence, providerMayChoose: false });
      case "plan_expander":
        requireIntent(request.intent, "none");
        return this.prepared(context, authority, { kind: "plan", mode: "expand", plan: context.evidence.plan, evidence: context.evidence });
      case "plan_approval":
        if (request.intent.kind !== "plan_approval" || !bounded(request.intent.confirmationToken, 512) || !digestLike(request.intent.confirmationScopeDigest)) throw new WorkflowArtifactError("Plan Approval requires the current-user confirmation and exact protected review scope issued for this command preparation.");
        if (!context.provenance) throw new WorkflowArtifactError("Plan Approval requires protected provider-context provenance for the exact reviewed plan.");
        if (request.intent.confirmationScopeDigest !== planApprovalReviewScopeDigest({
          sessionId: session.id,
          targetSnapshotId: context.targetSnapshotId,
          repositoryRoot: context.repositoryRoot,
          taskId: context.evidence.plan.taskId,
          planRevision: context.evidence.plan.revision,
          planDigest: context.evidence.plan.digest,
          originSessionId: context.evidence.plan.originSessionId,
          providerContextDigest: context.provenance.providerContextDigest,
          sourceRevision: context.sourceRevision
        })) throw new WorkflowArtifactError("Plan Approval confirmation is not bound to the exact protected plan and provider-context revision.");
        return this.prepared(context, authority, { kind: "plan", mode: "approve", plan: context.evidence.plan, executorSessionId: session.id, authorityId: authority.id, confirmationDigest: sha256(request.intent.confirmationToken), confirmationScopeDigest: request.intent.confirmationScopeDigest, providerContextDigest: context.provenance.providerContextDigest, executeOnce: true });
      case "handoff":
      case "handoff_queue":
      case "handoff_immediate":
        if (request.intent.kind !== "handoff") throw new WorkflowArtifactError("Handoff requires one exact coordinator-created package and recipient.");
        if ((request.action === "handoff" && request.intent.route !== "default") || (request.action === "handoff_immediate" && request.intent.route !== "immediate") || (request.action === "handoff_queue" && request.intent.route !== "queue")) throw new WorkflowArtifactError("Handoff route does not match its exact chord semantics.");
        await this.requireRecipient(session, request.intent.recipientSessionId);
        if (!this.handoffs) throw new WorkflowArtifactError("The durable coordinator Handoff store is unavailable.");
        const handoff = await this.handoffs.create({
          repositoryRoot: context.repositoryRoot,
          targetSnapshotId: context.targetSnapshotId,
          taskId: context.evidence.plan.taskId,
          planRevision: context.evidence.plan.revision,
          authorityId: authority.id,
          recipientSessionId: request.intent.recipientSessionId,
          ...(request.intent.route === "default" ? {} : { routing: request.intent.route }),
          plan: stableJson(context.evidence.plan),
          decisions: context.evidence.plan.decisions,
          documentation: context.evidence.documentation.map((entry) => `${entry.id}:${entry.digest}`),
          references: [...context.evidence.instructions, context.evidence.diff, ...context.evidence.files, ...context.evidence.tests].map((entry) => `${entry.id}:${entry.digest}`),
          constraints: ["This package transfers context only and grants no new authority or execution."],
          openQuestions: context.pendingDecisions.map((decision) => decision.question),
          nextActions: ["Acknowledge this exact immutable package before using its context."]
        });
        return this.prepared(context, authority, { kind: "handoff", packageId: handoff.id, route: handoff.status === "immediate_focus_requested" ? "immediate" : "queue", sourceSessionId: session.id, recipientSessionId: request.intent.recipientSessionId, authorityId: authority.id });
      case "focus_blocked_agent":
      case "focus_finished_agent":
        requireIntent(request.intent, "none");
        return this.prepared(context, authority, await this.contexts.nextFocus({ sourceSessionId: session.id, repositoryRoot: session.workspaceRoot, targetSnapshotId: session.targetSnapshotId, expectedStatus: request.action === "focus_blocked_agent" ? "verified_blocked" : "verified_finished", sessions: await this.sessions.list() }));
      case "authority_refresh":
        requireIntent(request.intent, "none");
        return this.prepared(context, authority, { kind: "authority", mode: "refresh", packets: [this.authorityPacket(context, session, authority)], acknowledgementRequired: true });
      case "authority_broadcast": {
        if (request.intent.kind !== "authority_broadcast" || request.intent.recipientSessionIds.length < 1 || request.intent.recipientSessionIds.length > 64) throw new WorkflowArtifactError("Authority broadcast requires a reviewed bounded recipient set.");
        const recipients = request.intent.recipientSessionIds.map((id) => identifier(id, "authority recipient"));
        if (new Set(recipients).size !== recipients.length) throw new WorkflowArtifactError("Authority broadcast recipients must be unique; duplicate session IDs are not silently collapsed.");
        const packets: AuthorityReplayPacket[] = [];
        for (const id of recipients) {
          const recipient = await this.sessions.get(id);
          if (!recipient?.targetSnapshotId || !recipient.workspaceRoot || recipient.status !== "verified_blocked"
            || recipient.targetSnapshotId !== session.targetSnapshotId || !sameRepositoryRoot(recipient.workspaceRoot, session.workspaceRoot!)) {
            throw new WorkflowArtifactError("Authority broadcast requires an exact verified-blocked recipient on the source repository and TargetSnapshot.");
          }
          const recipientContext = await this.contexts.current(id, recipient.targetSnapshotId);
          if (!recipientContext || !sameRepositoryRoot(recipientContext.repositoryRoot, recipient.workspaceRoot)) throw new WorkflowArtifactError("Authority broadcast recipient lacks protected individualized context.");
          const recipientAuthority = await this.requireAuthority(recipientContext, recipient, "authority_broadcast");
          const providerEffect = this.providerEffect(recipientContext, recipient, recipientAuthority, "authority_recipient");
          packets.push(this.authorityPacket(recipientContext, recipient, recipientAuthority, providerEffect));
        }
        return this.prepared(context, authority, { kind: "authority", mode: "broadcast", packets, acknowledgementRequired: true });
      }
      case "bind_voice_session":
        throw new WorkflowArtifactError("Voice binding uses its dedicated protected consent coordinator.");
    }
  }

  private prepared(context: WorkflowCoordinatorContext, authority: AuthorityGrant, payload: WorkflowArtifactPayload): WorkflowPreparationResult {
    return {
      payload,
      authorityId: authority.id,
      coordinatorContextDigest: context.digest,
      coordinatorContextRevision: context.sourceRevision
    };
  }

  private async requireAuthority(context: WorkflowCoordinatorContext, session: ManagedSession, action: CommandAction): Promise<AuthorityGrant> {
    const authority = await this.requireAuthorityScope(context, session);
    if (!authority.allowedActions.includes(action) || authority.prohibitedActions.includes(action)) throw new WorkflowArtifactError("Protected authority does not allow this exact workflow action.");
    return authority;
  }

  private async requireAuthorityScope(context: WorkflowCoordinatorContext, session: ManagedSession): Promise<AuthorityGrant> {
    const authority = await this.authorities.get(context.authorityId);
    if (!authority || authority.revokedAt || Date.parse(authority.expiresAt) <= Date.now() || !sameRepositoryRoot(authority.repositoryRoot, context.repositoryRoot)
      || (authority.sessionId !== undefined && authority.sessionId !== session.id) || (authority.taskId !== undefined && authority.taskId !== session.taskId)
      || (authority.planRevision !== undefined && authority.planRevision !== session.planRevision)) throw new WorkflowArtifactError("Protected authority is missing, stale, revoked, or does not exactly match this workflow scope.");
    return authority;
  }

  private async requireRecipient(source: ManagedSession, recipientId: string): Promise<ManagedSession> {
    const recipient = await this.sessions.get(identifier(recipientId, "handoff recipient"));
    if (!recipient?.workspaceRoot || !recipient.capabilities.includes("registered") || recipient.status === "stale" || recipient.status === "unreachable"
      || recipient.targetSnapshotId !== source.targetSnapshotId || !sameRepositoryRoot(recipient.workspaceRoot, source.workspaceRoot!)) throw new WorkflowArtifactError("Handoff recipient is not a current registered session bound to the exact source target.");
    return recipient;
  }

  private providerEffect(context: WorkflowCoordinatorContext, session: ManagedSession, authority: AuthorityGrant, role: WorkflowProviderEffectRole): WorkflowProviderEffectBinding {
    const provenance = context.provenance;
    if (!provenance || (session.provider !== "claude" && session.provider !== "codex") || provenance.provider !== session.provider || provenance.adapterVersion !== session.adapterVersion) {
      throw new WorkflowArtifactError("Provider effect preparation requires current protected adapter provenance for the exact managed session.");
    }
    const normalizedSession = normalizeEffectSession({ ...session, metadata: {} }, session.provider);
    const normalizedAuthority = normalizeEffectAuthority(authority, normalizedSession);
    const material = {
      role, provider: session.provider, session: normalizedSession, authority: normalizedAuthority,
      adapterId: identifier(provenance.adapterId, "provider adapter id"), adapterVersion: identifier(provenance.adapterVersion, "provider adapter version"),
      moduleSha256: digest(provenance.moduleSha256, "provider adapter module"), providerContextDigest: digest(provenance.providerContextDigest, "provider context digest")
    };
    return normalizeProviderEffect({ ...material, bindingDigest: sha256(stableJson(material)) }, role);
  }

  private authorityPacket(context: WorkflowCoordinatorContext, session: ManagedSession, authority: AuthorityGrant, providerEffect?: WorkflowProviderEffectBinding): AuthorityReplayPacket {
    if (!context.pendingRequest || context.pendingRequest.targetSnapshotId !== session.targetSnapshotId || context.pendingRequest.planRevision !== session.planRevision || context.pendingRequest.planDigest !== context.evidence.plan.digest) throw new WorkflowArtifactError("Authority Refresh stopped because the protected pending request does not exactly match target, plan revision, and plan digest.");
    if (!authority.allowedActions.includes(context.pendingRequest.action) || authority.prohibitedActions.includes(context.pendingRequest.action)) throw new WorkflowArtifactError("Authority Refresh stopped because the existing protected grant cannot replay the exact pending action.");
    const material = { recipientSessionId: session.id, grantId: authority.id, actions: authority.allowedActions.map(commandAction), prohibitions: authority.prohibitedActions.map(commandAction), expiresAt: authority.expiresAt, pendingRequest: context.pendingRequest, ...(providerEffect ? { providerEffect } : {}) };
    return { ...material, matchDigest: sha256(stableJson(material)) };
  }
}

export function parseWorkflowProviderResponse(value: unknown, artifact: WorkflowArtifact): WorkflowProviderResponse {
  rejectLegacyReanchorWorkflow(artifact.action);
  if (!record(value)) throw new WorkflowArtifactError("The provider workflow result is not a record.");
  const optional = value.externalId === undefined ? [] : ["externalId"];
  if (!exact(value, ["schema", "version", "artifactId", "artifactDigest", "operationId", "action", "status", "effectDisposition", "summary", "result", ...optional])
    || value.schema !== "sxsy-b122.workflow-result" || value.version !== 1
    || value.artifactId !== artifact.id || value.artifactDigest !== artifact.digest || value.operationId !== artifact.operationId || value.action !== artifact.action) {
    throw new WorkflowArtifactError("The provider workflow result does not match its artifact ID, digest, operation, or action binding.");
  }
  if (!providerStatus(value.status) || !disposition(value.effectDisposition) || typeof value.summary !== "string" || !value.summary.trim() || value.summary.length > 1_024 || (value.externalId !== undefined && !bounded(value.externalId, 256))) {
    throw new WorkflowArtifactError("The provider workflow result has an invalid status, disposition, summary, or external ID.");
  }
  if (value.status === "completed" && value.effectDisposition !== "committed") throw new WorkflowArtifactError("A completed provider workflow requires an explicit committed effect disposition.");
  if (value.status === "completed" && !value.externalId) throw new WorkflowArtifactError("A completed provider workflow requires one stable external acknowledgement ID for no-replay recovery.");
  const result = normalizeProviderResult(value.result, artifact);
  return {
    schema: "sxsy-b122.workflow-result",
    version: 1,
    artifactId: artifact.id,
    artifactDigest: artifact.digest,
    operationId: artifact.operationId!,
    action: artifact.action,
    status: value.status,
    effectDisposition: value.effectDisposition,
    summary: redactText(value.summary.trim()),
    ...(value.externalId ? { externalId: value.externalId } : {}),
    result
  };
}

/** Strict closed parser for one independently named provider/recipient child effect. */
export function parseWorkflowChildProviderResponse(value: unknown, artifact: WorkflowArtifact, effect: WorkflowProviderEffectBinding, childOperationId: string, role: WorkflowProviderEffectRole): WorkflowChildProviderResponse {
  if (!record(value)) throw new WorkflowArtifactError("The provider workflow child result is not a record.");
  const optional = value.externalId === undefined ? [] : ["externalId"];
  if (!exact(value, ["schema", "version", "artifactId", "artifactDigest", "parentOperationId", "childOperationId", "action", "role", "bindingDigest", "provider", "adapterId", "moduleSha256", "status", "effectDisposition", "summary", "result", ...optional])
    || value.schema !== "sxsy-b122.workflow-child-result" || value.version !== 1
    || value.artifactId !== artifact.id || value.artifactDigest !== artifact.digest || value.parentOperationId !== artifact.operationId
    || value.childOperationId !== identifier(childOperationId, "workflow child operation") || value.action !== artifact.action
    || value.role !== role || value.role !== effect.role || value.bindingDigest !== effect.bindingDigest
    || value.provider !== effect.provider || value.adapterId !== effect.adapterId || value.moduleSha256 !== effect.moduleSha256) {
    throw new WorkflowArtifactError("The provider workflow child result changed its exact parent, child, provider, profile, or effect binding.");
  }
  const status = value.status;
  if (status !== "completed" && status !== "failed" && status !== "unavailable") throw new WorkflowArtifactError("The provider workflow child result is not terminal.");
  if (!disposition(value.effectDisposition) || !bounded(value.summary, 1_024) || (value.externalId !== undefined && !bounded(value.externalId, 256))) throw new WorkflowArtifactError("The provider workflow child result has invalid terminal metadata.");
  if (status === "completed" && (value.effectDisposition !== "committed" || !value.externalId)) throw new WorkflowArtifactError("A completed provider child effect requires a committed disposition and stable external acknowledgement.");
  if (status !== "completed" && value.effectDisposition === "committed") throw new WorkflowArtifactError("A non-completed provider child cannot claim an unqualified committed result.");
  const result = normalizeWorkflowChildResult(value.result, artifact, effect, role, status);
  return {
    schema: "sxsy-b122.workflow-child-result", version: 1, artifactId: artifact.id, artifactDigest: artifact.digest,
    parentOperationId: artifact.operationId!, childOperationId, action: artifact.action, role, bindingDigest: effect.bindingDigest,
    provider: effect.provider, adapterId: effect.adapterId, moduleSha256: effect.moduleSha256, status,
    effectDisposition: value.effectDisposition, summary: redactText((value.summary as string).trim()),
    ...(value.externalId ? { externalId: value.externalId as string } : {}), result
  };
}

/** Finds one immutable child effect; ambiguity and cross-role reuse fail closed. */
export function workflowProviderEffect(payload: WorkflowArtifactPayload, role: WorkflowProviderEffectRole, bindingDigest: string): WorkflowProviderEffectBinding {
  const matches = payload.kind === "proof" && role === "proof_backend"
    ? (payload.providerEffects ?? []).filter((effect) => effect.bindingDigest === bindingDigest)
    : payload.kind === "authority" && role === "authority_recipient"
      ? payload.packets.map((packet) => packet.providerEffect).filter((effect): effect is WorkflowProviderEffectBinding => effect?.bindingDigest === bindingDigest)
      : [];
  if (matches.length !== 1 || matches[0]!.role !== role) throw new WorkflowArtifactError("The workflow child binding is missing, ambiguous, or belongs to another role.");
  return matches[0]!;
}

function normalizeInput(input: WorkflowArtifactInput & { readonly id: string }): WorkflowArtifactImmutable {
  const action = workflowAction(input.action);
  const payload = normalizePayload(input.payload, action);
  if (payload.kind === "plan" && payload.mode === "approve") {
    if (payload.executorSessionId !== input.sessionId) throw new WorkflowArtifactError("Plan Approval must execute in the exact already-selected executor session while retaining the immutable plan origin.");
    if (!input.planRevision || payload.plan.revision !== input.planRevision || !input.taskId || payload.plan.taskId !== input.taskId) throw new WorkflowArtifactError("Plan Approval binding does not match the exact task and plan revision.");
    if (payload.plan.expectedTargetTransition.beforeTargetSnapshotId !== input.targetSnapshotId) throw new WorkflowArtifactError("Plan Approval expected transition is not bound to the exact reviewed before-TargetSnapshot.");
  }
  if (payload.kind === "handoff" && payload.sourceSessionId !== input.sessionId) throw new WorkflowArtifactError("Handoff source does not match the selected managed session.");
  const hasCoordinatorDigest = input.coordinatorContextDigest !== undefined;
  const hasCoordinatorRevision = input.coordinatorContextRevision !== undefined;
  if (hasCoordinatorDigest !== hasCoordinatorRevision) throw new WorkflowArtifactError("Workflow artifact coordinator context digest and revision must be supplied together.");
  if ((hasCoordinatorDigest || input.authorityId !== undefined) && !input.authorityId) throw new WorkflowArtifactError("A bound workflow artifact requires one exact protected authority.");
  return {
    id: text(input.id, "artifact id"), action,
    repositoryRoot: text(input.repositoryRoot, "repository root"),
    targetSnapshotId: digest(input.targetSnapshotId, "target snapshot id"),
    sessionId: text(input.sessionId, "session id"),
    ...(input.taskId ? { taskId: text(input.taskId, "task id") } : {}),
    ...(input.planRevision ? { planRevision: text(input.planRevision, "plan revision") } : {}),
    ...(input.authorityId ? { authorityId: identifier(input.authorityId, "artifact authority") } : {}),
    ...(hasCoordinatorDigest ? {
      coordinatorContextDigest: digest(input.coordinatorContextDigest, "artifact coordinator context digest"),
      coordinatorContextRevision: positiveRevision(input.coordinatorContextRevision, "artifact coordinator context revision")
    } : {}),
    payload
  };
}

function normalizePayload(payload: WorkflowArtifactPayload, action: WorkflowArtifactAction): WorkflowArtifactPayload {
  if (!payload || typeof payload !== "object" || expectedKind(action) !== payload.kind) throw new WorkflowArtifactError(`Workflow action ${action} requires a ${expectedKind(action)} payload.`);
  switch (payload.kind) {
    case "anchor": {
      if (payload.cooperativeStopRequested !== true || payload.resumeAuthorized !== false) throw new WorkflowArtifactError("Re-anchor must request a cooperative stop and must not authorize automatic resume.");
      return { kind: "anchor", evidence: normalizeEvidence(payload.evidence), cooperativeStopRequested: true, resumeAuthorized: false, unresolved: list(payload.unresolved, "unresolved item", true) };
    }
    case "proof": {
      const requiredBackends = list(payload.requiredBackends, "proof backend");
      if (action === "proof_adversarial" && (requiredBackends.length < 2 || payload.independentBackendRequired !== true)) throw new WorkflowArtifactError("Adversarial proof requires at least two explicitly named backends and an independent review boundary.");
      if (action === "proof" && payload.independentBackendRequired !== false) throw new WorkflowArtifactError("Normal Proof must not claim an independent backend requirement.");
      const providerEffects = payload.providerEffects?.map((effect) => normalizeProviderEffect(effect, "proof_backend"));
      if (providerEffects) {
        if (new Set(providerEffects.map((effect) => effect.bindingDigest)).size !== providerEffects.length || new Set(providerEffects.map((effect) => effect.provider)).size !== providerEffects.length) throw new WorkflowArtifactError("Proof provider effects must be unique exact provider bindings.");
        if (requiredBackends.length !== providerEffects.length || requiredBackends.some((backend) => !providerEffects.some((effect) => effect.provider === backend))) throw new WorkflowArtifactError("Proof provider effects must cover every exact required backend once.");
        if (providerEffects.length > 1 && (new Set(providerEffects.map((effect) => effect.adapterId)).size !== providerEffects.length || new Set(providerEffects.map((effect) => effect.moduleSha256)).size !== providerEffects.length)) throw new WorkflowArtifactError("Adversarial proof provider labels alias the same adapter boundary and are not independent.");
      }
      if (action === "proof_adversarial" && providerEffects !== undefined && providerEffects.length !== 2) throw new WorkflowArtifactError("Adversarial proof requires exactly two independent provider effects.");
      return { kind: "proof", evidence: normalizeEvidence(payload.evidence), claims: list(payload.claims, "proof claim"), requiredBackends, independentBackendRequired: payload.independentBackendRequired, ...(providerEffects ? { providerEffects } : {}) };
    }
    case "decision": {
      const mode = payload.mode === "one" || payload.mode === "packet" ? payload.mode : invalid("decision mode");
      if (payload.providerMayChoose !== false || !Array.isArray(payload.decisions) || payload.decisions.length < 1 || payload.decisions.length > 64) throw new WorkflowArtifactError("A decision request must remain non-authoritative and carry a bounded pending-decision set.");
      if ((action === "option_provider" && (mode !== "one" || payload.decisions.length !== 1)) || (action === "option_packet" && (mode !== "packet" || payload.decisions.length < 2))) throw new WorkflowArtifactError("Option Provider mode does not match the requested normal or multi-decision packet action.");
      const decisions = payload.decisions.map((decision) => ({ id: identifier(decision.id, "decision id"), question: text(decision.question, "decision question"), context: text(decision.context, "decision context") }));
      if (new Set(decisions.map((decision) => decision.id)).size !== decisions.length) throw new WorkflowArtifactError("Pending decision IDs must be unique.");
      return { kind: "decision", mode, decisions, evidence: normalizeEvidence(payload.evidence), providerMayChoose: false };
    }
    case "plan": {
      const plan = normalizePlan(payload.plan);
      if (action === "plan_expander") {
        if (payload.mode !== "expand") throw new WorkflowArtifactError("Plan Expander requires an immutable existing-plan expansion request.");
        return { kind: "plan", mode: "expand", plan, evidence: normalizeEvidence(payload.evidence) };
      }
      if (payload.mode !== "approve" || payload.executeOnce !== true || !exact(payload as unknown as Record<string, unknown>, ["kind", "mode", "plan", "executorSessionId", "authorityId", "confirmationDigest", "confirmationScopeDigest", "providerContextDigest", "executeOnce"])) throw new WorkflowArtifactError("Plan Approval requires one exact immutable existing plan and once-only execution intent.");
      if (!plan.steps.some((step) => step.status === "approved") || plan.steps.some((step) => step.status !== "approved" && step.status !== "completed")) throw new WorkflowArtifactError("Plan Approval requires existing approved plan steps and refuses proposed or blocked work.");
      const executorSessionId = identifier(payload.executorSessionId, "plan executor session");
      return { kind: "plan", mode: "approve", plan, executorSessionId, authorityId: identifier(payload.authorityId, "plan authority"), confirmationDigest: digest(payload.confirmationDigest, "plan confirmation digest"), confirmationScopeDigest: digest(payload.confirmationScopeDigest, "plan confirmation scope digest"), providerContextDigest: digest(payload.providerContextDigest, "plan provider context digest"), executeOnce: true };
    }
    case "handoff": {
      const route = payload.route === "queue" || payload.route === "immediate" ? payload.route : invalid("handoff route");
      if (action === "handoff_queue" && route !== "queue") throw new WorkflowArtifactError("Queued Handoff requires the queue route.");
      if (action === "handoff_immediate" && route !== "immediate") throw new WorkflowArtifactError("Immediate Handoff requires immediate recipient focus.");
      return { kind: "handoff", packageId: identifier(payload.packageId, "handoff package id"), route, sourceSessionId: identifier(payload.sourceSessionId, "handoff source"), recipientSessionId: identifier(payload.recipientSessionId, "handoff recipient"), authorityId: identifier(payload.authorityId, "handoff authority") };
    }
    case "focus": {
      const expectedStatus = payload.expectedStatus === "verified_blocked" || payload.expectedStatus === "verified_finished" ? payload.expectedStatus : invalid("focus status");
      if ((action === "focus_blocked_agent" && expectedStatus !== "verified_blocked") || (action === "focus_finished_agent" && expectedStatus !== "verified_finished")) throw new WorkflowArtifactError("Focus artifact status does not match its command action.");
      if (!Number.isSafeInteger(payload.cycleIndex) || !Number.isSafeInteger(payload.cycleSize) || payload.cycleIndex < 0 || payload.cycleSize < 1 || payload.cycleIndex >= payload.cycleSize) throw new WorkflowArtifactError("Focus queue cycle position is invalid.");
      return { kind: "focus", selectedSessionId: identifier(payload.selectedSessionId, "selected session"), expectedStatus, queueCycleId: identifier(payload.queueCycleId, "focus queue cycle"), cycleIndex: payload.cycleIndex, cycleSize: payload.cycleSize, reason: text(payload.reason, "focus reason") };
    }
    case "authority": {
      const mode = payload.mode === "refresh" || payload.mode === "broadcast" ? payload.mode : invalid("authority replay mode");
      if (payload.acknowledgementRequired !== true || !Array.isArray(payload.packets) || payload.packets.length < 1 || payload.packets.length > 64) throw new WorkflowArtifactError("Authority replay requires bounded individualized packets and acknowledgement.");
      if ((action === "authority_refresh" && (mode !== "refresh" || payload.packets.length !== 1)) || (action === "authority_broadcast" && (mode !== "broadcast" || payload.packets.length < 1))) throw new WorkflowArtifactError("Authority replay mode does not match its command action.");
      const packets = payload.packets.map(normalizeAuthorityPacket);
      if (new Set(packets.map((packet) => packet.recipientSessionId)).size !== packets.length) throw new WorkflowArtifactError("Authority replay recipients must be unique.");
      if (mode === "broadcast" && packets.some((packet) => !packet.providerEffect)) throw new WorkflowArtifactError("Authority broadcast requires one exact provider effect for every recipient.");
      return { kind: "authority", mode, packets, acknowledgementRequired: true };
    }
    case "voice_binding": return { kind: "voice_binding", voiceSessionId: text(payload.voiceSessionId, "voice session id"), provider: voiceProvider(payload.provider), contextPackageId: text(payload.contextPackageId, "voice context package id"), consentId: text(payload.consentId, "voice consent id") };
  }
}

function normalizeProviderResult(value: unknown, artifact: WorkflowArtifact): WorkflowProviderResult {
  const expected = artifact.payload.kind;
  if (!record(value) || value.kind !== expected) throw new WorkflowArtifactError("The provider workflow result does not match the artifact result schema.");
  switch (expected) {
    case "proof": {
      if (!exact(value, ["kind", "verifiedClaims", "evidenceReferences", "backendResults"]) || !Array.isArray(value.verifiedClaims) || !Array.isArray(value.evidenceReferences) || !Array.isArray(value.backendResults)) throw new WorkflowArtifactError("The provider proof result is invalid.");
      const backendResults = value.backendResults.map((item) => {
        if (!record(item) || !exact(item, ["backend", "status"]) || !bounded(item.backend, 128) || !["passed", "failed", "unavailable"].includes(String(item.status))) throw new WorkflowArtifactError("The provider proof backend result is invalid.");
        return { backend: item.backend, status: item.status as "passed" | "failed" | "unavailable" };
      });
      const required = artifact.payload.kind === "proof" ? artifact.payload.requiredBackends : [];
      if (new Set(backendResults.map((result) => result.backend)).size !== backendResults.length
        || required.length !== backendResults.length || required.some((backend) => !backendResults.some((result) => result.backend === backend))) throw new WorkflowArtifactError("Provider proof did not report every exact required backend once.");
      return { kind: "proof", verifiedClaims: list(value.verifiedClaims as string[], "verified claim", true), evidenceReferences: list(value.evidenceReferences as string[], "verified evidence", true), backendResults };
    }
    case "anchor": {
      if (!exact(value, ["kind", "anchorDigest", "discrepancies", "questions", "resumed"]) || !digestLike(value.anchorDigest) || value.resumed !== false || !Array.isArray(value.discrepancies) || !Array.isArray(value.questions)) break;
      return { kind: "anchor", anchorDigest: value.anchorDigest, discrepancies: list(value.discrepancies, "re-anchor discrepancy", true), questions: list(value.questions, "re-anchor question", true), resumed: false };
    }
    case "decision": {
      if (!exact(value, ["kind", "decisionPacketId", "decisions", "userSelectionRequired"]) || !bounded(value.decisionPacketId, 256) || value.userSelectionRequired !== true || !Array.isArray(value.decisions)) break;
      const expectedDecisions = artifact.payload.kind === "decision" ? artifact.payload.decisions : [];
      if (value.decisions.length !== expectedDecisions.length) throw new WorkflowArtifactError("The provider decision result does not cover the exact pending decision set.");
      const decisions = value.decisions.map((entry, index) => normalizeDecisionPacket(entry, expectedDecisions[index]!.id, artifact.action === "option_provider"));
      return { kind: "decision", decisionPacketId: value.decisionPacketId, decisions, userSelectionRequired: true };
    }
    case "plan": {
      if (artifact.payload.kind !== "plan") break;
      if (artifact.payload.mode === "expand") {
        if (!exact(value, ["kind", "mode", "planDigest", "alternatives"]) || value.mode !== "expanded" || value.planDigest !== artifact.payload.plan.digest || !Array.isArray(value.alternatives) || value.alternatives.length !== 15) break;
        const alternatives = value.alternatives.map(normalizeAlternative);
        if (new Set(alternatives.map((alternative) => alternative.id)).size !== 15 || alternatives.some((alternative, index) => alternative.rank !== index + 1)) throw new WorkflowArtifactError("Plan Expander must return exactly fifteen uniquely ranked alternatives.");
        return { kind: "plan", mode: "expanded", planDigest: value.planDigest, alternatives };
      }
      if (!exact(value, ["kind", "mode", "planDigest", "planRevision", "originSessionId", "executorSessionId", "authorityId", "acknowledgementId", "executionStarted", "targetTransition", "childEffects"])
        || value.mode !== "execution_ack" || value.executionStarted !== true || !bounded(value.acknowledgementId, 256)
        || value.planDigest !== artifact.payload.plan.digest || value.planRevision !== artifact.payload.plan.revision
        || value.originSessionId !== artifact.payload.plan.originSessionId || value.executorSessionId !== artifact.payload.executorSessionId
        || value.authorityId !== artifact.payload.authorityId || !record(value.targetTransition) || !Array.isArray(value.childEffects)) break;
      const targetTransition = normalizePlanTargetTransition(value.targetTransition, artifact.targetSnapshotId);
      if (stableJson(targetTransition) !== stableJson(artifact.payload.plan.expectedTargetTransition)) {
        throw new WorkflowArtifactError("Plan Approval provider acknowledgement changed the exact transition reviewed before execution.");
      }
      const childEffects = value.childEffects.map(normalizePlanChildEffect);
      if (childEffects.length < 1 || childEffects.length > 64 || new Set(childEffects.map((effect) => effect.id)).size !== childEffects.length) {
        throw new WorkflowArtifactError("Plan Approval must report one to 64 unique durable provider child effects.");
      }
      return { kind: "plan", mode: "execution_ack", planDigest: value.planDigest, planRevision: value.planRevision as string, originSessionId: value.originSessionId as string, executorSessionId: value.executorSessionId as string, authorityId: value.authorityId as string, acknowledgementId: value.acknowledgementId, executionStarted: true, targetTransition, childEffects };
    }
    case "handoff": {
      if (artifact.payload.kind !== "handoff" || !exact(value, ["kind", "packageId", "recipientSessionId", "acknowledged"]) || value.packageId !== artifact.payload.packageId || value.recipientSessionId !== artifact.payload.recipientSessionId || typeof value.acknowledged !== "boolean") break;
      const expectedAcknowledged = artifact.payload.route === "immediate";
      if (value.acknowledged !== expectedAcknowledged) {
        throw new WorkflowArtifactError(expectedAcknowledged
          ? "An immediate Handoff provider result must acknowledge the exact recipient."
          : "A queued Handoff provider result cannot claim recipient acknowledgement or focus.");
      }
      return { kind: "handoff", packageId: value.packageId, recipientSessionId: value.recipientSessionId, acknowledged: value.acknowledged };
    }
    case "focus": {
      if (artifact.payload.kind !== "focus" || !exact(value, ["kind", "selectedSessionId", "status", "queueCycleId", "resultDelivered"]) || value.selectedSessionId !== artifact.payload.selectedSessionId || value.status !== artifact.payload.expectedStatus || value.queueCycleId !== artifact.payload.queueCycleId || value.resultDelivered !== true) break;
      return { kind: "focus", selectedSessionId: value.selectedSessionId as string, status: value.status as Extract<SessionStatus, "verified_blocked" | "verified_finished">, queueCycleId: value.queueCycleId as string, resultDelivered: value.resultDelivered };
    }
    case "authority": {
      if (artifact.payload.kind !== "authority" || !exact(value, ["kind", "acknowledgements"]) || !Array.isArray(value.acknowledgements) || value.acknowledgements.length !== artifact.payload.packets.length) break;
      const packets = new Map(artifact.payload.packets.map((packet) => [packet.recipientSessionId, packet]));
      const acknowledgements = value.acknowledgements.map((entry) => {
        if (!record(entry) || !exact(entry, ["recipientSessionId", "grantId", "matchDigest", "acknowledged"]) || entry.acknowledged !== true || !bounded(entry.recipientSessionId, 256)) throw new WorkflowArtifactError("Authority acknowledgement is malformed.");
        const packet = packets.get(entry.recipientSessionId);
        if (!packet || entry.grantId !== packet.grantId || entry.matchDigest !== packet.matchDigest) throw new WorkflowArtifactError("Authority acknowledgement changed its individualized exact binding.");
        return { recipientSessionId: entry.recipientSessionId, grantId: entry.grantId as string, matchDigest: entry.matchDigest as string, acknowledged: true as const };
      });
      if (new Set(acknowledgements.map((entry) => entry.recipientSessionId)).size !== acknowledgements.length) throw new WorkflowArtifactError("Authority acknowledgements must cover every recipient exactly once.");
      return { kind: "authority", acknowledgements };
    }
    case "voice_binding": if (exact(value, ["kind", "bindingId", "active"]) && bounded(value.bindingId, 256) && typeof value.active === "boolean") return { kind: "voice_binding", bindingId: value.bindingId, active: value.active }; break;
  }
  throw new WorkflowArtifactError("The provider workflow result is invalid for its action.");
}

function normalizePlanTargetTransition(value: Record<string, unknown>, beforeTargetSnapshotId: string): PlanExecutionTargetTransition {
  if (!exact(value, ["beforeTargetSnapshotId", "expectedAfterTargetSnapshotId", "expectation"])
    || value.beforeTargetSnapshotId !== beforeTargetSnapshotId || !digestLike(value.expectedAfterTargetSnapshotId)
    || (value.expectation !== "unchanged" && value.expectation !== "changed")) {
    throw new WorkflowArtifactError("Plan Approval returned an invalid expected TargetSnapshot transition.");
  }
  if ((value.expectation === "unchanged") !== (value.expectedAfterTargetSnapshotId === beforeTargetSnapshotId)) {
    throw new WorkflowArtifactError("Plan Approval target-transition expectation conflicts with its before/after identities.");
  }
  return {
    beforeTargetSnapshotId,
    expectedAfterTargetSnapshotId: value.expectedAfterTargetSnapshotId,
    expectation: value.expectation
  };
}

function normalizePlanChildEffect(value: unknown): PlanExecutionChildEffect {
  if (!record(value) || !allowedExact(value, ["id", "action", "status", "effectDisposition", "summary"], ["externalId"])
    || value.action !== "plan_execution" || (value.status !== "running" && value.status !== "completed" && value.status !== "failed")
    || !disposition(value.effectDisposition) || !bounded(value.summary, 1_024)) {
    throw new WorkflowArtifactError("Plan Approval returned a malformed provider child effect.");
  }
  const id = identifier(value.id, "plan execution child effect id");
  const externalId = value.externalId === undefined ? undefined : bounded(value.externalId, 256) ? value.externalId : invalid("plan execution child external id");
  if ((value.status === "running" || value.status === "completed") && value.effectDisposition !== "committed") {
    throw new WorkflowArtifactError("A running or completed plan child effect must be durably committed.");
  }
  if ((value.effectDisposition === "committed" || value.effectDisposition === "ambiguous") && !externalId) {
    throw new WorkflowArtifactError("A committed or ambiguous plan child effect requires one exact provider observation identity.");
  }
  return {
    id,
    action: "plan_execution",
    status: value.status,
    effectDisposition: value.effectDisposition,
    summary: redactText(value.summary.trim()),
    ...(externalId ? { externalId } : {})
  };
}

function normalizeWorkflowChildResult(value: unknown, artifact: WorkflowArtifact, effect: WorkflowProviderEffectBinding, role: WorkflowProviderEffectRole, status: WorkflowChildProviderResponse["status"]): WorkflowChildProviderResult {
  if (!record(value) || value.kind !== role) throw new WorkflowArtifactError("The provider workflow child result has the wrong role schema.");
  if (role === "proof_backend") {
    if (!exact(value, ["kind", "backend", "status", "verifiedClaims", "evidenceReferences"]) || value.backend !== effect.provider
      || !Array.isArray(value.verifiedClaims) || !Array.isArray(value.evidenceReferences)
      || (value.status !== "passed" && value.status !== "failed" && value.status !== "unavailable")) throw new WorkflowArtifactError("The independent proof child result is invalid.");
    if ((status === "completed") !== (value.status === "passed")) throw new WorkflowArtifactError("The proof child terminal status conflicts with its backend result.");
    return { kind: "proof_backend", backend: effect.provider, status: value.status, verifiedClaims: list(value.verifiedClaims, "verified claim", true), evidenceReferences: list(value.evidenceReferences, "verified evidence", true) };
  }
  if (artifact.payload.kind !== "authority" || !exact(value, ["kind", "recipientSessionId", "grantId", "matchDigest", "acknowledged"]) || value.acknowledged !== true || status !== "completed") throw new WorkflowArtifactError("The authority recipient child acknowledgement is invalid.");
  const packet = artifact.payload.packets.find((candidate) => candidate.providerEffect?.bindingDigest === effect.bindingDigest);
  if (!packet || value.recipientSessionId !== packet.recipientSessionId || value.grantId !== packet.grantId || value.matchDigest !== packet.matchDigest) throw new WorkflowArtifactError("The authority recipient acknowledgement changed its exact packet binding.");
  return { kind: "authority_recipient", recipientSessionId: packet.recipientSessionId, grantId: packet.grantId, matchDigest: packet.matchDigest, acknowledged: true };
}

function normalizeEvidence(value: CoordinatorEvidenceBundle): CoordinatorEvidenceBundle {
  if (!record(value)) throw new WorkflowArtifactError("Coordinator evidence is missing.");
  const plan = normalizePlan(value.plan);
  if (!Array.isArray(value.instructions) || value.instructions.length < 1 || value.instructions.length > 64
    || !Array.isArray(value.documentation) || value.documentation.length < 1 || value.documentation.length > 256
    || !Array.isArray(value.files) || value.files.length < 1 || value.files.length > 512
    || !Array.isArray(value.tests) || value.tests.length < 1 || value.tests.length > 256) throw new WorkflowArtifactError("Coordinator evidence lists are incomplete or unbounded.");
  const instructions = value.instructions.map(normalizeEvidenceReference);
  const documentation = value.documentation.map(normalizeEvidenceReference);
  const files = value.files.map(normalizeEvidenceReference);
  const tests = value.tests.map((item: unknown) => {
    if (!record(item) || !["passed", "failed", "unavailable", "incomplete", "assumed", "not_run"].includes(String(item.status))) throw new WorkflowArtifactError("Test evidence status is invalid.");
    const evidence = normalizeEvidenceReference(item as unknown as WorkflowEvidenceReference);
    return { ...evidence, status: item.status as WorkflowTestEvidence["status"] };
  });
  const diff = normalizeEvidenceReference(value.diff);
  const normalized = { contextDigest: digest(value.contextDigest, "coordinator context digest"), instructions, plan, documentation, diff, files, tests };
  const materialDigest = sha256(stableJson({ instructions, plan, documentation, diff, files, tests }));
  if (normalized.contextDigest !== materialDigest) throw new WorkflowArtifactError("Coordinator evidence digest does not match its exact assembled material.");
  return normalized;
}

/** Closed canonicalizer for host-owned context evidence reused by dedicated lifecycles. */
export function canonicalCoordinatorEvidence(value: CoordinatorEvidenceBundle): CoordinatorEvidenceBundle {
  return normalizeEvidence(value);
}

function normalizeEvidenceReference(value: WorkflowEvidenceReference): WorkflowEvidenceReference {
  if (!record(value) || !["protected_context", "repository", "target_snapshot", "receipt"].includes(String(value.source))) throw new WorkflowArtifactError("Workflow evidence reference is invalid.");
  return { id: identifier(value.id, "evidence id"), digest: digest(value.digest, "evidence digest"), source: value.source as WorkflowEvidenceReference["source"], summary: text(value.summary, "evidence summary") };
}

function normalizePlan(value: ExistingPlanBinding): ExistingPlanBinding {
  if (!record(value) || !exact(value, ["digest", "revision", "originSessionId", "taskId", "objective", "steps", "decisions", "expectedTargetTransition"]) || !Array.isArray(value.steps) || value.steps.length < 1 || value.steps.length > 256 || !Array.isArray(value.decisions) || !record(value.expectedTargetTransition)) throw new WorkflowArtifactError("An exact immutable existing plan is required.");
  const steps = value.steps.map((step: unknown) => {
    if (!record(step) || !exact(step, ["id", "summary", "ownedFiles", "dependencies", "status"]) || !Array.isArray(step.ownedFiles) || !Array.isArray(step.dependencies)) throw new WorkflowArtifactError("Plan step is invalid.");
    return { id: identifier(step.id, "plan step id"), summary: text(step.summary, "plan step summary"), ownedFiles: step.ownedFiles.map(safeOwnedFile), dependencies: step.dependencies.map((item: unknown) => identifier(item, "plan dependency")), status: planStepStatus(step.status) };
  });
  if (new Set(steps.map((step) => step.id)).size !== steps.length) throw new WorkflowArtifactError("Plan step IDs must be unique.");
  const known = new Set(steps.map((step) => step.id));
  if (steps.some((step) => step.dependencies.some((dependency) => dependency === step.id || !known.has(dependency)))) throw new WorkflowArtifactError("Plan dependencies must reference distinct known steps.");
  const normalized = {
    digest: digest(value.digest, "plan digest"),
    revision: identifier(value.revision, "plan revision"),
    originSessionId: identifier(value.originSessionId, "plan origin session"),
    taskId: identifier(value.taskId, "plan task"),
    objective: text(value.objective, "plan objective"),
    steps,
    decisions: list(value.decisions, "plan decision", true),
    expectedTargetTransition: normalizeReviewedPlanTargetTransition(value.expectedTargetTransition)
  };
  const materialDigest = sha256(stableJson({ revision: normalized.revision, originSessionId: normalized.originSessionId, taskId: normalized.taskId, objective: normalized.objective, steps: normalized.steps, decisions: normalized.decisions, expectedTargetTransition: normalized.expectedTargetTransition }));
  if (normalized.digest !== materialDigest) throw new WorkflowArtifactError("Plan digest does not match the exact immutable plan material.");
  return normalized;
}

function normalizeReviewedPlanTargetTransition(value: Record<string, unknown>): PlanExecutionTargetTransition {
  if (!exact(value, ["beforeTargetSnapshotId", "expectedAfterTargetSnapshotId", "expectation"])
    || !digestLike(value.beforeTargetSnapshotId) || !digestLike(value.expectedAfterTargetSnapshotId)
    || (value.expectation !== "unchanged" && value.expectation !== "changed")
    || ((value.expectation === "unchanged") !== (value.expectedAfterTargetSnapshotId === value.beforeTargetSnapshotId))) {
    throw new WorkflowArtifactError("The existing plan lacks one internally consistent exact expected TargetSnapshot transition.");
  }
  return {
    beforeTargetSnapshotId: value.beforeTargetSnapshotId,
    expectedAfterTargetSnapshotId: value.expectedAfterTargetSnapshotId,
    expectation: value.expectation
  };
}

function normalizeProviderEffect(value: WorkflowProviderEffectBinding, role: WorkflowProviderEffectRole): WorkflowProviderEffectBinding {
  if (!record(value) || value.role !== role || !record(value.session) || !record(value.authority)) throw new WorkflowArtifactError("The workflow provider effect binding is invalid.");
  const provider = value.provider === "claude" || value.provider === "codex" ? value.provider : invalid("workflow effect provider");
  const session = normalizeEffectSession(value.session, provider);
  const authority = normalizeEffectAuthority(value.authority, session);
  const material = {
    role,
    provider,
    session,
    authority,
    adapterId: identifier(value.adapterId, "provider adapter id"),
    adapterVersion: identifier(value.adapterVersion, "provider adapter version"),
    moduleSha256: digest(value.moduleSha256, "provider adapter module"),
    providerContextDigest: digest(value.providerContextDigest, "provider context digest")
  };
  const bindingDigest = digest(value.bindingDigest, "provider effect binding");
  if (bindingDigest !== sha256(stableJson(material))) throw new WorkflowArtifactError("The workflow provider effect digest does not match its exact session, authority, and adapter profile.");
  return { ...material, bindingDigest };
}

function normalizeEffectSession(value: ManagedSession, provider: "claude" | "codex"): ManagedSession {
  if (value.provider !== provider || !value.workspaceRoot || !value.targetSnapshotId || !value.taskId || !value.planRevision || !Array.isArray(value.capabilities) || !Array.isArray(value.plannedFiles)) throw new WorkflowArtifactError("The provider effect session lacks an exact task, target, and provider binding.");
  const capabilities = [...new Set(value.capabilities.map(workflowCapability))];
  if (!capabilities.includes("registered") || !capabilities.includes("observable") || value.status === "stale" || value.status === "unreachable") throw new WorkflowArtifactError("The provider effect session is not current and observable.");
  const status = managedSessionStatus(value.status);
  const surface = managedSessionSurface(value.surface);
  return {
    id: identifier(value.id, "provider effect session"), provider, surface, capabilities, status,
    workspaceRoot: text(value.workspaceRoot, "provider effect repository"), targetSnapshotId: digest(value.targetSnapshotId, "provider effect target"),
    taskId: identifier(value.taskId, "provider effect task"), planRevision: identifier(value.planRevision, "provider effect plan"),
    plannedFiles: value.plannedFiles.map(safeOwnedFile), lastHeartbeat: timestamp(value.lastHeartbeat, "provider effect heartbeat"),
    adapterVersion: identifier(value.adapterVersion, "provider effect adapter version"), metadata: {}
  };
}

function normalizeEffectAuthority(value: AuthorityGrant, session: ManagedSession): AuthorityGrant {
  if (!Array.isArray(value.allowedActions) || !Array.isArray(value.prohibitedActions)) throw new WorkflowArtifactError("The provider effect authority action scope is invalid.");
  const authority: AuthorityGrant = {
    id: identifier(value.id, "provider effect authority"), repositoryRoot: text(value.repositoryRoot, "provider effect authority repository"),
    ...(value.sessionId ? { sessionId: identifier(value.sessionId, "provider effect authority session") } : {}),
    ...(value.taskId ? { taskId: identifier(value.taskId, "provider effect authority task") } : {}),
    ...(value.planRevision ? { planRevision: identifier(value.planRevision, "provider effect authority plan") } : {}),
    allowedActions: [...new Set(value.allowedActions.map(commandAction))], prohibitedActions: [...new Set(value.prohibitedActions.map(commandAction))],
    expiresAt: timestamp(value.expiresAt, "provider effect authority expiry"), ...(value.revokedAt ? { revokedAt: timestamp(value.revokedAt, "provider effect authority revocation") } : {}),
    issuedAt: timestamp(value.issuedAt, "provider effect authority issue"), issuedBy: text(value.issuedBy, "provider effect authority issuer")
  };
  if (!sameRepositoryRoot(authority.repositoryRoot, session.workspaceRoot!) || (authority.sessionId && authority.sessionId !== session.id)
    || (authority.taskId && authority.taskId !== session.taskId) || (authority.planRevision && authority.planRevision !== session.planRevision) || authority.revokedAt) {
    throw new WorkflowArtifactError("The provider effect authority does not exactly match its session scope.");
  }
  return authority;
}

function normalizeAuthorityPacket(value: AuthorityReplayPacket): AuthorityReplayPacket {
  if (!record(value) || !record(value.pendingRequest)) throw new WorkflowArtifactError("Authority replay packet is invalid.");
  const pendingRequest = {
    requestId: identifier(value.pendingRequest.requestId, "pending request"),
    targetSnapshotId: digest(value.pendingRequest.targetSnapshotId, "pending request target"),
    planRevision: identifier(value.pendingRequest.planRevision, "pending request plan revision"),
    planDigest: digest(value.pendingRequest.planDigest, "pending request plan digest"),
    action: commandAction(value.pendingRequest.action)
  };
  const providerEffect = value.providerEffect ? normalizeProviderEffect(value.providerEffect, "authority_recipient") : undefined;
  const packet = {
    recipientSessionId: identifier(value.recipientSessionId, "authority recipient"),
    grantId: identifier(value.grantId, "authority grant"),
    actions: [...new Set(value.actions.map(commandAction))],
    prohibitions: [...new Set(value.prohibitions.map(commandAction))],
    expiresAt: timestamp(value.expiresAt, "authority expiry"),
    pendingRequest,
    matchDigest: digest(value.matchDigest, "authority match digest"),
    ...(providerEffect ? { providerEffect } : {})
  };
  const expected = sha256(stableJson({ recipientSessionId: packet.recipientSessionId, grantId: packet.grantId, actions: packet.actions, prohibitions: packet.prohibitions, expiresAt: packet.expiresAt, pendingRequest, ...(providerEffect ? { providerEffect } : {}) }));
  if (packet.matchDigest !== expected) throw new WorkflowArtifactError("Authority replay packet does not match its protected pending request and grant scope.");
  if (!packet.actions.includes(pendingRequest.action) || packet.prohibitions.includes(pendingRequest.action)) throw new WorkflowArtifactError("Pending request action is not exactly authorized by the replay packet.");
  if (providerEffect && (providerEffect.session.id !== packet.recipientSessionId || providerEffect.authority.id !== packet.grantId)) throw new WorkflowArtifactError("Authority broadcast provider effect changed its recipient or grant binding.");
  return packet;
}

function normalizeDecisionPacket(value: unknown, expectedDecisionId: string, exactlyFive: boolean): DecisionProviderPacket {
  if (!record(value) || !exact(value, ["decisionId", "options", "recommendationId"]) || value.decisionId !== expectedDecisionId || !Array.isArray(value.options)) throw new WorkflowArtifactError("Provider decision packet changed its pending decision binding.");
  if ((exactlyFive && value.options.length !== 5) || (!exactlyFive && (value.options.length < 2 || value.options.length > 15))) throw new WorkflowArtifactError(exactlyFive ? "Normal Option Provider must return exactly five options." : "A multi-decision packet must return a bounded option set for every pending decision.");
  const options = value.options.map((option) => {
    if (!record(option) || !exact(option, ["id", "label", "tradeoffs", "risks"]) || !Array.isArray(option.tradeoffs) || !Array.isArray(option.risks)) throw new WorkflowArtifactError("Provider decision option is invalid.");
    return { id: identifier(option.id, "option id"), label: text(option.label, "option label"), tradeoffs: list(option.tradeoffs, "option tradeoff"), risks: list(option.risks, "option risk") };
  });
  if (new Set(options.map((option) => option.id)).size !== options.length || typeof value.recommendationId !== "string" || !options.some((option) => option.id === value.recommendationId)) throw new WorkflowArtifactError("Provider recommendation must reference one unique returned option.");
  return { decisionId: expectedDecisionId, options, recommendationId: value.recommendationId };
}

function normalizeAlternative(value: unknown): RankedPlanAlternative {
  if (!record(value) || !exact(value, ["rank", "id", "summary", "rationale", "risks"]) || !Number.isSafeInteger(value.rank) || !Array.isArray(value.risks)) throw new WorkflowArtifactError("Ranked plan alternative is invalid.");
  return { rank: value.rank as number, id: identifier(value.id, "plan alternative id"), summary: text(value.summary, "plan alternative summary"), rationale: text(value.rationale, "plan alternative rationale"), risks: list(value.risks, "plan alternative risk", true) };
}

function normalizeCoordinatorContextInput(input: WorkflowCoordinatorContextInput): WorkflowCoordinatorContextInput {
  const evidence = normalizeEvidence(input.evidence);
  const pendingDecisions = input.pendingDecisions.map((decision) => ({ id: identifier(decision.id, "pending decision"), question: text(decision.question, "pending decision question"), context: text(decision.context, "pending decision context") }));
  if (pendingDecisions.length > 64 || new Set(pendingDecisions.map((decision) => decision.id)).size !== pendingDecisions.length) throw new WorkflowArtifactError("Protected pending decisions are unbounded or duplicate.");
  const pendingRequest = input.pendingRequest ? {
    requestId: identifier(input.pendingRequest.requestId, "pending request"),
    targetSnapshotId: digest(input.pendingRequest.targetSnapshotId, "pending request target"),
    planRevision: identifier(input.pendingRequest.planRevision, "pending request plan revision"),
    planDigest: digest(input.pendingRequest.planDigest, "pending request plan digest"),
    action: commandAction(input.pendingRequest.action)
  } : undefined;
  const provenance = input.provenance ? normalizeCoordinatorProvenance(input.provenance) : undefined;
  const normalized = {
    sessionId: identifier(input.sessionId, "workflow context session"),
    repositoryRoot: text(input.repositoryRoot, "workflow context repository"),
    targetSnapshotId: digest(input.targetSnapshotId, "workflow context target"),
    authorityId: identifier(input.authorityId, "workflow context authority"),
    sourceRevision: positiveRevision(input.sourceRevision, "workflow context source revision"),
    ...(provenance ? { provenance } : {}),
    evidence,
    pendingDecisions,
    ...(pendingRequest ? { pendingRequest } : {})
  };
  if (pendingRequest && (pendingRequest.targetSnapshotId !== normalized.targetSnapshotId || pendingRequest.planRevision !== evidence.plan.revision || pendingRequest.planDigest !== evidence.plan.digest)) throw new WorkflowArtifactError("Workflow context pending request is not exactly bound to its plan and target.");
  return normalized;
}

function normalizeCoordinatorProvenance(value: WorkflowCoordinatorProvenance): WorkflowCoordinatorProvenance {
  if (!record(value) || !exact(value, ["provider", "contextId", "observedAt", "adapterId", "adapterVersion", "moduleSha256", "providerContextDigest", "envelopeDigest"])
    || (value.provider !== "claude" && value.provider !== "codex")) throw new WorkflowArtifactError("Workflow coordinator provenance is invalid.");
  return {
    provider: value.provider,
    contextId: shortText(value.contextId, "workflow provider context", 256),
    observedAt: timestamp(value.observedAt, "workflow provider observation time"),
    adapterId: identifier(value.adapterId, "workflow provider adapter"),
    adapterVersion: shortText(value.adapterVersion, "workflow provider adapter version", 256),
    moduleSha256: digest(value.moduleSha256, "workflow provider module digest"),
    providerContextDigest: digest(value.providerContextDigest, "workflow provider context digest"),
    envelopeDigest: digest(value.envelopeDigest, "workflow provider envelope digest")
  };
}

function contextMap(entries: readonly JournalEntry<unknown>[]): Map<string, WorkflowCoordinatorContext> {
  const contexts = new Map<string, WorkflowCoordinatorContext>();
  for (const entry of entries) {
    if (entry.kind !== "workflow-context.saved") continue;
    const raw = (entry.payload as WorkflowContextSavedEvent | undefined)?.context;
    if (!raw) throw new WorkflowArtifactError("Protected workflow context is malformed.");
    const legacy = (raw as WorkflowCoordinatorContext & { readonly sourceRevision?: number }).sourceRevision === undefined;
    const normalized = normalizeCoordinatorContextInput({ ...raw, sourceRevision: raw.sourceRevision ?? 1 });
    const digestMaterial = legacy ? Object.fromEntries(Object.entries(normalized).filter(([key]) => key !== "sourceRevision")) : normalized;
    if (sha256(stableJson(digestMaterial)) !== raw.digest) throw new WorkflowArtifactError("Protected workflow context digest is invalid.");
    timestamp(raw.capturedAt, "workflow context capture time");
    contexts.set(raw.sessionId, cloneContext({ ...raw, ...normalized }));
  }
  return contexts;
}

function cycleMap(entries: readonly JournalEntry<unknown>[]): Map<string, WorkflowCycleSavedEvent> {
  const cycles = new Map<string, WorkflowCycleSavedEvent>();
  for (const entry of entries) {
    if (entry.kind !== "workflow-cycle.saved") continue;
    const raw = entry.payload as WorkflowCycleSavedEvent;
    if (!raw || !bounded(raw.key, 1_024) || !bounded(raw.selectedSessionId, 256) || !digestLike(raw.queueDigest)) throw new WorkflowArtifactError("Protected workflow focus cycle is malformed.");
    timestamp(raw.updatedAt, "workflow focus cycle time");
    cycles.set(raw.key, { ...raw });
  }
  return cycles;
}

function cloneContext(value: WorkflowCoordinatorContext): WorkflowCoordinatorContext { return jsonClone(value); }

function requireIntent(intent: WorkflowPreparationIntent, kind: WorkflowPreparationIntent["kind"]): void {
  if (intent.kind !== kind) throw new WorkflowArtifactError(`Workflow action requires only the ${kind} preparation intent.`);
}

function proofClaims(evidence: CoordinatorEvidenceBundle): readonly string[] {
  return [
    `Approved plan ${evidence.plan.revision} (${evidence.plan.digest}) is satisfied.`,
    `Exact diff evidence ${evidence.diff.id} (${evidence.diff.digest}) was inspected.`,
    `All ${evidence.files.length} assembled file references and ${evidence.tests.length} test evidence records were classified.`
  ];
}

function independentProvider(provider: ManagedSession["provider"]): string { return provider === "claude" ? "codex" : provider === "codex" ? "claude" : "independent-configured-backend"; }

function artifactMap(entries: readonly JournalEntry<unknown>[]): Map<string, WorkflowArtifact> {
  const result = new Map<string, WorkflowArtifact>();
  for (const entry of entries) {
    if (entry.kind !== "workflow-artifact.saved") continue;
    const raw = (entry.payload as ArtifactSavedEvent | undefined)?.artifact;
    if (!raw || raw.executionAuthorized !== false || !workflowStatus(raw.status)) throw new WorkflowArtifactError("Protected workflow artifact is malformed.");
    const immutable = normalizeInput({ id: raw.id, action: raw.action, repositoryRoot: raw.repositoryRoot, targetSnapshotId: raw.targetSnapshotId, sessionId: raw.sessionId, ...(raw.taskId ? { taskId: raw.taskId } : {}), ...(raw.planRevision ? { planRevision: raw.planRevision } : {}), ...(raw.authorityId ? { authorityId: raw.authorityId } : {}), ...(raw.coordinatorContextDigest ? { coordinatorContextDigest: raw.coordinatorContextDigest, coordinatorContextRevision: raw.coordinatorContextRevision } : {}), payload: raw.payload });
    if (artifactDigest(immutable) !== raw.digest || !timestamp(raw.createdAt, "artifact creation time") || !timestamp(raw.updatedAt, "artifact update time")) throw new WorkflowArtifactError("Protected workflow artifact digest is invalid.");
    let providerFields: Pick<WorkflowArtifact, "providerResult" | "providerSummary" | "providerResponseStatus" | "providerEffectDisposition"> = {};
    if (raw.providerResult !== undefined || raw.providerSummary !== undefined || raw.providerResponseStatus !== undefined || raw.providerEffectDisposition !== undefined) {
      if (raw.providerResult === undefined || !providerStatus(raw.providerResponseStatus) || !disposition(raw.providerEffectDisposition)
        || typeof raw.providerSummary !== "string" || !raw.providerSummary.trim() || raw.providerSummary.length > 1_024) {
        throw new WorkflowArtifactError("Protected workflow provider result metadata is malformed.");
      }
      providerFields = {
        providerResult: normalizeProviderResult(raw.providerResult, { ...raw, ...immutable }),
        providerSummary: redactText(raw.providerSummary.trim()),
        providerResponseStatus: raw.providerResponseStatus,
        providerEffectDisposition: raw.providerEffectDisposition
      };
    }
    let childResults: readonly WorkflowChildProviderResponse[] | undefined;
    if (raw.childResults !== undefined) {
      if (!Array.isArray(raw.childResults) || raw.childResults.length > 64 || !raw.operationId) throw new WorkflowArtifactError("Protected workflow child results are malformed or unbounded.");
      const parent: WorkflowArtifact = { ...raw, ...immutable, ...providerFields };
      childResults = raw.childResults.map((entry) => {
        const effect = workflowProviderEffect(immutable.payload, entry.role, entry.bindingDigest);
        return parseWorkflowChildProviderResponse(entry, parent, effect, entry.childOperationId, entry.role);
      });
      if (new Set(childResults.map((entry) => entry.bindingDigest)).size !== childResults.length || new Set(childResults.map((entry) => entry.childOperationId)).size !== childResults.length) throw new WorkflowArtifactError("Protected workflow child results contain duplicate bindings or operations.");
    }
    result.set(raw.id, clone({ ...raw, ...immutable, ...providerFields, ...(childResults ? { childResults } : {}) }));
  }
  return result;
}

function artifactDigest(value: object): string { return sha256(stableJson(value)); }
function clone(value: WorkflowArtifact): WorkflowArtifact { return jsonClone({ ...value, executionAuthorized: false }); }
function expectedKind(action: WorkflowArtifactAction): WorkflowArtifactPayload["kind"] {
  if (action === "reanchor") return "anchor";
  if (action === "proof" || action === "proof_adversarial") return "proof";
  if (action === "option_provider" || action === "option_packet") return "decision";
  if (action === "plan_expander" || action === "plan_approval") return "plan";
  if (action === "handoff" || action === "handoff_queue" || action === "handoff_immediate") return "handoff";
  if (action === "focus_blocked_agent" || action === "focus_finished_agent") return "focus";
  if (action === "authority_refresh" || action === "authority_broadcast") return "authority";
  return "voice_binding";
}
function workflowAction(value: unknown): WorkflowArtifactAction { if (typeof value === "string" && ["reanchor", "proof", "proof_adversarial", "option_provider", "option_packet", "plan_expander", "plan_approval", "handoff", "handoff_queue", "handoff_immediate", "focus_blocked_agent", "focus_finished_agent", "authority_refresh", "authority_broadcast", "bind_voice_session"].includes(value)) return value as WorkflowArtifactAction; return invalid("workflow action"); }
function rejectLegacyReanchorWorkflow(action: WorkflowArtifactAction): void {
  if (action === "reanchor") throw new WorkflowArtifactError("Generic Re-anchor artifacts are legacy audit evidence only; use the dedicated Re-anchor lifecycle.");
}
function commandAction(value: unknown): CommandAction { if (typeof value === "string" && (commandActionIds as readonly string[]).includes(value)) return value as CommandAction; return invalid("authority action"); }
function voiceProvider(value: unknown): VoiceProvider { if (value === "claude" || value === "chatgpt" || value === "system") return value; return invalid("voice provider"); }
function planStepStatus(value: unknown): PlanStepArtifact["status"] { if (value === "proposed" || value === "approved" || value === "completed" || value === "blocked") return value; return invalid("plan step status"); }
function workflowCapability(value: unknown): ManagedSession["capabilities"][number] { if (value === "registered" || value === "observable" || value === "controllable" || value === "mediated") return value; return invalid("provider effect capability"); }
function managedSessionStatus(value: unknown): ManagedSession["status"] { if (value === "running" || value === "verified_blocked" || value === "verified_finished" || value === "unreachable" || value === "stale" || value === "unknown") return value; return invalid("provider effect session status"); }
function managedSessionSurface(value: unknown): ManagedSession["surface"] { if (value === "vscode_terminal" || value === "vscode_window" || value === "desktop" || value === "browser" || value === "bridge") return value; return invalid("provider effect session surface"); }
function workflowStatus(value: unknown): value is WorkflowArtifactStatus { return value === "prepared" || value === "submitted" || value === "cancelling" || value === "acknowledged" || value === "rejected" || value === "cancelled"; }
function providerStatus(value: unknown): value is WorkflowProviderResponse["status"] { return typeof value === "string" && ["completed", "failed", "blocked", "unavailable", "running", "awaiting_input", "awaiting_confirmation"].includes(value); }
function disposition(value: unknown): value is EffectDisposition { return value === "not_started" || value === "committed" || value === "ambiguous" || value === "compensated"; }
function exact(value: Record<string, unknown>, keys: readonly string[]): boolean { return Object.keys(value).length === keys.length && keys.every((key) => Object.hasOwn(value, key)); }
function allowedExact(value: Record<string, unknown>, required: readonly string[], optional: readonly string[]): boolean {
  const allowed = new Set([...required, ...optional]);
  return required.every((key) => Object.hasOwn(value, key)) && Object.keys(value).every((key) => allowed.has(key));
}
function record(value: unknown): value is Record<string, unknown> { return typeof value === "object" && value !== null && !Array.isArray(value); }
function bounded(value: unknown, maximum: number): value is string { return typeof value === "string" && !!value.trim() && value.length <= maximum && !/[\r\n\0]/.test(value); }
function digestLike(value: unknown): value is string { return typeof value === "string" && /^[a-f0-9]{64}$/i.test(value); }
function digest(value: unknown, field: string): string { if (!digestLike(value)) throw new WorkflowArtifactError(`${field} must be a SHA-256 digest.`); return value.toLowerCase(); }
function identifier(value: unknown, field: string): string { if (typeof value !== "string" || !/^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/.test(value)) throw new WorkflowArtifactError(`${field} is invalid.`); return value; }
function positiveRevision(value: unknown, field: string): number { if (!Number.isSafeInteger(value) || Number(value) < 1) throw new WorkflowArtifactError(`${field} must be a positive safe integer.`); return Number(value); }
function text(value: unknown, field: string): string { if (!bounded(value, 16_384)) throw new WorkflowArtifactError(`${field} must be bounded nonempty text.`); return redactText(value.trim()); }
function shortText(value: unknown, field: string, maximum: number): string { if (!bounded(value, maximum)) throw new WorkflowArtifactError(`${field} must be bounded nonempty text.`); return redactText(value.trim()); }
function timestamp(value: unknown, field: string): string { if (typeof value !== "string" || !Number.isFinite(Date.parse(value))) throw new WorkflowArtifactError(`${field} must be an ISO timestamp.`); return value; }
function list(values: readonly unknown[], field: string, emptyAllowed = false): readonly string[] { if (!Array.isArray(values) || values.length > 512 || (!emptyAllowed && values.length === 0)) throw new WorkflowArtifactError(`${field} list is invalid.`); return [...new Set(values.map((value) => text(value, field)))]; }
function safeOwnedFile(value: unknown): string { if (typeof value !== "string" || !value || value.length > 4_096 || /[\r\n\0]/.test(value) || /^(?:[A-Za-z]:[\\/]|[\\/])/.test(value) || value.split(/[\\/]/).some((part) => !part || part === "." || part === "..")) throw new WorkflowArtifactError("Plan owned file is unsafe."); return value.replaceAll("\\", "/"); }
function sameRepositoryRoot(left: string, right: string): boolean { const normalize = (value: string) => value.replaceAll("\\", "/").replace(/\/+$/, "").toLowerCase(); return normalize(left) === normalize(right); }
function invalid(label: string): never { throw new WorkflowArtifactError(`${label} is invalid.`); }
