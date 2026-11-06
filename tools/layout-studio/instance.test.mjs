import test from "node:test";
import assert from "node:assert/strict";
import { randomBytes, createHmac, randomUUID } from "node:crypto";
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
test("signed editor metadata reaches only its closed read-only route and cannot carry effect fields or browser requests", async () => {
  let calls = 0; const selection = { compartment: "personal", ownerRequestId: randomUUID(), loadRequestId: randomUUID() };
  const suite = { async handle(path, body) { calls++; assert.equal(path, "/api/suite/coding/codex/owners/editor-target"); assert.deepEqual(body, selection); assert.equal(Object.isFrozen(body), true); return { metadataObserved: true, authorityGranted: false }; } };
  await serverFixture(async ({ endpoint, stops }) => {
    const origin = new URL(endpoint.url).origin, route = "/instance/v1/editor-target";
    const send = async (change = {}, headers = {}, destination = route) => {
      const raw = JSON.stringify({ schema: "switchyard-instance/v1", operation: "editorTarget", nonce: randomBytes(32).toString("base64url"), at: Date.now(), instanceId: endpoint.instance.id, build, selection, ...change });
      const signature = createHmac("sha256", token).update(`SWITCHYARD-INSTANCE-V1\nREQUEST\nPOST\n${route}\n`).update(raw).digest("hex");
      return fetch(origin + destination, { method: "POST", headers: { "Content-Type": "application/json", "X-Switchyard-Instance-Request": signature, ...headers }, body: raw });
    };
    const accepted = await send(); assert.equal(accepted.status, 200); const raw = await accepted.text();
    assert.equal(accepted.headers.get("x-switchyard-instance-response"), createHmac("sha256", token).update(`SWITCHYARD-INSTANCE-V1\nRESPONSE-200\nPOST\n${route}\n`).update(raw).digest("hex"));
    assert.equal(JSON.parse(raw).targetObservation.authorityGranted, false); assert.equal(calls, 1);
    for (const change of [{ selection: null }, { selection: [] }, { selection: { ...selection, prompt: "never" } }, { selection: { ...selection, ownerRequestId: "latest" } }, { selection: { ...selection, compartment: "../foreign" } }, { action: "load" }, { operation: "stop" }, { at: Date.now() - 11000 }, { build: "b".repeat(64) }]) assert.equal((await send(change)).status, 403);
    assert.equal((await send({}, { Origin: origin })).status, 403); assert.equal((await send({}, {}, "/instance/v1/stop")).status, 403);
    await assert.rejects(requestInstance(endpoint, { operation: "editorTarget" }), /Unsupported/);
    assert.equal(calls, 1); assert.equal(stops(), 0);
    await requestInstance(endpoint, { operation: "stop" }); assert.equal((await send()).status, 403); assert.equal(calls, 1);
  }, { suite, bridge: { close() {} } });
});
test("each signed editor authorization operation has its own closed route and fields; stop fences pending replies", async () => {
  const calls = [], selection = { compartment: "personal", ownerRequestId: randomUUID(), loadRequestId: randomUUID(), requestId: randomUUID(), editorId: randomUUID() };
  let gate, entered;
  const suite = { async handle(path, body) { calls.push({ path, body }); assert.ok(Object.isFrozen(body)); if (gate) { entered(); await gate; } return { terminalLaunched: false }; } };
  await serverFixture(async ({ endpoint, stops }) => {
    const origin = new URL(endpoint.url).origin;
    for (const action of ["review", "issue", "consume"]) {
      const route = "/instance/v1/editor-" + action, operation = "editor" + action[0].toUpperCase() + action.slice(1), selected = { ...selection, ...(action === "issue" ? { token: randomUUID() } : action === "consume" ? { permit: randomUUID() } : {}) };
      const send = async (change = {}, headers = {}, destination = route) => {
        const raw = JSON.stringify({ schema: "switchyard-instance/v1", operation, nonce: randomBytes(32).toString("base64url"), at: Date.now(), instanceId: endpoint.instance.id, build, selection: selected, ...change });
        const signature = createHmac("sha256", token).update(`SWITCHYARD-INSTANCE-V1\nREQUEST\nPOST\n${route}\n`).update(raw).digest("hex");
        return fetch(origin + destination, { method: "POST", headers: { "Content-Type": "application/json", "X-Switchyard-Instance-Request": signature, ...headers }, body: raw });
      };
      const accepted = await send(); assert.equal(accepted.status, 200); const raw = await accepted.text();
      assert.equal(accepted.headers.get("x-switchyard-instance-response"), createHmac("sha256", token).update(`SWITCHYARD-INSTANCE-V1\nRESPONSE-200\nPOST\n${route}\n`).update(raw).digest("hex"));
      assert.equal(JSON.parse(raw).editorAuthorization.terminalLaunched, false); assert.equal(calls.at(-1).path, "/api/suite/coding/codex/editor/" + action); assert.deepEqual(calls.at(-1).body, selected);
      const count = calls.length;
      for (const change of [{ selection: null }, { selection: { ...selected, editorId: "latest" } }, { selection: { ...selected, prompt: "never" } }, { selection: { ...selected, command: "never" } }, { selection: { ...selected, [action === "issue" ? "permit" : "token"]: randomUUID() } }, { operation: "editorTarget" }, { at: Date.now() - 11000 }]) assert.equal((await send(change)).status, 403);
      assert.equal((await send({}, { Origin: origin })).status, 403); assert.equal((await send({}, {}, "/instance/v1/editor-target")).status, 403); assert.equal(calls.length, count);
      await assert.rejects(requestInstance(endpoint, { operation }), /Unsupported/);
      if (action === "consume") {
        let release; gate = new Promise(r => { release = r; }); const ready = new Promise(r => { entered = r; }); const pending = send(); await ready;
        await requestInstance(endpoint, { operation: "stop" }); release(); assert.equal((await pending).status, 403); assert.equal((await send()).status, 403);
      }
    }
    assert.equal(stops(), 1);
  }, { suite, bridge: { close() {} } });
});

test("signed editor connections bind exact routes and peer fields, reject browser requests, and fence pending replies at stop", async () => {
  const calls=[], selection={compartment:'personal',requestId:randomUUID(),editorId:randomUUID(),ownerRequestId:randomUUID(),loadRequestId:randomUUID()};
  let gate,entered;
  const suite={async handle(path,body){calls.push({path,body});assert.ok(Object.isFrozen(body));if(body.peer)assert.ok(Object.isFrozen(body.peer));if(gate){entered();await gate;}return{authorityGranted:false};}};
  await serverFixture(async({endpoint})=>{
    const origin=new URL(endpoint.url).origin;
    for(const [suffix,operation] of [['open','editorConnectionOpen'],['pin-peer','editorConnectionPeer'],['observe','editorConnectionObserve'],['stop','editorConnectionStop'],['recover','editorConnectionRecover']]){
      const route='/instance/v1/editor-connection-'+suffix,selected={...selection,...(suffix==='pin-peer'?{peer:{pid:123,birth:'4',executable:'/synthetic/codex',executableSha256:'a'.repeat(64)}}:{})};
      const send=async(change={},headers={},destination=route)=>{
        const raw=JSON.stringify({schema:'switchyard-instance/v1',operation,nonce:randomBytes(32).toString('base64url'),at:Date.now(),instanceId:endpoint.instance.id,build,selection:selected,...change});
        const signature=createHmac('sha256',token).update(`SWITCHYARD-INSTANCE-V1\nREQUEST\nPOST\n${route}\n`).update(raw).digest('hex');
        return fetch(origin+destination,{method:'POST',headers:{'Content-Type':'application/json','X-Switchyard-Instance-Request':signature,...headers},body:raw});
      };
      const accepted=await send();assert.equal(accepted.status,200);const raw=await accepted.text();assert.equal(JSON.parse(raw).editorConnection.authorityGranted,false);
      assert.equal(accepted.headers.get('x-switchyard-instance-response'),createHmac('sha256',token).update(`SWITCHYARD-INSTANCE-V1\nRESPONSE-200\nPOST\n${route}\n`).update(raw).digest('hex'));
      assert.equal(calls.at(-1).path,'/api/suite/coding/codex/editor-connections/'+suffix);assert.deepEqual(calls.at(-1).body,selected);const count=calls.length;
      for(const change of [{selection:{...selected,prompt:'never'}},{selection:{...selected,requestId:'latest'}},{selection:{...selected,permit:randomUUID()}},{operation:'editorConsume'},{at:Date.now()-11000},{build:'b'.repeat(64)}])assert.equal((await send(change)).status,403);
      if(suffix==='pin-peer')for(const peer of [null,{...selected.peer,command:'never'},{...selected.peer,pid:0},{...selected.peer,birth:'latest'},{...selected.peer,executable:'relative'}])assert.equal((await send({selection:{...selected,peer}})).status,403);
      assert.equal((await send({},{Origin:origin})).status,403);assert.equal((await send({},{},'/instance/v1/editor-connection-foreign')).status,403);assert.equal(calls.length,count);
      if(suffix==='recover'){
        let release;gate=new Promise(r=>release=r);const ready=new Promise(r=>entered=r),pending=send();await ready;await requestInstance(endpoint,{operation:'stop'});release();assert.equal((await pending).status,403);assert.equal((await send()).status,403);
      }
    }
  },{suite,bridge:{close(){}}});
});
