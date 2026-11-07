import assert from "node:assert/strict";
import test from "node:test";
import { EventEmitter, once } from "node:events";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { reviewDesignObservations, reviewedDesignObservations } from "./design-observations.mjs";
import { createSuiteStore } from "./suite-store.mjs";
import { createSuite } from "./suite.mjs";
import { createAgentService } from "./agents.mjs";
import { createStudioServer } from "./serve.mjs";
import { plan } from "./test-support/copilot-fixture.mjs";

const observation = (changes = {}) => ({ id: "selected", status: "stopped", sources: ["deliberate", "agent-events", "foreground-category"], exclusions: [],
  events: [{ kind: "handoff", provenance: "user-marked", at: 10 }, { kind: "status", provenance: "authenticated-agent-self-report", at: 20, subjectDigest: "PRIVATE_SUBJECT", content: "PRIVATE_CONTENT" }],
  focusCategories: { terminal: 2000 }, createdAt: 0, updatedAt: 20, ...changes });
const state = () => ({ id: "personal", policy: "personal", mode: "personal-companion", accounts: [], observations: [observation()] });
const confirmation = review => ({ sessionIds: review.sessionIds, reviewId: review.reviewId, confirmed: true });

test("reviewed observations contain only explicit aggregate source facts and never raw content or identities", () => {
  const s = state(), before = structuredClone(s), review = reviewDesignObservations(s, "codex", ["selected"]);
  assert.deepEqual(reviewedDesignObservations(s, "codex", confirmation(review)), review.context);
  assert.deepEqual(review.context.sessions, [{ number: 1, eventCounts: [{ kind: "handoff", provenance: "user-marked", count: 1 }, { kind: "status", provenance: "authenticated-agent-self-report", count: 1 }], sampledCategoryMilliseconds: { terminal: 2000 } }]);
  assert.match(review.context.boundary, /do not establish intent, task completion or time saved/);
  for (const secret of ["PRIVATE", "selected", "createdAt", "updatedAt", "subjectDigest"]) assert.equal(JSON.stringify(review.context).includes(secret), false);
  assert.deepEqual(s, before); assert.equal(reviewedDesignObservations(s, "codex", undefined), undefined);
});

test("recording, foreign, duplicate, malformed and over-bound selections refuse without widening consent", () => {
  for (const ids of [[], ["missing"], ["selected", "selected"], [null], [["selected"]], Array(9).fill("selected")]) assert.throws(() => reviewDesignObservations(state(), "codex", ids), /review their exact summary/);
  for (const change of [{ status: "recording" }, { events: Array(2001).fill({}) }, { sources: ["deliberate"] }, { exclusions: ["terminal"] }, { focusCategories: { title: 1 } }, { focusCategories: { terminal: Infinity } }, { events: [{ kind: "status", provenance: "unverified" }] }]) {
    const s = state(); s.observations = [observation(change)]; assert.throws(() => reviewDesignObservations(s, "codex", ["selected"]));
  }
  for (const change of [{ policy: "work" }, { mode: "keyboard-only" }, { mode: "managed-companion" }]) assert.throws(() => reviewDesignObservations({ ...state(), ...change }, "codex", ["selected"]));
  for (const provider of ["microsoft-365-copilot", "custom-agent", null]) assert.throws(() => reviewDesignObservations(state(), provider, ["selected"]));
});

test("confirmation binds exact sources, provider, workspace and account scope; supplied context cannot replace it", () => {
  const s = state(), review = confirmation(reviewDesignObservations(s, "codex", ["selected"]));
  for (const change of [{ confirmed: false }, { confirmed: "true" }, { context: {} }, { reviewId: [review.reviewId] }, { sessionIds: ["missing"] }]) assert.throws(() => reviewedDesignObservations(s, "codex", { ...review, ...change }));
  for (const mutate of [s => { s.observations[0].events.push({ kind: "review", provenance: "user-marked" }); }, s => { s.observations[0].updatedAt++; }, s => { s.id = "other"; }, s => { s.accounts.push("changed"); }, s => { s.modeSelectedAt = 21; }, s => { s.observations = []; }, s => { s.observations[0].status = "paused"; }]) {
    const changed = structuredClone(s); mutate(changed); assert.throws(() => reviewedDesignObservations(changed, "codex", review));
  }
  assert.throws(() => reviewedDesignObservations(s, "claude-code", review), /changed/);
  s.observations.push(observation({ id: "unselected", events: [{ kind: "other", provenance: "user-marked", content: "NEVER_SEND" }] }));
  assert.deepEqual(reviewedDesignObservations(s, "codex", review).sessions.length, 1);
  s.observations[1].updatedAt++; assert.doesNotThrow(() => reviewedDesignObservations(s, "codex", review));
});

async function fixture(t) {
  const root = await mkdtemp(join(tmpdir(), "sx-observation-design-")), keys = new Map();
  const store = createSuiteStore({ root, clock: () => 20, secrets: { get: async (c, p) => keys.get(c + ":" + p), set: async (c, p, v) => { keys.set(c + ":" + p, v); } } });
  await store.initialize("personal"); await store.initialize("work", "work");
  await store.update("personal", "synthetic-state", s => { s.mode = "personal-companion"; s.observations = [observation(), observation({ id: "unselected", events: [] })]; });
  const calls = [], client = new EventEmitter(); let checks = 0, onAccount = async () => {};
  Object.assign(client, { closed: false, nativeVersion: "0.166.0", accountFingerprint: "a".repeat(64), restrictionsVerified: true, initialize: async () => {},
    recheckAccount: async () => { await onAccount(++checks); return client.accountFingerprint; }, close() { this.closed = true; },
    request: async (method, params) => {
      calls.push({ method, params });
      if (["thread/start", "thread/resume"].includes(method)) return { thread: { id: "synthetic-thread" }, sandbox: { type: "readOnly" }, approvalPolicy: "never", modelProvider: "openai" };
      if (method === "turn/start") {
        setImmediate(() => {
          client.emit("notification", { method: "item/completed", params: { threadId: "synthetic-thread", turnId: "synthetic-turn", item: { type: "agentMessage", text: JSON.stringify({ reply: "Synthetic process suggestion", summary: "Review", actions: [], steps: ["Review evidence"], roles: ["Reviewer"] }) } } });
          client.emit("notification", { method: "turn/completed", params: { threadId: "synthetic-thread", turn: { id: "synthetic-turn", status: "completed" } } });
        }); return { turn: { id: "synthetic-turn" } };
      }
    }
  });
  const agents = createAgentService({ store, runtimeRoot: join(root, "runtime"), codexFactory: () => client, resolveCli: async () => "/synthetic/codex", resolveMcp: async () => [], stopChild: async () => ({ stopped: true }) });
  const suite = createSuite({ store, agents, voice: { discovery: async () => ({ available: false }) } });
  t.after(async () => { await suite.close(); await rm(root, { recursive: true, force: true }); });
  await suite.handle("/api/suite/bootstrap");
  return { root, store, suite, calls, client, agents, onAccount: fn => { onAccount = fn; } };
}

test("the encrypted suite reviews selected observations locally and sends only confirmed aggregates through the real Codex designer", async t => {
  const f = await fixture(t), before = await readFile(join(f.root, "personal.sealed.json"));
  const server = createStudioServer({ token: "synthetic-private-access", suite: f.suite, bridge: {} });
  server.listen(0, "127.0.0.1"); await once(server, "listening");
  t.after(async () => { server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); });
  const origin = `http://127.0.0.1:${server.address().port}`;
  const api = (route, body, extra = {}) => fetch(origin + "/api/suite/" + route, { method: "POST", headers: { Origin: origin, "Content-Type": "application/json", Authorization: "Bearer synthetic-private-access", ...extra }, body: JSON.stringify(body) });
  assert.equal((await api("design/observations/review", { provider: "codex", sessionIds: ["selected"] }, { Authorization: "Bearer unrelated" })).status, 401);
  assert.equal((await api("design/observations/review", { provider: "codex", sessionIds: ["selected"] }, { Origin: "https://elsewhere.invalid" })).status, 403);
  const preview = await api("design/observations/review", { provider: "codex", sessionIds: ["selected"] }); assert.equal(preview.status, 200); const review = await preview.json();
  assert.deepEqual(await readFile(join(f.root, "personal.sealed.json")), before); assert.equal(f.calls.length, 0);
  const sentRequest = await api("design", { provider: "codex", message: "Use my selected demonstration", plan, observationReview: confirmation(review) }); assert.equal(sentRequest.status, 200); const reply = await sentRequest.json();
  assert.equal(reply.reply, "Synthetic process suggestion");
  const sent = JSON.parse(f.calls.find(c => c.method === "turn/start").params.input[0].text);
  assert.deepEqual(sent.observations, review.context); assert.equal(JSON.stringify(sent).includes("PRIVATE"), false);
  const saved = await f.store.snapshot("personal"); assert.deepEqual(saved.observations, [observation(), observation({ id: "unselected", events: [] })]);
  assert.equal(saved.profile, null); assert.equal(saved.workflow.steps.length, 0); assert.equal(saved.conversations.length, 1);
  assert.equal((await readFile(join(f.root, "personal.sealed.json"), "utf8")).includes(reply.reply), false);
});

test("ordinary design sends no observations and stale or work-policy reviews refuse before provider access", async t => {
  const f = await fixture(t), review = await f.suite.handle("/api/suite/design/observations/review", { provider: "codex", sessionIds: ["selected"] });
  await assert.rejects(f.suite.handle("/api/suite/design/observations/review", { provider: "codex", sessionIds: ["selected"], context: {} }), /only the selected/);
  await assert.rejects(f.suite.handle("/api/suite/design/observations/review", { compartment: "work", provider: "codex", sessionIds: ["selected"] }), /prohibited|Keyboard-only/);
  await f.store.update("work", "synthetic-mode", s => { s.mode = "managed-companion"; });
  await assert.rejects(f.suite.handle("/api/suite/design", { compartment: "work", provider: "microsoft-365-copilot", message: "No export", plan, observationReview: confirmation(review) }), /observation export is not enabled/);
  await f.store.update("personal", "synthetic-delete", s => { s.observations = []; });
  await assert.rejects(f.agents.design({ compartment: "personal", provider: "codex", message: "No stale export", plan, observationReview: confirmation(review) })); assert.equal(f.calls.length, 0);
  await f.suite.handle("/api/suite/design", { provider: "codex", message: "Use my words only", plan });
  assert.equal(Object.hasOwn(JSON.parse(f.calls.find(c => c.method === "turn/start").params.input[0].text), "observations"), false);
});

test("deletion during the final native account check prevents observed context from reaching turn start", async t => {
  const f = await fixture(t), review = confirmation(reviewDesignObservations(await f.store.snapshot("personal"), "codex", ["selected"]));
  f.onAccount(async () => { if (f.calls.some(c => c.method === "thread/start")) await f.store.update("personal", "synthetic-delete", s => { s.observations = []; }); });
  await assert.rejects(f.agents.design({ compartment: "personal", provider: "codex", message: "No late export", plan, observationReview: review }), { code: "SUBMISSION_BLOCKED" });
  assert.equal(f.calls.some(c => c.method === "turn/start"), false); assert.equal(f.client.closed, true);
  assert.equal((await f.store.snapshot("personal")).conversations[0].status, "failed");
});

test("native runtime metadata requires its original source and a separate aggregate design review", () => {
  const s = state(); s.observations[0].events = [{ kind: "status", provenance: "native-provider-runtime-notification", at: 20, subjectDigest: "PRIVATE_SUBJECT" }];
  const review = reviewDesignObservations(s, "codex", ["selected"]);
  assert.deepEqual(review.context.sessions[0].eventCounts, [{ kind: "status", provenance: "native-provider-runtime-notification", count: 1 }]);
  assert.equal(JSON.stringify(review.context).includes("PRIVATE_SUBJECT"), false);
  s.observations[0].sources = ["deliberate"]; assert.throws(() => reviewedDesignObservations(s, "codex", confirmation(review)));
});
