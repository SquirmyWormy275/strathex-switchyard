import { randomUUID } from "node:crypto";

import { redactText } from "./redaction.ts";
import { sha256, stableJson, type JournalEntry, ProtectedJsonStore } from "./store.ts";

/** Workflows which must preserve an operator-recoverable artifact before mutation. */
export type CheckpointWorkflow = "risky_mutation" | "environment_rebuild" | "council_repartition" | "repair_mission" | "consequential_git";

/** The ledger holds immutable references and digests, never a copy of user work. */
export type CheckpointArtifactKind = "workspace_manifest" | "environment_manifest" | "patch" | "archive" | "log" | "instructions" | "other";
export type RecoveryProhibitedAction = "automatic_restore" | "delete" | "stash" | "overwrite";
export type RecoveryObservationOutcome = "reviewed" | "restore_requested" | "restore_declined" | "artifact_missing" | "integrity_failed";

export interface CheckpointArtifact {
  readonly id: string;
  readonly kind: CheckpointArtifactKind;
  /** Host-owned path, object-store key, Git object, or other recovery reference. */
  readonly reference: string;
  /** SHA-256 of the referenced asset when it was captured. */
  readonly sha256: string;
  readonly bytes?: number;
}

export interface RecoveryGuideInput {
  /** Human-readable instructions only; the ledger has no restore executor. */
  readonly steps: readonly string[];
  /** Artifact IDs an operator should inspect while deciding on recovery. */
  readonly artifactIds: readonly string[];
}

export interface RecoveryGuide extends RecoveryGuideInput {
  /** Kept true in every record so it cannot become an execution capability. */
  readonly manualOnly: true;
  readonly prohibitedActions: readonly RecoveryProhibitedAction[];
}

export interface CheckpointInput {
  readonly id?: string;
  readonly repositoryRoot: string;
  readonly targetSnapshotId: string;
  readonly operationId?: string;
  readonly workflow: CheckpointWorkflow;
  readonly reason: string;
  readonly artifacts: readonly CheckpointArtifact[];
  readonly recovery: RecoveryGuideInput;
}

export interface Checkpoint {
  readonly id: string;
  readonly repositoryRoot: string;
  readonly targetSnapshotId: string;
  readonly operationId?: string;
  readonly workflow: CheckpointWorkflow;
  readonly reason: string;
  readonly artifacts: readonly CheckpointArtifact[];
  readonly recovery: RecoveryGuide;
  /** A typed guardrail, not an authorization token. */
  readonly manualOnly: true;
  readonly createdAt: string;
  /** Hash over immutable checkpoint metadata and asset digests. */
  readonly integrityHash: string;
}

export interface RecoveryObservationInput {
  readonly id?: string;
  readonly checkpointId: string;
  readonly operator: string;
  readonly outcome: RecoveryObservationOutcome;
  readonly note: string;
}

/** Observation only: it records a manual decision; it cannot restore or change a checkpoint. */
export interface RecoveryObservation {
  readonly id: string;
  readonly checkpointId: string;
  readonly operator: string;
  readonly outcome: RecoveryObservationOutcome;
  readonly note: string;
  readonly observedAt: string;
}

export interface RecoveryPlan {
  readonly checkpointId: string;
  readonly targetSnapshotId: string;
  readonly manualOnly: true;
  readonly artifacts: readonly CheckpointArtifact[];
  readonly recovery: RecoveryGuide;
}

export interface CheckpointScope {
  readonly repositoryRoot: string;
  readonly targetSnapshotId: string;
  readonly workflow?: CheckpointWorkflow;
  readonly operationId?: string;
}

export interface ArtifactVerification {
  readonly artifactId: string;
  readonly status: "verified" | "missing" | "mismatched" | "unavailable";
  readonly detail: string;
}

/** A verifier may read a reference, but never writes, restores, stashes, or deletes anything. */
export interface RecoveryArtifactVerifier {
  verify(artifact: CheckpointArtifact): Promise<Readonly<{ available: boolean; sha256?: string; detail?: string }>>;
}

interface CheckpointSavedEvent { readonly checkpoint: Checkpoint; }
interface RecoveryObservedEvent { readonly observation: RecoveryObservation; }

const prohibitedActions: readonly RecoveryProhibitedAction[] = ["automatic_restore", "delete", "stash", "overwrite"];
const workflows = new Set<CheckpointWorkflow>(["risky_mutation", "environment_rebuild", "council_repartition", "repair_mission", "consequential_git"]);
const artifactKinds = new Set<CheckpointArtifactKind>(["workspace_manifest", "environment_manifest", "patch", "archive", "log", "instructions", "other"]);
const observationOutcomes = new Set<RecoveryObservationOutcome>(["reviewed", "restore_requested", "restore_declined", "artifact_missing", "integrity_failed"]);

export class CheckpointError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "CheckpointError";
  }
}

function text(value: string, field: string): string {
  const normalized = value.trim();
  if (!normalized) throw new CheckpointError(`${field} must be non-empty.`);
  return redactText(normalized);
}

function timestamp(value: string, field: string): string {
  if (!Number.isFinite(Date.parse(value))) throw new CheckpointError(`${field} must be an ISO timestamp.`);
  return value;
}

function digest(value: string, field: string): string {
  const normalized = value.trim().toLowerCase();
  if (!/^[a-f0-9]{64}$/.test(normalized)) throw new CheckpointError(`${field} must be a SHA-256 hex digest.`);
  return normalized;
}

function unique(values: readonly string[], field: string): readonly string[] {
  const normalized = values.map((value) => text(value, field));
  if (normalized.length === 0) throw new CheckpointError(`${field} must include at least one value.`);
  if (new Set(normalized).size !== normalized.length) throw new CheckpointError(`${field} contains a duplicate value.`);
  return normalized;
}

function cloneArtifact(artifact: CheckpointArtifact): CheckpointArtifact {
  return { ...artifact };
}

function cloneGuide(guide: RecoveryGuide): RecoveryGuide {
  return {
    ...guide,
    steps: [...guide.steps],
    artifactIds: [...guide.artifactIds],
    prohibitedActions: [...guide.prohibitedActions],
    manualOnly: true
  };
}

function cloneCheckpoint(checkpoint: Checkpoint): Checkpoint {
  return {
    ...checkpoint,
    artifacts: checkpoint.artifacts.map(cloneArtifact),
    recovery: cloneGuide(checkpoint.recovery),
    manualOnly: true
  };
}

function cloneObservation(observation: RecoveryObservation): RecoveryObservation {
  return { ...observation };
}

function artifact(input: CheckpointArtifact): CheckpointArtifact {
  const id = text(input.id, "checkpoint artifact id");
  if (!artifactKinds.has(input.kind)) throw new CheckpointError("Checkpoint artifact kind is not recognized.");
  if (input.bytes !== undefined && (!Number.isInteger(input.bytes) || input.bytes < 0)) {
    throw new CheckpointError("Checkpoint artifact bytes must be a non-negative integer when supplied.");
  }
  return {
    id,
    kind: input.kind,
    reference: text(input.reference, "checkpoint artifact reference"),
    sha256: digest(input.sha256, "checkpoint artifact sha256"),
    ...(input.bytes === undefined ? {} : { bytes: input.bytes })
  };
}

function guide(input: RecoveryGuideInput, artifacts: readonly CheckpointArtifact[]): RecoveryGuide {
  const artifactIds = unique(input.artifactIds, "recovery artifact id");
  const knownArtifactIds = new Set(artifacts.map((entry) => entry.id));
  if (!artifactIds.every((id) => knownArtifactIds.has(id))) {
    throw new CheckpointError("Recovery instructions reference an unknown checkpoint artifact.");
  }
  return {
    steps: unique(input.steps, "recovery step"),
    artifactIds,
    manualOnly: true,
    prohibitedActions: [...prohibitedActions]
  };
}

function hashMaterial(checkpoint: Omit<Checkpoint, "integrityHash">): Record<string, unknown> {
  return {
    id: checkpoint.id,
    repositoryRoot: checkpoint.repositoryRoot,
    targetSnapshotId: checkpoint.targetSnapshotId,
    operationId: checkpoint.operationId ?? null,
    workflow: checkpoint.workflow,
    reason: checkpoint.reason,
    artifacts: checkpoint.artifacts.map((entry) => ({
      id: entry.id,
      kind: entry.kind,
      reference: entry.reference,
      sha256: entry.sha256,
      bytes: entry.bytes ?? null
    })),
    recovery: {
      steps: checkpoint.recovery.steps,
      artifactIds: checkpoint.recovery.artifactIds,
      manualOnly: true,
      prohibitedActions: checkpoint.recovery.prohibitedActions
    },
    manualOnly: true,
    createdAt: checkpoint.createdAt
  };
}

function checkpointHash(checkpoint: Omit<Checkpoint, "integrityHash">): string {
  return sha256(stableJson(hashMaterial(checkpoint)));
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function stringArray(value: unknown, field: string): readonly string[] {
  if (!Array.isArray(value) || !value.every((entry) => typeof entry === "string")) throw new CheckpointError(`${field} is malformed.`);
  return value as readonly string[];
}

function persistedCheckpoint(value: unknown): Checkpoint {
  if (!isRecord(value)) throw new CheckpointError("Protected checkpoint record is malformed.");
  const rawArtifacts = value.artifacts;
  if (!Array.isArray(rawArtifacts)) throw new CheckpointError("Protected checkpoint artifacts are malformed.");
  const parsedArtifacts = rawArtifacts.map((raw) => {
    if (!isRecord(raw) || typeof raw.id !== "string" || typeof raw.kind !== "string" || typeof raw.reference !== "string" || typeof raw.sha256 !== "string") {
      throw new CheckpointError("Protected checkpoint artifact is malformed.");
    }
    return artifact({
      id: raw.id,
      kind: raw.kind as CheckpointArtifactKind,
      reference: raw.reference,
      sha256: raw.sha256,
      ...(raw.bytes === undefined ? {} : { bytes: raw.bytes as number })
    });
  });
  if (parsedArtifacts.length === 0 || new Set(parsedArtifacts.map((entry) => entry.id)).size !== parsedArtifacts.length) {
    throw new CheckpointError("Protected checkpoint artifact IDs are malformed.");
  }
  if (!isRecord(value.recovery) || value.recovery.manualOnly !== true || !Array.isArray(value.recovery.prohibitedActions)) {
    throw new CheckpointError("Protected checkpoint recovery instructions are malformed.");
  }
  const rawRecovery = value.recovery;
  const candidate: Omit<Checkpoint, "integrityHash"> = {
    id: text(String(value.id ?? ""), "checkpoint id"),
    repositoryRoot: text(String(value.repositoryRoot ?? ""), "repository root"),
    targetSnapshotId: text(String(value.targetSnapshotId ?? ""), "target snapshot id"),
    ...(value.operationId === undefined ? {} : { operationId: text(String(value.operationId), "operation id") }),
    workflow: value.workflow as CheckpointWorkflow,
    reason: text(String(value.reason ?? ""), "checkpoint reason"),
    artifacts: parsedArtifacts,
    recovery: guide({
      steps: stringArray(rawRecovery.steps, "checkpoint recovery steps"),
      artifactIds: stringArray(rawRecovery.artifactIds, "checkpoint recovery artifact IDs")
    }, parsedArtifacts),
    manualOnly: true,
    createdAt: timestamp(String(value.createdAt ?? ""), "checkpoint creation timestamp")
  };
  if (!workflows.has(candidate.workflow)) throw new CheckpointError("Protected checkpoint workflow is malformed.");
  if (value.manualOnly !== true || typeof value.integrityHash !== "string") throw new CheckpointError("Protected checkpoint safety fields are malformed.");
  const expected = checkpointHash(candidate);
  if (value.integrityHash !== expected) throw new CheckpointError("Protected checkpoint immutable hash does not match its artifact metadata.");
  return { ...candidate, integrityHash: expected };
}

function persistedObservation(value: unknown): RecoveryObservation {
  if (!isRecord(value) || typeof value.id !== "string" || typeof value.checkpointId !== "string" || typeof value.operator !== "string" || typeof value.outcome !== "string" || typeof value.note !== "string" || typeof value.observedAt !== "string") {
    throw new CheckpointError("Protected recovery observation is malformed.");
  }
  if (!observationOutcomes.has(value.outcome as RecoveryObservationOutcome)) throw new CheckpointError("Protected recovery observation outcome is malformed.");
  return {
    id: text(value.id, "recovery observation id"),
    checkpointId: text(value.checkpointId, "checkpoint id"),
    operator: text(value.operator, "recovery operator"),
    outcome: value.outcome as RecoveryObservationOutcome,
    note: text(value.note, "recovery observation note"),
    observedAt: timestamp(value.observedAt, "recovery observation timestamp")
  };
}

function checkpoints(entries: readonly JournalEntry<unknown>[]): Map<string, Checkpoint> {
  const result = new Map<string, Checkpoint>();
  for (const entry of entries) {
    if (entry.kind !== "checkpoint.created") continue;
    const value = (entry.payload as CheckpointSavedEvent | undefined)?.checkpoint;
    const checkpoint = persistedCheckpoint(value);
    if (result.has(checkpoint.id)) throw new CheckpointError(`Duplicate durable checkpoint ID: ${checkpoint.id}`);
    result.set(checkpoint.id, checkpoint);
  }
  return result;
}

function observations(entries: readonly JournalEntry<unknown>[]): readonly RecoveryObservation[] {
  const result: RecoveryObservation[] = [];
  const seen = new Set<string>();
  for (const entry of entries) {
    if (entry.kind !== "checkpoint.recovery_observed") continue;
    const value = (entry.payload as RecoveryObservedEvent | undefined)?.observation;
    const observation = persistedObservation(value);
    if (seen.has(observation.id)) throw new CheckpointError(`Duplicate durable recovery observation ID: ${observation.id}`);
    seen.add(observation.id);
    result.push(observation);
  }
  return result;
}

/**
 * Protected, append-only checkpoint metadata. It never reads, restores,
 * deletes, stashes, or overwrites user files. A caller creates a checkpoint
 * before a risky operation; a UI or broker may later verify references and
 * guide an explicitly manual recovery flow.
 */
export class CheckpointLedger {
  private readonly store: ProtectedJsonStore;
  private readonly clock: () => string;
  private readonly idFactory: () => string;
  private readonly observationIdFactory: () => string;

  constructor(
    store: ProtectedJsonStore,
    options: { readonly clock?: () => string; readonly idFactory?: () => string; readonly observationIdFactory?: () => string } = {}
  ) {
    this.store = store;
    this.clock = options.clock ?? (() => new Date().toISOString());
    this.idFactory = options.idFactory ?? randomUUID;
    this.observationIdFactory = options.observationIdFactory ?? randomUUID;
  }

  async create(input: CheckpointInput): Promise<Checkpoint> {
    const now = timestamp(this.clock(), "checkpoint creation timestamp");
    const parsedArtifacts = input.artifacts.map(artifact);
    if (parsedArtifacts.length === 0) throw new CheckpointError("A checkpoint needs at least one immutable recovery artifact.");
    if (new Set(parsedArtifacts.map((entry) => entry.id)).size !== parsedArtifacts.length) throw new CheckpointError("Checkpoint artifact IDs must be unique.");
    if (!workflows.has(input.workflow)) throw new CheckpointError("Checkpoint workflow is not recognized.");
    const immutable: Omit<Checkpoint, "integrityHash"> = {
      id: text(input.id ?? this.idFactory(), "checkpoint id"),
      repositoryRoot: text(input.repositoryRoot, "repository root"),
      targetSnapshotId: text(input.targetSnapshotId, "target snapshot id"),
      ...(input.operationId ? { operationId: text(input.operationId, "operation id") } : {}),
      workflow: input.workflow,
      reason: text(input.reason, "checkpoint reason"),
      artifacts: parsedArtifacts,
      recovery: guide(input.recovery, parsedArtifacts),
      manualOnly: true,
      createdAt: now
    };
    const checkpoint: Checkpoint = { ...immutable, integrityHash: checkpointHash(immutable) };
    return this.store.transaction(async (transaction) => {
      if (checkpoints(await transaction.readEntries()).has(checkpoint.id)) {
        throw new CheckpointError(`Checkpoint already exists: ${checkpoint.id}`);
      }
      await transaction.append<CheckpointSavedEvent>("checkpoint.created", { checkpoint });
      return cloneCheckpoint(checkpoint);
    });
  }

  async get(id: string): Promise<Checkpoint | undefined> {
    const checkpoint = checkpoints(await this.store.readEntries()).get(text(id, "checkpoint id"));
    return checkpoint ? cloneCheckpoint(checkpoint) : undefined;
  }

  async list(scope?: Partial<CheckpointScope>): Promise<readonly Checkpoint[]> {
    return [...checkpoints(await this.store.readEntries()).values()]
      .filter((checkpoint) =>
        (scope?.repositoryRoot === undefined || checkpoint.repositoryRoot === scope.repositoryRoot)
        && (scope?.targetSnapshotId === undefined || checkpoint.targetSnapshotId === scope.targetSnapshotId)
        && (scope?.workflow === undefined || checkpoint.workflow === scope.workflow)
        && (scope?.operationId === undefined || checkpoint.operationId === scope.operationId))
      .map(cloneCheckpoint);
  }

  /** Return a manual plan only; it is intentionally not a restore command. */
  async recoveryPlan(id: string): Promise<RecoveryPlan | undefined> {
    const checkpoint = await this.get(id);
    if (!checkpoint) return undefined;
    return {
      checkpointId: checkpoint.id,
      targetSnapshotId: checkpoint.targetSnapshotId,
      manualOnly: true,
      artifacts: checkpoint.artifacts.map(cloneArtifact),
      recovery: cloneGuide(checkpoint.recovery)
    };
  }

  /** Ensure the checkpoint still binds the exact operation/snapshot scope before a risky action begins. */
  async assertUsable(id: string, scope: CheckpointScope): Promise<Checkpoint> {
    const checkpoint = await this.get(id);
    if (!checkpoint) throw new CheckpointError(`Unknown checkpoint: ${text(id, "checkpoint id")}`);
    if (!CheckpointLedger.verifyIntegrity(checkpoint)) throw new CheckpointError("Checkpoint immutable metadata is not trustworthy.");
    if (checkpoint.repositoryRoot !== scope.repositoryRoot || checkpoint.targetSnapshotId !== scope.targetSnapshotId) {
      throw new CheckpointError("Checkpoint does not bind the current repository and TargetSnapshot.");
    }
    if (scope.workflow && checkpoint.workflow !== scope.workflow) throw new CheckpointError("Checkpoint workflow does not match the requested risky action.");
    if (scope.operationId && checkpoint.operationId !== scope.operationId) throw new CheckpointError("Checkpoint does not bind the requested durable operation.");
    return checkpoint;
  }

  async recordRecoveryObservation(input: RecoveryObservationInput): Promise<RecoveryObservation> {
    const observedAt = timestamp(this.clock(), "recovery observation timestamp");
    if (!observationOutcomes.has(input.outcome)) throw new CheckpointError("Recovery observation outcome is not recognized.");
    const observation: RecoveryObservation = {
      id: text(input.id ?? this.observationIdFactory(), "recovery observation id"),
      checkpointId: text(input.checkpointId, "checkpoint id"),
      operator: text(input.operator, "recovery operator"),
      outcome: input.outcome,
      note: text(input.note, "recovery observation note"),
      observedAt
    };
    return this.store.transaction(async (transaction) => {
      const entries = await transaction.readEntries();
      if (!checkpoints(entries).has(observation.checkpointId)) throw new CheckpointError(`Unknown checkpoint: ${observation.checkpointId}`);
      if (observations(entries).some((existing) => existing.id === observation.id)) {
        throw new CheckpointError(`Recovery observation already exists: ${observation.id}`);
      }
      await transaction.append<RecoveryObservedEvent>("checkpoint.recovery_observed", { observation });
      return cloneObservation(observation);
    });
  }

  async recoveryObservations(checkpointId: string): Promise<readonly RecoveryObservation[]> {
    const normalized = text(checkpointId, "checkpoint id");
    return observations(await this.store.readEntries())
      .filter((observation) => observation.checkpointId === normalized)
      .map(cloneObservation);
  }

  /**
   * Verifies availability/digests through a supplied read-only adapter. The
   * ledger keeps all artifacts unchanged regardless of the outcome.
   */
  async verifyArtifacts(id: string, verifier: RecoveryArtifactVerifier): Promise<readonly ArtifactVerification[]> {
    const checkpoint = await this.get(id);
    if (!checkpoint) throw new CheckpointError(`Unknown checkpoint: ${text(id, "checkpoint id")}`);
    const results: ArtifactVerification[] = [];
    for (const entry of checkpoint.artifacts) {
      try {
        const result = await verifier.verify(cloneArtifact(entry));
        if (!result.available) {
          results.push({ artifactId: entry.id, status: "missing", detail: redactText(result.detail ?? "Recovery artifact is unavailable.") });
        } else if (!result.sha256 || result.sha256.trim().toLowerCase() !== entry.sha256) {
          results.push({ artifactId: entry.id, status: "mismatched", detail: redactText(result.detail ?? "Recovery artifact digest does not match the checkpoint.") });
        } else {
          results.push({ artifactId: entry.id, status: "verified", detail: redactText(result.detail ?? "Recovery artifact digest verified.") });
        }
      } catch (error) {
        results.push({ artifactId: entry.id, status: "unavailable", detail: redactText(error instanceof Error ? error.message : "Recovery artifact verification failed.") });
      }
    }
    return results;
  }

  static verifyIntegrity(checkpoint: Checkpoint): boolean {
    try {
      const { integrityHash, ...immutable } = checkpoint;
      return integrityHash === checkpointHash(immutable);
    } catch {
      return false;
    }
  }
}
