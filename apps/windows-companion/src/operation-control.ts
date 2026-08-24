import type { OperationControlAdapter, OperationCancellationOutcome, OperationCancellationRequest } from "../../../packages/control-plane/src/execution-control.ts";
import type { RepositoryProcessStartRequest, RepositoryProcessSupervisor, RepositorySupervisedProcess } from "./repository-runtime.ts";

export interface ExactOperationQueueControl {
  cancelByOperation(operationId: string, reason: string): Promise<number>;
  cancelQueuedForRepository(repositoryRoot: string, reason: string): Promise<number>;
  observeOperation(operationId: string): Promise<Readonly<{ settled: boolean; summary: string }>>;
}

export interface ManagedProcessOperationControl {
  cancelOperation(operationId: string, reason: string): Promise<number>;
  cancelRepository(repositoryRoot: string, reason: string): Promise<number>;
  reconcileOperation(operationId: string): Promise<Readonly<{ settled: boolean; summary: string }>>;
}

export interface DurableHostActionQueueControl {
  cancelPendingByOperation(operationId: string, reason: string): Promise<number>;
  cancelQueuedForRepository(repositoryRoot: string, reason: string): Promise<number>;
  observeOperation(operationId: string): Promise<Readonly<{ outcome: "committed" | "failed" | "cancelled" | "unresolved"; note: string }>>;
}

export type DurableWorkflowOperationStatus = "prepared" | "submitted" | "cancelling" | "acknowledged" | "rejected" | "cancelled";

export interface DurableWorkflowArtifactQueueControl {
  cancelByOperation(operationId: string): Promise<Readonly<{ status: DurableWorkflowOperationStatus }> | undefined>;
  cancelQueuedForRepository(repositoryRoot: string): Promise<readonly Readonly<{ status: DurableWorkflowOperationStatus }>[] >;
  observeOperation(operationId: string): Promise<Readonly<{ status: DurableWorkflowOperationStatus }> | undefined>;
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
    if (observed.status === "acknowledged" || observed.status === "rejected" || observed.status === "cancelled") {
      return { settled: true, summary: `The exact provider workflow artifact is durably ${observed.status}.` };
    }
    return { settled: false, summary: `The exact provider workflow artifact remains ${observed.status}; its external effect was not guessed or replayed.` };
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
}

export interface InstalledOperationControlOptions {
  readonly queues?: readonly ExactOperationQueueControl[];
  readonly processes?: ManagedProcessOperationControl;
}

/**
 * Coordinates cancellation across host-owned exact bindings only. It never
 * accepts a PID, process name, workspace command, or global kill fallback.
 */
export class InstalledOperationControl implements OperationControlAdapter {
  private readonly queues: readonly ExactOperationQueueControl[];
  private readonly processes?: ManagedProcessOperationControl;

  constructor(options: InstalledOperationControlOptions = {}) {
    this.queues = [...(options.queues ?? [])];
    this.processes = options.processes;
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
    const exactOperation = bounded(operationId, "operation ID");
    const observations = await Promise.all([
      ...this.queues.map((queue) => queue.observeOperation(exactOperation)),
      ...(this.processes ? [this.processes.reconcileOperation(exactOperation)] : [])
    ]);
    const unresolved = observations.filter((observation) => !observation.settled).length;
    return unresolved === 0 && observations.length > 0
      ? { settled: true, summary: `All ${observations.length} exact host controller(s) report the existing operation settled; no work was replayed.` }
      : { settled: false, summary: `Exact host observation remains unresolved in ${unresolved || 1} controller(s); no work was replayed.` };
  }

  /** Direct DurableContainmentManager hook. */
  async cancelQueuedOperations(input: Readonly<{ repositoryRoot: string; fenceEpoch: number }>): Promise<Readonly<{ queued: number; managedProcesses: number }>> {
    const repositoryRoot = bounded(input.repositoryRoot, "repository root");
    if (!Number.isSafeInteger(input.fenceEpoch) || input.fenceEpoch < 1) throw new Error("Containment fence epoch is invalid.");
    const reason = `Containment fence ${input.fenceEpoch} cancelled exact repository-bound queued work.`;
    const [queued, managedProcesses] = await Promise.all([
      Promise.all(this.queues.map((queue) => queue.cancelQueuedForRepository(repositoryRoot, reason))).then(sum),
      this.processes?.cancelRepository(repositoryRoot, reason) ?? Promise.resolve(0)
    ]);
    return { queued, managedProcesses };
  }
}

function sum(values: readonly number[]): number {
  if (values.some((value) => !Number.isSafeInteger(value) || value < 0)) throw new Error("An exact host cancellation controller returned an invalid count.");
  return values.reduce((total, value) => total + value, 0);
}
function bounded(value: string, field: string): string {
  if (typeof value !== "string" || !value.trim() || value.length > 4_096 || /[\0\r\n]/.test(value)) throw new Error(`The ${field} is invalid.`);
  return value;
}
