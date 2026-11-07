import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import { once } from "node:events";
import { createSuiteStore } from "./suite-store.mjs";
import { createCustomAgents } from "./custom-agents.mjs";
import { createSuite } from "./suite.mjs";
import { createStudioServer } from "./serve.mjs";
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

test("delayed authenticated reports update their original agent but cannot backfill a resumed recording", () => fixture(async ({ store, bridge, enroll, message, advance }) => {
  const e = await enroll(); await message(e.token, 1);
  const claim = await bridge.dispatch("personal", { agentId: "test", sessionId: "same-session", intent: "review" });
  await message(e.token, 2, agentRoutes.poll, {});
  await store.update("personal", "synthetic-resume", s => {
    s.observations = [{ id: "recording", status: "recording", sources: ["agent-events"], exclusions: [], createdAt: 90000, updatedAt: 100001, recordingSince: 100001, recordingGeneration: "resumed", events: [] }];
  });
  advance(2);
  let sequence = 2;
  for (const [path, fields] of [[agentRoutes.event, { event: { status: "busy" } }], [agentRoutes.ack, { commandId: claim.commandId, outcome: "completed" }]]) {
    const body = { schema: agentMessageSchema, compartment: "personal", agentId: "test", sessionId: "same-session", sequence: ++sequence, at: 100000, ...fields }, raw = JSON.stringify(body);
    await bridge.message(path, body, requestMac(e.token, path, raw), raw);
  }
  const state = await store.snapshot("personal");
  assert.equal(state.agents[0].reportedStatus, "busy");
  assert.equal(state.agents[0].commands[0].status, "completed");
  assert.deepEqual(state.observations[0].events, [], "Remote reports from before renewed consent are not new recording events.");
}));

test("authenticated HTTP reports cannot cross a recording generation while awaiting another encrypted store lease", () => fixture(async ({ root, secrets, store, bridge, enroll, message }) => {
  const e = await enroll(); await message(e.token, 1);
  await store.update("personal", "synthetic-recording", s => {
    s.observations = [{ id: "recording", status: "recording", sources: ["agent-events"], exclusions: [], createdAt: 90000, updatedAt: 100000, recordingSince: 99999, recordingGeneration: "original", events: [] }];
  });
  const other = createSuiteStore({ root, secrets, clock: () => 100000 }), update = store.update.bind(store);
  let release, entered, arrived;
  const gate = new Promise(resolve => { release = resolve; });
  const holding = new Promise(resolve => { entered = resolve; });
  const waiting = new Promise(resolve => { arrived = resolve; });
  store.update = (id, operation, fn, request) => {
    if (operation === "agent-message") arrived();
    return update(id, operation, fn, request);
  };
  const changing = other.update("personal", "synthetic-consent-round-trip", async s => {
    entered(); await gate; s.observations[0].recordingGeneration = "replacement";
  });
  const server = createStudioServer({ bridge: { close() {} }, suite: { agentMessage: (...args) => bridge.message(...args), close() {} } });
  server.listen(0, "127.0.0.1"); await once(server, "listening");
  const base = `http://127.0.0.1:${server.address().port}`;
  const post = (sequence, status) => {
    const body = { schema: agentMessageSchema, compartment: "personal", agentId: "test", sessionId: "same-session", sequence, at: 100000, event: { status } }, raw = JSON.stringify(body);
    return fetch(base + agentRoutes.event, { method: "POST", headers: { "Content-Type": "application/json", "X-Switchyard-Signature": requestMac(e.token, agentRoutes.event, raw) }, body: raw });
  };
  let pending;
  try {
    await holding; pending = post(2, "busy");
    await waiting; release(); await changing;
    const response = await pending; await response.arrayBuffer(); assert.equal(response.status, 200);
    const state = await store.snapshot("personal");
    assert.equal(state.agents[0].reportedStatus, "busy");
    assert.deepEqual(state.observations[0].events, [], "Lease delay cannot transfer the report into replacement consent.");
    const fresh = await post(3, "waiting"); await fresh.arrayBuffer(); assert.equal(fresh.status, 200);
    const after = await store.snapshot("personal");
    assert.deepEqual(after.observations[0].events.map(event => [event.status, event.at]), [["waiting", 100000]]);
    const sealed = await readFile(join(root, "personal.sealed.json"), "utf8");
    for (const value of [e.token, "same-session", "adapter-status-observed"]) assert.equal(sealed.includes(value), false);
  } finally {
    release(); await changing; await pending?.catch(() => {});
    server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); await server.cleanup();
  }
}));

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

async function uncertainClaim({ bridge, enroll, message }, intent = "review") {
  const enrollment = await enroll(); await message(enrollment.token, 1);
  const claim = await bridge.dispatch("personal", { agentId: "test", sessionId: "same-session", intent, content: "PRIVATE_REVIEWED_HANDOFF" });
  await assert.rejects(bridge.reviewOutcome("personal", { agentId: "test", commandId: claim.commandId }), /uncertain claim/);
  await message(enrollment.token, 2, agentRoutes.poll, {});
  await assert.rejects(bridge.reviewOutcome("personal", { agentId: "test", commandId: claim.commandId }), /uncertain claim/);
  await message(enrollment.token, 3, agentRoutes.event, { event: { status: "ready" } }, "replacement-session");
  return { enrollment, claim, input: { agentId: "test", commandId: claim.commandId } };
}

test("an authenticated stopped session retires pending work and cannot resume delivery under the same identity", () => fixture(async ({ store, bridge, enroll, message }) => {
  const e = await enroll(); await message(e.token, 1);
  const claimed = await bridge.dispatch("personal", { agentId: "test", sessionId: "same-session", intent: "review" });
  await message(e.token, 2, agentRoutes.poll, {});
  const queued = await bridge.dispatch("personal", { agentId: "test", sessionId: "same-session", intent: "handoff", content: "PRIVATE_STOPPED_HANDOFF" });
  await message(e.token, 3, agentRoutes.event, { event: { status: "stopped" } });
  const stopped = (await store.snapshot("personal")).agents[0];
  assert.deepEqual(stopped.commands.map(c => c.status), ["uncertain-session-ended", "cancelled-before-claim"]);
  assert.equal(stopped.sessionId, "same-session"); assert.equal(stopped.reportedStatus, "stopped");
  for (const status of ["ready", "busy", "idle", "waiting", "failed"]) await assert.rejects(message(e.token, 4, agentRoutes.event, { event: { status } }), /stopped.*session|fresh.*session/i);
  await assert.rejects(message(e.token, 4, agentRoutes.poll, {}), /no longer owns/);
  await assert.rejects(bridge.dispatch("personal", { agentId: "test", sessionId: "same-session", intent: "status" }), /absent or stale/);
  assert.equal((await store.snapshot("personal")).agents[0].sequence, 3);
  const review = await bridge.reviewOutcome("personal", { agentId: "test", commandId: claimed.commandId });
  assert.equal(review.externalOutcomeVerified, false);
  await assert.rejects(bridge.reviewOutcome("personal", { agentId: "test", commandId: queued.commandId }), /uncertain claim/);
  await message(e.token, 4, agentRoutes.event, { event: { status: "ready" } }, "fresh-session");
  assert.equal((await message(e.token, 5, agentRoutes.poll, {}, "fresh-session")).payload.result.command, null);
  const history = (await store.snapshot("personal")).agents[0].commands;
  assert.deepEqual(history, stopped.commands, "New readiness must not revive either old command.");
}));

test("a stopped adapter can acknowledge its exact old claim without reviving readiness or accepting stale review", () => fixture(async ({ store, bridge, enroll, message, advance }) => {
  const e = await enroll(); await message(e.token, 1);
  const claim = await bridge.dispatch("personal", { agentId: "test", sessionId: "same-session", intent: "review" });
  await message(e.token, 2, agentRoutes.poll, {});
  await message(e.token, 3, agentRoutes.event, { event: { status: "stopped" } });
  const review = await bridge.reviewOutcome("personal", { agentId: "test", commandId: claim.commandId });
  const stopped = (await store.snapshot("personal")).agents[0]; advance(1000);
  await message(e.token, 4, agentRoutes.ack, { commandId: claim.commandId, outcome: "completed" });
  const current = (await store.snapshot("personal")).agents[0];
  assert.equal(current.commands[0].status, "completed");
  assert.equal(current.reportedStatus, "stopped"); assert.equal(current.lastSeen, stopped.lastSeen);
  assert.equal(current.sessionId, stopped.sessionId);
  await assert.rejects(bridge.resolveOutcome("personal", { agentId: "test", commandId: claim.commandId, token: review.confirmation.token }), /uncertain claim/);
  await assert.rejects(message(e.token, 5, agentRoutes.poll, {}), /no longer owns/);
}));

test("stop retirement, sequence and private observations commit together or all remain unchanged", () => fixture(async ({ root, store, bridge, enroll, message }) => {
  await store.update("personal", "synthetic-recording", s => { s.observations = [{ id: "recording", status: "recording", sources: ["agent-events"], exclusions: [], createdAt: 100000, updatedAt: 100000, events: [] }]; });
  const e = await enroll(); await message(e.token, 1);
  const claim = await bridge.dispatch("personal", { agentId: "test", sessionId: "same-session", intent: "handoff", content: "PRIVATE_STOPPED_HANDOFF" });
  await message(e.token, 2, agentRoutes.poll, {});
  const before = await store.snapshot("personal"), update = store.update.bind(store);
  store.update = (id, op, fn, scope) => update(id, op, async s => { await fn(s); throw Error("synthetic stop save failure"); }, scope);
  try { await assert.rejects(message(e.token, 3, agentRoutes.event, { event: { status: "stopped" } }), /stop save failure/); }
  finally { store.update = update; }
  const failed = await store.snapshot("personal");
  assert.deepEqual(failed.agents, before.agents); assert.deepEqual(failed.observations, before.observations);
  await message(e.token, 3, agentRoutes.event, { event: { status: "stopped" } });
  await assert.rejects(message(e.token, 3, agentRoutes.event, { event: { status: "stopped" } }), /replayed/);
  await message(e.token, 4, agentRoutes.event, { event: { status: "stopped" } });
  const state = await store.snapshot("personal"), retired = state.observations[0].events.filter(e => e.phase === "adapter-command-retired");
  assert.equal(retired.length, 1); assert.equal(retired[0].status, "unknown");
  assert.equal(retired[0].provenance, "switchyard-local-lifecycle"); assert.equal(retired[0].taskCompletionVerified, false);
  for (const secret of [e.token, claim.commandId, "PRIVATE_STOPPED_HANDOFF", "same-session"]) assert.equal(JSON.stringify(retired).includes(secret), false);
  const sealed = await readFile(join(root, "personal.sealed.json"), "utf8");
  assert.equal(sealed.includes("PRIVATE_STOPPED_HANDOFF"), false);
}));

test("reviewing an uncertain retired claim records only local uncertainty and never retries or verifies external work", () => fixture(async f => {
  await f.store.update("personal", "synthetic-recording", s => { s.observations = [{ id: "recording", status: "recording", sources: ["agent-events"], exclusions: [], createdAt: 100000, updatedAt: 100000, events: [] }]; });
  const { enrollment, input } = await uncertainClaim(f, "handoff");
  const review = await f.bridge.reviewOutcome("personal", input); assert.equal(review.command.content, "PRIVATE_REVIEWED_HANDOFF"); assert.equal(review.commandWillBeRetried, false);
  const result = await f.bridge.resolveOutcome("personal", { ...input, token: review.confirmation.token });
  assert.deepEqual([result.status, result.externalOutcomeVerified, result.taskCompletionVerified, result.providerCommandSent], ["reviewed-unconfirmed", false, false, false]);
  await assert.rejects(f.message(enrollment.token, 4, agentRoutes.ack, { commandId: input.commandId, outcome: "completed" }), /active claim/);
  assert.equal((await f.message(enrollment.token, 4, agentRoutes.poll, {}, "replacement-session")).payload.result.command, null);
  const state = await f.store.snapshot("personal"), rows = state.observations[0].events.filter(e => e.phase === "adapter-command-outcome-reviewed");
  assert.equal(rows.length, 1); assert.equal(rows[0].status, "unknown"); assert.equal(rows[0].provenance, "switchyard-local-lifecycle"); assert.equal(rows[0].taskCompletionVerified, false);
  for (const value of [input.commandId, "PRIVATE_REVIEWED_HANDOFF", enrollment.token, review.confirmation.token]) assert.equal(JSON.stringify(rows).includes(value), false);
  await assert.rejects(f.bridge.resolveOutcome("personal", { ...input, token: review.confirmation.token }), /uncertain claim/);
}));

test("a late authenticated acknowledgement wins both before and after an uncertain-outcome token is consumed", async () => {
  for (const afterConsume of [false, true]) await fixture(async f => {
    const { enrollment, input } = await uncertainClaim(f), review = await f.bridge.reviewOutcome("personal", input);
    const acknowledge = () => f.message(enrollment.token, 4, agentRoutes.ack, { commandId: input.commandId, outcome: "completed" });
    const update = f.store.update.bind(f.store);
    if (afterConsume) f.store.update = async (id, op, fn, scope) => { if (op === "agent-outcome-review") await acknowledge(); return update(id, op, fn, scope); };
    else await acknowledge();
    try { await assert.rejects(f.bridge.resolveOutcome("personal", { ...input, token: review.confirmation.token }), /uncertain claim/); }
    finally { f.store.update = update; }
    const command = (await f.store.snapshot("personal")).agents[0].commands[0]; assert.equal(command.status, "completed"); assert.equal(command.outcomeReviewedAt, undefined);
  });
});

test("uncertain-outcome reviews reject replacement, expiry and failed persistence without changing the original claim", () => fixture(async f => {
  await f.store.update("personal", "synthetic-recording", s => { s.observations = [{ id: "recording", status: "recording", sources: ["agent-events"], exclusions: [], createdAt: 100000, updatedAt: 100000, events: [] }]; });
  const { input } = await uncertainClaim(f), original = await f.bridge.reviewOutcome("personal", input);
  await f.revoke(); await f.enroll();
  await assert.rejects(f.bridge.resolveOutcome("personal", { ...input, token: original.confirmation.token }), /scope|match/i);
  const expired = await f.bridge.reviewOutcome("personal", input); f.advance(300001);
  await assert.rejects(f.bridge.resolveOutcome("personal", { ...input, token: expired.confirmation.token }), /expir|unavailable|unknown/i);
  const review = await f.bridge.reviewOutcome("personal", input), update = f.store.update.bind(f.store), events = (await f.store.snapshot("personal")).observations[0].events;
  f.store.update = (id, op, fn, scope) => update(id, op, async s => { const r = await fn(s); if (op === "agent-outcome-review") throw Error("synthetic outcome save failure"); return r; }, scope);
  try { await assert.rejects(f.bridge.resolveOutcome("personal", { ...input, token: review.confirmation.token }), /save failure/); } finally { f.store.update = update; }
  assert.equal((await f.store.snapshot("personal")).agents[0].commands[0].status, "uncertain-session-ended");
  assert.deepEqual((await f.store.snapshot("personal")).observations[0].events, events);
  await assert.rejects(f.bridge.resolveOutcome("personal", { ...input, token: review.confirmation.token }), /consum/i);
  await f.store.update("personal", "synthetic-keyboard-only", s => { s.mode = "keyboard-only"; });
  await assert.rejects(f.bridge.reviewOutcome("personal", input), /Keyboard-only/);
}));

test("only an explicitly reviewed uncertain record becomes eligible for the original bounded command history", () => fixture(async f => {
  const { input } = await uncertainClaim(f);
  await f.store.update("personal", "synthetic-full-history", s => { const a = s.agents[0]; a.commands = [a.commands[0], ...Array.from({ length: 63 }, () => ({ ...a.commands[0], id: randomUUID() }))]; });
  const original = (await f.store.snapshot("personal")).agents[0].commands.slice(1);
  const request = { agentId: "test", sessionId: "replacement-session", intent: "status" };
  await assert.rejects(f.bridge.dispatch("personal", request), /Unresolved agent command limit/);
  const review = await f.bridge.reviewOutcome("personal", input); await f.bridge.resolveOutcome("personal", { ...input, token: review.confirmation.token });
  const next = await f.bridge.dispatch("personal", request), after = (await f.store.snapshot("personal")).agents[0].commands;
  assert.equal(after.length, 64); assert.deepEqual(after.slice(0, -1), original); assert.equal(after.at(-1).id, next.commandId); assert.equal(after.at(-1).status, "queued");
}));

test("uncertain agent outcome routes require owner authentication, exact fields and their own review token", () => fixture(async f => {
  const suite = createSuite({ store: f.store, agents: { discovery: async () => [], close() {} }, voice: { discovery: async () => ({ available: false }) } }), server = createStudioServer({ suite, bridge: { close() {} } });
  try {
    await suite.handle("/api/suite/bootstrap"); const { input } = await uncertainClaim(f);
    server.listen(0, "127.0.0.1"); await once(server, "listening"); const origin = `http://127.0.0.1:${server.address().port}`;
    const api = async (action, body, authorized = true) => { const response = await fetch(origin + "/api/suite/agents/outcome/" + action, { method: "POST", headers: { Origin: origin, "Content-Type": "application/json", ...(authorized ? { Authorization: `Bearer ${server.accessToken}` } : {}) }, body: JSON.stringify(body) }); return { status: response.status, body: await response.json() }; };
    assert.equal((await api("review", input, false)).status, 401); assert.equal((await api("review", { ...input, outcome: "completed" })).status, 409);
    const review = await api("review", input); assert.equal(review.status, 200);
    const other = await f.bridge.reviewRevoke("personal", "test"); assert.equal((await api("resolve", { ...input, token: other.confirmation.token })).status, 409);
    const resolved = await api("resolve", { ...input, token: review.body.confirmation.token }); assert.equal(resolved.status, 200); assert.equal(resolved.body.status, "reviewed-unconfirmed"); assert.equal(resolved.body.providerCommandSent, false);
    assert.equal((await api("resolve", { ...input, token: review.body.confirmation.token })).status, 409);
  } finally { await suite.close(); server.closeAllConnections(); if (server.listening) await new Promise(resolve => server.close(resolve)); await server.cleanup(); }
}));
