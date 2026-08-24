import { jsonClone, type JournalEntry, ProtectedJsonStore } from "./store.ts";
import { redactText } from "./redaction.ts";

/** Durable repository-level fence for brokered outbound effects. */
export type ContainmentChannel = "git" | "credential" | "network" | "deployment" | "local_remediation";
export type IncidentStatus = "rotation_pending" | "rotation_complete" | "not_required";

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
}

export interface ContainmentReleaseResult {
  readonly status: "released" | "blocked" | "unavailable";
  readonly reason: string;
  readonly record?: ContainmentRecord;
}

export type FenceListener = (record: ContainmentRecord) => void;

export interface DurableContainmentHooks {
  /** Revoke credential leases after the fence is durably active. */
  readonly revokeCredentialLeases?: (input: Readonly<{ repositoryRoot: string; fenceEpoch: number }>) => Promise<void>;
  /** Cancel queued/not-yet-external broker operations after the fence is durably active. */
  readonly cancelQueuedOperations?: (input: Readonly<{ repositoryRoot: string; fenceEpoch: number }>) => Promise<void>;
}

interface DurableContainmentSavedEvent { readonly record: ContainmentRecord; }

function containmentKey(repositoryRoot: string): string {
  return repositoryRoot.replaceAll("\\", "/").replace(/\/+$/, "").toLowerCase();
}

function cloneRecord(record: ContainmentRecord): ContainmentRecord {
  return {
    ...record,
    uncontrolledPaths: [...record.uncontrolledPaths],
    ...(record.hookFailures ? { hookFailures: [...record.hookFailures] } : {})
  };
}

function durableRecords(entries: readonly JournalEntry<unknown>[]): Map<string, ContainmentRecord> {
  const records = new Map<string, ContainmentRecord>();
  for (const entry of entries) {
    if (entry.kind !== "containment.saved") continue;
    const record = (entry.payload as DurableContainmentSavedEvent | undefined)?.record;
    if (!record || typeof record.repositoryRoot !== "string" || typeof record.fenceEpoch !== "number") {
      throw new Error("Protected containment record is malformed.");
    }
    records.set(containmentKey(record.repositoryRoot), cloneRecord(record));
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

  constructor(store: ProtectedJsonStore, hooks: DurableContainmentHooks = {}, options: { readonly clock?: () => string } = {}) {
    this.store = store;
    this.hooks = hooks;
    this.clock = options.clock ?? (() => new Date().toISOString());
  }

  async activate(request: ContainmentActivation): Promise<ContainmentRecord> {
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
        uncontrolledPaths: current?.uncontrolledPaths ?? []
      };
      await transaction.append<DurableContainmentSavedEvent>("containment.saved", { record: next });
      return { record: cloneRecord(next), activated: true };
    });
    const record = activation.record;
    // Repeated requests return the durable fence but never replay hooks.
    if (!activation.activated) return record;
    const failures: string[] = [];
    for (const [name, hook] of [
      ["credential lease revocation", this.hooks.revokeCredentialLeases],
      ["queued operation cancellation", this.hooks.cancelQueuedOperations]
    ] as const) {
      if (!hook) continue;
      try {
        await hook({ repositoryRoot: record.repositoryRoot, fenceEpoch: record.fenceEpoch });
      } catch (error) {
        failures.push(`${name}: ${redactText(error instanceof Error ? error.message : "adapter failed")}`);
      }
    }
    if (failures.length === 0) return record;
    return this.update(record.repositoryRoot, (current) => ({ ...current, hookFailures: [...(current.hookFailures ?? []), ...failures] }));
  }

  async check(repositoryRoot: string, channel: ContainmentChannel): Promise<ContainmentCheck> {
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
    const record = durableRecords(await this.store.readEntries()).get(containmentKey(repositoryRoot));
    return record ? cloneRecord(record) : undefined;
  }

  async list(): Promise<readonly ContainmentRecord[]> {
    return [...durableRecords(await this.store.readEntries()).values()].map(cloneRecord);
  }

  async markUncontrolled(repositoryRoot: string, description: string): Promise<ContainmentRecord | undefined> {
    const existing = await this.get(repositoryRoot);
    if (!existing) return undefined;
    return this.update(repositoryRoot, (current) => ({ ...current, uncontrolledPaths: [...current.uncontrolledPaths, redactText(description)] }));
  }

  async release(request: ContainmentReleaseRequest): Promise<ContainmentReleaseResult> {
    if (!request.reauthenticated) return { status: "blocked", reason: "Containment release requires companion-UI reauthentication." };
    if (!request.reason.trim()) return { status: "blocked", reason: "Containment release requires an incident review reason." };
    if (request.incidentStatus === "rotation_pending") return { status: "blocked", reason: "Containment release requires credential rotation completion or an explicit not-required finding." };
    return this.store.transaction(async (transaction) => {
      const records = durableRecords(await transaction.readEntries());
      const current = records.get(containmentKey(request.repositoryRoot));
      if (!current) return { status: "unavailable", reason: "No containment record exists for this exact repository." };
      if (!current.active) return { status: "blocked", reason: "Containment is already released; a keyboard press cannot change the historical record.", record: cloneRecord(current) };
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
}
