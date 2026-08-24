import { randomUUID } from "node:crypto";
import { resolve } from "node:path";
import { Readable } from "node:stream";

import type { ContainmentCheck } from "../../../packages/control-plane/src/containment.ts";
import { redactText } from "../../../packages/control-plane/src/redaction.ts";
import type { JournalEntry, ProtectedJsonStore } from "../../../packages/control-plane/src/store.ts";
import type { UserSecretProtector } from "./windows-secret.ts";

const provisionedKind = "credential.reference.provisioned";
const revokedKind = "credential.reference.revoked";
const maximumSecretBytes = 64 * 1024;
const defaultLeaseTtlMs = 15_000;
const maximumLeaseTtlMs = 60_000;

export interface CredentialContainmentFence {
  check(repositoryRoot: string, channel: "credential"): Promise<ContainmentCheck> | ContainmentCheck;
}

export interface CredentialScope {
  readonly repositoryRoot: string;
  readonly adapterId: string;
  readonly purpose: string;
}

export interface ProvisionCredentialReference {
  readonly reference: string;
  readonly scopes: readonly CredentialScope[];
  /** Rotation is explicit; ordinary provisioning never overwrites a live reference. */
  readonly replaceExisting?: boolean;
}

export interface CredentialReferenceSummary {
  readonly reference: string;
  readonly protectorProvider: string;
  readonly generation: number;
  readonly createdAt: string;
  readonly updatedAt: string;
  readonly scopes: readonly CredentialScope[];
  readonly revokedAt?: string;
  readonly revocationReason?: string;
}

export interface CredentialSecretReader {
  /** The returned bytes become vault-owned and are zeroed after sealing. */
  readSecret(maximumBytes: number): Promise<Uint8Array>;
}

export interface CredentialLeaseRequest {
  readonly reference: string;
  readonly repositoryRoot: string;
  readonly purpose: string;
  readonly ttlMs?: number;
}

/** Opaque by construction: a lease never carries its reference, scope, or value. */
export interface CredentialLease {
  readonly id: string;
  readonly expiresAt: number;
}

export interface CredentialAdapterPort {
  acquireLease(request: CredentialLeaseRequest): Promise<CredentialLease>;
  redeem<T>(lease: CredentialLease, consume: (cleartext: Uint8Array) => Promise<T>): Promise<T>;
  withCredential<T>(request: CredentialLeaseRequest, consume: (cleartext: Uint8Array) => Promise<T>): Promise<T>;
}

interface PersistedCredentialReference extends CredentialReferenceSummary {
  readonly sealedValue: string;
}

interface ProvisionedEvent {
  readonly record: PersistedCredentialReference;
}

interface RevokedEvent {
  readonly reference: string;
  readonly generation: number;
  readonly revokedAt: string;
  readonly reason: string;
}

interface ActiveLease {
  readonly id: string;
  readonly adapterId: string;
  readonly reference: string;
  readonly repositoryRoot: string;
  readonly purpose: string;
  readonly generation: number;
  readonly expiresAt: number;
}

export interface DurableCredentialVaultOptions {
  readonly now?: () => number;
  readonly idFactory?: () => string;
  readonly maximumLeaseTtlMs?: number;
}

export class CredentialReferenceIntegrityError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "CredentialReferenceIntegrityError";
  }
}

/**
 * Durable credential references backed by the companion's protected journal.
 * Journal events contain DPAPI/host-protected envelopes only. Clear values
 * exist solely inside an adapter redemption callback and are zeroed afterward.
 */
export class DurableCredentialReferenceVault {
  private readonly store: ProtectedJsonStore;
  private readonly protector: UserSecretProtector;
  private readonly containment: CredentialContainmentFence;
  private readonly now: () => number;
  private readonly idFactory: () => string;
  private readonly maximumLeaseTtlMs: number;
  private readonly leases = new Map<string, ActiveLease>();

  constructor(store: ProtectedJsonStore, protector: UserSecretProtector, containment: CredentialContainmentFence, options: DurableCredentialVaultOptions = {}) {
    this.store = store;
    this.protector = protector;
    this.containment = containment;
    this.now = options.now ?? Date.now;
    this.idFactory = options.idFactory ?? randomUUID;
    this.maximumLeaseTtlMs = boundedPositive(options.maximumLeaseTtlMs ?? maximumLeaseTtlMs, "maximum lease TTL", maximumLeaseTtlMs);
  }

  async provision(request: ProvisionCredentialReference, cleartext: Uint8Array): Promise<CredentialReferenceSummary> {
    const reference = validatedIdentifier(request.reference, "credential reference");
    const scopes = validatedScopes(request.scopes);
    if (cleartext.byteLength === 0 || cleartext.byteLength > maximumSecretBytes) {
      throw new Error(`Credential values must contain 1-${maximumSecretBytes} bytes.`);
    }
    const ephemeral = new Uint8Array(cleartext);
    let sealedValue: string;
    try {
      sealedValue = await this.protector.seal(ephemeral);
    } finally {
      ephemeral.fill(0);
    }
    if (!sealedValue.trim() || sealedValue.length > maximumSecretBytes * 4) {
      throw new Error("The current-user secret protector returned an invalid envelope.");
    }

    return this.store.transaction(async (transaction) => {
      const current = replayReferences(await transaction.readEntries());
      const existing = current.get(reference);
      if (existing && !existing.revokedAt && !request.replaceExisting) {
        throw new Error("A live credential reference already exists; rotation must be explicit.");
      }
      const at = new Date(this.now()).toISOString();
      const record: PersistedCredentialReference = {
        reference,
        protectorProvider: this.protector.provider,
        generation: (existing?.generation ?? 0) + 1,
        createdAt: existing?.createdAt ?? at,
        updatedAt: at,
        scopes,
        sealedValue
      };
      await transaction.append<ProvisionedEvent>(provisionedKind, { record });
      this.revokeLeasesForReference(reference);
      return publicSummary(record);
    });
  }

  async provisionFromReader(request: ProvisionCredentialReference, reader: CredentialSecretReader): Promise<CredentialReferenceSummary> {
    const cleartext = await reader.readSecret(maximumSecretBytes);
    try {
      return await this.provision(request, cleartext);
    } finally {
      cleartext.fill(0);
    }
  }

  async listReferences(): Promise<readonly CredentialReferenceSummary[]> {
    const records = replayReferences(await this.store.readEntries());
    return [...records.values()].sort((left, right) => left.reference.localeCompare(right.reference)).map(publicSummary);
  }

  async revoke(referenceInput: string, reasonInput: string): Promise<boolean> {
    const reference = validatedIdentifier(referenceInput, "credential reference");
    const reason = safeReason(reasonInput);
    const revoked = await this.store.transaction(async (transaction) => {
      const current = replayReferences(await transaction.readEntries());
      const record = current.get(reference);
      if (!record || record.revokedAt) return false;
      await transaction.append<RevokedEvent>(revokedKind, {
        reference,
        generation: record.generation,
        revokedAt: new Date(this.now()).toISOString(),
        reason
      });
      return true;
    });
    if (revoked) this.revokeLeasesForReference(reference);
    return revoked;
  }

  /** Containment hooks call this after the durable fence is active. */
  async revokeRepositoryLeases(repositoryRoot: string): Promise<void> {
    const root = canonicalRoot(repositoryRoot);
    for (const [id, lease] of this.leases) if (lease.repositoryRoot === root) this.leases.delete(id);
  }

  /**
   * Mint a capability for one named adapter. The vault deliberately exposes no
   * public redemption method, so generic dispatch/receipt code cannot open a
   * credential value or accidentally serialize it.
   */
  createAdapter(adapterIdInput: string): CredentialAdapterPort {
    const adapterId = validatedIdentifier(adapterIdInput, "credential adapter id");
    return Object.freeze({
      acquireLease: (request: CredentialLeaseRequest) => this.acquireLease(adapterId, request),
      redeem: <T>(lease: CredentialLease, consume: (cleartext: Uint8Array) => Promise<T>) => this.redeem(adapterId, lease, consume),
      withCredential: async <T>(request: CredentialLeaseRequest, consume: (cleartext: Uint8Array) => Promise<T>) => {
        const lease = await this.acquireLease(adapterId, request);
        return this.redeem(adapterId, lease, consume);
      }
    });
  }

  private async acquireLease(adapterId: string, request: CredentialLeaseRequest): Promise<CredentialLease> {
    this.reapExpiredLeases();
    const repositoryRoot = canonicalRoot(request.repositoryRoot);
    await requireUncontained(this.containment, repositoryRoot);
    const reference = validatedIdentifier(request.reference, "credential reference");
    const purpose = validatedIdentifier(request.purpose, "credential purpose");
    const records = replayReferences(await this.store.readEntries());
    const record = records.get(reference);
    if (!record || record.revokedAt) throw new Error("Credential reference is revoked or unavailable.");
    if (!record.scopes.some((scope) => scope.repositoryRoot === repositoryRoot && scope.adapterId === adapterId && scope.purpose === purpose)) {
      throw new Error("Credential reference scope does not authorize this repository, adapter, and purpose.");
    }
    const ttlMs = boundedPositive(request.ttlMs ?? defaultLeaseTtlMs, "credential lease TTL", this.maximumLeaseTtlMs);
    const lease: ActiveLease = {
      id: validatedIdentifier(this.idFactory(), "credential lease id"),
      adapterId,
      reference,
      repositoryRoot,
      purpose,
      generation: record.generation,
      expiresAt: this.now() + ttlMs
    };
    this.leases.set(lease.id, lease);
    return Object.freeze({ id: lease.id, expiresAt: lease.expiresAt });
  }

  private async redeem<T>(adapterId: string, supplied: CredentialLease, consume: (cleartext: Uint8Array) => Promise<T>): Promise<T> {
    const active = this.leases.get(supplied.id);
    if (active && active.adapterId !== adapterId) throw new Error("The credential lease belongs to a different adapter capability.");
    if (!active || supplied.expiresAt !== active.expiresAt || active.expiresAt <= this.now()) {
      if (active) this.leases.delete(active.id);
      throw new Error("Credential lease is already used, expired, or revoked.");
    }
    // Consume before the first await so concurrent redemption cannot replay.
    this.leases.delete(active.id);
    await requireUncontained(this.containment, active.repositoryRoot);
    const record = replayReferences(await this.store.readEntries()).get(active.reference);
    if (!record || record.revokedAt || record.generation !== active.generation || record.protectorProvider !== this.protector.provider) {
      throw new Error("Credential lease is already used, expired, or revoked.");
    }
    let cleartext: Uint8Array | undefined;
    try {
      cleartext = new Uint8Array(await this.protector.open(record.sealedValue));
      if (cleartext.byteLength === 0 || cleartext.byteLength > maximumSecretBytes) throw new Error("The protected credential value is invalid.");
      return await consume(cleartext);
    } finally {
      cleartext?.fill(0);
    }
  }

  private revokeLeasesForReference(reference: string): void {
    for (const [id, lease] of this.leases) if (lease.reference === reference) this.leases.delete(id);
  }

  private reapExpiredLeases(): void {
    const now = this.now();
    for (const [id, lease] of this.leases) if (lease.expiresAt <= now) this.leases.delete(id);
  }
}

/**
 * CLI-safe secret reader. Production provisioning must pipe or otherwise
 * inject bytes on stdin; command-line secret arguments are not part of this
 * API and interactive echoed input is rejected.
 */
export class StdinCredentialSecretReader implements CredentialSecretReader {
  private readonly input: Readable;

  constructor(input: Readable = process.stdin) {
    this.input = input;
  }

  async readSecret(maximumBytes = maximumSecretBytes): Promise<Uint8Array> {
    const terminal = this.input as Readable & { readonly isTTY?: boolean };
    if (terminal.isTTY) throw new Error("Credential provisioning requires piped or host-injected stdin; echoed terminal input is refused.");
    const chunks: Buffer[] = [];
    let length = 0;
    try {
      for await (const chunk of this.input) {
        const bytes = Buffer.isBuffer(chunk) ? chunk : Buffer.from(String(chunk), "utf8");
        length += bytes.length;
        if (length > maximumBytes + 2) throw new Error(`Credential input exceeds ${maximumBytes} bytes.`);
        chunks.push(Buffer.from(bytes));
      }
    } catch (error) {
      for (const chunk of chunks) chunk.fill(0);
      throw error;
    }
    const combined = Buffer.concat(chunks);
    for (const chunk of chunks) chunk.fill(0);
    const end = combined.length >= 2 && combined.at(-2) === 13 && combined.at(-1) === 10
      ? combined.length - 2
      : combined.at(-1) === 10 ? combined.length - 1 : combined.length;
    if (end === 0 || end > maximumBytes) {
      combined.fill(0);
      throw new Error(`Credential input must contain 1-${maximumBytes} bytes.`);
    }
    const result = new Uint8Array(combined.subarray(0, end));
    combined.fill(0);
    return result;
  }
}

function replayReferences(entries: readonly JournalEntry<unknown>[]): Map<string, PersistedCredentialReference> {
  const records = new Map<string, PersistedCredentialReference>();
  for (const entry of entries) {
    if (entry.kind === provisionedKind) {
      const record = (entry.payload as Partial<ProvisionedEvent> | undefined)?.record;
      if (!isPersistedRecord(record)) throw new CredentialReferenceIntegrityError("A durable credential provision event is malformed.");
      records.set(record.reference, cloneRecord(record));
    } else if (entry.kind === revokedKind) {
      const event = entry.payload as Partial<RevokedEvent> | undefined;
      if (!event || typeof event.reference !== "string" || !Number.isInteger(event.generation) || typeof event.revokedAt !== "string" || typeof event.reason !== "string") {
        throw new CredentialReferenceIntegrityError("A durable credential revocation event is malformed.");
      }
      const current = records.get(event.reference);
      if (!current || current.generation !== event.generation) throw new CredentialReferenceIntegrityError("A credential revocation event does not match a provisioned generation.");
      records.set(event.reference, { ...current, revokedAt: event.revokedAt, revocationReason: event.reason });
    }
  }
  return records;
}

function isPersistedRecord(value: unknown): value is PersistedCredentialReference {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const record = value as Partial<PersistedCredentialReference>;
  return typeof record.reference === "string"
    && typeof record.protectorProvider === "string"
    && Number.isInteger(record.generation)
    && typeof record.createdAt === "string"
    && typeof record.updatedAt === "string"
    && typeof record.sealedValue === "string"
    && Array.isArray(record.scopes)
    && record.scopes.every((scope) => isScope(scope));
}

function isScope(value: unknown): value is CredentialScope {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const scope = value as Partial<CredentialScope>;
  return typeof scope.repositoryRoot === "string" && typeof scope.adapterId === "string" && typeof scope.purpose === "string";
}

function cloneRecord(record: PersistedCredentialReference): PersistedCredentialReference {
  return { ...record, scopes: record.scopes.map((scope) => ({ ...scope })) };
}

function publicSummary(record: PersistedCredentialReference): CredentialReferenceSummary {
  const { sealedValue: _sealedValue, ...summary } = cloneRecord(record);
  return summary;
}

function validatedScopes(scopes: readonly CredentialScope[]): readonly CredentialScope[] {
  if (scopes.length === 0 || scopes.length > 64) throw new Error("A credential reference requires 1-64 explicit scopes.");
  const normalized = scopes.map((scope) => ({
    repositoryRoot: canonicalRoot(scope.repositoryRoot),
    adapterId: validatedIdentifier(scope.adapterId, "credential adapter id"),
    purpose: validatedIdentifier(scope.purpose, "credential purpose")
  }));
  const unique = new Map(normalized.map((scope) => [`${scope.repositoryRoot}\0${scope.adapterId}\0${scope.purpose}`, scope]));
  if (unique.size !== normalized.length) throw new Error("Credential scopes must be unique.");
  return [...unique.values()];
}

function validatedIdentifier(value: string, label: string): string {
  const normalized = value.trim();
  if (!/^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/.test(normalized)) throw new Error(`${label} is invalid.`);
  return normalized;
}

function canonicalRoot(repositoryRoot: string): string {
  const normalized = resolve(repositoryRoot).replaceAll("\\", "/").replace(/\/+$/, "");
  return process.platform === "win32" ? normalized.toLowerCase() : normalized;
}

function boundedPositive(value: number, label: string, maximum: number): number {
  if (!Number.isSafeInteger(value) || value < 1 || value > maximum) throw new Error(`${label} must be 1-${maximum} milliseconds.`);
  return value;
}

function safeReason(value: string): string {
  const normalized = redactText(value).replace(/[\r\n\t]+/g, " ").trim();
  if (!normalized || normalized.length > 256) throw new Error("Credential revocation requires a bounded reason.");
  return normalized;
}

async function requireUncontained(containment: CredentialContainmentFence, repositoryRoot: string): Promise<void> {
  const check = await containment.check(repositoryRoot, "credential");
  if (!check.allowed) throw new Error(`Credential containment check blocked this operation: ${check.reason}`);
}
