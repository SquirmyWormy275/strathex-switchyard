import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { createCopilot } from "./copilot.mjs";
import { createSuiteStore } from "./suite-store.mjs";

const tenantId = "11111111-1111-1111-1111-111111111111", clientId = "22222222-2222-2222-2222-222222222222", accountId = "33333333-3333-3333-3333-333333333333", remoteId = "44444444-4444-4444-4444-444444444444";
const plan = { schema: "sxsy-agentic-layout-plan/v1", profile: { schema: "sxsy-board-profile/v1", name: "Synthetic", layout: "one", controller: "unknown", keys: [{ id: "one", label: "A", matrix: [0, 0], x: 0, y: 0, baseKeycode: "KC_A" }] }, actions: [], study: null };
async function fixture(t) {
  const root = await mkdtemp(join(tmpdir(), "sx-copilot-pin-")), keys = new Map();
  t.after(() => rm(root, { recursive: true, force: true }));
  const store = createSuiteStore({ root, secrets: { get: async (c, p) => keys.get(c + ":" + p), set: async (c, p, v) => keys.set(c + ":" + p, v) } });
  await store.initialize("work");
  const credential = { tenantId, clientId, account: tenantId + ":" + accountId, accessToken: "SYNTHETIC_PINNED_ACCESS", refreshToken: "SYNTHETIC_REFRESH", expiresAt: Date.now() + 3600000 };
  await store.update("work", "synthetic-enroll", s => { s.mode = "managed-companion"; s.accounts = [credential.account]; });
  const setCredential = value => store.credential("work", "m365-token", JSON.stringify(value), { provider: "microsoft-365-copilot" }); await setCredential(credential);
  const calls = []; let hook = async () => {};
  const api = createCopilot({ store, fetcher: async (url, options) => {
    assert.ok(url.startsWith("https://graph.microsoft.com/beta/copilot/conversations")); assert.equal(options.headers.Authorization, "Bearer " + credential.accessToken); assert.equal(options.redirect, "error");
    calls.push(url); await hook(url);
    return new Response(JSON.stringify(url.endsWith("/chat") ? { id: remoteId, messages: [{ text: JSON.stringify({ reply: "Synthetic proposal only", summary: "No key changes", actions: [], steps: ["Review evidence"], roles: ["Reviewer"] }) }] } : { id: remoteId }));
  } });
  const seed = account => store.update("work", "synthetic-conversation", s => { s.conversations = [{ id: "owned-conversation", provider: "microsoft-365-copilot", sessionId: remoteId, updatedAt: Date.now(), ...(account === undefined ? {} : { account }), messages: [] }]; });
  return { store, credential, setCredential, calls, seed, hook: value => { hook = value; }, design: conversationId => api.design({ compartment: "work", plan, message: "Synthetic design request", conversationId }) };
}
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
