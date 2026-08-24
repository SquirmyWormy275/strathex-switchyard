import { createHash } from "node:crypto";
import { basename, isAbsolute, resolve } from "node:path";
import { readFile, realpath, stat } from "node:fs/promises";

import type { RawHidFrame } from "../../../packages/protocol/src/raw-hid.ts";
import type { JournalEntry, JsonValue, ProtectedJsonStore } from "../../../packages/control-plane/src/store.ts";
import type { WindowsUserPresenceRunner } from "./windows-user-presence.ts";
import type { DurableHardwareSignalInbox } from "./hardware-signal-queue.ts";

const installKind = "b122.raw-hid.install.v1";
const revokeKind = "b122.raw-hid.revoke.v1";
const maximumHelperBytes = 256 * 1024 * 1024;

export interface RawHidDeviceIdentity {
  readonly vendorId: number;
  readonly productId: number;
  readonly usagePage: number;
  readonly usage: number;
  readonly serialNumber?: string;
}

export interface RawHidInstallationPin {
  readonly identity: RawHidDeviceIdentity;
  readonly helperPath: string;
  readonly helperSha256: string;
  readonly protocolVersion: number;
  readonly mapFingerprint: string;
  readonly installedAt: string;
  readonly status: "active" | "revoked";
}

export interface RawHidInstallationCoordinator {
  install(identity: RawHidDeviceIdentity): Promise<RawHidInstallationPin>;
  revoke(): Promise<RawHidInstallationPin>;
  list(): Promise<readonly RawHidInstallationPin[]>;
}

interface PinPayload extends Record<string, JsonValue> {
  readonly identity: Record<string, JsonValue>;
  readonly helperPath: string;
  readonly helperSha256: string;
  readonly protocolVersion: number;
  readonly mapFingerprint: string;
  readonly attestedAt: string;
}

interface RevokePayload extends Record<string, JsonValue> { readonly attestedAt: string; }

interface InspectedPin {
  readonly identity: RawHidDeviceIdentity;
  readonly helperPath: string;
  readonly helperSha256: string;
  readonly protocolVersion: number;
  readonly mapFingerprint: string;
}

export interface DurableRawHidInstallationRegistryOptions {
  readonly helperPath: string;
  readonly protocolVersion: number;
  readonly mapFingerprint: string;
  readonly now?: () => string;
}

/** Durable global pin for one exact B122 native helper and physical identity. */
export class DurableRawHidInstallationRegistry {
  private readonly store: ProtectedJsonStore;
  private readonly helperPath: string;
  private readonly protocolVersion: number;
  private readonly mapFingerprint: string;
  private readonly now: () => string;

  constructor(store: ProtectedJsonStore, options: DurableRawHidInstallationRegistryOptions) {
    if (!boundedAbsolute(options.helperPath) || basename(options.helperPath).toLowerCase() !== "strathex-b122-hid-helper.exe") throw new Error("Raw-HID installation requires the fixed absolute packaged helper path.");
    if (!Number.isInteger(options.protocolVersion) || options.protocolVersion < 1 || options.protocolVersion > 255) throw new Error("Raw-HID protocol version is invalid.");
    if (!/^[a-f0-9]{16}$/i.test(options.mapFingerprint)) throw new Error("Raw-HID map fingerprint must be exactly eight bytes of hex.");
    this.store = store;
    this.helperPath = resolve(options.helperPath);
    this.protocolVersion = options.protocolVersion;
    this.mapFingerprint = options.mapFingerprint.toLowerCase();
    this.now = options.now ?? (() => new Date().toISOString());
  }

  async inspect(identity: RawHidDeviceIdentity): Promise<InspectedPin> {
    const exactIdentity = validateIdentity(identity);
    const helperPath = await realpath(this.helperPath);
    const metadata = await stat(helperPath);
    if (!metadata.isFile() || metadata.size <= 0 || metadata.size > maximumHelperBytes || basename(helperPath).toLowerCase() !== "strathex-b122-hid-helper.exe") throw new Error("The fixed Raw-HID helper is not a bounded regular executable file.");
    return {
      identity: exactIdentity,
      helperPath,
      helperSha256: sha256(await readFile(helperPath)),
      protocolVersion: this.protocolVersion,
      mapFingerprint: this.mapFingerprint
    };
  }

  async install(inspected: InspectedPin, attestedAt: string): Promise<RawHidInstallationPin> {
    this.assertAttestation(attestedAt);
    const current = await this.inspect(inspected.identity);
    if (!sameInspected(current, inspected)) throw new Error("The Raw-HID helper or protocol identity changed after current-user attestation.");
    const entry = await this.store.append(installKind, pinPayload(current, attestedAt));
    return { ...current, installedAt: entry.at, status: "active" };
  }

  async revoke(attestedAt: string): Promise<RawHidInstallationPin> {
    this.assertAttestation(attestedAt);
    const current = await this.currentState();
    if (!current || current.status !== "active") throw new Error("No active Raw-HID installation exists.");
    const entry = await this.store.append(revokeKind, { attestedAt } satisfies RevokePayload);
    return { ...current, installedAt: entry.at, status: "revoked" };
  }

  /** Revalidates the canonical path, file bytes, protocol, map, and tuple. */
  async resolve(): Promise<RawHidInstallationPin> {
    const current = await this.currentState();
    if (!current || current.status !== "active") throw new Error("No active current-user-attested Raw-HID installation exists.");
    const verified = await this.inspect(current.identity);
    if (!sameInspected(verified, current)) throw new Error("The installed Raw-HID helper, protocol, map, or device tuple changed after attestation.");
    return { ...verified, installedAt: current.installedAt, status: "active" };
  }

  async list(): Promise<readonly RawHidInstallationPin[]> {
    const current = await this.currentState();
    return current ? [current] : [];
  }

  private async currentState(): Promise<RawHidInstallationPin | undefined> {
    let current: RawHidInstallationPin | undefined;
    for (const entry of await this.store.readEntries<JsonValue>()) {
      if (entry.kind === installKind) {
        const pin = parsePin(entry);
        if (pin.protocolVersion !== this.protocolVersion || pin.mapFingerprint !== this.mapFingerprint) throw new Error("The protected Raw-HID installation journal conflicts with the fixed host build.");
        current = pin;
      } else if (entry.kind === revokeKind) {
        parseRevoke(entry.payload);
        if (!current || current.status !== "active") throw new Error("The protected Raw-HID revocation journal is inconsistent.");
        current = { ...current, installedAt: entry.at, status: "revoked" };
      }
    }
    return current;
  }

  private assertAttestation(value: string): void {
    const attested = Date.parse(value);
    const current = Date.parse(this.now());
    if (!Number.isFinite(attested) || !Number.isFinite(current) || Math.abs(current - attested) > 5 * 60_000) throw new Error("Raw-HID user-presence attestation is missing, stale, or future-dated.");
  }
}

export class AttestedRawHidInstallationCoordinator implements RawHidInstallationCoordinator {
  constructor(
    private readonly registry: DurableRawHidInstallationRegistry,
    private readonly presence: WindowsUserPresenceRunner,
    private readonly now: () => Date = () => new Date()
  ) {}

  async install(identity: RawHidDeviceIdentity): Promise<RawHidInstallationPin> {
    const inspected = await this.registry.inspect(identity);
    const tuple = `${hex(inspected.identity.vendorId)}:${hex(inspected.identity.productId)} ${hex(inspected.identity.usagePage)}:${hex(inspected.identity.usage)}${inspected.identity.serialNumber ? ` serial ${inspected.identity.serialNumber}` : " no-serial exact match"}`;
    const approved = await this.presence.verify(`Approve the exact SXSY-B122 Raw-HID device ${tuple}, protocol ${inspected.protocolVersion}, map ${inspected.mapFingerprint}, and fixed helper SHA-256 ${inspected.helperSha256}.`);
    if (!approved.verified || !approved.operator?.trim()) throw new Error("Current-user presence did not approve Raw-HID installation.");
    return this.registry.install(inspected, this.now().toISOString());
  }

  async revoke(): Promise<RawHidInstallationPin> {
    const approved = await this.presence.verify("Revoke the active SXSY-B122 Raw-HID device and fixed helper pin.");
    if (!approved.verified || !approved.operator?.trim()) throw new Error("Current-user presence did not approve Raw-HID revocation.");
    return this.registry.revoke(this.now().toISOString());
  }

  list(): Promise<readonly RawHidInstallationPin[]> { return this.registry.list(); }
}

export interface SupervisedRawHidTransport {
  start(): Promise<void>;
  stop(): Promise<void> | void;
}

export interface RawHidTransportEvents {
  readonly onSignal: (deviceId: string, signal: Extract<RawHidFrame, { type: "signal" }>) => Promise<void>;
  readonly onTransportStatus: (status: "connected" | "disconnected" | "rejected" | "stopped", detail: string) => void;
}

export interface RawHidTransportFactory {
  create(pin: RawHidInstallationPin, events: RawHidTransportEvents): SupervisedRawHidTransport;
}

export interface RawHidSupervisorStatus {
  readonly state: "unprovisioned" | "starting" | "running" | "retrying" | "stopped" | "unavailable";
  readonly generation: number;
  readonly detail: string;
}

export interface InstalledRawHidSupervisorOptions {
  readonly restartDelaysMs?: readonly number[];
  readonly schedule?: (callback: () => void, delayMs: number) => ReturnType<typeof setTimeout>;
  readonly cancelSchedule?: (timer: ReturnType<typeof setTimeout>) => void;
}

/** One verified helper generation, with bounded-backoff revalidation on exit. */
export class InstalledRawHidSupervisor {
  private readonly restartDelaysMs: readonly number[];
  private readonly schedule: (callback: () => void, delayMs: number) => ReturnType<typeof setTimeout>;
  private readonly cancelSchedule: (timer: ReturnType<typeof setTimeout>) => void;
  private desired = false;
  private generation = 0;
  private restartAttempt = 0;
  private transport?: SupervisedRawHidTransport;
  private restartTimer?: ReturnType<typeof setTimeout>;
  private currentStatus: RawHidSupervisorStatus = { state: "stopped", generation: 0, detail: "Raw-HID supervision has not started." };

  constructor(
    private readonly registry: DurableRawHidInstallationRegistry,
    private readonly inbox: DurableHardwareSignalInbox,
    private readonly factory: RawHidTransportFactory,
    options: InstalledRawHidSupervisorOptions = {}
  ) {
    const delays = options.restartDelaysMs ?? [250, 1_000, 5_000, 15_000, 30_000];
    if (!delays.length || delays.some((delay) => !Number.isInteger(delay) || delay < 0 || delay > 60_000)) throw new Error("Raw-HID restart delays are invalid.");
    this.restartDelaysMs = [...delays];
    this.schedule = options.schedule ?? ((callback, delay) => setTimeout(callback, delay));
    this.cancelSchedule = options.cancelSchedule ?? clearTimeout;
  }

  status(): RawHidSupervisorStatus { return { ...this.currentStatus }; }

  async startConfigured(): Promise<RawHidSupervisorStatus> {
    this.desired = true;
    if (this.transport) return this.status();
    if (this.restartTimer) { this.cancelSchedule(this.restartTimer); this.restartTimer = undefined; }
    return this.launchOne();
  }

  async stop(): Promise<void> {
    this.desired = false;
    this.generation += 1;
    if (this.restartTimer) { this.cancelSchedule(this.restartTimer); this.restartTimer = undefined; }
    const transport = this.transport;
    this.transport = undefined;
    if (transport) await transport.stop();
    this.currentStatus = { state: "stopped", generation: this.generation, detail: "Raw-HID supervision stopped and no helper generation remains owned." };
  }

  private async launchOne(): Promise<RawHidSupervisorStatus> {
    if (!this.desired || this.transport) return this.status();
    const generation = ++this.generation;
    this.currentStatus = { state: "starting", generation, detail: "Revalidating the current Raw-HID installation before helper launch." };
    let pin: RawHidInstallationPin;
    try {
      pin = await this.registry.resolve();
    } catch (error) {
      const detail = error instanceof Error ? error.message : "No verified Raw-HID installation is available.";
      const unprovisioned = /No active/i.test(detail);
      this.currentStatus = { state: unprovisioned ? "unprovisioned" : "unavailable", generation, detail };
      return this.status();
    }
    if (!this.desired || generation !== this.generation) return this.status();
    let transport: SupervisedRawHidTransport | undefined;
    try {
      transport = this.factory.create(pin, {
        onSignal: async (deviceId, signal) => { await this.inbox.accept(deviceId, signal); },
        onTransportStatus: (status, detail) => { this.transportEvent(generation, status, detail); }
      });
      this.transport = transport;
      await transport.start();
      if (!this.desired || generation !== this.generation || this.transport !== transport) { await transport.stop(); return this.status(); }
      if (this.currentStatus.state !== "running" || this.currentStatus.generation !== generation) {
        this.currentStatus = { state: "starting", generation, detail: "The verified Raw-HID helper is running and awaiting its exact physical device connection." };
      }
    } catch (error) {
      if (transport && this.transport === transport) this.transport = undefined;
      try { await transport?.stop(); } catch { /* startup failure already leaves this generation unavailable */ }
      this.currentStatus = { state: "unavailable", generation, detail: error instanceof Error ? error.message : "The verified Raw-HID helper failed to start." };
      this.queueRestart(generation);
    }
    return this.status();
  }

  private transportEvent(generation: number, status: "connected" | "disconnected" | "rejected" | "stopped", detail: string): void {
    if (generation !== this.generation || !this.desired) return;
    if (status === "connected") {
      this.restartAttempt = 0;
      this.currentStatus = { state: "running", generation, detail };
    } else if (status === "stopped") {
      this.transport = undefined;
      this.currentStatus = { state: "retrying", generation, detail };
      this.queueRestart(generation);
    } else {
      this.currentStatus = { state: this.transport ? "starting" : "unavailable", generation, detail };
    }
  }

  private queueRestart(generation: number): void {
    if (!this.desired || generation !== this.generation || this.restartTimer) return;
    const index = Math.min(this.restartAttempt, this.restartDelaysMs.length - 1);
    const delay = this.restartDelaysMs[index]!;
    this.restartAttempt += 1;
    this.currentStatus = { state: "retrying", generation, detail: `The helper will be reverified before bounded restart attempt ${this.restartAttempt}.` };
    this.restartTimer = this.schedule(() => {
      this.restartTimer = undefined;
      if (this.desired && generation === this.generation) void this.launchOne();
    }, delay);
    this.restartTimer.unref?.();
  }
}

function pinPayload(pin: InspectedPin, attestedAt: string): PinPayload {
  return {
    identity: { vendorId: pin.identity.vendorId, productId: pin.identity.productId, usagePage: pin.identity.usagePage, usage: pin.identity.usage, ...(pin.identity.serialNumber ? { serialNumber: pin.identity.serialNumber } : {}) },
    helperPath: pin.helperPath,
    helperSha256: pin.helperSha256,
    protocolVersion: pin.protocolVersion,
    mapFingerprint: pin.mapFingerprint,
    attestedAt
  };
}

function parsePin(entry: JournalEntry<JsonValue>): RawHidInstallationPin {
  const value = entry.payload;
  if (!record(value) || !exact(value, ["identity", "helperPath", "helperSha256", "protocolVersion", "mapFingerprint", "attestedAt"])
    || !record(value.identity) || typeof value.helperPath !== "string" || typeof value.helperSha256 !== "string" || typeof value.protocolVersion !== "number" || typeof value.mapFingerprint !== "string" || typeof value.attestedAt !== "string"
    || !digest(value.helperSha256) || !/^[a-f0-9]{16}$/.test(value.mapFingerprint)) throw new Error("The protected Raw-HID installation journal is malformed.");
  const identity = parseIdentity(value.identity);
  if (!boundedAbsolute(value.helperPath)) throw new Error("The protected Raw-HID helper path is malformed.");
  return { identity, helperPath: resolve(value.helperPath), helperSha256: value.helperSha256, protocolVersion: value.protocolVersion, mapFingerprint: value.mapFingerprint, installedAt: entry.at, status: "active" };
}

function parseRevoke(value: JsonValue): RevokePayload {
  if (!record(value) || !exact(value, ["attestedAt"]) || typeof value.attestedAt !== "string") throw new Error("The protected Raw-HID revocation journal is malformed.");
  return { attestedAt: value.attestedAt };
}

function parseIdentity(value: Record<string, JsonValue>): RawHidDeviceIdentity {
  if (!allowedExact(value, ["vendorId", "productId", "usagePage", "usage"], ["serialNumber"])
    || typeof value.vendorId !== "number" || typeof value.productId !== "number" || typeof value.usagePage !== "number" || typeof value.usage !== "number"
    || (value.serialNumber !== undefined && typeof value.serialNumber !== "string")) throw new Error("The protected Raw-HID device identity is malformed.");
  return validateIdentity({ vendorId: value.vendorId, productId: value.productId, usagePage: value.usagePage, usage: value.usage, ...(typeof value.serialNumber === "string" ? { serialNumber: value.serialNumber } : {}) });
}

function validateIdentity(identity: RawHidDeviceIdentity): RawHidDeviceIdentity {
  for (const [label, value] of [["vendorId", identity.vendorId], ["productId", identity.productId], ["usagePage", identity.usagePage], ["usage", identity.usage]] as const) {
    if (!Number.isInteger(value) || value < 0 || value > 0xffff) throw new Error(`Raw-HID ${label} must be a uint16.`);
  }
  if (identity.serialNumber !== undefined && !/^[A-Za-z0-9._-]{1,128}$/.test(identity.serialNumber)) throw new Error("Raw-HID serial number is invalid; omit it only when the exact tuple is guaranteed unambiguous.");
  return { vendorId: identity.vendorId, productId: identity.productId, usagePage: identity.usagePage, usage: identity.usage, ...(identity.serialNumber ? { serialNumber: identity.serialNumber } : {}) };
}

function sameInspected(left: InspectedPin, right: InspectedPin | RawHidInstallationPin): boolean {
  return sameIdentity(left.identity, right.identity) && samePath(left.helperPath, right.helperPath) && left.helperSha256 === right.helperSha256 && left.protocolVersion === right.protocolVersion && left.mapFingerprint === right.mapFingerprint;
}
function sameIdentity(left: RawHidDeviceIdentity, right: RawHidDeviceIdentity): boolean { return left.vendorId === right.vendorId && left.productId === right.productId && left.usagePage === right.usagePage && left.usage === right.usage && left.serialNumber === right.serialNumber; }
function samePath(left: string, right: string): boolean { return resolve(left).replaceAll("\\", "/").toLowerCase() === resolve(right).replaceAll("\\", "/").toLowerCase(); }
function hex(value: number): string { return value.toString(16).padStart(4, "0"); }
function sha256(value: Uint8Array): string { return createHash("sha256").update(value).digest("hex"); }
function digest(value: string): boolean { return /^[a-f0-9]{64}$/.test(value); }
function boundedAbsolute(value: unknown): value is string { return typeof value === "string" && value.length > 0 && value.length <= 4_096 && !/[\0\r\n]/.test(value) && (isAbsolute(value) || /^(?:[A-Za-z]:[\\/]|\\\\)/.test(value)); }
function record(value: unknown): value is Record<string, JsonValue> { return typeof value === "object" && value !== null && !Array.isArray(value); }
function exact(value: Record<string, unknown>, keys: readonly string[]): boolean { return Object.keys(value).length === keys.length && keys.every((key) => key in value); }
function allowedExact(value: Record<string, unknown>, required: readonly string[], optional: readonly string[]): boolean { const keys = Object.keys(value); const allowed = new Set([...required, ...optional]); return required.every((key) => key in value) && keys.every((key) => allowed.has(key)); }
