import test from "node:test";
import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { spawn } from "node:child_process";
import { stopOwnedChild } from "./owned-process.mjs";
import { PassThrough, Writable } from "node:stream";
import { mkdtemp, rm, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { WindowsNativeHotkeys } from "./windows-host.mjs";
import { createWindowsCategoryObserver } from "./foreground.mjs";
import { createSuiteStore } from "./suite-store.mjs";
import { createSuite } from "./suite.mjs";
const provenance = "Windows foreground process filename; no task identity", frame = { available: true, category: "vscode", provenance };
const gate = () => { let resolve; const promise = new Promise((r) => { resolve = r; }); return { promise, resolve }; };
async function until(fn) { const end = Date.now() + 10000; while (Date.now() < end) { if (fn()) return; await new Promise((r) => setTimeout(r, 10)); } throw new Error("The bounded synthetic foreground state did not appear."); }
function native(options = {}) {
  const messages = [], child = new EventEmitter(); child.stdout = new PassThrough(); child.exitCode = null; child.signalCode = null;
  child.kill = () => { child.exitCode = 0; child.emit("close", 0); };
  child.stdin = new Writable({ write(bytes, encoding, callback) { const m = JSON.parse(bytes.toString()); messages.push(m); queueMicrotask(() => child.stdout.write(JSON.stringify({ id: m.id, result: m.method === "initialize" ? { initialized: true, readOnly: true, protocolVersion: 2, ...options.initialize } : options.frame ?? frame }) + "\n")); callback(); } });
  const driver = new WindowsNativeHotkeys({ origin: "http://127.0.0.1:43177/", token: "a".repeat(43), readOnly: true, spawnProcess: () => child });
  return { driver, child, messages };
}
test("Windows category observation verifies a read-only native contract and cannot register or remove hotkeys", async () => {
  const { driver, messages } = native(), observer = createWindowsCategoryObserver({ driverFactory: (options) => { assert.equal(options.readOnly, true); return driver; } });
  try {
    assert.deepEqual(await observer.read("personal"), frame); assert.equal(messages[0].readOnly, true);
    await assert.rejects(driver.register({}), /observation only/); await assert.rejects(driver.unregister(1), /observation only/);
    assert.deepEqual(messages.map((m) => m.method), ["initialize", "foreground-category"]);
  } finally { await observer.close(); }
  assert.equal(driver.closed, true);
});
test("old native helpers and unexpected window metadata fail closed before any observation is saved", async () => {
  const old = native({ initialize: { protocolVersion: 1, readOnly: undefined } }); await assert.rejects(old.driver.ready, /read-only observation contract/); assert.equal(old.driver.closed, true);
  for (const value of [{ ...frame, title: "never-save-a-window-title" }, { ...frame, category: "unknown-injected-category" }, { ...frame, provenance: "unverified" }]) {
    const { driver } = native({ frame: value }), observer = createWindowsCategoryObserver({ driverFactory: () => driver });
    try { await assert.rejects(observer.read("personal"), /contract was rejected/); } finally { await observer.close(); }
  }
});
test("stopping a pending category initialization prevents a later read from reviving it", async () => {
  const ready = gate(); let created = 0, requested = 0, closed = 0;
  const observer = createWindowsCategoryObserver({ driverFactory: () => { created++; return { ready: ready.promise, request: async () => { requested++; return frame; }, close() { closed++; } }; } });
  const pending = observer.read("personal"), rejection = assert.rejects(pending, /was stopped/); await until(() => created === 1);
  await observer.stopCompartment("personal"); ready.resolve(); await rejection; assert.equal(requested, 0); assert.equal(closed, 1); await observer.close();
});
async function suiteFixture(fn, { foregroundOverride } = {}) {
  const root = await mkdtemp(join(tmpdir(), "switchyard-foreground-")), keys = new Map(), timers = new Set(); let reads = 0, stops = 0, next = frame;
  const secrets = { get: async (c, p) => keys.get(`${c}:${p}`), set: async (c, p, v) => keys.set(`${c}:${p}`, v) };
  const store = createSuiteStore({ root, secrets }), peer = createSuiteStore({ root, secrets });
  const foreground = foregroundOverride ?? { implemented: true, read: async (c, authorize) => { await authorize(); reads++; return next; }, stopCompartment: async () => { stops++; return { stopped: true }; }, close: async () => {} };
  const suite = createSuite({ store, foreground, scheduleForeground: (callback, ms) => { assert.equal(ms, 2000); const timer = { callback, unref() {} }; timers.add(timer); return timer; }, clearForeground: (timer) => timers.delete(timer), agents: { discovery: async () => [], close() {} }, voice: { discovery: async () => ({ available: false }) } });
  try { await suite.handle("/api/suite/bootstrap"); await fn({ suite, store, peer, root, timers, readCount: () => reads, stopCount: () => stops, next: (value) => { next = value; }, sample: async () => { const timer = [...timers][0]; assert.ok(timer); await timer.callback(); } }); }
  finally { await suite.close(); await rm(root, { recursive: true, force: true, maxRetries: 6, retryDelay: 50 }); }
}
const start = (suite, extra = {}) => suite.handle("/api/suite/observation/start", { consent: true, sources: ["foreground-category"], exclusions: ["browser"], ...extra });
test("a peer pause retires the original sampler before another foreground read", () => suiteFixture(async ({ suite, peer, sample, timers, readCount, stopCount }) => {
  await suite.handle("/api/suite/mode", { mode: "personal-companion" }); await start(suite);
  await peer.update("personal", "synthetic-peer-pause", s => { s.observations[0].status = "paused"; });
  const before = (await peer.snapshot("personal")).observations;
  await sample();
  assert.equal(readCount(), 0); assert.equal(stopCount(), 1); assert.equal(timers.size, 0);
  assert.deepEqual((await peer.snapshot("personal")).observations, before);
}));
for (const fails of [false, true]) test(`an old foreground ${fails ? "failure" : "reply"} cannot change a peer's renewed recording`, async () => {
  const entered = gate(), release = gate(); let stops = 0;
  const foregroundOverride = { implemented: true, async read(_c, authorize) { await authorize(); entered.resolve(); await release.promise; if (fails) throw Error("SYNTHETIC_OLD_SOURCE_FAILURE"); return frame; }, async stopCompartment() { stops++; return { stopped: true }; }, async close() {} };
  try { await suiteFixture(async ({ suite, peer, sample, timers }) => {
    await suite.handle("/api/suite/mode", { mode: "personal-companion" }); await start(suite);
    const pending = sample(); await entered.promise;
    await peer.update("personal", "synthetic-peer-resume", s => { s.observations[0].recordingGeneration = "synthetic-renewed-consent"; });
    const before = (await peer.snapshot("personal")).observations;
    release.resolve(); await pending;
    assert.deepEqual((await peer.snapshot("personal")).observations, before);
    assert.equal(timers.size, 0); assert.equal(stops, 1);
  }, { foregroundOverride }); } finally { release.resolve(); }
});
test("foreground recording needs consent and an allowed companion policy; exclusions, pause and mode-off fence samples", () => suiteFixture(async ({ suite, store, timers, sample, next, readCount, stopCount, root }) => {
  await assert.rejects(start(suite), /Keyboard-only/); assert.equal(readCount(), 0);
  await suite.handle("/api/suite/mode", { mode: "personal-companion" }); await assert.rejects(start(suite, { consent: false }), /explicitly start/);
  const o = await start(suite); next({ ...frame, category: "browser" }); await sample(); next(frame); await sample();
  let saved = (await store.snapshot("personal")).observations[0]; assert.equal(saved.focusCategories.browser, undefined); assert.equal(typeof saved.focusCategories.vscode, "number"); assert.equal(saved.sourceStates["foreground-category"].provenance, provenance);
  const callback = [...timers][0].callback; await suite.handle("/api/suite/observation/state", { id: o.id, status: "paused" }); const before = readCount(); await callback(); assert.equal(readCount(), before); assert.equal(stopCount(), 1);
  await suite.handle("/api/suite/observation/state", { id: o.id, status: "recording" }); assert.equal(timers.size, 1); await suite.handle("/api/suite/mode", { mode: "keyboard-only" }); assert.equal(timers.size, 0);
  saved = (await store.snapshot("personal")).observations[0]; assert.equal(saved.status, "paused"); assert.equal((await readFile(join(root, "personal.sealed.json"), "utf8")).includes(provenance), false);
  await suite.handle("/api/suite/compartment/create", { compartment: "work", policy: "work" }); await suite.handle("/api/suite/mode", { compartment: "work", mode: "managed-companion" }); await assert.rejects(start(suite, { compartment: "work" }), /prohibited/);
}));
test("an unavailable native session pauses its source after bounded retries and resumes only deliberately", () => suiteFixture(async ({ suite, store, next, sample, timers, stopCount }) => {
  await suite.handle("/api/suite/mode", { mode: "personal-companion" }); const o = await start(suite); next({ available: false, category: null, provenance });
  await sample(); await sample(); assert.equal(timers.size, 1); await sample(); assert.equal(timers.size, 0); assert.equal(stopCount(), 1);
  const saved = (await store.snapshot("personal")).observations[0]; assert.equal(saved.status, "paused"); assert.equal(saved.sourceStates["foreground-category"].status, "unavailable"); assert.deepEqual(saved.focusCategories, {});
  next(frame); await suite.handle("/api/suite/observation/state", { id: o.id, status: "recording" }); await sample(); assert.equal((await store.snapshot("personal")).observations[0].sourceStates["foreground-category"].status, "sampling");
}));

function ownedDriver({ ready = Promise.resolve(), request = async () => frame } = {}) {
  const child = new EventEmitter(); child.exitCode = null; child.signalCode = null;
  child.kill = () => false;
  let closes = 0;
  return { child, ready, request, closed: false, close() { this.closed = true; closes++; }, closes: () => closes,
    exit() { child.exitCode = 0; child.emit("close", 0, null); } };
}

test("uncertain category-helper exit retains ownership and blocks replacement until exact close", async () => {
  const drivers = [], observer = createWindowsCategoryObserver({ driverFactory: () => { const d = ownedDriver(); drivers.push(d); return d; }, stopChild: async () => ({ stopped: false }) });
  try {
    await observer.read("personal");
    assert.equal((await observer.stopCompartment("personal")).stopped, false);
    await assert.rejects(observer.read("personal"), { code: "FOREGROUND_HELPER_EXIT_UNCONFIRMED" });
    assert.equal(drivers.length, 1); assert.equal(drivers[0].closes(), 1);
    drivers[0].exit(); assert.deepEqual(await observer.read("personal"), frame);
    assert.equal(drivers.length, 2, "Only an exact observed exit permits a replacement.");
    await assert.rejects(observer.close(), { code: "FOREGROUND_HELPER_EXIT_UNCONFIRMED" });
    drivers[1].exit(); await observer.close();
    await assert.rejects(observer.read("personal"), /was stopped/);
    assert.equal(drivers.length, 2);
  } finally { for (const d of drivers) d.exit(); await observer.close(); }
});

test("overlapping category stops and a new read join one pending exact-child retirement", async () => {
  const stopped = gate(), d = ownedDriver(); let stops = 0, created = 0;
  const observer = createWindowsCategoryObserver({ driverFactory: () => { created++; return d; }, stopChild: async () => { stops++; return stopped.promise; } });
  try {
    await observer.read("personal");
    const first = observer.stopCompartment("personal"), second = observer.stopCompartment("personal");
    const reading = observer.read("personal"), refused = assert.rejects(reading, { code: "FOREGROUND_HELPER_EXIT_UNCONFIRMED" });
    await until(() => stops === 1); await new Promise(resolve => setImmediate(resolve));
    assert.equal(stops, 1); assert.equal(created, 1); assert.equal(d.closes(), 1);
    stopped.resolve({ stopped: false });
    assert.equal((await first).stopped, false); assert.equal((await second).stopped, false); await refused;
  } finally { stopped.resolve({ stopped: false }); d.exit(); await observer.close(); }
});

test("a failed or closed category helper cannot be replaced while native exit is uncertain", async () => {
  for (const phase of ["initialization", "contract", "closed-driver"]) {
    const d = ownedDriver({ request: async () => phase === "contract" ? { ...frame, title: "PRIVATE_WINDOW_TITLE" } : frame });
    if (phase === "initialization") d.ready = Promise.reject(Error("PRIVATE_NATIVE_DETAIL"));
    let created = 0;
    const observer = createWindowsCategoryObserver({ driverFactory: () => { created++; return d; }, stopChild: async () => { throw Error("PRIVATE_STOP_DETAIL"); } });
    try {
      if (phase === "closed-driver") { await observer.read("personal"); d.close(); }
      for (let i = 0; i < 2; i++) await assert.rejects(observer.read("personal"), error => error.code === "FOREGROUND_HELPER_EXIT_UNCONFIRMED" && !/PRIVATE/.test(error.message));
      assert.equal(created, 1);
    } finally { d.exit(); await observer.close(); }
  }
});

test("a late foreground reply after stop cannot be recorded and an exact close wins an uncertain stop result", async () => {
  const reply = gate(), stopping = gate(), d = ownedDriver({ request: () => reply.promise }); let requested = false;
  const request = d.request; d.request = () => { requested = true; return request(); };
  const observer = createWindowsCategoryObserver({ driverFactory: () => d, stopChild: () => stopping.promise });
  try {
    const reading = observer.read("personal"), refused = assert.rejects(reading, /was stopped/);
    await until(() => requested); const stopped = observer.stopCompartment("personal");
    d.exit(); reply.resolve(frame); stopping.resolve({ stopped: false });
    assert.equal((await stopped).stopped, true); await refused;
  } finally { d.exit(); reply.resolve(frame); stopping.resolve({ stopped: false }); await observer.close(); }
});

test("Suite shutdown reports an unconfirmed foreground helper instead of accepting successful closure", async () => {
  const d = ownedDriver(), observer = createWindowsCategoryObserver({ driverFactory: () => d, stopChild: async () => ({ stopped: false }) });
  await observer.read("personal");
  await suiteFixture(async ({ suite }) => {
    try { await assert.rejects(suite.close(), { code: "FOREGROUND_HELPER_EXIT_UNCONFIRMED" }); }
    finally { d.exit(); }
  }, { foregroundOverride: observer });
});

test("controlled real category-helper children exit before a replacement and final shutdown", async () => {
  const children = [], observer = createWindowsCategoryObserver({ driverFactory: () => {
    const child = spawn(process.execPath, ["-e", "process.stdin.resume()"], { stdio: ["pipe", "ignore", "ignore"], windowsHide: true }); children.push(child);
    return { child, ready: new Promise((resolve, reject) => { child.once("spawn", resolve); child.once("error", reject); }), request: async () => frame, closed: false, close() { this.closed = true; } };
  } });
  try {
    assert.deepEqual(await observer.read("personal"), frame);
    assert.equal((await observer.stopCompartment("personal")).stopped, true);
    assert.ok(children[0].exitCode !== null || children[0].signalCode !== null);
    assert.deepEqual(await observer.read("personal"), frame); assert.equal(children.length, 2);
    await observer.close(); assert.ok(children[1].exitCode !== null || children[1].signalCode !== null);
  } finally { for (const child of children) assert.equal((await stopOwnedChild(child)).stopped, true); await observer.close(); }
});
