/**
 * A bounded cooperative cancellation/deadline signal passed only from durable
 * governance to a registered adapter or broker. It is not client input and
 * does not itself grant execution authority.
 */
export interface ExecutionControl {
  readonly operationId: string;
  readonly budgetClaimId?: string;
  readonly deadline: string;
  isCancellationRequested(): Promise<boolean>;
}

export interface OperationCancellationRequest {
  readonly operationId: string;
  readonly reason: string;
}

export interface OperationCancellationOutcome {
  readonly accepted: boolean;
  readonly summary: string;
}

/**
 * Implemented by a real host/process/provider broker. The control plane calls
 * it on explicit cancel and deadline expiry; it never falls back to killing an
 * arbitrary PID or shell command. `reconcile` is an observation probe only.
 */
export interface OperationControlAdapter {
  cancel(request: OperationCancellationRequest): Promise<OperationCancellationOutcome>;
  reconcile?(operationId: string): Promise<Readonly<{ readonly settled: boolean; readonly summary: string }>>;
}

/** Ephemeral signal registry; durable cancellation intent remains in BudgetLedger. */
export class ExecutionControlRegistry {
  private readonly cancelled = new Map<string, string>();
  private readonly controls = new Map<string, ExecutionControl>();

  bind(operationId: string, deadline: string, budgetClaimId?: string): ExecutionControl {
    const control: ExecutionControl = {
      operationId,
      ...(budgetClaimId ? { budgetClaimId } : {}),
      deadline,
      isCancellationRequested: async () => this.cancelled.has(operationId) || Date.parse(deadline) <= Date.now()
    };
    this.controls.set(operationId, control);
    return control;
  }

  request(operationId: string, reason: string): void {
    this.cancelled.set(operationId, reason);
  }

  get(operationId: string): ExecutionControl | undefined { return this.controls.get(operationId); }

  release(operationId: string): void {
    this.controls.delete(operationId);
    this.cancelled.delete(operationId);
  }
}
