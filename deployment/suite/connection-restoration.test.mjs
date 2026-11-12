import assert from "node:assert/strict";
import test from "node:test";
import { randomUUID } from "node:crypto";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createSuiteStore } from "../../tools/layout-studio/suite-store.mjs";
import { connectionRestoration } from "./connection-restoration.mjs";
async function fixture(fn) {
  const root = await mkdtemp(join(tmpdir(), "switchyard-disconnect-")), keys = new Map();
  const store = createSuiteStore({ root, secrets: { get: async (id, purpose) => keys.get(`${id}:${purpose}`), set: async (id, purpose, value) => keys.set(`${id}:${purpose}`, value) } });
  const connection = { implementation: "native-chatgpt.focus/v1", nativeId: 1, windowsModifiers: 10, virtualKey: 65, actionId: "summon", label: "Synthetic native focus", key: "A", modmask: 68, shortcut: "SUPER + CTRL + A" };
  const tx = { id: randomUUID(), connection, status: "kept", baseline: [], createdAt: 1 };
  try { await store.initialize("personal", "personal"); await store.initialize("work", "work"); await store.update("personal", "synthetic-windows-binding", state => { state.windowsHost = { bindings: [connection], transactions: [tx] }; }); await fn({ store, keys, tx, connection }); }
  finally { await rm(root, { recursive: true, force: true }); }
}
test("Windows removal clears exact owned re-registration preferences while preserving protected baselines, policy and unrelated state", () => fixture(async ({ store, tx }) => {
  const before = await store.snapshot("personal"), work = await store.snapshot("work"); let committed = false;
  const result = await connectionRestoration({ platform: "win32", store })(async result => { const current = await store.snapshot("personal"); assert.deepEqual(current.windowsHost.bindings, []); assert.equal(current.windowsHost.transactions[0].status, "restored"); assert.deepEqual(current.windowsHost.transactions[0].baseline, tx.baseline); committed = true; return result; });
  assert.equal(committed, true); assert.equal(result.restored.length, 1); const after = await store.snapshot("personal"); assert.deepEqual(after.workflow, before.workflow); assert.equal(after.mode, before.mode); assert.deepEqual((await store.snapshot("work")).windowsHost, work.windowsHost);
}));
test("missing protected keys in another compartment block all preference changes and program removal", () => fixture(async ({ store, keys }) => {
  const before = (await store.snapshot("personal")).windowsHost; keys.delete("work:storage-key"); let committed = false;
  await assert.rejects(connectionRestoration({ platform: "win32", store })(() => { committed = true; }), /key|protected/i); assert.equal(committed, false); assert.deepEqual((await store.snapshot("personal")).windowsHost, before);
}));
test("unowned saved bindings fail complete preflight without clearing valid preferences in another compartment", () => fixture(async ({ store, connection }) => {
  await store.update("work", "synthetic-unknown-binding", state => { state.windowsHost = { bindings: [{ ...connection, nativeId: 7 }], transactions: [] }; });
  const before = (await store.snapshot("personal")).windowsHost; let committed = false;
  await assert.rejects(connectionRestoration({ platform: "win32", store })(() => { committed = true; }), /no exact owned transaction/); assert.equal(committed, false); assert.deepEqual((await store.snapshot("personal")).windowsHost, before);
}));
test("Linux connection restoration holds its bridge boundary through the removal continuation", async () => {
  const events = [];
  const restore = connectionRestoration({ platform: "linux", linuxBridge: { restoreAll: async continuation => { events.push("host-lease-held"); const result = await continuation({ restored: [{ id: "synthetic" }], readbackVerified: true }); events.push("host-lease-released"); return result; } } });
  assert.equal(await restore(async report => { events.push("remove-program"); assert.equal(report.restored.length, 1); return "removed"; }), "removed"); assert.deepEqual(events, ["host-lease-held", "remove-program", "host-lease-released"]);
});
