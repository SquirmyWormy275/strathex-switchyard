/** Versioned portable definitions. Local enrollment, sessions and authority never travel. */
import { createHash } from "node:crypto";
import { importProfile, portableSchema } from "./workspace.mjs";
import { parseWorkflow } from "./workflow.mjs";

export const packageSchema = "switchyard-profile/v2";
export const stableIntents = ["summon", "resume", "review", "handoff", "status", "cancel"];
const modes = ["keyboard-only", "personal-companion", "managed-companion"];
const digestPattern = /^[a-f0-9]{64}$/;
const canonical = (v) => v === null || typeof v !== "object" ? JSON.stringify(v)
  : Array.isArray(v) ? `[${v.map(canonical).join(",")}]`
    : `{${Object.keys(v).sort().map((k) => `${JSON.stringify(k)}:${canonical(v[k])}`).join(",")}}`;
const hash = (v) => createHash("sha256").update(canonical(v)).digest("hex");
function bounded(value) {
  let text; try { text = JSON.stringify(value); } catch { throw new Error("Choose a finite JSON profile document."); }
  if (!text || Buffer.byteLength(text) > 1024 * 1024 || !value || typeof value !== "object" || Array.isArray(value)) throw new Error("The portable profile must be an object within one MiB.");
}
function definition(value) {
  const p = importProfile(value);
  return { ...p, workflow: parseWorkflow(p.workflow ?? { name: p.name, steps: [], roles: [] }) };
}
export const portableDefinitionDigest = (value) => hash(value === null ? null : definition(value));
function compatibility(profile) {
  const keys = profile.keys;
  const geometry = keys.map(({ id, matrix, x, y, w, h, rotation, shape }) => ({ id, matrix, x, y, w, h, rotation: rotation ?? 0, shape: shape ?? null }));
  return {
    controller: profile.controller, qmkKeyboard: profile.qmkKeyboard, layout: profile.layout,
    keyCount: keys.length, matrix: { rows: Math.max(...keys.map((k) => k.matrix[0])) + 1, columns: Math.max(...keys.map((k) => k.matrix[1])) + 1 },
    geometry: { algorithm: "sha256", digest: hash(geometry), evidence: "profile definition; verify against the actual keyboard" },
    baseLayer: { index: 0, keycodesSha256: hash(keys.map((k) => ({ matrix: k.matrix, keycode: k.baseKeycode }))), completeness: keys.every((k) => k.baseKeycode !== null) ? "complete" : "partial", evidence: "portable declaration; not live firmware readback" }
  };
}
function assignments(value, p) {
  if (!Array.isArray(value) || value.length > 256) throw new Error("Choose at most 256 portable intent assignments.");
  const seen = new Set();
  return value.map((a) => {
    if (!a || Object.keys(a).sort().join(",") !== "actionId,intent,roleId" || !p.plan.actions.some((x) => x.id === a.actionId) || !p.workflow.roles.some((r) => r.id === a.roleId) || !stableIntents.includes(a.intent) || seen.has(a.actionId)) throw new Error("Portable intents need an existing action, workflow role and stable meaning; each action has one meaning.");
    seen.add(a.actionId); return { actionId: a.actionId, roleId: a.roleId, intent: a.intent };
  });
}
function migration(value) {
  if (value === null) return null;
  if (!value || Object.keys(value).sort().join(",") !== "sourceDigest,sourceSchema" || ![portableSchema, "sxsy-agentic-layout-plan/v1"].includes(value.sourceSchema) || !digestPattern.test(value.sourceDigest)) throw new Error("The profile migration origin is unsupported.");
  return { sourceSchema: value.sourceSchema, sourceDigest: value.sourceDigest };
}
export function createPortablePackage(value, { modePreference = "keyboard-only", intentAssignments = [], migratedFrom = null } = {}) {
  bounded(value); const p = definition(value);
  if (!modes.includes(modePreference)) throw new Error("Choose a supported portable mode preference.");
  const meanings = assignments(intentAssignments, p), c = compatibility(p.plan.profile);
  const body = { ...p, schema: packageSchema, compatibility: c,
    assumptions: { hostLayout: "us-qwerty", typingLayer: "recorded-base-layer", modePreference, activation: "explicit-local-selection" },
    intentAssignments: meanings,
    requiredCapabilities: [...new Set([...(c.baseLayer.completeness === "complete" ? ["typing.recorded-base-layer"] : []), ...meanings.map((a) => `intent.${a.intent}`)])].sort(),
    migration: migration(migratedFrom) };
  return { ...body, revision: hash(body) };
}
export function parsePortablePackage(value) {
  bounded(value);
  if (value.schema !== packageSchema) throw new Error("Unsupported portable package version. Preserve the original document.");
  const p = createPortablePackage({ schema: portableSchema, id: value.id, name: value.name, plan: value.plan, workflow: value.workflow }, {
    modePreference: value.assumptions?.modePreference, intentAssignments: value.intentAssignments, migratedFrom: value.migration
  });
  // Reject undeclared fields, false geometry/base claims, missing metadata and
  // edited revisions. This digest detects changes; it is not a signing identity.
  if (canonical(p) !== canonical(value)) throw new Error("The portable package revision or declared compatibility does not verify. No definitions were adopted.");
  return p;
}
export function packageDefinition(value) {
  const p = parsePortablePackage(value);
  return definition({ schema: portableSchema, id: p.id, name: p.name, plan: p.plan, workflow: p.workflow });
}
export function preparePortableImport(value, { currentProfile = null, localBindings = [] } = {}) {
  bounded(value);
  if (![packageSchema, portableSchema, "sxsy-agentic-layout-plan/v1"].includes(value.schema)) return { status: "unsupported", preserved: true, sourceDigest: hash(value), reason: "Keep the original document. This version cannot replace saved definitions." };
  const document = value.schema === packageSchema ? parsePortablePackage(value)
    : createPortablePackage(value, { migratedFrom: { sourceSchema: value.schema, sourceDigest: portableDefinitionDigest(value) } });
  const current = currentProfile === null ? null : definition(currentProfile), target = current ? compatibility(current.plan.profile) : null;
  const differences = [];
  for (const field of ["controller", "qmkKeyboard", "layout", "keyCount", "matrix", "geometry", "baseLayer"]) {
    if (!target || canonical(target[field]) !== canonical(document.compatibility[field])) differences.push({ field, current: target?.[field] ?? null, imported: document.compatibility[field] });
  }
  const currentDigest = portableDefinitionDigest(current), localBindingsDigest = hash(localBindings);
  const review = { schema: "switchyard-profile-import-review/v1", revision: document.revision, currentDigest, localBindingsDigest };
  return {
    status: "review-required", reviewId: hash(review), document, migrationRequired: value.schema !== packageSchema,
    compatibility: { comparison: "saved definitions only; no device read", differences, liveDeviceVerified: false },
    localConnections: { disconnectedRoleBindings: localBindings.length, imported: 0, requiresLocalReview: true },
    requiredCapabilities: document.requiredCapabilities.map((id) => ({ id, status: "requires-local-verification" })),
    activation: "definitions only; local mode, accounts and policy are preserved",
    warnings: ["Imported geometry and typing declarations are not hardware evidence.", "Local paths, accounts, credentials, task/session IDs and connection authority are excluded.", "Local role connections will be cleared; connect the imported meanings deliberately."]
  };
}
