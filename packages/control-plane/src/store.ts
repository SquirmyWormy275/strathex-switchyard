import { createHash, randomUUID } from "node:crypto";
import { chmod, mkdir, open, readFile, stat, unlink } from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, join, resolve } from "node:path";

/** A JSON-compatible value. The protected journal intentionally rejects richer runtime objects. */
export type JsonValue = null | boolean | number | string | readonly JsonValue[] | { readonly [key: string]: JsonValue };

export interface JournalEntry<T = JsonValue> {
  readonly schemaVersion: 1;
  readonly sequence: number;
  readonly id: string;
  readonly kind: string;
  readonly at: string;
  readonly payload: T;
  readonly previousHash?: string;
  readonly hash: string;
  /** Opaque host-backed authenticator tag over `hash`; never part of the chain hash itself. */
  readonly authenticationTag?: string;
}

/**
 * A host supplies this from a non-agent-accessible key boundary (for example
 * Windows DPAPI/NCrypt or a service-held signing key). The control plane never
 * implements or persists the secret itself.
 */
export interface JournalAuthenticator {
  readonly provider: string;
  seal(hash: string): Promise<string>;
  verify(hash: string, authenticationTag: string): Promise<boolean>;
}

export interface ProtectedJsonStoreOptions {
  /**
   * Explicit paths are mainly for a host-owned service location or isolated
   * tests. The default deliberately lives outside the working repository.
   */
  readonly filePath?: string;
  readonly clock?: () => string;
  readonly idFactory?: () => string;
  readonly lockTimeoutMs?: number;
  readonly staleLockAgeMs?: number;
  readonly authenticator?: JournalAuthenticator;
  /** Production companion startup sets this: a hash chain alone is not a protected authority boundary. */
  readonly requireAuthenticatedProtection?: boolean;
}

export interface JsonStoreTransaction {
  readEntries<T = JsonValue>(): Promise<readonly JournalEntry<T>[]>;
  append<T = JsonValue>(kind: string, payload: T): Promise<JournalEntry<T>>;
}

export class StoreIntegrityError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "StoreIntegrityError";
  }
}

export class StoreBusyError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "StoreBusyError";
  }
}

/**
 * Resolve a host-owned data path without deriving it from the repository cwd.
 * Callers that need another location must inject it explicitly.
 */
export function defaultControlPlaneStorePath(environment: Readonly<Record<string, string | undefined>> = process.env): string {
  const base = environment.LOCALAPPDATA
    ?? environment.APPDATA
    ?? environment.XDG_STATE_HOME
    ?? (environment.HOME ? join(environment.HOME, ".local", "state") : join(homedir(), ".local", "state"));
  return join(base, "STRATHEX", "switchyard", "protected-audit.jsonl");
}

/** Stable JSON makes a record's digest independent of caller object-key order. */
export function stableJson(value: unknown): string {
  if (value === null) return "null";
  switch (typeof value) {
    case "boolean":
      return value ? "true" : "false";
    case "number":
      if (!Number.isFinite(value)) throw new StoreIntegrityError("Journal values must be finite JSON numbers.");
      return JSON.stringify(value);
    case "string":
      return JSON.stringify(value);
    case "undefined":
    case "bigint":
    case "function":
    case "symbol":
      throw new StoreIntegrityError("Journal values must be JSON-serializable and cannot contain undefined, bigint, functions, or symbols.");
    case "object":
      if (Array.isArray(value)) return `[${value.map((item) => stableJson(item)).join(",")}]`;
      if (Object.getPrototypeOf(value) !== Object.prototype && Object.getPrototypeOf(value) !== null) {
        throw new StoreIntegrityError("Journal values must be plain JSON objects.");
      }
      return `{${Object.keys(value as Record<string, unknown>).sort().map((key) => `${JSON.stringify(key)}:${stableJson((value as Record<string, unknown>)[key])}`).join(",")}}`;
    default:
      throw new StoreIntegrityError("Unsupported journal value.");
  }
}

export function sha256(value: string): string {
  return createHash("sha256").update(value, "utf8").digest("hex");
}

export function jsonClone<T>(value: T): T {
  return JSON.parse(stableJson(value)) as T;
}

type UnsignedJournalEntry<T> = Omit<JournalEntry<T>, "hash" | "authenticationTag">;

function entryMaterial(entry: UnsignedJournalEntry<unknown>): Record<string, unknown> {
  return {
    schemaVersion: entry.schemaVersion,
    sequence: entry.sequence,
    id: entry.id,
    kind: entry.kind,
    at: entry.at,
    payload: entry.payload,
    previousHash: entry.previousHash ?? null
  };
}

export function journalEntryHash(entry: UnsignedJournalEntry<unknown>): string {
  return sha256(stableJson(entryMaterial(entry)));
}

function isNodeError(error: unknown, code: string): boolean {
  return typeof error === "object" && error !== null && "code" in error && (error as { code?: unknown }).code === code;
}

function delay(milliseconds: number): Promise<void> {
  return new Promise((resolveDelay) => setTimeout(resolveDelay, milliseconds));
}

/**
 * A small, host-owned, append-only JSONL journal. Integrity is hash chained;
 * failure to read or validate it is deliberately terminal rather than a cue to
 * silently start a new history. A production companion requires a host-backed
 * authenticator because a hash chain alone cannot prevent same-user rewrites.
 */
export class ProtectedJsonStore {
  readonly filePath: string;
  private readonly lockPath: string;
  private readonly clock: () => string;
  private readonly idFactory: () => string;
  private readonly lockTimeoutMs: number;
  private readonly staleLockAgeMs: number;
  private readonly authenticator?: JournalAuthenticator;
  private readonly requireAuthenticatedProtection: boolean;
  private serialTail: Promise<void> = Promise.resolve();

  constructor(options: ProtectedJsonStoreOptions = {}) {
    this.filePath = resolve(options.filePath ?? defaultControlPlaneStorePath());
    this.lockPath = `${this.filePath}.lock`;
    this.clock = options.clock ?? (() => new Date().toISOString());
    this.idFactory = options.idFactory ?? randomUUID;
    this.lockTimeoutMs = options.lockTimeoutMs ?? 5_000;
    this.staleLockAgeMs = options.staleLockAgeMs ?? 120_000;
    this.authenticator = options.authenticator;
    this.requireAuthenticatedProtection = options.requireAuthenticatedProtection ?? false;
    if (this.requireAuthenticatedProtection && !this.authenticator) {
      throw new StoreIntegrityError("The B122 protected store requires a host-backed journal authenticator; hash chaining alone is not accepted.");
    }
  }

  /** True only when journal records are authenticated by a host-owned key boundary. */
  get hasAuthenticatedProtection(): boolean { return !!this.authenticator; }

  async readEntries<T = JsonValue>(): Promise<readonly JournalEntry<T>[]> {
    return this.transaction(async (transaction) => transaction.readEntries<T>());
  }

  async append<T = JsonValue>(kind: string, payload: T): Promise<JournalEntry<T>> {
    return this.transaction(async (transaction) => transaction.append(kind, payload));
  }

  async verifyChain(): Promise<true> {
    await this.readEntries();
    return true;
  }

  /**
   * Serialize journal decisions both in-process and, with a short-lived lock
   * file, between companion processes. Operations use this for idempotency.
   */
  async transaction<T>(work: (transaction: JsonStoreTransaction) => Promise<T>): Promise<T> {
    return this.enqueue(async () => {
      await this.ensureParentDirectory();
      const lock = await this.acquireFileLock();
      try {
        let entries = await this.readEntriesUnlocked();
        const transaction: JsonStoreTransaction = {
          readEntries: async <R = JsonValue>() => jsonClone(entries) as readonly JournalEntry<R>[],
          append: async <R = JsonValue>(kind: string, payload: R) => {
            const entry = await this.appendUnlocked(kind, payload, entries);
            entries = [...entries, entry as JournalEntry<unknown>];
            return jsonClone(entry) as JournalEntry<R>;
          }
        };
        return await work(transaction);
      } finally {
        await this.releaseFileLock(lock);
      }
    });
  }

  private async enqueue<T>(work: () => Promise<T>): Promise<T> {
    const prior = this.serialTail;
    let release: (() => void) | undefined;
    this.serialTail = new Promise<void>((resolveTail) => {
      release = resolveTail;
    });
    await prior;
    try {
      return await work();
    } finally {
      release?.();
    }
  }

  private async ensureParentDirectory(): Promise<void> {
    const parent = dirname(this.filePath);
    await mkdir(parent, { recursive: true, mode: 0o700 });
    try {
      await chmod(parent, 0o700);
    } catch {
      // Windows ACLs are managed by the host; chmod is best-effort there.
    }
  }

  private async acquireFileLock() {
    const deadline = Date.now() + this.lockTimeoutMs;
    while (true) {
      try {
        return await open(this.lockPath, "wx", 0o600);
      } catch (error) {
        if (!isNodeError(error, "EEXIST")) throw error;
        try {
          const lockStat = await stat(this.lockPath);
          if (Date.now() - lockStat.mtimeMs > this.staleLockAgeMs) {
            await unlink(this.lockPath);
            continue;
          }
        } catch (lockError) {
          if (!isNodeError(lockError, "ENOENT")) throw lockError;
          continue;
        }
        if (Date.now() >= deadline) {
          throw new StoreBusyError(`The protected B122 store is busy: ${this.filePath}`);
        }
        await delay(20);
      }
    }
  }

  private async releaseFileLock(lock: Awaited<ReturnType<typeof open>>): Promise<void> {
    try {
      await lock.close();
    } finally {
      try {
        await unlink(this.lockPath);
      } catch (error) {
        if (!isNodeError(error, "ENOENT")) throw error;
      }
    }
  }

  private async readEntriesUnlocked(): Promise<JournalEntry<unknown>[]> {
    let raw: string;
    try {
      raw = await readFile(this.filePath, "utf8");
    } catch (error) {
      if (isNodeError(error, "ENOENT")) return [];
      throw error;
    }
    const lines = raw.split(/\r?\n/).filter((line) => line.trim().length > 0);
    const entries: JournalEntry<unknown>[] = [];
    let previousHash: string | undefined;
    for (let index = 0; index < lines.length; index += 1) {
      let candidate: unknown;
      try {
        candidate = JSON.parse(lines[index]!);
      } catch {
        throw new StoreIntegrityError(`Protected journal contains malformed JSON at line ${index + 1}.`);
      }
      const entry = await this.validateEntry(candidate, index + 1, previousHash);
      entries.push(entry);
      previousHash = entry.hash;
    }
    return entries;
  }

  private async validateEntry(candidate: unknown, expectedSequence: number, expectedPreviousHash: string | undefined): Promise<JournalEntry<unknown>> {
    if (typeof candidate !== "object" || candidate === null || Array.isArray(candidate)) {
      throw new StoreIntegrityError(`Protected journal entry ${expectedSequence} is not an object.`);
    }
    const record = candidate as Record<string, unknown>;
    const schemaVersion = record.schemaVersion;
    const sequence = record.sequence;
    const id = record.id;
    const kind = record.kind;
    const at = record.at;
    const hash = record.hash;
    const authenticationTag = record.authenticationTag;
    const previousHash = record.previousHash;
    if (schemaVersion !== 1 || typeof sequence !== "number" || sequence !== expectedSequence || typeof id !== "string" || typeof kind !== "string" || typeof at !== "string" || typeof hash !== "string") {
      throw new StoreIntegrityError(`Protected journal entry ${expectedSequence} has an invalid shape.`);
    }
    if (previousHash !== undefined && typeof previousHash !== "string") {
      throw new StoreIntegrityError(`Protected journal entry ${expectedSequence} has an invalid previous hash.`);
    }
    if ((previousHash as string | undefined) !== expectedPreviousHash) {
      throw new StoreIntegrityError(`Protected journal chain breaks at entry ${expectedSequence}.`);
    }
    const unverified: UnsignedJournalEntry<unknown> = {
      schemaVersion: 1,
      sequence,
      id,
      kind,
      at,
      payload: record.payload,
      ...(previousHash === undefined ? {} : { previousHash: previousHash as string })
    };
    const expectedHash = journalEntryHash(unverified);
    if (hash !== expectedHash) {
      throw new StoreIntegrityError(`Protected journal hash mismatch at entry ${expectedSequence}.`);
    }
    if (authenticationTag !== undefined && typeof authenticationTag !== "string") {
      throw new StoreIntegrityError(`Protected journal entry ${expectedSequence} has an invalid authenticator tag.`);
    }
    if (this.authenticator) {
      if (!authenticationTag) throw new StoreIntegrityError(`Protected journal entry ${expectedSequence} is missing the required host authenticator tag.`);
      let verified = false;
      try { verified = await this.authenticator.verify(hash, authenticationTag); } catch { verified = false; }
      if (!verified) throw new StoreIntegrityError(`Protected journal entry ${expectedSequence} failed host authenticator verification.`);
    } else if (this.requireAuthenticatedProtection) {
      throw new StoreIntegrityError("The B122 protected store requires a host-backed journal authenticator.");
    }
    return { ...unverified, hash, ...(authenticationTag ? { authenticationTag } : {}) };
  }

  private async appendUnlocked<T>(kind: string, payload: T, entries: readonly JournalEntry<unknown>[]): Promise<JournalEntry<T>> {
    if (!kind.trim()) throw new StoreIntegrityError("Protected journal entries need a non-empty kind.");
    const clonedPayload = jsonClone(payload);
    const previousHash = entries.at(-1)?.hash;
    const unverified: UnsignedJournalEntry<T> = {
      schemaVersion: 1,
      sequence: entries.length + 1,
      id: this.idFactory(),
      kind,
      at: this.clock(),
      payload: clonedPayload,
      ...(previousHash ? { previousHash } : {})
    };
    const hash = journalEntryHash(unverified as UnsignedJournalEntry<unknown>);
    let authenticationTag: string | undefined;
    if (this.authenticator) {
      try {
        authenticationTag = await this.authenticator.seal(hash);
      } catch {
        throw new StoreIntegrityError("The host-backed journal authenticator could not seal the new protected record.");
      }
      if (!authenticationTag?.trim()) throw new StoreIntegrityError("The host-backed journal authenticator returned an empty record tag.");
    } else if (this.requireAuthenticatedProtection) {
      throw new StoreIntegrityError("The B122 protected store requires a host-backed journal authenticator.");
    }
    const entry: JournalEntry<T> = { ...unverified, hash, ...(authenticationTag ? { authenticationTag } : {}) };
    const handle = await open(this.filePath, "a", 0o600);
    try {
      await handle.writeFile(`${stableJson(entry)}\n`, "utf8");
      await handle.sync();
    } finally {
      await handle.close();
    }
    try {
      await chmod(this.filePath, 0o600);
    } catch {
      // Best effort on platforms where POSIX file modes are not meaningful.
    }
    return entry;
  }
}
