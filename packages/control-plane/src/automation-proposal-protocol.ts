import type { AuthorityGrant, Capability, ManagedSession, TargetSnapshot } from "./contracts.ts";
import {
  parseAutomationOperationProposal,
  type AutomationManifestAction,
  type AutomationOperationProposal
} from "./automation-operation-manifest.ts";
import { sha256, stableJson } from "./store.ts";

export interface AutomationProposalTargetDocument {
  readonly id: string;
  readonly repositoryRoot: string;
  readonly canonicalRemote: string | null;
  readonly branch: string | null;
  readonly defaultBranch: string | null;
  readonly head: string | null;
  readonly indexTree: string | null;
  readonly trackedManifest: string;
  readonly untrackedManifest: string;
  readonly submodules: Readonly<Record<string, string>>;
  readonly policyVersion: string;
  readonly environmentFingerprint: string;
  readonly capturedAt: string;
  readonly completeness: "complete";
}

export interface AutomationProposalSessionDocument {
  readonly id: string;
  readonly provider: ManagedSession["provider"];
  readonly surface: ManagedSession["surface"];
  readonly capabilities: readonly Capability[];
  readonly status: "running";
  readonly workspaceRoot: string;
  readonly targetSnapshotId: string;
  readonly taskId: string;
  readonly planRevision: string;
  readonly plannedFiles: readonly string[];
  readonly adapterVersion: string;
}

export interface AutomationProposalRequest {
  readonly schema: "sxsy-b122.automation-proposal-request";
  readonly version: 1;
  readonly requestId: string;
  readonly action: AutomationManifestAction;
  readonly target: AutomationProposalTargetDocument;
  readonly session: AutomationProposalSessionDocument;
  readonly authorityId: string;
  /** Observation can propose review material; it can never authorize an effect. */
  readonly effectAuthorized: false;
}

export interface AutomationProposalResponse {
  readonly schema: "sxsy-b122.automation-proposal-response";
  readonly version: 1;
  readonly requestId: string;
  readonly action: AutomationManifestAction;
  readonly status: "completed" | "blocked" | "unavailable";
  readonly effectDisposition: "not_started";
  readonly summary: string;
  readonly proposal?: AutomationOperationProposal;
  readonly proposalDigest?: string;
}

export function createAutomationProposalRequest(input: Readonly<{
  requestId: string;
  action: AutomationManifestAction;
  target: TargetSnapshot;
  session: ManagedSession;
  authority: AuthorityGrant;
}>): AutomationProposalRequest {
  const requestId = requiredIdentifier(input.requestId, "request");
  const target = targetDocument(input.target);
  const session = sessionDocument(input.session);
  if (normalizeRoot(target.repositoryRoot) !== normalizeRoot(session.workspaceRoot) || target.id !== session.targetSnapshotId) {
    throw new Error("The automation proposal target and session binding differ.");
  }
  if (input.authority.id.length === 0 || input.authority.id.length > 256
    || normalizeRoot(input.authority.repositoryRoot) !== normalizeRoot(target.repositoryRoot)
    || input.authority.sessionId !== session.id || input.authority.taskId !== session.taskId
    || input.authority.planRevision !== session.planRevision || input.authority.revokedAt
    || !input.authority.allowedActions.includes(input.action) || input.authority.prohibitedActions.includes(input.action)) {
    throw new Error("The automation proposal authority does not match the exact action, target, session, task, and plan.");
  }
  return deepFreeze({
    schema: "sxsy-b122.automation-proposal-request",
    version: 1,
    requestId,
    action: input.action,
    target,
    session,
    authorityId: requiredIdentifier(input.authority.id, "authority"),
    effectAuthorized: false
  });
}

export function parseAutomationProposalRequest(value: unknown, expectedAction: AutomationManifestAction): AutomationProposalRequest {
  if (!record(value) || !exact(value, ["schema", "version", "requestId", "action", "target", "session", "authorityId", "effectAuthorized"])
    || value.schema !== "sxsy-b122.automation-proposal-request" || value.version !== 1 || !automationAction(value.action) || value.action !== expectedAction
    || value.effectAuthorized !== false || !record(value.target) || !record(value.session)) {
    throw new Error("The automation proposal request is malformed or contains an effect authority.");
  }
  const target = parseTargetDocument(value.target);
  const session = parseSessionDocument(value.session);
  if (normalizeRoot(target.repositoryRoot) !== normalizeRoot(session.workspaceRoot) || target.id !== session.targetSnapshotId) {
    throw new Error("The automation proposal request changed its target or session binding.");
  }
  return deepFreeze({
    schema: "sxsy-b122.automation-proposal-request",
    version: 1,
    requestId: requiredIdentifier(value.requestId, "request"),
    action: value.action,
    target,
    session,
    authorityId: requiredIdentifier(value.authorityId, "authority"),
    effectAuthorized: false
  });
}

export function createAutomationProposalResponse(input: Readonly<{
  requestId: string;
  action: AutomationManifestAction;
  status: AutomationProposalResponse["status"];
  summary: string;
  proposal?: AutomationOperationProposal;
}>): AutomationProposalResponse {
  const requestId = requiredIdentifier(input.requestId, "request");
  const summary = requiredSummary(input.summary);
  if (input.status === "completed") {
    const proposal = parseAutomationOperationProposal(input.proposal);
    if (proposal.kind !== input.action) throw new Error("The completed automation proposal has a different action.");
    return deepFreeze({
      schema: "sxsy-b122.automation-proposal-response",
      version: 1,
      requestId,
      action: input.action,
      status: input.status,
      effectDisposition: "not_started",
      summary,
      proposal,
      proposalDigest: sha256(stableJson(proposal))
    });
  }
  if (input.proposal !== undefined) throw new Error("A non-completed automation proposal response cannot carry proposal material.");
  return deepFreeze({
    schema: "sxsy-b122.automation-proposal-response",
    version: 1,
    requestId,
    action: input.action,
    status: input.status,
    effectDisposition: "not_started",
    summary
  });
}

export function parseAutomationProposalResponse(value: unknown, expectedRequestId: string, expectedAction: AutomationManifestAction): AutomationProposalResponse {
  if (!record(value) || !allowedExact(value,
    ["schema", "version", "requestId", "action", "status", "effectDisposition", "summary"],
    ["proposal", "proposalDigest"])
    || value.schema !== "sxsy-b122.automation-proposal-response" || value.version !== 1
    || value.requestId !== requiredIdentifier(expectedRequestId, "expected request") || value.action !== expectedAction
    || !proposalStatus(value.status) || value.effectDisposition !== "not_started") {
    throw new Error("The automation proposal response changed its exact request, action, status, or no-effect disposition.");
  }
  const base = {
    schema: "sxsy-b122.automation-proposal-response" as const,
    version: 1 as const,
    requestId: value.requestId,
    action: expectedAction,
    status: value.status,
    effectDisposition: "not_started" as const,
    summary: requiredSummary(value.summary)
  };
  if (value.status === "completed") {
    if (value.proposal === undefined || !digest(value.proposalDigest)) throw new Error("A completed automation proposal response lacks exact proposal material.");
    const proposal = parseAutomationOperationProposal(value.proposal);
    if (proposal.kind !== expectedAction || sha256(stableJson(proposal)) !== value.proposalDigest) {
      throw new Error("The automation proposal digest or action changed.");
    }
    return deepFreeze({ ...base, proposal, proposalDigest: value.proposalDigest });
  }
  if (value.proposal !== undefined || value.proposalDigest !== undefined) {
    throw new Error("A non-completed automation proposal response smuggled proposal material.");
  }
  return deepFreeze(base);
}

function targetDocument(value: TargetSnapshot): AutomationProposalTargetDocument {
  if (value.completeness !== "complete") throw new Error("Automation proposals require a complete exact TargetSnapshot.");
  return parseTargetDocument({
    id: value.id,
    repositoryRoot: value.repositoryRoot,
    canonicalRemote: value.canonicalRemote ?? null,
    branch: value.branch ?? null,
    defaultBranch: value.defaultBranch ?? null,
    head: value.head ?? null,
    indexTree: value.indexTree ?? null,
    trackedManifest: value.trackedManifest,
    untrackedManifest: value.untrackedManifest,
    submodules: value.submodules,
    policyVersion: value.policyVersion,
    environmentFingerprint: value.environmentFingerprint,
    capturedAt: value.capturedAt,
    completeness: "complete"
  });
}

function parseTargetDocument(value: Record<string, unknown>): AutomationProposalTargetDocument {
  if (!exact(value, [
    "id", "repositoryRoot", "canonicalRemote", "branch", "defaultBranch", "head", "indexTree", "trackedManifest", "untrackedManifest",
    "submodules", "policyVersion", "environmentFingerprint", "capturedAt", "completeness"
  ]) || !digest(value.id) || !absoluteRoot(value.repositoryRoot) || !nullableBounded(value.canonicalRemote, 2_048)
    || !nullableBranch(value.branch) || !nullableBranch(value.defaultBranch) || !nullableSha(value.head) || !nullableSha(value.indexTree)
    || !digest(value.trackedManifest) || !digest(value.untrackedManifest) || !record(value.submodules)
    || !bounded(value.policyVersion, 256) || !digest(value.environmentFingerprint) || !timestamp(value.capturedAt)
    || value.completeness !== "complete") throw new Error("The automation proposal target document is invalid.");
  const submodules: Record<string, string> = {};
  for (const [path, revision] of Object.entries(value.submodules)) {
    if (!safePath(path) || !sha(revision)) throw new Error("The automation proposal submodule binding is invalid.");
    submodules[path] = revision;
  }
  return deepFreeze({
    id: value.id,
    repositoryRoot: value.repositoryRoot,
    canonicalRemote: value.canonicalRemote as string | null,
    branch: value.branch as string | null,
    defaultBranch: value.defaultBranch as string | null,
    head: value.head as string | null,
    indexTree: value.indexTree as string | null,
    trackedManifest: value.trackedManifest,
    untrackedManifest: value.untrackedManifest,
    submodules,
    policyVersion: value.policyVersion,
    environmentFingerprint: value.environmentFingerprint,
    capturedAt: value.capturedAt,
    completeness: "complete"
  });
}

function sessionDocument(value: ManagedSession): AutomationProposalSessionDocument {
  return parseSessionDocument({
    id: value.id,
    provider: value.provider,
    surface: value.surface,
    capabilities: value.capabilities,
    status: value.status,
    workspaceRoot: value.workspaceRoot,
    targetSnapshotId: value.targetSnapshotId,
    taskId: value.taskId,
    planRevision: value.planRevision,
    plannedFiles: value.plannedFiles,
    adapterVersion: value.adapterVersion
  });
}

function parseSessionDocument(value: Record<string, unknown>): AutomationProposalSessionDocument {
  if (!exact(value, ["id", "provider", "surface", "capabilities", "status", "workspaceRoot", "targetSnapshotId", "taskId", "planRevision", "plannedFiles", "adapterVersion"])
    || !identifier(value.id) || !provider(value.provider) || !surface(value.surface) || !capabilities(value.capabilities)
    || value.status !== "running" || !absoluteRoot(value.workspaceRoot) || !digest(value.targetSnapshotId)
    || !identifier(value.taskId) || !identifier(value.planRevision) || !safePaths(value.plannedFiles) || !bounded(value.adapterVersion, 256)) {
    throw new Error("The automation proposal session document is invalid or not mediated and running.");
  }
  return deepFreeze({
    id: value.id,
    provider: value.provider,
    surface: value.surface,
    capabilities: [...value.capabilities] as Capability[],
    status: "running",
    workspaceRoot: value.workspaceRoot,
    targetSnapshotId: value.targetSnapshotId,
    taskId: value.taskId,
    planRevision: value.planRevision,
    plannedFiles: [...value.plannedFiles] as string[],
    adapterVersion: value.adapterVersion
  });
}

function capabilities(value: unknown): value is Capability[] {
  return Array.isArray(value) && value.length === 4 && new Set(value).size === 4
    && value.every((entry) => entry === "registered" || entry === "observable" || entry === "controllable" || entry === "mediated");
}
function safePaths(value: unknown): value is string[] { return Array.isArray(value) && value.length <= 512 && value.every(safePath) && new Set(value).size === value.length; }
function safePath(value: unknown): value is string { return typeof value === "string" && value.length > 0 && value.length <= 512 && !/[\0\r\n]/u.test(value) && !/^(?:[A-Za-z]:[\\/]|[\\/]{2}|\/)/u.test(value) && !value.split(/[\\/]/u).includes(".."); }
function absoluteRoot(value: unknown): value is string { return typeof value === "string" && value.length >= 2 && value.length <= 4_096 && !/[\0\r\n]/u.test(value) && /^(?:[A-Za-z]:[\\/]|[\\/]{2}[^\\/]|\/)/u.test(value); }
function normalizeRoot(value: string): string { return value.replaceAll("\\", "/").replace(/\/+$/u, "").toLowerCase(); }
function automationAction(value: unknown): value is AutomationManifestAction { return value === "compound_capture" || value === "compound_refresh" || value === "lfg" || value === "repair_mission"; }
function proposalStatus(value: unknown): value is AutomationProposalResponse["status"] { return value === "completed" || value === "blocked" || value === "unavailable"; }
function provider(value: unknown): value is ManagedSession["provider"] { return value === "claude" || value === "codex" || value === "generic" || value === "voice"; }
function surface(value: unknown): value is ManagedSession["surface"] { return value === "vscode_terminal" || value === "vscode_window" || value === "desktop" || value === "browser" || value === "bridge"; }
function record(value: unknown): value is Record<string, unknown> { return typeof value === "object" && value !== null && !Array.isArray(value); }
function exact(value: Record<string, unknown>, keys: readonly string[]): boolean { return Object.keys(value).length === keys.length && keys.every((key) => Object.hasOwn(value, key)); }
function allowedExact(value: Record<string, unknown>, required: readonly string[], optional: readonly string[]): boolean { const keys = Object.keys(value); return required.every((key) => Object.hasOwn(value, key)) && keys.every((key) => required.includes(key) || optional.includes(key)); }
function identifier(value: unknown): value is string { return typeof value === "string" && value.length > 0 && value.length <= 256 && /^[A-Za-z0-9][A-Za-z0-9._:-]*$/u.test(value); }
function requiredIdentifier(value: unknown, label: string): string { if (!identifier(value)) throw new Error(`The automation proposal ${label} identifier is invalid.`); return value; }
function digest(value: unknown): value is string { return typeof value === "string" && /^[a-f0-9]{64}$/u.test(value); }
function sha(value: unknown): value is string { return typeof value === "string" && /^[a-f0-9]{40,64}$/iu.test(value); }
function nullableSha(value: unknown): value is string | null { return value === null || sha(value); }
function branch(value: unknown): value is string { return typeof value === "string" && value.length > 0 && value.length <= 256 && /^[A-Za-z0-9][A-Za-z0-9._/-]*$/u.test(value) && !value.includes("..") && !value.endsWith("/"); }
function nullableBranch(value: unknown): value is string | null { return value === null || branch(value); }
function bounded(value: unknown, maximum: number): value is string { return typeof value === "string" && value.trim().length > 0 && value.length <= maximum && !/[\0\r\n]/u.test(value); }
function nullableBounded(value: unknown, maximum: number): value is string | null { return value === null || bounded(value, maximum); }
function timestamp(value: unknown): value is string { return typeof value === "string" && Number.isFinite(Date.parse(value)) && new Date(value).toISOString() === value; }
function requiredSummary(value: unknown): string { if (!bounded(value, 1_024)) throw new Error("The automation proposal summary is invalid."); return value; }
function deepFreeze<T>(value: T): T { if (value && typeof value === "object" && !Object.isFrozen(value)) { for (const child of Object.values(value as Record<string, unknown>)) deepFreeze(child); Object.freeze(value); } return value; }
