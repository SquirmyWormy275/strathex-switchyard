import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import type {
  ProviderExecutableIdentity,
  ProviderProcessEffectRequest
} from "../src/provider-desktop.ts";
import {
  WindowsProviderDesktopProcessPort,
  type ProviderDesktopHelperInvocation,
  type ProviderDesktopHelperSession,
  type ProviderDesktopHelperTransport
} from "../src/windows-provider-process.ts";

const digest = (value: string | Buffer): string => createHash("sha256").update(value).digest("hex");
const responseSchema = "sxsy-b122.provider-desktop-response";

class FakeSession implements ProviderDesktopHelperSession {
  readonly writes: string[] = [];
  readonly responses: string[] = [];
  terminated = false;
  onWrite?: (value: Record<string, unknown>) => void;
  onRead?: () => Promise<string>;

  async write(line: string): Promise<void> {
    this.writes.push(line);
    this.onWrite?.(JSON.parse(line) as Record<string, unknown>);
  }

  async read(): Promise<string> {
    if (this.onRead) return this.onRead();
    const response = this.responses.shift();
    if (response === undefined) throw new Error("fake helper has no response");
    return response;
  }

  async terminate(): Promise<void> { this.terminated = true; }
  async wait(): Promise<{ readonly code: number; readonly signal: NodeJS.Signals | null }> {
    return { code: 0, signal: null };
  }
}

class FakeTransport implements ProviderDesktopHelperTransport {
  readonly invocations: ProviderDesktopHelperInvocation[] = [];
  readonly sessions: FakeSession[] = [];
  configure?: (session: FakeSession) => void;

  async start(invocation: ProviderDesktopHelperInvocation): Promise<ProviderDesktopHelperSession> {
    this.invocations.push(invocation);
    const session = new FakeSession();
    this.configure?.(session);
    this.sessions.push(session);
    return session;
  }
}

async function fixture(context: test.TestContext) {
  const root = await mkdtemp(join(tmpdir(), "b122-provider-process-"));
  context.after(async () => rm(root, { recursive: true, force: true }));
  const helperPath = join(root, "sxsy-b122-provider-desktop-helper.exe");
  const executablePath = join(root, "Claude.exe");
  await writeFile(helperPath, "fixed native helper", "utf8");
  await writeFile(executablePath, "fixed provider executable", "utf8");
  const identity: ProviderExecutableIdentity = {
    canonicalExecutablePath: executablePath,
    executableSha256: digest("fixed provider executable"),
    signerSubject: "CN=Isolated Provider Test",
    signerThumbprint: "a".repeat(40),
    productIdentity: {
      productId: "anthropic.claude-desktop",
      displayName: "Claude Desktop",
      publisher: "Anthropic, PBC",
      role: "desktop"
    },
    size: Buffer.byteLength("fixed provider executable"),
    modifiedMs: 1_777_000_000_000,
    device: 7,
    inode: 11
  };
  return { root, helperPath, executablePath, identity };
}

function port(helperPath: string, helperSha256: string, transport: FakeTransport) {
  return new WindowsProviderDesktopProcessPort({
    helperPath,
    helperSha256,
    transport,
    hostEnvironment: { SystemRoot: "C:\\Windows", WINDIR: "C:\\Windows", PATH: "must-not-leak", SECRET_TOKEN: "must-not-leak" }
  });
}

function envelope(request: Record<string, unknown>, kind: "ready" | "result" | "error", body: Record<string, unknown>): string {
  return JSON.stringify({ schema: responseSchema, version: 1, requestId: request.requestId, kind, ...body });
}

test("list uses only the exact hash-bound helper and a sanitized fixed protocol", async (context) => {
  const setup = await fixture(context);
  const transport = new FakeTransport();
  transport.configure = (session) => {
    session.onWrite = (request) => session.responses.push(envelope(request, "result", {
      observations: [{ processId: 4100, surfaceId: "hwnd:100f" }]
    }));
  };
  const processPort = port(setup.helperPath, digest("fixed native helper"), transport);

  const observations = await processPort.listRunning(setup.identity, new AbortController().signal);

  assert.equal(observations.length, 1);
  assert.equal(observations[0]?.windowId, "hwnd:100f");
  assert.deepEqual(observations[0]?.identity, setup.identity);
  assert.deepEqual(transport.invocations[0]?.arguments, ["--stdio-v1"]);
  assert.deepEqual(transport.invocations[0]?.environment, { SystemRoot: "C:\\Windows", WINDIR: "C:\\Windows" });
  const request = JSON.parse(transport.sessions[0]!.writes[0]!) as Record<string, unknown>;
  assert.equal(request.action, "list");
  assert.equal(request.provider, "claude_desktop");
  assert.equal("cwd" in request, false);
  assert.equal("command" in request, false);
  assert.equal(JSON.stringify(request).includes("must-not-leak"), false);
});

test("focus authorizes only after the host barrier while the helper holds the exact one-surface identity", async (context) => {
  const setup = await fixture(context);
  const transport = new FakeTransport();
  const ordering: string[] = [];
  transport.configure = (session) => {
    session.onWrite = (request) => {
      if (request.kind === "authorize") {
        ordering.push("authorize");
        session.responses.push(envelope(request, "result", { processId: 4100, surfaceId: "hwnd:100f" }));
      } else {
        ordering.push("prepare");
        session.responses.push(envelope(request, "ready", { authorizationToken: "a".repeat(64), processId: 4100, surfaceId: "hwnd:100f" }));
      }
    };
  };
  const processPort = port(setup.helperPath, digest("fixed native helper"), transport);
  const request: ProviderProcessEffectRequest & { readonly process: { readonly processId: number; readonly windowId: string; readonly identity: ProviderExecutableIdentity } } = {
    provider: "claude_desktop",
    operationId: "focus-operation",
    identity: setup.identity,
    process: { processId: 4100, windowId: "hwnd:100f", identity: setup.identity },
    signal: new AbortController().signal,
    shell: false,
    async beforeEffect() { ordering.push("barrier"); }
  };

  assert.deepEqual(await processPort.focusExisting(request), { processId: 4100 });
  assert.deepEqual(ordering, ["prepare", "barrier", "authorize"]);
  const authorization = JSON.parse(transport.sessions[0]!.writes[1]!) as Record<string, unknown>;
  assert.equal(authorization.kind, "authorize");
  assert.equal(authorization.authorizationToken, "a".repeat(64));
});

test("focus never authorizes an ambiguous, changed, or cancelled surface", async (context) => {
  const setup = await fixture(context);
  const transport = new FakeTransport();
  transport.configure = (session) => {
    session.onWrite = (request) => session.responses.push(envelope(request, "ready", {
      authorizationToken: "b".repeat(64), processId: 9999, surfaceId: "hwnd:changed"
    }));
  };
  const processPort = port(setup.helperPath, digest("fixed native helper"), transport);
  let barrierCalled = false;
  await assert.rejects(processPort.focusExisting({
    provider: "claude_desktop",
    operationId: "changed-focus",
    identity: setup.identity,
    process: { processId: 4100, windowId: "hwnd:100f", identity: setup.identity },
    signal: new AbortController().signal,
    shell: false,
    async beforeEffect() { barrierCalled = true; }
  }), /changed|exact|surface/i);
  assert.equal(barrierCalled, false);
  assert.equal(transport.sessions[0]?.writes.length, 1);
  assert.equal(transport.sessions[0]?.terminated, true);

  const cancelledTransport = new FakeTransport();
  cancelledTransport.configure = (session) => {
    session.onWrite = (request) => session.responses.push(envelope(request, "ready", {
      authorizationToken: "c".repeat(64), processId: 4100, surfaceId: "hwnd:100f"
    }));
  };
  const controller = new AbortController();
  await assert.rejects(port(setup.helperPath, digest("fixed native helper"), cancelledTransport).focusExisting({
    provider: "claude_desktop",
    operationId: "cancelled-focus",
    identity: setup.identity,
    process: { processId: 4100, windowId: "hwnd:100f", identity: setup.identity },
    signal: controller.signal,
    shell: false,
    async beforeEffect() { controller.abort(new Error("cancelled")); }
  }), /cancel/i);
  assert.equal(cancelledTransport.sessions[0]?.writes.length, 1);
  assert.equal(cancelledTransport.sessions[0]?.terminated, true);
});

test("fresh launch binds fixed arguments and proves a new distinct surface", async (context) => {
  const setup = await fixture(context);
  const transport = new FakeTransport();
  transport.configure = (session) => {
    session.onWrite = (request) => {
      if (request.kind === "authorize") {
        session.responses.push(envelope(request, "result", { processId: 4200, surfaceId: "hwnd:20aa", distinctSurface: true }));
      } else {
        session.responses.push(envelope(request, "ready", { authorizationToken: "d".repeat(64), preexistingSurfaceIds: ["hwnd:10aa"] }));
      }
    };
  };
  const processPort = port(setup.helperPath, digest("fixed native helper"), transport);
  const result = await processPort.launch({
    provider: "claude_desktop",
    operationId: "fresh-operation",
    identity: setup.identity,
    args: ["--new-window"],
    requireDistinctSurface: true,
    signal: new AbortController().signal,
    shell: false,
    async beforeEffect() {}
  });

  assert.deepEqual(result, { processId: 4200, surfaceId: "hwnd:20aa", distinctSurface: true });
  const prepare = JSON.parse(transport.sessions[0]!.writes[0]!) as Record<string, unknown>;
  assert.deepEqual(prepare.args, ["--new-window"]);
  assert.equal(prepare.requireDistinctSurface, true);

  await assert.rejects(processPort.launch({
    provider: "claude_desktop",
    operationId: "unreviewed-args",
    identity: setup.identity,
    args: ["--new-window", "C:\\workspace\\prompt.txt"],
    requireDistinctSurface: true,
    signal: new AbortController().signal,
    shell: false,
    async beforeEffect() {}
  }), /fixed|arguments|profile/i);
});

test("a fresh result cannot reuse a preexisting surface and abort terminates only its helper session", async (context) => {
  const setup = await fixture(context);
  const transport = new FakeTransport();
  transport.configure = (session) => {
    session.onWrite = (request) => {
      if (request.kind === "authorize") session.responses.push(envelope(request, "result", { processId: 4200, surfaceId: "hwnd:0dd", distinctSurface: true }));
      else session.responses.push(envelope(request, "ready", { authorizationToken: "e".repeat(64), preexistingSurfaceIds: ["hwnd:0dd"] }));
    };
  };
  const processPort = port(setup.helperPath, digest("fixed native helper"), transport);
  await assert.rejects(processPort.launch({
    provider: "chatgpt_desktop",
    operationId: "not-distinct",
    identity: { ...setup.identity, productIdentity: { productId: "openai.chatgpt-desktop", displayName: "ChatGPT Desktop", publisher: "OpenAI, L.L.C.", role: "desktop" } },
    args: ["--new-window"],
    requireDistinctSurface: true,
    signal: new AbortController().signal,
    shell: false,
    async beforeEffect() {}
  }), /distinct|preexisting/i);
  assert.equal(transport.sessions[0]?.terminated, true);

  const cancelledTransport = new FakeTransport();
  const controller = new AbortController();
  cancelledTransport.configure = (session) => {
    let reads = 0;
    session.onWrite = (request) => {
      if (request.kind !== "authorize") session.responses.push(envelope(request, "ready", { authorizationToken: "f".repeat(64), preexistingSurfaceIds: [] }));
    };
    session.onRead = async () => {
      reads += 1;
      if (reads === 1) return session.responses.shift()!;
      return new Promise<string>(() => undefined);
    };
  };
  const pending = port(setup.helperPath, digest("fixed native helper"), cancelledTransport).launch({
    provider: "claude_desktop",
    operationId: "cancel-task-owned-launch",
    identity: setup.identity,
    args: ["--new-window"],
    requireDistinctSurface: true,
    signal: controller.signal,
    shell: false,
    async beforeEffect() { setTimeout(() => controller.abort(), 0); }
  });
  await assert.rejects(pending, /cancel/i);
  assert.equal(cancelledTransport.sessions[0]?.terminated, true);
});

test("helper identity drift and malformed or oversized native output fail closed", async (context) => {
  const setup = await fixture(context);
  const transport = new FakeTransport();
  const processPort = port(setup.helperPath, digest("fixed native helper"), transport);
  await writeFile(setup.helperPath, "tampered helper", "utf8");
  await assert.rejects(processPort.listRunning(setup.identity, new AbortController().signal), /helper.*identity|digest|changed/i);
  assert.equal(transport.invocations.length, 0);

  await writeFile(setup.helperPath, "fixed native helper", "utf8");
  const malformedTransport = new FakeTransport();
  malformedTransport.configure = (session) => { session.onWrite = () => session.responses.push("x".repeat(70_000)); };
  await assert.rejects(port(setup.helperPath, digest("fixed native helper"), malformedTransport).listRunning(setup.identity, new AbortController().signal), /oversized|invalid|response/i);
  assert.equal(malformedTransport.sessions[0]?.terminated, true);
});
