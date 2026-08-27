import { isAbsolute } from "node:path";

import {
  type AutomationEffectChild,
  type AutomationEffectChildKind,
  type AutomationOperationProposal
} from "../../../packages/control-plane/src/automation-operation-manifest.ts";
import { parseAutomationEnvelope, type AutomationEnvelope } from "../../../packages/control-plane/src/automation-protocol.ts";
import { sha256, stableJson } from "../../../packages/control-plane/src/store.ts";
import type {
  AutomationChildEffectPort,
  AutomationChildEffectPorts,
  AutomationChildEffectResult
} from "./automation-effect-executor.ts";

export const executableAutomationChildKinds = Object.freeze([
  "plan", "simplify", "review", "test", "git_commit", "git_push", "pull_request", "ci_watch",
  "sandbox_bind", "reproduce", "test_affected", "test_full", "review_diff"
] as const);

export type ExecutableAutomationChildKind = typeof executableAutomationChildKinds[number];
export type AutomationChildAction = "lfg" | "repair_mission";
export type AutomationRepairEnvironment = Readonly<{ id: string; digest: string; egress: "deny"; databaseName: string }>;

const lfgKinds = new Set<ExecutableAutomationChildKind>([
  "plan", "simplify", "review", "test", "git_commit", "git_push", "pull_request", "ci_watch"
]);
const repairKinds = new Set<ExecutableAutomationChildKind>([
  "sandbox_bind", "reproduce", "test_affected", "test_full", "review_diff"
]);

export interface AutomationChildArtifactBinding {
  readonly schema: "sxsy-b122.automation-child-artifact-binding";
  readonly version: 1;
  readonly action: AutomationChildAction;
  readonly operationId: string;
  readonly manifestId: string;
  readonly manifestDigest: string;
  readonly proposalDigest: string;
  readonly approvalId: string;
  readonly reviewScopeDigest: string;
  readonly confirmationDigest: string;
  readonly kind: ExecutableAutomationChildKind;
  readonly order: number;
  readonly scopeDigest: string;
  readonly repositoryRoot: string;
  readonly reviewedTargetSnapshotId: string;
  readonly currentTargetSnapshotId: string;
  readonly sessionId: string;
  readonly taskId: string;
  readonly planRevision: string;
  readonly authorityId: string;
  readonly provider: "claude" | "codex";
  readonly repairEnvironment: AutomationRepairEnvironment | null;
  readonly digest: string;
}

export interface AutomationReviewedChildRecipe {
  /** Host-local identifier only; it is never interpreted as a route, prompt, executable, or argument list. */
  readonly id: string;
  /** Digest of the separately configured host recipe. */
  readonly digest: string;
  /** Exact typed output contract expected from the host backend. */
  readonly resultContractDigest: string;
}

export interface ReviewedAutomationChildArtifact {
  readonly schema: "sxsy-b122.reviewed-automation-child-artifact";
  readonly version: 1;
  readonly id: string;
  readonly digest: string;
  readonly binding: AutomationChildArtifactBinding;
  readonly recipe: AutomationReviewedChildRecipe;
  readonly compensation: "none" | "safe_exact";
}

export interface AutomationChildArtifactResolver {
  resolve(binding: AutomationChildArtifactBinding): Promise<ReviewedAutomationChildArtifact | undefined>;
}

export interface AutomationChildExecutionFence {
  assertContained(input: Readonly<{ binding: AutomationChildArtifactBinding; artifact: ReviewedAutomationChildArtifact }>): Promise<void>;
  /** Must observe the exact latest accepted TargetSnapshot immediately before backend entry. */
  assertFinalCurrent(input: Readonly<{ binding: AutomationChildArtifactBinding; artifact: ReviewedAutomationChildArtifact }>): Promise<void>;
}

export type AutomationChildPrerequisiteReason =
  | "repository_recipe_not_configured"
  | "local_tool_not_configured"
  | "sandbox_not_configured"
  | "test_environment_not_available"
  | "account_not_configured"
  | "credential_not_configured"
  | "network_not_configured";

export interface AutomationChildHostRequest<K extends ExecutableAutomationChildKind = ExecutableAutomationChildKind> {
  readonly kind: K;
  readonly binding: Readonly<AutomationChildArtifactBinding & { kind: K }>;
  readonly artifact: Readonly<ReviewedAutomationChildArtifact & { binding: Readonly<AutomationChildArtifactBinding & { kind: K }> }>;
  readonly repairEnvironment: AutomationRepairEnvironment | null;
}

export type AutomationChildHostResult<K extends ExecutableAutomationChildKind = ExecutableAutomationChildKind> =
  | Readonly<{
      status: "committed";
      kind: K;
      artifactId: string;
      artifactDigest: string;
      bindingDigest: string;
      sourceTargetSnapshotId: string;
      scopeDigest: string;
      resultContractDigest: string;
      outputId: string;
      outputDigest: string;
      compensationToken: string | null;
    }>
  | Readonly<{
      status: "prerequisite_unavailable";
      kind: K;
      artifactId: string;
      artifactDigest: string;
      bindingDigest: string;
      sourceTargetSnapshotId: string;
      scopeDigest: string;
      resultContractDigest: string;
      reason: AutomationChildPrerequisiteReason;
    }>;

export interface AutomationChildHostCompensationRequest<K extends ExecutableAutomationChildKind = ExecutableAutomationChildKind>
  extends AutomationChildHostRequest<K> {
  readonly compensationToken: string;
}

export interface AutomationChildHostCompensationResult<K extends ExecutableAutomationChildKind = ExecutableAutomationChildKind> {
  readonly status: "compensated";
  readonly kind: K;
  readonly artifactId: string;
  readonly artifactDigest: string;
  readonly bindingDigest: string;
  readonly sourceTargetSnapshotId: string;
  readonly scopeDigest: string;
  readonly resultContractDigest: string;
  readonly compensationTokenDigest: string;
  readonly outputId: string;
  readonly outputDigest: string;
}

export interface AutomationTypedChildBackend<K extends ExecutableAutomationChildKind = ExecutableAutomationChildKind> {
  readonly kind: K;
  execute(input: AutomationChildHostRequest<K>): Promise<AutomationChildHostResult<K>>;
  compensate?(input: AutomationChildHostCompensationRequest<K>): Promise<AutomationChildHostCompensationResult<K>>;
}

export type AutomationTypedChildBackends = Readonly<{
  [K in ExecutableAutomationChildKind]?: AutomationTypedChildBackend<K>;
}>;

export interface ArtifactResolvingAutomationChildPortOptions {
  readonly artifacts: AutomationChildArtifactResolver;
  readonly fence: AutomationChildExecutionFence;
  readonly backends: AutomationTypedChildBackends;
}

export function automationChildArtifactBinding(input: Readonly<{
  child: AutomationEffectChild;
  envelope: AutomationEnvelope;
  currentTargetSnapshotId: string;
  repairEnvironment: AutomationRepairEnvironment | null;
}>): AutomationChildArtifactBinding {
  const envelope = parseAutomationEnvelope(input.envelope);
  const manifest = envelope.manifest;
  const proposal = manifest.proposal;
  const kind = executableKind(input.child.kind);
  if (!digest(input.currentTargetSnapshotId)) throw new Error("The automation child current TargetSnapshot binding is invalid.");
  if (proposal.kind !== "lfg" && proposal.kind !== "repair_mission") {
    throw new Error("Only reviewed LFG and Repair manifests may resolve typed automation children.");
  }
  const action = proposal.kind;
  if (manifest.action !== action) throw new Error("The automation child manifest action changed from its exact proposal.");
  if (!kindAllowed(action, kind)) throw new Error(`The ${kind} child is not authorized by the reviewed ${action} lifecycle.`);
  const plan = proposal.effectPlan;
  const exactChild = plan?.find((entry) => entry.order === input.child.order);
  if (!exactChild || exactChild.kind !== kind || exactChild.scopeDigest !== input.child.scopeDigest) {
    throw new Error("The automation child changed its exact reviewed kind, order, or scope binding.");
  }
  const repairEnvironment = exactRepairEnvironment(action, proposal, input.repairEnvironment);
  const content = {
    schema: "sxsy-b122.automation-child-artifact-binding" as const,
    version: 1 as const,
    action,
    operationId: envelope.operationId,
    manifestId: manifest.id,
    manifestDigest: manifest.digest,
    proposalDigest: envelope.intent.binding.proposalDigest,
    approvalId: envelope.approval.id,
    reviewScopeDigest: envelope.approval.reviewScopeDigest,
    confirmationDigest: envelope.approval.confirmationDigest,
    kind,
    order: exactChild.order,
    scopeDigest: exactChild.scopeDigest,
    repositoryRoot: manifest.repositoryRoot,
    reviewedTargetSnapshotId: manifest.targetSnapshotId,
    currentTargetSnapshotId: input.currentTargetSnapshotId,
    sessionId: manifest.sessionId,
    taskId: manifest.taskId,
    planRevision: manifest.planRevision,
    authorityId: manifest.authorityId,
    provider: manifest.provider as "claude" | "codex",
    repairEnvironment
  };
  return deepFreeze({ ...content, digest: sha256(stableJson(content)) });
}

export function createReviewedAutomationChildArtifact(input: Readonly<{
  binding: AutomationChildArtifactBinding;
  recipe: AutomationReviewedChildRecipe;
  compensation: "none" | "safe_exact";
}>): ReviewedAutomationChildArtifact {
  const binding = parseAutomationChildArtifactBinding(input.binding);
  const recipe = parseRecipe(input.recipe);
  if (input.compensation !== "none" && input.compensation !== "safe_exact") {
    throw new Error("The reviewed automation child artifact compensation mode is invalid.");
  }
  if (input.compensation === "safe_exact" && binding.kind !== "git_commit") {
    throw new Error("Only the exact local git_commit backend may advertise safe child compensation.");
  }
  const content = {
    schema: "sxsy-b122.reviewed-automation-child-artifact" as const,
    version: 1 as const,
    binding,
    recipe,
    compensation: input.compensation
  };
  const artifactDigest = sha256(stableJson(content));
  return deepFreeze({ ...content, id: `automation-child-artifact:${artifactDigest}`, digest: artifactDigest });
}

export class ConfiguredAutomationChildArtifactResolver implements AutomationChildArtifactResolver {
  private readonly artifacts = new Map<string, ReviewedAutomationChildArtifact>();

  constructor(artifacts: readonly ReviewedAutomationChildArtifact[]) {
    for (const raw of artifacts) {
      const artifact = parseReviewedAutomationChildArtifact(raw);
      if (this.artifacts.has(artifact.binding.digest)) {
        throw new Error("The host configuration contains multiple reviewed artifacts for one exact automation child binding.");
      }
      this.artifacts.set(artifact.binding.digest, artifact);
    }
  }

  async resolve(bindingValue: AutomationChildArtifactBinding): Promise<ReviewedAutomationChildArtifact | undefined> {
    const binding = parseAutomationChildArtifactBinding(bindingValue);
    const artifact = this.artifacts.get(binding.digest);
    if (artifact && stableJson(artifact.binding) !== stableJson(binding)) {
      throw new Error("The reviewed automation child artifact binding digest collided with different binding material.");
    }
    return artifact;
  }
}

export function createArtifactResolvingAutomationChildPorts(options: ArtifactResolvingAutomationChildPortOptions): AutomationChildEffectPorts {
  const entries = executableAutomationChildKinds.map((kind) => [kind, new ArtifactResolvingAutomationChildPort(kind, options)] as const);
  return Object.freeze(Object.fromEntries(entries)) as AutomationChildEffectPorts;
}

class ArtifactResolvingAutomationChildPort<K extends ExecutableAutomationChildKind> implements AutomationChildEffectPort<K> {
  constructor(private readonly kind: K, private readonly options: ArtifactResolvingAutomationChildPortOptions) {}

  async execute(input: Readonly<{
    child: Readonly<AutomationEffectChild & { kind: K }>;
    envelope: AutomationEnvelope;
    currentTargetSnapshotId: string;
    repairEnvironment: AutomationRepairEnvironment | null;
  }>): Promise<AutomationChildEffectResult> {
    if (input.child.kind !== this.kind) throw new Error("The typed automation child port received another child kind.");
    const binding = automationChildArtifactBinding(input);
    const rawArtifact = await this.options.artifacts.resolve(binding);
    if (!rawArtifact) return notStarted(binding, null, "artifact_not_configured");
    const artifact = parseReviewedAutomationChildArtifact(rawArtifact);
    assertArtifactBinding(artifact, binding);
    const backend = this.options.backends[this.kind] as AutomationTypedChildBackend<K> | undefined;
    if (!backend) return notStarted(binding, artifact, "backend_not_configured");
    if (backend.kind !== this.kind) throw new Error("The typed automation child backend changed its configured kind.");
    await this.options.fence.assertContained({ binding, artifact });
    await this.options.fence.assertFinalCurrent({ binding, artifact });
    const request = deepFreeze({
      kind: this.kind,
      binding: binding as Readonly<AutomationChildArtifactBinding & { kind: K }>,
      artifact: artifact as Readonly<ReviewedAutomationChildArtifact & { binding: Readonly<AutomationChildArtifactBinding & { kind: K }> }>,
      repairEnvironment: binding.repairEnvironment
    });
    const result = parseHostResult(await backend.execute(request), this.kind, binding, artifact);
    if (result.status === "prerequisite_unavailable") return notStarted(binding, artifact, result.reason);
    const supportsCompensation = artifact.compensation === "safe_exact" && typeof backend.compensate === "function";
    if (artifact.compensation === "safe_exact" && !supportsCompensation) {
      throw new Error("The reviewed git_commit artifact requires an exact safe compensation backend.");
    }
    if ((supportsCompensation && !identifier(result.compensationToken)) || (!supportsCompensation && result.compensationToken !== null)) {
      throw new Error("The typed automation child backend returned an invalid or unsupported compensation token.");
    }
    return deepFreeze({
      sourceTargetSnapshotId: binding.currentTargetSnapshotId,
      scopeDigest: binding.scopeDigest,
      evidenceDigest: childEvidenceDigest(binding, artifact, {
        status: "committed",
        outputId: result.outputId,
        outputDigest: result.outputDigest,
        compensationTokenDigest: result.compensationToken === null ? null : sha256(result.compensationToken)
      }),
      effectDisposition: "committed" as const,
      compensationToken: result.compensationToken
    });
  }

  async compensate(input: Readonly<{
    child: Readonly<AutomationEffectChild & { kind: K }>;
    envelope: AutomationEnvelope;
    currentTargetSnapshotId: string;
    compensationToken: string;
  }>): Promise<Readonly<{ compensated: true; sourceTargetSnapshotId: string; evidenceDigest: string }>> {
    if (input.child.kind !== this.kind || !identifier(input.compensationToken)) {
      throw new Error("The typed automation child compensation binding is invalid.");
    }
    const envelope = parseAutomationEnvelope(input.envelope);
    const proposal = envelope.manifest.proposal;
    const repairEnvironment = proposal.kind === "repair_mission" ? proposal.testEnvironment : null;
    const binding = automationChildArtifactBinding({ ...input, repairEnvironment });
    const rawArtifact = await this.options.artifacts.resolve(binding);
    if (!rawArtifact) throw new Error("The reviewed automation child compensation artifact is unavailable.");
    const artifact = parseReviewedAutomationChildArtifact(rawArtifact);
    assertArtifactBinding(artifact, binding);
    const backend = this.options.backends[this.kind] as AutomationTypedChildBackend<K> | undefined;
    if (artifact.compensation !== "safe_exact" || !backend?.compensate || backend.kind !== this.kind) {
      throw new Error("The typed automation child has no exact safe compensation backend.");
    }
    await this.options.fence.assertContained({ binding, artifact });
    await this.options.fence.assertFinalCurrent({ binding, artifact });
    const request = deepFreeze({
      kind: this.kind,
      binding: binding as Readonly<AutomationChildArtifactBinding & { kind: K }>,
      artifact: artifact as Readonly<ReviewedAutomationChildArtifact & { binding: Readonly<AutomationChildArtifactBinding & { kind: K }> }>,
      repairEnvironment: binding.repairEnvironment,
      compensationToken: input.compensationToken
    });
    const result = parseCompensationResult(await backend.compensate(request), this.kind, binding, artifact, input.compensationToken);
    return deepFreeze({
      compensated: true as const,
      sourceTargetSnapshotId: binding.currentTargetSnapshotId,
      evidenceDigest: childEvidenceDigest(binding, artifact, {
        status: "compensated",
        outputId: result.outputId,
        outputDigest: result.outputDigest,
        compensationTokenDigest: result.compensationTokenDigest
      })
    });
  }
}

function parseAutomationChildArtifactBinding(value: unknown): AutomationChildArtifactBinding {
  const keys = [
    "schema", "version", "action", "operationId", "manifestId", "manifestDigest", "proposalDigest", "approvalId",
    "reviewScopeDigest", "confirmationDigest", "kind", "order", "scopeDigest", "repositoryRoot", "reviewedTargetSnapshotId",
    "currentTargetSnapshotId", "sessionId", "taskId", "planRevision", "authorityId", "provider", "repairEnvironment", "digest"
  ];
  if (!record(value) || !exactKeys(value, keys) || value.schema !== "sxsy-b122.automation-child-artifact-binding" || value.version !== 1
    || (value.action !== "lfg" && value.action !== "repair_mission") || !identifier(value.operationId) || !identifier(value.manifestId)
    || !digest(value.manifestDigest) || !digest(value.proposalDigest) || !identifier(value.approvalId) || !digest(value.reviewScopeDigest)
    || !digest(value.confirmationDigest) || !executableAutomationChildKinds.includes(value.kind as ExecutableAutomationChildKind)
    || !Number.isSafeInteger(value.order) || Number(value.order) < 0 || Number(value.order) > 32 || !digest(value.scopeDigest)
    || typeof value.repositoryRoot !== "string" || !isAbsolute(value.repositoryRoot) || value.repositoryRoot.length > 4_096 || /[\0\r\n]/u.test(value.repositoryRoot)
    || !digest(value.reviewedTargetSnapshotId) || !digest(value.currentTargetSnapshotId) || !identifier(value.sessionId)
    || !identifier(value.taskId) || !identifier(value.planRevision) || !identifier(value.authorityId)
    || (value.provider !== "claude" && value.provider !== "codex") || !digest(value.digest)) {
    throw new Error("The reviewed automation child artifact binding is malformed.");
  }
  const repairEnvironment = parseRepairEnvironment(value.repairEnvironment);
  const { digest: bindingDigest, ...rawContent } = value;
  const content = { ...rawContent, repairEnvironment };
  if (!kindAllowed(value.action, value.kind as ExecutableAutomationChildKind)
    || (value.action === "repair_mission") !== (repairEnvironment !== null)
    || value.manifestId !== `automation-manifest:${value.manifestDigest}`
    || sha256(stableJson(content)) !== bindingDigest) {
    throw new Error("The reviewed automation child artifact binding digest or lifecycle changed.");
  }
  return deepFreeze({ ...(content as unknown as Omit<AutomationChildArtifactBinding, "digest">), digest: bindingDigest as string });
}

function parseRecipe(value: unknown): AutomationReviewedChildRecipe {
  if (!record(value) || !exactKeys(value, ["id", "digest", "resultContractDigest"]) || !identifier(value.id)
    || !digest(value.digest) || !digest(value.resultContractDigest)) {
    throw new Error("The reviewed automation child recipe contains an invalid or unexpected field.");
  }
  return deepFreeze({ id: value.id, digest: value.digest, resultContractDigest: value.resultContractDigest });
}

function parseReviewedAutomationChildArtifact(value: unknown): ReviewedAutomationChildArtifact {
  if (!record(value) || !exactKeys(value, ["schema", "version", "id", "digest", "binding", "recipe", "compensation"])
    || value.schema !== "sxsy-b122.reviewed-automation-child-artifact" || value.version !== 1 || !identifier(value.id)
    || !digest(value.digest) || (value.compensation !== "none" && value.compensation !== "safe_exact")) {
    throw new Error("The reviewed automation child artifact is malformed.");
  }
  const binding = parseAutomationChildArtifactBinding(value.binding);
  const recipe = parseRecipe(value.recipe);
  const compensation = value.compensation as "none" | "safe_exact";
  if (compensation === "safe_exact" && binding.kind !== "git_commit") {
    throw new Error("The reviewed automation child artifact smuggled an unsupported compensation route.");
  }
  const content = {
    schema: "sxsy-b122.reviewed-automation-child-artifact" as const,
    version: 1 as const,
    binding,
    recipe,
    compensation
  };
  const expectedDigest = sha256(stableJson(content));
  if (value.digest !== expectedDigest || value.id !== `automation-child-artifact:${expectedDigest}`) {
    throw new Error("The reviewed automation child artifact digest changed.");
  }
  return deepFreeze({ ...content, id: value.id, digest: value.digest });
}

function parseHostResult<K extends ExecutableAutomationChildKind>(
  value: unknown,
  kind: K,
  binding: AutomationChildArtifactBinding,
  artifact: ReviewedAutomationChildArtifact
): AutomationChildHostResult<K> {
  if (!record(value) || value.status !== "committed" && value.status !== "prerequisite_unavailable") {
    throw new Error("The typed automation child backend result is malformed.");
  }
  const commonKeys = ["status", "kind", "artifactId", "artifactDigest", "bindingDigest", "sourceTargetSnapshotId", "scopeDigest", "resultContractDigest"];
  const expectedKeys = value.status === "committed" ? [...commonKeys, "outputId", "outputDigest", "compensationToken"] : [...commonKeys, "reason"];
  if (!exactKeys(value, expectedKeys) || value.kind !== kind || value.artifactId !== artifact.id || value.artifactDigest !== artifact.digest
    || value.bindingDigest !== binding.digest || value.sourceTargetSnapshotId !== binding.currentTargetSnapshotId
    || value.scopeDigest !== binding.scopeDigest || value.resultContractDigest !== artifact.recipe.resultContractDigest) {
    throw new Error("The typed automation child backend result changed its reviewed artifact, target, scope, or result contract, or included an unexpected field.");
  }
  if (value.status === "committed") {
    if (!identifier(value.outputId) || !digest(value.outputDigest) || value.compensationToken !== null && !identifier(value.compensationToken)) {
      throw new Error("The typed automation child backend committed output is invalid.");
    }
    return deepFreeze(value as unknown as AutomationChildHostResult<K>);
  }
  if (!prerequisiteReason(value.reason)) throw new Error("The typed automation child backend prerequisite result is invalid.");
  return deepFreeze(value as unknown as AutomationChildHostResult<K>);
}

function parseCompensationResult<K extends ExecutableAutomationChildKind>(
  value: unknown,
  kind: K,
  binding: AutomationChildArtifactBinding,
  artifact: ReviewedAutomationChildArtifact,
  compensationToken: string
): AutomationChildHostCompensationResult<K> {
  const keys = [
    "status", "kind", "artifactId", "artifactDigest", "bindingDigest", "sourceTargetSnapshotId", "scopeDigest",
    "resultContractDigest", "compensationTokenDigest", "outputId", "outputDigest"
  ];
  if (!record(value) || !exactKeys(value, keys) || value.status !== "compensated" || value.kind !== kind
    || value.artifactId !== artifact.id || value.artifactDigest !== artifact.digest || value.bindingDigest !== binding.digest
    || value.sourceTargetSnapshotId !== binding.currentTargetSnapshotId || value.scopeDigest !== binding.scopeDigest
    || value.resultContractDigest !== artifact.recipe.resultContractDigest || value.compensationTokenDigest !== sha256(compensationToken)
    || !identifier(value.outputId) || !digest(value.outputDigest)) {
    throw new Error("The typed automation child compensation result changed its exact artifact, token, target, scope, or output contract.");
  }
  return deepFreeze(value as unknown as AutomationChildHostCompensationResult<K>);
}

function notStarted(
  binding: AutomationChildArtifactBinding,
  artifact: ReviewedAutomationChildArtifact | null,
  reason: AutomationChildPrerequisiteReason | "artifact_not_configured" | "backend_not_configured"
): AutomationChildEffectResult {
  return deepFreeze({
    sourceTargetSnapshotId: binding.currentTargetSnapshotId,
    scopeDigest: binding.scopeDigest,
    evidenceDigest: childEvidenceDigest(binding, artifact, { status: "not_started", reason }),
    effectDisposition: "not_started" as const,
    compensationToken: null
  });
}

function childEvidenceDigest(
  binding: AutomationChildArtifactBinding,
  artifact: ReviewedAutomationChildArtifact | null,
  outcome: Readonly<Record<string, unknown>>
): string {
  return sha256(stableJson({
    schema: "sxsy-b122.automation-child-host-evidence",
    version: 1,
    bindingDigest: binding.digest,
    artifactId: artifact?.id ?? null,
    artifactDigest: artifact?.digest ?? null,
    recipeId: artifact?.recipe.id ?? null,
    recipeDigest: artifact?.recipe.digest ?? null,
    resultContractDigest: artifact?.recipe.resultContractDigest ?? null,
    outcome
  }));
}

function assertArtifactBinding(artifact: ReviewedAutomationChildArtifact, binding: AutomationChildArtifactBinding): void {
  if (artifact.binding.digest !== binding.digest || stableJson(artifact.binding) !== stableJson(binding)) {
    throw new Error("The resolved reviewed automation child artifact changed its exact binding.");
  }
}

function exactRepairEnvironment(
  action: AutomationChildAction,
  proposal: AutomationOperationProposal,
  supplied: AutomationRepairEnvironment | null
): AutomationRepairEnvironment | null {
  if (action === "lfg") {
    if (supplied !== null) throw new Error("LFG automation children cannot carry a Repair environment binding.");
    return null;
  }
  if (proposal.kind !== "repair_mission") throw new Error("The Repair child proposal binding changed.");
  const exact = parseRepairEnvironment(supplied);
  if (!exact || stableJson(exact) !== stableJson(proposal.testEnvironment)) {
    throw new Error("The Repair child deny-egress environment changed from its exact reviewed binding.");
  }
  return exact;
}

function parseRepairEnvironment(value: unknown): AutomationRepairEnvironment | null {
  if (value === null) return null;
  if (!record(value) || !exactKeys(value, ["id", "digest", "egress", "databaseName"]) || !identifier(value.id)
    || !digest(value.digest) || value.egress !== "deny" || !identifier(value.databaseName)) {
    throw new Error("The automation child Repair environment binding is malformed.");
  }
  return deepFreeze({ id: value.id, digest: value.digest, egress: "deny", databaseName: value.databaseName });
}

function kindAllowed(action: AutomationChildAction, kind: ExecutableAutomationChildKind): boolean {
  return action === "lfg" ? lfgKinds.has(kind) : repairKinds.has(kind);
}

function executableKind(value: AutomationEffectChildKind): ExecutableAutomationChildKind {
  if (!executableAutomationChildKinds.includes(value as ExecutableAutomationChildKind)) {
    throw new Error("Filesystem mutations require the dedicated companion filesystem port.");
  }
  return value as ExecutableAutomationChildKind;
}

function prerequisiteReason(value: unknown): value is AutomationChildPrerequisiteReason {
  return value === "repository_recipe_not_configured" || value === "local_tool_not_configured" || value === "sandbox_not_configured"
    || value === "test_environment_not_available" || value === "account_not_configured" || value === "credential_not_configured"
    || value === "network_not_configured";
}

function identifier(value: unknown): value is string {
  return typeof value === "string" && value.length > 0 && value.length <= 256 && /^[A-Za-z0-9][A-Za-z0-9._:-]*$/u.test(value);
}
function digest(value: unknown): value is string { return typeof value === "string" && /^[a-f0-9]{64}$/u.test(value); }
function record(value: unknown): value is Record<string, unknown> { return typeof value === "object" && value !== null && !Array.isArray(value); }
function exactKeys(value: Record<string, unknown>, keys: readonly string[]): boolean {
  const actual = Object.keys(value).sort();
  const expected = [...keys].sort();
  return actual.length === expected.length && actual.every((key, index) => key === expected[index]);
}
function deepFreeze<T>(value: T): T {
  if (value && typeof value === "object" && !Object.isFrozen(value)) {
    for (const child of Object.values(value as Record<string, unknown>)) deepFreeze(child);
    Object.freeze(value);
  }
  return value;
}
