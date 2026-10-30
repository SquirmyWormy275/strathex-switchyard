import assert from "node:assert/strict";
import test from "node:test";
import { createDeviceService, VialDevice, validateDeviceChanges } from "./devices.mjs";

function fixture() {
  const deviceId = "a".repeat(64), definition = { name: "Synthetic configuration device", matrix: { rows: 1, cols: 2 }, layouts: { keymap: [["0,0", "0,1"]] } };
  const raw = [[[4, 5]], [[1, 1]]], state = { deviceTransactions: [], deviceSnapshots: [] };
  let locked = false, disconnected = false, wrong = false, partialFailure = false, writes = 0, baselineFailure = false, protocolVersion = 4;
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
      if (r[0] === 0x0C) { r[1] = 0; return r; }
      if (r[0] === 0x0D) { r.writeUInt16BE(0, 1); return r; }
      if (r[0] === 2) { r.fill(0, 2); return r; }
      if (r[0] === 5) { writes++; if (partialFailure && writes === 2) throw new Error("Synthetic partial write"); raw[r[1]][r[2]][r[3]] = r.readUInt16BE(4); return r; }
      if (r[0] === 4) { r.writeUInt16BE(raw[r[1]][r[2]][r[3]], 4); return r; }
      throw new Error("Unexpected protocol command");
    }
  });
  return { deviceId, raw, state, store, transportFactory, service: createDeviceService({ store, transportFactory }), lock: () => { locked = true; }, disconnect: () => { disconnected = true; }, wrongDevice: () => { wrong = true; }, partialFailure: () => { partialFailure = true; }, baselineFailure: () => { baselineFailure = true; }, unsupported: () => { protocolVersion = 99; }, writes: () => writes };
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
  const restarted = createDeviceService({ store: f.store, transportFactory: f.transportFactory });
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
