/**
 * Hardware-independent product simulator for the exact B122 Raw-HID contract.
 *
 * This utility exercises the same 32-byte framing and replay state machines as
 * the installed host. It never discovers a HID device, opens a network socket,
 * or executes a B122 assignment. Its receipt is therefore useful pre-hardware
 * evidence without being mislabeled as physical-device acceptance.
 */
import { createHash } from "node:crypto";
import { fileURLToPath } from "node:url";
import { resolve } from "node:path";

import {
  assignmentFor,
  assignments,
  controls,
  protocolVersion,
  type Modifier
} from "../../../packages/protocol/src/b122.ts";
import {
  decodeRawHidFrame,
  encodeRawHidFrame,
  mapFingerprint,
  type DeviceStatus
} from "../../../packages/protocol/src/raw-hid.ts";
import { B122FirmwareProtocolSimulator, RawHidHostProtocol } from "./raw-hid-protocol.ts";

const modifiers = ["normal", "shift", "alt", "shift_alt", "ctrl", "ctrl_shift", "ctrl_alt", "ctrl_shift_alt"] as const satisfies readonly Modifier[];
const statuses = ["booting", "ready", "busy", "degraded"] as const satisfies readonly DeviceStatus[];

export interface B122RawHidSimulationReceipt {
  readonly schema: "sxsy-b122.raw-hid-simulation";
  readonly version: 1;
  readonly status: "passed";
  readonly protocolVersion: number;
  readonly mapFingerprint: string;
  readonly traceSha256: string;
  readonly chordsExercised: number;
  readonly assignedChords: number;
  readonly unassignedChords: number;
  readonly statusesExercised: readonly DeviceStatus[];
  readonly duplicateAcknowledgedWithoutRedispatch: true;
  readonly staleEpochRejected: true;
  readonly corruptFrameRejected: true;
  readonly hardwareAccessed: false;
  readonly networkAccessed: false;
}

/** Runs a deterministic, complete logical transport scenario in-process. */
export function runB122RawHidSimulation(): B122RawHidSimulationReceipt {
  const trace = createHash("sha256");
  const host = new RawHidHostProtocol();
  const firmware = new B122FirmwareProtocolSimulator({ connectionEpoch: 1, bootNonce: 0xb122_0001 });
  const deviceId = "b122".padEnd(64, "0");

  exchangeHandshake(host, firmware, deviceId, trace);
  let assignedChords = 0;
  let unassignedChords = 0;
  for (const control of controls) {
    for (const modifier of modifiers) {
      const expectedAssigned = assignmentFor(control, modifier) !== undefined;
      const packet = firmware.signal(control, modifier);
      trace.update(packet);
      const result = host.receive(deviceId, packet);
      if (result.outcome !== "signal_accepted" || result.signal?.control !== control || result.signal.modifier !== modifier || result.signal.assigned !== expectedAssigned || !result.response) {
        throw new Error(`Raw-HID simulation failed the exact ${control}:${modifier} signal contract.`);
      }
      const response = decodeRawHidFrame(result.response);
      if (response?.type !== "ack" || response.status !== "accepted" || response.acknowledgedCounter !== result.acknowledgedCounter) {
        throw new Error(`Raw-HID simulation received an invalid acknowledgement for ${control}:${modifier}.`);
      }
      trace.update(result.response);
      firmware.receive(result.response);
      if (expectedAssigned) assignedChords += 1;
      else unassignedChords += 1;
    }
  }
  if (assignedChords !== assignments.length || assignments.length !== 65) throw new Error("Raw-HID simulation did not cover the exact 65-assignment manifest.");

  for (const status of statuses) {
    const packet = firmware.status(status);
    trace.update(packet);
    const result = host.receive(deviceId, packet);
    if (result.outcome !== "status_accepted" || result.status !== status || !result.response) throw new Error(`Raw-HID simulation failed the ${status} status contract.`);
    trace.update(result.response);
    firmware.receive(result.response);
  }
  if (firmware.pendingCounters().length !== 0) throw new Error("Raw-HID simulation left acknowledged frames pending.");

  const duplicateAcknowledgedWithoutRedispatch = exerciseDuplicate(trace);
  const staleEpochRejected = exerciseReconnect(trace);
  const corruptFrameRejected = exerciseCorruption(trace);
  if (!duplicateAcknowledgedWithoutRedispatch || !staleEpochRejected || !corruptFrameRejected) throw new Error("Raw-HID simulation did not complete every negative-path assertion.");

  return {
    schema: "sxsy-b122.raw-hid-simulation",
    version: 1,
    status: "passed",
    protocolVersion,
    mapFingerprint: Buffer.from(mapFingerprint).toString("hex"),
    traceSha256: trace.digest("hex"),
    chordsExercised: controls.length * modifiers.length,
    assignedChords,
    unassignedChords,
    statusesExercised: [...statuses],
    duplicateAcknowledgedWithoutRedispatch,
    staleEpochRejected,
    corruptFrameRejected,
    hardwareAccessed: false,
    networkAccessed: false
  };
}

function exchangeHandshake(host: RawHidHostProtocol, firmware: B122FirmwareProtocolSimulator, deviceId: string, trace: ReturnType<typeof createHash>): void {
  const hello = firmware.hello();
  trace.update(hello);
  const result = host.receive(deviceId, hello);
  if (result.outcome !== "handshake_accepted" || !result.response || decodeRawHidFrame(result.response)?.type !== "hello_ack") throw new Error("Raw-HID simulation handshake failed.");
  trace.update(result.response);
  firmware.receive(result.response);
  if (!firmware.isHandshakeComplete()) throw new Error("Raw-HID simulation firmware did not accept the exact host handshake.");
}

function exerciseDuplicate(trace: ReturnType<typeof createHash>): true {
  const host = new RawHidHostProtocol();
  const firmware = new B122FirmwareProtocolSimulator({ connectionEpoch: 7, bootNonce: 0xb122_0002 });
  const deviceId = "duplicate".padEnd(64, "0");
  exchangeHandshake(host, firmware, deviceId, trace);
  const packet = firmware.signal("RUN", "normal");
  trace.update(packet);
  const first = host.receive(deviceId, packet);
  if (first.outcome !== "signal_accepted" || !first.acknowledgedCounter) throw new Error("Raw-HID simulation could not establish an accepted signal for retry testing.");
  const retried = firmware.retry(first.acknowledgedCounter);
  const duplicate = host.receive(deviceId, retried);
  if (duplicate.outcome !== "duplicate_acknowledged" || duplicate.signal !== undefined || !duplicate.response) throw new Error("Raw-HID simulation redispatched a duplicate signal.");
  trace.update(duplicate.response);
  firmware.receive(duplicate.response);
  return true;
}

function exerciseReconnect(trace: ReturnType<typeof createHash>): true {
  const host = new RawHidHostProtocol();
  const firmware = new B122FirmwareProtocolSimulator({ connectionEpoch: 21, bootNonce: 0xb122_0003 });
  const deviceId = "reconnect".padEnd(64, "0");
  exchangeHandshake(host, firmware, deviceId, trace);
  const delayed = firmware.signal("VSCODE", "normal");
  firmware.reconnect(0xb122_0004);
  exchangeHandshake(host, firmware, deviceId, trace);
  const stale = host.receive(deviceId, delayed);
  if (stale.outcome !== "rejected" || stale.reason !== "stale_epoch" || decodeRawHidFrame(stale.response ?? new Uint8Array())?.type !== "nack") {
    throw new Error("Raw-HID simulation accepted traffic from a stale connection epoch.");
  }
  if (stale.response) trace.update(stale.response);
  return true;
}

function exerciseCorruption(trace: ReturnType<typeof createHash>): true {
  const host = new RawHidHostProtocol();
  const corrupt = encodeRawHidFrame({ type: "hello", connectionEpoch: 1, counter: 1, bootNonce: 0xb122_0005, mapFingerprint });
  corrupt[9] ^= 0x80;
  trace.update(corrupt);
  const result = host.receive("corrupt".padEnd(64, "0"), corrupt);
  if (result.outcome !== "rejected" || result.reason !== "malformed_frame" || result.response !== undefined) throw new Error("Raw-HID simulation accepted a corrupt frame.");
  return true;
}

function isMainModule(): boolean {
  const entry = process.argv[1];
  return typeof entry === "string" && resolve(entry) === resolve(fileURLToPath(import.meta.url));
}

if (isMainModule()) {
  try {
    if (process.argv.length !== 3 || process.argv[2] !== "--self-test") throw new Error("The Raw-HID simulator accepts exactly --self-test.");
    process.stdout.write(`${JSON.stringify(runB122RawHidSimulation())}\n`);
  } catch (error) {
    process.stderr.write(`${error instanceof Error ? error.message : "Raw-HID simulation failed."}\n`);
    process.exitCode = 64;
  }
}
