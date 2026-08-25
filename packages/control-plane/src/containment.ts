import { jsonClone, sha256, stableJson, type JournalEntry, ProtectedJsonStore } from "./store.ts";
import { redactText } from "./redaction.ts";

/** Durable repository-level fence for brokered outbound effects. */
/**
 * Each brokered effect has its own durable fence channel.  Keeping the
 * channels explicit makes a missing pre-effect check reviewable and prevents
 * a newly added executor from silently falling through a generic allow path.
 */
export type ContainmentChannel =
  | "git"
  | "credential"
  | "network"
  | "deployment"
  | "execution"
  | "test_environment"
  | "automation"
  | "isolation"
  | "council"
  | "adapter"
  | "local_remediation";
export type IncidentStatus = "rotation_pending" | "rotation_complete" | "not_required";
export type ContainmentHookName = "credential_lease_revocation" | "queued_operation_cancellation";
export type ContainmentHookStatus = "pending" | "running" | "completed" | "failed" | "unavailable";

export interface ContainmentHookState {
  readonly name: ContainmentHookName;
  readonly status: ContainmentHookStatus;
  readonly attempts: number;
  readonly updatedAt: string;
  readonly failure?: string;
}

export interface ContainmentRecord {
  readonly repositoryRoot: string;
  readonly fenceEpoch: number;
  readonly active: boolean;
  readonly activatedAt: string;
  readonly activatedByOperationId: string;
  readonly reason: string;
  readonly releasedAt?: string;
  readonly releaseReason?: string;
  readonly uncontrolledPaths: readonly string[];
  /** Failures from post-fence cancellation/revocation hooks remain visible. */
  readonly hookFailures?: readonly string[];
  /** Durable per-epoch hook phases make interrupted containment restartable. */
  readonly hookStates?: readonly ContainmentHookState[];
}

export interface ContainmentState {
  readonly records: readonly ContainmentRecord[];
}

export interface ContainmentActivation {
  readonly repositoryRoot: string;
  readonly operationId: string;
  readonly reason: string;
}

export interface ContainmentCheck {
  readonly allowed: boolean;
  readonly reason: string;
  readonly fenceEpoch?: number;
}

export interface ContainmentReleaseRequest {
  readonly repositoryRoot: string;
  readonly reason: string;
  /** Must be asserted only by the authenticated companion-UI reauth flow. */
  readonly reauthenticated: boolean;
  readonly incidentStatus: IncidentStatus;
  /** Exact active fence reviewed by the current-user release UI. */
  readonly expectedFenceEpoch: number;
  /** Exact activation operation reviewed by the current-user release UI. */
  readonly expectedActivationOperationId: string;
}

export interface ContainmentReleaseResult {
  readonly status: "released" | "blocked" | "unavailable";
  readonly reason: string;
  readonly record?: ContainmentRecord;
}

export type FenceListener = (record: ContainmentRecord) => void;

export interface DurableContainmentHooks {
  /** Revoke credential leases after the fence is durably active. Must be idempotent for one repositoryRoot/fenceEpoch key. */
  readonly revokeCredentialLeases?: (input: Readonly<{ repositoryRoot: string; fenceEpoch: number }>) => Promise<void>;
  /** Cancel queued/not-yet-external broker operations after the fence is durably active. Must be idempotent for one repositoryRoot/fenceEpoch key. */
  readonly cancelQueuedOperations?: (input: Readonly<{ repositoryRoot: string; fenceEpoch: number }>) => Promise<void>;
}

export type ContainmentReleaseBinding = Pick<ContainmentReleaseRequest, "expectedFenceEpoch" | "expectedActivationOperationId">;

/** Hashes only the immutable reviewed fence identity; hook progress may safely advance before release. */
export function containmentReleaseScopeDigest(binding: ContainmentReleaseBinding): string {
  if (!Number.isSafeInteger(binding.expectedFenceEpoch) || binding.expectedFenceEpoch < 1
    || !binding.expectedActivationOperationId.trim() || binding.expectedActivationOperationId.length > 256
    || /[\r\n\0]/.test(binding.expectedActivationOperationId)) {
    throw new Error("Containment release binding must name one exact positive fence epoch and bounded activation operation.");
  }
  return sha256(stableJson({
    expectedActivationOperationId: binding.expectedActivationOperationId,
    expectedFenceEpoch: binding.expectedFenceEpoch
  }));
}

export type ContainmentLifecyclePhase = "fence_persisted" | "hook_claimed" | "hook_effect_completed" | "hook_completion_persisted";
export interface DurableContainmentManagerOptions {
  readonly clock?: () => string;
  readonly hookTimeoutMs?: number;
  /** Deterministic crash seam for isolated recovery tests; production omits it. */
  readonly lifecycleProbe?: (input: Readonly<{ phase: ContainmentLifecyclePhase; repositoryRoot: string; fenceEpoch: number; hook?: ContainmentHookName }>) => Promise<void> | void;
}

interface DurableContainmentSavedEvent { readonly record: ContainmentRecord; }

function containmentKey(repositoryRoot: string): string {
  return repositoryRoot.replaceAll("\\", "/").replace(/\/+$/, "").toLowerCase();
}

function cloneRecord(record: ContainmentRecord): ContainmentRecord {
  return {
    ...record,
    uncontrolledPaths: [...record.uncontrolledPaths],
    ...(record.hookFailures ? { hookFailures: [...record.hookFailures] } : {}),
    ...(record.hookStates ? { hookStates: record.hookStates.map((state) => ({ ...state })) } : {})
  };
}

const containmentHookNames = ["credential_lease_revocation", "queued_operation_cancellation"] as const;

function validateHookStates(candidate: unknown): readonly ContainmentHookState[] | undefined {
  if (candidate === undefined) return undefined;
  if (!Array.isArray(candidate) || candidate.length > containmentHookNames.length) throw new Error("Protected containment hook state is malformed.");
  const names = new Set<string>();
  return candidate.map((value) => {
    if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("Protected containment hook state is malformed.");
    const state = value as Partial<ContainmentHookState>;
    if (!containmentHookNames.includes(state.name as ContainmentHookName) || names.has(state.name as string)
      || !["pending", "running", "completed", "failed", "unavailable"].includes(state.status as string)
      || !Number.isSafeInteger(state.attempts) || (state.attempts ?? -1) < 0 || typeof state.updatedAt !== "string" || !state.updatedAt
      || (state.failure !== undefined && typeof state.failure !== "string")) {
      throw new Error("Protected containment hook state is malformed.");
    }
    names.add(state.name as string);
    return { name: state.name!, status: state.status!, attempts: state.attempts!, updatedAt: state.updatedAt, ...(state.failure ? { failure: state.failure } : {}) };
  });
}

function durableRecords(entries: readonly JournalEntry<unknown>[]): Map<string, ContainmentRecord> {
  const records = new Map<string, ContainmentRecord>();
  for (const entry of entries) {
    if (entry.kind !== "containment.saved") continue;
    const record = (entry.payload as DurableContainmentSavedEvent | undefined)?.record;
    if (!record || typeof record.repositoryRoot !== "string" || typeof record.fenceEpoch !== "number") {
      throw new Error("Protected containment record is malformed.");
    }
    const hookStates = validateHookStates(record.hookStates);
    records.set(containmentKey(record.repositoryRoot), cloneRecord({ ...record, ...(hookStates ? { hookStates } : {}) }));
  }
  return records;
}

/**
 * In-memory implementation used by the local control plane and isolated tests.
 * A production store can serialize `exportState()` into the protected durable
 * store. The manager never claims to stop unmediated shells or remote jobs.
 */
export class InMemoryContainmentManager {
  private readonly records = new Map<string, ContainmentRecord>();
  private readonly listeners = new Set<FenceListener>();

  activate(request: ContainmentActivation): ContainmentRecord {
    const current = this.records.get(request.repositoryRoot);
    if (current?.active) return current; // repeated press is idempotent
    const record: ContainmentRecord = {
      repositoryRoot: request.repositoryRoot,
      fenceEpoch: (current?.fenceEpoch ?? 0) + 1,
      active: true,
      activatedAt: new Date().toISOString(),
      activatedByOperationId: request.operationId,
      reason: request.reason,
      uncontrolledPaths: current?.uncontrolledPaths ?? []
    };
    this.records.set(request.repositoryRoot, record);
    for (const listener of this.listeners) listener(record);
    return record;
  }

  check(repositoryRoot: string, channel: ContainmentChannel): ContainmentCheck {
    const record = this.records.get(repositoryRoot);
    if (!record?.active || channel === "local_remediation") {
      return { allowed: true, reason: channel === "local_remediation" ? "Local remediation remains available during containment." : "No active containment fence." };
    }
    return {
      allowed: false,
      reason: `Containment fence ${record.fenceEpoch} blocks brokered ${channel}; unmediated paths remain visibly uncontrolled.`,
      fenceEpoch: record.fenceEpoch
    };
  }

  markUncontrolled(repositoryRoot: string, description: string): ContainmentRecord | undefined {
    const current = this.records.get(repositoryRoot);
    if (!current) return undefined;
    const record = { ...current, uncontrolledPaths: [...current.uncontrolledPaths, description] };
    this.records.set(repositoryRoot, record);
    return record;
  }

  release(request: ContainmentReleaseRequest): ContainmentReleaseResult {
    const current = this.records.get(request.repositoryRoot);
    if (!current) return { status: "unavailable", reason: "No containment record exists for this exact repository." };
    if (!current.active) return { status: "blocked", reason: "Containment is already released; a keyboard press cannot change the historical record.", record: current };
    if (!request.reauthenticated) return { status: "blocked", reason: "Containment release requires companion-UI reauthentication." };
    if (!request.reason.trim()) return { status: "blocked", reason: "Containment release requires an incident review reason." };
    if (request.incidentStatus === "rotation_pending") return { status: "blocked", reason: "Containment release requires credential rotation completion or an explicit not-required finding." };
    if (!Number.isSafeInteger(request.expectedFenceEpoch) || request.expectedFenceEpoch < 1 || request.expectedFenceEpoch !== current.fenceEpoch
      || !request.expectedActivationOperationId.trim() || request.expectedActivationOperationId !== current.activatedByOperationId) {
      return { status: "blocked", reason: "Containment changed after review; inspect the exact active fence again before release.", record: current };
    }
    const record: ContainmentRecord = {
      ...current,
      active: false,
      releasedAt: new Date().toISOString(),
      releaseReason: request.reason
    };
    this.records.set(request.repositoryRoot, record);
    return { status: "released", reason: "Authenticated containment release recorded.", record };
  }

  addFenceListener(listener: FenceListener): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  exportState(): ContainmentState {
    return { records: [...this.records.values()] };
  }

  static restore(state: ContainmentState): InMemoryContainmentManager {
    const manager = new InMemoryContainmentManager();
    for (const record of state.records) manager.records.set(record.repositoryRoot, record);
    return manager;
  }
}

/**
 * Protected-store containment implementation for the companion service. The
 * fence is recorded before revocation/cancellation hooks run, so a crash or a
 * failing adapter can never make containment silently disappear. Hooks are
 * intentionally best-effort after the durable write; any failure stays on the
 * record and the fence remains active.
 */
export class DurableContainmentManager {
  private readonly store: ProtectedJsonStore;
  private readonly hooks: DurableContainmentHooks;
  private readonly clock: () => string;
  private readonly lifecycleProbe?: DurableContainmentManagerOptions["lifecycleProbe"];
  private readonly hookTimeoutMs: number;
  private readonly reconciliationTails = new Map<string, Promise<void>>();
  private readonly startupRecovery: Promise<void>;
  private startupFailure: unknown;
  private readonly startupRecoveries = new Map<string, Promise<void>>();
  private readonly startupFailures = new Map<string, unknown>();

  constructor(store: ProtectedJsonStore, hooks: DurableContainmentHooks = {}, options: DurableContainmentManagerOptions = {}) {
    this.store = store;
    this.hooks = hooks;
    this.clock = options.clock ?? (() => new Date().toISOString());
    this.lifecycleProbe = options.lifecycleProbe;
    this.hookTimeoutMs = options.hookTimeoutMs ?? 10_000;
    if (!Number.isSafeInteger(this.hookTimeoutMs) || this.hookTimeoutMs < 1 || this.hookTimeoutMs > 60_000) throw new Error("Containment hook timeout must be between 1 and 60000 milliseconds.");
    // Defer one microtask so bootstrap compositions can finish assigning hook
    // dependencies, then reconcile every already-active fence before any
    // public containment decision is allowed to proceed.
    this.startupRecovery = Promise.resolve()
      .then(() => this.startActiveFenceRecoveries())
      .catch((error: unknown) => { this.startupFailure = error; });
  }

  async activate(request: ContainmentActivation): Promise<ContainmentRecord> {
    await this.ensureStartupRecovery(request.repositoryRoot);
    const activation = await this.store.transaction(async (transaction) => {
      const records = durableRecords(await transaction.readEntries());
      const key = containmentKey(request.repositoryRoot);
      const current = records.get(key);
      if (current?.active) return { record: cloneRecord(current), activated: false };
      const next: ContainmentRecord = {
        repositoryRoot: request.repositoryRoot,
        fenceEpoch: (current?.fenceEpoch ?? 0) + 1,
        active: true,
        activatedAt: this.clock(),
        activatedByOperationId: request.operationId,
        reason: request.reason,
        uncontrolledPaths: current?.uncontrolledPaths ?? [],
        hookStates: this.initialHookStates()
      };
      await transaction.append<DurableContainmentSavedEvent>("containment.saved", { record: next });
      return { record: cloneRecord(next), activated: true };
    });
    const record = activation.record;
    if (activation.activated) await this.probe("fence_persisted", record);
    return this.serializeReconciliation(record.repositoryRoot, () => this.reconcileHooks(record.repositoryRoot, record.fenceEpoch));
  }

  async check(repositoryRoot: string, channel: ContainmentChannel): Promise<ContainmentCheck> {
    await this.ensureStartupRecovery(repositoryRoot);
    const record = durableRecords(await this.store.readEntries()).get(containmentKey(repositoryRoot));
    if (!record?.active || channel === "local_remediation") {
      return { allowed: true, reason: channel === "local_remediation" ? "Local remediation remains available during containment." : "No active containment fence." };
    }
    return {
      allowed: false,
      reason: `Containment fence ${record.fenceEpoch} blocks brokered ${channel}; unmediated paths remain visibly uncontrolled.`,
      fenceEpoch: record.fenceEpoch
    };
  }

  async get(repositoryRoot: string): Promise<ContainmentRecord | undefined> {
    await this.ensureStartupRecovery(repositoryRoot);
    return this.readRecord(repositoryRoot);
  }

  private async readRecord(repositoryRoot: string): Promise<ContainmentRecord | undefined> {
    const record = durableRecords(await this.store.readEntries()).get(containmentKey(repositoryRoot));
    return record ? cloneRecord(record) : undefined;
  }

  async list(): Promise<readonly ContainmentRecord[]> {
    await this.ensureStartupRecovery();
    return [...durableRecords(await this.store.readEntries()).values()].map(cloneRecord);
  }

  async markUncontrolled(repositoryRoot: string, description: string): Promise<ContainmentRecord | undefined> {
    await this.ensureStartupRecovery(repositoryRoot);
    const existing = await this.get(repositoryRoot);
    if (!existing) return undefined;
    return this.update(repositoryRoot, (current) => ({ ...current, uncontrolledPaths: [...current.uncontrolledPaths, redactText(description)] }));
  }

  async release(request: ContainmentReleaseRequest): Promise<ContainmentReleaseResult> {
    await this.ensureStartupRecovery(request.repositoryRoot);
    if (!request.reauthenticated) return { status: "blocked", reason: "Containment release requires companion-UI reauthentication." };
    if (!request.reason.trim()) return { status: "blocked", reason: "Containment release requires an incident review reason." };
    if (request.incidentStatus === "rotation_pending") return { status: "blocked", reason: "Containment release requires credential rotation completion or an explicit not-required finding." };
    return this.store.transaction(async (transaction) => {
      const records = durableRecords(await transaction.readEntries());
      const current = records.get(containmentKey(request.repositoryRoot));
      if (!current) return { status: "unavailable", reason: "No containment record exists for this exact repository." };
      if (!current.active) return { status: "blocked", reason: "Containment is already released; a keyboard press cannot change the historical record.", record: cloneRecord(current) };
      if (!Number.isSafeInteger(request.expectedFenceEpoch) || request.expectedFenceEpoch < 1 || request.expectedFenceEpoch !== current.fenceEpoch
        || !request.expectedActivationOperationId.trim() || request.expectedActivationOperationId !== current.activatedByOperationId) {
        return { status: "blocked", reason: "Containment changed after review; inspect the exact active fence again before release.", record: cloneRecord(current) };
      }
      if (!current.hookStates || current.hookStates.length !== containmentHookNames.length || current.hookStates.some((state) => state.status !== "completed")) {
        return { status: "blocked", reason: "Containment release requires every durable revocation/cancellation hook to reconcile successfully.", record: cloneRecord(current) };
      }
      const next: ContainmentRecord = {
        ...current,
        active: false,
        releasedAt: this.clock(),
        releaseReason: redactText(request.reason)
      };
      await transaction.append<DurableContainmentSavedEvent>("containment.saved", { record: next });
      return { status: "released", reason: "Authenticated containment release recorded.", record: cloneRecord(next) };
    });
  }

  private async update(repositoryRoot: string, mutate: (record: ContainmentRecord) => ContainmentRecord): Promise<ContainmentRecord> {
    return this.store.transaction(async (transaction) => {
      const records = durableRecords(await transaction.readEntries());
      const current = records.get(containmentKey(repositoryRoot));
      if (!current) throw new Error("Cannot update an unknown containment record.");
      const next = cloneRecord(mutate(cloneRecord(current)));
      await transaction.append<DurableContainmentSavedEvent>("containment.saved", { record: next });
      return jsonClone(next);
    });
  }

  private hook(name: ContainmentHookName): DurableContainmentHooks[keyof DurableContainmentHooks] {
    return name === "credential_lease_revocation" ? this.hooks.revokeCredentialLeases : this.hooks.cancelQueuedOperations;
  }

  private initialHookStates(): readonly ContainmentHookState[] {
    return containmentHookNames.map((name) => {
      const available = !!this.hook(name);
      return {
        name,
        status: available ? "pending" as const : "unavailable" as const,
        attempts: 0,
        updatedAt: this.clock(),
        ...(!available ? { failure: `${this.hookLabel(name)} is not configured.` } : {})
      };
    });
  }

  private hookLabel(name: ContainmentHookName): string {
    return name === "credential_lease_revocation" ? "credential lease revocation" : "queued operation cancellation";
  }

  private withHookState(record: ContainmentRecord, nextState: ContainmentHookState): ContainmentRecord {
    const existing = new Map((record.hookStates ?? []).map((state) => [state.name, state]));
    existing.set(nextState.name, nextState);
    const hookStates = containmentHookNames.map((name) => existing.get(name) ?? {
      name,
      status: "unavailable" as const,
      attempts: 0,
      updatedAt: this.clock(),
      failure: `${this.hookLabel(name)} is not configured.`
    });
    const failures = hookStates
      .filter((state) => state.status === "failed" || state.status === "unavailable")
      .map((state) => `${this.hookLabel(state.name)}: ${state.failure ?? state.status}`);
    const { hookFailures: _priorFailures, ...withoutFailures } = record;
    return { ...withoutFailures, hookStates, ...(failures.length ? { hookFailures: failures } : {}) };
  }

  private async setHookState(repositoryRoot: string, fenceEpoch: number, state: ContainmentHookState): Promise<ContainmentRecord> {
    return this.store.transaction(async (transaction) => {
      const current = durableRecords(await transaction.readEntries()).get(containmentKey(repositoryRoot));
      if (!current?.active || current.fenceEpoch !== fenceEpoch) throw new Error("Containment hook reconciliation lost its exact active fence epoch.");
      const next = this.withHookState(current, state);
      await transaction.append<DurableContainmentSavedEvent>("containment.saved", { record: next });
      return cloneRecord(next);
    });
  }

  private async reconcileHooks(repositoryRoot: string, fenceEpoch: number): Promise<ContainmentRecord> {
    for (const name of containmentHookNames) {
      const before = await this.readRecord(repositoryRoot);
      if (!before?.active || before.fenceEpoch !== fenceEpoch) throw new Error("Containment hook reconciliation lost its exact active fence epoch.");
      const prior = before.hookStates?.find((state) => state.name === name);
      if (prior?.status === "completed") continue;
      const hook = this.hook(name);
      if (!hook) {
        if (prior?.status !== "unavailable") {
          await this.setHookState(repositoryRoot, fenceEpoch, {
            name, status: "unavailable", attempts: prior?.attempts ?? 0, updatedAt: this.clock(), failure: `${this.hookLabel(name)} is not configured.`
          });
        }
        continue;
      }
      const running: ContainmentHookState = { name, status: "running", attempts: (prior?.attempts ?? 0) + 1, updatedAt: this.clock() };
      const claimed = await this.setHookState(repositoryRoot, fenceEpoch, running);
      await this.probe("hook_claimed", claimed, name);
      try {
        await this.invokeBoundedHook(name, hook, { repositoryRoot, fenceEpoch });
      } catch (error) {
        const failure = redactText(error instanceof Error ? error.message : "adapter failed").slice(0, 512);
        await this.setHookState(repositoryRoot, fenceEpoch, { ...running, status: "failed", updatedAt: this.clock(), failure });
        continue;
      }
      await this.probe("hook_effect_completed", claimed, name);
      const completed = await this.setHookState(repositoryRoot, fenceEpoch, { ...running, status: "completed", updatedAt: this.clock() });
      await this.probe("hook_completion_persisted", completed, name);
    }
    const record = await this.readRecord(repositoryRoot);
    if (!record?.active || record.fenceEpoch !== fenceEpoch) throw new Error("Containment hook reconciliation lost its exact active fence epoch.");
    return record;
  }

  private async probe(phase: ContainmentLifecyclePhase, record: ContainmentRecord, hook?: ContainmentHookName): Promise<void> {
    await this.lifecycleProbe?.({ phase, repositoryRoot: record.repositoryRoot, fenceEpoch: record.fenceEpoch, ...(hook ? { hook } : {}) });
  }

  private async serializeReconciliation<T>(repositoryRoot: string, work: () => Promise<T>): Promise<T> {
    const key = containmentKey(repositoryRoot);
    const prior = this.reconciliationTails.get(key) ?? Promise.resolve();
    let release!: () => void;
    const tail = new Promise<void>((resolve) => { release = resolve; });
    this.reconciliationTails.set(key, tail);
    await prior;
    try { return await work(); }
    finally { release(); if (this.reconciliationTails.get(key) === tail) this.reconciliationTails.delete(key); }
  }

  private async startActiveFenceRecoveries(): Promise<void> {
    const active = [...durableRecords(await this.store.readEntries()).values()].filter((record) => record.active);
    for (const record of active) {
      const key = containmentKey(record.repositoryRoot);
      const recovery = this.serializeReconciliation(record.repositoryRoot, () => this.reconcileHooks(record.repositoryRoot, record.fenceEpoch))
        .then(() => undefined)
        .catch((error: unknown) => { this.startupFailures.set(key, error); });
      this.startupRecoveries.set(key, recovery);
    }
  }

  private async ensureStartupRecovery(repositoryRoot?: string): Promise<void> {
    await this.startupRecovery;
    if (this.startupFailure) throw this.startupFailure instanceof Error ? this.startupFailure : new Error("Durable containment startup reconciliation failed.");
    if (repositoryRoot) {
      const key = containmentKey(repositoryRoot);
      await this.startupRecoveries.get(key);
      const failure = this.startupFailures.get(key);
      if (failure) throw failure instanceof Error ? failure : new Error("Durable containment startup reconciliation failed for the exact repository.");
      return;
    }
    await Promise.all(this.startupRecoveries.values());
    const failure = this.startupFailures.values().next().value as unknown;
    if (failure) throw failure instanceof Error ? failure : new Error("Durable containment startup reconciliation failed.");
  }

  private invokeBoundedHook(name: ContainmentHookName, hook: NonNullable<ReturnType<DurableContainmentManager["hook"]>>, input: Readonly<{ repositoryRoot: string; fenceEpoch: number }>): Promise<void> {
    const effect = Promise.resolve().then(() => hook(input));
    return new Promise<void>((resolve, reject) => {
      let settled = false;
      const timer = setTimeout(() => {
        if (settled) return;
        settled = true;
        reject(new Error(`${this.hookLabel(name)} timed out before a durable acknowledgement.`));
      }, this.hookTimeoutMs);
      effect.then(
        () => { if (settled) return; settled = true; clearTimeout(timer); resolve(); },
        (error: unknown) => { if (settled) return; settled = true; clearTimeout(timer); reject(error); }
      );
    });
  }
}
