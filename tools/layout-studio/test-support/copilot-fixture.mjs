import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { createCopilot } from "../copilot.mjs";
import { createSuiteStore } from "../suite-store.mjs";

export const tenantId = "11111111-1111-1111-1111-111111111111", clientId = "22222222-2222-2222-2222-222222222222", accountId = "33333333-3333-3333-3333-333333333333", remoteId = "44444444-4444-4444-4444-444444444444";
export const plan = { schema: "sxsy-agentic-layout-plan/v1", profile: { schema: "sxsy-board-profile/v1", name: "Synthetic", layout: "one", controller: "unknown", keys: [{ id: "one", label: "A", matrix: [0, 0], x: 0, y: 0, baseKeycode: "KC_A" }] }, actions: [], study: null };
export async function copilotFixture(t, options = {}) {
  const root = await mkdtemp(join(tmpdir(), "sx-copilot-pin-")), keys = new Map();
  let api; t.after(async () => { if (api) assert.equal((await api.close()).localRequestsSettled, true); await rm(root, { recursive: true, force: true }); });
  const store = createSuiteStore({ root, secrets: { get: async (c, p) => keys.get(c + ":" + p), set: async (c, p, v) => keys.set(c + ":" + p, v) } });
  await store.initialize("work");
  const credential = { tenantId, clientId, account: tenantId + ":" + accountId, accessToken: "SYNTHETIC_PINNED_ACCESS", refreshToken: "SYNTHETIC_REFRESH", expiresAt: Date.now() + 3600000 };
  await store.update("work", "synthetic-enroll", s => { s.mode = "managed-companion"; s.accounts = [credential.account]; });
  const setCredential = value => store.credential("work", "m365-token", JSON.stringify(value), { provider: "microsoft-365-copilot" }); await setCredential(credential);
  const calls = []; let hook = async () => {};
  const transport = async (url, request) => {
    if (options.fetcher) { calls.push(url); return options.fetcher(url, request); }
    assert.ok(url.startsWith("https://graph.microsoft.com/beta/copilot/conversations")); assert.equal(request.headers.Authorization, "Bearer " + credential.accessToken); assert.equal(request.redirect, "error");
    calls.push(url); await hook(url, request);
    return new Response(JSON.stringify(url.endsWith("/chat") ? { id: remoteId, messages: [{ text: JSON.stringify({ reply: "Synthetic proposal only", summary: "No key changes", actions: [], steps: ["Review evidence"], roles: ["Reviewer"] }) }] } : { id: remoteId }));
  };
  api = createCopilot({ store, ...options, fetcher: transport });
  const seed = account => store.update("work", "synthetic-conversation", s => { s.conversations = [{ id: "owned-conversation", provider: "microsoft-365-copilot", sessionId: remoteId, updatedAt: Date.now(), ...(account === undefined ? {} : { account }), messages: [] }]; });
  return { store, api, transport, credential, setCredential, calls, seed, hook: value => { hook = value; }, design: (conversationId, requestId) => api.design({ compartment: "work", plan, message: "Synthetic design request", conversationId, requestId }) };
}
