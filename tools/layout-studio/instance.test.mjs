import test from "node:test";
import assert from "node:assert/strict";
import { randomBytes, createHmac } from "node:crypto";
import { createServer } from "node:http";
import { once } from "node:events";
import { createStudioServer } from "./serve.mjs";
import { newInstanceIdentity, requestInstance } from "./instance.mjs";
const build = "a".repeat(64), token = randomBytes(32).toString("base64url");
async function serverFixture(fn, options = {}) {
  let stops = 0; const identity = newInstanceIdentity(build), server = createStudioServer({ token, instance: identity, onApplicationStop: () => { stops++; }, ...options });
  server.listen(0, "127.0.0.1"); await once(server, "listening");
  const endpoint = { schema: "switchyard-active-endpoint/v1", instance: identity, pid: process.pid, url: `http://127.0.0.1:${server.address().port}/#access=${token}` };
  try { await fn({ server, endpoint, stops: () => stops }); } finally { server.closeAllConnections(); await new Promise((r) => server.close(r)); }
}
test("local instance probes mutually bind build, process, nonce and origin; repeated stops invoke owned cleanup once", () => serverFixture(async ({ endpoint, stops }) => {
  const proof = await requestInstance(endpoint); assert.equal(proof.authenticated, true); assert.equal(proof.status, "ready"); assert.equal(proof.pid, process.pid);
  const stopped = await Promise.all([requestInstance(endpoint, { operation: "stop" }), requestInstance(endpoint, { operation: "stop" })]);
  assert.ok(stopped.every((r) => r.status === "stopping")); await new Promise((r) => setImmediate(r)); assert.equal(stops(), 1);
  assert.equal((await requestInstance(endpoint)).status, "stopping");
}));
test("unverified replacement listeners never receive the browser bearer or token, and unsigned responses are rejected", async () => {
  let observed; const server = createServer(async (req, res) => { const chunks = []; for await (const b of req) chunks.push(b); observed = { headers: req.headers, body: Buffer.concat(chunks).toString("utf8") }; res.writeHead(200, { "Content-Type": "application/json" }); res.end("{}"); });
  server.listen(0, "127.0.0.1"); await once(server, "listening");
  try {
    const endpoint = { schema: "switchyard-active-endpoint/v1", instance: newInstanceIdentity(build), pid: process.pid, url: `http://127.0.0.1:${server.address().port}/#access=${token}` };
    await assert.rejects(requestInstance(endpoint), /did not authenticate/); assert.equal(observed.headers.authorization, undefined);
    assert.equal(JSON.stringify(observed).includes(token), false); assert.match(observed.headers["x-switchyard-instance-request"], /^[a-f0-9]{64}$/);
  } finally { server.closeAllConnections(); await new Promise((r) => server.close(r)); }
});
test("instance requests reject wrong build, token, PID, route, stale time and browser origins before any stop", () => serverFixture(async ({ endpoint, stops }) => {
  await assert.rejects(requestInstance({ ...endpoint, instance: { ...endpoint.instance, build: "b".repeat(64) } }), /authenticate/);
  await assert.rejects(requestInstance({ ...endpoint, url: endpoint.url.replace(token, randomBytes(32).toString("base64url")) }), /authenticate/);
  await assert.rejects(requestInstance({ ...endpoint, pid: process.pid + 1 }), /exact request/);
  await assert.rejects(requestInstance(endpoint, { now: () => Date.now() - 11000, operation: "stop" }), /authenticate/);
  const origin = new URL(endpoint.url).origin, route = "/instance/v1/probe", raw = JSON.stringify({ schema: "switchyard-instance/v1", operation: "probe", nonce: randomBytes(32).toString("base64url"), at: Date.now(), instanceId: endpoint.instance.id, build });
  const signature = createHmac("sha256", token).update(`SWITCHYARD-INSTANCE-V1\nREQUEST\nPOST\n${route}\n`).update(raw).digest("hex");
  const headers = { "Content-Type": "application/json", "X-Switchyard-Instance-Request": signature };
  assert.equal((await fetch(origin + "/instance/v1/stop", { method: "POST", headers, body: raw })).status, 403);
  assert.equal((await fetch(origin + route, { method: "POST", headers: { ...headers, Origin: origin }, body: raw })).status, 403);
  assert.equal(stops(), 0);
}));
test("legacy, redirected and malformed saved endpoints cannot enter managed application control", () => serverFixture(async ({ endpoint }) => {
  for (const changed of [{ instance: undefined }, { schema: "future" }, { url: endpoint.url.replace("127.0.0.1", "localhost") }, { url: endpoint.url.replace("/#", "/redirect#") }]) await assert.rejects(requestInstance({ ...endpoint, ...changed }), /supported authenticated/);
}));
