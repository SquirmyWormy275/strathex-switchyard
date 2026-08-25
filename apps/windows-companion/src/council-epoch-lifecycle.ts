import { resolve } from "node:path";

import { CouncilCoordinator, type CouncilEpoch, type CouncilParticipant } from "../../../packages/control-plane/src/council.ts";
import type { ManagedSession } from "../../../packages/control-plane/src/contracts.ts";
import type { SessionRegistry } from "../../../packages/control-plane/src/session-registry.ts";
import type { CouncilIsolationPlan } from "./council-workspace-isolation.ts";

export interface CouncilEpochLifecycleIsolation {
  recover(epochId: string): Promise<CouncilIsolationPlan>;
  assertCurrent(epochId: string): Promise<CouncilIsolationPlan>;
  cleanup(epochId: string): Promise<CouncilIsolationPlan>;
}

export interface CouncilEpochLifecycleScheduler {
  setInterval(callback: () => void, delayMs: number): unknown;
  clearInterval(handle: unknown): void;
}

export interface CouncilEpochLifecycleOptions {
  readonly now?: () => number;
  readonly heartbeatMaxAgeMs?: number;
  readonly pollIntervalMs?: number;
  readonly scheduler?: CouncilEpochLifecycleScheduler;
  readonly resources?: Readonly<{ assertPlanOperational(plan: CouncilIsolationPlan): Promise<void> }>;
}

const defaultScheduler: CouncilEpochLifecycleScheduler = {
  setInterval(callback, delayMs) {
    const timer = setInterval(callback, delayMs);
    timer.unref?.();
    return timer;
  },
  clearInterval(handle) {
    clearInterval(handle as ReturnType<typeof setInterval>);
  }
};

/**
 * Owns active Council epochs after their one-shot activation transaction.
 * Every pass re-reads protected session state, advances only monotonic fresh
 * heartbeats, verifies the exact isolation fence, and immediately records an
 * abort before cleanup when any invariant is lost.
 */
export class CouncilEpochLifecycleManager {
  private readonly now: () => number;
  private readonly heartbeatMaxAgeMs: number;
  private readonly pollIntervalMs: number;
  private readonly scheduler: CouncilEpochLifecycleScheduler;
  private readonly resources?: Readonly<{ assertPlanOperational(plan: CouncilIsolationPlan): Promise<void> }>;
  private timer: unknown;
  private inFlight?: Promise<readonly CouncilEpoch[]>;
  private started = false;
  private disposed = false;

  constructor(
    private readonly council: CouncilCoordinator,
    private readonly sessions: SessionRegistry,
    private readonly isolation: CouncilEpochLifecycleIsolation,
    options: CouncilEpochLifecycleOptions = {}
  ) {
    this.now = options.now ?? Date.now;
    this.heartbeatMaxAgeMs = options.heartbeatMaxAgeMs ?? 5 * 60_000;
    this.pollIntervalMs = options.pollIntervalMs ?? 5_000;
    this.scheduler = options.scheduler ?? defaultScheduler;
    this.resources = options.resources;
    if (!Number.isSafeInteger(this.heartbeatMaxAgeMs) || this.heartbeatMaxAgeMs < 1) throw new Error("Council lifecycle heartbeat maximum age must be a positive integer.");
    if (!Number.isSafeInteger(this.pollIntervalMs) || this.pollIntervalMs < 100) throw new Error("Council lifecycle poll interval must be at least 100 milliseconds.");
  }

  async start(): Promise<void> {
    if (this.disposed) throw new Error("A disposed Council lifecycle cannot be restarted.");
    if (this.started) return;
    this.started = true;
    await this.recoverAndReconcile();
    if (this.disposed) return;
    this.timer = this.scheduler.setInterval(() => {
      void this.reconcileNow().catch(() => undefined);
    }, this.pollIntervalMs);
  }

  async reconcileNow(): Promise<readonly CouncilEpoch[]> {
    if (this.disposed) return [];
    if (this.inFlight) return this.inFlight;
    const run = this.reconcileAll();
    this.inFlight = run;
    try {
      return await run;
    } finally {
      if (this.inFlight === run) this.inFlight = undefined;
    }
  }

  async dispose(): Promise<void> {
    if (this.disposed) return;
    this.disposed = true;
    if (this.timer !== undefined) {
      this.scheduler.clearInterval(this.timer);
      this.timer = undefined;
    }
    await this.inFlight?.catch(() => undefined);
  }

  private async recoverAndReconcile(): Promise<void> {
    for (const epoch of await this.council.listOngoing()) {
      if (epoch.status === "completion_pending") continue;
      try {
        const recovered = await this.isolation.recover(epoch.id);
        if (recovered.status !== "prepared") throw new Error(`Council isolation recovery returned ${recovered.status}.`);
      } catch (error) {
        await this.abortAndCleanup(epoch.id, reason(error, "Council isolation could not be recovered on companion startup."));
      }
    }
    await this.reconcileNow();
  }

  private async reconcileAll(): Promise<readonly CouncilEpoch[]> {
    const results: CouncilEpoch[] = [];
    for (const epoch of await this.council.listOngoing()) results.push(await this.reconcileEpoch(epoch));
    return results;
  }

  private async reconcileEpoch(epoch: CouncilEpoch): Promise<CouncilEpoch> {
    if (epoch.status === "completion_pending") return this.finishCleanup(epoch);
    try {
      const observations = await this.observations(epoch);
      const validated = await this.council.validate(epoch.id, observations);
      if (validated.status === "aborted") {
        await this.isolation.cleanup(epoch.id).catch(() => undefined);
        return validated;
      }
      const plan = await this.isolation.assertCurrent(epoch.id);
      if (validated.participants.every((participant) => participant.status === "verified_finished")) {
        return this.finishCleanup(await this.council.beginCompletion(epoch.id));
      }
      await this.resources?.assertPlanOperational(plan);
      return validated;
    } catch (error) {
      return this.abortAndCleanup(epoch.id, reason(error, "Council ongoing verification failed closed."));
    }
  }

  private async finishCleanup(epoch: CouncilEpoch): Promise<CouncilEpoch> {
    const cleaned = await this.isolation.cleanup(epoch.id);
    if (cleaned.status !== "cleaned") return epoch;
    return this.council.complete(epoch.id);
  }

  private async abortAndCleanup(epochId: string, failure: string): Promise<CouncilEpoch> {
    const stopped = await this.council.abort(epochId, failure);
    await this.isolation.cleanup(epochId).catch(() => undefined);
    return stopped;
  }

  private async observations(epoch: CouncilEpoch): Promise<readonly CouncilParticipant[]> {
    const eligible = (await this.sessions.list())
      .filter((session) => exactEpochSession(session, epoch))
      .sort((left, right) => left.id.localeCompare(right.id));
    const expectedIds = epoch.participants.map((participant) => participant.id).sort();
    const currentIds = eligible.map((session) => session.id);
    if (!sameStrings(expectedIds, currentIds)) throw new Error("Council participant set changed during the epoch.");
    return eligible.map((session) => participantFromSession(session, epoch, this.now(), this.heartbeatMaxAgeMs));
  }
}

function exactEpochSession(session: ManagedSession, epoch: CouncilEpoch): boolean {
  return session.targetSnapshotId === epoch.targetSnapshotId
    && session.workspaceRoot !== undefined
    && samePath(session.workspaceRoot, epoch.repositoryRoot)
    && session.capabilities.includes("registered")
    && session.capabilities.includes("observable")
    && session.metadata["sxsy-b122.providerHandshake"] === "exact-route-v1";
}

function participantFromSession(session: ManagedSession, epoch: CouncilEpoch, now: number, heartbeatMaxAgeMs: number): CouncilParticipant {
  const heartbeat = Date.parse(session.lastHeartbeat);
  if (!Number.isFinite(heartbeat) || heartbeat > now + 30_000 || now - heartbeat > heartbeatMaxAgeMs) throw new Error(`Council participant ${session.id} heartbeat is stale or invalid.`);
  const resources = declarations(session, "sxsy-b122.resources");
  const dependencies = declarations(session, "sxsy-b122.dependencies");
  const diffDigest = session.metadata["sxsy-b122.diffDigest"];
  if (!diffDigest || !/^[a-f0-9]{64}$/i.test(diffDigest)) throw new Error(`Council participant ${session.id} lacks a trusted current diff digest.`);
  return {
    id: session.id,
    targetSnapshotId: epoch.targetSnapshotId,
    status: session.status,
    capabilities: session.capabilities,
    lastHeartbeat: session.lastHeartbeat,
    plannedFiles: session.plannedFiles,
    resources,
    dependencies,
    diffDigest: diffDigest.toLowerCase()
  };
}

function declarations(session: ManagedSession, key: string): readonly string[] {
  const raw = session.metadata[key];
  if (raw === undefined) return [];
  let value: unknown;
  try {
    value = JSON.parse(raw);
  } catch {
    throw new Error(`Council participant ${session.id} has malformed ${key} declarations.`);
  }
  if (!Array.isArray(value) || value.length > 128 || !value.every((entry) => typeof entry === "string" && entry.length > 0 && entry.length <= 256 && !/[\r\n\0]/.test(entry))) {
    throw new Error(`Council participant ${session.id} has invalid ${key} declarations.`);
  }
  return [...new Set(value)].sort();
}

function samePath(left: string, right: string): boolean {
  return resolve(left).replace(/[\\/]+$/, "").toLowerCase() === resolve(right).replace(/[\\/]+$/, "").toLowerCase();
}

function sameStrings(left: readonly string[], right: readonly string[]): boolean {
  return left.length === right.length && left.every((value, index) => value === right[index]);
}

function reason(error: unknown, fallback: string): string {
  return error instanceof Error ? error.message.slice(0, 512) : fallback;
}
