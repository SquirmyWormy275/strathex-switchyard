import { createHash } from "node:crypto";
import { spawn, type SpawnOptions } from "node:child_process";
import { readFile, realpath } from "node:fs/promises";
import { relative, resolve, isAbsolute } from "node:path";
import {
  decodeRawHidFrame,
  encodeRawHidFrame,
  mapFingerprint,
  signalAssigned,
  type DeviceStatus,
  type NackReason,
  type RawHidFrame,
} from "../../../packages/protocol/src/raw-hid.ts";
import type { Control, Modifier } from "../../../packages/protocol/src/b122.ts";

export interface HostProtocolResult {
  readonly outcome: "handshake_accepted" | "signal_pending" | "signal_accepted" | "status_accepted" | "duplicate_acknowledged" | "rejected";
  readonly response?: Uint8Array;
  readonly signal?: Extract<RawHidFrame, { type: "signal" }>;
  readonly status?: DeviceStatus;
  readonly acknowledgedCounter?: number;
  readonly reason?: NackReason | "malformed_frame";
}

export interface PreparedHostProtocolResult extends HostProtocolResult {
  /** Commits replay state and creates the ACK only after durable signal acceptance. */
  readonly commit?: () => HostProtocolResult;
}

interface HostDeviceSession {
  readonly connectionEpoch: number;
  readonly bootNonce: number;
  lastDeviceCounter: number;
  hostCounter: number;
  lastDevicePacket: Uint8Array;
}

/**
 * Host-side framing and replay boundary. This class only validates and emits a
 * canonical signal; it has no filesystem, process, Git, network, or provider
 * dependency and cannot execute a B122 assignment.
 */
export class RawHidHostProtocol {
  private readonly sessions = new Map<string, HostDeviceSession>();

  receive(deviceId: string, packet: Uint8Array): HostProtocolResult {
    const prepared = this.prepare(deviceId, packet);
    return prepared.commit ? prepared.commit() : prepared;
  }

  prepare(deviceId: string, packet: Uint8Array): PreparedHostProtocolResult {
    const frame = decodeRawHidFrame(packet);
    if (!frame) return { outcome: "rejected", reason: "malformed_frame" };
    if (frame.type === "hello") return this.handshake(deviceId, frame, packet);

    const session = this.sessions.get(deviceId);
    if (!session) return this.reject(frame, undefined, "handshake_required");
    if (frame.connectionEpoch !== session.connectionEpoch || frame.bootNonce !== session.bootNonce) return this.reject(frame, session, "stale_epoch");
    if (frame.counter === session.lastDeviceCounter) {
      if (!equalBytes(packet, session.lastDevicePacket)) return this.reject(frame, session, "stale_counter");
      return {
        outcome: "duplicate_acknowledged",
        acknowledgedCounter: frame.counter,
        response: this.response(session, { type: "ack", acknowledgedCounter: frame.counter, status: "duplicate" }),
      };
    }
    if (frame.counter < session.lastDeviceCounter) return this.reject(frame, session, "stale_counter");
    if (frame.counter !== session.lastDeviceCounter + 1) return this.reject(frame, session, "counter_gap");
    if (frame.type !== "signal" && frame.type !== "status") return this.reject(frame, session, "invalid_signal");
    if (frame.type === "signal" && frame.assigned !== signalAssigned(frame.control, frame.modifier)) return this.reject(frame, session, "invalid_signal");
    if (frame.type === "status") {
      session.lastDeviceCounter = frame.counter;
      session.lastDevicePacket = packet.slice();
      const response = this.response(session, { type: "ack", acknowledgedCounter: frame.counter, status: "accepted" });
      return { outcome: "status_accepted", status: frame.status, acknowledgedCounter: frame.counter, response };
    }
    const expectedPrevious = session.lastDeviceCounter;
    return {
      outcome: "signal_pending",
      signal: frame,
      acknowledgedCounter: frame.counter,
      commit: () => {
        const current = this.sessions.get(deviceId);
        if (current !== session || current.lastDeviceCounter !== expectedPrevious) return { outcome: "rejected", reason: "stale_counter", acknowledgedCounter: frame.counter };
        current.lastDeviceCounter = frame.counter;
        current.lastDevicePacket = packet.slice();
        return {
          outcome: "signal_accepted",
          signal: frame,
          acknowledgedCounter: frame.counter,
          response: this.response(current, { type: "ack", acknowledgedCounter: frame.counter, status: "accepted" }),
        };
      },
    };
  }

  disconnect(deviceId: string): void {
    // Preserve the last epoch so delayed traffic cannot become a new session.
    const session = this.sessions.get(deviceId);
    if (session) session.lastDeviceCounter = 0xffff_ffff;
  }

  private handshake(deviceId: string, frame: Extract<RawHidFrame, { type: "hello" }>, packet: Uint8Array): HostProtocolResult {
    if (!equalBytes(frame.mapFingerprint, mapFingerprint)) return this.reject(frame, this.sessions.get(deviceId), "checksum_mismatch");
    const current = this.sessions.get(deviceId);
    if (current && (frame.connectionEpoch < current.connectionEpoch || (frame.connectionEpoch === current.connectionEpoch && frame.bootNonce !== current.bootNonce))) {
      return this.reject(frame, current, "stale_epoch");
    }
    if (current && frame.connectionEpoch === current.connectionEpoch && frame.bootNonce === current.bootNonce) {
      if (!equalBytes(packet, current.lastDevicePacket)) return this.reject(frame, current, "stale_counter");
      return {
        outcome: "handshake_accepted",
        acknowledgedCounter: frame.counter,
        response: this.response(current, { type: "hello_ack", mapFingerprint }),
      };
    }
    const session: HostDeviceSession = { connectionEpoch: frame.connectionEpoch, bootNonce: frame.bootNonce, lastDeviceCounter: frame.counter, hostCounter: 0, lastDevicePacket: packet.slice() };
    this.sessions.set(deviceId, session);
    return {
      outcome: "handshake_accepted",
      acknowledgedCounter: frame.counter,
      response: this.response(session, { type: "hello_ack", mapFingerprint }),
    };
  }

  private reject(frame: RawHidFrame, session: HostDeviceSession | undefined, reason: NackReason): HostProtocolResult {
    const responseSession = session ?? { connectionEpoch: frame.connectionEpoch, bootNonce: frame.bootNonce, lastDeviceCounter: 0, hostCounter: 0, lastDevicePacket: new Uint8Array() };
    return {
      outcome: "rejected",
      reason,
      acknowledgedCounter: frame.counter,
      response: this.response(responseSession, { type: "nack", acknowledgedCounter: frame.counter, reason }),
    };
  }

  private response(
    session: HostDeviceSession,
    details: { readonly type: "hello_ack"; readonly mapFingerprint: Uint8Array }
      | { readonly type: "ack"; readonly acknowledgedCounter: number; readonly status: "accepted" | "duplicate" }
      | { readonly type: "nack"; readonly acknowledgedCounter: number; readonly reason: NackReason },
  ): Uint8Array {
    session.hostCounter += 1;
    return encodeRawHidFrame({ ...details, connectionEpoch: session.connectionEpoch, counter: session.hostCounter, bootNonce: session.bootNonce });
  }
}

export interface FirmwareSimulatorOptions { readonly bootNonce: number; readonly connectionEpoch: number; }

/** Deterministic no-hardware model of the signal-only QMK state machine. */
export class B122FirmwareProtocolSimulator {
  private bootNonce: number;
  private connectionEpoch: number;
  private counter = 0;
  private lastAcknowledgedCounter = 0;
  private handshakeComplete = false;
  private readonly pending = new Map<number, Uint8Array>();

  constructor(options: FirmwareSimulatorOptions) {
    this.bootNonce = options.bootNonce;
    this.connectionEpoch = options.connectionEpoch;
  }

  hello(): Uint8Array {
    return this.queue({ type: "hello", mapFingerprint });
  }

  signal(control: Control, modifier: Modifier): Uint8Array {
    return this.queue({ type: "signal", control, modifier, assigned: signalAssigned(control, modifier) });
  }

  status(status: DeviceStatus): Uint8Array {
    const pendingSignals = [...this.pending.values()].filter((packet) => decodeRawHidFrame(packet)?.type === "signal").length;
    return this.queue({ type: "status", status, pendingSignals, lastAcknowledgedCounter: this.lastAcknowledgedCounter });
  }

  retry(counter: number): Uint8Array {
    const packet = this.pending.get(counter);
    if (!packet) throw new Error(`No pending Raw-HID frame ${counter}.`);
    return packet.slice();
  }

  receive(packet: Uint8Array): void {
    const frame = decodeRawHidFrame(packet);
    if (!frame || frame.connectionEpoch !== this.connectionEpoch || frame.bootNonce !== this.bootNonce) return;
    if (frame.type === "hello_ack" && equalBytes(frame.mapFingerprint, mapFingerprint)) {
      this.handshakeComplete = true;
      for (const [counter, pending] of this.pending) if (decodeRawHidFrame(pending)?.type === "hello") this.pending.delete(counter);
      return;
    }
    if (frame.type === "ack") {
      this.lastAcknowledgedCounter = Math.max(this.lastAcknowledgedCounter, frame.acknowledgedCounter);
      this.pending.delete(frame.acknowledgedCounter);
    }
  }

  reconnect(newBootNonce: number): void {
    this.connectionEpoch += 1;
    this.bootNonce = newBootNonce;
    this.counter = 0;
    this.lastAcknowledgedCounter = 0;
    this.handshakeComplete = false;
    this.pending.clear();
  }

  pendingCounters(): readonly number[] { return [...this.pending.keys()].sort((left, right) => left - right); }
  isHandshakeComplete(): boolean { return this.handshakeComplete; }

  private queue(details: Omit<Extract<RawHidFrame, { type: "hello" }>, "connectionEpoch" | "counter" | "bootNonce">
    | Omit<Extract<RawHidFrame, { type: "signal" }>, "connectionEpoch" | "counter" | "bootNonce">
    | Omit<Extract<RawHidFrame, { type: "status" }>, "connectionEpoch" | "counter" | "bootNonce">): Uint8Array {
    this.counter += 1;
    if (this.counter > 0xffff_ffff) throw new Error("Raw-HID counter exhausted; reconnect before sending another signal.");
    const packet = encodeRawHidFrame({ ...details, connectionEpoch: this.connectionEpoch, counter: this.counter, bootNonce: this.bootNonce } as RawHidFrame);
    this.pending.set(this.counter, packet);
    return packet.slice();
  }
}

function equalBytes(left: Uint8Array, right: Uint8Array): boolean {
  return left.byteLength === right.byteLength && left.every((value, index) => value === right[index]);
}

export interface WindowsRawHidIdentity {
  readonly vendorId: number;
  readonly productId: number;
  readonly usagePage: number;
  readonly usage: number;
  readonly serialNumber?: string;
}

export interface RawHidHelperProcess {
  onLine(listener: (line: string) => void): void;
  onExit(listener: (code: number | null) => void): void;
  onError(listener: (error: Error) => void): void;
  write(line: string): Promise<void>;
  stop(): Promise<void>;
}

export interface RawHidHelperLauncher {
  launch(executable: string, args: readonly string[]): RawHidHelperProcess;
}

export class NodeRawHidHelperLauncher implements RawHidHelperLauncher {
  private readonly spawnProcess: typeof spawn;
  constructor(spawnProcess: typeof spawn = spawn) { this.spawnProcess = spawnProcess; }

  launch(executable: string, args: readonly string[]): RawHidHelperProcess {
    const options: SpawnOptions = {
      shell: false,
      windowsHide: true,
      stdio: ["pipe", "pipe", "ignore"],
      env: strictWindowsHelperEnvironment(process.env),
    };
    const child = this.spawnProcess(executable, [...args], options);
    if (!child.stdout || !child.stdin) { child.kill(); throw new Error("Native Raw HID helper did not expose bounded stdio."); }
    const stdout = child.stdout;
    const stdin = child.stdin;
    const lineListeners: Array<(line: string) => void> = [];
    const exitListeners: Array<(code: number | null) => void> = [];
    const errorListeners: Array<(error: Error) => void> = [];
    let buffer = "";
    let exited = false;
    stdout.setEncoding("utf8");
    stdout.on("data", (chunk: string) => {
      buffer += chunk;
      while (buffer.includes("\n")) {
        const newline = buffer.indexOf("\n");
        const line = buffer.slice(0, newline).replace(/\r$/, "");
        buffer = buffer.slice(newline + 1);
        if (line.length > 4096) { const error = new Error("Native Raw HID helper emitted an oversized record."); errorListeners.forEach((listener) => listener(error)); child.kill(); return; }
        lineListeners.forEach((listener) => listener(line));
      }
      if (buffer.length > 4096) { const error = new Error("Native Raw HID helper emitted an oversized unterminated record."); errorListeners.forEach((listener) => listener(error)); child.kill(); }
    });
    child.on("error", (error) => errorListeners.forEach((listener) => listener(error)));
    child.on("exit", (code) => { exited = true; exitListeners.forEach((listener) => listener(code)); });
    return {
      onLine: (listener) => { lineListeners.push(listener); },
      onExit: (listener) => { exitListeners.push(listener); },
      onError: (listener) => { errorListeners.push(listener); },
      write: (line) => new Promise<void>((resolveWrite, rejectWrite) => {
        if (line.length > 4096 || exited || stdin.destroyed) return rejectWrite(new Error("Native Raw HID helper write is unavailable or oversized."));
        stdin.write(`${line}\n`, (error) => error ? rejectWrite(error) : resolveWrite());
      }),
      stop: () => new Promise<void>((resolveStop) => {
        if (exited) return resolveStop();
        child.once("exit", () => resolveStop());
        child.kill();
      }),
    };
  }
}

export function strictWindowsHelperEnvironment(source: NodeJS.ProcessEnv): NodeJS.ProcessEnv {
  const systemRoot = source.SystemRoot ?? source.SYSTEMROOT;
  const windir = source.WINDIR ?? systemRoot;
  if (!systemRoot || !windir) throw new Error("SystemRoot/WINDIR are required for the native Raw HID helper.");
  return { SystemRoot: systemRoot, WINDIR: windir };
}

export interface WindowsRawHidTransportOptions {
  readonly installationRoot: string;
  readonly helperPath: string;
  readonly helperSha256: string;
  readonly identity: WindowsRawHidIdentity;
  readonly launcher?: RawHidHelperLauncher;
  readonly onSignal: (deviceId: string, signal: Extract<RawHidFrame, { type: "signal" }>) => Promise<void>;
  readonly onStatus?: (deviceId: string, status: DeviceStatus) => void;
  readonly onTransportStatus?: (status: "connected" | "disconnected" | "rejected" | "stopped", detail: string) => void;
}

/**
 * Real Windows host transport for the repository-owned native HID helper.
 * The executable is canonical-path and SHA-256 bound; device selection is an
 * exact VID/PID/usage tuple with no ambient PATH or first-HID fallback.
 */
export class WindowsRawHidTransport {
  private readonly host = new RawHidHostProtocol();
  private readonly options: WindowsRawHidTransportOptions;
  private helper?: RawHidHelperProcess;
  private activeDevice?: string;
  private processing: Promise<void> = Promise.resolve();

  constructor(options: WindowsRawHidTransportOptions) { this.options = options; }

  async start(): Promise<void> {
    if (this.helper) throw new Error("Raw HID transport is already started.");
    validateIdentity(this.options.identity);
    const root = await realpath(resolve(this.options.installationRoot));
    const helper = await realpath(resolve(this.options.helperPath));
    const rel = relative(root, helper);
    if (!rel || rel.startsWith("..") || isAbsolute(rel)) throw new Error("Raw HID helper must be a file beneath the canonical installation root.");
    if (!/^[0-9a-f]{64}$/i.test(this.options.helperSha256)) throw new Error("Raw HID helper SHA-256 is invalid.");
    const digest = createHash("sha256").update(await readFile(helper)).digest("hex");
    if (digest !== this.options.helperSha256.toLowerCase()) throw new Error("Raw HID helper digest mismatch.");
    const identity = this.options.identity;
    const args = [
      "--vendor-id", identity.vendorId.toString(10), "--product-id", identity.productId.toString(10),
      "--usage-page", identity.usagePage.toString(10), "--usage", identity.usage.toString(10),
    ];
    if (identity.serialNumber) args.push("--serial", identity.serialNumber);
    const launched = (this.options.launcher ?? new NodeRawHidHelperLauncher()).launch(helper, args);
    this.helper = launched;
    launched.onLine((line) => { this.processing = this.processing.then(() => this.handleLine(launched, line)).catch((error: unknown) => this.reject(error instanceof Error ? error.message : "Raw HID processing failed closed.")); });
    launched.onError((error) => this.reject(`Native Raw HID helper process failed: ${error.message}`));
    launched.onExit((code) => {
      if (this.helper !== launched) return;
      this.helper = undefined;
      if (this.activeDevice) this.host.disconnect(this.activeDevice);
      this.activeDevice = undefined;
      this.options.onTransportStatus?.("stopped", `Native Raw HID helper exited with code ${String(code)}.`);
    });
  }

  async stop(): Promise<void> {
    const helper = this.helper;
    this.helper = undefined;
    if (helper) await helper.stop();
    await this.processing;
    if (this.activeDevice) this.host.disconnect(this.activeDevice);
    this.activeDevice = undefined;
  }

  private async handleLine(source: RawHidHelperProcess, line: string): Promise<void> {
    if (source !== this.helper) return;
    if (line.length > 4096) return this.reject("Native Raw HID helper emitted an oversized record.");
    let message: unknown;
    try { message = JSON.parse(line); } catch { return this.reject("Native Raw HID helper emitted invalid JSON."); }
    if (!isRecord(message) || typeof message.type !== "string") return this.reject("Native Raw HID helper emitted an invalid record.");
    if (message.type === "error") return this.reject("Native Raw HID helper reported a fail-closed device error.");
    if (message.type === "connected" && typeof message.deviceId === "string" && validDeviceId(message.deviceId)) {
      if (this.activeDevice && this.activeDevice !== message.deviceId) return this.reject("Native Raw HID helper reported an ambiguous second connection.");
      this.activeDevice = message.deviceId;
      this.options.onTransportStatus?.("connected", message.deviceId);
      return;
    }
    if (message.type === "disconnected" && typeof message.deviceId === "string") {
      this.host.disconnect(message.deviceId);
      if (this.activeDevice === message.deviceId) this.activeDevice = undefined;
      this.options.onTransportStatus?.("disconnected", message.deviceId);
      return;
    }
    if (message.type !== "frame" || typeof message.deviceId !== "string" || message.deviceId !== this.activeDevice || typeof message.frame !== "string") return this.reject("Native Raw HID helper record was out of session.");
    const packet = Uint8Array.from(Buffer.from(message.frame, "base64"));
    if (packet.byteLength !== 32) return this.reject("Native Raw HID helper report was not 32 bytes.");
    let result = this.host.prepare(message.deviceId, packet);
    if (result.outcome === "signal_pending" && result.signal && result.commit) {
      try { await this.options.onSignal(message.deviceId, result.signal); }
      catch { this.reject("Raw HID signal durable acceptance failed; ACK withheld for retry."); return; }
      result = result.commit();
    }
    if (result.response) await source.write(JSON.stringify({ type: "write", deviceId: message.deviceId, frame: Buffer.from(result.response).toString("base64") }));
    if (result.status) this.options.onStatus?.(message.deviceId, result.status);
    if (result.outcome === "rejected") this.options.onTransportStatus?.("rejected", result.reason ?? "Raw HID frame rejected.");
  }

  private reject(detail: string): void { this.options.onTransportStatus?.("rejected", detail); }
}

function validateIdentity(identity: WindowsRawHidIdentity): void {
  for (const [name, value] of Object.entries(identity).filter(([name]) => name !== "serialNumber")) {
    if (!Number.isInteger(value) || (value as number) < 0 || (value as number) > 0xffff) throw new RangeError(`${name} must be a uint16.`);
  }
  if (identity.serialNumber !== undefined && (!/^[A-Za-z0-9._-]{1,128}$/.test(identity.serialNumber))) throw new Error("Raw HID serial number is invalid.");
}
function isRecord(value: unknown): value is Record<string, unknown> { return typeof value === "object" && value !== null; }
function validDeviceId(value: string): boolean { return /^[A-Fa-f0-9]{64}$/.test(value); }
