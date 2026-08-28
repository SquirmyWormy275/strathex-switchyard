import assert from "node:assert/strict";
import test from "node:test";

import { B122FirmwareProtocolSimulator } from "../../windows-companion/src/raw-hid-protocol.ts";
import { LinuxHidrawTransport, type LinuxHidrawIdentity, type LinuxHidrawPort } from "../src/linux-hidraw.ts";

const identity: LinuxHidrawIdentity = { devicePath: "/dev/hidraw7", vendorId: 0xb122, productId: 1, reportDescriptorSha256: "a".repeat(64), serialNumber: "B122-TEST" };

test("Linux hidraw transport performs the canonical handshake and durably accepts a signal before ACK", async () => {
  let onFrame!: (frame: Uint8Array) => Promise<void>; const writes: Uint8Array[] = []; const accepted: unknown[] = [];
  const openedIdentity = { dev: 1, ino: 2, rdev: 3 };
  const port: LinuxHidrawPort = { async inspect() { return { canonicalDevicePath: identity.devicePath, deviceId: "b".repeat(64), openedIdentity }; }, async open(_path, expected, receive) { assert.deepEqual(expected, openedIdentity); onFrame = receive; return { async write(frame) { writes.push(frame.slice()); }, async close() {} }; } };
  const transport = new LinuxHidrawTransport(identity, { async accept(deviceId, signal) { accepted.push({ deviceId, signal }); return { status: "accepted", signalId: "signal" }; } }, port);
  const firmware = new B122FirmwareProtocolSimulator({ bootNonce: 7, connectionEpoch: 1 });
  await transport.start(); await onFrame(firmware.hello()); firmware.receive(writes.shift()!);
  await onFrame(firmware.signal("PROOF", "normal")); firmware.receive(writes.shift()!);
  assert.equal(firmware.pendingCounters().length, 0); assert.equal(accepted.length, 1);
  await transport.stop();
});

test("Linux hidraw identity rejects broad device paths and malformed descriptor pins", () => {
  assert.throws(() => new LinuxHidrawTransport({ ...identity, devicePath: "/dev/input/event0" }, { async accept() { throw new Error(); } }), /identity/i);
  assert.throws(() => new LinuxHidrawTransport({ ...identity, reportDescriptorSha256: "bad" }, { async accept() { throw new Error(); } }), /identity/i);
});
