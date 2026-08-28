import { spawn } from "node:child_process";
import type { ChildProcess, ChildProcessWithoutNullStreams } from "node:child_process";
import { randomBytes, timingSafeEqual } from "node:crypto";
import { realpathSync } from "node:fs";
import { basename, dirname, isAbsolute, join } from "node:path";

import type { JournalAuthenticator } from "../../../packages/control-plane/src/store.ts";

const maximumSecretBytes = 64 * 1024;
const maximumEnvelopeBytes = maximumSecretBytes * 4;
const defaultDpapiTimeoutMs = 120_000;
const cleanupTimeoutMs = 5_000;
const protectScript = "& { param([int]$length) Add-Type -AssemblyName System.Security;$raw=$null;$out=$null;try{if($length-lt1-or$length-gt262144){throw'input length'};$raw=New-Object byte[] $length;$stream=[Console]::OpenStandardInput();$offset=0;while($offset-lt$length){$read=$stream.Read($raw,$offset,$length-$offset);if($read-le0){throw'truncated input'};$offset+=$read};if($stream.ReadByte()-ne-1){throw'oversized input'};$out=[Security.Cryptography.ProtectedData]::Protect($raw,$null,[Security.Cryptography.DataProtectionScope]::CurrentUser);[Console]::OpenStandardOutput().Write($out,0,$out.Length)}finally{if($null-ne$raw){[Array]::Clear($raw,0,$raw.Length)};if($null-ne$out){[Array]::Clear($out,0,$out.Length)}} }";
const unprotectScript = "& { param([int]$length) Add-Type -AssemblyName System.Security;$raw=$null;$out=$null;try{if($length-lt1-or$length-gt262144){throw'input length'};$raw=New-Object byte[] $length;$stream=[Console]::OpenStandardInput();$offset=0;while($offset-lt$length){$read=$stream.Read($raw,$offset,$length-$offset);if($read-le0){throw'truncated input'};$offset+=$read};if($stream.ReadByte()-ne-1){throw'oversized input'};$out=[Security.Cryptography.ProtectedData]::Unprotect($raw,$null,[Security.Cryptography.DataProtectionScope]::CurrentUser);[Console]::OpenStandardOutput().Write($out,0,$out.Length)}finally{if($null-ne$raw){[Array]::Clear($raw,0,$raw.Length)};if($null-ne$out){[Array]::Clear($out,0,$out.Length)}} }";

export interface BoundedWindowsProcessRequest {
  readonly executable: string;
  readonly args: readonly string[];
  readonly input: Uint8Array;
  readonly timeoutMs: number;
  readonly maximumOutputBytes: number;
}

export interface BoundedWindowsProcessResult {
  readonly exitCode: number;
  readonly stdout: Buffer;
  readonly stderr: Buffer;
}

export type BoundedWindowsProcessRunner = (request: BoundedWindowsProcessRequest) => Promise<BoundedWindowsProcessResult>;

/**
 * Runs only the OS-anchored, fixed non-spawning DPAPI scripts with byte-capped
 * output. The cleanup path is defense in depth for a hung PowerShell host.
 */
export async function runBoundedWindowsProcess(request: BoundedWindowsProcessRequest): Promise<BoundedWindowsProcessResult> {
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
      await terminateOwnedWindowsProcessTree(child).catch(() => undefined);
      throw new Error("The bounded Windows helper could not be started.");
    }
    if (outcome === "timeout" || outcome === "overflow") {
      const cleanup = await terminateOwnedWindowsProcessTree(child);
      const closed = await waitForClose(child, cleanupTimeoutMs);
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

function validDpapiInvocation(request: BoundedWindowsProcessRequest): boolean {
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

async function terminateOwnedWindowsProcessTree(child: ChildProcessWithoutNullStreams): Promise<boolean> {
  if (!child.pid || child.exitCode !== null || child.signalCode !== null) return true;
  const systemDirectory = loadedWindowsSystemDirectory();
  const systemRoot = dirname(systemDirectory);
  const taskkill = join(systemDirectory, "taskkill.exe");
  const killer = spawn(taskkill, ["/PID", String(child.pid), "/T", "/F"], {
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
    await waitForClose(killer, cleanupTimeoutMs);
  }
  if (!await waitForClose(child, cleanupTimeoutMs)) {
    child.kill("SIGKILL");
    await waitForClose(child, cleanupTimeoutMs);
  }
  return killerOutcome === 0 && (child.exitCode !== null || child.signalCode !== null);
}

function waitForClose(child: ChildProcess, timeoutMs: number): Promise<boolean> {
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

/**
 * Small boundary around a current-user host secret protector. Callers may
 * persist only the returned opaque string; the clear value is held only for a
 * single local IPC round trip.  Tests inject a deterministic protector.
 */
export interface UserSecretProtector {
  readonly provider: string;
  seal(cleartext: Uint8Array): Promise<string>;
  open(sealed: string): Promise<Uint8Array>;
}

/** Test-only protector. It is intentionally conspicuous and never selected by production startup. */
export class FakeUserSecretProtector implements UserSecretProtector {
  readonly provider = "fake-test-protector";

  async seal(cleartext: Uint8Array): Promise<string> {
    return `fake:${Buffer.from(cleartext).toString("base64")}`;
  }

  async open(sealed: string): Promise<Uint8Array> {
    if (!sealed.startsWith("fake:")) throw new Error("The test secret is not sealed by this protector.");
    return Buffer.from(sealed.slice("fake:".length), "base64");
  }
}

/**
 * Windows DPAPI CurrentUser adapter. It invokes a constant PowerShell script
 * with data exclusively on stdin (never in command arguments or a file). The
 * B122 host does not fall back to a user-supplied passphrase or plaintext key.
 */
export class WindowsDpapiCurrentUserProtector implements UserSecretProtector {
  readonly provider = "windows-dpapi-current-user";
  private readonly runner: BoundedWindowsProcessRunner;

  constructor(runner: BoundedWindowsProcessRunner = runBoundedWindowsProcess) {
    this.runner = runner;
  }

  async seal(cleartext: Uint8Array): Promise<string> {
    if (cleartext.byteLength < 1 || cleartext.byteLength > maximumSecretBytes) throw new Error("Windows DPAPI cannot seal this secret value.");
    const clearCopy = Buffer.from(cleartext);
    let protectedBytes: Buffer | undefined;
    try {
      protectedBytes = await this.invoke("protect", clearCopy);
      if (protectedBytes.byteLength < 1 || protectedBytes.byteLength > maximumEnvelopeBytes) throw new Error("Windows DPAPI returned an invalid secret envelope.");
      return protectedBytes.toString("base64");
    } finally { clearCopy.fill(0); protectedBytes?.fill(0); }
  }

  async open(sealed: string): Promise<Uint8Array> {
    const envelope = decodeCanonicalBase64(sealed, maximumEnvelopeBytes, "The DPAPI secret envelope");
    try {
      const opened = await this.invoke("unprotect", envelope);
      if (opened.byteLength < 1 || opened.byteLength > maximumSecretBytes) { opened.fill(0); throw new Error("Windows DPAPI returned an invalid clear secret."); }
      return opened;
    } finally { envelope.fill(0); }
  }

  private async invoke(mode: "protect" | "unprotect", input: Uint8Array): Promise<Buffer> {
    if (process.platform !== "win32") throw new Error("Windows DPAPI is unavailable on this platform.");
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
        throw new Error("Windows DPAPI rejected the local secret.");
      } finally { result.stdout.fill(0); result.stderr.fill(0); }
    }
    result.stderr.fill(0);
    return result.stdout;
  }
}

/** Journal tags are host-protected digests, not a locally persisted signing key. */
export class SecretProtectorJournalAuthenticator implements JournalAuthenticator {
  readonly provider: string;
  private readonly protector: UserSecretProtector;

  constructor(protector: UserSecretProtector = new WindowsDpapiCurrentUserProtector()) {
    this.protector = protector;
    this.provider = protector.provider;
  }

  seal(hash: string): Promise<string> {
    return this.protector.seal(Buffer.from(hash, "utf8"));
  }

  async verify(hash: string, authenticationTag: string): Promise<boolean> {
    let actual: Uint8Array | undefined;
    let expected: Buffer | undefined;
    try {
      actual = await this.protector.open(authenticationTag);
      expected = Buffer.from(hash, "utf8");
      return actual.length === expected.length && timingSafeEqual(actual, expected);
    } catch {
      return false;
    } finally {
      actual?.fill(0);
      expected?.fill(0);
    }
  }
}

/** Backward-compatible Windows name retained for the verified Windows bundle. */
export class DpapiJournalAuthenticator extends SecretProtectorJournalAuthenticator {}

export async function createSealedRandomToken(protector: UserSecretProtector): Promise<string> {
  const token = randomBytes(32);
  try { return await protector.seal(token); }
  finally { token.fill(0); }
}
