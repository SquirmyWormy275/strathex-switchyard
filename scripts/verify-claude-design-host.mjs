#!/usr/bin/env node
/** Two synthetic configuration turns through the normal installed private API. */
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { homedir } from "node:os";
import { join } from "node:path";
import { newPlan, parseBoardProfile } from "../tools/layout-studio/model.mjs";
import { createSuiteStore } from "../tools/layout-studio/suite-store.mjs";
import { privateRead, privateWrite } from "../tools/layout-studio/private-fs.mjs";
import { applicationStateRoot, applicationStatus } from "../deployment/suite/application.mjs";
import { runtimeGuardianStopped } from "../tools/layout-studio/runtime-command.mjs";
if (process.platform !== "linux" || process.argv.length !== 3 || process.argv[2] !== "--synthetic") throw new Error("Usage on the pilot: node scripts/verify-claude-design-host.mjs --synthetic (normal app running; two tiny native configuration prompts in the existing keyboard-only validation workspace)");
const store = createSuiteStore(), compartment = "claude-coding-validation", baseline = await store.snapshot(compartment); assert.equal(baseline.mode, "keyboard-only");
const selected = await store.selection(), endpoint = JSON.parse(await privateRead(join(applicationStateRoot(), "endpoint.json"))), url = new URL(endpoint.url), token = /^#access=([A-Za-z0-9_-]{43})$/.exec(url.hash)?.[1]; assert.ok(token && url.hostname === "127.0.0.1" && url.protocol === "http:");
const applicationRelease = (await applicationStatus()).build, checks = [], digest = value => createHash("sha256").update(JSON.stringify(value)).digest("hex"), definitions = s => digest([s.profile, s.workflow, s.roleBindings ?? [], s.mode]);
async function api(path, body = {}, expected = 200, authenticated = true) {
  const r = await fetch(new URL(`/api/suite/${path}`, url.origin), { method: "POST", redirect: "error", headers: { "Content-Type": "application/json", Origin: url.origin, ...(authenticated ? { Authorization: `Bearer ${token}` } : {}) }, body: JSON.stringify({ compartment, ...body }), signal: AbortSignal.timeout(150000) });
  const value = await r.json(); assert.equal(r.status, expected, `Installed ${path} did not verify: ${typeof value.error === "string" ? value.error.slice(0, 400) : "unexpected status"}`); return value;
}
const personalBefore = definitions(await api("snapshot", { compartment: "personal" })), baselineDefinitions = definitions(baseline), beforeIds = new Set(baseline.conversations.map(c => c.id)), owned = new Map();
const plan = newPlan(parseBoardProfile({ schema: "sxsy-board-profile/v1", name: "Synthetic transport check", layout: "one", keys: [{ id: "synthetic-one", label: "A", matrix: [0, 0], x: 0, y: 0, baseKeycode: "KC_A" }] }));
let first, second, failure, cleaned = false, modelRequestsAttempted = 0;
try {
  await api("design", { provider: "claude-code", plan, message: "Synthetic authorization check" }, 401, false); checks.push("unauthenticated designer request rejected before a model prompt");
  await api("mode", { mode: "personal-companion" });
  modelRequestsAttempted++; first = await api("design", { provider: "claude-code", plan, message: 'Synthetic transport check only. Reply exactly "Ready"; summary "Synthetic check"; actions, steps and roles must all be empty arrays. Do no other work.' });
  assert.equal(first.reply, "Ready"); assert.equal(first.ownedRuntimeStoppedVerified, true); assert.equal(await runtimeGuardianStopped(first.ownedRuntime), true); owned.set(first.conversationId, first.sessionId); checks.push("normal installed first structured reply verifies exact native guardian exit");
  modelRequestsAttempted++; second = await api("design", { provider: "claude-code", plan, conversationId: first.conversationId, message: 'Repeat the synthetic check in this exact conversation. Reply exactly "Ready"; summary "Synthetic check"; actions, steps and roles must all be empty arrays. Do no other work.' });
  assert.equal(second.reply, "Ready"); assert.equal(second.sessionId, first.sessionId); assert.equal(second.conversationId, first.conversationId); assert.notEqual(second.ownedRuntime.id, first.ownedRuntime.id); assert.equal(second.ownedRuntimeStoppedVerified, true); assert.equal(await runtimeGuardianStopped(second.ownedRuntime), true); checks.push("exact continuation retains the native conversation and verifies a distinct guardian exited");
  const saved = (await store.snapshot(compartment)).conversations.find(c => c.id === first.conversationId); assert.match(saved.accountFingerprint, /^[a-f0-9]{64}$/); assert.equal(saved.messages.length, 4); assert.equal(saved.ownedRuntimeStoppedVerified, true); assert.deepEqual(saved.ownedRuntime, second.ownedRuntime); checks.push("protected record retains stable account binding, both messages and verified native ownership");
} catch (error) { failure = error; }
finally {
  try {
    assert.equal((await api("mode", { mode: "keyboard-only" })).ownedProcessesStopped, true); checks.push("keyboard-only cleanup verifies owned process stop");
    await store.update(compartment, "synthetic-design-cleanup", s => {
      for (const c of s.conversations) if (!beforeIds.has(c.id)) {
        if (!owned.has(c.id) || owned.get(c.id) !== c.sessionId || c.ownedRuntimeStoppedVerified !== true) throw new Error("An unconfirmed validation conversation was retained for review.");
      }
      s.conversations = s.conversations.filter(c => beforeIds.has(c.id));
    }); cleaned = true; checks.push("only this verified synthetic conversation was removed; native CLI history remains");
    assert.equal(definitions(await api("snapshot")), baselineDefinitions); assert.equal(definitions(await api("snapshot", { compartment: "personal" })), personalBefore); assert.equal(await store.selection(), selected); assert.equal(JSON.parse(await privateRead(join(applicationStateRoot(), "endpoint.json"))).url, endpoint.url); assert.equal((await applicationStatus()).build, applicationRelease); checks.push("Personal and validation definitions, mode, selection and private endpoint preserved");
  } catch (error) { failure ??= error; }
}
const path = join(homedir(), ".local/state/strathex-switchyard/runtime-verification", `installed-claude-design-${Date.now()}.json`);
await privateWrite(path, JSON.stringify({ schema: "switchyard-installed-claude-design/v1", at: new Date().toISOString(), applicationRelease, checks, sessionIdSha256: first?.sessionId ? digest(first.sessionId) : null, guardians: [first?.ownedRuntime, second?.ownedRuntime].filter(Boolean), modelRequestsAttempted, validatedStructuredReplies: second ? 2 : first ? 1 : 0, syntheticRecordsRemoved: cleaned, nativeConversationHistory: second ? "two synthetic turns retained by the installed Claude CLI" : "native CLI may retain synthetic history; failed-request delivery is unconfirmed", externalTaskCompletionVerified: false, keyboardWritten: false, failure: failure?.message ?? null }, null, 2) + "\n");
console.log(JSON.stringify({ receipt: path, checks: checks.length, syntheticRecordsRemoved: cleaned, externalTaskCompletionVerified: false, failure: failure?.message ?? null })); if (failure) throw failure;
