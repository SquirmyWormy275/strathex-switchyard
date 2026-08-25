import assert from "node:assert/strict";
import { createServer, request as httpRequest } from "node:http";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { CodexProviderAdapterBackend, FixtureProviderRuntimePort } from "../src/backends.ts";
import { createProviderHostRequestListener } from "../src/server.ts";
import { ProviderAdapterHostService } from "../src/service.ts";
import { createProviderHostStore } from "../src/state.ts";

const token = "a".repeat(64);

test("the real HTTP request boundary enforces authentication, exact paths, and bounded bodies", async (context) => {
  const root = await mkdtemp(join(tmpdir(), "b122-provider-http-"));
  context.after(async () => rm(root, { recursive: true, force: true }));
  const service = new ProviderAdapterHostService({
    authenticationToken: token,
    store: createProviderHostStore(join(root, "state.jsonl"), token),
    backends: [new CodexProviderAdapterBackend(new FixtureProviderRuntimePort("codex"))]
  });
  // Production composes this exact request boundary with node:https. Plain HTTP
  // is used here only to avoid shipping a test private key in the repository.
  const server = createServer(createProviderHostRequestListener(service));
  await new Promise<void>((resolve, reject) => { server.once("error", reject); server.listen(0, "127.0.0.1", resolve); });
  context.after(async () => new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve())));
  const address = server.address();
  assert.ok(address && typeof address !== "string");

  assert.equal((await send(address.port, "/v1/b122/health", "GET", "Bearer wrong")).status, 401);
  assert.equal((await send(address.port, "/v1/b122/health", "GET", `Bearer ${token}`)).status, 200);
  assert.equal((await send(address.port, "/v1/b122/health?target=changed", "GET", `Bearer ${token}`)).status, 400);
  assert.equal((await send(address.port, "/v1/b122/handshake/codex", "POST", `Bearer ${token}`, "x".repeat(65 * 1024))).status, 413);

  const connected = await send(address.port, "/v1/b122/handshake/codex", "POST", `Bearer ${token}`, JSON.stringify({
    schema: "sxsy-b122.provider-handshake-request", version: 1, sessionId: "codex-session", provider: "codex",
    targetSnapshotId: "b".repeat(64), repositoryRoot: "C:\\repo", branch: "feature/provider-host",
    head: "d".repeat(40), requestedAt: "2026-08-25T12:00:00.000Z"
  }));
  assert.equal(connected.status, 503);
  assert.equal((connected.body as { schema: string }).schema, "sxsy-b122.provider-host-error");
});

test("the socket boundary returns a bounded failure when a provider port ignores cancellation", async (context) => {
  const hanging = { handle: async () => new Promise<never>(() => undefined) } as unknown as ProviderAdapterHostService;
  const server = createServer(createProviderHostRequestListener(hanging, { requestDeadlineMs: 25 }));
  await new Promise<void>((resolve, reject) => { server.once("error", reject); server.listen(0, "127.0.0.1", resolve); });
  context.after(async () => new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve())));
  const address = server.address();
  assert.ok(address && typeof address !== "string");
  const started = Date.now();
  const result = await send(address.port, "/v1/b122/health", "GET", `Bearer ${token}`);
  assert.equal(result.status, 408);
  assert.ok(Date.now() - started < 1_000);
});

function send(port: number, path: string, method: string, authorization: string, body?: string): Promise<{ status: number; body: unknown }> {
  return new Promise((resolve, reject) => {
    const request = httpRequest({ hostname: "127.0.0.1", port, path, method, headers: { authorization, ...(body ? { "content-length": String(Buffer.byteLength(body)), "content-type": "application/json" } : {}) } }, (response) => {
      const chunks: Buffer[] = [];
      response.on("data", (chunk) => chunks.push(Buffer.from(chunk)));
      response.once("end", () => {
        let parsed: unknown;
        try { parsed = JSON.parse(Buffer.concat(chunks).toString("utf8")); } catch { parsed = undefined; }
        resolve({ status: response.statusCode ?? 0, body: parsed });
      });
    });
    request.once("error", reject);
    if (body) request.write(body);
    request.end();
  });
}
