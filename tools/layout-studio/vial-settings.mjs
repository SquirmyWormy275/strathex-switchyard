/** Standard QMK setting wire facts; reset/calibration/vendor commands excluded. */
const integer = (v, max) => Number.isInteger(v) && v >= 0 && v <= max;
const spec = (name, width, max, mask = 2 ** (width * 8) - 1) => Object.freeze({ name, width, max, mask });
export const qmkSettings = Object.freeze({
  1: spec("Grave/Escape modifier flags", 1, 15, 15), 2: spec("Combo timeout (ms)", 2, 10000),
  3: spec("Automatic shift flags", 1, 127, 127), 4: spec("Automatic shift timeout (ms)", 2, 1000),
  5: spec("One-shot repeat count", 1, 50), 6: spec("One-shot release timeout (ms)", 2, 60000),
  7: spec("Tap/hold threshold (ms)", 2, 10000), 8: spec("Legacy tap/hold flags", 1, 15, 15),
  9: spec("Mouse-key initial delay (ms)", 2, 10000), 10: spec("Mouse-key interval (ms)", 2, 10000),
  11: spec("Mouse-key step", 2, 1000), 12: spec("Mouse-key maximum speed", 2, 1000),
  13: spec("Mouse-key acceleration interval", 2, 1000), 14: spec("Wheel-key initial delay (ms)", 2, 10000),
  15: spec("Wheel-key interval (ms)", 2, 10000), 16: spec("Wheel-key maximum steps", 2, 1000),
  17: spec("Wheel-key acceleration interval", 2, 1000), 18: spec("Tap output delay (ms)", 2, 1000),
  19: spec("Caps tap/hold delay (ms)", 2, 1000), 20: spec("Tap-toggle repeat count", 1, 100),
  21: spec("Modifier/rollover mapping flags", 4, 1023, 1023), 22: spec("Permissive hold", 1, 1, 1),
  23: spec("Hold on another keypress", 1, 1, 1), 24: spec("Retroactive tapping", 1, 1, 1),
  25: spec("Quick-tap threshold (ms)", 2, 10000), 26: spec("Chordal hold", 1, 1, 1),
  27: spec("Flow-tap threshold (ms)", 2, 10000)
});
const packet = (...bytes) => { const b = Buffer.alloc(32); Buffer.from(bytes).copy(b); return [...b]; };
export const qmkSettingsSchema = "switchyard-vial-qmk-settings/v1";
function assertCodec(c) {
  const s = Number.isInteger(c?.id) && Object.hasOwn(qmkSettings, c.id) ? qmkSettings[c.id] : null;
  if (!s || c.codec !== qmkSettingsSchema || c.width !== s.width || c.mask !== s.mask || !integer(c.before, 2 ** (s.width * 8) - 1) || !integer(c.after, 2 ** (s.width * 8) - 1)) throw new Error("The saved QMK setting codec is unsupported. Preserve the baseline and use a compatible build for recovery.");
  return s;
}
export async function readQmkSetting(transport, id) {
  const s = qmkSettings[id]; if (!s || !Number.isInteger(id)) throw new Error("That standard QMK setting has no verified codec.");
  const r = await transport.exchange(packet(0xfe, 0x0a, id & 255, id >> 8));
  if (r.length !== 32 || r[0] !== 0) throw new Error("The firmware did not return the requested standard QMK setting.");
  return r.readUIntLE(1, s.width);
}
export async function readQmkSettings(transport, protocol) {
  if (protocol < 4) return { schema: qmkSettingsSchema, availability: "not-supported", supportedIds: [], values: {} };
  try {
    const supported = new Set(); let cursor = 0, complete = false;
    for (let page = 0; page < 16 && !complete; page++) {
      const r = await transport.exchange(packet(0xfe, 9, cursor & 255, cursor >> 8));
      if (r.length !== 32) throw new Error("Setting enumeration has an invalid packet size.");
      let next = cursor;
      for (let offset = 0; offset < 32; offset += 2) {
        const id = r.readUInt16LE(offset);
        if (id === 0xffff) { complete = true; continue; }
        if (complete || id <= cursor || supported.has(id)) throw new Error("Setting enumeration is not a bounded advancing query.");
        supported.add(id); next = Math.max(next, id);
      }
      if (!complete && next <= cursor) throw new Error("Setting enumeration did not advance.");
      cursor = next;
    }
    if (!complete) throw new Error("Setting enumeration exceeds 256 IDs.");
    const supportedIds = [...supported].sort((a, b) => a - b), values = {};
    for (const id of supportedIds) if (Object.hasOwn(qmkSettings, id)) values[id] = await readQmkSetting(transport, id);
    return { schema: qmkSettingsSchema, availability: "verified", supportedIds, values, unsupportedIds: supportedIds.filter((id) => !Object.hasOwn(qmkSettings, id)) };
  } catch { return { schema: qmkSettingsSchema, availability: "unverified", supportedIds: [], values: {}, reason: "The optional standard QMK setting query/read contract was not verified. No setting writes are available." }; }
}
export function settingChanges(snapshot, edits) {
  if (edits === undefined) return [];
  if (!snapshot.identity.vialProtocol || snapshot.identity.vialProtocol < 4 || snapshot.qmkSettings?.schema !== qmkSettingsSchema || snapshot.qmkSettings?.availability !== "verified") throw new Error("Standard QMK settings require a verified Vial 4+ setting readout.");
  if (!Array.isArray(edits) || !edits.length || edits.length > 32) throw new Error("Review 1–32 standard QMK setting changes.");
  const seen = new Set();
  return edits.map((e) => {
    const s = Number.isInteger(e?.id) && Object.hasOwn(qmkSettings, e.id) ? qmkSettings[e.id] : null;
    if (!s || !Object.hasOwn(snapshot.qmkSettings.values, e.id) || !integer(e.value, s.max) || !integer(e.before, 2 ** (s.width * 8) - 1) || Object.keys(e).some((k) => !["id", "before", "value"].includes(k))) throw new Error("Choose an advertised standard QMK setting and its bounded reviewed value. Reset, calibration and vendor IDs are prohibited.");
    if (seen.has(e.id)) throw new Error("A QMK setting is changed twice."); seen.add(e.id);
    if (e.before !== snapshot.qmkSettings.values[e.id]) throw new Error("The QMK setting changed since this proposal was prepared.");
    const after = ((e.before & ~s.mask) | (e.value & s.mask)) >>> 0;
    return { codec: qmkSettingsSchema, id: e.id, name: s.name, width: s.width, mask: s.mask, before: e.before, after };
  }).filter((c) => c.before !== c.after);
}
const bytes = (value, width) => { const b = Buffer.alloc(width); b.writeUIntLE(value, 0, width); return b; };
export function verifyOwnedSetting(current, change) {
  assertCodec(change);
  if (!Number.isInteger(current) || current < 0 || current > 2 ** (change.width * 8) - 1) throw new Error("The owned QMK setting is unavailable for recovery.");
  const found = bytes(current, change.width), before = bytes(change.before, change.width), after = bytes(change.after, change.width), mask = bytes(change.mask, change.width);
  if (found.some((v, i) => (v & mask[i]) !== (before[i] & mask[i]) && (v & mask[i]) !== (after[i] & mask[i]))) throw new Error("A QMK setting changed outside this transaction. Review before restoring.");
}
export function validateSettingsRestore(snapshot, changes = []) {
  if (changes.length && snapshot.qmkSettings?.availability !== "verified") throw new Error("The original standard QMK setting surface is unavailable for restoration.");
  for (const c of changes) verifyOwnedSetting(snapshot.qmkSettings.values[c.id], c);
}
export function settingsReadback(snapshot, changes = [], target = "after") {
  if (changes.length && snapshot.qmkSettings?.availability !== "verified") throw new Error("Standard QMK setting readback is unavailable.");
  for (const c of changes) if (((snapshot.qmkSettings.values[c.id] & c.mask) >>> 0) !== ((c[target] & c.mask) >>> 0) || !Object.hasOwn(snapshot.qmkSettings.values, c.id)) throw new Error("Standard QMK setting readback mismatch.");
}
export async function writeQmkSetting(transport, change, target = "after") {
  assertCodec(change);
  if (!["before", "after"].includes(target)) throw new Error("This QMK setting write does not match the standard codec.");
  const current = await readQmkSetting(transport, change.id); verifyOwnedSetting(current, change);
  const value = ((current & ~change.mask) | (change[target] & change.mask)) >>> 0;
  if (value === current) return;
  const r = await transport.exchange(packet(0xfe, 0x0b, change.id & 255, change.id >> 8, ...bytes(value, change.width)));
  if (r.length !== 32 || r[0] !== 0 || await readQmkSetting(transport, change.id) !== value) throw new Error("Standard QMK setting write was not acknowledged and read back.");
}
