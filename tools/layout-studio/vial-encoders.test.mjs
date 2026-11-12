import assert from "node:assert/strict";
import test from "node:test";
import { createDeviceService } from "./devices.mjs";
import { encoderIndices, readVialEncoders, encoderChanges } from "./vial-encoders.mjs";
import { vialFixture } from "./test-support/vial-fixture.mjs";
const label = (index, direction) => `${index},${direction}${"\n".repeat(9)}e`;
function fixture() { const f = vialFixture(); f.definition.layouts.keymap.push([label(0, 0), label(0, 1), { a: 0 }, label(2, 0), label(2, 1)]); return f; }
const edit = { layer: 0, index: 0, direction: 0, before: 4, after: { kind: "modified", modifiers: 1, keycode: 6 } };
test("encoder identity comes from normalized KLE markers; holes, metadata and alignment are handled explicitly", () => {
  const f = fixture(); f.definition.layouts.keymap.unshift({ name: "Synthetic metadata" });
  assert.deepEqual(encoderIndices(f.definition), [0, 2]);
  for (const keymap of [[[label(32, 0)]], [[{ a: 1 }, label(0, 0)]], [[{ a: 8 }, label(0, 0)]], [["0,2" + "\n".repeat(9) + "e"]]]) assert.throws(() => encoderIndices({ layouts: { keymap } }));
  assert.deepEqual(encoderIndices({ layouts: { keymap: [["0,0\ne"]] } }), []);
});
test("snapshot reads only definition-advertised encoder indices and both BE directions without writes", async () => {
  const f = fixture(), s = await f.service.read("personal", f.deviceId);
  assert.equal(s.encoders.availability, "verified"); assert.deepEqual(s.encoders.indices, [0, 2]); assert.equal(s.encoders.entries.length, 4);
  assert.deepEqual(s.encoders.entries.find((e) => e.layer === 0 && e.index === 2).values, [0x7777, 0x8888]);
  assert.deepEqual([...new Set(f.encoderReads.map((e) => e.index))], [0, 2]); assert.equal(f.writes.length, 0);
  const unsupported = await readVialEncoders({ exchange: async (p) => Buffer.from(p) }, f.definition, 2); assert.equal(unsupported.availability, "unverified");
  assert.throws(() => encoderChanges({ ...s, identity: { protocol: "original-xwhatsit-0.9" } }, [edit]), /verified Vial definition/);
});
test("reviewed direction writes use exact BE payloads, reject replay and restore after restart", async () => {
  const f = fixture(), review = await f.service.review("personal", f.deviceId, { encoders: [edit] }), tx = await f.service.apply("personal", review.reviewId);
  assert.equal(f.encoders.get("0:0")[0], 0x0106); assert.deepEqual(f.writes[0].packet.slice(0, 7), [0xfe, 4, 0, 0, 0, 1, 6]);
  await assert.rejects(f.service.apply("personal", review.reviewId), /already used/);
  await createDeviceService(f.options).restore("personal", tx.id); assert.deepEqual(f.encoders.get("0:0"), [4, 5]); assert.deepEqual(f.encoders.get("0:2"), [0x7777, 0x8888]);
});
test("wrong indices/layers/directions, stale values, error codes and firmware controls fail before writes", async () => {
  const f = fixture();
  for (const e of [{ ...edit, index: 1 }, { ...edit, layer: 2 }, { ...edit, direction: 2 }, { ...edit, before: 6 }, { ...edit, after: 2 }, { ...edit, after: 0x7c00 }]) await assert.rejects(f.service.review("personal", f.deviceId, { encoders: [e] }));
  await assert.rejects(f.service.review("personal", f.deviceId, { encoders: [edit, edit] }), /twice/); assert.equal(f.writes.length, 0);
});
test("partial encoder words restore only known before/after bytes and preserve ordinary typing", async () => {
  const f = fixture(), review = await f.service.review("personal", f.deviceId, { encoders: [edit] }); f.interruptEncoder();
  await assert.rejects(f.service.apply("personal", review.reviewId), /interrupted encoder/);
  assert.equal(f.state.deviceTransactions[0].status, "restored"); assert.deepEqual(f.encoders.get("0:0"), [4, 5]); assert.deepEqual(f.raw[0], [[4, 5]]);
});
test("unplugged encoder recovery stays pending until exact device readout returns", async () => {
  const f = fixture(), review = await f.service.review("personal", f.deviceId, { encoders: [edit] }); f.interruptEncoder(true);
  await assert.rejects(f.service.apply("personal", review.reviewId), /Restoration is pending/); assert.equal(f.state.deviceTransactions[0].status, "recovery-pending");
  f.reconnect(); await createDeviceService(f.options).restore("personal", f.state.deviceTransactions[0].id); assert.deepEqual(f.encoders.get("0:0"), [4, 5]);
});
test("encoder bad readback rolls back and unrelated direction edits block restoration before any write", async () => {
  const f = fixture(), review = await f.service.review("personal", f.deviceId, { encoders: [edit] }); f.corruptEncoder();
  await assert.rejects(f.service.apply("personal", review.reviewId), /acknowledged and read back/); assert.equal(f.state.deviceTransactions[0].status, "restored");
  const next = await f.service.review("personal", f.deviceId, { encoders: [edit] }), tx = await f.service.apply("personal", next.reviewId);
  f.encoders.get("0:0")[0] = 0x1234; const count = f.writes.length;
  await assert.rejects(f.service.restore("personal", tx.id), /outside this transaction/); assert.equal(f.writes.length, count);
});
test("unowned encoder directions survive restoration and TD references restore before their tables", async () => {
  const f = fixture(), dance = { index: 0, before: [0, 0, 0, 0, 200], tap: 4, hold: 0, doubleTap: 6, tapHold: 0, termMs: 250 };
  const review = await f.service.review("personal", f.deviceId, { tapDances: [dance], encoders: [{ ...edit, after: { kind: "tap-dance", index: 0 } }] }), tx = await f.service.apply("personal", review.reviewId);
  f.encoders.get("0:0")[1] = 0x8888;
  await f.service.restore("personal", tx.id); assert.deepEqual(f.encoders.get("0:0"), [4, 0x8888]); assert.deepEqual(f.tapDances[0], [0, 0, 0, 0, 200]);
  assert.deepEqual(f.writes.map((w) => w.kind), ["tap-dance", "encoder", "encoder", "tap-dance"]);
});
test("locked encoder configuration and failed protected-baseline saves have no writes", async () => {
  for (const flag of ["locked", "backupFailure"]) { const f = fixture(), review = await f.service.review("personal", f.deviceId, { encoders: [edit] }); f[flag](); await assert.rejects(f.service.apply("personal", review.reviewId)); assert.equal(f.writes.length, 0); }
});
