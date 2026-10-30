/** Bounded Vial 4+ tap-dance/combo codecs; never accept firmware-control integers. */
import { compileDeviceKey } from "./vial-keycodes.mjs";
export const dynamicSchema = "switchyard-vial-dynamic/v1";
const changeSchema = "switchyard-vial-dynamic-change/v1";
const kinds = { "tap-dance": { get: 1, set: 2, field: "tapDances" }, combo: { get: 3, set: 4, field: "combos" } };
const integer = (v, max) => Number.isInteger(v) && v >= 0 && v <= max;
const words = (v) => Array.isArray(v) && v.length === 5 && v.every((x) => integer(x, 65535));
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
const packet = (...bytes) => { const p = Buffer.alloc(32); Buffer.from(bytes).copy(p); return [...p]; };
const encoded = (values) => { const p = Buffer.alloc(10); values.forEach((v, i) => p.writeUInt16LE(v, i * 2)); return p; };
function codec(c) {
  if (c?.schema !== changeSchema || !Object.hasOwn(kinds, c.kind) || !integer(c.index, 63) || !words(c.before) || !words(c.after)) throw new Error("The saved dynamic-entry codec is unsupported. Preserve its baseline for a compatible recovery build.");
  return kinds[c.kind];
}
export async function readDynamicEntry(transport, kind, index) {
  if (!Object.hasOwn(kinds, kind) || !integer(index, 63)) throw new Error("Choose a supported dynamic-entry kind and index.");
  const r = await transport.exchange(packet(0xfe, 0x0d, kinds[kind].get, index));
  if (r.length !== 32 || r[0] !== 0) throw new Error("The firmware did not return the exact dynamic entry.");
  return Array.from({ length: 5 }, (_, i) => r.readUInt16LE(1 + i * 2));
}
export async function readVialDynamic(transport, protocol) {
  const empty = { schema: dynamicSchema, availability: "not-supported", tapDances: [], combos: [] };
  if (protocol < 4) return empty;
  try {
    const r = await transport.exchange(packet(0xfe, 0x0d, 0));
    if (r.length !== 32 || r[0] > 64 || r[1] > 64 || r.subarray(4, 31).some((v) => v !== 0)) throw new Error("The dynamic-entry advertisement is outside the verified contract.");
    const tapDances = [], combos = [];
    for (let index = 0; index < r[0]; index++) tapDances.push(await readDynamicEntry(transport, "tap-dance", index));
    for (let index = 0; index < r[1]; index++) combos.push(await readDynamicEntry(transport, "combo", index));
    return { schema: dynamicSchema, availability: "verified", tapDances, combos, unimplementedCounts: { keyOverrides: r[2], alternateRepeatKeys: r[3] }, featureBits: r[31] };
  } catch { return { ...empty, availability: "unverified", reason: "The optional dynamic-entry advertisement/read contract was not verified. No tap-dance or combo writes are available." }; }
}
function requireSurface(snapshot) {
  if (snapshot.identity.vialProtocol < 4 || !snapshot.identity.vialProtocol || snapshot.dynamic?.schema !== dynamicSchema || snapshot.dynamic.availability !== "verified") throw new Error("Tap-dance and combos require a verified Vial 4+ dynamic-entry readout.");
}
function output(snapshot, value) {
  if (value?.kind === "tap-dance") throw new Error("Nested tap-dance outputs are not supported. Keep a direct ordinary tap fallback.");
  if (typeof value === "number" && value !== 0 && (value < 4 || value > 231)) throw new Error("Dynamic outputs permit no-op or ordinary HID keys, not error/rollover or firmware control codes.");
  return compileDeviceKey(snapshot, value);
}
export function dynamicChanges(snapshot, input) {
  const changes = [];
  for (const [field, kind] of [["tapDances", "tap-dance"], ["combos", "combo"]]) {
    const edits = input[field]; if (edits === undefined) continue; requireSurface(snapshot);
    if (!Array.isArray(edits) || !edits.length || edits.length > 32) throw new Error("Review 1–32 changes per dynamic-entry kind.");
    const seen = new Set(), saved = snapshot.dynamic[field];
    for (const edit of edits) {
      if (!edit || !integer(edit.index, saved.length - 1) || seen.has(edit.index) || !words(edit.before) || !same(edit.before, saved[edit.index])) throw new Error("A dynamic entry is duplicated, unadvertised or changed since this proposal.");
      seen.add(edit.index); let after;
      if (kind === "tap-dance") {
        if (Object.keys(edit).some((k) => !["index", "before", "tap", "hold", "doubleTap", "tapHold", "termMs"].includes(k)) || !integer(edit.termMs, 10000) || edit.termMs < 1) throw new Error("A tap-dance needs four explicit outputs and a reviewed 1–10000 ms threshold.");
        after = [edit.tap, edit.hold, edit.doubleTap, edit.tapHold].map((v) => output(snapshot, v)).concat(edit.termMs);
        // Do not change a live ordinary base tap through a timing-table write.
        // First move that reference to an ordinary key in a separate review.
        if (snapshot.keymap_raw[0].flat().includes(0x5700 + edit.index) && after[0] !== edit.before[0]) throw new Error("This tap-dance is used on the typing layer. Preserve its tap output, or first remove that reference in a separate reviewed transaction.");
      } else {
        if (edit.disable === true) {
          if (Object.keys(edit).some((k) => !["index", "before", "disable"].includes(k))) throw new Error("Clearing a combo cannot include replacement triggers or output.");
          after = [0, 0, 0, 0, 0];
          if (!same(edit.before, after)) changes.push({ schema: changeSchema, kind, index: edit.index, before: [...edit.before], after });
          continue;
        }
        if (Object.keys(edit).some((k) => !["index", "before", "keys", "output"].includes(k)) || !Array.isArray(edit.keys) || edit.keys.length < 2 || edit.keys.length > 4 || new Set(edit.keys).size !== edit.keys.length || edit.keys.some((v) => !integer(v, 231) || v < 4)) throw new Error("A combo needs 2–4 distinct ordinary HID keys and an explicit output.");
        const available = new Set(snapshot.keymap_raw.flat(2));
        if (edit.keys.some((v) => !available.has(v))) throw new Error("Combo trigger keys must exist in the recorded keymap.");
        after = [...edit.keys, ...Array(4 - edit.keys.length).fill(0), output(snapshot, edit.output)];
      }
      if (!same(edit.before, after)) changes.push({ schema: changeSchema, kind, index: edit.index, before: [...edit.before], after });
    }
  }
  return changes;
}
export function dynamicCandidate(snapshot, changes = []) {
  const candidate = structuredClone(snapshot);
  for (const c of changes) { const spec = codec(c); requireSurface(candidate); candidate.dynamic[spec.field][c.index] = [...c.after]; }
  return candidate;
}
export function validateDynamicRestore(snapshot, changes = []) {
  if (changes.length) requireSurface(snapshot);
  for (const c of changes) {
    const spec = codec(c), current = snapshot.dynamic[spec.field][c.index];
    verifyOwnedDynamic(current, c);
  }
}
export function verifyOwnedDynamic(current, change) {
  codec(change);
  if (!words(current)) throw new Error("The original dynamic entry is unavailable for recovery.");
  const found = encoded(current), before = encoded(change.before), after = encoded(change.after);
  if (found.some((v, i) => v !== before[i] && v !== after[i])) throw new Error("A dynamic entry changed outside this transaction. Review before restoring.");
}
export function dynamicReadback(snapshot, changes = [], target = "after") {
  if (changes.length) requireSurface(snapshot);
  for (const c of changes) { const spec = codec(c); if (!same(snapshot.dynamic[spec.field][c.index], c[target])) throw new Error("Dynamic-entry readback mismatch."); }
}
export async function writeDynamicEntry(transport, change, target = "after") {
  const spec = codec(change); if (!["before", "after"].includes(target)) throw new Error("Choose the exact dynamic-entry restoration direction.");
  const current = await readDynamicEntry(transport, change.kind, change.index); verifyOwnedDynamic(current, change);
  if (same(current, change[target])) return;
  const r = await transport.exchange(packet(0xfe, 0x0d, spec.set, change.index, ...encoded(change[target])));
  if (r.length !== 32 || r[0] !== 0 || !same(await readDynamicEntry(transport, change.kind, change.index), change[target])) throw new Error("The dynamic-entry write was not acknowledged and read back.");
}
