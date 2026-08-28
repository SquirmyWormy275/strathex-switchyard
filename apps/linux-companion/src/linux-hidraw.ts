import { createHash } from "node:crypto";
import { constants } from "node:fs";
import { createReadStream } from "node:fs";
import { open, readFile, realpath, stat } from "node:fs/promises";
import { basename, join } from "node:path";

import type { DurableHardwareSignalInbox } from "../../windows-companion/src/hardware-signal-queue.ts";
import { RawHidHostProtocol } from "../../windows-companion/src/raw-hid-protocol.ts";

export interface LinuxHidrawIdentity { readonly devicePath: string; readonly vendorId: number; readonly productId: number; readonly reportDescriptorSha256: string; readonly serialNumber?: string; }
export interface LinuxHidrawOpenedIdentity { readonly dev: number; readonly ino: number; readonly rdev: number; }
export interface LinuxHidrawPort {
  inspect(identity: LinuxHidrawIdentity): Promise<Readonly<{ canonicalDevicePath: string; deviceId: string; openedIdentity: LinuxHidrawOpenedIdentity }>>;
  open(path: string, expected: LinuxHidrawOpenedIdentity, onFrame: (frame: Uint8Array) => Promise<void>, onDisconnect: () => void): Promise<Readonly<{ write(frame: Uint8Array): Promise<void>; close(): Promise<void> }>>;
}

/** Linux hidraw framing boundary. The physical device remains signal-only. */
export class LinuxHidrawTransport {
  private readonly protocol = new RawHidHostProtocol();
  private connection?: Readonly<{ write(frame: Uint8Array): Promise<void>; close(): Promise<void> }>;
  private deviceId?: string;
  private tail: Promise<void> = Promise.resolve();
  constructor(private readonly identity: LinuxHidrawIdentity, private readonly inbox: Pick<DurableHardwareSignalInbox, "accept">, private readonly port: LinuxHidrawPort = new NodeLinuxHidrawPort()) { validateIdentity(identity); }

  async start(): Promise<void> {
    if (this.connection) throw new Error("The Linux hidraw transport is already active.");
    const inspected = await this.port.inspect(this.identity);
    this.deviceId = inspected.deviceId;
    this.connection = await this.port.open(inspected.canonicalDevicePath, inspected.openedIdentity, async (frame) => {
      this.tail = this.tail.then(() => this.receive(inspected.deviceId, frame));
      await this.tail;
    }, () => { this.protocol.disconnect(inspected.deviceId); this.connection = undefined; });
  }

  async stop(): Promise<void> { const connection = this.connection; this.connection = undefined; if (connection) await connection.close(); await this.tail; if (this.deviceId) this.protocol.disconnect(this.deviceId); this.deviceId = undefined; }

  private async receive(deviceId: string, packet: Uint8Array): Promise<void> {
    if (!this.connection || packet.byteLength !== 32) return;
    let result = this.protocol.prepare(deviceId, packet);
    if (result.outcome === "signal_pending" && result.signal && result.commit) { await this.inbox.accept(deviceId, result.signal); result = result.commit(); }
    if (result.response && this.connection) await this.connection.write(result.response);
  }
}

export class NodeLinuxHidrawPort implements LinuxHidrawPort {
  async inspect(identity: LinuxHidrawIdentity): Promise<Readonly<{ canonicalDevicePath: string; deviceId: string; openedIdentity: LinuxHidrawOpenedIdentity }>> {
    if (process.platform !== "linux") throw new Error("Linux hidraw is unavailable on this platform.");
    validateIdentity(identity);
    const canonicalDevicePath = await realpath(identity.devicePath);
    const deviceMetadata = await stat(canonicalDevicePath);
    if (canonicalDevicePath !== identity.devicePath || !/^\/dev\/hidraw[0-9]+$/.test(canonicalDevicePath) || !deviceMetadata.isCharacterDevice()) throw new Error("The configured Linux hidraw path is not an exact character device.");
    const sysfs = await realpath(join("/sys/class/hidraw", basename(canonicalDevicePath), "device"));
    const uevent = await readFile(join(sysfs, "uevent"), "utf8");
    const id = /^HID_ID=[0-9A-Fa-f]{4}:([0-9A-Fa-f]{8}):([0-9A-Fa-f]{8})$/m.exec(uevent);
    if (!id || Number.parseInt(id[1]!, 16) !== identity.vendorId || Number.parseInt(id[2]!, 16) !== identity.productId) throw new Error("The Linux hidraw VID/PID changed before open.");
    const observedSerial = /^HID_UNIQ=(.*)$/m.exec(uevent)?.[1] || undefined;
    if ((identity.serialNumber ?? undefined) !== observedSerial) throw new Error("The Linux hidraw serial identity changed before open.");
    const descriptor = await readFile(join(sysfs, "report_descriptor"));
    const descriptorSha256 = createHash("sha256").update(descriptor).digest("hex"); descriptor.fill(0);
    if (descriptorSha256 !== identity.reportDescriptorSha256) throw new Error("The Linux hidraw report descriptor changed before open.");
    const deviceId = createHash("sha256").update(JSON.stringify({ canonicalDevicePath, vendorId: identity.vendorId, productId: identity.productId, serialNumber: identity.serialNumber ?? null, descriptorSha256 })).digest("hex");
    return { canonicalDevicePath, deviceId, openedIdentity: { dev: deviceMetadata.dev, ino: deviceMetadata.ino, rdev: deviceMetadata.rdev } };
  }

  async open(path: string, expected: LinuxHidrawOpenedIdentity, onFrame: (frame: Uint8Array) => Promise<void>, onDisconnect: () => void): Promise<Readonly<{ write(frame: Uint8Array): Promise<void>; close(): Promise<void> }>> {
    if (await realpath(path) !== path) throw new Error("The Linux hidraw path changed before open.");
    const handle = await open(path, constants.O_RDWR | constants.O_NOFOLLOW);
    const opened = await handle.stat();
    if (!opened.isCharacterDevice() || opened.dev !== expected.dev || opened.ino !== expected.ino || opened.rdev !== expected.rdev) { await handle.close(); throw new Error("The Linux hidraw character-device identity changed before open."); }
    let closed = false; let pending = Buffer.alloc(0); let tail = Promise.resolve();
    const stream = createReadStream(path, { fd: handle.fd, autoClose: false });
    const disconnect = (): void => {
      if (closed) return;
      closed = true;
      pending.fill(0);
      pending = Buffer.alloc(0);
      onDisconnect();
      stream.destroy();
      void handle.close().catch(() => undefined);
    };
    stream.on("data", (chunk: Buffer | string) => {
      stream.pause();
      const bytes = typeof chunk === "string" ? Buffer.from(chunk) : chunk;
      pending = Buffer.concat([pending, bytes]);
      if (pending.length > 32 * 64) { disconnect(); return; }
      const frames: Buffer[] = [];
      while (pending.length >= 32 && frames.length < 64) {
        const frame = Buffer.from(pending.subarray(0, 32));
        pending = pending.subarray(32);
        frames.push(frame);
      }
      tail = tail.then(async () => { for (const frame of frames) { try { await onFrame(frame); } finally { frame.fill(0); } } }).then(() => { if (!closed) stream.resume(); }).catch(() => { for (const frame of frames) frame.fill(0); disconnect(); });
    });
    stream.once("error", disconnect);
    stream.once("close", disconnect);
    return {
      async write(frame) {
        if (closed || frame.byteLength !== 32) throw new Error("The Linux hidraw response is invalid or closed.");
        const bytes = Buffer.from(frame);
        try {
          let offset = 0;
          while (offset < bytes.length) {
            const result = await handle.write(bytes, offset, bytes.length - offset, null);
            if (result.bytesWritten < 1) throw new Error("The Linux hidraw response write made no progress.");
            offset += result.bytesWritten;
          }
        } finally { bytes.fill(0); }
      },
      async close() { if (closed) return; closed = true; stream.destroy(); await tail; pending.fill(0); await handle.close(); }
    };
  }
}

export async function loadLinuxHidrawIdentity(filePath: string): Promise<LinuxHidrawIdentity | undefined> {
  let handle;
  try { handle = await open(filePath, constants.O_RDONLY | constants.O_NOFOLLOW); } catch (error) { if (missing(error)) return undefined; throw error; }
  let raw: string;
  try {
    const before = await handle.stat();
    const uid = process.getuid?.();
    if (!before.isFile() || uid === undefined || before.uid !== uid || before.size < 2 || before.size > 8192 || (before.mode & 0o077) !== 0) throw new Error("The Linux hidraw identity file is unsafe.");
    raw = await handle.readFile("utf8");
    const after = await handle.stat();
    if (before.dev !== after.dev || before.ino !== after.ino || before.size !== after.size || before.mtimeMs !== after.mtimeMs) throw new Error("The Linux hidraw identity changed while it was read.");
  } finally { await handle.close(); }
  const value: unknown = JSON.parse(raw);
  if (!record(value) || !exact(value, ["devicePath", "vendorId", "productId", "reportDescriptorSha256", ...(value.serialNumber === undefined ? [] : ["serialNumber"])])) throw new Error("The Linux hidraw identity is invalid.");
  const identity = value as unknown as LinuxHidrawIdentity; validateIdentity(identity); return identity;
}

function validateIdentity(identity: LinuxHidrawIdentity): void { if (!/^\/dev\/hidraw[0-9]+$/.test(identity.devicePath) || !Number.isInteger(identity.vendorId) || identity.vendorId < 0 || identity.vendorId > 0xffff || !Number.isInteger(identity.productId) || identity.productId < 0 || identity.productId > 0xffff || !/^[a-f0-9]{64}$/.test(identity.reportDescriptorSha256) || identity.serialNumber !== undefined && !/^[A-Za-z0-9._-]{1,128}$/.test(identity.serialNumber)) throw new Error("The Linux hidraw identity is invalid."); }
function record(value: unknown): value is Record<string, unknown> { return typeof value === "object" && value !== null && !Array.isArray(value); }
function exact(value: Record<string, unknown>, keys: readonly string[]): boolean { return Object.keys(value).length === keys.length && keys.every((key) => key in value); }
function missing(error: unknown): boolean { return typeof error === "object" && error !== null && "code" in error && (error as { code?: string }).code === "ENOENT"; }
