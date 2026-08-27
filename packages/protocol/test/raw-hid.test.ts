import assert from "node:assert/strict";
import test from "node:test";
import {
  RAW_HID_FRAME_SIZE,
  crc32,
  decodeRawHidFrame,
  encodeRawHidFrame,
  mapFingerprint,
  type RawHidFrame,
} from "../src/raw-hid.ts";

const common = { connectionEpoch: 17, counter: 42, bootNonce: 0x1020_3040 } as const;

const frames: readonly RawHidFrame[] = [
  { type: "hello", ...common, mapFingerprint },
  { type: "hello_ack", ...common, mapFingerprint },
  { type: "signal", ...common, control: "PROOF", modifier: "shift", assigned: true },
  { type: "ack", ...common, acknowledgedCounter: 41, status: "accepted" },
  { type: "ack", ...common, acknowledgedCounter: 41, status: "duplicate" },
  { type: "nack", ...common, acknowledgedCounter: 41, reason: "stale_counter" },
  { type: "status", ...common, status: "ready", pendingSignals: 2, lastAcknowledgedCounter: 40 },
];

test("all protocol messages round-trip as exact 32-byte QMK Raw-HID reports", () => {
  for (const frame of frames) {
    const encoded = encodeRawHidFrame(frame);
    assert.equal(encoded.byteLength, RAW_HID_FRAME_SIZE);
    assert.deepEqual(decodeRawHidFrame(encoded), frame);
  }
});

test("framing rejects corruption, reserved-byte abuse, wrong size, and unsupported versions", () => {
  const encoded = encodeRawHidFrame(frames[2]);
  encoded[22] ^= 1;
  assert.equal(decodeRawHidFrame(encoded), undefined);

  const reserved = encodeRawHidFrame(frames[2]);
  reserved[6] = 1;
  // Repairing CRC must not make non-zero reserved bytes valid.
  const repaired = encodeRawHidFrame(frames[2]);
  repaired.set(reserved.subarray(0, 28), 0);
  new DataView(repaired.buffer, repaired.byteOffset, repaired.byteLength).setUint32(28, crc32(repaired.subarray(0, 28)), true);
  assert.equal(decodeRawHidFrame(repaired), undefined);

  assert.equal(decodeRawHidFrame(new Uint8Array(31)), undefined);
  const version = encodeRawHidFrame(frames[2]);
  version[2] = 99;
  assert.equal(decodeRawHidFrame(version), undefined);
});

test("the handshake carries the canonical manifest fingerprint", () => {
  assert.equal(mapFingerprint.byteLength, 8);
  const hello = decodeRawHidFrame(encodeRawHidFrame(frames[0]));
  assert.equal(hello?.type, "hello");
  if (hello?.type === "hello") assert.deepEqual(hello.mapFingerprint, mapFingerprint);
});
