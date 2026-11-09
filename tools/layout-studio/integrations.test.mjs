import assert from "node:assert/strict";
import test from "node:test";
import { createServer } from "node:http";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import { mkdtemp, readFile, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { stopOwnedChild } from "./owned-process.mjs";
import { createCustomAgents } from "./custom-agents.mjs";
import { createCopilot } from "./copilot.mjs";
import { createClientIntegrations } from "./client-integrations.mjs";
import { clientRecipe, validateClientRecipe } from "../../integrations/client-recipes.mjs";
import { createStudioServer } from "./serve.mjs";
import { switchyardAgent } from "../../integrations/agent-sdk.mjs";
import { agentRoutes, agentMessageSchema, agentResponseSchema, requestMac, responseMac, sameMac } from "../../integrations/agent-protocol.mjs";

function memoryStore() {
  const states = { personal: { id: "personal", policy: "personal", mode: "personal-companion", accounts: [], agents: [], observations: [], conversations: [], workflow: { name: "Synthetic", roles: [], steps: [] } }, work: { id: "work", policy: "work", accounts: [], agents: [], observations: [], conversations: [], workflow: { name: "Synthetic", roles: [], steps: [] } } }, secrets = new Map();
  const pending = new Map(), history = [], resources = new Set();
  return {
    states, secrets, history,
    // Symbolic resource port here; account/lifecycle suites exercise real kernel leases.
    async withResourceLock(kind, id, fn) { const key = kind + ":" + id; if (resources.has(key)) throw Error("Synthetic resource busy"); resources.add(key); try { return await fn({ assert() {} }); } finally { resources.delete(key); } },
    async tryWithResourceLock(kind, id, fn) { if (resources.has(kind + ":" + id)) return { acquired: false }; return { acquired: true, value: await this.withResourceLock(kind, id, fn) }; },
    async authorize(id, { provider, account } = {}) { const s = states[id]; if (!s || s.policy === "work" && provider && provider !== "microsoft-365-copilot") throw new Error("provider prohibited"); if (account && !s.accounts.includes(account)) throw new Error("account prohibited"); },
    async credential(id, purpose, value, request) { await this.authorize(id, request); if (value === undefined) return secrets.get(`${id}:${purpose}`); secrets.set(`${id}:${purpose}`, value); },
    async snapshot(id) { return structuredClone(states[id]); },
    async update(id, operation, fn, request) {
      const next = (pending.get(id) ?? Promise.resolve()).catch(() => {}).then(async () => { await this.authorize(id, request); const draft = structuredClone(states[id]); const result = await fn(draft); states[id] = draft; history.push({ operation, state: structuredClone(draft) }); return result; });
      pending.set(id, next); return next;
    }
  };
}
test("declarative client recipes reject substituted targets, commands, imported authority and future versions", () => {
  const recipe = clientRecipe("github-copilot-web");
  const reordered = Object.fromEntries(Object.entries(recipe).reverse()); assert.deepEqual(validateClientRecipe(reordered), recipe);
  for (const input of [{ ...recipe, target: { kind: "https", url: "https://github.com.evil.invalid/copilot" } }, { ...recipe, target: { kind: "https", url: "https://user:secret@github.com/copilot" } }, { ...recipe, command: "arbitrary executable" }, { ...recipe, approved: true }, { ...recipe, importedAuthority: true }, { ...recipe, version: 2 }]) assert.throws(() => validateClientRecipe(input), /recipe|Imported/);
  assert.throws(() => clientRecipe("microsoft-copilot"), /exact client/); assert.throws(() => clientRecipe("claude-code"), /exact client/);
});
test("client discovery keeps offline configuration useful and Work recipes cannot route to a personal provider", async () => {
  const store = memoryStore(), service = createClientIntegrations({ store, platform: "linux" });
  const personal = await service.catalog("personal"), work = await service.catalog("work");
  assert.equal(personal.entries.every(e => e.capabilities.hostLaunchConnected === false && e.account === "not-verified" && e.session === "not-identified" && e.importedAuthority === false), true);
  assert.equal(personal.entries.find(e => e.provider === "microsoft-365-copilot").policyPermitsProvider, false);
  await assert.rejects(service.recipe("personal", { id: "microsoft-365-copilot-web" }), /prohibited/);
  assert.equal(work.entries.filter(e => e.policyPermitsProvider).length, 1); assert.equal(work.entries.find(e => e.policyPermitsProvider).provider, "microsoft-365-copilot");
  assert.equal(work.entries.find(e => e.provider === "github-copilot").policyPermitsProvider, false);
  await assert.rejects(service.recipe("work", { id: "github-copilot-web" }), /prohibited/);
  const safe = await service.recipe("work", { id: "microsoft-365-copilot-web" }); assert.equal(safe.hostActionAuthorized, false); assert.equal(safe.modelPromptSubmitted, false);
  await assert.rejects(service.recipe("personal", { id: "figma-web", command: "open another site" }), /exact documented/);
  const desktop = personal.entries.find(e => e.provider === "claude-desktop"); assert.equal(desktop.recipe.target.kind, "native-application"); assert.equal(desktop.capabilities.exactResume, false);
  desktop.recipe.target.applicationId = "foreign"; assert.equal((await service.recipe("personal", { id: "claude-desktop" })).recipe.target.applicationId, "claude-desktop");
  assert.equal(store.history.length, 0); assert.equal(store.secrets.size, 0);
});

test("custom SDK events require exact scoped MAC, freshness and monotonic sequence; commands have one claim", async () => {
  const store = memoryStore(); let clock = 100000;
  const bridge = createCustomAgents({ store, now: () => clock });
  await assert.rejects(bridge.enroll("work", { id: "test", name: "Synthetic", capabilities: ["status"] }), /prohibited/);
  const enrollment = await bridge.enroll("personal", { id: "test", name: "Synthetic", capabilities: ["status", "review"] });
  const msg = (sequence, fields) => ({ schema: agentMessageSchema, compartment: "personal", agentId: "test", sessionId: "exact-session", sequence, at: clock, ...fields });
  const send = async (path, b, raw = JSON.stringify(b)) => {
    const r = await bridge.message(path, b, requestMac(enrollment.token, path, raw), raw);
    assert.equal(sameMac(r.signature, responseMac(enrollment.token, path, 200, JSON.stringify(r.payload))), true);
    assert.equal(r.payload.requestSequence, b.sequence); return r.payload.result;
  };
  const ready = msg(1, { event: { status: "ready" } });
  await assert.rejects(bridge.message(agentRoutes.event, ready, "forged"), /authentication/);
  await send(agentRoutes.event, ready, JSON.stringify(ready, null, 2));
  await assert.rejects(send(agentRoutes.event, ready), /replayed/);
  assert.equal(store.history.filter((h) => h.state.agents[0]?.sequence === 1).every((h) => h.state.agents[0].sessionId === "exact-session" && h.state.agents[0].reportedStatus === "ready"), true, "sequence and event must be durable in the same transaction");
  await assert.rejects(bridge.dispatch("personal", { agentId: "test", intent: "cancel", sessionId: "exact-session" }), /capability/);
  const command = await bridge.dispatch("personal", { agentId: "test", intent: "review", sessionId: "exact-session" });
  await assert.rejects(bridge.dispatch("personal", { agentId: "test", intent: "review", sessionId: "exact-session" }), /duplicate/);
  const poll = msg(2, {}); assert.equal((await send(agentRoutes.poll, poll)).command.id, command.commandId);
  const pollAgain = msg(3, {}); assert.equal((await send(agentRoutes.poll, pollAgain)).command, null);
  const ack = msg(4, { commandId: command.commandId, outcome: "completed" }); await send(agentRoutes.ack, ack);
  assert.equal(store.states.personal.agents[0].commands[0].status, "completed");
  clock += 31000;
  await assert.rejects(bridge.dispatch("personal", { agentId: "test", intent: "status", sessionId: "exact-session" }), /stale/);
  assert.equal(JSON.stringify(store.states).includes(enrollment.token), false);
});

test("SDK route substitution, failed mutations and concurrent replays cannot advance a session counter", async () => {
  const store = memoryStore(), bridge = createCustomAgents({ store, now: () => 100000 });
  const enrollment = await bridge.enroll("personal", { id: "test", name: "Synthetic", capabilities: ["review"] });
  const body = { schema: agentMessageSchema, compartment: "personal", agentId: "test", sessionId: "one", sequence: 1, at: 100000, event: { status: "ready" } };
  const send = (path, b) => bridge.message(path, b, requestMac(enrollment.token, path, JSON.stringify(b)));
  const poll = { ...body }; delete poll.event;
  await assert.rejects(bridge.message(agentRoutes.poll, poll, requestMac(enrollment.token, agentRoutes.event, JSON.stringify(poll))), /authentication/);
  await assert.rejects(send(agentRoutes.event, { ...body, event: { status: "completed" } }), /contract/);
  assert.equal(store.states.personal.agents[0].sequence, 0);
  const outcomes = await Promise.allSettled([send(agentRoutes.event, body), send(agentRoutes.event, body)]);
  assert.equal(outcomes.filter((r) => r.status === "fulfilled").length, 1);
  assert.match(outcomes.find((r) => r.status === "rejected").reason.message, /replayed/);
  await assert.rejects(send(agentRoutes.poll, { ...poll, sequence: 2, sessionId: "other" }), /current agent session/);
  await assert.rejects(send(agentRoutes.event, { ...body, sequence: 2, sessionId: "other", event: { status: "idle" } }), /publish ready/);
  assert.equal(store.states.personal.agents[0].sequence, 1);
  await assert.rejects(bridge.message("/agent/v1/event", { ...body, schema: "switchyard-agent-message/v1" }, "forged"), /v2/);
});

test("session replacement preserves uncertain claims and accepts a late exact acknowledgement without refreshing the new session", async () => {
  const store = memoryStore(); let clock = 100000, sequence = 0;
  const bridge = createCustomAgents({ store, now: () => clock });
  const enrollment = await bridge.enroll("personal", { id: "test", name: "Synthetic", capabilities: ["review", "status"] });
  const send = async (path, sessionId, fields = {}) => { const b = { schema: agentMessageSchema, compartment: "personal", agentId: "test", sessionId, sequence: ++sequence, at: clock, ...fields }; return (await bridge.message(path, b, requestMac(enrollment.token, path, JSON.stringify(b)))).payload.result; };
  await send(agentRoutes.event, "one", { event: { status: "ready" } });
  const claimed = await bridge.dispatch("personal", { agentId: "test", intent: "review", sessionId: "one" });
  await send(agentRoutes.poll, "one");
  await bridge.dispatch("personal", { agentId: "test", intent: "status", sessionId: "one" });
  await send(agentRoutes.event, "two", { event: { status: "ready" } });
  assert.deepEqual(store.states.personal.agents[0].commands.map((c) => c.status), ["uncertain-session-ended", "cancelled-before-claim"]);
  await assert.rejects(send(agentRoutes.poll, "one"), /current agent session/);
  assert.equal((await send(agentRoutes.poll, "two")).command, null);
  clock += 31000;
  await send(agentRoutes.ack, "one", { commandId: claimed.commandId, outcome: "completed" });
  assert.equal(store.states.personal.agents[0].commands[0].status, "completed");
  assert.equal(store.states.personal.agents[0].sessionId, "two");
  await assert.rejects(bridge.dispatch("personal", { agentId: "test", intent: "status", sessionId: "two" }), /stale/);
  store.states.personal.observations.push({ status: "recording", sources: ["agent-events"], events: Array.from({ length: 2000 }, () => ({ kind: "status" })) });
  await send(agentRoutes.event, "two", { event: { status: "idle" } });
  assert.equal(store.states.personal.observations[0].status, "paused");
  assert.equal(store.states.personal.observations[0].events.length, 2000);
});

async function listening(server, t) { await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve)); t.after(() => new Promise((resolve) => { server.closeAllConnections(); server.close(resolve); })); return `http://127.0.0.1:${server.address().port}/`; }

test("authenticated custom command history records exact claims, late acknowledgements and replacement without replay or content", async () => {
  const store = memoryStore(); let sequence = 0, clock = 100000;
  store.states.personal.observations.push({ status: "recording", sources: ["agent-events"], events: [], createdAt: clock });
  const bridge = createCustomAgents({ store, now: () => clock }), enrollment = await bridge.enroll("personal", { id: "private-agent", name: "PRIVATE_LABEL", capabilities: ["handoff", "review"] });
  const send = async (path, sessionId, fields = {}) => { const b = { schema: agentMessageSchema, compartment: "personal", agentId: enrollment.agentId, sessionId, sequence: ++sequence, at: clock, ...fields }; return (await bridge.message(path, b, requestMac(enrollment.token, path, JSON.stringify(b)))).payload.result; };
  const events = () => store.states.personal.observations[0].events.filter(e => e.phase.startsWith("adapter-command-"));
  await send(agentRoutes.event, "PRIVATE_SESSION", { event: { status: "ready" } });
  const input = { agentId: enrollment.agentId, sessionId: "PRIVATE_SESSION", intent: "handoff", content: "PRIVATE_HANDOFF_CONTENT" };
  const queued = await bridge.dispatch("personal", input); await assert.rejects(bridge.dispatch("personal", input), /duplicate/);
  assert.equal((await send(agentRoutes.poll, "PRIVATE_SESSION")).command.id, queued.commandId); assert.equal((await send(agentRoutes.poll, "PRIVATE_SESSION")).command, null);
  const unclaimed = await bridge.dispatch("personal", { ...input, intent: "review" });
  await send(agentRoutes.event, "NEW_PRIVATE_SESSION", { event: { status: "ready" } });
  const lastSeen = store.states.personal.agents[0].lastSeen; clock++;
  await send(agentRoutes.ack, "PRIVATE_SESSION", { commandId: queued.commandId, outcome: "completed" });
  await assert.rejects(send(agentRoutes.ack, "PRIVATE_SESSION", { commandId: queued.commandId, outcome: "completed" }), /exact active claim/);
  assert.equal(store.states.personal.agents[0].lastSeen, lastSeen); assert.equal(store.states.personal.agents[0].sessionId, "NEW_PRIVATE_SESSION");
  assert.deepEqual(events().map(e => [e.phase, e.status]), [["adapter-command-queued", "reserved-locally"], ["adapter-command-claimed", "running"], ["adapter-command-queued", "reserved-locally"], ["adapter-command-retired", "unknown"], ["adapter-command-retired", "stopped"], ["adapter-command-acknowledged", "done"]]);
  const first = events()[0].subjectDigest; assert.deepEqual(events().filter(e => e.subjectDigest === first).map(e => e.intent), ["handoff", "handoff", "handoff", "handoff"]);
  assert.equal(events().every(e => e.taskCompletionVerified === false && e.timeSavingMeasured === false), true);
  for (const privateValue of [queued.commandId, unclaimed.commandId, enrollment.token, enrollment.agentId, "PRIVATE_LABEL", "PRIVATE_SESSION", "NEW_PRIVATE_SESSION", "PRIVATE_HANDOFF_CONTENT"]) assert.equal(JSON.stringify(events()).includes(privateValue), false);
  const committedClaim = store.history.find(h => h.state.agents[0]?.commands[0]?.status === "claimed");
  assert.equal(committedClaim.state.observations[0].events.some(e => e.phase === "adapter-command-claimed"), true);
});

test("custom command events commit atomically and paused acknowledgements are not backfilled", async () => {
  const store = memoryStore(); let sequence = 0, fail = false;
  store.states.personal.observations.push({ status: "recording", sources: ["agent-events"], events: [] });
  const update = store.update.bind(store); store.update = (id, operation, fn, request) => update(id, operation, async s => { const result = await fn(s); if (fail) throw Error("synthetic persistence failure"); return result; }, request);
  const bridge = createCustomAgents({ store, now: () => 100000 }), enrollment = await bridge.enroll("personal", { id: "test", name: "Synthetic", capabilities: ["review"] });
  const send = async (path, fields = {}) => { const b = { schema: agentMessageSchema, compartment: "personal", agentId: "test", sessionId: "one", sequence: ++sequence, at: 100000, ...fields }; return (await bridge.message(path, b, requestMac(enrollment.token, path, JSON.stringify(b)))).payload.result; };
  await send(agentRoutes.event, { event: { status: "ready" } });
  const input = { agentId: "test", sessionId: "one", intent: "review" }, before = structuredClone(store.states.personal); fail = true;
  await assert.rejects(bridge.dispatch("personal", input), /persistence failure/); assert.deepEqual(store.states.personal, before); fail = false;
  const queued = await bridge.dispatch("personal", input); const reserved = structuredClone(store.states.personal); fail = true;
  await assert.rejects(send(agentRoutes.poll), /persistence failure/); assert.deepEqual(store.states.personal, reserved); fail = false;
  await send(agentRoutes.poll); const claimed = structuredClone(store.states.personal); fail = true;
  await assert.rejects(send(agentRoutes.ack, { commandId: queued.commandId, outcome: "failed" }), /persistence failure/); assert.deepEqual(store.states.personal, claimed); fail = false;
  store.states.personal.observations[0].status = "paused";
  await send(agentRoutes.ack, { commandId: queued.commandId, outcome: "failed" });
  assert.equal(store.states.personal.agents[0].commands[0].status, "failed");
  store.states.personal.observations[0].status = "recording";
  await assert.rejects(send(agentRoutes.ack, { commandId: queued.commandId, outcome: "failed" }), /exact active claim/);
  assert.equal(store.states.personal.observations[0].events.some(e => e.phase === "adapter-command-acknowledged"), false);
});

test("Node SDK exchanges authenticated HTTP events and one exact claim through the actual local server", async (t) => {
  const store = memoryStore(), bridge = createCustomAgents({ store });
  const enrollment = await bridge.enroll("personal", { id: "test", name: "Synthetic", capabilities: ["review"] });
  const server = createStudioServer({ bridge: { close() {} }, suite: { agentMessage: (...a) => bridge.message(...a), close() {} } });
  const baseUrl = await listening(server, t), sdk = switchyardAgent({ ...enrollment, baseUrl });
  assert.equal((await sdk.publish("exact-one", "ready")).accepted, true);
  const queued = await bridge.dispatch("personal", { agentId: "test", intent: "review", sessionId: "exact-one" });
  const claim = (await sdk.poll()).command; assert.equal(claim.id, queued.commandId);
  assert.equal((await sdk.poll()).command, null);
  await sdk.publish("exact-two", "ready");
  await sdk.acknowledge(claim.id, "completed");
  assert.equal(store.states.personal.agents[0].sessionId, "exact-two");
  assert.equal(store.states.personal.agents[0].commands[0].status, "completed");
  assert.equal((await fetch(`${baseUrl}agent/v1/event`, { method: "POST", headers: { "Content-Type": "application/json" }, body: "{}" })).status, 426);
  assert.equal((await fetch(`${baseUrl}agent/v2/event`, { method: "POST", headers: { "Content-Type": "application/json", Origin: baseUrl.slice(0, -1) }, body: "{}" })).status, 403);
});

test("the Node SDK rejects unsigned, replayed and wrong-session responses before returning any command", async (t) => {
  const token = "x".repeat(43); let fault = "unsigned";
  const server = createServer(async (req, res) => {
    let raw = ""; for await (const c of req) raw += c;
    const b = JSON.parse(raw);
    const payload = { schema: agentResponseSchema, requestSequence: fault === "replayed" ? b.sequence - 1 : b.sequence, sessionId: fault === "wrong-session" ? "other" : b.sessionId, result: { accepted: true } }, text = JSON.stringify(payload);
    if (fault !== "unsigned") res.setHeader("X-Switchyard-Response-Signature", responseMac(token, req.url, 200, text));
    res.end(text);
  });
  const sdk = switchyardAgent({ baseUrl: await listening(server, t), token, compartment: "personal", agentId: "test" });
  await assert.rejects(sdk.publish("exact", "ready"), /authentication/);
  fault = "replayed"; await assert.rejects(sdk.publish("exact", "ready"), /scope/);
  fault = "wrong-session"; await assert.rejects(sdk.publish("exact", "ready"), /scope/);
  fault = "valid"; assert.equal((await sdk.publish("exact", "ready")).accepted, true);
  await assert.rejects(sdk.poll(), /command.*contract/);
});

async function sequenceServer(t, token, readSequence = async () => null) {
  const received = [], server = createServer(async (req, res) => {
    try {
      let raw = ""; for await (const chunk of req) raw += chunk;
      const body = JSON.parse(raw), persisted = await readSequence();
      received.push({ sequence: body.sequence, at: body.at, persisted, compartment: body.compartment, agentId: body.agentId, authenticated: sameMac(req.headers["x-switchyard-signature"], requestMac(token, req.url, raw)) });
      const text = JSON.stringify({ schema: agentResponseSchema, requestSequence: body.sequence, sessionId: body.sessionId, result: { accepted: true } });
      res.setHeader("X-Switchyard-Response-Signature", responseMac(token, req.url, 200, text)); res.end(text);
    } catch { res.writeHead(500); res.end(); }
  });
  return { baseUrl: await listening(server, t), received };
}

test("Node SDK waits for private sequence persistence before serialized sends and resumes above the saved counter", async (t) => {
  const root = await mkdtemp(join(tmpdir(), "switchyard-sdk-sequence-")), path = join(root, "sequence"), token = "x".repeat(43);
  const saves = []; t.after(async () => { await Promise.allSettled(saves); await rm(root, { recursive: true, force: true }); });
  const saved = async () => Number(await readFile(path, "utf8").catch(() => "0")), { baseUrl, received } = await sequenceServer(t, token, saved);
  const enrollment = { baseUrl, token, compartment: "personal", agentId: "test" }, persisted = [];
  const sdk = switchyardAgent({ ...enrollment, onSequence: sequence => { const save = (async () => { await new Promise(resolve => setTimeout(resolve, 40)); await writeFile(path, String(sequence), { mode: 0o600 }); persisted.push(sequence); })(); saves.push(save); return save; } });
  await Promise.all([sdk.publish("one", "ready"), sdk.publish("two", "ready")]);
  assert.deepEqual(received.map(r => [r.sequence, r.persisted, r.authenticated]), [[1, 1, true], [2, 2, true]]);
  assert.deepEqual(persisted, [1, 2]);
  const restarted = switchyardAgent({ ...enrollment, initialSequence: await saved(), onSequence: sequence => writeFile(path, String(sequence), { mode: 0o600 }) });
  await restarted.publish("three", "ready"); assert.equal(received[2].sequence, 3); assert.equal(received[2].persisted, 3);
});

test("Node SDK persistence rejection sends nothing and cannot reuse the consumed sequence", async (t) => {
  const token = "x".repeat(43), { baseUrl, received } = await sequenceServer(t, token), saved = [];
  const enrollment = { baseUrl, token, compartment: "personal", agentId: "test" };
  assert.throws(() => switchyardAgent({ ...enrollment, onSequence: "not-a-callback" }), /persistence|callback/);
  const sdk = switchyardAgent({ ...enrollment, onSequence: async sequence => { if (sequence === 1) throw Error("Synthetic persistence failure"); saved.push(sequence); } });
  await assert.rejects(sdk.publish("one", "ready"), /Synthetic persistence failure/); assert.equal(received.length, 0);
  await sdk.publish("two", "ready"); assert.deepEqual(saved, [2]); assert.deepEqual(received.map(r => r.sequence), [2]);
});

test("Node SDK dates each report before its serialized request and sequence persistence wait", async t => {
  const token = "x".repeat(43), { baseUrl, received } = await sequenceServer(t, token);
  const original = Date.now; let at = 100000;
  Date.now = () => at;
  try {
    const sdk = switchyardAgent({ baseUrl, token, compartment: "personal", agentId: "test", onSequence: async () => { at += 100; } });
    const first = sdk.publish("one", "ready"); at++;
    const second = sdk.publish("one", "busy"); at++;
    await Promise.all([first, second]);
    assert.deepEqual(received.map(row => row.at), [100000, 100001]);
    assert.equal(received.every(row => row.authenticated), true);
  } finally { Date.now = original; }
});

async function pythonSdk(program, enrollment) {
  const module = fileURLToPath(new URL("../../integrations", import.meta.url));
  const child = spawn(process.platform === "win32" ? "python.exe" : "/usr/bin/python3", ["-I", "-B", "-c", "import sys,json\nsys.path.insert(0,sys.argv[1])\nfrom switchyard_agent import SwitchyardAgent\nenrollment=json.load(sys.stdin)\n" + program, module], { stdio: ["pipe", "pipe", "pipe"], windowsHide: true });
  let stdout = "", stderr = "", overflow = false;
  child.stdout.on("data", bytes => { stdout += bytes; if (stdout.length > 16384) { overflow = true; child.kill(); } });
  child.stderr.on("data", bytes => { stderr += bytes; if (stderr.length > 16384) { overflow = true; child.kill(); } });
  const exited = new Promise((resolve, reject) => { child.once("error", reject); child.once("close", (code, signal) => resolve({ code, signal })); });
  child.stdin.on("error", () => {}); child.stdin.end(JSON.stringify(enrollment));
  let timer;
  try {
    const result = await Promise.race([exited, new Promise((_, reject) => { timer = setTimeout(() => reject(Error("Synthetic Python SDK check exceeded its bound.")), 10000); })]);
    assert.equal(overflow, false); assert.equal(result.signal, null); assert.equal(result.code, 0, stderr); return JSON.parse(stdout);
  } finally { clearTimeout(timer); assert.equal((await stopOwnedChild(child)).stopped, true); }
}

test("Python SDK pins its enrolled endpoint and scope against caller dictionary mutation", async (t) => {
  const token = "x".repeat(43), original = await sequenceServer(t, token), substitute = await sequenceServer(t, "y".repeat(43));
  const result = await pythonSdk(`sdk=SwitchyardAgent(enrollment)\nenrollment.update(baseUrl=enrollment['substitute'],token='y'*43,compartment='work',agentId='other')\nsdk.publish('exact','ready')\nprint(json.dumps({'sequence':sdk.sequence}))`, { baseUrl: original.baseUrl, substitute: substitute.baseUrl, token, compartment: "personal", agentId: "test" });
  assert.equal(result.sequence, 1); assert.equal(substitute.received.length, 0);
  assert.deepEqual(original.received.map(r => [r.compartment, r.agentId, r.authenticated]), [["personal", "test", true]]);
});

test("Python SDK persists before sending, refuses failed or asynchronous hooks and resumes above saved state", async (t) => {
  const root = await mkdtemp(join(tmpdir(), "switchyard-python-sequence-")), path = join(root, "sequence"), token = "x".repeat(43);
  t.after(() => rm(root, { recursive: true, force: true }));
  const { baseUrl, received } = await sequenceServer(t, token, async () => Number(await readFile(path, "utf8").catch(() => "0")));
  const result = await pythonSdk(`from pathlib import Path\np=Path(enrollment['sequencePath'])\ndef persist(sequence):\n    if sequence==1: raise RuntimeError('Synthetic persistence failure')\n    p.write_text(str(sequence))\nsdk=SwitchyardAgent(enrollment,on_sequence=persist)\ntry: sdk.publish('one','ready')\nexcept RuntimeError: pass\nelse: raise AssertionError('Failed save sent a request')\nsdk.publish('two','ready')\nrestarted=SwitchyardAgent({**enrollment,'initialSequence':int(p.read_text())},on_sequence=persist)\nrestarted.publish('three','ready')\nasync def unsupported(sequence): pass\ntry: SwitchyardAgent(enrollment,on_sequence=unsupported).publish('async','ready')\nexcept ValueError: pass\nelse: raise AssertionError('An asynchronous hook was accepted')\ntry: SwitchyardAgent(enrollment,on_sequence=lambda _:unsupported(1)).publish('awaitable','ready')\nexcept ValueError: pass\nelse: raise AssertionError('A returned awaitable was accepted')\nrecursive=SwitchyardAgent(enrollment,on_sequence=lambda _:recursive.publish('nested','ready'))\ntry: recursive.publish('outer','ready')\nexcept ValueError: pass\nelse: raise AssertionError('A persistence hook sent a nested request')\nassert recursive.sequence==1\ntry: SwitchyardAgent(enrollment,on_sequence=7)\nexcept ValueError: pass\nelse: raise AssertionError('Invalid hook was accepted')\nprint(json.dumps({'saved':int(p.read_text())}))`, { baseUrl, token, compartment: "personal", agentId: "test", sequencePath: path });
  assert.equal(result.saved, 3); assert.deepEqual(received.map(r => [r.sequence, r.persisted, r.authenticated]), [[2, 2, true], [3, 3, true]]);
});

test("Python SDK dates reports before the private sequence callback can delay them", async t => {
  const token = "x".repeat(43), { baseUrl, received } = await sequenceServer(t, token);
  await pythonSdk(`import switchyard_agent\nclock=[100]\nswitchyard_agent.time.time=lambda:clock[0]\ndef persist(sequence):\n    clock[0]+=10\nsdk=SwitchyardAgent(enrollment,on_sequence=persist)\nsdk.publish('one','ready')\nsdk.publish('one','busy')\nprint(json.dumps({'sent':2}))`, { baseUrl, token, compartment: "personal", agentId: "test" });
  assert.deepEqual(received.map(row => row.at), [100000, 110000]);
  assert.equal(received.every(row => row.authenticated), true);
});

test("a real bundled Node example exits after abrupt loss of its owning parent", { timeout: 12000 }, async (t) => {
  const store = memoryStore(), bridge = createCustomAgents({ store });
  const enrollment = await bridge.enroll("personal", { id: "test", name: "Synthetic", capabilities: ["review"] });
  const server = createStudioServer({ bridge: { close() {} }, suite: { agentMessage: (...a) => bridge.message(...a), close() {} } });
  const baseUrl = await listening(server, t), file = fileURLToPath(new URL("../../examples/custom-agent/agent.mjs", import.meta.url));
  const parent = spawn(process.execPath, ["--input-type=module", "-e", `
    import {spawn} from 'node:child_process';
    let text=''; for await (const chunk of process.stdin) text+=chunk;
    const {file,enrollment}=JSON.parse(text);
    const child=spawn(process.execPath,[file],{stdio:['pipe',1,2]});
    child.stdin.on('error',()=>{});
    child.stdin.write(JSON.stringify({...enrollment,supervised:true})+'\\n');
    console.log(JSON.stringify({pid:child.pid}));
  `], { stdio: ["pipe", "pipe", "pipe"], windowsHide: true });
  let childPid, output = "", errors = "";
  parent.stdout.on("data", (c) => { output += c; if (output.includes("\n")) childPid = JSON.parse(output.trim()).pid; });
  parent.stderr.on("data", (c) => { errors += c; });
  let closed = false; const close = new Promise((resolve) => parent.once("close", () => { closed = true; resolve(); }));
  t.after(async () => { await stopOwnedChild(parent); if (!closed && childPid) { try { process.kill(childPid, "SIGKILL"); } catch {} } });
  parent.stdin.end(JSON.stringify({ file, enrollment: { ...enrollment, baseUrl } }));
  const deadline = Date.now() + 5000;
  while (!store.states.personal.agents[0].sessionId && Date.now() < deadline && !closed) await new Promise((r) => setTimeout(r, 20));
  assert.equal(store.states.personal.agents[0].reportedStatus, "ready", errors);
  assert.equal(Number.isInteger(childPid), true);
  parent.kill("SIGKILL");
  let timer;
  try { await Promise.race([close, new Promise((_, reject) => { timer = setTimeout(() => reject(new Error("The example retained its inherited output pipe after its parent died.")), 3000); })]); }
  finally { clearTimeout(timer); }
});

test("Copilot-only enrollment uses fixed Microsoft endpoints, opaque credentials and an exact owned Graph conversation", async () => {
  const store = memoryStore(), calls = []; let clock = 100000;
  const tenantId = "11111111-1111-1111-1111-111111111111", clientId = "22222222-2222-2222-2222-222222222222", account = "33333333-3333-3333-3333-333333333333", remoteId = "44444444-4444-4444-4444-444444444444";
  const fetcher = async (url, options) => {
    calls.push({ url, options });
    let value;
    if (url.endsWith("/devicecode")) value = { device_code: "synthetic-device-code", user_code: "EXAMPLE", verification_uri: "https://microsoft.com/devicelogin", expires_in: 900, interval: 5 };
    else if (url.endsWith("/token")) value = { access_token: "opaque-synthetic-token", refresh_token: "opaque-refresh", expires_in: 3600 };
    else if (url.includes("/v1.0/me")) value = { id: account, displayName: "Synthetic approved account" };
    else if (url.endsWith("/conversations")) value = { id: remoteId };
    else if (url.endsWith("/chat")) value = { id: remoteId, messages: [{ text: JSON.stringify({ reply: "Review this synthetic workflow", summary: "No key changes", actions: [], steps: ["Review evidence"], roles: ["Reviewer"] }) }] };
    else throw new Error("Unexpected Microsoft route");
    return new Response(JSON.stringify(value), { status: 200 });
  };
  const api = createCopilot({ store, fetcher, now: () => clock });
  await assert.rejects(api.beginLogin("work", { tenantId, clientId, approved: false }), /explicitly/); assert.equal(calls.length, 0);
  const login = await api.beginLogin("work", { tenantId, clientId, approved: true });
  assert.equal((await api.pollLogin("work", login.loginId)).status, "pending");
  clock += 6000; assert.equal((await api.pollLogin("work", login.loginId)).status, "connected");
  const plan = { schema: "sxsy-agentic-layout-plan/v1", profile: { schema: "sxsy-board-profile/v1", name: "Synthetic", layout: "one", controller: "unknown", keys: [{ id: "one", label: "A", matrix: [0, 0], x: 0, y: 0, baseKeycode: "KC_A" }] }, actions: [], study: null };
  const result = await api.design({ compartment: "work", message: "Synthetic design request", plan });
  assert.equal(result.provider, "microsoft-365-copilot"); assert.equal(result.sessionId, remoteId);
  assert.equal(JSON.stringify(store.states).includes("opaque-synthetic-token"), false);
  assert.equal(JSON.stringify(store.states).includes("synthetic-device-code"), false);
  assert.equal(calls.every((c) => c.options.redirect === "error"), true);
  await assert.rejects(api.design({ compartment: "work", message: "Do not fall back", plan, conversationId: "missing" }), /not owned/);
});
