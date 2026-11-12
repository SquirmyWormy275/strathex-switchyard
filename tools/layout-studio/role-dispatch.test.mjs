import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { agentRoutes } from "../../integrations/agent-protocol.mjs";
import { fixture } from "./test-support/role-dispatch.mjs";
import { privateWrite } from "./suite-store.mjs";

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

for (const physical of [true, false]) for (const change of ["another workspace", "away and back", "saved selection", "saved selection round trip", "saved same selection", "shutdown"]) {
  test(`a ${physical ? "physical" : "reviewed frontend"} role intent refuses ${change} before enqueue`, () => fixture(async ({ suite, store, peer, dispatch, pause }) => {
    await suite.handle("/api/suite/compartment/create", { compartment: "second" });
    const held = pause("agent-intent"), result = dispatch(physical);
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

for (const physical of [true, false]) test(`a workspace change after ${physical ? "physical" : "reviewed frontend"} enqueue preserves the original command and refuses stale attribution`, () => fixture(async ({ suite, store, dispatch, pause, send }) => {
  await suite.handle("/api/suite/compartment/create", { compartment: "second" });
  const held = pause("role-intent-result"), result = dispatch(physical);
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

test("a reviewed frontend request cannot dispatch a no-longer-selected workspace", () => fixture(async ({ suite, store }) => {
  await suite.handle("/api/suite/compartment/create", { compartment: "second" });
  await suite.handle("/api/suite/compartment/select", { compartment: "second" });
  await assert.rejects(suite.handle("/api/suite/roles/dispatch", { compartment: "personal", roleId: "operator", intent: "status" }), /selected workspace changed/);
  assert.equal((await store.snapshot("personal")).agents.every(agent => agent.commands.length === 0), true);
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
