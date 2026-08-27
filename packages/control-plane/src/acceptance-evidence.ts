import { randomUUID } from "node:crypto";

import type { AcceptanceGate } from "./command-catalog.ts";
import { redactText } from "./redaction.ts";
import { jsonClone, type JournalEntry, ProtectedJsonStore } from "./store.ts";

export type GateEvidenceStatus = "not_evaluated" | "passed" | "failed" | "unavailable" | "incomplete";

export interface GateEvidence {
  readonly id: string;
  readonly gate: AcceptanceGate;
  readonly status: Exclude<GateEvidenceStatus, "not_evaluated">;
  readonly targetSnapshotId?: string;
  readonly operationId?: string;
  readonly evidenceDigest: string;
  /** Host-owned durable evidence package; never accepted from a dispatch payload. */
  readonly evidenceReference?: string;
  readonly policyVersion: string;
  readonly evaluatedBy: string;
  readonly evaluatedAt: string;
  readonly expiresAt?: string;
  readonly rationale: string;
  readonly invalidatedAt?: string;
  readonly invalidatedReason?: string;
}

export interface GateEvidenceInput {
  readonly id?: string;
  readonly gate: AcceptanceGate;
  readonly status: Exclude<GateEvidenceStatus, "not_evaluated">;
  readonly targetSnapshotId?: string;
  readonly operationId?: string;
  readonly evidenceDigest: string;
  readonly evidenceReference?: string;
  readonly policyVersion: string;
  readonly evaluatedBy: string;
  readonly expiresAt?: string;
  readonly rationale: string;
  /**
   * Opaque, single-use host authorization. The ledger never persists it.
   * Production authorizers bind it to the complete evidence operation;
   * test-only allowlists may deliberately ignore it.
   */
  readonly authorizationProof?: string;
}

export interface EvidenceAuthorizationRequest {
  readonly operation: "record" | "invalidate";
  readonly evaluatedBy: string;
  readonly gate: AcceptanceGate;
  readonly evidenceId?: string;
  readonly evidenceDigest?: string;
  readonly authorizationProof?: string;
}

export interface EvidenceAuthorizer {
  assertMayRecord(request: EvidenceAuthorizationRequest): void | Promise<void>;
}

export interface EvidenceArtifactVerifier {
  verify(evidence: GateEvidence): boolean | Promise<boolean>;
}

/** Safe default: no code path can mark a gate as passed without an authenticated host attestor. */
export class DenyEvidenceAuthorizer implements EvidenceAuthorizer {
  assertMayRecord(): void {
    throw new GateEvidenceError("Acceptance evidence is not authenticated by a trusted host attestor.");
  }
}

/** A local-test harness helper; production injects an authenticated identity-backed authorizer. */
export class AllowlistedEvidenceAuthorizer implements EvidenceAuthorizer {
  private readonly allowlist: ReadonlySet<string>;

  constructor(identities: readonly string[]) {
    this.allowlist = new Set(identities.map((identity) => identity.trim()).filter(Boolean));
  }

  assertMayRecord(request: EvidenceAuthorizationRequest): void {
    if (!this.allowlist.has(request.evaluatedBy)) throw new GateEvidenceError("Acceptance evidence attestor is not authenticated for this ledger.");
  }
}

interface EvidenceSavedEvent { readonly evidence: GateEvidence; }
interface EvidenceInvalidatedEvent { readonly evidenceId: string; readonly at: string; readonly reason: string; }

export class GateEvidenceError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "GateEvidenceError";
  }
}

function nonEmpty(value: string, field: string): string {
  const normalized = value.trim();
  if (!normalized) throw new GateEvidenceError(`${field} must be non-empty.`);
  return redactText(normalized);
}

function timestamp(value: string, field: string): string {
  if (!Number.isFinite(Date.parse(value))) throw new GateEvidenceError(`${field} must be an ISO timestamp.`);
  return value;
}

function gate(value: number): AcceptanceGate {
  if (!Number.isInteger(value) || value < 1 || value > 27) throw new GateEvidenceError("Acceptance gate must be an integer from 1 through 27.");
  return value as AcceptanceGate;
}

function cloneEvidence(evidence: GateEvidence): GateEvidence {
  return { ...evidence };
}

function evidenceMap(entries: readonly JournalEntry<unknown>[]): Map<string, GateEvidence> {
  const result = new Map<string, GateEvidence>();
  for (const entry of entries) {
    if (entry.kind === "gate-evidence.saved") {
      const evidence = (entry.payload as EvidenceSavedEvent | undefined)?.evidence;
      if (!evidence || typeof evidence.id !== "string") throw new GateEvidenceError("Protected acceptance evidence is malformed.");
      result.set(evidence.id, cloneEvidence(evidence));
    }
    if (entry.kind === "gate-evidence.invalidated") {
      const invalidation = entry.payload as EvidenceInvalidatedEvent | undefined;
      if (!invalidation) throw new GateEvidenceError("Protected acceptance evidence invalidation is malformed.");
      const existing = result.get(invalidation.evidenceId);
      if (existing) result.set(existing.id, {
        ...existing,
        invalidatedAt: timestamp(invalidation.at, "invalidation timestamp"),
        invalidatedReason: nonEmpty(invalidation.reason, "invalidation reason")
      });
    }
  }
  return result;
}

/**
 * An append-only ledger for the 27 acceptance gates. A gate is not green
 * merely because a test emitted text: it needs trusted attestation, current
 * target scope, unexpired evidence, and no invalidation record.
 */
export class GateEvidenceLedger {
  private readonly store: ProtectedJsonStore;
  private readonly authorizer: EvidenceAuthorizer;
  private readonly clock: () => string;
  private readonly idFactory: () => string;
  private readonly artifactVerifier?: EvidenceArtifactVerifier;

  constructor(
    store: ProtectedJsonStore,
    authorizer: EvidenceAuthorizer = new DenyEvidenceAuthorizer(),
    options: { readonly clock?: () => string; readonly idFactory?: () => string; readonly artifactVerifier?: EvidenceArtifactVerifier } = {}
  ) {
    this.store = store;
    this.authorizer = authorizer;
    this.clock = options.clock ?? (() => new Date().toISOString());
    this.idFactory = options.idFactory ?? randomUUID;
    this.artifactVerifier = options.artifactVerifier;
  }

  async record(input: GateEvidenceInput): Promise<GateEvidence> {
    const selectedGate = gate(input.gate);
    await this.authorizer.assertMayRecord({
      operation: "record",
      evaluatedBy: input.evaluatedBy,
      gate: selectedGate,
      ...(input.id ? { evidenceId: input.id } : {}),
      evidenceDigest: input.evidenceDigest,
      ...(input.authorizationProof ? { authorizationProof: input.authorizationProof } : {})
    });
    const evaluatedAt = this.clock();
    const evidence: GateEvidence = {
      id: nonEmpty(input.id ?? this.idFactory(), "evidence id"),
      gate: selectedGate,
      status: input.status,
      ...(input.targetSnapshotId ? { targetSnapshotId: nonEmpty(input.targetSnapshotId, "targetSnapshotId") } : {}),
      ...(input.operationId ? { operationId: nonEmpty(input.operationId, "operationId") } : {}),
      evidenceDigest: nonEmpty(input.evidenceDigest, "evidenceDigest"),
      ...(input.evidenceReference ? { evidenceReference: nonEmpty(input.evidenceReference, "evidenceReference") } : {}),
      policyVersion: nonEmpty(input.policyVersion, "policyVersion"),
      evaluatedBy: nonEmpty(input.evaluatedBy, "evaluatedBy"),
      evaluatedAt: timestamp(evaluatedAt, "evaluation timestamp"),
      ...(input.expiresAt ? { expiresAt: timestamp(input.expiresAt, "expiry timestamp") } : {}),
      rationale: nonEmpty(input.rationale, "rationale")
    };
    if (evidence.expiresAt && Date.parse(evidence.expiresAt) <= Date.parse(evidence.evaluatedAt)) {
      throw new GateEvidenceError("Acceptance evidence expiry must be later than evaluation.");
    }
    return this.store.transaction(async (transaction) => {
      if (evidenceMap(await transaction.readEntries()).has(evidence.id)) throw new GateEvidenceError(`Acceptance evidence already exists: ${evidence.id}`);
      await transaction.append<EvidenceSavedEvent>("gate-evidence.saved", { evidence });
      return cloneEvidence(evidence);
    });
  }

  async invalidate(id: string, reason: string, attestedBy: string, authorizationProof?: string): Promise<void> {
    const existing = (await this.get(id));
    if (!existing) throw new GateEvidenceError(`Unknown acceptance evidence: ${id}`);
    await this.authorizer.assertMayRecord({
      operation: "invalidate",
      evaluatedBy: attestedBy,
      gate: existing.gate,
      evidenceId: existing.id,
      evidenceDigest: existing.evidenceDigest,
      ...(authorizationProof ? { authorizationProof } : {})
    });
    await this.store.append<EvidenceInvalidatedEvent>("gate-evidence.invalidated", {
      evidenceId: nonEmpty(id, "evidence id"),
      at: timestamp(this.clock(), "invalidation timestamp"),
      reason: nonEmpty(reason, "invalidation reason")
    });
  }

  async get(id: string): Promise<GateEvidence | undefined> {
    const found = evidenceMap(await this.store.readEntries()).get(id);
    return found ? cloneEvidence(found) : undefined;
  }

  async list(gateNumber?: AcceptanceGate): Promise<readonly GateEvidence[]> {
    return [...evidenceMap(await this.store.readEntries()).values()]
      .filter((evidence) => gateNumber === undefined || evidence.gate === gateNumber)
      .map(cloneEvidence);
  }

  async statusFor(gateNumber: AcceptanceGate, targetSnapshotId?: string, now = this.clock()): Promise<{ readonly status: GateEvidenceStatus; readonly evidence?: GateEvidence }> {
    const all = [...(await this.list(gate(gateNumber)))].sort((left, right) => Date.parse(right.evaluatedAt) - Date.parse(left.evaluatedAt));
    const candidate = targetSnapshotId === undefined
      ? all[0]
      : all.find((evidence) => evidence.targetSnapshotId === targetSnapshotId) ?? all[0];
    if (!candidate) return { status: "not_evaluated" };
    if (candidate.invalidatedAt || (candidate.expiresAt && Date.parse(candidate.expiresAt) <= Date.parse(now))) return { status: "incomplete", evidence: candidate };
    if (targetSnapshotId !== undefined && candidate.targetSnapshotId !== targetSnapshotId) return { status: "incomplete", evidence: candidate };
    if (candidate.status === "passed" && this.artifactVerifier && !await Promise.resolve(this.artifactVerifier.verify(candidate)).catch(() => false)) return { status: "incomplete", evidence: candidate };
    return { status: candidate.status, evidence: candidate };
  }

  async policyEvidence(targetSnapshotId?: string, now = this.clock()): Promise<Readonly<Record<number, GateEvidenceStatus>>>
  {
    const result: Record<number, GateEvidenceStatus> = {};
    for (let value = 1; value <= 27; value += 1) result[value] = (await this.statusFor(value as AcceptanceGate, targetSnapshotId, now)).status;
    return result;
  }
}
