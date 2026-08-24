import type { ManagedSession } from "../../../packages/control-plane/src/contracts.ts";
import type { SessionRegistry } from "../../../packages/control-plane/src/session-registry.ts";

export interface SessionFreshnessOptions {
  readonly now?: () => string;
  readonly staleAfterMs?: number;
  readonly refreshIntervalMs?: number;
  readonly maxFutureSkewMs?: number;
}

/** Local-only host-time expiry. It performs no provider or network effect. */
export class SessionFreshnessCoordinator {
  private readonly now: () => string;
  private readonly staleAfterMs: number;
  private readonly refreshIntervalMs: number;
  private readonly maxFutureSkewMs: number;
  private lastRefresh = Number.NEGATIVE_INFINITY;
  private pending?: Promise<readonly ManagedSession[]>;

  constructor(private readonly sessions: SessionRegistry, options: SessionFreshnessOptions = {}) {
    this.now = options.now ?? (() => new Date().toISOString());
    this.staleAfterMs = duration(options.staleAfterMs ?? 90_000, 1_000, 15 * 60_000, "session stale duration");
    this.refreshIntervalMs = duration(options.refreshIntervalMs ?? 5_000, 0, this.staleAfterMs, "session freshness interval");
    this.maxFutureSkewMs = duration(options.maxFutureSkewMs ?? 30_000, 0, 5 * 60_000, "session future skew");
  }

  async refresh(force = false): Promise<readonly ManagedSession[]> {
    if (this.pending) return this.pending;
    const nowText = this.now(); const now = Date.parse(nowText);
    if (!Number.isFinite(now)) throw new Error("The host session-freshness clock is invalid.");
    if (!force && now - this.lastRefresh < this.refreshIntervalMs) return this.sessions.list();
    this.pending = this.refreshNow(nowText, now).finally(() => { this.pending = undefined; });
    return this.pending;
  }

  private async refreshNow(nowText: string, now: number): Promise<readonly ManagedSession[]> {
    await this.sessions.markStale(nowText, this.staleAfterMs);
    for (const session of await this.sessions.list()) {
      const heartbeat = Date.parse(session.lastHeartbeat);
      if (!Number.isFinite(heartbeat) || heartbeat > now + this.maxFutureSkewMs) await this.sessions.setStatus(session.id, "stale");
    }
    this.lastRefresh = now;
    return this.sessions.list();
  }
}

function duration(value: number, minimum: number, maximum: number, label: string): number {
  if (!Number.isSafeInteger(value) || value < minimum || value > maximum) throw new Error(`${label} is invalid.`);
  return value;
}
