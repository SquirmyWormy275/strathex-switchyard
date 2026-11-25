#!/usr/bin/env node
/** One reviewed synthetic native coding turn through the normal installed API. */
import assert from "node:assert/strict";
import { createHash, randomUUID } from "node:crypto";
import { mkdir, readFile, readdir, rm } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";
import { applicationStateRoot } from "../deployment/suite/application.mjs";
import { privateDirectory, privateRead, privateWrite } from "../tools/layout-studio/private-fs.mjs";
import { createSuiteStore } from "../tools/layout-studio/suite-store.mjs";
if (process.platform !== "linux" || process.argv.length !== 3 || process.argv[2] !== "--synthetic") throw new Error("Usage on the pilot: node scripts/verify-codex-submission-host.mjs --synthetic (normal app must run; creates one temporary exact task and sends one tiny manually reviewed native prompt through the existing Codex account)");
const store = createSuiteStore(), compartment = "coding-validation", directory = join(homedir(), ".local/state/strathex-switchyard/runtime-verification"), root = join(directory, `reviewed-text-${randomUUID()}`), repositoryRoot = join(root, "repo"), requestId = randomUUID(), taskId = randomUUID(), checks = [];
await store.initialize(compartment, "personal"); const baseline = await store.snapshot(compartment); assert.equal(baseline.mode, "keyboard-only", "The synthetic validation workspace must be idle and keyboard-only before this check.");
const endpoint = JSON.parse(await privateRead(join(applicationStateRoot(), "endpoint.json"))), url = new URL(endpoint.url), token = /^#access=([A-Za-z0-9_-]{43})$/.exec(url.hash)?.[1];
assert.ok(token && url.protocol === "http:" && url.hostname === "127.0.0.1");
const hash = (v) => createHash("sha256").update(v).digest("hex"), digest = (v) => hash(JSON.stringify(v));
async function api(path, body, expected = 200, authenticated = true) {
  const r = await fetch(new URL(`/api/suite/${path}`, url.origin), { method: "POST", redirect: "error", headers: { "Content-Type": "application/json", Origin: url.origin, ...(authenticated ? { Authorization: `Bearer ${token}` } : {}) }, body: JSON.stringify(body), signal: AbortSignal.timeout(150000) });
  const value = await r.json();
  assert.equal(r.status, expected, `The installed ${path} check did not verify: ${typeof value.error === "string" ? value.error.slice(0, 600) : "unexpected HTTP status"}`); return value;
}
const definitions = (s) => digest([s.profile, s.workflow, s.roleBindings ?? [], s.mode]), personal = definitions(await api("snapshot", { compartment: "personal" })), selection = await store.selection();
await privateDirectory(repositoryRoot); await mkdir(join(repositoryRoot, ".git"), { mode: 0o700 });
const evidence = { schema: "switchyard-installed-reviewed-codex-text/v1", at: new Date().toISOString(), checks, modelPromptsSubmitted: 0, fileOrCommandAuthorityGranted: false, taskCompletionVerified: false, windowsRuntimeAccepted: false, frontendVisualAcceptance: false };
let failure, nativeSessionId;
try {
  await api("mode", { compartment, mode: "personal-companion" });
  const task = await api("coding/codex/create", { compartment, requestId: taskId, repositoryRoot, label: "Synthetic reviewed-text transport check" });
  assert.equal(task.modelPromptSubmitted, false); assert.ok(task.repositoryIdentity && task.sessionId); nativeSessionId = task.sessionId; checks.push("normal API created one exact account/directory-bound empty task without a model prompt");
  const input = { compartment, taskId: task.id, text: 'Synthetic text transport check only. Reply with exactly the single word Ready. Do not call tools, inspect files, execute commands or do other work.' };
  const review = await api("coding/codex/turns/review", input); assert.equal(review.modelPromptSubmitted, false); assert.equal(review.scope.sessionId, task.sessionId); assert.equal(review.scope.repositoryRoot, repositoryRoot); checks.push("exact native account/root/text review returned a one-use approval without prompting");
  const submission = { ...input, requestId, token: review.confirmation.token }; evidence.modelSubmissionAttempted = true; evidence.modelPromptsSubmitted = null;
  const result = await api("coding/codex/turns/submit", submission);
  evidence.modelPromptsSubmitted = 1;
  assert.equal(result.status, "provider-turn-completed"); assert.equal(result.reply.trim(), "Ready"); assert.ok(result.turnId); assert.equal(result.sessionId, task.sessionId); assert.equal(result.taskCompletionVerified, false);
  evidence.sessionIdSha256 = hash(result.sessionId); evidence.turnIdSha256 = hash(result.turnId); checks.push("one actual restricted turn returned Ready and retained its exact native acknowledgement");
  const duplicate = await api("coding/codex/turns/submit", submission); assert.equal(duplicate.duplicatePrevented, true); assert.equal(duplicate.turnId, result.turnId); checks.push("duplicate request returned its saved result without another model submission");
  await api("coding/codex/turns/submit", { ...submission, requestId: randomUUID() }, 409); await api("coding/codex/turns/review", input, 401, false); checks.push("consumed approval and unauthenticated review were rejected");
  assert.deepEqual(await readdir(repositoryRoot), [".git"]); assert.deepEqual(await readdir(join(repositoryRoot, ".git")), []); checks.push("synthetic repository remained unchanged");
} catch (error) { failure = error; evidence.failure = error.message; }
finally {
  try {
    await api("mode", { compartment, mode: "keyboard-only" });
    const state = await store.snapshot(compartment), turn = state.codingTurns?.find((t) => t.id === requestId), task = state.codingSessions?.find((t) => t.id === taskId);
    if (turn && !["provider-turn-completed", "failed-before-turn", "reviewed-unconfirmed"].includes(turn.status) || task && ["creating", "creation-uncertain"].includes(task.status)) throw new Error("The synthetic native outcome is unresolved. Its protected identities and private working directory were retained for deliberate review.");
    await store.update(compartment, "synthetic-text-cleanup", (s) => { s.codingTurns = (s.codingTurns ?? []).filter((t) => t.id !== requestId); s.codingSessions = (s.codingSessions ?? []).filter((t) => t.id !== taskId); });
    const restored = await api("snapshot", { compartment }); assert.equal(definitions(restored), definitions(baseline)); assert.deepEqual(restored.codingSessions ?? [], baseline.codingSessions ?? []); assert.deepEqual(restored.codingTurns ?? [], baseline.codingTurns ?? []);
    assert.equal(definitions(await api("snapshot", { compartment: "personal" })), personal); assert.equal(await store.selection(), selection);
    assert.equal((JSON.parse(await privateRead(join(applicationStateRoot(), "endpoint.json")))).url, endpoint.url);
    await rm(root, { recursive: true, force: true }); evidence.privateStagingRemoved = true; checks.push("keyboard-only cleanup preserved Personal/validation definitions, selection and private link");
  } catch (error) { failure ??= error; evidence.cleanupFailure = error.message; }
}
evidence.nativeConversationHistory = nativeSessionId ? "one synthetic native task retained by the installed CLI; local fixture records removed" : "no exact native session was returned";
evidence.sourceSha256 = hash(await readFile(new URL("../tools/layout-studio/codex-submissions.mjs", import.meta.url)));
const path = join(directory, `installed-reviewed-codex-text-${Date.now()}.json`); await privateWrite(path, JSON.stringify(evidence, null, 2) + "\n");
console.log(JSON.stringify({ receipt: path, checks: checks.length, modelPromptsSubmitted: evidence.modelPromptsSubmitted, privateStagingRemoved: evidence.privateStagingRemoved ?? false, taskCompletionVerified: false, failure: failure?.message ?? null }));
if (failure) throw failure;
