/** Independent protocol implementation; never conflate Vial with original xwhatsit. */
import { spawn } from "node:child_process";
import { homedir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { randomUUID, createHash } from "node:crypto";
import { additionalDeviceChanges, validateAdditionalRestore, restoredLayoutOptions } from "./device-proposal.mjs";
import { withStateLock } from "./state-lock.mjs";
import { compileDeviceKey, baseTypingCode } from "./vial-keycodes.mjs";
import { runtimeEnvironment } from "./runtime-setup.mjs";
import { readQmkSettings, writeQmkSetting, settingsReadback } from "./vial-settings.mjs";

const digest = (v) => createHash("sha256").update(JSON.stringify(v)).digest("hex");
const integer = (v, max) => Number.isInteger(v) && v >= 0 && v <= max;
const packet = (...bytes) => { const b = Buffer.alloc(32); Buffer.from(bytes).copy(b); return [...b]; };

export class NativeHidTransport {
  constructor({ executable = join(homedir(), ".local/share/strathex-switchyard/voice", process.platform === "win32" ? "venv/Scripts/python.exe" : "venv/bin/python"), spawnProcess = spawn } = {}) {
    this.sequence = 0; this.pending = new Map(); this.buffer = ""; this.closed = false;
    this.child = spawnProcess(executable, ["-I", fileURLToPath(new URL("./hid-bridge.py", import.meta.url))], { shell: false, windowsHide: true, stdio: ["pipe", "pipe", "ignore"], env: runtimeEnvironment() });
    this.child.stdout.setEncoding("utf8");
    this.child.stdout.on("data", (chunk) => {
      this.buffer += chunk; if (this.buffer.length > 1048576) { this.close(); return; }
      let end;
      while ((end = this.buffer.indexOf("\n")) >= 0) { const line = this.buffer.slice(0, end); this.buffer = this.buffer.slice(end + 1); let m; try { m = JSON.parse(line); } catch { this.close(); return; } const p = this.pending.get(m.id); if (!p) continue; this.pending.delete(m.id); clearTimeout(p.timer); m.error ? p.reject(new Error(m.error)) : p.resolve(m.result); }
    });
    this.child.on("error", () => this.close()); this.child.on("close", () => this.close()); this.child.stdin.on("error", () => this.close());
  }
  request(method, body = {}) {
    if (this.closed) return Promise.reject(new Error("Device transport is closed. Reconnect and read the exact device again."));
    return new Promise((resolve, reject) => { const id = ++this.sequence; const timer = setTimeout(() => { this.pending.delete(id); reject(new Error("Device request timed out.")); }, 5000); this.pending.set(id, { resolve, reject, timer }); this.child.stdin.write(`${JSON.stringify({ id, method, ...body })}\n`); });
  }
  async exchange(bytes, read = true) { return Buffer.from(await this.request("exchange", { packet: bytes, read })); }
  async read() { return Buffer.from(await this.request("read")); }
  close() { if (this.closed) return; this.closed = true; this.child.kill(); for (const p of this.pending.values()) { clearTimeout(p.timer); p.reject(new Error("Device transport disconnected. Restoration may be pending until the same device returns.")); } this.pending.clear(); }
}

export class VialDevice {
  constructor(transport, deviceId) { this.transport = transport; this.deviceId = deviceId; }
  async identity() {
    const opened = await this.transport.request("open", { deviceId: this.deviceId });
    if (opened.candidateProtocol !== "vial") throw new Error("This interface uses a different protocol; Vial operations are prohibited.");
    const via = await this.transport.exchange(packet(1));
    if (via[0] !== 1 || via.readUInt16BE(1) !== 9) throw new Error("This VIA protocol version is unsupported.");
    const vial = await this.transport.exchange(packet(0xFE, 0));
    const version = vial.readUInt32LE(0), keyboardId = vial.subarray(4, 12).toString("hex");
    if (version < 1 || version > 6 || /^0+$/.test(keyboardId)) throw new Error("This Vial identity/version is unsupported.");
    return { deviceId: this.deviceId, keyboardId, viaProtocol: 9, vialProtocol: version, controller: "unverified", interface: "configuration Raw HID", capabilities: ["dynamic-keymap", "macro-buffer", "layout-options"], firmwareRecovery: "Configuration readout only; no firmware image readback or flashing is provided." };
  }
  async unlocked() { const r = await this.transport.exchange(packet(0xFE, 5)); return r[0] === 1; }
  async unlockStatus() { const r = await this.transport.exchange(packet(0xFE, 5)); return { unlocked: r[0] === 1, inProgress: r[1] === 1, physicalKeys: [...r.subarray(2)].reduce((a, v, i, all) => { if (i % 2 === 0 && v !== 255 && all[i + 1] !== 255) a.push([v, all[i + 1]]); return a; }, []) }; }
  async beginUnlock() { await this.transport.exchange(packet(0xFE, 6)); return this.unlockStatus(); }
  async pollUnlock() { await this.transport.exchange(packet(0xFE, 7)); return this.unlockStatus(); }
  async snapshot() {
    const identity = await this.identity();
    const size = (await this.transport.exchange(packet(0xFE, 1))).readUInt32LE(0);
    if (size < 1 || size > 65536) throw new Error("The device definition size is unsupported.");
    const parts = [];
    for (let page = 0; page * 32 < size; page++) parts.push(await this.transport.exchange(packet(0xFE, 2, page & 255, page >> 8)));
    const definition = await this.transport.request("decode-definition", { data: Buffer.concat(parts).subarray(0, size).toString("base64") });
    const rows = definition?.matrix?.rows, cols = definition?.matrix?.cols;
    if (!integer(rows, 32) || !integer(cols, 32) || !rows || !cols || rows * cols > 512) throw new Error("The verified definition has unsupported matrix dimensions.");
    const lc = await this.transport.exchange(packet(0x11)), layers = lc[1];
    if (lc[0] !== 0x11 || layers < 1 || layers > 32) throw new Error("The device layer count is unsupported.");
    const bytes = layers * rows * cols * 2; if (bytes > 32768) throw new Error("The device keymap exceeds the supported bound.");
    const map = await this.readBuffer(0x12, bytes);
    const keymap_raw = Array.from({ length: layers }, (_, l) => Array.from({ length: rows }, (_, r) => Array.from({ length: cols }, (_, c) => map.readUInt16BE(((l * rows + r) * cols + c) * 2))));
    const macroCount = (await this.transport.exchange(packet(0x0C)))[1], macroBytes = (await this.transport.exchange(packet(0x0D))).readUInt16BE(1);
    if (macroBytes > 8192 || macroCount > 128) throw new Error("Device macro limits are unsupported.");
    const macro = macroBytes ? (await this.readBuffer(0x0E, macroBytes)).toString("base64") : "";
    const layout = await this.transport.exchange(packet(2, 2));
    if (layout[0] !== 2 || layout[1] !== 2) throw new Error("Layout option readback is unsupported.");
    const qmkSettings = await readQmkSettings(this.transport, identity.vialProtocol);
    return { schema: "switchyard-device-snapshot/v1", identity, capturedAt: new Date().toISOString(), definition, rows, cols, layers, keymap_raw, macroCount, macroBytes, macro, layoutOptions: layout.readUInt32BE(2), qmkSettings, configurationOnly: true };
  }
  async readBuffer(command, length) { const chunks = []; for (let offset = 0; offset < length; offset += 28) { const size = Math.min(28, length - offset), r = await this.transport.exchange(packet(command, offset >> 8, offset & 255, size)); if (r[0] !== command || r[1] !== (offset >> 8) || r[2] !== (offset & 255) || r[3] !== size) throw new Error("Device buffer response does not match the requested range."); chunks.push(r.subarray(4, 4 + size)); } return Buffer.concat(chunks); }
  async writeKey(change) { const r = await this.transport.exchange(packet(5, change.layer, change.row, change.col, change.after >> 8, change.after & 255)); if (r[0] !== 5) throw new Error("The device rejected a keymap write."); const check = await this.transport.exchange(packet(4, change.layer, change.row, change.col)); if (check[0] !== 4 || check.readUInt16BE(4) !== change.after) throw new Error("Keymap write readback mismatch."); }
  async writeMacros(data, baseline) {
    if (!await this.unlocked()) throw new Error("Unlock the keyboard physically before changing macros.");
    if (!Buffer.isBuffer(data) || data.length !== baseline.macroBytes || data.length < 2 || data.at(-1) !== 0) throw new Error("Macro buffer must preserve the verified storage size and committed sentinel.");
    const range = async (offset, bytes) => {
      const r = await this.transport.exchange(packet(0x0F, offset >> 8, offset & 255, bytes.length, ...bytes));
      if (r[0] !== 0x0F || r.readUInt16BE(1) !== offset || r[3] !== bytes.length) throw new Error("Macro range write was not acknowledged.");
    };
    // QMK's last-byte sentinel disables macro execution until the complete body
    // is written and verified. A disconnect must leave macros disabled.
    await range(data.length - 1, Buffer.from([255]));
    if ((await this.readBuffer(0x0E, data.length)).at(-1) !== 255) throw new Error("The macro execution guard was not read back.");
    for (let offset = 0; offset < data.length - 1; offset += 28) await range(offset, data.subarray(offset, Math.min(offset + 28, data.length - 1)));
    const guarded = await this.readBuffer(0x0E, data.length);
    if (guarded.at(-1) !== 255 || !guarded.subarray(0, -1).equals(data.subarray(0, -1))) throw new Error("Macro body readback failed; execution remains disabled pending restoration.");
    await range(data.length - 1, Buffer.from([0]));
    if (!(await this.readBuffer(0x0E, data.length)).equals(data)) throw new Error("Macro commit readback mismatch.");
  }
  async writeLayoutOptions(value) {
    if (!Number.isInteger(value) || value < 0 || value > 0xffffffff || !await this.unlocked()) throw new Error("Physical layout options require a verified value and physical unlock.");
    const bytes = Buffer.alloc(4); bytes.writeUInt32BE(value);
    const r = await this.transport.exchange(packet(3, 2, ...bytes));
    if (r[0] !== 3 || r[1] !== 2) throw new Error("Physical layout write was not acknowledged.");
    const check = await this.transport.exchange(packet(2, 2));
    if (check[0] !== 2 || check[1] !== 2 || check.readUInt32BE(2) !== value) throw new Error("Physical layout write readback mismatch.");
  }
  async writeSetting(change, target = "after") { if (!await this.unlocked()) throw new Error("Unlock the keyboard physically before changing a standard QMK setting."); return writeQmkSetting(this.transport, change, target); }
}

/** Original 0.9.0 has 8-byte state streams and 8-bit scancodes, not Vial. */
export class OriginalXwhatsitDevice {
  constructor(transport, deviceId) { this.transport = transport; this.deviceId = deviceId; }
  async select(state) { await this.transport.exchange([0, 0, 0, 0, 0, 0, 0, 0], false); await this.transport.exchange([0, state, 0, 0, 0, 0, 0, 0], false); for (let n = 0; n < 64; n++) { const r = await this.transport.read(); if (r[0] === state) return r; } throw new Error("Original xwhatsit state stream did not synchronize."); }
  async snapshot() {
    const identity = await this.transport.request("open", { deviceId: this.deviceId });
    if (identity.candidateProtocol !== "original-xwhatsit-0.9") throw new Error("Original xwhatsit operations are prohibited on this interface.");
    try {
      const version = (await this.select(9)).subarray(1, 7).toString("ascii").replace(/\0.*$/, "").trim();
      if (version !== "0.9.0") throw new Error("This original xwhatsit firmware version has not been verified by this adapter.");
      const info = await this.select(1), layers = info[1], cols = info[3], rows = info[4], type = info[5];
      if (layers < 1 || layers > 4 || cols < 1 || cols > 32 || rows < 1 || rows > 8 || ![1, 2, 3].includes(type)) throw new Error("The original controller's reported model/matrix is unsupported.");
      const keymap_raw = Array.from({ length: layers }, () => Array.from({ length: rows }, () => Array(cols).fill(null)));
      let r = await this.select(7); const seen = new Set();
      for (let n = 0; n < layers * cols * 2 + 64; n++) {
        if (r[0] === 7) { const layer = r[1] >> 6, slice = (r[1] >> 5) & 1, col = r[1] & 31; if (layer >= layers || col >= cols) throw new Error("Original keymap framing is invalid."); for (let i = 0; i < 4; i++) if (slice * 4 + i < rows) { keymap_raw[layer][slice * 4 + i][col] = r[i + 2]; seen.add(`${layer}:${slice * 4 + i}:${col}`); } }
        if (seen.size === layers * rows * cols) break; r = await this.transport.read();
      }
      if (seen.size !== layers * rows * cols) throw new Error("Original keymap snapshot is incomplete.");
      return { schema: "switchyard-device-snapshot/v1", identity: { deviceId: this.deviceId, protocol: "original-xwhatsit-0.9", firmwareVersion: version, controller: "original xwhatsit protocol; hardware revision unverified", keyboardType: type }, rows, cols, layers, keymap_raw, configurationOnly: true, capturedAt: new Date().toISOString() };
    } finally { await this.transport.exchange([0, 0, 0, 0, 0, 0, 0, 0], false).catch(() => {}); }
  }
  async writeKey(change) { if (change.after > 255) throw new Error("Original xwhatsit uses 8-bit scancodes, not QMK keycodes."); await this.transport.exchange([5, (change.layer << 6) | change.col, change.row, change.after, 0, 0, 0, 0], false); await this.transport.exchange([8, 1, 0, 0, 0, 0, 0, 0], false); }
}

export function validateDeviceChanges(snapshot, changes) {
  if (!Array.isArray(changes) || !changes.length || changes.length > 64) throw new Error("Review 1–64 bounded key changes at a time.");
  const seen = new Set(), candidate = structuredClone(snapshot.keymap_raw);
  const parsed = changes.map((c) => {
    if (!c || !integer(c.layer, snapshot.layers - 1) || !integer(c.row, snapshot.rows - 1) || !integer(c.col, snapshot.cols - 1)) throw new Error("A key change exceeds the verified matrix/layer. Firmware control codes are prohibited.");
    const slot = `${c.layer}:${c.row}:${c.col}`; if (seen.has(slot)) throw new Error("A device key is changed twice."); seen.add(slot);
    const before = snapshot.keymap_raw[c.layer][c.row][c.col];
    if (c.before !== before) throw new Error("The keymap changed since this proposal was prepared.");
    const after = compileDeviceKey(snapshot, c.after);
    candidate[c.layer][c.row][c.col] = after; return { layer: c.layer, row: c.row, col: c.col, before, after };
  });
  const required = new Set(snapshot.keymap_raw[0].flat().filter((code) => code > 1).map((code) => baseTypingCode(snapshot, code)));
  const remaining = new Set(candidate[0].flat().map((code) => baseTypingCode(snapshot, code)));
  if ([...required].some((code) => !remaining.has(code))) throw new Error("This proposal removes an ordinary base-layer key without a fallback. Keep a complete typing layer.");
  return parsed;
}

export function createDeviceService({ store, transportFactory = () => new NativeHidTransport(), now = () => Date.now(), withDeviceLock = (id, fn) => withStateLock(join(process.env.XDG_STATE_HOME || (process.platform === "win32" ? process.env.LOCALAPPDATA : null) || join(homedir(), ".local/state"), "strathex-switchyard", "device-access", id), "hid", fn) } = {}) {
  const reviews = new Map(), busy = new Set();
  async function using(deviceId, fn) {
    if (typeof deviceId !== "string" || !/^[a-f0-9]{64}$/.test(deviceId)) throw new Error("Select an exact discovered configuration interface.");
    if (busy.has(deviceId)) throw new Error("A configuration transaction already owns this device."); busy.add(deviceId);
    try { return await withDeviceLock(deviceId, async (lease) => {
      const t = transportFactory(), checked = Object.fromEntries(["request", "exchange", "read"].map((method) => [method, (...args) => { lease.assert(); return t[method](...args); }]));
      try {
        const list = await checked.request("list"), matches = list.filter((d) => d.id === deviceId);
        if (matches.length !== 1) throw new Error("The selected keyboard is disconnected or its identity is ambiguous.");
        const protocol = matches[0].candidateProtocol;
        if (!["vial", "original-xwhatsit-0.9"].includes(protocol)) throw new Error("The discovered interface protocol is unsupported.");
        return await fn(protocol === "vial" ? new VialDevice(checked, deviceId) : new OriginalXwhatsitDevice(checked, deviceId));
      } finally { t.close(); }
    }); } finally { busy.delete(deviceId); }
  }
  async function restore(compartment, id) {
    const s = await store.snapshot(compartment), tx = s.deviceTransactions?.find((t) => t.id === id);
    if (!tx || !["applied", "applying", "recovery-pending"].includes(tx.status)) throw new Error("That device transaction is unavailable for restoration.");
    return using(tx.baseline.identity.deviceId, async (device) => {
      try {
        const current = await device.snapshot();
        if (digest(current.identity) !== digest(tx.baseline.identity)) throw new Error("A different device identity returned.");
        if (device instanceof VialDevice && !await device.unlocked()) throw new Error("The keyboard is locked. Complete physical unlock before restoration.");
        for (const c of tx.changes) if (![c.before, c.after].includes(current.keymap_raw[c.layer][c.row][c.col])) throw new Error("A key changed outside this transaction. Review before restoring.");
        validateAdditionalRestore(current, tx);
        for (const c of tx.qmkSettings ?? []) await device.writeSetting(c, "before");
        if (tx.macro && current.macro !== tx.macro.before) await device.writeMacros(Buffer.from(tx.macro.before, "base64"), tx.baseline);
        if (tx.layout) { const value = restoredLayoutOptions(current.layoutOptions, tx.layout); if (value !== current.layoutOptions) await device.writeLayoutOptions(value); }
        for (const c of tx.changes) if (current.keymap_raw[c.layer][c.row][c.col] !== c.before) await device.writeKey({ ...c, after: c.before });
        const readback = await device.snapshot();
        for (const c of tx.changes) if (readback.keymap_raw[c.layer][c.row][c.col] !== c.before) throw new Error("Restoration readback failed.");
        if (tx.macro && readback.macro !== tx.macro.before) throw new Error("Macro restoration readback failed.");
        if (tx.layout && readback.layoutOptions !== restoredLayoutOptions(current.layoutOptions, tx.layout)) throw new Error("Layout option restoration readback failed.");
        settingsReadback(readback, tx.qmkSettings, "before");
        await store.update(compartment, "device-restore", (s) => { s.deviceTransactions.find((t) => t.id === id).status = "restored"; });
        return { id, status: "restored", hardwareAcceptance: "readback only; ordinary typing and physical trial still required" };
      } catch (e) { await store.update(compartment, "device-recovery-pending", (s) => { s.deviceTransactions.find((t) => t.id === id).status = "recovery-pending"; }); throw e; }
    }).catch(async (error) => { await store.update(compartment, "device-recovery-pending", (s) => { s.deviceTransactions.find((t) => t.id === id).status = "recovery-pending"; }); throw error; });
  }
  return {
    async list() { const t = transportFactory(); try { return (await t.request("list")).map(({ path, serial_number, ...d }) => d); } finally { t.close(); } },
    async read(compartment, deviceId) { return using(deviceId, async (d) => { const snapshot = await d.snapshot(); await store.update(compartment, "device-read", (s) => { s.deviceSnapshots ??= []; s.deviceSnapshots = [...s.deviceSnapshots.filter((v) => v.identity.deviceId !== deviceId), snapshot].slice(-16); }); return snapshot; }); },
    async review(compartment, deviceId, value) {
      const input = Array.isArray(value) ? { changes: value } : value;
      if (!input || typeof input !== "object" || Array.isArray(input) || Object.keys(input).some((k) => !["changes", "macros", "layoutOptions", "qmkSettings"].includes(k))) throw new Error("Review a supported bounded configuration proposal.");
      const baseline = await this.read(compartment, deviceId), parsed = input.changes === undefined ? [] : validateDeviceChanges(baseline, input.changes), additional = additionalDeviceChanges(baseline, input), id = randomUUID();
      if (!parsed.length && !additional.macro && !additional.layout && !additional.qmkSettings.length) throw new Error("The configuration proposal is empty.");
      reviews.set(id, { compartment, baseline, changes: parsed, ...additional, expires: now() + 120000 });
      return { reviewId: id, changes: parsed, macros: additional.macro?.slots ?? [], layoutOptions: additional.layout, qmkSettings: additional.qmkSettings, configurationOnly: true, note: "Release all keys and close other keyboard configuration tools. Complete physical unlock if required. The exact baseline is saved encrypted before any write. Onboard macros type into the foreground; they are not session-aware agent controls. Layout choices do not move physical keys. Settings can change tap/hold, repeat, modifier and rollover behavior; verify ordinary typing afterward. Firmware/solenoid/bootloader operations are excluded." };
    },
    async apply(compartment, reviewId) {
      const r = reviews.get(reviewId); reviews.delete(reviewId);
      if (!r || r.compartment !== compartment || now() > r.expires) throw new Error("This device review expired or was already used.");
      const id = randomUUID();
      try {
        return await using(r.baseline.identity.deviceId, async (d) => {
          const current = await d.snapshot();
          if (digest({ ...current, capturedAt: null }) !== digest({ ...r.baseline, capturedAt: null })) throw new Error("Device configuration or identity changed after review. Nothing was written.");
          if (d instanceof VialDevice && !await d.unlocked()) throw new Error("Configuration is locked. Perform the device's physical unlock and review again.");
          await store.update(compartment, "device-baseline", (s) => { s.deviceTransactions ??= []; s.deviceTransactions.push({ id, baseline: r.baseline, changes: r.changes, macro: r.macro, layout: r.layout, qmkSettings: r.qmkSettings, status: "applying", createdAt: Date.now() }); });
          for (const c of r.qmkSettings ?? []) await d.writeSetting(c);
          if (r.macro) await d.writeMacros(Buffer.from(r.macro.after, "base64"), r.baseline);
          if (r.layout) await d.writeLayoutOptions(r.layout.after);
          for (const change of r.changes) await d.writeKey(change);
          const after = await d.snapshot();
          for (const c of r.changes) if (after.keymap_raw[c.layer][c.row][c.col] !== c.after) throw new Error("Device write readback mismatch.");
          if (r.macro && after.macro !== r.macro.after) throw new Error("Device macro readback mismatch.");
          if (r.layout && after.layoutOptions !== r.layout.after) throw new Error("Device layout option readback mismatch.");
          settingsReadback(after, r.qmkSettings);
          await store.update(compartment, "device-apply", (s) => { s.deviceTransactions.find((t) => t.id === id).status = "applied"; });
          return { id, status: "applied", ordinaryTypingTrial: "pending" };
        });
      } catch (error) {
        const saved = (await store.snapshot(compartment)).deviceTransactions?.some((t) => t.id === id);
        if (saved) { try { await restore(compartment, id); } catch { throw new Error(`${error.message} Restoration is pending until the exact device is available and unlocked.`); } }
        throw error;
      }
    },
    restore,
    async unlock(deviceId, operation) { return using(deviceId, async (d) => { if (!(d instanceof VialDevice)) throw new Error("Physical Vial unlock does not apply to this protocol."); await d.identity(); if (operation === "start") return d.beginUnlock(); if (operation === "poll") return d.pollUnlock(); return d.unlockStatus(); }); }
  };
}
