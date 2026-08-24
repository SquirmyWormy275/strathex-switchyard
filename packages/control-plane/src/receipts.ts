import { randomUUID } from "node:crypto";
import type { AuditEvent, CommandStatus, ProtectedReceipt, ReceiptResult } from "./contracts.ts";
import { redactText, untrustedSummary } from "./redaction.ts";
import { jsonClone, type JournalEntry, ProtectedJsonStore } from "./store.ts";

export interface ReceiptIssue {
  readonly id?: string;
  readonly operationId: string;
  readonly action: string;
  readonly targetSnapshotId: string;
  readonly authorityId?: string;
  readonly result: ReceiptResult;
  readonly completeness: "complete" | "incomplete";
  readonly evidenceDigest: string;
  readonly policyVersion: string;
  readonly toolVersions: Readonly<Record<string, string>>;
  readonly expiresAt?: string;
}

export interface AuditInput {
  readonly id?: string;
  readonly at?: string;
  readonly action: string;
  readonly status: CommandStatus;
  readonly operationId?: string;
  readonly targetSnapshotId?: string;
  readonly detail: string;
}

export interface ChainedAuditEvent extends AuditEvent {
  readonly previousHash?: string;
  readonly hash: string;
  readonly sequence: number;
}

export interface ReceiptLedgerOptions {
  readonly clock?: () => string;
  readonly idFactory?: () => string;
}

interface ReceiptBody {
  readonly id: string;
  readonly operationId: string;
  readonly action: string;
  readonly targetSnapshotId: string;
  readonly authorityId?: string;
  readonly result: ReceiptResult;
  readonly completeness: "complete" | "incomplete";
  readonly evidenceDigest: string;
  readonly policyVersion: string;
  readonly toolVersions: Readonly<Record<string, string>>;
  readonly createdAt: string;
  readonly expiresAt?: string;
}

interface ReceiptIssuedEvent {
  readonly receipt: ReceiptBody;
}

interface ReceiptInvalidatedEvent {
  readonly receiptId: string;
  readonly invalidatedBy: string;
  readonly at: string;
}

interface AuditRecordedEvent {
  readonly audit: AuditEvent;
}

export class ReceiptLedgerError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ReceiptLedgerError";
  }
}

function nonEmpty(value: string, field: string): string {
  const trimmed = value.trim();
  if (!trimmed) throw new ReceiptLedgerError(`${field} must be non-empty.`);
  return trimmed;
}

function validTimestamp(value: string, field: string): string {
  if (!Number.isFinite(Date.parse(value))) throw new ReceiptLedgerError(`${field} must be a valid ISO timestamp.`);
  return value;
}

function receiptFromEntry(entry: JournalEntry<ReceiptIssuedEvent>, invalidatedBy?: string): ProtectedReceipt {
  const body = entry.payload.receipt;
  return {
    ...body,
    ...(invalidatedBy ? { invalidatedBy } : {}),
    ...(entry.previousHash ? { previousHash: entry.previousHash } : {}),
    hash: entry.hash
  };
}

function receiptEntries(entries: readonly JournalEntry<unknown>[]): Map<string, { entry: JournalEntry<ReceiptIssuedEvent>; invalidatedBy?: string }> {
  const receipts = new Map<string, { entry: JournalEntry<ReceiptIssuedEvent>; invalidatedBy?: string }>();
  for (const entry of entries) {
    if (entry.kind === "receipt.issued") {
      const issued = entry as JournalEntry<ReceiptIssuedEvent>;
      if (!issued.payload?.receipt?.id) throw new ReceiptLedgerError("Protected receipt record is malformed.");
      receipts.set(issued.payload.receipt.id, { entry: issued });
    }
    if (entry.kind === "receipt.invalidated") {
      const invalidated = entry as JournalEntry<ReceiptInvalidatedEvent>;
      const existing = receipts.get(invalidated.payload?.receiptId);
      if (existing) existing.invalidatedBy = invalidated.payload.invalidatedBy;
    }
  }
  return receipts;
}

/**
 * Writes gate-bearing receipts and sanitized audit records into the host-owned
 * journal. Receipts are reconstructed from the journal's immutable chain;
 * invalidation adds another record rather than rewriting a historical result.
 */
export class ReceiptLedger {
  private readonly store: ProtectedJsonStore;
  private readonly clock: () => string;
  private readonly idFactory: () => string;

  constructor(store: ProtectedJsonStore, options: ReceiptLedgerOptions = {}) {
    this.store = store;
    this.clock = options.clock ?? (() => new Date().toISOString());
    this.idFactory = options.idFactory ?? randomUUID;
  }

  async issue(input: ReceiptIssue): Promise<ProtectedReceipt> {
    const createdAt = this.clock();
    const receipt: ReceiptBody = {
      id: nonEmpty(input.id ?? this.idFactory(), "receipt id"),
      operationId: nonEmpty(input.operationId, "operationId"),
      action: nonEmpty(input.action, "action"),
      targetSnapshotId: nonEmpty(input.targetSnapshotId, "targetSnapshotId"),
      ...(input.authorityId ? { authorityId: nonEmpty(input.authorityId, "authorityId") } : {}),
      result: input.result,
      completeness: input.completeness,
      evidenceDigest: nonEmpty(input.evidenceDigest, "evidenceDigest"),
      policyVersion: nonEmpty(input.policyVersion, "policyVersion"),
      toolVersions: sanitizeToolVersions(input.toolVersions),
      createdAt,
      ...(input.expiresAt ? { expiresAt: validTimestamp(input.expiresAt, "expiresAt") } : {})
    };
    if (receipt.expiresAt && Date.parse(receipt.expiresAt) <= Date.parse(createdAt)) {
      throw new ReceiptLedgerError("Receipt expiry must be later than its creation time.");
    }
    return this.store.transaction(async (transaction) => {
      const existing = receiptEntries(await transaction.readEntries());
      if (existing.has(receipt.id)) throw new ReceiptLedgerError(`Receipt id already exists: ${receipt.id}`);
      const entry = await transaction.append<ReceiptIssuedEvent>("receipt.issued", { receipt });
      return receiptFromEntry(entry);
    });
  }

  async audit(input: AuditInput): Promise<ChainedAuditEvent> {
    const audit: AuditEvent = {
      id: nonEmpty(input.id ?? this.idFactory(), "audit id"),
      action: nonEmpty(input.action, "action"),
      status: input.status,
      ...(input.operationId ? { operationId: nonEmpty(input.operationId, "operationId") } : {}),
      ...(input.targetSnapshotId ? { targetSnapshotId: nonEmpty(input.targetSnapshotId, "targetSnapshotId") } : {}),
      at: validTimestamp(input.at ?? this.clock(), "audit timestamp"),
      detail: untrustedSummary(redactText(nonEmpty(input.detail, "detail")))
    };
    return this.store.transaction(async (transaction) => {
      const existing = (await transaction.readEntries<AuditRecordedEvent>())
        .find((entry) => entry.kind === "audit.recorded" && entry.payload?.audit?.id === audit.id);
      if (existing) return chainedAudit(existing);
      const entry = await transaction.append<AuditRecordedEvent>("audit.recorded", { audit });
      return chainedAudit(entry);
    });
  }

  async invalidate(receiptId: string, invalidatedBy: string): Promise<void> {
    const at = this.clock();
    await this.store.transaction(async (transaction) => {
      const receipts = receiptEntries(await transaction.readEntries());
      if (!receipts.has(receiptId)) throw new ReceiptLedgerError(`Unknown receipt: ${receiptId}`);
      await transaction.append<ReceiptInvalidatedEvent>("receipt.invalidated", {
        receiptId: nonEmpty(receiptId, "receiptId"),
        invalidatedBy: nonEmpty(invalidatedBy, "invalidatedBy"),
        at: validTimestamp(at, "invalidation timestamp")
      });
    });
  }

  async get(receiptId: string): Promise<ProtectedReceipt | undefined> {
    const receipts = receiptEntries(await this.store.readEntries());
    const found = receipts.get(receiptId);
    return found ? receiptFromEntry(found.entry, found.invalidatedBy) : undefined;
  }

  async list(): Promise<readonly ProtectedReceipt[]> {
    const receipts = receiptEntries(await this.store.readEntries());
    return [...receipts.values()].map(({ entry, invalidatedBy }) => receiptFromEntry(entry, invalidatedBy));
  }

  /** A stale, failed, incomplete, invalidated, or target-mismatched receipt never authorizes a gate. */
  async isFresh(receipt: ProtectedReceipt, targetSnapshotId: string, now = this.clock()): Promise<boolean> {
    if (receipt.result !== "passed" || receipt.completeness !== "complete") return false;
    if (receipt.invalidatedBy || receipt.targetSnapshotId !== targetSnapshotId) return false;
    if (receipt.expiresAt && Date.parse(receipt.expiresAt) <= Date.parse(now)) return false;
    return true;
  }

  async audits(): Promise<readonly ChainedAuditEvent[]> {
    const entries = await this.store.readEntries<AuditRecordedEvent>();
    return entries
      .filter((entry) => entry.kind === "audit.recorded")
      .map(chainedAudit);
  }

  async verify(): Promise<true> {
    await this.store.verifyChain();
    return true;
  }
}

function chainedAudit(entry: JournalEntry<AuditRecordedEvent>): ChainedAuditEvent {
  return {
    ...jsonClone(entry.payload.audit),
    ...(entry.previousHash ? { previousHash: entry.previousHash } : {}),
    hash: entry.hash,
    sequence: entry.sequence
  };
}

function sanitizeToolVersions(versions: Readonly<Record<string, string>>): Readonly<Record<string, string>> {
  const result: Record<string, string> = {};
  for (const [name, version] of Object.entries(versions)) {
    result[nonEmpty(name, "tool version name")] = redactText(nonEmpty(version, "tool version"));
  }
  return result;
}
