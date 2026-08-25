import { createServer, type Server as HttpsServer, type ServerOptions } from "node:https";
import type { IncomingMessage, RequestListener, ServerResponse } from "node:http";

import type { ProviderAdapterHostService } from "./service.ts";

const maximumBodyBytes = 64 * 1024;
const maximumRequestDurationMs = 60_000;

export interface ProviderHostServerOptions {
  readonly service: ProviderAdapterHostService;
  readonly host: string;
  readonly port: number;
  readonly certificate: Uint8Array;
  readonly privateKey: Uint8Array;
}

export interface ProviderHostRequestListenerOptions { readonly requestDeadlineMs?: number; }

export interface RunningProviderHostServer {
  readonly host: string;
  readonly port: number;
  close(): Promise<void>;
}

/** Production listener: TLS is mandatory and client-selected paths never become outbound destinations. */
export async function startProviderAdapterHttpsServer(options: ProviderHostServerOptions): Promise<RunningProviderHostServer> {
  if (options.host !== "127.0.0.1" && options.host !== "::1") throw new Error("The provider adapter host may listen only on an exact loopback address.");
  if (!Number.isSafeInteger(options.port) || options.port < 1 || options.port > 65_535) throw new Error("The provider adapter host listen port is invalid.");
  const tls: ServerOptions = {
    cert: Buffer.from(options.certificate),
    key: Buffer.from(options.privateKey),
    minVersion: "TLSv1.2",
    requestCert: false,
    rejectUnauthorized: true
  };
  const server = createServer(tls, createProviderHostRequestListener(options.service));
  server.requestTimeout = maximumRequestDurationMs;
  server.headersTimeout = 15_000;
  server.keepAliveTimeout = 5_000;
  await listen(server, options.port, options.host);
  const address = server.address();
  if (!address || typeof address === "string") { await close(server); throw new Error("The provider host did not obtain an exact TCP listener."); }
  return { host: options.host, port: address.port, close: () => close(server) };
}

/** Shared request boundary so tests exercise the same authentication/body/deadline behavior over a real socket. */
export function createProviderHostRequestListener(service: ProviderAdapterHostService, options: ProviderHostRequestListenerOptions = {}): RequestListener {
  const requestDeadlineMs = boundedDeadline(options.requestDeadlineMs ?? maximumRequestDurationMs);
  return (request, response) => { void dispatchHttp(service, request, response, requestDeadlineMs); };
}

async function dispatchHttp(service: ProviderAdapterHostService, request: IncomingMessage, response: ServerResponse, requestDeadlineMs: number): Promise<void> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), requestDeadlineMs);
  timeout.unref?.();
  const onClose = (): void => { if (!request.complete) controller.abort(); };
  request.once("close", onClose);
  try {
    const body = await readBoundedBody(request, controller.signal);
    const pending = service.handle({
      method: request.method ?? "",
      path: exactRequestPath(request.url),
      headers: { authorization: oneHeader(request.headers.authorization) },
      ...(body.byteLength ? { body } : {}),
      signal: controller.signal
    });
    const result = await abortable(pending, controller.signal);
    if (response.headersSent || response.destroyed) return;
    const encoded = Buffer.from(JSON.stringify(result.body), "utf8");
    response.writeHead(result.status, {
      "content-type": "application/json; charset=utf-8",
      "content-length": String(encoded.byteLength),
      "cache-control": "no-store",
      "x-content-type-options": "nosniff"
    });
    if (result.afterResponse) response.once("finish", result.afterResponse);
    response.end(encoded);
  } catch (error) {
    if (response.headersSent || response.destroyed) return;
    const status = error instanceof OversizedBodyError ? 413 : controller.signal.aborted ? 408 : 400;
    const encoded = Buffer.from(JSON.stringify({ schema: "sxsy-b122.provider-host-error", version: 1, status: "blocked", summary: status === 413 ? "The provider host request exceeded its fixed input cap." : status === 408 ? "The provider host request timed out." : "The provider host rejected the HTTP request.", effectDisposition: "not_started" }), "utf8");
    response.writeHead(status, { "content-type": "application/json; charset=utf-8", "content-length": String(encoded.byteLength), "cache-control": "no-store" });
    response.end(encoded);
  } finally {
    clearTimeout(timeout);
    request.removeListener("close", onClose);
  }
}

async function readBoundedBody(request: IncomingMessage, signal: AbortSignal): Promise<Uint8Array> {
  const declared = request.headers["content-length"];
  if (declared !== undefined && (!/^\d+$/.test(declared) || Number(declared) > maximumBodyBytes)) throw new OversizedBodyError();
  const chunks: Buffer[] = [];
  let length = 0;
  for await (const chunk of request) {
    if (signal.aborted) throw new Error("Request cancelled.");
    const bytes = Buffer.from(chunk);
    length += bytes.byteLength;
    if (length > maximumBodyBytes) throw new OversizedBodyError();
    chunks.push(bytes);
  }
  return Buffer.concat(chunks);
}

function exactRequestPath(value: string | undefined): string {
  if (!value || value.length > 512 || /[?#\0\r\n]/.test(value) || !value.startsWith("/")) throw new Error("The provider host path is invalid.");
  return value;
}
function oneHeader(value: string | readonly string[] | undefined): string | undefined { return typeof value === "string" ? value : undefined; }
function abortable<T>(pending: Promise<T>, signal: AbortSignal): Promise<T> { if (signal.aborted) return Promise.reject(new Error("Request cancelled.")); return new Promise<T>((resolve, reject) => { const onAbort = () => { cleanup(); reject(new Error("Request cancelled.")); }; const cleanup = () => signal.removeEventListener("abort", onAbort); signal.addEventListener("abort", onAbort, { once: true }); pending.then((value) => { cleanup(); resolve(value); }, (error) => { cleanup(); reject(error); }); }); }
function boundedDeadline(value: number): number { if (!Number.isSafeInteger(value) || value < 1 || value > maximumRequestDurationMs) throw new Error("The provider host request deadline is invalid."); return value; }
function listen(server: HttpsServer, port: number, host: string): Promise<void> { return new Promise((resolveListen, rejectListen) => { const onError = (error: Error) => { server.removeListener("listening", onListening); rejectListen(error); }; const onListening = () => { server.removeListener("error", onError); resolveListen(); }; server.once("error", onError); server.once("listening", onListening); server.listen(port, host); }); }
function close(server: HttpsServer): Promise<void> { return new Promise((resolveClose, rejectClose) => server.close((error) => error ? rejectClose(error) : resolveClose())); }
class OversizedBodyError extends Error {}
