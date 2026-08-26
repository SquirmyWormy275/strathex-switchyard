import { createHash, createHmac, randomBytes, randomUUID, timingSafeEqual } from "node:crypto";
import { lstat, open, rename, rm, unlink } from "node:fs/promises";
import { createServer, connect, type Server, type Socket } from "node:net";
import { dirname, isAbsolute, join } from "node:path";

import { companionBridgeVersion, isCompanionRequest, type CompanionRequest, type CompanionResponse } from "./bridge.ts";
import type { CompanionRequestContext, CompanionRequestHandler } from "./stdio.ts";
import type { UserSecretProtector } from "./windows-secret.ts";
import { createSealedRandomToken } from "./windows-secret.ts";

export const maxPipeFrameBytes = 64 * 1024;
const defaultPipeTimeoutMs = 5_000;
const maximumPipeConfigurationBytes = 64 * 1024;
const maximumSealedTokenCharacters = 16 * 1024;

export interface AuthenticatedPipeConfiguration {
  readonly version: 1;
  readonly pipePath: string;
  /** DPAPI/host-protected token only. This record never stores a clear token. */
  readonly sealedToken: string;
}

interface AuthenticatedEnvelope {
  readonly version: 2;
  readonly clientNonce: string;
  readonly serverNonce: string;
  readonly proof: string;
  readonly request: CompanionRequest;
}

interface ClientHello { readonly version: 2; readonly clientNonce: string; }
interface ServerChallenge { readonly version: 2; readonly clientNonce: string; readonly serverNonce: string; readonly proof: string; }
interface AuthenticatedResponseEnvelope { readonly version: 2; readonly response: CompanionResponse; readonly proof: string; }

export interface AuthenticatedPipeServerOptions {
  readonly timeoutMs?: number;
  readonly maxFrameBytes?: number;
  readonly drainTimeoutMs?: number;
}

export function defaultPipePath(stateDirectory: string, suffix?: string): string {
  const suppliedSuffix = suffix ?? randomUUID();
  const safeSuffix = suppliedSuffix.replace(/[^a-zA-Z0-9-]/g, "").slice(0, 48);
  if (!safeSuffix) throw new Error("A local pipe suffix is required.");
  return process.platform === "win32"
    ? `\\\\.\\pipe\\sxsy-b122-${safeSuffix}`
    : join(stateDirectory, `sxsy-b122-${safeSuffix}.sock`);
}

export async function createPipeConfiguration(stateDirectory: string, protector: UserSecretProtector, suffix?: string): Promise<AuthenticatedPipeConfiguration> {
  const configuration: AuthenticatedPipeConfiguration = {
    version: 1,
    pipePath: defaultPipePath(stateDirectory, suffix),
    sealedToken: await createSealedRandomToken(protector)
  };
  assertLocalPipePath(configuration.pipePath);
  return configuration;
}

/** Persist public endpoint metadata and an opaque sealed token only. */
export async function savePipeConfiguration(filePath: string, configuration: AuthenticatedPipeConfiguration): Promise<void> {
  if (!isPipeConfiguration(configuration)) throw new Error("Refusing to persist an invalid local pipe configuration.");
  const bytes = Buffer.from(`${JSON.stringify(configuration)}\n`, "utf8");
  if (bytes.byteLength > maximumPipeConfigurationBytes) { bytes.fill(0); throw new Error("The local pipe configuration is oversized."); }
  const temporary = `${filePath}.${randomUUID()}.tmp`;
  try {
    const handle = await open(temporary, "wx", 0o600);
    try { await handle.writeFile(bytes); await handle.sync(); }
    finally { await handle.close(); }
    await rename(temporary, filePath);
  } finally {
    bytes.fill(0);
    await rm(temporary, { force: true }).catch(() => undefined);
  }
}

export async function loadPipeConfiguration(filePath: string): Promise<AuthenticatedPipeConfiguration> {
  const value: unknown = JSON.parse(await readBoundedConfiguration(filePath));
  if (!isPipeConfiguration(value)) throw new Error("The local pipe configuration is invalid.");
  return value;
}

async function readBoundedConfiguration(filePath: string): Promise<string> {
  const before = await lstat(filePath);
  if (!before.isFile() || before.isSymbolicLink() || before.size < 2 || before.size > maximumPipeConfigurationBytes) throw new Error("The local pipe configuration file is invalid or oversized.");
  const handle = await open(filePath, "r");
  const bytes = Buffer.alloc(maximumPipeConfigurationBytes + 1);
  try {
    const opened = await handle.stat();
    if (!opened.isFile() || opened.size !== before.size) throw new Error("The local pipe configuration changed during validation.");
    let offset = 0;
    while (offset < bytes.byteLength) {
      const { bytesRead } = await handle.read(bytes, offset, bytes.byteLength - offset, null);
      if (bytesRead === 0) break;
      offset += bytesRead;
    }
    if (offset < 2 || offset > maximumPipeConfigurationBytes || offset !== opened.size) throw new Error("The local pipe configuration changed or is oversized.");
    return bytes.subarray(0, offset).toString("utf8");
  } finally { bytes.fill(0); await handle.close(); }
}

export class AuthenticatedPipeServer {
  private readonly configuration: AuthenticatedPipeConfiguration;
  private readonly protector: UserSecretProtector;
  private readonly handler: CompanionRequestHandler;
  private readonly timeoutMs: number;
  private readonly maxFrameBytes: number;
  private readonly drainTimeoutMs: number;
  private server?: Server;
  private token?: Buffer;
  private readonly sockets = new Set<Socket>();
  private readonly activeHandlers = new Set<Promise<void>>();
  private readonly activeRequestControllers = new Set<AbortController>();
  private stopping = false;
  private stopPromise?: Promise<void>;

  constructor(configuration: AuthenticatedPipeConfiguration, protector: UserSecretProtector, handler: CompanionRequestHandler, options: AuthenticatedPipeServerOptions = {}) {
    if (!isPipeConfiguration(configuration)) throw new Error("The local pipe configuration is invalid.");
    this.configuration = configuration;
    this.protector = protector;
    this.handler = handler;
    this.timeoutMs = positiveBounded(options.timeoutMs ?? defaultPipeTimeoutMs, "timeout");
    this.maxFrameBytes = positiveBounded(options.maxFrameBytes ?? maxPipeFrameBytes, "frame", 256 * 1024);
    this.drainTimeoutMs = positiveBounded(options.drainTimeoutMs ?? 10_000, "handler drain");
  }

  async start(): Promise<void> {
    if (this.server) throw new Error("The authenticated companion pipe is already started.");
    if (this.stopping) throw new Error("The authenticated companion pipe cannot restart after shutdown begins.");
    assertLocalPipePath(this.configuration.pipePath);
    const opened = await this.protector.open(this.configuration.sealedToken);
    const token = Buffer.from(opened);
    opened.fill(0);
    if (token.length < 32) { token.fill(0); throw new Error("The protected local pipe token is too short."); }
    this.stopping = false;
    this.stopPromise = undefined;
    this.token = token;
    try {
      if (process.platform !== "win32") await unlink(this.configuration.pipePath).catch(() => undefined);
      this.server = createServer((socket) => this.accept(socket));
      await new Promise<void>((resolve, reject) => {
        this.server!.once("error", reject);
        this.server!.listen(this.configuration.pipePath, resolve);
      });
    } catch (error) {
      this.server = undefined;
      this.token?.fill(0);
      this.token = undefined;
      throw error;
    }
  }

  stop(): Promise<void> {
    if (this.stopPromise) return this.stopPromise;
    this.stopping = true;
    const attempt = this.stopInternal();
    this.stopPromise = attempt;
    void attempt.catch(() => { if (this.stopPromise === attempt) this.stopPromise = undefined; });
    return attempt;
  }

  private async stopInternal(): Promise<void> {
    const server = this.server;
    this.server = undefined;
    for (const controller of this.activeRequestControllers) controller.abort();
    for (const socket of this.sockets) socket.destroy();
    this.sockets.clear();
    const failures: Error[] = [];
    if (server) {
      try { await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve())); }
      catch (error) { failures.push(error instanceof Error ? error : new Error("The authenticated companion pipe server could not close.")); }
    }
    try { await this.drainHandlers(); }
    catch (error) { failures.push(error instanceof Error ? error : new Error("The authenticated companion pipe handlers could not drain.")); }
    try {
      if (process.platform !== "win32") await unlink(this.configuration.pipePath).catch(() => undefined);
    } finally {
      this.token?.fill(0);
      this.token = undefined;
    }
    if (failures.length) throw new AggregateError(failures, "The authenticated companion pipe did not stop cleanly.");
  }

  private async drainHandlers(): Promise<void> {
    if (!this.activeHandlers.size) return;
    let timeoutHandle: ReturnType<typeof setTimeout> | undefined;
    const timeout = new Promise<"timeout">((resolveTimeout) => {
      timeoutHandle = setTimeout(() => resolveTimeout("timeout"), this.drainTimeoutMs);
    });
    const drained = Promise.allSettled([...this.activeHandlers]).then(() => "drained" as const);
    const outcome = await Promise.race([drained, timeout]);
    if (timeoutHandle !== undefined) clearTimeout(timeoutHandle);
    if (outcome === "timeout") throw new Error("The authenticated companion pipe could not drain active handlers before shutdown.");
  }

  private accept(socket: Socket): void {
    if (!this.server || this.stopping) {
      socket.destroy();
      return;
    }
    this.sockets.add(socket);
    const forget = (): void => { this.sockets.delete(socket); };
    socket.once("close", forget);
    let pending = Buffer.alloc(0);
    let state: "hello" | "request" | "done" = "hello";
    let clientNonce: string | undefined;
    let serverNonce: string | undefined;
    let processing = false;
    socket.setTimeout(this.timeoutMs, () => socket.destroy());
    socket.once("error", () => undefined);
    socket.on("data", (chunk: Buffer) => {
      if (state === "done" || pending.length + chunk.length > this.maxFrameBytes + 1) {
        socket.destroy();
        return;
      }
      pending = Buffer.concat([pending, chunk]);
      if (processing) return;
      processing = true;
      const work = Promise.resolve().then(async () => {
        try {
          while (state !== "done") {
            const newline = pending.indexOf(0x0a);
            if (newline < 0) break;
            if (newline > this.maxFrameBytes) { socket.destroy(); state = "done"; break; }
            const line = pending.subarray(0, newline).toString("utf8");
            pending = pending.subarray(newline + 1);
            if (state === "hello") {
              const hello: unknown = JSON.parse(line);
              if (!isClientHello(hello) || !this.token) { socket.destroy(); state = "done"; break; }
              clientNonce = hello.clientNonce;
              serverNonce = randomBytes(32).toString("base64");
              const challenge: ServerChallenge = {
                version: 2,
                clientNonce,
                serverNonce,
                proof: pipeProof(this.token, "server", clientNonce, serverNonce)
              };
              socket.write(`${JSON.stringify(challenge)}\n`, "utf8");
              state = "request";
              continue;
            }
            if (!clientNonce || !serverNonce) { socket.destroy(); state = "done"; break; }
            state = "done";
            if (this.stopping || pending.length) { socket.destroy(); break; }
            await this.respond(socket, line, clientNonce, serverNonce);
          }
          if (state !== "done" && pending.length > this.maxFrameBytes) socket.destroy();
        } catch { socket.destroy(); state = "done"; }
        finally { processing = false; }
      });
      this.activeHandlers.add(work);
      void work.finally(() => this.activeHandlers.delete(work));
    });
  }

  private async respond(socket: Socket, line: string, clientNonce: string, serverNonce: string): Promise<void> {
    const fallback = invalidPipeResponse("invalid", "The companion rejected an unauthenticated local request.");
    let response = fallback;
    let controller: AbortController | undefined;
    let requestAborted = false;
    const abortRequest = (): void => { controller?.abort(); };
    try {
      if (this.stopping) throw new Error("stopping");
      const envelope: unknown = JSON.parse(line);
      if (!isAuthenticatedEnvelope(envelope) || !this.token || envelope.clientNonce !== clientNonce || envelope.serverNonce !== serverNonce
        || !constantTimeTextMatches(envelope.proof, pipeProof(this.token, "client", clientNonce, serverNonce, JSON.stringify(envelope.request)))) {
        throw new Error("unauthenticated");
      }
      controller = new AbortController();
      this.activeRequestControllers.add(controller);
      socket.once("close", abortRequest);
      socket.once("error", abortRequest);
      response = await waitForRequest(this.handler.handle(envelope.request, { signal: controller.signal } satisfies CompanionRequestContext), controller.signal);
    } catch {
      // Do not reveal whether a pipe, token, method, or request ID was valid.
    } finally {
      if (controller) {
        requestAborted = controller.signal.aborted;
        socket.off("close", abortRequest);
        socket.off("error", abortRequest);
        this.activeRequestControllers.delete(controller);
        controller.abort();
      }
    }
    if (requestAborted || socket.destroyed || this.stopping) return;
    const responseJson = JSON.stringify(response);
    const serialized = JSON.stringify({ version: 2, response, proof: pipeProof(this.token ?? Buffer.alloc(0), "response", clientNonce, serverNonce, responseJson) } satisfies AuthenticatedResponseEnvelope);
    if (Buffer.byteLength(serialized, "utf8") > this.maxFrameBytes) {
      socket.destroy();
      return;
    }
    socket.end(`${serialized}\n`);
  }
}

/** One request per new local named-pipe connection; no TCP or endpoint override exists. */
export class AuthenticatedPipeClient {
  private readonly configuration: AuthenticatedPipeConfiguration;
  private readonly protector: UserSecretProtector;
  private readonly timeoutMs: number;
  private readonly maxFrameBytes: number;

  constructor(configuration: AuthenticatedPipeConfiguration, protector: UserSecretProtector, options: AuthenticatedPipeServerOptions = {}) {
    if (!isPipeConfiguration(configuration)) throw new Error("The local pipe configuration is invalid.");
    this.configuration = configuration;
    this.protector = protector;
    this.timeoutMs = positiveBounded(options.timeoutMs ?? defaultPipeTimeoutMs, "timeout");
    this.maxFrameBytes = positiveBounded(options.maxFrameBytes ?? maxPipeFrameBytes, "frame", 256 * 1024);
  }

  async request(request: CompanionRequest): Promise<CompanionResponse> {
    if (!isCompanionRequest(request)) throw new Error("The local companion request is invalid.");
    const opened = await this.protector.open(this.configuration.sealedToken);
    const token = Buffer.from(opened);
    try {
      if (token.length < 32) throw new Error("The protected local pipe token is too short.");
      const requestJson = JSON.stringify(request);
      if (Buffer.byteLength(requestJson, "utf8") > this.maxFrameBytes) throw new Error("The local companion request is too large.");
      return await this.roundTrip(request, requestJson, request.id, token);
    } finally {
      token.fill(0);
      opened.fill(0);
    }
  }

  private roundTrip(request: CompanionRequest, requestJson: string, requestId: string, token: Buffer): Promise<CompanionResponse> {
    return new Promise<CompanionResponse>((resolve, reject) => {
      const socket = connect(this.configuration.pipePath);
      let pending = Buffer.alloc(0);
      let state: "challenge" | "response" | "done" = "challenge";
      const clientNonce = randomBytes(32).toString("base64");
      let serverNonce: string | undefined;
      let settled = false;
      const finish = (work: () => void): void => {
        if (settled) return;
        settled = true;
        socket.destroy();
        work();
      };
      socket.setTimeout(this.timeoutMs, () => finish(() => reject(new Error("The local companion pipe timed out."))));
      socket.once("error", () => finish(() => reject(new Error("The local companion pipe is unavailable."))));
      socket.once("end", () => finish(() => reject(new Error("The local companion pipe closed before an authenticated response."))));
      socket.once("close", () => finish(() => reject(new Error("The local companion pipe closed before an authenticated response."))));
      socket.on("data", (chunk: Buffer) => {
        if (pending.length + chunk.length > this.maxFrameBytes + 1) return finish(() => reject(new Error("The local companion response is too large.")));
        pending = Buffer.concat([pending, chunk]);
        while (state !== "done") {
          const newline = pending.indexOf(0x0a);
          if (newline < 0) return;
          const line = pending.subarray(0, newline).toString("utf8");
          pending = pending.subarray(newline + 1);
          try {
            const parsed: unknown = JSON.parse(line);
            if (state === "challenge") {
              if (!isServerChallenge(parsed) || parsed.clientNonce !== clientNonce || !constantTimeTextMatches(parsed.proof, pipeProof(token, "server", clientNonce, parsed.serverNonce))) throw new Error("invalid server proof");
              serverNonce = parsed.serverNonce;
              const envelope: AuthenticatedEnvelope = { version: 2, clientNonce, serverNonce, proof: pipeProof(token, "client", clientNonce, serverNonce, requestJson), request };
              const message = JSON.stringify(envelope);
              if (Buffer.byteLength(message, "utf8") > this.maxFrameBytes) throw new Error("request too large");
              state = "response";
              socket.write(`${message}\n`, "utf8");
              continue;
            }
            if (!serverNonce || !isAuthenticatedResponseEnvelope(parsed)) throw new Error("invalid response envelope");
            const responseJson = JSON.stringify(parsed.response);
            if (!constantTimeTextMatches(parsed.proof, pipeProof(token, "response", clientNonce, serverNonce, responseJson)) || parsed.response.id !== requestId) throw new Error("invalid response proof");
            state = "done";
            if (pending.length) throw new Error("trailing response data");
            finish(() => resolve(parsed.response));
          } catch {
            state = "done";
            finish(() => reject(new Error("The local companion response is invalid.")));
          }
        }
      });
      socket.once("connect", () => socket.write(`${JSON.stringify({ version: 2, clientNonce } satisfies ClientHello)}\n`, "utf8"));
    });
  }
}

function assertLocalPipePath(path: string): void {
  const valid = process.platform === "win32"
    ? /^\\\\\.\\pipe\\sxsy-b122-[a-zA-Z0-9-]{1,48}$/.test(path)
    : isAbsolute(path) && !path.includes("\0") && path.endsWith(".sock") && dirname(path) !== path;
  if (!valid) throw new Error("The companion transport accepts only a local B122 named pipe or Unix-domain socket path.");
}

function isPipeConfiguration(value: unknown): value is AuthenticatedPipeConfiguration {
  if (!isRecord(value) || !exactKeys(value, ["version", "pipePath", "sealedToken"]) || value.version !== 1 || typeof value.pipePath !== "string"
    || typeof value.sealedToken !== "string" || !/^[A-Za-z0-9+/=:_-]+$/.test(value.sealedToken) || value.sealedToken.length > maximumSealedTokenCharacters) return false;
  try { assertLocalPipePath(value.pipePath); return true; } catch { return false; }
}

function isAuthenticatedEnvelope(value: unknown): value is AuthenticatedEnvelope {
  return isRecord(value) && exactKeys(value, ["version", "clientNonce", "serverNonce", "proof", "request"]) && value.version === 2 && isNonce(value.clientNonce) && isNonce(value.serverNonce) && isProof(value.proof) && isCompanionRequest(value.request);
}

function isClientHello(value: unknown): value is ClientHello { return isRecord(value) && exactKeys(value, ["version", "clientNonce"]) && value.version === 2 && isNonce(value.clientNonce); }
function isServerChallenge(value: unknown): value is ServerChallenge { return isRecord(value) && exactKeys(value, ["version", "clientNonce", "serverNonce", "proof"]) && value.version === 2 && isNonce(value.clientNonce) && isNonce(value.serverNonce) && isProof(value.proof); }
function isAuthenticatedResponseEnvelope(value: unknown): value is AuthenticatedResponseEnvelope { return isRecord(value) && exactKeys(value, ["version", "response", "proof"]) && value.version === 2 && isCompanionResponse(value.response) && isProof(value.proof); }

function isCompanionResponse(value: unknown): value is CompanionResponse {
  return isRecord(value) && value.version === companionBridgeVersion && typeof value.id === "string" && typeof value.ok === "boolean";
}

function isRecord(value: unknown): value is Record<string, unknown> { return typeof value === "object" && value !== null && !Array.isArray(value); }
function invalidPipeResponse(id: string, message: string): CompanionResponse { return { version: companionBridgeVersion, id, ok: false, error: { code: "companion_unavailable", message } }; }
function positiveBounded(value: number, label: string, maximum = 60_000): number { if (!Number.isSafeInteger(value) || value < 100 || value > maximum) throw new Error(`The local pipe ${label} is outside safe bounds.`); return value; }
function constantTimeMatches(candidate: Buffer, expected: Buffer): boolean { return candidate.length === expected.length && timingSafeEqual(candidate, expected); }
function constantTimeTextMatches(candidate: string, expected: string): boolean { return constantTimeMatches(Buffer.from(candidate, "base64"), Buffer.from(expected, "base64")); }
function pipeProof(token: Buffer, role: "server" | "client" | "response", clientNonce: string, serverNonce: string, document = ""): string {
  const documentDigest = createHash("sha256").update(document).digest("hex");
  return createHmac("sha256", token).update(`sxsy-b122-pipe-v2\0${role}\0${clientNonce}\0${serverNonce}\0${documentDigest}`).digest("base64");
}
function isNonce(value: unknown): value is string { if (typeof value !== "string" || !/^[A-Za-z0-9+/]+={0,2}$/.test(value)) return false; try { return Buffer.from(value, "base64").length === 32; } catch { return false; } }
function isProof(value: unknown): value is string { return typeof value === "string" && /^[A-Za-z0-9+/]+={0,2}$/.test(value) && Buffer.from(value, "base64").length === 32; }
function exactKeys(value: Record<string, unknown>, keys: readonly string[]): boolean { return Object.keys(value).length === keys.length && keys.every((key) => key in value); }

function waitForRequest<T>(operation: Promise<T>, signal: AbortSignal): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    let settled = false;
    const finish = (work: () => void): void => {
      if (settled) return;
      settled = true;
      signal.removeEventListener("abort", aborted);
      work();
    };
    const aborted = (): void => finish(() => reject(new Error("The authenticated companion request was aborted.")));
    signal.addEventListener("abort", aborted, { once: true });
    operation.then(
      (value) => finish(() => resolve(value)),
      (error: unknown) => finish(() => reject(error))
    );
    if (signal.aborted) aborted();
  });
}
