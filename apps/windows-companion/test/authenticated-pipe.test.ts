import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { connect, createServer } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { AuthenticatedPipeClient, AuthenticatedPipeServer, createPipeConfiguration, loadPipeConfiguration, savePipeConfiguration } from "../src/authenticated-pipe.ts";
import { companionBridgeVersion, type CompanionRequest, type CompanionResponse } from "../src/bridge.ts";
import { DpapiJournalAuthenticator, FakeUserSecretProtector, WindowsDpapiCurrentUserProtector } from "../src/windows-secret.ts";

const request: CompanionRequest = { version: companionBridgeVersion, id: "pipe-ping", method: "ping" };

test("authenticated local pipe carries the candidate bridge protocol without a clear persisted token", async (context) => {
  const directory = await mkdtemp(join(tmpdir(), "sxsy-b122-pipe-"));
  context.after(async () => { await rm(directory, { recursive: true, force: true }); });
  const protector = new FakeUserSecretProtector();
  const configuration = await createPipeConfiguration(directory, protector, `test-${Date.now()}`);
  const file = join(directory, "authenticated-pipe.json");
  await savePipeConfiguration(file, configuration);
  const persisted = await loadPipeConfiguration(file);
  assert.equal(JSON.stringify(persisted).includes("token\""), false);
  assert.equal(persisted.sealedToken.startsWith("fake:"), true);

  const seen: CompanionRequest[] = [];
  const server = new AuthenticatedPipeServer(persisted, protector, {
    async handle(candidate): Promise<CompanionResponse> {
      seen.push(candidate);
      return { version: companionBridgeVersion, id: candidate.id, ok: true, result: { state: "ready" } };
    }
  });
  await server.start();
  context.after(async () => { await server.stop(); });
  const response = await new AuthenticatedPipeClient(persisted, protector).request(request);
  assert.deepEqual(response, { version: companionBridgeVersion, id: "pipe-ping", ok: true, result: { state: "ready" } });
  assert.deepEqual(seen, [request]);
});

test("local pipe client rejects oversized requests before any connection", async (context) => {
  const directory = await mkdtemp(join(tmpdir(), "sxsy-b122-pipe-"));
  context.after(async () => { await rm(directory, { recursive: true, force: true }); });
  const protector = new FakeUserSecretProtector();
  const configuration = await createPipeConfiguration(directory, protector, `large-${Date.now()}`);
  const client = new AuthenticatedPipeClient(configuration, protector);
  await assert.rejects(() => client.request({ ...request, payload: { value: "x".repeat(70_000) } }), /too large/i);
});

test("local pipe paths reject TCP-like or arbitrary endpoint configuration", async () => {
  const protector = new FakeUserSecretProtector();
  const sealedToken = await awaitFakeSeal(protector);
  assert.throws(() => new AuthenticatedPipeClient({ version: 1, pipePath: "127.0.0.1:9999", sealedToken }, protector), /local B122 named pipe|invalid/i);
});

test("unauthenticated pipe frames never reach the companion request handler", async (context) => {
  const directory = await mkdtemp(join(tmpdir(), "sxsy-b122-pipe-"));
  context.after(async () => { await rm(directory, { recursive: true, force: true }); });
  const protector = new FakeUserSecretProtector();
  const configuration = await createPipeConfiguration(directory, protector, `reject-${Date.now()}`);
  let calls = 0;
  const server = new AuthenticatedPipeServer(configuration, protector, {
    async handle(candidate): Promise<CompanionResponse> {
      calls += 1;
      return { version: 1, id: candidate.id, ok: true };
    }
  });
  await server.start();
  context.after(async () => { await server.stop(); });
  const reply = await rawPipeRequest(configuration.pipePath, JSON.stringify({ version: 1, token: Buffer.alloc(32, 9).toString("base64"), request }));
  assert.equal(calls, 0);
  assert.equal(reply, "");
});

test("client proves the server before disclosing any companion request payload", async (context) => {
  const directory = await mkdtemp(join(tmpdir(), "sxsy-b122-pipe-"));
  context.after(async () => { await rm(directory, { recursive: true, force: true }); });
  const protector = new FakeUserSecretProtector();
  const configuration = await createPipeConfiguration(directory, protector, `mutual-${Date.now()}`);
  const received: string[] = [];
  const fake = createServer((socket) => {
    socket.once("data", (chunk) => {
      received.push(chunk.toString("utf8"));
      const hello = JSON.parse(chunk.toString("utf8")) as { clientNonce: string };
      socket.end(`${JSON.stringify({ version: 2, clientNonce: hello.clientNonce, serverNonce: Buffer.alloc(32, 3).toString("base64"), proof: Buffer.alloc(32, 4).toString("base64") })}\n`);
    });
  });
  await new Promise<void>((resolve, reject) => { fake.once("error", reject); fake.listen(configuration.pipePath, resolve); });
  context.after(async () => { await new Promise<void>((resolve) => fake.close(() => resolve())); });
  await assert.rejects(() => new AuthenticatedPipeClient(configuration, protector).request({ ...request, payload: { credential: "must-not-cross" } }), /invalid|unavailable/i);
  assert.equal(received.length, 1);
  assert.equal(received[0]?.includes("must-not-cross"), false);
  assert.equal(received[0]?.includes("\"method\""), false);
});

test("authenticated pipe shutdown destroys idle clients instead of waiting indefinitely", async (context) => {
  const directory = await mkdtemp(join(tmpdir(), "sxsy-b122-pipe-"));
  context.after(async () => { await rm(directory, { recursive: true, force: true }); });
  const protector = new FakeUserSecretProtector();
  const configuration = await createPipeConfiguration(directory, protector, `idle-${Date.now()}`);
  const server = new AuthenticatedPipeServer(configuration, protector, {
    async handle(candidate): Promise<CompanionResponse> {
      return { version: 1, id: candidate.id, ok: true };
    }
  }, { timeoutMs: 30_000 });
  await server.start();
  const idle = connect(configuration.pipePath);
  await new Promise<void>((resolve, reject) => {
    idle.once("connect", resolve);
    idle.once("error", reject);
  });
  const closed = new Promise<void>((resolve) => idle.once("close", () => resolve()));
  await Promise.race([
    server.stop(),
    new Promise<never>((_resolve, reject) => setTimeout(() => reject(new Error("server shutdown did not close an idle pipe client")), 1_000))
  ]);
  await closed;
  assert.equal(idle.destroyed, true);
});

test("journal authenticator test harness detects a sealed tag from the wrong digest", async () => {
  const authenticator = new DpapiJournalAuthenticator(new FakeUserSecretProtector());
  const tag = await authenticator.seal("a".repeat(64));
  assert.equal(await authenticator.verify("a".repeat(64), tag), true);
  assert.equal(await authenticator.verify("b".repeat(64), tag), false);
});

test("Windows CurrentUser DPAPI seals and opens a non-secret local test value", { skip: process.platform !== "win32" ? "Windows-only DPAPI integration check." : false }, async () => {
  const protector = new WindowsDpapiCurrentUserProtector();
  const cleartext = Buffer.from("sxsy-b122-dpapi-smoke-v1", "utf8");
  const sealed = await protector.seal(cleartext);
  assert.notEqual(sealed, cleartext.toString("base64"));
  const reopened = Buffer.from(await protector.open(sealed));
  assert.deepEqual(reopened, cleartext);
  reopened.fill(0);
});

async function awaitFakeSeal(protector: FakeUserSecretProtector): Promise<string> {
  return protector.seal(Buffer.alloc(32, 1));
}

function rawPipeRequest(pipePath: string, line: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const socket = connect(pipePath);
    let received = "";
    socket.once("error", reject);
    socket.on("data", (chunk: Buffer) => { received += chunk.toString("utf8"); });
    socket.once("end", () => resolve(received.trim()));
    socket.once("connect", () => socket.end(`${line}\n`));
  });
}
