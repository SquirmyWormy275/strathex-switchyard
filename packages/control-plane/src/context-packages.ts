import { randomUUID } from "node:crypto";

import { redactText } from "./redaction.ts";
import { jsonClone, type JournalEntry, ProtectedJsonStore, sha256, stableJson } from "./store.ts";

export type HandoffStatus = "queued" | "immediate_focus_requested" | "acknowledged" | "cancelled" | "archived";
export type HandoffRoutingDefault = "queue" | "immediate";

/**
 * A durable transfer of work context. An authority ID is only a reference to
 * the protected authority ledger: this package can never issue, widen, or
 * execute authority on its own.
 */
export interface HandoffPackage {
  readonly id: string;
  readonly digest: string;
  readonly repositoryRoot: string;
  readonly targetSnapshotId: string;
  readonly taskId: string;
  readonly planRevision: string;
  readonly authorityId?: string;
  readonly plan: string;
  readonly decisions: readonly string[];
  readonly documentation: readonly string[];
  readonly references: readonly string[];
  readonly constraints: readonly string[];
  readonly openQuestions: readonly string[];
  readonly nextActions: readonly string[];
  readonly recipientSessionId?: string;
  readonly status: HandoffStatus;
  /** A hard boundary, included to make accidental use as an execution token impossible. */
  readonly executionAuthorized: false;
  readonly createdAt: string;
  readonly updatedAt: string;
  readonly acknowledgedAt?: string;
}

export interface HandoffPackageInput {
  readonly id?: string;
  readonly repositoryRoot: string;
  readonly targetSnapshotId: string;
  readonly taskId: string;
  readonly planRevision: string;
  readonly authorityId?: string;
  readonly plan: string;
  readonly decisions: readonly string[];
  readonly documentation: readonly string[];
  readonly references: readonly string[];
  readonly constraints: readonly string[];
  readonly openQuestions: readonly string[];
  readonly nextActions: readonly string[];
  readonly recipientSessionId?: string;
  readonly routing?: HandoffRoutingDefault;
}

interface HandoffSavedEvent { readonly packet: HandoffPackage; }
interface HandoffRoutingEvent { readonly routing: HandoffRoutingDefault; }

export class HandoffPackageError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "HandoffPackageError";
  }
}

function nonEmpty(value: string, field: string): string {
  const trimmed = value.trim();
  if (!trimmed) throw new HandoffPackageError(`${field} must be non-empty.`);
  return redactText(trimmed);
}

function list(values: readonly string[], field: string): readonly string[] {
  return [...new Set(values.map((value) => nonEmpty(value, field)))];
}

function clonePacket(packet: HandoffPackage): HandoffPackage {
  return {
    ...packet,
    decisions: [...packet.decisions],
    documentation: [...packet.documentation],
    references: [...packet.references],
    constraints: [...packet.constraints],
    openQuestions: [...packet.openQuestions],
    nextActions: [...packet.nextActions],
    executionAuthorized: false
  };
}

function packets(entries: readonly JournalEntry<unknown>[]): Map<string, HandoffPackage> {
  const result = new Map<string, HandoffPackage>();
  for (const entry of entries) {
    if (entry.kind !== "handoff.saved") continue;
    const packet = (entry.payload as HandoffSavedEvent | undefined)?.packet;
    if (!packet || typeof packet.id !== "string" || packet.executionAuthorized !== false || packetDigest(packet) !== packet.digest) {
      throw new HandoffPackageError("Protected handoff record is malformed.");
    }
    result.set(packet.id, clonePacket(packet));
  }
  return result;
}

function routing(entries: readonly JournalEntry<unknown>[]): HandoffRoutingDefault {
  let current: HandoffRoutingDefault = "queue";
  for (const entry of entries) {
    if (entry.kind !== "handoff.routing") continue;
    const candidate = (entry.payload as HandoffRoutingEvent | undefined)?.routing;
    if (candidate !== "queue" && candidate !== "immediate") throw new HandoffPackageError("Protected routing record is malformed.");
    current = candidate;
  }
  return current;
}

/**
 * Host-owned, append-only context packages for Handoff and decision return.
 * It deliberately does not communicate with a provider, focus a window, or
 * execute a command; adapters can only consume an already-created package.
 */
export class HandoffPackageStore {
  private readonly store: ProtectedJsonStore;
  private readonly clock: () => string;
  private readonly idFactory: () => string;

  constructor(store: ProtectedJsonStore, options: { readonly clock?: () => string; readonly idFactory?: () => string } = {}) {
    this.store = store;
    this.clock = options.clock ?? (() => new Date().toISOString());
    this.idFactory = options.idFactory ?? randomUUID;
  }

  async create(input: HandoffPackageInput): Promise<HandoffPackage> {
    const now = this.clock();
    const immutable = {
      id: nonEmpty(input.id ?? this.idFactory(), "handoff id"),
      repositoryRoot: nonEmpty(input.repositoryRoot, "repositoryRoot"),
      targetSnapshotId: nonEmpty(input.targetSnapshotId, "targetSnapshotId"),
      taskId: nonEmpty(input.taskId, "taskId"),
      planRevision: nonEmpty(input.planRevision, "planRevision"),
      ...(input.authorityId ? { authorityId: nonEmpty(input.authorityId, "authorityId") } : {}),
      plan: nonEmpty(input.plan, "plan"),
      decisions: list(input.decisions, "decision"),
      documentation: list(input.documentation, "documentation reference"),
      references: list(input.references, "reference"),
      constraints: list(input.constraints, "constraint"),
      openQuestions: list(input.openQuestions, "open question"),
      nextActions: list(input.nextActions, "next action"),
      ...(input.recipientSessionId ? { recipientSessionId: nonEmpty(input.recipientSessionId, "recipientSessionId") } : {})
    };
    return this.store.transaction(async (transaction) => {
      const entries = await transaction.readEntries();
      const existing = packets(entries);
      const resolvedRouting = input.routing ?? routing(entries);
      const packet: HandoffPackage = {
        ...immutable,
        digest: sha256(stableJson(immutable)),
        status: resolvedRouting === "immediate" ? "immediate_focus_requested" : "queued",
        executionAuthorized: false,
        createdAt: now,
        updatedAt: now
      };
      if (existing.has(packet.id)) throw new HandoffPackageError(`Handoff package already exists: ${packet.id}`);
      await transaction.append<HandoffSavedEvent>("handoff.saved", { packet });
      return clonePacket(packet);
    });
  }

  async get(id: string): Promise<HandoffPackage | undefined> {
    const packet = packets(await this.store.readEntries()).get(id);
    return packet ? clonePacket(packet) : undefined;
  }

  async list(status?: HandoffStatus): Promise<readonly HandoffPackage[]> {
    return [...packets(await this.store.readEntries()).values()]
      .filter((packet) => !status || packet.status === status)
      .map(clonePacket);
  }

  async setRoutingDefault(value: HandoffRoutingDefault): Promise<HandoffRoutingDefault> {
    if (value !== "queue" && value !== "immediate") throw new HandoffPackageError("Unknown handoff routing default.");
    await this.store.append<HandoffRoutingEvent>("handoff.routing", { routing: value });
    return value;
  }

  async routingDefault(): Promise<HandoffRoutingDefault> {
    return routing(await this.store.readEntries());
  }

  async acknowledge(id: string, recipientSessionId: string): Promise<HandoffPackage> {
    return this.updateStatus(id, "acknowledged", recipientSessionId);
  }

  async cancel(id: string): Promise<HandoffPackage> {
    return this.updateStatus(id, "cancelled");
  }

  async archive(id: string): Promise<HandoffPackage> {
    return this.updateStatus(id, "archived");
  }

  private async updateStatus(id: string, status: HandoffStatus, recipientSessionId?: string): Promise<HandoffPackage> {
    return this.store.transaction(async (transaction) => {
      const found = packets(await transaction.readEntries()).get(id);
      if (!found) throw new HandoffPackageError(`Unknown handoff package: ${id}`);
      if (recipientSessionId && found.recipientSessionId && found.recipientSessionId !== recipientSessionId) {
        throw new HandoffPackageError("Only the package's selected recipient can acknowledge it.");
      }
      if (["cancelled", "archived"].includes(found.status) && found.status !== status) {
        throw new HandoffPackageError(`Handoff package is already ${found.status}.`);
      }
      const updatedAt = this.clock();
      const updated: HandoffPackage = {
        ...found,
        ...(recipientSessionId && !found.recipientSessionId ? { recipientSessionId: nonEmpty(recipientSessionId, "recipientSessionId") } : {}),
        status,
        updatedAt,
        ...(status === "acknowledged" ? { acknowledgedAt: updatedAt } : {}),
        executionAuthorized: false
      };
      await transaction.append<HandoffSavedEvent>("handoff.saved", { packet: updated });
      return clonePacket(updated);
    });
  }
}

function packetDigest(packet: HandoffPackage): string {
  return sha256(stableJson({
    id: packet.id, repositoryRoot: packet.repositoryRoot, targetSnapshotId: packet.targetSnapshotId, taskId: packet.taskId,
    planRevision: packet.planRevision, ...(packet.authorityId ? { authorityId: packet.authorityId } : {}), plan: packet.plan,
    decisions: packet.decisions, documentation: packet.documentation, references: packet.references, constraints: packet.constraints,
    openQuestions: packet.openQuestions, nextActions: packet.nextActions, ...(packet.recipientSessionId ? { recipientSessionId: packet.recipientSessionId } : {})
  }));
}
