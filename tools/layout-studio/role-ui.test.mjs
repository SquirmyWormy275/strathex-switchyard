import test from "node:test";
import assert from "node:assert/strict";
import { browserSurfaceFixture, until } from "./test-support/browser-ui.mjs";
import { randomUUID } from "node:crypto";
import { join } from "node:path";
import { createClientLaunch } from "./client-launch.mjs";
const uiFixture = fn => browserSurfaceFixture(async context => { const { mountRoles } = await import("./role-ui.mjs"); await fn({ ...context, mount: extra => mountRoles({ notify() {}, refresh: context.refresh, ...extra }) }); });

for (const change of ["another target", "same target", "role label", "same workspace selection"]) {
  test(`confirming an open control review refuses ${change} changed in another window`, () => uiFixture(async c => {
    c.mount(); await c.refresh(); await until(() => !c.$("try-agent-role").disabled);
    c.click("try-agent-role"); assert.match(c.$("role-connection-summary").textContent, /→ alpha/);
    if (change === "another target") await c.bind("beta");
    else if (change === "same target") await c.bind("alpha");
    else if (change === "role label") await c.store.update("personal", "synthetic-review-change", state => { state.workflow.roles[0].label = "Replacement role"; });
    else await c.peer.selection("personal");
    c.click("confirm-role-connection");
    await until(() => c.responses.some(row => /\/roles\/dispatch(?:-choice)?$/.test(row.path)));
    await c.responses.find(row => /\/roles\/dispatch(?:-choice)?$/.test(row.path)).response;
    await until(() => !c.$("role-connection-dialog").open);
    const state = await c.store.snapshot("personal");
    assert.equal(state.agents.every(agent => agent.commands.length === 0), true, "confirmation must not queue a command for a changed reviewed choice");
    assert.equal(state.intentResults?.length ?? 0, 0);
    assert.match(c.$("role-result").textContent, /reviewed role connection changed/);
  }));
}

test("a saved homepage role can be reviewed and tried without sending empty workflow content", async () => {
  let launch, effects = 0;
  const clientLaunch = { launch: (...args) => launch.launch(...args), list: (...args) => launch.list(...args), stopCompartment: (...args) => launch ? launch.stopCompartment(...args) : { stopped: true }, close: () => launch?.close() };
  await browserSurfaceFixture(async c => {
    launch = createClientLaunch({ store: c.store, stateDirectory: join(c.root, "role-launch"), platform: "linux", guardianStopped: async () => true, command: async (_exe, _args, options) => {
      const input = JSON.parse(options.inputText); assert.equal(input.id, "github-copilot-web");
      await options.onGuardianReady({ schema: "switchyard-runtime-command/v1", id: randomUUID(), guardianPid: 12345, birth: "1", containment: "owned-linux-session" });
      effects++;
      return { status: "completed", exitCode: 0, inputDelivered: true, treeExitVerified: true, stdout: JSON.stringify({ schema: "switchyard-client-portal-result/v1", id: input.id, status: "accepted", response: 0, applicationOpenedVerified: false, accountVerified: false, sessionIdentified: false }) };
    } });
    const item = c.document.createElement("option"); item.value = "summon"; item.textContent = "Open app or conversation"; c.$("role-intent").replaceChildren(item);
    const { mountRoles } = await import("./role-ui.mjs"); mountRoles({ notify() {}, refresh: c.refresh }); await c.refresh();
    await until(() => c.$("role-target").children.length === 4); c.change("role-target", "0");
    c.click("bind-agent-role"); c.click("confirm-role-connection");
    await until(() => !c.$("role-connection-dialog").open && !c.$("try-agent-role").disabled); assert.equal(effects, 0);
    c.click("try-agent-role"); c.click("cancel-role-connection"); await new Promise(resolve => setImmediate(resolve)); assert.equal(effects, 0);
    c.click("try-agent-role"); c.click("confirm-role-connection");
    await until(() => !c.$("role-connection-dialog").open && c.$("role-result").textContent.includes("launch-requested"));
    assert.equal(effects, 1);
    const request = c.calls.find(row => row.path.endsWith("/roles/dispatch-choice")); assert.equal(Object.hasOwn(request.body, "content"), false);
    assert.equal(request.body.targetId, "github-copilot-web"); assert.match(request.body.choiceDigest, /^[a-f0-9]{64}$/);
    const state = await c.store.snapshot("personal"); assert.equal(state.clientLaunches.length, 1); assert.equal(state.clientLaunches[0].stoppedVerified, true);
    assert.equal(state.clientLaunches[0].cleanupPending, false); assert.equal(state.intentResults.at(-1).result.providerAccountVerified, false);
  }, { platform: "linux", clientLaunch });
});

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
