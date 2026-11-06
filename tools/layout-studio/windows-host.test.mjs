import test from "node:test";
import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { spawn } from "node:child_process";
import { PassThrough } from "node:stream";
import { stopOwnedChild } from "./owned-process.mjs";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createSuiteStore } from "./suite-store.mjs";
import { createWindowsHostBridge, windowsChord, WindowsNativeHotkeys } from "./windows-host.mjs";
import { compileConnection } from "./workspace.mjs";
import { closedIntent } from "./physical-intent.mjs";
function plan(key = "KC_F1") { return { schema: "sxsy-agentic-layout-plan/v1", profile: { schema: "sxsy-board-profile/v1", name: "Synthetic", layout: "one", keys: [{ id: "one", label: "F", matrix: [0, 0], x: 0, y: 0, baseKeycode: key }] }, actions: [{ id: "resume", label: "Return", family: "lifecycle", consequence: "navigation", confirmation: false, frequencyPerDay: 0, secondsSaved: 0, binding: { keyId: "one", modifier: "gui_alt" } }], study: null }; }
const target = { roleId: "builder", intent: "resume" };
async function fixture(fn) {
  const root = await mkdtemp(join(tmpdir(), "switchyard-windows-native-")), keys = new Map(), drivers = [], reserved = new Set(); let corruptNext = false, dispatched = 0;
  const store = createSuiteStore({ root, secrets: { get: async (id, purpose) => keys.get(`${id}:${purpose}`), set: async (id, purpose, value) => { keys.set(`${id}:${purpose}`, value); } } }); await store.initialize("personal");
  const driverFactory = () => {
    const bindings = new Map();
    const driver = { closed: false, ready: Promise.resolve(), bindings,
      async register(c) { if (driver.closed || reserved.has(c.virtualKey) || [...bindings.values()].some((b) => b.modifiers === c.windowsModifiers && b.virtualKey === c.virtualKey)) throw new Error("Synthetic occupied registration"); bindings.set(c.nativeId, { bindingId: c.nativeId, modifiers: c.windowsModifiers, virtualKey: c.virtualKey, body: corruptNext ? { implementation: "switchyard.role/v1", roleId: "wrong-role", intent: "resume" } : closedIntent(c) }); corruptNext = false; return { registered: true }; },
      async unregister(id) { if (!bindings.delete(id)) throw new Error("Not registered"); return { removed: true }; },
      async status() { return { bindings: [...bindings.values()] }; }, close() { driver.closed = true; bindings.clear(); }
    }; drivers.push(driver); return driver;
  };
  const options = { store, driverFactory, verifyTarget: async (c) => { assert.equal(c.roleId, "builder"); }, dispatch: async () => { dispatched++; return { status: "queued" }; } };
  const bridge = createWindowsHostBridge(options);
  try { await fn({ store, bridge, options, drivers, reserved, corrupt: () => { corruptNext = true; }, dispatched: () => dispatched }); }
  finally { await bridge.close(); for (const d of drivers) d.close(); await rm(root, { recursive: true, force: true }); }
}
const review = (bridge, key) => bridge.review(plan(key), "resume", "switchyard.role/v1", target);

test("Windows exact hotkey registration survives helper restart and restores without deleting a later shortcut", () => fixture(async ({ bridge, options, drivers, dispatched }) => {
  const c = windowsChord(compileConnection(plan(), "resume", "switchyard.role/v1", target)); assert.equal(c.virtualKey, 112); assert.equal(c.windowsModifiers, 9);
  const tx = await bridge.apply((await review(bridge)).reviewId); assert.equal(tx.status, "applied");
  await assert.rejects(bridge.keep(tx.id), /Try and verify/);
  assert.equal((await bridge.trial(tx.id)).trial, "verified"); assert.equal(dispatched(), 1); await bridge.keep(tx.id);
  const later = await bridge.apply((await review(bridge, "KC_F2")).reviewId);
  await bridge.close(); const restarted = createWindowsHostBridge(options);
  try { assert.equal((await restarted.transactions()).length, 2); await restarted.restore(tx.id); assert.equal(drivers.at(-1).bindings.size, 1); assert.equal((await restarted.transactions()).find((t) => t.id === later.id).status, "applied"); }
  finally { await restarted.close(); }
}));

test("Windows occupied chord, replay and wrong-target readback preserve existing registrations", () => fixture(async ({ bridge, drivers, reserved, corrupt, store }) => {
  reserved.add(112); const r = await review(bridge); await assert.rejects(bridge.apply(r.reviewId), /occupied/); await assert.rejects(bridge.apply(r.reviewId), /already used/);
  assert.equal(drivers.at(-1).bindings.size, 0); reserved.delete(112);
  corrupt(); await assert.rejects(bridge.apply((await review(bridge)).reviewId), /readback/);
  assert.equal(drivers.at(-1).bindings.size, 0);
  assert.ok((await store.snapshot("personal")).windowsHost.transactions.every((t) => t.status === "rolled-back"));
}));

test("Windows pending recovery does not reuse its native ID or unregister a new owned shortcut", () => fixture(async ({ bridge, store, drivers }) => {
  const old = await bridge.apply((await review(bridge)).reviewId); await bridge.restore(old.id);
  await store.update("personal", "synthetic-interruption", (s) => { const t = structuredClone(s.windowsHost.transactions[0]); t.id = "interrupted"; t.status = "applying"; t.connection.nativeId = 2; s.windowsHost.transactions.push(t); });
  await bridge.close();
  // Creating a new bridge simulates a restarted suite, with no old native registrations.
  const replacement = createWindowsHostBridge({ store, driverFactory: () => { const d = { closed: false, bindings: new Map(), ready: Promise.resolve(), async register(c) { d.bindings.set(c.nativeId, { bindingId: c.nativeId, modifiers: c.windowsModifiers, virtualKey: c.virtualKey, body: closedIntent(c) }); return { registered: true }; }, async status() { return { bindings: [...d.bindings.values()] }; }, async unregister(id) { d.bindings.delete(id); }, close() { d.closed = true; d.bindings.clear(); } }; drivers.push(d); return d; }, verifyTarget: async () => {}, dispatch: async () => {} });
  try { const next = await replacement.apply((await review(replacement, "KC_F2")).reviewId); assert.equal([...drivers.at(-1).bindings.keys()][0], 3); await replacement.restore("interrupted"); assert.equal(drivers.at(-1).bindings.size, 1); assert.equal((await replacement.transactions()).find((t) => t.id === next.id).status, "applied"); }
  finally { await replacement.close(); }
}));

function retainChild(driver) {
  const child = new EventEmitter(); child.exitCode = null; child.signalCode = null; child.kill = () => false;
  driver.child = child; driver.exit = () => { child.exitCode = 0; child.emit("close", 0, null); };
  return driver;
}

test("closed shortcut helpers retain uncertain exact ownership and shutdown cannot silently replace them", () => fixture(async ({ options, drivers, store }) => {
  const bridge = createWindowsHostBridge({ ...options, driverFactory: () => retainChild(options.driverFactory()), stopChild: async () => ({ stopped: false }) });
  try {
    await review(bridge); const d = drivers[0]; d.close();
    await assert.rejects(review(bridge), { code: "HOTKEY_HELPER_EXIT_UNCONFIRMED" }); assert.equal(drivers.length, 1);
    await assert.rejects(bridge.close(), { code: "HOTKEY_HELPER_EXIT_UNCONFIRMED" });
    assert.equal((await store.snapshot("personal")).windowsHost, undefined);
    d.exit(); await bridge.close();
    await assert.rejects(review(bridge), /closed|stopped/i); assert.equal(drivers.length, 1);
  } finally { for (const d of drivers) d.exit?.(); await bridge.close(); }
}));

test("concurrent shortcut hydration joins one initialization and preserves saved bindings after uncertain failure", () => fixture(async ({ bridge: original, options, drivers, store }) => {
  await original.apply((await review(original)).reviewId); await original.close();
  const before = (await store.snapshot("personal")).windowsHost;
  let stopResolve, reached, registrations = 0, stops = 0;
  const stopGate = new Promise(resolve => { stopResolve = resolve; }), entered = new Promise(resolve => { reached = resolve; });
  const bridge = createWindowsHostBridge({ ...options, driverFactory: () => {
    const d = retainChild(options.driverFactory()); d.register = async () => { registrations++; throw Error("PRIVATE_HYDRATION_FAILURE"); }; return d;
  }, stopChild: async () => { stops++; reached(); return stopGate; } });
  try {
    const first = assert.rejects(bridge.transactions(), error => error.code === "HOTKEY_HELPER_EXIT_UNCONFIRMED" && !/PRIVATE/.test(error.message));
    const second = assert.rejects(bridge.transactions(), { code: "HOTKEY_HELPER_EXIT_UNCONFIRMED" });
    await entered; assert.equal(stops, 1); assert.equal(registrations, 1);
    stopResolve({ stopped: false }); await Promise.all([first, second]);
    assert.equal(drivers.length, 2); assert.deepEqual((await store.snapshot("personal")).windowsHost, before);
  } finally { stopResolve({ stopped: false }); for (const d of drivers) d.exit?.(); await bridge.close(); }
}));

test("uncertain registration is retained for deliberate recovery and is never automatically rehydrated", () => fixture(async ({ options, drivers, store }) => {
  let fail = true;
  const bridge = createWindowsHostBridge({ ...options, driverFactory: () => {
    const d = retainChild(options.driverFactory()), register = d.register;
    d.register = async connection => { const result = await register(connection); if (fail) throw Error("Synthetic lost registration acknowledgement"); return result; }; return d;
  }, stopChild: async () => ({ stopped: false }) });
  try {
    await assert.rejects(bridge.apply((await review(bridge)).reviewId), /recovery|unconfirmed/i);
    const state = (await store.snapshot("personal")).windowsHost, tx = state.transactions[0];
    assert.equal(tx.status, "recovery-pending"); assert.equal(state.bindings.length, 1);
    await assert.rejects(bridge.transactions(), { code: "HOTKEY_HELPER_EXIT_UNCONFIRMED" }); assert.equal(drivers.length, 1);
    drivers[0].exit(); fail = false;
    assert.equal((await bridge.transactions())[0].status, "recovery-pending");
    assert.equal(drivers.length, 2); assert.equal(drivers[1].bindings.size, 0, "Uncertain registrations must not be replayed on a new helper.");
    await bridge.restore(tx.id); assert.equal((await store.snapshot("personal")).windowsHost.bindings.length, 0);
    const next = await bridge.apply((await review(bridge, "KC_F2")).reviewId);
    assert.equal(next.status, "applied"); assert.equal(drivers[1].bindings.has(tx.connection.nativeId), false);
  } finally { for (const d of drivers) d.exit?.(); await bridge.close(); }
}));

test("a late registration reply cannot use a replacement helper for readback or rollback", () => fixture(async ({ options, drivers, store }) => {
  let release, entered; const reply = new Promise(resolve => { release = resolve; }), started = new Promise(resolve => { entered = resolve; });
  const bridge = createWindowsHostBridge({ ...options, driverFactory: () => {
    const d = retainChild(options.driverFactory()), register = d.register;
    if (drivers.length === 1) d.register = async c => { const result = await register(c); entered(); await reply; return result; };
    return d;
  } });
  try {
    const pending = bridge.apply((await review(bridge)).reviewId), rejected = assert.rejects(pending, /closed/); await started;
    drivers[0].close(); drivers[0].exit();
    await bridge.transactions(); const later = await bridge.apply((await review(bridge, "KC_F2")).reviewId);
    assert.equal(drivers.length, 2); const before = [...drivers[1].bindings];
    release(); await rejected;
    assert.deepEqual([...drivers[1].bindings], before);
    const transactions = (await store.snapshot("personal")).windowsHost.transactions;
    assert.equal(transactions[0].status, "rolled-back"); assert.equal(transactions.find(t => t.id === later.id).status, "applied");
  } finally { release(); for (const d of drivers) d.exit?.(); await bridge.close(); }
}));

test("shortcut helper replacement and bridge shutdown independently verify controlled real child exits", () => fixture(async ({ options, drivers }) => {
  const children = [], bridge = createWindowsHostBridge({ ...options, driverFactory: () => {
    const d = options.driverFactory(), child = spawn(process.execPath, ["-e", "process.stdin.resume()"], { stdio: ["pipe", "ignore", "ignore"], windowsHide: true });
    children.push(child); d.child = child; d.ready = new Promise((resolve, reject) => { child.once("spawn", resolve); child.once("error", reject); }); return d;
  } });
  try {
    await review(bridge); drivers[0].close(); await review(bridge);
    assert.equal(children.length, 2); assert.ok(children[0].exitCode !== null || children[0].signalCode !== null);
    assert.equal((await bridge.close()).stopped, true); assert.ok(children[1].exitCode !== null || children[1].signalCode !== null);
  } finally { for (const child of children) assert.equal((await stopOwnedChild(child)).stopped, true); await bridge.close(); }
}));

test("a native kill exception still rejects pending initialization and clears request timers", async () => {
  const child = new EventEmitter(); child.stdout = new PassThrough(); child.stdin = new PassThrough(); child.kill = () => { throw Error("PRIVATE_KILL_FAILURE"); };
  const driver = new WindowsNativeHotkeys({ origin: "http://127.0.0.1:43177/", token: "a".repeat(43), spawnProcess: () => child });
  const rejected = assert.rejects(driver.ready, /disconnected/);
  assert.doesNotThrow(() => driver.close()); await rejected;
  assert.equal(driver.closed, true); assert.equal(driver.pending.size, 0);
  child.stdin.destroy(); child.stdout.destroy();
});
