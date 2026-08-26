import type { EffectDisposition } from "./contracts.ts";

export type AutomationAction = "compound_capture" | "compound_refresh" | "lfg" | "repair_mission";
export interface AutomationConfirmationBinding { readonly digest: string; readonly scopeDigest: string; }
export interface AutomationTestEnvironmentBinding { readonly id: string; readonly egress: "deny"; readonly databaseName: string; }

export type AutomationIntent =
  | Readonly<{ kind: "compound_capture"; durability: "project_learning"; solvedProblemEvidenceRequired: true; verifiedOutcomeRequired: true; nonTrivialRequired: true; instructionFileMutation: "explicit_consent_only" }>
  | Readonly<{ kind: "compound_refresh"; mode: "preview_only"; audit: readonly ["drift", "overlap", "supersession", "contradiction"]; mutationApplied: false; confirmation: AutomationConfirmationBinding }>
  | Readonly<{ kind: "lfg"; lifecycle: readonly ["plan", "implement", "simplify", "review", "test", "commit", "push", "pull_request", "ci_watch"]; deployAuthorized: false; confirmation: AutomationConfirmationBinding }>
  | Readonly<{ kind: "repair_mission"; reproduceBeforeModify: true; approvedScope: "exact_target_snapshot"; testEnvironment: AutomationTestEnvironmentBinding; pushAuthorized: false; mergeAuthorized: false; deployAuthorized: false; hostedRerunAuthorized: false; productionDataAuthorized: false; confirmation: AutomationConfirmationBinding }>;

export interface AutomationEnvelope {
  readonly schema: string;
  readonly version: 1;
  readonly action: AutomationAction;
  readonly operationId: string;
  readonly target: Readonly<Record<string, unknown>>;
  readonly session: Readonly<Record<string, unknown>>;
  readonly authorityId: string;
  readonly intent: AutomationIntent;
}

export type AutomationProviderResultPayload =
  | Readonly<{ kind: "compound_capture"; captureId: string; learningDigest: string; verifiedProblemDigest: string; documents: readonly string[] }>
  | Readonly<{ kind: "compound_refresh"; previewDigest: string; affectedPaths: readonly string[]; creates: number; updates: number; deletes: number; mutationApplied: false }>
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
  readonly result: AutomationProviderResultPayload;
}
export type AutomationProviderResultFor<A extends AutomationAction> = Omit<AutomationProviderResult, "action" | "result"> & Readonly<{
  action: A;
  result: Extract<AutomationProviderResultPayload, { kind: A }>;
}>;

export function automationRequestSchema(action: AutomationAction): string { return `sxsy-b122.${action.replaceAll("_", "-")}-request`; }
export function automationResultSchema(action: AutomationAction): string { return `sxsy-b122.${action.replaceAll("_", "-")}-result`; }

export function createAutomationIntent(action: AutomationAction, confirmation?: AutomationConfirmationBinding, testEnvironment?: AutomationTestEnvironmentBinding): AutomationIntent {
  if (action === "compound_capture") {
    if (confirmation) throw new Error("Compound Capture cannot carry an unrelated confirmation binding.");
    if (testEnvironment) throw new Error("Compound Capture cannot carry a repair test environment.");
    return Object.freeze({ kind: action, durability: "project_learning", solvedProblemEvidenceRequired: true, verifiedOutcomeRequired: true, nonTrivialRequired: true, instructionFileMutation: "explicit_consent_only" });
  }
  const exactConfirmation = parseConfirmation(confirmation);
  if (action === "compound_refresh") {
    if (testEnvironment) throw new Error("Compound Refresh cannot carry a repair test environment.");
    return Object.freeze({ kind: action, mode: "preview_only", audit: Object.freeze(["drift", "overlap", "supersession", "contradiction"] as const), mutationApplied: false, confirmation: exactConfirmation });
  }
  if (action === "lfg") {
    if (testEnvironment) throw new Error("LFG cannot carry a repair test environment.");
    return Object.freeze({ kind: action, lifecycle: Object.freeze(["plan", "implement", "simplify", "review", "test", "commit", "push", "pull_request", "ci_watch"] as const), deployAuthorized: false, confirmation: exactConfirmation });
  }
  if (!testEnvironment || !identifier(testEnvironment.id) || testEnvironment.egress !== "deny" || !identifier(testEnvironment.databaseName)) throw new Error("Repair Mission requires one exact deny-egress test environment binding.");
  return Object.freeze({ kind: action, reproduceBeforeModify: true, approvedScope: "exact_target_snapshot", testEnvironment: Object.freeze({ id: testEnvironment.id, egress: "deny", databaseName: testEnvironment.databaseName }), pushAuthorized: false, mergeAuthorized: false, deployAuthorized: false, hostedRerunAuthorized: false, productionDataAuthorized: false, confirmation: exactConfirmation });
}

export function parseAutomationEnvelope(value: unknown): AutomationEnvelope {
  if (!record(value) || !exact(value, ["schema", "version", "action", "operationId", "target", "session", "authorityId", "intent"])
    || value.version !== 1 || !automationAction(value.action) || value.schema !== automationRequestSchema(value.action)
    || !identifier(value.operationId) || !record(value.target) || !record(value.session) || !identifier(value.authorityId)) throw new Error("The action-specific automation request schema or binding is invalid.");
  const intent = parseIntent(value.action, value.intent);
  return Object.freeze({ schema: value.schema, version: 1, action: value.action, operationId: value.operationId, target: Object.freeze({ ...value.target }), session: Object.freeze({ ...value.session }), authorityId: value.authorityId, intent });
}

export function parseAutomationProviderResult<A extends AutomationAction>(value: unknown, expectedAction: A, expectedExternalId: string): AutomationProviderResultFor<A> {
  if (!record(value) || !exact(value, ["schema", "version", "action", "status", "effectDisposition", "summary", "externalId", "result"])
    || value.schema !== automationResultSchema(expectedAction) || value.version !== 1 || value.action !== expectedAction
    || !status(value.status) || !disposition(value.effectDisposition) || !summary(value.summary) || value.externalId !== expectedExternalId || !identifier(value.externalId)) {
    throw new Error("The action-specific automation provider response schema or binding is invalid.");
  }
  const result = parseResult(expectedAction, value.result);
  return Object.freeze({ schema: value.schema, version: 1, action: expectedAction, status: value.status, effectDisposition: value.effectDisposition, summary: value.summary, externalId: value.externalId, result: result as Extract<AutomationProviderResultPayload, { kind: A }> });
}

function parseIntent(action: AutomationAction, value: unknown): AutomationIntent {
  if (!record(value) || value.kind !== action) throw new Error("The automation intent does not match its exact action.");
  switch (action) {
    case "compound_capture":
      if (!exact(value, ["kind", "durability", "solvedProblemEvidenceRequired", "verifiedOutcomeRequired", "nonTrivialRequired", "instructionFileMutation"]) || value.durability !== "project_learning" || value.solvedProblemEvidenceRequired !== true || value.verifiedOutcomeRequired !== true || value.nonTrivialRequired !== true || value.instructionFileMutation !== "explicit_consent_only") break;
      return createAutomationIntent(action);
    case "compound_refresh":
      if (!exact(value, ["kind", "mode", "audit", "mutationApplied", "confirmation"]) || value.mode !== "preview_only" || value.mutationApplied !== false || !exactStrings(value.audit, ["drift", "overlap", "supersession", "contradiction"])) break;
      return createAutomationIntent(action, parseConfirmation(value.confirmation));
    case "lfg":
      if (!exact(value, ["kind", "lifecycle", "deployAuthorized", "confirmation"]) || value.deployAuthorized !== false || !exactStrings(value.lifecycle, ["plan", "implement", "simplify", "review", "test", "commit", "push", "pull_request", "ci_watch"])) break;
      return createAutomationIntent(action, parseConfirmation(value.confirmation));
    case "repair_mission": {
      if (!exact(value, ["kind", "reproduceBeforeModify", "approvedScope", "testEnvironment", "pushAuthorized", "mergeAuthorized", "deployAuthorized", "hostedRerunAuthorized", "productionDataAuthorized", "confirmation"])
        || value.reproduceBeforeModify !== true || value.approvedScope !== "exact_target_snapshot" || value.pushAuthorized !== false || value.mergeAuthorized !== false || value.deployAuthorized !== false || value.hostedRerunAuthorized !== false || value.productionDataAuthorized !== false || !record(value.testEnvironment)) break;
      const environment = value.testEnvironment;
      if (!exact(environment, ["id", "egress", "databaseName"]) || !identifier(environment.id) || environment.egress !== "deny" || !identifier(environment.databaseName)) break;
      return createAutomationIntent(action, parseConfirmation(value.confirmation), { id: environment.id, egress: "deny", databaseName: environment.databaseName });
    }
  }
  throw new Error("The action-specific automation intent is invalid.");
}

function parseResult(action: AutomationAction, value: unknown): AutomationProviderResultPayload {
  if (!record(value) || value.kind !== action) throw new Error("The automation result does not match its exact action.");
  switch (action) {
    case "compound_capture":
      if (exact(value, ["kind", "captureId", "learningDigest", "verifiedProblemDigest", "documents"]) && identifier(value.captureId) && digest(value.learningDigest) && digest(value.verifiedProblemDigest) && stringList(value.documents, 256, true)) return Object.freeze({ kind: action, captureId: value.captureId, learningDigest: value.learningDigest, verifiedProblemDigest: value.verifiedProblemDigest, documents: Object.freeze([...value.documents]) });
      break;
    case "compound_refresh":
      if (exact(value, ["kind", "previewDigest", "affectedPaths", "creates", "updates", "deletes", "mutationApplied"]) && digest(value.previewDigest) && stringList(value.affectedPaths, 512) && count(value.creates) && count(value.updates) && count(value.deletes) && value.mutationApplied === false) return Object.freeze({ kind: action, previewDigest: value.previewDigest, affectedPaths: Object.freeze([...value.affectedPaths]), creates: value.creates, updates: value.updates, deletes: value.deletes, mutationApplied: false });
      break;
    case "lfg":
      if (exact(value, ["kind", "runId", "stages", "pullRequestUrl", "deploymentAttempted"]) && identifier(value.runId) && Array.isArray(value.stages) && value.stages.length >= 1 && value.stages.length <= 32 && value.deploymentAttempted === false && (value.pullRequestUrl === null || safeHttps(value.pullRequestUrl))) {
        const stages = value.stages.map((stage) => { if (!record(stage) || !exact(stage, ["name", "status", "evidenceDigest"]) || !identifier(stage.name) || (stage.status !== "passed" && stage.status !== "failed" && stage.status !== "skipped") || !digest(stage.evidenceDigest)) throw new Error("The LFG stage result is invalid."); return Object.freeze({ name: stage.name, status: stage.status, evidenceDigest: stage.evidenceDigest }); });
        return Object.freeze({ kind: action, runId: value.runId, stages: Object.freeze(stages), pullRequestUrl: value.pullRequestUrl, deploymentAttempted: false });
      }
      break;
    case "repair_mission":
      if (exact(value, ["kind", "reproduction", "approvedScopeDigest", "diffDigest", "affectedChecks", "fullChecks", "risks", "nextAction", "pushAttempted", "mergeAttempted", "deployAttempted", "hostedRerunAttempted", "productionDataUsed"]) && record(value.reproduction) && exact(value.reproduction, ["commandDigest", "status", "logsDigest"]) && digest(value.reproduction.commandDigest) && (value.reproduction.status === "reproduced" || value.reproduction.status === "not_reproduced") && digest(value.reproduction.logsDigest) && digest(value.approvedScopeDigest) && digest(value.diffDigest) && stringList(value.affectedChecks, 256) && stringList(value.fullChecks, 256) && stringList(value.risks, 128) && bounded(value.nextAction) && value.pushAttempted === false && value.mergeAttempted === false && value.deployAttempted === false && value.hostedRerunAttempted === false && value.productionDataUsed === false) return Object.freeze({ kind: action, reproduction: Object.freeze({ commandDigest: value.reproduction.commandDigest, status: value.reproduction.status, logsDigest: value.reproduction.logsDigest }), approvedScopeDigest: value.approvedScopeDigest, diffDigest: value.diffDigest, affectedChecks: Object.freeze([...value.affectedChecks]), fullChecks: Object.freeze([...value.fullChecks]), risks: Object.freeze([...value.risks]), nextAction: value.nextAction, pushAttempted: false, mergeAttempted: false, deployAttempted: false, hostedRerunAttempted: false, productionDataUsed: false });
      break;
  }
  throw new Error("The action-specific automation provider result is invalid.");
}

function parseConfirmation(value: unknown): AutomationConfirmationBinding { if (!record(value) || !exact(value, ["digest", "scopeDigest"]) || !digest(value.digest) || !digest(value.scopeDigest)) throw new Error("Automation requires one exact reviewed confirmation binding."); return Object.freeze({ digest: value.digest, scopeDigest: value.scopeDigest }); }
function automationAction(value: unknown): value is AutomationAction { return value === "compound_capture" || value === "compound_refresh" || value === "lfg" || value === "repair_mission"; }
function record(value: unknown): value is Record<string, unknown> { return typeof value === "object" && value !== null && !Array.isArray(value); }
function exact(value: Record<string, unknown>, keys: readonly string[]): boolean { return Object.keys(value).length === keys.length && keys.every((key) => Object.hasOwn(value, key)); }
function identifier(value: unknown): value is string { return typeof value === "string" && value.length > 0 && value.length <= 256 && /^[A-Za-z0-9][A-Za-z0-9._:-]*$/u.test(value); }
function digest(value: unknown): value is string { return typeof value === "string" && /^[a-f0-9]{64}$/u.test(value); }
function bounded(value: unknown): value is string { return typeof value === "string" && value.trim().length > 0 && value.length <= 512 && !/[\0\r\n]/u.test(value); }
function stringList(value: unknown, maximum: number, nonEmpty = false): value is string[] { return Array.isArray(value) && (!nonEmpty || value.length > 0) && value.length <= maximum && value.every((entry) => typeof entry === "string" && entry.length > 0 && entry.length <= 512 && !/[\0\r\n]/u.test(entry)) && new Set(value).size === value.length; }
function exactStrings(value: unknown, expected: readonly string[]): boolean { return Array.isArray(value) && value.length === expected.length && value.every((entry, index) => entry === expected[index]); }
function count(value: unknown): value is number { return Number.isSafeInteger(value) && (value as number) >= 0 && (value as number) <= 1_000_000; }
function status(value: unknown): value is AutomationProviderResult["status"] { return value === "completed" || value === "unavailable" || value === "blocked" || value === "failed" || value === "awaiting_input" || value === "awaiting_confirmation" || value === "running" || value === "cancelled" || value === "timed_out"; }
function disposition(value: unknown): value is EffectDisposition { return value === "not_started" || value === "ambiguous" || value === "committed" || value === "compensated"; }
function summary(value: unknown): value is string { return typeof value === "string" && value.length > 0 && value.length <= 512 && !/[\0\r\n]/u.test(value); }
function safeHttps(value: unknown): value is string { if (typeof value !== "string" || value.length > 2048) return false; try { const url = new URL(value); return url.protocol === "https:" && !url.username && !url.password; } catch { return false; } }
