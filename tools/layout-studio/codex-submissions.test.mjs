import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { randomUUID } from "node:crypto";
import { mkdtemp, mkdir, readFile, rename, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { codexDesignConfig } from "./agents.mjs";
import { createCodexSubmissions } from "./codex-submissions.mjs";
import { repositoryIdentity } from "./coding-task-identity.mjs";
import { createSuiteStore } from "./suite-store.mjs";
import { createSuite } from "./suite.mjs";
import { appendAgentObservation } from "./agent-observation.mjs";
const tick = () => new Promise((r) => setImmediate(r));
async function fixture(fn) {
  const root = await mkdtemp(join(tmpdir(), "switchyard-codex-text-")), repositoryRoot = join(root, "repo"), keys = new Map(), calls = [], clients = [];
  await mkdir(join(repositoryRoot, ".git"), { recursive: true });
  let clock = Date.now();
  const store = createSuiteStore({ root: join(root, "state"), clock: () => clock, secrets: { get: async (c, p) => keys.get(`${c}:${p}`), set: async (c, p, v) => keys.set(`${c}:${p}`, v) } });
  const task = { schema: "switchyard-coding-session/v1", id: randomUUID(), provider: "codex", status: "registered", nativeTransport: "owned-stdio", label: "Synthetic task", repositoryRoot, repositoryIdentity: await repositoryIdentity(repositoryRoot), accountFingerprint: "a".repeat(64), sessionId: randomUUID(), launchPolicy: "read-only/on-request" };
  for (const c of ["personal", "other"]) { await store.initialize(c); await store.update(c, "synthetic-task", (s) => { s.mode = "personal-companion"; s.codingSessions = [{ ...task, sessionId: c === "personal" ? task.sessionId : randomUUID() }]; }); }
  await store.initialize("company", "work");
  const settings = { fingerprint: task.accountFingerprint, nativeVersion: "0.166.0", stopped: true, config: codexDesignConfig(), nativeState: "idle", wrongPermissions: false, onTurn: null, afterReply: () => {} };
  const options = { store, resolveCli: async () => "/synthetic/codex", resolveMcp: async () => [], now: () => clock, stopChild: async () => ({ stopped: settings.stopped }), clientFactory: (_, cwd, names) => {
    const client = new EventEmitter(); clients.push(client);
    Object.assign(client, { child: {}, closed: false, serverNames: names, nativeVersion: settings.nativeVersion, restrictionsVerified: true, accountFingerprint: settings.fingerprint, initialize: async () => {}, recheckAccount: async () => { if (client.accountFingerprint !== settings.fingerprint) throw Error("Synthetic native account changed"); }, close() { if (!this.closed) { this.closed = true; this.emit("disconnected"); } },
      request: async (method, params) => {
        calls.push({ method, params, cwd });
        if (method === "config/read") return { config: settings.config };
        if (method === "thread/read") return { thread: { id: params.threadId, cwd, turns: [], status: { type: settings.nativeState } } };
        if (method === "thread/resume") return { thread: { id: params.threadId, cwd }, cwd, sandbox: { type: settings.wrongPermissions ? "workspaceWrite" : "readOnly" }, modelProvider: "openai", approvalPolicy: "never" };
        if (method === "turn/start") {
          assert.ok((await store.snapshot("personal")).codingTurns.some((t) => t.status === "submitting" && t.prompt === params.input[0].text));
          if (settings.onTurn) return settings.onTurn(client, params);
          setImmediate(() => { client.emit("notification", { method: "item/completed", params: { threadId: params.threadId, turnId: "exact-turn", item: { type: "agentMessage", text: "Ready" } } }); settings.afterReply(); client.emit("notification", { method: "turn/completed", params: { threadId: params.threadId, turn: { id: "exact-turn", status: "completed" } } }); });
          return { turn: { id: "exact-turn" } };
        }
        if (method === "turn/interrupt") return {};
        throw Error("Unexpected native method");
      }
    }); return client;
  } };
  const service = createCodexSubmissions(options), input = { taskId: task.id, text: "Synthetic reviewed text only" };
  const approve = () => service.review("personal", input);
  const submit = (review, extra = {}) => service.submit("personal", { ...input, requestId: randomUUID(), token: review.confirmation.token, ...extra });
  try { await fn({ root, repositoryRoot, store, task, settings, clients, calls, service, options, input, approve, submit, advance: (ms) => { clock += ms; } }); }
  finally { settings.stopped = true; await service.close(); await rm(root, { recursive: true, force: true, maxRetries: 5, retryDelay: 50 }); }
}
test("the observed Codex revision is bound into text review and a changed version requires a new review",()=>fixture(async({settings,approve,submit,calls,store})=>{
  const old=await approve();assert.equal(old.scope.nativeVersion,'0.166.0');
  settings.nativeVersion='0.167.0';await assert.rejects(submit(old));assert.equal(calls.some(c=>c.method==='turn/start'),false);
  const current=await approve();assert.equal(current.scope.nativeVersion,'0.167.0');
  assert.equal((await submit(current)).status,'provider-turn-completed');
  assert.equal((await store.snapshot('personal')).codingTurns.at(-1).nativeVersion,'0.167.0');
}));
test("already authorized Codex text turns record exact runtime status through encrypted consented storage", () => fixture(async ({ store, task, settings, input, approve, submit, calls }) => {
  await store.update("personal", "synthetic-recording", s => { s.observations = [{ id: "runtime", status: "recording", sources: ["agent-events"], exclusions: [], events: [], createdAt: Date.now() - 1000, updatedAt: Date.now() }]; });
  settings.onTurn = (client, params) => {
    const emit = status => client.emit("notification", { method: "thread/status/changed", params: { threadId: params.threadId, status, privateText: "NEVER_RECORD" } });
    emit({ type: "active", activeFlags: [] }); emit({ type: "active", activeFlags: [] });
    setImmediate(() => { emit({ type: "idle" }); client.emit("notification", { method: "turn/completed", params: { threadId: params.threadId, turn: { id: "runtime-turn", status: "completed" } } }); });
    return { turn: { id: "runtime-turn" } };
  };
  const result = await submit(await approve()), state = await store.snapshot("personal"), rows = state.observations[0].events.filter(row => row.phase === "runtime-status-observed");
  assert.equal(result.status, "provider-turn-completed"); assert.deepEqual(rows.map(row => row.status), ["active", "idle"]);
  assert(rows.every(row => row.provenance === "native-provider-runtime-notification" && row.taskCompletionVerified === false));
  for (const secret of [task.sessionId, task.accountFingerprint, task.repositoryRoot, input.text, "NEVER_RECORD"]) assert.equal(JSON.stringify(rows).includes(secret), false);
  assert.equal(calls.filter(call => call.method === "turn/start").length, 1); assert.equal(calls.filter(call => call.method === "thread/resume").length, 1);
}));

test("reviewed text uses one exact owned restricted turn, retains its acknowledgement and prevents durable duplicate submission", () => fixture(async ({ root, store, task, calls, clients, service, options, input, approve, submit }) => {
  await store.update("personal", "synthetic-observation", s => { s.observations = [{ id: "text-events", status: "recording", sources: ["agent-events"], exclusions: [], events: [], updatedAt: Date.now() }]; appendAgentObservation(s, { provider: "codex", subjectId: task.id, phase: "identity-bound", status: "idle", at: Date.now() }); });
  const review = await approve(); assert.equal(review.modelPromptSubmitted, false); assert.equal(calls.some((c) => c.method === "thread/resume" || c.method === "turn/start"), false);
  const requestId = task.id, result = await submit(review, { requestId }); assert.equal(result.status, "provider-turn-completed"); assert.equal(result.reply, "Ready"); assert.equal(result.turnId, "exact-turn"); assert.equal(result.taskCompletionVerified, false);
  assert.equal(calls.filter((c) => c.method === "turn/start").length, 1); assert.ok(clients.every((c) => c.closed));
  const resume = calls.find((c) => c.method === "thread/resume"); assert.equal(resume.params.config.project_doc_max_bytes, 0); assert.equal(resume.params.approvalPolicy, "never"); assert.equal(resume.params.sandbox, "read-only");
  const restarted = createCodexSubmissions(options); try { const again = await restarted.submit("personal", { ...input, requestId, token: review.confirmation.token }); assert.equal(again.duplicatePrevented, true); } finally { await restarted.close(); }
  assert.equal(calls.filter((c) => c.method === "turn/start").length, 1);
  await assert.rejects(service.submit("personal", { ...input, text: "Different", requestId, token: review.confirmation.token }), /different reviewed text/);
  const sealed = await readFile(join(root, "state/personal.sealed.json"), "utf8"); assert.equal(sealed.includes(input.text), false); assert.equal(sealed.includes(review.confirmation.token), false); assert.equal((await store.snapshot("personal")).codingTurns.length, 1);
  const allEvents = (await store.snapshot("personal")).observations[0].events, events = allEvents.filter(event => event.phase.startsWith("text-"));
  assert.equal(allEvents.length, 4); assert.notEqual(allEvents[0].subjectDigest, events[0].subjectDigest, "the same raw UUID in task and text domains must not merge their correlation");
  assert.deepEqual(events.map(event => event.phase), ["text-request-reserved", "text-identity-bound", "text-reply-recorded"]);
  assert.deepEqual(events.map(event => event.status), ["reserved-locally", "active", "provider-turn-finished"]);
  assert.equal(new Set(events.map(event => event.subjectDigest)).size, 1);
  assert.ok(events.every(event => event.provider === "codex" && event.provenance === "switchyard-local-lifecycle" && event.taskCompletionVerified === false && event.timeSavingMeasured === false));
  for (const value of [task.id, task.sessionId, task.accountFingerprint, task.repositoryRoot, task.label, requestId, input.text, result.reply, result.turnId]) assert.equal(JSON.stringify(events).includes(value), false);
}));
test("reviewed-text collection respects source/category/pause fences including a pause before native acknowledgement", async () => {
  for (const fence of ["paused", "source", "excluded", "pause-before-ack"]) await fixture(async ({ store, settings, approve, submit }) => {
    await store.update("personal", "synthetic-observation", s => { s.observations = [{ id: "text-events", status: fence === "paused" ? "paused" : "recording", sources: [fence === "source" ? "deliberate" : "agent-events"], exclusions: fence === "excluded" ? ["codex"] : [], events: [], updatedAt: Date.now() }]; });
    if (fence === "pause-before-ack") settings.onTurn = async (client, params) => {
      await store.update("personal", "synthetic-pause", s => { s.observations[0].status = "paused"; });
      setImmediate(() => client.emit("notification", { method: "turn/completed", params: { threadId: params.threadId, turn: { id: "paused-turn", status: "completed" } } }));
      return { turn: { id: "paused-turn" } };
    };
    const result = await submit(await approve()); assert.equal(result.status, "provider-turn-completed");
    assert.deepEqual((await store.snapshot("personal")).observations[0].events.map(event => event.phase), fence === "pause-before-ack" ? ["text-request-reserved"] : []);
  });
});
test("failed preparation and uncertain delivery retain distinct local metadata without claiming remote completion", async () => {
  for (const attempted of [false, true]) await fixture(async ({ store, settings, calls, service, approve, submit }) => {
    await store.update("personal", "synthetic-observation", s => { s.observations = [{ id: "text-events", status: "recording", sources: ["agent-events"], exclusions: [], events: [], updatedAt: Date.now() }]; });
    const review = await approve(), requestId = randomUUID();
    if (attempted) settings.onTurn = async () => { throw new Error("Synthetic lost native acknowledgement"); };
    else settings.wrongPermissions = true;
    await assert.rejects(submit(review, { requestId }));
    assert.equal(calls.filter(call => call.method === "turn/start").length, attempted ? 1 : 0);
    let events = (await store.snapshot("personal")).observations[0].events;
    assert.deepEqual(events.map(event => event.phase), ["text-request-reserved", attempted ? "text-outcome-unconfirmed" : "text-request-failed"]);
    if (attempted) { const review = await service.reviewOutcome("personal", requestId); await service.resolveOutcome("personal", { id: requestId, token: review.confirmation.token }); events = (await store.snapshot("personal")).observations[0].events; assert.equal(events.at(-1).phase, "text-outcome-reviewed"); assert.equal(events.at(-1).status, "unknown"); }
    assert.ok(events.every(event => event.provenance === "switchyard-local-lifecycle" && event.taskCompletionVerified === false));
  });
});
test("account/connection drift between native completion and reply persistence preserves uncertainty and the original turn ID", async () => {
  for (const boundary of ["closed", "epoch"]) await fixture(async ({ store, clients, calls, service, input, approve, submit }) => {
    await store.update("personal", "synthetic-observation", s => { s.observations = [{ id: "text-events", status: "recording", sources: ["agent-events"], exclusions: [], events: [], updatedAt: Date.now() }]; });
    const review = await approve(), update = store.update, requestId = randomUUID();
    store.update = async (...args) => {
      if (args[1] === "coding-text-reply") { const client = clients.at(-1); if (boundary === "closed") client.close(); else client.accountEpoch = (client.accountEpoch ?? 0) + 1; }
      return update(...args);
    };
    await assert.rejects(submit(review, { requestId }), /account\/connection changed/);
    const state = await store.snapshot("personal"), turn = state.codingTurns[0];
    assert.equal(turn.status, "outcome-unconfirmed"); assert.equal(turn.failureCode, "ACCOUNT_UNCONFIRMED"); assert.equal(turn.reply, null); assert.equal(turn.turnId, "exact-turn");
    assert.deepEqual(state.observations[0].events.map(event => event.phase), ["text-request-reserved", "text-identity-bound", "text-outcome-unconfirmed"]);
    assert.equal((await service.submit("personal", { ...input, requestId, token: review.confirmation.token })).duplicatePrevented, true);
    assert.equal(calls.filter(call => call.method === "turn/start").length, 1);
  });
});

test("changed prompt, account enrollment, login, directory or expiry invalidates exact reviewed text before a model request", async () => {
  for (const change of ["text", "enrollment", "login", "directory", "expiry"]) await fixture(async ({ root, repositoryRoot, store, settings, calls, approve, submit, advance }) => {
    const review = await approve();
    if (change === "enrollment") await store.update("personal", "synthetic-enrollment", (s) => { s.accounts.push("new-enrollment"); });
    if (change === "login") settings.fingerprint = "b".repeat(64);
    if (change === "directory") { await rename(repositoryRoot, join(root, "preserved")); await mkdir(join(repositoryRoot, ".git"), { recursive: true }); }
    if (change === "expiry") advance(301000);
    await assert.rejects(submit(review, change === "text" ? { text: "Changed reviewed text" } : {}), /scope|account changed|directory was replaced|unknown|expired/);
    assert.equal(calls.some((c) => c.method === "turn/start"), false);
  });
});
test("Work, keyboard-only, external bindings, active native tasks and unverified repository configuration cannot receive a turn", async () => {
  await fixture(async ({ store, service, settings, calls, input, task }) => {
    await assert.rejects(service.review("company", input), /prohibited/); assert.equal(calls.length, 0);
    await store.update("personal", "synthetic-keyboard", (s) => { s.mode = "keyboard-only"; }); await assert.rejects(service.review("personal", input), /keyboard-only/i);
    await store.update("personal", "synthetic-external", (s) => { s.mode = "personal-companion"; delete s.codingSessions[0].launchPolicy; }); await assert.rejects(service.review("personal", input), /created by Switchyard/);
    await store.update("personal", "synthetic-owned", (s) => { s.codingSessions[0] = task; }); settings.nativeState = "active"; await assert.rejects(service.review("personal", input), /not verified idle/);
    settings.nativeState = "idle"; settings.config = { ...codexDesignConfig(), mcp_servers: { unknown: { enabled: true } } }; await assert.rejects(service.review("personal", input), /restricted design configuration/);
    assert.equal(calls.some((c) => c.method === "turn/start"), false);
  });
});
test("cancellation before acknowledgement retains the durable request and requires explicit outcome review without retry", () => fixture(async ({ store, settings, service, calls, input, approve, submit }) => {
  let entered, release; const ready = new Promise((r) => { entered = r; }); settings.onTurn = () => { entered(); return new Promise((r) => { release = r; }); };
  const review = await approve(), requestId = randomUUID(), pending = submit(review, { requestId }), rejected = assert.rejects(pending, /Cancellation|connection|stopped/); await ready;
  const cancelled = await service.cancel("personal", requestId); assert.equal(cancelled.taskCompletionVerified, false); await rejected; release({ turn: { id: "late-acknowledgement" } }); await tick();
  const saved = (await store.snapshot("personal")).codingTurns[0]; assert.equal(saved.status, "outcome-unconfirmed"); assert.equal(saved.turnId, null);
  assert.equal((await service.submit("personal", { ...input, requestId, token: review.confirmation.token })).duplicatePrevented, true);
  const next = await approve(); await assert.rejects(submit(next), /unresolved previous submission/);
  await assert.rejects(service.remove("personal", requestId), /Only completed/);
  const resolution = await service.reviewOutcome("personal", requestId); const result = await service.resolveOutcome("personal", { id: requestId, token: resolution.confirmation.token }); assert.equal(result.status, "reviewed-unconfirmed"); assert.equal(result.taskCompletionVerified, false);
  await assert.rejects(service.resolveOutcome("personal", { id: requestId, token: resolution.confirmation.token }), /unavailable/); assert.equal(calls.filter((c) => c.method === "turn/start").length, 1);
}));
test("failure to persist an acknowledgement retains its exact returned turn ID during failure recovery", () => fixture(async ({ store, calls, approve, submit }) => {
  const review = await approve(), update = store.update;
  store.update = async (c, operation, ...rest) => { if (operation === "coding-text-identity") throw Error("Synthetic sealed-state interruption"); return update(c, operation, ...rest); };
  await assert.rejects(submit(review), /exact binding/);
  const saved = (await store.snapshot("personal")).codingTurns[0]; assert.equal(saved.turnId, "exact-turn"); assert.equal(saved.reply, null); assert.equal(saved.status, "outcome-unconfirmed"); assert.equal(calls.filter((c) => c.method === "turn/start").length, 1);
}));
test("wrong resume permissions and a changed post-turn login cannot be retained as a successful reply", () => fixture(async ({ store, settings, calls, approve, submit }) => {
  settings.wrongPermissions = true; const first = await approve(); await assert.rejects(submit(first), /permissions did not verify/); assert.equal(calls.some((c) => c.method === "turn/start"), false); assert.equal((await store.snapshot("personal")).codingTurns[0].status, "failed-before-turn");
  settings.wrongPermissions = false; settings.afterReply = () => { settings.fingerprint = "b".repeat(64); };
  await assert.rejects(submit(await approve()), /account or generation changed/);
  assert.equal((await store.snapshot("personal")).codingTurns.some((t) => t.reply), false);
}));
test("unconfirmed owned exit blocks a replacement until that exact child verifies exit", () => fixture(async ({ settings, clients, approve }) => {
  settings.stopped = false; await assert.rejects(approve(), /exit is unconfirmed/); const count = clients.length;
  await assert.rejects(approve(), /previous owned text-task process/); assert.equal(clients.length, count);
  settings.stopped = true; assert.equal((await approve()).status, "requires-confirmation");
}));
test("suite routes preserve explicit review and keyboard-only shutdown of an owned text request", () => fixture(async ({ store, service, input, calls }) => {
  const suite = createSuite({ store, codexSubmissions: service, agents: { discovery: async () => [], close: async () => {} }, voice: { discovery: async () => ({ available: false }) } });
  try { const review = await suite.handle("/api/suite/coding/codex/turns/review", { compartment: "personal", ...input }); assert.equal(review.modelPromptSubmitted, false); await suite.handle("/api/suite/mode", { compartment: "personal", mode: "keyboard-only" }); await assert.rejects(suite.handle("/api/suite/coding/codex/turns/submit", { compartment: "personal", ...input, token: review.confirmation.token, requestId: randomUUID() }), /keyboard-only/i); assert.equal(calls.some((c) => c.method === "turn/start"), false); } finally { await suite.close(); }
}));

test("mode stop fences a pending native startup and preserves an unconfirmed live request for local review", () => fixture(async ({ store, service, options, input, clients, settings, approve, submit }) => {
  let entered, release; const ready = new Promise((r) => { entered = r; });
  const pendingService = createCodexSubmissions({ ...options, resolveCli: async () => { entered(); await new Promise((r) => { release = r; }); return "/synthetic/native"; } });
  try { const pending = pendingService.review("personal", input), rejected = assert.rejects(pending, /stopped/); await ready; await pendingService.stopCompartment("personal"); release(); await rejected; assert.equal(clients.length, 0); } finally { release?.(); await pendingService.close(); }
  let turnEntered, acknowledge; const turnReady = new Promise((r) => { turnEntered = r; }); settings.onTurn = () => { turnEntered(); return new Promise((r) => { acknowledge = r; }); };
  const review = await approve(), pending = submit(review), rejected = assert.rejects(pending, /Cancellation|connection|stopped/); await turnReady;
  await store.update("personal", "synthetic-keyboard-only", (s) => { s.mode = "keyboard-only"; }); await service.stopCompartment("personal"); await rejected; acknowledge({ turn: { id: "late-after-mode-stop" } }); await tick();
  const saved = (await store.snapshot("personal")).codingTurns[0]; assert.equal(saved.status, "outcome-unconfirmed"); assert.equal(saved.reply, null);
  const resolution = await service.reviewOutcome("personal", saved.id); const resolved = await service.resolveOutcome("personal", { id: saved.id, token: resolution.confirmation.token }); assert.equal(resolved.status, "reviewed-unconfirmed"); assert.equal(resolved.taskCompletionVerified, false);
}));

test("retention erases expired completed text but preserves unresolved identities and bounds new history before prompting", () => fixture(async ({ store, calls, approve, submit, advance }) => {
  await submit(await approve());
  await store.update("personal", "synthetic-unresolved-history", (s) => { s.codingTurns.push({ id: "retained-uncertain", status: "outcome-unconfirmed", prompt: "Synthetic unresolved context", updatedAt: Date.now() }); });
  advance(31 * 86400000); await store.update("personal", "synthetic-retention", () => {});
  assert.deepEqual((await store.snapshot("personal")).codingTurns.map((t) => t.id), ["retained-uncertain"]);
  await store.update("personal", "synthetic-full-history", (s) => { s.codingTurns = Array.from({ length: 32 }, (_, i) => ({ id: `synthetic-${i}`, status: "provider-turn-completed", updatedAt: Date.now() + 31 * 86400000 })); });
  const prior = calls.filter((c) => c.method === "turn/start").length;
  await assert.rejects(submit(await approve()), /older completed text turns/); assert.equal(calls.filter((c) => c.method === "turn/start").length, prior);
}));
