/** Definition-advertised encoder directions; no matrix identity or device count guesses. */
import { compileDeviceKey } from "./vial-keycodes.mjs";
export const encoderSchema = "switchyard-vial-encoders/v1";
const changeSchema = "switchyard-vial-encoder-change/v1";
const integer = (v, max) => Number.isInteger(v) && v >= 0 && v <= max;
const packet = (...bytes) => { const p = Buffer.alloc(32); Buffer.from(bytes).copy(p); return [...p]; };
export function encoderIndices(definition) {
  const rows = definition?.layouts?.keymap, indices = new Set(); let alignment = 4, count = 0;
  if (!Array.isArray(rows) || rows.length > 128) throw new Error("Encoder identification requires a bounded Vial KLE definition.");
  for (const row of rows) {
    if (!Array.isArray(row)) { if (row && typeof row === "object") continue; throw new Error("The encoder definition row is unsupported."); }
    if (row.length > 512) throw new Error("The encoder definition row is unsupported.");
    for (const item of row) {
      if (++count > 4096) throw new Error("The encoder definition exceeds the supported key bound.");
      if (item && typeof item === "object" && !Array.isArray(item)) {
        if (item.a !== undefined) { if (!integer(item.a, 7)) throw new Error("The KLE alignment is invalid."); alignment = item.a; }
        continue;
      }
      if (typeof item !== "string" || item.length > 1024 || item.includes("\0")) throw new Error("The encoder definition label is invalid.");
      const labels = item.split("\n");
      if (labels.length > 12) throw new Error("The encoder label count exceeds the verified KLE format.");
      if (![0, 4].includes(alignment)) { if (labels.includes("e")) throw new Error("This centered encoder definition has no verified matrix-independent index codec."); continue; }
      // At KLE alignments 0 and 4: raw 0 -> normalized 0 (index/direction),
      // raw 9 -> normalized 4 (encoder marker). Other alignments lack label 0.
      if (labels[9] !== "e") continue;
      const match = /^(\d+),([01])$/.exec(labels[0]);
      if (!match || !integer(+match[1], 31)) throw new Error("The advertised encoder index or direction is invalid.");
      indices.add(+match[1]);
    }
  }
  return [...indices].sort((a, b) => a - b);
}
export async function readEncoder(transport, layer, index) {
  if (!integer(layer, 31) || !integer(index, 31)) throw new Error("Choose a bounded encoder layer and index.");
  const request = packet(0xfe, 3, layer, index), r = await transport.exchange(request);
  if (r.length !== 32 || r.equals(Buffer.from(request))) throw new Error("The exact encoder read contract was not verified.");
  return [r.readUInt16BE(0), r.readUInt16BE(2)];
}
export async function readVialEncoders(transport, definition, layers) {
  try {
    if (!integer(layers, 32) || layers < 1) throw new Error("The encoder layer count is unsupported.");
    const indices = encoderIndices(definition), entries = [];
    for (let layer = 0; layer < layers; layer++) for (const index of indices) entries.push({ layer, index, values: await readEncoder(transport, layer, index) });
    return { schema: encoderSchema, availability: "verified", indices, entries, identity: "definition-advertised encoder indices; physical direction trial pending" };
  } catch { return { schema: encoderSchema, availability: "unverified", indices: [], entries: [], reason: "Encoder definition/read contract unavailable. No encoder writes are available." }; }
}
function entry(snapshot, layer, index) {
  if (!snapshot.identity.vialProtocol || snapshot.encoders?.schema !== encoderSchema || snapshot.encoders.availability !== "verified" || !snapshot.encoders.indices.includes(index)) throw new Error("Choose an encoder index advertised by the exact verified Vial definition.");
  const found = snapshot.encoders.entries.find((e) => e.layer === layer && e.index === index);
  if (!found || !Array.isArray(found.values) || found.values.length !== 2 || found.values.some((v) => !integer(v, 65535))) throw new Error("That exact encoder layer is unavailable.");
  return found;
}
export function encoderChanges(snapshot, edits) {
  if (edits === undefined) return [];
  if (!Array.isArray(edits) || !edits.length || edits.length > 64) throw new Error("Review 1–64 encoder direction changes.");
  const seen = new Set();
  return edits.map((e) => {
    if (!e || Object.keys(e).some((k) => !["layer", "index", "direction", "before", "after"].includes(k)) || !integer(e.layer, snapshot.layers - 1) || !integer(e.index, 31) || !integer(e.direction, 1)) throw new Error("An encoder change needs an advertised layer/index and direction 0 or 1.");
    const slot = `${e.layer}:${e.index}:${e.direction}`; if (seen.has(slot)) throw new Error("An encoder direction is changed twice."); seen.add(slot);
    const before = entry(snapshot, e.layer, e.index).values[e.direction];
    if (e.before !== before) throw new Error("The encoder changed since this proposal.");
    if (typeof e.after === "number" && e.after !== 0 && (e.after < 4 || e.after > 231)) throw new Error("Encoder output cannot use HID error or firmware control codes.");
    return { schema: changeSchema, layer: e.layer, index: e.index, direction: e.direction, before, after: compileDeviceKey(snapshot, e.after) };
  }).filter((e) => e.before !== e.after);
}
function codec(c) { if (c?.schema !== changeSchema || !integer(c.layer, 31) || !integer(c.index, 31) || !integer(c.direction, 1) || !integer(c.before, 65535) || !integer(c.after, 65535)) throw new Error("The saved encoder codec is unsupported. Preserve the baseline for recovery."); }
export function verifyOwnedEncoder(current, c) {
  codec(c); if (!integer(current, 65535) || [0, 8].some((shift) => ![c.before >> shift & 255, c.after >> shift & 255].includes(current >> shift & 255))) throw new Error("An encoder direction changed outside this transaction. Review before restoring.");
}
export function validateEncodersRestore(snapshot, changes = []) { for (const c of changes) verifyOwnedEncoder(entry(snapshot, c.layer, c.index).values[c.direction], c); }
export function encodersReadback(snapshot, changes = [], target = "after") { for (const c of changes) { codec(c); if (entry(snapshot, c.layer, c.index).values[c.direction] !== c[target]) throw new Error("Encoder readback mismatch."); } }
export async function writeEncoder(transport, c, target = "after") {
  codec(c); if (!["before", "after"].includes(target)) throw new Error("Choose an exact encoder restoration direction.");
  const current = (await readEncoder(transport, c.layer, c.index))[c.direction]; verifyOwnedEncoder(current, c);
  if (current === c[target]) return;
  const request = packet(0xfe, 4, c.layer, c.index, c.direction, c[target] >> 8, c[target] & 255), r = await transport.exchange(request);
  if (r.length !== 32 || !r.subarray(0, 7).equals(Buffer.from(request).subarray(0, 7)) || (await readEncoder(transport, c.layer, c.index))[c.direction] !== c[target]) throw new Error("The encoder write was not acknowledged and read back.");
}
