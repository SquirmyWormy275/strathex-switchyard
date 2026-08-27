import type { OperationControlAdapter, OperationCancellationOutcome, OperationCancellationRequest } from "../../../packages/control-plane/src/execution-control.ts";
import { commandActionIds, type CommandAction } from "../../../packages/control-plane/src/command-catalog.ts";
import type { OperationControllerObservation, OperationReconciliationBinding, RuntimeOperationControlAdapter } from "../../../packages/control-plane/src/runtime.ts";
import type { RepositoryProcessObservationRequest, RepositoryProcessStartRequest, RepositoryProcessSupervisor, RepositorySupervisedProcess } from "./repository-runtime.ts";

export interface ExactOperationQueueControl {
  cancelByOperation(operationId: string, reason: string): Promise<number>;
  cancelQueuedForRepository(repositoryRoot: string, reason: string): Promise<number>;
  observeOperation(operationId: string): Promise<Readonly<{ settled: boolean; summary: string }>>;
  observeBoundOperation?(binding: OperationReconciliationBinding): Promise<OperationControllerObservation>;
}

export interface ManagedProcessOperationControl {
  cancelOperation(operationId: string, reason: string): Promise<number>;
  cancelRepository(repositoryRoot: string, reason: string): Promise<number>;
  reconcileOperation(binding: OperationReconciliationBinding): Promise<OperationControllerObservation>;
}

export interface DurableHostActionQueueControl {
  cancelPendingByOperation(operationId: string, reason: string): Promise<number>;
  cancelQueuedForRepository(repositoryRoot: string, reason: string): Promise<number>;
  observeOperation(operationId: string, action?: string, targetSnapshotId?: string, repositoryRoot?: string): Promise<Readonly<{
    outcome: "committed" | "failed" | "cancelled" | "unresolved";
    note: string;
    binding?: Readonly<{ action: string; targetSnapshotId?: string; repositoryRoot?: string }>;
  }>>;
}

export type DurableWorkflowOperationStatus = "prepared" | "submitted" | "cancelling" | "acknowledged" | "rejected" | "cancelled";

export interface DurableWorkflowArtifactQueueControl {
  cancelByOperation(operationId: string): Promise<Readonly<{ status: DurableWorkflowOperationStatus }> | undefined>;
  cancelQueuedForRepository(repositoryRoot: string): Promise<readonly Readonly<{ status: DurableWorkflowOperationStatus }>[] >;
  observeOperation(operationId: string): Promise<Readonly<{
    status: DurableWorkflowOperationStatus;
    action?: string;
    targetSnapshotId?: string;
    repositoryRoot?: string;
    providerEffectDisposition?: "not_started" | "committed" | "ambiguous" | "compensated";
  }> | undefined>;
}

/** Narrow adapter from the durable VS Code host queue to exact operation control. */
export class HostActionOperationQueueControl implements ExactOperationQueueControl {
  constructor(private readonly queue: DurableHostActionQueueControl) {}
  cancelByOperation(operationId: string, reason: string): Promise<number> {
    return this.queue.cancelPendingByOperation(operationId, reason);
  }
  cancelQueuedForRepository(repositoryRoot: string, reason: string): Promise<number> {
    return this.queue.cancelQueuedForRepository(repositoryRoot, reason);
  }
  async observeOperation(operationId: string): Promise<Readonly<{ settled: boolean; summary: string }>> {
    const observed = await this.queue.observeOperation(operationId);
    return { settled: observed.outcome !== "unresolved", summary: observed.note };
  }
  async observeBoundOperation(binding: OperationReconciliationBinding): Promise<OperationControllerObservation> {
    const observed = await this.queue.observeOperation(binding.operationId, binding.action, binding.targetSnapshotId, binding.repositoryRoot);
    if (observed.outcome === "unresolved") return notOwnerNote(observed.note)
      ? { state: "not_owner", operationId: binding.operationId, summary: observed.note }
      : hostBindingMatches(binding, observed.binding) ? active(binding, observed.note) : active(binding, "The durable host action does not prove the exact protected action and target binding; terminal state remains ambiguous.");
    if (!hostBindingMatches(binding, observed.binding)) {
      return active(binding, "The durable host action does not prove the exact protected action and target binding; terminal state remains ambiguous.");
    }
    if (observed.outcome === "committed") return terminal(binding, "completed", "committed", observed.note);
    if (observed.outcome === "cancelled") return terminal(binding, "cancelled", "not_started", observed.note);
    return active(binding, "The durable host action reports failure without an exact effect disposition; terminal state remains ambiguous and no work was replayed.");
  }
}

/** Narrow adapter from the durable provider-artifact queue to exact operation control. */
export class WorkflowArtifactOperationQueueControl implements ExactOperationQueueControl {
  constructor(private readonly queue: DurableWorkflowArtifactQueueControl) {}
  async cancelByOperation(operationId: string, _reason: string): Promise<number> {
    const artifact = await this.queue.cancelByOperation(operationId);
    return artifact?.status === "cancelled" || artifact?.status === "cancelling" ? 1 : 0;
  }
  async cancelQueuedForRepository(repositoryRoot: string, _reason: string): Promise<number> {
    return (await this.queue.cancelQueuedForRepository(repositoryRoot)).length;
  }
  async observeOperation(operationId: string): Promise<Readonly<{ settled: boolean; summary: string }>> {
    const observed = await this.queue.observeOperation(operationId);
    if (!observed) return { settled: false, summary: "No exact durable provider workflow artifact is bound to this operation." };
    if (observed.status === "acknowledged" && observed.providerEffectDisposition === "committed") {
      return { settled: true, summary: `The exact provider workflow artifact is durably ${observed.status}.` };
    }
    if (observed.status === "rejected" && observed.providerEffectDisposition === "not_started") {
      return { settled: true, summary: `The exact provider workflow artifact is durably ${observed.status}.` };
    }
    if (observed.status === "cancelled" && (observed.providerEffectDisposition === "not_started" || observed.providerEffectDisposition === "compensated")) {
      return { settled: true, summary: `The exact provider workflow artifact is durably ${observed.status}.` };
    }
    if (observed.status === "acknowledged") return { settled: false, summary: "The acknowledged provider workflow artifact lacks a consistent durable effect disposition." };
    if (observed.status === "rejected") return { settled: false, summary: "The rejected provider workflow artifact lacks a consistent durable effect disposition." };
    return { settled: false, summary: `The exact provider workflow artifact remains ${observed.status}; its external effect was not guessed or replayed.` };
  }
  async observeBoundOperation(binding: OperationReconciliationBinding): Promise<OperationControllerObservation> {
    const observed = await this.queue.observeOperation(binding.operationId);
    if (!observed) return { state: "not_owner", operationId: binding.operationId, summary: "No exact durable provider workflow artifact is bound to this operation." };
    if (observed.action !== binding.action || observed.targetSnapshotId !== binding.targetSnapshotId || boundPath(observed.repositoryRoot) !== boundPath(binding.repositoryRoot)) {
      return active(binding, "The durable provider workflow artifact does not prove the exact protected action and target binding; terminal state remains ambiguous.");
    }
    if (observed.status === "acknowledged" && observed.providerEffectDisposition === "committed") return terminal(binding, "completed", "committed", "The exact provider workflow artifact is durably acknowledged.");
    if (observed.status === "acknowledged") return active(binding, "The acknowledged provider workflow does not prove a committed effect disposition.");
    if (observed.status === "rejected" && observed.providerEffectDisposition === "not_started") return terminal(binding, "failed", "not_started", "The exact provider workflow artifact is durably rejected before effect.");
    if (observed.status === "rejected") return active(binding, "The rejected provider workflow does not prove that no effect started.");
    if (observed.status === "cancelled" && observed.providerEffectDisposition === "not_started") {
      return terminal(binding, "cancelled", "not_started", "The exact provider workflow artifact has a durable pre-effect cancellation.");
    }
    if (observed.status === "cancelled" && observed.providerEffectDisposition === "compensated") {
      return terminal(binding, "cancelled", "compensated", "The exact provider workflow artifact has a durable compensated cancellation.");
    }
    if (observed.status === "cancelled") {
      return active(binding, "The cancelled provider workflow does not prove that no effect began or that a compensator completed.");
    }
    return active(binding, `The exact provider workflow artifact remains ${observed.status}; its external effect was not guessed or replayed.`);
  }
}

/**
 * The hardware inbox durably owns Raw-HID trigger delivery and cancellation,
 * but it does not own the mediated command's external effect. A handled signal
 * means only that the one physical trigger was consumed; promoting it to a
 * command terminal would bypass the actual provider/process/host controller.
 */
export class HardwareSignalTriggerOperationQueueControl implements ExactOperationQueueControl {
  constructor(private readonly queue: ExactOperationQueueControl) {}
  cancelByOperation(operationId: string, reason: string): Promise<number> {
    return this.queue.cancelByOperation(operationId, reason);
  }
  cancelQueuedForRepository(repositoryRoot: string, reason: string): Promise<number> {
    return this.queue.cancelQueuedForRepository(repositoryRoot, reason);
  }
  observeOperation(operationId: string): Promise<Readonly<{ settled: boolean; summary: string }>> {
    return this.queue.observeOperation(operationId);
  }
  async observeBoundOperation(binding: OperationReconciliationBinding): Promise<OperationControllerObservation> {
    return {
      state: "not_owner",
      operationId: binding.operationId,
      summary: "The durable hardware inbox proves only trigger delivery and cancellation, not the mediated command's terminal effect."
    };
  }
}

/** Installed fail-closed sentinel: absence of the native helper never selects direct spawn. */
export class UnavailableInstalledRepositoryProcessSupervisor implements RepositoryProcessSupervisor {
  async start(_request: RepositoryProcessStartRequest): Promise<RepositorySupervisedProcess> {
    throw new Error("The packaged repository Job-Object process supervisor is unavailable; no child process was started.");
  }
  async recover(_request: Readonly<{ repositoryRoot: string; manifestSha256: string }>): Promise<readonly RepositorySupervisedProcess[]> {
    return [];
  }
  async observeOperation(request: RepositoryProcessObservationRequest): Promise<OperationControllerObservation> {
    return { state: "not_owner", operationId: request.operationId, summary: "The packaged repository Job-Object process supervisor is unavailable and owns no proven operation." };
  }
}

export interface InstalledOperationControlOptions {
  readonly queues?: readonly ExactOperationQueueControl[];
  readonly processes?: ManagedProcessOperationControl;
  readonly repositoryEffects?: readonly RepositoryEffectControl[];
}

/** Exact direct effects that are not represented by the durable command queue. */
export interface RepositoryEffectControl {
  cancelRepository(repositoryRoot: string, reason: string): Promise<number>;
}

/**
 * Coordinates cancellation across host-owned exact bindings only. It never
 * accepts a PID, process name, workspace command, or global kill fallback.
 */
export class InstalledOperationControl implements RuntimeOperationControlAdapter {
  private readonly queues: readonly ExactOperationQueueControl[];
  private readonly processes?: ManagedProcessOperationControl;
  private readonly repositoryEffects: readonly RepositoryEffectControl[];

  constructor(options: InstalledOperationControlOptions = {}) {
    this.queues = [...(options.queues ?? [])];
    this.processes = options.processes;
    this.repositoryEffects = [...(options.repositoryEffects ?? [])];
  }

  async cancel(request: OperationCancellationRequest): Promise<OperationCancellationOutcome> {
    const operationId = bounded(request.operationId, "operation ID");
    const reason = bounded(request.reason, "cancellation reason");
    try {
      const [queued, managedProcesses] = await Promise.all([
        Promise.all(this.queues.map((queue) => queue.cancelByOperation(operationId, reason))).then(sum),
        this.processes?.cancelOperation(operationId, reason) ?? Promise.resolve(0)
      ]);
      return {
        accepted: true,
        summary: `Cancellation reached ${queued} exact queued item(s) and ${managedProcesses} supervisor-owned process tree(s); no unrelated process was targeted.`
      };
    } catch {
      return { accepted: false, summary: "Cancellation intent is durable, but an exact host controller could not confirm delivery; reconciliation is required and no broad process kill was attempted." };
    }
  }

  async reconcile(operationId: string): Promise<Readonly<{ settled: boolean; summary: string }>> {
    bounded(operationId, "operation ID");
    return { settled: false, summary: "Exact terminal reconciliation requires the durable operation, action, and target binding; no work was replayed." };
  }

  async observe(bindingInput: OperationReconciliationBinding): Promise<OperationControllerObservation> {
    const binding = exactBinding(bindingInput);
    const observations = await Promise.all([
      ...this.queues.map(async (queue): Promise<OperationControllerObservation> => {
        if (queue.observeBoundOperation) return queue.observeBoundOperation(binding);
        const legacy = await queue.observeOperation(binding.operationId);
        if (notOwnerNote(legacy.summary)) return { state: "not_owner", operationId: binding.operationId, summary: legacy.summary };
        return active(binding, legacy.settled
          ? "A legacy exact queue reports settlement but cannot bind a terminal status and effect disposition; reconciliation remains ambiguous."
          : legacy.summary);
      }),
      ...(this.processes ? [this.processes.reconcileOperation(binding)] : [])
    ]);
    const owners = observations.filter((observation) => observation.state !== "not_owner");
    if (owners.length === 0) return { state: "not_owner", operationId: binding.operationId, summary: "No exact installed host controller owns this durable operation; no work was replayed." };
    if (owners.some((observation) => observation.state === "active")) {
      return active(binding, "At least one exact host controller remains active or cannot prove a terminal effect; no work was replayed.");
    }
    const terminals = owners.filter((observation): observation is Extract<OperationControllerObservation, { state: "terminal" }> => observation.state === "terminal");
    return terminals.length === 1
      ? terminals[0]!
      : active(binding, "More than one installed controller claimed the same durable operation; terminal state remains ambiguous and no work was replayed.");
  }

  /** Direct DurableContainmentManager hook. */
  async cancelQueuedOperations(input: Readonly<{ repositoryRoot: string; fenceEpoch: number }>): Promise<Readonly<{ queued: number; managedProcesses: number; repositoryEffects?: number }>> {
    const repositoryRoot = bounded(input.repositoryRoot, "repository root");
    if (!Number.isSafeInteger(input.fenceEpoch) || input.fenceEpoch < 1) throw new Error("Containment fence epoch is invalid.");
    const reason = `Containment fence ${input.fenceEpoch} cancelled exact repository-bound queued work.`;
    const [queued, managedProcesses, repositoryEffects] = await Promise.all([
      Promise.all(this.queues.map((queue) => queue.cancelQueuedForRepository(repositoryRoot, reason))).then(sum),
      this.processes?.cancelRepository(repositoryRoot, reason) ?? Promise.resolve(0),
      Promise.all(this.repositoryEffects.map((effect) => effect.cancelRepository(repositoryRoot, reason))).then(sum)
    ]);
    return { queued, managedProcesses, ...(this.repositoryEffects.length ? { repositoryEffects } : {}) };
  }
}

function sum(values: readonly number[]): number {
  if (values.some((value) => !Number.isSafeInteger(value) || value < 0)) throw new Error("An exact host cancellation controller returned an invalid count.");
  return values.reduce((total, value) => total + value, 0);
}
function exactBinding(input: OperationReconciliationBinding): OperationReconciliationBinding {
  const operationId = bounded(input.operationId, "operation ID");
  const action = bounded(input.action, "operation action");
  if (!(commandActionIds as readonly string[]).includes(action)) throw new Error("The operation action is not a canonical command action.");
  const targetSnapshotId = input.targetSnapshotId;
  if (targetSnapshotId !== undefined && !/^[a-f0-9]{64}$/.test(targetSnapshotId)) throw new Error("The operation target snapshot ID is invalid.");
  const repositoryRoot = input.repositoryRoot === undefined ? undefined : bounded(input.repositoryRoot, "repository root");
  if ((targetSnapshotId === undefined) !== (repositoryRoot === undefined)) throw new Error("The operation target binding is partial.");
  const sessionId = input.sessionId === undefined ? undefined : bounded(input.sessionId, "operation session ID");
  const authorityId = input.authorityId === undefined ? undefined : bounded(input.authorityId, "operation authority ID");
  return {
    operationId,
    action: action as CommandAction,
    ...(targetSnapshotId ? { targetSnapshotId, repositoryRoot } : {}),
    ...(sessionId ? { sessionId } : {}),
    ...(authorityId ? { authorityId } : {})
  };
}
function active(binding: OperationReconciliationBinding, summary: string): Extract<OperationControllerObservation, { state: "active" }> {
  return { state: "active", ...binding, effectDisposition: "ambiguous", summary };
}
function terminal(
  binding: OperationReconciliationBinding,
  status: "completed" | "failed" | "cancelled",
  effectDisposition: "not_started" | "committed" | "compensated",
  summary: string
): Extract<OperationControllerObservation, { state: "terminal" }> {
  return { state: "terminal", ...binding, status, effectDisposition, summary };
}
function notOwnerNote(summary: string): boolean {
  return /\bno exact\b|\bnot bound\b|\bdoes not own\b|\bowns no proven\b/i.test(summary);
}
function hostBindingMatches(
  expected: OperationReconciliationBinding,
  actual: Readonly<{ action: string; targetSnapshotId?: string; repositoryRoot?: string }> | undefined
): boolean {
  return actual?.action === expected.action && actual.targetSnapshotId === expected.targetSnapshotId
    && boundPath(actual.repositoryRoot) === boundPath(expected.repositoryRoot);
}
function boundPath(value: string | undefined): string | undefined {
  if (value === undefined) return undefined;
  const boundedPath = bounded(value, "repository root").replaceAll("\\", "/").replace(/\/+$/, "");
  return process.platform === "win32" ? boundedPath.toLowerCase() : boundedPath;
}
function bounded(value: string, field: string): string {
  if (typeof value !== "string" || !value.trim() || value.length > 4_096 || /[\0\r\n]/.test(value)) throw new Error(`The ${field} is invalid.`);
  return value;
}
