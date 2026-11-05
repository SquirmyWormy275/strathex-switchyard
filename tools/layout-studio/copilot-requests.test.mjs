import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { copilotFixture, plan, remoteId } from "./test-support/copilot-fixture.mjs";
import { createCopilot } from "./copilot.mjs";
import { createSuite } from "./suite.mjs";
import { createStudioServer } from "./serve.mjs";
import { once } from "node:events";
const deferred = () => { let resolve; const promise = new Promise(done => { resolve = done; }); return { promise, resolve }; };

test("an explicit request replays only its recorded response and refuses different content without another POST", async t => {
  const f = await copilotFixture(t), requestId = randomUUID(), first = await f.design(undefined, requestId), repeated = await f.design(undefined, requestId);
  assert.equal(repeated.reused, true); assert.equal(repeated.modelPromptSubmitted, false); assert.equal(repeated.operationId, first.operationId); assert.equal(f.calls.length, 2);
  await assert.rejects(f.api.design({ compartment: "work", plan, message: "Different synthetic request", requestId }), /different content/); assert.equal(f.calls.length, 2);
  const rows = await f.api.listRequests("work"); assert.equal(rows.length, 1); assert.equal(rows[0].status, "completed");
  const metadata = JSON.stringify((await f.store.snapshot("work")).copilotRequests); for (const privateText of ["Synthetic design request", "SYNTHETIC_PINNED_ACCESS", "SYNTHETIC_REFRESH"]) assert.equal(metadata.includes(privateText), false);
});
test("frozen-client duplicate creation and continuation reuse exact recorded replies rather than create or submit again", async t => {
  const f = await copilotFixture(t), first = await f.design(), duplicate = await f.design(); assert.equal(duplicate.operationId, first.operationId); assert.equal(f.calls.length, 2);
  const next = await f.design(first.conversationId), repeated = await f.design(first.conversationId); assert.equal(next.operationId, repeated.operationId); assert.equal(f.calls.length, 3); assert.equal((await f.store.snapshot("work")).conversations[0].messages.length, 4);
});
test("separate service instances serialize the account lifetime and an actual simultaneous duplicate emits one creation and one chat", async t => {
  const f = await copilotFixture(t), other = createCopilot({ store: f.store, fetcher: f.transport });
  try { const [a, b] = await Promise.all([f.design(), other.design({ compartment: "work", plan, message: "Synthetic design request" })]); assert.equal(a.operationId, b.operationId); assert.equal(f.calls.length, 2); }
  finally { assert.equal((await other.close()).localRequestsSettled, true); }
});
test("lost creation acknowledgement stays unresolved across a new service instance and is never retried", async t => {
  const f = await copilotFixture(t); f.hook(async () => { throw Error("Synthetic lost remote acknowledgement"); }); await assert.rejects(f.design(), /lost remote acknowledgement/);
  const row = (await f.api.listRequests("work"))[0]; assert.equal(row.status, "outcome-unconfirmed"); assert.equal(row.phase, "creating"); assert.equal(row.sessionId, null);
  let effects = 0; const restarted = createCopilot({ store: f.store, fetcher: async () => { effects++; throw Error("NEVER_RETRY"); } });
  try { await assert.rejects(restarted.design({ compartment: "work", plan, message: "Another request must wait" }), /unresolved outcome/); assert.equal(effects, 0); }
  finally { await restarted.close(); }
});
test("failure to persist the created remote identity sends no chat and preserves the original unconfirmed creation", async t => {
  const f = await copilotFixture(t), update = f.store.update.bind(f.store); let fail = true;
  f.store.update = (...args) => { if (fail && args[1] === "m365-request-created") { fail = false; throw Error("Synthetic remote identity persistence lost"); } return update(...args); };
  await assert.rejects(f.design(), /identity persistence lost/); assert.equal(f.calls.length, 1);
  const row = (await f.api.listRequests("work"))[0]; assert.equal(row.phase, "creating"); assert.equal(row.status, "outcome-unconfirmed"); assert.equal(row.sessionId, null); assert.equal((await f.store.snapshot("work")).conversations.length, 0);
});
test("loss of the original kernel lease after the delivery marker still refuses before the network send", async t => {
  const f = await copilotFixture(t), resource = f.store.withResourceLock.bind(f.store), update = f.store.update.bind(f.store); let alive = true;
  f.store.withResourceLock = (kind, id, fn) => resource(kind, id, lease => fn({ assert() { lease.assert(); if (!alive) throw Error("Synthetic original lease lost"); } }));
  f.store.update = async (...args) => { const value = await update(...args); if (args[1] === "m365-request-delivery") alive = false; return value; };
  await assert.rejects(f.design(), /original lease lost/); assert.equal(f.calls.length, 0); assert.equal((await f.api.listRequests("work"))[0].status, "outcome-unconfirmed");
});
test("a changed durable phase cannot authorize an old writer even while its original kernel lease remains held", async t => {
  const f = await copilotFixture(t), update = f.store.update.bind(f.store); let originalUpdatedAt;
  f.store.update = async (...args) => {
    const value = await update(...args);
    if (args[1] === "m365-request-delivery") await update("work", "synthetic-original-outcome-change", state => { const row = state.copilotRequests[0]; row.status = "reviewed-unconfirmed"; row.originalOutcome = "outcome-unconfirmed"; row.reviewedAt = row.updatedAt; originalUpdatedAt = row.updatedAt; });
    return value;
  };
  await assert.rejects(f.design(), /owner or delivery phase changed/); assert.equal(f.calls.length, 0);
  const row = (await f.api.listRequests("work"))[0]; assert.equal(row.status, "reviewed-unconfirmed"); assert.equal(row.updatedAt, originalUpdatedAt);
});
test("lost chat acknowledgement retains the verified original conversation identity and blocks another delivery", async t => {
  const f = await copilotFixture(t); f.hook(async url => { if (url.endsWith("/chat")) throw Error("Synthetic lost chat acknowledgement"); });
  await assert.rejects(f.design(), /lost chat acknowledgement/); const row = (await f.api.listRequests("work"))[0]; assert.equal(row.phase, "submitting"); assert.equal(row.status, "outcome-unconfirmed"); assert.equal(row.sessionId, remoteId);
  await assert.rejects(f.design(), /unresolved outcome/); assert.equal(f.calls.length, 2);
});
test("outcome review requires actual idle kernel ownership, preserves remote uncertainty and never replays a consumed approval", async t => {
  const f = await copilotFixture(t), entered = deferred(), release = deferred(); f.hook(async () => { entered.resolve(); await release.promise; });
  const pending = assert.rejects(f.design(), /stopped/); await entered.promise; const id = (await f.api.listRequests("work"))[0].id;
  await assert.rejects(f.api.reviewRequest("work", id), /has not settled/); assert.equal((await f.api.stopCompartment("work")).localRequestsSettled, false); await assert.rejects(f.api.reviewRequest("work", id), /has not settled/);
  release.resolve(); await pending; const review = await f.api.reviewRequest("work", id), resolved = await f.api.resolveRequest("work", { id, token: review.confirmation.token });
  assert.equal(resolved.status, "reviewed-unconfirmed"); assert.equal(resolved.originalOutcome, "outcome-unconfirmed"); assert.equal(resolved.remoteCancellationVerified, false); assert.equal(resolved.modelPromptSubmitted, false); assert.equal(f.calls.length, 1);
  await assert.rejects(f.api.resolveRequest("work", { id, token: review.confirmation.token }), /already reviewed/);
  f.hook(async () => {}); await f.design(); assert.equal(f.calls.length, 3); assert.equal((await f.api.listRequests("work"))[0].status, "reviewed-unconfirmed");
});
test("changed policy invalidates the exact one-use review and keyboard-only review itself performs no Microsoft request", async t => {
  const f = await copilotFixture(t); f.hook(async () => { throw Error("Synthetic uncertain creation"); }); await assert.rejects(f.design()); const id = (await f.api.listRequests("work"))[0].id, review = await f.api.reviewRequest("work", id);
  await f.store.update("work", "synthetic-mode-change", s => { s.mode = "keyboard-only"; });
  await assert.rejects(f.api.resolveRequest("work", { id, token: review.confirmation.token })); assert.equal((await f.api.listRequests("work"))[0].status, "outcome-unconfirmed");
  const fresh = await f.api.reviewRequest("work", id); assert.equal((await f.api.resolveRequest("work", { id, token: fresh.confirmation.token })).status, "reviewed-unconfirmed"); assert.equal(f.calls.length, 1);
  await assert.rejects(f.api.resolveRequest("work", { id, token: randomUUID(), replay: true }), /only the exact/);
});
test("retired explicit request identities remain tombstoned and cannot be reused after terminal detail retirement", async t => {
  const f = await copilotFixture(t), requestId = randomUUID(); await f.design(undefined, requestId); await f.store.update("work", "synthetic-detail-retirement", s => { s.copilotRequests = []; });
  await assert.rejects(f.design(undefined, requestId), /retired/); assert.equal(f.calls.length, 2); assert.equal(Object.keys((await f.store.snapshot("work")).copilotRequestTombstones).length, 1);
});
test("unresolved delivery facts survive retention clocks and block even credential refresh before another request", async t => {
  let clock = Date.now(); const f = await copilotFixture(t, { now: () => clock }); f.hook(async () => { throw Error("Synthetic uncertain creation"); }); await assert.rejects(f.design());
  clock += 366 * 86400000; await f.store.enforceRetention("work"); await assert.rejects(f.design(), /unresolved outcome/); assert.equal(f.calls.length, 1); assert.equal((await f.api.listRequests("work"))[0].status, "outcome-unconfirmed");
});
test("GUID case changes cannot bypass the same-account unresolved-delivery barrier", async t => {
  const f = await copilotFixture(t), tenantId = "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa", subjectId = "cccccccc-cccc-cccc-cccc-cccccccccccc";
  const original = { ...f.credential, tenantId, clientId: "bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb", account: tenantId + ":" + subjectId };
  await f.setCredential(original); await f.store.update("work", "synthetic-account-binding", s => { s.accounts = [original.account]; }); f.hook(async () => { throw Error("Synthetic uncertain creation"); }); await assert.rejects(f.design());
  const changed = { ...original, tenantId: original.tenantId.toUpperCase(), clientId: original.clientId.toUpperCase(), account: original.account.toUpperCase() }; await f.setCredential(changed); await f.store.update("work", "synthetic-account-case", s => { s.accounts = [changed.account]; });
  await assert.rejects(f.design(), /unresolved outcome/); assert.equal(f.calls.length, 1);
});
test("a full explicit tombstone inventory refuses new delivery without discarding any original request identity", async t => {
  const f = await copilotFixture(t); await f.store.update("work", "synthetic-tombstone-limit", s => { s.copilotRequestTombstones = Object.fromEntries(Array.from({ length: 4096 }, (_, i) => ["00000000-0000-4000-8000-" + i.toString(16).padStart(12, "0"), "a".repeat(64)])); });
  await assert.rejects(f.design(undefined, randomUUID()), /inventory is full/); assert.equal(f.calls.length, 0); assert.equal(Object.keys((await f.store.snapshot("work")).copilotRequestTombstones).length, 4096);
});
test("unknown original record fields refuse inspection instead of being normalized, dropped or accepted", async t => {
  const f = await copilotFixture(t); f.hook(async () => { throw Error("Synthetic uncertain creation"); }); await assert.rejects(f.design());
  await f.store.update("work", "synthetic-record-drift", s => { s.copilotRequests[0].foreignField = "PRESERVE_ORIGINAL"; }); const before = JSON.stringify((await f.store.snapshot("work")).copilotRequests);
  await assert.rejects(f.api.listRequests("work"), /unfamiliar/); assert.equal(JSON.stringify((await f.store.snapshot("work")).copilotRequests), before); assert.equal(f.calls.length, 1);
});
test("contradictory phase, outcome, response and review witnesses cannot become accepted original delivery facts", async t => {
  const f = await copilotFixture(t); await f.design(); const original = (await f.store.snapshot("work")).copilotRequests[0];
  for (const mutate of [
    row => { row.phase = "reserved"; }, row => { row.originalOutcome = "not-started"; }, row => { row.reviewedAt = row.createdAt; },
    row => { row.status = "reserved"; row.phase = "reserved"; },
    row => { row.status = "creating"; row.phase = "creating"; row.responseDigest = null; },
    row => { row.status = "outcome-unconfirmed"; row.phase = "submitting"; row.attempted = false; row.responseDigest = null; row.originalOutcome = "outcome-unconfirmed"; },
    row => { row.status = "outcome-unconfirmed"; row.phase = "created"; row.sessionId = null; row.responseDigest = null; row.originalOutcome = "outcome-unconfirmed"; },
    row => { row.status = "reviewed-unconfirmed"; row.responseDigest = null; row.originalOutcome = "outcome-unconfirmed"; }
  ]) {
    const changed = structuredClone(original); mutate(changed); await f.store.update("work", "synthetic-contradictory-facts", state => { state.copilotRequests = [changed]; });
    await assert.rejects(f.api.listRequests("work"), /contradictory/); assert.deepEqual((await f.store.snapshot("work")).copilotRequests, [changed]);
  }
  assert.equal(f.calls.length, 2);
});
test("authenticated Suite routes expose only request metadata, hide internal journals and refuse replay or cross-workspace fields", async t => {
  const f = await copilotFixture(t); f.hook(async () => { throw Error("Synthetic uncertain creation"); }); await assert.rejects(f.design(undefined, randomUUID()));
  const suite = createSuite({ store: f.store, copilot: f.api, agents: { discovery: async () => [], close() {} }, voice: { discovery: async () => ({ available: false }) }, foreground: { stopCompartment: async () => ({ stopped: true }), close() {} } });
  const token = "q".repeat(43), server = createStudioServer({ suite, bridge: { close() {} }, token }); server.listen(0, "127.0.0.1"); await once(server, "listening");
  const origin = "http://127.0.0.1:" + server.address().port, api = async (path, body, authenticated = true) => { const response = await fetch(origin + "/api/suite/" + path, { method: "POST", headers: { Origin: origin, "Content-Type": "application/json", ...(authenticated ? { Authorization: "Bearer " + token } : {}) }, body: JSON.stringify(body) }); return { status: response.status, body: await response.json() }; };
  try {
    assert.equal((await api("copilot/requests", { compartment: "work" }, false)).status, 401);
    assert.equal((await api("compartment/select", { compartment: "work" })).status, 200);
    const list = await api("copilot/requests", { compartment: "work" }); assert.equal(list.status, 200); assert.equal(list.body.length, 1);
    const snapshot = await api("snapshot", { compartment: "work" }); assert.equal(snapshot.status, 200); assert.equal(Object.hasOwn(snapshot.body, "copilotRequests"), false); assert.equal(Object.hasOwn(snapshot.body, "copilotRequestTombstones"), false);
    for (const value of ["Synthetic design request", "SYNTHETIC_PINNED_ACCESS", "SYNTHETIC_REFRESH"]) assert.equal(JSON.stringify(list.body).includes(value), false);
    const id = list.body[0].id; assert.notEqual((await api("copilot/requests/review", { compartment: "personal", id })).status, 200);
    const reviewed = await api("copilot/requests/review", { compartment: "work", id }); assert.equal(reviewed.status, 200);
    assert.notEqual((await api("copilot/requests/resolve", { compartment: "work", id, token: reviewed.body.confirmation.token, replay: true })).status, 200);
    const resolved = await api("copilot/requests/resolve", { compartment: "work", id, token: reviewed.body.confirmation.token }); assert.equal(resolved.status, 200); assert.equal(resolved.body.status, "reviewed-unconfirmed"); assert.equal(resolved.body.remoteCancellationVerified, false); assert.equal(f.calls.length, 1);
  } finally { await new Promise(resolve => server.close(resolve)); await server.cleanup(); }
});
