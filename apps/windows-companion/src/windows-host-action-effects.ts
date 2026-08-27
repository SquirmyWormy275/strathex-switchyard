import { spawn } from "node:child_process";
import type { ChildProcess, ChildProcessWithoutNullStreams } from "node:child_process";
import { randomBytes } from "node:crypto";
import { realpathSync } from "node:fs";
import { win32 } from "node:path";

import type {
  FixedWindowsHostApplicationIdentity,
  WindowsHostActionEffectPort,
  WindowsHostActionEffectRequest,
  WindowsHostActionEffectResult
} from "./windows-host-action-consumer.ts";

const requestSchema = "sxsy-b122.windows-host-action-request" as const;
const responseSchema = "sxsy-b122.windows-host-action-response" as const;
const maximumLineBytes = 32 * 1024;
const maximumOutputBytes = 64 * 1024;
const maximumDiagnosticBytes = 4 * 1024;
const cleanupTimeoutMs = 5_000;
const digestPattern = /^[a-f0-9]{64}$/;
const thumbprintPattern = /^[a-f0-9]{40,64}$/;
const requestIdPattern = /^windows-host-action:[a-f0-9]{32}$/;
const windowIdPattern = /^hwnd:[a-f0-9]{1,16}$/;

export interface WindowsHostActionHelperInvocation {
  readonly executable: string;
  readonly arguments: readonly string[];
  readonly environment: Readonly<Record<string, string>>;
  readonly workingDirectory: string;
}

export interface WindowsHostActionHelperSession {
  write(line: string): Promise<void>;
  read(): Promise<string>;
  terminate(): Promise<void>;
  wait(): Promise<Readonly<{ code: number; signal: NodeJS.Signals | null }>>;
}

export interface WindowsHostActionHelperTransport {
  start(invocation: WindowsHostActionHelperInvocation): Promise<WindowsHostActionHelperSession>;
}

interface WindowsHostActionRuntimeOptions {
  readonly transport?: WindowsHostActionHelperTransport;
  readonly timeoutMs?: number;
  /** Test-only. Accepted only with an injected non-production transport. */
  readonly testPlatform?: NodeJS.Platform;
  /** Test-only. Accepted only with an injected non-production transport. */
  readonly testSystemDirectory?: string;
}

export interface PinnedWindowsHostActionEffectPortOptions extends WindowsHostActionRuntimeOptions {
  readonly applications: Readonly<Partial<Record<"vscode" | "terminal", FixedWindowsHostApplicationIdentity>>>;
}

/** Production transport for the fixed inbox PowerShell/native helper. */
export class NodeWindowsHostActionHelperTransport implements WindowsHostActionHelperTransport {
  async start(invocation: WindowsHostActionHelperInvocation): Promise<WindowsHostActionHelperSession> {
    validateInvocation(invocation);
    if (process.platform !== "win32") throw new Error("The Windows host-action native helper is unavailable on this platform.");
    const expectedSystemDirectory = realpathSync.native(loadedWindowsSystemDirectory());
    const actualSystemDirectory = realpathSync.native(invocation.workingDirectory);
    const expectedExecutable = realpathSync.native(win32.join(expectedSystemDirectory, "WindowsPowerShell", "v1.0", "powershell.exe"));
    const actualExecutable = realpathSync.native(invocation.executable);
    const expectedSystemRoot = win32.dirname(expectedSystemDirectory);
    if (actualExecutable.toLowerCase() !== expectedExecutable.toLowerCase()
      || actualSystemDirectory.toLowerCase() !== expectedSystemDirectory.toLowerCase()
      || invocation.environment.SystemRoot?.toLowerCase() !== expectedSystemRoot.toLowerCase()
      || invocation.environment.WINDIR?.toLowerCase() !== expectedSystemRoot.toLowerCase()) {
      throw new Error("The Windows host-action helper boundary is not the OS-loaded System32 Windows PowerShell environment.");
    }
    const child = spawn(invocation.executable, [...invocation.arguments], {
      cwd: invocation.workingDirectory,
      env: { ...invocation.environment },
      shell: false,
      windowsHide: true,
      stdio: ["pipe", "pipe", "pipe"]
    });
    if (!child.stdin || !child.stdout || !child.stderr) {
      child.kill();
      throw new Error("The fixed Windows host-action helper did not expose its protocol streams.");
    }

    const queued: string[] = [];
    const readers: Array<{ resolve: (line: string) => void; reject: (error: Error) => void }> = [];
    let buffer = "";
    let totalOutput = 0;
    let diagnosticBytes = 0;
    let lines = 0;
    let terminalError: Error | undefined;
    let exited = false;
    let exitValue: Readonly<{ code: number; signal: NodeJS.Signals | null }> | undefined;
    let settleExit!: (value: Readonly<{ code: number; signal: NodeJS.Signals | null }>) => void;
    const exit = new Promise<Readonly<{ code: number; signal: NodeJS.Signals | null }>>((resolveExit) => { settleExit = resolveExit; });
    const fail = (error: Error): void => {
      if (!terminalError) terminalError = error;
      while (readers.length) readers.shift()!.reject(terminalError);
    };
    const emit = (line: string): void => {
      const bytes = Buffer.byteLength(line, "utf8");
      totalOutput += bytes;
      lines += 1;
      if (bytes < 1 || bytes > maximumLineBytes || totalOutput > maximumOutputBytes || lines > 4) {
        fail(new Error("The fixed Windows host-action helper exceeded its bounded protocol output."));
        return;
      }
      const reader = readers.shift();
      if (reader) reader.resolve(line);
      else queued.push(line);
    };

    child.stdout.setEncoding("utf8");
    child.stdout.on("data", (chunk: string) => {
      buffer += chunk;
      if (Buffer.byteLength(buffer, "utf8") > maximumLineBytes) return fail(new Error("The fixed Windows host-action helper emitted an oversized unterminated response."));
      for (let newline = buffer.indexOf("\n"); newline >= 0; newline = buffer.indexOf("\n")) {
        const line = buffer.slice(0, newline).replace(/\r$/, "");
        buffer = buffer.slice(newline + 1);
        emit(line);
      }
    });
    child.stderr.on("data", (chunk: Buffer) => {
      diagnosticBytes += chunk.byteLength;
      chunk.fill(0);
      fail(new Error(diagnosticBytes > maximumDiagnosticBytes
        ? "The fixed Windows host-action helper exceeded its bounded diagnostic output."
        : "The fixed Windows host-action helper emitted unexpected diagnostic output."));
    });
    child.once("error", () => fail(new Error("The fixed Windows host-action helper could not be started.")));
    child.once("close", (code, signal) => {
      exited = true;
      if (buffer.length && !terminalError) terminalError = new Error("The fixed Windows host-action helper ended with an incomplete response.");
      const closed = { code: code ?? -1, signal };
      exitValue = closed;
      while (readers.length) readers.shift()!.reject(terminalError ?? new Error("The fixed Windows host-action helper exited before its response was complete."));
      settleExit(closed);
    });

    return {
      write: async (line) => {
        if (exited || terminalError || child.stdin.destroyed || /[\r\n]/.test(line) || Buffer.byteLength(line, "utf8") > maximumLineBytes) {
          throw terminalError ?? new Error("The fixed Windows host-action helper request is invalid or closed.");
        }
        await new Promise<void>((resolveWrite, rejectWrite) => child.stdin!.write(`${line}\n`, (error) => error ? rejectWrite(error) : resolveWrite()));
      },
      read: async () => {
        const line = queued.shift();
        if (line !== undefined) return line;
        if (terminalError) throw terminalError;
        if (exited) throw new Error("The fixed Windows host-action helper exited before its response was complete.");
        return new Promise<string>((resolve, reject) => readers.push({ resolve, reject }));
      },
      terminate: async () => {
        if (!exited) await terminateOwnedWindowsTree(child, invocation);
      },
      wait: async () => {
        const value = exitValue ?? await exit;
        if (terminalError) throw terminalError;
        if (queued.length || buffer.length) throw new Error("The fixed Windows host-action helper emitted an unconsumed trailing response.");
        return value;
      }
    };
  }
}

/**
 * Executes only the two closed, targetless Windows-global focus actions. The
 * fixed helper holds the executable/process/window identities while READY is
 * emitted; only after the durable consumer barrier returns does it receive the
 * one-time authorization that permits SetForegroundWindow/CreateProcess.
 */
export class PinnedWindowsHostActionEffectPort implements WindowsHostActionEffectPort {
  private readonly applications: Readonly<Partial<Record<"vscode" | "terminal", FixedWindowsHostApplicationIdentity>>>;
  private readonly runtime: RuntimeBoundary;

  constructor(options: PinnedWindowsHostActionEffectPortOptions) {
    this.applications = Object.freeze({
      ...(options.applications.vscode ? { vscode: validateIdentity(options.applications.vscode, "vscode") } : {}),
      ...(options.applications.terminal ? { terminal: validateIdentity(options.applications.terminal, "terminal") } : {})
    });
    this.runtime = runtimeBoundary(options);
  }

  async execute(request: WindowsHostActionEffectRequest): Promise<WindowsHostActionEffectResult> {
    this.runtime.requireWindows();
    const application = request.action === "focus_vscode" ? "vscode" : request.action === "focus_external_terminal" ? "terminal" : undefined;
    const configured = application ? this.applications[application] : undefined;
    if (!application || !configured || request.application !== application || request.processOwner !== "current-user" || request.processSession !== "current-session"
      || request.windowSurface !== "visible-top-level" || request.shell !== false || !sameIdentity(request.executable, configured)
      || !exactArguments(request.action, request.fixedArguments) || !exactWindowCycleOrdinal(request.action, request.windowCycleOrdinal) || request.signal.aborted) {
      throw new Error("The Windows host-action request changed its fixed executable, action, arguments, or current-user window boundary.");
    }
    const session = await bounded(this.runtime.transport.start(this.runtime.invocation), request.signal, this.runtime.timeoutMs, "Windows host-action helper startup");
    let authorized = false;
    let outcome: WindowsHostActionEffectResult | undefined;
    let failure: unknown;
    try {
      const requestId = newRequestId();
      await bounded(session.write(JSON.stringify({
        schema: requestSchema,
        version: 1,
        requestId,
        action: "effect",
        effect: request.action,
        application,
        identity: request.executable,
        fixedArguments: request.fixedArguments,
        windowCycleOrdinal: request.windowCycleOrdinal
      })), request.signal, this.runtime.timeoutMs, "Windows host-action prepare write");
      const ready = parseReady(await bounded(session.read(), request.signal, this.runtime.timeoutMs, "Windows host-action READY"), requestId);
      if ((ready.mode === "focus") !== (ready.processId !== undefined && ready.windowId !== undefined)) throw new Error("The Windows host-action helper returned a malformed focus plan.");

      await bounded(Promise.resolve().then(() => request.beforeEffect()), request.signal, this.runtime.timeoutMs, "Windows host-action final effect barrier");
      if (request.signal.aborted) throw new Error("The Windows host action was cancelled at its final effect boundary.");
      authorized = true;
      await bounded(session.write(JSON.stringify({
        schema: requestSchema,
        version: 1,
        requestId,
        action: "effect",
        kind: "authorize",
        authorizationNonce: ready.authorizationNonce
      })), request.signal, this.runtime.timeoutMs, "Windows host-action authorization write");
      const result = parseEffectResult(await bounded(session.read(), request.signal, this.runtime.timeoutMs, "Windows host-action result"), requestId, ready.mode);
      const exit = await bounded(session.wait(), undefined, this.runtime.timeoutMs, "Windows host-action helper exit");
      if (exit.code !== 0 || exit.signal !== null) throw new Error("The fixed Windows host-action helper did not exit cleanly after its result.");
      outcome = Object.freeze({
        disposition: "committed" as const,
        summary: result.effect === "focused"
          ? `Focused the exact current-user ${application === "vscode" ? "VS Code" : "Windows Terminal"} window.`
          : `Launched the exact current-user ${application === "vscode" ? "VS Code" : "Windows Terminal"} executable.`
      });
    } catch (error) {
      failure = authorized
        ? new Error("The authorized Windows host action did not return a trustworthy exact result; its outcome is ambiguous.", { cause: error })
        : error;
    }
    try {
      await bounded(session.terminate(), undefined, cleanupTimeoutMs, "Windows host-action helper cleanup");
    } catch (error) {
      failure = authorized
        ? new Error("The authorized Windows host action could not prove exact helper cleanup; its outcome is ambiguous.", { cause: error })
        : error;
    }
    if (failure !== undefined) throw failure;
    if (!outcome) throw new Error("The Windows host action returned no exact outcome.");
    return outcome;
  }
}

export async function provisionWindowsHostActionApplications(options: WindowsHostActionRuntimeOptions = {}): Promise<Readonly<Partial<Record<"vscode" | "terminal", FixedWindowsHostApplicationIdentity>>>> {
  const runtime = runtimeBoundary(options);
  runtime.requireWindows();
  const provision = async (application: "vscode" | "terminal"): Promise<FixedWindowsHostApplicationIdentity> => {
    const session = await bounded(runtime.transport.start(runtime.invocation), undefined, runtime.timeoutMs, `Windows ${application} provisioning helper startup`);
    let identity: FixedWindowsHostApplicationIdentity | undefined;
    let failure: unknown;
    try {
      const requestId = newRequestId();
      await bounded(session.write(JSON.stringify({ schema: requestSchema, version: 1, requestId, action: "provision", application })), undefined, runtime.timeoutMs, `Windows ${application} provisioning request`);
      identity = parseProvisionResult(await bounded(session.read(), undefined, runtime.timeoutMs, `Windows ${application} provisioning response`), requestId, application);
      const exit = await bounded(session.wait(), undefined, runtime.timeoutMs, `Windows ${application} provisioning helper exit`);
      if (exit.code !== 0 || exit.signal !== null) throw new Error(`The fixed Windows ${application} provisioning helper did not exit cleanly.`);
    } catch (error) {
      failure = error;
    }
    try {
      await bounded(session.terminate(), undefined, cleanupTimeoutMs, `Windows ${application} provisioning helper cleanup`);
    } catch (error) {
      failure = error;
    }
    if (failure !== undefined) throw failure;
    if (!identity) throw new Error(`The fixed Windows ${application} provisioning helper returned no identity.`);
    return identity;
  };
  const applications: Partial<Record<"vscode" | "terminal", FixedWindowsHostApplicationIdentity>> = {};
  for (const application of ["vscode", "terminal"] as const) {
    try { applications[application] = await provision(application); }
    catch { /* An absent or unverifiable host application remains unavailable. */ }
  }
  return Object.freeze(applications);
}

interface RuntimeBoundary {
  readonly transport: WindowsHostActionHelperTransport;
  readonly invocation: WindowsHostActionHelperInvocation;
  readonly timeoutMs: number;
  requireWindows(): void;
}

function runtimeBoundary(options: WindowsHostActionRuntimeOptions): RuntimeBoundary {
  const transport = options.transport ?? new NodeWindowsHostActionHelperTransport();
  const platform = options.testPlatform ?? process.platform;
  if ((options.testPlatform !== undefined || options.testSystemDirectory !== undefined) && !options.transport) {
    throw new Error("Windows host-action test overrides require an injected non-production transport.");
  }
  const timeoutMs = options.timeoutMs ?? 15_000;
  if (!Number.isSafeInteger(timeoutMs) || timeoutMs < 50 || timeoutMs > 60_000) throw new Error("The Windows host-action helper timeout is outside safe bounds.");
  const systemDirectory = options.testSystemDirectory ?? (platform === "win32" ? loadedWindowsSystemDirectory() : "C:\\Windows\\System32");
  if (!win32.isAbsolute(systemDirectory) || win32.basename(systemDirectory).toLowerCase() !== "system32" || /[\0\r\n"]/u.test(systemDirectory)) {
    throw new Error("The Windows native system directory is invalid.");
  }
  const canonicalSystem = win32.normalize(systemDirectory);
  const systemRoot = win32.dirname(canonicalSystem);
  const invocation: WindowsHostActionHelperInvocation = Object.freeze({
    executable: win32.join(canonicalSystem, "WindowsPowerShell", "v1.0", "powershell.exe"),
    arguments: Object.freeze(["-NoLogo", "-NoProfile", "-NonInteractive", "-Command", windowsHostActionHelperContractSource]),
    environment: Object.freeze({ SystemRoot: systemRoot, WINDIR: systemRoot }),
    workingDirectory: canonicalSystem
  });
  validateInvocation(invocation);
  return Object.freeze({
    transport,
    invocation,
    timeoutMs,
    requireWindows() { if (platform !== "win32") throw new Error("Windows host actions are unavailable on this platform."); }
  });
}

function validateInvocation(invocation: WindowsHostActionHelperInvocation): void {
  const systemDirectory = invocation.workingDirectory;
  const systemRoot = win32.dirname(systemDirectory);
  if (!win32.isAbsolute(systemDirectory) || win32.basename(systemDirectory).toLowerCase() !== "system32"
    || win32.normalize(invocation.executable).toLowerCase() !== win32.join(systemDirectory, "WindowsPowerShell", "v1.0", "powershell.exe").toLowerCase()
    || invocation.arguments.length !== 5 || invocation.arguments[0] !== "-NoLogo" || invocation.arguments[1] !== "-NoProfile"
    || invocation.arguments[2] !== "-NonInteractive" || invocation.arguments[3] !== "-Command" || invocation.arguments[4] !== windowsHostActionHelperContractSource
    || !exactKeys(invocation.environment, ["SystemRoot", "WINDIR"]) || invocation.environment.SystemRoot !== systemRoot || invocation.environment.WINDIR !== systemRoot
    || windowsHostActionHelperContractSource.length > 24_000) {
    throw new Error("The fixed Windows host-action helper invocation is invalid.");
  }
}

function parseProvisionResult(line: string, requestId: string, application: "vscode" | "terminal"): FixedWindowsHostApplicationIdentity {
  const value = parseJsonRecord(line);
  throwIfError(value, requestId);
  if (!exactKeys(value, ["schema", "version", "requestId", "kind", "action", "identity"])
    || value.schema !== responseSchema || value.version !== 1 || value.requestId !== requestId || value.kind !== "result" || value.action !== "provision") {
    throw new Error("The Windows host-action provisioning response is malformed.");
  }
  return validateIdentity(value.identity as FixedWindowsHostApplicationIdentity, application);
}

interface ReadyResponse { readonly mode: "focus" | "launch"; readonly authorizationNonce: string; readonly processId?: number; readonly windowId?: string }
function parseReady(line: string, requestId: string): ReadyResponse {
  const value = parseJsonRecord(line);
  throwIfError(value, requestId);
  const focus = value.mode === "focus";
  const expected = focus
    ? ["schema", "version", "requestId", "kind", "action", "authorizationNonce", "mode", "processId", "windowId"]
    : ["schema", "version", "requestId", "kind", "action", "authorizationNonce", "mode"];
  if (!exactKeys(value, expected) || value.schema !== responseSchema || value.version !== 1 || value.requestId !== requestId
    || value.kind !== "ready" || value.action !== "effect" || (value.mode !== "focus" && value.mode !== "launch")
    || typeof value.authorizationNonce !== "string" || !digestPattern.test(value.authorizationNonce)
    || (focus && (!Number.isSafeInteger(value.processId) || (value.processId as number) <= 0 || typeof value.windowId !== "string" || !windowIdPattern.test(value.windowId)))) {
    throw new Error("The Windows host-action helper READY response is malformed.");
  }
  return Object.freeze({
    mode: value.mode,
    authorizationNonce: value.authorizationNonce,
    ...(focus ? { processId: value.processId as number, windowId: value.windowId as string } : {})
  });
}

function parseEffectResult(line: string, requestId: string, mode: ReadyResponse["mode"]): Readonly<{ effect: "focused" | "launched"; processId: number; windowId?: string }> {
  const value = parseJsonRecord(line);
  throwIfError(value, requestId);
  const focused = mode === "focus";
  const expected = focused
    ? ["schema", "version", "requestId", "kind", "action", "effect", "processId", "windowId"]
    : ["schema", "version", "requestId", "kind", "action", "effect", "processId"];
  if (!exactKeys(value, expected) || value.schema !== responseSchema || value.version !== 1 || value.requestId !== requestId || value.kind !== "result" || value.action !== "effect"
    || value.effect !== (focused ? "focused" : "launched") || !Number.isSafeInteger(value.processId) || (value.processId as number) <= 0
    || (focused && (typeof value.windowId !== "string" || !windowIdPattern.test(value.windowId)))) {
    throw new Error("The Windows host-action helper effect result does not match its exact READY plan.");
  }
  return Object.freeze({ effect: focused ? "focused" : "launched", processId: value.processId as number, ...(focused ? { windowId: value.windowId as string } : {}) });
}

function throwIfError(value: Record<string, unknown>, requestId: string): void {
  if (value.kind !== "error") return;
  if (!exactKeys(value, ["schema", "version", "requestId", "kind", "code"]) || value.schema !== responseSchema || value.version !== 1
    || value.requestId !== requestId || typeof value.code !== "string" || !/^[a-z][a-z0-9_]{0,63}$/.test(value.code)) {
    throw new Error("The Windows host-action helper error response is malformed.");
  }
  throw new Error(`The Windows host-action helper failed closed (${value.code}).`);
}

function parseJsonRecord(line: string): Record<string, unknown> {
  if (!line || Buffer.byteLength(line, "utf8") > maximumLineBytes) throw new Error("The Windows host-action helper response is outside its bound.");
  let value: unknown;
  try { value = JSON.parse(line); } catch { throw new Error("The Windows host-action helper response is not valid JSON."); }
  if (!isRecord(value)) throw new Error("The Windows host-action helper response is malformed.");
  return value;
}

function validateIdentity(value: FixedWindowsHostApplicationIdentity, application: "vscode" | "terminal"): FixedWindowsHostApplicationIdentity {
  const productId = application === "vscode" ? "microsoft.visual-studio-code" : "microsoft.windows-terminal";
  if (!isRecord(value) || !exactKeys(value, ["version", "application", "productId", "canonicalExecutablePath", "executableSha256", "signerSubject", "signerThumbprint", "size", "modifiedMs", "device", "inode"])
    || value.version !== 1 || value.application !== application || value.productId !== productId
    || typeof value.canonicalExecutablePath !== "string" || !win32.isAbsolute(value.canonicalExecutablePath) || !/\.exe$/i.test(value.canonicalExecutablePath) || /[\0\r\n"]/u.test(value.canonicalExecutablePath)
    || typeof value.executableSha256 !== "string" || !digestPattern.test(value.executableSha256.toLowerCase())
    || typeof value.signerSubject !== "string" || value.signerSubject.length < 1 || value.signerSubject.length > 240 || !/^CN=Microsoft Corporation(?:,|$)/i.test(value.signerSubject) || /[\0\r\n]/u.test(value.signerSubject)
    || typeof value.signerThumbprint !== "string" || !thumbprintPattern.test(value.signerThumbprint.toLowerCase())
    || !Number.isSafeInteger(value.size) || value.size <= 0 || !Number.isSafeInteger(value.modifiedMs) || value.modifiedMs <= 0
    || typeof value.device !== "string" || !unsigned64(value.device) || typeof value.inode !== "string" || !unsigned64(value.inode)) {
    throw new Error(`The fixed Windows ${application} executable identity is invalid.`);
  }
  return Object.freeze({
    version: 1,
    application,
    productId,
    canonicalExecutablePath: win32.normalize(value.canonicalExecutablePath),
    executableSha256: value.executableSha256.toLowerCase(),
    signerSubject: value.signerSubject,
    signerThumbprint: value.signerThumbprint.toLowerCase(),
    size: value.size,
    modifiedMs: value.modifiedMs,
    device: value.device,
    inode: value.inode
  });
}

function sameIdentity(left: FixedWindowsHostApplicationIdentity, right: FixedWindowsHostApplicationIdentity): boolean {
  try {
    const normalized = validateIdentity(left, right.application);
    return normalized.version === right.version && normalized.application === right.application && normalized.productId === right.productId
      && normalized.canonicalExecutablePath.toLowerCase() === right.canonicalExecutablePath.toLowerCase()
      && normalized.executableSha256 === right.executableSha256 && normalized.signerSubject === right.signerSubject
      && normalized.signerThumbprint === right.signerThumbprint && normalized.size === right.size && normalized.modifiedMs === right.modifiedMs
      && normalized.device === right.device && normalized.inode === right.inode;
  } catch { return false; }
}

function exactArguments(action: WindowsHostActionEffectRequest["action"], args: readonly string[]): boolean {
  return Array.isArray(args) && (action === "focus_vscode" ? args.length === 1 && args[0] === "--reuse-window" : args.length === 0);
}

function exactWindowCycleOrdinal(action: WindowsHostActionEffectRequest["action"], value: number): boolean {
  return Number.isSafeInteger(value) && value >= 0 && value <= 65_535 && (action === "focus_vscode" || value === 0);
}

async function bounded<T>(promise: Promise<T>, signal: AbortSignal | undefined, timeoutMs: number, label: string): Promise<T> {
  promise.then(() => undefined, () => undefined);
  let timer: ReturnType<typeof setTimeout> | undefined;
  let onAbort: (() => void) | undefined;
  const timeout = new Promise<never>((_resolve, reject) => { timer = setTimeout(() => reject(new Error(`${label} timed out.`)), timeoutMs); timer.unref?.(); });
  const cancelled = new Promise<never>((_resolve, reject) => {
    if (!signal) return;
    onAbort = () => reject(new Error(`${label} was cancelled.`));
    if (signal.aborted) onAbort(); else signal.addEventListener("abort", onAbort, { once: true });
  });
  try { return await Promise.race([promise, timeout, cancelled]); }
  finally { if (timer) clearTimeout(timer); if (signal && onAbort) signal.removeEventListener("abort", onAbort); }
}

async function terminateOwnedWindowsTree(child: ChildProcessWithoutNullStreams, invocation: WindowsHostActionHelperInvocation): Promise<void> {
  if (!child.pid || child.exitCode !== null || child.signalCode !== null) return;
  if (await waitForClose(child, 100)) return;
  const taskkill = win32.join(invocation.workingDirectory, "taskkill.exe");
  const killer = spawn(taskkill, ["/PID", String(child.pid), "/T", "/F"], {
    cwd: invocation.workingDirectory,
    env: { ...invocation.environment },
    shell: false,
    windowsHide: true,
    stdio: "ignore"
  });
  const killed = new Promise<number>((resolve) => { killer.once("error", () => resolve(-1)); killer.once("close", (code) => resolve(code ?? -1)); });
  let code: number;
  try {
    code = await bounded(killed, undefined, 2_000, "Windows host-action cleanup process");
  } catch {
    killer.kill("SIGKILL");
    if (!await waitForClose(killer, 500)) throw new Error("The exact Windows host-action cleanup process did not exit.");
    code = -1;
  }
  if (code === 0 && await waitForClose(child, 1_500)) return;
  child.kill("SIGKILL");
  if (!await waitForClose(child, 750)) throw new Error("The exact Windows host-action helper process tree did not exit after bounded cleanup.");
  throw new Error("The exact Windows host-action helper process exited, but whole-tree cleanup could not be proven.");
}

function waitForClose(child: ChildProcess, timeoutMs: number): Promise<boolean> {
  if (child.exitCode !== null || child.signalCode !== null) return Promise.resolve(true);
  return new Promise((resolve) => {
    const closed = (): void => { clearTimeout(timer); child.off("close", closed); resolve(true); };
    const timer = setTimeout(() => { child.off("close", closed); resolve(false); }, timeoutMs);
    child.once("close", closed);
  });
}

function loadedWindowsSystemDirectory(): string {
  if (process.platform !== "win32" || !process.report?.getReport) throw new Error("The Windows native system directory is unavailable.");
  const report = process.report.getReport() as { readonly sharedObjects?: unknown };
  const loaded = Array.isArray(report.sharedObjects) ? report.sharedObjects : [];
  const candidates = loaded.filter((value): value is string => typeof value === "string" && win32.basename(value).toLowerCase() === "kernel32.dll");
  if (candidates.length !== 1 || !win32.isAbsolute(candidates[0]!) || /[\0\r\n"]/u.test(candidates[0]!)) throw new Error("The loaded Windows kernel module identity is invalid.");
  const kernel = realpathSync.native(candidates[0]!);
  if (win32.basename(kernel).toLowerCase() !== "kernel32.dll") throw new Error("The loaded Windows kernel module identity changed.");
  return win32.dirname(kernel);
}

function newRequestId(): string { return `windows-host-action:${randomBytes(16).toString("hex")}`; }
function isRecord(value: unknown): value is Record<string, unknown> { return !!value && typeof value === "object" && !Array.isArray(value) && Object.getPrototypeOf(value) === Object.prototype; }
function exactKeys(value: Record<string, unknown>, keys: readonly string[]): boolean { return Object.keys(value).length === keys.length && keys.every((key) => key in value); }
function unsigned64(value: string): boolean { if (!/^(0|[1-9][0-9]{0,19})$/.test(value)) return false; try { return BigInt(value) <= 18_446_744_073_709_551_615n; } catch { return false; } }

/** Fixed PS5-compatible helper source; it accepts only the closed JSON protocol above. */
export const windowsHostActionHelperContractSource = String.raw`$ErrorActionPreference='Stop'
$schema='sxsy-b122.windows-host-action-response';$rid='unknown';$stage='startup'
function Out($v){[Console]::Out.WriteLine(($v|ConvertTo-Json -Compress -Depth 8))}
function Exact($o,[string[]]$n){$a=@($o.PSObject.Properties.Name|Sort-Object);$b=@($n|Sort-Object);return ($a.Count-eq$b.Count-and(@(Compare-Object $a $b).Count-eq0))}
function Line(){ $v=[Console]::In.ReadLine();if([string]::IsNullOrEmpty($v)-or$v.Length-gt32768){throw'bad_line'};return $v }
function Sig($p){$s=Get-AuthenticodeSignature -LiteralPath $p;if([string]$s.Status-cne'Valid'-or$null-eq$s.SignerCertificate){throw'bad_signature'};$sub=[string]$s.SignerCertificate.Subject;$th=([string]$s.SignerCertificate.Thumbprint).ToLowerInvariant();if(-not$sub.StartsWith('CN=Microsoft Corporation',[StringComparison]::OrdinalIgnoreCase)-or$th-notmatch'^[a-f0-9]{40,64}$'){throw'bad_signer'};$ch=New-Object Security.Cryptography.X509Certificates.X509Chain;try{if(-not$ch.Build($s.SignerCertificate)){throw'bad_chain'};$el=@($ch.ChainElements);if($el.Count-lt2-or([string]$el[$el.Count-1].Certificate.Thumbprint).ToLowerInvariant()-cne'8f43288ad272f3103b6fb1428485ea3014c0bcfe'){throw'bad_microsoft_root'}}finally{$ch.Dispose()};return @($sub,$th)}
function Candidate([string]$app){if($app-ceq'vscode'){$pf=[Environment]::GetFolderPath([Environment+SpecialFolder]::ProgramFiles);$px=[Environment]::GetFolderPath([Environment+SpecialFolder]::ProgramFilesX86);$la=[Environment]::GetFolderPath([Environment+SpecialFolder]::LocalApplicationData);$c=@(@((Join-Path $pf 'Microsoft VS Code\Code.exe'),(Join-Path $px 'Microsoft VS Code\Code.exe'),(Join-Path $la 'Programs\Microsoft VS Code\Code.exe'))|Select-Object -Unique|Where-Object{[IO.File]::Exists($_)})}else{$p=@(Get-AppxPackage -Name Microsoft.WindowsTerminal -ErrorAction Stop|Where-Object{-not[string]::IsNullOrWhiteSpace($_.InstallLocation)});if($p.Count-ne1){throw'ambiguous_terminal'};$c=@((Join-Path ([string]$p[0].InstallLocation) 'WindowsTerminal.exe')|Where-Object{[IO.File]::Exists($_)})};if($c.Count-ne1){throw'ambiguous_installation'};return [string]$c[0]}
$cs=@'
using System;using System.Collections.Generic;using System.Diagnostics;using System.IO;using System.Runtime.InteropServices;using System.Security.Cryptography;using System.Security.Principal;using System.Text;using Microsoft.Win32.SafeHandles;
namespace B122Host{
public sealed class Pin:IDisposable{public string Path,Sha,Device,Inode;public long Size,MtimeMs;FileStream f;List<SafeFileHandle>d=new List<SafeFileHandle>();List<string>a=new List<string>();
const uint SR=1,SW=2,OE=3,BACK=33554432,NORP=2097152;public Pin(string p,bool hold){Path=System.IO.Path.GetFullPath(p);Check(Path);string root=System.IO.Path.GetPathRoot(Path),cur=root;Check(root);string rel=Path.Substring(root.Length);string[]parts=rel.Split(new[]{'\\'},StringSplitOptions.RemoveEmptyEntries);for(int i=0;i<parts.Length-1;i++){cur=System.IO.Path.Combine(cur,parts[i]);Check(cur);if(hold)Hold(cur);else a.Add(cur);}f=new FileStream(Path,FileMode.Open,FileAccess.Read,FileShare.Read);if(!Eq(Final(f.SafeFileHandle),Path))throw new Exception("canonical");Read();}
static void Check(string p){if((File.GetAttributes(p)&FileAttributes.ReparsePoint)!=0)throw new Exception("reparse");}void Hold(string p){SafeFileHandle h=CreateFileW(p,0,SR|SW,IntPtr.Zero,OE,BACK|NORP,IntPtr.Zero);if(h.IsInvalid)throw new Exception("pin");d.Add(h);}static string Final(SafeFileHandle h){var b=new StringBuilder(4096);uint n=GetFinalPathNameByHandleW(h,b,(uint)b.Capacity,0);if(n==0||n>=b.Capacity)throw new Exception("final");string s=b.ToString();if(s.StartsWith(@"\\?\UNC\"))s=@"\\"+s.Substring(8);else if(s.StartsWith(@"\\?\"))s=s.Substring(4);return System.IO.Path.GetFullPath(s);}void Read(){Info i;if(!GetFileInformationByHandle(f.SafeFileHandle,out i))throw new Exception("info");Size=f.Length;Device=i.Volume.ToString();Inode=(((ulong)i.IndexHi<<32)|i.IndexLo).ToString();MtimeMs=(long)(File.GetLastWriteTimeUtc(Path)-new DateTime(1970,1,1,0,0,0,DateTimeKind.Utc)).TotalMilliseconds;f.Position=0;using(SHA256 h=SHA256.Create())Sha=Hex(h.ComputeHash(f));f.Position=0;}public void Verify(){foreach(string p in a)Check(p);if(!Eq(Final(f.SafeFileHandle),Path))throw new Exception("canonical_changed");string s=Sha,z=Device,q=Inode;long n=Size,m=MtimeMs;Read();if(s!=Sha||z!=Device||q!=Inode||n!=Size||m!=MtimeMs)throw new Exception("changed");}public void Dispose(){if(f!=null)f.Dispose();foreach(var h in d)h.Dispose();}static string Hex(byte[]v){var b=new StringBuilder(v.Length*2);foreach(byte x in v)b.Append(x.ToString("x2"));return b.ToString();}static bool Eq(string a,string b){return string.Equals(System.IO.Path.GetFullPath(a),System.IO.Path.GetFullPath(b),StringComparison.OrdinalIgnoreCase);}
[StructLayout(LayoutKind.Sequential)]struct Info{public uint Attr;public System.Runtime.InteropServices.ComTypes.FILETIME C,A,W;public uint Volume,SizeHi,SizeLo,Links,IndexHi,IndexLo;}[DllImport("kernel32.dll",SetLastError=true,CharSet=CharSet.Unicode)]static extern SafeFileHandle CreateFileW(string p,uint a,uint s,IntPtr x,uint c,uint f,IntPtr t);[DllImport("kernel32.dll",SetLastError=true)]static extern bool GetFileInformationByHandle(SafeFileHandle h,out Info i);[DllImport("kernel32.dll",SetLastError=true,CharSet=CharSet.Unicode)]static extern uint GetFinalPathNameByHandleW(SafeFileHandle h,StringBuilder b,uint n,uint f);}
public sealed class Prepared:IDisposable{public string Mode;public uint Pid;public IntPtr Window;public Pin File;SafeFileHandle Process;uint session;string sid,path;const uint QUERY=4096,SYNC=1048576,STILL=259,CREATE_SUSPENDED=4,CREATE_NEW_PROCESS_GROUP=512;public Prepared(Pin p,int cycle){if(cycle<0||cycle>65535)throw new Exception("cycle");File=p;session=(uint)System.Diagnostics.Process.GetCurrentProcess().SessionId;sid=WindowsIdentity.GetCurrent().User.Value;path=p.Path;Find(cycle);Mode=Process==null?"launch":"focus";}
void Find(int cycle){var hs=new List<SafeFileHandle>();var ps=new List<uint>();var ws=new List<IntPtr>();EnumWindows(delegate(IntPtr w,IntPtr x){uint pid;if(!Visible(w)||GetWindow(w,4)!=IntPtr.Zero||GetWindowThreadProcessId(w,out pid)==0)return true;SafeFileHandle h=OpenProcess(QUERY|SYNC,false,pid);if(h.IsInvalid){h.Dispose();return true;}if(Check(h,pid)){hs.Add(h);ps.Add(pid);ws.Add(w);}else h.Dispose();return true;},IntPtr.Zero);if(hs.Count>0){int pick=cycle%hs.Count;Process=hs[pick];Pid=ps[pick];Window=ws[pick];for(int i=0;i<hs.Count;i++)if(i!=pick)hs[i].Dispose();}}static bool Visible(IntPtr w){int c;if(!IsWindowVisible(w)||DwmGetWindowAttribute(w,14,out c,4)!=0||c!=0)return false;return true;}bool Check(SafeFileHandle h,uint pid){uint s;if(!ProcessIdToSessionId(pid,out s)||s!=session)return false;IntPtr tok;if(!OpenProcessToken(h.DangerousGetHandle(),8,out tok))return false;try{using(WindowsIdentity w=new WindowsIdentity(tok)){if(!String.Equals(w.User.Value,sid,StringComparison.OrdinalIgnoreCase))return false;}}finally{CloseHandle(tok);}var b=new StringBuilder(4096);uint n=(uint)b.Capacity;if(!QueryFullProcessImageNameW(h,0,b,ref n)||!String.Equals(System.IO.Path.GetFullPath(b.ToString()),path,StringComparison.OrdinalIgnoreCase))return false;uint e;if(!GetExitCodeProcess(h,out e)||e!=STILL)return false;System.Runtime.InteropServices.ComTypes.FILETIME c,a,k,u;if(!GetProcessTimes(h,out c,out a,out k,out u))return false;long ft=((long)(uint)c.dwHighDateTime<<32)|(uint)c.dwLowDateTime;long ms=(long)(DateTime.FromFileTimeUtc(ft)-new DateTime(1970,1,1,0,0,0,DateTimeKind.Utc)).TotalMilliseconds;return ms>=File.MtimeMs;}
public uint Execute(string app){File.Verify();if(Mode=="focus"){if(!Check(Process,Pid)||!Visible(Window)){throw new Exception("stale");}uint p;if(GetWindowThreadProcessId(Window,out p)==0||p!=Pid)throw new Exception("window");ShowWindow(Window,9);if(!SetForegroundWindow(Window))throw new Exception("focus");IntPtr f=GetForegroundWindow();uint fp;if(f==IntPtr.Zero||GetWindowThreadProcessId(f,out fp)==0||fp!=Pid)throw new Exception("focus_unproven");return Pid;}string arg=app=="vscode"?" --reuse-window":"";var si=new SI();si.cb=Marshal.SizeOf(typeof(SI));PI pi;string cmd=Quote(path)+arg;if(!CreateProcessW(path,new StringBuilder(cmd),IntPtr.Zero,IntPtr.Zero,false,CREATE_SUSPENDED|CREATE_NEW_PROCESS_GROUP,IntPtr.Zero,System.IO.Path.GetDirectoryName(path),ref si,out pi))throw new Exception("launch");using(var ph=new SafeFileHandle(pi.hProcess,true))using(var th=new SafeFileHandle(pi.hThread,true)){bool resumed=false;try{if(!Check(ph,pi.pid))throw new Exception("launch_identity");if(ResumeThread(th)==uint.MaxValue)throw new Exception("resume");resumed=true;return pi.pid;}finally{if(!resumed)TerminateProcess(ph,70);}}}static string Quote(string v){return "\""+v.Replace("\"","\\\"")+"\"";}public void Dispose(){if(Process!=null)Process.Dispose();File.Dispose();}
delegate bool EW(IntPtr w,IntPtr p);[StructLayout(LayoutKind.Sequential,CharSet=CharSet.Unicode)]struct SI{public int cb;public string r,d;public string t,x;public int X,Y,XS,YS,XC,YC;public int flags,show;public short r2;public IntPtr r3,input,output,error;}[StructLayout(LayoutKind.Sequential)]struct PI{public IntPtr hProcess,hThread;public uint pid,tid;}[DllImport("user32.dll")]static extern bool EnumWindows(EW c,IntPtr p);[DllImport("user32.dll")]static extern bool IsWindowVisible(IntPtr w);[DllImport("dwmapi.dll")]static extern int DwmGetWindowAttribute(IntPtr w,int a,out int v,int n);[DllImport("user32.dll")]static extern IntPtr GetWindow(IntPtr w,uint c);[DllImport("user32.dll")]static extern uint GetWindowThreadProcessId(IntPtr w,out uint p);[DllImport("user32.dll")]static extern bool ShowWindow(IntPtr w,int c);[DllImport("user32.dll")]static extern bool SetForegroundWindow(IntPtr w);[DllImport("user32.dll")]static extern IntPtr GetForegroundWindow();[DllImport("kernel32.dll")]static extern SafeFileHandle OpenProcess(uint a,bool i,uint p);[DllImport("advapi32.dll")]static extern bool OpenProcessToken(IntPtr p,uint a,out IntPtr t);[DllImport("kernel32.dll")]static extern bool CloseHandle(IntPtr h);[DllImport("kernel32.dll")]static extern bool ProcessIdToSessionId(uint p,out uint s);[DllImport("kernel32.dll",CharSet=CharSet.Unicode)]static extern bool QueryFullProcessImageNameW(SafeFileHandle p,uint f,StringBuilder b,ref uint n);[DllImport("kernel32.dll")]static extern bool GetExitCodeProcess(SafeFileHandle p,out uint e);[DllImport("kernel32.dll")]static extern bool GetProcessTimes(SafeFileHandle p,out System.Runtime.InteropServices.ComTypes.FILETIME c,out System.Runtime.InteropServices.ComTypes.FILETIME e,out System.Runtime.InteropServices.ComTypes.FILETIME k,out System.Runtime.InteropServices.ComTypes.FILETIME u);[DllImport("kernel32.dll",CharSet=CharSet.Unicode)]static extern bool CreateProcessW(string a,StringBuilder c,IntPtr pa,IntPtr ta,bool ih,uint f,IntPtr e,string d,ref SI s,out PI p);[DllImport("kernel32.dll")]static extern uint ResumeThread(SafeFileHandle t);[DllImport("kernel32.dll")]static extern bool TerminateProcess(SafeFileHandle p,uint e);}
public static class Native{public static Prepared Prepare(Pin p,int cycle){return new Prepared(p,cycle);}}
}
'@
try{$stage='compile';Add-Type -TypeDefinition $cs -Language CSharp}catch{Out ([ordered]@{schema=$schema;version=1;requestId=$rid;kind='error';code='native_compile_failure'});exit 65}
try{
  $stage='request';$r=(Line)|ConvertFrom-Json;$rid=[string]$r.requestId
  if($r.schema-cne'sxsy-b122.windows-host-action-request'-or$r.version-ne1-or$rid-notmatch'^windows-host-action:[a-f0-9]{32}$'){throw'bad_request'}
  if($r.action-ceq'provision'){
    if(-not(Exact $r @('schema','version','requestId','action','application'))-or$r.application-notin@('vscode','terminal')){throw'bad_provision'};$app=[string]$r.application;$c=@()
    $stage='discovery';try{$candidate=Candidate $app}catch{throw'candidate_discovery_failure'};$stage='pin';$pin=[B122Host.Pin]::new($candidate,$app-ceq'vscode');try{$stage='signature';try{$sg=Sig $pin.Path}catch{throw'signature_validation_failure'};$stage='response';$prod=if($app-ceq'vscode'){'microsoft.visual-studio-code'}else{'microsoft.windows-terminal'};Out ([ordered]@{schema=$schema;version=1;requestId=$rid;kind='result';action='provision';identity=[ordered]@{version=1;application=$app;productId=$prod;canonicalExecutablePath=$pin.Path;executableSha256=$pin.Sha;signerSubject=$sg[0];signerThumbprint=$sg[1];size=$pin.Size;modifiedMs=$pin.MtimeMs;device=$pin.Device;inode=$pin.Inode}})}finally{$pin.Dispose()};exit 0}
  if(-not(Exact $r @('schema','version','requestId','action','effect','application','identity','fixedArguments','windowCycleOrdinal'))-or$r.action-cne'effect'-or$r.effect-notin@('focus_vscode','focus_external_terminal')-or$r.application-notin@('vscode','terminal')){throw'bad_effect'};$app=[string]$r.application;if(($r.effect-ceq'focus_vscode')-ne($app-ceq'vscode')){throw'bad_mapping'};$args=@($r.fixedArguments);if(($app-ceq'vscode'-and($args.Count-ne1-or[string]$args[0]-cne'--reuse-window'))-or($app-ceq'terminal'-and$args.Count-ne0)){throw'bad_args'};$cycle=[int]$r.windowCycleOrdinal;if($cycle-lt0-or$cycle-gt65535-or($app-ceq'terminal'-and$cycle-ne0)){throw'bad_cycle'}
  $i=$r.identity;if(-not(Exact $i @('version','application','productId','canonicalExecutablePath','executableSha256','signerSubject','signerThumbprint','size','modifiedMs','device','inode'))){throw'bad_identity'};$candidate=Candidate $app;if(-not[string]::Equals([string]$i.canonicalExecutablePath,$candidate,[StringComparison]::OrdinalIgnoreCase)){throw'candidate_changed'};$pin=[B122Host.Pin]::new($candidate,$app-ceq'vscode');$prepared=$null
  try{$sg=Sig $pin.Path;if($i.version-ne1-or[string]$i.application-cne$app-or[string]$i.executableSha256-cne$pin.Sha-or[string]$i.signerSubject-cne$sg[0]-or[string]$i.signerThumbprint-cne$sg[1]-or[long]$i.size-ne$pin.Size-or[long]$i.modifiedMs-ne$pin.MtimeMs-or[string]$i.device-cne$pin.Device-or[string]$i.inode-cne$pin.Inode){throw'identity_changed'};$prepared=[B122Host.Native]::Prepare($pin,$cycle);$b=New-Object byte[] 32;[Security.Cryptography.RandomNumberGenerator]::Create().GetBytes($b);$nonce=-join($b|ForEach-Object{$_.ToString('x2')});$ready=[ordered]@{schema=$schema;version=1;requestId=$rid;kind='ready';action='effect';authorizationNonce=$nonce;mode=$prepared.Mode};if($prepared.Mode-ceq'focus'){$ready.processId=$prepared.Pid;$ready.windowId=('hwnd:{0:x}'-f$prepared.Window.ToInt64())};Out $ready
    $a=(Line)|ConvertFrom-Json;if(-not(Exact $a @('schema','version','requestId','action','kind','authorizationNonce'))-or$a.schema-cne'sxsy-b122.windows-host-action-request'-or$a.version-ne1-or[string]$a.requestId-cne$rid-or$a.action-cne'effect'-or$a.kind-cne'authorize'-or[string]$a.authorizationNonce-cne$nonce){throw'bad_authorization'};$sg2=Sig $pin.Path;if([string]$i.signerSubject-cne$sg2[0]-or[string]$i.signerThumbprint-cne$sg2[1]){throw'signature_changed'};$pid=$prepared.Execute($app);$eff=if($prepared.Mode-ceq'focus'){'focused'}else{'launched'};$o=[ordered]@{schema=$schema;version=1;requestId=$rid;kind='result';action='effect';effect=$eff;processId=$pid};if($eff-ceq'focused'){$o.windowId=('hwnd:{0:x}'-f$prepared.Window.ToInt64())};Out $o
  }finally{if($null-ne$prepared){$prepared.Dispose()}elseif($null-ne$pin){$pin.Dispose()}};exit 0
}catch{$m=[string]$_.Exception.Message;$inner=[string]$_.Exception.GetBaseException().Message;$code=if($m-match'^[a-z][a-z0-9_]{0,63}$'){$m}elseif($inner-match'^[a-z][a-z0-9_]{0,63}$'){$inner}else{'native_'+$stage+'_failure'};Out ([ordered]@{schema=$schema;version=1;requestId=$rid;kind='error';code=$code});exit 65}`;
