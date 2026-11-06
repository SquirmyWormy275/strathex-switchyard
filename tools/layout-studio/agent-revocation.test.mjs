import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createSuiteStore } from "./suite-store.mjs";
import { createCustomAgents } from "./custom-agents.mjs";
import { agentRoutes, agentMessageSchema, requestMac } from "../../integrations/agent-protocol.mjs";

async function fixture(fn) {
  const root = await mkdtemp(join(tmpdir(), "agent-revocation-")), keys = new Map(); let at = 100000;
  const secrets = { get: async (id, p) => keys.get(`${id}:${p}`), set: async (id, p, v) => { keys.set(`${id}:${p}`, v); } };
  const store = createSuiteStore({ root, secrets, clock: () => at });
  const bridge = createCustomAgents({ store, now: () => at });
  const enroll = () => bridge.enroll("personal", { id: "test", name: "Synthetic", capabilities: ["status", "handoff", "review"] });
  const message = (token, sequence, path = agentRoutes.event, fields = { event: { status: "ready" } }, sessionId = "same-session") => {
    const body = { schema: agentMessageSchema, compartment: "personal", agentId: "test", sessionId, sequence, at, ...fields }, raw = JSON.stringify(body);
    return bridge.message(path, body, requestMac(token, path, raw), raw);
  };
  const revoke = async () => { const review = await bridge.reviewRevoke("personal", "test"); return bridge.revoke("personal", { agentId: "test", token: review.confirmation.token }); };
  try {
    await store.initialize("personal"); await store.update("personal", "synthetic-mode", s => { s.mode = "personal-companion"; });
    await fn({ root, store, bridge, keys, secrets, enroll, message, revoke, advance: n => { at += n; } });
  } finally { await rm(root, { recursive: true, force: true }); }
}

test("reviewed revocation preserves uncertain history, removes exact roles and cannot authorize a replacement credential", () => fixture(async ({ root, store, bridge, keys, enroll, message }) => {
  const original = await enroll(); await message(original.token, 1);
  const claim = await bridge.dispatch("personal", { agentId: "test", sessionId: "same-session", intent: "review" });
  await message(original.token, 2, agentRoutes.poll, {});
  const queued = await bridge.dispatch("personal", { agentId: "test", sessionId: "same-session", intent: "handoff", content: "PRIVATE_HANDOFF" });
  const before = (await store.snapshot("personal")).agents[0];
  await store.update("personal", "synthetic-roles", s => { s.roleBindings = [{ provider: "custom-agent", targetId: "test", roleId: "owned" }, { provider: "custom-agent", targetId: "other", roleId: "preserved" }]; });
  const review = await bridge.reviewRevoke("personal", "test");
  assert.deepEqual([review.queued, review.claimed, review.roleBindings, review.externalProcessStopped], [1, 1, 1, false]);
  assert.equal(JSON.stringify(review).includes("PRIVATE_HANDOFF"), false);
  const result = await bridge.revoke("personal", { agentId: "test", token: review.confirmation.token });
  assert.equal(result.externalProcessStopped, false);
  const state = await store.snapshot("personal"), a = state.agents[0];
  assert.equal(a.enrollmentStatus, "revoked"); assert.equal(a.sessionId, null);
  assert.equal(a.commands.find(c => c.id === claim.commandId).status, "uncertain-session-ended");
  assert.equal(a.commands.find(c => c.id === queued.commandId).status, "cancelled-before-claim");
  assert.deepEqual(state.roleBindings.map(b => b.roleId), ["preserved"]);
  assert.equal(keys.get("personal:agent-test"), original.token, "Revocation needs no credential-store mutation.");
  await assert.rejects(message(original.token, 3), /not actively enrolled/);
  await assert.rejects(bridge.dispatch("personal", { agentId: "test", sessionId: "same-session", intent: "status" }), /revoked/);
  const replacement = await enroll(); assert.notEqual(replacement.token, original.token);
  assert.notEqual((await store.snapshot("personal")).agents[0].credentialEpoch, before.credentialEpoch);
  await assert.rejects(message(original.token, 99), /authentication/);
  await message(replacement.token, 1);
  await assert.rejects(message(replacement.token, 2, agentRoutes.ack, { commandId: claim.commandId, outcome: "completed" }), /exact active claim/);
  await assert.rejects(bridge.dispatch("personal", { agentId: "test", sessionId: "same-session", intent: "status", credentialEpoch: before.credentialEpoch }), /replaced/);
  await assert.rejects(bridge.revoke("personal", { agentId: "test", token: review.confirmation.token }), /consum|scope|match|unavailable/i);
  assert.equal((await message(replacement.token, 2, agentRoutes.poll, {})).payload.result.command, null);
  assert.equal((await store.snapshot("personal")).agents[0].commands.length, 2);
  const sealed = await readFile(join(root, "personal.sealed.json"), "utf8");
  for (const secret of [original.token, replacement.token, "PRIVATE_HANDOFF", review.confirmation.token]) assert.equal(sealed.includes(secret), false);
}));

test("agent revocation review binds claims, roles, exact identity and expiry without accepting a stale token", () => fixture(async ({ store, bridge, enroll, message, advance }) => {
  const e = await enroll(); await message(e.token, 1);
  const review = await bridge.reviewRevoke("personal", "test");
  await bridge.dispatch("personal", { agentId: "test", sessionId: "same-session", intent: "status" });
  await assert.rejects(bridge.revoke("personal", { agentId: "test", token: review.confirmation.token }), /scope|match/i);
  const roles = await bridge.reviewRevoke("personal", "test");
  await store.update("personal", "synthetic-role", s => { s.roleBindings = [{ provider: "custom-agent", targetId: "test", roleId: "changed" }]; });
  await assert.rejects(bridge.revoke("personal", { agentId: "test", token: roles.confirmation.token }), /scope|match/i);
  await bridge.enroll("personal", { id: "other", name: "Other", capabilities: ["status"] });
  const exact = await bridge.reviewRevoke("personal", "test");
  await assert.rejects(bridge.revoke("personal", { agentId: "other", token: exact.confirmation.token }), /scope|match/i);
  advance(300001);
  await assert.rejects(bridge.revoke("personal", { agentId: "test", token: exact.confirmation.token }), /expir|unavailable|unknown/i);
  assert.equal((await store.snapshot("personal")).agents.every(a => a.enrollmentStatus === "active"), true);
}));

test("a failed revoke state commit preserves authorization and requires a fresh review", () => fixture(async ({ store, bridge, enroll, message }) => {
  const e = await enroll(); await message(e.token, 1); const review = await bridge.reviewRevoke("personal", "test");
  const update = store.update.bind(store);
  store.update = (id, op, fn, request) => update(id, op, async s => { const r = await fn(s); if (op === "agent-revoke") throw Error("synthetic save failure"); return r; }, request);
  await assert.rejects(bridge.revoke("personal", { agentId: "test", token: review.confirmation.token }), /save failure/);
  store.update = update;
  assert.equal((await store.snapshot("personal")).agents[0].enrollmentStatus, "active");
  await message(e.token, 2);
  await assert.rejects(bridge.revoke("personal", { agentId: "test", token: review.confirmation.token }), /consum/i);
  const fresh = await bridge.reviewRevoke("personal", "test"); await bridge.revoke("personal", { agentId: "test", token: fresh.confirmation.token });
}));

test("a replacement credential write followed by failed state persistence leaves the agent revoked", () => fixture(async ({ store, bridge, keys, enroll, message, revoke }) => {
  const e = await enroll(); await message(e.token, 1); await revoke();
  const update = store.update.bind(store);
  store.update = (id, op, fn, request) => update(id, op, async s => { const r = await fn(s); if (op === "agent-enroll") throw Error("synthetic save failure"); return r; }, request);
  await assert.rejects(enroll(), /save failure/); const abandoned = keys.get("personal:agent-test"); assert.notEqual(abandoned, e.token);
  store.update = update;
  assert.equal((await store.snapshot("personal")).agents[0].enrollmentStatus, "revoked");
  for (const token of [e.token, abandoned]) await assert.rejects(message(token, 99), /not actively enrolled/);
  const next = await enroll(); assert.notEqual(next.token, abandoned); await message(next.token, 1);
  assert.equal([...keys.keys()].filter(k => k.includes(":agent-")).length, 1, "Reenrollment must reuse one bounded OS credential slot.");
}));

test("credential verification and accepted messages serialize before revocation, including a delayed old credential read", () => fixture(async ({ store, bridge, enroll, message }) => {
  const e = await enroll(); await message(e.token, 1); const review = await bridge.reviewRevoke("personal", "test");
  const credential = store.credential.bind(store); let release, reached;
  const entered = new Promise(resolve => { reached = resolve; }), gate = new Promise(resolve => { release = resolve; });
  store.credential = async (...args) => { const value = await credential(...args); if (args[1] === "agent-test" && args[2] === undefined) { reached(); await gate; } return value; };
  const old = message(e.token, 2, agentRoutes.event, { event: { status: "busy" } }); await entered;
  let revoked = false; const pending = bridge.revoke("personal", { agentId: "test", token: review.confirmation.token }).then(r => { revoked = true; return r; });
  try { await new Promise(resolve => setImmediate(resolve)); assert.equal(revoked, false); }
  finally { release(); await Promise.all([old, pending]); store.credential = credential; }
  const next = await enroll(); await message(next.token, 1); await assert.rejects(message(e.token, 100), /authentication/);
  assert.equal((await store.snapshot("personal")).agents[0].sequence, 1);
}));

test("legacy enrollment and claims remain usable until deliberate revocation without granting the replacement their authority", () => fixture(async ({ store, bridge, enroll, message, revoke }) => {
  const e = await enroll();
  await store.update("personal", "synthetic-legacy", s => { delete s.agents[0].credentialEpoch; delete s.agents[0].enrollmentStatus; });
  await message(e.token, 1);
  const claim = await bridge.dispatch("personal", { agentId: "test", sessionId: "same-session", intent: "review", credentialEpoch: "legacy" });
  await store.update("personal", "synthetic-legacy-command", s => { delete s.agents[0].commands[0].credentialEpoch; });
  await message(e.token, 2, agentRoutes.poll, {}); await revoke(); const next = await enroll(); await message(next.token, 1);
  await assert.rejects(message(next.token, 2, agentRoutes.ack, { commandId: claim.commandId, outcome: "completed" }), /exact active claim/);
  assert.equal((await store.snapshot("personal")).agents[0].commands[0].status, "uncertain-session-ended");
}));

test("agent revocation and replacement keep work policy and keyboard-only mode fences", () => fixture(async ({ store, bridge, enroll }) => {
  await enroll(); await store.initialize("work", "work");
  await assert.rejects(bridge.reviewRevoke("work", "test"), /prohibited/);
  await assert.rejects(enroll(), /already enrolled/);
  await store.update("personal", "synthetic-keyboard", s => { s.mode = "keyboard-only"; });
  await assert.rejects(bridge.reviewRevoke("personal", "test"), /Keyboard-only/);
  await assert.rejects(enroll(), /Keyboard-only/);
}));
