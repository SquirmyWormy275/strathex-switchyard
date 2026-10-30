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
    assert.equal(result.status, "queued"); assert.deepEqual(seen[0].body, closedIntent(intent)); assert.equal(seen[0].headers.origin, new URL(url).origin);
    assert.equal(seen[0].headers.authorization, `Bearer ${server.accessToken}`);
    const receipt = await waitIntentReceipt(intent, at, { root, timeoutMs: 1000 });
    assert.equal(receipt.status, "accepted"); assert.match(receipt.evidence, /not established/);
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
