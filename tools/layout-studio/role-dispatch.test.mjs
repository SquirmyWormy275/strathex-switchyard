import assert from "node:assert/strict";
import test from "node:test";
import { mkdtemp, rm, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
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
