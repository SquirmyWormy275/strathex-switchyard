import { createDeviceService } from "../devices.mjs";
export function vialFixture() {
  const deviceId = "d".repeat(64), raw = [[[4, 5]], [[1, 1]]], tapDances = [[0, 0, 0, 0, 200], [0x7777, 0x8888, 0x9999, 0xaaaa, 230]], combos = [[0, 0, 0, 0, 0], [0x7777, 0, 0, 0, 0x8888]], writes = [], state = { deviceTransactions: [], deviceSnapshots: [] };
  const definition = { matrix: { rows: 1, cols: 2 }, layouts: { keymap: [["0,0", "0,1"]] } }, encoders = new Map([["0:0", [4, 5]], ["0:2", [0x7777, 0x8888]], ["1:0", [0, 1]], ["1:2", [6, 7]]]), encoderReads = [];
  const keyOverrides = [[0, 0, 0, 0, 0, 0, 0], [0x7777, 0x8888, 0xabcd, 255, 255, 255, 64]], alternateRepeatKeys = [[0, 0, 0, 0], [0x7777, 0x8888, 255, 128]]; let rulesEnabled = false;
  let disconnected = false, locked = false, failBaseline = false, interrupt = false, unplug = false, corrupt = false, changed = false, protocol = 4;
  let interruptEncoder = false, unplugEncoder = false, corruptEncoder = false, encoderChanged = false;
  const store = { snapshot: async () => structuredClone(state), update: async (_, operation, fn) => { if (operation === "device-baseline" && failBaseline) throw new Error("Synthetic backup failure"); const draft = structuredClone(state), result = await fn(draft); Object.assign(state, draft); return result; } };
  const withDeviceLock = async (_, fn) => fn({ assert() {} });
  const transportFactory = () => ({ close() {}, async request(method) {
    if (method === "list") return disconnected ? [] : [{ id: deviceId, candidateProtocol: "vial" }];
    if (method === "open") return { candidateProtocol: "vial" };
    if (method === "decode-definition") return definition;
    throw Error("Unexpected transport method");
  }, async exchange(bytes) {
    if (disconnected) throw Error("Synthetic unplug"); const r = Buffer.from(bytes);
    if (r[0] === 0xfe) {
      const command = r[1], operation = r[2], index = r[3];
      if (command === 0) { r.fill(0); r.writeUInt32LE(protocol); r.fill(1, 4, 12); }
      else if (command === 1) { r.fill(0); r.writeUInt32LE(1); }
      else if (command === 2) r.fill(0);
      else if (command === 3) { const value = encoders.get(`${operation}:${index}`); encoderReads.push({ layer: operation, index }); if (value) { r.fill(0); r.writeUInt16BE(value[0], 0); r.writeUInt16BE(value[1], 2); if (corruptEncoder && encoderChanged) { corruptEncoder = false; r[0] ^= 1; } } }
      else if (command === 4) { const value = encoders.get(`${operation}:${index}`), direction = r[4], after = r.readUInt16BE(5); writes.push({ kind: "encoder", layer: operation, index, direction, packet: [...r] }); encoderChanged = true; if (interruptEncoder) { interruptEncoder = false; value[direction] = value[direction] & 0xff00 | after & 255; if (unplugEncoder) disconnected = true; throw Error("Synthetic interrupted encoder"); } value[direction] = after; }
      else if (command === 5) { r.fill(255); r[0] = locked ? 0 : 1; r[1] = 0; }
      else if (command === 9) r.fill(255);
      else if (command === 13) {
        if (operation === 0) { r.fill(0); r[0] = tapDances.length; r[1] = combos.length; r[2] = rulesEnabled ? keyOverrides.length : 0; r[3] = rulesEnabled ? alternateRepeatKeys.length : 0; r[31] = 3; }
        else {
          const table = operation <= 2 ? tapDances : operation <= 4 ? combos : operation <= 6 && rulesEnabled ? keyOverrides : operation <= 8 && rulesEnabled ? alternateRepeatKeys : null;
          if (!table) throw Error("Unexpected dynamic table");
          const widths = operation <= 4 ? [2, 2, 2, 2, 2] : operation <= 6 ? [2, 2, 2, 1, 1, 1, 1] : [2, 2, 1, 1];
          const decode = (bytes, offset) => widths.map(width => { const value = bytes.readUIntLE(offset, width); offset += width; return value; });
          if (operation % 2 === 1) { r.fill(0); let at = 1; table[index].forEach((value, i) => { r.writeUIntLE(value, at, widths[i]); at += widths[i]; }); if (corrupt && changed) { corrupt = false; r[1] ^= 1; } }
          else {
            writes.push({ kind: operation === 2 ? "tap-dance" : operation === 4 ? "combo" : operation === 6 ? "key-override" : "alternate-repeat", index, packet: [...r] }); changed = true;
            const after = decode(r, 4);
            if (interrupt) { interrupt = false; const partial = Buffer.alloc(widths.reduce((n, width) => n + width, 0)); let at = 0; table[index].forEach((value, i) => { partial.writeUIntLE(value, at, widths[i]); at += widths[i]; }); r.copy(partial, 0, 4, 7); table[index] = decode(partial, 0); if (unplug) disconnected = true; throw Error("Synthetic interrupted dynamic entry"); }
            table[index] = after; r.fill(0);
          }
        }
      } else throw Error("Unexpected Vial command");
      return r;
    }
    if (r[0] === 1) { r.writeUInt16BE(9, 1); return r; }
    if (r[0] === 0x11) { r[1] = 2; return r; }
    if (r[0] === 0x12) { const p = Buffer.alloc(8); raw.flat(2).forEach((v, i) => p.writeUInt16BE(v, i * 2)); p.copy(r, 4, r.readUInt16BE(1), r.readUInt16BE(1) + r[3]); return r; }
    if ([0x0c, 0x0d].includes(r[0])) { r.fill(0, 1); return r; }
    if (r[0] === 2) { r.writeUInt32BE(0, 2); return r; }
    if (r[0] === 5) { writes.push({ kind: "key", layer: r[1], row: r[2], col: r[3] }); raw[r[1]][r[2]][r[3]] = r.readUInt16BE(4); return r; }
    if (r[0] === 4) { r.writeUInt16BE(raw[r[1]][r[2]][r[3]], 4); return r; }
    throw Error("Unexpected VIA command");
  } });
  const options = { store, transportFactory, withDeviceLock };
  return { deviceId, raw, keyOverrides, alternateRepeatKeys, enableRules: () => { rulesEnabled = true; }, definition, encoders, encoderReads, tapDances, combos, writes, state, options, service: createDeviceService(options), interrupt: (disconnect = false) => { interrupt = true; unplug = disconnect; }, interruptEncoder: (disconnect = false) => { interruptEncoder = true; unplugEncoder = disconnect; }, corruptEncoder: () => { corruptEncoder = true; }, reconnect: () => { disconnected = false; }, corrupt: () => { corrupt = true; }, locked: () => { locked = true; }, backupFailure: () => { failBaseline = true; }, protocol: (v) => { protocol = v; } };
}
