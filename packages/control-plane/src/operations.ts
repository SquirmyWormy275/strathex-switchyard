import { randomUUID } from "node:crypto";
import type { CommandStatus, OperationRecord, OperationState, ReceiptResult } from "./contracts.ts";
import { redactText } from "./redaction.ts";
import { ReceiptLedger } from "./receipts.ts";
import { jsonClone, sha256, stableJson, type JournalEntry, type JsonStoreTransaction, ProtectedJsonStore } from "./store.ts";

export interface OperationStart {
  readonly id?: string;
  readonly parentId?: string;
  readonly idempotencyKey: string;
  readonly action: string;
  readonly targetSnapshotId: string;
  readonly details?: Readonly<Record<string, string>>;
}

export interface BegunOperation {
  readonly operation: OperationRecord;
  readonly reused: boolean;
}

export interface ResourceLease {
  readonly id: string;
  readonly resource: string;
  readonly operationId: string;
  readonly holder: string;
  /** Monotonic per-resource fence; consumers reject an older fence. */
  readonly fence: number;
  readonly acquiredAt: string;
  readonly expiresAt: string;
  readonly releasedAt?: string;
  readonly revokedAt?: string;
}

export interface LeaseRequest {
  readonly operationId: string;
  readonly resource: string;
  readonly holder: string;
  readonly durationMs: number;
  readonly now?: string;
}

export interface ReconciliationDecision {
  /** No state means the child remains unresolved and must not be retried automatically. */
  readonly state?: OperationState;
  readonly details?: Readonly<Record<string, string>>;
  readonly note?: string;
}

export interface OperationReconciler {
  /** Probe an external provider's actual state; do not repeat the side effect. */
  reconcile(operation: OperationRecord): Promise<ReconciliationDecision>;
}

export interface ReconciliationResult {
  readonly operationId: string;
  readonly outcome: OperationState | "unresolved";
  readonly note: string;
}

/**
 * A broker-side effect is always durably named before the broker invokes a
 * provider. `idempotencyScope` must identify one provider request within the
 * parent operation; it is hashed into the durable child idempotency key.
 */
export interface ChildOperationStart {
  readonly action: string;
  readonly idempotencyScope: string;
  readonly details?: Readonly<Record<string, string>>;
}

/** A child lease is capability-scoped to one parent and one TargetSnapshot. */
export interface ChildOperationLease {
  readonly operationId: string;
  readonly parentOperationId: string;
  readonly action: string;
  readonly targetSnapshotId: string;
  readonly existing: boolean;
  readonly state: OperationState;
  /** False means a prior attempt exists and must be reconciled, never replayed. */
  readonly mayExecute: boolean;
}

/**
 * Terminal child outcomes deliberately distinguish an unknown provider result
 * from a known failure. `ambiguous` leaves the child active for reconciliation.
 */
export type ChildOperationOutcome = "completed" | "failed" | "cancelled" | "ambiguous";

/**
 * Passed only to trusted composite broker handlers. It does not execute a
 * provider call itself; it records the child saga around the handler's typed
 * provider call and refuses an idempotently reused child from being executed.
 */
export interface ChildOperationSaga {
  begin(input: ChildOperationStart): Promise<ChildOperationLease>;
  markExecuting(lease: ChildOperationLease): Promise<void>;
  markExternalCommitted(lease: ChildOperationLease, details?: Readonly<Record<string, string>>): Promise<void>;
  markCancelling(lease: ChildOperationLease): Promise<void>;
  markCompensating(lease: ChildOperationLease): Promise<void>;
  settle(lease: ChildOperationLease, outcome: ChildOperationOutcome, details?: Readonly<Record<string, string>>): Promise<void>;
}

/** Structural seam used by dispatch without coupling it to this implementation. */
export interface ChildOperationCoordinator {
  childSaga(lease: DurableCommandOperationLease): ChildOperationSaga;
}

/** Structural match for the dispatch coordinator contract without a runtime dependency on dispatch.ts. */
export interface DurableCommandOperationLease {
  readonly operationId: string;
  readonly existing: boolean;
  readonly existingStatus?: CommandStatus;
}

export interface DurableOperationClaim {
  readonly action: string;
  readonly targetSnapshotId?: string;
  readonly sessionId?: string;
}

export interface DurableOperationResult {
  readonly action: string;
  readonly targetSnapshotId?: string;
  readonly authorityId?: string;
  readonly status: CommandStatus;
  readonly summary: string;
  /** Gate-bearing receipts are issued only with explicit evidence metadata. */
  readonly policyVersion?: string;
  readonly evidenceDigest?: string;
  readonly toolVersions?: Readonly<Record<string, string>>;
  readonly expiresAt?: string;
}

interface OperationSavedEvent {
  readonly operation: OperationRecord;
}

interface ReconciliationObservedEvent {
  readonly operationId: string;
  readonly at: string;
  readonly outcome: OperationState | "unresolved";
  readonly note: string;
}

interface LeaseSavedEvent {
  readonly lease: ResourceLease;
}

export class OperationSagaError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "OperationSagaError";
  }
}

export class IdempotencyConflictError extends OperationSagaError {
  constructor(message: string) {
    super(message);
    this.name = "IdempotencyConflictError";
  }
}

export class ResourceLeaseConflictError extends OperationSagaError {
  constructor(message: string) {
    super(message);
    this.name = "ResourceLeaseConflictError";
  }
}

function nonEmpty(value: string, field: string): string {
  const normalized = value.trim();
  if (!normalized) throw new OperationSagaError(`${field} must be non-empty.`);
  return normalized;
}

function parseTimestamp(value: string, field: string): number {
  const parsed = Date.parse(value);
  if (!Number.isFinite(parsed)) throw new OperationSagaError(`${field} must be a valid ISO timestamp.`);
  return parsed;
}

function sanitizeDetails(details: Readonly<Record<string, string>> | undefined): Readonly<Record<string, string>> {
  const sanitized: Record<string, string> = {};
  for (const [key, value] of Object.entries(details ?? {})) {
    sanitized[nonEmpty(key, "operation detail key")] = redactText(nonEmpty(value, "operation detail value"));
  }
  return sanitized;
}

function cloneOperation(operation: OperationRecord): OperationRecord {
  return {
    ...operation,
    childIds: [...operation.childIds],
    details: { ...operation.details }
  };
}

function operationMap(entries: readonly JournalEntry<unknown>[]): Map<string, OperationRecord> {
  const operations = new Map<string, OperationRecord>();
  for (const entry of entries) {
    if (entry.kind !== "operation.created" && entry.kind !== "operation.updated") continue;
    const payload = entry.payload as OperationSavedEvent;
    if (!payload?.operation || typeof payload.operation.id !== "string") {
      throw new OperationSagaError("Protected operation record is malformed.");
    }
    operations.set(payload.operation.id, cloneOperation(payload.operation));
  }
  // A crash can occur after the child record is durable but before a redundant
  // parent childIds update. parentId is the source of truth during recovery.
  for (const operation of operations.values()) {
    if (!operation.parentId) continue;
    const parent = operations.get(operation.parentId);
    if (!parent || parent.childIds.includes(operation.id)) continue;
    operations.set(parent.id, { ...parent, childIds: [...parent.childIds, operation.id] });
  }
  return operations;
}

function leaseMap(entries: readonly JournalEntry<unknown>[]): Map<string, ResourceLease> {
  const leases = new Map<string, ResourceLease>();
  for (const entry of entries) {
    if (entry.kind !== "lease.created" && entry.kind !== "lease.updated") continue;
    const payload = entry.payload as LeaseSavedEvent;
    if (!payload?.lease || typeof payload.lease.id !== "string") throw new OperationSagaError("Protected lease record is malformed.");
    leases.set(payload.lease.id, jsonClone(payload.lease));
  }
  return leases;
}

function isTerminal(state: OperationState): boolean {
  return state === "recorded" || state === "failed" || state === "cancelled";
}

function permitsTransition(from: OperationState, to: OperationState): boolean {
  if (from === to) return true;
  const allowed: Readonly<Record<OperationState, readonly OperationState[]>> = {
    prepared: ["executing", "failed", "cancelling", "cancelled"],
    executing: ["external_committed", "failed", "cancelling", "compensating"],
    external_committed: ["recorded", "compensating"],
    recorded: [],
    failed: [],
    cancelling: ["cancelled", "compensating", "failed"],
    compensating: ["cancelled", "failed", "external_committed"] ,
    cancelled: []
  };
  return allowed[from].includes(to);
}

function activeLease(lease: ResourceLease, now: string): boolean {
  return !lease.releasedAt && !lease.revokedAt && Date.parse(lease.expiresAt) > Date.parse(now);
}

/** A deterministic idempotency key builder for provider-specific collision scopes. */
export function deriveIdempotencyKey(scope: Readonly<Record<string, string>>): string {
  const normalized: Record<string, string> = {};
  for (const [key, value] of Object.entries(scope)) normalized[nonEmpty(key, "idempotency scope key")] = nonEmpty(value, "idempotency scope value");
  return sha256(stableJson(normalized));
}

/**
 * Durable parent/child operation state with an intentionally conservative
 * reconciliation rule: external ambiguity is observed and resolved per child;
 * this class never restarts a parent saga as a retry shortcut.
 */
export class OperationSagaStore {
  private readonly store: ProtectedJsonStore;
  private readonly clock: () => string;
  private readonly idFactory: () => string;

  constructor(store: ProtectedJsonStore, options: { readonly clock?: () => string; readonly idFactory?: () => string } = {}) {
    this.store = store;
    this.clock = options.clock ?? (() => new Date().toISOString());
    this.idFactory = options.idFactory ?? randomUUID;
  }

  async begin(input: OperationStart): Promise<BegunOperation> {
    return this.store.transaction(async (transaction) => this.beginWithin(transaction, input));
  }

  async beginChild(parentId: string, input: Omit<OperationStart, "parentId">): Promise<BegunOperation> {
    return this.store.transaction(async (transaction) => this.beginWithin(transaction, { ...input, parentId }));
  }

  /**
   * Atomically find an active dispatch scope or create a new generation after
   * its predecessor is terminal. This gives repeated presses a durable focus
   * target while still allowing a later intentional invocation.
   */
  async claimScope(input: Readonly<{ scope: string; action: string; targetSnapshotId: string; details?: Readonly<Record<string, string>> }>): Promise<BegunOperation> {
    return this.store.transaction(async (transaction) => {
      const operations = operationMap(await transaction.readEntries());
      const scope = nonEmpty(input.scope, "operation scope");
      const matching = [...operations.values()]
        .filter((operation) => operation.details.dispatchScope === scope)
        .sort((left, right) => Date.parse(left.createdAt) - Date.parse(right.createdAt));
      const active = matching.find((operation) => !isTerminal(operation.state));
      if (active) return { operation: cloneOperation(active), reused: true };
      const generation = matching.length + 1;
      return this.beginWithin(transaction, {
        action: input.action,
        targetSnapshotId: input.targetSnapshotId,
        idempotencyKey: deriveIdempotencyKey({ dispatchScope: scope, generation: String(generation) }),
        details: { ...input.details, dispatchScope: scope, dispatchGeneration: String(generation) }
      });
    });
  }

  async get(id: string): Promise<OperationRecord | undefined> {
    const operation = operationMap(await this.store.readEntries()).get(id);
    return operation ? cloneOperation(operation) : undefined;
  }

  async list(): Promise<readonly OperationRecord[]> {
    return [...operationMap(await this.store.readEntries()).values()].map(cloneOperation);
  }

  /**
   * Preflight a terminal parent result before any receipt can be issued. The
   * final transition repeats this fence inside its write transaction.
   */
  async assertChildrenTerminal(id: string): Promise<void> {
    await this.store.transaction(async (transaction) => {
      const operations = operationMap(await transaction.readEntries());
      const existing = operations.get(id);
      if (!existing) throw new OperationSagaError(`Unknown operation: ${id}`);
      assertChildrenTerminal(operations, existing);
    });
  }

  async findByIdempotencyKey(idempotencyKey: string): Promise<OperationRecord | undefined> {
    const found = (await this.list()).find((operation) => operation.idempotencyKey === idempotencyKey);
    return found ? cloneOperation(found) : undefined;
  }

  async advance(id: string, state: OperationState, details?: Readonly<Record<string, string>>): Promise<OperationRecord> {
    return this.store.transaction(async (transaction) => {
      const operations = operationMap(await transaction.readEntries());
      const existing = operations.get(id);
      if (!existing) throw new OperationSagaError(`Unknown operation: ${id}`);
      if (existing.state === state) {
        const additional = sanitizeDetails(details);
        if (Object.keys(additional).length === 0) return cloneOperation(existing);
        const next: OperationRecord = {
          ...existing,
          updatedAt: this.clock(),
          details: { ...existing.details, ...additional }
        };
        await transaction.append<OperationSavedEvent>("operation.updated", { operation: next });
        return cloneOperation(next);
      }
      if (!permitsTransition(existing.state, state)) {
        throw new OperationSagaError(`Invalid durable operation transition ${existing.state} -> ${state} for ${id}.`);
      }
      if (isTerminal(state)) {
        assertChildrenTerminal(operations, existing);
      }
      const next: OperationRecord = {
        ...existing,
        state,
        updatedAt: this.clock(),
        details: { ...existing.details, ...sanitizeDetails(details) }
      };
      await transaction.append<OperationSavedEvent>("operation.updated", { operation: next });
      return cloneOperation(next);
    });
  }

  async reconciliationCandidates(): Promise<readonly OperationRecord[]> {
    return (await this.list()).filter((operation) =>
      ["executing", "external_committed", "cancelling", "compensating"].includes(operation.state)
      // A child is durable before a broker may invoke its provider. If the
      // process dies between those writes, fail closed and observe it rather
      // than letting a repeat press silently replay the provider request.
      || (operation.parentId !== undefined && operation.state === "prepared")
    );
  }

  async reconcilePending(reconciler: OperationReconciler): Promise<readonly ReconciliationResult[]> {
    const candidates = await this.reconciliationCandidates();
    const results: ReconciliationResult[] = [];
    for (const candidate of candidates) {
      let decision: ReconciliationDecision;
      try {
        decision = await reconciler.reconcile(candidate);
      } catch {
        const note = "External reconciliation probe failed; operation remains unresolved and was not retried.";
        await this.recordReconciliation(candidate.id, "unresolved", note);
        results.push({ operationId: candidate.id, outcome: "unresolved", note });
        continue;
      }
      if (!candidate.parentId && decision.state === "recorded") {
        // The operation store has no receipt/evidence authority. A root may
        // be observed externally committed, but becoming Recorded is reserved
        // for DurableOperationCoordinator.recordResult after its audit/receipt
        // writes succeed.
        decision = {
          ...decision,
          state: undefined,
          note: "Top-level completion requires durable result and receipt recording; reconciliation did not mark it recorded."
        };
      }
      if (decision.state) {
        try {
          await this.advanceReconciled(candidate, decision.state, decision.details);
        } catch (error) {
          const note = error instanceof Error ? `Reconciliation could not advance durable state: ${redactText(error.message)}` : "Reconciliation could not advance durable state.";
          await this.recordReconciliation(candidate.id, "unresolved", note);
          results.push({ operationId: candidate.id, outcome: "unresolved", note });
          continue;
        }
      }
      const outcome = decision.state ?? "unresolved";
      const note = decision.note ? redactText(decision.note) : outcome === "unresolved"
        ? "External state remains ambiguous; no retry was performed."
        : "External state was reconciled without replaying the parent saga.";
      await this.recordReconciliation(candidate.id, outcome, note);
      results.push({ operationId: candidate.id, outcome, note });
    }
    return results;
  }

  async acquireLease(request: LeaseRequest): Promise<ResourceLease> {
    const now = request.now ?? this.clock();
    const nowMs = parseTimestamp(now, "lease timestamp");
    if (!Number.isFinite(request.durationMs) || request.durationMs <= 0) throw new OperationSagaError("Lease duration must be a positive finite value.");
    const resource = nonEmpty(request.resource, "lease resource");
    const holder = nonEmpty(request.holder, "lease holder");
    return this.store.transaction(async (transaction) => {
      const operations = operationMap(await transaction.readEntries());
      if (!operations.has(request.operationId)) throw new OperationSagaError(`Unknown operation for lease: ${request.operationId}`);
      const leases = leaseMap(await transaction.readEntries());
      const allForResource = [...leases.values()].filter((lease) => lease.resource === resource);
      const existing = allForResource.find((lease) => activeLease(lease, now));
      if (existing) {
        if (existing.operationId === request.operationId && existing.holder === holder) return jsonClone(existing);
        throw new ResourceLeaseConflictError(`Resource ${resource} is fenced by operation ${existing.operationId} until ${existing.expiresAt}.`);
      }
      const fence = Math.max(0, ...allForResource.map((lease) => lease.fence)) + 1;
      const lease: ResourceLease = {
        id: this.idFactory(),
        resource,
        operationId: request.operationId,
        holder,
        fence,
        acquiredAt: now,
        expiresAt: new Date(nowMs + request.durationMs).toISOString()
      };
      await transaction.append<LeaseSavedEvent>("lease.created", { lease });
      return jsonClone(lease);
    });
  }

  async renewLease(leaseId: string, holder: string, durationMs: number, now = this.clock()): Promise<ResourceLease> {
    const nowMs = parseTimestamp(now, "lease renewal timestamp");
    if (!Number.isFinite(durationMs) || durationMs <= 0) throw new OperationSagaError("Lease duration must be a positive finite value.");
    return this.store.transaction(async (transaction) => {
      const leases = leaseMap(await transaction.readEntries());
      const existing = leases.get(leaseId);
      if (!existing) throw new OperationSagaError(`Unknown lease: ${leaseId}`);
      if (existing.holder !== holder) throw new ResourceLeaseConflictError("Only the recorded lease holder can renew this resource.");
      if (!activeLease(existing, now)) throw new ResourceLeaseConflictError("Expired, released, or revoked leases cannot be renewed.");
      const renewed: ResourceLease = { ...existing, expiresAt: new Date(nowMs + durationMs).toISOString() };
      await transaction.append<LeaseSavedEvent>("lease.updated", { lease: renewed });
      return jsonClone(renewed);
    });
  }

  async releaseLease(leaseId: string, holder: string, now = this.clock()): Promise<ResourceLease> {
    parseTimestamp(now, "lease release timestamp");
    return this.store.transaction(async (transaction) => {
      const leases = leaseMap(await transaction.readEntries());
      const existing = leases.get(leaseId);
      if (!existing) throw new OperationSagaError(`Unknown lease: ${leaseId}`);
      if (existing.holder !== holder) throw new ResourceLeaseConflictError("Only the recorded lease holder can release this resource.");
      if (existing.releasedAt) return jsonClone(existing);
      const released: ResourceLease = { ...existing, releasedAt: now };
      await transaction.append<LeaseSavedEvent>("lease.updated", { lease: released });
      return jsonClone(released);
    });
  }

  async revokeLeasesForResource(resource: string, now = this.clock()): Promise<readonly ResourceLease[]> {
    parseTimestamp(now, "lease revocation timestamp");
    return this.store.transaction(async (transaction) => {
      const leases = leaseMap(await transaction.readEntries());
      const revoked: ResourceLease[] = [];
      for (const existing of leases.values()) {
        if (existing.resource !== resource || existing.releasedAt || existing.revokedAt) continue;
        const next: ResourceLease = { ...existing, revokedAt: now };
        await transaction.append<LeaseSavedEvent>("lease.updated", { lease: next });
        revoked.push(jsonClone(next));
      }
      return revoked;
    });
  }

  async activeLeases(resource?: string, now = this.clock()): Promise<readonly ResourceLease[]> {
    parseTimestamp(now, "lease query timestamp");
    return [...leaseMap(await this.store.readEntries()).values()]
      .filter((lease) => (resource === undefined || lease.resource === resource) && activeLease(lease, now))
      .map((lease) => jsonClone(lease));
  }

  private async beginWithin(transaction: JsonStoreTransaction, input: OperationStart): Promise<BegunOperation> {
    const operations = operationMap(await transaction.readEntries());
    const idempotencyKey = nonEmpty(input.idempotencyKey, "idempotencyKey");
    const action = nonEmpty(input.action, "action");
    const targetSnapshotId = nonEmpty(input.targetSnapshotId, "targetSnapshotId");
    const parentId = input.parentId ? nonEmpty(input.parentId, "parentId") : undefined;
    if (parentId && !operations.has(parentId)) throw new OperationSagaError(`Unknown parent operation: ${parentId}`);
    if (parentId) {
      const parent = operations.get(parentId)!;
      if (isTerminal(parent.state)) throw new OperationSagaError(`Cannot add a child to terminal parent operation: ${parentId}`);
      if (parent.state !== "prepared" && parent.state !== "executing") {
        throw new OperationSagaError(`Cannot add a child after parent operation ${parentId} has an external commit or cancellation state.`);
      }
    }
    const existing = [...operations.values()].find((operation) => operation.idempotencyKey === idempotencyKey);
    if (existing) {
      if (existing.action !== action || existing.targetSnapshotId !== targetSnapshotId || existing.parentId !== parentId) {
        throw new IdempotencyConflictError(`Idempotency key ${idempotencyKey} is already bound to a different operation scope.`);
      }
      return { operation: cloneOperation(existing), reused: true };
    }
    const id = nonEmpty(input.id ?? this.idFactory(), "operation id");
    if (operations.has(id)) throw new OperationSagaError(`Operation id already exists: ${id}`);
    const createdAt = this.clock();
    const operation: OperationRecord = {
      id,
      ...(parentId ? { parentId } : {}),
      idempotencyKey,
      action,
      targetSnapshotId,
      state: "prepared",
      createdAt,
      updatedAt: createdAt,
      childIds: [],
      details: sanitizeDetails(input.details)
    };
    await transaction.append<OperationSavedEvent>("operation.created", { operation });
    if (parentId) {
      const parent = operations.get(parentId)!;
      const updatedParent: OperationRecord = { ...parent, childIds: [...new Set([...parent.childIds, id])], updatedAt: this.clock() };
      await transaction.append<OperationSavedEvent>("operation.updated", { operation: updatedParent });
    }
    return { operation: cloneOperation(operation), reused: false };
  }

  private async recordReconciliation(operationId: string, outcome: OperationState | "unresolved", note: string): Promise<void> {
    await this.store.append<ReconciliationObservedEvent>("operation.reconciliation_observed", {
      operationId,
      at: this.clock(),
      outcome,
      note: redactText(note)
    });
  }

  /**
   * A reconciler has observed provider state, so it may write the minimal
   * durable path required to reflect that observation. It still never invokes
   * a provider or bypasses the parent/child terminal-state fence.
   */
  private async advanceReconciled(operation: OperationRecord, target: OperationState, details?: Readonly<Record<string, string>>): Promise<void> {
    const path = reconciliationPath(operation.state, target);
    if (!path) {
      throw new OperationSagaError(`Reconciliation cannot safely advance ${operation.state} to ${target} for ${operation.id}.`);
    }
    for (const state of path) {
      await this.advance(operation.id, state, state === target ? details : undefined);
    }
  }
}

function assertChildrenTerminal(operations: ReadonlyMap<string, OperationRecord>, parent: OperationRecord): void {
  const incompleteChild = parent.childIds
    .map((childId) => operations.get(childId))
    .find((child) => !child || !isTerminal(child.state));
  if (incompleteChild) {
    throw new OperationSagaError(`Parent operation ${parent.id} cannot transition to terminal state while child ${incompleteChild.id} is unresolved.`);
  }
}

function reconciliationPath(from: OperationState, to: OperationState): readonly OperationState[] | undefined {
  if (from === to) return [to];
  if (permitsTransition(from, to)) return [to];
  // These paths only record a reconciler's affirmative provider observation;
  // they never repeat the external side effect.
  if ((from === "executing" || from === "compensating") && to === "recorded") return ["external_committed", "recorded"];
  if (from === "prepared" && to === "recorded") return ["executing", "external_committed", "recorded"];
  if (from === "executing" && to === "cancelled") return ["cancelling", "cancelled"];
  return undefined;
}

/**
 * Parent-bound broker capability for a single dispatch invocation. A broker
 * handler receives this only while its dispatcher call is active. A durable
 * child is considered ambiguous as soon as it exists, so a reused child can
 * only be observed through reconciliation and cannot be executed again.
 */
class DurableChildOperationSaga implements ChildOperationSaga {
  private closed = false;
  private readonly operations: OperationSagaStore;
  private readonly parentOperationId: string;

  constructor(operations: OperationSagaStore, parentOperationId: string) {
    this.operations = operations;
    this.parentOperationId = parentOperationId;
  }

  close(): void {
    this.closed = true;
  }

  async begin(input: ChildOperationStart): Promise<ChildOperationLease> {
    this.assertOpen();
    const parent = await this.requireParent();
    if (parent.state !== "executing") {
      throw new OperationSagaError(`Child side effects require executing parent operation ${parent.id}; current state is ${parent.state}.`);
    }
    const action = nonEmpty(input.action, "child action");
    const idempotencyScope = nonEmpty(input.idempotencyScope, "child idempotencyScope");
    const begun = await this.operations.beginChild(parent.id, {
      action,
      targetSnapshotId: parent.targetSnapshotId,
      idempotencyKey: deriveIdempotencyKey({ parentOperationId: parent.id, action, idempotencyScope }),
      details: input.details
    });
    return childLeaseFor(begun.operation, begun.reused);
  }

  async markExecuting(lease: ChildOperationLease): Promise<void> {
    const child = await this.requireNewChild(lease);
    if (child.state === "executing") return;
    if (child.state !== "prepared") throw new OperationSagaError(`Child ${child.id} cannot begin provider execution from ${child.state}.`);
    await this.operations.advance(child.id, "executing");
  }

  async markExternalCommitted(lease: ChildOperationLease, details?: Readonly<Record<string, string>>): Promise<void> {
    const child = await this.requireNewChild(lease);
    if (child.state === "external_committed") {
      await this.operations.advance(child.id, child.state, details);
      return;
    }
    if (child.state !== "executing") {
      throw new OperationSagaError(`Child ${child.id} cannot record an external commit from ${child.state}.`);
    }
    await this.operations.advance(child.id, "external_committed", details);
  }

  async markCancelling(lease: ChildOperationLease): Promise<void> {
    const child = await this.requireNewChild(lease);
    if (child.state === "cancelling") return;
    if (child.state !== "executing") throw new OperationSagaError(`Child ${child.id} cannot begin cancellation from ${child.state}.`);
    await this.operations.advance(child.id, "cancelling");
  }

  async markCompensating(lease: ChildOperationLease): Promise<void> {
    const child = await this.requireNewChild(lease);
    if (child.state === "compensating") return;
    if (child.state !== "external_committed" && child.state !== "cancelling") {
      throw new OperationSagaError(`Child ${child.id} cannot begin compensation from ${child.state}.`);
    }
    await this.operations.advance(child.id, "compensating");
  }

  async settle(lease: ChildOperationLease, outcome: ChildOperationOutcome, details?: Readonly<Record<string, string>>): Promise<void> {
    const child = await this.requireNewChild(lease);
    switch (outcome) {
      case "ambiguous":
        if (isTerminal(child.state)) throw new OperationSagaError(`Terminal child ${child.id} cannot be relabelled ambiguous.`);
        await this.operations.advance(child.id, child.state, details);
        return;
      case "completed":
        if (child.state === "recorded") {
          await this.operations.advance(child.id, child.state, details);
          return;
        }
        if (child.state !== "external_committed") {
          throw new OperationSagaError(`Child ${child.id} cannot complete without a recorded external commit; use ambiguous when provider state is unknown.`);
        }
        await this.operations.advance(child.id, "recorded", details);
        return;
      case "failed":
        if (child.state === "failed") {
          await this.operations.advance(child.id, child.state, details);
          return;
        }
        if (!["prepared", "executing", "cancelling", "compensating"].includes(child.state)) {
          throw new OperationSagaError(`Child ${child.id} has an external commit and cannot be marked failed without compensation.`);
        }
        await this.operations.advance(child.id, "failed", details);
        return;
      case "cancelled":
        if (child.state === "cancelled") {
          await this.operations.advance(child.id, child.state, details);
          return;
        }
        if (child.state === "prepared") {
          await this.operations.advance(child.id, "cancelled", details);
          return;
        }
        if (child.state === "executing") await this.operations.advance(child.id, "cancelling");
        const cancelling = await this.requireChild(lease);
        if (cancelling.state !== "cancelling" && cancelling.state !== "compensating") {
          throw new OperationSagaError(`Child ${child.id} cannot be cancelled from ${cancelling.state}.`);
        }
        await this.operations.advance(cancelling.id, "cancelled", details);
        return;
    }
  }

  private assertOpen(): void {
    if (this.closed) throw new OperationSagaError("The broker child-saga scope is closed; reconcile rather than continuing a previous provider call.");
  }

  private async requireParent(): Promise<OperationRecord> {
    const parent = await this.operations.get(this.parentOperationId);
    if (!parent) throw new OperationSagaError(`Unknown parent operation for child saga: ${this.parentOperationId}`);
    return parent;
  }

  private async requireNewChild(lease: ChildOperationLease): Promise<OperationRecord> {
    this.assertOpen();
    if (lease.existing || !lease.mayExecute) {
      throw new OperationSagaError(`Child ${lease.operationId} belongs to an earlier provider attempt and must be reconciled rather than replayed.`);
    }
    return this.requireChild(lease);
  }

  private async requireChild(lease: ChildOperationLease): Promise<OperationRecord> {
    if (lease.parentOperationId !== this.parentOperationId) throw new OperationSagaError("Child lease is not bound to this parent operation.");
    const child = await this.operations.get(lease.operationId);
    if (!child) throw new OperationSagaError(`Unknown child operation: ${lease.operationId}`);
    if (child.parentId !== this.parentOperationId || child.action !== lease.action || child.targetSnapshotId !== lease.targetSnapshotId) {
      throw new OperationSagaError(`Child lease ${lease.operationId} does not match its durable operation binding.`);
    }
    return child;
  }
}

function childLeaseFor(operation: OperationRecord, existing: boolean): ChildOperationLease {
  if (!operation.parentId) throw new OperationSagaError(`Operation ${operation.id} is not a child operation.`);
  return {
    operationId: operation.id,
    parentOperationId: operation.parentId,
    action: operation.action,
    targetSnapshotId: operation.targetSnapshotId,
    existing,
    state: operation.state,
    mayExecute: !existing && operation.state === "prepared"
  };
}

/**
 * Bootstrap-only recovery registry. It invokes only registered observation
 * adapters; it never calls a broker handler or creates a new child operation.
 * Top-level completion is deliberately left for normal durable result/receipt
 * recording, so recovery cannot manufacture a green root operation.
 */
export class NoReplayOperationRecovery {
  private readonly reconcilers = new Map<string, OperationReconciler>();
  private readonly operations: OperationSagaStore;

  constructor(operations: OperationSagaStore) {
    this.operations = operations;
  }

  register(action: string, reconciler: OperationReconciler): void {
    this.reconcilers.set(nonEmpty(action, "reconciliation action"), reconciler);
  }

  async recoverPending(): Promise<readonly ReconciliationResult[]> {
    return this.operations.reconcilePending({
      reconcile: async (operation) => {
        const reconciler = this.reconcilers.get(operation.action);
        if (!reconciler) {
          return {
            note: operation.parentId
              ? "No child reconciliation adapter is registered; provider state remains ambiguous and was not replayed."
              : "Top-level operation remains for durable result and receipt recovery; no replay was performed."
          };
        }
        const decision = await reconciler.reconcile(operation);
        if (!operation.parentId && decision.state === "recorded") {
          return {
            ...decision,
            state: undefined,
            note: "Top-level completion requires normal durable result and receipt recording; no replay was performed."
          };
        }
        return decision;
      }
    });
  }
}

function commandStatusFor(operation: OperationRecord): CommandStatus {
  switch (operation.state) {
    case "prepared": return "queued";
    case "executing":
    case "external_committed":
    case "compensating": return "running";
    case "cancelling": return "running";
    case "recorded": return "completed";
    case "failed": return "failed";
    case "cancelled": return "cancelled";
  }
}

function receiptResultFor(status: CommandStatus): ReceiptResult {
  switch (status) {
    case "completed": return "passed";
    case "failed":
    case "timed_out":
    case "cancelled": return "failed";
    case "unavailable": return "unavailable";
    case "incomplete": return "incomplete";
    default: return "not_run";
  }
}

function isFinalCommandStatus(status: CommandStatus): boolean {
  return ["completed", "failed", "timed_out", "unavailable", "incomplete", "blocked", "cancelled"].includes(status);
}

/**
 * Dispatch-facing durable coordinator. It intentionally creates an audit for
 * every settled result, issues a typed receipt only when evidence is supplied,
 * and reaches Recorded only after those protected records are durable.
 */
export class DurableOperationCoordinator {
  private readonly operations: OperationSagaStore;
  private readonly receipts: ReceiptLedger;

  constructor(operations: OperationSagaStore, receipts: ReceiptLedger) {
    this.operations = operations;
    this.receipts = receipts;
  }

  async claim(input: DurableOperationClaim): Promise<DurableCommandOperationLease> {
    const action = nonEmpty(input.action, "dispatch action");
    const targetSnapshotId = input.targetSnapshotId ?? `<no-target:${input.sessionId ?? "host"}>`;
    const scope = deriveIdempotencyKey({ action, targetSnapshotId, sessionId: input.sessionId ?? "none" });
    const claimed = await this.operations.claimScope({
      scope,
      action,
      targetSnapshotId,
      details: { ...(input.sessionId ? { sessionId: input.sessionId } : {}), targetBound: input.targetSnapshotId ? "true" : "false" }
    });
    return {
      operationId: claimed.operation.id,
      existing: claimed.reused,
      ...(claimed.reused ? { existingStatus: commandStatusFor(claimed.operation) } : {})
    };
  }

  /** Creates a parent-bound broker capability for one composite dispatch. */
  childSaga(lease: DurableCommandOperationLease): ChildOperationSaga {
    if (lease.existing) {
      throw new OperationSagaError(`Cannot create a broker child saga for focused existing operation ${lease.operationId}.`);
    }
    return new DurableChildOperationSaga(this.operations, lease.operationId);
  }

  async markExecuting(lease: DurableCommandOperationLease): Promise<void> {
    const operation = await this.requireOperation(lease.operationId);
    if (operation.state === "prepared") await this.operations.advance(operation.id, "executing");
  }

  async markExternalCommitted(lease: DurableCommandOperationLease, details?: Readonly<Record<string, string>>): Promise<void> {
    const operation = await this.requireOperation(lease.operationId);
    if (operation.state === "prepared") await this.operations.advance(operation.id, "executing");
    const current = await this.requireOperation(lease.operationId);
    if (current.state === "executing") await this.operations.advance(current.id, "external_committed", details);
  }

  /** Persist operator/timeout cancellation intent without guessing whether an external provider stopped. */
  async requestCancellation(operationId: string, reason: string): Promise<void> {
    const operation = await this.requireOperation(operationId);
    if (["recorded", "failed", "cancelled"].includes(operation.state)) return;
    if (operation.state === "prepared" || operation.state === "executing") {
      await this.operations.advance(operation.id, "cancelling", { cancellationReason: reason });
    }
    await this.receipts.audit({
      id: auditId(operation.id, "cancelling"),
      action: operation.action,
      status: "cancelling",
      operationId: operation.id,
      ...(operation.targetSnapshotId.startsWith("<no-target:") ? {} : { targetSnapshotId: operation.targetSnapshotId }),
      detail: "Durable cancellation intent was recorded; provider reconciliation is required before a final outcome."
    });
  }

  /**
   * Persist the user-visible outcome. A successful result is not marked
   * Recorded until audit/receipt writes have succeeded. Missing evidence never
   * produces a green receipt; it still produces a sanitized audit event.
   */
  async recordResult(lease: DurableCommandOperationLease, result: DurableOperationResult): Promise<{ readonly receiptId?: string }> {
    let operation = await this.requireOperation(lease.operationId);
    if (operation.action !== result.action) throw new OperationSagaError("A dispatch result cannot be recorded against a different operation action.");
    if (result.targetSnapshotId && operation.targetSnapshotId !== result.targetSnapshotId) {
      throw new OperationSagaError("A dispatch result cannot be recorded against a different target snapshot.");
    }
    if (operation.state === "recorded" || operation.state === "failed" || operation.state === "cancelled") return {};

    if (result.status === "running") {
      await this.markExecuting(lease);
      await this.receipts.audit({ id: auditId(operation.id, "running"), action: result.action, status: "running", operationId: operation.id, ...(result.targetSnapshotId ? { targetSnapshotId: result.targetSnapshotId } : {}), detail: result.summary });
      return {};
    }
    if (["queued", "awaiting_input", "awaiting_confirmation"].includes(result.status)) {
      await this.receipts.audit({ id: auditId(operation.id, result.status), action: result.action, status: result.status, operationId: operation.id, ...(result.targetSnapshotId ? { targetSnapshotId: result.targetSnapshotId } : {}), detail: result.summary });
      return {};
    }
    if (!isFinalCommandStatus(result.status)) {
      throw new OperationSagaError(`Unsupported command status for durable operation: ${result.status}`);
    }
    let receiptId: string | undefined;
    if (result.status === "completed") {
      await this.markExternalCommitted(lease, { commandStatus: result.status });
      operation = await this.requireOperation(lease.operationId);
    } else if (result.status === "cancelled") {
      await this.markExecuting(lease);
      operation = await this.requireOperation(lease.operationId);
      if (operation.state === "executing") await this.operations.advance(operation.id, "cancelling", { commandStatus: result.status });
      operation = await this.requireOperation(lease.operationId);
    } else if (operation.state === "prepared" || operation.state === "executing") {
      await this.markExecuting(lease);
      operation = await this.requireOperation(lease.operationId);
    }

    // Never issue a pass/fail receipt or final audit while a composite child is
    // unresolved. The terminal transition repeats this check, but doing it
    // here prevents a fresh gate-bearing receipt from outliving a failed
    // parent-recording attempt.
    await this.operations.assertChildrenTerminal(operation.id);

    if (result.targetSnapshotId && result.policyVersion && result.evidenceDigest && result.toolVersions) {
      const deterministicReceiptId = receiptIdFor(operation.id, result.action, result.targetSnapshotId);
      const existing = await this.receipts.get(deterministicReceiptId);
      if (existing) {
        if (existing.operationId !== operation.id || existing.action !== result.action || existing.targetSnapshotId !== result.targetSnapshotId) {
          throw new OperationSagaError("A durable receipt ID is already bound to different operation evidence.");
        }
        receiptId = existing.id;
      } else {
        const receipt = await this.receipts.issue({
          id: deterministicReceiptId,
          operationId: operation.id,
          action: result.action,
          targetSnapshotId: result.targetSnapshotId,
          ...(result.authorityId ? { authorityId: result.authorityId } : {}),
          result: receiptResultFor(result.status),
          completeness: result.status === "incomplete" ? "incomplete" : "complete",
          evidenceDigest: result.evidenceDigest,
          policyVersion: result.policyVersion,
          toolVersions: result.toolVersions,
          ...(result.expiresAt ? { expiresAt: result.expiresAt } : {})
        });
        receiptId = receipt.id;
      }
    }
    await this.receipts.audit({
      id: auditId(operation.id, result.status),
      action: result.action,
      status: result.status,
      operationId: operation.id,
      ...(result.targetSnapshotId ? { targetSnapshotId: result.targetSnapshotId } : {}),
      detail: result.summary
    });

    operation = await this.requireOperation(lease.operationId);
    if (result.status === "completed" && operation.state === "external_committed") {
      await this.operations.advance(operation.id, "recorded", { commandStatus: result.status, ...(receiptId ? { receiptId } : {}) });
    } else if (result.status === "cancelled" && operation.state === "cancelling") {
      await this.operations.advance(operation.id, "cancelled", { commandStatus: result.status });
    } else if (result.status !== "completed" && operation.state !== "external_committed") {
      await this.operations.advance(operation.id, "failed", { commandStatus: result.status, ...(receiptId ? { receiptId } : {}) });
    }
    return receiptId ? { receiptId } : {};
  }

  /** Required by dispatch; terminal calls are idempotent after recordResult. */
  async settle(lease: DurableCommandOperationLease, status: CommandStatus): Promise<void> {
    const operation = await this.requireOperation(lease.operationId);
    if (operation.state === "recorded" || operation.state === "failed" || operation.state === "cancelled") return;
    // Input/confirmation review happens before any broker effect. Do not leave
    // that provisional generation executing forever: cancel it durably so a
    // reviewed request can claim a fresh generation after restart.
    if (["awaiting_input", "awaiting_confirmation"].includes(status)) {
      await this.receipts.audit({
        id: auditId(operation.id, `${status}:abandoned`),
        action: operation.action,
        status,
        operationId: operation.id,
        ...(operation.targetSnapshotId.startsWith("<no-target:") ? {} : { targetSnapshotId: operation.targetSnapshotId }),
        detail: "No external broker effect was started while the companion awaited reviewed input or confirmation; provisional operation cancelled."
      });
      const current = await this.requireOperation(lease.operationId);
      if (current.state === "prepared" || current.state === "executing") await this.operations.advance(current.id, "cancelling", { commandStatus: status, noExternalEffect: "true" });
      const cancelling = await this.requireOperation(lease.operationId);
      if (cancelling.state === "cancelling") await this.operations.advance(cancelling.id, "cancelled", { commandStatus: status, noExternalEffect: "true" });
      return;
    }
    await this.recordResult(lease, {
      action: operation.action,
      ...(operation.targetSnapshotId.startsWith("<no-target:") ? {} : { targetSnapshotId: operation.targetSnapshotId }),
      status,
      summary: "Dispatch settled this durable operation."
    });
  }

  async reconcilePending(reconciler: OperationReconciler): Promise<readonly ReconciliationResult[]> {
    return this.operations.reconcilePending(reconciler);
  }

  /**
   * Explicit bootstrap entry point. Register provider observation adapters on
   * the returned object and call recoverPending(); it cannot replay dispatch
   * handlers or turn an unreceipted top-level operation green.
   */
  createNoReplayRecovery(): NoReplayOperationRecovery {
    return new NoReplayOperationRecovery(this.operations);
  }

  private async requireOperation(id: string): Promise<OperationRecord> {
    const operation = await this.operations.get(id);
    if (!operation) throw new OperationSagaError(`Unknown durable dispatch operation: ${id}`);
    return operation;
  }
}

function receiptIdFor(operationId: string, action: string, targetSnapshotId: string): string {
  return `receipt:${sha256(stableJson({ operationId, action, targetSnapshotId })).slice(0, 32)}`;
}

function auditId(operationId: string, status: string): string {
  return `audit:${operationId}:${status}`;
}
