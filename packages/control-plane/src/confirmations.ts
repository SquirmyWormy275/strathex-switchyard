import { randomUUID } from "node:crypto";

import type { CommandAction } from "./command-catalog.ts";
import { redactText } from "./redaction.ts";
import { sha256, type JournalEntry, type JsonStoreTransaction, ProtectedJsonStore } from "./store.ts";

export interface DurableConfirmationRequest {
  readonly action: CommandAction;
  readonly targetSnapshotId?: string;
  readonly sessionId?: string;
  readonly authorityId?: string;
  /** Digest of additional reviewed scope that must match exactly at consume time. */
  readonly scopeDigest?: string;
  readonly reason: string;
  /** This bit is written only after a host-owned reauthentication attestor succeeds. */
  readonly reauthenticated: boolean;
}

export interface DurableConfirmationRecord extends DurableConfirmationRequest {
  readonly id: string;
  /** Never expose or persist the bearer token itself. */
  readonly tokenDigest: string;
  readonly createdAt: string;
  readonly expiresAt: string;
  readonly consumedAt?: string;
}

export interface IssuedConfirmation {
  readonly record: Omit<DurableConfirmationRecord, "tokenDigest" | "consumedAt">;
  /** Returned exactly once to the reviewed host UI; it is never written to the journal. */
  readonly token: string;
}

export interface ConfirmationConsumeRequest {
  readonly token: string;
  readonly action: CommandAction;
  readonly targetSnapshotId?: string;
  readonly sessionId?: string;
  readonly authorityId?: string;
  readonly scopeDigest?: string;
}

export interface ConfirmationDecision {
  readonly allowed: boolean;
  readonly reason: string;
  readonly record?: DurableConfirmationRecord;
}

interface ConfirmationIssuedEvent { readonly confirmation: DurableConfirmationRecord; }
interface ConfirmationConsumedEvent { readonly confirmationId: string; readonly consumedAt: string; }

function text(value: string, field: string): string {
  const normalized = value.trim();
  if (!normalized || /[\r\n\0]/.test(normalized)) throw new DurableConfirmationError(`${field} must be a bounded non-empty reference.`);
  return redactText(normalized);
}

function optionalReference(value: string | undefined, field: string): string | undefined {
  return value === undefined ? undefined : text(value, field);
}

function optionalDigest(value: string | undefined, field: string): string | undefined {
  if (value === undefined) return undefined;
  if (!/^[a-f0-9]{64}$/.test(value)) throw new DurableConfirmationError(`${field} must be an exact SHA-256 digest.`);
  return value;
}

function timestamp(value: string, field: string): string {
  if (!Number.isFinite(Date.parse(value))) throw new DurableConfirmationError(`${field} must be an ISO timestamp.`);
  return value;
}

function clone(record: DurableConfirmationRecord): DurableConfirmationRecord {
  return { ...record };
}

function records(entries: readonly JournalEntry<unknown>[]): Map<string, DurableConfirmationRecord> {
  const output = new Map<string, DurableConfirmationRecord>();
  for (const entry of entries) {
    if (entry.kind === "confirmation.issued") {
      const value = (entry.payload as ConfirmationIssuedEvent | undefined)?.confirmation;
      if (!value || typeof value.id !== "string" || typeof value.tokenDigest !== "string") {
        throw new DurableConfirmationError("Protected confirmation record is malformed.");
      }
      output.set(value.id, clone(value));
    }
    if (entry.kind === "confirmation.consumed") {
      const value = entry.payload as ConfirmationConsumedEvent | undefined;
      if (!value || typeof value.confirmationId !== "string" || typeof value.consumedAt !== "string") {
        throw new DurableConfirmationError("Protected confirmation consumption record is malformed.");
      }
      const existing = output.get(value.confirmationId);
      if (!existing) throw new DurableConfirmationError("Protected confirmation consumption references an unknown confirmation.");
      output.set(existing.id, { ...existing, consumedAt: timestamp(value.consumedAt, "confirmation consumption timestamp") });
    }
  }
  return output;
}

function matches(record: DurableConfirmationRecord, request: Omit<ConfirmationConsumeRequest, "token">): boolean {
  return record.action === request.action
    && record.targetSnapshotId === request.targetSnapshotId
    && record.sessionId === request.sessionId
    && record.authorityId === request.authorityId
    && record.scopeDigest === request.scopeDigest;
}

export class DurableConfirmationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "DurableConfirmationError";
  }
}

/**
 * Protected, exact-scope confirmation and reauthentication evidence. Its
 * consume path runs in one journal transaction, so a token cannot be raced or
 * replayed across a restart. It has no UI and never treats client input as a
 * reauthentication assertion.
 */
export class DurableConfirmationLedger {
  private readonly store: Pick<ProtectedJsonStore, "transaction" | "readEntries">;
  private readonly clock: () => string;
  private readonly tokenFactory: () => string;
  private readonly idFactory: () => string;
  private readonly ttlMs: number;

  constructor(store: Pick<ProtectedJsonStore, "transaction" | "readEntries">, options: {
    readonly clock?: () => string;
    readonly tokenFactory?: () => string;
    readonly idFactory?: () => string;
    readonly ttlMs?: number;
  } = {}) {
    this.store = store;
    this.clock = options.clock ?? (() => new Date().toISOString());
    this.tokenFactory = options.tokenFactory ?? randomUUID;
    this.idFactory = options.idFactory ?? randomUUID;
    this.ttlMs = options.ttlMs ?? 5 * 60_000;
    if (!Number.isSafeInteger(this.ttlMs) || this.ttlMs <= 0) throw new DurableConfirmationError("confirmation ttl must be a positive safe integer.");
  }

  async issue(request: DurableConfirmationRequest): Promise<IssuedConfirmation> {
    const createdAt = timestamp(this.clock(), "confirmation creation timestamp");
    const token = text(this.tokenFactory(), "confirmation token");
    const record: DurableConfirmationRecord = {
      id: text(this.idFactory(), "confirmation id"),
      action: request.action,
      ...(optionalReference(request.targetSnapshotId, "target snapshot id") ? { targetSnapshotId: optionalReference(request.targetSnapshotId, "target snapshot id") } : {}),
      ...(optionalReference(request.sessionId, "session id") ? { sessionId: optionalReference(request.sessionId, "session id") } : {}),
      ...(optionalReference(request.authorityId, "authority id") ? { authorityId: optionalReference(request.authorityId, "authority id") } : {}),
      ...(optionalDigest(request.scopeDigest, "confirmation scope digest") ? { scopeDigest: optionalDigest(request.scopeDigest, "confirmation scope digest") } : {}),
      reason: text(request.reason, "confirmation reason"),
      reauthenticated: request.reauthenticated === true,
      tokenDigest: sha256(token),
      createdAt,
      expiresAt: new Date(Date.parse(createdAt) + this.ttlMs).toISOString()
    };
    await this.store.transaction(async (transaction) => {
      const existing = records(await transaction.readEntries());
      if (existing.has(record.id) || [...existing.values()].some((entry) => entry.tokenDigest === record.tokenDigest)) {
        throw new DurableConfirmationError("Confirmation identifier collision; no confirmation was issued.");
      }
      await transaction.append<ConfirmationIssuedEvent>("confirmation.issued", { confirmation: record });
    });
    const { tokenDigest: _tokenDigest, consumedAt: _consumedAt, ...visible } = record;
    return { record: visible, token };
  }

  async consume(request: ConfirmationConsumeRequest): Promise<ConfirmationDecision> {
    const token = text(request.token, "confirmation token");
    const now = timestamp(this.clock(), "confirmation consume timestamp");
    return this.store.transaction(async (transaction) => {
      const found = [...records(await transaction.readEntries()).values()].find((entry) => entry.tokenDigest === sha256(token));
      if (!found) return { allowed: false, reason: "Confirmation token is unknown or was not issued by the protected companion." };
      if (found.consumedAt) return { allowed: false, reason: "Confirmation token has already been consumed." , record: clone(found) };
      if (Date.parse(found.expiresAt) <= Date.parse(now)) return { allowed: false, reason: "Confirmation token has expired.", record: clone(found) };
      if (!matches(found, request)) return { allowed: false, reason: "Confirmation does not match the exact action, target, session, authority, and reviewed scope.", record: clone(found) };
      await transaction.append<ConfirmationConsumedEvent>("confirmation.consumed", { confirmationId: found.id, consumedAt: now });
      return { allowed: true, reason: "Protected confirmation was consumed for this exact action once.", record: { ...found, consumedAt: now } };
    });
  }

  async get(id: string): Promise<DurableConfirmationRecord | undefined> {
    const found = records(await this.store.readEntries()).get(text(id, "confirmation id"));
    return found ? clone(found) : undefined;
  }
}
