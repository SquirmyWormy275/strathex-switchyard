import test from "node:test";
import assert from "node:assert/strict";
import { copilotFixture, tenantId, clientId, remoteId, plan } from "./test-support/copilot-fixture.mjs";
import { createCopilot } from "./copilot.mjs";
import { createSuite } from "./suite.mjs";
const deferred = () => { let resolve; const promise = new Promise(done => { resolve = done; }); return { promise, resolve }; };

test("stopping an owned request aborts cooperative transport and never sends the subsequent chat", async t => {
  const f = await copilotFixture(t), entered = deferred(); let signal;
  f.hook(async (_, options) => { signal = options.signal; entered.resolve(); await new Promise((_, reject) => signal.addEventListener("abort", () => reject(signal.reason), { once: true })); });
  const pending = assert.rejects(f.design(), /abort|stopped/i); await entered.promise;
  const result = await f.api.stopCompartment("work"); await pending;
  assert.equal(signal.aborted, true); assert.equal(result.localDeliveryBlocked, true); assert.equal(result.localRequestsSettled, true); assert.equal(result.remoteCancellationVerified, false);
  assert.equal(f.calls.length, 1); assert.equal((await f.store.snapshot("work")).conversations.length, 0);
});
test("late abort-ignoring transport cannot publish or follow up; the next generation preserves its unresolved delivery until review", async t => {
  const f = await copilotFixture(t), entered = deferred(), release = deferred(); f.hook(async () => { entered.resolve(); await release.promise; });
  const pending = assert.rejects(f.design(), /stopped/); await entered.promise;
  const stopped = await f.api.stopCompartment("work"); assert.equal(stopped.localRequestsSettled, false); assert.equal(stopped.remoteCancellationVerified, false);
  release.resolve(); await pending; assert.equal(f.calls.length, 1); assert.equal((await f.store.snapshot("work")).conversations.length, 0);
  f.hook(async () => {}); await assert.rejects(f.design(), /unresolved outcome/); assert.equal(f.calls.length, 1);
  const id = (await f.api.listRequests("work"))[0].id, review = await f.api.reviewRequest("work", id); await f.api.resolveRequest("work", { id, token: review.confirmation.token });
  assert.equal((await f.design()).sessionId, remoteId); assert.equal(f.calls.length, 3);
});
test("cancellation during a partially read body cannot turn a late body into an accepted conversation", async t => {
  const entered = deferred(), release = deferred(); let pulls = 0;
  const f = await copilotFixture(t, { fetcher: async () => new Response(new ReadableStream({ async pull(controller) {
    if (++pulls === 1) controller.enqueue(Buffer.from('{"id":"'));
    else { entered.resolve(); await release.promise; controller.enqueue(Buffer.from(remoteId + '"}')); controller.close(); }
  } })) });
  const pending = assert.rejects(f.design(), /stopped/); await entered.promise;
  assert.equal((await f.api.stopCompartment("work")).remoteCancellationVerified, false); release.resolve(); await pending;
  assert.equal(f.calls.length, 1); assert.equal((await f.store.snapshot("work")).conversations.length, 0);
});
test("a newer deliberate sign-in invalidates an older unfinished device-code request", async t => {
  const entered = deferred(), release = deferred(); let count = 0, firstSignal;
  const f = await copilotFixture(t, { fetcher: async (_, options) => {
    if (++count === 1) { firstSignal = options.signal; entered.resolve(); await release.promise; }
    return new Response(JSON.stringify({ device_code: "SYNTHETIC_DEVICE_" + count, user_code: "EXAMPLE", verification_uri: "https://microsoft.com/devicelogin", interval: 5, expires_in: 900 }));
  } });
  const first = assert.rejects(f.api.beginLogin("work", { tenantId, clientId, approved: true }), /stopped/); await entered.promise;
  const second = await f.api.beginLogin("work", { tenantId, clientId, approved: true }); assert.equal(firstSignal.aborted, true); release.resolve(); await first;
  assert.equal((await f.api.pollLogin("work", second.loginId)).status, "pending"); await f.api.close(); await assert.rejects(f.api.pollLogin("work", second.loginId), /expired/);
});
test("stopping token polling stores no late credential or account and makes the device-code session unusable", async t => {
  const entered = deferred(); let clock = 100000;
  const f = await copilotFixture(t, { now: () => clock, fetcher: async (url, options) => {
    if (url.endsWith("/devicecode")) return new Response(JSON.stringify({ device_code: "SYNTHETIC", user_code: "EXAMPLE", verification_uri: "https://microsoft.com/devicelogin", interval: 5, expires_in: 900 }));
    assert.ok(url.endsWith("/token")); entered.resolve(); return new Promise((_, reject) => options.signal.addEventListener("abort", () => reject(options.signal.reason), { once: true }));
  } });
  const original = await f.store.credential("work", "m365-token", undefined, { provider: "microsoft-365-copilot" });
  const login = await f.api.beginLogin("work", { tenantId, clientId, approved: true }); clock += 6000;
  const pending = assert.rejects(f.api.pollLogin("work", login.loginId), /abort|stopped/i); await entered.promise; await f.api.stopCompartment("work"); await pending;
  assert.equal(await f.store.credential("work", "m365-token", undefined, { provider: "microsoft-365-copilot" }), original); await assert.rejects(f.api.pollLogin("work", login.loginId), /expired/);
});
test("fresh workspace policy readback rejects a returned body even when no explicit stop was called", async t => {
  let active = true; const f = await copilotFixture(t, { isActive: async () => active }); f.hook(async () => { active = false; });
  await assert.rejects(f.design(), /no longer active/); assert.equal(f.calls.length, 1); assert.equal((await f.store.snapshot("work")).conversations.length, 0);
});
test("exact sign-in cancellation while policy authorization is pending prevents later token exchange", async t => {
  let clock = Date.now();
  const f = await copilotFixture(t, { now: () => clock, fetcher: async () => new Response(JSON.stringify({ device_code: "SYNTHETIC", user_code: "EXAMPLE", verification_uri: "https://microsoft.com/devicelogin", interval: 5, expires_in: 900 })) });
  const login = await f.api.beginLogin("work", { tenantId, clientId, approved: true }); clock += 6000;
  const authorize = f.store.authorize.bind(f.store); let release, paused = false;
  f.store.authorize = async (...args) => { const result = await authorize(...args); if (!paused) { paused = true; await new Promise(resolve => { release = resolve; }); } return result; };
  const pending = assert.rejects(f.api.pollLogin("work", login.loginId), /stopped/);
  try {
    const deadline = Date.now() + 2000;
    while (!release) { if (Date.now() >= deadline) throw Error("Original policy authorization did not enter"); await new Promise(resolve => setTimeout(resolve, 5)); }
    const stopped = await f.api.cancelLogin("work", login.loginId); assert.equal(stopped.localRequestsSettled, false);
    release(); await pending; assert.equal(f.calls.length, 1); assert.equal((await f.store.snapshot("work")).copilotAccount, undefined);
  } finally { release?.(); f.store.authorize = authorize; await pending; }
});
test("a stop after private history persistence cannot return success or pretend the already received remote reply was undone", async t => {
  const f = await copilotFixture(t), update = f.store.update.bind(f.store); let stopped;
  f.store.update = async (...args) => { const value = await update(...args); if (args[1] === "m365-design") stopped = await f.api.stopCompartment("work"); return value; };
  await assert.rejects(f.design(), /stopped/);
  assert.equal(stopped.localRequestsSettled, false); assert.equal(stopped.remoteCancellationVerified, false); assert.equal(f.calls.length, 2);
  const state = await f.store.snapshot("work"); assert.equal(state.conversations.length, 1); assert.equal(state.conversations[0].account, f.credential.account); assert.equal(state.profile, null);
});
for (const change of ["keyboard-only", "workspace", "shutdown"]) test(`the actual Suite ${change} boundary aborts its owned Copilot request and rejects late delivery`, async t => {
  const f = await copilotFixture(t), entered = deferred(); let signal;
  f.hook(async (_, options) => { signal = options.signal; entered.resolve(); await new Promise((_, reject) => signal.addEventListener("abort", () => reject(signal.reason), { once: true })); });
  const suite = createSuite({ store: f.store, copilotFactory: options => createCopilot({ ...options, fetcher: f.transport }), agents: { discovery: async () => [], close() {} }, voice: { discovery: async () => ({ available: false }) }, foreground: { stopCompartment: async () => ({ stopped: true }), close() {} } });
  try {
    await suite.handle("/api/suite/bootstrap"); await suite.handle("/api/suite/compartment/select", { compartment: "work" });
    const pending = assert.rejects(suite.handle("/api/suite/design", { compartment: "work", provider: "microsoft-365-copilot", message: "Synthetic design request", plan }), /abort|stopped/i); await entered.promise;
    if (change === "keyboard-only") await suite.handle("/api/suite/mode", { compartment: "work", mode: "keyboard-only" });
    else if (change === "workspace") await suite.handle("/api/suite/compartment/select", { compartment: "personal" });
    else await suite.close();
    await pending; assert.equal(signal.aborted, true); assert.equal(f.calls.length, 1); assert.equal((await f.store.snapshot("work")).conversations.length, 0);
  } finally { await suite.close(); }
});
