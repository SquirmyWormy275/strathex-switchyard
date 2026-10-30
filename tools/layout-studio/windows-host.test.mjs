import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createSuiteStore } from "./suite-store.mjs";
import { createWindowsHostBridge, windowsChord } from "./windows-host.mjs";
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
  finally { bridge.close(); for (const d of drivers) d.close(); await rm(root, { recursive: true, force: true }); }
}
const review = (bridge, key) => bridge.review(plan(key), "resume", "switchyard.role/v1", target);

test("Windows exact hotkey registration survives helper restart and restores without deleting a later shortcut", () => fixture(async ({ bridge, options, drivers, dispatched }) => {
  const c = windowsChord(compileConnection(plan(), "resume", "switchyard.role/v1", target)); assert.equal(c.virtualKey, 112); assert.equal(c.windowsModifiers, 9);
  const tx = await bridge.apply((await review(bridge)).reviewId); assert.equal(tx.status, "applied");
  await assert.rejects(bridge.keep(tx.id), /Try and verify/);
  assert.equal((await bridge.trial(tx.id)).trial, "verified"); assert.equal(dispatched(), 1); await bridge.keep(tx.id);
  const later = await bridge.apply((await review(bridge, "KC_F2")).reviewId);
  bridge.close(); const restarted = createWindowsHostBridge(options);
  try { assert.equal((await restarted.transactions()).length, 2); await restarted.restore(tx.id); assert.equal(drivers.at(-1).bindings.size, 1); assert.equal((await restarted.transactions()).find((t) => t.id === later.id).status, "applied"); }
  finally { restarted.close(); }
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
  bridge.close();
  // Creating a new bridge simulates a restarted suite, with no old native registrations.
  const replacement = createWindowsHostBridge({ store, driverFactory: () => { const d = { closed: false, bindings: new Map(), ready: Promise.resolve(), async register(c) { d.bindings.set(c.nativeId, { bindingId: c.nativeId, modifiers: c.windowsModifiers, virtualKey: c.virtualKey, body: closedIntent(c) }); return { registered: true }; }, async status() { return { bindings: [...d.bindings.values()] }; }, async unregister(id) { d.bindings.delete(id); }, close() { d.closed = true; d.bindings.clear(); } }; drivers.push(d); return d; }, verifyTarget: async () => {}, dispatch: async () => {} });
  try { const next = await replacement.apply((await review(replacement, "KC_F2")).reviewId); assert.equal([...drivers.at(-1).bindings.keys()][0], 3); await replacement.restore("interrupted"); assert.equal(drivers.at(-1).bindings.size, 1); assert.equal((await replacement.transactions()).find((t) => t.id === next.id).status, "applied"); }
  finally { replacement.close(); }
}));
