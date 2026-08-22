import assert from "node:assert/strict";
import test from "node:test";
import { assignments, controls, decodeSignal, encodeSignal, protocolVersion, type B122Signal, assignmentFor } from "../src/b122.ts";

test("the protocol exposes exactly 22 logical controls and 65 settled chord assignments", () => {
  assert.equal(controls.length, 22);
  assert.equal(assignments.length, 65);
  assert.equal(new Set(assignments.map((item) => `${item.control}:${item.modifier}`)).size, 65);
});

test("unassigned Ctrl combinations stay unassigned", () => {
  assert.equal(assignmentFor("REANCHOR", "ctrl"), undefined);
  assert.equal(assignmentFor("PROOF", "ctrl_alt"), undefined);
  assert.equal(assignmentFor("COMMIT", "ctrl_shift"), undefined);
});

test("high-consequence controls are disabled pending gates", () => {
  for (const [control, modifier] of [
    ["COUNCIL", "shift"], ["COMMIT", "alt"], ["COMMIT", "shift_alt"],
    ["COMPOUND", "shift_alt"], ["PIPELINE", "ctrl_shift_alt"],
    ["SHIELD", "ctrl_shift_alt"], ["SANDBOX", "alt"], ["SANDBOX", "shift_alt"],
    ["SANDBOX", "ctrl_shift_alt"]
  ] as const) {
    assert.equal(assignmentFor(control, modifier)?.capability, "disabled_pending_gates");
  }
});

test("raw HID signals round-trip and reject corruption", () => {
  const signal: B122Signal = { version: protocolVersion, control: "PROOF", modifier: "shift", sequence: 513 };
  const packet = encodeSignal(signal);
  assert.deepEqual(decodeSignal(packet), signal);
  packet[6] ^= 1;
  assert.equal(decodeSignal(packet), undefined);
});

test("raw HID reserved bytes must remain zero", () => {
  const signal: B122Signal = { version: protocolVersion, control: "RUN", modifier: "normal", sequence: 9 };
  const packet = new Uint8Array(8);
  packet.set(encodeSignal(signal));
  assert.deepEqual(decodeSignal(packet), signal);
  packet[7] = 1;
  assert.equal(decodeSignal(packet), undefined);
});
