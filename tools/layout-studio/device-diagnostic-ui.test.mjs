import test from "node:test";
import assert from "node:assert/strict";
import { browserSurfaceFixture, until } from "./test-support/browser-ui.mjs";
import { vialFixture } from "./test-support/vial-fixture.mjs";
import { createDeviceService } from "./devices.mjs";
async function fixture(fn) {
  const device = vialFixture(), packets = []; let service, hook, locked = false, failLock = false;
  const transportFactory = () => { const original = device.options.transportFactory(); return { ...original, async exchange(bytes) {
    packets.push([...bytes]);
    if (bytes[0] === 0xfe && bytes[1] === 8) { if (failLock) throw Error("Synthetic lock failure"); locked = true; return Buffer.from(bytes); }
    if (bytes[0] === 0xfe && bytes[1] === 5 && locked) { const r = Buffer.alloc(32, 255); r[0] = r[1] = 0; return r; }
    if (bytes[0] === 2 && bytes[1] === 3) { const r = Buffer.alloc(32); r[0] = 2; r[1] = 3; r[2] = 2; await hook?.(); return r; }
    return original.exchange(bytes);
  } }; };
  const devices = Object.fromEntries(["read", "matrixProbe", "relock"].map(name => [name, (...args) => service[name](...args)])); devices.close = async () => {};
  return browserSurfaceFixture(async c => {
    service = createDeviceService({ ...device.options, store: c.store, transportFactory }); const snapshot = await service.read("personal", device.deviceId);
    const { mountDeviceDiagnostic } = await import("./device-diagnostic-ui.mjs"), notices = [], ui = mountDeviceDiagnostic({ notify: text => notices.push(text) }); ui.update(snapshot); await c.refresh(); packets.length = 0;
    await fn({ ...c, device, snapshot, packets, notices, ui, lock: () => { locked = true; }, failLock: () => { failLock = true; }, sampleHook: fn => { hook = fn; } });
  }, { devices });
}
const samples = c => c.packets.filter(p => p[0] === 2 && p[1] === 3);
async function review(c) { c.click("review-key-test"); await until(() => c.$("key-test-review-dialog").open); }
async function start(c) { await review(c); c.$("key-test-consent").checked = true; c.$("key-test-consent").dispatchEvent(new Event("change")); c.click("start-key-test"); await until(() => !c.$("sample-key-test").disabled); }

test("matrix review requires consent and manual samples, saves no positions, and stops separately from firmware relock", () => fixture(async c => {
  const before = await c.store.snapshot("personal"); await review(c); assert.equal(c.packets.length, 0); assert.equal(c.$("start-key-test").disabled, true);
  c.click("cancel-key-test"); assert.equal(c.packets.length, 0); await start(c); assert.equal(samples(c).length, 0);
  c.click("sample-key-test"); await until(() => c.$("key-test-result").children.length === 1); assert.match(c.$("key-test-result").children[0].textContent, /Row 0, column 1/); assert.equal(samples(c).length, 1); assert.deepEqual(await c.store.snapshot("personal"), before);
  c.click("stop-key-test"); await until(() => /Test stopped/.test(c.$("key-test-status").textContent)); assert.equal(c.$("key-test-result").children.length, 0); assert.ok(!c.packets.some(p => p[0] === 0xfe && p[1] === 8));
  c.click("relock-keyboard"); await until(() => /lock verified/.test(c.$("key-test-status").textContent)); assert.equal(c.packets.filter(p => p[0] === 0xfe && p[1] === 8).length, 1); assert.equal(c.device.writes.length, 0);
}));

test("a locked device refuses startup without a sample and a failed relock is visible", () => fixture(async c => {
  c.lock(); await review(c); c.$("key-test-consent").checked = true; c.$("key-test-consent").dispatchEvent(new Event("change")); c.click("start-key-test"); await until(() => /Physically unlock/.test(c.$("key-test-status").textContent)); assert.equal(samples(c).length, 0); assert.equal(c.$("sample-key-test").disabled, true);
  c.failLock(); c.click("relock-keyboard"); await until(() => /Synthetic lock failure/.test(c.$("key-test-status").textContent)); assert.ok(c.notices.some(n => /lock failure/.test(n)));
}));

test("workspace changes discard an in-flight matrix sample and disable capture", () => fixture(async c => {
  let release, entered = false; const waiting = new Promise(resolve => { release = resolve; }); c.sampleHook(async () => { entered = true; await waiting; }); await start(c); c.click("sample-key-test"); await until(() => entered);
  c.document.dispatchEvent(new Event("switchyard-workspace-changing")); await c.store.initialize("work", "work"); c.document.dispatchEvent(new CustomEvent("switchyard-compartment-state", { detail: await c.store.snapshot("work") })); release();
  await until(() => c.$("device-key-test").ariaBusy === "false"); assert.equal(c.$("key-test-result").children.length, 0); assert.equal(c.$("review-key-test").disabled, true);
}));

test("keyboard-only mode revokes the view and policy-disabled recording cannot review a key test", () => fixture(async c => {
  await start(c); await c.suite.handle("/api/suite/mode", { compartment: "personal", mode: "keyboard-only" }); await c.refresh(); assert.equal(c.$("sample-key-test").disabled, true); assert.equal(c.$("key-test-result").children.length, 0); assert.equal(c.$("review-key-test").disabled, true);
}));
