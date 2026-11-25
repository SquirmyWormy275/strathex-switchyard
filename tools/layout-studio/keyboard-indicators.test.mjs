import assert from "node:assert/strict";
import test from "node:test";
import { randomUUID } from "node:crypto";
import { createKeyboardIndicators } from "./keyboard-indicators.mjs";

test("kernel lock reports retain per-input differences and unknown nodes without inventing a global or firmware state", async () => {
  const observer = createKeyboardIndicators({ platform: "linux", now: () => 1234, list: async () => ["input3::numlock", "input3::capslock", "input4::numlock", "input4::scrolllock", "../unrelated", "vendor::secret"],
    read: async path => { if (path.includes('scrolllock')) throw new Error("Synthetic unplug"); if (path.endsWith('max_brightness')) return "1\n"; return path.includes('input3::numlock') ? "1\n" : "0\n"; } });
  try { const result = await observer.read(); assert.equal(result.available, true); assert.equal(result.observedAt, 1234); assert.deepEqual(result.observations, [{ instance: "input3", numLock: true, capsLock: false, scrollLock: null }, { instance: "input4", numLock: false, capsLock: null, scrollLock: null }]); assert.equal(result.physicalDeviceLinked, false); assert.equal(result.liveDesktopStateVerified, false); assert.equal(result.keyboardWritten, false); } finally { await observer.close(); }
});

test("missing, malformed, unplugged and excessive kernel indicators never become an off-state guess", async () => {
  for (const list of [async () => { throw new Error("Synthetic unavailable sysfs"); }, async () => ["input1::numlock"], async () => Array.from({ length: 193 }, (_, i) => `input${i}::numlock`)]) {
    const observer = createKeyboardIndicators({ platform: "linux", list, read: async path => path.endsWith('max_brightness') ? '1\n' : '2\n' });
    try { if ((await list().catch(() => [])).length > 192) await assert.rejects(observer.read(), /supported bound/); else { const value = await observer.read(); assert.equal(value.available, false); assert.ok(value.observations.every(row => row.numLock === null)); } } finally { await observer.close(); }
  }
});

test("Windows lock snapshots use one exact supervised read-only mode and reject extra data or device attestation", async () => {
  for (const corrupted of [false, true]) {
    const calls = [], value = { schema: "switchyard-windows-keyboard-indicators/v1", available: true, numLock: true, capsLock: false, scrollLock: false, provenance: "Windows GetKeyboardState calling-thread snapshot", physicalDeviceLinked: false, physicalLightVerified: false, liveDesktopStateVerified: false, keyboardWritten: false, ...(corrupted ? { title: "must-not-cross-the-boundary" } : {}) };
    const observer = createKeyboardIndicators({ platform: "win32", executable: "/synthetic/verified/helper.exe", command: async (exe, args, options) => { calls.push({ exe, args, options }); await options.onGuardianReady({ schema: "switchyard-runtime-command/v1", id: randomUUID(), guardianPid: 12345, birth: "1", containment: "windows-job" }); return { status: "completed", exitCode: 0, stdout: JSON.stringify(value), stderr: "", inputDelivered: true, treeExitVerified: true }; }, guardianStopped: async () => true });
    try { if (corrupted) await assert.rejects(observer.read(), /scope was rejected/); else { const report = await observer.read(); assert.equal(report.observations[0].numLock, true); assert.equal(report.liveDesktopStateVerified, false); assert.equal(report.physicalLightVerified, false); } assert.equal(calls.length, 1); assert.deepEqual(calls[0].args, ["--keyboard-indicators"]); assert.equal(calls[0].options.captureStderrBytes, 0); assert.equal(calls[0].options.inputText, undefined); assert.equal(calls[0].options.env.OPENAI_API_KEY, undefined); } finally { await observer.close(); }
  }
});

test("concurrent indicator reads share one probe and shutdown fences a pending kernel read", async () => {
  let release, entered; const ready = new Promise(r => { entered = r; }), held = new Promise(r => { release = r; }); let count = 0;
  const observer = createKeyboardIndicators({ platform: "linux", list: async () => { count++; entered(); await held; return ["input1::numlock"]; }, read: async () => "1\n" });
  const first = observer.read(), second = observer.read(); assert.equal(first, second); await ready; const rejection = assert.rejects(first, /stopped/); const stopping = observer.close(); release(); await rejection; assert.equal((await stopping).stopped, true); assert.equal(count, 1); await assert.rejects(observer.read(), /stopped/);
});
