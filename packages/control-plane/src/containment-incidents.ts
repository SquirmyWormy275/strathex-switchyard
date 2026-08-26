import { jsonClone, sha256, stableJson, type JournalEntry, type JsonStoreTransaction, ProtectedJsonStore } from "./store.ts";
import { redactText, untrustedSummary } from "./redaction.ts";

const eventKind = "containment.incident.saved.v1";
const digestPattern = /^[a-f0-9]{64}$/;
const incidentIdPattern = /^containment-incident:[a-f0-9]{64}$/;
const identifierPattern = /^[A-Za-z0-9][A-Za-z0-9_.:-]{0,255}$/;
const assessmentSteps = ["working_tree", "history", "remote"] as const;

export type ContainmentAssessmentStep = (typeof assessmentSteps)[number];
export type ContainmentAssessmentStatus = "passed" | "failed" | "unavailable" | "incomplete";
export type ContainmentExposure = "none" | "found" | "unknown";
export type ContainmentIncidentStatus = "assessing" | "assessment_incomplete" | "remediation_required" | "ready_for_release" | "released";
export type ContainmentRemediationAction = "remove_exposed_value" | "rewrite_local_history" | "add_ignore_rule";

export interface ContainmentFinding {
  readonly id: string;
  readonly relativePath: string;
  readonly credentialRelated: boolean;
}

export interface ContainmentAssessmentRequest {
  readonly schema: "sxsy-b122.containment-assessment-request";
  readonly version: 1;
  readonly incidentId: string;
  readonly repositoryRoot: string;
  readonly fenceEpoch: number;
  readonly step: ContainmentAssessmentStep;
  readonly operationId: string;
  readonly externalId: string;
  readonly egressAllowed: false;
  readonly revealSecretValues: false;
}

export interface ContainmentAssessmentResult {
  readonly schema: "sxsy-b122.containment-assessment-result";
  readonly version: 1;
  readonly incidentId: string;
  readonly repositoryRoot: string;
  readonly fenceEpoch: number;
  readonly step: ContainmentAssessmentStep;
  readonly operationId: string;
  readonly externalId: string;
  readonly effectDisposition: "committed" | "not_started" | "ambiguous";
  readonly status: ContainmentAssessmentStatus;
  readonly exposure: ContainmentExposure;
  readonly summary: string;
  readonly findings: readonly ContainmentFinding[];
}

export interface ContainmentAssessmentEffectPort {
  execute(request: ContainmentAssessmentRequest): Promise<ContainmentAssessmentResult>;
  observe(request: ContainmentAssessmentRequest): Promise<ContainmentAssessmentResult | undefined>;
}

export interface ContainmentIncidentStepState {
  readonly name: ContainmentAssessmentStep;
  readonly operationId: string;
  readonly externalId: string;
  readonly status: "pending" | "executing" | "ambiguous" | "completed";
  readonly attempts: number;
  readonly updatedAt: string;
  readonly result?: ContainmentAssessmentResult;
}

export interface ContainmentRemediationPermit {
  readonly id: string;
  readonly incidentId: string;
  readonly fenceEpoch: number;
  readonly action: ContainmentRemediationAction;
  readonly relativePaths: readonly string[];
  readonly reviewedBy: string;
  readonly issuedAt: string;
  readonly expiresAt: string;
  readonly networkAllowed: false;
  readonly credentialAccessAllowed: false;
  readonly consumedAt?: string;
}

export interface ContainmentRemediationReceipt {
  readonly id: string;
  readonly permitId: string;
  readonly incidentId: string;
  readonly fenceEpoch: number;
  readonly action: ContainmentRemediationAction;
  readonly relativePaths: readonly string[];
  readonly remediatedFindingIds: readonly string[];
  readonly evidenceDigest: string;
  readonly recordedAt: string;
}

export interface ContainmentRemediationBinding {
  readonly permitId: string;
  readonly incidentId: string;
  readonly fenceEpoch: number;
  readonly action: ContainmentRemediationAction;
  readonly relativePaths: readonly string[];
  readonly remediatedFindingIds: readonly string[];
}

export interface ContainmentRotationReview {
  readonly disposition: "complete" | "not_required";
  readonly evidenceReference: string;
  readonly evidenceDigest: string;
  readonly reviewedAt: string;
}

export interface ContainmentIncidentRecord {
  readonly version: 1;
  readonly id: string;
  readonly repositoryRoot: string;
  readonly fenceEpoch: number;
  readonly activationOperationId: string;
  readonly reason: string;
  readonly createdAt: string;
  readonly updatedAt: string;
  readonly status: ContainmentIncidentStatus;
  readonly steps: readonly ContainmentIncidentStepState[];
  readonly permits: readonly ContainmentRemediationPermit[];
  readonly receipts: readonly ContainmentRemediationReceipt[];
  readonly rotation?: ContainmentRotationReview;
  readonly releasedAt?: string;
}

export interface ContainmentIncidentActivation {
  readonly repositoryRoot: string;
  readonly fenceEpoch: number;
  readonly activationOperationId: string;
  readonly reason: string;
}

export type ContainmentIncidentLifecyclePhase = "assessment_claimed" | "assessment_effect_returned" | "assessment_persisted";

export interface DurableContainmentIncidentCoordinatorOptions {
  readonly now?: () => string;
  readonly lifecycleProbe?: (input: Readonly<{ phase: ContainmentIncidentLifecyclePhase; incidentId: string; step: ContainmentAssessmentStep }>) => Promise<void> | void;
}

interface SavedIncidentEvent { readonly record: ContainmentIncidentRecord; }

/**
 * Creates the incident in the caller's existing protected-store transaction so
 * Emergency Containment can persist the fence and its workflow atomically.
 */
export async function activateContainmentIncidentInTransaction(
  transaction: JsonStoreTransaction,
  input: ContainmentIncidentActivation,
  timestamp: string
): Promise<ContainmentIncidentRecord> {
  const exact = validateActivation(input);
  const incidents = incidentsFrom(await transaction.readEntries());
  const latest = latestForRepository(incidents.values(), exact.repositoryRoot);
  if (latest && latest.fenceEpoch > exact.fenceEpoch) throw new Error("A newer containment incident fence already exists for this repository.");
  if (latest?.fenceEpoch === exact.fenceEpoch) {
    if (latest.activationOperationId !== exact.activationOperationId) throw new Error("The containment fence epoch is already bound to another activation operation.");
    return cloneIncident(latest);
  }
  const id = `containment-incident:${sha256(stableJson({
    activationOperationId: exact.activationOperationId,
    fenceEpoch: exact.fenceEpoch,
    repositoryRoot: containmentKey(exact.repositoryRoot)
  }))}`;
  const record: ContainmentIncidentRecord = {
    version: 1,
    id,
    repositoryRoot: exact.repositoryRoot,
    fenceEpoch: exact.fenceEpoch,
    activationOperationId: exact.activationOperationId,
    reason: untrustedSummary(exact.reason, 2_048),
    createdAt: exactTimestamp(timestamp),
    updatedAt: exactTimestamp(timestamp),
    status: "assessing",
    steps: assessmentSteps.map((name) => ({
      name,
      operationId: `containment-assessment:${sha256(`${id}:${name}:operation`)}`,
      externalId: `containment-assessment:${sha256(`${id}:${name}:external`)}`,
      status: "pending" as const,
      attempts: 0,
      updatedAt: exactTimestamp(timestamp)
    })),
    permits: [],
    receipts: []
  };
  await transaction.append<SavedIncidentEvent>(eventKind, { record });
  return cloneIncident(record);
}

export class DurableContainmentIncidentCoordinator {
  private readonly store: ProtectedJsonStore;
  private readonly now: () => string;
  private readonly lifecycleProbe?: DurableContainmentIncidentCoordinatorOptions["lifecycleProbe"];

  constructor(store: ProtectedJsonStore, options: DurableContainmentIncidentCoordinatorOptions = {}) {
    this.store = store;
    this.now = options.now ?? (() => new Date().toISOString());
    this.lifecycleProbe = options.lifecycleProbe;
  }

  activate(input: ContainmentIncidentActivation): Promise<ContainmentIncidentRecord> {
    const timestamp = exactTimestamp(this.now());
    return this.store.transaction((transaction) => activateContainmentIncidentInTransaction(transaction, input, timestamp));
  }

  async get(incidentId: string): Promise<ContainmentIncidentRecord | undefined> {
    const incident = incidentsFrom(await this.store.readEntries()).get(exactIncidentId(incidentId));
    return incident ? cloneIncident(incident) : undefined;
  }

  async getForFence(repositoryRoot: string, fenceEpoch: number): Promise<ContainmentIncidentRecord | undefined> {
    const exactRoot = exactRepositoryRoot(repositoryRoot);
    if (!Number.isSafeInteger(fenceEpoch) || fenceEpoch < 1) throw new Error("The containment incident fence epoch is invalid.");
    const match = [...incidentsFrom(await this.store.readEntries()).values()].find((incident) => containmentKey(incident.repositoryRoot) === containmentKey(exactRoot) && incident.fenceEpoch === fenceEpoch);
    return match ? cloneIncident(match) : undefined;
  }

  async assess(incidentId: string, port: ContainmentAssessmentEffectPort): Promise<ContainmentIncidentRecord> {
    const exactId = exactIncidentId(incidentId);
    for (const stepName of assessmentSteps) {
      let current = await this.requireCurrent(exactId);
      let step = requireStep(current, stepName);
      if (step.status === "completed") continue;
      const request = assessmentRequest(current, step);
      let result: ContainmentAssessmentResult | undefined;

      if (step.status === "pending") {
        current = await this.update(exactId, (record) => withStep(record, stepName, {
          ...requireStep(record, stepName),
          status: "executing",
          attempts: requireStep(record, stepName).attempts + 1,
          updatedAt: exactTimestamp(this.now())
        }));
        step = requireStep(current, stepName);
        await this.probe("assessment_claimed", current, stepName);
        try {
          result = await port.execute(assessmentRequest(current, step));
        } catch {
          return this.update(exactId, (record) => withStep(record, stepName, {
            ...requireStep(record, stepName),
            status: "ambiguous",
            updatedAt: exactTimestamp(this.now())
          }));
        }
      } else {
        try { result = await port.observe(request); }
        catch { result = undefined; }
        if (!result) {
          return this.update(exactId, (record) => withStep(record, stepName, {
            ...requireStep(record, stepName),
            status: "ambiguous",
            updatedAt: exactTimestamp(this.now())
          }));
        }
      }

      const validated = validateAssessmentResult(result, assessmentRequest(current, requireStep(current, stepName)));
      await this.probe("assessment_effect_returned", current, stepName);
      if (validated.effectDisposition === "not_started") {
        await this.update(exactId, (record) => withStep(record, stepName, {
          ...requireStep(record, stepName), status: "pending", updatedAt: exactTimestamp(this.now())
        }));
        return this.requireCurrent(exactId);
      }
      if (validated.effectDisposition !== "committed") {
        return this.update(exactId, (record) => withStep(record, stepName, {
          ...requireStep(record, stepName), status: "ambiguous", updatedAt: exactTimestamp(this.now())
        }));
      }
      current = await this.update(exactId, (record) => withStep(record, stepName, {
        ...requireStep(record, stepName), status: "completed", result: validated, updatedAt: exactTimestamp(this.now())
      }));
      await this.probe("assessment_persisted", current, stepName);
    }
    return this.requireCurrent(exactId);
  }

  async issueRemediationPermit(input: Readonly<{
    incidentId: string;
    action: ContainmentRemediationAction;
    relativePaths: readonly string[];
    expiresAt: string;
    reviewedBy: string;
  }>): Promise<ContainmentRemediationPermit> {
    const exactId = exactIncidentId(input.incidentId);
    const action = remediationAction(input.action);
    const paths = exactRelativePaths(input.relativePaths);
    const reviewedBy = boundedText(input.reviewedBy, "remediation reviewer", 256);
    const expiresAt = exactTimestamp(input.expiresAt);
    const issuedAt = exactTimestamp(this.now());
    if (Date.parse(expiresAt) <= Date.parse(issuedAt)) throw new Error("The containment remediation permit is expired.");
    return this.store.transaction(async (transaction) => {
      const incidents = incidentsFrom(await transaction.readEntries());
      const current = requireCurrentIncident(incidents, exactId);
      requireLatestFence(incidents.values(), current);
      if (!current.steps.every((step) => step.status === "completed")) throw new Error("Containment assessment must be terminal before remediation is authorized.");
      const allowedPaths = new Set(allFindings(current).map((finding) => finding.relativePath.toLowerCase()));
      if (!paths.every((path) => allowedPaths.has(path.toLowerCase()))) throw new Error("The containment remediation permit names a path outside the exact findings.");
      const id = `containment-remediation-permit:${sha256(stableJson({ action, expiresAt, incidentId: exactId, paths, reviewedBy }))}`;
      const existing = current.permits.find((permit) => permit.id === id);
      if (existing) return clonePermit(existing);
      const permit: ContainmentRemediationPermit = {
        id,
        incidentId: exactId,
        fenceEpoch: current.fenceEpoch,
        action,
        relativePaths: paths,
        reviewedBy,
        issuedAt,
        expiresAt,
        networkAllowed: false,
        credentialAccessAllowed: false
      };
      const next = deriveStatus({ ...current, permits: [...current.permits, permit], updatedAt: issuedAt });
      await transaction.append<SavedIncidentEvent>(eventKind, { record: next });
      return clonePermit(permit);
    });
  }

  async recordRemediation(input: Readonly<{
    permitId: string;
    incidentId: string;
    action: ContainmentRemediationAction;
    relativePaths: readonly string[];
    remediatedFindingIds: readonly string[];
    evidenceDigest: string;
  }>): Promise<ContainmentIncidentRecord> {
    const exactId = exactIncidentId(input.incidentId);
    const action = remediationAction(input.action);
    const paths = exactRelativePaths(input.relativePaths);
    const findingIds = exactIdentifiers(input.remediatedFindingIds, "remediated finding");
    const evidenceDigest = exactDigest(input.evidenceDigest, "remediation evidence");
    return this.store.transaction(async (transaction) => {
      const incidents = incidentsFrom(await transaction.readEntries());
      const current = requireCurrentIncident(incidents, exactId);
      requireLatestFence(incidents.values(), current);
      const permit = current.permits.find((candidate) => candidate.id === input.permitId);
      if (!permit) throw new Error("The containment remediation permit is unknown.");
      if (permit.consumedAt) throw new Error("The containment remediation permit was already consumed.");
      if (Date.parse(permit.expiresAt) <= Date.parse(exactTimestamp(this.now()))) throw new Error("The containment remediation permit expired.");
      if (permit.incidentId !== exactId || permit.fenceEpoch !== current.fenceEpoch || permit.action !== action || !sameStrings(permit.relativePaths, paths)) {
        throw new Error("The containment remediation receipt changed its exact permit action or path binding.");
      }
      const findings = new Map(allFindings(current).map((finding) => [finding.id, finding]));
      if (!findingIds.length || findingIds.some((id) => !findings.has(id))) throw new Error("The containment remediation receipt names an unknown finding.");
      if (findingIds.some((id) => !paths.some((path) => path.toLowerCase() === findings.get(id)!.relativePath.toLowerCase()))) {
        throw new Error("The containment remediation finding is outside the exact permitted path.");
      }
      const recordedAt = exactTimestamp(this.now());
      const receipt: ContainmentRemediationReceipt = {
        id: `containment-remediation-receipt:${sha256(stableJson({ evidenceDigest, findingIds, permitId: permit.id }))}`,
        permitId: permit.id,
        incidentId: exactId,
        fenceEpoch: current.fenceEpoch,
        action,
        relativePaths: paths,
        remediatedFindingIds: findingIds,
        evidenceDigest,
        recordedAt
      };
      const next = deriveStatus({
        ...current,
        permits: current.permits.map((candidate) => candidate.id === permit.id ? { ...candidate, consumedAt: recordedAt } : candidate),
        receipts: [...current.receipts, receipt],
        updatedAt: recordedAt
      });
      await transaction.append<SavedIncidentEvent>(eventKind, { record: next });
      return cloneIncident(next);
    });
  }

  /** Final pre-effect validation; it does not consume the one-time permit. */
  async assertRemediationPermit(input: ContainmentRemediationBinding): Promise<ContainmentRemediationPermit> {
    const exactId = exactIncidentId(input.incidentId);
    const incidents = incidentsFrom(await this.store.readEntries());
    const current = requireCurrentIncident(incidents, exactId);
    requireLatestFence(incidents.values(), current);
    if (current.fenceEpoch !== positiveInteger(input.fenceEpoch, "containment remediation fence epoch")) throw new Error("The containment remediation permit is bound to another fence generation.");
    const permit = current.permits.find((candidate) => candidate.id === input.permitId);
    if (!permit) throw new Error("The containment remediation permit is unknown.");
    if (permit.consumedAt) throw new Error("The containment remediation permit was already consumed.");
    if (Date.parse(permit.expiresAt) <= Date.parse(exactTimestamp(this.now()))) throw new Error("The containment remediation permit expired.");
    const action = remediationAction(input.action);
    const paths = exactRelativePaths(input.relativePaths);
    const findingIds = exactIdentifiers(input.remediatedFindingIds, "remediated finding");
    const findings = new Map(allFindings(current).map((finding) => [finding.id, finding]));
    if (!findingIds.length || findingIds.some((id) => !findings.has(id))) throw new Error("The containment remediation permit names an unknown finding.");
    if (findingIds.some((id) => !paths.some((path) => path.toLowerCase() === findings.get(id)!.relativePath.toLowerCase()))) throw new Error("The containment remediation permit changed its exact finding/path binding.");
    if (permit.incidentId !== exactId || permit.fenceEpoch !== current.fenceEpoch || permit.action !== action || !sameStrings(permit.relativePaths, paths)) throw new Error("The containment remediation permit changed its exact action or path binding.");
    return clonePermit(permit);
  }

  async recordRotationReview(input: Readonly<{
    incidentId: string;
    disposition: "complete" | "not_required";
    evidenceReference: string;
    evidenceDigest: string;
  }>): Promise<ContainmentIncidentRecord> {
    const exactId = exactIncidentId(input.incidentId);
    const evidenceReference = boundedText(input.evidenceReference, "rotation evidence reference", 512);
    const evidenceDigest = exactDigest(input.evidenceDigest, "rotation evidence");
    if (input.disposition !== "complete" && input.disposition !== "not_required") throw new Error("The containment rotation disposition is invalid.");
    return this.update(exactId, (current, incidents) => {
      requireLatestFence(incidents.values(), current);
      if (input.disposition === "not_required" && allFindings(current).some((finding) => finding.credentialRelated)) {
        throw new Error("Credential-related findings require completed rotation evidence.");
      }
      const reviewedAt = exactTimestamp(this.now());
      return deriveStatus({
        ...current,
        rotation: { disposition: input.disposition, evidenceReference, evidenceDigest, reviewedAt },
        updatedAt: reviewedAt
      });
    });
  }

  async assertReadyForRelease(incidentId: string): Promise<ContainmentIncidentRecord> {
    const exactId = exactIncidentId(incidentId);
    const incidents = incidentsFrom(await this.store.readEntries());
    const current = requireCurrentIncident(incidents, exactId);
    requireLatestFence(incidents.values(), current);
    const derived = deriveStatus(current);
    if (derived.status === "assessment_incomplete" || derived.status === "assessing") throw new Error("The containment assessment is incomplete.");
    if (derived.status === "remediation_required") {
      const remediated = new Set(derived.receipts.flatMap((receipt) => receipt.remediatedFindingIds));
      if (allFindings(derived).some((finding) => !remediated.has(finding.id))) throw new Error("Containment release requires exact finding remediation receipts.");
      throw new Error("Containment release requires credential-rotation evidence.");
    }
    if (derived.status !== "ready_for_release") throw new Error("The containment incident is not ready for release.");
    return cloneIncident(derived);
  }

  async markReleased(incidentId: string): Promise<ContainmentIncidentRecord> {
    await this.assertReadyForRelease(incidentId);
    return this.update(exactIncidentId(incidentId), (current, incidents) => {
      requireLatestFence(incidents.values(), current);
      const at = exactTimestamp(this.now());
      return { ...current, status: "released", releasedAt: at, updatedAt: at };
    });
  }

  private async requireCurrent(incidentId: string): Promise<ContainmentIncidentRecord> {
    const record = await this.get(incidentId);
    if (!record) throw new Error("The containment incident is unknown.");
    return record;
  }

  private async update(
    incidentId: string,
    mutate: (record: ContainmentIncidentRecord, incidents: Map<string, ContainmentIncidentRecord>) => ContainmentIncidentRecord
  ): Promise<ContainmentIncidentRecord> {
    return this.store.transaction(async (transaction) => {
      const incidents = incidentsFrom(await transaction.readEntries());
      const current = requireCurrentIncident(incidents, incidentId);
      const next = validateIncident(deriveStatus(mutate(cloneIncident(current), incidents)));
      await transaction.append<SavedIncidentEvent>(eventKind, { record: next });
      return cloneIncident(next);
    });
  }

  private probe(phase: ContainmentIncidentLifecyclePhase, incident: ContainmentIncidentRecord, step: ContainmentAssessmentStep): Promise<void> {
    return Promise.resolve(this.lifecycleProbe?.({ phase, incidentId: incident.id, step }));
  }
}

function assessmentRequest(incident: ContainmentIncidentRecord, step: ContainmentIncidentStepState): ContainmentAssessmentRequest {
  return Object.freeze({
    schema: "sxsy-b122.containment-assessment-request",
    version: 1,
    incidentId: incident.id,
    repositoryRoot: incident.repositoryRoot,
    fenceEpoch: incident.fenceEpoch,
    step: step.name,
    operationId: step.operationId,
    externalId: step.externalId,
    egressAllowed: false,
    revealSecretValues: false
  });
}

function validateAssessmentResult(value: ContainmentAssessmentResult, expected: ContainmentAssessmentRequest): ContainmentAssessmentResult {
  if (!value || value.schema !== "sxsy-b122.containment-assessment-result" || value.version !== 1
    || value.incidentId !== expected.incidentId || containmentKey(value.repositoryRoot) !== containmentKey(expected.repositoryRoot)
    || value.fenceEpoch !== expected.fenceEpoch || value.step !== expected.step || value.operationId !== expected.operationId || value.externalId !== expected.externalId
    || !["committed", "not_started", "ambiguous"].includes(value.effectDisposition)
    || !["passed", "failed", "unavailable", "incomplete"].includes(value.status)
    || !["none", "found", "unknown"].includes(value.exposure) || !Array.isArray(value.findings) || value.findings.length > 1_024) {
    throw new Error("The containment assessment result changed its exact child binding or closed schema.");
  }
  if ((value.status === "passed") !== (value.exposure === "none") || (value.status === "failed") !== (value.exposure === "found")
    || (["unavailable", "incomplete"].includes(value.status) && value.exposure !== "unknown")) {
    throw new Error("The containment assessment status and exposure are inconsistent.");
  }
  const findings = value.findings.map((finding) => ({
    id: boundedIdentifier(finding.id, "containment finding"),
    relativePath: exactRelativePath(finding.relativePath),
    credentialRelated: finding.credentialRelated === true
  }));
  if (new Set(findings.map((finding) => finding.id)).size !== findings.length || (value.exposure === "found") !== (findings.length > 0)) {
    throw new Error("The containment assessment findings are inconsistent or duplicated.");
  }
  return {
    ...value,
    repositoryRoot: expected.repositoryRoot,
    summary: untrustedSummary(value.summary, 1_024),
    findings
  };
}

function deriveStatus(record: ContainmentIncidentRecord): ContainmentIncidentRecord {
  if (record.status === "released") return record;
  if (!record.steps.every((step) => step.status === "completed")) return { ...record, status: "assessing" };
  if (record.steps.some((step) => !step.result || step.result.status === "unavailable" || step.result.status === "incomplete" || step.result.exposure === "unknown")) {
    return { ...record, status: "assessment_incomplete" };
  }
  const findings = allFindings(record);
  const remediated = new Set(record.receipts.flatMap((receipt) => receipt.remediatedFindingIds));
  const remediationComplete = findings.every((finding) => remediated.has(finding.id));
  const rotationComplete = !!record.rotation && (record.rotation.disposition === "complete" || (!findings.some((finding) => finding.credentialRelated) && record.rotation.disposition === "not_required"));
  return { ...record, status: remediationComplete && rotationComplete ? "ready_for_release" : "remediation_required" };
}

function incidentsFrom(entries: readonly JournalEntry<unknown>[]): Map<string, ContainmentIncidentRecord> {
  const incidents = new Map<string, ContainmentIncidentRecord>();
  for (const entry of entries) {
    if (entry.kind !== eventKind) continue;
    const record = (entry.payload as SavedIncidentEvent | undefined)?.record;
    const validated = validateIncident(record);
    incidents.set(validated.id, validated);
  }
  return incidents;
}

function validateIncident(value: unknown): ContainmentIncidentRecord {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("The protected containment incident is malformed.");
  const record = value as ContainmentIncidentRecord;
  if (record.version !== 1 || !incidentIdPattern.test(record.id) || !Number.isSafeInteger(record.fenceEpoch) || record.fenceEpoch < 1
    || !Array.isArray(record.steps) || record.steps.length !== assessmentSteps.length || !Array.isArray(record.permits) || !Array.isArray(record.receipts)
    || !["assessing", "assessment_incomplete", "remediation_required", "ready_for_release", "released"].includes(record.status)) {
    throw new Error("The protected containment incident is malformed.");
  }
  exactRepositoryRoot(record.repositoryRoot);
  boundedIdentifier(record.activationOperationId, "containment activation operation");
  exactTimestamp(record.createdAt); exactTimestamp(record.updatedAt);
  const names = new Set(record.steps.map((step) => step.name));
  if (names.size !== assessmentSteps.length || assessmentSteps.some((name) => !names.has(name))) throw new Error("The protected containment incident steps are malformed.");
  return cloneIncident(record);
}

function validateActivation(input: ContainmentIncidentActivation): ContainmentIncidentActivation {
  return {
    repositoryRoot: exactRepositoryRoot(input.repositoryRoot),
    fenceEpoch: positiveInteger(input.fenceEpoch, "containment fence epoch"),
    activationOperationId: boundedIdentifier(input.activationOperationId, "containment activation operation"),
    reason: boundedText(input.reason, "containment incident reason", 2_048)
  };
}

function withStep(record: ContainmentIncidentRecord, name: ContainmentAssessmentStep, replacement: ContainmentIncidentStepState): ContainmentIncidentRecord {
  return deriveStatus({ ...record, steps: record.steps.map((step) => step.name === name ? replacement : step), updatedAt: replacement.updatedAt });
}

function requireStep(record: ContainmentIncidentRecord, name: ContainmentAssessmentStep): ContainmentIncidentStepState {
  const step = record.steps.find((candidate) => candidate.name === name);
  if (!step) throw new Error("The containment incident lacks its exact assessment child.");
  return step;
}

function allFindings(record: ContainmentIncidentRecord): readonly ContainmentFinding[] {
  return record.steps.flatMap((step) => step.result?.findings ?? []);
}

function requireCurrentIncident(incidents: Map<string, ContainmentIncidentRecord>, incidentId: string): ContainmentIncidentRecord {
  const current = incidents.get(incidentId);
  if (!current) throw new Error("The containment incident is unknown.");
  return cloneIncident(current);
}

function requireLatestFence(incidents: Iterable<ContainmentIncidentRecord>, current: ContainmentIncidentRecord): void {
  const latest = latestForRepository(incidents, current.repositoryRoot);
  if (!latest || latest.id !== current.id) throw new Error("A newer containment fence invalidated this incident, permit, or evidence.");
}

function latestForRepository(incidents: Iterable<ContainmentIncidentRecord>, repositoryRoot: string): ContainmentIncidentRecord | undefined {
  return [...incidents]
    .filter((incident) => containmentKey(incident.repositoryRoot) === containmentKey(repositoryRoot))
    .sort((left, right) => right.fenceEpoch - left.fenceEpoch)[0];
}

function cloneIncident(record: ContainmentIncidentRecord): ContainmentIncidentRecord {
  return jsonClone(record);
}

function clonePermit(permit: ContainmentRemediationPermit): ContainmentRemediationPermit {
  return jsonClone(permit);
}

function containmentKey(value: string): string { return value.replaceAll("\\", "/").replace(/\/+$/, "").toLowerCase(); }
function exactIncidentId(value: string): string { if (!incidentIdPattern.test(value)) throw new Error("The containment incident ID is invalid."); return value; }
function positiveInteger(value: number, label: string): number { if (!Number.isSafeInteger(value) || value < 1) throw new Error(`The ${label} is invalid.`); return value; }
function exactDigest(value: string, label: string): string { if (!digestPattern.test(value)) throw new Error(`The ${label} digest is invalid.`); return value; }
function boundedIdentifier(value: string, label: string): string { if (typeof value !== "string" || !identifierPattern.test(value)) throw new Error(`The ${label} identifier is invalid.`); return value; }
function boundedText(value: string, label: string, maximum: number): string { if (typeof value !== "string" || !value.trim() || value.length > maximum || /[\r\n\0]/.test(value)) throw new Error(`The ${label} is invalid.`); return redactText(value.trim()); }
function exactTimestamp(value: string): string { if (typeof value !== "string" || !Number.isFinite(Date.parse(value)) || new Date(value).toISOString() !== value) throw new Error("The containment incident timestamp is invalid."); return value; }
function exactRepositoryRoot(value: string): string { if (typeof value !== "string" || value.length > 4_096 || /[\r\n\0]/.test(value) || !/^(?:[A-Za-z]:[\\/]|\/|\\\\)/.test(value)) throw new Error("The containment incident repository root must be an exact absolute path."); return value.replaceAll("\\", "/").replace(/\/+$/, ""); }
function remediationAction(value: string): ContainmentRemediationAction { if (!(["remove_exposed_value", "rewrite_local_history", "add_ignore_rule"] as const).includes(value as ContainmentRemediationAction)) throw new Error("The containment remediation action is invalid."); return value as ContainmentRemediationAction; }
function exactRelativePath(value: string): string { const normalized = value.replaceAll("\\", "/"); if (!normalized || normalized.length > 2_048 || normalized.startsWith("/") || /^[A-Za-z]:/.test(normalized) || normalized.split("/").some((part) => !part || part === "." || part === ".." || part.toLowerCase() === ".git") || /[\r\n\0]/.test(normalized)) throw new Error("The containment remediation path is outside the repository boundary."); return normalized; }
function exactRelativePaths(values: readonly string[]): readonly string[] { if (!Array.isArray(values) || !values.length || values.length > 1_024) throw new Error("The containment remediation paths are invalid."); const paths = values.map(exactRelativePath).sort((a, b) => a.localeCompare(b)); if (new Set(paths.map((path) => path.toLowerCase())).size !== paths.length) throw new Error("The containment remediation paths are duplicated."); return paths; }
function exactIdentifiers(values: readonly string[], label: string): readonly string[] { if (!Array.isArray(values) || values.length > 1_024) throw new Error(`The ${label} identifiers are invalid.`); const result = values.map((value) => boundedIdentifier(value, label)).sort((a, b) => a.localeCompare(b)); if (new Set(result).size !== result.length) throw new Error(`The ${label} identifiers are duplicated.`); return result; }
function sameStrings(left: readonly string[], right: readonly string[]): boolean { return left.length === right.length && left.every((value, index) => value === right[index]); }
