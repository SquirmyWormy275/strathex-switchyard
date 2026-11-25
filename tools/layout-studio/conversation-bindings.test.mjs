import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { createAgentService } from "./agents.mjs";
import { createSuiteStore } from "./suite-store.mjs";
import { createSuite } from "./suite.mjs";

async function fixture(fn, provider = "codex") {
  const root = await mkdtemp(join(tmpdir(), "switchyard-legacy-binding-")), keys = new Map(), calls = [];
  const store = createSuiteStore({ root: join(root, "state"), secrets: { get: async (c, p) => keys.get(`${c}:${p}`), set: async (c, p, v) => keys.set(`${c}:${p}`, v) } });
  for (const c of ["personal", "other"]) { await store.initialize(c); await store.update(c, "synthetic-mode", (s) => { s.mode = "personal-companion"; s.conversations = [{ id: "legacy", provider, sessionId: randomUUID(), updatedAt: Date.now(), messages: [{ role: "user", text: "Preserved original context" }], proposal: { synthetic: "previous proposal" } }]; }); }
  let clock = Date.now(), fingerprint = "a".repeat(64);
  const options = { store, runtimeRoot: join(root, "runtime"), now: () => clock, resolveCli: async () => "/synthetic/native", resolveMcp: async () => [],
    readClaudeLogin: async () => ({ fingerprint }), codexFactory: () => ({ closed: false, accountFingerprint: fingerprint, initialize: async () => {}, close() { this.closed = true; }, async recheckAccount() { if (this.accountFingerprint !== fingerprint) { this.close(); throw Error("Synthetic native account changed"); } }, request: async (...args) => { calls.push(args); throw Error("No context or native thread request is permitted in binding review"); } }) };
  const agents = createAgentService(options);
  try { await fn({ store, root, calls, agents, options, changeAccount: () => { fingerprint = "b".repeat(64); }, advance: (ms) => { clock += ms; } }); }
  finally { await agents.close(); await rm(root, { recursive: true, force: true, maxRetries: 5, retryDelay: 50 }); }
}
test("legacy account review preserves exact context and consumes durable scope once for either native provider", async () => {
  for (const provider of ["codex", "claude-code"]) await fixture(async ({ store, root, calls, agents, options }) => {
    const original = (await store.snapshot("personal")).conversations[0], review = await agents.reviewLegacyBinding("personal", "legacy");
    assert.equal(review.scope.originalAccountVerified, false); assert.deepEqual(review.scope.messages, original.messages); assert.equal(review.modelPromptSubmitted, false);
    await agents.close(); const restarted = createAgentService(options);
    try {
      const input = { conversationId: "legacy", token: review.confirmation.token }, results = await Promise.allSettled([restarted.bindLegacy("personal", input), restarted.bindLegacy("personal", input)]);
      assert.equal(results.filter((r) => r.status === "fulfilled").length, 1);
      const saved = (await store.snapshot("personal")).conversations[0]; assert.equal(saved.accountFingerprint, review.scope.currentAccountFingerprint); assert.equal(saved.originalAccountVerified, false); assert.equal(saved.sessionId, original.sessionId); assert.deepEqual(saved.messages, original.messages); assert.deepEqual(saved.proposal, original.proposal);
      await assert.rejects(restarted.bindLegacy("personal", input), /already has an account binding/);
      const sealed = await readFile(join(root, "state/personal.sealed.json"), "utf8"); assert.equal(sealed.includes(review.confirmation.token), false); assert.equal(sealed.includes(original.messages[0].text), false); assert.equal(calls.length, 0);
    } finally { await restarted.close(); }
  }, provider);
});
test("changed legacy context, policy, login or expired review cannot silently authorize a destination", async () => {
  for (const change of ["context", "policy", "account", "expiry"]) await fixture(async ({ store, agents, changeAccount, advance, calls }) => {
    const review = await agents.reviewLegacyBinding("personal", "legacy");
    if (change === "context") await store.update("personal", "synthetic-context-edit", (s) => { s.conversations[0].messages.push({ role: "user", text: "Later context" }); });
    if (change === "policy") await store.update("personal", "synthetic-policy-edit", (s) => { s.accounts.push("synthetic-new-account-enrollment"); });
    if (change === "account") changeAccount();
    if (change === "expiry") advance(5 * 60000 + 1);
    await assert.rejects(agents.bindLegacy("personal", { conversationId: "legacy", token: review.confirmation.token }), /scope|changed|unknown|expired/);
    assert.equal((await store.snapshot("personal")).conversations[0].accountFingerprint, undefined); assert.equal(calls.length, 0);
  });
});
test("legacy tokens cannot cross workspaces, overwrite a known account binding or enable keyboard-only providers", () => fixture(async ({ store, agents, calls }) => {
  const review = await agents.reviewLegacyBinding("personal", "legacy");
  await assert.rejects(agents.bindLegacy("other", { conversationId: "legacy", token: review.confirmation.token }), /unknown/);
  await store.update("personal", "synthetic-existing-binding", (s) => { s.conversations[0].accountFingerprint = "b".repeat(64); });
  await assert.rejects(agents.reviewLegacyBinding("personal", "legacy"), /already has an account binding/);
  await store.update("other", "synthetic-keyboard-only", (s) => { s.mode = "keyboard-only"; });
  await assert.rejects(agents.reviewLegacyBinding("other", "legacy"), /keyboard-only/i); assert.equal(calls.length, 0);
}));
test("the suite exposes deliberate review and binding through its scoped backend routes without a prompt", () => fixture(async ({ store, agents }) => {
  const suite = createSuite({ store, agents, voice: { discovery: async () => ({ available: false }) } });
  try {
    const review = await suite.handle("/api/suite/conversation/binding/review", { compartment: "personal", conversationId: "legacy" });
    const result = await suite.handle("/api/suite/conversation/binding/bind", { compartment: "personal", conversationId: "legacy", token: review.confirmation.token });
    assert.equal(result.status, "bound-after-review"); assert.equal(result.modelPromptSubmitted, false); assert.equal(result.originalAccountVerified, false);
  } finally { await suite.close(); }
}));
