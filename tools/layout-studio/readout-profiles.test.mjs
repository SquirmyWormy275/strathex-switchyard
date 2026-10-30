import assert from "node:assert/strict";
import { once } from "node:events";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { createReadoutProfiles } from "./readout-profiles.mjs";
import { createSuiteStore } from "./suite-store.mjs";
import { createSuite } from "./suite.mjs";
import { createStudioServer } from "./serve.mjs";
import { layoutChoices, unpackChoices, vialGeometry } from "./geometry.mjs";
import { importVialSnapshot } from "./vial-snapshot.mjs";
const catalog = JSON.parse(await readFile(new URL("./model-f-catalog.json", import.meta.url), "utf8"));
const firstId = "a".repeat(64), secondId = "b".repeat(64);
function captured(definitionId, choices, deviceId, at) {
  const d = catalog.definitions[definitionId], definition = structuredClone(d.definition), rows = definition.matrix.rows, cols = definition.matrix.cols;
  const options = layoutChoices(definition), selections = choices ?? options.map(() => 0), packed = selections.reduce((v, choice, i) => v * 2 ** Math.ceil(Math.log2(options[i].options.length)) + choice, 0), geometry = vialGeometry(definition, selections);
  const layer = Array.from({ length: rows }, () => Array(cols).fill(0));
  for (let i = 0; i < 4; i++) { const [r, c] = geometry[i].matrix; layer[r][c] = 30 + i; }
  const [r, c] = geometry[5].matrix; layer[r][c] = 52; // Dvorak punctuation, not the source typing default.
  const [r2, c2] = geometry[6].matrix; layer[r2][c2] = 0x5221; // Opaque native form is retained, never compiled or emitted.
  return { schema: "switchyard-device-snapshot/v1", identity: { deviceId, keyboardId: d.firmwareIdentity.keyboardId, viaProtocol: 9, vialProtocol: 6 }, capturedAt: new Date(at).toISOString(), definition, rows, cols, layers: 1, keymap_raw: [layer], layoutOptions: packed, configurationOnly: true };
}
async function fixture(fn) {
  const root = await mkdtemp(join(tmpdir(), "sy-readout-")), keys = new Map(), time = { value: Date.now() }, store = createSuiteStore({ root, clock: () => time.value, secrets: { get: async (id, purpose) => keys.get(`${id}:${purpose}`), set: async (id, purpose, v) => { keys.set(`${id}:${purpose}`, v); } } });
  const service = createReadoutProfiles({ store, catalog, now: () => time.value });
  try { await store.initialize("personal"); await store.initialize("work", "work"); const snapshot = captured("wcass:f77", null, firstId, time.value); await store.update("personal", "synthetic-read", (s) => { s.deviceSnapshots = [snapshot]; }); await fn({ root, store, service, snapshot, time }); }
  finally { service.close(); await rm(root, { recursive: true, force: true, maxRetries: 5, retryDelay: 50 }); }
}
test("recommended adoption retains the captured Dvorak/opaque layer and stable meanings without enabling tools or editing hardware", () => fixture(async ({ store, service, snapshot }) => {
  const before = await store.snapshot("personal"), review = await service.review("personal", { deviceId: firstId });
  assert.deepEqual(review.document.plan.profile, importVialSnapshot(snapshot, unpackChoices(snapshot.definition, snapshot.layoutOptions)));
  assert.ok(review.document.plan.profile.keys.some((k) => k.baseKeycode === "KC_QUOT")); assert.ok(review.document.plan.profile.keys.some((k) => k.baseKeycode === "VIAL_0X5221"));
  assert.deepEqual(review.document.intentAssignments.map((a) => a.intent), ["resume", "status", "review", "handoff"]); assert.equal(review.document.assumptions.modePreference, "keyboard-only"); assert.equal((await store.snapshot("personal")).profile, null);
  const results = await Promise.allSettled([service.adopt("personal", { reviewId: review.reviewId }), service.adopt("personal", { reviewId: review.reviewId })]); assert.equal(results.filter((r) => r.status === "fulfilled").length, 1);
  const saved = await store.snapshot("personal"); assert.equal(saved.mode, before.mode); assert.deepEqual(saved.deviceSnapshots, before.deviceSnapshots); assert.deepEqual(saved.accounts, before.accounts); assert.deepEqual(saved.profile.plan.profile, review.document.plan.profile); assert.deepEqual((await store.exportProfilePackage("personal")).document, review.document);
}));
test("a late changed readout, expired capture, changed profile or wrong compartment cannot cross the state-locked source fence", () => fixture(async ({ store, service, snapshot, time }) => {
  const review = await service.review("personal", { deviceId: firstId });
  await assert.rejects(service.adopt("work", { reviewId: review.reviewId }), /workspace first/);
  await store.update("personal", "synthetic-race", (s) => { s.deviceSnapshots[0].keymap_raw[0][0][0] ^= 1; }); const before = await store.snapshot("personal");
  await assert.rejects(service.adopt("personal", { reviewId: review.reviewId }), /readout changed/); assert.deepEqual(await store.snapshot("personal"), before);
  await store.update("personal", "synthetic-reset", (s) => { s.deviceSnapshots = [structuredClone(snapshot)]; });
  const next = await service.review("personal", { deviceId: firstId }); await store.saveWorkflow("personal", { name: "Changed meanwhile", roles: [], steps: [] }); await assert.rejects(service.adopt("personal", { reviewId: next.reviewId }), /Review this exact profile/);
  time.value += 120001; await assert.rejects(service.review("personal", { deviceId: firstId }), /stale/); assert.equal((await store.snapshot("personal")).profile, null);
}));
test("duplicate ordinary positions stay unassigned, while conflicting firmware cannot become a recommended profile", () => fixture(async ({ store, service, snapshot }) => {
  const key = vialGeometry(snapshot.definition, unpackChoices(snapshot.definition, snapshot.layoutOptions))[4].matrix;
  await store.update("personal", "synthetic-duplicate", (s) => { s.deviceSnapshots[0].keymap_raw[0][key[0]][key[1]] = 30; });
  const review = await service.review("personal", { deviceId: firstId }); assert.ok(review.unassignedActions.includes("task-resume")); assert.equal(review.document.plan.actions[0].binding, null);
  await store.update("personal", "synthetic-conflict", (s) => { s.deviceSnapshots[0].definition.name += " altered"; });
  await assert.rejects(service.review("personal", { deviceId: firstId }), /complete verified source identity/); assert.equal((await store.snapshot("personal")).profile, null);
}));
test("split adoption requires two distinct matching readouts in declared left/right order and retains both matrices", () => fixture(async ({ store, service, time }) => {
  const model = catalog.models.find((m) => m.id === "fortho"), parts = model.variants[0].parts, left = captured(parts[0].definitionId, parts[0].choices, firstId, time.value), right = captured(parts[1].definitionId, parts[1].choices, secondId, time.value);
  await store.update("personal", "synthetic-pair", (s) => { s.deviceSnapshots = [left, right]; });
  await assert.rejects(service.review("personal", { deviceId: firstId }), /One split half/);
  await assert.rejects(service.review("personal", { deviceIds: [firstId, firstId] }), /distinct split/);
  await assert.rejects(service.review("personal", { deviceIds: [secondId, firstId] }), /left\/right order/);
  const review = await service.review("personal", { deviceIds: [firstId, secondId] }), keys = review.document.plan.profile.keys;
  assert.ok(keys.some((k) => k.id.startsWith("left:") && k.matrix[0] < 128)); assert.ok(keys.some((k) => k.id.startsWith("right:") && k.matrix[0] >= 128)); assert.equal(review.source.readouts.length, 2); assert.ok(review.unassignedActions.includes("task-resume"));
  await service.adopt("personal", { reviewId: review.reviewId }); assert.equal((await store.snapshot("personal")).profile.plan.profile.keys.length, keys.length);
}));
test("authenticated HTTP review/adopt uses protected readouts and cannot accept a caller's replacement profile or source assertion", () => fixture(async ({ store }) => {
  const suite = createSuite({ store, agents: { close() {} }, devices: { read: () => { throw Error("No HID operation is allowed here"); } }, voice: { discovery: async () => ({ available: false }) } }), token = "p".repeat(43), server = createStudioServer({ token, suite, bridge: { close() {} }, discover: async () => ({}) });
  server.listen(0, "127.0.0.1"); await once(server, "listening"); const base = `http://127.0.0.1:${server.address().port}`;
  const post = (path, body, auth = true) => fetch(`${base}/api/suite/devices/profile/${path}`, { method: "POST", headers: { "Content-Type": "application/json", Origin: base, ...(auth ? { Authorization: `Bearer ${token}` } : {}) }, body: JSON.stringify(body) });
  try {
    assert.equal((await post("review", { deviceId: firstId }, false)).status, 401);
    const response = await post("review", { deviceId: firstId, profile: { arbitrary: "ignored" }, name: "My captured keyboard" }); assert.equal(response.status, 200); const review = await response.json();
    assert.equal(review.document.name, "My captured keyboard"); assert.equal((await post("adopt", { reviewId: review.reviewId, sourceVerified: true, document: { arbitrary: "ignored" } })).status, 200);
    assert.equal((await store.snapshot("personal")).profile.name, "My captured keyboard"); assert.equal((await store.snapshot("personal")).mode, "keyboard-only"); assert.equal((await post("adopt", { reviewId: review.reviewId })).status, 409);
  } finally { server.closeAllConnections(); await new Promise((r) => server.close(r)); await server.cleanup(); }
}));
