import assert from "node:assert/strict";
import test from "node:test";
import { createDeviceService, VialDevice, validateDeviceChanges } from "./devices.mjs";
import { compileMacro, editMacroBuffer } from "./vial-macros.mjs";
import { editLayoutOptions } from "./device-proposal.mjs";
import { compileDeviceKey } from "./vial-keycodes.mjs";

function fixture() {
  const deviceId = "a".repeat(64), definition = { name: "Synthetic configuration device", matrix: { rows: 1, cols: 2 }, layouts: { keymap: [["0,0", "0,1"]], labels: [["Enter", "ANSI", "ISO", "Big"], "Split"] } };
  const raw = [[[4, 5]], [[1, 1]]], state = { deviceTransactions: [], deviceSnapshots: [] };
  const macro = Buffer.alloc(96); Buffer.from([88, 0, 1, 5, 19, 2, 0, 0]).copy(macro);
  const macroWrites = [], withDeviceLock = async (_, fn) => fn({ assert() {} });
  let layoutOptions = 0x80000000, locked = false, disconnected = false, wrong = false, partialFailure = false, writes = 0, baselineFailure = false, protocolVersion = 4, macroFailure = false, unplugMacro = false, corruptMacroRead = false;
  const store = { snapshot: async () => structuredClone(state), update: async (_, op, fn) => { if (baselineFailure && op === "device-baseline") throw new Error("Synthetic backup failure"); const draft = structuredClone(state); const result = await fn(draft); Object.assign(state, draft); return result; } };
  const transportFactory = () => ({
    close() {},
    async request(method) {
      if (method === "list") return disconnected ? [] : [{ id: deviceId, candidateProtocol: "vial", name: "Synthetic" }];
      if (method === "open") { if (disconnected) throw new Error("Synthetic disconnected device"); return { candidateProtocol: "vial" }; }
      if (method === "decode-definition") return definition;
      throw new Error("Unexpected private transport method");
    },
    async exchange(bytes) {
      if (disconnected) throw new Error("Synthetic device disconnected");
      const r = Buffer.from(bytes);
      if (r[0] === 1) { r.writeUInt16BE(9, 1); return r; }
      if (r[0] === 0xFE) {
        if (r[1] === 0) { r.fill(0); r.writeUInt32LE(protocolVersion); r.fill(wrong ? 2 : 1, 4, 12); }
        else if (r[1] === 1) { r.fill(0); r.writeUInt32LE(1); }
        else if (r[1] === 2) { r.fill(0); r[0] = 42; }
        else if (r[1] === 5) { r.fill(255); r[0] = locked ? 0 : 1; r[1] = 0; }
        return r;
      }
      if (r[0] === 0x11) { r[1] = 2; return r; }
      if (r[0] === 0x12) { const all = Buffer.alloc(8); raw.flat(2).forEach((v, i) => all.writeUInt16BE(v, i * 2)); all.copy(r, 4, (r[1] << 8) | r[2], ((r[1] << 8) | r[2]) + r[3]); return r; }
      if (r[0] === 0x0C) { r[1] = 3; return r; }
      if (r[0] === 0x0D) { r.writeUInt16BE(macro.length, 1); return r; }
      if (r[0] === 0x0E) { const offset = r.readUInt16BE(1); macro.copy(r, 4, offset, offset + r[3]); if (corruptMacroRead && macroWrites.length >= 5) { r[4] ^= 1; corruptMacroRead = false; } return r; }
      if (r[0] === 0x0F) {
        writes++; const offset = r.readUInt16BE(1); macroWrites.push({ offset, bytes: [...r.subarray(4, 4 + r[3])], sentinelBefore: macro.at(-1) });
        if (macroFailure && macroWrites.length === 3) { if (unplugMacro) disconnected = true; throw new Error("Synthetic interrupted macro write"); }
        r.copy(macro, offset, 4, 4 + r[3]); return r;
      }
      if (r[0] === 2) { r.writeUInt32BE(layoutOptions, 2); return r; }
      if (r[0] === 3) { writes++; layoutOptions = r.readUInt32BE(2); return r; }
      if (r[0] === 5) { writes++; if (partialFailure && writes === 2) throw new Error("Synthetic partial write"); raw[r[1]][r[2]][r[3]] = r.readUInt16BE(4); return r; }
      if (r[0] === 4) { r.writeUInt16BE(raw[r[1]][r[2]][r[3]], 4); return r; }
      throw new Error("Unexpected protocol command");
    }
  });
  return { deviceId, raw, macro, macroWrites, state, store, transportFactory, withDeviceLock, service: createDeviceService({ store, transportFactory, withDeviceLock }), layout: () => layoutOptions, setLayout: (v) => { layoutOptions = v; }, reconnect: () => { disconnected = false; macroFailure = false; }, corruptMacroRead: () => { corruptMacroRead = true; }, interruptMacro: (unplug = false) => { macroFailure = true; unplugMacro = unplug; }, lock: () => { locked = true; }, disconnect: () => { disconnected = true; }, wrongDevice: () => { wrong = true; }, partialFailure: () => { partialFailure = true; }, baselineFailure: () => { baselineFailure = true; }, unsupported: () => { protocolVersion = 99; }, writes: () => writes };
}
const change = (col = 0, after = 104) => ({ layer: 1, row: 0, col, before: 1, after });

test("Vial snapshot reads exact protocol/matrix/base layer and does not identify controller hardware by product name", async () => {
  const f = fixture(), s = await f.service.read("personal", f.deviceId);
  assert.deepEqual(s.keymap_raw, [[[4, 5]], [[1, 1]]]);
  assert.equal(s.identity.controller, "unverified");
  assert.equal(s.configurationOnly, true);
  assert.equal(f.writes(), 0);
  f.unsupported(); await assert.rejects(f.service.read("personal", f.deviceId), /version is unsupported/);
});

test("device apply saves a baseline, verifies writes, rejects replay, and restores through a new service", async () => {
  const f = fixture(), review = await f.service.review("personal", f.deviceId, [change()]);
  const tx = await f.service.apply("personal", review.reviewId);
  assert.equal(tx.status, "applied"); assert.equal(f.raw[1][0][0], 104);
  assert.equal(f.state.deviceTransactions[0].baseline.keymap_raw[1][0][0], 1);
  await assert.rejects(f.service.apply("personal", review.reviewId), /already used/);
  const restarted = createDeviceService({ store: f.store, transportFactory: f.transportFactory, withDeviceLock: f.withDeviceLock });
  assert.equal((await restarted.restore("personal", tx.id)).status, "restored");
  assert.equal(f.raw[1][0][0], 1);
});

test("locked, wrong-device and backup-failure paths make no writes", async () => {
  for (const mode of ["lock", "wrongDevice", "baselineFailure"]) {
    const f = fixture(), review = await f.service.review("personal", f.deviceId, [change()]); f[mode]();
    await assert.rejects(f.service.apply("personal", review.reviewId)); assert.equal(f.writes(), 0);
  }
});

test("partial write restores changed slots, and disconnected restore remains explicitly pending", async () => {
  const f = fixture(), review = await f.service.review("personal", f.deviceId, [change(), change(1, 105)]); f.partialFailure();
  await assert.rejects(f.service.apply("personal", review.reviewId), /partial write/);
  assert.deepEqual(f.raw[1][0], [1, 1]); assert.equal(f.state.deviceTransactions[0].status, "restored");
  const next = fixture(), tx = await next.service.apply("personal", (await next.service.review("personal", next.deviceId, [change()])).reviewId);
  next.disconnect(); await assert.rejects(next.service.restore("personal", tx.id), /disconnected/);
  assert.equal(next.state.deviceTransactions[0].status, "recovery-pending");
});

test("device review protects complete ordinary typing and rejects firmware controls, wrong matrices and duplicate slots", async () => {
  const f = fixture(), s = await f.service.read("personal", f.deviceId);
  assert.throws(() => validateDeviceChanges(s, [{ layer: 0, row: 0, col: 0, before: 4, after: 104 }]), /fallback/);
  assert.throws(() => validateDeviceChanges(s, [change(), change()]), /twice/);
  assert.throws(() => validateDeviceChanges(s, [{ ...change(), row: 8 }]), /matrix/);
  assert.throws(() => validateDeviceChanges(s, [change(0, 0x7C00)]), /Firmware control codes/);
  assert.throws(() => validateDeviceChanges(s, [{ ...change(), before: 9 }]), /changed since/);
});

test("macro wire encoding supports verified version boundaries and rejects unbalanced keys, controls and oversized text", () => {
  const chord = [{ type: "down", keycode: 224 }, { type: "tap", keycode: 6 }, { type: "up", keycode: 224 }];
  assert.deepEqual([...compileMacro(chord, 1)], [2, 224, 1, 6, 3, 224]);
  assert.deepEqual([...compileMacro(chord, 2)], [1, 2, 224, 1, 1, 6, 1, 3, 224]);
  assert.deepEqual([...compileMacro([{ type: "text", text: "Hi" }, { type: "delay", milliseconds: 256 }], 4)], [72, 105, 1, 4, 2, 2]);
  assert.throws(() => compileMacro(chord.slice(0, -1), 4), /released/);
  assert.throws(() => compileMacro([{ type: "up", keycode: 224 }], 4), /did not hold/);
  assert.throws(() => compileMacro([{ type: "tap", keycode: 0x7C00 }], 4), /Firmware control/);
  assert.throws(() => compileMacro([{ type: "text", text: "hello\n" }], 4), /printable ASCII/);
  assert.throws(() => compileMacro([{ type: "delay", milliseconds: 1 }], 1), /Vial 2/);
  assert.throws(() => compileMacro([{ type: "text", text: "x".repeat(2001) }], 4), /printable ASCII/);
});

test("semantic macro/layer/modifier keys use the exact Vial version and preserve an ordinary tap fallback", async () => {
  const f = fixture(), s = await f.service.read("personal", f.deviceId);
  assert.equal(compileDeviceKey(s, { kind: "macro", index: 2 }), 0x5f14);
  assert.equal(compileDeviceKey({ ...s, identity: { ...s.identity, vialProtocol: 6 } }, { kind: "macro", index: 2 }), 0x7702);
  assert.equal(compileDeviceKey(s, { kind: "momentary-layer", layer: 1 }), 0x5101);
  assert.equal(compileDeviceKey(s, { kind: "modified", modifiers: 12, keycode: 30 }), 0x0c1e);
  const safe = validateDeviceChanges(s, [{ layer: 0, row: 0, col: 0, before: 4, after: { kind: "layer-tap", layer: 1, keycode: 4 } }]);
  assert.equal(safe[0].after, 0x4104);
  assert.throws(() => validateDeviceChanges(s, [{ layer: 0, row: 0, col: 0, before: 4, after: { kind: "layer-tap", layer: 1, keycode: 5 } }]), /fallback/);
  for (const value of [{ kind: "macro", index: 3 }, { kind: "momentary-layer", layer: 2 }, { kind: "layer-tap", layer: 1, keycode: 0x7c00 }, 0x7c00, { kind: "bootloader" }]) assert.throws(() => compileDeviceKey(s, value), /prohibited/);
  const tx = await f.service.apply("personal", (await f.service.review("personal", f.deviceId, [{ ...change(), after: { kind: "macro", index: 0 } }])).reviewId);
  assert.equal(f.raw[1][0][0], 0x5f12); await f.service.restore("personal", tx.id); assert.equal(f.raw[1][0][0], 1);
});

test("macro and physical option proposals preserve opaque slots and unknown option bits and enforce device capacity", async () => {
  const f = fixture(), s = await f.service.read("personal", f.deviceId), edit = editMacroBuffer(s, [{ index: 0, actions: [{ type: "text", text: "Review" }] }]);
  assert.deepEqual([...Buffer.from(edit.after, "base64").subarray(7, 12)], [1, 5, 19, 2, 0]);
  assert.equal(editLayoutOptions(s, [2, 1]).after, 0x80000005);
  assert.throws(() => editLayoutOptions(s, [3, 1]), /every documented/);
  assert.throws(() => editMacroBuffer(s, [{ index: 0, actions: [{ type: "text", text: "x".repeat(95) }] }]), /capacity/);
  assert.throws(() => editMacroBuffer(s, [{ index: 0, actions: [] }, { index: 0, actions: [] }]), /duplicated/);
});

test("one reviewed key/macro/layout transaction guards execution, reads back and restores after restart while preserving unowned bits", async () => {
  const f = fixture(), before = Buffer.from(f.macro);
  const review = await f.service.review("personal", f.deviceId, { changes: [change()], macros: [{ index: 0, actions: [{ type: "text", text: "Review" }] }], layoutOptions: [2, 1] });
  assert.equal(review.macros[0].index, 0); assert.equal(review.layoutOptions.choices[0].after, "Big");
  const tx = await f.service.apply("personal", review.reviewId);
  assert.equal(f.layout(), 0x80000005); assert.equal(f.raw[1][0][0], 104); assert.equal(f.macro.at(-1), 0);
  assert.deepEqual(f.macroWrites[0], { offset: 95, bytes: [255], sentinelBefore: 0 });
  assert.ok(f.macroWrites.slice(1).every((w) => w.sentinelBefore === 255));
  f.setLayout(0xc0000005);
  const restarted = createDeviceService({ store: f.store, transportFactory: f.transportFactory, withDeviceLock: f.withDeviceLock });
  await restarted.restore("personal", tx.id);
  assert.ok(f.macro.equals(before)); assert.equal(f.layout(), 0xc0000000); assert.equal(f.raw[1][0][0], 1);
});

test("an unplug during macro writing leaves execution disabled and encrypted recovery pending until the exact device returns", async () => {
  const f = fixture(), before = Buffer.from(f.macro), review = await f.service.review("personal", f.deviceId, { macros: [{ index: 0, actions: [{ type: "text", text: "Review the evidence" }] }] });
  f.interruptMacro(true);
  await assert.rejects(f.service.apply("personal", review.reviewId), /Restoration is pending/);
  assert.equal(f.macro.at(-1), 255); assert.equal(f.state.deviceTransactions[0].status, "recovery-pending");
  f.reconnect();
  const restarted = createDeviceService({ store: f.store, transportFactory: f.transportFactory, withDeviceLock: f.withDeviceLock });
  await restarted.restore("personal", f.state.deviceTransactions[0].id);
  assert.ok(f.macro.equals(before)); assert.equal(f.state.deviceTransactions[0].status, "restored");
});

test("a bad macro-body readback never enables the unverified macro and rolls back before committing the original buffer", async () => {
  const f = fixture(), before = Buffer.from(f.macro), review = await f.service.review("personal", f.deviceId, { macros: [{ index: 0, actions: [{ type: "text", text: "Review" }] }] });
  f.corruptMacroRead(); await assert.rejects(f.service.apply("personal", review.reviewId), /body readback failed/);
  const sentinels = f.macroWrites.filter((w) => w.offset === 95).map((w) => w.bytes[0]);
  assert.deepEqual(sentinels, [255, 255, 0]); assert.ok(f.macro.equals(before)); assert.equal(f.state.deviceTransactions[0].status, "restored");
});

test("macro backup failures write nothing, and recovery detects all key/macro conflicts before any restoration write", async () => {
  const backup = fixture(), review = await backup.service.review("personal", backup.deviceId, { macros: [{ index: 0, actions: [{ type: "text", text: "Review" }] }] });
  backup.baselineFailure(); await assert.rejects(backup.service.apply("personal", review.reviewId), /backup failure/); assert.equal(backup.writes(), 0);
  for (const kind of ["key", "macro", "layout"]) {
    const f = fixture(), tx = await f.service.apply("personal", (await f.service.review("personal", f.deviceId, { changes: [change(), change(1, 105)], macros: [{ index: 0, actions: [{ type: "text", text: "Review" }] }], layoutOptions: [2, 1] })).reviewId);
    if (kind === "key") f.raw[1][0][1] = 106;
    if (kind === "macro") f.macro[94] = 88;
    if (kind === "layout") f.setLayout(0x80000002);
    const written = f.writes(); await assert.rejects(f.service.restore("personal", tx.id), /outside this transaction/);
    assert.equal(f.writes(), written); assert.equal(f.state.deviceTransactions[0].status, "recovery-pending");
  }
});
