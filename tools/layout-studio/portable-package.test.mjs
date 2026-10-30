import assert from "node:assert/strict";
import { once } from "node:events";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { newPlan, parseBoardProfile } from "./model.mjs";
import { portableProfile } from "./workspace.mjs";
import { agentIntents } from "./custom-agents.mjs";
import { createPortablePackage, parsePortablePackage, preparePortableImport, stableIntents } from "./portable-package.mjs";
import { createSuiteStore } from "./suite-store.mjs";
import { createSuite } from "./suite.mjs";
import { createStudioServer } from "./serve.mjs";

function sample() {
  const plan = newPlan(parseBoardProfile({ schema: "sxsy-board-profile/v1", name: "Synthetic F", layout: "two", qmkKeyboard: "synthetic/f", controller: "xwhatsit", keys: [
    { id: "one", label: "First", matrix: [0, 0], x: 0, y: 0, baseKeycode: "KC_A" },
    { id: "two", label: "Second", matrix: [0, 1], x: 1, y: 0, rotation: 10, baseKeycode: "KC_B" }
  ] }));
  plan.actions.push({ id: "my-resume", label: "Return to work", family: "lifecycle", consequence: "read_only", confirmation: false, frequencyPerDay: 0, secondsSaved: 0, binding: { keyId: "two", modifier: "gui_ctrl" } });
  return portableProfile(plan, "synthetic", "Synthetic workflow", { name: "Build", roles: [{ id: "coder", label: "Coding" }], steps: [{ id: "implement", label: "Implement", roleId: "coder", after: [] }] });
}
const preferences = { modePreference: "personal-companion", intentAssignments: [{ actionId: "my-resume", roleId: "coder", intent: "resume" }] };
async function fixture(fn) {
  const root = await mkdtemp(join(tmpdir(), "pp-")), keys = new Map();
  const secrets = { get: async (id, purpose) => keys.get(`${id}:${purpose}`), set: async (id, purpose, v) => { keys.set(`${id}:${purpose}`, v); } };
  const store = createSuiteStore({ root, secrets });
  try { await store.initialize("personal"); await fn({ root, secrets, store }); }
  finally { await rm(root, { recursive: true, force: true, maxRetries: 5, retryDelay: 40 }); }
}
test("portable v2 records exact geometry/base assumptions and stable meanings independently of local implementations", () => {
  const source = sample(); source.localBindings = { sessionId: "synthetic-private-session", path: "/private", credential: "synthetic-private-credential" };
  const p = createPortablePackage(source, preferences), text = JSON.stringify(p);
  assert.equal(p.schema, "switchyard-profile/v2"); assert.equal(p.compatibility.matrix.columns, 2);
  assert.equal(p.compatibility.controller, "xwhatsit"); assert.equal(p.compatibility.baseLayer.completeness, "complete");
  assert.equal(p.assumptions.hostLayout, "us-qwerty"); assert.deepEqual(p.requiredCapabilities, ["intent.resume", "typing.recorded-base-layer"]);
  assert.deepEqual(p.intentAssignments, preferences.intentAssignments); assert.deepEqual(parsePortablePackage(JSON.parse(text)), p);
  assert.equal(text.includes("synthetic-private"), false); assert.equal(text.includes("/private"), false);
  assert.deepEqual([...stableIntents].sort(), [...agentIntents].sort());
  const rotated = sample(); rotated.plan.profile = { ...rotated.plan.profile, keys: rotated.plan.profile.keys.map((k, i) => i ? { ...k, rotation: 12 } : k) };
  assert.notEqual(createPortablePackage(rotated).compatibility.geometry.digest, p.compatibility.geometry.digest);
});
test("edited compatibility, revisions, local fields and nonexistent intent targets cannot cross the v2 import boundary", () => {
  const original = createPortablePackage(sample(), preferences);
  for (const change of [p => { p.compatibility.controller = "leyden_jar"; }, p => { p.compatibility.geometry.digest = "0".repeat(64); }, p => { p.plan.localBindings = { session: "untrusted" }; }, p => { p.localConnections = []; }, p => { delete p.assumptions; }, p => { p.revision = "a".repeat(64); }]) {
    const p = structuredClone(original); change(p); assert.throws(() => parsePortablePackage(p), /verify|preference|unsupported/);
  }
  for (const assignment of [{ actionId: "missing", roleId: "coder", intent: "resume" }, { actionId: "my-resume", roleId: "missing", intent: "resume" }, { actionId: "my-resume", roleId: "coder", intent: "shell" }]) assert.throws(() => createPortablePackage(sample(), { intentAssignments: [assignment] }), /existing action/);
  assert.throws(() => createPortablePackage(sample(), { intentAssignments: [preferences.intentAssignments[0], preferences.intentAssignments[0]] }), /one meaning/);
});
test("legacy migration is a reviewable candidate; unknown future documents remain untouched", () => {
  const legacy = sample(), original = JSON.stringify(legacy), review = preparePortableImport(legacy);
  assert.equal(review.migrationRequired, true); assert.equal(review.document.migration.sourceSchema, legacy.schema);
  assert.equal(review.compatibility.liveDeviceVerified, false); assert.equal(review.status, "review-required");
  assert.equal(JSON.stringify(legacy), original);
  const plan = preparePortableImport(legacy.plan); assert.equal(plan.document.migration.sourceSchema, legacy.plan.schema);
  const future = { schema: "switchyard-profile/v99", nested: { unknown: [1, 2, 3] } }, before = JSON.stringify(future);
  assert.equal(preparePortableImport(future).status, "unsupported"); assert.equal(JSON.stringify(future), before);
  assert.throws(() => createPortablePackage({ ...legacy, name: "x".repeat(1024 * 1024) }), /one MiB/);
});
test("import reviews show concrete typing differences, reject stale definitions/bindings and never mutate on rejection", () => fixture(async ({ store }) => {
  await store.saveProfile("personal", sample());
  const changed = sample(); changed.plan.profile = { ...changed.plan.profile, keys: changed.plan.profile.keys.map((k) => ({ ...k, baseKeycode: "KC_C" })) };
  const document = createPortablePackage(changed, preferences), review = await store.reviewProfilePackage("personal", document);
  assert.ok(review.compatibility.differences.some((d) => d.field === "baseLayer"));
  await store.update("personal", "synthetic-binding", (s) => { s.roleBindings = [{ roleId: "coder", intent: "resume", provider: "codex", sessionId: "local-exact-session" }]; });
  const before = await store.snapshot("personal");
  await assert.rejects(store.importProfilePackage("personal", document, review.reviewId), /Review this exact/);
  assert.deepEqual(await store.snapshot("personal"), before);
  const refreshed = await store.reviewProfilePackage("personal", document);
  assert.equal(refreshed.localConnections.disconnectedRoleBindings, 1);
  await store.saveWorkflow("personal", { name: "Changed meanwhile", roles: [], steps: [] });
  await assert.rejects(store.importProfilePackage("personal", document, refreshed.reviewId), /Review this exact/);
}));
test("second-host imports preserve keyboard-only policy, clear colliding role authority and round-trip metadata after restart", () => fixture(async ({ root, secrets, store }) => {
  await store.saveProfile("personal", sample());
  await store.update("personal", "synthetic-local-state", (s) => { s.roleBindings = [{ roleId: "coder", provider: "codex", sessionId: "never-export-session", intent: "resume" }]; s.accounts = ["never-export-account"]; });
  await store.credential("personal", "synthetic", "never-export-credential", {});
  const document = createPortablePackage(sample(), preferences), review = await store.reviewProfilePackage("personal", document);
  const result = await store.importProfilePackage("personal", document, review.reviewId);
  assert.equal(result.localMode, "keyboard-only"); assert.equal(result.roleBindingsCleared, 1);
  const reopened = createSuiteStore({ root, secrets }), saved = await reopened.snapshot("personal");
  assert.deepEqual(saved.roleBindings, []); assert.equal(saved.accounts[0], "never-export-account");
  const exported = await reopened.exportProfilePackage("personal");
  assert.equal(exported.metadataStatus, "preserved"); assert.deepEqual(exported.document, document);
  assert.equal(JSON.stringify(exported).includes("never-export"), false);
  await assert.rejects(reopened.authorize("personal", { provider: "codex" }), /Keyboard-only/);
  await reopened.initialize("work", "work"); const workReview = await reopened.reviewProfilePackage("work", document);
  await reopened.importProfilePackage("work", document, workReview.reviewId);
  assert.equal((await reopened.snapshot("work")).policy, "work");
  await assert.rejects(reopened.exportProfilePackage("work"), /Exports are prohibited/);
}));
test("v1 edits cannot silently retain stale package metadata and imports preserve an explicitly selected local mode", () => fixture(async ({ store }) => {
  await store.update("personal", "explicit-companion-mode", (s) => { s.mode = "personal-companion"; });
  const doc = createPortablePackage(sample(), preferences), review = await store.reviewProfilePackage("personal", doc);
  await store.importProfilePackage("personal", doc, review.reviewId);
  assert.equal((await store.snapshot("personal")).mode, "personal-companion");
  const changed = sample(); changed.name = "Changed after import"; await store.saveProfile("personal", changed);
  const exported = await store.exportProfilePackage("personal"); assert.equal(exported.metadataStatus, "derived-requires-review"); assert.deepEqual(exported.document.intentAssignments, []);
  const before = await store.snapshot("personal");
  assert.equal((await store.reviewProfilePackage("personal", { schema: "switchyard-profile/v9", opaque: true })).preserved, true);
  await assert.rejects(store.importProfilePackage("personal", { schema: "switchyard-profile/v9" }, "untrusted"), /Review this exact/);
  assert.deepEqual(await store.snapshot("personal"), before);
}));
test("authenticated HTTP package review and import work while an unauthenticated request cannot replace definitions", () => fixture(async ({ store }) => {
  const suite = createSuite({ store, agents: { close() {} }, voice: { discovery: async () => ({ available: false }) } });
  const token = "s".repeat(43), server = createStudioServer({ token, suite, bridge: { close() {} }, discover: async () => ({}) });
  server.listen(0, "127.0.0.1"); await once(server, "listening"); const base = `http://127.0.0.1:${server.address().port}`;
  const post = (path, body, authenticated = true) => fetch(`${base}/api/suite/profile/package/${path}`, { method: "POST", headers: { "Content-Type": "application/json", Origin: base, ...(authenticated ? { Authorization: `Bearer ${token}` } : {}) }, body: JSON.stringify(body) });
  try {
    const document = createPortablePackage(sample(), preferences);
    assert.equal((await post("import", { document }, false)).status, 401);
    const reviewed = await post("review", { document }); assert.equal(reviewed.status, 200); const review = await reviewed.json();
    const imported = await post("import", { document, reviewId: review.reviewId }); assert.equal(imported.status, 200); assert.equal((await imported.json()).localMode, "keyboard-only");
    const exported = await post("export", {}); assert.equal(exported.status, 200); assert.equal((await exported.json()).document.revision, document.revision);
  } finally { server.closeAllConnections(); await new Promise((resolve) => server.close(resolve)); await server.cleanup(); }
}));
