#!/usr/bin/env node
/** Exercise installed protected binding routes with synthetic legacy identities only. */
import assert from "node:assert/strict";
import { createHash, randomUUID } from "node:crypto";
import { homedir } from "node:os";
import { join } from "node:path";
import { applicationStateRoot } from "../deployment/suite/application.mjs";
import { privateRead, privateWrite } from "../tools/layout-studio/private-fs.mjs";
import { createSuiteStore } from "../tools/layout-studio/suite-store.mjs";
if (process.platform !== "linux" || process.argv.length !== 3 || process.argv[2] !== "--synthetic") throw new Error("Usage on the pilot: node scripts/verify-conversation-binding-host.mjs --synthetic (normal application must be running; checks actual native login and protected routes using invented session UUIDs, never resumes or prompts them)");
const store = createSuiteStore(), compartment = "binding-validation", fixtures = [], checks = [];
await store.initialize(compartment, "personal");
const endpoint = JSON.parse(await privateRead(join(applicationStateRoot(), "endpoint.json"))), url = new URL(endpoint.url), token = /^#access=([A-Za-z0-9_-]{43})$/.exec(url.hash)?.[1];
assert.ok(token && url.protocol === "http:" && url.hostname === "127.0.0.1");
const digest = (v) => createHash("sha256").update(JSON.stringify(v)).digest("hex");
async function api(path, body, expected = 200, authenticated = true) {
  const r = await fetch(new URL(`/api/suite/${path}`, url.origin), { method: "POST", redirect: "error", headers: { "Content-Type": "application/json", Origin: url.origin, ...(authenticated ? { Authorization: `Bearer ${token}` } : {}) }, body: JSON.stringify(body), signal: AbortSignal.timeout(30000) });
  assert.equal(r.status, expected, "The normal installed binding API returned an unexpected status."); return r.json();
}
const definitions = (s) => digest([s.profile, s.workflow, s.roleBindings ?? [], s.mode]);
const personal = definitions(await api("snapshot", { compartment: "personal" })), baseline = await store.snapshot(compartment);
const evidence = { schema: "switchyard-installed-legacy-binding/v1", at: new Date().toISOString(), checks,
  nativeSessionIdentifiers: "invented UUIDs in synthetic saved legacy records", nativeSessionExistenceVerified: false,
  actualNativeFirstPartyLoginChecked: true, originalAccountVerified: false, modelPromptSubmitted: false,
  keyboardWritten: false, frontendVisualAcceptance: false };
let failure;
try {
  await api("mode", { compartment, mode: "personal-companion" });
  for (const provider of ["codex", "claude-code"]) {
    const fixture = { id: randomUUID(), provider, sessionId: randomUUID(), updatedAt: Date.now(), messages: [{ role: "user", text: "Synthetic legacy account-binding transport check; no user content." }] };
    fixtures.push(fixture);
    await store.update(compartment, "synthetic-legacy-fixture", (s) => { s.conversations.push(fixture); });
    const review = await api("conversation/binding/review", { compartment, conversationId: fixture.id });
    assert.equal(review.scope.originalAccountVerified, false); assert.match(review.scope.currentAccountFingerprint, /^[a-f0-9]{64}$/); assert.deepEqual(review.scope.messages, fixture.messages);
    const input = { compartment, conversationId: fixture.id, token: review.confirmation.token };
    const bound = await api("conversation/binding/bind", input); assert.equal(bound.modelPromptSubmitted, false); assert.equal(bound.originalAccountVerified, false);
    const saved = (await api("snapshot", { compartment })).conversations.find((c) => c.id === fixture.id);
    assert.equal(saved.accountFingerprint, review.scope.currentAccountFingerprint); assert.equal(saved.sessionId, fixture.sessionId); assert.deepEqual(saved.messages, fixture.messages);
    await api("conversation/binding/bind", input, 400); checks.push(`${provider}: reviewed exact destination, retained context/identity and rejected replay without a model request`);
  }
  await api("conversation/binding/review", { compartment, conversationId: fixtures[0].id }, 401, false); checks.push("unauthenticated review rejected");
} catch (error) { failure = error; evidence.failure = error.message; }
finally {
  try {
    for (const fixture of fixtures) await store.update(compartment, "synthetic-legacy-cleanup", (s) => { s.conversations = s.conversations.filter((c) => c.id !== fixture.id || c.sessionId !== fixture.sessionId); });
    await api("mode", { compartment, mode: baseline.mode });
    const restored = await api("snapshot", { compartment }); assert.equal(definitions(restored), definitions(baseline)); assert.deepEqual(restored.conversations, baseline.conversations);
    assert.equal(definitions(await api("snapshot", { compartment: "personal" })), personal);
    assert.equal((JSON.parse(await privateRead(join(applicationStateRoot(), "endpoint.json")))).url, endpoint.url);
    evidence.syntheticRecordsRemoved = true; checks.push("synthetic records removed; validation definitions/mode, Personal definitions and private link preserved");
  } catch (error) { failure ??= error; evidence.cleanupFailure = error.message; }
}
const path = join(homedir(), ".local/state/strathex-switchyard/runtime-verification", `installed-legacy-binding-${Date.now()}.json`); await privateWrite(path, JSON.stringify(evidence, null, 2) + "\n");
console.log(JSON.stringify({ receipt: path, checks: checks.length, syntheticRecordsRemoved: evidence.syntheticRecordsRemoved ?? false, modelPromptSubmitted: false, nativeSessionExistenceVerified: false, failure: failure?.message ?? null }));
if (failure) throw failure;
