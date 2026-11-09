import test from "node:test";
import assert from "node:assert/strict";
import { browserSurfaceFixture, until } from "./test-support/browser-ui.mjs";
const uiFixture = fn => browserSurfaceFixture(async context => { const { mountRoles } = await import("./role-ui.mjs"); await fn({ ...context, mount: extra => mountRoles({ notify() {}, refresh: context.refresh, ...extra }) }); });

test("named picker uses the real HTTP contract, requires review, and saves without dispatch", () => uiFixture(async ({ mount, refresh, $, change, click, calls, store }) => {
  mount(); await refresh(); await until(() => $("role-target").children.length === 3);
  assert.match($("role-target").children[2].textContent, /^beta · Custom agent/);
  change("role-target", ""); assert.equal($("bind-agent-role").disabled, true, "empty selection cannot become the first choice");
  change("role-target", "1"); assert.equal($("try-agent-role").disabled, true);
  click("bind-agent-role"); assert.equal($("role-connection-dialog").open, true);
  assert.match($("role-connection-summary").textContent, /Operator · Check progress → beta/);
  assert.equal((await store.snapshot("personal")).roleBindings[0].targetId, "alpha");
  click("confirm-role-connection"); await until(() => /Connection saved/.test($("role-result").textContent));
  await until(() => !$("role-connection-dialog").open && !$("try-agent-role").disabled);
  const saved = await store.snapshot("personal"); assert.equal(saved.roleBindings[0].targetId, "beta"); assert.equal((saved.agentCommands ?? []).length, 0);
  for (const call of calls.filter(call => /roles\/(choices|bind-choice)$/.test(call.path))) assert.equal(Object.hasOwn(call.body, "compartment"), false);
  const binding = calls.find(call => call.path.endsWith("/bind-choice")); assert.match(binding.body.choiceDigest, /^[a-f0-9]{64}$/); assert.equal(Object.hasOwn(binding.body, "label"), false);
  assert.equal(calls.some(call => call.path.endsWith("/dispatch")), false);
}));

test("a late old-workspace inventory cannot repopulate or enable the picker", () => uiFixture(async ({ mount, refresh, $, document, store }) => {
  let resolve, entered;
  const called = new Promise(done => { entered = done; });
  mount({ request: () => new Promise(done => { resolve = done; entered(); }) });
  await refresh(); await called;
  document.dispatchEvent(new Event("switchyard-workspace-changing"));
  const state = await store.snapshot("personal");
  resolve({ compartment: "personal", role: state.workflow.roles[0], intent: "status", complete: true, choices: [{ targetId: "alpha", label: "old target", provider: "custom-agent", targetKind: "custom-agent", choiceDigest: "a".repeat(64) }] });
  await new Promise(done => setImmediate(done));
  assert.equal($("role-target").children.length, 1); assert.equal($("bind-agent-role").disabled, true); assert.equal($("try-agent-role").disabled, true);
}));

test("a changed saved connection refuses the reviewed choice and preserves the original binding", () => uiFixture(async ({ mount, refresh, $, change, click, store }) => {
  mount(); await refresh(); await until(() => $("role-target").children.length === 3);
  change("role-target", "1"); click("bind-agent-role");
  await store.update("personal", "synthetic-ui-race", state => { state.agents.find(agent => agent.id === "beta").sessionId = "replacement-beta"; });
  click("confirm-role-connection"); await until(() => /saved role connection changed/.test($("role-result").textContent));
  await until(() => !$("role-connection-dialog").open);
  assert.equal((await store.snapshot("personal")).roleBindings[0].targetId, "alpha");
  assert.equal(((await store.snapshot("personal")).agentCommands ?? []).length, 0);
}));

test("keyboard-only mode returns useful guidance without querying or enabling a connection", () => uiFixture(async ({ mount, $, document, store, calls }) => {
  mount(); const state = await store.snapshot("personal");
  document.dispatchEvent(new CustomEvent("switchyard-compartment-state", { detail: { ...state, mode: "keyboard-only" } }));
  assert.match($("role-choice-status").textContent, /Keyboard-only mode/);
  assert.equal(calls.length, 0); assert.equal($("bind-agent-role").disabled, true); assert.equal($("try-agent-role").disabled, true);
}));
