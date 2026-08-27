export interface DurableCancellationControl {
  readonly deadline: string;
  isCancellationRequested(): Promise<boolean>;
}

export type DurableAbortReason = "cancelled" | "deadline" | "unavailable";

export interface DurableAbortControl {
  readonly signal: AbortSignal;
  reason(): DurableAbortReason | undefined;
  dispose(): void;
}

export interface DurableAbortControlOptions {
  /** Used by effect boundaries that also have a non-governance hard limit. */
  readonly fallbackDeadline?: string;
  readonly pollIntervalMs?: number;
}

type CancellationRead = "active" | DurableAbortReason;

/**
 * Creates one deadline-bound, fail-closed cancellation signal. Cancellation
 * reads are serialized: a later poll is not scheduled until the prior read
 * settles. Every read races the operation deadline and keeps both settlement
 * handlers attached so a late store result cannot become unhandled.
 */
export async function createDurableAbortControl(
  control?: DurableCancellationControl,
  options: DurableAbortControlOptions = {}
): Promise<DurableAbortControl> {
  const controller = new AbortController();
  let abortReason: DurableAbortReason | undefined;
  let deadlineTimer: ReturnType<typeof setTimeout> | undefined;
  let pollTimer: ReturnType<typeof setTimeout> | undefined;
  let disposed = false;

  const abort = (reason: DurableAbortReason): void => {
    if (!abortReason) abortReason = reason;
    if (!controller.signal.aborted) controller.abort();
  };
  const result = (): DurableAbortControl => ({
    signal: controller.signal,
    reason: () => abortReason,
    dispose() {
      disposed = true;
      if (deadlineTimer) clearTimeout(deadlineTimer);
      if (pollTimer) clearTimeout(pollTimer);
      if (!controller.signal.aborted) controller.abort();
    }
  });

  const deadlineText = control?.deadline ?? options.fallbackDeadline;
  if (!deadlineText) return result();
  const deadline = Date.parse(deadlineText);
  const remaining = deadline - Date.now();
  if (!Number.isFinite(deadline) || remaining <= 0) {
    abort("deadline");
    return result();
  }
  deadlineTimer = setTimeout(() => abort("deadline"), remaining);
  deadlineTimer.unref?.();
  if (!control) return result();

  const read = (): Promise<CancellationRead> => {
    const effect = Promise.resolve().then(() => control.isCancellationRequested());
    return new Promise<CancellationRead>((resolve) => {
      let settled = false;
      const finish = (value: CancellationRead): void => {
        if (settled) return;
        settled = true;
        controller.signal.removeEventListener("abort", onAbort);
        resolve(value);
      };
      const onAbort = (): void => finish(abortReason ?? "deadline");
      controller.signal.addEventListener("abort", onAbort, { once: true });
      effect.then(
        (cancelled) => finish(Date.now() >= deadline ? "deadline" : cancelled ? "cancelled" : "active"),
        () => finish("unavailable")
      );
      if (controller.signal.aborted) onAbort();
    });
  };

  const schedule = (): void => {
    if (disposed || controller.signal.aborted) return;
    pollTimer = setTimeout(async () => {
      pollTimer = undefined;
      const state = await read();
      if (disposed) return;
      if (state === "active") schedule();
      else abort(state);
    }, Math.max(1, options.pollIntervalMs ?? 100));
    pollTimer.unref?.();
  };

  const initial = await read();
  if (initial === "active" && Date.now() >= deadline) abort("deadline");
  else if (initial === "active") schedule();
  else abort(initial);
  return result();
}

/** A bounded, fail-closed admission read for composed broker boundaries. */
export async function readDurableCancellation(control?: DurableCancellationControl): Promise<"active" | DurableAbortReason> {
  if (!control) return "active";
  const abort = await createDurableAbortControl(control);
  const state = abort.reason() ?? "active";
  abort.dispose();
  return state;
}
