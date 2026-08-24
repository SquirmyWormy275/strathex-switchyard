import { randomUUID } from "node:crypto";

import { commandActionIds, type CommandAction } from "./command-catalog.ts";
import type { EffectDisposition, SessionStatus } from "./contracts.ts";
import { redactText } from "./redaction.ts";
import { jsonClone, type JournalEntry, ProtectedJsonStore, sha256, stableJson } from "./store.ts";

export type WorkflowArtifactAction =
  | "reanchor" | "proof" | "proof_adversarial" | "option_provider" | "option_packet"
  | "plan_expander" | "plan_approval" | "handoff" | "handoff_queue"
  | "focus_blocked_agent" | "focus_finished_agent" | "authority_refresh" | "authority_broadcast"
  | "bind_voice_session";
export type WorkflowArtifactStatus = "prepared" | "submitted" | "acknowledged" | "rejected" | "cancelled";

export interface AnchorWorkflowPayload { readonly kind: "anchor"; readonly contextSummary: string; readonly anchors: readonly string[]; readonly unresolved: readonly string[]; }
export interface ProofWorkflowPayload { readonly kind: "proof"; readonly claims: readonly string[]; readonly evidenceReferences: readonly string[]; readonly requiredBackends: readonly string[]; }
export interface DecisionOption { readonly id: string; readonly label: string; readonly tradeoffs: readonly string[]; readonly risks: readonly string[]; }
export interface DecisionWorkflowPayload { readonly kind: "decision"; readonly question: string; readonly options: readonly DecisionOption[]; readonly recommendationId: string; }
export interface PlanStepArtifact { readonly id: string; readonly summary: string; readonly ownedFiles: readonly string[]; readonly dependencies: readonly string[]; readonly status: "proposed" | "approved" | "completed" | "blocked"; }
export interface PlanWorkflowPayload { readonly kind: "plan"; readonly objective: string; readonly steps: readonly PlanStepArtifact[]; readonly approved: boolean; readonly approvedBy?: string; readonly approvedAt?: string; }
export interface HandoffWorkflowPayload { readonly kind: "handoff"; readonly packageId: string; readonly route: "queue" | "immediate"; readonly recipientSessionId?: string; }
export interface FocusWorkflowPayload { readonly kind: "focus"; readonly selectedSessionId: string; readonly expectedStatus: Extract<SessionStatus, "verified_blocked" | "verified_finished">; }
export interface AuthorityWorkflowPayload { readonly kind: "authority"; readonly grantId: string; readonly actions: readonly CommandAction[]; readonly recipientSessionIds: readonly string[]; }
export interface VoiceBindingWorkflowPayload { readonly kind: "voice_binding"; readonly voiceSessionId: string; readonly provider: "claude" | "codex" | "generic"; readonly contextPackageId: string; readonly consentId: string; }

export type WorkflowArtifactPayload = AnchorWorkflowPayload | ProofWorkflowPayload | DecisionWorkflowPayload | PlanWorkflowPayload | HandoffWorkflowPayload | FocusWorkflowPayload | AuthorityWorkflowPayload | VoiceBindingWorkflowPayload;

export interface WorkflowArtifactInput {
  readonly id?: string;
  readonly action: WorkflowArtifactAction;
  readonly repositoryRoot: string;
  readonly targetSnapshotId: string;
  readonly sessionId: string;
  readonly taskId?: string;
  readonly planRevision?: string;
  readonly payload: WorkflowArtifactPayload;
}

export interface WorkflowArtifact extends Omit<WorkflowArtifactInput, "id"> {
  readonly id: string;
  readonly digest: string;
  readonly status: WorkflowArtifactStatus;
  readonly operationId?: string;
  readonly providerExternalId?: string;
  readonly executionAuthorized: false;
  readonly createdAt: string;
  readonly updatedAt: string;
}

export type WorkflowProviderResult =
  | { readonly kind: "anchor"; readonly anchorDigest: string }
  | { readonly kind: "proof"; readonly verifiedClaims: readonly string[]; readonly evidenceReferences: readonly string[]; readonly backendResults: readonly { readonly backend: string; readonly status: "passed" | "failed" | "unavailable" }[] }
  | { readonly kind: "decision"; readonly selectedOptionId?: string; readonly decisionPacketId: string }
  | { readonly kind: "plan"; readonly planRevision: string; readonly acceptedStepIds: readonly string[] }
  | { readonly kind: "handoff"; readonly packageId: string; readonly recipientSessionId: string; readonly acknowledged: boolean }
  | { readonly kind: "focus"; readonly selectedSessionId: string; readonly status: Extract<SessionStatus, "verified_blocked" | "verified_finished"> }
  | { readonly kind: "authority"; readonly grantId: string; readonly acceptedRecipientSessionIds: readonly string[] }
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

  async claimForDispatch(input: Readonly<{ action: WorkflowArtifactAction; targetSnapshotId: string; sessionId: string; operationId: string }>): Promise<WorkflowArtifact | undefined> {
    return this.store.transaction(async (transaction) => {
      const entries = artifactMap(await transaction.readEntries());
      const existing = [...entries.values()].find((entry) => entry.operationId === input.operationId);
      if (existing) {
        if (existing.action !== input.action || existing.targetSnapshotId !== input.targetSnapshotId || existing.sessionId !== input.sessionId) throw new WorkflowArtifactError("The operation is already bound to a different workflow artifact scope.");
        return clone(existing);
      }
      const candidates = [...entries.values()].filter((entry) => entry.status === "prepared" && entry.action === input.action && entry.targetSnapshotId === input.targetSnapshotId && entry.sessionId === input.sessionId);
      if (candidates.length === 0) return undefined;
      if (candidates.length !== 1) throw new WorkflowArtifactError("Multiple prepared workflow artifacts match this dispatch; explicit operator selection is required.");
      const selected = candidates[0]!;
      const updated: WorkflowArtifact = { ...selected, status: "submitted", operationId: text(input.operationId, "operation id"), updatedAt: timestamp(this.clock(), "artifact clock"), executionAuthorized: false };
      await transaction.append<ArtifactSavedEvent>("workflow-artifact.saved", { artifact: updated });
      return clone(updated);
    });
  }

  async acknowledge(response: WorkflowProviderResponse): Promise<WorkflowArtifact> {
    return this.store.transaction(async (transaction) => {
      const found = artifactMap(await transaction.readEntries()).get(response.artifactId);
      if (!found) throw new WorkflowArtifactError("The provider response references an unknown workflow artifact.");
      const parsed = parseWorkflowProviderResponse(response, found);
      if (found.status === "acknowledged" && found.providerExternalId === parsed.externalId) return clone(found);
      if (found.status !== "submitted") throw new WorkflowArtifactError(`Workflow artifact is already ${found.status}.`);
      const finalStatus: WorkflowArtifactStatus = parsed.status === "completed" && parsed.effectDisposition === "committed"
        ? "acknowledged"
        : parsed.effectDisposition === "not_started"
          ? "rejected"
          : parsed.effectDisposition === "compensated"
            ? "cancelled"
            : "submitted";
      const updated: WorkflowArtifact = {
        ...found,
        status: finalStatus,
        ...(parsed.externalId ? { providerExternalId: parsed.externalId } : {}),
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
      const updated: WorkflowArtifact = { ...found, status: "cancelled", updatedAt: timestamp(this.clock(), "artifact clock"), executionAuthorized: false };
      await transaction.append<ArtifactSavedEvent>("workflow-artifact.saved", { artifact: updated });
      return clone(updated);
    });
  }
}

export function parseWorkflowProviderResponse(value: unknown, artifact: WorkflowArtifact): WorkflowProviderResponse {
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
  const result = normalizeProviderResult(value.result, artifact.payload.kind);
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

function normalizeInput(input: WorkflowArtifactInput & { readonly id: string }): Omit<WorkflowArtifact, "digest" | "status" | "operationId" | "providerExternalId" | "executionAuthorized" | "createdAt" | "updatedAt"> {
  const action = workflowAction(input.action);
  const payload = normalizePayload(input.payload, action);
  return {
    id: text(input.id, "artifact id"), action,
    repositoryRoot: text(input.repositoryRoot, "repository root"),
    targetSnapshotId: digest(input.targetSnapshotId, "target snapshot id"),
    sessionId: text(input.sessionId, "session id"),
    ...(input.taskId ? { taskId: text(input.taskId, "task id") } : {}),
    ...(input.planRevision ? { planRevision: text(input.planRevision, "plan revision") } : {}),
    payload
  };
}

function normalizePayload(payload: WorkflowArtifactPayload, action: WorkflowArtifactAction): WorkflowArtifactPayload {
  if (!payload || typeof payload !== "object" || expectedKind(action) !== payload.kind) throw new WorkflowArtifactError(`Workflow action ${action} requires a ${expectedKind(action)} payload.`);
  switch (payload.kind) {
    case "anchor": return { kind: "anchor", contextSummary: text(payload.contextSummary, "context summary"), anchors: list(payload.anchors, "anchor"), unresolved: list(payload.unresolved, "unresolved item", true) };
    case "proof": {
      const requiredBackends = list(payload.requiredBackends, "proof backend");
      if (action === "proof_adversarial" && requiredBackends.length < 2) throw new WorkflowArtifactError("Adversarial proof requires at least two explicitly named backends.");
      return { kind: "proof", claims: list(payload.claims, "proof claim"), evidenceReferences: list(payload.evidenceReferences, "evidence reference"), requiredBackends };
    }
    case "decision": {
      if (payload.options.length !== 5) throw new WorkflowArtifactError("A decision artifact requires exactly five options.");
      const options = payload.options.map((option) => ({ id: identifier(option.id, "option id"), label: text(option.label, "option label"), tradeoffs: list(option.tradeoffs, "option tradeoff"), risks: list(option.risks, "option risk") }));
      if (new Set(options.map((option) => option.id)).size !== 5) throw new WorkflowArtifactError("Decision option IDs must be unique.");
      const recommendationId = identifier(payload.recommendationId, "recommendation id");
      if (!options.some((option) => option.id === recommendationId)) throw new WorkflowArtifactError("The recommendation must reference one exact option.");
      return { kind: "decision", question: text(payload.question, "decision question"), options, recommendationId };
    }
    case "plan": {
      if (!payload.steps.length || payload.steps.length > 256) throw new WorkflowArtifactError("A plan artifact requires a bounded nonempty step list.");
      const steps = payload.steps.map((step) => ({ id: identifier(step.id, "plan step id"), summary: text(step.summary, "plan step summary"), ownedFiles: step.ownedFiles.map(safeOwnedFile), dependencies: step.dependencies.map((value) => identifier(value, "plan dependency")), status: planStepStatus(step.status) }));
      if (new Set(steps.map((step) => step.id)).size !== steps.length) throw new WorkflowArtifactError("Plan step IDs must be unique.");
      const known = new Set(steps.map((step) => step.id));
      if (steps.some((step) => step.dependencies.some((dependency) => !known.has(dependency) || dependency === step.id))) throw new WorkflowArtifactError("Plan dependencies must reference distinct known steps.");
      if (action === "plan_approval" && (!payload.approved || !payload.approvedBy || !payload.approvedAt)) throw new WorkflowArtifactError("Plan approval requires an explicitly approved revision, operator, and timestamp.");
      return { kind: "plan", objective: text(payload.objective, "plan objective"), steps, approved: payload.approved === true, ...(payload.approvedBy ? { approvedBy: text(payload.approvedBy, "plan approver") } : {}), ...(payload.approvedAt ? { approvedAt: timestamp(payload.approvedAt, "plan approval time") } : {}) };
    }
    case "handoff": {
      const route = payload.route === "queue" || payload.route === "immediate" ? payload.route : invalid("handoff route");
      if (action === "handoff_queue" && route !== "queue") throw new WorkflowArtifactError("Queued Handoff requires the queue route.");
      return { kind: "handoff", packageId: text(payload.packageId, "handoff package id"), route, ...(payload.recipientSessionId ? { recipientSessionId: text(payload.recipientSessionId, "handoff recipient") } : {}) };
    }
    case "focus": {
      const expectedStatus = payload.expectedStatus === "verified_blocked" || payload.expectedStatus === "verified_finished" ? payload.expectedStatus : invalid("focus status");
      if ((action === "focus_blocked_agent" && expectedStatus !== "verified_blocked") || (action === "focus_finished_agent" && expectedStatus !== "verified_finished")) throw new WorkflowArtifactError("Focus artifact status does not match its command action.");
      return { kind: "focus", selectedSessionId: text(payload.selectedSessionId, "selected session"), expectedStatus };
    }
    case "authority": {
      const recipientSessionIds = list(payload.recipientSessionIds, "authority recipient", true);
      if (action === "authority_broadcast" && recipientSessionIds.length === 0) throw new WorkflowArtifactError("Authority broadcast requires at least one exact recipient session.");
      return { kind: "authority", grantId: text(payload.grantId, "authority grant id"), actions: [...new Set(payload.actions.map(commandAction))], recipientSessionIds };
    }
    case "voice_binding": return { kind: "voice_binding", voiceSessionId: text(payload.voiceSessionId, "voice session id"), provider: payload.provider === "claude" || payload.provider === "codex" || payload.provider === "generic" ? payload.provider : invalid("voice provider"), contextPackageId: text(payload.contextPackageId, "voice context package id"), consentId: text(payload.consentId, "voice consent id") };
  }
}

function normalizeProviderResult(value: unknown, expected: WorkflowArtifactPayload["kind"]): WorkflowProviderResult {
  if (!record(value) || value.kind !== expected) throw new WorkflowArtifactError("The provider workflow result does not match the artifact result schema.");
  switch (expected) {
    case "proof": {
      if (!exact(value, ["kind", "verifiedClaims", "evidenceReferences", "backendResults"]) || !Array.isArray(value.verifiedClaims) || !Array.isArray(value.evidenceReferences) || !Array.isArray(value.backendResults)) throw new WorkflowArtifactError("The provider proof result is invalid.");
      const backendResults = value.backendResults.map((item) => {
        if (!record(item) || !exact(item, ["backend", "status"]) || !bounded(item.backend, 128) || !["passed", "failed", "unavailable"].includes(String(item.status))) throw new WorkflowArtifactError("The provider proof backend result is invalid.");
        return { backend: item.backend, status: item.status as "passed" | "failed" | "unavailable" };
      });
      return { kind: "proof", verifiedClaims: list(value.verifiedClaims as string[], "verified claim", true), evidenceReferences: list(value.evidenceReferences as string[], "verified evidence", true), backendResults };
    }
    case "anchor": if (exact(value, ["kind", "anchorDigest"]) && digestLike(value.anchorDigest)) return { kind: "anchor", anchorDigest: value.anchorDigest }; break;
    case "decision": if (exact(value, ["kind", "decisionPacketId", ...(value.selectedOptionId === undefined ? [] : ["selectedOptionId"])]) && bounded(value.decisionPacketId, 256) && (value.selectedOptionId === undefined || bounded(value.selectedOptionId, 128))) return { kind: "decision", decisionPacketId: value.decisionPacketId, ...(value.selectedOptionId ? { selectedOptionId: value.selectedOptionId } : {}) }; break;
    case "plan": if (exact(value, ["kind", "planRevision", "acceptedStepIds"]) && bounded(value.planRevision, 256) && Array.isArray(value.acceptedStepIds)) return { kind: "plan", planRevision: value.planRevision, acceptedStepIds: list(value.acceptedStepIds as string[], "accepted step", true) }; break;
    case "handoff": if (exact(value, ["kind", "packageId", "recipientSessionId", "acknowledged"]) && bounded(value.packageId, 256) && bounded(value.recipientSessionId, 256) && typeof value.acknowledged === "boolean") return { kind: "handoff", packageId: value.packageId, recipientSessionId: value.recipientSessionId, acknowledged: value.acknowledged }; break;
    case "focus": if (exact(value, ["kind", "selectedSessionId", "status"]) && bounded(value.selectedSessionId, 256) && (value.status === "verified_blocked" || value.status === "verified_finished")) return { kind: "focus", selectedSessionId: value.selectedSessionId, status: value.status }; break;
    case "authority": if (exact(value, ["kind", "grantId", "acceptedRecipientSessionIds"]) && bounded(value.grantId, 256) && Array.isArray(value.acceptedRecipientSessionIds)) return { kind: "authority", grantId: value.grantId, acceptedRecipientSessionIds: list(value.acceptedRecipientSessionIds as string[], "authority recipient", true) }; break;
    case "voice_binding": if (exact(value, ["kind", "bindingId", "active"]) && bounded(value.bindingId, 256) && typeof value.active === "boolean") return { kind: "voice_binding", bindingId: value.bindingId, active: value.active }; break;
  }
  throw new WorkflowArtifactError("The provider workflow result is invalid for its action.");
}

function artifactMap(entries: readonly JournalEntry<unknown>[]): Map<string, WorkflowArtifact> {
  const result = new Map<string, WorkflowArtifact>();
  for (const entry of entries) {
    if (entry.kind !== "workflow-artifact.saved") continue;
    const raw = (entry.payload as ArtifactSavedEvent | undefined)?.artifact;
    if (!raw || raw.executionAuthorized !== false || !workflowStatus(raw.status)) throw new WorkflowArtifactError("Protected workflow artifact is malformed.");
    const immutable = normalizeInput({ id: raw.id, action: raw.action, repositoryRoot: raw.repositoryRoot, targetSnapshotId: raw.targetSnapshotId, sessionId: raw.sessionId, ...(raw.taskId ? { taskId: raw.taskId } : {}), ...(raw.planRevision ? { planRevision: raw.planRevision } : {}), payload: raw.payload });
    if (artifactDigest(immutable) !== raw.digest || !timestamp(raw.createdAt, "artifact creation time") || !timestamp(raw.updatedAt, "artifact update time")) throw new WorkflowArtifactError("Protected workflow artifact digest is invalid.");
    result.set(raw.id, clone({ ...raw, ...immutable }));
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
  if (action === "handoff" || action === "handoff_queue") return "handoff";
  if (action === "focus_blocked_agent" || action === "focus_finished_agent") return "focus";
  if (action === "authority_refresh" || action === "authority_broadcast") return "authority";
  return "voice_binding";
}
function workflowAction(value: unknown): WorkflowArtifactAction { if (typeof value === "string" && ["reanchor", "proof", "proof_adversarial", "option_provider", "option_packet", "plan_expander", "plan_approval", "handoff", "handoff_queue", "focus_blocked_agent", "focus_finished_agent", "authority_refresh", "authority_broadcast", "bind_voice_session"].includes(value)) return value as WorkflowArtifactAction; return invalid("workflow action"); }
function commandAction(value: unknown): CommandAction { if (typeof value === "string" && (commandActionIds as readonly string[]).includes(value)) return value as CommandAction; return invalid("authority action"); }
function planStepStatus(value: unknown): PlanStepArtifact["status"] { if (value === "proposed" || value === "approved" || value === "completed" || value === "blocked") return value; return invalid("plan step status"); }
function workflowStatus(value: unknown): value is WorkflowArtifactStatus { return value === "prepared" || value === "submitted" || value === "acknowledged" || value === "rejected" || value === "cancelled"; }
function providerStatus(value: unknown): value is WorkflowProviderResponse["status"] { return typeof value === "string" && ["completed", "failed", "blocked", "unavailable", "running", "awaiting_input", "awaiting_confirmation"].includes(value); }
function disposition(value: unknown): value is EffectDisposition { return value === "not_started" || value === "committed" || value === "ambiguous" || value === "compensated"; }
function exact(value: Record<string, unknown>, keys: readonly string[]): boolean { return Object.keys(value).length === keys.length && keys.every((key) => key in value); }
function record(value: unknown): value is Record<string, unknown> { return typeof value === "object" && value !== null && !Array.isArray(value); }
function bounded(value: unknown, maximum: number): value is string { return typeof value === "string" && !!value.trim() && value.length <= maximum && !/[\r\n\0]/.test(value); }
function digestLike(value: unknown): value is string { return typeof value === "string" && /^[a-f0-9]{64}$/i.test(value); }
function digest(value: unknown, field: string): string { if (!digestLike(value)) throw new WorkflowArtifactError(`${field} must be a SHA-256 digest.`); return value.toLowerCase(); }
function identifier(value: unknown, field: string): string { if (typeof value !== "string" || !/^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/.test(value)) throw new WorkflowArtifactError(`${field} is invalid.`); return value; }
function text(value: unknown, field: string): string { if (!bounded(value, 16_384)) throw new WorkflowArtifactError(`${field} must be bounded nonempty text.`); return redactText(value.trim()); }
function timestamp(value: unknown, field: string): string { if (typeof value !== "string" || !Number.isFinite(Date.parse(value))) throw new WorkflowArtifactError(`${field} must be an ISO timestamp.`); return value; }
function list(values: readonly unknown[], field: string, emptyAllowed = false): readonly string[] { if (!Array.isArray(values) || values.length > 512 || (!emptyAllowed && values.length === 0)) throw new WorkflowArtifactError(`${field} list is invalid.`); return [...new Set(values.map((value) => text(value, field)))]; }
function safeOwnedFile(value: unknown): string { if (typeof value !== "string" || !value || value.length > 4_096 || /[\r\n\0]/.test(value) || /^(?:[A-Za-z]:[\\/]|[\\/])/.test(value) || value.split(/[\\/]/).some((part) => !part || part === "." || part === "..")) throw new WorkflowArtifactError("Plan owned file is unsafe."); return value.replaceAll("\\", "/"); }
function invalid(label: string): never { throw new WorkflowArtifactError(`${label} is invalid.`); }
