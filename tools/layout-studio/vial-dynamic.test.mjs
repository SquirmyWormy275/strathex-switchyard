import assert from "node:assert/strict";
import test from "node:test";
import { createDeviceService, validateDeviceChanges } from "./devices.mjs";
import { compileDeviceKey } from "./vial-keycodes.mjs";
import { dynamicChanges, dynamicCandidate, readVialDynamic } from "./vial-dynamic.mjs";
function fixture() {
  const deviceId = "d".repeat(64), raw = [[[4, 5]], [[1, 1]]], tapDances = [[0, 0, 0, 0, 200], [0x7777, 0x8888, 0x9999, 0xaaaa, 230]], combos = [[0, 0, 0, 0, 0], [0x7777, 0, 0, 0, 0x8888]], writes = [], state = { deviceTransactions: [], deviceSnapshots: [] };
  let disconnected = false, locked = false, failBaseline = false, interrupt = false, unplug = false, corrupt = false, changed = false, protocol = 4;
  const store = { snapshot: async () => structuredClone(state), update: async (_, operation, fn) => { if (operation === "device-baseline" && failBaseline) throw new Error("Synthetic backup failure"); const draft = structuredClone(state), result = await fn(draft); Object.assign(state, draft); return result; } };
  const withDeviceLock = async (_, fn) => fn({ assert() {} });
  const transportFactory = () => ({ close() {}, async request(method) {
    if (method === "list") return disconnected ? [] : [{ id: deviceId, candidateProtocol: "vial" }];
    if (method === "open") return { candidateProtocol: "vial" };
    if (method === "decode-definition") return { matrix: { rows: 1, cols: 2 }, layouts: { keymap: [["0,0", "0,1"]] } };
    throw Error("Unexpected transport method");
  }, async exchange(bytes) {
    if (disconnected) throw Error("Synthetic unplug"); const r = Buffer.from(bytes);
    if (r[0] === 0xfe) {
      const command = r[1], operation = r[2], index = r[3];
      if (command === 0) { r.fill(0); r.writeUInt32LE(protocol); r.fill(1, 4, 12); }
      else if (command === 1) { r.fill(0); r.writeUInt32LE(1); }
      else if (command === 2) r.fill(0);
      else if (command === 5) { r.fill(255); r[0] = locked ? 0 : 1; r[1] = 0; }
      else if (command === 9) r.fill(255);
      else if (command === 13) {
        if (operation === 0) { r.fill(0); r[0] = tapDances.length; r[1] = combos.length; r[31] = 3; }
        else {
          const entries = operation <= 2 ? tapDances : combos;
          if (operation === 1 || operation === 3) { r.fill(0); entries[index].forEach((v, i) => r.writeUInt16LE(v, 1 + i * 2)); if (corrupt && changed) { corrupt = false; r[1] ^= 1; } }
          else if (operation === 2 || operation === 4) {
            writes.push({ kind: operation === 2 ? "tap-dance" : "combo", index, packet: [...r] }); changed = true;
            const after = Array.from({ length: 5 }, (_, i) => r.readUInt16LE(4 + i * 2));
            if (interrupt) { interrupt = false; const partial = Buffer.alloc(10); entries[index].forEach((v, i) => partial.writeUInt16LE(v, i * 2)); r.copy(partial, 0, 4, 7); entries[index] = Array.from({ length: 5 }, (_, i) => partial.readUInt16LE(i * 2)); if (unplug) disconnected = true; throw Error("Synthetic interrupted dynamic entry"); }
            entries[index] = after; r.fill(0);
          } else throw Error("Unexpected dynamic operation");
        }
      } else throw Error("Unexpected Vial command");
      return r;
    }
    if (r[0] === 1) { r.writeUInt16BE(9, 1); return r; }
    if (r[0] === 0x11) { r[1] = 2; return r; }
    if (r[0] === 0x12) { const p = Buffer.alloc(8); raw.flat(2).forEach((v, i) => p.writeUInt16BE(v, i * 2)); p.copy(r, 4, r.readUInt16BE(1), r.readUInt16BE(1) + r[3]); return r; }
    if ([0x0c, 0x0d].includes(r[0])) { r.fill(0, 1); return r; }
    if (r[0] === 2) { r.writeUInt32BE(0, 2); return r; }
    if (r[0] === 5) { writes.push({ kind: "key", layer: r[1], row: r[2], col: r[3] }); raw[r[1]][r[2]][r[3]] = r.readUInt16BE(4); return r; }
    if (r[0] === 4) { r.writeUInt16BE(raw[r[1]][r[2]][r[3]], 4); return r; }
    throw Error("Unexpected VIA command");
  } });
  const options = { store, transportFactory, withDeviceLock };
  return { deviceId, raw, tapDances, combos, writes, state, options, service: createDeviceService(options), interrupt: (disconnect = false) => { interrupt = true; unplug = disconnect; }, reconnect: () => { disconnected = false; }, corrupt: () => { corrupt = true; }, locked: () => { locked = true; }, backupFailure: () => { failBaseline = true; }, protocol: (v) => { protocol = v; } };
}
const dance = (before = [0, 0, 0, 0, 200]) => ({ index: 0, before, tap: 4, hold: { kind: "momentary-layer", layer: 1 }, doubleTap: 6, tapHold: 0, termMs: 250 });
const key = { layer: 0, row: 0, col: 0, before: 4, after: { kind: "tap-dance", index: 0 } };
test("dynamic advertisement and LE entries are read without rewriting opaque unused slots", async () => {
  const f = fixture(), s = await f.service.read("personal", f.deviceId);
  assert.equal(s.dynamic.availability, "verified"); assert.deepEqual(s.dynamic.tapDances[1], f.tapDances[1]); assert.deepEqual(s.dynamic.combos[1], f.combos[1]); assert.equal(s.dynamic.featureBits, 3); assert.equal(f.writes.length, 0);
  f.protocol(3); assert.equal((await f.service.read("personal", f.deviceId)).dynamic.availability, "not-supported");
  for (const response of [Buffer.alloc(31), Buffer.alloc(32, 0xfe), Buffer.from([65, ...Array(31).fill(0)])]) assert.equal((await readVialDynamic({ exchange: async () => response }, 4)).availability, "unverified");
});
test("combined tap-dance/key changes preserve ordinary typing and restore key references before table entries", async () => {
  const f = fixture(), review = await f.service.review("personal", f.deviceId, { tapDances: [dance()], changes: [key] });
  assert.equal(review.dynamic[0].after[1], 0x5101); const tx = await f.service.apply("personal", review.reviewId);
  assert.equal(f.raw[0][0][0], 0x5700); assert.equal(f.state.deviceTransactions[0].baseline.keymap_raw[0][0][0], 4);
  await assert.rejects(f.service.apply("personal", review.reviewId), /already used/);
  await createDeviceService(f.options).restore("personal", tx.id);
  assert.equal(f.raw[0][0][0], 4); assert.deepEqual(f.tapDances[0], [0, 0, 0, 0, 200]);
  assert.deepEqual(f.writes.map((w) => w.kind), ["tap-dance", "key", "key", "tap-dance"]);
});
test("TD keycodes use only advertised slots and candidate tap meanings across Vial versions", async () => {
  for (const protocol of [4, 5, 6]) {
    const f = fixture(); f.protocol(protocol); const s = await f.service.read("personal", f.deviceId), candidate = dynamicCandidate(s, dynamicChanges(s, { tapDances: [dance()] }));
    assert.equal(compileDeviceKey(candidate, { kind: "tap-dance", index: 0 }), 0x5700);
    assert.equal(validateDeviceChanges(s, [key], candidate)[0].after, 0x5700);
    assert.throws(() => compileDeviceKey(candidate, { kind: "tap-dance", index: 2 }), /key form/);
    assert.throws(() => validateDeviceChanges(s, [key]), /fallback/);
  }
});
test("unsafe dynamic proposals, nested dances, absent triggers and lost ordinary taps fail before writes", async () => {
  const f = fixture();
  for (const edit of [{ ...dance(), index: 2 }, { ...dance(), termMs: 0 }, { ...dance(), tap: 0x7c00 }, { ...dance(), hold: 1 }, { ...dance(), tapHold: { kind: "tap-dance", index: 1 } }]) await assert.rejects(f.service.review("personal", f.deviceId, { tapDances: [edit] }));
  await assert.rejects(f.service.review("personal", f.deviceId, { combos: [{ index: 0, before: [0, 0, 0, 0, 0], keys: [4, 6], output: 7 }] }), /exist in the recorded/);
  assert.equal(f.writes.length, 0);
  const review = await f.service.review("personal", f.deviceId, { tapDances: [dance()], changes: [key] }); await f.service.apply("personal", review.reviewId);
  await assert.rejects(f.service.review("personal", f.deviceId, { tapDances: [{ ...dance(f.tapDances[0]), tap: 5 }] }), /Preserve its tap output/);
});
test("combo output is bounded, can be cleared, and unowned entries survive restore", async () => {
  const f = fixture(), original = [...f.combos[1]], before = [0, 0, 0, 0, 0];
  const review = await f.service.review("personal", f.deviceId, { combos: [{ index: 0, before, keys: [4, 5], output: 6 }] }), tx = await f.service.apply("personal", review.reviewId);
  assert.deepEqual(f.combos[0], [4, 5, 0, 0, 6]); f.combos[1][4] = 0xabcd;
  await f.service.restore("personal", tx.id); assert.deepEqual(f.combos[0], before); assert.equal(f.combos[1][4], 0xabcd);
  assert.deepEqual(original.slice(0, 4), f.combos[1].slice(0, 4));
  const add = await f.service.review("personal", f.deviceId, { combos: [{ index: 0, before, keys: [4, 5], output: 6 }] }); await f.service.apply("personal", add.reviewId);
  const clear = await f.service.review("personal", f.deviceId, { combos: [{ index: 0, before: [...f.combos[0]], disable: true }] }); await f.service.apply("personal", clear.reviewId); assert.deepEqual(f.combos[0], before);
});
test("partial dynamic writes restore known bytes and never install an unverified key reference", async () => {
  const f = fixture(), review = await f.service.review("personal", f.deviceId, { tapDances: [dance()], changes: [key] }); f.interrupt();
  await assert.rejects(f.service.apply("personal", review.reviewId), /interrupted/);
  assert.equal(f.state.deviceTransactions[0].status, "restored"); assert.equal(f.raw[0][0][0], 4); assert.deepEqual(f.tapDances[0], [0, 0, 0, 0, 200]);
});
test("unplug keeps exact recovery inputs pending until the same device returns", async () => {
  const f = fixture(), review = await f.service.review("personal", f.deviceId, { tapDances: [dance()], changes: [key] }); f.interrupt(true);
  await assert.rejects(f.service.apply("personal", review.reviewId), /Restoration is pending/); assert.equal(f.state.deviceTransactions[0].status, "recovery-pending"); assert.equal(f.raw[0][0][0], 4);
  f.reconnect(); await createDeviceService(f.options).restore("personal", f.state.deviceTransactions[0].id); assert.deepEqual(f.tapDances[0], [0, 0, 0, 0, 200]);
});
test("bad readback rolls back; unrelated dynamic edits are preflighted before any recovery write", async () => {
  const f = fixture(), review = await f.service.review("personal", f.deviceId, { tapDances: [dance()], changes: [key] }); f.corrupt();
  await assert.rejects(f.service.apply("personal", review.reviewId), /read back/); assert.equal(f.raw[0][0][0], 4); assert.equal(f.state.deviceTransactions[0].status, "restored");
  const fresh = await f.service.review("personal", f.deviceId, { tapDances: [dance()], changes: [key] }), tx = await f.service.apply("personal", fresh.reviewId);
  f.tapDances[0][1] = 0x1234; const count = f.writes.length;
  await assert.rejects(f.service.restore("personal", tx.id), /outside this transaction/); assert.equal(f.writes.length, count); assert.equal(f.raw[0][0][0], 0x5700);
});
test("locked and failed-baseline dynamic transactions have no hardware writes", async () => {
  for (const flag of ["locked", "backupFailure"]) { const f = fixture(), review = await f.service.review("personal", f.deviceId, { tapDances: [dance()] }); f[flag](); await assert.rejects(f.service.apply("personal", review.reviewId)); assert.equal(f.writes.length, 0); }
});
