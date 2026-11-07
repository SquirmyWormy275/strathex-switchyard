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
  NodeProviderDesktopHelperTransport,
  WindowsProviderDesktopProcessPort,
  type ProviderDesktopHelperInvocation,
  type ProviderDesktopHelperSession,
  type ProviderDesktopHelperTransport,
  type WindowsProviderDesktopProcessPortOptions
} from "../src/windows-provider-process.ts";

const digest = (value: string | Buffer): string => createHash("sha256").update(value).digest("hex");
const responseSchema = "sxsy-b122.provider-desktop-response";

class FakeSession implements ProviderDesktopHelperSession {
  readonly processId = 7111;
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
    device: "4294967295",
    inode: "59672695062879660"
  };
  return { root, helperPath, executablePath, identity };
}

function port(helperPath: string, helperSha256: string, transport: FakeTransport, focusOnly = false, callbacks: Partial<Pick<WindowsProviderDesktopProcessPortOptions, "onHelperOwned" | "onHelperStopped">> = {}) {
  return new WindowsProviderDesktopProcessPort({
    helperPath,
    helperSha256,
    transport,
    focusOnly,
    ...(focusOnly ? { onHelperOwned: async () => {}, onHelperStopped: async () => {} } : {}),
    ...callbacks,
    hostEnvironment: { SystemRoot: "C:\\Windows", WINDIR: "C:\\Windows", PATH: "must-not-leak", SECRET_TOKEN: "must-not-leak" }
  });
}

function envelope(request: Record<string, unknown>, kind: "ready" | "result" | "error", body: Record<string, unknown>): string {
  return JSON.stringify({ schema: responseSchema, version: 2, requestId: request.requestId, kind, ...body });
}
const helperOwner = Object.freeze({ processId: 7111, processStartTime: "133000000000000001" });
const ownerHello = (changes = {}) => JSON.stringify({ schema: "switchyard-native-focus-owner/v1", ...helperOwner, ...changes });

test("focus helper ownership is recorded before requests and cleared only after exact child closure", async context => {
  const setup = await fixture(context), transport = new FakeTransport(), events: string[] = [];
  transport.configure = session => {
    session.responses.push(ownerHello());
    session.onWrite = request => { events.push("request"); session.responses.push(envelope(request, "result", { observations: [] })); };
    session.wait = async () => { events.push("exit"); return { code: 0, signal: null }; };
  };
  const processPort = port(setup.helperPath, digest("fixed native helper"), transport, true, {
    async onHelperOwned(owner) { assert.deepEqual(owner, helperOwner); assert.equal(Object.isFrozen(owner), true); events.push("owned"); },
    async onHelperStopped(owner) { assert.deepEqual(owner, helperOwner); events.push("stopped"); }
  });
  assert.deepEqual(await processPort.listRunning(setup.identity, new AbortController().signal), []);
  assert.deepEqual(events, ["owned", "request", "exit", "stopped"]);
});

test("focus helper refuses missing, substituted or lossy owner identity before writing requests", async context => {
  const setup = await fixture(context);
  for (const changes of [{ processId: 7112 }, { processId: undefined }, { processStartTime: 133000000000000001 }, { processStartTime: "0" }, { processStartTime: "1".repeat(513) }, { extra: "untrusted" }, { schema: "older-owner/v0" }]) {
    const transport = new FakeTransport(); let owned = 0;
    transport.configure = session => { session.responses.push(ownerHello(changes)); };
    await assert.rejects(port(setup.helperPath, digest("fixed native helper"), transport, true, { async onHelperOwned() { owned++; } }).listRunning(setup.identity, new AbortController().signal), /owner|birth|identity/i);
    assert.equal(owned, 0); assert.equal(transport.sessions[0]!.writes.length, 0); assert.equal(transport.sessions[0]!.terminated, true);
  }
});

test("failed owner persistence cannot send a request and failed retirement persistence blocks replacement", async context => {
  const setup = await fixture(context), transport = new FakeTransport(); let owned = 0, allowRetirement = false;
  transport.configure = session => { session.responses.push(ownerHello()); session.onWrite = request => session.responses.push(envelope(request, "result", { observations: [] })); };
  const processPort = port(setup.helperPath, digest("fixed native helper"), transport, true, {
    async onHelperOwned() { if (++owned === 1) throw Error("synthetic owner write failure"); },
    async onHelperStopped() { if (!allowRetirement) throw Error("synthetic retirement write failure"); }
  });
  await assert.rejects(processPort.listRunning(setup.identity, new AbortController().signal), /retirement.*unconfirmed/i);
  assert.equal(transport.sessions[0]!.writes.length, 0);
  await assert.rejects(processPort.listRunning(setup.identity, new AbortController().signal), /retirement.*unconfirmed/i);
  assert.equal(transport.invocations.length, 1);
  allowRetirement = true;
  assert.deepEqual(await processPort.listRunning(setup.identity, new AbortController().signal), []); assert.equal(transport.invocations.length, 2);
});

test("cancellation joins pending owner persistence before recording helper retirement", async context => {
  const setup = await fixture(context), transport = new FakeTransport(), controller = new AbortController(), events: string[] = [];
  let started!: () => void, release!: () => void;
  const recording = new Promise<void>(resolve => { started = resolve; }), gate = new Promise<void>(resolve => { release = resolve; });
  transport.configure = session => { session.responses.push(ownerHello()); };
  const processPort = port(setup.helperPath, digest("fixed native helper"), transport, true, {
    async onHelperOwned() { started(); await gate; events.push("owned"); },
    async onHelperStopped() { events.push("stopped"); }
  });
  const pending = processPort.listRunning(setup.identity, controller.signal); void pending.catch(() => {});
  await recording; controller.abort();
  try { await new Promise(resolve => setImmediate(resolve)); assert.deepEqual(events, []); assert.equal(transport.sessions[0]!.writes.length, 0); }
  finally { release(); }
  await assert.rejects(pending, /cancel/i); assert.deepEqual(events, ["owned", "stopped"]); assert.equal(transport.sessions[0]!.writes.length, 0);
});

test("list uses only the exact hash-bound helper and a sanitized fixed protocol", async (context) => {
  const setup = await fixture(context);
  const transport = new FakeTransport();
  transport.configure = (session) => {
    session.onWrite = (request) => session.responses.push(envelope(request, "result", {
      observations: [{ processId: 4100, processStartTime: "133000000000000001", surfaceId: "hwnd:100f", isForeground: true }]
    }));
  };
  const processPort = port(setup.helperPath, digest("fixed native helper"), transport);

  const observations = await processPort.listRunning(setup.identity, new AbortController().signal);

  assert.equal(observations.length, 1);
  assert.equal(observations[0]?.windowId, "hwnd:100f");
  assert.equal(observations[0]?.processStartTime, "133000000000000001");
  assert.equal(observations[0]?.isForeground, true);
  assert.deepEqual(observations[0]?.identity, setup.identity);
  assert.deepEqual(transport.invocations[0]?.arguments, ["--stdio-v2"]);
  assert.deepEqual(transport.invocations[0]?.environment, { SystemRoot: "C:\\Windows", WINDIR: "C:\\Windows" });
  const request = JSON.parse(transport.sessions[0]!.writes[0]!) as Record<string, unknown>;
  assert.equal(request.action, "list");
  assert.equal(request.provider, "claude_desktop");
  assert.equal("cwd" in request, false);
  assert.equal("command" in request, false);
  assert.equal(JSON.stringify(request).includes("must-not-leak"), false);
});

test("focus-only helper mode cannot launch a provider or silently use the broader helper entrypoint", async (context) => {
  const setup = await fixture(context), transport = new FakeTransport();
  transport.configure = session => { session.responses.push(ownerHello()); session.onWrite = request => session.responses.push(envelope(request, "result", { observations: [] })); };
  const processPort = port(setup.helperPath, digest("fixed native helper"), transport, true);
  assert.deepEqual(await processPort.listRunning(setup.identity, new AbortController().signal), []);
  assert.deepEqual(transport.invocations[0]!.arguments, ["--native-desktop-focus-v3"]);
  let barriers = 0;
  for (const requireDistinctSurface of [false, true]) await assert.rejects(processPort.launch({
    provider: "claude_desktop", operationId: "forbidden-suite-launch", identity: setup.identity,
    args: requireDistinctSurface ? ["--new-window"] : [], requireDistinctSurface,
    signal: new AbortController().signal, shell: false, async beforeEffect() { barriers++; }
  }), /focus-only.*cannot launch/i);
  assert.equal(transport.invocations.length, 1); assert.equal(barriers, 0);
});

test("focus authorizes only after the host barrier while the helper holds the exact one-surface identity", async (context) => {
  const setup = await fixture(context);
  const transport = new FakeTransport();
  const ordering: string[] = [];
  transport.configure = (session) => {
    session.onWrite = (request) => {
      if (request.kind === "authorize") {
        ordering.push("authorize");
        session.responses.push(envelope(request, "result", { processId: 4100, processStartTime: "133000000000000001", surfaceId: "hwnd:100f", windowFocusVerified: true }));
      } else {
        ordering.push("prepare");
        session.responses.push(envelope(request, "ready", { authorizationToken: "a".repeat(64), processId: 4100, processStartTime: "133000000000000001", surfaceId: "hwnd:100f", windowFocusVerified: true }));
      }
    };
  };
  const processPort = port(setup.helperPath, digest("fixed native helper"), transport);
  const request: ProviderProcessEffectRequest & { readonly process: { readonly processId: number; readonly processStartTime: string; readonly windowId: string; readonly isForeground: boolean; readonly identity: ProviderExecutableIdentity } } = {
    provider: "claude_desktop",
    operationId: "focus-operation",
    identity: setup.identity,
    process: { processId: 4100, processStartTime: "133000000000000001", windowId: "hwnd:100f", isForeground: true, identity: setup.identity },
    signal: new AbortController().signal,
    shell: false,
    async beforeEffect() { ordering.push("barrier"); }
  };

  assert.deepEqual(await processPort.focusExisting(request), { processId: 4100 });
  assert.deepEqual(ordering, ["prepare", "barrier", "authorize"]);
  assert.equal(JSON.parse(transport.sessions[0]!.writes[0]!).expectedProcessStartTime, "133000000000000001");
  const authorization = JSON.parse(transport.sessions[0]!.writes[1]!) as Record<string, unknown>;
  assert.equal(authorization.kind, "authorize");
  assert.equal(authorization.authorizationToken, "a".repeat(64));
});

test("focus never authorizes an ambiguous, changed, or cancelled surface", async (context) => {
  const setup = await fixture(context);
  const transport = new FakeTransport();
  transport.configure = (session) => {
    session.onWrite = (request) => session.responses.push(envelope(request, "ready", {
      authorizationToken: "b".repeat(64), processId: 9999, processStartTime: "133000000000000001", surfaceId: "hwnd:changed"
    }));
  };
  const processPort = port(setup.helperPath, digest("fixed native helper"), transport);
  let barrierCalled = false;
  await assert.rejects(processPort.focusExisting({
    provider: "claude_desktop",
    operationId: "changed-focus",
    identity: setup.identity,
    process: { processId: 4100, processStartTime: "133000000000000001", windowId: "hwnd:100f", isForeground: true, identity: setup.identity },
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
      authorizationToken: "c".repeat(64), processId: 4100, processStartTime: "133000000000000001", surfaceId: "hwnd:100f"
    }));
  };
  const controller = new AbortController();
  await assert.rejects(port(setup.helperPath, digest("fixed native helper"), cancelledTransport).focusExisting({
    provider: "claude_desktop",
    operationId: "cancelled-focus",
    identity: setup.identity,
    process: { processId: 4100, processStartTime: "133000000000000001", windowId: "hwnd:100f", isForeground: true, identity: setup.identity },
    signal: controller.signal,
    shell: false,
    async beforeEffect() { controller.abort(new Error("cancelled")); }
  }), /cancel/i);
  assert.equal(cancelledTransport.sessions[0]?.writes.length, 1);
  assert.equal(cancelledTransport.sessions[0]?.terminated, true);
});

test("focus refuses a recycled PID even when the executable and window handle match", async (context) => {
  const setup = await fixture(context), transport = new FakeTransport();
  let barrierCalls = 0;
  transport.configure = session => { session.onWrite = request => session.responses.push(envelope(request,
    request.kind === "authorize" ? "result" : "ready", {
      authorizationToken: "d".repeat(64), processId: 4100, surfaceId: "hwnd:100f",
      processStartTime: "133000000000000002", windowFocusVerified: true
    })); };
  const process = { processId: 4100, windowId: "hwnd:100f", isForeground: false,
    processStartTime: "133000000000000001", identity: setup.identity };
  await assert.rejects(port(setup.helperPath, digest("fixed native helper"), transport).focusExisting({
    provider: "claude_desktop", operationId: "recycled-pid", identity: setup.identity, process,
    signal: new AbortController().signal, shell: false, async beforeEffect() { barrierCalls++; }
  }), /birth|start|changed/i);
  assert.equal(barrierCalls, 0);
  assert.equal(transport.sessions[0]?.writes.length, 1);
  assert.equal(transport.sessions[0]?.terminated, true);
});

test("focus requires unchanged process birth and native foreground readback after authorization", async (context) => {
  const setup = await fixture(context);
  for (const changed of ["birth", "missing-birth", "readback", "missing-readback"]) {
    const transport = new FakeTransport(); let barrierCalls = 0;
    transport.configure = session => { session.onWrite = request => {
      const authorized = request.kind === "authorize";
      session.responses.push(envelope(request, authorized ? "result" : "ready", {
        authorizationToken: "e".repeat(64), processId: 4100, surfaceId: "hwnd:100f",
        processStartTime: authorized && changed === "missing-birth" ? undefined : authorized && changed === "birth" ? "133000000000000002" : "133000000000000001",
        windowFocusVerified: authorized && changed === "missing-readback" ? undefined : !(authorized && changed === "readback")
      }));
    }; };
    const process = { processId: 4100, windowId: "hwnd:100f", isForeground: false,
      processStartTime: "133000000000000001", identity: setup.identity };
    await assert.rejects(port(setup.helperPath, digest("fixed native helper"), transport).focusExisting({
      provider: "claude_desktop", operationId: "readback-" + changed, identity: setup.identity, process,
      signal: new AbortController().signal, shell: false, async beforeEffect() { barrierCalls++; }
    }), /birth|start|changed|readback|foreground/i);
    assert.equal(barrierCalls, 1); assert.equal(transport.sessions[0]?.writes.length, 2);
    assert.equal(transport.sessions[0]?.terminated, true);
  }
});

test("list refuses missing or lossy process birth identities", async (context) => {
  const setup = await fixture(context);
  for (const processStartTime of [undefined, 133000000000000001, "0", "01", "-1", "18446744073709551616"]) {
    const transport = new FakeTransport();
    transport.configure = session => { session.onWrite = request => session.responses.push(envelope(request, "result", {
      observations: [{ processId: 4100, surfaceId: "hwnd:100f", isForeground: false, processStartTime }]
    })); };
    await assert.rejects(port(setup.helperPath, digest("fixed native helper"), transport).listRunning(setup.identity, new AbortController().signal), /birth|start/i);
    assert.equal(transport.sessions[0]?.terminated, true);
  }
});

test("old helper protocol cannot substitute for witnessed process discovery", async (context) => {
  const setup = await fixture(context), transport = new FakeTransport();
  transport.configure = session => { session.onWrite = request => session.responses.push(envelope(request, "result", { version: 1,
    observations: [{ processId: 4100, processStartTime: "133000000000000001", surfaceId: "hwnd:100f", isForeground: false }]
  })); };
  await assert.rejects(port(setup.helperPath, digest("fixed native helper"), transport).listRunning(setup.identity, new AbortController().signal), /bound to the exact request/i);
  assert.equal(transport.sessions[0]?.terminated, true);
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

test("unconfirmed helper exit blocks results and replacement until the original session retires", async (context) => {
  const setup = await fixture(context), transport = new FakeTransport();
  let confirmed = false, waits = 0, terminations = 0;
  transport.configure = session => {
    session.onWrite = request => session.responses.push(envelope(request, "result", { observations: [] }));
    session.terminate = async () => { terminations++; throw Error("synthetic kill failure"); };
    session.wait = async () => { waits++; if (!confirmed) throw Error("synthetic unavailable exit"); return { code: 0, signal: null }; };
  };
  const processPort = port(setup.helperPath, digest("fixed native helper"), transport), signal = new AbortController().signal;
  const unconfirmed = (error: unknown) => error instanceof Error && "code" in error && error.code === "PROVIDER_HELPER_EXIT_UNCONFIRMED";
  await assert.rejects(processPort.listRunning(setup.identity, signal), unconfirmed);
  await assert.rejects(processPort.listRunning(setup.identity, signal), unconfirmed);
  assert.equal(transport.invocations.length, 1); assert.equal(waits, 2); assert.equal(terminations, 2);
  confirmed = true;
  assert.deepEqual(await processPort.listRunning(setup.identity, signal), []);
  assert.equal(transport.invocations.length, 2); assert.equal(waits, 4);
});

test("a helper that never confirms exit reaches the fixed retirement bound and remains owned", async (context) => {
  const setup = await fixture(context), transport = new FakeTransport();
  transport.configure = session => {
    session.onWrite = request => session.responses.push(envelope(request, "result", { observations: [] }));
    session.wait = () => new Promise(() => {});
  };
  const processPort = port(setup.helperPath, digest("fixed native helper"), transport);
  await assert.rejects(processPort.listRunning(setup.identity, new AbortController().signal), /original.*exit.*unconfirmed/i);
  assert.equal(transport.sessions.length, 1); assert.equal(transport.sessions[0]!.terminated, true);
  transport.sessions[0]!.wait = async () => ({ code: 0, signal: null });
  transport.configure = session => { session.onWrite = request => session.responses.push(envelope(request, "result", { observations: [] })); };
  assert.deepEqual(await processPort.listRunning(setup.identity, new AbortController().signal), []);
});

test("helper ownership is reserved before asynchronous startup and concurrent operations do not replace it", async (context) => {
  const setup = await fixture(context), transport = new FakeTransport();
  let started!: () => void, release!: () => void;
  const starting = new Promise<void>(resolve => { started = resolve; }), gate = new Promise<void>(resolve => { release = resolve; });
  const original = transport.start.bind(transport);
  let starts = 0;
  transport.start = async invocation => { starts++; started(); if (starts === 1) await gate; return original(invocation); };
  transport.configure = session => { session.onWrite = request => session.responses.push(envelope(request, "result", { observations: [] })); };
  const processPort = port(setup.helperPath, digest("fixed native helper"), transport), signal = new AbortController().signal;
  const pending = processPort.listRunning(setup.identity, signal); void pending.catch(() => {});
  await starting;
  try { await assert.rejects(processPort.listRunning(setup.identity, signal), /already in progress/); }
  finally { release(); }
  assert.deepEqual(await pending, []); assert.equal(transport.invocations.length, 1);
});

test("cancellation waits for the exact helper exit and rejects unconfirmed retirement", async (context) => {
  const setup = await fixture(context), transport = new FakeTransport(), controller = new AbortController();
  let waited = false;
  transport.configure = session => {
    session.onWrite = () => controller.abort();
    session.onRead = () => new Promise(() => {});
    session.terminate = async () => { throw Error("synthetic termination failure"); };
    session.wait = async () => { waited = true; throw Error("synthetic missing exit"); };
  };
  await assert.rejects(port(setup.helperPath, digest("fixed native helper"), transport).listRunning(setup.identity, controller.signal), /original.*exit.*unconfirmed/i);
  assert.equal(waited, true); assert.equal(transport.invocations.length, 1);
});

test("native helper transport joins actual owned child closure after termination", async () => {
  const session = await new NodeProviderDesktopHelperTransport().start({ helperPath: process.execPath, helperSha256: "a".repeat(64), arguments: ["--input-type=module", "-e", 'process.stdout.write("ready\\n");setInterval(()=>{},1000);'], environment: {} });
  try { assert.equal(await session.read(), "ready"); }
  finally { await session.terminate(); }
  const exit = await session.wait(); assert.ok(Number.isInteger(exit.code)); assert.ok(exit.signal !== null || exit.code !== 0);
});

test("native helper transport never returns queued output after a terminal protocol error", async () => {
  const session = await new NodeProviderDesktopHelperTransport().start({ helperPath: process.execPath, helperSha256: "a".repeat(64), arguments: ["--input-type=module", "-e", 'process.stdout.write("queued\\n",()=>process.stderr.write("x".repeat(4097)));setInterval(()=>{},1000);'], environment: {} });
  try { await session.wait(); await assert.rejects(session.read(), /diagnostic output/); }
  finally { await session.terminate(); await session.wait(); }
});

test("closed helper protocol failures cannot promote earlier results and do not retain exited ownership", async (context) => {
  const setup = await fixture(context), transport = new FakeTransport();
  for (const flags of [{ protocolFailed: true }, { unreadResponses: 1 }]) {
    transport.configure = session => {
      session.onWrite = request => session.responses.push(envelope(request, "result", { observations: [] }));
      session.wait = async () => ({ code: 0, signal: null, ...flags });
    };
    const processPort = port(setup.helperPath, digest("fixed native helper"), transport);
    await assert.rejects(processPort.listRunning(setup.identity, new AbortController().signal), /earlier result was not accepted/);
    transport.configure = session => { session.onWrite = request => session.responses.push(envelope(request, "result", { observations: [] })); };
    assert.deepEqual(await processPort.listRunning(setup.identity, new AbortController().signal), []);
  }
});
