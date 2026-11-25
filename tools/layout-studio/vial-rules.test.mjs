import assert from "node:assert/strict";
import test from "node:test";
import { createDeviceService } from "./devices.mjs";
import { compileDeviceKey } from "./vial-keycodes.mjs";
import { overrideOptions, repeatOptions, ruleValues } from "./vial-rules.mjs";
import { readVialDynamic } from "./vial-dynamic.mjs";
import { vialFixture } from "./test-support/vial-fixture.mjs";
const flags = (spec, selected) => Object.fromEntries(Object.keys(spec).map(name => [name, selected.includes(name)]));
const override = (before = [0, 0, 0, 0, 0, 0, 0]) => ({ index: 0, before, trigger: 4, replacement: { kind: "modified", modifiers: 0x12, keycode: 5 }, layers: [0], triggerMods: ["lshift"], negativeMods: [], suppressedMods: ["lshift"], options: flags(overrideOptions, ["activateOnTrigger", "enabled"]) });
const repeat = (before = [0, 0, 0, 0]) => ({ index: 0, before, key: { kind: "modified", modifiers: 1, keycode: 4 }, alternate: { kind: "modified", modifiers: 0x11, keycode: 5 }, allowedMods: ["lshift", "rshift"], options: flags(repeatOptions, ["bidirectional", "ignoreModifierHandedness", "enabled"]) });
const fixture = () => { const f = vialFixture(); f.enableRules(); f.protocol(6); return f; };
const control = { layer: 1, row: 0, col: 0, before: 1, after: { kind: "alternate-repeat" } };
test("advertised rule entries use their exact mixed-width LE formats and preserve opaque unused slots", async () => {
  const f = fixture(), value = await f.service.read("personal", f.deviceId);
  assert.equal(value.dynamic.availability, "verified"); assert.deepEqual(value.dynamic.keyOverrides, f.keyOverrides); assert.deepEqual(value.dynamic.alternateRepeatKeys, f.alternateRepeatKeys); assert.equal(f.writes.length, 0);
  for (const index of [2, 3]) { const bytes = Buffer.alloc(32); bytes[index] = 65; assert.equal((await readVialDynamic({ exchange: async () => bytes }, 6)).availability, "unverified"); }
});
test("override/repeat semantic proposals serialize source-verified packets and restore global-key references before tables", async () => {
  const f = fixture(), opaqueOverride = [...f.keyOverrides[1]], opaqueRepeat = [...f.alternateRepeatKeys[1]];
  const reviewed = await f.service.review("personal", f.deviceId, { keyOverrides: [override()], alternateRepeatKeys: [repeat()], changes: [control] }), tx = await f.service.apply("personal", reviewed.reviewId);
  assert.deepEqual(f.keyOverrides[0], [4, 0x1205, 1, 2, 0, 2, 0x81]); assert.deepEqual(f.alternateRepeatKeys[0], [0x0104, 0x1105, 0x22, 14]);
  assert.deepEqual(f.writes[0].packet.slice(0, 14), [254, 13, 6, 0, 4, 0, 5, 18, 1, 0, 2, 0, 2, 129]);
  assert.deepEqual(f.writes[1].packet.slice(0, 10), [254, 13, 8, 0, 4, 1, 5, 17, 34, 14]); assert.ok(f.writes[1].packet.slice(10).every(byte => byte === 0));
  assert.equal(f.raw[1][0][0], 0x7c7a); await createDeviceService(f.options).restore("personal", tx.id); assert.equal(f.raw[1][0][0], 1);
  assert.deepEqual(f.keyOverrides[0], override().before); assert.deepEqual(f.alternateRepeatKeys[0], repeat().before); assert.deepEqual(f.keyOverrides[1], opaqueOverride); assert.deepEqual(f.alternateRepeatKeys[1], opaqueRepeat);
  assert.deepEqual(f.writes.map(write => write.kind), ["key-override", "alternate-repeat", "key", "key", "key-override", "alternate-repeat"]);
});
test("unmodified typing, firmware controls, absent triggers, contradictory modifiers and invalid options fail before writes", async () => {
  const f = fixture();
  for (const edit of [{ ...override(), triggerMods: [] }, { ...override(), trigger: 6 }, { ...override(), replacement: 0x7c00 }, { ...override(), replacement: 2 }, { ...override(), replacement: { kind: "macro", index: 0 } }, { ...override(), layers: [16] }, { ...override(), triggerMods: ["lshift"], negativeMods: ["lshift"] }, { ...override(), options: { ...override().options, invented: true } }, { ...override(), options: flags(overrideOptions, ["enabled"]) }]) await assert.rejects(f.service.review("personal", f.deviceId, { keyOverrides: [edit] }));
  for (const edit of [{ ...repeat(), key: 6 }, { ...repeat(), key: 0 }, { ...repeat(), alternate: 0x7c00 }, { ...repeat(), alternate: { kind: "tap-dance", index: 0 } }, { ...repeat(), allowedMods: ["lshift", "lshift"] }, { ...repeat(), allowedMods: ["invented"] }, { ...repeat(), options: { enabled: true } }]) await assert.rejects(f.service.review("personal", f.deviceId, { alternateRepeatKeys: [edit] }));
  assert.equal(f.writes.length, 0);
});
test("unknown rule option bits remain read-only unless that exact advertised entry is explicitly cleared", async () => {
  const f = fixture(), original = [...f.keyOverrides[1]], repeatOriginal = [...f.alternateRepeatKeys[1]];
  await assert.rejects(f.service.review("personal", f.deviceId, { keyOverrides: [{ ...override(original), index: 1 }] }), /unknown/);
  await assert.rejects(f.service.review("personal", f.deviceId, { alternateRepeatKeys: [{ ...repeat(repeatOriginal), index: 1 }] }), /unknown/);
  const reviewed = await f.service.review("personal", f.deviceId, { keyOverrides: [{ index: 1, before: original, disable: true }], alternateRepeatKeys: [{ index: 1, before: repeatOriginal, disable: true }] }), tx = await f.service.apply("personal", reviewed.reviewId);
  assert.deepEqual(f.keyOverrides[1], Array(7).fill(0)); assert.deepEqual(f.alternateRepeatKeys[1], Array(4).fill(0)); await f.service.restore("personal", tx.id); assert.deepEqual(f.keyOverrides[1], original); assert.deepEqual(f.alternateRepeatKeys[1], repeatOriginal);
});
test("Vial 6 feature assignments use verified advertisement bits/counts; legacy migration sentinels never become firmware codes", async () => {
  const f = fixture(), snapshot = await f.service.read("personal", f.deviceId);
  assert.equal(ruleValues({ ...snapshot, layers: 32 }, "key-override", { ...override(), layers: [15] })[2], 0x8000);
  assert.throws(() => ruleValues({ ...snapshot, layers: 32 }, "key-override", { ...override(), layers: [16] }), /16-bit mask/);
  for (const [kind, code] of [["repeat", 0x7c79], ["alternate-repeat", 0x7c7a], ["caps-word", 0x7c73], ["layer-lock", 0x7c7b]]) assert.equal(compileDeviceKey(snapshot, { kind }), code);
  snapshot.dynamic.featureBits = 0; assert.throws(() => compileDeviceKey(snapshot, { kind: "caps-word" }), /key form/); assert.throws(() => compileDeviceKey(snapshot, { kind: "layer-lock" }), /key form/);
  snapshot.dynamic.alternateRepeatKeys = []; assert.throws(() => compileDeviceKey(snapshot, { kind: "repeat" }), /key form/);
  for (const protocol of [4, 5]) { f.protocol(protocol); await assert.rejects(f.service.review("personal", f.deviceId, { alternateRepeatKeys: [repeat()] }), /Vial 6/); const value = await f.service.read("personal", f.deviceId); assert.throws(() => compileDeviceKey(value, { kind: "alternate-repeat" }), /key form/); await f.service.review("personal", f.deviceId, { keyOverrides: [override()] }); }
  assert.equal(f.writes.length, 0);
});
test("both rule codecs recover mixed before/after bytes and keep unplugged recovery pending until reconnect", async () => {
  for (const kind of ["keyOverrides", "alternateRepeatKeys"]) for (const unplug of [false, true]) {
    const f = fixture(), reviewed = await f.service.review("personal", f.deviceId, { [kind]: [kind === "keyOverrides" ? override() : repeat()] }); f.interrupt(unplug);
    await assert.rejects(f.service.apply("personal", reviewed.reviewId), unplug ? /Restoration is pending/ : /interrupted/);
    assert.equal(f.state.deviceTransactions[0].status, unplug ? "recovery-pending" : "restored");
    if (unplug) { f.reconnect(); await createDeviceService(f.options).restore("personal", f.state.deviceTransactions[0].id); }
    assert.deepEqual(f[kind][0], kind === "keyOverrides" ? override().before : repeat().before);
  }
});
test("readback faults roll back, and unrelated rule bytes block all recovery writes before removing key references", async () => {
  const f = fixture(), reviewed = await f.service.review("personal", f.deviceId, { alternateRepeatKeys: [repeat()], changes: [control] }); f.corrupt();
  await assert.rejects(f.service.apply("personal", reviewed.reviewId), /read back/); assert.equal(f.raw[1][0][0], 1); assert.equal(f.state.deviceTransactions[0].status, "restored");
  const next = await f.service.review("personal", f.deviceId, { keyOverrides: [override()], alternateRepeatKeys: [repeat()], changes: [control] }), tx = await f.service.apply("personal", next.reviewId); f.keyOverrides[0][4] = 0x80; const writes = f.writes.length;
  await assert.rejects(f.service.restore("personal", tx.id), /outside this transaction/); assert.equal(f.writes.length, writes); assert.equal(f.raw[1][0][0], 0x7c7a);
});
test("rule changes retain baseline/physical-unlock guards and cannot replay a consumed review", async () => {
  for (const flag of ["locked", "backupFailure"]) { const f = fixture(), reviewed = await f.service.review("personal", f.deviceId, { keyOverrides: [override()], alternateRepeatKeys: [repeat()] }); f[flag](); await assert.rejects(f.service.apply("personal", reviewed.reviewId)); assert.equal(f.writes.length, 0); await assert.rejects(f.service.apply("personal", reviewed.reviewId), /already used/); }
});
test("explicit default alternate behavior remains bounded to ordinary outputs and reviewed option semantics", async () => {
  const f = fixture(), value = { ...repeat(), key: 0, alternate: 5, allowedMods: [], options: flags(repeatOptions, ["defaultToAlternate", "enabled"]) };
  const reviewed = await f.service.review("personal", f.deviceId, { alternateRepeatKeys: [value] }), tx = await f.service.apply("personal", reviewed.reviewId); assert.deepEqual(f.alternateRepeatKeys[0], [0, 5, 0, 9]); await f.service.restore("personal", tx.id);
});
