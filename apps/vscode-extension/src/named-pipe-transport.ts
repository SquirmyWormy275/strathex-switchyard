import { spawn, spawnSync } from "node:child_process";
import type { ChildProcess, ChildProcessWithoutNullStreams } from "node:child_process";
import { createHash, createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import { realpathSync } from "node:fs";
import { lstat, open } from "node:fs/promises";
import { connect } from "node:net";
import { homedir } from "node:os";
import { basename, dirname, isAbsolute, join } from "node:path";

import type { JsonLineTransport } from "./companion-bridge.ts";

const maxFrameBytes = 64 * 1024;
const defaultTimeoutMs = 5_000;
const maximumSecretBytes = 64 * 1024;
const maximumEnvelopeBytes = maximumSecretBytes * 4;
const defaultDpapiTimeoutMs = 120_000;
const cleanupTimeoutMs = 5_000;
const maximumPipeConfigurationBytes = 64 * 1024;
const maximumSealedTokenCharacters = 16 * 1024;
const protectScript = "& { param([int]$length) Add-Type -AssemblyName System.Security;$raw=$null;$out=$null;try{if($length-lt1-or$length-gt262144){throw'input length'};$raw=New-Object byte[] $length;$stream=[Console]::OpenStandardInput();$offset=0;while($offset-lt$length){$read=$stream.Read($raw,$offset,$length-$offset);if($read-le0){throw'truncated input'};$offset+=$read};if($stream.ReadByte()-ne-1){throw'oversized input'};$out=[Security.Cryptography.ProtectedData]::Protect($raw,$null,[Security.Cryptography.DataProtectionScope]::CurrentUser);[Console]::OpenStandardOutput().Write($out,0,$out.Length)}finally{if($null-ne$raw){[Array]::Clear($raw,0,$raw.Length)};if($null-ne$out){[Array]::Clear($out,0,$out.Length)}} }";
const unprotectScript = "& { param([int]$length) Add-Type -AssemblyName System.Security;$raw=$null;$out=$null;try{if($length-lt1-or$length-gt262144){throw'input length'};$raw=New-Object byte[] $length;$stream=[Console]::OpenStandardInput();$offset=0;while($offset-lt$length){$read=$stream.Read($raw,$offset,$length-$offset);if($read-le0){throw'truncated input'};$offset+=$read};if($stream.ReadByte()-ne-1){throw'oversized input'};$out=[Security.Cryptography.ProtectedData]::Unprotect($raw,$null,[Security.Cryptography.DataProtectionScope]::CurrentUser);[Console]::OpenStandardOutput().Write($out,0,$out.Length)}finally{if($null-ne$raw){[Array]::Clear($raw,0,$raw.Length)};if($null-ne$out){[Array]::Clear($out,0,$out.Length)}} }";
const localAppDataScript = "[Console]::Out.Write([Environment]::GetFolderPath([Environment+SpecialFolder]::LocalApplicationData))";

export interface BoundedWindowsHostProcessRequest {
  readonly executable: string;
  readonly args: readonly string[];
  readonly input: Uint8Array;
  readonly timeoutMs: number;
  readonly maximumOutputBytes: number;
}

export interface BoundedWindowsHostProcessResult {
  readonly exitCode: number;
  readonly stdout: Buffer;
  readonly stderr: Buffer;
}

export type BoundedWindowsHostProcessRunner = (request: BoundedWindowsHostProcessRequest) => Promise<BoundedWindowsHostProcessResult>;

/** VS Code-local boundary for only the OS-anchored, fixed non-spawning DPAPI scripts. */
export async function runBoundedWindowsHostProcess(request: BoundedWindowsHostProcessRequest): Promise<BoundedWindowsHostProcessResult> {
  const environment = dpapiEnvironment();
  if (process.platform !== "win32" || !validDpapiInvocation(request) || !isAbsolute(request.executable) || /[\0\r\n]/.test(request.executable)
    || request.args.some((value) => /[\0\r\n]/.test(value))
    || !Number.isSafeInteger(request.timeoutMs) || request.timeoutMs < 100 || request.timeoutMs > 120_000
    || !Number.isSafeInteger(request.maximumOutputBytes) || request.maximumOutputBytes < 1 || request.maximumOutputBytes > 1024 * 1024
    || request.input.byteLength > maximumEnvelopeBytes) {
    throw new Error("The bounded Windows helper request is invalid.");
  }
  const child = spawn(request.executable, [...request.args], {
    shell: false,
    windowsHide: true,
    env: { ...environment },
    stdio: ["pipe", "pipe", "pipe"]
  });
  const stdout: Buffer[] = [];
  const stderr: Buffer[] = [];
  let retainedBytes = 0;
  let overflow = false;
  let signalOverflow!: () => void;
  const overflowSignal = new Promise<"overflow">((resolveOverflow) => { signalOverflow = () => resolveOverflow("overflow"); });
  const collect = (target: Buffer[]) => (chunk: Buffer): void => {
    const remaining = request.maximumOutputBytes - retainedBytes;
    if (remaining > 0) {
      const kept = Buffer.from(chunk.subarray(0, remaining));
      target.push(kept);
      retainedBytes += kept.byteLength;
    }
    if (chunk.byteLength > remaining && !overflow) { overflow = true; signalOverflow(); }
    chunk.fill(0);
  };
  child.stdout.on("data", collect(stdout));
  child.stderr.on("data", collect(stderr));
  let signalSpawnError!: (error: Error) => void;
  const spawnError = new Promise<Error>((resolveError) => { signalSpawnError = resolveError; });
  child.once("error", signalSpawnError);
  child.stdin.once("error", () => { /* close/error outcome remains authoritative */ });
  const close = new Promise<Readonly<{ kind: "close"; exitCode: number }>>((resolveClose) => {
    child.once("close", (code) => resolveClose({ kind: "close", exitCode: code ?? -1 }));
  });
  let timeoutHandle: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<"timeout">((resolveTimeout) => { timeoutHandle = setTimeout(() => resolveTimeout("timeout"), request.timeoutMs); });
  const stdinCopy = Buffer.from(request.input);
  try {
    child.stdin.end(stdinCopy);
    const outcome = await Promise.race([close, timeout, overflowSignal, spawnError]);
    if (outcome instanceof Error) {
      await terminateOwnedWindowsHostProcessTree(child).catch(() => undefined);
      throw new Error("The bounded Windows helper could not be started.");
    }
    if (outcome === "timeout" || outcome === "overflow") {
      const cleanup = await terminateOwnedWindowsHostProcessTree(child);
      const closed = await waitForHostClose(child, cleanupTimeoutMs);
      if (!cleanup || !closed) throw new Error("The bounded Windows helper process tree could not be proven stopped.");
      throw new Error(outcome === "timeout" ? "The bounded Windows helper timed out." : "The bounded Windows helper exceeded its output limit.");
    }
    return { exitCode: outcome.exitCode, stdout: combineAndClear(stdout), stderr: combineAndClear(stderr) };
  } finally {
    if (timeoutHandle !== undefined) clearTimeout(timeoutHandle);
    stdinCopy.fill(0);
    clearChunks(stdout);
    clearChunks(stderr);
  }
}

function validDpapiInvocation(request: BoundedWindowsHostProcessRequest): boolean {
  try {
    const expected = realpathSync.native(powershellExecutable()).toLowerCase();
    const actual = realpathSync.native(request.executable).toLowerCase();
    return actual === expected
      && request.args.length === 6
      && request.args[0] === "-NoLogo"
      && request.args[1] === "-NoProfile"
      && request.args[2] === "-NonInteractive"
      && request.args[3] === "-Command"
      && (request.args[4] === protectScript || request.args[4] === unprotectScript)
      && request.args[5] === String(request.input.byteLength);
  } catch { return false; }
}

function combineAndClear(chunks: Buffer[]): Buffer {
  const combined = Buffer.concat(chunks);
  clearChunks(chunks);
  return combined;
}

function clearChunks(chunks: Buffer[]): void {
  for (const chunk of chunks.splice(0)) chunk.fill(0);
}

async function terminateOwnedWindowsHostProcessTree(child: ChildProcessWithoutNullStreams): Promise<boolean> {
  if (!child.pid || child.exitCode !== null || child.signalCode !== null) return true;
  const systemDirectory = loadedWindowsSystemDirectory();
  const systemRoot = dirname(systemDirectory);
  const killer = spawn(join(systemDirectory, "taskkill.exe"), ["/PID", String(child.pid), "/T", "/F"], {
    shell: false,
    windowsHide: true,
    env: { SystemRoot: systemRoot, WINDIR: systemRoot },
    stdio: "ignore"
  });
  const killerClose = new Promise<number>((resolveClose) => {
    killer.once("error", () => resolveClose(-1));
    killer.once("close", (code) => resolveClose(code ?? -1));
  });
  let killerTimeoutHandle: ReturnType<typeof setTimeout> | undefined;
  const killerTimeout = new Promise<"timeout">((resolveTimeout) => { killerTimeoutHandle = setTimeout(() => resolveTimeout("timeout"), cleanupTimeoutMs); });
  const killerOutcome = await Promise.race([killerClose, killerTimeout]);
  if (killerTimeoutHandle !== undefined) clearTimeout(killerTimeoutHandle);
  if (killerOutcome === "timeout") {
    killer.kill("SIGKILL");
    await waitForHostClose(killer, cleanupTimeoutMs);
  }
  if (!await waitForHostClose(child, cleanupTimeoutMs)) {
    child.kill("SIGKILL");
    await waitForHostClose(child, cleanupTimeoutMs);
  }
  return killerOutcome === 0 && (child.exitCode !== null || child.signalCode !== null);
}

function waitForHostClose(child: ChildProcess, timeoutMs: number): Promise<boolean> {
  if (child.exitCode !== null || child.signalCode !== null) return Promise.resolve(true);
  return new Promise((resolveClose) => {
    const closed = (): void => { clearTimeout(timer); child.off("close", closed); resolveClose(true); };
    const timer = setTimeout(() => { child.off("close", closed); resolveClose(false); }, timeoutMs);
    child.once("close", closed);
  });
}

function loadedWindowsSystemDirectory(): string {
  if (process.platform !== "win32" || !process.report?.getReport) throw new Error("The Windows native system directory is unavailable.");
  const report = process.report.getReport() as { readonly sharedObjects?: unknown };
  const loaded: unknown[] = Array.isArray(report.sharedObjects) ? report.sharedObjects : [];
  const candidates = loaded.filter((path): path is string => typeof path === "string" && basename(path).toLowerCase() === "kernel32.dll");
  if (candidates.length !== 1 || !isAbsolute(candidates[0]!) || /[\0\r\n"]/u.test(candidates[0]!)) {
    throw new Error("The Windows native system directory could not be anchored to the loaded kernel module.");
  }
  const canonicalKernel = realpathSync.native(candidates[0]!);
  if (basename(canonicalKernel).toLowerCase() !== "kernel32.dll") throw new Error("The loaded Windows kernel module identity is invalid.");
  return dirname(canonicalKernel);
}

function dpapiEnvironment(): Readonly<Record<string, string>> {
  const systemRoot = dirname(loadedWindowsSystemDirectory());
  return { SystemRoot: systemRoot, WINDIR: systemRoot };
}

function powershellExecutable(): string {
  return join(loadedWindowsSystemDirectory(), "WindowsPowerShell", "v1.0", "powershell.exe");
}

function decodeCanonicalBase64(value: string, maximumBytes: number, label: string): Buffer {
  if (!value || value.length > maximumBytes * 2 || !/^[A-Za-z0-9+/]+={0,2}$/.test(value)) throw new Error(`${label} is malformed.`);
  const decoded = Buffer.from(value, "base64");
  if (decoded.byteLength > maximumBytes || decoded.toString("base64") !== value) { decoded.fill(0); throw new Error(`${label} is malformed.`); }
  return decoded;
}

/** Stored by a reviewed local installer/bootstrapper. It contains no clear token. */
export interface StoredCompanionPipeConfiguration {
  readonly version: 1;
  readonly pipePath: string;
  readonly sealedToken: string;
}

export interface ExtensionSecretReader {
  open(sealed: string): Promise<Uint8Array>;
  dispose?(): Promise<void> | void;
}

/** Uses DPAPI CurrentUser so the VS Code process can open only its own user's sealed pipe token. */
export class WindowsDpapiSecretReader implements ExtensionSecretReader {
  private readonly runner: BoundedWindowsHostProcessRunner;
  private cached?: Readonly<{ sealed: string; cleartext: Buffer }>;
  private pending?: Readonly<{ sealed: string; task: Promise<void> }>;
  private readonly activeOperations = new Set<Promise<unknown>>();
  private disposed = false;

  constructor(runner: BoundedWindowsHostProcessRunner = runBoundedWindowsHostProcess) {
    this.runner = runner;
  }

  async open(sealed: string): Promise<Uint8Array> {
    if (process.platform !== "win32") throw new Error("Windows DPAPI is unavailable on this platform.");
    if (this.disposed) throw new Error("The Windows DPAPI secret reader is disposed.");
    return this.track(this.openInternal(sealed));
  }

  private async openInternal(sealed: string): Promise<Uint8Array> {
    if (this.disposed) throw new Error("The Windows DPAPI secret reader is disposed.");
    const checked = decodeCanonicalBase64(sealed, maximumEnvelopeBytes, "The local companion secret envelope");
    checked.fill(0);
    if (this.cached?.sealed === sealed) return Buffer.from(this.cached.cleartext);
    if (this.cached) this.clearCache();
    if (this.pending) {
      await this.pending.task;
      return this.openInternal(sealed);
    }
    const envelope = decodeCanonicalBase64(sealed, maximumEnvelopeBytes, "The local companion secret envelope");
    const task = this.openAndCache(sealed, envelope);
    this.pending = { sealed, task };
    try {
      await task;
      if (!this.cached || this.cached.sealed !== sealed || this.disposed) throw new Error("Windows DPAPI did not retain the current local companion credential.");
      return Buffer.from(this.cached.cleartext);
    } finally { if (this.pending?.task === task) this.pending = undefined; }
  }

  async dispose(): Promise<void> {
    this.disposed = true;
    await Promise.allSettled([...this.activeOperations]);
    this.clearCache();
  }

  async seal(cleartext: Uint8Array): Promise<string> {
    if (process.platform !== "win32" || cleartext.byteLength < 1 || cleartext.byteLength > maximumSecretBytes) throw new Error("Windows DPAPI cannot seal this credential value.");
    if (this.disposed) throw new Error("The Windows DPAPI secret reader is disposed.");
    return this.track(this.sealInternal(cleartext));
  }

  private async sealInternal(cleartext: Uint8Array): Promise<string> {
    const clearCopy = Buffer.from(cleartext);
    let protectedBytes: Buffer | undefined;
    try {
      protectedBytes = await this.invoke("protect", clearCopy);
      if (protectedBytes.byteLength < 1 || protectedBytes.byteLength > maximumEnvelopeBytes) throw new Error("Windows DPAPI returned an invalid credential envelope.");
      if (this.disposed) throw new Error("The Windows DPAPI secret reader was disposed during credential sealing.");
      return protectedBytes.toString("base64");
    } finally { clearCopy.fill(0); protectedBytes?.fill(0); }
  }

  private async invoke(mode: "protect" | "unprotect", input: Buffer): Promise<Buffer> {
    try {
      const result = await this.runner({
        executable: powershellExecutable(),
        args: ["-NoLogo", "-NoProfile", "-NonInteractive", "-Command", mode === "protect" ? protectScript : unprotectScript, String(input.byteLength)],
        input,
        timeoutMs: defaultDpapiTimeoutMs,
        maximumOutputBytes: maximumEnvelopeBytes
      });
      if (result.exitCode !== 0 || result.stderr.byteLength !== 0 || result.stdout.byteLength < 1
        || result.stdout.byteLength > (mode === "protect" ? maximumEnvelopeBytes : maximumSecretBytes)) {
        try {
          throw new Error("Windows DPAPI rejected the current-user secret operation.");
        } finally { result.stdout.fill(0); result.stderr.fill(0); }
      }
      result.stderr.fill(0);
      return result.stdout;
    } finally {
      input.fill(0);
    }
  }

  private async openAndCache(sealed: string, envelope: Buffer): Promise<void> {
    let opened: Buffer | undefined;
    try {
      opened = await this.invoke("unprotect", envelope);
      if (opened.byteLength < 1 || opened.byteLength > maximumSecretBytes) throw new Error("Windows DPAPI returned an invalid clear credential.");
      if (this.disposed) throw new Error("The Windows DPAPI secret reader was disposed during credential opening.");
      this.clearCache();
      this.cached = { sealed, cleartext: Buffer.from(opened) };
    } finally { envelope.fill(0); opened?.fill(0); }
  }

  private clearCache(): void {
    this.cached?.cleartext.fill(0);
    this.cached = undefined;
  }

  private track<T>(operation: Promise<T>): Promise<T> {
    this.activeOperations.add(operation);
    void operation.finally(() => this.activeOperations.delete(operation)).catch(() => undefined);
    return operation;
  }
}

/**
 * Authenticated one-request local named-pipe transport. Its only endpoint is
 * the B122 pipe path created by the companion; no TCP host/port or arbitrary
 * command configuration is accepted.
 */
export class NamedPipeJsonLineTransport implements JsonLineTransport {
  private readonly configuration: StoredCompanionPipeConfiguration;
  private readonly secrets: ExtensionSecretReader;
  private readonly timeoutMs: number;

  constructor(configuration: StoredCompanionPipeConfiguration, secrets: ExtensionSecretReader = new WindowsDpapiSecretReader(), timeoutMs = defaultTimeoutMs) {
    if (!isStoredConfiguration(configuration)) throw new Error("The stored SXSY-B122 local pipe configuration is invalid.");
    if (!Number.isSafeInteger(timeoutMs) || timeoutMs < 100 || timeoutMs > 60_000) throw new Error("The local companion timeout is outside safe bounds.");
    this.configuration = configuration;
    this.secrets = secrets;
    this.timeoutMs = timeoutMs;
  }

  async request(line: string): Promise<string> {
    if (!line || Buffer.byteLength(line, "utf8") > maxFrameBytes) throw new Error("The companion request is outside the local frame limit.");
    const request: unknown = JSON.parse(line);
    if (!isRequest(request)) throw new Error("The companion request is invalid.");
    const opened = await this.secrets.open(this.configuration.sealedToken);
    const token = Buffer.from(opened);
    try {
      if (token.length < 32) throw new Error("The local companion token is too short.");
      return await this.roundTrip(request, line, token);
    } finally {
      token.fill(0);
      opened.fill(0);
    }
  }

  private roundTrip(request: Readonly<{ version: 1; id: string; method: string }>, requestJson: string, token: Buffer): Promise<string> {
    return new Promise<string>((resolve, reject) => {
      const socket = connect(this.configuration.pipePath);
      let buffer = Buffer.alloc(0);
      let state: "challenge" | "response" | "done" = "challenge";
      const clientNonce = randomBytes(32).toString("base64");
      let serverNonce: string | undefined;
      let settled = false;
      const done = (work: () => void): void => { if (settled) return; settled = true; socket.destroy(); work(); };
      socket.setTimeout(this.timeoutMs, () => done(() => reject(new Error("The local companion pipe timed out."))));
      socket.once("error", () => done(() => reject(new Error("The local companion pipe is unavailable."))));
      socket.once("end", () => done(() => reject(new Error("The local companion pipe closed before an authenticated response."))));
      socket.once("close", () => done(() => reject(new Error("The local companion pipe closed before an authenticated response."))));
      socket.on("data", (chunk: Buffer) => {
        if (buffer.length + chunk.length > maxFrameBytes + 1) return done(() => reject(new Error("The local companion response is too large.")));
        buffer = Buffer.concat([buffer, chunk]);
        while (state !== "done") {
          const newline = buffer.indexOf(0x0a);
          if (newline < 0) return;
          const frame = buffer.subarray(0, newline).toString("utf8");
          buffer = buffer.subarray(newline + 1);
          try {
            const parsed: unknown = JSON.parse(frame);
            if (state === "challenge") {
              if (!isChallenge(parsed) || parsed.clientNonce !== clientNonce || !sameProof(parsed.proof, proof(token, "server", clientNonce, parsed.serverNonce))) throw new Error("invalid server proof");
              serverNonce = parsed.serverNonce;
              const envelope = JSON.stringify({ version: 2, clientNonce, serverNonce, proof: proof(token, "client", clientNonce, serverNonce, requestJson), request });
              if (Buffer.byteLength(envelope, "utf8") > maxFrameBytes) throw new Error("request too large");
              state = "response";
              socket.write(`${envelope}\n`, "utf8");
              continue;
            }
            if (!serverNonce || !isResponseEnvelope(parsed)) throw new Error("invalid response");
            const responseJson = JSON.stringify(parsed.response);
            if (!sameProof(parsed.proof, proof(token, "response", clientNonce, serverNonce, responseJson)) || parsed.response.id !== request.id || buffer.length) throw new Error("invalid response proof");
            state = "done";
            done(() => resolve(responseJson));
          } catch { state = "done"; done(() => reject(new Error("The local companion response is malformed or unauthenticated."))); }
        }
      });
      socket.once("connect", () => socket.write(`${JSON.stringify({ version: 2, clientNonce })}\n`, "utf8"));
    });
  }
}

/** Read only the companion-created, DPAPI-sealed local endpoint record. */
export class ProvisionedNamedPipeJsonLineTransport implements JsonLineTransport {
  private readonly configurationPath: string;
  private readonly secrets: ExtensionSecretReader;
  private readonly timeoutMs: number;

  constructor(configurationPath = defaultCompanionPipeConfigurationPath(), secrets: ExtensionSecretReader = new WindowsDpapiSecretReader(), timeoutMs = defaultTimeoutMs) {
    this.configurationPath = configurationPath;
    this.secrets = secrets;
    this.timeoutMs = timeoutMs;
  }

  async request(line: string): Promise<string> {
    let configuration: unknown;
    try { configuration = JSON.parse(await readBoundedConfiguration(this.configurationPath)); } catch { throw new Error("The authenticated local companion pipe is not provisioned."); }
    if (!isStoredConfiguration(configuration)) throw new Error("The authenticated local companion pipe configuration is invalid.");
    return new NamedPipeJsonLineTransport(configuration, this.secrets, this.timeoutMs).request(line);
  }
}

/** Mirrors the companion's host-owned state location; it never uses a workspace path or VS Code setting. */
export function defaultCompanionPipeConfigurationPath(environment: Readonly<Record<string, string | undefined>> = process.env): string {
  const base = process.platform === "win32" ? windowsLocalAppDataKnownFolder() : nonWindowsStateRoot(environment);
  return join(base, "STRATHEX", "switchyard", "authenticated-pipe.json");
}

function windowsLocalAppDataKnownFolder(): string {
  const result = spawnSync(powershellExecutable(), ["-NoLogo", "-NoProfile", "-NonInteractive", "-Command", localAppDataScript], {
    shell: false,
    windowsHide: true,
    env: { ...dpapiEnvironment() },
    encoding: "utf8",
    timeout: 5_000,
    maxBuffer: 4 * 1024
  });
  const value = result.stdout?.trim();
  if (result.error || result.status !== 0 || result.signal || result.stderr || !value || !isAbsolute(value) || /[\0\r\n"]/u.test(value)) {
    throw new Error("The Windows LocalAppData Known Folder is unavailable.");
  }
  const canonical = realpathSync.native(value);
  if (!isAbsolute(canonical) || /[\0\r\n"]/u.test(canonical)) throw new Error("The Windows LocalAppData Known Folder is invalid.");
  return canonical;
}

function nonWindowsStateRoot(environment: Readonly<Record<string, string | undefined>>): string {
  const candidate = environment.XDG_STATE_HOME ?? (environment.HOME ? join(environment.HOME, ".local", "state") : join(homedir(), ".local", "state"));
  if (!isAbsolute(candidate) || /[\0\r\n]/u.test(candidate)) throw new Error("The local state directory must be absolute.");
  return candidate;
}

export function isStoredConfiguration(value: unknown): value is StoredCompanionPipeConfiguration {
  if (!isRecord(value) || !exact(value, ["version", "pipePath", "sealedToken"]) || value.version !== 1 || typeof value.pipePath !== "string"
    || typeof value.sealedToken !== "string" || !/^[A-Za-z0-9+/=:_-]+$/.test(value.sealedToken) || value.sealedToken.length > maximumSealedTokenCharacters) return false;
  return process.platform === "win32"
    ? /^\\\\\.\\pipe\\sxsy-b122-[a-zA-Z0-9-]{1,48}$/.test(value.pipePath)
    : isAbsolute(value.pipePath) && value.pipePath.endsWith(".sock") && !value.pipePath.includes("\0");
}

async function readBoundedConfiguration(filePath: string): Promise<string> {
  const before = await lstat(filePath);
  const uid = process.getuid?.();
  if (!before.isFile() || before.isSymbolicLink() || before.size < 2 || before.size > maximumPipeConfigurationBytes
    || process.platform === "linux" && (uid === undefined || before.uid !== uid || (before.mode & 0o077) !== 0)) throw new Error("invalid configuration file");
  const handle = await open(filePath, "r");
  const bytes = Buffer.alloc(maximumPipeConfigurationBytes + 1);
  try {
    const opened = await handle.stat();
    if (!opened.isFile() || opened.size !== before.size) throw new Error("changed configuration file");
    let offset = 0;
    while (offset < bytes.byteLength) {
      const { bytesRead } = await handle.read(bytes, offset, bytes.byteLength - offset, null);
      if (bytesRead === 0) break;
      offset += bytesRead;
    }
    if (offset < 2 || offset > maximumPipeConfigurationBytes || offset !== opened.size) throw new Error("oversized configuration file");
    return bytes.subarray(0, offset).toString("utf8");
  } finally { bytes.fill(0); await handle.close(); }
}

function isRequest(value: unknown): value is { readonly version: 1; readonly id: string; readonly method: string } {
  return isRecord(value) && value.version === 1 && typeof value.id === "string" && typeof value.method === "string";
}
function isRecord(value: unknown): value is Record<string, unknown> { return typeof value === "object" && value !== null && !Array.isArray(value); }
function isNonce(value: unknown): value is string { return typeof value === "string" && /^[A-Za-z0-9+/]+={0,2}$/.test(value) && Buffer.from(value, "base64").length === 32; }
function isProof(value: unknown): value is string { return isNonce(value); }
function exact(value: Record<string, unknown>, keys: readonly string[]): boolean { return Object.keys(value).length === keys.length && keys.every((key) => key in value); }
function isChallenge(value: unknown): value is { version: 2; clientNonce: string; serverNonce: string; proof: string } { return isRecord(value) && exact(value, ["version", "clientNonce", "serverNonce", "proof"]) && value.version === 2 && isNonce(value.clientNonce) && isNonce(value.serverNonce) && isProof(value.proof); }
function isResponseEnvelope(value: unknown): value is { version: 2; response: { version: 1; id: string; ok: boolean }; proof: string } { return isRecord(value) && exact(value, ["version", "response", "proof"]) && value.version === 2 && isRecord(value.response) && value.response.version === 1 && typeof value.response.id === "string" && typeof value.response.ok === "boolean" && isProof(value.proof); }
function proof(token: Buffer, role: "server" | "client" | "response", clientNonce: string, serverNonce: string, document = ""): string { const documentDigest = createHash("sha256").update(document).digest("hex"); return createHmac("sha256", token).update(`sxsy-b122-pipe-v2\0${role}\0${clientNonce}\0${serverNonce}\0${documentDigest}`).digest("base64"); }
function sameProof(left: string, right: string): boolean { const a = Buffer.from(left, "base64"); const b = Buffer.from(right, "base64"); return a.length === b.length && timingSafeEqual(a, b); }
