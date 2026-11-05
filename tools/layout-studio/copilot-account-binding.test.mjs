import test from "node:test";
import assert from "node:assert/strict";
import { copilotFixture as fixture, tenantId, accountId, remoteId } from "./test-support/copilot-fixture.mjs";

test("an existing Copilot conversation cannot be addressed with a different or absent stored account binding", async t => {
  const f = await fixture(t);
  for (const account of [tenantId + ":55555555-5555-5555-5555-555555555555", undefined]) { await f.seed(account); await assert.rejects(f.design("owned-conversation"), /different or unverified account/); }
  assert.equal(f.calls.length, 0); assert.equal((await f.store.snapshot("work")).conversations[0].messages.length, 0);
});
test("credential replacement after remote creation prevents chat submission under either old or new credentials", async t => {
  const f = await fixture(t); f.hook(() => f.setCredential({ ...f.credential, accessToken: "SYNTHETIC_REPLACEMENT" }));
  await assert.rejects(f.design(), /pinned Microsoft sign-in changed/); assert.equal(f.calls.length, 1); assert.equal(f.calls[0].endsWith("/conversations"), true); assert.equal((await f.store.snapshot("work")).conversations.length, 0);
});
test("an in-flight reply under a replaced credential is not accepted into the old conversation", async t => {
  const f = await fixture(t); await f.seed(f.credential.account); f.hook(() => f.setCredential({ ...f.credential, accessToken: "SYNTHETIC_REPLACEMENT" }));
  await assert.rejects(f.design("owned-conversation"), /pinned Microsoft sign-in changed/); assert.equal(f.calls.length, 1); assert.equal((await f.store.snapshot("work")).conversations[0].messages.length, 0);
});
test("the same pinned account continues its exact conversation while changed final binding cannot be overwritten", async t => {
  const f = await fixture(t), result = await f.design(); assert.equal(result.sessionId, remoteId); await f.design(result.conversationId); assert.equal(f.calls.length, 3); assert.equal(f.calls.filter(url => url.endsWith("/conversations")).length, 1);
  const update = f.store.update.bind(f.store); f.store.update = async (c, action, fn, options) => {
    if (action === "m365-design") await update(c, "synthetic-binding-drift", s => { s.conversations[0].sessionId = "66666666-6666-6666-6666-666666666666"; });
    return update(c, action, fn, options);
  };
  await assert.rejects(f.design(result.conversationId), /binding changed/); assert.equal((await f.store.snapshot("work")).conversations[0].messages.length, 4);
});
test("malformed local credential identities and expiry refuse before any Graph request", async t => {
  const f = await fixture(t);
  for (const changed of [{ account: "unbound" }, { account: "77777777-7777-7777-7777-777777777777:" + accountId }, { accessToken: "" }, { refreshToken: [] }, { expiresAt: null }, { unknown: "NEVER_ROUTE" }]) {
    await f.setCredential({ ...f.credential, ...changed }); await assert.rejects(f.design(), /credential binding is invalid/);
  }
  assert.equal(f.calls.length, 0);
});
