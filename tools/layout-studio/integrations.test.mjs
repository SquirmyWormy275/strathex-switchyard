import assert from "node:assert/strict";
import test from "node:test";
import { createHmac } from "node:crypto";
import { createCustomAgents } from "./custom-agents.mjs";
import { createCopilot } from "./copilot.mjs";

function memoryStore() {
  const states = { personal: { id: "personal", policy: "personal", accounts: [], agents: [], observations: [], conversations: [], workflow: { name: "Synthetic", roles: [], steps: [] } }, work: { id: "work", policy: "work", accounts: [], agents: [], observations: [], conversations: [], workflow: { name: "Synthetic", roles: [], steps: [] } } }, secrets = new Map();
  return {
    states, secrets,
    async authorize(id, { provider, account } = {}) { const s = states[id]; if (!s || s.policy === "work" && provider && provider !== "microsoft-365-copilot") throw new Error("provider prohibited"); if (account && !s.accounts.includes(account)) throw new Error("account prohibited"); },
    async credential(id, purpose, value, request) { await this.authorize(id, request); if (value === undefined) return secrets.get(`${id}:${purpose}`); secrets.set(`${id}:${purpose}`, value); },
    async snapshot(id) { return structuredClone(states[id]); },
    async update(id, _, fn, request) { await this.authorize(id, request); const draft = structuredClone(states[id]); const result = await fn(draft); states[id] = draft; return result; }
  };
}

test("custom SDK events require exact scoped MAC, freshness and monotonic sequence; commands have one claim", async () => {
  const store = memoryStore(); let clock = 100000;
  const bridge = createCustomAgents({ store, now: () => clock });
  await assert.rejects(bridge.enroll("work", { id: "test", name: "Synthetic", capabilities: ["status"] }), /prohibited/);
  const enrollment = await bridge.enroll("personal", { id: "test", name: "Synthetic", capabilities: ["status", "review"] });
  const msg = (sequence, fields) => ({ schema: "switchyard-agent-message/v1", compartment: "personal", agentId: "test", sequence, at: clock, ...fields });
  const sign = (b) => createHmac("sha256", enrollment.token).update(JSON.stringify(b)).digest("hex");
  const ready = msg(1, { event: { sessionId: "exact-session", status: "ready" } });
  await assert.rejects(bridge.message("/agent/v1/event", ready, "forged"), /authentication/);
  await bridge.message("/agent/v1/event", ready, sign(ready));
  await assert.rejects(bridge.message("/agent/v1/event", ready, sign(ready)), /replayed/);
  await assert.rejects(bridge.dispatch("personal", { agentId: "test", intent: "cancel", sessionId: "exact-session" }), /capability/);
  const command = await bridge.dispatch("personal", { agentId: "test", intent: "review", sessionId: "exact-session" });
  await assert.rejects(bridge.dispatch("personal", { agentId: "test", intent: "review", sessionId: "exact-session" }), /duplicate/);
  const poll = msg(2, {}); assert.equal((await bridge.message("/agent/v1/poll", poll, sign(poll))).command.id, command.commandId);
  const pollAgain = msg(3, {}); assert.equal((await bridge.message("/agent/v1/poll", pollAgain, sign(pollAgain))).command, null);
  const ack = msg(4, { commandId: command.commandId, outcome: "completed" }); await bridge.message("/agent/v1/ack", ack, sign(ack));
  assert.equal(store.states.personal.agents[0].commands[0].status, "completed");
  clock += 31000;
  await assert.rejects(bridge.dispatch("personal", { agentId: "test", intent: "status", sessionId: "exact-session" }), /stale/);
  assert.equal(JSON.stringify(store.states).includes(enrollment.token), false);
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
