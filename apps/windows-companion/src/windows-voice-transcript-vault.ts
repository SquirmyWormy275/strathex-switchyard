import { createCipheriv, createDecipheriv, createHash, randomBytes } from "node:crypto";
import { chmod, lstat, mkdir, readFile, readdir, realpath, rename, rmdir, unlink, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";

import { jsonClone, stableJson } from "../../../packages/control-plane/src/store.ts";
import type { VoiceTranscriptEntry, VoiceTranscriptStore } from "../../../packages/control-plane/src/voice.ts";
import type { UserSecretProtector } from "./windows-secret.ts";

const cipherSchema = "sxsy-b122.voice-transcript-cipher";
const keySchema = "sxsy-b122.voice-transcript-key";
const identifierPattern = /^[A-Za-z0-9:._-]{1,256}$/;
const digestPattern = /^[a-f0-9]{64}$/;
const maximumCiphertextBytes = 32 * 1024;

interface CipherEnvelope {
  readonly schema: typeof cipherSchema;
  readonly version: 1;
  readonly entryDigest: string;
  readonly bindingDigest: string;
  readonly recordedAt: string;
  readonly expiresAt: string;
  readonly iv: string;
  readonly authenticationTag: string;
  readonly ciphertext: string;
}

interface KeyEnvelope {
  readonly schema: typeof keySchema;
  readonly version: 1;
  readonly protector: string;
  readonly sealedKey: string;
}

/**
 * DPAPI-wrapped, per-entry AES-GCM transcript storage. The protected audit
 * journal contains no transcript text. Every entry has its own wrapping-key
 * file so expiry/deletion destroys that key before removing recoverable data.
 */
export class WindowsErasableVoiceTranscriptVault implements VoiceTranscriptStore {
  private readonly root: string;
  private readonly protector: UserSecretProtector;
  private serialTail: Promise<void> = Promise.resolve();
  private retentionTimer?: ReturnType<typeof setInterval>;
  private retentionFailure?: Error;
  private retentionSweepRunning = false;

  constructor(root: string, protector: UserSecretProtector) {
    this.root = resolve(root);
    this.protector = protector;
  }

  async append(input: VoiceTranscriptEntry): Promise<void> {
    if (this.retentionFailure) throw new Error("Transcript retention enforcement failed; new transcript persistence is disabled.", { cause: this.retentionFailure });
    const entry = validateEntry(input);
    await this.serial(async () => {
      const directory = await this.bindingDirectory(entry.bindingId, true);
      const token = digest(entry.id);
      const keyPath = join(directory, `${token}.key`);
      const cipherPath = join(directory, `${token}.cipher.json`);
      await assertMissing(keyPath);
      await assertMissing(cipherPath);

      const key = randomBytes(32);
      let sealedKey = "";
      try {
        sealedKey = await this.protector.seal(key);
        if (!sealedKey.trim() || sealedKey.length > 128 * 1024) throw new Error("The transcript key protector returned an invalid envelope.");
        const metadata: Omit<CipherEnvelope, "iv" | "authenticationTag" | "ciphertext"> = {
          schema: cipherSchema,
          version: 1 as const,
          entryDigest: token,
          bindingDigest: digest(entry.bindingId),
          recordedAt: entry.recordedAt,
          expiresAt: entry.expiresAt
        };
        const iv = randomBytes(12);
        const cipher = createCipheriv("aes-256-gcm", key, iv);
        cipher.setAAD(Buffer.from(stableJson(metadata), "utf8"));
        const plaintext = Buffer.from(stableJson(entry), "utf8");
        let ciphertext: Buffer;
        try { ciphertext = Buffer.concat([cipher.update(plaintext), cipher.final()]); }
        finally { plaintext.fill(0); }
        if (ciphertext.byteLength > maximumCiphertextBytes) throw new Error("The encrypted transcript entry is oversized.");
        const keyEnvelope: KeyEnvelope = { schema: keySchema, version: 1, protector: this.protector.provider, sealedKey };
        const cipherEnvelope: CipherEnvelope = {
          ...metadata,
          iv: iv.toString("base64"),
          authenticationTag: cipher.getAuthTag().toString("base64"),
          ciphertext: ciphertext.toString("base64")
        };
        await atomicCreate(keyPath, stableJson(keyEnvelope));
        try { await atomicCreate(cipherPath, stableJson(cipherEnvelope)); }
        catch (error) { await removeFile(keyPath); throw error; }
        ciphertext.fill(0);
      } finally {
        key.fill(0);
      }
    });
  }

  async list(bindingIdInput: string, nowInput: string): Promise<readonly VoiceTranscriptEntry[]> {
    const bindingId = identifier(bindingIdInput, "voice binding id");
    const now = timestamp(nowInput, "transcript clock");
    return this.serial(async () => {
      await this.purgeExpiredUnlocked(now);
      const directory = await this.bindingDirectory(bindingId, false);
      if (!directory) return [];
      const entries: VoiceTranscriptEntry[] = [];
      for (const name of (await readdir(directory)).filter((value) => value.endsWith(".cipher.json")).sort()) {
        const cipherPath = join(directory, name);
        const keyPath = join(directory, name.replace(/\.cipher\.json$/, ".key"));
        const envelope = await readCipher(cipherPath);
        if (envelope.bindingDigest !== digest(bindingId)) throw new Error("The encrypted transcript binding changed.");
        const keyEnvelope = await readKey(keyPath, this.protector.provider);
        const clearKey = await this.protector.open(keyEnvelope.sealedKey);
        try {
          if (clearKey.byteLength !== 32) throw new Error("The protected transcript key is invalid.");
          const metadata = {
            schema: envelope.schema,
            version: envelope.version,
            entryDigest: envelope.entryDigest,
            bindingDigest: envelope.bindingDigest,
            recordedAt: envelope.recordedAt,
            expiresAt: envelope.expiresAt
          };
          const decipher = createDecipheriv("aes-256-gcm", clearKey, decode(envelope.iv, 12, "transcript IV"));
          decipher.setAAD(Buffer.from(stableJson(metadata), "utf8"));
          decipher.setAuthTag(decode(envelope.authenticationTag, 16, "transcript authentication tag"));
          const plaintext = Buffer.concat([decipher.update(decode(envelope.ciphertext, maximumCiphertextBytes, "transcript ciphertext", false)), decipher.final()]);
          try {
            const entry = validateEntry(JSON.parse(plaintext.toString("utf8")) as unknown);
            if (digest(entry.id) !== envelope.entryDigest || entry.bindingId !== bindingId || entry.recordedAt !== envelope.recordedAt || entry.expiresAt !== envelope.expiresAt) {
              throw new Error("The decrypted transcript metadata changed.");
            }
            entries.push(entry);
          } finally { plaintext.fill(0); }
        } finally { clearKey.fill(0); }
      }
      return entries.sort((left, right) => left.recordedAt.localeCompare(right.recordedAt) || left.id.localeCompare(right.id)).map(jsonClone);
    });
  }

  async delete(bindingIdInput: string): Promise<void> {
    const bindingId = identifier(bindingIdInput, "voice binding id");
    await this.serial(async () => {
      const directory = await this.bindingDirectory(bindingId, false);
      if (!directory) return;
      const names = await readdir(directory);
      // Keys are destroyed first. A crash can leave ciphertext but cannot leave
      // an application-readable transcript after deletion was attempted.
      for (const name of names.filter((value) => value.endsWith(".key"))) await removeRegularChild(directory, name);
      for (const name of names.filter((value) => !value.endsWith(".key"))) await removeRegularChild(directory, name);
      await rmdir(directory);
    });
  }

  async purgeExpired(nowInput: string): Promise<void> {
    const now = timestamp(nowInput, "transcript purge clock");
    await this.serial(() => this.purgeExpiredUnlocked(now));
    this.retentionFailure = undefined;
  }

  /**
   * Runs an immediate startup purge, then an unref'ed bounded idle sweep. A
   * failure disables future appends and is surfaced to the installed runtime
   * through onFailure so voice can stop rather than retain beyond policy.
   */
  async startRetentionEnforcement(options: Readonly<{
    clock?: () => string;
    intervalMs?: number;
    onFailure?: (error: Error) => void;
  }> = {}): Promise<void> {
    if (this.retentionTimer) return;
    const clock = options.clock ?? (() => new Date().toISOString());
    const intervalMs = options.intervalMs ?? 30_000;
    if (!Number.isSafeInteger(intervalMs) || intervalMs < 10 || intervalMs > 60_000) throw new Error("Transcript retention sweep interval is outside its bounded range.");
    await this.purgeExpired(clock());
    this.retentionTimer = setInterval(() => {
      if (this.retentionSweepRunning) return;
      this.retentionSweepRunning = true;
      void this.purgeExpired(clock())
        .catch((error) => {
          const failure = error instanceof Error ? error : new Error("Transcript retention sweep failed.");
          this.retentionFailure = failure;
          options.onFailure?.(failure);
        })
        .finally(() => { this.retentionSweepRunning = false; });
    }, intervalMs);
    this.retentionTimer.unref?.();
  }

  stopRetentionEnforcement(): void {
    if (this.retentionTimer) clearInterval(this.retentionTimer);
    this.retentionTimer = undefined;
  }

  private async purgeExpiredUnlocked(now: string): Promise<void> {
    await this.safeRoot(true);
    const cutoff = Date.parse(now);
    for (const child of await readdir(this.root, { withFileTypes: true })) {
      if (!child.isDirectory() || !digestPattern.test(child.name)) continue;
      const directory = join(this.root, child.name);
      await assertSafeDirectory(directory, this.root);
      const names = await readdir(directory);
      const ciphers = new Set(names.filter((value) => value.endsWith(".cipher.json")));
      for (const name of ciphers) {
        const cipherPath = join(directory, name);
        const keyName = name.replace(/\.cipher\.json$/, ".key");
        let expired = false;
        try { expired = Date.parse((await readCipher(cipherPath)).expiresAt) <= cutoff; }
        catch { expired = true; }
        if (expired || !names.includes(keyName)) {
          await removeFile(join(directory, keyName));
          await removeFile(cipherPath);
        }
      }
      for (const name of names.filter((value) => value.endsWith(".key"))) {
        if (!ciphers.has(name.replace(/\.key$/, ".cipher.json"))) await removeFile(join(directory, name));
      }
      if ((await readdir(directory)).length === 0) await rmdir(directory);
    }
  }

  private async bindingDirectory(bindingId: string, create: true): Promise<string>;
  private async bindingDirectory(bindingId: string, create: false): Promise<string | undefined>;
  private async bindingDirectory(bindingId: string, create: boolean): Promise<string | undefined> {
    await this.safeRoot(create);
    const directory = join(this.root, digest(bindingId));
    try {
      const metadata = await lstat(directory);
      if (!metadata.isDirectory() || metadata.isSymbolicLink()) throw new Error("The transcript binding directory is not a trusted local directory.");
      await assertSafeDirectory(directory, this.root);
      return directory;
    } catch (error) {
      if (!missing(error) || !create) return undefined;
      await mkdir(directory, { recursive: false, mode: 0o700 });
      await chmod(directory, 0o700).catch(() => undefined);
      await assertSafeDirectory(directory, this.root);
      return directory;
    }
  }

  private async safeRoot(create: boolean): Promise<void> {
    try {
      const metadata = await lstat(this.root);
      if (!metadata.isDirectory() || metadata.isSymbolicLink()) throw new Error("The transcript vault root is not a trusted local directory.");
    } catch (error) {
      if (!missing(error)) throw error;
      if (!create) return;
      await mkdir(this.root, { recursive: true, mode: 0o700 });
      await chmod(this.root, 0o700).catch(() => undefined);
    }
  }

  private async serial<T>(work: () => Promise<T>): Promise<T> {
    const prior = this.serialTail;
    let release!: () => void;
    this.serialTail = new Promise<void>((resolveTail) => { release = resolveTail; });
    await prior;
    try { return await work(); }
    finally { release(); }
  }
}

async function atomicCreate(path: string, value: string): Promise<void> {
  const temporary = `${path}.${randomBytes(12).toString("hex")}.tmp`;
  try {
    await writeFile(temporary, value, { encoding: "utf8", flag: "wx", mode: 0o600, flush: true });
    await rename(temporary, path);
    await chmod(path, 0o600).catch(() => undefined);
  } finally { await removeFile(temporary); }
}

async function assertSafeDirectory(directory: string, root: string): Promise<void> {
  const [canonicalRoot, canonicalDirectory] = await Promise.all([realpath(root), realpath(directory)]);
  const prefix = resolve(canonicalRoot).toLowerCase().replace(/[\\/]+$/, "") + "\\";
  if (!resolve(canonicalDirectory).toLowerCase().startsWith(prefix)) throw new Error("The transcript binding directory escaped the vault root.");
}

async function assertMissing(path: string): Promise<void> {
  try { await lstat(path); throw new Error("A transcript entry identifier was already used."); }
  catch (error) { if (!missing(error)) throw error; }
}

async function readCipher(path: string): Promise<CipherEnvelope> {
  const metadata = await lstat(path);
  if (!metadata.isFile() || metadata.isSymbolicLink() || metadata.size < 1 || metadata.size > 128 * 1024) throw new Error("The encrypted transcript entry is not a bounded regular file.");
  const value = JSON.parse(await readFile(path, "utf8")) as Partial<CipherEnvelope>;
  if (value.schema !== cipherSchema || value.version !== 1 || !digestPattern.test(value.entryDigest ?? "") || !digestPattern.test(value.bindingDigest ?? "")
    || !validTime(value.recordedAt) || !validTime(value.expiresAt) || typeof value.iv !== "string" || typeof value.authenticationTag !== "string" || typeof value.ciphertext !== "string") {
    throw new Error("The encrypted transcript envelope is malformed.");
  }
  return value as CipherEnvelope;
}

async function readKey(path: string, provider: string): Promise<KeyEnvelope> {
  const metadata = await lstat(path);
  if (!metadata.isFile() || metadata.isSymbolicLink() || metadata.size < 1 || metadata.size > 128 * 1024) throw new Error("The protected transcript key is not a bounded regular file.");
  const value = JSON.parse(await readFile(path, "utf8")) as Partial<KeyEnvelope>;
  if (value.schema !== keySchema || value.version !== 1 || value.protector !== provider || typeof value.sealedKey !== "string" || !value.sealedKey.trim()) throw new Error("The protected transcript key envelope is malformed.");
  return value as KeyEnvelope;
}

async function removeRegularChild(directory: string, name: string): Promise<void> {
  if (!/^[a-f0-9]{64}\.(?:key|cipher\.json)$/.test(name)) throw new Error("The transcript directory contains an unexpected file; deletion stopped.");
  const path = join(directory, name);
  const metadata = await lstat(path);
  if (!metadata.isFile() || metadata.isSymbolicLink()) throw new Error("The transcript directory contains an unsafe filesystem entry; deletion stopped.");
  await unlink(path);
}

async function removeFile(path: string): Promise<void> {
  try { await unlink(path); }
  catch (error) { if (!missing(error)) throw error; }
}

function validateEntry(value: unknown): VoiceTranscriptEntry {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("The transcript entry is malformed.");
  const candidate = value as Partial<VoiceTranscriptEntry>;
  const id = identifier(candidate.id, "transcript id");
  const bindingId = identifier(candidate.bindingId, "voice binding id");
  if (typeof candidate.text !== "string" || !candidate.text.trim() || candidate.text.length > 4_096 || /[\r\n\0]/.test(candidate.text)) throw new Error("The transcript text is invalid or oversized.");
  const recordedAt = timestamp(candidate.recordedAt, "transcript timestamp");
  const expiresAt = timestamp(candidate.expiresAt, "transcript expiry");
  if (Date.parse(expiresAt) <= Date.parse(recordedAt) || Date.parse(expiresAt) - Date.parse(recordedAt) > 24 * 60 * 60_000) throw new Error("The transcript retention window is invalid.");
  return { id, bindingId, text: candidate.text, recordedAt, expiresAt };
}

function identifier(value: unknown, label: string): string {
  if (typeof value !== "string" || !identifierPattern.test(value)) throw new Error(`${label} is invalid.`);
  return value;
}

function timestamp(value: unknown, label: string): string {
  if (!validTime(value)) throw new Error(`${label} is invalid.`);
  return value;
}

function validTime(value: unknown): value is string { return typeof value === "string" && Number.isFinite(Date.parse(value)); }
function digest(value: string): string { return createHash("sha256").update(value, "utf8").digest("hex"); }
function missing(error: unknown): boolean { return typeof error === "object" && error !== null && "code" in error && (error as { code?: unknown }).code === "ENOENT"; }

function decode(value: string, expectedOrMaximum: number, label: string, exact = true): Buffer {
  if (!/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(value)) throw new Error(`${label} is malformed.`);
  const bytes = Buffer.from(value, "base64");
  if ((exact && bytes.byteLength !== expectedOrMaximum) || (!exact && (bytes.byteLength < 1 || bytes.byteLength > expectedOrMaximum))) throw new Error(`${label} is invalid or oversized.`);
  return bytes;
}
