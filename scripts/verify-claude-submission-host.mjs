#!/usr/bin/env node
/** Actual stopped-task Claude continuation through the normal installed API. */
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { createHash, randomUUID } from "node:crypto";
import { lstat, realpath } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";
import { applicationStateRoot } from "../deployment/suite/application.mjs";
import { privateRead, privateWrite } from "../tools/layout-studio/private-fs.mjs";
import { createSuiteStore } from "../tools/layout-studio/suite-store.mjs";
import { desktopEnvironment } from "../tools/layout-studio/process-environment.mjs";
if (process.platform !== "linux" || process.argv.length !== 3 || process.argv[2] !== "--synthetic") throw new Error("Usage on the pilot: node scripts/verify-claude-submission-host.mjs --synthetic (normal app running; current Git directory must already be trusted by the native CLI; creates/stops one empty owned task and sends one tiny reviewed prompt, without changing native trust settings)");
const repositoryRoot = await realpath(process.cwd()); assert.ok((await lstat(join(repositoryRoot, ".git"))).isDirectory());
const store = createSuiteStore(), compartment = "claude-coding-validation", taskId = randomUUID(), requestId = randomUUID(), checks = [];
await store.initialize(compartment, "personal"); const baseline = await store.snapshot(compartment); assert.equal(baseline.mode, "keyboard-only");
const endpoint = JSON.parse(await privateRead(join(applicationStateRoot(), "endpoint.json"))), url = new URL(endpoint.url), token = /^#access=([A-Za-z0-9_-]{43})$/.exec(url.hash)?.[1]; assert.ok(token && url.hostname === "127.0.0.1" && url.protocol === "http:");
const hash = (v) => createHash("sha256").update(v).digest("hex"), digest = (v) => hash(JSON.stringify(v));
async function api(path, body, expected = 200, authenticated = true) {
  const r = await fetch(new URL(`/api/suite/${path}`, url.origin), { method: "POST", redirect: "error", headers: { "Content-Type": "application/json", Origin: url.origin, ...(authenticated ? { Authorization: `Bearer ${token}` } : {}) }, body: JSON.stringify(body), signal: AbortSignal.timeout(150000) });
  const value = await r.json(); assert.equal(r.status, expected, `The installed ${path} check did not verify: ${typeof value.error === "string" ? value.error.slice(0, 600) : "unexpected HTTP status"}`); return value;
}
function sourceState() {
  const values = [["status", "--porcelain=v1", "-z", "--untracked-files=normal"], ["diff", "--no-ext-diff", "--no-textconv", "--binary", "HEAD", "--", "."]].map((args) => { const r = spawnSync("git", args, { cwd: repositoryRoot, shell: false, encoding: "utf8", maxBuffer: 4 * 1024 * 1024, env: desktopEnvironment() }); assert.equal(r.status, 0); return hash(r.stdout); });
  return digest(values);
}
const definitions = (s) => digest([s.profile, s.workflow, s.roleBindings ?? [], s.mode]), personal = definitions(await api("snapshot", { compartment: "personal" })), selection = await store.selection(), sourceBefore = sourceState();
const evidence = { schema: "switchyard-installed-reviewed-claude-text/v1", at: new Date().toISOString(), checks, modelPromptsSubmitted: 0, nativeTurnIdSupported: false, taskCompletionVerified: false, keyboardWritten: false, windowsRuntimeAccepted: false };
let failure;
try {
  await api("mode", { compartment, mode: "personal-companion" });
  const task = await api("coding/claude/create", { compartment, requestId: taskId, repositoryRoot, label: "Synthetic reviewed Claude text check" }); assert.equal(task.modelPromptSubmitted, false); checks.push("one exact owned account/directory-bound empty Claude task created without prompting");
  const stopReview = await api("coding/claude/stop/review", { compartment, id: task.id });
  if (stopReview.effect !== "already-stopped") { const stopped = await api("coding/claude/stop", { compartment, id: task.id, token: stopReview.confirmation.token }); assert.equal(stopped.effect, "provider-reported-stopped"); }
  checks.push("the exact owned background task stopped through its separate reviewed native route");
  const input = { compartment, taskId: task.id, text: "Synthetic text transport check only. Reply with exactly the word Ready. Do not call tools, inspect files, execute commands or do other work." };
  const review = await api("coding/claude/turns/review", input); assert.equal(review.modelPromptSubmitted, false); assert.equal(review.scope.sessionId, task.sessionId); checks.push("exact stopped-session text review issued approval without prompting");
  const submission = { ...input, requestId, token: review.confirmation.token }; evidence.modelPromptsSubmitted = null;
  const result = await api("coding/claude/turns/submit", submission); evidence.modelPromptsSubmitted = 1;
  assert.equal(result.reply.trim(), "Ready"); assert.equal(result.status, "provider-turn-completed"); assert.equal(result.sessionId, task.sessionId); assert.equal(result.nativeSessionVerified, true); assert.equal(result.nativeTurnIdSupported, false); assert.equal(result.turnId, null); assert.equal(result.taskCompletionVerified, false);
  evidence.sessionIdSha256 = hash(result.sessionId); checks.push("actual native reply retained under the exact original UUID without an invented turn ID");
  const duplicate = await api("coding/claude/turns/submit", submission); assert.equal(duplicate.duplicatePrevented, true); assert.equal(duplicate.reply, result.reply); checks.push("duplicate request reused the saved reply without another native submission");
  await api("coding/claude/turns/submit", { ...submission, requestId: randomUUID() }, 409); await api("coding/claude/turns/review", input, 401, false); checks.push("consumed approval and unauthenticated review rejected");
  assert.equal(sourceState(), sourceBefore); checks.push("repository Git diff/status preserved");
} catch (error) { failure = error; evidence.failure = error.message; }
finally {
  try {
    await api("mode", { compartment, mode: "keyboard-only" });
    const state = await store.snapshot(compartment), turn = state.codingTurns?.find((t) => t.id === requestId), task = state.codingSessions?.find((t) => t.id === taskId);
    if (turn && !["provider-turn-completed", "failed-before-turn", "reviewed-unconfirmed"].includes(turn.status) || task && ["creating", "creation-uncertain"].includes(task.status)) throw new Error("The synthetic native outcome is unresolved; its protected identities were retained for deliberate review.");
    await store.update(compartment, "synthetic-claude-text-cleanup", (s) => { s.codingTurns = (s.codingTurns ?? []).filter((t) => t.id !== requestId); s.codingSessions = (s.codingSessions ?? []).filter((t) => t.id !== taskId); });
    const restored = await api("snapshot", { compartment }); assert.equal(definitions(restored), definitions(baseline)); assert.deepEqual(restored.codingSessions ?? [], baseline.codingSessions ?? []); assert.deepEqual(restored.codingTurns ?? [], baseline.codingTurns ?? []);
    assert.equal(definitions(await api("snapshot", { compartment: "personal" })), personal); assert.equal(await store.selection(), selection); assert.equal((JSON.parse(await privateRead(join(applicationStateRoot(), "endpoint.json")))).url, endpoint.url);
    evidence.syntheticRecordsRemoved = true; checks.push("keyboard-only cleanup preserved definitions, active selection and private link");
  } catch (error) { failure ??= error; evidence.cleanupFailure = error.message; }
}
evidence.nativeConversationHistory = "the installed CLI retains its small synthetic task history; no native user history is deleted";
const path = join(homedir(), ".local/state/strathex-switchyard/runtime-verification", `installed-reviewed-claude-text-${Date.now()}.json`); await privateWrite(path, JSON.stringify(evidence, null, 2) + "\n");
console.log(JSON.stringify({ receipt: path, checks: checks.length, modelPromptsSubmitted: evidence.modelPromptsSubmitted, nativeTurnIdSupported: false, syntheticRecordsRemoved: evidence.syntheticRecordsRemoved ?? false, taskCompletionVerified: false, failure: failure?.message ?? null }));
if (failure) throw failure;
