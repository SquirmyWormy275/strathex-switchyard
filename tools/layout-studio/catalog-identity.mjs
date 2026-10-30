/** Source identity is a suggestion contract, never device authentication or authority. */
import { createHash } from "node:crypto";
import { unpackChoices } from "./geometry.mjs";

const hash = (v) => createHash("sha256").update(v).digest("hex");
export function presetKeyboardId(text) {
  if (typeof text !== "string" || text.length > 1024 * 1024 || (text.match(/"uid"\s*:/g) ?? []).length !== 1) throw new Error("A source preset needs one bounded exact UID.");
  const parsed = JSON.parse(text, (key, value, context) => key === "uid" ? { literal: context.source } : value), literal = parsed.uid?.literal;
  if (typeof literal !== "string" || !/^(?:0|[1-9][0-9]{0,19})$/.test(literal)) throw new Error("The source UID must be an exact unsigned 64-bit integer literal.");
  let value = BigInt(literal);
  if (value === 0n || value > 0xffffffffffffffffn) throw new Error("The source UID is outside the nonzero 64-bit range.");
  let result = ""; for (let i = 0; i < 8; i++, value >>= 8n) result += (value & 255n).toString(16).padStart(2, "0");
  return result;
}
export function firmwareKeyboardId(text) {
  if (typeof text !== "string" || text.length > 32768) throw new Error("Choose a bounded literal firmware UID header.");
  const clean = text.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/[^\n]*/g, "").replace(/\\\r?\n/g, "");
  const declarations = [...clean.matchAll(/^\s*#\s*define\s+VIAL_KEYBOARD_UID\s+([^\r\n]+)$/gm)];
  if (declarations.length !== 1 || !/^\{[^{}]+\}\s*$/.test(declarations[0][1])) throw new Error("The source must declare one literal Vial UID; preprocessor expressions are not evaluated.");
  const bytes = declarations[0][1].trim().slice(1, -1).split(",").map((v) => v.trim());
  if (bytes.length !== 8 || bytes.some((v) => !/^(?:0x[0-9a-f]{1,2}|0|[1-9][0-9]{0,2})$/i.test(v) || Number(v) > 255)) throw new Error("The source UID must contain exactly eight literal bytes.");
  const result = bytes.map((v) => Number(v).toString(16).padStart(2, "0")).join("");
  if (/^0+$/.test(result)) throw new Error("A zero source UID does not identify firmware.");
  return result;
}
export function definitionDigest(value) {
  let nodes = 0;
  const canonical = (v, depth = 0) => {
    if (++nodes > 16384 || depth > 32) throw new Error("The keyboard definition exceeds its structural bound.");
    if (v === null || typeof v === "string" || typeof v === "boolean" || typeof v === "number" && Number.isFinite(v)) return JSON.stringify(v);
    if (Array.isArray(v)) return `[${v.map((x) => canonical(x, depth + 1)).join(",")}]`;
    if (v && typeof v === "object") return `{${Object.keys(v).sort().map((k) => `${JSON.stringify(k)}:${canonical(v[k], depth + 1)}`).join(",")}}`;
    throw new Error("The keyboard definition must contain finite JSON data.");
  };
  const encoded = canonical(value); if (encoded.length > 1024 * 1024) throw new Error("The keyboard definition exceeds its size bound."); return hash(encoded);
}
export function identifyCatalogSnapshot(catalog, snapshot) {
  if (catalog?.schema !== "switchyard-model-f-catalog/v1" || !catalog.definitions || !Array.isArray(catalog.models) || Object.keys(catalog.definitions).length > 128 || catalog.models.length > 64) throw new Error("Choose a bounded verified source catalog.");
  const base = { schema: "switchyard-catalog-identification/v1", capturedAt: snapshot?.capturedAt ?? null, liveConnectionVerified: false, controllerHardwareVerified: false, caseIdentityVerified: false, physicalFitVerified: false, sourceProposalEligible: false, suggestedModels: [], sourceBuilds: [], definitions: [] };
  if (!snapshot?.identity?.vialProtocol) return { ...base, status: "unsupported-identity-route", reason: "This protocol has no verified Vial UID/definition contract. No model was guessed." };
  const keyboardId = snapshot.identity.keyboardId;
  if (typeof keyboardId !== "string" || !/^[a-f0-9]{16}$/.test(keyboardId) || /^0+$/.test(keyboardId) || snapshot.identity.viaProtocol !== 9 || !Number.isInteger(snapshot.identity.vialProtocol) || snapshot.identity.vialProtocol < 1 || snapshot.identity.vialProtocol > 6 || snapshot.rows !== snapshot.definition?.matrix?.rows || snapshot.cols !== snapshot.definition?.matrix?.cols) throw new Error("The readout has no exact supported UID, protocol and definition matrix.");
  const actual = definitionDigest(snapshot.definition), knownUid = [], exact = [];
  for (const [id, source] of Object.entries(catalog.definitions)) {
    const identity = source.firmwareIdentity, uidMatches = identity?.keyboardId === keyboardId, definitionMatches = definitionDigest(source.definition) === actual;
    if (uidMatches) knownUid.push(id);
    if (definitionMatches) exact.push({ id, definitionSource: source.source, uidMatches, uidSource: identity?.source ?? null });
  }
  let selections = null;
  try { if (Number.isSafeInteger(snapshot.layoutOptions)) selections = unpackChoices(snapshot.definition, snapshot.layoutOptions); } catch { /* keep the identity result; do not guess physical selections */ }
  const strong = exact.filter((d) => d.uidMatches), selected = new Set((strong.length ? strong : knownUid.length ? [] : exact).map((d) => d.id));
  const suggestedModels = catalog.models.flatMap((model) => {
    const variants = model.variants.flatMap((variant) => variant.parts.flatMap((part, index) => selected.has(part.definitionId) ? [{ id: variant.id, label: variant.label, part: index, totalParts: variant.parts.length, source: part.source, layoutOptionsMatch: selections !== null && JSON.stringify(part.choices) === JSON.stringify(selections), wholeKeyboardVerified: false }] : []));
    return variants.length ? [{ id: model.id, name: model.name, status: model.status, variants }] : [];
  });
  const sourceBuilds = Object.entries(catalog.additionalBuilds ?? {}).flatMap(([id, variants]) => { const matches = variants.flatMap((v) => v.parts.flatMap((p, part) => selected.has(p.definitionId) ? [{ id: v.id, label: v.label, part, totalParts: v.parts.length, source: p.source, layoutOptionsMatch: selections !== null && JSON.stringify(p.choices) === JSON.stringify(selections) }] : [])); return matches.length ? [{ id, variants: matches }] : []; });
  return { ...base, status: strong.length ? "source-identity-match" : knownUid.length ? "identity-definition-conflict" : exact.length ? "definition-match-uid-unverified" : "unrecognized", definitionSha256: actual, definitions: exact, selections, suggestedModels, sourceBuilds, sourceProposalEligible: strong.length > 0 && selections !== null, reason: strong.length ? "Readout UID and complete definition match pinned firmware source. Review the case and physical choices; source identity is not authentication." : knownUid.length ? "The known source UID returned a different complete definition. No source layout was selected." : "No complete source UID/definition pair matched. Geometry or product names alone do not establish controller compatibility." };
}
