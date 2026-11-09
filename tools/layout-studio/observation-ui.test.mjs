import test from "node:test";
import assert from "node:assert/strict";
import { browserSurfaceFixture, until } from "./test-support/browser-ui.mjs";
import { reviewedDesignObservations } from "./design-observations.mjs";

async function mount(context, request) {
  const { mountObservation } = await import("./observation-ui.mjs");
  const notices = []; context.$("conversation-provider").value = "codex";
  context.$("observe-deliberate").checked = true; context.$("exclude-browser").checked = true; context.$("observation-kind").value = "handoff";
  const ui = mountObservation({ refresh: context.refresh, notify: text => notices.push(text), ...(request ? { request } : {}) });
  await context.refresh(); return { ui, notices };
}
async function stopped(context) {
  await context.suite.handle("/api/suite/observation/start", { sources: ["deliberate"], exclusions: ["browser"], consent: true });
  const session = (await context.store.snapshot("personal")).observations.at(-1);
  await context.suite.handle("/api/suite/observation/mark", { id: session.id, kind: "handoff" });
  await context.suite.handle("/api/suite/observation/state", { id: session.id, status: "stopped" });
  return session.id;
}
function select(context, index = 0) { const input = context.$("design-observation-sessions").children[index].children[0]; input.checked = true; input.dispatchEvent(new Event("change")); }

test("observation controls record only chosen sources, mark, pause, resume and stop the exact session", () => browserSurfaceFixture(async c => {
  await mount(c); c.$("observe-agent-events").checked = true; c.$("observe-host-action-events").checked = true; c.$("observe-editor-events").checked = true;
  c.click("start-observation"); await until(() => /recording/.test(c.$("observation-status").textContent) && !c.$("mark-observation").disabled);
  let session = (await c.store.snapshot("personal")).observations[0];
  assert.deepEqual(session.sources, ["deliberate", "agent-events", "host-action-events", "editor-events"]); assert.deepEqual(session.exclusions, ["browser"]);
  assert.equal(c.$("start-observation").disabled, true); c.click("mark-observation"); await until(() => /1 events/.test(c.$("observation-status").textContent) && !c.$("pause-observation").disabled);
  c.click("pause-observation"); await until(() => /paused/.test(c.$("observation-status").textContent) && !c.$("pause-observation").disabled); assert.equal(c.$("mark-observation").disabled, true);
  c.click("pause-observation"); await until(() => /recording/.test(c.$("observation-status").textContent) && !c.$("stop-observation").disabled);
  c.click("stop-observation"); await until(() => /stopped/.test(c.$("observation-status").textContent) && !c.$("delete-observation").disabled);
  const after = (await c.store.snapshot("personal")).observations; assert.equal(after.length, 1); assert.equal(after[0].id, session.id); assert.equal(after[0].events[0].kind, "handoff"); assert.equal(c.$("pause-observation").disabled, true);
}));

test("Claude hook setup requires separate consent and previews the exact destination without installing settings", () => browserSurfaceFixture(async c => {
  await mount(c); c.$("observe-deliberate").checked = false; c.$("observe-claude-hook-events").checked = true;
  assert.equal(c.$("prepare-claude-hook").disabled, true);
  c.click("start-observation"); await until(() => !c.$("prepare-claude-hook").disabled);
  const observation = (await c.store.snapshot("personal")).observations[0]; assert.deepEqual(observation.sources, ["claude-hook-events"]);
  c.$("claude-hook-session").value = "synthetic-native-session"; c.click("prepare-claude-hook");
  await until(() => c.$("claude-hook-settings").textContent.includes("SessionStart") && !c.$("prepare-claude-hook").disabled);
  const settings = JSON.parse(c.$("claude-hook-settings").textContent), args = settings.hooks.Stop[0].hooks[0].args;
  assert.deepEqual(args.slice(1), ["--workspace", "personal", "--observation", observation.id, "--session", "synthetic-native-session"]);
  assert.match(c.$("claude-hook-detail").textContent, /writes no settings/);
  assert.equal((await c.store.snapshot("personal")).observations[0].events.length, 0);
  c.$("claude-hook-session").value = "other"; c.$("claude-hook-session").dispatchEvent(new Event("input")); assert.equal(c.$("claude-hook-settings").textContent, "");
  await assert.rejects(c.suite.handle("/api/suite/observation/claude-hook/recipe", { observationId: observation.id, expectedSessionId: "synthetic", command: "foreign" }), /only an exact/);
}));

test("a late hook settings reply cannot expose the old Personal session in Work", () => browserSurfaceFixture(async c => {
  const { api } = await import("./connection.mjs"); let entered = false, release;
  const gate = new Promise(resolve => { release = resolve; });
  await mount(c, async (path, body) => { const value = await api(path, body); if (path.endsWith("claude-hook/recipe")) { entered = true; await gate; } return value; });
  c.$("observe-deliberate").checked = false; c.$("observe-claude-hook-events").checked = true; c.click("start-observation"); await until(() => !c.$("prepare-claude-hook").disabled);
  c.$("claude-hook-session").value = "private-native-session"; c.click("prepare-claude-hook"); await until(() => entered);
  try { await c.store.initialize("work", "work"); c.document.dispatchEvent(new CustomEvent("switchyard-compartment-state", { detail: await c.store.snapshot("work") })); }
  finally { release(); }
  await until(() => c.$("observation-consent-detail").textContent.includes("unavailable")); await new Promise(resolve => setImmediate(resolve));
  assert.equal(c.$("claude-hook-settings").textContent, ""); assert.equal(c.$("claude-hook-session").value, ""); assert.equal(c.$("prepare-claude-hook").disabled, true);
}));

test("selected activity needs destination review and confirmation before its single-use request envelope", () => browserSurfaceFixture(async c => {
  const id = await stopped(c); const { ui } = await mount(c); select(c);
  assert.throws(() => ui.takeReview("codex"), /Review the selected activity/);
  c.click("review-design-observations"); await until(() => c.$("observation-review-dialog").open && !c.$("confirm-design-observations").disabled);
  assert.match(c.$("observation-review-content").textContent, /1 × handoff/); assert.equal(c.$("observation-review-content").textContent.includes(id), false);
  assert.equal(c.calls.some(row => row.path === "/api/suite/design"), false); assert.throws(() => ui.takeReview("codex"), /Review/);
  c.click("confirm-design-observations"); assert.match(c.$("design-observation-status").textContent, /Nothing has been sent/);
  const envelope = ui.takeReview("codex"), state = await c.store.snapshot("personal");
  assert.deepEqual(envelope.sessionIds, [id]); assert.equal(envelope.confirmed, true); assert.equal(reviewedDesignObservations(state, "codex", envelope).sessions[0].eventCounts[0].count, 1);
  assert.equal(ui.takeReview("codex"), undefined);
}));

test("changed observations and destination invalidate previously confirmed designer context", () => browserSurfaceFixture(async c => {
  await stopped(c); const { ui } = await mount(c); select(c);
  c.click("review-design-observations"); await until(() => c.$("observation-review-dialog").open && !c.$("confirm-design-observations").disabled); c.click("confirm-design-observations");
  c.change("conversation-provider", "claude-code"); assert.throws(() => ui.takeReview("claude-code"), /Review/);
  c.click("review-design-observations"); await until(() => c.$("observation-review-dialog").open && !c.$("confirm-design-observations").disabled); c.click("confirm-design-observations");
  await c.store.update("personal", "synthetic-source-change", s => { s.observations[0].updatedAt++; }); await c.refresh(); assert.throws(() => ui.takeReview("claude-code"), /Review/);
  c.click("clear-design-observations"); assert.equal(ui.takeReview("claude-code"), undefined);
}));

test("a late old-workspace observation review cannot offer a send confirmation", () => browserSurfaceFixture(async c => {
  await stopped(c); const { api } = await import("./connection.mjs"); let release, entered = false;
  const gate = new Promise(resolve => { release = resolve; });
  const { ui } = await mount(c, async (path, body) => { const result = await api(path, body); if (path.endsWith("/observations/review")) { entered = true; await gate; } return result; });
  select(c); c.click("review-design-observations"); await until(() => entered);
  try {
    c.document.dispatchEvent(new Event("switchyard-workspace-changing")); await c.store.initialize("work", "work"); c.document.dispatchEvent(new CustomEvent("switchyard-compartment-state", { detail: await c.store.snapshot("work") }));
  } finally { release(); }
  await until(() => c.$("observation-consent-detail").textContent.includes("unavailable")); await new Promise(resolve => setImmediate(resolve));
  assert.equal(c.$("observation-review-dialog").open, false); assert.equal(c.$("confirm-design-observations").disabled, true); assert.equal(c.$("start-observation").disabled, true); assert.equal(ui.takeReview("codex"), undefined);
}));

test("deletion names the chosen historical session and does nothing until confirmed", () => browserSurfaceFixture(async c => {
  const old = await stopped(c); await stopped(c); await mount(c); c.change("observation-session", old);
  c.click("delete-observation"); assert.equal(c.$("delete-observation-dialog").open, true); assert.equal((await c.store.snapshot("personal")).observations.length, 2);
  c.click("confirm-delete-observation"); await until(() => !c.$("delete-observation-dialog").open && !c.$("observation-session").disabled);
  const remaining = (await c.store.snapshot("personal")).observations; assert.equal(remaining.length, 1); assert.notEqual(remaining[0].id, old);
}));

test("the designer form sends the confirmed observation envelope with its exact message and saved layout", async () => {
  let designRequest;
  await browserSurfaceFixture(async c => {
    const id = await stopped(c), previousWindow = globalThis.window;
    const { portableProfile } = await import("./workspace.mjs"), { plan } = await import("./test-support/copilot-fixture.mjs");
    let profile = portableProfile(plan, "design-ui", "Synthetic design", (await c.store.snapshot("personal")).workflow);
    await c.store.saveProfile("personal", profile); globalThis.window = new EventTarget();
    try {
      const { mountSuite } = await import("./suite-ui.mjs");
      mountSuite({ getProfile: () => profile, loadProfile: value => { profile = value; }, previewProposal: () => assert.fail("No proposal was supplied"), notify() {}, saved() {}, onPolicy() {}, onWorkflow() {}, download() {} });
      await until(() => /Private workspace connected/.test(c.$("suite-status").textContent));
      select(c); c.click("review-design-observations"); await until(() => c.$("observation-review-dialog").open && !c.$("confirm-design-observations").disabled); c.click("confirm-design-observations");
      c.$("design-message").value = "Help simplify this handoff"; c.$("design-form").dispatchEvent(new Event("submit", { cancelable: true }));
      await until(() => /Synthetic design reply/.test(c.$("design-status").textContent) && !c.$("send-design").disabled);
      assert.equal(designRequest.compartment, "personal"); assert.equal(designRequest.provider, "codex"); assert.equal(designRequest.message, "Help simplify this handoff"); assert.deepEqual(designRequest.plan, profile.plan); assert.deepEqual(designRequest.plan, (await c.store.snapshot("personal")).profile.plan); assert.equal(designRequest.plan.profile.keys[0].baseKeycode, "KC_A");
      assert.deepEqual(designRequest.observationReview.sessionIds, [id]); assert.equal(designRequest.observationReview.confirmed, true);
      assert.equal(reviewedDesignObservations(await c.store.snapshot("personal"), "codex", designRequest.observationReview).sessions[0].eventCounts[0].count, 1);
      assert.equal(c.$("design-observation-sessions").children[0].children[0].checked, false);
      assert.equal(c.calls.filter(row => row.path === "/api/suite/design").length, 1);
    } finally { globalThis.window = previousWindow; }
  }, { agents: { discovery: async () => [], close: async () => {}, design: async request => { designRequest = request; return { conversationId: "synthetic", reply: "Synthetic design reply", workflow: { name: "Review handoff", steps: [], roles: [] }, proposal: null }; } } });
});
