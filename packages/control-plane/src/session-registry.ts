import type { Capability, ManagedSession, SessionStatus } from "./contracts.ts";
import { jsonClone, type JournalEntry, ProtectedJsonStore } from "./store.ts";

export interface SessionRegistration extends Omit<ManagedSession, "lastHeartbeat" | "status"> {
  readonly lastHeartbeat?: string;
  readonly status?: SessionStatus;
}

export interface SessionBindingUpdate {
  readonly workspaceRoot?: string;
  readonly targetSnapshotId?: string;
  readonly taskId?: string;
  readonly planRevision?: string;
  readonly plannedFiles?: readonly string[];
  readonly metadata?: Readonly<Record<string, string>>;
}

export interface CapabilityDecision {
  readonly allowed: boolean;
  readonly missing: readonly Capability[];
  readonly session?: ManagedSession;
}

interface SessionSavedEvent {
  readonly session: ManagedSession;
}

export class SessionRegistryError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "SessionRegistryError";
  }
}

export class SessionCapabilityError extends SessionRegistryError {
  constructor(message: string) {
    super(message);
    this.name = "SessionCapabilityError";
  }
}

function nonEmpty(value: string, field: string): string {
  const trimmed = value.trim();
  if (!trimmed) throw new SessionRegistryError(`${field} must be non-empty.`);
  return trimmed;
}

function parseTimestamp(value: string, field: string): number {
  const parsed = Date.parse(value);
  if (!Number.isFinite(parsed)) throw new SessionRegistryError(`${field} must be a valid ISO timestamp.`);
  return parsed;
}

function distinctCapabilities(capabilities: readonly Capability[]): readonly Capability[] {
  const normalized = [...new Set(capabilities)];
  if (!normalized.includes("registered")) {
    throw new SessionCapabilityError("A managed session must retain the registered capability.");
  }
  return normalized;
}

function cloneSession(session: ManagedSession): ManagedSession {
  return {
    ...session,
    capabilities: [...session.capabilities],
    plannedFiles: [...session.plannedFiles],
    metadata: { ...session.metadata }
  };
}

function sessionMap(entries: readonly JournalEntry<unknown>[]): Map<string, ManagedSession> {
  const sessions = new Map<string, ManagedSession>();
  for (const entry of entries) {
    if (entry.kind !== "session.registered" && entry.kind !== "session.updated") continue;
    const payload = entry.payload as SessionSavedEvent;
    if (!payload?.session || typeof payload.session.id !== "string") {
      throw new SessionRegistryError("Protected session record is malformed.");
    }
    sessions.set(payload.session.id, cloneSession(payload.session));
  }
  return sessions;
}

/**
 * Durable capability and lifecycle registry. The companion records only
 * adapter-proven capabilities; absent capability is never inferred from an
 * open terminal or a visible window.
 */
export class SessionRegistry {
  private readonly store: ProtectedJsonStore;
  private readonly clock: () => string;

  constructor(store: ProtectedJsonStore, options: { readonly clock?: () => string } = {}) {
    this.store = store;
    this.clock = options.clock ?? (() => new Date().toISOString());
  }

  async register(input: SessionRegistration): Promise<ManagedSession> {
    const session = this.normalize(input);
    this.assertStatusSupported(session, session.status);
    parseTimestamp(session.lastHeartbeat, "lastHeartbeat");
    return this.store.transaction(async (transaction) => {
      const sessions = sessionMap(await transaction.readEntries());
      if (sessions.has(session.id)) throw new SessionRegistryError(`Session already registered: ${session.id}`);
      await transaction.append<SessionSavedEvent>("session.registered", { session });
      return cloneSession(session);
    });
  }

  /**
   * Stores a complete, already-normalized host session record. This is for
   * the authenticated companion persistence boundary, not for repository or
   * provider text; a new record replaces stale capability claims rather than
   * retaining privilege from a prior session with the same ID.
   */
  async upsert(input: SessionRegistration): Promise<ManagedSession> {
    const session = this.normalize(input);
    this.assertStatusSupported(session, session.status);
    parseTimestamp(session.lastHeartbeat, "lastHeartbeat");
    return this.store.transaction(async (transaction) => {
      const sessions = sessionMap(await transaction.readEntries());
      await transaction.append<SessionSavedEvent>(sessions.has(session.id) ? "session.updated" : "session.registered", { session });
      return cloneSession(session);
    });
  }

  async get(id: string): Promise<ManagedSession | undefined> {
    const session = sessionMap(await this.store.readEntries()).get(id);
    return session ? cloneSession(session) : undefined;
  }

  async list(): Promise<readonly ManagedSession[]> {
    return [...sessionMap(await this.store.readEntries()).values()].map(cloneSession);
  }

  async listByStatus(status: SessionStatus): Promise<readonly ManagedSession[]> {
    return (await this.list()).filter((session) => session.status === status);
  }

  async setCapabilities(id: string, capabilities: readonly Capability[]): Promise<ManagedSession> {
    return this.mutate(id, (existing) => ({ ...existing, capabilities: distinctCapabilities(capabilities) }));
  }

  async setStatus(id: string, status: SessionStatus): Promise<ManagedSession> {
    return this.mutate(id, (existing) => {
      this.assertStatusSupported(existing, status);
      return { ...existing, status };
    });
  }

  async heartbeat(id: string, at = this.clock()): Promise<ManagedSession> {
    const timestamp = parseTimestamp(at, "heartbeat timestamp");
    return this.mutate(id, (existing) => {
      if (timestamp < parseTimestamp(existing.lastHeartbeat, "stored heartbeat timestamp")) {
        throw new SessionRegistryError("Out-of-order heartbeats are rejected rather than moving a session backward in time.");
      }
      // A heartbeat proves liveness only. It does not infer running, blocked,
      // finished, observability, controllability, or mediation.
      return { ...existing, lastHeartbeat: at };
    });
  }

  async updateBinding(id: string, update: SessionBindingUpdate): Promise<ManagedSession> {
    return this.mutate(id, (existing) => ({
      ...existing,
      ...(update.workspaceRoot !== undefined ? { workspaceRoot: nonEmpty(update.workspaceRoot, "workspaceRoot") } : {}),
      ...(update.targetSnapshotId !== undefined ? { targetSnapshotId: nonEmpty(update.targetSnapshotId, "targetSnapshotId") } : {}),
      ...(update.taskId !== undefined ? { taskId: nonEmpty(update.taskId, "taskId") } : {}),
      ...(update.planRevision !== undefined ? { planRevision: nonEmpty(update.planRevision, "planRevision") } : {}),
      ...(update.plannedFiles !== undefined ? { plannedFiles: [...update.plannedFiles] } : {}),
      ...(update.metadata !== undefined ? { metadata: { ...update.metadata } } : {})
    }));
  }

  async markUnreachable(id: string): Promise<ManagedSession> {
    return this.setStatus(id, "unreachable");
  }

  async markStale(now: string, staleAfterMs: number): Promise<readonly ManagedSession[]> {
    const current = parseTimestamp(now, "stale check timestamp");
    if (!Number.isFinite(staleAfterMs) || staleAfterMs < 0) throw new SessionRegistryError("staleAfterMs must be a non-negative finite duration.");
    return this.store.transaction(async (transaction) => {
      const sessions = sessionMap(await transaction.readEntries());
      const changed: ManagedSession[] = [];
      for (const session of sessions.values()) {
        if (session.status === "unreachable" || session.status === "stale") continue;
        if (current - parseTimestamp(session.lastHeartbeat, "stored heartbeat timestamp") <= staleAfterMs) continue;
        const stale: ManagedSession = { ...session, status: "stale" };
        await transaction.append<SessionSavedEvent>("session.updated", { session: stale });
        changed.push(cloneSession(stale));
      }
      return changed;
    });
  }

  async requireCapabilities(id: string, required: readonly Capability[]): Promise<CapabilityDecision> {
    const session = await this.get(id);
    if (!session) return { allowed: false, missing: [...new Set(required)] };
    const available = new Set(session.capabilities);
    const missing = [...new Set(required)].filter((capability) => !available.has(capability));
    return { allowed: missing.length === 0, missing, session };
  }

  private async mutate(id: string, change: (session: ManagedSession) => ManagedSession): Promise<ManagedSession> {
    return this.store.transaction(async (transaction) => {
      const sessions = sessionMap(await transaction.readEntries());
      const existing = sessions.get(id);
      if (!existing) throw new SessionRegistryError(`Unknown session: ${id}`);
      const changed = cloneSession(change(cloneSession(existing)));
      const normalized: ManagedSession = { ...changed, capabilities: distinctCapabilities(changed.capabilities) };
      this.assertStatusSupported(normalized, normalized.status);
      parseTimestamp(normalized.lastHeartbeat, "lastHeartbeat");
      await transaction.append<SessionSavedEvent>("session.updated", { session: normalized });
      return jsonClone(normalized);
    });
  }

  private normalize(input: SessionRegistration): ManagedSession {
    return {
      id: nonEmpty(input.id, "session id"),
      provider: input.provider,
      surface: input.surface,
      capabilities: distinctCapabilities(input.capabilities),
      status: input.status ?? "unknown",
      ...(input.workspaceRoot ? { workspaceRoot: nonEmpty(input.workspaceRoot, "workspaceRoot") } : {}),
      ...(input.targetSnapshotId ? { targetSnapshotId: nonEmpty(input.targetSnapshotId, "targetSnapshotId") } : {}),
      ...(input.taskId ? { taskId: nonEmpty(input.taskId, "taskId") } : {}),
      ...(input.planRevision ? { planRevision: nonEmpty(input.planRevision, "planRevision") } : {}),
      plannedFiles: [...input.plannedFiles],
      lastHeartbeat: input.lastHeartbeat ?? this.clock(),
      adapterVersion: nonEmpty(input.adapterVersion, "adapterVersion"),
      metadata: { ...input.metadata }
    };
  }

  private assertStatusSupported(session: ManagedSession, status: SessionStatus): void {
    if ((status === "verified_blocked" || status === "verified_finished") && !session.capabilities.includes("observable")) {
      throw new SessionCapabilityError(`${status} requires an adapter-proven observable capability.`);
    }
  }
}
