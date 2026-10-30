import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { matrixDimensions, decodeMatrixState } from "./vial-matrix.mjs";
import { createMatrixDiagnostics } from "./matrix-diagnostics.mjs";
import { createDeviceService, VialDevice } from "./devices.mjs";
import { createSuiteStore } from "./suite-store.mjs";
import { createSuite } from "./suite.mjs";
import { vialFixture } from "./test-support/vial-fixture.mjs";

async function fixture(fn) {
  const root = await mkdtemp(join(tmpdir(), "switchyard-key-test-")), keys = new Map(), time = { value: Date.now() }, f = vialFixture(), packets = [];
  const store = createSuiteStore({ root, clock: () => time.value, secrets: { get: async (id, purpose) => keys.get(`${id}:${purpose}`), set: async (id, purpose, value) => { keys.set(`${id}:${purpose}`, value); } } });
  let locked = false, definitionChanged = false, sampleHook, active = "personal", closes = 0;
  const transportFactory = () => {
    const t = f.options.transportFactory();
    return { ...t, close() { closes++; return t.close(); }, async request(method, body) { const r = await t.request(method, body); return method === "decode-definition" && definitionChanged ? { ...r, name: "Changed firmware definition" } : r; }, async exchange(bytes) {
      packets.push([...bytes]);
      if (bytes[0] === 0xfe && bytes[1] === 8) { locked = true; return Buffer.from(bytes); }
      if (bytes[0] === 0xfe && bytes[1] === 5 && locked) { const r = Buffer.alloc(32, 255); r[0] = r[1] = 0; return r; }
      if (bytes[0] === 2 && bytes[1] === 3) { const r = Buffer.alloc(32); r[0] = 2; r[1] = 3; r[2] = 2; await sampleHook?.(); return r; }
      return t.exchange(bytes);
    } };
  };
  const devices = createDeviceService({ store, transportFactory, withDeviceLock: f.options.withDeviceLock }), diagnostic = createMatrixDiagnostics({ store, devices, now: () => time.value, isActive: async (c) => c === active });
  try {
    await store.initialize("personal"); await store.initialize("work", "work"); await store.update("personal", "mode-select", (s) => { s.mode = "personal-companion"; });
    const baseline = await devices.read("personal", f.deviceId); time.value = Date.parse(baseline.capturedAt); packets.length = 0;
    await fn({ root, store, devices, diagnostic, baseline, deviceId: f.deviceId, time, packets, f, closes: () => closes, lock: () => { locked = true; }, changeDefinition: () => { definitionChanged = true; }, sampleHook: (fn) => { sampleHook = fn; }, select: (c) => { active = c; } });
  } finally { await diagnostic.close(); await rm(root, { recursive: true, force: true, maxRetries: 5, retryDelay: 50 }); }
}
const approve = (review) => ({ ...review, consent: true });
const queries = (packets) => packets.filter((p) => p[0] === 2 && p[1] === 3);

test("matrix wire decoding preserves big-endian rows and bit 31, rejects padding and follows the firmware compile guard", () => {
  for (const cols of [1, 8, 9, 16, 17, 24, 25, 32]) {
    const bytes = Math.ceil(cols / 8), r = Buffer.alloc(32); r[0] = 2; r[1] = 3; r.writeUIntBE(2 ** (cols - 1) + (cols === 1 ? 0 : 1), 2, bytes);
    assert.deepEqual(decodeMatrixState(r, 1, cols), cols === 1 ? [[0, 0]] : [[0, 0], [0, cols - 1]]);
  }
  const r = Buffer.alloc(32); r[0] = 2; r[1] = 3; r[2] = 1; r[3] = 128;
  assert.deepEqual(decodeMatrixState(r, 2, 8), [[0, 0], [1, 7]]);
  assert.throws(() => matrixDimensions(10, 16), /firmware.*limit/); assert.throws(() => matrixDimensions(1, 0), /dimensions/);
  r[31] = 1; assert.throws(() => decodeMatrixState(r, 2, 8), /bounded query/); r[31] = 0;
  assert.throws(() => decodeMatrixState(r, 2, 7), /outside/); assert.throws(() => decodeMatrixState(r.subarray(0, 31), 2, 8), /bounded query/);
  r[0] = 255; assert.throws(() => decodeMatrixState(r, 2, 8), /bounded query/);
});
test("physical unlock gates matrix reads on both sides and clears response bytes after a failed sample", async () => {
  let unlocked = false, reads = 0, response;
  const d = new VialDevice({ exchange: async (p) => {
    if (p[0] === 0xfe) return Buffer.from([unlocked ? 1 : 0, ...Array(31).fill(0)]);
    reads++; unlocked = false; response = Buffer.from(p); response[2] = 1; return response;
  } }, "a".repeat(64));
  await assert.rejects(d.matrixState(1, 2), /Physically unlock/); assert.equal(reads, 0);
  unlocked = true; await assert.rejects(d.matrixState(1, 2), /relocked/); assert.equal(reads, 1); assert.ok(response.every((n) => n === 0));
});
test("consent review performs no HID I/O; exact one-use consent starts a bounded test without storing samples", () => fixture(async ({ root, store, diagnostic, deviceId, packets }) => {
  const before = await store.snapshot("personal"), sealed = await readFile(join(root, "personal.sealed.json")), review = await diagnostic.review("personal", { deviceId });
  assert.equal(packets.length, 0); assert.equal(review.durationMs, 60000); assert.match(review.notice, /reveal typing/);
  for (const consent of [undefined, false, "true"]) await assert.rejects(diagnostic.start("personal", { ...review, consent }), /consent/);
  await assert.rejects(diagnostic.start("work", approve(review)), /consent/);
  await assert.rejects(diagnostic.start("personal", { ...approve(review), consentToken: "0".repeat(64) }), /consent/);
  const started = await diagnostic.start("personal", approve(review)); assert.equal(queries(packets).length, 0);
  await assert.rejects(diagnostic.start("personal", approve(review)), /one-use/);
  const result = await diagnostic.sample("personal", started); assert.deepEqual(result.pressed, [[0, 1]]); assert.equal(result.samplesRetained, false); assert.equal(queries(packets).length, 1);
  assert.deepEqual(await store.snapshot("personal"), before); assert.deepEqual(await readFile(join(root, "personal.sealed.json")), sealed);
  await assert.rejects(diagnostic.sample("work", started), /exact active/); await diagnostic.stop("personal", started);
  await assert.rejects(diagnostic.sample("personal", started), /exact active/); await assert.rejects(diagnostic.stop("personal", {}), /exact active/);
}));
test("Work, keyboard-only, inactive and stale readouts are rejected before a device transport is opened", () => fixture(async ({ store, diagnostic, deviceId, packets, time, select }) => {
  await store.update("work", "mode-select", (s) => { s.mode = "managed-companion"; }); select("work");
  await assert.rejects(diagnostic.review("work", { deviceId }), /prohibited/); select("personal");
  await store.update("personal", "mode-select", (s) => { s.mode = "keyboard-only"; }); await assert.rejects(diagnostic.review("personal", { deviceId }), /Keyboard-only/);
  await store.update("personal", "mode-select", (s) => { s.mode = "personal-companion"; }); select("work"); await assert.rejects(diagnostic.review("personal", { deviceId }), /selected workspace/);
  select("personal"); time.value += 120001; await assert.rejects(diagnostic.review("personal", { deviceId }), /stale/); assert.equal(packets.length, 0);
}));
test("changed protected readouts, live identity, live definition and physical lock consume consent without requesting key states", async () => {
  for (const change of ["protected", "identity", "definition", "lock"]) await fixture(async ({ store, diagnostic, deviceId, packets, f, changeDefinition, lock }) => {
    const review = await diagnostic.review("personal", { deviceId });
    if (change === "protected") await store.update("personal", "synthetic-changed-readout", (s) => { s.deviceSnapshots[0].keymap_raw[0][0][0] ^= 1; });
    if (change === "identity") f.protocol(5); if (change === "definition") changeDefinition(); if (change === "lock") lock();
    await assert.rejects(diagnostic.start("personal", approve(review)), /changed|Physically unlock/); assert.equal(queries(packets).length, 0);
    await assert.rejects(diagnostic.start("personal", approve(review)), /one-use/);
  });
});
test("capture count, polling interval, consent expiry and service restart cannot silently renew a key test", () => fixture(async ({ store, baseline, deviceId, time }) => {
  const devices = { matrixProbe: async (_, options) => { await options.beforeIo(); return options.sample ? { pressed: [] } : { unlocked: true }; } };
  const d = createMatrixDiagnostics({ store, devices, now: () => time.value, isActive: async () => true });
  try {
    const review = await d.review("personal", { deviceId }), started = await d.start("personal", approve(review));
    await d.sample("personal", started); await assert.rejects(d.sample("personal", started), /100 ms/);
    for (let i = 1; i < 240; i++) { time.value += 100; assert.equal((await d.sample("personal", started)).sequence, i + 1); }
    time.value += 100; await assert.rejects(d.sample("personal", started), /capture limit/);
    const second = await d.start("personal", approve(await d.review("personal", { deviceId }))); time.value += 60000; await assert.rejects(d.sample("personal", second), /capture limit/);
    const expired = await d.review("personal", { deviceId }); time.value += 120001; await assert.rejects(d.start("personal", approve(expired)), /expired/);
    const restarted = createMatrixDiagnostics({ store, devices, now: () => time.value, isActive: async () => true });
    await assert.rejects(restarted.sample("personal", started), /exact active/); await restarted.close();
    assert.deepEqual((await store.snapshot("personal")).deviceSnapshots, [baseline]);
  } finally { await d.close(); }
}));
test("stopping an in-flight sample aborts its exact transport and discards late data even after mode re-enable", () => fixture(async ({ store, deviceId }) => {
  let enter, release, signal;
  const entered = new Promise((r) => { enter = r; }), held = new Promise((r) => { release = r; });
  const devices = { matrixProbe: async (_, options) => { if (!options.sample) return { unlocked: true }; signal = options.signal; enter(); await held; await options.beforeIo(); return { pressed: [[0, 1]] }; } };
  const d = createMatrixDiagnostics({ store, devices, isActive: async () => true });
  try {
    const start = await d.start("personal", approve(await d.review("personal", { deviceId }))), sample = d.sample("personal", start); await entered;
    const stopped = d.stopCompartment("personal"); assert.equal(signal.aborted, true); release(); await assert.rejects(sample, /stopped/); assert.equal((await stopped).stopped, true);
    await store.update("personal", "mode-select", (s) => { s.mode = "keyboard-only"; }); await store.update("personal", "mode-select", (s) => { s.mode = "personal-companion"; });
    await assert.rejects(d.sample("personal", start), /exact active/);
  } finally { release(); await d.close(); }
}));
test("a mode change while the matrix response is pending discards that response and closes the device transport", () => fixture(async ({ store, diagnostic, deviceId, sampleHook, closes }) => {
  const started = await diagnostic.start("personal", approve(await diagnostic.review("personal", { deviceId }))), previous = closes();
  sampleHook(async () => { await store.update("personal", "mode-select", (s) => { s.mode = "keyboard-only"; }); });
  await assert.rejects(diagnostic.sample("personal", started), /Keyboard-only/); assert.equal(closes(), previous + 1); await assert.rejects(diagnostic.sample("personal", started), /exact active/);
}));
test("Vial relock verifies the exact protected identity and locked readback; it never changes configuration", () => fixture(async ({ store, devices, deviceId, packets, f }) => {
  const before = await store.snapshot("personal");
  await assert.rejects(devices.relock("work", deviceId), /Read this exact/); assert.equal(packets.length, 0);
  f.protocol(5); await assert.rejects(devices.relock("personal", deviceId), /identity changed/); assert.ok(!packets.some((p) => p[0] === 0xfe && p[1] === 8));
  f.protocol(4); assert.equal((await devices.relock("personal", deviceId)).lockedVerified, true); assert.equal(packets.filter((p) => p[0] === 0xfe && p[1] === 8).length, 1);
  assert.deepEqual(await store.snapshot("personal"), before); assert.equal(f.writes.length, 0);
  const d = new VialDevice({ exchange: async () => Buffer.from([1, ...Array(31).fill(0)]) }, deviceId); await assert.rejects(d.lock(), /not verified/);
  for (const malformed of [Buffer.alloc(2), Buffer.alloc(32, 255), Buffer.from([0, 0, 255, 2, ...Array(28).fill(255)])]) {
    const bad = new VialDevice({ exchange: async () => malformed }, deviceId); await assert.rejects(bad.lock(), /malformed/);
  }
}));
test("suite selection, keyboard-only and close revoke matrix sessions through their actual routes", () => fixture(async ({ store, devices, deviceId }) => {
  const suite = createSuite({ store, devices });
  const call = (action, body = {}) => suite.handle(`/api/suite/${action}`, { compartment: "personal", ...body });
  try {
    await call("bootstrap");
    let started = await call("devices/matrix/start", approve(await call("devices/matrix/review", { deviceId })));
    await call("compartment/select", { compartment: "work" }); await assert.rejects(call("devices/matrix/sample", started), /exact active/);
    await call("compartment/select"); started = await call("devices/matrix/start", approve(await call("devices/matrix/review", { deviceId })));
    await call("mode", { mode: "keyboard-only" }); await assert.rejects(call("devices/matrix/sample", started), /exact active/);
    await call("mode", { mode: "personal-companion" }); started = await call("devices/matrix/start", approve(await call("devices/matrix/review", { deviceId })));
    await suite.close(); await assert.rejects(call("devices/matrix/sample", started), /closed/);
  } finally { await suite.close(); }
}));
