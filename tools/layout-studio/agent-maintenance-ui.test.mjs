import test from "node:test";
import assert from "node:assert/strict";
import { browserSurfaceFixture, until } from "./test-support/browser-ui.mjs";
import { agentRoutes } from "../../integrations/agent-protocol.mjs";

async function fixture(fn) {
  return browserSurfaceFixture(async c => {
    await c.store.initialize("work", "work");
    const { mountAgentMaintenance } = await import("./role-ui.mjs"), { api } = await import("./connection.mjs"), notices = [];
    let selected = "personal";
    const refresh = async () => { const value = await api("/api/suite/snapshot", { compartment: selected }); c.document.dispatchEvent(new CustomEvent("switchyard-compartment-state", { detail: value })); };
    mountAgentMaintenance({ notify: message => notices.push(message), refresh }); await refresh();
    const context = { ...c, notices, refresh, select: async id => { c.document.dispatchEvent(new Event("switchyard-workspace-changing")); selected = id; await refresh(); } };
    await fn(context);
  });
}
async function openReview(c, button) { c.click(button); await until(() => c.$("agent-maintenance-dialog").open && !c.$("confirm-agent-maintenance").disabled); }
async function settled(c) { await until(() => !c.$("refresh-managed-agents").disabled); }
async function claim(c, stop = false) {
  const value = await c.suite.handle("/api/suite/agents/dispatch", { compartment: "personal", agentId: "alpha", intent: "status", sessionId: "exact-alpha" });
  await c.send("alpha", agentRoutes.poll, {});
  if (stop) await c.send("alpha", agentRoutes.event, { event: { status: "stopped" } });
  await c.refresh(); return value.commandId;
}

test("agent inventory displays saved self-reports without credentials, commands or external completion claims", () => fixture(async c => {
  const before = await c.store.snapshot("personal");
  assert.equal(c.$("managed-agent-picker").options.length, 2); assert.match(c.$("managed-agent-detail").textContent, /authenticated adapter self-report/);
  c.click("refresh-managed-agents"); await settled(c); assert.deepEqual(await c.store.snapshot("personal"), before);
  assert.equal(c.calls.some(row => row.path.endsWith("/dispatch") || row.path.endsWith("/enroll")), false);
  assert.equal(c.$("review-agent-outcome").disabled, true); await c.select("work"); assert.equal(c.$("review-agent-revoke").disabled, true); assert.equal(c.$("managed-agent-picker").options.length, 0);
}));

test("revocation reviews exact bindings and claims, preserves another agent and consumes its confirmation once", () => fixture(async c => {
  await claim(c); await c.store.update("personal", "synthetic-capability", s => { s.agents.find(a => a.id === "alpha").capabilities.push("handoff"); });
  await c.suite.handle("/api/suite/agents/dispatch", { compartment: "personal", agentId: "alpha", intent: "handoff", sessionId: "exact-alpha", content: "Synthetic retained handoff" }); await c.refresh();
  const beta = (await c.store.snapshot("personal")).agents.find(a => a.id === "beta");
  await openReview(c, "review-agent-revoke"); assert.match(c.$("agent-maintenance-summary").textContent, /Saved role bindings removed: 1/); assert.match(c.$("agent-maintenance-summary").textContent, /Queued commands cancelled locally: 1/); assert.match(c.$("agent-maintenance-summary").textContent, /Claimed commands retained as uncertain: 1/);
  c.click("cancel-agent-maintenance"); assert.equal((await c.store.snapshot("personal")).agents[0].enrollmentStatus, "active");
  await until(() => c.$("agent-maintenance-summary").textContent === "");
  await openReview(c, "review-agent-revoke"); c.click("confirm-agent-maintenance"); await until(() => c.$("managed-agent-status").textContent.includes("access revoked")); await settled(c);
  const state = await c.store.snapshot("personal"), alpha = state.agents.find(a => a.id === "alpha");
  assert.equal(alpha.enrollmentStatus, "revoked"); assert.deepEqual(alpha.commands.map(row => row.status), ["uncertain-session-ended", "cancelled-before-claim"]); assert.deepEqual(state.agents.find(a => a.id === "beta"), beta); assert.equal(state.roleBindings.length, 0);
  const body = c.calls.find(row => row.path === "/api/suite/agents/revoke").body; await assert.rejects(c.suite.handle("/api/suite/agents/revoke", body), /active enrolled agent/); assert.equal(c.$("review-agent-revoke").disabled, true);
}));

test("a changed claim refuses the old revocation review without altering authorization", () => fixture(async c => {
  const pending = await c.suite.handle("/api/suite/agents/dispatch", { compartment: "personal", agentId: "alpha", intent: "status", sessionId: "exact-alpha" }); await c.refresh();
  await openReview(c, "review-agent-revoke"); await c.send("alpha", agentRoutes.poll, {}); c.click("confirm-agent-maintenance"); await until(() => c.notices.length > 0); await settled(c);
  const alpha = (await c.store.snapshot("personal")).agents[0]; assert.equal(alpha.enrollmentStatus, "active"); assert.equal(alpha.commands.find(row => row.id === pending.commandId).status, "claimed"); assert.match(c.notices[0], /match the exact/);
}));

test("an uncertain retired claim receives separate review and acknowledgement with explicit bounded retention", () => fixture(async c => {
  const id = await claim(c, true); await openReview(c, "review-agent-outcome"); assert.match(c.$("agent-maintenance-summary").textContent, /bounded command-history retention/); assert.match(c.$("agent-maintenance-summary").textContent, /exact-alpha/);
  c.click("confirm-agent-maintenance"); await until(() => c.$("managed-agent-status").textContent.includes("Uncertainty review recorded")); await settled(c);
  const row = (await c.store.snapshot("personal")).agents[0].commands.find(row => row.id === id); assert.equal(row.status, "reviewed-unconfirmed"); assert.equal(row.externalOutcomeVerified, false); assert.equal(c.$("review-agent-outcome").disabled, true);
  assert.equal(c.calls.some(row => row.path.endsWith("/dispatch")), false); const body = c.calls.find(row => row.path.endsWith("/outcome/resolve")).body; await assert.rejects(c.suite.handle("/api/suite/agents/outcome/resolve", body), /uncertain claim/);
}));

test("a late original adapter acknowledgement wins over a stale local uncertainty review", () => fixture(async c => {
  const id = await claim(c, true); await openReview(c, "review-agent-outcome"); await c.send("alpha", agentRoutes.ack, { commandId: id, outcome: "completed" });
  c.click("confirm-agent-maintenance"); await until(() => c.notices.length > 0); await settled(c);
  assert.equal((await c.store.snapshot("personal")).agents[0].commands[0].status, "completed"); assert.match(c.$("managed-agent-command-detail").textContent, /external task outcome/); assert.equal(c.$("review-agent-outcome").disabled, true);
}));

test("a lost revocation reply refreshes durable state and never reenrolls, redispatches or retries the token", () => fixture(async c => {
  await openReview(c, "review-agent-revoke"); const fetch = globalThis.fetch;
  globalThis.fetch = async (path, options) => { const response = await fetch(path, options); if (path === "/api/suite/agents/revoke") throw Error("Synthetic lost revocation reply"); return response; };
  try { c.click("confirm-agent-maintenance"); await until(() => c.notices.some(message => /Synthetic lost/.test(message))); await settled(c); } finally { globalThis.fetch = fetch; }
  assert.equal(c.$("review-agent-revoke").disabled, true); assert.match(c.$("managed-agent-detail").textContent, /revoked/); assert.equal(c.calls.filter(row => row.path === "/api/suite/agents/revoke").length, 1);
  c.click("refresh-managed-agents"); await settled(c); assert.equal(c.calls.filter(row => row.path === "/api/suite/agents/revoke").length, 1); assert.equal(c.calls.some(row => row.path.endsWith("/enroll")), false);
}));

test("bundled example retirement in keyboard-only mode reports missing ownership without revoking access", () => fixture(async c => {
  await c.suite.handle("/api/suite/agents/enroll", { compartment: "personal", id: "custom-example", name: "Synthetic example metadata", capabilities: ["status"] });
  await c.suite.handle("/api/suite/mode", { compartment: "personal", mode: "keyboard-only" }); await c.refresh(); c.change("managed-agent-picker", "custom-example");
  assert.equal(c.$("review-agent-revoke").disabled, true); await openReview(c, "review-example-stop"); c.click("confirm-agent-maintenance"); await until(() => c.$("managed-agent-status").textContent.includes("not-observed")); await settled(c);
  const s = await c.store.snapshot("personal"), a = s.agents.find(a => a.id === "custom-example"); assert.equal(a.enrollmentStatus, "active"); assert.equal(a.reportedStatus, "unknown"); assert.equal(s.mode, "keyboard-only"); assert.match(c.$("managed-agent-status").textContent, /Task completion remains unverified/);
}));

test("changed agent selection and a late review cannot reveal Personal command contents in Work", () => fixture(async c => {
  await claim(c, true); await openReview(c, "review-agent-outcome"); c.change("managed-agent-picker", "beta"); assert.equal(c.$("agent-maintenance-dialog").open, false);
  const fetch = globalThis.fetch; let entered = false, release; const wait = new Promise(resolve => { release = resolve; });
  globalThis.fetch = async (path, options) => { const response = await fetch(path, options); if (path.endsWith("/revoke/review")) { entered = true; await wait; } return response; };
  try { c.click("review-agent-revoke"); await until(() => entered); await c.select("work"); release(); await settled(c); assert.equal(c.$("agent-maintenance-dialog").open, false); assert.equal(c.$("managed-agent-picker").options.length, 0); assert.doesNotMatch(c.$("managed-agent-command-detail").textContent, /exact-alpha/); }
  finally { release(); globalThis.fetch = fetch; }
}));
