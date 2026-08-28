import assert from "node:assert/strict";
import { createHash, createHmac, randomBytes } from "node:crypto";
import { mkdtemp, readFile, rm, unlink, writeFile } from "node:fs/promises";
import { connect, createServer, type Socket } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { AuthenticatedPipeClient, AuthenticatedPipeServer, createPipeConfiguration, loadPipeConfiguration, savePipeConfiguration } from "../src/authenticated-pipe.ts";
import { companionBridgeVersion, type CompanionRequest, type CompanionResponse } from "../src/bridge.ts";
import { DpapiJournalAuthenticator, FakeUserSecretProtector, WindowsDpapiCurrentUserProtector, createSealedRandomToken, runBoundedWindowsProcess, type BoundedWindowsProcessRunner, type UserSecretProtector } from "../src/windows-secret.ts";

const request: CompanionRequest = { version: companionBridgeVersion, id: "pipe-ping", method: "ping" };

class TrackingFakeProtector extends FakeUserSecretProtector {
  readonly opened: Buffer[] = [];
  override async open(sealed: string): Promise<Uint8Array> {
    const clear = Buffer.from(await super.open(sealed));
    this.opened.push(clear);
    return clear;
  }
}

test("authenticated local pipe carries the candidate bridge protocol without a clear persisted token", async (context) => {
  const directory = await mkdtemp(join(tmpdir(), "sxsy-b122-pipe-"));
  context.after(async () => { await rm(directory, { recursive: true, force: true }); });
  const protector = new TrackingFakeProtector();
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
  assert.equal(protector.opened.length, 2);
  assert.equal(protector.opened.every((buffer) => buffer.every((byte) => byte === 0)), true);
});

test("Unix socket startup refuses to unlink a regular file at the endpoint", { skip: process.platform === "win32" }, async (context) => {
  const directory = await mkdtemp(join(tmpdir(), "sxsy-b122-unsafe-socket-"));
  context.after(async () => { await rm(directory, { recursive: true, force: true }); });
  const protector = new FakeUserSecretProtector();
  const configuration = await createPipeConfiguration(directory, protector, `unsafe-${Date.now()}`);
  await writeFile(configuration.pipePath, "must-survive", { mode: 0o600 });
  const server = new AuthenticatedPipeServer(configuration, protector, { async handle(candidate) { return { version: 1, id: candidate.id, ok: true }; } });
  await assert.rejects(() => server.start(), /unsafe|foreign/i);
  assert.equal(await readFile(configuration.pipePath, "utf8"), "must-survive");
});

test("Unix socket shutdown preserves a path swapped after listen", { skip: process.platform === "win32" }, async (context) => {
  const directory = await mkdtemp(join(tmpdir(), "sxsy-b122-swapped-socket-"));
  context.after(async () => { await rm(directory, { recursive: true, force: true }); });
  const protector = new FakeUserSecretProtector();
  const configuration = await createPipeConfiguration(directory, protector, `swapped-${Date.now()}`);
  const server = new AuthenticatedPipeServer(configuration, protector, { async handle(candidate) { return { version: 1, id: candidate.id, ok: true }; } });
  await server.start();
  await unlink(configuration.pipePath);
  await writeFile(configuration.pipePath, "replacement-must-survive", { mode: 0o600 });
  await assert.rejects(() => server.stop(), /changed before shutdown/i);
  assert.equal(await readFile(configuration.pipePath, "utf8"), "replacement-must-survive");
});

test("authenticated local pipe admits the installed acceptance, scanner, and provider administration methods", async (context) => {
  const directory = await mkdtemp(join(tmpdir(), "sxsy-b122-admin-pipe-"));
  context.after(async () => { await rm(directory, { recursive: true, force: true }); });
  const protector = new FakeUserSecretProtector();
  const configuration = await createPipeConfiguration(directory, protector, `admin-${Date.now()}`);
  const seen: string[] = [];
  const server = new AuthenticatedPipeServer(configuration, protector, {
    async handle(candidate): Promise<CompanionResponse> {
      seen.push(candidate.method);
      return { version: companionBridgeVersion, id: candidate.id, ok: true, result: { admitted: candidate.method } };
    }
  });
  await server.start();
  context.after(async () => { await server.stop(); });
  const client = new AuthenticatedPipeClient(configuration, protector);
  const requests: CompanionRequest[] = [
    { version: 1, id: "acceptance-admin", method: "acceptance.trust.list" },
    { version: 1, id: "scanner-admin", method: "scanner.fixture.list" },
    { version: 1, id: "provider-admin", method: "provider-desktop.list" }
  ];
  for (const candidate of requests) assert.equal((await client.request(candidate)).ok, true);
  assert.deepEqual(seen, requests.map((candidate) => candidate.method));
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

test("pipe configuration persistence is atomic, bounded, exact, and ignores stale temporary files", async (context) => {
  const directory = await mkdtemp(join(tmpdir(), "sxsy-b122-pipe-config-"));
  context.after(async () => { await rm(directory, { recursive: true, force: true }); });
  const protector = new FakeUserSecretProtector();
  const configuration = await createPipeConfiguration(directory, protector, `config-${Date.now()}`);
  const authoritative = join(directory, "authenticated-pipe.json");
  await savePipeConfiguration(authoritative, configuration);
  await writeFile(`${authoritative}.stale.tmp`, "{\"version\":", "utf8");
  assert.deepEqual(await loadPipeConfiguration(authoritative), configuration);

  const malformed = [
    ["truncated.json", "{\"version\":"],
    ["extra-key.json", JSON.stringify({ ...configuration, attacker: true })],
    ["oversized.json", "x".repeat((64 * 1024) + 1)]
  ] as const;
  for (const [name, contents] of malformed) {
    const candidate = join(directory, name);
    await writeFile(candidate, contents, "utf8");
    await assert.rejects(() => loadPipeConfiguration(candidate), /invalid|oversized|JSON|Unexpected/i);
    assert.deepEqual(await loadPipeConfiguration(authoritative), configuration);
  }
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

test("an authenticated envelope replayed against a fresh server challenge never reaches the handler", async (context) => {
  const directory = await mkdtemp(join(tmpdir(), "sxsy-b122-pipe-replay-"));
  context.after(async () => { await rm(directory, { recursive: true, force: true }); });
  const protector = new FakeUserSecretProtector();
  const configuration = await createPipeConfiguration(directory, protector, `replay-${Date.now()}`);
  let calls = 0;
  const server = new AuthenticatedPipeServer(configuration, protector, {
    async handle(candidate): Promise<CompanionResponse> { calls += 1; return { version: 1, id: candidate.id, ok: true }; }
  });
  await server.start();
  context.after(async () => { await server.stop(); });
  const token = Buffer.from(configuration.sealedToken.slice("fake:".length), "base64");
  const clientNonce = randomBytes(32).toString("base64");
  const first = await openRawChallenge(configuration.pipePath, clientNonce);
  const oldEnvelope = authenticatedRequestEnvelope(token, clientNonce, first.challenge.serverNonce, request);
  const firstClosed = waitForSocketClose(first.socket);
  first.socket.destroy();
  await firstClosed;

  const second = await openRawChallenge(configuration.pipePath, clientNonce);
  assert.notEqual(second.challenge.serverNonce, first.challenge.serverNonce);
  const secondClosed = waitForSocketClose(second.socket);
  second.socket.end(`${JSON.stringify(oldEnvelope)}\n`);
  await secondClosed;
  token.fill(0);
  assert.equal(calls, 0);
});

test("a valid authenticated request with a trailing second frame is rejected before dispatch", async (context) => {
  const directory = await mkdtemp(join(tmpdir(), "sxsy-b122-pipe-trailing-"));
  context.after(async () => { await rm(directory, { recursive: true, force: true }); });
  const protector = new FakeUserSecretProtector();
  const configuration = await createPipeConfiguration(directory, protector, `trailing-${Date.now()}`);
  let calls = 0;
  const server = new AuthenticatedPipeServer(configuration, protector, {
    async handle(candidate): Promise<CompanionResponse> { calls += 1; return { version: 1, id: candidate.id, ok: true }; }
  });
  await server.start();
  context.after(async () => { await server.stop(); });
  const token = Buffer.from(configuration.sealedToken.slice("fake:".length), "base64");
  const clientNonce = randomBytes(32).toString("base64");
  const connection = await openRawChallenge(configuration.pipePath, clientNonce);
  const envelope = authenticatedRequestEnvelope(token, clientNonce, connection.challenge.serverNonce, request);
  const closed = waitForSocketClose(connection.socket);
  connection.socket.write(`${JSON.stringify(envelope)}\n${JSON.stringify(envelope)}\n`, "utf8");
  await closed;
  token.fill(0);
  assert.equal(calls, 0);
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

test("authenticated pipe disconnect aborts the exact admitted request and consumes late rejection", async (context) => {
  const directory = await mkdtemp(join(tmpdir(), "sxsy-b122-pipe-disconnect-"));
  context.after(async () => { await rm(directory, { recursive: true, force: true }); });
  const protector = new FakeUserSecretProtector();
  const configuration = await createPipeConfiguration(directory, protector, `disconnect-${Date.now()}`);
  let admit!: () => void;
  const admitted = new Promise<void>((resolve) => { admit = resolve; });
  let rejectLate!: (error: Error) => void;
  const late = new Promise<CompanionResponse>((_resolve, reject) => { rejectLate = reject; });
  let requestSignal: AbortSignal | undefined;
  const server = new AuthenticatedPipeServer(configuration, protector, {
    async handle(_candidate, requestContext?: { readonly signal?: AbortSignal }): Promise<CompanionResponse> {
      requestSignal = requestContext?.signal;
      admit();
      return late;
    }
  });
  await server.start();
  context.after(async () => { rejectLate(new Error("late fixture rejection")); await server.stop().catch(() => undefined); });
  const token = Buffer.from(configuration.sealedToken.slice("fake:".length), "base64");
  const clientNonce = randomBytes(32).toString("base64");
  const connection = await openRawChallenge(configuration.pipePath, clientNonce);
  const envelope = authenticatedRequestEnvelope(token, clientNonce, connection.challenge.serverNonce, request);
  connection.socket.write(`${JSON.stringify(envelope)}\n`, "utf8");
  await admitted;
  assert.ok(requestSignal, "the admitted request must own an abort signal");
  const aborted = new Promise<void>((resolve) => requestSignal!.addEventListener("abort", () => resolve(), { once: true }));
  connection.socket.destroy();
  await Promise.race([aborted, new Promise<never>((_resolve, reject) => setTimeout(() => reject(new Error("disconnect did not abort the request")), 1_000))]);
  rejectLate(new Error("late fixture rejection"));
  await server.stop();
  token.fill(0);
});

test("authenticated pipe timeout aborts the exact admitted request", async (context) => {
  const directory = await mkdtemp(join(tmpdir(), "sxsy-b122-pipe-timeout-"));
  context.after(async () => { await rm(directory, { recursive: true, force: true }); });
  const protector = new FakeUserSecretProtector();
  const configuration = await createPipeConfiguration(directory, protector, `timeout-${Date.now()}`);
  let admit!: () => void;
  const admitted = new Promise<void>((resolve) => { admit = resolve; });
  let release!: () => void;
  const blocked = new Promise<void>((resolve) => { release = resolve; });
  let requestSignal: AbortSignal | undefined;
  const server = new AuthenticatedPipeServer(configuration, protector, {
    async handle(candidate, requestContext?: { readonly signal?: AbortSignal }): Promise<CompanionResponse> {
      requestSignal = requestContext?.signal;
      admit();
      await blocked;
      return { version: 1, id: candidate.id, ok: true };
    }
  }, { timeoutMs: 100 });
  await server.start();
  context.after(async () => { release(); await server.stop().catch(() => undefined); });
  const clientOutcome = new AuthenticatedPipeClient(configuration, protector, { timeoutMs: 2_000 }).request(request).then(() => "resolved", () => "rejected");
  await admitted;
  assert.ok(requestSignal, "the timed request must own an abort signal");
  await Promise.race([
    new Promise<void>((resolve) => requestSignal!.addEventListener("abort", () => resolve(), { once: true })),
    new Promise<never>((_resolve, reject) => setTimeout(() => reject(new Error("pipe timeout did not abort the request")), 1_000))
  ]);
  assert.equal(await clientOutcome, "rejected");
  release();
  await server.stop();
});

test("authenticated pipe shutdown aborts and drains a never-settling admitted handler", async (context) => {
  const directory = await mkdtemp(join(tmpdir(), "sxsy-b122-pipe-drain-"));
  context.after(async () => { await rm(directory, { recursive: true, force: true }); });
  const protector = new FakeUserSecretProtector();
  const configuration = await createPipeConfiguration(directory, protector, `drain-${Date.now()}`);
  let admit!: () => void;
  const admitted = new Promise<void>((resolve) => { admit = resolve; });
  let requestSignal: AbortSignal | undefined;
  const server = new AuthenticatedPipeServer(configuration, protector, {
    async handle(_candidate, requestContext?: { readonly signal?: AbortSignal }): Promise<CompanionResponse> {
      requestSignal = requestContext?.signal;
      admit();
      return new Promise<CompanionResponse>(() => undefined);
    }
  }, { timeoutMs: 30_000, drainTimeoutMs: 200 });
  await server.start();
  context.after(async () => { await server.stop().catch(() => undefined); });
  const clientOutcome = new AuthenticatedPipeClient(configuration, protector).request(request).then(() => "resolved", () => "rejected");
  await admitted;
  assert.ok(requestSignal, "the admitted request must own an abort signal");
  await Promise.race([
    server.stop(),
    new Promise<never>((_resolve, reject) => setTimeout(() => reject(new Error("server shutdown did not abort and drain the request")), 1_000))
  ]);
  assert.equal(requestSignal.aborted, true);
  assert.equal(await clientOutcome, "rejected");
  await assert.rejects(() => new AuthenticatedPipeClient(configuration, protector).request({ ...request, id: "after-stop" }), /unavailable/i);
});

test("journal authenticator test harness detects a sealed tag from the wrong digest", async () => {
  const authenticator = new DpapiJournalAuthenticator(new FakeUserSecretProtector());
  const tag = await authenticator.seal("a".repeat(64));
  assert.equal(await authenticator.verify("a".repeat(64), tag), true);
  assert.equal(await authenticator.verify("b".repeat(64), tag), false);
});

test("DPAPI protector zeroes task-owned input and output buffers on both paths", { skip: process.platform !== "win32" ? "Windows-only DPAPI boundary." : false }, async () => {
  const inputs: Buffer[] = [];
  const outputs: Buffer[] = [];
  const runner: BoundedWindowsProcessRunner = async (request) => {
    inputs.push(request.input as Buffer);
    const protects = request.args.some((argument) => argument.includes("ProtectedData]::Protect"));
    const stdout = Buffer.from(protects ? "sealed-fixture" : "opened-fixture", "utf8");
    const stderr = Buffer.alloc(0);
    outputs.push(stdout, stderr);
    return { exitCode: 0, stdout, stderr };
  };
  const protector = new WindowsDpapiCurrentUserProtector(runner);
  const sealed = await protector.seal(Buffer.from("clear-fixture", "utf8"));
  assert.equal(Buffer.from(sealed, "base64").toString("utf8"), "sealed-fixture");
  const opened = await protector.open(sealed);
  assert.equal(Buffer.from(opened).toString("utf8"), "opened-fixture");
  opened.fill(0);
  assert.equal(inputs.length, 2);
  assert.equal(inputs.every((buffer) => buffer.every((byte) => byte === 0)), true);
  assert.equal(outputs.every((buffer) => buffer.every((byte) => byte === 0)), true);
});

test("DPAPI helper identity is anchored to the loaded Windows kernel instead of inherited SystemRoot", { skip: process.platform !== "win32" ? "Windows-only DPAPI boundary." : false }, async () => {
  let executable = "";
  const runner: BoundedWindowsProcessRunner = async (request) => {
    executable = request.executable;
    return { exitCode: 0, stdout: Buffer.from("sealed-fixture", "utf8"), stderr: Buffer.alloc(0) };
  };
  const previous = process.env.SystemRoot;
  process.env.SystemRoot = join(tmpdir(), "attacker-controlled-windows");
  try { await new WindowsDpapiCurrentUserProtector(runner).seal(Buffer.from("clear-fixture", "utf8")); }
  finally {
    if (previous === undefined) delete process.env.SystemRoot;
    else process.env.SystemRoot = previous;
  }
  assert.equal(executable.toLowerCase().includes("attacker-controlled-windows"), false);
  assert.match(executable, /[\\/]System32[\\/]WindowsPowerShell[\\/]v1\.0[\\/]powershell\.exe$/i);
});

test("random local pipe token is zeroed after the protector seals it", async () => {
  let observed: Uint8Array | undefined;
  const protector: UserSecretProtector = {
    provider: "zeroization-probe",
    async seal(cleartext) { observed = cleartext; return "opaque"; },
    async open() { throw new Error("not used"); }
  };
  assert.equal(await createSealedRandomToken(protector), "opaque");
  assert.ok(observed);
  assert.equal(observed.every((byte) => byte === 0), true);
});

test("bounded companion DPAPI runner rejects an arbitrary descendant-spawning executable before launch", { skip: process.platform !== "win32" ? "Windows-only process identity check." : false }, async (context) => {
  const directory = await mkdtemp(join(tmpdir(), "sxsy-b122-dpapi-timeout-"));
  context.after(async () => { await rm(directory, { recursive: true, force: true }); });
  const identityPath = join(directory, "identity.json");
  const fixture = join(directory, "hung-tree.cjs");
  await writeFile(fixture, [
    "const { spawn } = require('node:child_process');",
    "const { writeFileSync } = require('node:fs');",
    "const child = spawn(process.execPath, ['-e', 'setInterval(() => {}, 1000)'], { stdio: 'ignore', windowsHide: true });",
    "writeFileSync(process.argv[2], JSON.stringify({ root: process.pid, child: child.pid }));",
    "setInterval(() => {}, 1000);"
  ].join("\n"), "utf8");
  await assert.rejects(() => runBoundedWindowsProcess({
    executable: process.execPath,
    args: [fixture, identityPath],
    input: Buffer.alloc(0),
    timeoutMs: 300,
    maximumOutputBytes: 4096
  }), /invalid/i);
  await assert.rejects(() => readFile(identityPath), /ENOENT/i);
});

test("Windows CurrentUser DPAPI seals and opens a non-secret local test value", { skip: process.platform !== "win32" ? "Windows-only DPAPI integration check." : false, timeout: 120_000 }, async () => {
  const protector = new WindowsDpapiCurrentUserProtector();
  const cleartext = Buffer.from("sxsy-b122-dpapi-smoke-v1", "utf8");
  const sealed = await protector.seal(cleartext);
  assert.notEqual(sealed, cleartext.toString("base64"));
  const reopened = await protector.open(sealed);
  assert.deepEqual(Buffer.from(reopened), cleartext);
  reopened.fill(0);
});

test("Windows CurrentUser DPAPI round-trips the maximum supported credential size", { skip: process.platform !== "win32" ? "Windows-only DPAPI integration check." : false, timeout: 120_000 }, async () => {
  const protector = new WindowsDpapiCurrentUserProtector();
  const cleartext = Buffer.alloc(64 * 1024, 0x5a);
  const sealed = await protector.seal(cleartext);
  assert.equal(sealed.length <= 256 * 1024, true);
  const reopened = await protector.open(sealed);
  assert.deepEqual(Buffer.from(reopened), cleartext);
  reopened.fill(0);
  cleartext.fill(0);
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

async function openRawChallenge(pipePath: string, clientNonce: string): Promise<{
  readonly socket: Socket;
  readonly challenge: { readonly version: 2; readonly clientNonce: string; readonly serverNonce: string; readonly proof: string };
}> {
  const socket = connect(pipePath);
  await new Promise<void>((resolve, reject) => {
    socket.once("connect", resolve);
    socket.once("error", reject);
  });
  const response = readRawLine(socket);
  socket.write(`${JSON.stringify({ version: 2, clientNonce })}\n`, "utf8");
  const challenge = JSON.parse(await response) as { version: 2; clientNonce: string; serverNonce: string; proof: string };
  assert.equal(challenge.version, 2);
  assert.equal(challenge.clientNonce, clientNonce);
  return { socket, challenge };
}

function readRawLine(socket: Socket): Promise<string> {
  return new Promise((resolve, reject) => {
    let received = Buffer.alloc(0);
    const cleanup = (): void => {
      socket.off("data", onData);
      socket.off("error", onError);
      socket.off("close", onClose);
    };
    const onData = (chunk: Buffer): void => {
      received = Buffer.concat([received, chunk]);
      const newline = received.indexOf(0x0a);
      if (newline < 0) return;
      const line = received.subarray(0, newline).toString("utf8");
      received.fill(0);
      cleanup();
      resolve(line);
    };
    const onError = (): void => { cleanup(); reject(new Error("raw pipe challenge failed")); };
    const onClose = (): void => { cleanup(); reject(new Error("raw pipe closed before challenge")); };
    socket.on("data", onData);
    socket.once("error", onError);
    socket.once("close", onClose);
  });
}

function waitForSocketClose(socket: Socket): Promise<void> {
  if (socket.destroyed) return Promise.resolve();
  return new Promise((resolve) => socket.once("close", () => resolve()));
}

function authenticatedRequestEnvelope(token: Buffer, clientNonce: string, serverNonce: string, candidate: CompanionRequest): unknown {
  const document = JSON.stringify(candidate);
  const digest = createHash("sha256").update(document).digest("hex");
  const proof = createHmac("sha256", token).update(`sxsy-b122-pipe-v2\0client\0${clientNonce}\0${serverNonce}\0${digest}`).digest("base64");
  return { version: 2, clientNonce, serverNonce, proof, request: candidate };
}
