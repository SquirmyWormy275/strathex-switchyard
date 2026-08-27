import {
  assignmentFor,
  controlFromId,
  controlId,
  manifestSha256,
  modifierFromMask,
  modifierMask,
  protocolVersion,
  type Control,
  type Modifier,
} from "./b122.ts";

export const RAW_HID_FRAME_SIZE = 32 as const;
export const RAW_HID_MAGIC = [0xb1, 0x22] as const;
export const mapFingerprint = Uint8Array.from(manifestSha256.slice(0, 16).match(/../g)?.map((value) => Number.parseInt(value, 16)) ?? []);

export type AckStatus = "accepted" | "duplicate";
export type NackReason = "handshake_required" | "checksum_mismatch" | "stale_epoch" | "stale_counter" | "counter_gap" | "invalid_signal";
export type DeviceStatus = "booting" | "ready" | "busy" | "degraded";

interface FrameBase { readonly connectionEpoch: number; readonly counter: number; readonly bootNonce: number; }
export type RawHidFrame =
  | (FrameBase & { readonly type: "hello"; readonly mapFingerprint: Uint8Array })
  | (FrameBase & { readonly type: "hello_ack"; readonly mapFingerprint: Uint8Array })
  | (FrameBase & { readonly type: "signal"; readonly control: Control; readonly modifier: Modifier; readonly assigned: boolean })
  | (FrameBase & { readonly type: "ack"; readonly acknowledgedCounter: number; readonly status: AckStatus })
  | (FrameBase & { readonly type: "nack"; readonly acknowledgedCounter: number; readonly reason: NackReason })
  | (FrameBase & { readonly type: "status"; readonly status: DeviceStatus; readonly pendingSignals: number; readonly lastAcknowledgedCounter: number });

const typeCode = { hello: 1, hello_ack: 2, signal: 3, ack: 4, nack: 5, status: 6 } as const;
const codeType = new Map<number, RawHidFrame["type"]>(Object.entries(typeCode).map(([key, value]) => [value, key as RawHidFrame["type"]]));
const ackCode = { accepted: 0, duplicate: 1 } as const;
const codeAck = ["accepted", "duplicate"] as const;
const nackCode = { handshake_required: 1, checksum_mismatch: 2, stale_epoch: 3, stale_counter: 4, counter_gap: 5, invalid_signal: 6 } as const;
const codeNack = new Map<number, NackReason>(Object.entries(nackCode).map(([key, value]) => [value, key as NackReason]));
const statusCode = { booting: 0, ready: 1, busy: 2, degraded: 3 } as const;
const codeStatus = ["booting", "ready", "busy", "degraded"] as const;

export function encodeRawHidFrame(frame: RawHidFrame): Uint8Array {
  assertUint32(frame.connectionEpoch, "connectionEpoch");
  assertUint32(frame.counter, "counter");
  assertUint32(frame.bootNonce, "bootNonce");
  const packet = new Uint8Array(RAW_HID_FRAME_SIZE);
  packet[0] = RAW_HID_MAGIC[0]; packet[1] = RAW_HID_MAGIC[1]; packet[2] = protocolVersion; packet[3] = typeCode[frame.type];
  packet[4] = 0; packet[5] = 12;
  writeU32(packet, 8, frame.connectionEpoch); writeU32(packet, 12, frame.counter); writeU32(packet, 16, frame.bootNonce);
  switch (frame.type) {
    case "hello": case "hello_ack":
      if (frame.mapFingerprint.byteLength !== 8) throw new RangeError("mapFingerprint must be exactly 8 bytes");
      packet.set(frame.mapFingerprint, 20);
      break;
    case "signal":
      packet[20] = controlId(frame.control); packet[21] = modifierMask(frame.modifier); packet[22] = frame.assigned ? 1 : 0;
      break;
    case "ack":
      writeU32(packet, 20, frame.acknowledgedCounter); packet[24] = ackCode[frame.status];
      break;
    case "nack":
      writeU32(packet, 20, frame.acknowledgedCounter); packet[24] = nackCode[frame.reason];
      break;
    case "status":
      packet[20] = statusCode[frame.status]; packet[21] = frame.pendingSignals;
      writeU32(packet, 24, frame.lastAcknowledgedCounter);
      break;
  }
  writeU32(packet, 28, crc32(packet.subarray(0, 28)));
  return packet;
}

export function decodeRawHidFrame(packet: Uint8Array): RawHidFrame | undefined {
  if (packet.byteLength !== RAW_HID_FRAME_SIZE || packet[0] !== RAW_HID_MAGIC[0] || packet[1] !== RAW_HID_MAGIC[1] || packet[2] !== protocolVersion || packet[4] !== 0 || packet[5] !== 12 || packet[6] !== 0 || packet[7] !== 0) return undefined;
  if (readU32(packet, 28) !== crc32(packet.subarray(0, 28))) return undefined;
  const type = codeType.get(packet[3]);
  if (!type) return undefined;
  const base = { connectionEpoch: readU32(packet, 8), counter: readU32(packet, 12), bootNonce: readU32(packet, 16) };
  switch (type) {
    case "hello": case "hello_ack":
      return { type, ...base, mapFingerprint: packet.slice(20, 28) };
    case "signal": {
      if (packet[22] > 1 || !allZero(packet, 23, 28)) return undefined;
      const control = controlFromId(packet[20]); const modifier = modifierFromMask(packet[21]);
      if (!control || !modifier) return undefined;
      return { type, ...base, control, modifier, assigned: packet[22] === 1 };
    }
    case "ack": {
      if (!allZero(packet, 25, 28)) return undefined;
      const status = codeAck[packet[24]];
      return status ? { type, ...base, acknowledgedCounter: readU32(packet, 20), status } : undefined;
    }
    case "nack": {
      if (!allZero(packet, 25, 28)) return undefined;
      const reason = codeNack.get(packet[24]);
      return reason ? { type, ...base, acknowledgedCounter: readU32(packet, 20), reason } : undefined;
    }
    case "status": {
      if (!allZero(packet, 22, 24)) return undefined;
      const status = codeStatus[packet[20]];
      return status ? { type, ...base, status, pendingSignals: packet[21], lastAcknowledgedCounter: readU32(packet, 24) } : undefined;
    }
  }
}

export function signalAssigned(control: Control, modifier: Modifier): boolean {
  return assignmentFor(control, modifier) !== undefined;
}

export function crc32(bytes: Uint8Array): number {
  let crc = 0xffff_ffff;
  for (const byte of bytes) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit += 1) crc = (crc >>> 1) ^ ((crc & 1) ? 0xedb8_8320 : 0);
  }
  return (crc ^ 0xffff_ffff) >>> 0;
}

function readU32(bytes: Uint8Array, offset: number): number {
  return (bytes[offset] | (bytes[offset + 1] << 8) | (bytes[offset + 2] << 16) | (bytes[offset + 3] << 24)) >>> 0;
}
function writeU32(bytes: Uint8Array, offset: number, value: number): void {
  new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength).setUint32(offset, value, true);
}
function allZero(bytes: Uint8Array, start: number, end: number): boolean {
  for (let index = start; index < end; index += 1) if (bytes[index] !== 0) return false;
  return true;
}
function assertUint32(value: number, name: string): void {
  if (!Number.isInteger(value) || value < 0 || value > 0xffff_ffff) throw new RangeError(`${name} must be a uint32`);
}
