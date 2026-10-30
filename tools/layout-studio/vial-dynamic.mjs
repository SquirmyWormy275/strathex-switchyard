/** Bounded source-verified Vial dynamic codecs; no arbitrary firmware-control outputs. */
import { compileDeviceKey } from "./vial-keycodes.mjs";
import { ruleKinds, ruleValues } from "./vial-rules.mjs";
export const dynamicSchema = "switchyard-vial-dynamic/v1";
const changeSchema = "switchyard-vial-dynamic-change/v1";
const kinds = { "tap-dance": { get: 1, set: 2, field: "tapDances", widths: [2, 2, 2, 2, 2] }, combo: { get: 3, set: 4, field: "combos", widths: [2, 2, 2, 2, 2] }, ...ruleKinds };
const integer = (v, max) => Number.isInteger(v) && v >= 0 && v <= max;
const valid = (kind, values) => Array.isArray(values) && values.length === kinds[kind].widths.length && values.every((value, index) => integer(value, 2 ** (8 * kinds[kind].widths[index]) - 1));
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
const packet = (...bytes) => { const p = Buffer.alloc(32); Buffer.from(bytes).copy(p); return [...p]; };
const encoded = (kind, values) => { const p = Buffer.alloc(kinds[kind].widths.reduce((total, width) => total + width, 0)); let offset = 0; values.forEach((value, index) => { const width = kinds[kind].widths[index]; p.writeUIntLE(value, offset, width); offset += width; }); return p; };
const decoded = (kind, bytes, offset) => kinds[kind].widths.map(width => { const value = bytes.readUIntLE(offset, width); offset += width; return value; });
function codec(c) {
  if (c?.schema !== changeSchema || !Object.hasOwn(kinds, c.kind) || !integer(c.index, 63) || !valid(c.kind, c.before) || !valid(c.kind, c.after)) throw new Error("The saved dynamic-entry codec is unsupported. Preserve its baseline for a compatible recovery build.");
  return kinds[c.kind];
}
export async function readDynamicEntry(transport, kind, index) {
  if (!Object.hasOwn(kinds, kind) || !integer(index, 63)) throw new Error("Choose a supported dynamic-entry kind and index.");
  const r = await transport.exchange(packet(0xfe, 0x0d, kinds[kind].get, index));
  if (r.length !== 32 || r[0] !== 0) throw new Error("The firmware did not return the exact dynamic entry.");
  return decoded(kind, r, 1);
}
export async function readVialDynamic(transport, protocol) {
  const empty = { schema: dynamicSchema, availability: "not-supported", tapDances: [], combos: [], keyOverrides: [], alternateRepeatKeys: [] };
  if (protocol < 4 || protocol > 6) return empty;
  try {
    const r = await transport.exchange(packet(0xfe, 0x0d, 0));
    if (r.length !== 32 || [...r.subarray(0, 4)].some(value => value > 64) || r.subarray(4, 31).some((v) => v !== 0)) throw new Error("The dynamic-entry advertisement is outside the verified contract.");
    const entries = {};
    for (const [index, [kind, spec]] of Object.entries(kinds).entries()) { entries[spec.field] = []; for (let slot = 0; slot < r[index]; slot++) entries[spec.field].push(await readDynamicEntry(transport, kind, slot)); }
    return { schema: dynamicSchema, availability: "verified", ...entries, unimplementedCounts: {}, featureBits: r[31] };
  } catch { return { ...empty, availability: "unverified", reason: "The optional dynamic-entry advertisement/read contract was not verified. No dynamic-table writes are available." }; }
}
function requireSurface(snapshot) {
  if (snapshot.identity.vialProtocol < 4 || !snapshot.identity.vialProtocol || snapshot.dynamic?.schema !== dynamicSchema || snapshot.dynamic.availability !== "verified") throw new Error("Dynamic tables require a verified Vial 4–6 advertisement and entry readout.");
}
function output(snapshot, value) {
  if (value?.kind === "tap-dance") throw new Error("Nested tap-dance outputs are not supported. Keep a direct ordinary tap fallback.");
  if (typeof value === "number" && value !== 0 && (value < 4 || value > 231)) throw new Error("Dynamic outputs permit no-op or ordinary HID keys, not error/rollover or firmware control codes.");
  return compileDeviceKey(snapshot, value);
}
export function dynamicChanges(snapshot, input) {
  const changes = [];
  for (const [kind, spec] of Object.entries(kinds)) {
    const field = spec.field;
    const edits = input[field]; if (edits === undefined) continue; requireSurface(snapshot);
    if (!Array.isArray(edits) || !edits.length || edits.length > 32) throw new Error("Review 1–32 changes per dynamic-entry kind.");
    const seen = new Set(), saved = snapshot.dynamic[field];
    if (!Array.isArray(saved)) throw new Error("The requested rule table was not advertised and read.");
    for (const edit of edits) {
      if (!edit || !integer(edit.index, saved.length - 1) || seen.has(edit.index) || !valid(kind, edit.before) || !same(edit.before, saved[edit.index])) throw new Error("A dynamic entry is duplicated, unadvertised or changed since this proposal.");
      seen.add(edit.index); let after;
      if (kind === "tap-dance") {
        if (Object.keys(edit).some((k) => !["index", "before", "tap", "hold", "doubleTap", "tapHold", "termMs"].includes(k)) || !integer(edit.termMs, 10000) || edit.termMs < 1) throw new Error("A tap-dance needs four explicit outputs and a reviewed 1–10000 ms threshold.");
        after = [edit.tap, edit.hold, edit.doubleTap, edit.tapHold].map((v) => output(snapshot, v)).concat(edit.termMs);
        // Do not change a live ordinary base tap through a timing-table write.
        // First move that reference to an ordinary key in a separate review.
        if (snapshot.keymap_raw[0].flat().includes(0x5700 + edit.index) && after[0] !== edit.before[0]) throw new Error("This tap-dance is used on the typing layer. Preserve its tap output, or first remove that reference in a separate reviewed transaction.");
      } else if (kind === "combo") {
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
      } else after = ruleValues(snapshot, kind, edit);
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
  if (!valid(change.kind, current)) throw new Error("The original dynamic entry is unavailable for recovery.");
  const found = encoded(change.kind, current), before = encoded(change.kind, change.before), after = encoded(change.kind, change.after);
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
  const r = await transport.exchange(packet(0xfe, 0x0d, spec.set, change.index, ...encoded(change.kind, change[target])));
  if (r.length !== 32 || r[0] !== 0 || !same(await readDynamicEntry(transport, change.kind, change.index), change[target])) throw new Error("The dynamic-entry write was not acknowledged and read back.");
}
