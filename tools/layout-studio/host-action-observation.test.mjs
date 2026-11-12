import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { appendHostActionObservation } from "./host-action-observation.mjs";
import { repositoryEffectTransaction, repositoryEffectJournal } from "./repository-effect-journal.mjs";
import { createSuiteStore } from "./suite-store.mjs";
import { createSuite } from "./suite.mjs";
import { observationSummary } from "./workflow.mjs";

const observation = changes => ({ id: "observation", status: "recording", sources: ["host-action-events"], exclusions: [], events: [], updatedAt: 10, ...changes });
const state = changes => ({ id: "personal", policy: "personal", mode: "personal-companion", observations: [observation()], ...changes });
const session = changes => ({ id: "private-session", provider: "generic", surface: "bridge", capabilities: ["registered", "mediated"], targetSnapshotId: "private-target", adapterVersion: "switchyard-host-execution/v1", metadata: { nativeProvider: "codex", accountFingerprint: "PRIVATE_ACCOUNT" }, workspaceRoot: "/PRIVATE_PATH", ...changes });
const operation = changes => ({ id: "private-operation", action: "shield_supply_chain", targetSnapshotId: "private-target", state: "prepared", details: { sessionId: "private-session", privateCommand: "PRIVATE_COMMAND" }, ...changes });
const receipt = changes => ({ id: "private-receipt", operationId: "private-operation", action: "shield_supply_chain", targetSnapshotId: "private-target", result: "failed", evidenceDigest: "PRIVATE_EVIDENCE", ...changes });
const journal = s => repositoryEffectTransaction(s, "execution", { now: () => 100 });
async function prepared(s, sess = session(), op = operation()) { const tx = journal(s); await tx.append("session.registered", { session: sess }); await tx.append("operation.created", { operation: op }); return tx; }

test("host journal metadata cannot backfill before initial consent or across a resumed interval", async () => {
  for (const timing of [{ createdAt: 101 }, { createdAt: 0, recordingSince: 101 }]) {
    const s = state({ observations: [observation(timing)] }), before = structuredClone(s.observations);
    await prepared(s);
    assert.deepEqual(s.observations, before);
    const tx = repositoryEffectTransaction(s, "execution", { now: () => 101 });
    await tx.append("receipt.issued", { receipt: receipt() });
    assert.deepEqual(s.observations[0].events.map(e => [e.phase, e.at]), [["host-action-receipt-recorded", 101]]);
  }
});

test("installed observation proof refuses broader or duplicate flags before application or account access", () => {
  const script = fileURLToPath(new URL("../../scripts/verify-shield-host.mjs", import.meta.url));
  for (const args of [["--synthetic", "--host-action-events"], ["--synthetic", "--action=shield_supply_chain", "--host-action-events"], ["--synthetic", "--action=shield_supply_chain", "--pep440-requirements", "--host-action-events", "--host-action-events"], ["--synthetic", "--action=shield_change_scan", "--pep440-requirements", "--host-action-events"]]) {
    const r = spawnSync(process.execPath, [script, ...args], { encoding: "utf8", timeout: 10000 }); assert.equal(r.error, undefined); assert.notEqual(r.status, 0); assert.equal(r.stdout, ""); assert.match(r.stderr, /Usage: node scripts\/verify-shield-host/);
  }
});

test("local prepared, receipt and invalidation metadata are private, correlated and explicitly non-authoritative", async () => {
  const s = state(), tx = await prepared(s);
  await tx.append("receipt.issued", { receipt: receipt() });
  await tx.append("audit.recorded", { audit: { operationId: "private-operation", action: "shield_supply_chain", targetSnapshotId: "private-target", status: "failed", detail: "PRIVATE_OUTPUT" } });
  await tx.append("receipt.invalidated", { receiptId: "private-receipt", invalidatedBy: "PRIVATE_REASON" });
  const events = s.observations[0].events;
  assert.deepEqual(events.map(e => [e.phase, e.status]), [["host-action-prepared", "prepared"], ["host-action-receipt-recorded", "failed"], ["host-action-result-recorded", "failed"], ["host-action-receipt-invalidated", "invalidated"]]);
  for (const e of events) { assert.equal(e.intent, "shield_supply_chain"); assert.equal(e.provenance, "switchyard-local-host-action"); assert.equal(e.taskCompletionVerified, false); assert.equal(e.timeSavingMeasured, false); assert.match(e.subjectDigest, /^[a-f0-9]{64}$/); }
  assert.equal(new Set(events.map(e => e.subjectDigest)).size, 1);
  assert.doesNotMatch(JSON.stringify(events), /private-|PRIVATE_/);
  const other = state({ id: "other" }); await prepared(other); assert.notEqual(other.observations[0].events[0].subjectDigest, events[0].subjectDigest);
  const summary = observationSummary(s.observations[0]); assert.equal(summary.byKind.status.count, 4); assert.deepEqual(summary.suggestions, []);
});

test("old agent consent, Work, keyboard-only, pause, stop and provider exclusions collect no host metadata", async () => {
  for (const changes of [{ policy: "work", mode: "managed-companion" }, { mode: "keyboard-only" }, ...[{ sources: ["agent-events"] }, { sources: ["deliberate"] }, { status: "paused" }, { status: "stopped" }, { exclusions: ["codex"] }].map(o => ({ observations: [observation(o)] }))]) {
    const s = state(changes); await prepared(s); await journal(s).append("receipt.issued", { receipt: receipt() }); assert.equal(s.observations[0].events.length, 0);
  }
  const s = state({ observations: [observation({ exclusions: ["claude"] })] }); await prepared(s, session({ metadata: { nativeProvider: "claude-code" } })); assert.equal(s.observations[0].events.length, 0);
});

test("Windows mediation binds its provider at preparation and later session reuse cannot relabel receipts", async () => {
  const s = state(), tx = await prepared(s, session({ adapterVersion: "switchyard-windows-execution/v1", metadata: { nativeProvider: "claude-code" } }));
  await tx.append("session.updated", { session: session() });
  await tx.append("receipt.issued", { receipt: receipt({ result: "incomplete" }) });
  assert.deepEqual(s.observations[0].events.map(e => e.provider), ["claude-code", "claude-code"]);
  await tx.append("receipt.issued", { receipt: receipt({ id: "second-receipt", result: "incomplete" }) });
  await tx.append("receipt.invalidated", { receiptId: "private-receipt", invalidatedBy: "changed" });
  await tx.append("receipt.invalidated", { receiptId: "private-receipt", invalidatedBy: "changed-again" });
  assert.equal(s.observations[0].events.length, 3);
});

test("unknown adapters, self reports, child effects, changed scopes and absent journal associations are ignored", async () => {
  for (const sess of [session({ adapterVersion: "custom" }), session({ provider: "codex" }), session({ surface: "terminal" }), session({ capabilities: [] }), session({ targetSnapshotId: "other" }), session({ metadata: { nativeProvider: "custom-agent" } })]) { const s = state(); await prepared(s, sess); assert.equal(s.observations[0].events.length, 0); }
  for (const op of [operation({ parentId: "parent" }), operation({ action: "invented-completion" }), operation({ id: "/PRIVATE_PATH" }), operation({ details: {} })]) { const s = state(); await prepared(s, session(), op); assert.equal(s.observations[0].events.length, 0); }
  const s = state(), tx = await prepared(s);
  for (const r of [receipt({ action: "run_target" }), receipt({ targetSnapshotId: "other" }), receipt({ operationId: "missing" }), receipt({ result: "PRIVATE_STATUS" })]) await tx.append("receipt.issued", { receipt: r });
  await tx.append("receipt.invalidated", { receiptId: "missing" });
  for (const audit of [{ operationId: "missing", action: "shield_supply_chain", targetSnapshotId: "private-target", status: "completed" }, { operationId: "private-operation", action: "run_target", targetSnapshotId: "private-target", status: "completed" }, { operationId: "private-operation", action: "shield_supply_chain", targetSnapshotId: "private-target", status: "PRIVATE_STATUS" }]) await tx.append("audit.recorded", { audit });
  assert.equal(s.observations[0].events.length, 1);
  assert.equal(appendHostActionObservation(s, "effects", s.repositoryExecutionJournal.at(-1)), 0);
  assert.equal(appendHostActionObservation(s, "execution", structuredClone(s.repositoryExecutionJournal.at(-1))), 0);
});

test("full recordings pause without losing history and paused metadata never backfills on resume", async () => {
  const original = Array.from({ length: 2000 }, () => ({ kind: "status", provenance: "original" }));
  const s = state({ observations: [observation({ events: structuredClone(original) })] }); await prepared(s);
  assert.equal(s.observations[0].status, "paused"); assert.equal(s.observations[0].limitReached, true); assert.deepEqual(s.observations[0].events, original);
  const paused = state({ observations: [observation({ status: "paused" })] }), tx = await prepared(paused);
  paused.observations[0].status = "recording"; await tx.append("receipt.issued", { receipt: receipt() });
  assert.deepEqual(paused.observations[0].events.map(e => e.phase), ["host-action-receipt-recorded"]);
});

test("normal API consent and encrypted transaction rollback protect host observations without another state write", async t => {
  const root = await mkdtemp(join(tmpdir(), "switchyard-host-observation-")), keys = new Map();
  const store = createSuiteStore({ root, secrets: { get: async (id, purpose) => keys.get(`${id}:${purpose}`), set: async (id, purpose, value) => keys.set(`${id}:${purpose}`, value) } });
  const suite = createSuite({ store, agents: { discovery: async () => [], close() {} }, voice: { discovery: async () => ({ available: false }) } });
  t.after(async () => { await suite.close(); await rm(root, { recursive: true, force: true }); }); await suite.handle("/api/suite/bootstrap");
  const start = { compartment: "personal", sources: ["host-action-events"], exclusions: [], consent: true };
  await assert.rejects(suite.handle("/api/suite/observation/start", start), /keyboard-only|companion/i);
  await suite.handle("/api/suite/mode", { mode: "personal-companion" });
  await assert.rejects(suite.handle("/api/suite/observation/start", { ...start, consent: false }), /explicitly/);
  await suite.handle("/api/suite/compartment/create", { compartment: "work", policy: "work" });
  await assert.rejects(suite.handle("/api/suite/observation/start", { ...start, compartment: "work" }), /prohibited|keyboard-only/i);
  const started = await suite.handle("/api/suite/observation/start", start);
  const beforeWrites = (await store.snapshot("personal")).audit.filter(e => e.operation === "repository-effect-journal").length;
  const j = repositoryEffectJournal(store, "personal", { domain: "execution", now: () => started.createdAt });
  await j.append("session.registered", { session: session() });
  const before = await readFile(join(root, "personal.sealed.json"));
  await assert.rejects(j.transaction(async tx => { await tx.append("operation.created", { operation: operation() }); throw Error("Synthetic lost final commit"); }), /lost final commit/);
  assert.deepEqual(await readFile(join(root, "personal.sealed.json")), before);
  await j.append("operation.created", { operation: operation() });
  const guarded = repositoryEffectJournal(store, "personal", { domain: "execution", now: () => started.createdAt, receiptGuard: () => { throw Error("Synthetic revoked receipt authority"); } });
  await assert.rejects(guarded.append("receipt.issued", { receipt: receipt() }), /revoked/);
  assert.deepEqual((await store.snapshot("personal")).observations[0].events.map(e => e.phase), ["host-action-prepared"]);
  await j.append("receipt.issued", { receipt: receipt() });
  const saved = await store.snapshot("personal"); assert.equal(saved.observations[0].events.length, 2);
  assert.equal(saved.audit.filter(e => e.operation === "repository-effect-journal").length - beforeWrites, 3);
  assert.doesNotMatch(await readFile(join(root, "personal.sealed.json"), "utf8"), /host-action|private-session|PRIVATE_/);
});
