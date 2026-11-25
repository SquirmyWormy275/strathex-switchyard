import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createSuiteStore } from "../suite-store.mjs";
import { createSuite } from "../suite.mjs";
import { agentRoutes, agentMessageSchema, requestMac, responseMac } from "../../../integrations/agent-protocol.mjs";

export async function fixture(fn, overrides = {}) {
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

