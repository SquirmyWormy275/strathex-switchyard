import assert from "node:assert/strict";
import test from "node:test";
import { EventEmitter } from "node:events";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createSuiteStore } from "./suite-store.mjs";
import { createSuite } from "./suite.mjs";
import { createAgentService } from "./agents.mjs";
import { newPlan, parseBoardProfile } from "./model.mjs";
import { copilotFixture, plan as workPlan } from "./test-support/copilot-fixture.mjs";

async function fixture(fn) {
  const root = await mkdtemp(join(tmpdir(), "switchyard-conversation-role-")), keys = new Map(), calls = [], pending = [];
  const store = createSuiteStore({ root: join(root, "state"), secrets: {
    get: async (id, purpose) => keys.get(`${id}:${purpose}`),
    set: async (id, purpose, value) => { keys.set(`${id}:${purpose}`, value); }
  } });
  const plan = newPlan(parseBoardProfile({ schema: "sxsy-board-profile/v1", name: "Synthetic", layout: "one", keys: [{ id: "one", label: "A", matrix: [0, 0], x: 0, y: 0, baseKeycode: "KC_A" }] }));
  const hooks = { account: async () => {}, resumed: async () => {}, reply: async () => {}, holdTurn: false };
  const client = new EventEmitter();
  Object.assign(client, { closed: false, nativeVersion: "0.166.0", accountFingerprint: "a".repeat(64), restrictionsVerified: true,
    initialize: async () => {}, close: () => { client.closed = true; },
    recheckAccount: async () => { await hooks.account(); return client.accountFingerprint; }
  });
  let turnStarted;
  const started = new Promise(resolve => { turnStarted = resolve; });
  client.request = async (method, params) => {
    calls.push({ method, params });
    if (method === "thread/resume") { await hooks.resumed(); return { thread: { id: params.threadId }, sandbox: { type: "readOnly" }, approvalPolicy: "never", modelProvider: "openai" }; }
    if (method === "turn/start") {
      turnStarted();
      if (!hooks.holdTurn) setImmediate(async () => {
        try {
          await hooks.reply();
          client.emit("notification", { method: "item/completed", params: { threadId: "exact-thread", turnId: "exact-turn", item: { type: "agentMessage", text: JSON.stringify({ reply: "SYNTHETIC_REPLY", summary: "Review", actions: [], steps: ["Review evidence"], roles: ["Reviewer"] }) } } });
          client.emit("notification", { method: "turn/completed", params: { threadId: "exact-thread", turn: { id: "exact-turn", status: "completed" } } });
        } catch (error) { client.emit("disconnected", error); }
      });
      return { turn: { id: "exact-turn" } };
    }
    if (method === "turn/interrupt") return {};
    throw Error("Unexpected synthetic provider operation: " + method);
  };
  const agents = createAgentService({ store, runtimeRoot: join(root, "runtime"), codexFactory: () => client, resolveCli: async () => "/synthetic/codex", resolveMcp: async () => [], stopChild: async () => ({ stopped: true }) });
  const suite = createSuite({ store, agents, voice: { discovery: async () => ({ available: false }) } });
  const bind = intent => suite.handle("/api/suite/roles/bind", { roleId: "builder", intent, provider: "codex", targetKind: "conversation", targetId: "original" });
  const dispatch = intent => suite.handle("/api/suite/intent", { implementation: "switchyard.role/v1", roleId: "builder", intent });
  try {
    // Initialize directly to avoid discovery constructing any unrelated provider.
    await store.initialize("personal"); await store.initialize("second");
    await store.update("personal", "synthetic-conversation", state => {
      state.mode = "personal-companion";
      state.profile = { plan };
      state.conversations = [{ id: "original", provider: "codex", sessionId: "exact-thread", accountFingerprint: client.accountFingerprint, updatedAt: Date.now(), messages: [] }];
    });
    await store.saveWorkflow("personal", { name: "Synthetic conversation roles", roles: [{ id: "builder", label: "Builder" }], steps: [] });
    await fn({ store, suite, agents, plan, hooks, calls, bind, dispatch, started, pending });
  } finally {
    try { await suite.close(); }
    finally { await Promise.allSettled(pending); await rm(root, { recursive: true, force: true }); }
  }
}

for (const boundary of ["same-role-rebind", "workspace-round-trip"]) {
  test(`conversation resume refuses ${boundary} after the account check`, () => fixture(async ({ suite, hooks, calls, bind, dispatch }) => {
    await bind("resume");
    hooks.account = async () => {
      hooks.account = async () => {};
      if (boundary === "same-role-rebind") await bind("resume");
      else { await suite.handle("/api/suite/compartment/select", { compartment: "second" }); await suite.handle("/api/suite/compartment/select", { compartment: "personal" }); }
    };
    await assert.rejects(dispatch("resume"), /role binding changed|workspace changed/);
    assert.equal(calls.some(call => call.method === "thread/resume"), false);
  }));
}

test("a conversation design rebound after thread resume submits no model turn", () => fixture(async ({ store, hooks, calls, bind, dispatch }) => {
  await bind("review"); hooks.resumed = () => bind("review");
  await assert.rejects(dispatch("review"), { code: "SUBMISSION_BLOCKED" });
  assert.equal(calls.filter(call => call.method === "thread/resume").length, 1);
  assert.equal(calls.some(call => call.method === "turn/start"), false);
  assert.equal((await store.snapshot("personal")).intentResults?.length ?? 0, 0);
}));

test("a conversation design rebound before reply persistence retains no stale proposal", () => fixture(async ({ store, hooks, calls, bind, dispatch }) => {
  await bind("review"); hooks.reply = () => bind("review");
  await assert.rejects(dispatch("review"), /role binding changed/);
  assert.equal(calls.filter(call => call.method === "turn/start").length, 1);
  const state = await store.snapshot("personal");
  assert.equal(JSON.stringify(state).includes("SYNTHETIC_REPLY"), false);
  assert.equal(state.intentResults?.length ?? 0, 0);
}));

test("the encrypted conversation reply transaction rejects a role changed after the async guard", () => fixture(async ({ store, bind, dispatch }) => {
  await bind("review"); const update = store.update.bind(store);
  store.update = async (id, operation, ...args) => { if (operation === "design-conversation") await bind("review"); return update(id, operation, ...args); };
  await assert.rejects(dispatch("review"), /role binding changed/);
  assert.equal(JSON.stringify(await store.snapshot("personal")).includes("SYNTHETIC_REPLY"), false);
}));

test("an unchanged conversation role resumes and records a synthetic design reply", () => fixture(async ({ store, calls, bind, dispatch }) => {
  await bind("resume"); assert.equal((await dispatch("resume")).status, "resumed");
  await bind("review"); assert.equal((await dispatch("review")).reply, "SYNTHETIC_REPLY");
  assert.equal(calls.filter(call => call.method === "turn/start").length, 1);
  assert.equal((await store.snapshot("personal")).intentResults.length, 2);
}));

test("a rebound cancellation role cannot interrupt the original conversation turn", () => fixture(async ({ store, agents, plan, hooks, calls, bind, dispatch, started, pending }) => {
  await bind("cancel"); hooks.holdTurn = true;
  const turn = agents.design({ compartment: "personal", provider: "codex", message: "Synthetic held turn", plan, conversationId: "original" }).then(value => ({ value }), error => ({ error }));
  pending.push(turn); await started;
  const snapshot = store.snapshot.bind(store); let changed = false;
  store.snapshot = async (...args) => {
    const state = await snapshot(...args);
    if (!changed) { changed = true; await bind("cancel"); }
    return state;
  };
  await assert.rejects(dispatch("cancel"), /role binding changed/);
  assert.equal(calls.some(call => call.method === "turn/interrupt"), false);
}));

for (const boundary of ["unchanged", "credential-read", "remote-reply", "history-write"]) {
  test(`Microsoft conversation role delivery and retention at ${boundary} use the original binding`, async t => {
    const f = await copilotFixture(t); await f.store.initialize("personal"); await f.seed(f.credential.account); await f.store.selection("work");
    await f.store.saveWorkflow("work", { name: "Synthetic work roles", roles: [{ id: "builder", label: "Builder" }], steps: [] });
    await f.store.update("work", "synthetic-profile", state => { state.profile = { plan: workPlan }; });
    const suite = createSuite({ store: f.store, copilot: f.api, agents: { discovery: async () => [], close: async () => {} }, voice: { discovery: async () => ({ available: false }) } });
    const bind = () => suite.handle("/api/suite/roles/bind", { compartment: "work", roleId: "builder", intent: "review", provider: "microsoft-365-copilot", targetId: "owned-conversation" });
    try {
      await bind();
      if (boundary === "credential-read") {
        const credential = f.store.credential.bind(f.store); let changed = false;
        f.store.credential = async (...args) => { const value = await credential(...args); if (!changed) { changed = true; await bind(); } return value; };
      } else if (boundary === "remote-reply") f.hook(() => bind());
      else if (boundary === "history-write") {
        const update = f.store.update.bind(f.store);
        f.store.update = async (id, operation, ...args) => { if (operation === "m365-design") await bind(); return update(id, operation, ...args); };
      }
      const invoke = () => suite.handle("/api/suite/intent", { implementation: "switchyard.role/v1", roleId: "builder", intent: "review" });
      if (boundary === "unchanged") assert.equal((await invoke()).reply, "Synthetic proposal only");
      else await assert.rejects(invoke(), /role binding changed/);
      assert.equal(f.calls.length, boundary === "credential-read" ? 0 : 1);
      const state = await f.store.snapshot("work");
      assert.equal(state.conversations[0].messages.length, boundary === "unchanged" ? 2 : 0);
      assert.equal(state.intentResults?.length ?? 0, boundary === "unchanged" ? 1 : 0);
      const requests = await f.api.listRequests("work");
      if (boundary === "credential-read") assert.equal(requests.length, 0);
      else {
        assert.equal(requests.length, 1);
        assert.equal(requests[0].status, boundary === "unchanged" ? "completed" : "outcome-unconfirmed");
        assert.equal(requests[0].remoteCancellationVerified, false);
      }
    } finally { await suite.close(); }
  });
}
