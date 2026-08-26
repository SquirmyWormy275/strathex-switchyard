import { assignmentFor } from "../../../packages/protocol/src/b122.ts";
import type { CommandRequest, CommandResult } from "../../../packages/control-plane/src/contracts.ts";
import {
  DurableHardwareSignalInbox,
  isCompanionOwnedHardwareSignal,
  type HardwareSignalClaim
} from "./hardware-signal-queue.ts";

export interface HardwareSignalCommandExecutor {
  execute(request: CommandRequest): Promise<CommandResult>;
}

export interface CompanionHardwareSignalDispatcherOptions {
  readonly pollIntervalMs?: number;
}

/**
 * Companion-owned consumer for the authority-free, targetless subset of the
 * physical map. The inbox partitions claims before this class sees them, so a
 * focused VS Code window and the background consumer cannot race the same
 * canonical signal.
 */
export class CompanionHardwareSignalDispatcher {
  private readonly inbox: DurableHardwareSignalInbox;
  private readonly executor: HardwareSignalCommandExecutor;
  private readonly pollIntervalMs: number;
  private running = false;
  private timer: NodeJS.Timeout | undefined;
  private active: Promise<void> | undefined;
  private stopping: Promise<void> | undefined;

  constructor(
    inbox: DurableHardwareSignalInbox,
    executor: HardwareSignalCommandExecutor,
    options: CompanionHardwareSignalDispatcherOptions = {}
  ) {
    this.inbox = inbox;
    this.executor = executor;
    this.pollIntervalMs = options.pollIntervalMs ?? 100;
    if (!Number.isSafeInteger(this.pollIntervalMs) || this.pollIntervalMs < 10 || this.pollIntervalMs > 60_000) {
      throw new Error("The companion hardware dispatch polling interval is outside safe bounds.");
    }
  }

  async start(): Promise<void> {
    if (this.stopping) await this.stopping;
    if (this.running) return;
    this.running = true;
    this.kick();
  }

  async stop(): Promise<void> {
    if (this.stopping) return this.stopping;
    this.running = false;
    if (this.timer) clearTimeout(this.timer);
    this.timer = undefined;
    const active = this.active;
    if (!active) return;
    const stopping = active.then(() => undefined, () => undefined);
    this.stopping = stopping;
    try { await stopping; }
    finally { if (this.stopping === stopping) this.stopping = undefined; }
  }

  private kick(): void {
    if (!this.running || this.active) return;
    const task = this.drainAvailable().catch(() => undefined);
    this.active = task;
    void task.finally(() => {
      if (this.active === task) this.active = undefined;
      if (this.running) this.schedule();
    });
  }

  private schedule(): void {
    if (!this.running || this.timer) return;
    this.timer = setTimeout(() => {
      this.timer = undefined;
      this.kick();
    }, this.pollIntervalMs);
    this.timer.unref?.();
  }

  private async drainAvailable(): Promise<void> {
    while (this.running) {
      const claim = await this.inbox.claimCompanionTargetless();
      if (!claim) return;
      if (!this.running) {
        await this.requeueBeforeDispatch(claim);
        return;
      }
      if (!await this.dispatch(claim)) return;
    }
  }

  /** False pauses the drain until the next bounded poll after a pre-effect failure. */
  private async dispatch(claim: HardwareSignalClaim): Promise<boolean> {
    const assignment = assignmentFor(claim.control, claim.modifier);
    if (!assignment || !isCompanionOwnedHardwareSignal(claim.control, claim.modifier)) {
      await this.requeueBeforeDispatch(claim);
      return false;
    }

    let dispatchReceiptId: string;
    try {
      ({ dispatchReceiptId } = await this.inbox.recordDispatch({
        signalId: claim.signalId,
        claimToken: claim.claimToken,
        windowSessionId: claim.windowSessionId,
        workspaceRoots: claim.workspaceRoots,
        handler: assignment.handler,
        resultStatus: "dispatching"
      }));
    } catch {
      // If the append failed before commit, this safely requeues. If commit is
      // ambiguous, complete rejects because a dispatch exists and the claim is
      // retained for startup reconciliation instead of being replayed.
      await this.requeueBeforeDispatch(claim);
      return false;
    }

    if (!this.running) {
      await this.cancelAfterDispatchBeforeEffect(claim, dispatchReceiptId);
      return false;
    }

    let result: CommandResult;
    try {
      result = await this.executor.execute({ assignment, control: claim.control, modifier: claim.modifier });
    } catch {
      await this.markAmbiguous(claim, dispatchReceiptId, "The targetless command crossed its durable dispatch boundary but did not return a trusted result; manual reconciliation is required.");
      return true;
    }

    const ambiguous = result.status === "incomplete" || result.effectDisposition === "ambiguous";
    try {
      await this.inbox.complete({
        signalId: claim.signalId,
        claimToken: claim.claimToken,
        windowSessionId: claim.windowSessionId,
        workspaceRoots: claim.workspaceRoots,
        outcome: ambiguous ? "needs_reconciliation" : "handled",
        summary: ambiguous
          ? "The targetless command returned an ambiguous effect result; the hardware signal will not be replayed."
          : `The companion durably dispatched the canonical targetless command and received status ${result.status}.`,
        dispatchReceiptId
      });
    } catch {
      // A lost completion write leaves the exact dispatched claim intact. The
      // startup recovery pass converts it to needs_reconciliation without a
      // second effect.
    }
    return true;
  }

  private async requeueBeforeDispatch(claim: HardwareSignalClaim): Promise<void> {
    try {
      await this.inbox.complete({
        signalId: claim.signalId,
        claimToken: claim.claimToken,
        windowSessionId: claim.windowSessionId,
        workspaceRoots: claim.workspaceRoots,
        outcome: "failed_before_dispatch",
        summary: "The companion stopped or failed before recording a durable command dispatch; no effect was requested."
      });
    } catch {
      // An ambiguous durable append must retain the claim for restart recovery.
    }
  }

  private async markAmbiguous(claim: HardwareSignalClaim, dispatchReceiptId: string, summary: string): Promise<void> {
    try {
      await this.inbox.complete({
        signalId: claim.signalId,
        claimToken: claim.claimToken,
        windowSessionId: claim.windowSessionId,
        workspaceRoots: claim.workspaceRoots,
        outcome: "needs_reconciliation",
        summary,
        dispatchReceiptId
      });
    } catch {
      // Startup recovery owns a dispatched claim whose completion could not be
      // proven durable. Never infer success and never replay it.
    }
  }

  private async cancelAfterDispatchBeforeEffect(claim: HardwareSignalClaim, dispatchReceiptId: string): Promise<void> {
    try {
      await this.inbox.complete({
        signalId: claim.signalId,
        claimToken: claim.claimToken,
        windowSessionId: claim.windowSessionId,
        workspaceRoots: claim.workspaceRoots,
        outcome: "cancelled",
        summary: "Shutdown fenced the targetless command after its durable dispatch intent and before executor entry; no effect was requested.",
        dispatchReceiptId
      });
    } catch {
      // The dispatch remains reconciliation-required if cancellation cannot be
      // proven durable. It is never re-forwarded.
    }
  }
}
