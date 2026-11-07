import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { agentRoutes } from "../../integrations/agent-protocol.mjs";
import { fixture } from "./test-support/role-dispatch.mjs";
import { once } from "node:events";
import { createStudioServer } from "./serve.mjs";

test("guided role choices bind a saved named connection through authenticated HTTP without exposing sessions or dispatching a command", () => fixture(async ({ suite, store, root }) => {
  const token = "r".repeat(43), server = createStudioServer({ suite, token, bridge: { close() {} } });
  server.listen(0, "127.0.0.1"); await once(server, "listening");
  const origin = `http://127.0.0.1:${server.address().port}`;
  const api = async (route, body, expected = 200, authenticated = true) => {
    const response = await fetch(origin + "/api/suite/roles/" + route, { method: "POST", headers: { Origin: origin, "Content-Type": "application/json", ...(authenticated ? { Authorization: "Bearer " + token } : {}) }, body: JSON.stringify(body) });
    assert.equal(response.status, expected); return response.json();
  };
  try {
    const before = await store.snapshot("personal"), bytes = await readFile(join(root, "personal.sealed.json"));
    await api("choices", { roleId: "operator", intent: "status" }, 401, false);
    const choices = await api("choices", { roleId: "operator", intent: "status" });
    assert.equal(choices.schema, "switchyard-role-choices/v1"); assert.equal(choices.compartment, "personal");
    assert.deepEqual(choices.choices.map(row => row.label), ["alpha", "beta"]);
    assert.equal(choices.nativeObserved, false); assert.equal(choices.authorityGranted, false); assert.equal(choices.bindingRequired, true);
    for (const privateValue of ["exact-alpha", "exact-beta", ...before.agents.map(row => row.credentialEpoch)]) assert.equal(JSON.stringify(choices).includes(privateValue), false);
    assert.deepEqual(await store.snapshot("personal"), before); assert.deepEqual(await readFile(join(root, "personal.sealed.json")), bytes);
    const { label, ...selection } = choices.choices[1], input = { roleId: "operator", intent: "status", ...selection };
    const bound = await api("bind-choice", input);
    assert.equal(bound.bound, true); assert.equal(bound.targetId, "beta"); assert.equal(bound.authorityGranted, false); assert.equal(JSON.stringify(bound).includes("exact-beta"), false);
    const after = await store.snapshot("personal"); assert.equal(after.roleBindings[0].sessionId, "exact-beta");
    assert.deepEqual(after.agentCommands, before.agentCommands);
    await api("bind-choice", input, 409); assert.deepEqual(await store.snapshot("personal"), after);
    for (const extra of [{ compartment: "work" }, { content: "never" }, { sessionId: "foreign" }, { approved: true }]) await api("choices", { roleId: "operator", intent: "status", ...extra }, 409);
  } finally { server.closeAllConnections(); await new Promise((resolve, reject) => server.close(error => error ? reject(error) : resolve())); }
}));

test("guided binding refuses changed sessions, roles, policy, prior bindings and same-name workspace selection", async () => {
  for (const change of ["session", "capability", "role", "policy", "mode", "prior-binding", "same-selection"]) await fixture(async ({ suite, store, peer, bind }) => {
    const inventory = await suite.handle("/api/suite/roles/choices", { roleId: "operator", intent: "status" }), { label, ...choice } = inventory.choices[1];
    if (change === "prior-binding") await bind("alpha");
    else if (change === "same-selection") await peer.selection("personal");
    else await store.update("personal", "synthetic-choice-change", state => {
      if (change === "session") state.agents[1].sessionId = "replacement-session";
      if (change === "capability") state.agents[1].capabilities = [];
      if (change === "role") state.workflow.roles[0].label = "Different responsibility";
      if (change === "policy") state.policy = "work";
      if (change === "mode") state.mode = "keyboard-only";
    });
    const before = await store.snapshot("personal");
    await assert.rejects(suite.handle("/api/suite/roles/bind-choice", { roleId: "operator", intent: "status", ...choice }));
    assert.deepEqual(await store.snapshot("personal"), before);
  });
});

test("guided choices filter unsupported or stale actions, keep heartbeats usable and honor Copilot-only work policy", () => fixture(async ({ suite, store, send }) => {
  const select = intent => suite.handle("/api/suite/roles/choices", { roleId: "operator", intent });
  assert.deepEqual((await select("handoff")).choices, []);
  const inventory = await select("status"), { label, ...choice } = inventory.choices[1];
  await send("beta", agentRoutes.event, { event: { status: "ready" } });
  assert.equal((await suite.handle("/api/suite/roles/bind-choice", { roleId: "operator", intent: "status", ...choice })).bound, true);
  await store.update("personal", "synthetic-stale-connection", state => { state.agents[0].lastSeen = Date.now() - 31000; state.agents[1].enrollmentStatus = "revoked"; });
  assert.deepEqual((await select("status")).choices, []);
  assert.deepEqual((await select("summon")).choices.map(row => row.targetId), ["github-copilot-web", "cursor-cloud", "figma-web"]);
  await store.initialize("work", "work"); await store.saveWorkflow("work", { name: "Work", roles: [{ id: "operator", label: "Operator" }], steps: [] });
  await suite.handle("/api/suite/compartment/select", { compartment: "work" });
  await assert.rejects(select("summon"), /companion mode/);
  await suite.handle("/api/suite/mode", { compartment: "work", mode: "managed-companion" });
  const work = await select("summon"); assert.equal(work.compartment, "work"); assert.deepEqual(work.choices.map(row => row.targetId), ["microsoft-365-copilot-web"]);
  const { label: ignored, ...workChoice } = work.choices[0];
  assert.equal((await suite.handle("/api/suite/roles/bind-choice", { roleId: "operator", intent: "summon", ...workChoice })).provider, "microsoft-365-copilot");
}));

test("guided choices refuse ambiguous and oversized inventories without returning a partial list", () => fixture(async ({ suite, store }) => {
  const choose = () => suite.handle("/api/suite/roles/choices", { roleId: "operator", intent: "status" });
  const original = structuredClone((await store.snapshot("personal")).agents);
  await store.update("personal", "synthetic-duplicate-choice", state => { state.agents.push(structuredClone(state.agents[0])); });
  await assert.rejects(choose(), /ambiguous/);
  await store.update("personal", "synthetic-many-choices", state => { state.agents = Array.from({ length: 129 }, (_, index) => ({ ...original[0], id: "choice-" + index, name: "Saved agent " + index, sessionId: "synthetic-session-" + index, lastSeen: Date.now() })); });
  await assert.rejects(choose(), /complete response bound/);
  await store.update("personal", "synthetic-invalid-session", state => { state.agents = original; state.agents[0].sessionId = { invalid: true }; state.agents[1].name = "unsafe\nlabel"; });
  await assert.rejects(choose(), /label is invalid/);
}));

test("a workspace reselection while a guided binding waits for the state lease cannot save the old choice", () => fixture(async ({ suite, store, peer, pause }) => {
  const inventory = await suite.handle("/api/suite/roles/choices", { roleId: "operator", intent: "status" }), { label, ...choice } = inventory.choices[1];
  const held = pause("role-bind"), pending = suite.handle("/api/suite/roles/bind-choice", { roleId: "operator", intent: "status", ...choice }).then(value => ({ value }), error => ({ error }));
  await held.entered; await peer.selection("personal"); const before = await store.snapshot("personal"); held.release();
  assert.match((await pending).error?.message ?? "unexpected binding", /workspace changed/);
  assert.deepEqual(await store.snapshot("personal"), before);
}));

