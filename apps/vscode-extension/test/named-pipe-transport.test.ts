import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { isAbsolute, join } from "node:path";
import test from "node:test";

import { NamedPipeJsonLineTransport, ProvisionedNamedPipeJsonLineTransport, WindowsDpapiSecretReader, defaultCompanionPipeConfigurationPath, runBoundedWindowsHostProcess, type BoundedWindowsHostProcessRunner, type ExtensionSecretReader, type StoredCompanionPipeConfiguration } from "../src/named-pipe-transport.ts";
import { WindowsDpapiCurrentUserProtector } from "../../windows-companion/src/windows-secret.ts";
import { AuthenticatedPipeServer } from "../../windows-companion/src/authenticated-pipe.ts";

class FakeSecretReader implements ExtensionSecretReader {
  readonly opened: Buffer[] = [];
  async open(): Promise<Uint8Array> {
    const clear = Buffer.alloc(32, 7);
    this.opened.push(clear);
    return clear;
  }
}

test("VS Code named-pipe transport authenticates exactly one candidate JSON-line request", async (context) => {
  const pipePath = process.platform === "win32"
    ? `\\\\.\\pipe\\sxsy-b122-vscode-${Date.now()}`
    : `${process.cwd()}/.tmp-sxsy-b122-vscode-${Date.now()}.sock`;
  const configuration: StoredCompanionPipeConfiguration = { version: 1, pipePath, sealedToken: "opaque-dpapi-envelope" };
  let received: unknown;
  const server = new AuthenticatedPipeServer(configuration, fixedProtector(), { async handle(request) { received = request; return { version: 1, id: request.id, ok: true, result: { state: "ready" } }; } });
  await server.start();
  context.after(async () => { await server.stop(); });

  const secrets = new FakeSecretReader();
  const transport = new NamedPipeJsonLineTransport(configuration, secrets);
  const response = await transport.request(JSON.stringify({ version: 1, id: "vscode-ping", method: "ping" }));
  assert.deepEqual(JSON.parse(response), { version: 1, id: "vscode-ping", ok: true, result: { state: "ready" } });
  assert.deepEqual(received, { version: 1, id: "vscode-ping", method: "ping" });
  assert.equal(secrets.opened.length, 1);
  assert.equal(secrets.opened[0]?.every((byte) => byte === 0), true);
});

test("VS Code named-pipe transport refuses TCP-like endpoint metadata", () => {
  assert.throws(() => new NamedPipeJsonLineTransport({ version: 1, pipePath: "http://127.0.0.1:9999", sealedToken: "opaque" }, new FakeSecretReader()), /invalid/i);
});

test("provisioned VS Code transport reads only the companion-owned sealed state record", async (context) => {
  const directory = await mkdtemp(join(tmpdir(), "sxsy-b122-vscode-state-"));
  context.after(async () => { await rm(directory, { recursive: true, force: true }); });
  const pipePath = process.platform === "win32"
    ? `\\\\.\\pipe\\sxsy-b122-vscode-state-${Date.now()}`
    : join(directory, "sxsy-b122-vscode-state.sock");
  const configurationPath = join(directory, "authenticated-pipe.json");
  await writeFile(configurationPath, JSON.stringify({ version: 1, pipePath, sealedToken: "opaque-dpapi-envelope" }), { encoding: "utf8", mode: 0o600 });
  await writeFile(`${configurationPath}.stale.tmp`, "{\"version\":", "utf8");
  const server = new AuthenticatedPipeServer({ version: 1, pipePath, sealedToken: "opaque-dpapi-envelope" }, fixedProtector(), { async handle(request) { return { version: 1, id: request.id, ok: true, result: { state: "ready" } }; } });
  await server.start();
  context.after(async () => { await server.stop(); });
  const transport = new ProvisionedNamedPipeJsonLineTransport(configurationPath, new FakeSecretReader());
  const response = await transport.request(JSON.stringify({ version: 1, id: "state-ping", method: "ping" }));
  assert.equal((JSON.parse(response) as { id: string }).id, "state-ping");
});

test("provisioned VS Code transport rejects a broadly readable Linux endpoint record", { skip: process.platform !== "linux" }, async (context) => {
  const directory = await mkdtemp(join(tmpdir(), "sxsy-b122-vscode-public-state-"));
  context.after(async () => { await rm(directory, { recursive: true, force: true }); });
  const configurationPath = join(directory, "authenticated-pipe.json");
  await writeFile(configurationPath, JSON.stringify({ version: 1, pipePath: join(directory, "companion.sock"), sealedToken: "opaque" }), { encoding: "utf8", mode: 0o644 });
  const transport = new ProvisionedNamedPipeJsonLineTransport(configurationPath, new FakeSecretReader());
  await assert.rejects(() => transport.request(JSON.stringify({ version: 1, id: "public-state", method: "ping" })), /not provisioned|unsafe|private/i);
});

test("provisioned VS Code transport rejects truncated, oversized, and extra-key endpoint records before connecting", async (context) => {
  const directory = await mkdtemp(join(tmpdir(), "sxsy-b122-vscode-invalid-state-"));
  context.after(async () => { await rm(directory, { recursive: true, force: true }); });
  const pipePath = process.platform === "win32"
    ? `\\\\.\\pipe\\sxsy-b122-invalid-state-${Date.now()}`
    : join(directory, "sxsy-b122-invalid-state.sock");
  const base = { version: 1, pipePath, sealedToken: "opaque-dpapi-envelope" };
  const requestLine = JSON.stringify({ version: 1, id: "invalid-state", method: "ping" });
  const malformed = [
    ["truncated.json", "{\"version\":"],
    ["extra-key.json", JSON.stringify({ ...base, attacker: true })],
    ["oversized.json", "x".repeat((64 * 1024) + 1)]
  ] as const;
  for (const [name, contents] of malformed) {
    const configurationPath = join(directory, name);
    await writeFile(configurationPath, contents, "utf8");
    const transport = new ProvisionedNamedPipeJsonLineTransport(configurationPath, new FakeSecretReader());
    await assert.rejects(() => transport.request(requestLine), /not provisioned|configuration is invalid/i);
  }
});

function fixedProtector() {
  return {
    provider: "test-fixed",
    async seal(): Promise<string> { return "opaque-dpapi-envelope"; },
    async open(): Promise<Uint8Array> { return Buffer.alloc(32, 7); }
  };
}

test("VS Code DPAPI reader zeroes task-owned input and output buffers", async () => {
  const inputs: Buffer[] = [];
  const outputs: Buffer[] = [];
  const runner: BoundedWindowsHostProcessRunner = async (request) => {
    inputs.push(request.input as Buffer);
    const protects = request.args.some((argument) => argument.includes("ProtectedData]::Protect"));
    const stdout = Buffer.from(protects ? "sealed-extension" : "opened-extension", "utf8");
    const stderr = Buffer.alloc(0);
    outputs.push(stdout, stderr);
    return { exitCode: 0, stdout, stderr };
  };
  const reader = new WindowsDpapiSecretReader(runner);
  const sealed = await reader.seal(Buffer.from("extension-secret", "utf8"));
  assert.equal(Buffer.from(sealed, "base64").toString("utf8"), "sealed-extension");
  const opened = await reader.open(sealed);
  assert.equal(Buffer.from(opened).toString("utf8"), "opened-extension");
  opened.fill(0);
  assert.equal(inputs.length, 2);
  assert.equal(inputs.every((buffer) => buffer.every((byte) => byte === 0)), true);
  assert.equal(outputs.every((buffer) => buffer.every((byte) => byte === 0)), true);
});

test("VS Code DPAPI reader coalesces opens, caches one token, zeroes rotation, and refuses use after disposal", { skip: process.platform !== "win32" ? "Windows-only DPAPI lifecycle." : false }, async () => {
  let calls = 0;
  let releaseFirst!: () => void;
  const firstGate = new Promise<void>((resolve) => { releaseFirst = resolve; });
  let markFirstStarted!: () => void;
  const firstStarted = new Promise<void>((resolve) => { markFirstStarted = resolve; });
  const runner: BoundedWindowsHostProcessRunner = async () => {
    calls += 1;
    const call = calls;
    if (call === 1) { markFirstStarted(); await firstGate; }
    return { exitCode: 0, stdout: Buffer.alloc(32, call), stderr: Buffer.alloc(0) };
  };
  const firstSealed = Buffer.from("sealed-one", "utf8").toString("base64");
  const secondSealed = Buffer.from("sealed-two", "utf8").toString("base64");
  const reader = new WindowsDpapiSecretReader(runner);
  const firstOpen = reader.open(firstSealed);
  const concurrentOpen = reader.open(firstSealed);
  await firstStarted;
  assert.equal(calls, 1);
  releaseFirst();
  const [first, concurrent] = await Promise.all([firstOpen, concurrentOpen]);
  assert.deepEqual(first, Buffer.alloc(32, 1));
  assert.deepEqual(concurrent, Buffer.alloc(32, 1));
  first.fill(0);
  concurrent.fill(0);

  const internals = reader as unknown as { cached?: { cleartext: Buffer } };
  const firstRetained = internals.cached?.cleartext;
  assert.ok(firstRetained);
  const cachedCopy = await reader.open(firstSealed);
  assert.equal(calls, 1);
  cachedCopy.fill(0);
  const rotated = await reader.open(secondSealed);
  assert.equal(calls, 2);
  assert.equal(firstRetained.every((byte) => byte === 0), true);
  rotated.fill(0);
  const secondRetained = internals.cached?.cleartext;
  assert.ok(secondRetained);
  await reader.dispose();
  assert.equal(secondRetained.every((byte) => byte === 0), true);
  await assert.rejects(() => reader.open(firstSealed), /disposed/i);
  await assert.rejects(() => reader.seal(Buffer.from("after-dispose", "utf8")), /disposed/i);
});

test("VS Code DPAPI reader drains an in-flight seal and withholds its result during disposal", { skip: process.platform !== "win32" ? "Windows-only DPAPI lifecycle." : false }, async () => {
  let release!: () => void;
  const gate = new Promise<void>((resolve) => { release = resolve; });
  let markStarted!: () => void;
  const started = new Promise<void>((resolve) => { markStarted = resolve; });
  let output: Buffer | undefined;
  const runner: BoundedWindowsHostProcessRunner = async () => {
    markStarted();
    await gate;
    output = Buffer.from("sealed-during-dispose", "utf8");
    return { exitCode: 0, stdout: output, stderr: Buffer.alloc(0) };
  };
  const reader = new WindowsDpapiSecretReader(runner);
  const sealing = reader.seal(Buffer.from("clear-during-dispose", "utf8"));
  await started;
  const disposal = reader.dispose();
  release();
  await assert.rejects(() => sealing, /disposed/i);
  await disposal;
  assert.ok(output);
  assert.equal(output.every((byte) => byte === 0), true);
});

test("VS Code DPAPI helper identity ignores a crafted inherited SystemRoot", async () => {
  let executable = "";
  const runner: BoundedWindowsHostProcessRunner = async (request) => {
    executable = request.executable;
    return { exitCode: 0, stdout: Buffer.from("sealed-extension", "utf8"), stderr: Buffer.alloc(0) };
  };
  const previous = process.env.SystemRoot;
  process.env.SystemRoot = join(tmpdir(), "attacker-controlled-windows");
  try { await new WindowsDpapiSecretReader(runner).seal(Buffer.from("extension-secret", "utf8")); }
  finally {
    if (previous === undefined) delete process.env.SystemRoot;
    else process.env.SystemRoot = previous;
  }
  assert.equal(executable.toLowerCase().includes("attacker-controlled-windows"), false);
  assert.match(executable, /[\\/]System32[\\/]WindowsPowerShell[\\/]v1\.0[\\/]powershell\.exe$/i);
});

test("default companion discovery uses the Windows LocalAppData Known Folder instead of inherited path variables", { skip: process.platform !== "win32" ? "Windows-only Known Folder lookup." : false }, () => {
  const candidate = defaultCompanionPipeConfigurationPath({
    LOCALAPPDATA: "attacker-relative-local",
    APPDATA: "attacker-relative-roaming",
    HOME: "attacker-relative-home",
    USERPROFILE: "attacker-relative-profile"
  });
  assert.equal(isAbsolute(candidate), true);
  assert.equal(candidate.toLowerCase().includes("attacker-relative"), false);
  assert.match(candidate, /[\\/]STRATHEX[\\/]switchyard[\\/]authenticated-pipe\.json$/i);
});

test("bounded VS Code DPAPI host rejects an arbitrary descendant-spawning executable before launch", { skip: process.platform !== "win32" ? "Windows-only process identity check." : false }, async (context) => {
  const directory = await mkdtemp(join(tmpdir(), "sxsy-b122-vscode-dpapi-overflow-"));
  context.after(async () => { await rm(directory, { recursive: true, force: true }); });
  const identityPath = join(directory, "identity.json");
  const fixture = join(directory, "overflow-tree.cjs");
  await writeFile(fixture, [
    "const { spawn } = require('node:child_process');",
    "const { writeFileSync } = require('node:fs');",
    "const child = spawn(process.execPath, ['-e', 'setInterval(() => {}, 1000)'], { stdio: 'ignore', windowsHide: true });",
    "writeFileSync(process.argv[2], JSON.stringify({ root: process.pid, child: child.pid }));",
    "process.stdout.write('x'.repeat(131072));",
    "setInterval(() => {}, 1000);"
  ].join("\n"), "utf8");
  await assert.rejects(() => runBoundedWindowsHostProcess({
    executable: process.execPath,
    args: [fixture, identityPath],
    input: Buffer.alloc(0),
    timeoutMs: 5_000,
    maximumOutputBytes: 1024
  }), /invalid/i);
  await assert.rejects(() => readFile(identityPath), /ENOENT/i);
});

test("the VS Code DPAPI reader opens only the current user's companion-sealed test value", { skip: process.platform !== "win32" ? "Windows-only DPAPI integration check." : false }, async () => {
  const companionProtector = new WindowsDpapiCurrentUserProtector();
  const cleartext = Buffer.from("sxsy-b122-extension-dpapi-smoke-v1", "utf8");
  const sealed = await companionProtector.seal(cleartext);
  const reader = new WindowsDpapiSecretReader();
  const opened = await reader.open(sealed);
  assert.deepEqual(Buffer.from(opened), cleartext);
  opened.fill(0);
  await reader.dispose();
});
