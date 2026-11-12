import assert from "node:assert/strict";
import test from "node:test";
import { createHash, randomUUID } from "node:crypto";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { once } from "node:events";
import { createSuiteStore } from "./suite-store.mjs";
import { createSuite } from "./suite.mjs";
import { createStudioServer } from "./serve.mjs";
import { createWindowsNativeFocus, validateNativeFocusOwnerExit } from "./windows-native-focus.mjs";
import { WindowsProviderDesktopProcessPort } from "../../apps/windows-companion/src/windows-provider-process.ts";

const implementation = "native-chatgpt.focus/v1";
const digest = value => createHash("sha256").update(value).digest("hex");
const surface = { processId: 4100, processStartTime: "133000000000000001", surfaceId: "hwnd:100f", isForeground: false };
const deferred = () => { let resolve; const promise = new Promise(r => { resolve = r; }); return { promise, resolve }; };

async function fixture(t) {
  const root = await mkdtemp(join(tmpdir(), "sx-windows-focus-")), keys = new Map();
  const store = createSuiteStore({ root: join(root, "private"), secrets: { get: async (c,p) => keys.get(c + p), set: async (c,p,v) => { keys.set(c + p, v); } } });
  await store.initialize("personal"); await store.initialize("work", "work");
  await store.update("personal", "synthetic-mode", state => { state.mode = "personal-companion"; });
  const executablePath = join(root, "ChatGPT.exe"), helperPath = join(root, "Switchyard.Hotkeys.exe");
  await writeFile(executablePath, "synthetic reviewed application"); await writeFile(helperPath, "synthetic helper");
  const f = { store, root, executablePath, helperPath, now: 100, active: "personal", sessions: [], requests: [], effects: 0, observations: [surface],
    beforeReady: async () => {}, afterEffect: async () => {}, beforeOwnedRequest: async () => {}, exitUnknown: false, observedExit: false, observedOwners: [] };
  f.options = {
    store, platform: "win32", isActive: async c => f.active === c, now: () => f.now,
    signatureProbe: { inspect: async () => ({ signerSubject: "CN=Isolated Focus Fixture", signerThumbprint: "a".repeat(40) }) },
    helper: async () => ({ path: helperPath, sha256: digest("synthetic helper") }),
    observeExit: async (_helper, owner, signal) => { f.observedOwners.push(structuredClone(owner)); await f.beforeObserve?.(signal); return f.observedExit; },
    processFactory: options => new WindowsProviderDesktopProcessPort({ ...options, hostEnvironment: { SystemRoot: "C:\\Windows" }, transport: {
      async start(invocation) {
        assert.deepEqual(invocation.arguments, [options.claudeLaunchOnly ? "--native-claude-launch-v1" : "--native-desktop-focus-v3"]);
        const owner = { processId: 7111 + f.sessions.length, processStartTime: String(133000000000000010n + BigInt(f.sessions.length)) };
        const responses = [JSON.stringify({ schema: "switchyard-native-focus-owner/v1", ...owner })];
        let waiting, ended = false;
        const push = value => { if (waiting) { const receiver = waiting; waiting = undefined; receiver.resolve(value); } else responses.push(value); };
        const session = { processId: owner.processId, owner, terminated: false,
          async write(line) {
            const value = JSON.parse(line), records = (await store.snapshot("personal")).nativeFocusOperations;
            assert(records.some(record => record.helpers.some(h => h.identity.processId === owner.processId && !h.stopped)), "owner must be durable before every request");
            f.requests.push(value); await f.beforeOwnedRequest(value);
            const envelope = (kind, body) => JSON.stringify({ schema: "sxsy-b122.provider-desktop-response", version: 2, requestId: value.requestId, kind, ...body });
            if (value.action === "list") push(envelope("result", { observations: f.observations }));
            else if (value.action === "focus") { await f.beforeReady(); if (!ended) push(envelope("ready", { ...surface, authorizationToken: "a".repeat(64) })); }
            else if (value.action === "launch") { await f.beforeReady(); if (!ended) push(envelope("ready", { authorizationToken: "a".repeat(64), preexistingSurfaceIds: f.observations.map(row => row.surfaceId) })); }
            else if (value.kind === "authorize") { f.effects++; await f.afterEffect(); push(envelope("result", { ...surface, ...(options.claudeLaunchOnly ? { distinctSurface: true } : { windowFocusVerified: true }) })); }
            else throw Error("Unexpected native request");
          },
          async read() { if (responses.length) return responses.shift(); if (ended) throw Error("synthetic helper closed"); return new Promise((resolve, reject) => { waiting = { resolve, reject }; }); },
          async terminate() { session.terminated = true; ended = true; waiting?.reject(Error("synthetic helper closed")); waiting = undefined; },
          async wait() { if (f.exitUnknown) throw Error("synthetic missing close observation"); return { code: 0, signal: null }; }
        };
        f.sessions.push(session); return session;
      }
    } })
  };
  f.service = createWindowsNativeFocus(f.options);
  f.configure = async (target = implementation, path = executablePath) => { const review = await f.service.review("personal", { implementation: target, executablePath: path }); await f.service.configure("personal", { reviewId: review.reviewId, confirmation: review.confirmation }); return review; };
  t.after(async () => {
    f.exitUnknown = false;
    if (f.server) { f.server.closeAllConnections(); await new Promise(resolve => f.server.close(resolve)); }
    await f.suite?.close(); await f.service.close(); await rm(root, { recursive: true, force: true });
  });
  return f;
}

const launchImplementation = "native-claude-desktop.launch/v1";
async function launchFixture(t) {
  const f = await fixture(t), path = join(f.root, "Claude.exe");
  await writeFile(path, "synthetic reviewed Claude");
  await f.configure("native-claude-desktop.focus/v1", path); f.observations = [];
  f.launchInput = async () => {
    const review = await f.service.reviewLaunch("personal", { implementation: launchImplementation });
    return { implementation: launchImplementation, reviewId: review.reviewId, confirmation: review.confirmation, requestId: randomUUID() };
  };
  f.claudePath = path; return f;
}

test("Claude launch review is separate from configured trust and records one exact acknowledged launch", async t => {
  const f = await launchFixture(t), sealed = join(f.root, "private/personal.sealed.json"), before = await readFile(sealed);
  const input = await f.launchInput(); assert.deepEqual(await readFile(sealed), before); assert.equal(f.sessions.length, 0);
  await assert.rejects(f.service.launch("personal", { ...input, confirmation: "Trust Windows Claude Desktop" }));
  const result = await f.service.launch("personal", input);
  assert.equal(result.applicationOpenedVerified, true); assert.equal(result.windowFocusVerified, false); assert.equal(result.accountVerified, false); assert.equal(result.taskResumptionVerified, false);
  assert.equal(result.processStartTime, surface.processStartTime); assert.equal(f.effects, 1); assert.equal(f.sessions.length, 2);
  const record = (await f.store.snapshot("personal")).nativeFocusOperations.at(-1);
  assert.equal(record.kind, "launch"); assert.equal(record.status, "completed"); assert(record.helpers.every(h => h.stopped));
  assert.equal((await f.service.launch("personal", input)).replayed, true); assert.equal(f.effects, 1); assert.equal(f.sessions.length, 2);
  await assert.rejects(f.service.launch("personal", { ...input, requestId: randomUUID() }), /review/);
  await assert.rejects(f.service.launch("personal", { ...input, confirmation: "changed" }), /replayed|review/);
});

test("an existing Claude window refuses launch without silently focusing or opening another window", async t => {
  const f = await launchFixture(t), input = await f.launchInput(); f.observations = [surface];
  await assert.rejects(f.service.launch("personal", input), /existing|already open/);
  assert.equal(f.effects, 0); assert.equal(f.sessions.length, 1); assert.equal(f.requests.some(row => row.action === "launch" || row.action === "focus"), false);
});

test("Claude launch review cannot survive changed image, account, workspace selection or expiry", async t => {
  for (const mutation of ["image", "account", "selection", "expiry"]) await t.test(mutation, async sub => {
    const f = await launchFixture(sub), input = await f.launchInput();
    if (mutation === "image") await writeFile(f.claudePath, "changed reviewed image");
    if (mutation === "account") await f.store.update("personal", "synthetic-revocation", s => { s.accounts.push("changed"); });
    if (mutation === "selection") f.active = "work";
    if (mutation === "expiry") f.now += 300001;
    await assert.rejects(f.service.launch("personal", input)); assert.equal(f.effects, 0);
    assert.equal(f.requests.some(row => row.kind === "authorize"), false);
  });
});

test("Claude launch rechecks workspace at the native effect barrier and retains a lost successful reply", async t => {
  const f = await launchFixture(t), refused = await f.launchInput(); f.beforeReady = async () => { f.active = "work"; };
  await assert.rejects(f.service.launch("personal", refused), /workspace/); assert.equal(f.effects, 0);
  f.active = "personal"; f.beforeReady = async () => {}; const lost = await f.launchInput();
  f.afterEffect = async () => { throw Error("synthetic lost launch reply"); };
  await assert.rejects(f.service.launch("personal", lost), /lost launch reply/); assert.equal(f.effects, 1);
  const original = (await f.store.snapshot("personal")).nativeFocusOperations.find(row => row.id === lost.requestId);
  assert.equal(original.status, "outcome-unconfirmed"); assert.equal(original.effectAuthorized, true); assert(original.helpers.every(h => h.stopped));
  f.afterEffect = async () => {}; await assert.rejects(f.service.launch("personal", lost), /cannot be replayed/); assert.equal(f.effects, 1);
});

test("native application review is local, one-use and bound to encrypted exact executable identity", async t => {
  const f = await fixture(t), file = join(f.root, "private/personal.sealed.json"), before = await readFile(file);
  const review = await f.service.review("personal", { implementation, executablePath: f.executablePath });
  assert.deepEqual(await readFile(file), before); assert.equal(f.sessions.length, 0);
  assert.equal(review.identity.executableSha256, digest("synthetic reviewed application"));
  const original = structuredClone(review.identity); review.identity.executableSha256 = "b".repeat(64);
  await assert.rejects(f.service.configure("personal", { reviewId: review.reviewId, confirmation: "wrong" }));
  const result = await f.service.configure("personal", { reviewId: review.reviewId, confirmation: review.confirmation });
  assert.equal(result.configured, true); assert.equal(result.windowFocused, false);
  assert.deepEqual((await f.store.snapshot("personal")).nativeWindowsChatgpt.identity, original);
  assert.equal((await readFile(file, "utf8")).includes("ChatGPT.exe"), false);
  await assert.rejects(f.service.configure("personal", { reviewId: review.reviewId, confirmation: review.confirmation }), /missing/);
});

test("review confirmation refuses changed bytes, account scope, selection, expiry and extra fields", async t => {
  const f = await fixture(t);
  for (const input of [{ implementation, executablePath: f.executablePath, launch: true }, { implementation: "native-vscode.launch/v1", executablePath: f.executablePath }]) await assert.rejects(f.service.review("personal", input));
  for (const mutation of ["bytes", "accounts", "selection", "expiry", "retired-review"]) {
    f.active = "personal";
    const review = await f.service.review("personal", { implementation, executablePath: f.executablePath });
    if (mutation === "bytes") await writeFile(f.executablePath, "changed reviewed bytes");
    if (mutation === "accounts") await f.store.update("personal", "synthetic-account", s => { s.accounts.push("changed"); });
    if (mutation === "selection") f.active = "work";
    if (mutation === "expiry") f.now += 300001;
    if (mutation === "retired-review") await f.service.stopCompartment("personal");
    await assert.rejects(f.service.configure("personal", { reviewId: review.reviewId, confirmation: review.confirmation }));
  }
  assert.equal(f.sessions.length, 0);
});

test("configured focus records exact helpers before requests and replays a completed UUID without another effect", async t => {
  const f = await fixture(t); await f.configure(); const requestId = randomUUID();
  const result = await f.service.focus("personal", implementation, { requestId });
  assert.equal(result.windowFocusVerified, true); assert.equal(result.accountVerified, false); assert.equal(result.taskResumptionVerified, false); assert.equal(result.modelPromptSubmitted, false);
  assert.equal(f.effects, 1); assert.equal(f.sessions.length, 2); assert(f.sessions.every(s => s.terminated));
  const record = (await f.store.snapshot("personal")).nativeFocusOperations[0];
  assert.equal(record.status, "completed"); assert.equal(record.helpers.length, 2); assert(record.helpers.every(h => h.stopped));
  assert.equal((await f.service.focus("personal", implementation, { requestId })).replayed, true); assert.equal(f.effects, 1); assert.equal(f.sessions.length, 2);
  const inspection = await f.service.inspect("personal", implementation); assert.equal(inspection.windowFocusVerified, false); assert.equal(f.effects, 1); assert.equal(f.sessions.length, 3);
});

test("Windows VS Code focus has its own reviewed identity and cannot replay a ChatGPT request", async t => {
  const f = await fixture(t), editor = "native-vscode.focus/v1", codePath = join(f.root, "Code.exe");
  await writeFile(codePath, "synthetic reviewed editor"); await f.configure();
  const review = await f.configure(editor, codePath); assert.match(review.confirmation, /^Trust Windows VS Code /);
  const state = await f.store.snapshot("personal");
  assert.equal(state.nativeWindowsVscode.identity.productIdentity.productId, "microsoft.visual-studio-code");
  assert.equal(state.nativeWindowsChatgpt.identity.executableSha256, digest("synthetic reviewed application"));
  const requestId = randomUUID(); await f.service.focus("personal", implementation, { requestId });
  await assert.rejects(f.service.focus("personal", editor, { requestId }), /cannot be replayed/);
  const result = await f.service.focus("personal", editor, { requestId: randomUUID() });
  assert.equal(result.provider, "native-vscode"); assert.equal(result.windowFocusVerified, true); assert.equal(result.projectVerified, false); assert.equal(result.taskResumptionVerified, false);
  assert.deepEqual(f.requests.filter(value => value.action === "focus").map(value => value.provider), ["chatgpt_desktop", "vscode"]); assert.equal(f.effects, 2);
  assert((await f.store.snapshot("personal")).nativeFocusOperations.every(row => row.helpers.every(owner => owner.stopped)));
});

test("missing, duplicate or changed application targets refuse without a focus authorization", async t => {
  const f = await fixture(t); await f.configure();
  for (const rows of [[], [surface, { ...surface, surfaceId: "hwnd:101f" }]]) {
    f.observations = rows; await assert.rejects(f.service.focus("personal", implementation, { requestId: randomUUID() }), /exactly one/);
  }
  f.observations = [surface]; await writeFile(f.executablePath, "different application");
  await assert.rejects(f.service.focus("personal", implementation, { requestId: randomUUID() }), /identity changed/);
  assert.equal(f.effects, 0); assert.equal(f.sessions.length, 2);
});

test("Claude Desktop keeps its own reviewed image and request identity, never selecting Claude Code or ChatGPT", async t => {
  const f = await fixture(t), claude = "native-claude-desktop.focus/v1", path = join(f.root, "Claude.exe");
  await writeFile(path, "synthetic Claude Desktop image"); await f.configure();
  await assert.rejects(f.service.focus("personal", claude, { requestId: randomUUID() }), /Review and configure/);
  const review = await f.configure(claude, path); assert.match(review.confirmation, /^Trust Windows Claude Desktop /);
  const saved = (await f.store.snapshot("personal")).nativeWindowsClaude;
  assert.equal(saved.implementation, claude); assert.equal(saved.identity.productIdentity.productId, "anthropic.claude-desktop");
  assert.equal(saved.identity.productIdentity.role, "desktop");
  const requestId = randomUUID(), result = await f.service.focus("personal", claude, { requestId });
  assert.equal(result.provider, "claude-desktop"); assert.equal(result.windowFocusVerified, true);
  for (const key of ["accountVerified", "projectVerified", "taskResumptionVerified", "modelPromptSubmitted"]) assert.equal(result[key], false);
  assert.equal((await f.service.focus("personal", claude, { requestId })).replayed, true);
  await assert.rejects(f.service.focus("personal", implementation, { requestId }), /cannot be replayed/);
  assert.equal(f.effects, 1); assert(f.requests.filter(r => r.action).every(r => r.provider === "claude_desktop"));
  assert(f.sessions.every(s => s.terminated));
  await writeFile(path, "changed Claude Desktop image");
  await assert.rejects(f.service.focus("personal", claude, { requestId: randomUUID() }), /identity changed/);
  assert.equal(f.effects, 1);
});

test("changing a saved Claude Desktop identity invalidates an outstanding other-app review", async t => {
  const f = await fixture(t), claude = "native-claude-desktop.focus/v1";
  const review = await f.service.review("personal", { implementation, executablePath: f.executablePath });
  await f.configure(claude);
  await assert.rejects(f.service.configure("personal", { reviewId: review.reviewId, confirmation: review.confirmation }), /changed/);
  await f.store.update("work", "synthetic-work-mode", s => { s.mode = "managed-companion"; }); f.active = "work";
  await assert.rejects(f.service.review("work", { implementation: claude, executablePath: f.executablePath }), /prohibit|permit|allowed/i);
  assert.equal(f.effects, 0); assert.equal(f.sessions.length, 0);
});

test("current policy and executable bytes are checked at the native final-effect barrier and after readback", async t => {
  const f = await fixture(t);
  for (const mutation of ["before-selection", "before-mode", "before-bytes", "after-mode"]) {
    f.active = "personal"; await f.store.update("personal", "synthetic-mode", s => { s.mode = "personal-companion"; }); await f.configure();
    f.beforeReady = async () => {
      if (mutation === "before-selection") f.active = "work";
      if (mutation === "before-mode") await f.store.update("personal", "synthetic-mode", s => { s.mode = "keyboard-only"; });
      if (mutation === "before-bytes") await writeFile(f.executablePath, "late changed application");
    };
    f.afterEffect = async () => { if (mutation === "after-mode") await f.store.update("personal", "synthetic-mode", s => { s.mode = "keyboard-only"; }); };
    await assert.rejects(f.service.focus("personal", implementation, { requestId: randomUUID() }));
    assert.equal((await f.store.snapshot("personal")).nativeFocusOperations.at(-1).status, mutation === "after-mode" ? "outcome-unconfirmed" : "refused");
  }
  assert.equal(f.effects, 1);
});

test("stop cancels and joins a pending focus helper without focusing or closing the application", async t => {
  const f = await fixture(t); await f.configure(); const entered = deferred(), gate = deferred();
  f.beforeReady = async () => { entered.resolve(); await gate.promise; };
  const request = f.service.focus("personal", implementation, { requestId: randomUUID() }); void request.catch(() => {});
  await Promise.race([entered.promise, request.then(() => assert.fail("The request completed before entering its pending focus barrier."))]);
  await assert.rejects(f.service.focus("personal", implementation, { requestId: randomUUID() }), /existing native focus/);
  assert.deepEqual(await f.service.stopCompartment("personal"), { stopped: true, applicationClosed: false });
  gate.resolve(); await assert.rejects(request, /cancel/); assert.equal(f.effects, 0); assert(f.sessions.every(s => s.terminated));
});

test("uncertain helper closure retains its original port and blocks replacement until exact retirement", async t => {
  const f = await fixture(t); await f.configure(); const requestId = randomUUID(); f.exitUnknown = true;
  await assert.rejects(f.service.focus("personal", implementation, { requestId }), /exit is unconfirmed/);
  assert.equal((await f.service.stopCompartment("personal")).stopped, false);
  await assert.rejects(f.service.focus("personal", implementation, { requestId: randomUUID() }), /retirement remains unconfirmed/);
  assert.equal(f.sessions.length, 1); assert.equal(f.observedOwners.length, 0);
  f.exitUnknown = false;
  await assert.rejects(f.service.focus("personal", implementation, { requestId }), /cannot be replayed/);
  assert.equal(f.sessions.length, 1); assert.equal((await f.store.snapshot("personal")).nativeFocusOperations[0].helpers[0].stopped, true);
  assert.equal((await f.service.focus("personal", implementation, { requestId: randomUUID() })).windowFocusVerified, true);
});

test("restart recovery observes the original helper birth and preserves uncertain outcome instead of replaying it", async t => {
  const f = await fixture(t); await f.configure(); const id = randomUUID(), owner = { processId: 8888, processStartTime: "133000000000000009" };
  await f.store.update("personal", "synthetic-interruption", s => { s.nativeFocusOperations = [{ id, kind: "focus", scope: "interrupted", status: "started", helpers: [{ identity: owner, helperSha256: "c".repeat(64), stopped: false }] }]; });
  await assert.rejects(f.service.focus("personal", implementation, { requestId: randomUUID() }), /has not verified exit/);
  assert.equal(f.sessions.length, 0); assert.deepEqual(f.observedOwners, [owner]);
  f.observedExit = true;
  await assert.rejects(f.service.focus("personal", implementation, { requestId: id }), /cannot be replayed/);
  const old = (await f.store.snapshot("personal")).nativeFocusOperations[0]; assert.equal(old.status, "outcome-unconfirmed"); assert.equal(old.helpers[0].stopped, true); assert.equal(old.helpers[0].helperSha256, "c".repeat(64));
  await f.service.focus("personal", implementation, { requestId: randomUUID() }); assert.equal(f.effects, 1);
});

test("unsupported platform, Work policy and keyboard-only mode refuse before helper discovery", async t => {
  const f = await fixture(t); await f.configure();
  const linux = createWindowsNativeFocus({ ...f.options, platform: "linux" });
  await assert.rejects(linux.focus("personal", implementation, { requestId: randomUUID() }), /requires Windows/); await linux.close();
  await assert.rejects(f.service.focus("personal", implementation, { requestId: "not-a-uuid" }));
  assert.throws(() => f.service.inspect("personal", "native-cursor.focus/v1"), /unfinished/);
  f.active = "work"; await f.store.update("work", "synthetic-mode", s => { s.mode = "managed-companion"; });
  await assert.rejects(f.service.focus("work", implementation, { requestId: randomUUID() }), /prohibited/);
  f.active = "personal"; await f.store.update("personal", "synthetic-mode", s => { s.mode = "keyboard-only"; });
  await assert.rejects(f.service.focus("personal", implementation, { requestId: randomUUID() }), /Keyboard-only/);
  assert.equal(f.sessions.length, 0);
});

test("read-only recovery works in keyboard-only mode while unknown history cannot be reported as a clean shutdown", async t => {
  const f = await fixture(t), owner = { processId: 8888, processStartTime: "133000000000000009" };
  await f.store.update("personal", "synthetic-interruption", s => { s.mode = "keyboard-only"; s.nativeFocusOperations = [{ id: randomUUID(), status: "started", helpers: [{ identity: owner, helperSha256: "c".repeat(64), stopped: false }] }]; });
  const abandoned = createWindowsNativeFocus(f.options);
  await assert.rejects(abandoned.close(), /retirement remains unconfirmed/);
  await assert.rejects(f.service.recover("personal"), /has not verified exit/);
  f.observedExit = true;
  assert.deepEqual(await f.service.recover("personal"), { helpersRetired: true, originalFocusOutcomeVerified: false, applicationClosed: false, windowFocused: false });
  const record = (await f.store.snapshot("personal")).nativeFocusOperations[0]; assert.equal(record.status, "outcome-unconfirmed"); assert.equal(record.helpers[0].stopped, true);
  assert.equal(f.effects, 0); assert.equal(f.sessions.length, 0); await abandoned.close();
});

test("a request UUID cannot move to another workspace and a failing final assertion cannot authorize focus", async t => {
  const f = await fixture(t); await f.configure(); const requestId = randomUUID();
  await f.store.initialize("other");
  await f.store.update("other", "synthetic-replay", s => { s.nativeFocusOperations = [{ id: requestId, status: "completed", helpers: [] }]; });
  await assert.rejects(f.service.focus("personal", implementation, { requestId }), /another workspace/); assert.equal(f.sessions.length, 0);
  let asserted = 0;
  await assert.rejects(f.service.focus("personal", implementation, { requestId: randomUUID(), assertCurrent: async () => { if (++asserted >= 6) throw Error("synthetic final assertion revoked"); } }), /final assertion revoked/);
  assert.equal(f.effects, 0);
});

test("shutdown cancels and joins an in-flight read-only recovery without replacing the original helper", async t => {
  const f = await fixture(t), entered = deferred(), exited = deferred();
  await f.store.update("personal", "synthetic-interruption", s => { s.nativeFocusOperations = [{ id: randomUUID(), status: "started", helpers: [{ identity: { processId: 8888, processStartTime: "133000000000000009" }, helperSha256: "c".repeat(64), stopped: false }] }]; });
  f.beforeObserve = signal => new Promise((_, reject) => { signal.addEventListener("abort", () => { exited.resolve(); reject(Error("synthetic observer cancelled")); }, { once: true }); entered.resolve(); });
  const recovering = f.service.recover("personal"); void recovering.catch(() => {}); await entered.promise;
  await assert.rejects(f.service.recover("personal"), /existing native focus/);
  await assert.rejects(f.service.close(), /retirement remains unconfirmed/); await exited.promise; await assert.rejects(recovering, /cancelled/);
  assert.equal(f.sessions.length, 0); assert.equal(f.effects, 0);
  f.beforeObserve = undefined; f.observedExit = true;
  const next = createWindowsNativeFocus(f.options); await next.recover("personal"); await next.close();
});

test("bounded history retains unresolved effects while ordinary before-effect refusals do not exhaust the workspace", async t => {
  const f = await fixture(t); await f.configure();
  await f.store.update("personal", "synthetic-history", s => { s.nativeFocusOperations = Array.from({ length: 64 }, () => ({ id: randomUUID(), status: "refused", effectAuthorized: false, helpers: [] })); });
  await f.service.focus("personal", implementation, { requestId: randomUUID() });
  let records = (await f.store.snapshot("personal")).nativeFocusOperations; assert.equal(records.length, 64); assert.equal(records.at(-1).effectAuthorized, true);
  await f.store.update("personal", "synthetic-history", s => { s.nativeFocusOperations = Array.from({ length: 64 }, () => ({ id: randomUUID(), status: "outcome-unconfirmed", effectAuthorized: true, helpers: [] })); });
  await assert.rejects(f.service.focus("personal", implementation, { requestId: randomUUID() }), /unresolved native focus history/);
  records = (await f.store.snapshot("personal")).nativeFocusOperations; assert.equal(records.length, 64); assert(records.every(row => row.status === "outcome-unconfirmed")); assert.equal(f.effects, 1);
});

test("owner exit readback is closed, birth-bound and restricted to query-only observation", () => {
  const owner = { processId: 8888, processStartTime: "133000000000000009" };
  const response = { schema: "switchyard-native-focus-owner-result/v1", ...owner, state: "exited", exited: true, processAccessMask: 0x101000, tokenAccessMask: 8, processTerminated: false, windowFocused: false };
  assert.equal(validateNativeFocusOwnerExit(response, owner), true);
  assert.equal(validateNativeFocusOwnerExit({ ...response, exited: false, state: "running" }, owner), false);
  for (const change of [{ processId: 8889 }, { processStartTime: "133000000000000010" }, { state: "running" }, { exited: "true" }, { tokenAccessMask: 10 }, { processAccessMask: 0x1fffff }, { processTerminated: true }, { windowFocused: true }, { extra: false }]) assert.throws(() => validateNativeFocusOwnerExit({ ...response, ...change }, owner));
});

test("authenticated Suite routes review and configure exact Windows focus, dispatch selected scope and hide owner records", async t => {
  const f = await fixture(t);
  f.suite = createSuite({ store: f.store, platform: "win32", windowsNativeFocusFactory: options => createWindowsNativeFocus({ ...f.options, ...options }), agents: { discovery: async () => [], close() {} }, voice: { discovery: async () => ({ available: false }) } });
  f.server = createStudioServer({ token: "synthetic-native-focus-token", suite: f.suite, platform: "win32", bridge: {} });
  f.server.listen(0, "127.0.0.1"); await once(f.server, "listening");
  const origin = `http://127.0.0.1:${f.server.address().port}`;
  const discovery = await fetch(origin + "/api/discovery", { headers: { Authorization: "Bearer synthetic-native-focus-token" } });
  assert.equal(discovery.status, 200); const observed = await discovery.json();
  assert.equal(observed.platform, "win32"); assert.equal(observed.shortcuts, true); assert.equal(observed.shortcutRegistrationVerified, false);
  assert.deepEqual(observed.hostLayouts, []); assert.equal(observed.chatgpt.status, "not-observed"); assert.equal(f.sessions.length, 0);
  const api = async (route, body, headers = {}) => {
    const response = await fetch(origin + "/api/suite/" + route, { method: "POST", headers: { Origin: origin, "Content-Type": "application/json", Authorization: "Bearer synthetic-native-focus-token", ...headers }, body: JSON.stringify(body) });
    return { status: response.status, body: await response.json() };
  };
  const input = { implementation, executablePath: f.executablePath };
  assert.equal((await api("native-focus/review", input, { Authorization: "Bearer unrelated" })).status, 401);
  assert.equal((await api("native-focus/review", input, { Origin: "https://unrelated.invalid" })).status, 403);
  assert.equal(f.sessions.length, 0);
  const review = await api("native-focus/review", input); assert.equal(review.status, 200, JSON.stringify(review.body));
  const configured = await api("native-focus/configure", { reviewId: review.body.reviewId, confirmation: review.body.confirmation }); assert.equal(configured.status, 200, JSON.stringify(configured.body));
  assert.equal((await api("intent", { implementation, requestId: randomUUID(), executablePath: f.executablePath })).status, 409);
  const requestId = randomUUID(), focused = await api("intent", { implementation, requestId, compartment: "work" });
  assert.equal(focused.status, 200, JSON.stringify(focused.body)); assert.equal(focused.body.windowFocusVerified, true); assert.equal(f.effects, 1);
  const replay = await api("intent", { implementation, requestId }); assert.equal(replay.body.replayed, true); assert.equal(f.effects, 1);
  const snapshot = await api("snapshot", {}); assert.equal(Object.hasOwn(snapshot.body, "nativeFocusOperations"), false);
  assert.equal((await f.suite.authorizeConnection("personal", { implementation })).available, true);
  await assert.rejects(f.suite.authorizeConnection("personal", { implementation: "native-vscode.focus/v1" }), /Review and configure/);
  const codePath = join(f.root, "Code.exe"); await writeFile(codePath, "synthetic gateway editor");
  const editorReview = await api("native-focus/review", { implementation: "native-vscode.focus/v1", executablePath: codePath }); assert.equal(editorReview.status, 200);
  assert.equal((await api("native-focus/configure", { reviewId: editorReview.body.reviewId, confirmation: editorReview.body.confirmation })).status, 200);
  const editorFocus = await api("intent", { implementation: "native-vscode.focus/v1", requestId: randomUUID() }); assert.equal(editorFocus.status, 200); assert.equal(editorFocus.body.provider, "native-vscode"); assert.equal(editorFocus.body.projectVerified, false);
  const claude = "native-claude-desktop.focus/v1", claudePath = join(f.root, "Claude.exe"); await writeFile(claudePath, "synthetic gateway Claude Desktop");
  const claudeReview = await api("native-focus/review", { implementation: claude, executablePath: claudePath }); assert.equal(claudeReview.status, 200);
  assert.equal((await api("native-focus/configure", { reviewId: claudeReview.body.reviewId, confirmation: claudeReview.body.confirmation })).status, 200);
  const claudeFocus = await api("native-focus/focus", { compartment: "personal", implementation: claude, requestId: randomUUID() });
  assert.equal(claudeFocus.status, 200); assert.equal(claudeFocus.body.provider, "claude-desktop"); assert.equal(claudeFocus.body.taskResumptionVerified, false);
  assert.equal((await f.suite.authorizeConnection("personal", { implementation: claude })).available, true);
  assert.equal((await api("compartment/select", { compartment: "work" })).status, 200);
  assert.equal((await api("intent", { implementation, requestId: randomUUID(), compartment: "personal" })).status, 409);
  assert.equal((await api("intent", { implementation: claude, requestId: randomUUID(), compartment: "personal" })).status, 409); assert.equal(f.effects, 3);
});

test("Suite preserves selection on an uncertain original focus helper and saves keyboard-only without claiming stop", async t => {
  const f = await fixture(t);
  f.suite = createSuite({ store: f.store, platform: "win32", windowsNativeFocusFactory: options => createWindowsNativeFocus({ ...f.options, ...options }), agents: { discovery: async () => [], close() {} }, voice: { discovery: async () => ({ available: false }) } });
  const review = await f.suite.handle("/api/suite/native-focus/review", { implementation, executablePath: f.executablePath });
  await f.suite.handle("/api/suite/native-focus/configure", { reviewId: review.reviewId, confirmation: review.confirmation }); f.exitUnknown = true;
  await assert.rejects(f.suite.handle("/api/suite/intent", { implementation, requestId: randomUUID() }), /exit is unconfirmed/);
  await assert.rejects(f.suite.handle("/api/suite/compartment/select", { compartment: "work" }), /selection was preserved/); assert.equal(await f.store.selection(), "personal");
  await assert.rejects(f.suite.handle("/api/suite/mode", { mode: "keyboard-only" }), /stop is unconfirmed/); assert.equal((await f.store.snapshot("personal")).mode, "keyboard-only");
  assert.equal(f.sessions.length, 1); assert.equal(f.effects, 0);
  f.exitUnknown = false;
  const stopped = await f.suite.handle("/api/suite/mode", { mode: "keyboard-only" }); assert.equal(stopped.ownedProcessesStopped, true); assert.equal(f.sessions.length, 1);
});

test("authenticated Claude launch routes enforce closed reviews, exact selection and single durable effects", async t => {
  const f = await launchFixture(t);
  f.suite = createSuite({ store: f.store, platform: "win32", windowsNativeFocusFactory: options => createWindowsNativeFocus({ ...f.options, ...options }), agents: { discovery: async () => [], close() {} }, voice: { discovery: async () => ({ available: false }) } });
  f.server = createStudioServer({ token: "synthetic-native-launch-token", suite: f.suite, platform: "win32", bridge: {} });
  f.server.listen(0, "127.0.0.1"); await once(f.server, "listening");
  const origin = "http://127.0.0.1:" + f.server.address().port;
  const api = async (route, body, headers = {}) => {
    const response = await fetch(origin + "/api/suite/" + route, { method: "POST", headers: { Origin: origin, "Content-Type": "application/json", Authorization: "Bearer synthetic-native-launch-token", ...headers }, body: JSON.stringify(body) });
    return { status: response.status, body: await response.json() };
  };
  const input = { compartment: "personal", implementation: launchImplementation };
  assert.equal((await api("native-launch/review", input, { Authorization: "Bearer unrelated" })).status, 401);
  assert.equal((await api("native-launch/review", input, { Origin: "https://unrelated.invalid" })).status, 403);
  for (const value of [{ implementation: launchImplementation }, { ...input, args: [] }, { ...input, implementation: "native-chatgpt.launch/v1" }, { ...input, compartment: "work" }]) assert.equal((await api("native-launch/review", value)).status, 409);
  const review = await api("native-launch/review", input); assert.equal(review.status, 200, JSON.stringify(review.body)); assert.equal(f.sessions.length, 0);
  const request = { ...input, requestId: randomUUID(), reviewId: review.body.reviewId, confirmation: review.body.confirmation };
  assert.equal((await api("native-launch/apply", { ...request, args: [] })).status, 409);
  assert.equal((await api("native-launch/apply", { ...request, confirmation: "Trust Windows Claude Desktop" })).status, 409);
  const result = await api("native-launch/apply", request); assert.equal(result.status, 200, JSON.stringify(result.body)); assert.equal(result.body.applicationOpenedVerified, true); assert.equal(f.effects, 1);
  assert.equal((await api("native-launch/apply", request)).body.replayed, true); assert.equal(f.effects, 1);
  const catalog = await api("native-focus/catalog", { compartment: "personal" });
  assert.equal(catalog.body.entries.find(row => row.name === "Claude Desktop").launchImplementation, launchImplementation);
  assert(catalog.body.entries.filter(row => row.name !== "Claude Desktop").every(row => row.launchImplementation === null));
  assert.equal(catalog.body.history.at(-1).kind, "launch"); assert.equal(catalog.body.history.at(-1).helpersRetired, true);
  const snapshot = await api("snapshot", { compartment: "personal" }); assert.equal(Object.hasOwn(snapshot.body, "nativeFocusOperations"), false);
  const stale = await api("native-launch/review", input); assert.equal(stale.status, 200);
  await api("compartment/select", { compartment: "work" }); await api("compartment/select", { compartment: "personal" });
  assert.equal((await api("native-launch/apply", { ...input, requestId: randomUUID(), reviewId: stale.body.reviewId, confirmation: stale.body.confirmation })).status, 409); assert.equal(f.effects, 1);
  const final = await api("native-launch/review", input); assert.equal(final.status, 200);
  // A separate writer changing persisted selection must fence the final
  // authorization before this Suite learns its new generation.
  f.beforeReady = async () => { await f.store.selection("work"); };
  const changed = await api("native-launch/apply", { ...input, requestId: randomUUID(), reviewId: final.body.reviewId, confirmation: final.body.confirmation });
  assert.equal(changed.status, 409); assert.equal(f.effects, 1);
});
