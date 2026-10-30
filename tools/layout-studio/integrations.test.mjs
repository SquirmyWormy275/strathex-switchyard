import assert from "node:assert/strict";
import test from "node:test";
import { createServer } from "node:http";
import { createCustomAgents } from "./custom-agents.mjs";
import { createCopilot } from "./copilot.mjs";
import { createStudioServer } from "./serve.mjs";
import { switchyardAgent } from "../../integrations/agent-sdk.mjs";
import { agentRoutes, agentMessageSchema, agentResponseSchema, requestMac, responseMac, sameMac } from "../../integrations/agent-protocol.mjs";

function memoryStore() {
  const states = { personal: { id: "personal", policy: "personal", accounts: [], agents: [], observations: [], conversations: [], workflow: { name: "Synthetic", roles: [], steps: [] } }, work: { id: "work", policy: "work", accounts: [], agents: [], observations: [], conversations: [], workflow: { name: "Synthetic", roles: [], steps: [] } } }, secrets = new Map();
  const pending = new Map(), history = [];
  return {
    states, secrets, history,
    async authorize(id, { provider, account } = {}) { const s = states[id]; if (!s || s.policy === "work" && provider && provider !== "microsoft-365-copilot") throw new Error("provider prohibited"); if (account && !s.accounts.includes(account)) throw new Error("account prohibited"); },
    async credential(id, purpose, value, request) { await this.authorize(id, request); if (value === undefined) return secrets.get(`${id}:${purpose}`); secrets.set(`${id}:${purpose}`, value); },
    async snapshot(id) { return structuredClone(states[id]); },
    async update(id, operation, fn, request) {
      const next = (pending.get(id) ?? Promise.resolve()).catch(() => {}).then(async () => { await this.authorize(id, request); const draft = structuredClone(states[id]); const result = await fn(draft); states[id] = draft; history.push({ operation, state: structuredClone(draft) }); return result; });
      pending.set(id, next); return next;
    }
  };
}

test("custom SDK events require exact scoped MAC, freshness and monotonic sequence; commands have one claim", async () => {
  const store = memoryStore(); let clock = 100000;
  const bridge = createCustomAgents({ store, now: () => clock });
  await assert.rejects(bridge.enroll("work", { id: "test", name: "Synthetic", capabilities: ["status"] }), /prohibited/);
  const enrollment = await bridge.enroll("personal", { id: "test", name: "Synthetic", capabilities: ["status", "review"] });
  const msg = (sequence, fields) => ({ schema: agentMessageSchema, compartment: "personal", agentId: "test", sessionId: "exact-session", sequence, at: clock, ...fields });
  const send = async (path, b, raw = JSON.stringify(b)) => {
    const r = await bridge.message(path, b, requestMac(enrollment.token, path, raw), raw);
    assert.equal(sameMac(r.signature, responseMac(enrollment.token, path, 200, JSON.stringify(r.payload))), true);
    assert.equal(r.payload.requestSequence, b.sequence); return r.payload.result;
  };
  const ready = msg(1, { event: { status: "ready" } });
  await assert.rejects(bridge.message(agentRoutes.event, ready, "forged"), /authentication/);
  await send(agentRoutes.event, ready, JSON.stringify(ready, null, 2));
  await assert.rejects(send(agentRoutes.event, ready), /replayed/);
  assert.equal(store.history.filter((h) => h.state.agents[0]?.sequence === 1).every((h) => h.state.agents[0].sessionId === "exact-session" && h.state.agents[0].reportedStatus === "ready"), true, "sequence and event must be durable in the same transaction");
  await assert.rejects(bridge.dispatch("personal", { agentId: "test", intent: "cancel", sessionId: "exact-session" }), /capability/);
  const command = await bridge.dispatch("personal", { agentId: "test", intent: "review", sessionId: "exact-session" });
  await assert.rejects(bridge.dispatch("personal", { agentId: "test", intent: "review", sessionId: "exact-session" }), /duplicate/);
  const poll = msg(2, {}); assert.equal((await send(agentRoutes.poll, poll)).command.id, command.commandId);
  const pollAgain = msg(3, {}); assert.equal((await send(agentRoutes.poll, pollAgain)).command, null);
  const ack = msg(4, { commandId: command.commandId, outcome: "completed" }); await send(agentRoutes.ack, ack);
  assert.equal(store.states.personal.agents[0].commands[0].status, "completed");
  clock += 31000;
  await assert.rejects(bridge.dispatch("personal", { agentId: "test", intent: "status", sessionId: "exact-session" }), /stale/);
  assert.equal(JSON.stringify(store.states).includes(enrollment.token), false);
});

test("SDK route substitution, failed mutations and concurrent replays cannot advance a session counter", async () => {
  const store = memoryStore(), bridge = createCustomAgents({ store, now: () => 100000 });
  const enrollment = await bridge.enroll("personal", { id: "test", name: "Synthetic", capabilities: ["review"] });
  const body = { schema: agentMessageSchema, compartment: "personal", agentId: "test", sessionId: "one", sequence: 1, at: 100000, event: { status: "ready" } };
  const send = (path, b) => bridge.message(path, b, requestMac(enrollment.token, path, JSON.stringify(b)));
  const poll = { ...body }; delete poll.event;
  await assert.rejects(bridge.message(agentRoutes.poll, poll, requestMac(enrollment.token, agentRoutes.event, JSON.stringify(poll))), /authentication/);
  await assert.rejects(send(agentRoutes.event, { ...body, event: { status: "completed" } }), /contract/);
  assert.equal(store.states.personal.agents[0].sequence, 0);
  const outcomes = await Promise.allSettled([send(agentRoutes.event, body), send(agentRoutes.event, body)]);
  assert.equal(outcomes.filter((r) => r.status === "fulfilled").length, 1);
  assert.match(outcomes.find((r) => r.status === "rejected").reason.message, /replayed/);
  await assert.rejects(send(agentRoutes.poll, { ...poll, sequence: 2, sessionId: "other" }), /current agent session/);
  await assert.rejects(send(agentRoutes.event, { ...body, sequence: 2, sessionId: "other", event: { status: "idle" } }), /publish ready/);
  assert.equal(store.states.personal.agents[0].sequence, 1);
  await assert.rejects(bridge.message("/agent/v1/event", { ...body, schema: "switchyard-agent-message/v1" }, "forged"), /v2/);
});

test("session replacement preserves uncertain claims and accepts a late exact acknowledgement without refreshing the new session", async () => {
  const store = memoryStore(); let clock = 100000, sequence = 0;
  const bridge = createCustomAgents({ store, now: () => clock });
  const enrollment = await bridge.enroll("personal", { id: "test", name: "Synthetic", capabilities: ["review", "status"] });
  const send = async (path, sessionId, fields = {}) => { const b = { schema: agentMessageSchema, compartment: "personal", agentId: "test", sessionId, sequence: ++sequence, at: clock, ...fields }; return (await bridge.message(path, b, requestMac(enrollment.token, path, JSON.stringify(b)))).payload.result; };
  await send(agentRoutes.event, "one", { event: { status: "ready" } });
  const claimed = await bridge.dispatch("personal", { agentId: "test", intent: "review", sessionId: "one" });
  await send(agentRoutes.poll, "one");
  await bridge.dispatch("personal", { agentId: "test", intent: "status", sessionId: "one" });
  await send(agentRoutes.event, "two", { event: { status: "ready" } });
  assert.deepEqual(store.states.personal.agents[0].commands.map((c) => c.status), ["uncertain-session-ended", "cancelled-before-claim"]);
  await assert.rejects(send(agentRoutes.poll, "one"), /current agent session/);
  assert.equal((await send(agentRoutes.poll, "two")).command, null);
  clock += 31000;
  await send(agentRoutes.ack, "one", { commandId: claimed.commandId, outcome: "completed" });
  assert.equal(store.states.personal.agents[0].commands[0].status, "completed");
  assert.equal(store.states.personal.agents[0].sessionId, "two");
  await assert.rejects(bridge.dispatch("personal", { agentId: "test", intent: "status", sessionId: "two" }), /stale/);
  store.states.personal.observations.push({ status: "recording", sources: ["agent-events"], events: Array.from({ length: 2000 }, () => ({ kind: "status" })) });
  await send(agentRoutes.event, "two", { event: { status: "idle" } });
  assert.equal(store.states.personal.observations[0].status, "paused");
  assert.equal(store.states.personal.observations[0].events.length, 2000);
});

async function listening(server, t) { await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve)); t.after(() => new Promise((resolve) => { server.closeAllConnections(); server.close(resolve); })); return `http://127.0.0.1:${server.address().port}/`; }

test("Node SDK exchanges authenticated HTTP events and one exact claim through the actual local server", async (t) => {
  const store = memoryStore(), bridge = createCustomAgents({ store });
  const enrollment = await bridge.enroll("personal", { id: "test", name: "Synthetic", capabilities: ["review"] });
  const server = createStudioServer({ bridge: { close() {} }, suite: { agentMessage: (...a) => bridge.message(...a), close() {} } });
  const baseUrl = await listening(server, t), sdk = switchyardAgent({ ...enrollment, baseUrl });
  assert.equal((await sdk.publish("exact-one", "ready")).accepted, true);
  const queued = await bridge.dispatch("personal", { agentId: "test", intent: "review", sessionId: "exact-one" });
  const claim = (await sdk.poll()).command; assert.equal(claim.id, queued.commandId);
  assert.equal((await sdk.poll()).command, null);
  await sdk.publish("exact-two", "ready");
  await sdk.acknowledge(claim.id, "completed");
  assert.equal(store.states.personal.agents[0].sessionId, "exact-two");
  assert.equal(store.states.personal.agents[0].commands[0].status, "completed");
  assert.equal((await fetch(`${baseUrl}agent/v1/event`, { method: "POST", headers: { "Content-Type": "application/json" }, body: "{}" })).status, 426);
  assert.equal((await fetch(`${baseUrl}agent/v2/event`, { method: "POST", headers: { "Content-Type": "application/json", Origin: baseUrl.slice(0, -1) }, body: "{}" })).status, 403);
});

test("the Node SDK rejects unsigned, replayed and wrong-session responses before returning any command", async (t) => {
  const token = "x".repeat(43); let fault = "unsigned";
  const server = createServer(async (req, res) => {
    let raw = ""; for await (const c of req) raw += c;
    const b = JSON.parse(raw);
    const payload = { schema: agentResponseSchema, requestSequence: fault === "replayed" ? b.sequence - 1 : b.sequence, sessionId: fault === "wrong-session" ? "other" : b.sessionId, result: { accepted: true } }, text = JSON.stringify(payload);
    if (fault !== "unsigned") res.setHeader("X-Switchyard-Response-Signature", responseMac(token, req.url, 200, text));
    res.end(text);
  });
  const sdk = switchyardAgent({ baseUrl: await listening(server, t), token, compartment: "personal", agentId: "test" });
  await assert.rejects(sdk.publish("exact", "ready"), /authentication/);
  fault = "replayed"; await assert.rejects(sdk.publish("exact", "ready"), /scope/);
  fault = "wrong-session"; await assert.rejects(sdk.publish("exact", "ready"), /scope/);
  fault = "valid"; assert.equal((await sdk.publish("exact", "ready")).accepted, true);
  await assert.rejects(sdk.poll(), /command.*contract/);
});

test("Copilot-only enrollment uses fixed Microsoft endpoints, opaque credentials and an exact owned Graph conversation", async () => {
  const store = memoryStore(), calls = []; let clock = 100000;
  const tenantId = "11111111-1111-1111-1111-111111111111", clientId = "22222222-2222-2222-2222-222222222222", account = "33333333-3333-3333-3333-333333333333", remoteId = "44444444-4444-4444-4444-444444444444";
  const fetcher = async (url, options) => {
    calls.push({ url, options });
    let value;
    if (url.endsWith("/devicecode")) value = { device_code: "synthetic-device-code", user_code: "EXAMPLE", verification_uri: "https://microsoft.com/devicelogin", expires_in: 900, interval: 5 };
    else if (url.endsWith("/token")) value = { access_token: "opaque-synthetic-token", refresh_token: "opaque-refresh", expires_in: 3600 };
    else if (url.includes("/v1.0/me")) value = { id: account, displayName: "Synthetic approved account" };
    else if (url.endsWith("/conversations")) value = { id: remoteId };
    else if (url.endsWith("/chat")) value = { id: remoteId, messages: [{ text: JSON.stringify({ reply: "Review this synthetic workflow", summary: "No key changes", actions: [], steps: ["Review evidence"], roles: ["Reviewer"] }) }] };
    else throw new Error("Unexpected Microsoft route");
    return new Response(JSON.stringify(value), { status: 200 });
  };
  const api = createCopilot({ store, fetcher, now: () => clock });
  await assert.rejects(api.beginLogin("work", { tenantId, clientId, approved: false }), /explicitly/); assert.equal(calls.length, 0);
  const login = await api.beginLogin("work", { tenantId, clientId, approved: true });
  assert.equal((await api.pollLogin("work", login.loginId)).status, "pending");
  clock += 6000; assert.equal((await api.pollLogin("work", login.loginId)).status, "connected");
  const plan = { schema: "sxsy-agentic-layout-plan/v1", profile: { schema: "sxsy-board-profile/v1", name: "Synthetic", layout: "one", controller: "unknown", keys: [{ id: "one", label: "A", matrix: [0, 0], x: 0, y: 0, baseKeycode: "KC_A" }] }, actions: [], study: null };
  const result = await api.design({ compartment: "work", message: "Synthetic design request", plan });
  assert.equal(result.provider, "microsoft-365-copilot"); assert.equal(result.sessionId, remoteId);
  assert.equal(JSON.stringify(store.states).includes("opaque-synthetic-token"), false);
  assert.equal(JSON.stringify(store.states).includes("synthetic-device-code"), false);
  assert.equal(calls.every((c) => c.options.redirect === "error"), true);
  await assert.rejects(api.design({ compartment: "work", message: "Do not fall back", plan, conversationId: "missing" }), /not owned/);
});
