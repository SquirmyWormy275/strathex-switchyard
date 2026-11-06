import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { appendEditorObservation } from "./editor-observation.mjs";
import { createSuiteStore } from "./suite-store.mjs";
import { createSuite } from "./suite.mjs";

const observation = patch => ({ status: "recording", sources: ["editor-events"], exclusions: [], events: [], createdAt: 0, updatedAt: 0, ...patch });
const row = patch => ({ schema: "switchyard-editor-connection/v1", requestId: randomUUID(), editorId: randomUUID(), status: "reserved", createdAt: 10, privatePath: "/PRIVATE_PATH", taskId: "PRIVATE_TASK", ...patch });
const clean = { upstreamExitVerified: true, carrierExitVerified: true, socketRemovedVerified: true, directoryRemovedVerified: true };
function state(patch = {}) { return { id: "personal", policy: "personal", mode: "personal-companion", observations: [observation()], codingEditorConnections: [row()], ...patch }; }

test("editor metadata keeps correlation private and its historical provenance cannot claim live attachment", () => {
  const s = state(), r = s.codingEditorConnections[0];
  assert.equal(appendEditorObservation(s, r), 1);
  Object.assign(r, { status: "acknowledged", acknowledgement: { protocolAcknowledged: true }, updatedAt: 20 });
  assert.equal(appendEditorObservation(s, r), 1);
  Object.assign(r, { status: "uncertain", retirement: { ...clean, carrierExitVerified: false }, updatedAt: 30 });
  assert.equal(appendEditorObservation(s, r), 1);
  Object.assign(r, { status: "stopped", retirement: clean, updatedAt: 40 });
  assert.equal(appendEditorObservation(s, r), 1);
  const events = s.observations[0].events;
  assert.deepEqual(events.map(e => e.status), ["reserved", "acknowledged", "uncertain", "stopped"]);
  assert.equal(new Set(events.map(e => e.subjectDigest)).size, 1);
  assert.doesNotMatch(JSON.stringify(events), /PRIVATE/);
  for (const e of events) {
    assert.equal(e.provider, "codex"); assert.equal(e.provenance, "switchyard-editor-journal");
    assert.equal(e.ideAttached, false); assert.equal(e.taskCompletionVerified, false); assert.equal(e.timeSavingMeasured, false);
    assert.equal(JSON.stringify(e).includes(r.requestId), false); assert.equal(JSON.stringify(e).includes(r.editorId), false);
  }
  const other = state({ id: "other", codingEditorConnections: [structuredClone(r)] });
  appendEditorObservation(other, other.codingEditorConnections[0]);
  assert.notEqual(other.observations[0].events[0].subjectDigest, events[0].subjectDigest);
});

test("editor recording needs separate consent, Personal companion mode and all relevant category permissions", () => {
  const patches = [{ policy: "work", mode: "managed-companion" }, { mode: "keyboard-only" },
    ...[{ sources: ["agent-events"] }, { sources: ["host-action-events"] }, { sources: [] }, { status: "paused" }, { status: "stopped" },
      ...["codex", "terminal", "vscode"].map(category => ({ exclusions: [category] }))].map(p => ({ observations: [observation(p)] }))];
  for (const patch of patches) { const s = state(patch); assert.equal(appendEditorObservation(s, s.codingEditorConnections[0]), 0); assert.equal(s.observations[0].events.length, 0); }
});

test("unowned rows, absent acknowledgement, false retirement and unrecognized journal phases emit nothing", () => {
  const s = state(), r = s.codingEditorConnections[0];
  assert.equal(appendEditorObservation(s, structuredClone(r)), 0);
  for (const patch of [{ status: "ready" }, { status: "__proto__" }, { status: "acknowledged" }, { status: "stopped", retirement: { ...clean, carrierExitVerified: false } }, { status: "uncertain", retirement: clean }, { status: "stopped", retirement: { ...clean, unrelated: true } }, { updatedAt: NaN }, { requestId: "PRIVATE" }]) {
    const invalid = state({ codingEditorConnections: [row(patch)] }); assert.equal(appendEditorObservation(invalid, invalid.codingEditorConnections[0]), 0);
  }
});

test("duplicate and stale metadata collapse; pause cannot backfill and capacity preserves original events", () => {
  const s = state(), r = s.codingEditorConnections[0], o = s.observations[0];
  assert.equal(appendEditorObservation(s, r), 1); r.updatedAt = 11; assert.equal(appendEditorObservation(s, r), 0);
  Object.assign(r, { status: "acknowledged", acknowledgement: { protocolAcknowledged: true }, updatedAt: 9 });
  assert.equal(appendEditorObservation(s, r), 0);
  o.status = "paused"; r.updatedAt = 20; assert.equal(appendEditorObservation(s, r), 0);
  o.status = "recording"; Object.assign(r, { status: "stopped", retirement: clean, updatedAt: 30 });
  assert.equal(appendEditorObservation(s, r), 1); assert.deepEqual(o.events.map(e => e.status), ["reserved", "stopped"]);
  const full = state({ observations: [observation({ events: Array.from({ length: 2000 }, () => ({ original: true })) })] });
  const before = structuredClone(full.observations[0].events);
  assert.equal(appendEditorObservation(full, full.codingEditorConnections[0]), 0);
  assert.deepEqual(full.observations[0].events, before); assert.equal(full.observations[0].status, "paused"); assert.equal(full.observations[0].limitReached, true);
  const later = state({ observations: [observation({ createdAt: 100 })] }); assert.equal(appendEditorObservation(later, later.codingEditorConnections[0]), 0);
});

test("the normal Suite API admits editor recording only after explicit Personal consent", async t => {
  const root = await mkdtemp(join(tmpdir(), "syeo-")), keys = new Map();
  const store = createSuiteStore({ root, secrets: { get: async (c, p) => keys.get(c + p), set: async (c, p, v) => keys.set(c + p, v) } });
  const suite = createSuite({ store, agents: { discovery: async () => [], close() {} }, voice: { discovery: async () => ({ available: false }) } });
  t.after(async () => { await suite.close(); await rm(root, { recursive: true }); });
  await suite.handle("/api/suite/bootstrap");
  const start = { compartment: "personal", sources: ["editor-events"], exclusions: [], consent: true };
  await assert.rejects(suite.handle("/api/suite/observation/start", start), /keyboard-only|companion/i);
  await suite.handle("/api/suite/mode", { mode: "personal-companion" });
  await assert.rejects(suite.handle("/api/suite/observation/start", { ...start, consent: false }), /explicitly/);
  const o = await suite.handle("/api/suite/observation/start", start);
  assert.deepEqual(o.sources, ["editor-events"]); assert.deepEqual(o.events, []);
  await suite.handle("/api/suite/compartment/create", { compartment: "work", policy: "work" });
  await assert.rejects(suite.handle("/api/suite/observation/start", { ...start, compartment: "work" }), /prohibited|keyboard-only/i);
});
