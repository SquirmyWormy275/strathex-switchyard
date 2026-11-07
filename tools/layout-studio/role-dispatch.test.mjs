import assert from "node:assert/strict";
import test from "node:test";
import { mkdtemp, rm, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { once } from "node:events";
import { createStudioServer } from "./serve.mjs";
import { createSuiteStore, privateWrite } from "./suite-store.mjs";
import { createSuite } from "./suite.mjs";
import { agentRoutes, agentMessageSchema, requestMac, responseMac } from "../../integrations/agent-protocol.mjs";

async function fixture(fn, overrides = {}) {
  const root = await mkdtemp(join(tmpdir(), "switchyard-role-dispatch-"));
  const keys = new Map(), pending = new Set();
  const secrets = {
    get: async (id, purpose) => keys.get(`${id}:${purpose}`),
    set: async (id, purpose, value) => { keys.set(`${id}:${purpose}`, value); }
  };
  const store = createSuiteStore({ root, secrets }), peer = createSuiteStore({ root, secrets });
  const update = store.update.bind(store);
  let gate;
  store.update = async (id, operation, ...args) => {
    if (gate?.operation === operation) {
      const held = gate; gate = undefined; held.enter(); await held.wait;
    }
    return update(id, operation, ...args);
  };
  const releases = [];
  const pause = operation => {
    let enter, release;
    const entered = new Promise(resolve => { enter = resolve; });
    const wait = new Promise(resolve => { release = resolve; });
    releases.push(release); gate = { operation, enter, wait };
    return { entered, release };
  };
  const suite = createSuite({ store, agents: { discovery: async () => [], close: async () => {} }, voice: { discovery: async () => ({ available: false }) }, ...overrides });
  const enrollments = new Map();
  const send = async (id, path, fields = {}) => {
    const enrollment = enrollments.get(id);
    const body = { schema: agentMessageSchema, compartment: "personal", agentId: id, sessionId: `exact-${id}`, sequence: ++enrollment.sequence, at: Date.now(), ...fields };
    const raw = JSON.stringify(body);
    const reply = await suite.agentMessage(path, body, requestMac(enrollment.token, path, raw), raw);
    assert.equal(reply.signature, responseMac(enrollment.token, path, 200, JSON.stringify(reply.payload)));
    assert.equal(reply.payload.requestSequence, body.sequence);
    assert.equal(reply.payload.sessionId, body.sessionId);
    return reply.payload.result;
  };
  const bind = (targetId = "alpha") => suite.handle("/api/suite/roles/bind", { roleId: "operator", provider: "custom-agent", targetId, intent: "status" });
  const dispatch = (physical = false) => {
    // Attach both handlers immediately: a refusal may settle while the fixture is changing the binding.
    const result = suite.handle(physical ? "/api/suite/intent" : "/api/suite/roles/dispatch", { roleId: "operator", intent: "status", ...(physical ? { implementation: "switchyard.role/v1" } : {}) }).then(value => ({ value }), error => ({ error }));
    pending.add(result); return result;
  };
  try {
    await suite.handle("/api/suite/bootstrap");
    await suite.handle("/api/suite/mode", { mode: "personal-companion" });
    await store.saveWorkflow("personal", { name: "Synthetic role dispatch", roles: [{ id: "operator", label: "Operator" }], steps: [] });
    for (const id of ["alpha", "beta"]) {
      const enrolled = await suite.handle("/api/suite/agents/enroll", { id, name: id, capabilities: ["status"] });
      enrollments.set(id, { token: enrolled.token, sequence: 0 });
      await send(id, agentRoutes.event, { event: { status: "ready" } });
    }
    await bind();
    await fn({ suite, store, peer, root, bind, dispatch, pause, send });
  } finally {
    for (const release of releases) release();
    await Promise.allSettled(pending);
    try { await suite.close(); } finally { await rm(root, { recursive: true, force: true }); }
  }
}

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

for (const change of ["another target", "same target", "role removed", "role edited"]) {
  test(`a role changed to ${change} before enqueue refuses the original command`, () => fixture(async ({ store, bind, dispatch, pause }) => {
    const held = pause("agent-intent"), result = dispatch();
    await held.entered;
    if (change === "another target") await bind("beta");
    else if (change === "same target") await bind("alpha");
    else await store.update("personal", "synthetic-role-change", state => {
      if (change === "role removed") state.workflow.roles = [];
      else state.workflow.roles[0].label = "Changed responsibility";
    });
    held.release();
    const outcome = await result;
    assert.match(outcome.error?.message ?? "command was accepted", /role binding changed/);
    const state = await store.snapshot("personal");
    assert.equal(state.agents.every(agent => agent.commands.length === 0), true);
    assert.equal(state.intentResults?.length ?? 0, 0);
  }));
}

test("a role rebound after enqueue preserves its original claim without attributing it to the new binding", () => fixture(async ({ store, bind, dispatch, pause, send }) => {
  const held = pause("role-intent-result"), result = dispatch();
  await held.entered;
  const original = (await store.snapshot("personal")).agents.find(agent => agent.id === "alpha").commands[0];
  assert.equal(original.status, "queued");
  await bind("beta"); held.release();
  assert.match((await result).error?.message ?? "result was attributed", /role binding changed/);
  const state = await store.snapshot("personal");
  assert.deepEqual(state.agents.find(agent => agent.id === "alpha").commands, [original]);
  assert.equal(state.agents.find(agent => agent.id === "beta").commands.length, 0);
  assert.equal(state.intentResults?.length ?? 0, 0);
  assert.equal((await send("alpha", agentRoutes.poll)).command.id, original.id);
  assert.equal((await send("alpha", agentRoutes.poll)).command, null);
  assert.equal((await send("beta", agentRoutes.poll)).command, null);
}));

test("a deliberate new binding queues and authenticates only its exact new session", () => fixture(async ({ store, bind, dispatch, send }) => {
  const binding = await bind("beta");
  const outcome = await dispatch();
  assert.equal(outcome.error, undefined);
  assert.equal(outcome.value.status, "queued");
  const state = await store.snapshot("personal");
  assert.equal(state.agents.find(agent => agent.id === "alpha").commands.length, 0);
  const command = (await send("beta", agentRoutes.poll)).command;
  assert.equal(command.id, outcome.value.commandId);
  assert.equal(command.sessionId, binding.sessionId);
  assert.equal((await send("beta", agentRoutes.poll)).command, null);
  await send("beta", agentRoutes.ack, { commandId: command.id, outcome: "completed" });
  const completed = await store.snapshot("personal");
  assert.equal(completed.agents.find(agent => agent.id === "beta").commands[0].status, "completed");
  assert.equal(completed.intentResults.length, 1);
  assert.equal(completed.intentResults[0].result.commandId, command.id);
}));

test("unrebound legacy role bindings remain usable until deliberately replaced", () => fixture(async ({ store, dispatch }) => {
  await store.update("personal", "synthetic-legacy-binding", state => { delete state.roleBindings[0].bindingId; });
  assert.equal((await dispatch()).value.status, "queued");
}));

for (const change of ["another workspace", "away and back", "saved selection", "saved selection round trip", "saved same selection", "shutdown"]) {
  test(`a physical role intent refuses ${change} before enqueue`, () => fixture(async ({ suite, store, peer, dispatch, pause }) => {
    await suite.handle("/api/suite/compartment/create", { compartment: "second" });
    const held = pause("agent-intent"), result = dispatch(true);
    await held.entered;
    if (change === "shutdown") await suite.close();
    else if (change === "saved selection") await store.selection("second");
    else if (change === "saved selection round trip") { await peer.selection("second"); await peer.selection("personal"); }
    else if (change === "saved same selection") await peer.selection("personal");
    else {
      await suite.handle("/api/suite/compartment/select", { compartment: "second" });
      if (change === "away and back") await suite.handle("/api/suite/compartment/select", { compartment: "personal" });
    }
    held.release();
    assert.match((await result).error?.message ?? "command was accepted", /workspace changed/);
    const state = await store.snapshot("personal");
    assert.equal(state.agents.every(agent => agent.commands.length === 0), true);
    assert.equal(state.intentResults?.length ?? 0, 0);
    assert.equal((await store.snapshot("second")).agents.length, 0);
  }));
}

test("a workspace change after physical enqueue preserves the original command and refuses stale attribution", () => fixture(async ({ suite, store, dispatch, pause, send }) => {
  await suite.handle("/api/suite/compartment/create", { compartment: "second" });
  const held = pause("role-intent-result"), result = dispatch(true);
  await held.entered;
  const original = (await store.snapshot("personal")).agents.find(agent => agent.id === "alpha").commands[0];
  await suite.handle("/api/suite/compartment/select", { compartment: "second" });
  held.release();
  assert.match((await result).error?.message ?? "result was attributed", /workspace changed/);
  const state = await store.snapshot("personal");
  assert.deepEqual(state.agents.find(agent => agent.id === "alpha").commands, [original]);
  assert.equal(state.intentResults?.length ?? 0, 0);
  assert.equal((await send("alpha", agentRoutes.poll)).command.id, original.id);
  assert.equal((await send("alpha", agentRoutes.poll)).command, null);
}));

test("a fresh physical role intent works after deliberately returning to its workspace", () => fixture(async ({ suite, dispatch }) => {
  await suite.handle("/api/suite/compartment/create", { compartment: "second" });
  await suite.handle("/api/suite/compartment/select", { compartment: "second" });
  await suite.handle("/api/suite/compartment/select", { compartment: "personal" });
  assert.equal((await dispatch(true)).value.status, "queued");
}));

test("an unsuccessful workspace departure cannot revive an earlier physical intent", () => fixture(async ({ suite, store, dispatch, pause }) => {
  await suite.handle("/api/suite/compartment/create", { compartment: "second" });
  const held = pause("agent-intent"), result = dispatch(true);
  await held.entered;
  await assert.rejects(suite.handle("/api/suite/compartment/select", { compartment: "second" }), /owner has not verified exit/);
  assert.equal(await store.selection(), "personal");
  held.release();
  assert.match((await result).error?.message ?? "command was accepted", /workspace changed/);
  assert.equal((await store.snapshot("personal")).agents.every(agent => agent.commands.length === 0), true);
}, { codingTaskOwners: { stopCompartment: async () => ({ stopped: false }), close: async () => [] } }));

test("missing and legacy selection witnesses are read-only; independent deliberate writes get fresh identities", () => fixture(async ({ store, peer, root }) => {
  const path = join(root, "active-compartment.json"), missing = await store.selectionWitness();
  assert.equal(missing.id, "personal"); assert.deepEqual(await peer.selectionWitness(), missing);
  await assert.rejects(readFile(path), { code: "ENOENT" });
  await privateWrite(path, '{"id":"personal"}'); const bytes = await readFile(path), legacy = await store.selectionWitness();
  assert.equal(legacy.id, "personal"); assert.notEqual(legacy.digest, missing.digest); assert.deepEqual(await peer.selectionWitness(), legacy); assert.deepEqual(await readFile(path), bytes);
  await peer.selection("personal"); const first = await store.selectionWitness(); assert.notEqual(first.digest, legacy.digest);
  await peer.selection("personal"); const second = await store.selectionWitness(); assert.notEqual(second.digest, first.digest); assert.equal(await store.selection(), "personal");
  assert.equal(typeof JSON.parse(await readFile(path, "utf8")).generation, "string");
}));
test("a peer selection round trip after enqueue keeps the original command but refuses stale result attribution", () => fixture(async ({ suite, store, peer, dispatch, pause, send }) => {
  await suite.handle("/api/suite/compartment/create", { compartment: "second" });
  const held = pause("role-intent-result"), result = dispatch(true); await held.entered;
  const original = structuredClone((await store.snapshot("personal")).agents.find(agent => agent.id === "alpha").commands[0]);
  await peer.selection("second"); await peer.selection("personal"); held.release();
  assert.match((await result).error?.message ?? "stale result accepted", /workspace changed/);
  const state = await store.snapshot("personal"); assert.deepEqual(state.agents.find(agent => agent.id === "alpha").commands, [original]); assert.equal(state.intentResults?.length ?? 0, 0);
  assert.equal((await send("alpha", agentRoutes.poll)).command.id, original.id); assert.equal((await send("alpha", agentRoutes.poll)).command, null);
}));
test("a fresh physical request uses the final peer selection identity", () => fixture(async ({ suite, peer, dispatch }) => {
  await suite.handle("/api/suite/compartment/create", { compartment: "second" }); await peer.selection("second"); await peer.selection("personal");
  const result = await dispatch(true); assert.equal(result.error, undefined); assert.equal(result.value.status, "queued");
}));
