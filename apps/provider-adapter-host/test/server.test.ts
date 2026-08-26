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
    backends: [new CodexProviderAdapterBackend(new FixtureProviderRuntimePort("codex"))],
    dispatchLease: { authenticationKey: "c".repeat(64), host: { configurationSha256: "1".repeat(64), lifecycleNonceSha256: "2".repeat(64), tlsSpkiSha256: "3".repeat(64) } }
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
  assert.equal((result.body as { effectDisposition: string }).effectDisposition, "not_started");
  assert.ok(Date.now() - started < 1_000);
});

test("the request deadline bounds an incomplete body without waiting for another client byte", async (context) => {
  const unreachable = { handle: async () => { throw new Error("an incomplete body must not reach the service"); } } as unknown as ProviderAdapterHostService;
  const server = createServer(createProviderHostRequestListener(unreachable, { requestDeadlineMs: 25 }));
  await new Promise<void>((resolve, reject) => { server.once("error", reject); server.listen(0, "127.0.0.1", resolve); });
  context.after(async () => new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve())));
  const address = server.address();
  assert.ok(address && typeof address !== "string");
  const started = Date.now();
  let client!: ReturnType<typeof httpRequest>;
  const result = new Promise<{ status: number; body: unknown }>((resolve, reject) => {
    client = httpRequest({ hostname: "127.0.0.1", port: address.port, path: "/v1/b122/handshake/codex", method: "POST", headers: { authorization: `Bearer ${token}`, "content-length": "2" } }, (response) => {
      const chunks: Buffer[] = [];
      response.on("data", (chunk) => chunks.push(Buffer.from(chunk)));
      response.once("end", () => {
        try { resolve({ status: response.statusCode ?? 0, body: JSON.parse(Buffer.concat(chunks).toString("utf8")) }); }
        catch (error) { reject(error); }
      });
    });
    client.once("error", reject);
    client.write("{");
  });
  const bounded = await result.finally(() => client.destroy());
  assert.equal(bounded.status, 408);
  assert.equal((bounded.body as { effectDisposition: string }).effectDisposition, "not_started");
  assert.ok(Date.now() - started < 1_000);
});

test("the socket timeout reports ambiguous only after the service crosses its durable effect boundary", async (context) => {
  const hanging = {
    handle: async (input: { effectProgress?: { markAmbiguous(): void } }) => {
      input.effectProgress?.markAmbiguous();
      return new Promise<never>(() => undefined);
    }
  } as unknown as ProviderAdapterHostService;
  const server = createServer(createProviderHostRequestListener(hanging, { requestDeadlineMs: 25 }));
  await new Promise<void>((resolve, reject) => { server.once("error", reject); server.listen(0, "127.0.0.1", resolve); });
  context.after(async () => new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve())));
  const address = server.address();
  assert.ok(address && typeof address !== "string");
  const result = await send(address.port, "/v1/b122/automation/compound_capture", "POST", `Bearer ${token}`, "{}");
  assert.equal(result.status, 408);
  assert.equal((result.body as { effectDisposition: string }).effectDisposition, "ambiguous");
});

test("a client disconnect after a complete request aborts the exact in-flight provider signal", async (context) => {
  let started!: () => void;
  let aborted!: () => void;
  const providerStarted = new Promise<void>((resolve) => { started = resolve; });
  const providerAborted = new Promise<void>((resolve) => { aborted = resolve; });
  const hanging = {
    handle: async (input: { signal?: AbortSignal }) => {
      assert.ok(input.signal);
      started();
      return new Promise<never>((_resolve, reject) => {
        const onAbort = () => { aborted(); reject(new Error("provider request aborted")); };
        if (input.signal!.aborted) onAbort(); else input.signal!.addEventListener("abort", onAbort, { once: true });
      });
    }
  } as unknown as ProviderAdapterHostService;
  const server = createServer(createProviderHostRequestListener(hanging, { requestDeadlineMs: 5_000 }));
  await new Promise<void>((resolve, reject) => { server.once("error", reject); server.listen(0, "127.0.0.1", resolve); });
  context.after(async () => new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve())));
  const address = server.address();
  assert.ok(address && typeof address !== "string");

  const client = httpRequest({ hostname: "127.0.0.1", port: address.port, path: "/v1/b122/observe/session/codex", method: "POST", headers: { authorization: `Bearer ${token}`, "content-length": "2" } });
  client.on("error", () => undefined);
  client.end("{}");
  await providerStarted;
  client.destroy();
  await Promise.race([
    providerAborted,
    new Promise<never>((_resolve, reject) => setTimeout(() => reject(new Error("the provider signal was not aborted after client disconnect")), 500))
  ]);
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
