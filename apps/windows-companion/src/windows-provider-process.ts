/**
 * Exact Windows-native process/window boundary for installed desktop providers.
 *
 * The companion never launches a provider directly. A separately packaged,
 * SHA-256-pinned helper revalidates and holds the executable/process handles,
 * then pauses at a one-time authorization handshake while the companion runs
 * the final effect barrier supplied by InstalledProviderDesktopLifecycle.
 */
import { spawn } from "node:child_process";
import { createHash, randomBytes } from "node:crypto";
import { createReadStream } from "node:fs";
import { lstat, realpath, stat } from "node:fs/promises";
import { dirname, isAbsolute, resolve } from "node:path";

import type {
  DesktopProviderId,
  ProviderDesktopProcessObservation,
  ProviderDesktopProcessPort,
  ProviderExecutableIdentity,
  ProviderProcessEffectRequest,
  ProviderProductIdentity
} from "./provider-desktop.ts";

const requestSchema = "sxsy-b122.provider-desktop-request" as const;
const responseSchema = "sxsy-b122.provider-desktop-response" as const;
const helperArguments = ["--stdio-v2"] as const;
const digestPattern = /^[a-f0-9]{64}$/;
const surfacePattern = /^hwnd:[a-f0-9]{1,16}$/;
const maximumProtocolBytes = 64 * 1024;
const maximumRequestBytes = 16 * 1024;
const maximumObservations = 64;
const maximumHelperBytes = 256 * 1024 * 1024;
const helperRetirementMs = 2_000;

const desktopProducts: Readonly<Record<DesktopProviderId, ProviderProductIdentity>> = {
  claude_desktop: {
    productId: "anthropic.claude-desktop",
    displayName: "Claude Desktop",
    publisher: "Anthropic, PBC",
    role: "desktop"
  },
  chatgpt_desktop: {
    productId: "openai.chatgpt-desktop",
    displayName: "ChatGPT Desktop",
    publisher: "OpenAI, L.L.C.",
    role: "desktop"
  }
};

export interface ProviderDesktopHelperInvocation {
  readonly helperPath: string;
  readonly helperSha256: string;
  readonly arguments: readonly string[];
  /** Complete environment. It never inherits PATH, credentials, or workspace state. */
  readonly environment: Readonly<Record<string, string>>;
}

export interface ProviderDesktopHelperSession {
  write(line: string): Promise<void>;
  read(): Promise<string>;
  terminate(): Promise<void>;
  wait(): Promise<ProviderDesktopHelperExit>;
}

export interface ProviderDesktopHelperExit {
  readonly code: number;
  readonly signal: NodeJS.Signals | null;
  readonly protocolFailed?: boolean;
  readonly unreadResponses?: number;
}

export interface ProviderDesktopHelperTransport {
  start(invocation: ProviderDesktopHelperInvocation): Promise<ProviderDesktopHelperSession>;
}

export interface WindowsProviderDesktopProcessPortOptions {
  readonly helperPath: string;
  readonly helperSha256: string;
  readonly transport?: ProviderDesktopHelperTransport;
  /** Closed Suite mode: native discovery/focus only, never provider launch. */
  readonly focusOnly?: boolean;
  /** Injectable only so non-Windows protocol tests can prove ambient values are removed. */
  readonly hostEnvironment?: NodeJS.ProcessEnv;
}

/** Native transport used by the installed companion. */
export class NodeProviderDesktopHelperTransport implements ProviderDesktopHelperTransport {
  async start(invocation: ProviderDesktopHelperInvocation): Promise<ProviderDesktopHelperSession> {
    const child = spawn(invocation.helperPath, [...invocation.arguments], {
      cwd: dirname(invocation.helperPath),
      env: { ...invocation.environment },
      shell: false,
      windowsHide: true,
      stdio: ["pipe", "pipe", "pipe"]
    });
    if (!child.stdin || !child.stdout || !child.stderr) {
      child.kill();
      throw new Error("The fixed provider helper did not expose its bounded protocol streams.");
    }

    const queued: string[] = [];
    const readers: Array<{ readonly resolve: (line: string) => void; readonly reject: (error: Error) => void }> = [];
    let buffer = "";
    let stderrBytes = 0;
    let responseBytes = 0;
    let responseLines = 0;
    let terminalError: Error | undefined;
    let exited = false;
    let settleExit!: (value: { readonly code: number; readonly signal: NodeJS.Signals | null }) => void;
    const exit = new Promise<{ readonly code: number; readonly signal: NodeJS.Signals | null }>((resolveExit) => { settleExit = resolveExit; });
    const fail = (error: Error): void => {
      if (!terminalError) terminalError = error;
      queued.length = 0;
      while (readers.length) readers.shift()!.reject(terminalError);
      try { if (!exited) child.kill(); } catch { /* Only the close event proves retirement. */ }
    };
    const emit = (line: string): void => {
      const bytes = Buffer.byteLength(line, "utf8");
      responseBytes += bytes;
      responseLines += 1;
      if (bytes > maximumProtocolBytes || responseBytes > maximumProtocolBytes || responseLines > 4) return fail(new Error("The provider helper exceeded its bounded response budget."));
      const reader = readers.shift();
      if (reader) reader.resolve(line);
      else queued.push(line);
    };

    child.stdout.setEncoding("utf8");
    child.stdout.on("data", (chunk: string) => {
      if (terminalError) return;
      buffer += chunk;
      if (Buffer.byteLength(buffer, "utf8") > maximumProtocolBytes) return fail(new Error("The provider helper emitted an oversized unterminated response."));
      for (let newline = buffer.indexOf("\n"); newline >= 0; newline = buffer.indexOf("\n")) {
        const line = buffer.slice(0, newline).replace(/\r$/, "");
        buffer = buffer.slice(newline + 1);
        emit(line);
      }
    });
    child.stderr.on("data", (chunk: Buffer) => {
      stderrBytes += chunk.byteLength;
      if (stderrBytes > 4_096) fail(new Error("The provider helper exceeded its bounded diagnostic output."));
    });
    child.once("error", () => fail(new Error("The fixed provider helper could not be started.")));
    child.stdin.on("error", () => fail(new Error("The fixed provider helper request stream failed.")));
    child.stdout.on("error", () => fail(new Error("The fixed provider helper response stream failed.")));
    child.stderr.on("error", () => fail(new Error("The fixed provider helper diagnostic stream failed.")));
    child.once("close", (code, signal) => {
      exited = true;
      if (buffer.length > 0 && !terminalError) terminalError = new Error("The provider helper ended with an incomplete response.");
      const error = terminalError ?? new Error("The provider helper exited before its response was complete.");
      while (readers.length) readers.shift()!.reject(error);
      settleExit({ code: code ?? -1, signal });
    });

    return {
      write: async (line) => {
        if (exited || terminalError || child.stdin.destroyed) throw terminalError ?? new Error("The provider helper protocol is closed.");
        if (/\r|\n/.test(line) || Buffer.byteLength(line, "utf8") > maximumRequestBytes) throw new Error("The provider helper request is invalid or oversized.");
        await new Promise<void>((resolveWrite, rejectWrite) => child.stdin!.write(`${line}\n`, (error) => error ? rejectWrite(error) : resolveWrite()));
      },
      read: async () => {
        if (terminalError) throw terminalError;
        const line = queued.shift();
        if (line !== undefined) return line;
        if (exited) throw new Error("The provider helper exited before its response was complete.");
        return new Promise<string>((resolveRead, rejectRead) => readers.push({ resolve: resolveRead, reject: rejectRead }));
      },
      terminate: async () => { if (!exited) child.kill(); },
      wait: async () => ({ ...await exit, protocolFailed: terminalError !== undefined, unreadResponses: queued.length })
    };
  }
}

/**
 * Concrete ProviderDesktopProcessPort. The only variable effect inputs are the
 * already-attested executable identity and the two compiled provider profiles.
 */
export class WindowsProviderDesktopProcessPort implements ProviderDesktopProcessPort {
  private readonly helperPath: string;
  private readonly helperSha256: string;
  private readonly transport: ProviderDesktopHelperTransport;
  private readonly environment: Readonly<Record<string, string>>;
  private readonly focusOnly: boolean;
  private busy = false;
  private owner?: ProviderDesktopHelperSession;

  constructor(options: WindowsProviderDesktopProcessPortOptions) {
    if (options.focusOnly !== undefined && typeof options.focusOnly !== "boolean") throw new Error("The provider helper mode must be a literal boolean.");
    this.focusOnly = options.focusOnly === true;
    if (!isAbsolute(options.helperPath) || !/\.exe$/i.test(options.helperPath) || !digestPattern.test(options.helperSha256)) {
      throw new Error("The provider process port requires an exact absolute helper path and SHA-256 digest.");
    }
    this.helperPath = resolve(options.helperPath);
    this.helperSha256 = options.helperSha256.toLowerCase();
    this.transport = options.transport ?? new NodeProviderDesktopHelperTransport();
    this.environment = strictHelperEnvironment(options.hostEnvironment ?? process.env);
  }

  async listRunning(identity: ProviderExecutableIdentity, signal: AbortSignal): Promise<readonly ProviderDesktopProcessObservation[]> {
    const provider = providerForIdentity(identity);
    return this.withSession(signal, async (session, requestId) => {
      await session.write(encodeRequest({
        schema: requestSchema,
        version: 2,
        requestId,
        action: "list",
        provider,
        identity: nativeIdentity(identity)
      }));
      const response = parseResponse(await session.read(), requestId, "result");
      const observations = parseObservations(response.observations);
      return observations.map((observation) => ({
        processId: observation.processId,
        processStartTime: observation.processStartTime,
        windowId: observation.surfaceId,
        isForeground: observation.isForeground,
        identity
      }));
    });
  }

  async focusExisting(request: ProviderProcessEffectRequest & { readonly process: ProviderDesktopProcessObservation }): Promise<Readonly<{ processId: number }>> {
    validateEffectRequest(request);
    if (request.process.processId <= 0 || !Number.isSafeInteger(request.process.processId) || !surfacePattern.test(request.process.windowId)) {
      throw new Error("The expected provider surface identity is invalid.");
    }
    if (!sameNativeIdentity(request.identity, request.process.identity)) throw new Error("The expected provider process identity changed before native focus.");
    const expectedStartTime = processBirthIdentity(request.process.processStartTime);
    return this.withSession(request.signal, async (session, requestId) => {
      await session.write(encodeRequest({
        schema: requestSchema,
        version: 2,
        requestId,
        action: "focus",
        provider: request.provider,
        identity: nativeIdentity(request.identity),
        expectedProcessId: request.process.processId,
        expectedProcessStartTime: expectedStartTime,
        expectedSurfaceId: request.process.windowId
      }));
      const ready = parseResponse(await session.read(), requestId, "ready");
      const token = authorizationToken(ready.authorizationToken);
      const processId = processIdentity(ready.processId);
      const surfaceId = surfaceIdentity(ready.surfaceId);
      const processStartTime = processBirthIdentity(ready.processStartTime);
      if (processId !== request.process.processId || surfaceId !== request.process.windowId || processStartTime !== expectedStartTime) {
        throw new Error("The exact provider process or surface changed before the final focus barrier.");
      }
      await request.beforeEffect();
      assertNotAborted(request.signal);
      await session.write(authorization(requestId, token));
      const result = parseResponse(await session.read(), requestId, "result");
      if (processIdentity(result.processId) !== processId || surfaceIdentity(result.surfaceId) !== surfaceId || processBirthIdentity(result.processStartTime) !== processStartTime) {
        throw new Error("The provider helper returned a changed focus surface.");
      }
      if (result.windowFocusVerified !== true) throw new Error("The provider helper did not verify native foreground readback.");
      return { processId };
    });
  }

  async launch(request: ProviderProcessEffectRequest & { readonly args: readonly string[]; readonly requireDistinctSurface: boolean }): Promise<Readonly<{
    processId: number;
    surfaceId: string;
    distinctSurface: boolean;
  }>> {
    if (this.focusOnly) throw new Error("The focus-only provider helper cannot launch an application or a fresh surface.");
    validateEffectRequest(request);
    validateFixedLaunchProfile(request.provider, request.args, request.requireDistinctSurface);
    return this.withSession(request.signal, async (session, requestId) => {
      await session.write(encodeRequest({
        schema: requestSchema,
        version: 2,
        requestId,
        action: "launch",
        provider: request.provider,
        identity: nativeIdentity(request.identity),
        args: [...request.args],
        requireDistinctSurface: request.requireDistinctSurface
      }));
      const ready = parseResponse(await session.read(), requestId, "ready");
      const token = authorizationToken(ready.authorizationToken);
      const preexisting = parseSurfaceIds(ready.preexistingSurfaceIds);
      if (!request.requireDistinctSurface && preexisting.length !== 0) {
        throw new Error("A normal provider launch became ambiguous because a surface appeared before authorization.");
      }
      await request.beforeEffect();
      assertNotAborted(request.signal);
      await session.write(authorization(requestId, token));
      const result = parseResponse(await session.read(), requestId, "result");
      const processId = processIdentity(result.processId);
      const surfaceId = surfaceIdentity(result.surfaceId);
      if (typeof result.distinctSurface !== "boolean" || !result.distinctSurface || preexisting.includes(surfaceId)) {
        throw new Error("The provider helper did not prove a new distinct surface.");
      }
      return { processId, surfaceId, distinctSurface: true };
    });
  }

  private async withSession<T>(signal: AbortSignal, run: (session: ProviderDesktopHelperSession, requestId: string) => Promise<T>): Promise<T> {
    assertNotAborted(signal);
    if (this.busy) throw new Error("An exact provider helper operation is already in progress.");
    this.busy = true;
    try {
      // A prior uncertain stop retains the original session. Never replace it
      // merely because a signal was sent or the caller abandoned its request.
      if (this.owner) await this.retire(this.owner);
      return await this.runSession(signal, run);
    } finally { this.busy = false; }
  }

  private async retire(session: ProviderDesktopHelperSession): Promise<ProviderDesktopHelperExit> {
    const unconfirmed = () => Object.assign(new Error("The original provider helper exit is unconfirmed. No replacement was started."), { code: "PROVIDER_HELPER_EXIT_UNCONFIRMED" });
    let timer: ReturnType<typeof setTimeout> | undefined;
    // Termination errors cannot erase ownership. An independent close event may
    // still prove that this exact child has already exited.
    void Promise.resolve().then(() => session.terminate()).catch(() => undefined);
    try {
      const exit = await Promise.race([
        Promise.resolve().then(() => session.wait()),
        new Promise<never>((_resolve, reject) => { timer = setTimeout(() => reject(unconfirmed()), helperRetirementMs); })
      ]);
      if (!exit || !Number.isSafeInteger(exit.code) || exit.code < -1 || exit.code > 0xffffffff || !(exit.signal === null || typeof exit.signal === "string")) throw unconfirmed();
      if (this.owner === session) this.owner = undefined;
      return exit;
    } catch { throw unconfirmed(); }
    finally { clearTimeout(timer); }
  }

  private async runSession<T>(signal: AbortSignal, run: (session: ProviderDesktopHelperSession, requestId: string) => Promise<T>): Promise<T> {
    assertNotAborted(signal);
    const canonicalHelperPath = await this.assertHelperIdentity();
    assertNotAborted(signal);
    const session = await this.transport.start({
      helperPath: canonicalHelperPath,
      helperSha256: this.helperSha256,
      arguments: this.focusOnly ? ["--native-desktop-focus-v2"] : helperArguments,
      environment: this.environment
    });
    this.owner = session;
    let rejectAbort!: (error: Error) => void;
    const aborted = new Promise<never>((_resolve, reject) => { rejectAbort = reject; });
    const abort = () => {
      rejectAbort(new Error("The provider native operation was cancelled before its effect completed."));
    };
    signal.addEventListener("abort", abort, { once: true });
    try {
      if (signal.aborted) {
        abort();
        return await aborted;
      }
      const operation = run(session, randomBytes(24).toString("hex"));
      operation.catch(() => undefined);
      return await Promise.race([operation, aborted]);
    } finally {
      signal.removeEventListener("abort", abort);
      const exit = await this.retire(session);
      if (exit.protocolFailed === true || exit.unreadResponses !== undefined && exit.unreadResponses !== 0)
        throw new Error("The provider helper closed with failed or unconsumed protocol output. Its earlier result was not accepted.");
    }
  }

  private async assertHelperIdentity(): Promise<string> {
    const link = await lstat(this.helperPath).catch(() => { throw new Error("The fixed provider helper identity is unavailable."); });
    if (link.isSymbolicLink()) throw new Error("The fixed provider helper identity cannot be a redirect.");
    const canonical = await realpath(this.helperPath).catch(() => { throw new Error("The fixed provider helper identity cannot be canonicalized."); });
    const metadata = await stat(canonical);
    if (!metadata.isFile() || metadata.size <= 0 || metadata.size > maximumHelperBytes) {
      throw new Error("The fixed provider helper identity changed or is not a bounded file.");
    }
    if (await fileSha256(canonical) !== this.helperSha256) throw new Error("The fixed provider helper digest changed.");
    return canonical;
  }
}

function strictHelperEnvironment(source: NodeJS.ProcessEnv): Readonly<Record<string, string>> {
  const systemRoot = source.SystemRoot ?? source.SYSTEMROOT;
  const windir = source.WINDIR ?? systemRoot;
  if (!systemRoot || !windir || /[\0\r\n]/.test(systemRoot) || /[\0\r\n]/.test(windir)) {
    throw new Error("The fixed provider helper requires the Windows system directories.");
  }
  return { SystemRoot: systemRoot, WINDIR: windir };
}

function validateEffectRequest(request: ProviderProcessEffectRequest): void {
  if (request.shell !== false) throw new Error("The provider process port never permits a shell.");
  if (!/^[A-Za-z0-9:._-]{1,256}$/.test(request.operationId)) throw new Error("The provider operation identity is invalid.");
  const expected = desktopProducts[request.provider];
  if (!sameProduct(expected, request.identity.productIdentity)) throw new Error("The provider product identity is not the fixed desktop catalog identity.");
  nativeIdentity(request.identity);
  assertNotAborted(request.signal);
}

function providerForIdentity(identity: ProviderExecutableIdentity): DesktopProviderId {
  nativeIdentity(identity);
  for (const provider of Object.keys(desktopProducts) as DesktopProviderId[]) {
    if (sameProduct(desktopProducts[provider], identity.productIdentity)) return provider;
  }
  throw new Error("The executable identity is not a fixed desktop provider product.");
}

function validateFixedLaunchProfile(provider: DesktopProviderId, args: readonly string[], fresh: boolean): void {
  const fixed = fresh ? ["--new-window"] : [];
  if (args.length !== fixed.length || args.some((value, index) => value !== fixed[index])) {
    throw new Error("The provider launch arguments do not match the compiled fixed profile.");
  }
  if (!(provider in desktopProducts)) throw new Error("The provider launch profile is not part of the compiled desktop catalog.");
}

function nativeIdentity(identity: ProviderExecutableIdentity): Record<string, unknown> {
  if (!isAbsolute(identity.canonicalExecutablePath) || !/\.exe$/i.test(identity.canonicalExecutablePath) || /[\0\r\n]/.test(identity.canonicalExecutablePath)) {
    throw new Error("The provider executable identity must use one bounded absolute .exe path.");
  }
  if (!digestPattern.test(identity.executableSha256)
    || typeof identity.signerSubject !== "string" || identity.signerSubject.length < 3 || identity.signerSubject.length > 512 || /[\0\r\n]/.test(identity.signerSubject)
    || !/^[a-f0-9]{40,128}$/.test(identity.signerThumbprint)
    || !Number.isSafeInteger(identity.size) || identity.size <= 0
    || !Number.isFinite(identity.modifiedMs) || identity.modifiedMs < 0
    || !decimalIdentity(identity.device)
    || !decimalIdentity(identity.inode)) {
    throw new Error("The provider executable identity is malformed.");
  }
  return {
    canonicalExecutablePath: resolve(identity.canonicalExecutablePath),
    executableSha256: identity.executableSha256,
    signerSubject: identity.signerSubject,
    signerThumbprint: identity.signerThumbprint,
    productIdentity: { ...identity.productIdentity },
    size: identity.size,
    modifiedMs: identity.modifiedMs,
    device: identity.device,
    inode: identity.inode
  };
}

function decimalIdentity(value: unknown): value is string {
  if (typeof value !== "string" || !/^(?:0|[1-9][0-9]{0,19})$/.test(value)) return false;
  try { return BigInt(value) <= 0xffff_ffff_ffff_ffffn; } catch { return false; }
}

function encodeRequest(value: Record<string, unknown>): string {
  const encoded = JSON.stringify(value);
  if (Buffer.byteLength(encoded, "utf8") > maximumRequestBytes) throw new Error("The fixed provider helper request is oversized.");
  return encoded;
}

function authorization(requestId: string, token: string): string {
  return encodeRequest({ schema: requestSchema, version: 2, requestId, kind: "authorize", authorizationToken: token });
}

function parseResponse(line: string, requestId: string, expectedKind: "ready" | "result"): Record<string, unknown> {
  if (typeof line !== "string" || Buffer.byteLength(line, "utf8") > maximumProtocolBytes) throw new Error("The provider helper emitted an oversized response.");
  let value: unknown;
  try { value = JSON.parse(line); } catch { throw new Error("The provider helper emitted an invalid response."); }
  if (!record(value) || value.schema !== responseSchema || value.version !== 2 || value.requestId !== requestId) {
    throw new Error("The provider helper response was not bound to the exact request.");
  }
  if (value.kind === "error") {
    const code = typeof value.code === "string" && /^[a-z0-9_]{1,64}$/.test(value.code) ? value.code : "native_failure";
    throw new Error(`The provider helper failed closed (${code}).`);
  }
  if (value.kind !== expectedKind) throw new Error("The provider helper response arrived in an invalid protocol phase.");
  return value;
}

function parseObservations(value: unknown): readonly { readonly processId: number; readonly processStartTime: string; readonly surfaceId: string; readonly isForeground: boolean }[] {
  if (!Array.isArray(value) || value.length > maximumObservations) throw new Error("The provider helper returned an invalid or ambiguous observation set.");
  const seen = new Set<string>();
  return value.map((observation) => {
    if (!record(observation)) throw new Error("The provider helper returned an invalid observation.");
    const processId = processIdentity(observation.processId);
    const processStartTime = processBirthIdentity(observation.processStartTime);
    const surfaceId = surfaceIdentity(observation.surfaceId);
    if (typeof observation.isForeground !== "boolean") throw new Error("The provider helper returned an invalid foreground observation.");
    if (seen.has(surfaceId)) throw new Error("The provider helper returned duplicate surface identities.");
    seen.add(surfaceId);
    return { processId, processStartTime, surfaceId, isForeground: observation.isForeground };
  });
}

function parseSurfaceIds(value: unknown): readonly string[] {
  if (!Array.isArray(value) || value.length > maximumObservations) throw new Error("The provider helper returned an invalid preexisting surface set.");
  const values = value.map(surfaceIdentity);
  if (new Set(values).size !== values.length) throw new Error("The provider helper returned duplicate preexisting surface identities.");
  return values;
}

function processIdentity(value: unknown): number {
  if (!Number.isSafeInteger(value) || (value as number) <= 0 || (value as number) > 0xffff_ffff) throw new Error("The provider helper returned an invalid process identity.");
  return value as number;
}

function surfaceIdentity(value: unknown): string {
  if (typeof value !== "string" || !surfacePattern.test(value)) throw new Error("The provider helper returned an invalid surface identity.");
  return value;
}

function processBirthIdentity(value: unknown): string {
  if (typeof value !== "string" || !/^[1-9][0-9]{0,19}$/.test(value) || BigInt(value) > 0xffff_ffff_ffff_ffffn) throw new Error("The provider helper returned an invalid process birth identity.");
  return value;
}

function authorizationToken(value: unknown): string {
  if (typeof value !== "string" || !digestPattern.test(value)) throw new Error("The provider helper returned an invalid one-time authorization token.");
  return value;
}

function assertNotAborted(signal: AbortSignal): void {
  if (signal.aborted) throw new Error("The provider native operation was cancelled before its effect.");
}

function sameNativeIdentity(left: ProviderExecutableIdentity, right: ProviderExecutableIdentity): boolean {
  return samePath(left.canonicalExecutablePath, right.canonicalExecutablePath)
    && left.executableSha256 === right.executableSha256
    && left.signerSubject === right.signerSubject
    && left.signerThumbprint === right.signerThumbprint
    && sameProduct(left.productIdentity, right.productIdentity)
    && left.size === right.size
    && left.modifiedMs === right.modifiedMs
    && left.device === right.device
    && left.inode === right.inode;
}

function sameProduct(left: ProviderProductIdentity, right: ProviderProductIdentity): boolean {
  return left.productId === right.productId
    && left.displayName === right.displayName
    && left.publisher === right.publisher
    && left.role === right.role;
}

function samePath(left: string, right: string): boolean {
  const normalize = (value: string) => resolve(value).replaceAll("\\", "/").replace(/\/+$/, "").toLowerCase();
  return normalize(left) === normalize(right);
}

function record(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

async function fileSha256(path: string): Promise<string> {
  const hash = createHash("sha256");
  await new Promise<void>((resolveHash, rejectHash) => {
    const stream = createReadStream(path);
    stream.on("data", (chunk) => hash.update(chunk));
    stream.once("error", rejectHash);
    stream.once("end", resolveHash);
  });
  return hash.digest("hex");
}
