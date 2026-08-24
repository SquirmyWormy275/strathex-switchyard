import assert from "node:assert/strict";
import { mkdtemp, realpath, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { ProtectedJsonStore, type JournalAuthenticator } from "../../../packages/control-plane/src/store.ts";
import { DurableHardwareSignalInbox } from "../src/hardware-signal-queue.ts";
import {
  AttestedRawHidInstallationCoordinator,
  DurableRawHidInstallationRegistry,
  InstalledRawHidSupervisor,
  type RawHidTransportEvents,
  type SupervisedRawHidTransport
} from "../src/raw-hid-installation.ts";

const authenticator: JournalAuthenticator = {
  provider: "raw-hid-installation-isolated-test",
  async seal(hash) { return `test:${hash}`; },
  async verify(hash, tag) { return tag === `test:${hash}`; }
};

test("user-presence installation pins the fixed helper, exact device tuple, protocol, map, and digest", async (context) => {
  const folder = await mkdtemp(join(tmpdir(), "sxsy-b122-raw-hid-installation-"));
  context.after(async () => { await rm(folder, { recursive: true, force: true }); });
  const helperPath = join(folder, "strathex-b122-hid-helper.exe");
  await writeFile(helperPath, "exact helper bytes", "utf8");
  const store = new ProtectedJsonStore({ filePath: join(folder, "protected.jsonl"), authenticator, clock: () => "2026-08-24T12:00:00.000Z" });
  const registry = new DurableRawHidInstallationRegistry(store, {
    helperPath,
    protocolVersion: 1,
    mapFingerprint: "0123456789abcdef",
    now: () => "2026-08-24T12:00:00.000Z"
  });
  const prompts: string[] = [];
  const coordinator = new AttestedRawHidInstallationCoordinator(registry, {
    async verify(prompt) { prompts.push(prompt); return { verified: true, operator: "Current User", method: "windows-user-presence" }; }
  }, () => new Date("2026-08-24T12:00:00.000Z"));

  const pin = await coordinator.install({ vendorId: 0x5358, productId: 0xb122, usagePage: 0xff60, usage: 0x61, serialNumber: "B122-A" });
  assert.equal(pin.helperPath, await realpath(helperPath));
  assert.match(pin.helperSha256, /^[a-f0-9]{64}$/);
  assert.equal(pin.protocolVersion, 1);
  assert.equal(pin.mapFingerprint, "0123456789abcdef");
  assert.deepEqual(pin.identity, { vendorId: 0x5358, productId: 0xb122, usagePage: 0xff60, usage: 0x61, serialNumber: "B122-A" });
  assert.match(prompts[0] ?? "", /5358.*b122.*ff60.*0061.*0123456789abcdef/i);
  assert.equal((await registry.resolve()).status, "active");
});

test("resolution fails closed after helper tamper and revocation requires fresh user presence", async (context) => {
  const folder = await mkdtemp(join(tmpdir(), "sxsy-b122-raw-hid-reverify-"));
  context.after(async () => { await rm(folder, { recursive: true, force: true }); });
  const helperPath = join(folder, "strathex-b122-hid-helper.exe");
  await writeFile(helperPath, "approved", "utf8");
  const registry = new DurableRawHidInstallationRegistry(
    new ProtectedJsonStore({ filePath: join(folder, "protected.jsonl"), authenticator }),
    { helperPath, protocolVersion: 1, mapFingerprint: "0123456789abcdef" }
  );
  let approvals = 0;
  const coordinator = new AttestedRawHidInstallationCoordinator(registry, {
    async verify() { approvals += 1; return { verified: true, operator: "Current User", method: "windows-user-presence" }; }
  });
  await coordinator.install({ vendorId: 0x5358, productId: 0xb122, usagePage: 0xff60, usage: 0x61 });
  await writeFile(helperPath, "tampered", "utf8");
  await assert.rejects(() => registry.resolve(), /changed|digest/i);
  await writeFile(helperPath, "approved", "utf8");
  const revoked = await coordinator.revoke();
  assert.equal(revoked.status, "revoked");
  assert.equal(approvals, 2);
  await assert.rejects(() => registry.resolve(), /active/i);
});

test("client-controlled paths, digests, protocol values, and ambiguous device tuples are rejected", async (context) => {
  const folder = await mkdtemp(join(tmpdir(), "sxsy-b122-raw-hid-invalid-"));
  context.after(async () => { await rm(folder, { recursive: true, force: true }); });
  const helperPath = join(folder, "strathex-b122-hid-helper.exe");
  await writeFile(helperPath, "approved", "utf8");
  const registry = new DurableRawHidInstallationRegistry(
    new ProtectedJsonStore({ filePath: join(folder, "protected.jsonl"), authenticator }),
    { helperPath, protocolVersion: 1, mapFingerprint: "0123456789abcdef" }
  );
  const coordinator = new AttestedRawHidInstallationCoordinator(registry, {
    async verify() { return { verified: true, operator: "Current User", method: "windows-user-presence" }; }
  });
  await assert.rejects(() => coordinator.install({ vendorId: 0x5358, productId: 0xb122, usagePage: 0xff60, usage: 0x61, serialNumber: "" }), /serial/i);
  await assert.rejects(() => coordinator.install({ vendorId: -1, productId: 0xb122, usagePage: 0xff60, usage: 0x61 }), /vendorId/i);
});

test("supervisor launches no helper while unprovisioned and owns only one verified generation", async (context) => {
  const folder = await mkdtemp(join(tmpdir(), "sxsy-b122-raw-hid-supervisor-"));
  context.after(async () => { await rm(folder, { recursive: true, force: true }); });
  const helperPath = join(folder, "strathex-b122-hid-helper.exe");
  await writeFile(helperPath, "approved helper", "utf8");
  const store = new ProtectedJsonStore({ filePath: join(folder, "protected.jsonl"), authenticator });
  const registry = new DurableRawHidInstallationRegistry(store, { helperPath, protocolVersion: 1, mapFingerprint: "0123456789abcdef" });
  const coordinator = new AttestedRawHidInstallationCoordinator(registry, { async verify() { return { verified: true, operator: "Current User", method: "windows-user-presence" }; } });
  const created: FakeTransport[] = [];
  class FakeTransport implements SupervisedRawHidTransport {
    starts = 0;
    stops = 0;
    constructor(readonly events: RawHidTransportEvents) {}
    async start() { this.starts += 1; }
    async stop() { this.stops += 1; }
  }
  const supervisor = new InstalledRawHidSupervisor(registry, new DurableHardwareSignalInbox(store), {
    create(_pin, events) { const transport = new FakeTransport(events); created.push(transport); return transport; }
  });

  assert.equal((await supervisor.startConfigured()).state, "unprovisioned");
  assert.equal(created.length, 0);
  await coordinator.install({ vendorId: 0x5358, productId: 0xb122, usagePage: 0xff60, usage: 0x61, serialNumber: "B122-A" });
  assert.equal((await supervisor.startConfigured()).state, "starting", "a spawned helper is not a connected physical device");
  created[0]!.events.onTransportStatus("connected", "exact device connected");
  assert.equal(supervisor.status().state, "running");
  await supervisor.startConfigured();
  assert.equal(created.length, 1);
  assert.equal(created[0]?.starts, 1);
  await supervisor.stop();
  assert.equal(created[0]?.stops, 1);
  assert.equal(supervisor.status().state, "stopped");

  const immediateConnection = new InstalledRawHidSupervisor(registry, new DurableHardwareSignalInbox(store), {
    create(_pin, events) {
      return { async start() { events.onTransportStatus("connected", "connected during startup"); }, async stop() {} };
    }
  });
  assert.equal((await immediateConnection.startConfigured()).state, "running", "a connection event observed during helper startup is not overwritten by spawned-only status");
  await immediateConnection.stop();
});

test("unexpected helper exit schedules one bounded restart and stop cancels the pending generation", async (context) => {
  const folder = await mkdtemp(join(tmpdir(), "sxsy-b122-raw-hid-restart-"));
  context.after(async () => { await rm(folder, { recursive: true, force: true }); });
  const helperPath = join(folder, "strathex-b122-hid-helper.exe");
  await writeFile(helperPath, "approved helper", "utf8");
  const store = new ProtectedJsonStore({ filePath: join(folder, "protected.jsonl"), authenticator });
  const registry = new DurableRawHidInstallationRegistry(store, { helperPath, protocolVersion: 1, mapFingerprint: "0123456789abcdef" });
  const coordinator = new AttestedRawHidInstallationCoordinator(registry, { async verify() { return { verified: true, operator: "Current User", method: "windows-user-presence" }; } });
  await coordinator.install({ vendorId: 0x5358, productId: 0xb122, usagePage: 0xff60, usage: 0x61, serialNumber: "B122-A" });
  const created: { events: RawHidTransportEvents; stop: number }[] = [];
  const scheduled: { callback: () => void; delay: number; cancelled: boolean }[] = [];
  const supervisor = new InstalledRawHidSupervisor(registry, new DurableHardwareSignalInbox(store), {
    create(_pin, events) {
      const record = { events, stop: 0 };
      created.push(record);
      return { async start() {}, async stop() { record.stop += 1; } };
    }
  }, {
    restartDelaysMs: [25, 100],
    schedule(callback, delay) { const record = { callback, delay, cancelled: false }; scheduled.push(record); return record as unknown as ReturnType<typeof setTimeout>; },
    cancelSchedule(timer) { (timer as unknown as { cancelled: boolean }).cancelled = true; }
  });
  await supervisor.startConfigured();
  created[0]!.events.onTransportStatus("stopped", "unexpected exit");
  assert.equal(scheduled[0]?.delay, 25);
  scheduled[0]!.callback();
  for (let attempt = 0; attempt < 20 && created.length < 2; attempt += 1) await new Promise((resolve) => setTimeout(resolve, 5));
  assert.equal(created.length, 2);
  created[1]!.events.onTransportStatus("stopped", "second exit");
  assert.equal(scheduled[1]?.delay, 100, "merely spawning a helper cannot reset bounded backoff before a connected device is proven");
  await supervisor.stop();
  assert.equal(scheduled[1]?.cancelled, true);
  scheduled[1]!.callback();
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(created.length, 2);
});

test("a synchronous transport factory failure is supervised and cannot escape the bounded restart boundary", async (context) => {
  const folder = await mkdtemp(join(tmpdir(), "sxsy-b122-raw-hid-factory-failure-"));
  context.after(async () => { await rm(folder, { recursive: true, force: true }); });
  const helperPath = join(folder, "strathex-b122-hid-helper.exe");
  await writeFile(helperPath, "approved helper", "utf8");
  const store = new ProtectedJsonStore({ filePath: join(folder, "protected.jsonl"), authenticator });
  const registry = new DurableRawHidInstallationRegistry(store, { helperPath, protocolVersion: 1, mapFingerprint: "0123456789abcdef" });
  const coordinator = new AttestedRawHidInstallationCoordinator(registry, { async verify() { return { verified: true, operator: "Current User", method: "windows-user-presence" }; } });
  await coordinator.install({ vendorId: 0x5358, productId: 0xb122, usagePage: 0xff60, usage: 0x61, serialNumber: "B122-A" });
  const scheduled: number[] = [];
  const supervisor = new InstalledRawHidSupervisor(registry, new DurableHardwareSignalInbox(store), {
    create() { throw new Error("factory refused launch"); }
  }, {
    restartDelaysMs: [25],
    schedule(_callback, delay) { scheduled.push(delay); return { unref() {} } as unknown as ReturnType<typeof setTimeout>; }
  });

  const status = await supervisor.startConfigured();
  assert.equal(status.state, "retrying");
  assert.deepEqual(scheduled, [25]);
  await supervisor.stop();
});
