import test from "node:test";
import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
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
async function suiteFixture(fn) {
  const root = await mkdtemp(join(tmpdir(), "switchyard-foreground-")), keys = new Map(), timers = new Set(); let reads = 0, stops = 0, next = frame;
  const store = createSuiteStore({ root, secrets: { get: async (c, p) => keys.get(`${c}:${p}`), set: async (c, p, v) => keys.set(`${c}:${p}`, v) } });
  const foreground = { implemented: true, read: async (c, authorize) => { await authorize(); reads++; return next; }, stopCompartment: async () => { stops++; return { stopped: true }; }, close: async () => {} };
  const suite = createSuite({ store, foreground, scheduleForeground: (callback, ms) => { assert.equal(ms, 2000); const timer = { callback, unref() {} }; timers.add(timer); return timer; }, clearForeground: (timer) => timers.delete(timer), agents: { discovery: async () => [], close() {} }, voice: { discovery: async () => ({ available: false }) } });
  try { await suite.handle("/api/suite/bootstrap"); await fn({ suite, store, root, timers, readCount: () => reads, stopCount: () => stops, next: (value) => { next = value; }, sample: async () => { const timer = [...timers][0]; assert.ok(timer); await timer.callback(); } }); }
  finally { await suite.close(); await rm(root, { recursive: true, force: true, maxRetries: 6, retryDelay: 50 }); }
}
const start = (suite, extra = {}) => suite.handle("/api/suite/observation/start", { consent: true, sources: ["foreground-category"], exclusions: ["browser"], ...extra });
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
