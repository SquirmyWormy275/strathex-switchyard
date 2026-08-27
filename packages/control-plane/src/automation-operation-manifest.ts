import { createHash } from "node:crypto";

import { canonicalRepositoryPath } from "./brokers.ts";
import { sha256, stableJson } from "./store.ts";

export type AutomationManifestAction = "compound_capture" | "compound_refresh" | "lfg" | "repair_mission";
export interface AutomationExactContent {
  readonly encoding: "base64";
  readonly byteLength: number;
  readonly data: string;
}
export type AutomationPathMutation = Readonly<{
  path: string;
  mutation: "create" | "update" | "replace" | "delete";
  /** Optionality is source-compatibility only; the strict parser requires this key and either a SHA-256 or null. */
  beforeDigest?: string | null;
  /** Optionality is source-compatibility only; the strict parser requires this key and either a SHA-256 or null. */
  afterDigest?: string | null;
  /** Exact reviewed bytes for create/update/replace; explicitly null for delete. */
  content?: AutomationExactContent | null;
}>;

export type AutomationEffectChildKind =
  | "plan" | "filesystem_mutation" | "simplify" | "review" | "test" | "git_commit" | "git_push" | "pull_request" | "ci_watch"
  | "sandbox_bind" | "reproduce" | "test_affected" | "test_full" | "review_diff";
export interface AutomationEffectChild {
  readonly order: number;
  readonly kind: AutomationEffectChildKind;
  readonly scopeDigest: string;
}

export interface AutomationManifestContext {
  readonly repositoryRoot: string;
  readonly targetSnapshotId: string;
  readonly sessionId: string;
  readonly authorityId: string;
  readonly taskId: string;
  readonly planRevision: string;
  readonly provider: string;
  readonly createdAt: string;
  readonly expiresAt: string;
}

export type AutomationOperationProposal =
  | Readonly<{
      kind: "compound_capture";
      solvedProblemEvidenceDigest: string;
      verifiedOutcomeEvidenceDigest: string;
      nonTrivialRationale: string;
      documents: readonly AutomationPathMutation[];
      instructionFileMutation:
        | Readonly<{ kind: "none" }>
        | Readonly<{ kind: "edit_existing"; path: string; beforeDigest: string; afterDigest: string; content?: AutomationExactContent }>;
    }>
  | Readonly<{
      kind: "compound_refresh";
      audit: readonly ["drift", "overlap", "supersession", "contradiction"];
      mutations: readonly AutomationPathMutation[];
      commit: Readonly<{ planned: false } | { planned: true; messageDigest: string; /** Optionality is source compatibility only. */ message?: string }>;
    }>
  | Readonly<{
      kind: "lfg";
      requirementsSources: readonly Readonly<{ path: string; digest: string }>[];
      approvedScopePaths: readonly string[];
      /** Optionality is source-compatibility only; executable manifests require exact reviewed mutations. */
      mutations?: readonly AutomationPathMutation[];
      /** Optionality is source-compatibility only; executable manifests require the exact ordered child plan. */
      effectPlan?: readonly AutomationEffectChild[];
      authorizedActions: readonly ["filesystem_mutation", "git_commit", "git_push", "pull_request", "ci_watch"];
      deployAuthorized: false;
    }>
  | Readonly<{
      kind: "repair_mission";
      failingGateId: string;
      reproductionCommandDigest: string;
      approvedScopePaths: readonly string[];
      /** Optionality is source-compatibility only; executable manifests require exact reviewed mutations. */
      mutations?: readonly AutomationPathMutation[];
      affectedChecks: readonly string[];
      fullChecks: readonly string[];
      testEnvironment: Readonly<{ id: string; digest: string; egress: "deny"; databaseName: string }>;
      /** Optionality is source-compatibility only; executable manifests require the exact ordered child plan. */
      effectPlan?: readonly AutomationEffectChild[];
      pushAuthorized: false;
      mergeAuthorized: false;
      deployAuthorized: false;
      hostedRerunAuthorized: false;
      productionDataAuthorized: false;
    }>;

export interface AutomationOperationManifest extends AutomationManifestContext {
  readonly schema: "sxsy-b122.automation-operation-manifest";
  readonly version: 1;
  readonly id: string;
  readonly digest: string;
  readonly action: AutomationManifestAction;
  readonly proposal: AutomationOperationProposal;
}

export interface AutomationManifestApproval {
  readonly schema: "sxsy-b122.automation-manifest-approval";
  readonly version: 1;
  readonly id: string;
  readonly manifestId: string;
  readonly manifestDigest: string;
  readonly reviewScopeDigest: string;
  readonly confirmationDigest: string;
  readonly action: AutomationManifestAction;
  readonly repositoryRoot: string;
  readonly targetSnapshotId: string;
  readonly sessionId: string;
  readonly authorityId: string;
  readonly taskId: string;
  readonly planRevision: string;
  readonly provider: string;
  readonly confirmedAt: string;
  readonly expiresAt: string;
}

const manifestSchema = "sxsy-b122.automation-operation-manifest" as const;
const approvalSchema = "sxsy-b122.automation-manifest-approval" as const;
const maximumLifetimeMs = 15 * 60_000;
export const maximumAutomationReviewedBytes = 4 * 1024 * 1024;
const lfgActions = ["filesystem_mutation", "git_commit", "git_push", "pull_request", "ci_watch"] as const;
const refreshAudit = ["drift", "overlap", "supersession", "contradiction"] as const;
const lfgEffectOrder = ["plan", "filesystem_mutation", "simplify", "review", "test", "git_commit", "git_push", "pull_request", "ci_watch"] as const;
const repairEffectOrder = ["sandbox_bind", "reproduce", "filesystem_mutation", "test_affected", "test_full", "review_diff"] as const;

/** Cross-host canonical path accepted by the Windows companion effect boundary. */
export function canonicalAutomationRepositoryPath(value: string): string | undefined {
  const path = canonicalRepositoryPath(value);
  return path && windowsSafeRepositoryPath(path) ? path : undefined;
}

export function createAutomationOperationManifest(context: AutomationManifestContext, proposal: AutomationOperationProposal): AutomationOperationManifest {
  const exactContext = parseContext(context);
  const exactProposal = parseProposal(proposal);
  const content = manifestContent(exactContext, exactProposal);
  const digestValue = sha256(stableJson(content));
  return deepFreeze({ ...content, id: `automation-manifest:${digestValue}`, digest: digestValue });
}

export function parseAutomationOperationManifest(value: unknown): AutomationOperationManifest {
  if (!record(value) || !exactKeys(value, [
    "schema", "version", "id", "digest", "action", "repositoryRoot", "targetSnapshotId", "sessionId", "authorityId",
    "taskId", "planRevision", "provider", "createdAt", "expiresAt", "proposal"
  ]) || value.schema !== manifestSchema || value.version !== 1 || !manifestAction(value.action) || !digest(value.digest)
    || value.id !== `automation-manifest:${value.digest}`) throw new Error("The automation operation manifest is malformed.");
  const rebuilt = createAutomationOperationManifest({
    repositoryRoot: requiredRoot(value.repositoryRoot),
    targetSnapshotId: requiredDigest(value.targetSnapshotId, "target snapshot"),
    sessionId: requiredIdentifier(value.sessionId, "session"),
    authorityId: requiredIdentifier(value.authorityId, "authority"),
    taskId: requiredIdentifier(value.taskId, "task"),
    planRevision: requiredIdentifier(value.planRevision, "plan revision"),
    provider: requiredIdentifier(value.provider, "provider"),
    createdAt: requiredTimestamp(value.createdAt, "created time"),
    expiresAt: requiredTimestamp(value.expiresAt, "expiry")
  }, parseProposal(value.proposal));
  if (rebuilt.action !== value.action || rebuilt.id !== value.id || rebuilt.digest !== value.digest) throw new Error("The automation operation manifest digest or action changed.");
  return rebuilt;
}

/** Strict public parser for untrusted provider proposal material. */
export function parseAutomationOperationProposal(value: unknown): AutomationOperationProposal {
  return parseProposal(value);
}

/** Stable digest of one strict, content-bearing filesystem mutation scope. */
export function automationMutationScopeDigest(value: readonly AutomationPathMutation[]): string {
  const mutations = parseMutations(value, "filesystem mutation scope", false);
  return sha256(stableJson({ schema: "sxsy-b122.automation-mutation-scope", version: 1, mutations }));
}

export function automationManifestReviewScopeDigest(manifest: AutomationOperationManifest): string {
  const exactManifest = parseAutomationOperationManifest(manifest);
  return sha256(stableJson({
    schema: "sxsy-b122.automation-manifest-review-scope",
    version: 1,
    manifestId: exactManifest.id,
    manifestDigest: exactManifest.digest,
    action: exactManifest.action,
    repositoryRoot: normalizeRoot(exactManifest.repositoryRoot),
    targetSnapshotId: exactManifest.targetSnapshotId,
    sessionId: exactManifest.sessionId,
    authorityId: exactManifest.authorityId,
    taskId: exactManifest.taskId,
    planRevision: exactManifest.planRevision,
    provider: exactManifest.provider,
    expiresAt: exactManifest.expiresAt,
    proposal: exactManifest.proposal
  }));
}

export function createAutomationManifestApproval(input: Readonly<{
  manifest: AutomationOperationManifest;
  confirmationToken: string;
  confirmationScopeDigest: string;
  confirmedAt: string;
  expiresAt: string;
}>): AutomationManifestApproval {
  const manifest = parseAutomationOperationManifest(input.manifest);
  const reviewScopeDigest = automationManifestReviewScopeDigest(manifest);
  if (input.confirmationScopeDigest !== reviewScopeDigest) throw new Error("The automation approval does not match the exact reviewed manifest scope.");
  const confirmationToken = bounded(input.confirmationToken, "confirmation token", 512);
  const confirmedAt = requiredTimestamp(input.confirmedAt, "confirmation time");
  const expiresAt = requiredTimestamp(input.expiresAt, "approval expiry");
  const confirmedTime = Date.parse(confirmedAt);
  const expiryTime = Date.parse(expiresAt);
  if (confirmedTime < Date.parse(manifest.createdAt) || confirmedTime >= Date.parse(manifest.expiresAt)
    || expiryTime <= confirmedTime || expiryTime > Date.parse(manifest.expiresAt) || expiryTime - confirmedTime > maximumLifetimeMs) {
    throw new Error("The automation approval lifetime is outside the exact manifest lifetime.");
  }
  return buildApproval(manifest, reviewScopeDigest, sha256(confirmationToken), confirmedAt, expiresAt);
}

export function parseAutomationManifestApproval(value: unknown, manifest: AutomationOperationManifest): AutomationManifestApproval {
  if (!record(value) || !exactKeys(value, [
    "schema", "version", "id", "manifestId", "manifestDigest", "reviewScopeDigest", "confirmationDigest", "action", "repositoryRoot",
    "targetSnapshotId", "sessionId", "authorityId", "taskId", "planRevision", "provider", "confirmedAt", "expiresAt"
  ]) || value.schema !== approvalSchema || value.version !== 1 || !digest(value.confirmationDigest) || !digest(value.reviewScopeDigest)) {
    throw new Error("The automation manifest approval is malformed.");
  }
  const exactManifest = parseAutomationOperationManifest(manifest);
  const rebuilt = buildApproval(
    exactManifest,
    requiredDigest(value.reviewScopeDigest, "review scope"),
    requiredDigest(value.confirmationDigest, "confirmation"),
    requiredTimestamp(value.confirmedAt, "confirmation time"),
    requiredTimestamp(value.expiresAt, "approval expiry")
  );
  if (Object.entries(rebuilt).some(([key, expected]) => value[key] !== expected)) throw new Error("The automation manifest approval changed its exact artifact, actor, target, or review binding.");
  const confirmedTime = Date.parse(rebuilt.confirmedAt);
  const expiryTime = Date.parse(rebuilt.expiresAt);
  if (rebuilt.reviewScopeDigest !== automationManifestReviewScopeDigest(exactManifest)
    || confirmedTime < Date.parse(exactManifest.createdAt) || confirmedTime >= Date.parse(exactManifest.expiresAt)
    || expiryTime <= confirmedTime || expiryTime > Date.parse(exactManifest.expiresAt) || expiryTime - confirmedTime > maximumLifetimeMs) {
    throw new Error("The automation manifest approval is outside its exact reviewed artifact lifetime or scope.");
  }
  return rebuilt;
}

export function assertAutomationManifestCurrent(manifest: AutomationOperationManifest, current: AutomationManifestContext, now: string): void {
  const exact = parseAutomationOperationManifest(manifest);
  const binding = parseContext(current);
  const currentTime = Date.parse(requiredTimestamp(now, "current time"));
  if (currentTime < Date.parse(exact.createdAt)) throw new Error("The automation manifest is not current yet.");
  if (currentTime >= Date.parse(exact.expiresAt)) throw new Error("The automation manifest expired before the final effect boundary.");
  if (normalizeRoot(exact.repositoryRoot) !== normalizeRoot(binding.repositoryRoot)
    || exact.targetSnapshotId !== binding.targetSnapshotId || exact.sessionId !== binding.sessionId
    || exact.authorityId !== binding.authorityId || exact.taskId !== binding.taskId
    || exact.planRevision !== binding.planRevision || exact.provider !== binding.provider) {
    throw new Error("The automation manifest no longer matches the exact current target, session, authority, task, plan, or provider binding.");
  }
}

function buildApproval(manifest: AutomationOperationManifest, reviewScopeDigest: string, confirmationDigest: string, confirmedAt: string, expiresAt: string): AutomationManifestApproval {
  const content = {
    schema: approvalSchema,
    version: 1 as const,
    manifestId: manifest.id,
    manifestDigest: manifest.digest,
    reviewScopeDigest,
    confirmationDigest,
    action: manifest.action,
    repositoryRoot: manifest.repositoryRoot,
    targetSnapshotId: manifest.targetSnapshotId,
    sessionId: manifest.sessionId,
    authorityId: manifest.authorityId,
    taskId: manifest.taskId,
    planRevision: manifest.planRevision,
    provider: manifest.provider,
    confirmedAt,
    expiresAt
  };
  return deepFreeze({ ...content, id: `automation-approval:${sha256(stableJson(content))}` });
}

function manifestContent(context: AutomationManifestContext, proposal: AutomationOperationProposal) {
  return {
    schema: manifestSchema,
    version: 1 as const,
    action: proposal.kind,
    repositoryRoot: context.repositoryRoot,
    targetSnapshotId: context.targetSnapshotId,
    sessionId: context.sessionId,
    authorityId: context.authorityId,
    taskId: context.taskId,
    planRevision: context.planRevision,
    provider: context.provider,
    createdAt: context.createdAt,
    expiresAt: context.expiresAt,
    proposal
  };
}

function parseContext(value: AutomationManifestContext): AutomationManifestContext {
  const context = {
    repositoryRoot: requiredRoot(value.repositoryRoot),
    targetSnapshotId: requiredDigest(value.targetSnapshotId, "target snapshot"),
    sessionId: requiredIdentifier(value.sessionId, "session"),
    authorityId: requiredIdentifier(value.authorityId, "authority"),
    taskId: requiredIdentifier(value.taskId, "task"),
    planRevision: requiredIdentifier(value.planRevision, "plan revision"),
    provider: requiredIdentifier(value.provider, "provider"),
    createdAt: requiredTimestamp(value.createdAt, "created time"),
    expiresAt: requiredTimestamp(value.expiresAt, "expiry")
  };
  const lifetime = Date.parse(context.expiresAt) - Date.parse(context.createdAt);
  if (lifetime < 10_000 || lifetime > maximumLifetimeMs) throw new Error("The automation manifest lifetime is outside the safe bound.");
  return deepFreeze(context);
}

function parseProposal(value: unknown): AutomationOperationProposal {
  if (!record(value) || !manifestAction(value.kind)) throw new Error("The automation operation proposal is malformed.");
  switch (value.kind) {
    case "compound_capture": {
      if (!exactKeys(value, ["kind", "solvedProblemEvidenceDigest", "verifiedOutcomeEvidenceDigest", "nonTrivialRationale", "documents", "instructionFileMutation"])
        || !digest(value.solvedProblemEvidenceDigest) || !digest(value.verifiedOutcomeEvidenceDigest)) throw new Error("The Compound Capture manifest lacks verified evidence.");
      const documents = parseMutations(value.documents, "Compound Capture documents", true);
      const instructionFileMutation = parseInstructionMutation(value.instructionFileMutation);
      requireReviewedByteBound(documents, instructionFileMutation.kind === "edit_existing" ? instructionFileMutation.content!.byteLength : 0);
      return deepFreeze({
        kind: value.kind,
        solvedProblemEvidenceDigest: value.solvedProblemEvidenceDigest,
        verifiedOutcomeEvidenceDigest: value.verifiedOutcomeEvidenceDigest,
        nonTrivialRationale: bounded(value.nonTrivialRationale, "non-trivial rationale", 4_096),
        documents,
        instructionFileMutation
      });
    }
    case "compound_refresh": {
      if (!exactKeys(value, ["kind", "audit", "mutations", "commit"]) || !exactStrings(value.audit, refreshAudit) || !record(value.commit)) throw new Error("The Compound Refresh manifest is malformed.");
      const mutations = parseMutations(value.mutations, "Compound Refresh mutation scope", true);
      let commit: Extract<AutomationOperationProposal, { kind: "compound_refresh" }>["commit"];
      if (exactKeys(value.commit, ["planned"]) && value.commit.planned === false) commit = deepFreeze({ planned: false });
      else if (exactKeys(value.commit, ["planned", "messageDigest", "message"]) && value.commit.planned === true && digest(value.commit.messageDigest)) {
        const message = bounded(value.commit.message, "Compound Refresh commit message", 512);
        if (sha256(message) !== value.commit.messageDigest) throw new Error("The Compound Refresh commit message changed from its reviewed digest.");
        commit = deepFreeze({ planned: true, messageDigest: value.commit.messageDigest, message });
      }
      else throw new Error("The Compound Refresh planned commit is malformed or missing its exact message digest.");
      return deepFreeze({ kind: value.kind, audit: refreshAudit, mutations, commit });
    }
    case "lfg": {
      if (!exactKeys(value, ["kind", "requirementsSources", "approvedScopePaths", "mutations", "effectPlan", "authorizedActions", "deployAuthorized"])
        || !exactStrings(value.authorizedActions, lfgActions) || value.deployAuthorized !== false) throw new Error("The lfg wrapper manifest is malformed.");
      if (!Array.isArray(value.requirementsSources) || value.requirementsSources.length < 1 || value.requirementsSources.length > 64) {
        throw new Error("The lfg wrapper requires one to 64 exact requirements sources.");
      }
      const requirementsSources = value.requirementsSources.map((source) => {
        if (!record(source) || !exactKeys(source, ["path", "digest"]) || !digest(source.digest)) throw new Error("The lfg requirements source is malformed.");
        return deepFreeze({ path: requiredPath(source.path, "lfg requirements source"), digest: source.digest });
      });
      requireUnique(requirementsSources.map((source) => source.path), "lfg requirements source");
      const approvedScopePaths = parsePaths(value.approvedScopePaths, "lfg approved scope", true);
      const mutations = parseMutations(value.mutations, "lfg filesystem mutation scope", true);
      requireWithinApprovedScope(mutations, approvedScopePaths, "lfg");
      const effectPlan = parseEffectPlan(value.effectPlan, lfgEffectOrder, "lfg");
      requireFilesystemChild(effectPlan, mutations, "lfg");
      return deepFreeze({ kind: value.kind, requirementsSources: deepFreeze(requirementsSources), approvedScopePaths, mutations, effectPlan, authorizedActions: lfgActions, deployAuthorized: false });
    }
    case "repair_mission": {
      if (!exactKeys(value, [
        "kind", "failingGateId", "reproductionCommandDigest", "approvedScopePaths", "mutations", "affectedChecks", "fullChecks", "testEnvironment", "effectPlan",
        "pushAuthorized", "mergeAuthorized", "deployAuthorized", "hostedRerunAuthorized", "productionDataAuthorized"
      ]) || !digest(value.reproductionCommandDigest) || !record(value.testEnvironment)
        || value.pushAuthorized !== false || value.mergeAuthorized !== false || value.deployAuthorized !== false
        || value.hostedRerunAuthorized !== false || value.productionDataAuthorized !== false) throw new Error("The Repair Mission manifest is malformed.");
      if (!exactKeys(value.testEnvironment, ["id", "digest", "egress", "databaseName"]) || !digest(value.testEnvironment.digest)
        || value.testEnvironment.egress !== "deny") throw new Error("The Repair Mission test environment must be exact and deny egress.");
      const approvedScopePaths = parsePaths(value.approvedScopePaths, "Repair Mission approved scope", true);
      const mutations = parseMutations(value.mutations, "Repair Mission filesystem mutation scope", true);
      requireWithinApprovedScope(mutations, approvedScopePaths, "Repair Mission");
      const effectPlan = parseEffectPlan(value.effectPlan, repairEffectOrder, "Repair Mission");
      requireFilesystemChild(effectPlan, mutations, "Repair Mission");
      if (effectPlan[0]!.scopeDigest !== value.testEnvironment.digest || effectPlan[1]!.scopeDigest !== value.reproductionCommandDigest) {
        throw new Error("The Repair Mission effect plan changed its exact sandbox or reproduction binding.");
      }
      return deepFreeze({
        kind: value.kind,
        failingGateId: requiredIdentifier(value.failingGateId, "failing gate"),
        reproductionCommandDigest: value.reproductionCommandDigest,
        approvedScopePaths,
        mutations,
        affectedChecks: parseNames(value.affectedChecks, "affected checks", true),
        fullChecks: parseNames(value.fullChecks, "full checks", true),
        testEnvironment: deepFreeze({
          id: requiredIdentifier(value.testEnvironment.id, "test environment"),
          digest: value.testEnvironment.digest,
          egress: "deny" as const,
          databaseName: requiredIdentifier(value.testEnvironment.databaseName, "test database")
        }),
        effectPlan,
        pushAuthorized: false,
        mergeAuthorized: false,
        deployAuthorized: false,
        hostedRerunAuthorized: false,
        productionDataAuthorized: false
      });
    }
  }
}

function parseInstructionMutation(value: unknown): Extract<AutomationOperationProposal, { kind: "compound_capture" }>["instructionFileMutation"] {
  if (!record(value)) throw new Error("The Compound Capture instruction-file mutation review is malformed.");
  if (exactKeys(value, ["kind"]) && value.kind === "none") return deepFreeze({ kind: "none" });
  if (!exactKeys(value, ["kind", "path", "beforeDigest", "afterDigest", "content"]) || value.kind !== "edit_existing"
    || !digest(value.beforeDigest) || !digest(value.afterDigest) || value.beforeDigest === value.afterDigest) {
    throw new Error("An instruction-file mutation must be one explicit edit of an existing reviewed file.");
  }
  const content = parseExactContent(value.content, value.afterDigest, "instruction-file mutation");
  return deepFreeze({ kind: "edit_existing", path: requiredPath(value.path, "instruction file"), beforeDigest: value.beforeDigest, afterDigest: value.afterDigest, content });
}

function parseMutations(value: unknown, label: string, nonEmpty: boolean): readonly AutomationPathMutation[] {
  if (!Array.isArray(value) || (nonEmpty && value.length === 0) || value.length > 512) throw new Error(`${label} requires a bounded mutation scope.`);
  const mutations = value.map((entry) => {
    if (!record(entry) || !exactKeys(entry, ["path", "mutation", "beforeDigest", "afterDigest", "content"])) throw new Error(`${label} contains a malformed path mutation.`);
    const path = requiredPath(entry.path, `${label} path`);
    const mutation = entry.mutation;
    if (!mutationKind(mutation)) throw new Error(`${label} contains an unknown mutation.`);
    const beforeDigest = entry.beforeDigest;
    const afterDigest = entry.afterDigest;
    if (mutation === "create" && (beforeDigest !== null || !digest(afterDigest))) throw new Error(`${label} create requires an explicit absent before state and one after digest.`);
    if ((mutation === "update" || mutation === "replace") && (!digest(beforeDigest) || !digest(afterDigest) || beforeDigest === afterDigest)) throw new Error(`${label} update or replace requires distinct explicit before and after digests.`);
    if (mutation === "delete" && (!digest(beforeDigest) || afterDigest !== null || entry.content !== null)) throw new Error(`${label} delete requires one before digest and explicit absent after state/content.`);
    const content = mutation === "delete" ? null : parseExactContent(entry.content, afterDigest as string, `${label} ${path}`);
    return deepFreeze({ path, mutation, beforeDigest: beforeDigest as string | null, afterDigest: afterDigest as string | null, content });
  });
  requireUnique(mutations.map((entry) => entry.path), `${label} path`);
  requireReviewedByteBound(mutations);
  return deepFreeze(mutations);
}

function parseExactContent(value: unknown, afterDigest: string, label: string): AutomationExactContent {
  if (!record(value) || !exactKeys(value, ["encoding", "byteLength", "data"]) || value.encoding !== "base64"
    || !Number.isSafeInteger(value.byteLength) || (value.byteLength as number) < 0 || (value.byteLength as number) > maximumAutomationReviewedBytes
    || typeof value.data !== "string" || value.data.length > Math.ceil(maximumAutomationReviewedBytes / 3) * 4
    || !canonicalBase64(value.data)) throw new Error(`${label} does not contain canonical bounded base64 bytes.`);
  const bytes = Buffer.from(value.data, "base64");
  if (bytes.length !== value.byteLength || createHash("sha256").update(bytes).digest("hex") !== afterDigest) {
    throw new Error(`${label} content length or SHA-256 digest changed from the reviewed bytes.`);
  }
  return deepFreeze({ encoding: "base64", byteLength: bytes.length, data: value.data });
}

function parseEffectPlan(value: unknown, expectedOrder: readonly AutomationEffectChildKind[], label: string): readonly AutomationEffectChild[] {
  if (!Array.isArray(value) || value.length !== expectedOrder.length) throw new Error(`${label} requires one exact ordered effect plan.`);
  return deepFreeze(value.map((child, order) => {
    if (!record(child) || !exactKeys(child, ["order", "kind", "scopeDigest"]) || child.order !== order
      || child.kind !== expectedOrder[order] || !digest(child.scopeDigest)) throw new Error(`${label} effect plan order or scope binding changed.`);
    return deepFreeze({ order, kind: child.kind as AutomationEffectChildKind, scopeDigest: child.scopeDigest });
  }));
}

function requireFilesystemChild(plan: readonly AutomationEffectChild[], mutations: readonly AutomationPathMutation[], label: string): void {
  const child = plan.find((entry) => entry.kind === "filesystem_mutation");
  if (!child || child.scopeDigest !== automationMutationScopeDigest(mutations)) {
    throw new Error(`${label} effect plan does not bind the exact reviewed filesystem mutations.`);
  }
}

function requireWithinApprovedScope(mutations: readonly AutomationPathMutation[], scope: readonly string[], label: string): void {
  const approved = new Set(scope);
  if (mutations.some((mutation) => !approved.has(mutation.path))) throw new Error(`${label} filesystem mutation escapes its exact approved path scope.`);
}

function requireReviewedByteBound(mutations: readonly AutomationPathMutation[], additionalBytes = 0): void {
  const total = mutations.reduce((sum, mutation) => sum + (mutation.content?.byteLength ?? 0), additionalBytes);
  if (!Number.isSafeInteger(total) || total > maximumAutomationReviewedBytes) throw new Error("The automation reviewed content exceeds the bounded total bytes.");
}

function canonicalBase64(value: string): boolean {
  if (value === "") return true;
  if (!/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/u.test(value)) return false;
  return Buffer.from(value, "base64").toString("base64") === value;
}

function parsePaths(value: unknown, label: string, nonEmpty: boolean): readonly string[] {
  if (!Array.isArray(value) || (nonEmpty && value.length === 0) || value.length > 512) throw new Error(`${label} requires a bounded path list.`);
  const paths = value.map((path) => requiredPath(path, label));
  requireUnique(paths, label);
  return deepFreeze(paths);
}

function parseNames(value: unknown, label: string, nonEmpty: boolean): readonly string[] {
  if (!Array.isArray(value) || (nonEmpty && value.length === 0) || value.length > 512) throw new Error(`${label} requires a bounded list.`);
  const names = value.map((entry) => bounded(entry, label, 512));
  requireUnique(names, label);
  return deepFreeze(names);
}

function requiredPath(value: unknown, label: string): string {
  if (typeof value !== "string") throw new Error(`${label} is not a repository-relative path.`);
  const path = canonicalAutomationRepositoryPath(value);
  if (!path) throw new Error(`${label} is not a safe repository-relative path.`);
  return path;
}

function windowsSafeRepositoryPath(value: string): boolean {
  return value.split("/").every((segment) => {
    if (!segment || /[<>:"|?*\u0000-\u001f]/u.test(segment) || /[. ]$/u.test(segment)) return false;
    const base = segment.split(".", 1)[0]!.toLowerCase();
    return !/^(?:con|prn|aux|nul|com[1-9]|lpt[1-9])$/u.test(base);
  });
}

function requiredRoot(value: unknown): string {
  if (typeof value !== "string" || value.length < 2 || value.length > 4_096 || /[\0\r\n]/u.test(value)
    || !/^(?:[A-Za-z]:[\\/]|[\\/]{2}[^\\/]|\/)/u.test(value)) throw new Error("The automation repository root is not an absolute host path.");
  return value.replace(/[\\/]+$/u, "");
}

function normalizeRoot(value: string): string { return value.replaceAll("\\", "/").replace(/\/+$/u, "").toLowerCase(); }
function requiredDigest(value: unknown, label: string): string { if (!digest(value)) throw new Error(`The automation ${label} digest is invalid.`); return value; }
function requiredIdentifier(value: unknown, label: string): string { if (!identifier(value)) throw new Error(`The automation ${label} identifier is invalid.`); return value; }
function requiredTimestamp(value: unknown, label: string): string { if (typeof value !== "string" || !Number.isFinite(Date.parse(value)) || new Date(value).toISOString() !== value) throw new Error(`The automation ${label} is invalid.`); return value; }
function bounded(value: unknown, label: string, maximum: number): string { if (typeof value !== "string" || !value.trim() || value.length > maximum || /[\0\r]/u.test(value)) throw new Error(`The automation ${label} is invalid.`); return value; }
function mutationKind(value: unknown): value is AutomationPathMutation["mutation"] { return value === "create" || value === "update" || value === "replace" || value === "delete"; }
function digest(value: unknown): value is string { return typeof value === "string" && /^[a-f0-9]{64}$/u.test(value); }
function identifier(value: unknown): value is string { return typeof value === "string" && value.length > 0 && value.length <= 256 && /^[A-Za-z0-9][A-Za-z0-9._:-]*$/u.test(value); }
function manifestAction(value: unknown): value is AutomationManifestAction { return value === "compound_capture" || value === "compound_refresh" || value === "lfg" || value === "repair_mission"; }
function record(value: unknown): value is Record<string, unknown> { return typeof value === "object" && value !== null && !Array.isArray(value); }
function exactKeys(value: Record<string, unknown>, expected: readonly string[]): boolean { const keys = Object.keys(value); return keys.length === expected.length && expected.every((key) => Object.hasOwn(value, key)); }
function exactStrings(value: unknown, expected: readonly string[]): boolean { return Array.isArray(value) && value.length === expected.length && expected.every((entry, index) => value[index] === entry); }
function requireUnique(values: readonly string[], label: string): void { if (new Set(values).size !== values.length) throw new Error(`The automation ${label} list contains duplicates after canonicalization.`); }
function deepFreeze<T>(value: T): T {
  if (value && typeof value === "object" && !Object.isFrozen(value)) {
    for (const child of Object.values(value as Record<string, unknown>)) deepFreeze(child);
    Object.freeze(value);
  }
  return value;
}
