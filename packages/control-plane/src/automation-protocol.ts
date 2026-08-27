import type { EffectDisposition } from "./contracts.ts";
import {
  canonicalAutomationRepositoryPath,
  parseAutomationManifestApproval,
  parseAutomationOperationManifest,
  type AutomationManifestApproval,
  type AutomationOperationManifest,
  type AutomationOperationProposal
} from "./automation-operation-manifest.ts";
import { sha256, stableJson } from "./store.ts";

export type AutomationAction = "compound_capture" | "compound_refresh" | "lfg" | "repair_mission";
export interface AutomationConfirmationBinding { readonly digest: string; readonly scopeDigest: string; }
/** `digest` is optional only for source compatibility; effect construction rejects its absence. */
export interface AutomationTestEnvironmentBinding { readonly id: string; readonly digest?: string; readonly egress: "deny"; readonly databaseName: string; }

export interface AutomationIntentBinding {
  readonly action: AutomationAction;
  readonly repositoryRoot: string;
  readonly targetSnapshotId: string;
  readonly sessionId: string;
  readonly authorityId: string;
  readonly taskId: string;
  readonly planRevision: string;
  readonly provider: string;
  readonly manifestId: string;
  readonly manifestDigest: string;
  readonly approvalId: string;
  readonly reviewScopeDigest: string;
  readonly confirmationDigest: string;
  readonly proposalDigest: string;
  readonly scopeDigest: string;
}

type ReviewedIntent<A extends AutomationAction> = Readonly<{
  kind: A;
  confirmation: AutomationConfirmationBinding;
  binding: AutomationIntentBinding;
  proposal: Extract<AutomationOperationProposal, { kind: A }>;
}>;

export type AutomationIntent =
  | Readonly<ReviewedIntent<"compound_capture"> & { durability: "project_learning"; solvedProblemEvidenceRequired: true; verifiedOutcomeRequired: true; nonTrivialRequired: true; instructionFileMutation: "explicit_consent_only" }>
  | Readonly<ReviewedIntent<"compound_refresh"> & { mode: "reviewed_companion_effects"; audit: readonly ["drift", "overlap", "supersession", "contradiction"]; mutationAppliedByProvider: false }>
  | Readonly<ReviewedIntent<"lfg"> & { lifecycle: readonly ["plan", "implement", "simplify", "review", "test", "commit", "push", "pull_request", "ci_watch"]; deployAuthorized: false }>
  | Readonly<ReviewedIntent<"repair_mission"> & { reproduceBeforeModify: true; approvedScope: "exact_target_snapshot"; testEnvironment: Readonly<{ id: string; digest: string; egress: "deny"; databaseName: string }>; pushAuthorized: false; mergeAuthorized: false; deployAuthorized: false; hostedRerunAuthorized: false; productionDataAuthorized: false }>;

export interface AutomationEnvelope {
  readonly schema: string;
  readonly version: 1;
  readonly action: AutomationAction;
  readonly operationId: string;
  readonly target: Readonly<Record<string, unknown>>;
  readonly session: Readonly<Record<string, unknown>>;
  readonly authorityId: string;
  readonly manifest: AutomationOperationManifest;
  readonly approval: AutomationManifestApproval;
  readonly intent: AutomationIntent;
}

export interface AutomationActualMutationDelta {
  readonly path: string;
  readonly mutation: "create" | "update" | "replace" | "delete";
  readonly beforeDigest: string | null;
  readonly afterDigest: string | null;
  readonly byteLength: number;
  readonly status: "applied";
}

export interface AutomationActualDeltaEvidence {
  readonly schema: "sxsy-b122.automation-actual-delta";
  readonly version: 1;
  readonly operationId: string;
  readonly manifestId: string;
  readonly manifestDigest: string;
  readonly proposalDigest: string;
  readonly fromTargetSnapshotId: string;
  readonly mutations: readonly AutomationActualMutationDelta[];
  readonly digest: string;
}

export interface AutomationAcceptedTargetTransitionEvidence {
  readonly schema: "sxsy-b122.automation-target-transition";
  readonly version: 1;
  readonly operationId: string;
  readonly manifestId: string;
  readonly fromTargetSnapshotId: string;
  readonly toTargetSnapshotId: string;
  readonly actualDeltaDigest: string;
  /** Digest of the trusted host's independent post-effect snapshot observation. */
  readonly hostObservationDigest: string;
  readonly accepted: true;
  readonly evidenceDigest: string;
}

export type AutomationRefreshResult =
  | Readonly<{
      kind: "compound_refresh"; previewDigest: string; affectedPaths: readonly string[]; creates: number; updates: number; deletes: number;
      mutationApplied: false; actualDelta?: null; targetTransition?: null;
    }>
  | Readonly<{
      kind: "compound_refresh"; previewDigest: string; affectedPaths: readonly string[]; creates: number; updates: number; deletes: number;
      mutationApplied: true; actualDelta: AutomationActualDeltaEvidence; targetTransition: AutomationAcceptedTargetTransitionEvidence;
    }>;

export type AutomationProviderResultPayload =
  | Readonly<{ kind: "compound_capture"; captureId: string; learningDigest: string; verifiedProblemDigest: string; documents: readonly string[] }>
  | AutomationRefreshResult
  | Readonly<{ kind: "lfg"; runId: string; stages: readonly Readonly<{ name: string; status: "passed" | "failed" | "skipped"; evidenceDigest: string }>[]; pullRequestUrl: string | null; deploymentAttempted: false }>
  | Readonly<{ kind: "repair_mission"; reproduction: Readonly<{ commandDigest: string; status: "reproduced" | "not_reproduced"; logsDigest: string }>; approvedScopeDigest: string; diffDigest: string; affectedChecks: readonly string[]; fullChecks: readonly string[]; risks: readonly string[]; nextAction: string; pushAttempted: false; mergeAttempted: false; deployAttempted: false; hostedRerunAttempted: false; productionDataUsed: false }>;

export interface AutomationProviderResult {
  readonly schema: string;
  readonly version: 1;
  readonly action: AutomationAction;
  readonly status: "completed" | "unavailable" | "blocked" | "failed" | "awaiting_input" | "awaiting_confirmation" | "running" | "cancelled" | "timed_out";
  readonly effectDisposition: EffectDisposition;
  readonly summary: string;
  readonly externalId: string;
  /** Runtime parsing requires every echo; optionality only keeps legacy constructors source-compatible while they are rejected. */
  readonly manifestId?: string;
  readonly manifestDigest?: string;
  readonly approvalId?: string;
  readonly reviewScopeDigest?: string;
  readonly proposalDigest?: string;
  readonly result: AutomationProviderResultPayload;
}
export type AutomationProviderResultFor<A extends AutomationAction> = Omit<AutomationProviderResult, "action" | "result"> & Readonly<{
  action: A;
  result: Extract<AutomationProviderResultPayload, { kind: A }>;
}>;

export function automationRequestSchema(action: AutomationAction): string { return `sxsy-b122.${action.replaceAll("_", "-")}-request`; }
export function automationResultSchema(action: AutomationAction): string { return `sxsy-b122.${action.replaceAll("_", "-")}-result`; }

export function createAutomationIntent<A extends AutomationAction>(
  action: A,
  confirmation?: AutomationConfirmationBinding,
  testEnvironment?: AutomationTestEnvironmentBinding,
  review?: Readonly<{ manifest: AutomationOperationManifest; approval: AutomationManifestApproval }>
): Extract<AutomationIntent, { kind: A }> {
  if (!review) throw new Error("Automation requires one exact reviewed manifest and approval.");
  const manifest = parseAutomationOperationManifest(review.manifest);
  if (manifest.action !== action || manifest.proposal.kind !== action) throw new Error("The automation manifest does not match the exact intent action.");
  const approval = parseAutomationManifestApproval(review.approval, manifest);
  const exactConfirmation = parseConfirmation(confirmation);
  if (exactConfirmation.digest !== approval.confirmationDigest || exactConfirmation.scopeDigest !== approval.reviewScopeDigest) {
    throw new Error("The automation confirmation does not match the exact manifest approval.");
  }
  const binding = automationIntentBinding(manifest, approval);
  const common = { kind: action, confirmation: exactConfirmation, binding, proposal: manifest.proposal };
  if (action === "compound_capture") {
    if (testEnvironment) throw new Error("Compound Capture cannot carry a repair test environment.");
    return deepFreeze({ ...common, durability: "project_learning", solvedProblemEvidenceRequired: true, verifiedOutcomeRequired: true, nonTrivialRequired: true, instructionFileMutation: "explicit_consent_only" }) as Extract<AutomationIntent, { kind: A }>;
  }
  if (action === "compound_refresh") {
    if (testEnvironment) throw new Error("Compound Refresh cannot carry a repair test environment.");
    return deepFreeze({ ...common, mode: "reviewed_companion_effects", audit: ["drift", "overlap", "supersession", "contradiction"] as const, mutationAppliedByProvider: false }) as Extract<AutomationIntent, { kind: A }>;
  }
  if (action === "lfg") {
    if (testEnvironment) throw new Error("LFG cannot carry a repair test environment.");
    return deepFreeze({ ...common, lifecycle: ["plan", "implement", "simplify", "review", "test", "commit", "push", "pull_request", "ci_watch"] as const, deployAuthorized: false }) as Extract<AutomationIntent, { kind: A }>;
  }
  const proposal = manifest.proposal as Extract<AutomationOperationProposal, { kind: "repair_mission" }>;
  if (!testEnvironment || !identifier(testEnvironment.id) || !digest(testEnvironment.digest) || testEnvironment.egress !== "deny" || !identifier(testEnvironment.databaseName)
    || testEnvironment.id !== proposal.testEnvironment.id || testEnvironment.digest !== proposal.testEnvironment.digest
    || testEnvironment.databaseName !== proposal.testEnvironment.databaseName) {
    throw new Error("Repair Mission requires the exact reviewed deny-egress test environment binding.");
  }
  return deepFreeze({
    ...common,
    reproduceBeforeModify: true,
    approvedScope: "exact_target_snapshot",
    testEnvironment: { id: testEnvironment.id, digest: testEnvironment.digest, egress: "deny" as const, databaseName: testEnvironment.databaseName },
    pushAuthorized: false,
    mergeAuthorized: false,
    deployAuthorized: false,
    hostedRerunAuthorized: false,
    productionDataAuthorized: false
  }) as Extract<AutomationIntent, { kind: A }>;
}

export function parseAutomationEnvelope(value: unknown): AutomationEnvelope {
  if (!record(value) || !exact(value, ["schema", "version", "action", "operationId", "target", "session", "authorityId", "manifest", "approval", "intent"])
    || value.version !== 1 || !automationAction(value.action) || value.schema !== automationRequestSchema(value.action)
    || !identifier(value.operationId) || !record(value.target) || !record(value.session) || !identifier(value.authorityId)) {
    throw new Error("The action-specific automation request schema or protected review binding is invalid.");
  }
  const target = parseEnvelopeTarget(value.target);
  const session = parseEnvelopeSession(value.session);
  const manifest = parseAutomationOperationManifest(value.manifest);
  const approval = parseAutomationManifestApproval(value.approval, manifest);
  requireEnvelopeBinding(value.action, value.authorityId, target, session, manifest);
  const intent = parseIntent(value.action, value.intent, manifest, approval);
  return deepFreeze({
    schema: value.schema,
    version: 1,
    action: value.action,
    operationId: value.operationId,
    target,
    session,
    authorityId: value.authorityId,
    manifest,
    approval,
    intent
  });
}

/** Canonical dispatch-lease artifact binding over both the reviewed manifest and its one-use approval. */
export function automationEffectLeaseArtifact(envelope: AutomationEnvelope): Readonly<{
  id: string;
  digest: string;
  coordinatorContextDigest: null;
  coordinatorContextRevision: null;
}> {
  const manifest = parseAutomationOperationManifest(envelope.manifest);
  const approval = parseAutomationManifestApproval(envelope.approval, manifest);
  const binding = automationIntentBinding(manifest, approval);
  if (stableJson(binding) !== stableJson(envelope.intent.binding)) throw new Error("The automation lease artifact binding changed from the reviewed intent.");
  return automationIntentLeaseArtifact(binding);
}

export function automationIntentLeaseArtifact(bindingValue: AutomationIntentBinding): Readonly<{
  id: string;
  digest: string;
  coordinatorContextDigest: null;
  coordinatorContextRevision: null;
}> {
  const binding = parseIntentBinding(bindingValue);
  return Object.freeze({
    id: binding.approvalId,
    digest: sha256(stableJson({ schema: "sxsy-b122.automation-effect-lease-artifact", version: 1, ...binding })),
    coordinatorContextDigest: null,
    coordinatorContextRevision: null
  });
}

export function createAutomationActualDeltaEvidence(input: Readonly<{
  operationId: string;
  manifestId: string;
  manifestDigest: string;
  proposalDigest: string;
  fromTargetSnapshotId: string;
  mutations: readonly AutomationActualMutationDelta[];
}>): AutomationActualDeltaEvidence {
  const content = {
    schema: "sxsy-b122.automation-actual-delta" as const,
    version: 1 as const,
    operationId: requiredIdentifier(input.operationId, "actual-delta operation"),
    manifestId: requiredIdentifier(input.manifestId, "actual-delta manifest"),
    manifestDigest: requiredDigest(input.manifestDigest, "actual-delta manifest"),
    proposalDigest: requiredDigest(input.proposalDigest, "actual-delta proposal"),
    fromTargetSnapshotId: requiredDigest(input.fromTargetSnapshotId, "actual-delta source target"),
    mutations: parseActualMutations(input.mutations)
  };
  if (content.manifestId !== `automation-manifest:${content.manifestDigest}`) throw new Error("The actual delta changed its reviewed manifest binding.");
  return deepFreeze({ ...content, digest: sha256(stableJson(content)) });
}

export function parseAutomationActualDeltaEvidence(value: unknown): AutomationActualDeltaEvidence {
  if (!record(value) || !exact(value, ["schema", "version", "operationId", "manifestId", "manifestDigest", "proposalDigest", "fromTargetSnapshotId", "mutations", "digest"])
    || value.schema !== "sxsy-b122.automation-actual-delta" || value.version !== 1 || !digest(value.digest)) {
    throw new Error("The companion actual-delta evidence is malformed.");
  }
  const rebuilt = createAutomationActualDeltaEvidence({
    operationId: requiredIdentifier(value.operationId, "actual-delta operation"),
    manifestId: requiredIdentifier(value.manifestId, "actual-delta manifest"),
    manifestDigest: requiredDigest(value.manifestDigest, "actual-delta manifest"),
    proposalDigest: requiredDigest(value.proposalDigest, "actual-delta proposal"),
    fromTargetSnapshotId: requiredDigest(value.fromTargetSnapshotId, "actual-delta source target"),
    mutations: Array.isArray(value.mutations) ? value.mutations as unknown as AutomationActualMutationDelta[] : []
  });
  if (rebuilt.digest !== value.digest) throw new Error("The companion actual-delta evidence digest changed.");
  return rebuilt;
}

export function createAutomationAcceptedTargetTransitionEvidence(input: Readonly<{
  operationId: string;
  manifestId: string;
  fromTargetSnapshotId: string;
  toTargetSnapshotId: string;
  actualDeltaDigest: string;
  hostObservationDigest: string;
  accepted: true;
}>): AutomationAcceptedTargetTransitionEvidence {
  const content = {
    schema: "sxsy-b122.automation-target-transition" as const,
    version: 1 as const,
    operationId: requiredIdentifier(input.operationId, "target-transition operation"),
    manifestId: requiredIdentifier(input.manifestId, "target-transition manifest"),
    fromTargetSnapshotId: requiredDigest(input.fromTargetSnapshotId, "target-transition source target"),
    toTargetSnapshotId: requiredDigest(input.toTargetSnapshotId, "target-transition destination target"),
    actualDeltaDigest: requiredDigest(input.actualDeltaDigest, "target-transition actual delta"),
    hostObservationDigest: requiredDigest(input.hostObservationDigest, "target-transition host observation"),
    accepted: input.accepted
  };
  if (content.accepted !== true || content.fromTargetSnapshotId === content.toTargetSnapshotId) {
    throw new Error("A mutating automation target transition must be independently accepted and changed.");
  }
  return deepFreeze({ ...content, evidenceDigest: sha256(stableJson(content)) });
}

export function parseAutomationAcceptedTargetTransitionEvidence(value: unknown): AutomationAcceptedTargetTransitionEvidence {
  if (!record(value) || !exact(value, ["schema", "version", "operationId", "manifestId", "fromTargetSnapshotId", "toTargetSnapshotId", "actualDeltaDigest", "hostObservationDigest", "accepted", "evidenceDigest"])
    || value.schema !== "sxsy-b122.automation-target-transition" || value.version !== 1 || !digest(value.evidenceDigest)) {
    throw new Error("The companion target-transition evidence is malformed.");
  }
  const rebuilt = createAutomationAcceptedTargetTransitionEvidence({
    operationId: requiredIdentifier(value.operationId, "target-transition operation"),
    manifestId: requiredIdentifier(value.manifestId, "target-transition manifest"),
    fromTargetSnapshotId: requiredDigest(value.fromTargetSnapshotId, "target-transition source target"),
    toTargetSnapshotId: requiredDigest(value.toTargetSnapshotId, "target-transition destination target"),
    actualDeltaDigest: requiredDigest(value.actualDeltaDigest, "target-transition actual delta"),
    hostObservationDigest: requiredDigest(value.hostObservationDigest, "target-transition host observation"),
    accepted: value.accepted as true
  });
  if (rebuilt.evidenceDigest !== value.evidenceDigest) throw new Error("The companion target-transition evidence digest changed.");
  return rebuilt;
}

export function parseAutomationProviderResult<A extends AutomationAction>(
  value: unknown,
  expectedAction: A,
  expectedExternalId: string,
  expectedBinding?: AutomationIntentBinding
): AutomationProviderResultFor<A> {
  const binding = expectedBinding ? parseIntentBinding(expectedBinding) : undefined;
  if (!record(value) || !exact(value, [
    "schema", "version", "action", "status", "effectDisposition", "summary", "externalId",
    "manifestId", "manifestDigest", "approvalId", "reviewScopeDigest", "proposalDigest", "result"
  ]) || value.schema !== automationResultSchema(expectedAction) || value.version !== 1 || value.action !== expectedAction
    || !status(value.status) || !disposition(value.effectDisposition) || !summary(value.summary)
    || value.externalId !== expectedExternalId || !identifier(value.externalId)
    || !identifier(value.manifestId) || !digest(value.manifestDigest) || value.manifestId !== `automation-manifest:${value.manifestDigest}`
    || !identifier(value.approvalId) || !digest(value.reviewScopeDigest) || !digest(value.proposalDigest)
    || (binding !== undefined && (value.manifestId !== binding.manifestId || value.manifestDigest !== binding.manifestDigest
      || value.approvalId !== binding.approvalId || value.reviewScopeDigest !== binding.reviewScopeDigest
      || value.proposalDigest !== binding.proposalDigest))) {
    throw new Error("The action-specific automation provider response schema or reviewed artifact binding is invalid.");
  }
  const result = parseResult(expectedAction, value.result);
  assertProviderResultConsistency(value.status, value.effectDisposition, result, binding, expectedExternalId);
  return deepFreeze({
    schema: value.schema,
    version: 1,
    action: expectedAction,
    status: value.status,
    effectDisposition: value.effectDisposition,
    summary: value.summary,
    externalId: value.externalId,
    manifestId: value.manifestId,
    manifestDigest: value.manifestDigest,
    approvalId: value.approvalId,
    reviewScopeDigest: value.reviewScopeDigest,
    proposalDigest: value.proposalDigest,
    result: result as Extract<AutomationProviderResultPayload, { kind: A }>
  });
}

function parseIntent(action: AutomationAction, value: unknown, manifest: AutomationOperationManifest, approval: AutomationManifestApproval): AutomationIntent {
  if (!record(value) || value.kind !== action) throw new Error("The automation intent does not match its exact action.");
  const canonical = createAutomationIntent(
    action,
    record(value.confirmation) ? value.confirmation as unknown as AutomationConfirmationBinding : undefined,
    action === "repair_mission" && record(value.testEnvironment) ? value.testEnvironment as unknown as AutomationTestEnvironmentBinding : undefined,
    { manifest, approval }
  );
  if (stableJson(value) !== stableJson(canonical)) throw new Error("The action-specific automation intent, proposal, or approved scope changed.");
  return canonical;
}

function automationIntentBinding(manifest: AutomationOperationManifest, approval: AutomationManifestApproval): AutomationIntentBinding {
  return deepFreeze({
    action: manifest.action,
    repositoryRoot: manifest.repositoryRoot,
    targetSnapshotId: manifest.targetSnapshotId,
    sessionId: manifest.sessionId,
    authorityId: manifest.authorityId,
    taskId: manifest.taskId,
    planRevision: manifest.planRevision,
    provider: manifest.provider,
    manifestId: manifest.id,
    manifestDigest: manifest.digest,
    approvalId: approval.id,
    reviewScopeDigest: approval.reviewScopeDigest,
    confirmationDigest: approval.confirmationDigest,
    proposalDigest: sha256(stableJson(manifest.proposal)),
    scopeDigest: proposalScopeDigest(manifest.proposal)
  });
}

function parseIntentBinding(value: unknown): AutomationIntentBinding {
  if (!record(value) || !exact(value, [
    "action", "repositoryRoot", "targetSnapshotId", "sessionId", "authorityId", "taskId", "planRevision", "provider",
    "manifestId", "manifestDigest", "approvalId", "reviewScopeDigest", "confirmationDigest", "proposalDigest", "scopeDigest"
  ]) || !automationAction(value.action) || !absoluteRoot(value.repositoryRoot) || !digest(value.targetSnapshotId)
    || !identifier(value.sessionId) || !identifier(value.authorityId) || !identifier(value.taskId) || !identifier(value.planRevision)
    || !identifier(value.provider) || !identifier(value.manifestId) || !digest(value.manifestDigest) || !identifier(value.approvalId)
    || !digest(value.reviewScopeDigest) || !digest(value.confirmationDigest) || !digest(value.proposalDigest) || !digest(value.scopeDigest)) {
    throw new Error("The automation intent manifest and approval binding is malformed.");
  }
  return deepFreeze({
    action: value.action,
    repositoryRoot: value.repositoryRoot,
    targetSnapshotId: value.targetSnapshotId,
    sessionId: value.sessionId,
    authorityId: value.authorityId,
    taskId: value.taskId,
    planRevision: value.planRevision,
    provider: value.provider,
    manifestId: value.manifestId,
    manifestDigest: value.manifestDigest,
    approvalId: value.approvalId,
    reviewScopeDigest: value.reviewScopeDigest,
    confirmationDigest: value.confirmationDigest,
    proposalDigest: value.proposalDigest,
    scopeDigest: value.scopeDigest
  });
}

function proposalScopeDigest(proposal: AutomationOperationProposal): string {
  let scope: Readonly<Record<string, unknown>>;
  if (proposal.kind === "compound_capture") scope = { documents: proposal.documents, instructionFileMutation: proposal.instructionFileMutation };
  else if (proposal.kind === "compound_refresh") scope = { audit: proposal.audit, mutations: proposal.mutations, commit: proposal.commit };
  else if (proposal.kind === "lfg") scope = { requirementsSources: proposal.requirementsSources, approvedScopePaths: proposal.approvedScopePaths, authorizedActions: proposal.authorizedActions, deployAuthorized: proposal.deployAuthorized };
  else scope = {
    failingGateId: proposal.failingGateId,
    reproductionCommandDigest: proposal.reproductionCommandDigest,
    approvedScopePaths: proposal.approvedScopePaths,
    affectedChecks: proposal.affectedChecks,
    fullChecks: proposal.fullChecks,
    testEnvironment: proposal.testEnvironment,
    pushAuthorized: proposal.pushAuthorized,
    mergeAuthorized: proposal.mergeAuthorized,
    deployAuthorized: proposal.deployAuthorized,
    hostedRerunAuthorized: proposal.hostedRerunAuthorized,
    productionDataAuthorized: proposal.productionDataAuthorized
  };
  return sha256(stableJson({ schema: "sxsy-b122.automation-approved-effect-scope", version: 1, action: proposal.kind, scope }));
}

function requireEnvelopeBinding(
  action: AutomationAction,
  authorityId: string,
  target: Readonly<Record<string, unknown>>,
  session: Readonly<Record<string, unknown>>,
  manifest: AutomationOperationManifest
): void {
  if (manifest.action !== action || manifest.proposal.kind !== action
    || normalizeRoot(manifest.repositoryRoot) !== normalizeRoot(String(target.repositoryRoot))
    || manifest.targetSnapshotId !== target.id || manifest.sessionId !== session.id
    || manifest.authorityId !== authorityId || manifest.taskId !== session.taskId
    || manifest.planRevision !== session.planRevision || manifest.provider !== session.provider) {
    throw new Error("The automation manifest changed its exact action, repository, target, session, authority, task, plan, or provider binding.");
  }
}

function parseEnvelopeTarget(value: Record<string, unknown>): Readonly<Record<string, unknown>> {
  if (!allowedExact(value, ["id", "repositoryRoot", "policyVersion", "trackedManifest", "untrackedManifest"], ["branch", "head"])
    || !digest(value.id) || !absoluteRoot(value.repositoryRoot) || !boundedIdentifier(value.policyVersion, 256)
    || !digest(value.trackedManifest) || !digest(value.untrackedManifest)
    || (value.branch !== undefined && !boundedIdentifier(value.branch, 256))
    || (value.head !== undefined && !(digest(value.head) || sha40(value.head)))) {
    throw new Error("The automation target document is malformed.");
  }
  return deepFreeze({ ...value });
}

function parseEnvelopeSession(value: Record<string, unknown>): Readonly<Record<string, unknown>> {
  if (!exact(value, ["id", "provider", "surface", "capabilities", "taskId", "planRevision", "plannedFiles"])
    || !identifier(value.id) || (value.provider !== "claude" && value.provider !== "codex")
    || !boundedIdentifier(value.surface, 128) || !identifier(value.taskId) || !identifier(value.planRevision)
    || !capabilityList(value.capabilities) || !stringList(value.plannedFiles, 512)) {
    throw new Error("The automation session document is malformed or lacks one exact protected provider binding.");
  }
  return deepFreeze({ ...value, capabilities: [...value.capabilities], plannedFiles: [...value.plannedFiles] });
}

function parseResult(action: AutomationAction, value: unknown): AutomationProviderResultPayload {
  if (!record(value) || value.kind !== action) throw new Error("The automation result does not match its exact action.");
  switch (action) {
    case "compound_capture":
      if (exact(value, ["kind", "captureId", "learningDigest", "verifiedProblemDigest", "documents"]) && identifier(value.captureId) && digest(value.learningDigest) && digest(value.verifiedProblemDigest) && stringList(value.documents, 256, true)) return deepFreeze({ kind: action, captureId: value.captureId, learningDigest: value.learningDigest, verifiedProblemDigest: value.verifiedProblemDigest, documents: [...value.documents] });
      break;
    case "compound_refresh":
      if (allowedExact(value, ["kind", "previewDigest", "affectedPaths", "creates", "updates", "deletes", "mutationApplied"], ["actualDelta", "targetTransition"])
        && digest(value.previewDigest) && stringList(value.affectedPaths, 512) && count(value.creates) && count(value.updates) && count(value.deletes)) {
        if (value.mutationApplied === false && (value.actualDelta === undefined || value.actualDelta === null) && (value.targetTransition === undefined || value.targetTransition === null)) {
          return deepFreeze({ kind: action, previewDigest: value.previewDigest, affectedPaths: [...value.affectedPaths], creates: value.creates, updates: value.updates, deletes: value.deletes, mutationApplied: false, actualDelta: null, targetTransition: null });
        }
        if (value.mutationApplied === true && value.actualDelta !== null && value.targetTransition !== null) {
          const actualDelta = parseAutomationActualDeltaEvidence(value.actualDelta);
          const targetTransition = parseAutomationAcceptedTargetTransitionEvidence(value.targetTransition);
          const paths = actualDelta.mutations.map((mutation) => mutation.path);
          const creates = actualDelta.mutations.filter((mutation) => mutation.mutation === "create").length;
          const updates = actualDelta.mutations.filter((mutation) => mutation.mutation === "update" || mutation.mutation === "replace").length;
          const deletes = actualDelta.mutations.filter((mutation) => mutation.mutation === "delete").length;
          if (stableJson(paths) !== stableJson(value.affectedPaths) || creates !== value.creates || updates !== value.updates || deletes !== value.deletes
            || targetTransition.operationId !== actualDelta.operationId || targetTransition.manifestId !== actualDelta.manifestId
            || targetTransition.fromTargetSnapshotId !== actualDelta.fromTargetSnapshotId || targetTransition.actualDeltaDigest !== actualDelta.digest) {
            throw new Error("The Refresh result contradicts the companion-observed actual delta or accepted target transition.");
          }
          return deepFreeze({ kind: action, previewDigest: value.previewDigest, affectedPaths: [...value.affectedPaths], creates: value.creates, updates: value.updates, deletes: value.deletes, mutationApplied: true, actualDelta, targetTransition });
        }
      }
      throw new Error("The Refresh mutation result or companion evidence is invalid.");
    case "lfg":
      if (exact(value, ["kind", "runId", "stages", "pullRequestUrl", "deploymentAttempted"]) && identifier(value.runId) && Array.isArray(value.stages) && value.stages.length >= 1 && value.stages.length <= 32 && value.deploymentAttempted === false && (value.pullRequestUrl === null || safeHttps(value.pullRequestUrl))) {
        const stages = value.stages.map((stage) => { if (!record(stage) || !exact(stage, ["name", "status", "evidenceDigest"]) || !identifier(stage.name) || (stage.status !== "passed" && stage.status !== "failed" && stage.status !== "skipped") || !digest(stage.evidenceDigest)) throw new Error("The LFG stage result is invalid."); return deepFreeze({ name: stage.name, status: stage.status as "passed" | "failed" | "skipped", evidenceDigest: stage.evidenceDigest }); });
        return deepFreeze({ kind: action, runId: value.runId, stages, pullRequestUrl: value.pullRequestUrl, deploymentAttempted: false });
      }
      break;
    case "repair_mission":
      if (exact(value, ["kind", "reproduction", "approvedScopeDigest", "diffDigest", "affectedChecks", "fullChecks", "risks", "nextAction", "pushAttempted", "mergeAttempted", "deployAttempted", "hostedRerunAttempted", "productionDataUsed"]) && record(value.reproduction) && exact(value.reproduction, ["commandDigest", "status", "logsDigest"]) && digest(value.reproduction.commandDigest) && (value.reproduction.status === "reproduced" || value.reproduction.status === "not_reproduced") && digest(value.reproduction.logsDigest) && digest(value.approvedScopeDigest) && digest(value.diffDigest) && stringList(value.affectedChecks, 256) && stringList(value.fullChecks, 256) && stringList(value.risks, 128) && bounded(value.nextAction) && value.pushAttempted === false && value.mergeAttempted === false && value.deployAttempted === false && value.hostedRerunAttempted === false && value.productionDataUsed === false) return deepFreeze({ kind: action, reproduction: { commandDigest: value.reproduction.commandDigest, status: value.reproduction.status, logsDigest: value.reproduction.logsDigest }, approvedScopeDigest: value.approvedScopeDigest, diffDigest: value.diffDigest, affectedChecks: [...value.affectedChecks], fullChecks: [...value.fullChecks], risks: [...value.risks], nextAction: value.nextAction, pushAttempted: false, mergeAttempted: false, deployAttempted: false, hostedRerunAttempted: false, productionDataUsed: false });
      break;
  }
  throw new Error("The action-specific automation provider result is invalid.");
}

function assertProviderResultConsistency(
  statusValue: AutomationProviderResult["status"],
  dispositionValue: EffectDisposition,
  result: AutomationProviderResultPayload,
  binding: AutomationIntentBinding | undefined,
  externalId: string
): void {
  const passiveStatus = statusValue === "unavailable" || statusValue === "blocked" || statusValue === "awaiting_input"
    || statusValue === "awaiting_confirmation";
  if (dispositionValue === "committed" && statusValue !== "completed") throw new Error("The automation status contradicts its committed effect disposition.");
  if (dispositionValue === "ambiguous" && statusValue !== "running" && statusValue !== "failed" && statusValue !== "cancelled" && statusValue !== "timed_out") throw new Error("The automation status contradicts its ambiguous effect disposition.");
  if (dispositionValue === "compensated" && statusValue !== "completed" && statusValue !== "failed" && statusValue !== "cancelled" && statusValue !== "timed_out") throw new Error("The automation status contradicts its compensated effect disposition.");
  if (passiveStatus && dispositionValue !== "not_started") throw new Error("An incomplete automation status cannot claim a started effect disposition.");
  if ((statusValue === "failed" || statusValue === "cancelled" || statusValue === "timed_out") && dispositionValue === "committed") throw new Error("A failed automation result cannot claim a committed effect.");
  if (result.kind === "compound_refresh") {
    if (!result.mutationApplied && dispositionValue === "committed") throw new Error("Refresh cannot claim a committed mutation when its result says no mutation was applied.");
    if (result.mutationApplied) {
      if (statusValue !== "completed" || dispositionValue !== "committed") throw new Error("Applied Refresh mutations require a completed committed companion result.");
      if (result.actualDelta.operationId !== externalId) throw new Error("Refresh actual-delta evidence changed its operation binding.");
      if (binding && (result.actualDelta.manifestId !== binding.manifestId || result.actualDelta.manifestDigest !== binding.manifestDigest
        || result.actualDelta.proposalDigest !== binding.proposalDigest || result.actualDelta.fromTargetSnapshotId !== binding.targetSnapshotId)) {
        throw new Error("Refresh actual-delta evidence changed its reviewed artifact or source target binding.");
      }
    }
  }
}

function parseActualMutations(value: unknown): readonly AutomationActualMutationDelta[] {
  if (!Array.isArray(value) || value.length < 1 || value.length > 512) throw new Error("The actual delta requires one bounded mutation list.");
  const mutations = value.map((entry) => {
    if (!record(entry) || !exact(entry, ["path", "mutation", "beforeDigest", "afterDigest", "byteLength", "status"]) || entry.status !== "applied"
      || typeof entry.path !== "string" || !canonicalAutomationRepositoryPath(entry.path) || canonicalAutomationRepositoryPath(entry.path) !== entry.path
      || (entry.mutation !== "create" && entry.mutation !== "update" && entry.mutation !== "replace" && entry.mutation !== "delete")
      || !Number.isSafeInteger(entry.byteLength) || (entry.byteLength as number) < 0 || (entry.byteLength as number) > 4 * 1024 * 1024) {
      throw new Error("The companion actual delta contains a malformed mutation.");
    }
    if (entry.mutation === "create" && (entry.beforeDigest !== null || !digest(entry.afterDigest))
      || (entry.mutation === "update" || entry.mutation === "replace") && (!digest(entry.beforeDigest) || !digest(entry.afterDigest) || entry.beforeDigest === entry.afterDigest)
      || entry.mutation === "delete" && (!digest(entry.beforeDigest) || entry.afterDigest !== null || entry.byteLength !== 0)) {
      throw new Error("The companion actual delta contradicts its before/after state.");
    }
    return deepFreeze({
      path: entry.path,
      mutation: entry.mutation as AutomationActualMutationDelta["mutation"],
      beforeDigest: entry.beforeDigest as string | null,
      afterDigest: entry.afterDigest as string | null,
      byteLength: entry.byteLength as number,
      status: "applied" as const
    });
  });
  if (new Set(mutations.map((entry) => entry.path)).size !== mutations.length) throw new Error("The companion actual delta repeats a canonical path.");
  return deepFreeze(mutations);
}

function parseConfirmation(value: unknown): AutomationConfirmationBinding {
  if (!record(value) || !exact(value, ["digest", "scopeDigest"]) || !digest(value.digest) || !digest(value.scopeDigest)) throw new Error("Automation requires one exact reviewed confirmation binding.");
  return deepFreeze({ digest: value.digest, scopeDigest: value.scopeDigest });
}
function requiredIdentifier(value: unknown, label: string): string { if (!identifier(value)) throw new Error(`The automation ${label} identifier is invalid.`); return value; }
function requiredDigest(value: unknown, label: string): string { if (!digest(value)) throw new Error(`The automation ${label} digest is invalid.`); return value; }
function automationAction(value: unknown): value is AutomationAction { return value === "compound_capture" || value === "compound_refresh" || value === "lfg" || value === "repair_mission"; }
function record(value: unknown): value is Record<string, unknown> { return typeof value === "object" && value !== null && !Array.isArray(value); }
function exact(value: Record<string, unknown>, keys: readonly string[]): boolean { return Object.keys(value).length === keys.length && keys.every((key) => Object.hasOwn(value, key)); }
function allowedExact(value: Record<string, unknown>, required: readonly string[], optional: readonly string[]): boolean { const allowed = new Set([...required, ...optional]); return required.every((key) => Object.hasOwn(value, key)) && Object.keys(value).every((key) => allowed.has(key)); }
function identifier(value: unknown): value is string { return typeof value === "string" && value.length > 0 && value.length <= 256 && /^[A-Za-z0-9][A-Za-z0-9._:-]*$/u.test(value); }
function digest(value: unknown): value is string { return typeof value === "string" && /^[a-f0-9]{64}$/u.test(value); }
function sha40(value: unknown): value is string { return typeof value === "string" && /^[a-f0-9]{40}$/u.test(value); }
function absoluteRoot(value: unknown): value is string { return typeof value === "string" && value.length >= 2 && value.length <= 4_096 && !/[\0\r\n]/u.test(value) && /^(?:[A-Za-z]:[\\/]|[\\/]{2}[^\\/]|\/)/u.test(value); }
function normalizeRoot(value: string): string { return value.replaceAll("\\", "/").replace(/\/+$/u, "").toLowerCase(); }
function boundedIdentifier(value: unknown, maximum: number): value is string { return typeof value === "string" && value.trim().length > 0 && value.length <= maximum && !/[\0\r\n]/u.test(value); }
function bounded(value: unknown): value is string { return boundedIdentifier(value, 512); }
function stringList(value: unknown, maximum: number, nonEmpty = false): value is string[] { return Array.isArray(value) && (!nonEmpty || value.length > 0) && value.length <= maximum && value.every((entry) => typeof entry === "string" && entry.length > 0 && entry.length <= 512 && !/[\0\r\n]/u.test(entry)) && new Set(value).size === value.length; }
function capabilityList(value: unknown): value is string[] { return Array.isArray(value) && value.length === 4 && new Set(value).size === 4 && value.every((entry) => entry === "registered" || entry === "observable" || entry === "controllable" || entry === "mediated"); }
function count(value: unknown): value is number { return Number.isSafeInteger(value) && (value as number) >= 0 && (value as number) <= 1_000_000; }
function status(value: unknown): value is AutomationProviderResult["status"] { return value === "completed" || value === "unavailable" || value === "blocked" || value === "failed" || value === "awaiting_input" || value === "awaiting_confirmation" || value === "running" || value === "cancelled" || value === "timed_out"; }
function disposition(value: unknown): value is EffectDisposition { return value === "not_started" || value === "ambiguous" || value === "committed" || value === "compensated"; }
function summary(value: unknown): value is string { return boundedIdentifier(value, 512); }
function safeHttps(value: unknown): value is string { if (typeof value !== "string" || value.length > 2_048) return false; try { const url = new URL(value); return url.protocol === "https:" && !url.username && !url.password; } catch { return false; } }
function deepFreeze<T>(value: T): T { if (value && typeof value === "object" && !Object.isFrozen(value)) { for (const child of Object.values(value as Record<string, unknown>)) deepFreeze(child); Object.freeze(value); } return value; }
