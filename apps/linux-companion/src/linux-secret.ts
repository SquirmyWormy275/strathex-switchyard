import { spawn } from "node:child_process";
import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";
import { realpath } from "node:fs/promises";
import { join } from "node:path";

import type { UserSecretProtector } from "../../windows-companion/src/windows-secret.ts";
import { acquireLinuxExclusiveLock, type LinuxExclusiveLock } from "./linux-exclusive-lock.ts";

const secretToolPath = "/usr/bin/secret-tool";
const application = "sxsy-b122";
const purpose = "current-user-master-key-v1";
const aad = Buffer.from("sxsy-b122/linux-libsecret-v1", "utf8");
const maximumCleartextBytes = 256 * 1024;
const maximumToolOutputBytes = 8 * 1024;

export interface LinuxSecretToolRequest {
  readonly operation: "lookup" | "store";
  readonly input: Uint8Array;
}

export interface LinuxSecretToolResult {
  readonly exitCode: number;
  readonly stdout: Buffer;
  readonly stderr: Buffer;
}

export type LinuxSecretToolRunner = (request: LinuxSecretToolRequest) => Promise<LinuxSecretToolResult>;
export type LinuxSecretCreationLock = () => Promise<LinuxExclusiveLock>;

/**
 * Current-user Linux secret protection. Secret Service stores only a random
 * 256-bit master key. Per-value AES-256-GCM envelopes may safely live in the
 * B122 state directory; no plaintext fallback or caller-selected key exists.
 */
export class LinuxLibsecretCurrentUserProtector implements UserSecretProtector {
  readonly provider = "linux-secret-service-current-user";
  private readonly runner: LinuxSecretToolRunner;
  private readonly creationLock: LinuxSecretCreationLock;
  private key?: Buffer;
  private pending?: Promise<Buffer>;
  private disposed = false;

  constructor(runner: LinuxSecretToolRunner = runLinuxSecretTool, creationLock: LinuxSecretCreationLock = defaultCreationLock) { this.runner = runner; this.creationLock = creationLock; }

  async seal(cleartext: Uint8Array): Promise<string> {
    if (this.disposed || cleartext.byteLength < 1 || cleartext.byteLength > maximumCleartextBytes) throw new Error("Linux Secret Service cannot seal this secret value.");
    const key = await this.masterKey();
    const nonce = randomBytes(12);
    const clear = Buffer.from(cleartext);
    let ciphertext: Buffer | undefined;
    let tag: Buffer | undefined;
    try {
      const cipher = createCipheriv("aes-256-gcm", key, nonce);
      cipher.setAAD(aad);
      ciphertext = Buffer.concat([cipher.update(clear), cipher.final()]);
      tag = cipher.getAuthTag();
      const envelope = Buffer.from(JSON.stringify({ v: 1, n: nonce.toString("base64"), c: ciphertext.toString("base64"), t: tag.toString("base64") }), "utf8");
      try { return `linux-libsecret-v1:${envelope.toString("base64url")}`; }
      finally { envelope.fill(0); }
    } finally { nonce.fill(0); clear.fill(0); ciphertext?.fill(0); tag?.fill(0); }
  }

  async open(sealed: string): Promise<Uint8Array> {
    if (this.disposed || !sealed.startsWith("linux-libsecret-v1:") || sealed.length > maximumCleartextBytes * 3) throw new Error("The Linux secret envelope is invalid.");
    const encoded = sealed.slice("linux-libsecret-v1:".length);
    if (!encoded || !/^[A-Za-z0-9_-]+$/.test(encoded)) throw new Error("The Linux secret envelope is invalid.");
    let document: Buffer | undefined;
    let nonce: Buffer | undefined;
    let ciphertext: Buffer | undefined;
    let tag: Buffer | undefined;
    try {
      document = Buffer.from(encoded, "base64url");
      if (document.toString("base64url") !== encoded) throw new Error("The Linux secret envelope is invalid.");
      const parsed: unknown = JSON.parse(document.toString("utf8"));
      if (!record(parsed) || !exact(parsed, ["v", "n", "c", "t"]) || parsed.v !== 1 || typeof parsed.n !== "string" || typeof parsed.c !== "string" || typeof parsed.t !== "string") throw new Error("The Linux secret envelope is invalid.");
      nonce = canonicalBase64(parsed.n, 12);
      tag = canonicalBase64(parsed.t, 16);
      ciphertext = canonicalBase64(parsed.c, maximumCleartextBytes + 16, true);
      const decipher = createDecipheriv("aes-256-gcm", await this.masterKey(), nonce);
      decipher.setAAD(aad);
      decipher.setAuthTag(tag);
      const opened = Buffer.concat([decipher.update(ciphertext), decipher.final()]);
      if (opened.length < 1 || opened.length > maximumCleartextBytes) { opened.fill(0); throw new Error("The Linux secret envelope is invalid."); }
      return opened;
    } catch {
      throw new Error("The Linux secret envelope is invalid or could not authenticate.");
    } finally { document?.fill(0); nonce?.fill(0); ciphertext?.fill(0); tag?.fill(0); }
  }

  async dispose(): Promise<void> {
    this.disposed = true;
    await this.pending?.catch(() => undefined);
    this.key?.fill(0);
    this.key = undefined;
  }

  private async masterKey(): Promise<Buffer> {
    if (this.disposed) throw new Error("The Linux Secret Service protector is disposed.");
    if (this.key) return this.key;
    if (!this.pending) this.pending = this.loadOrCreateMasterKey();
    try {
      const loaded = await this.pending;
      if (!this.key) this.key = loaded;
      return this.key;
    } finally { this.pending = undefined; }
  }

  private async loadOrCreateMasterKey(): Promise<Buffer> {
    const existing = await this.lookup();
    if (existing) return existing;
    const lock = await this.creationLock();
    try {
      const afterLock = await this.lookup();
      if (afterLock) return afterLock;
      const generated = randomBytes(32);
      const encoded = Buffer.from(`${generated.toString("base64")}\n`, "utf8");
      generated.fill(0);
      try {
        const stored = await this.runner({ operation: "store", input: encoded });
        try {
          if (stored.exitCode !== 0 || stored.stdout.length || stored.stderr.length) throw new Error("Linux Secret Service rejected master-key storage.");
        } finally { stored.stdout.fill(0); stored.stderr.fill(0); }
      } finally { encoded.fill(0); }
      const confirmed = await this.lookup();
      if (!confirmed) throw new Error("Linux Secret Service could not confirm the stored master key.");
      return confirmed;
    } finally { await lock.release(); }
  }

  private async lookup(): Promise<Buffer | undefined> {
    const result = await this.runner({ operation: "lookup", input: Buffer.alloc(0) });
    try {
      if (result.exitCode !== 0) {
        if (result.stdout.length || result.stderr.length) throw new Error("Linux Secret Service is unavailable or locked.");
        return undefined;
      }
      if (result.stderr.length || result.stdout.length < 2 || result.stdout.length > maximumToolOutputBytes) throw new Error("Linux Secret Service returned an invalid master key.");
      const text = result.stdout.toString("utf8").trimEnd();
      return canonicalBase64(text, 32);
    } finally { result.stdout.fill(0); result.stderr.fill(0); }
  }
}

async function defaultCreationLock(): Promise<LinuxExclusiveLock> {
  if (process.platform !== "linux") return { release: async () => undefined };
  const runtime = process.env.XDG_RUNTIME_DIR;
  if (!runtime) throw new Error("Linux Secret Service key provisioning requires XDG_RUNTIME_DIR.");
  return acquireLinuxExclusiveLock(join(runtime, "sxsy-b122-secret-key.lock"));
}

export async function runLinuxSecretTool(request: LinuxSecretToolRequest): Promise<LinuxSecretToolResult> {
  if (process.platform !== "linux") throw new Error("Linux Secret Service is unavailable on this platform.");
  if (await realpath(secretToolPath) !== secretToolPath) throw new Error("The fixed Linux secret-tool executable is unavailable or redirected.");
  const args = request.operation === "lookup"
    ? ["lookup", "application", application, "purpose", purpose]
    : ["store", "--label=SXSY-B122 current-user master key", "application", application, "purpose", purpose];
  return new Promise((resolve, reject) => {
    const child = spawn(secretToolPath, args, { shell: false, windowsHide: true, env: minimalLinuxEnvironment(), stdio: ["pipe", "pipe", "pipe"] });
    const stdout: Buffer[] = []; const stderr: Buffer[] = []; let bytes = 0; let overflow = false; let timer: NodeJS.Timeout | undefined;
    const collect = (target: Buffer[]) => (chunk: Buffer): void => { bytes += chunk.length; if (bytes > maximumToolOutputBytes) { overflow = true; child.kill("SIGKILL"); return; } target.push(Buffer.from(chunk)); };
    child.stdout.on("data", collect(stdout)); child.stderr.on("data", collect(stderr));
    child.once("error", reject);
    child.once("close", (code) => {
      if (timer) clearTimeout(timer);
      if (overflow) return reject(new Error("Linux Secret Service output exceeded its bound."));
      resolve({ exitCode: code ?? -1, stdout: Buffer.concat(stdout), stderr: Buffer.concat(stderr) });
    });
    timer = setTimeout(() => child.kill("SIGKILL"), 10_000);
    child.stdin.end(request.input);
  });
}

function minimalLinuxEnvironment(): NodeJS.ProcessEnv {
  const result: NodeJS.ProcessEnv = { PATH: "/usr/bin:/bin" };
  for (const name of ["DBUS_SESSION_BUS_ADDRESS", "XDG_RUNTIME_DIR", "HOME", "LANG", "LC_ALL"]) if (process.env[name]) result[name] = process.env[name];
  return result;
}

function canonicalBase64(value: string, maximum: number, allowEmpty = false): Buffer {
  if ((!allowEmpty && !value) || !/^[A-Za-z0-9+/]*={0,2}$/.test(value)) throw new Error("The Linux secret envelope is invalid.");
  const decoded = Buffer.from(value, "base64");
  if (decoded.length > maximum || decoded.toString("base64") !== value) { decoded.fill(0); throw new Error("The Linux secret envelope is invalid."); }
  if (!allowEmpty && decoded.length !== maximum) { decoded.fill(0); throw new Error("The Linux secret envelope is invalid."); }
  return decoded;
}

function record(value: unknown): value is Record<string, unknown> { return typeof value === "object" && value !== null && !Array.isArray(value); }
function exact(value: Record<string, unknown>, keys: readonly string[]): boolean { return Object.keys(value).length === keys.length && keys.every((key) => key in value); }
