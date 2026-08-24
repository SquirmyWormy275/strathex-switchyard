import { randomUUID } from "node:crypto";

import type { Capability, SessionStatus } from "./contracts.ts";
import { jsonClone, type JournalEntry, ProtectedJsonStore, sha256, stableJson } from "./store.ts";

export interface CouncilParticipant {
  readonly id: string;
  readonly targetSnapshotId: string;
  readonly status: SessionStatus;
  readonly capabilities: readonly Capability[];
  readonly lastHeartbeat: string;
  readonly plannedFiles: readonly string[];
  readonly resources: readonly string[];
  readonly dependencies: readonly string[];
  readonly diffDigest: string;
}

export interface CouncilConflict {
  readonly resource: string;
  readonly participants: readonly string[];
}

export interface CouncilReport {
  readonly repositoryRoot: string;
  readonly targetSnapshotId: string;
  readonly participants: readonly CouncilParticipant[];
  readonly pathConflicts: readonly CouncilConflict[];
  readonly resourceConflicts: readonly CouncilConflict[];
  readonly dependencyConflicts: readonly CouncilConflict[];
  /** True only when every participant proved it can accept a cooperative pause. */
  readonly atomic: boolean;
  readonly collectedAt: string;
}

export type CouncilEpochStatus = "awaiting_pause_acknowledgements" | "awaiting_assignment_acknowledgements" | "awaiting_resume_acknowledgements" | "active" | "aborted" | "completed";

export interface CouncilAssignment {
  readonly sessionId: string;
  readonly paths: readonly string[];
  readonly resources: readonly string[];
  /** Exact host-isolation binding acknowledged by the assigned participant. */
  readonly isolationDigest?: string;
}

export interface CouncilEpoch {
  readonly id: string;
  readonly repositoryRoot: string;
  readonly targetSnapshotId: string;
  readonly participants: readonly CouncilParticipant[];
  readonly assignments: Readonly<Record<string, CouncilAssignment>>;
  readonly pauseAcknowledgedSessionIds: readonly string[];
  readonly assignmentAcknowledgedSessionIds: readonly string[];
  readonly resumeAcknowledgedSessionIds: readonly string[];
  readonly status: CouncilEpochStatus;
  readonly createdAt: string;
  readonly updatedAt: string;
  readonly abortReason?: string;
}

export type CouncilRecommendationStatus = "prepared" | "approved" | "rejected";
export interface CouncilRecommendation {
  readonly id: string;
  readonly repositoryRoot: string;
  readonly targetSnapshotId: string;
  readonly participantSessionIds: readonly string[];
  readonly assignments: Readonly<Record<string, CouncilAssignment>>;
  readonly reportDigest: string;
  readonly digest: string;
  readonly ready: boolean;
  readonly status: CouncilRecommendationStatus;
  readonly approvalOperationId?: string;
  readonly rejectionReason?: string;
  readonly executionAuthorized: false;
  readonly createdAt: string;
  readonly updatedAt: string;
}

interface CouncilEpochSavedEvent { readonly epoch: CouncilEpoch; }
interface CouncilRecommendationSavedEvent { readonly recommendation: CouncilRecommendation; }

export class CouncilError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "CouncilError";
  }
}

const necessaryAutomaticCapabilities: readonly Capability[] = ["registered", "observable", "controllable", "mediated"];

function nonEmpty(value: string, field: string): string {
  const normalized = value.trim();
  if (!normalized) throw new CouncilError(`${field} must be non-empty.`);
  return normalized;
}

function unique(values: readonly string[], field: string): readonly string[] {
  return [...new Set(values.map((value) => nonEmpty(value, field)))].sort();
}

function cloneParticipant(participant: CouncilParticipant): CouncilParticipant {
  return {
    ...participant,
    capabilities: [...participant.capabilities],
    plannedFiles: [...participant.plannedFiles],
    resources: [...participant.resources],
    dependencies: [...participant.dependencies]
  };
}

function cloneEpoch(epoch: CouncilEpoch): CouncilEpoch {
  return {
    ...epoch,
    participants: epoch.participants.map(cloneParticipant),
    assignments: Object.fromEntries(Object.entries(epoch.assignments).map(([id, assignment]) => [id, {
      ...assignment,
      paths: [...assignment.paths],
      resources: [...assignment.resources]
    }])),
    pauseAcknowledgedSessionIds: [...epoch.pauseAcknowledgedSessionIds],
    assignmentAcknowledgedSessionIds: [...epoch.assignmentAcknowledgedSessionIds],
    resumeAcknowledgedSessionIds: [...(epoch.resumeAcknowledgedSessionIds ?? [])]
  };
}

function cloneRecommendation(value: CouncilRecommendation): CouncilRecommendation {
  return {
    ...value,
    participantSessionIds: [...value.participantSessionIds],
    assignments: Object.fromEntries(Object.entries(value.assignments).map(([id, assignment]) => [id, { ...assignment, paths: [...assignment.paths], resources: [...assignment.resources] }])),
    executionAuthorized: false
  };
}

function epochs(entries: readonly JournalEntry<unknown>[]): Map<string, CouncilEpoch> {
  const result = new Map<string, CouncilEpoch>();
  for (const entry of entries) {
    if (entry.kind !== "council.epoch.saved") continue;
    const epoch = (entry.payload as CouncilEpochSavedEvent | undefined)?.epoch;
    if (!epoch || typeof epoch.id !== "string") throw new CouncilError("Protected Council epoch record is malformed.");
    if (Object.values(epoch.assignments ?? {}).some((assignment) => assignment.isolationDigest !== undefined && !/^[a-f0-9]{64}$/.test(assignment.isolationDigest))) throw new CouncilError("Protected Council assignment isolation digest is malformed.");
    result.set(epoch.id, cloneEpoch(epoch));
  }
  return result;
}

function recommendations(entries: readonly JournalEntry<unknown>[]): Map<string, CouncilRecommendation> {
  const result = new Map<string, CouncilRecommendation>();
  for (const entry of entries) {
    if (entry.kind !== "council.recommendation.saved") continue;
    const value = (entry.payload as CouncilRecommendationSavedEvent | undefined)?.recommendation;
    if (!value || value.executionAuthorized !== false || !["prepared", "approved", "rejected"].includes(value.status)) throw new CouncilError("Protected Council recommendation is malformed.");
    if (recommendationDigest(value) !== value.digest) throw new CouncilError("Protected Council recommendation digest is invalid.");
    result.set(value.id, cloneRecommendation(value));
  }
  return result;
}

function normalizedParticipant(input: CouncilParticipant): CouncilParticipant {
  if (!input.capabilities.includes("registered") || !input.capabilities.includes("observable")) {
    throw new CouncilError(`Participant ${input.id} lacks the Registered and Observable capabilities required for a Council report.`);
  }
  if (!Number.isFinite(Date.parse(input.lastHeartbeat))) throw new CouncilError(`Participant ${input.id} has an invalid heartbeat.`);
  return {
    id: nonEmpty(input.id, "participant id"),
    targetSnapshotId: nonEmpty(input.targetSnapshotId, "participant targetSnapshotId"),
    status: input.status,
    capabilities: [...new Set(input.capabilities)],
    lastHeartbeat: input.lastHeartbeat,
    plannedFiles: unique(input.plannedFiles, "planned file"),
    resources: unique(input.resources, "resource"),
    dependencies: unique(input.dependencies, "dependency"),
    diffDigest: nonEmpty(input.diffDigest, "diffDigest")
  };
}

function assertAutomaticParticipant(participant: CouncilParticipant): void {
  if (!necessaryAutomaticCapabilities.every((capability) => participant.capabilities.includes(capability))) {
    throw new CouncilError(`Participant ${participant.id} lacks a proven automatic-coordination capability.`);
  }
  if (participant.status !== "running") {
    throw new CouncilError(`Participant ${participant.id} is ${participant.status}; automatic Council requires a fresh running participant.`);
  }
}

function conflicts(participants: readonly CouncilParticipant[], field: "plannedFiles" | "resources" | "dependencies"): readonly CouncilConflict[] {
  const membership = new Map<string, string[]>();
  for (const participant of participants) {
    for (const value of participant[field]) {
      membership.set(value, [...(membership.get(value) ?? []), participant.id]);
    }
  }
  return [...membership.entries()]
    .filter(([, ids]) => ids.length > 1)
    .map(([resource, ids]) => ({ resource, participants: [...ids].sort() }))
    .sort((a, b) => a.resource.localeCompare(b.resource));
}

function allAcknowledged(epoch: CouncilEpoch, field: "pauseAcknowledgedSessionIds" | "assignmentAcknowledgedSessionIds" | "resumeAcknowledgedSessionIds"): boolean {
  const acknowledgements = new Set(epoch[field]);
  return epoch.participants.every((participant) => acknowledgements.has(participant.id));
}

function equalStrings(left: readonly string[], right: readonly string[]): boolean {
  return left.length === right.length && left.every((value, index) => value === right[index]);
}

/**
 * Durable Council state machinery. It can report and validate an epoch, but
 * it cannot make arbitrary terminals cooperate or mutate worktrees. A
 * separately mediated adapter must perform any actual isolation step.
 */
export class CouncilCoordinator {
  private readonly store: ProtectedJsonStore;
  private readonly clock: () => string;
  private readonly idFactory: () => string;

  constructor(store: ProtectedJsonStore, options: { readonly clock?: () => string; readonly idFactory?: () => string } = {}) {
    this.store = store;
    this.clock = options.clock ?? (() => new Date().toISOString());
    this.idFactory = options.idFactory ?? randomUUID;
  }

  async report(input: { readonly repositoryRoot: string; readonly targetSnapshotId: string; readonly participants: readonly CouncilParticipant[] }): Promise<CouncilReport> {
    const participants = input.participants.map(normalizedParticipant);
    if (participants.length === 0) throw new CouncilError("Council needs at least one verified participant.");
    if (new Set(participants.map((participant) => participant.id)).size !== participants.length) throw new CouncilError("Council participant IDs must be unique.");
    return {
      repositoryRoot: nonEmpty(input.repositoryRoot, "repositoryRoot"),
      targetSnapshotId: nonEmpty(input.targetSnapshotId, "targetSnapshotId"),
      participants: participants.map(cloneParticipant),
      pathConflicts: conflicts(participants, "plannedFiles"),
      resourceConflicts: conflicts(participants, "resources"),
      dependencyConflicts: conflicts(participants, "dependencies"),
      atomic: participants.every((participant) => participant.targetSnapshotId === input.targetSnapshotId
        && participant.status === "running"
        && necessaryAutomaticCapabilities.every((capability) => participant.capabilities.includes(capability))),
      collectedAt: this.clock()
    };
  }

  async beginAutomatic(input: { readonly repositoryRoot: string; readonly targetSnapshotId: string; readonly participants: readonly CouncilParticipant[] }): Promise<CouncilEpoch> {
    const report = await this.report(input);
    if (!report.atomic) throw new CouncilError("Council automatic coordination requires every participant to accept a cooperative pause.");
    for (const participant of report.participants) assertAutomaticParticipant(participant);
    if (report.participants.some((participant) => participant.targetSnapshotId !== report.targetSnapshotId)) {
      throw new CouncilError("Council automatic coordination requires every participant to share the exact verified TargetSnapshot.");
    }
    if (report.pathConflicts.length || report.resourceConflicts.length || report.dependencyConflicts.length) {
      throw new CouncilError("Council automatic coordination stops on a path, resource, or dependency overlap.");
    }
    const now = this.clock();
    const epoch: CouncilEpoch = {
      id: nonEmpty(this.idFactory(), "Council epoch id"),
      repositoryRoot: report.repositoryRoot,
      targetSnapshotId: report.targetSnapshotId,
      participants: report.participants,
      assignments: {},
      pauseAcknowledgedSessionIds: [],
      assignmentAcknowledgedSessionIds: [],
      resumeAcknowledgedSessionIds: [],
      status: "awaiting_pause_acknowledgements",
      createdAt: now,
      updatedAt: now
    };
    return this.store.transaction(async (transaction) => {
      if (epochs(await transaction.readEntries()).has(epoch.id)) throw new CouncilError(`Council epoch already exists: ${epoch.id}`);
      await transaction.append<CouncilEpochSavedEvent>("council.epoch.saved", { epoch });
      return cloneEpoch(epoch);
    });
  }

  async get(id: string): Promise<CouncilEpoch | undefined> {
    const epoch = epochs(await this.store.readEntries()).get(id);
    return epoch ? cloneEpoch(epoch) : undefined;
  }

  async acknowledgePause(id: string, sessionId: string): Promise<CouncilEpoch> {
    return this.mutate(id, (epoch) => {
      if (epoch.status !== "awaiting_pause_acknowledgements") throw new CouncilError("Council pause acknowledgement is no longer accepted for this epoch.");
      this.assertParticipant(epoch, sessionId);
      return {
        ...epoch,
        pauseAcknowledgedSessionIds: unique([...epoch.pauseAcknowledgedSessionIds, sessionId], "session id")
      };
    });
  }

  async assign(id: string, sessionId: string, paths: readonly string[], resources: readonly string[], isolationDigest?: string): Promise<CouncilEpoch> {
    return this.mutate(id, (epoch) => {
      if (epoch.status !== "awaiting_pause_acknowledgements" && epoch.status !== "awaiting_assignment_acknowledgements") {
        throw new CouncilError("Council assignments are not accepted for this epoch state.");
      }
      if (!allAcknowledged(epoch, "pauseAcknowledgedSessionIds")) throw new CouncilError("Every participant must acknowledge the cooperative pause before assignment.");
      const participant = this.assertParticipant(epoch, sessionId);
      const normalizedPaths = unique(paths, "assigned path");
      const normalizedResources = unique(resources, "assigned resource");
      const normalizedIsolationDigest = isolationDigest === undefined ? undefined : exactIsolationDigest(isolationDigest);
      if (!normalizedPaths.every((path) => participant.plannedFiles.includes(path))) throw new CouncilError("Council cannot assign a path outside the participant's verified plan.");
      if (!normalizedResources.every((resource) => participant.resources.includes(resource))) throw new CouncilError("Council cannot assign a resource outside the participant's verified declaration.");
      for (const [otherId, assignment] of Object.entries(epoch.assignments)) {
        if (otherId === sessionId) continue;
        if (normalizedPaths.some((path) => assignment.paths.includes(path)) || normalizedResources.some((resource) => assignment.resources.includes(resource))) {
          throw new CouncilError("Council assignment overlaps an existing path or resource lease.");
        }
      }
      return {
        ...epoch,
        assignments: { ...epoch.assignments, [sessionId]: { sessionId, paths: normalizedPaths, resources: normalizedResources, ...(normalizedIsolationDigest ? { isolationDigest: normalizedIsolationDigest } : {}) } },
        status: "awaiting_assignment_acknowledgements"
      };
    });
  }

  async acknowledgeAssignment(id: string, sessionId: string, isolationDigest?: string): Promise<CouncilEpoch> {
    return this.mutate(id, (epoch) => {
      if (epoch.status !== "awaiting_assignment_acknowledgements") throw new CouncilError("Council assignment acknowledgement is not accepted for this epoch.");
      this.assertParticipant(epoch, sessionId);
      const assignment = epoch.assignments[sessionId];
      if (!assignment) throw new CouncilError("A participant cannot acknowledge an assignment it has not received.");
      assertIsolationAcknowledgement(assignment, isolationDigest);
      return {
        ...epoch,
        assignmentAcknowledgedSessionIds: unique([...epoch.assignmentAcknowledgedSessionIds, sessionId], "session id")
      };
    });
  }

  async beginResume(id: string): Promise<CouncilEpoch> {
    return this.mutate(id, (epoch) => {
      if (epoch.status !== "awaiting_assignment_acknowledgements") throw new CouncilError("Council epoch cannot resume from its current state.");
      if (Object.keys(epoch.assignments).length !== epoch.participants.length) throw new CouncilError("Every Council participant needs an explicit assignment before resuming.");
      if (!allAcknowledged(epoch, "assignmentAcknowledgedSessionIds")) throw new CouncilError("Every Council participant must acknowledge its assignment before resuming.");
      return { ...epoch, status: "awaiting_resume_acknowledgements", resumeAcknowledgedSessionIds: [] };
    });
  }

  async prepareRecommendation(input: { readonly repositoryRoot: string; readonly targetSnapshotId: string; readonly participants: readonly CouncilParticipant[] }): Promise<CouncilRecommendation> {
    const report = await this.report(input);
    const ready = report.atomic && report.pathConflicts.length === 0 && report.resourceConflicts.length === 0 && report.dependencyConflicts.length === 0;
    const assignments = ready ? Object.fromEntries(report.participants.map((participant) => [participant.id, { sessionId: participant.id, paths: participant.plannedFiles, resources: participant.resources }])) : {};
    const now = this.clock();
    const base = {
      id: nonEmpty(this.idFactory(), "Council recommendation id"), repositoryRoot: report.repositoryRoot, targetSnapshotId: report.targetSnapshotId,
      participantSessionIds: report.participants.map((participant) => participant.id).sort(), assignments,
      reportDigest: sha256(stableJson(report)), ready, createdAt: now
    };
    const recommendation: CouncilRecommendation = { ...base, digest: recommendationDigest(base), status: "prepared", executionAuthorized: false, updatedAt: now };
    return this.store.transaction(async (transaction) => {
      if (recommendations(await transaction.readEntries()).has(recommendation.id)) throw new CouncilError(`Council recommendation already exists: ${recommendation.id}`);
      await transaction.append<CouncilRecommendationSavedEvent>("council.recommendation.saved", { recommendation });
      return cloneRecommendation(recommendation);
    });
  }

  async getRecommendation(id: string): Promise<CouncilRecommendation | undefined> {
    const found = recommendations(await this.store.readEntries()).get(nonEmpty(id, "Council recommendation id"));
    return found ? cloneRecommendation(found) : undefined;
  }

  async approveRecommendation(id: string, operationId: string): Promise<CouncilRecommendation> {
    return this.mutateRecommendation(id, (value) => {
      if (value.status === "approved" && value.approvalOperationId === operationId) return value;
      if (value.status !== "prepared") throw new CouncilError(`Council recommendation is already ${value.status}.`);
      if (!value.ready) throw new CouncilError("Council recommendation cannot be approved while participant, target, path, resource, or dependency conflicts remain.");
      return { ...value, status: "approved", approvalOperationId: nonEmpty(operationId, "approval operation id"), executionAuthorized: false };
    });
  }

  async rejectRecommendation(id: string, reason: string): Promise<CouncilRecommendation> {
    return this.mutateRecommendation(id, (value) => {
      if (value.status === "approved") throw new CouncilError("An approved Council recommendation cannot be silently rejected.");
      return { ...value, status: "rejected", rejectionReason: nonEmpty(reason, "recommendation rejection reason"), executionAuthorized: false };
    });
  }

  async acknowledgeResume(id: string, sessionId: string, isolationDigest?: string): Promise<CouncilEpoch> {
    return this.mutate(id, (epoch) => {
      if (epoch.status !== "awaiting_resume_acknowledgements") throw new CouncilError("Council resume acknowledgement is not accepted for this epoch.");
      this.assertParticipant(epoch, sessionId);
      const assignment = epoch.assignments[sessionId];
      if (!assignment) throw new CouncilError("A participant cannot acknowledge resume without an exact assignment.");
      assertIsolationAcknowledgement(assignment, isolationDigest);
      return { ...epoch, resumeAcknowledgedSessionIds: unique([...epoch.resumeAcknowledgedSessionIds, sessionId], "session id") };
    });
  }

  async activate(id: string): Promise<CouncilEpoch> {
    return this.mutate(id, (epoch) => {
      if (epoch.status !== "awaiting_resume_acknowledgements") throw new CouncilError("Council epoch cannot activate from its current state.");
      if (!allAcknowledged(epoch, "resumeAcknowledgedSessionIds")) throw new CouncilError("Every Council participant must durably acknowledge resume before the epoch becomes active.");
      return { ...epoch, status: "active" };
    });
  }

  async complete(id: string): Promise<CouncilEpoch> {
    return this.mutate(id, (epoch) => {
      if (epoch.status !== "active") throw new CouncilError("Only an active Council epoch can be completed.");
      return { ...epoch, status: "completed" };
    });
  }

  /** A fresh unexpected diff, lease declaration, target, state, or heartbeat stops automatic coordination. */
  async validate(id: string, observations: readonly CouncilParticipant[]): Promise<CouncilEpoch> {
    const epoch = await this.get(id);
    if (!epoch) throw new CouncilError(`Unknown Council epoch: ${id}`);
    if (epoch.status !== "active") return epoch;
    let reason: string | undefined;
    try {
      const normalized = observations.map((observation) => {
        const participant = normalizedParticipant(observation);
        assertAutomaticParticipant(participant);
        return participant;
      });
      if (normalized.length !== epoch.participants.length) reason = "Council participant set changed during the epoch.";
      const currentById = new Map(normalized.map((participant) => [participant.id, participant]));
      for (const expected of epoch.participants) {
        const current = currentById.get(expected.id);
        if (!current) { reason = `Council participant ${expected.id} is missing.`; break; }
        if (current.targetSnapshotId !== epoch.targetSnapshotId) { reason = `Council participant ${expected.id} changed TargetSnapshot.`; break; }
        if (current.diffDigest !== expected.diffDigest) { reason = `Council participant ${expected.id} changed its diff during coordination.`; break; }
        if (current.lastHeartbeat !== expected.lastHeartbeat) { reason = `Council participant ${expected.id} heartbeat changed; the epoch is no longer atomic.`; break; }
        if (!equalStrings(current.plannedFiles, expected.plannedFiles) || !equalStrings(current.resources, expected.resources) || !equalStrings(current.dependencies, expected.dependencies)) {
          reason = `Council participant ${expected.id} changed its declared plan or resource lease.`;
          break;
        }
      }
    } catch (error) {
      reason = error instanceof Error ? error.message : "Council observation could not be verified.";
    }
    return reason ? this.abort(id, reason) : epoch;
  }

  async abort(id: string, reason: string): Promise<CouncilEpoch> {
    return this.mutate(id, (epoch) => {
      if (epoch.status === "aborted") return epoch;
      if (epoch.status === "completed") throw new CouncilError("A completed Council epoch cannot be aborted.");
      return { ...epoch, status: "aborted", abortReason: nonEmpty(reason, "abort reason") };
    });
  }

  private async mutate(id: string, mutate: (epoch: CouncilEpoch) => CouncilEpoch): Promise<CouncilEpoch> {
    return this.store.transaction(async (transaction) => {
      const existing = epochs(await transaction.readEntries()).get(id);
      if (!existing) throw new CouncilError(`Unknown Council epoch: ${id}`);
      const changed = { ...mutate(cloneEpoch(existing)), updatedAt: this.clock() };
      await transaction.append<CouncilEpochSavedEvent>("council.epoch.saved", { epoch: changed });
      return jsonClone(cloneEpoch(changed));
    });
  }

  private async mutateRecommendation(id: string, mutate: (value: CouncilRecommendation) => CouncilRecommendation): Promise<CouncilRecommendation> {
    return this.store.transaction(async (transaction) => {
      const existing = recommendations(await transaction.readEntries()).get(nonEmpty(id, "Council recommendation id"));
      if (!existing) throw new CouncilError(`Unknown Council recommendation: ${id}`);
      const changed = { ...mutate(cloneRecommendation(existing)), updatedAt: this.clock(), executionAuthorized: false as const };
      await transaction.append<CouncilRecommendationSavedEvent>("council.recommendation.saved", { recommendation: changed });
      return cloneRecommendation(changed);
    });
  }

  private assertParticipant(epoch: CouncilEpoch, sessionId: string): CouncilParticipant {
    const found = epoch.participants.find((participant) => participant.id === sessionId);
    if (!found) throw new CouncilError("Session is not a participant in this Council epoch.");
    return found;
  }
}

function recommendationDigest(value: Pick<CouncilRecommendation, "id" | "repositoryRoot" | "targetSnapshotId" | "participantSessionIds" | "assignments" | "reportDigest" | "ready" | "createdAt">): string {
  return sha256(stableJson({ id: value.id, repositoryRoot: value.repositoryRoot, targetSnapshotId: value.targetSnapshotId, participantSessionIds: value.participantSessionIds, assignments: value.assignments, reportDigest: value.reportDigest, ready: value.ready, createdAt: value.createdAt }));
}

function exactIsolationDigest(value: string): string {
  const normalized = value.trim().toLowerCase();
  if (!/^[a-f0-9]{64}$/.test(normalized)) throw new CouncilError("Council isolation digest must be an exact SHA-256 value.");
  return normalized;
}

function assertIsolationAcknowledgement(assignment: CouncilAssignment, supplied: string | undefined): void {
  if (!assignment.isolationDigest) {
    if (supplied !== undefined) throw new CouncilError("Council assignment has no durable isolation digest to acknowledge.");
    return;
  }
  if (supplied === undefined || exactIsolationDigest(supplied) !== assignment.isolationDigest) {
    throw new CouncilError("Council acknowledgement does not match the exact durable isolation digest.");
  }
}
