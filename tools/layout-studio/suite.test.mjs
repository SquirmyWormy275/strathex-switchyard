import assert from "node:assert/strict";
import test from "node:test";
import { EventEmitter } from "node:events";
import { mkdtemp, readFile, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createSuiteStore } from "./suite-store.mjs";
import { createSuite } from "./suite.mjs";
import { createAgentService } from "./agents.mjs";
import { newPlan, parseBoardProfile } from "./model.mjs";
import { portableProfile } from "./workspace.mjs";
import { parseWorkflow } from "./workflow.mjs";

function samplePlan() { return newPlan(parseBoardProfile({ schema: "sxsy-board-profile/v1", name: "Synthetic", layout: "one", keys: [{ id: "one", label: "A", matrix: [0, 0], x: 0, y: 0, baseKeycode: "KC_A" }] })); }
async function fixture(fn) {
  const root = await mkdtemp(join(tmpdir(), "switchyard-suite-"));
  const keys = new Map(), secrets = { get: async (id, purpose) => keys.get(`${id}:${purpose}`), set: async (id, purpose, value) => { keys.set(`${id}:${purpose}`, value); } };
  const store = createSuiteStore({ root, secrets });
  try { await fn({ root, store, keys, secrets }); } finally { await rm(root, { recursive: true, force: true }); }
}

test("independent compartment encryption rejects swapping and tampering, with provider/account/export/recording boundaries", () => fixture(async ({ root, store, keys }) => {
  await assert.rejects(store.initialize("invalid", "constructor"), /Choose Personal/);
  await assert.rejects(store.initialize("invalid", ["work"]), /Choose Personal/);
  await store.initialize("personal", "personal"); await store.initialize("work", "work");
  assert.notEqual(keys.get("personal:storage-key"), keys.get("work:storage-key"));
  await store.update("personal", "synthetic-content", (s) => { s.workflow.name = "private synthetic content"; });
  const raw = await readFile(join(root, "personal.sealed.json"), "utf8");
  assert.equal(raw.includes("private synthetic content"), false);
  await assert.rejects(store.authorize("work", { provider: "codex" }), /prohibited/);
  await assert.rejects(store.authorize("work", { account: "unapproved" }), /not enrolled/);
  await assert.rejects(store.authorize("work", { operation: "record" }), /prohibited/);
  await assert.rejects(store.exportProfile("work"), /prohibited/);
  await assert.rejects(store.route("work", "personal", "synthetic-content", "microsoft-365-copilot"), /Cross-compartment/);
  await store.authorize("work", { provider: "microsoft-365-copilot" });
  assert.deepEqual((await store.snapshot("personal")).audit.at(-1).operation, "synthetic-content");
  assert.equal(JSON.stringify((await store.snapshot("personal")).audit).includes("private synthetic content"), false);
  const envelope = JSON.parse(raw); envelope.id = "work";
  await writeFile(join(root, "work.sealed.json"), JSON.stringify(envelope));
  await assert.rejects(store.snapshot("work"), /authenticate/);
}));

test("concurrent suite bootstrap recovers a compartment once and never silently changes its existing policy", () => fixture(async ({ store }) => {
  let recoveries = 0; const update = store.update.bind(store);
  store.update = async (id, operation, ...args) => { if (operation === "restart-recovery") recoveries++; return update(id, operation, ...args); };
  const suite = createSuite({ store, agents: { discovery: async () => [], close() {} }, voice: { discovery: async () => ({ available: false }) } });
  try {
    await Promise.all([suite.handle("/api/suite/bootstrap"), suite.handle("/api/suite/bootstrap")]);
    assert.equal(recoveries, 1);
    await assert.rejects(suite.handle("/api/suite/compartment/create", { compartment: "personal", policy: "work" }), /policy differs/);
    assert.equal((await store.snapshot("personal")).policy, "personal");
  } finally { await suite.close(); }
}));

test("missing keys never replace existing data; saved profiles survive restart and omit local environment data", () => fixture(async ({ root, store, keys, secrets }) => {
  await store.initialize("personal"); const p = portableProfile(samplePlan()); p.credentials = "never-portable";
  await store.saveProfile("personal", p);
  const restarted = createSuiteStore({ root, secrets });
  assert.deepEqual((await restarted.snapshot("personal")).profile.plan, samplePlan());
  assert.equal(JSON.stringify(await restarted.exportProfile("personal")).includes("never-portable"), false);
  const before = await readFile(join(root, "personal.sealed.json"), "utf8"); keys.delete("personal:storage-key");
  await assert.rejects(restarted.initialize("personal"), /key is unavailable/);
  assert.equal(await readFile(join(root, "personal.sealed.json"), "utf8"), before);
}));

test("workflow edits validate role bindings, step relationships and cycles", () => {
  const workflow = parseWorkflow({ name: "Review loop", roles: ["Builder", "Reviewer"], steps: ["Describe", "Build", "Review"] });
  assert.equal(workflow.steps[2].after[0], workflow.steps[1].id);
  assert.throws(() => parseWorkflow({ ...workflow, steps: workflow.steps.map((s, i) => ({ ...s, after: i ? [workflow.steps[i - 1].id] : [workflow.steps[2].id] })) }), /cycle/);
  assert.throws(() => parseWorkflow({ ...workflow, steps: [{ ...workflow.steps[0], roleId: "missing-role" }] }), /relationship/);
});

test("named profiles retain their workflow, isolate revisions by compartment, and preserve the current saved version after opening history", () => fixture(async ({ root, store, secrets }) => {
  await store.initialize("personal"); await store.initialize("work", "work");
  const workflow = parseWorkflow({ name: "Keep my place", roles: [{ id: "builder", label: "Builder" }], steps: ["Define", "Review"] });
  const first = portableProfile(samplePlan(), "f77", "F77 desk", workflow);
  await store.saveProfile("personal", first);
  assert.deepEqual((await store.snapshot("personal")).workflow, workflow);
  const changed = { ...first, name: "F77 updated" };
  await store.saveProfile("personal", changed);
  await store.saveProfile("personal", changed);
  await store.saveProfile("personal", { ...first, id: "b122", name: "B122 desk" });
  const restarted = createSuiteStore({ root, secrets }), state = await restarted.snapshot("personal");
  assert.equal(state.profiles.length, 2); assert.equal(state.profileHistory.length, 1);
  assert.deepEqual(await restarted.selectProfile("personal", "f77", state.profileHistory[0].revision), first);
  assert.deepEqual(await restarted.selectProfile("personal", "f77"), changed);
  await assert.rejects(restarted.selectProfile("work", "f77", state.profileHistory[0].revision), /unavailable/);
  assert.equal((await restarted.snapshot("work")).profile, null);
}));

test("observation and voice expose explicit sources, pause/restart recovery, deletion and encrypted retry without duplicating chunks", () => fixture(async ({ store, root }) => {
  let transcribeCalls = 0;
  const voice = { discovery: async () => ({ available: true }), transcribe: async () => { transcribeCalls++; return { text: "Synthetic transcript" }; } };
  const agents = { discovery: async () => [], close() {} };
  const suite = createSuite({ store, voice, agents });
  try {
    await suite.handle("/api/suite/bootstrap");
    await suite.handle("/api/suite/compartment/create", { compartment: "work", policy: "work" });
    await assert.rejects(suite.handle("/api/suite/voice/start", { compartment: "work", consent: true }), /prohibited/);
    await assert.rejects(suite.handle("/api/suite/observation/start", { compartment: "personal", sources: ["deliberate"], exclusions: [] }), /explicitly/);
    const o = await suite.handle("/api/suite/observation/start", { compartment: "personal", sources: ["deliberate"], exclusions: [], consent: true });
    await suite.handle("/api/suite/observation/mark", { id: o.id, kind: "handoff" });
    await suite.handle("/api/suite/observation/state", { id: o.id, status: "paused" });
    await assert.rejects(suite.handle("/api/suite/observation/mark", { id: o.id, kind: "resume" }), /Start deliberate/);
    const v = await suite.handle("/api/suite/voice/start", { consent: true });
    await suite.handle("/api/suite/voice/segment", { id: v.id, audio: "U3ludGhldGlj", chunkId: "chunk-one" });
    await suite.handle("/api/suite/voice/segment", { id: v.id, audio: "U3ludGhldGlj", chunkId: "chunk-one" });
    assert.equal(transcribeCalls, 1);
    assert.equal((await store.snapshot("personal")).voice[0].chunks[0].audio, null);
    await suite.handle("/api/suite/voice/review", { id: v.id, transcript: "Corrected synthetic transcript" });
    await suite.close();
    const restarted = createSuite({ store, voice, agents });
    await restarted.handle("/api/suite/bootstrap");
    const snapshot = await restarted.handle("/api/suite/snapshot");
    assert.equal(snapshot.observations[0].status, "interrupted");
    assert.equal(snapshot.voice[0].status, "paused");
    assert.equal(snapshot.voice[0].reviewedTranscript, "Corrected synthetic transcript");
    assert.equal((await readFile(join(root, "personal.sealed.json"), "utf8")).includes("Synthetic transcript"), false);
    await restarted.handle("/api/suite/observation/delete", { id: o.id });
    await restarted.handle("/api/suite/voice/delete", { id: v.id });
    assert.equal((await restarted.handle("/api/suite/snapshot")).voice.length, 0);
    await restarted.close();
  } finally { await suite.close(); }
}));

test("Codex design binds an exact returned session, rejects unsafe outputs and never switches providers", () => fixture(async ({ store, root }) => {
  await store.initialize("personal"); await store.initialize("work", "work");
  const calls = [];
  const fake = new EventEmitter(); fake.closed = false; fake.initialize = async () => {}; fake.close = () => { fake.closed = true; };
  fake.request = async (method, params) => {
    calls.push({ method, params });
    if (method === "thread/start") return { thread: { id: "synthetic-thread" } };
    if (method === "thread/resume") return { thread: { id: params.threadId } };
    if (method === "turn/start") {
      setImmediate(() => {
        fake.emit("notification", { method: "item/completed", params: { threadId: "synthetic-thread", item: { type: "agentMessage", text: JSON.stringify({ reply: "A synthetic response", summary: "Review the process", actions: [], steps: ["Review evidence"], roles: ["Reviewer"] }) } } });
        fake.emit("notification", { method: "turn/completed", params: { threadId: "synthetic-thread", turn: { status: "completed" } } });
      }); return { turn: { id: "synthetic-turn" } };
    }
  };
  const agents = createAgentService({ store, runtimeRoot: join(root, "runtime"), codexFactory: () => fake, resolveCli: async () => "/synthetic-native-cli" });
  try {
    await assert.rejects(agents.design({ compartment: "work", provider: "codex", message: "denied", plan: samplePlan() }), /prohibited/);
    assert.equal(calls.length, 0);
    const response = await agents.design({ compartment: "personal", provider: "codex", message: "Improve the review routine", plan: samplePlan() });
    assert.equal(response.sessionId, "synthetic-thread");
    assert.equal(calls.find((c) => c.method === "thread/start").params.config.features.shell_tool, false);
    assert.equal(calls.find((c) => c.method === "turn/start").params.sandboxPolicy.type, "readOnly");
    assert.equal((await store.snapshot("personal")).conversations[0].sessionId, "synthetic-thread");
  } finally { agents.close(); }
}));
