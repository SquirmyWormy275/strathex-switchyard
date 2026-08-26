import { createInterface } from "node:readline";
import type { Readable, Writable } from "node:stream";
import { companionBridgeVersion, isCompanionMethod, isRecord, type CompanionRequest, type CompanionResponse } from "./bridge.ts";
import { CompanionService } from "./service.ts";

const maxJsonLineBytes = 64 * 1024;

/** Both the simple service and durable endpoint share this local-only boundary. */
export interface CompanionRequestContext {
  readonly signal?: AbortSignal;
}

export interface CompanionRequestHandler {
  handle(request: CompanionRequest, context?: CompanionRequestContext): Promise<CompanionResponse>;
}

/**
 * Serve one local companion request per UTF-8 JSON line and emit exactly one
 * JSON response line. The protocol is intentionally stdin/stdout only: it
 * opens no listener and has no network fallback.
 */
export async function serveJsonLines(
  input: Readable,
  output: Writable,
  service: CompanionRequestHandler = new CompanionService()
): Promise<void> {
  const lines = createInterface({ input, crlfDelay: Infinity });
  for await (const line of lines) {
    const response = await handleJsonLine(line, service);
    if (response) output.write(`${JSON.stringify(response)}\n`);
  }
}

/** Pure line handler retained for deterministic tests and embedding hosts. */
export async function handleJsonLine(line: string, service: CompanionRequestHandler, context?: CompanionRequestContext): Promise<CompanionResponse | undefined> {
  if (!line.trim()) return undefined;
  if (Buffer.byteLength(line, "utf8") > maxJsonLineBytes) {
    return invalidResponse("invalid", "The companion rejected an oversized JSON-lines request.");
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(line) as unknown;
  } catch {
    return invalidResponse("invalid", "The companion received malformed JSON.");
  }

  if (!isRecord(parsed) || typeof parsed.id !== "string" || typeof parsed.version !== "number" || !isCompanionMethod(parsed.method)) {
    return invalidResponse(isRecord(parsed) && typeof parsed.id === "string" ? parsed.id : "invalid", "The companion received an invalid JSON-lines request.");
  }

  const request: CompanionRequest = {
    version: parsed.version as typeof companionBridgeVersion,
    id: parsed.id,
    method: parsed.method,
    payload: parsed.payload
  };
  return service.handle(request, context);
}

export function invalidResponse(id: string, message: string): CompanionResponse {
  return {
    version: companionBridgeVersion,
    id,
    ok: false,
    error: { code: "invalid_request", message }
  };
}

/**
 * Intended executable entry point for a deliberately launched local companion
 * process. The caller owns process startup and authentication; no extension
 * command silently starts an arbitrary configured executable.
 */
export async function runCompanionStdio(service: CompanionRequestHandler = new CompanionService()): Promise<void> {
  await serveJsonLines(process.stdin, process.stdout, service);
}
