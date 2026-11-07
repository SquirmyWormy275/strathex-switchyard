import assert from "node:assert/strict";
import test from "node:test";
import { createDeviceService } from "./devices.mjs";
import { decodeOriginalExpansion, originalExpansionSource } from "./xwhatsit-expansion.mjs";
import { compileDeviceKey } from "./vial-keycodes.mjs";

function fixture({ rows = 8, cols = 16, type = 3 } = {}) {
  const deviceId = "e".repeat(64), raw = Array.from({ length: 4 }, (_, l) => Array.from({ length: rows }, () => Array(cols).fill(l === 0 ? 4 : 0))), state = { deviceSnapshots: [], deviceTransactions: [] }, commands = [];
  const settings = { version: "0.9.0", protocol: "original-xwhatsit-0.9", layers: 4, rows, cols, type, mode: 5, val1: 20, val2: 30, short: false, conflict: false, incomplete: false, badExpansion: false };
  let selected = 0, cursor = 37, sequence = 0, previous, closed = 0;
  const store = { snapshot: async () => structuredClone(state), update: async (_, operation, fn) => { const draft = structuredClone(state), result = await fn(draft); Object.assign(state, draft); return result; } };
  const transportFactory = () => ({
    close() { closed++; },
    async request(method) { if (method === "list") return [{ id: deviceId, candidateProtocol: "original-xwhatsit-0.9" }]; if (method === "open") return { candidateProtocol: settings.protocol }; throw new Error("Unexpected legacy method"); },
    async exchange(p, read) {
      assert.equal(p.length, 8); assert.equal(read, false); commands.push([...p]);
      if (p[0] === 0) { selected = p[1]; sequence = 0; previous = undefined; }
      else if (p[0] === 5) raw[p[1] >> 6][p[2]][p[1] & 31] = p[3];
      else throw new Error("Unexpected legacy mutation");
      return Buffer.alloc(0);
    },
    async read() {
      const r = Buffer.alloc(8); r[0] = selected;
      if (selected === 9) Buffer.from(settings.version).copy(r, 1);
      if (selected === 1) { r[1] = settings.layers; r[2] = 8; r[3] = settings.cols; r[4] = settings.rows; r[5] = settings.type; r[6] = 1; }
      if (selected === 10) { r[1] = settings.mode; r[2] = settings.val1; r[3] = settings.val2; if (settings.badExpansion) r[7] = 1; }
      if (selected === 7) {
        if (settings.short) return Buffer.from([7, 0, 4]);
        if (settings.conflict && sequence === 1) { sequence++; const changed = Buffer.from(previous); changed[2] ^= 1; return changed; }
        const slices = rows / 4, count = 4 * cols * slices, index = settings.incomplete ? 0 : cursor++ % count, col = index % cols, slice = Math.floor(index / cols) % slices, layer = Math.floor(index / (cols * slices));
        r[1] = layer << 6 | slice << 5 | col;
        for (let i = 0; i < 4; i++) r[2 + i] = raw[layer][slice * 4 + i][col];
        if (settings.dirtyPadding) r[7] = 1; if (settings.badColumn) r[1] = r[1] & 224 | 31; if (settings.badSlice) r[1] |= 32;
        previous = Buffer.from(r); sequence++;
      }
      return r;
    }
  });
  const options = { store, transportFactory, withDeviceLock: async (_, fn) => fn({ assert() {} }) };
  return { deviceId, raw, state, settings, commands, store, options, service: createDeviceService(options), closed: () => closed };
}
test("original expansion modes decode exact configured timings and lock contacts without claiming physical hardware or safe limits", () => {
  for (let mode = 0; mode <= 14; mode++) {
    const r = decodeOriginalExpansion(Buffer.from([10, mode, 0, 255, 0, 0, 0, 0]));
    assert.equal(r.modeKnown, true); assert.deepEqual(r.rawValues, [0, 255]); assert.equal(r.controlAvailable, false); assert.equal(r.hardwarePresenceVerified, false); assert.equal(r.electricalLimitsVerified, false); assert.equal(r.hostLockStateVerified, false);
    assert.deepEqual(r.timing, mode === 1 || mode >= 3 ? { extendMs: 0, retractMs: 255 } : null);
    if (mode >= 3) assert.equal(r.lockSwitch.contact, mode % 2 ? "normally-open" : "normally-closed"); else assert.equal(r.lockSwitch, null);
  }
  const num = decodeOriginalExpansion(Buffer.from([10, 5, 20, 30, 0, 0, 0, 0])); assert.equal(num.lockSwitch.function, "num-lock"); assert.equal(num.source.archiveSha256, originalExpansionSource.archiveSha256);
  const unknown = decodeOriginalExpansion(Buffer.from([10, 255, 123, 234, 0, 0, 0, 0])); assert.equal(unknown.modeKnown, false); assert.equal(unknown.configuredFunction, "unknown"); assert.deepEqual(unknown.rawValues, [123, 234]); assert.equal(unknown.timing, null);
});
test("malformed legacy expansion headers, lengths and unowned bytes do not become configuration evidence", () => {
  for (const r of [Buffer.alloc(7), Buffer.alloc(8), Buffer.from([10, 1, 20, 30, 0, 0, 0, 1])]) assert.throws(() => decodeOriginalExpansion(r), /malformed/);
});
test("original 0.9 readout decodes every layer from a rotating column stream and reads expansion with no configuration writes", async () => {
  for (const shape of [{ rows: 8, cols: 16, type: 3 }, { rows: 4, cols: 23, type: 1 }, { rows: 8, cols: 12, type: 2 }]) {
    const f = fixture(shape); f.raw[0][0][0] = 52; f.raw[3][shape.rows - 1][shape.cols - 1] = 242;
    const s = await f.service.read("personal", f.deviceId); assert.deepEqual(s.keymap_raw, f.raw); assert.equal(s.identity.firmwareVersion, "0.9.0"); assert.equal(s.expansion.lockSwitch.function, "num-lock"); assert.deepEqual(s.expansion.timing, { extendMs: 20, retractMs: 30 });
    assert.equal(f.commands.every(p => p[0] === 0), true); assert.equal(f.commands.at(-1)[1], 0); assert.equal(f.closed(), 1); assert.deepEqual(f.state.deviceSnapshots, [s]); assert.equal(f.state.deviceTransactions.length, 0);
  }
});
test("unsupported original identity, version, matrix and malformed expansion reject before any snapshot is saved", async () => {
  for (const change of [s => { s.protocol = "vial"; }, s => { s.version = "0.8.0"; }, s => { s.layers = 3; }, s => { s.rows = 6; }, s => { s.cols = 15; }, s => { s.type = 9; }, s => { s.badExpansion = true; }]) {
    const f = fixture(); change(f.settings); await assert.rejects(f.service.read("personal", f.deviceId), /prohibited|not been verified|unsupported|malformed/); assert.equal(f.state.deviceSnapshots.length, 0); assert.equal(f.commands.every(p => p[0] === 0), true); assert.equal(f.closed(), 1);
  }
});
test("truncated, incomplete and conflicting original streams preserve the previous protected readout and always quiesce", async () => {
  for (const fault of ["short", "incomplete", "conflict", "dirtyPadding", "badColumn", "badSlice"]) {
    const f = fixture(fault === "badSlice" ? { rows: 4, cols: 23, type: 1 } : undefined); await f.service.read("personal", f.deviceId); const before = structuredClone(f.state); f.settings[fault] = true;
    await assert.rejects(f.service.read("personal", f.deviceId), /malformed|incomplete|changed during|framing is invalid/); assert.deepEqual(f.state, before); assert.equal(f.commands.at(-1)[1], 0); assert.equal(f.commands.every(p => p[0] === 0), true); assert.equal(f.closed(), 2);
  }
});
test("ordinary original key transactions save the full readout, reject replay and restore keys without mutating expansion settings", async () => {
  const f = fixture(), edit = { layer: 1, row: 0, col: 0, before: 0, after: 6 }, review = await f.service.review("personal", f.deviceId, [edit]);
  const tx = await f.service.apply("personal", review.reviewId); assert.equal(tx.status, "applied"); assert.equal(f.raw[1][0][0], 6); assert.equal(f.state.deviceTransactions[0].baseline.expansion.configurationReadVerified, true);
  await assert.rejects(f.service.apply("personal", review.reviewId), /already used/);
  f.settings.val1 = 21; const restarted = createDeviceService(f.options); assert.equal((await restarted.restore("personal", tx.id)).status, "restored"); assert.equal(f.raw[1][0][0], 0); assert.equal(f.settings.val1, 21);
  assert.ok(f.commands.some(p => p[0] === 5)); assert.ok(f.commands.every(p => [0, 5].includes(p[0]))); assert.ok(!f.commands.some(p => [8, 9, 10].includes(p[0])));
});
test("legacy calibration and expansion keycodes cannot be confused with Vial transparent or ordinary assignments", async () => {
  const f = fixture(), snapshot = await f.service.read("personal", f.deviceId);
  for (const value of [1, 2, 3, 232, 255, -1, { kind: "momentary-layer", layer: 1 }]) assert.throws(() => compileDeviceKey(snapshot, value), /calibration.*expansion-control/);
  assert.equal(compileDeviceKey(snapshot, 0), 0); assert.equal(compileDeviceKey(snapshot, 231), 231); assert.equal(compileDeviceKey({ identity: { vialProtocol: 6 } }, 1), 1);
  for (const value of [1, 2, 3]) { f.raw[1][0][0] = value; await assert.rejects(f.service.review("personal", f.deviceId, [{ layer: 1, row: 0, col: 0, before: value, after: 6 }]), /calibration-reference.*preserved/); }
  assert.equal(f.commands.every(p => p[0] === 0), true);
});
