import test from "node:test";
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { once } from "node:events";
import { mkdtemp, rm, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { closedIntent, publishEndpoint, dispatchPhysicalIntent, waitIntentReceipt, intentKey, reviewAccessToken } from "./physical-intent.mjs";
import { createSuiteStore } from "./suite-store.mjs";
import { createSuite } from "./suite.mjs";
import { randomUUID } from "node:crypto";
import { createClientLaunch } from "./client-launch.mjs";
import { createStudioServer } from "./serve.mjs";

async function clientRoleFixture(t, boundary = async () => {}) {
  const root = await mkdtemp(join(tmpdir(), "switchyard-client-role-")), keys = new Map(), requests = [];
  const store = createSuiteStore({ root: join(root, "state"), secrets: { get: async (c,p) => keys.get(c+p), set: async (c,p,v) => { keys.set(c+p,v); } } });
  let effects = 0;
  const clientLaunch = createClientLaunch({ store, stateDirectory: join(root, "launch"), platform: "linux", guardianStopped: async () => true, isActive: async c => c === await store.selection(), command: async (exe, args, options) => {
    const request = JSON.parse(options.inputText), owner = { schema: "switchyard-runtime-command/v1", id: randomUUID(), guardianPid: 12345, birth: "1", containment: process.platform === "linux" ? "owned-linux-session" : "windows-job" };
    requests.push(request); await boundary("before-ready", { store }); await options.onGuardianReady(owner); effects++; await boundary("after-effect", { store });
    return { status: "completed", exitCode: 0, inputDelivered: true, treeExitVerified: true, stdout: JSON.stringify({ schema: "switchyard-client-portal-result/v1", id: request.id, status: "accepted", response: 0, applicationOpenedVerified: false, accountVerified: false, sessionIdentified: false }) };
  } });
  const suite = createSuite({ store, clientLaunch, agents: { discovery: async () => [], close() {} }, voice: { discovery: async () => ({ available: false }) } });
  const server = createStudioServer({ suite, bridge: { close() {} }, token: "b".repeat(43) }); server.listen(0, "127.0.0.1"); await once(server, "listening");
  t.after(async () => { server.closeAllConnections(); await new Promise(r => server.close(r)); await server.cleanup(); await rm(root, { recursive: true, force: true }); });
  const origin = `http://127.0.0.1:${server.address().port}`;
  async function api(path, body = {}, status = 200, authenticated = true) { const response = await fetch(origin + "/api/suite/" + path, { method: "POST", headers: { "Content-Type": "application/json", Origin: origin, ...(authenticated ? { Authorization: `Bearer ${server.accessToken}` } : {}) }, body: JSON.stringify(body) }); const result = await response.json(); assert.equal(response.status, status, JSON.stringify(result)); return result; }
  await api("bootstrap"); await api("mode", { mode: "personal-companion" });
  await api("workflow/save", { workflow: { name: "Synthetic client roles", roles: [{ id: "builder", label: "Builder" }, { id: "reviewer", label: "Reviewer" }], steps: [] } });
  const binding = { roleId: "builder", intent: "summon", provider: "github-copilot", targetKind: "client-surface", targetId: "github-copilot-web" };
  return { root, store, suite, server, api, binding, requests, effects: () => effects };
}

test("authenticated role and physical gateways share exact launch receipts without fabricating session control", async t => {
  const f = await clientRoleFixture(t), { api, binding, store, suite } = f;
  await api("roles/bind", binding, 401, false);
  for (const extra of [{ sessionId: "invented" }, { command: "foreign" }, { url: "https://foreign.invalid" }, { approved: true }]) await api("roles/bind", { ...binding, ...extra }, 409);
  await api("roles/bind", { ...binding, intent: "resume" }, 409);
  await api("roles/bind", { ...binding, provider: "figma" }, 409);
  await api("roles/bind", { ...binding, provider: "claude-desktop", targetId: "claude-desktop" }, 409);
  const bound = await api("roles/bind", binding); assert.equal(bound.sessionId, undefined); assert.equal(bound.targetKind, "client-surface");
  const connection = await suite.authorizeConnection("personal", { implementation: "switchyard.role/v1", roleId: "builder", intent: "summon" }); assert.equal(connection.capability, "launch-only"); assert.equal(connection.sessionIdentified, false); assert.match(connection.evidence, /no account/);
  const packet = { roleId: "builder", intent: "summon", requestId: randomUUID() };
  await api("roles/dispatch", packet, 401, false); await api("roles/dispatch", { ...packet, content: "private context" }, 409); await api("roles/dispatch", { ...packet, url: "https://foreign.invalid" }, 409); await api("roles/dispatch", { roleId: "builder", intent: "summon" }, 409);
  assert.equal(f.effects(), 0);
  const original = await store.snapshot("personal");
  const launched = await api("roles/dispatch", packet); assert.equal(launched.status, "launch-requested"); assert.equal(launched.sessionIdentified, false); assert.equal(launched.modelPromptSubmitted, false);
  const intent = { implementation: "switchyard.role/v1", ...packet };
  assert.equal((await api("intent", intent)).replayed, true); assert.equal(f.effects(), 1);
  assert.equal((await store.snapshot("personal")).activeConversationId, original.activeConversationId);
  await api("integrations/launch", { id: binding.targetId, requestId: packet.requestId }, 409);
  await api("roles/bind", { ...binding, roleId: "reviewer" }); await api("roles/dispatch", { ...packet, roleId: "reviewer" }, 409);
  await api("roles/bind", binding); await api("roles/dispatch", packet, 409); assert.equal(f.effects(), 1);
  await publishEndpoint(f.server, { root: f.root }); const at = Date.now();
  const physical = { implementation: "switchyard.role/v1", roleId: "builder", intent: "summon" };
  const result = await dispatchPhysicalIntent(physical, { root: f.root }); const receipt = await waitIntentReceipt(physical, at, { root: f.root, timeoutMs: 1000 });
  assert.equal(result.requestId, receipt.invocationId); assert.equal(f.effects(), 2); assert.equal(f.requests.every(r => Object.keys(r).sort().join(",") === "id,schema,targetSha256"), true);
  await api("mode", { mode: "keyboard-only" }); await api("intent", { ...intent, requestId: randomUUID() }, 409); assert.equal(f.effects(), 2);
});

test("rebound or removed client roles fail before native acknowledgement and late changes remain uncertain", async t => {
  let change = "before-ready";
  const f = await clientRoleFixture(t, async (stage, { store }) => { if (stage === change) await store.update("personal", "synthetic-role-change", s => { s.roleBindings[0].bindingId = randomUUID(); }); });
  await f.api("roles/bind", f.binding);
  const packet = { roleId: "builder", intent: "summon", requestId: randomUUID() };
  assert.match((await f.api("roles/dispatch", packet, 409)).error, /binding changed/); assert.equal(f.effects(), 0);
  assert.equal((await f.store.snapshot("personal")).clientLaunches[0].status, "outcome-unconfirmed");
  await f.api("roles/dispatch", packet, 409); assert.equal(f.requests.length, 1);
  change = "after-effect"; assert.match((await f.api("roles/dispatch", { ...packet, requestId: randomUUID() }, 409)).error, /binding changed/); assert.equal(f.effects(), 1);
  assert.equal((await f.store.snapshot("personal")).clientLaunches.at(-1).status, "outcome-unconfirmed");
  change = null; await f.api("workflow/save", { workflow: { name: "Removed role", roles: [], steps: [] } });
  await f.api("intent", { implementation: "switchyard.role/v1", ...packet, requestId: randomUUID() }, 409); assert.equal(f.effects(), 1);
});

test("active Work client roles allow only Microsoft work Copilot and never route caller-selected Personal context", async t => {
  const f = await clientRoleFixture(t); await f.api("roles/bind", f.binding);
  await f.api("compartment/create", { compartment: "company", policy: "work" }); await f.api("compartment/select", { compartment: "company" }); await f.api("mode", { compartment: "company", mode: "managed-companion" });
  await f.api("workflow/save", { compartment: "company", workflow: { name: "Work", roles: [{ id: "builder", label: "Builder" }], steps: [] } });
  await f.api("roles/bind", { ...f.binding, compartment: "company" }, 409);
  await f.api("roles/bind", { ...f.binding, compartment: "company", provider: "microsoft-365-copilot", targetId: "microsoft-365-copilot-web" });
  const packet = { implementation: "switchyard.role/v1", roleId: "builder", intent: "summon", compartment: "personal", requestId: randomUUID() };
  assert.equal((await f.api("intent", packet)).provider, "microsoft-365-copilot"); assert.equal(f.requests[0].id, "microsoft-365-copilot-web");
  await f.api("intent", { ...packet, url: "https://github.com/copilot" }, 409);
  await f.api("roles/dispatch", { compartment: "personal", roleId: "builder", intent: "summon", requestId: randomUUID() }, 409);
  await f.api("roles/bind", { ...f.binding, compartment: "company", provider: "microsoft-365-copilot", targetId: "microsoft-365-copilot-web", intent: "cancel" }, 409);
  assert.equal(f.effects(), 1); assert.equal((await f.store.snapshot("company")).activeConversationId, undefined);
});

test("backend review restarts retain access only for the same private frozen review and a stopped endpoint owner", async () => {
  const root = await mkdtemp(join(tmpdir(), "switchyard-review-access-")), review = "b".repeat(64), token = "a".repeat(43), endpoint = { schema: "switchyard-active-endpoint/v1", pid: 12345, url: `http://127.0.0.1:43177/#access=${token}`, review };
  const options = { root, port: 43177, review, processExists: () => false };
  try {
    assert.equal(await reviewAccessToken(options), undefined);
    await writeFile(join(root, "43177.json"), JSON.stringify(endpoint), { mode: 0o600 });
    assert.equal(await reviewAccessToken(options), token);
    assert.equal(await reviewAccessToken({ ...options, review: "c".repeat(64) }), undefined);
    await assert.rejects(reviewAccessToken({ ...options, processExists: () => true }), /still owns/);
    await writeFile(join(root, "43177.json"), JSON.stringify({ ...endpoint, url: `https://external.invalid/#access=${token}` }));
    await assert.rejects(reviewAccessToken(options), /endpoint is invalid/);
  } finally { await rm(root, { recursive: true, force: true }); }
});

test("physical gateway uses only its private active endpoint and closed intent; acceptance is not task completion", async () => {
  const root = await mkdtemp(join(tmpdir(), "switchyard-physical-")), seen = [];
  let reject = false;
  const server = createServer(async (request, response) => { const chunks = []; for await (const chunk of request) chunks.push(chunk); seen.push({ headers: request.headers, body: JSON.parse(Buffer.concat(chunks).toString()) }); response.writeHead(reject ? 409 : 200, { "Content-Type": "application/json" }); response.end(JSON.stringify(reject ? { error: "Work prohibits this target" } : { status: "queued", provenance: "synthetic self-report" })); });
  server.accessToken = "a".repeat(43); server.listen(0, "127.0.0.1"); await once(server, "listening");
  try {
    const url = await publishEndpoint(server, { root }), intent = { implementation: "switchyard.role/v1", roleId: "builder", intent: "status", compartment: "personal", command: "never forwarded" };
    const at = Date.now(), result = await dispatchPhysicalIntent(intent, { root });
    assert.equal(result.status, "queued"); const { requestId, ...packet } = seen[0].body; assert.deepEqual(packet, closedIntent(intent)); assert.match(requestId, /^[a-f0-9-]{36}$/); assert.equal(seen[0].headers.origin, new URL(url).origin);
    assert.equal(seen[0].headers.authorization, `Bearer ${server.accessToken}`);
    const receipt = await waitIntentReceipt(intent, at, { root, timeoutMs: 1000 });
    assert.equal(receipt.status, "accepted"); assert.equal(receipt.invocationId, requestId); assert.match(receipt.evidence, /not established/);
    const raw = await readFile(join(root, "intent-receipts", `${intentKey(intent)}.json`), "utf8"); assert.equal(raw.includes(server.accessToken), false);
    reject = true; await assert.rejects(dispatchPhysicalIntent(intent, { root }), /Work prohibits/);
    await assert.rejects(waitIntentReceipt(intent, at, { root, timeoutMs: 1000 }), /rejected/);
    await writeFile(join(root, "active.json"), JSON.stringify({ schema: "switchyard-active-endpoint/v1", pid: process.pid, url: "https://external.invalid/#access=" + server.accessToken }));
    await assert.rejects(dispatchPhysicalIntent(intent, { root }), /could not be verified/);
    assert.equal(seen.length, 2);
    assert.throws(() => closedIntent({ implementation: "shell", command: "anything" }), /closed intent/);
  } finally { server.closeAllConnections(); await new Promise((resolve) => server.close(resolve)); await rm(root, { recursive: true, force: true }); }
});

test("cold-start physical intent honors persisted Work selection before any UI bootstrap; caller compartment cannot redirect it", async () => {
  const root = await mkdtemp(join(tmpdir(), "switchyard-active-policy-")), credentials = new Map(); let effects = 0;
  const store = createSuiteStore({ root, secrets: { get: async (id, key) => credentials.get(`${id}:${key}`), set: async (id, key, value) => { credentials.set(`${id}:${key}`, value); } } });
  await store.initialize("personal"); await store.initialize("company", "work"); await store.selection("company");
  const suite = createSuite({ store, agents: { discovery: async () => [], close() {}, resume: async () => { effects++; } }, voice: { discovery: async () => ({ available: false }) }, hypr: async () => { effects++; throw new Error("No compositor effect expected"); } });
  try {
    await assert.rejects(suite.authorizeConnection(undefined, { implementation: "native-chatgpt.focus/v1" }), /prohibited/);
    await assert.rejects(suite.handle("/api/suite/intent", { implementation: "native-chatgpt.focus/v1", compartment: "personal" }), /prohibited/);
    assert.equal(effects, 0);
    assert.equal((await suite.handle("/api/suite/bootstrap")).activeCompartment, "company");
    await assert.rejects(suite.authorizeConnection("personal", { implementation: "native-chatgpt.focus/v1" }), /Select this workspace/);
  } finally { await suite.close(); await rm(root, { recursive: true, force: true }); }
});
