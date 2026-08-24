import assert from "node:assert/strict";
import test from "node:test";
import { createHash } from "node:crypto";
import { mkdtemp, mkdir, realpath, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { assignmentFor } from "../../../packages/protocol/src/b122.ts";
import { decodeRawHidFrame, encodeRawHidFrame, mapFingerprint } from "../../../packages/protocol/src/raw-hid.ts";
import { B122FirmwareProtocolSimulator, RawHidHostProtocol, WindowsRawHidTransport, strictWindowsHelperEnvironment, type RawHidHelperLauncher, type RawHidHelperProcess } from "../src/raw-hid-protocol.ts";

test("handshake, modifiers, intentionally unassigned chords, and status are transported as signals only", () => {
  const host = new RawHidHostProtocol();
  const firmware = new B122FirmwareProtocolSimulator({ bootNonce: 11, connectionEpoch: 1 });
  const helloAck = host.receive("device-a", firmware.hello());
  assert.equal(helloAck.outcome, "handshake_accepted");
  firmware.receive(helloAck.response!);

  for (const [control, modifier] of [["PROOF", "shift"], ["REANCHOR", "ctrl"]] as const) {
    const result = host.receive("device-a", firmware.signal(control, modifier));
    assert.equal(result.outcome, "signal_accepted");
    assert.equal(result.signal?.assigned, assignmentFor(control, modifier) !== undefined);
    firmware.receive(result.response!);
  }

  const status = host.receive("device-a", firmware.status("ready"));
  assert.equal(status.outcome, "status_accepted");
  assert.equal(status.status, "ready");
  firmware.receive(status.response!);
  assert.deepEqual(firmware.pendingCounters(), []);
});

test("lost ACKs retry safely: a duplicate is acknowledged but never emitted twice", () => {
  const host = new RawHidHostProtocol();
  const firmware = new B122FirmwareProtocolSimulator({ bootNonce: 12, connectionEpoch: 1 });
  firmware.receive(host.receive("device-a", firmware.hello()).response!);
  const packet = firmware.signal("RUN", "normal");
  const first = host.receive("device-a", packet);
  assert.equal(first.outcome, "signal_accepted");
  const retry = firmware.retry(first.acknowledgedCounter!);
  const duplicate = host.receive("device-a", retry);
  assert.equal(duplicate.outcome, "duplicate_acknowledged");
  assert.equal(duplicate.signal, undefined);
  firmware.receive(duplicate.response!);
  assert.deepEqual(firmware.pendingCounters(), []);
});

test("reconnect changes epoch and rejects delayed packets from the old connection", () => {
  const host = new RawHidHostProtocol();
  const firmware = new B122FirmwareProtocolSimulator({ bootNonce: 13, connectionEpoch: 7 });
  firmware.receive(host.receive("device-a", firmware.hello()).response!);
  const delayed = firmware.signal("VSCODE", "normal");
  firmware.reconnect(14);
  firmware.receive(host.receive("device-a", firmware.hello()).response!);
  const stale = host.receive("device-a", delayed);
  assert.equal(stale.outcome, "rejected");
  assert.equal(decodeRawHidFrame(stale.response!)?.type, "nack");
});

test("loss before handshake, stale counters, checksum mismatch, and forged assigned bits fail closed", () => {
  const host = new RawHidHostProtocol();
  const firmware = new B122FirmwareProtocolSimulator({ bootNonce: 15, connectionEpoch: 1 });
  assert.equal(host.receive("device-a", firmware.signal("PROOF", "normal")).outcome, "rejected");
  firmware.receive(host.receive("device-a", firmware.hello()).response!);

  const packet = firmware.signal("PROOF", "normal");
  assert.equal(host.receive("device-a", packet).outcome, "signal_accepted");
  const stale = encodeRawHidFrame({ type: "signal", connectionEpoch: 1, counter: 1, bootNonce: 15, control: "PROOF", modifier: "normal", assigned: true });
  assert.equal(host.receive("device-a", stale).outcome, "rejected");

  const forged = encodeRawHidFrame({ type: "signal", connectionEpoch: 1, counter: 3, bootNonce: 15, control: "REANCHOR", modifier: "ctrl", assigned: true });
  assert.equal(host.receive("device-a", forged).outcome, "rejected");

  const wrongMap = new Uint8Array(mapFingerprint); wrongMap[0] ^= 0xff;
  const mismatch = encodeRawHidFrame({ type: "hello", connectionEpoch: 2, counter: 1, bootNonce: 16, mapFingerprint: wrongMap });
  const response = host.receive("device-a", mismatch);
  assert.equal(response.outcome, "rejected");
  assert.equal(decodeRawHidFrame(response.response!)?.type, "nack");
});

class FakeHelper implements RawHidHelperProcess {
  line?: (line: string) => void;
  exit?: (code: number | null) => void;
  error?: (error: Error) => void;
  readonly writes: string[] = [];
  onLine(listener: (line: string) => void): void { this.line = listener; }
  onExit(listener: (code: number | null) => void): void { this.exit = listener; }
  onError(listener: (error: Error) => void): void { this.error = listener; }
  async write(line: string): Promise<void> { this.writes.push(line); }
  async stop(): Promise<void> { this.exit?.(0); }
  async emit(value: unknown): Promise<void> { this.line?.(JSON.stringify(value)); await new Promise<void>((resolve) => setImmediate(resolve)); }
}

test("the digest-bound Windows helper transport discovers, reads, acknowledges, and reconnects without an ambient device fallback", async () => {
  const root = await mkdtemp(join(tmpdir(), "b122-hid-transport-"));
  try {
    const bin = join(root, "bin"); await mkdir(bin);
    const helperPath = join(bin, "strathex-b122-hid-helper.exe");
    const helperBytes = Buffer.from("deterministic test helper"); await writeFile(helperPath, helperBytes);
    const helperSha256 = createHash("sha256").update(helperBytes).digest("hex");
    const helper = new FakeHelper();
    let launchedPath = ""; let launchedArgs: readonly string[] = [];
    const launcher: RawHidHelperLauncher = { launch: (path, args) => { launchedPath = path; launchedArgs = args; return helper; } };
    const signals: string[] = [];
    const transport = new WindowsRawHidTransport({
      installationRoot: root, helperPath, helperSha256,
      identity: { vendorId: 0x5358, productId: 0xb122, usagePage: 0xff60, usage: 0x61, serialNumber: "B122-A" },
      launcher,
      onSignal: async (_device, signal) => { signals.push(`${signal.control}:${signal.modifier}`); },
    });
    await transport.start();
    assert.equal(launchedPath, await realpath(helperPath));
    assert.deepEqual(launchedArgs, ["--vendor-id", "21336", "--product-id", "45346", "--usage-page", "65376", "--usage", "97", "--serial", "B122-A"]);

    const deviceId = "a".repeat(64);
    const firmware = new B122FirmwareProtocolSimulator({ connectionEpoch: 1, bootNonce: 21 });
    await helper.emit({ type: "connected", deviceId });
    await helper.emit({ type: "frame", deviceId, frame: Buffer.from(firmware.hello()).toString("base64") });
    firmware.receive(Buffer.from(JSON.parse(helper.writes.pop()!).frame, "base64"));
    await helper.emit({ type: "frame", deviceId, frame: Buffer.from(firmware.signal("PROOF", "shift")).toString("base64") });
    assert.deepEqual(signals, ["PROOF:shift"]);
    assert.equal(JSON.parse(helper.writes.at(-1)!).deviceId, deviceId);

    await helper.emit({ type: "disconnected", deviceId });
    firmware.reconnect(22);
    await helper.emit({ type: "connected", deviceId });
    await helper.emit({ type: "frame", deviceId, frame: Buffer.from(firmware.hello()).toString("base64") });
    firmware.receive(Buffer.from(JSON.parse(helper.writes.pop()!).frame, "base64"));
    assert.equal(firmware.isHandshakeComplete(), true);
    await transport.stop();
  } finally { await rm(root, { recursive: true, force: true }); }
});

test("the Windows helper transport rejects a changed native binary before launch", async () => {
  const root = await mkdtemp(join(tmpdir(), "b122-hid-digest-"));
  try {
    const helperPath = join(root, "helper.exe"); await writeFile(helperPath, "changed");
    const transport = new WindowsRawHidTransport({
      installationRoot: root, helperPath, helperSha256: "0".repeat(64),
      identity: { vendorId: 1, productId: 2, usagePage: 3, usage: 4 },
      launcher: { launch: () => { throw new Error("must not launch"); } }, onSignal: async () => undefined,
    });
    await assert.rejects(() => transport.start(), /digest mismatch/i);
  } finally { await rm(root, { recursive: true, force: true }); }
});

test("durable acceptance failure withholds ACK and replay commit so the exact retry can succeed", async () => {
  const root = await mkdtemp(join(tmpdir(), "b122-hid-durable-"));
  try {
    const helperPath = join(root, "helper.exe"); const bytes = Buffer.from("helper"); await writeFile(helperPath, bytes);
    const helper = new FakeHelper(); let attempts = 0;
    const transport = new WindowsRawHidTransport({
      installationRoot: root, helperPath, helperSha256: createHash("sha256").update(bytes).digest("hex"),
      identity: { vendorId: 1, productId: 2, usagePage: 3, usage: 4 }, launcher: { launch: () => helper },
      onSignal: async () => { attempts += 1; if (attempts === 1) throw new Error("store unavailable"); },
    });
    await transport.start();
    const deviceId = "b".repeat(64); const firmware = new B122FirmwareProtocolSimulator({ connectionEpoch: 1, bootNonce: 31 });
    await helper.emit({ type: "connected", deviceId });
    await helper.emit({ type: "frame", deviceId, frame: Buffer.from(firmware.hello()).toString("base64") });
    firmware.receive(Buffer.from(JSON.parse(helper.writes.pop()!).frame, "base64"));
    const signal = firmware.signal("RUN", "normal");
    await helper.emit({ type: "frame", deviceId, frame: Buffer.from(signal).toString("base64") });
    assert.equal(helper.writes.length, 0);
    await helper.emit({ type: "frame", deviceId, frame: Buffer.from(signal).toString("base64") });
    assert.equal(attempts, 2);
    assert.equal(decodeRawHidFrame(Buffer.from(JSON.parse(helper.writes[0]).frame, "base64"))?.type, "ack");
    await transport.stop();
  } finally { await rm(root, { recursive: true, force: true }); }
});

test("native helper environment contains no ambient PATH or secrets", () => {
  assert.deepEqual(strictWindowsHelperEnvironment({ SystemRoot: "C:\\Windows", WINDIR: "C:\\Windows", PATH: "bad", TOKEN: "secret" }), { SystemRoot: "C:\\Windows", WINDIR: "C:\\Windows" });
});
