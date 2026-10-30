#!/usr/bin/env node
/** Actual first-turn creation and exact Claude continuation through the installed API. */
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
if (process.platform !== "linux" || process.argv.length !== 3 || process.argv[2] !== "--synthetic") throw new Error("Usage on the pilot: node scripts/verify-claude-submission-host.mjs --synthetic (normal app running; current Git directory must already be trusted by the native CLI; reserves one local task and sends two separately reviewed tiny prompts, without changing native trust settings)");
const repositoryRoot = await realpath(process.cwd()), git = await lstat(join(repositoryRoot, ".git")); assert.ok(!git.isSymbolicLink() && (git.isDirectory() || git.isFile()));
const store = createSuiteStore(), compartment = "claude-coding-validation", taskId = randomUUID(), requestId = randomUUID(), checks = [];
await store.initialize(compartment, "personal"); const baseline = await store.snapshot(compartment); assert.equal(baseline.mode, "keyboard-only");
const endpoint = JSON.parse(await privateRead(join(applicationStateRoot(), "endpoint.json"))), url = new URL(endpoint.url), token = /^#access=([A-Za-z0-9_-]{43})$/.exec(url.hash)?.[1]; assert.ok(token && url.hostname === "127.0.0.1" && url.protocol === "http:");
const hash = (v) => createHash("sha256").update(v).digest("hex"), digest = (v) => hash(JSON.stringify(v));
async function api(path, body, expected = 200, authenticated = true) {
  const r = await fetch(new URL(`/api/suite/${path}`, url.origin), { method: "POST", redirect: "error", headers: { "Content-Type": "application/json", Origin: url.origin, ...(authenticated ? { Authorization: `Bearer ${token}` } : {}) }, body: JSON.stringify(body), signal: AbortSignal.timeout(150000) });
  const value = await r.json(); assert.equal(r.status, expected, `The installed ${path} check did not verify: ${typeof value.error === "string" ? value.error.slice(0, 600) : "unexpected HTTP status"}`); return value;
}
function sourceState() {
  const hasHead = spawnSync("git", ["rev-parse", "--verify", "HEAD"], { cwd: repositoryRoot, shell: false, stdio: "ignore", env: desktopEnvironment() }).status === 0;
  const values = [["status", "--porcelain=v1", "-z", "--untracked-files=normal"], ["diff", "--no-ext-diff", "--no-textconv", "--binary", ...(hasHead ? ["HEAD"] : []), "--", "."]].map((args) => { const r = spawnSync("git", args, { cwd: repositoryRoot, shell: false, encoding: "utf8", maxBuffer: 4 * 1024 * 1024, env: desktopEnvironment() }); assert.equal(r.status, 0); return hash(r.stdout); });
  return digest(values);
}
const definitions = (s) => digest([s.profile, s.workflow, s.roleBindings ?? [], s.mode]), personal = definitions(await api("snapshot", { compartment: "personal" })), selection = await store.selection(), sourceBefore = sourceState();
const taskDefinitions = (tasks) => (tasks ?? []).map(({ observation, ...definition }) => definition);
const evidence = { schema: "switchyard-installed-reviewed-claude-text/v1", at: new Date().toISOString(), checks, modelPromptsSubmitted: 0, nativeTurnIdSupported: false, taskCompletionVerified: false, keyboardWritten: false, windowsRuntimeAccepted: false };
let failure;
try {
  await api("mode", { compartment, mode: "personal-companion" });
  const task = await api("coding/claude/text/create", { compartment, requestId: taskId, repositoryRoot, label: "Synthetic reviewed Claude text check" }); assert.equal(task.modelPromptSubmitted, false); assert.equal(task.nativeConversationCreated, false); assert.equal(task.nativeIdentityVerified, false); assert.equal(task.capabilities.sessionIdentifiable, false); checks.push("account/directory-bound local task reservation explicitly reports no native conversation yet");
  const duplicateTask = await api("coding/claude/text/create", { compartment, requestId: taskId, repositoryRoot, label: "Synthetic reviewed Claude text check" }); assert.equal(duplicateTask.duplicatePrevented, true); assert.equal(duplicateTask.sessionId, task.sessionId); checks.push("durable duplicate task reservation preserves its requested UUID without a background worker");
  const input = { compartment, taskId: task.id, text: "Synthetic text transport check only. Reply with exactly the word Ready. Do not call tools, inspect files, execute commands or do other work." };
  const review = await api("coding/claude/turns/review", input); assert.equal(review.modelPromptSubmitted, false); assert.equal(review.scope.sessionId, task.sessionId); assert.equal(review.scope.nativeIdentityVerified, false); checks.push("first-turn review explicitly identifies the unverified requested UUID without prompting");
  const submission = { ...input, requestId, token: review.confirmation.token }; evidence.modelPromptsSubmitted = null;
  const result = await api("coding/claude/turns/submit", submission); evidence.modelPromptsSubmitted = 1;
  assert.equal(result.reply.trim(), "Ready"); assert.equal(result.status, "provider-turn-completed"); assert.equal(result.sessionId, task.sessionId); assert.equal(result.nativeSessionVerified, true); assert.equal(result.nativeTurnIdSupported, false); assert.equal(result.turnId, null); assert.equal(result.taskCompletionVerified, false);
  assert.equal(result.ownedRuntime?.schema, "switchyard-runtime-command/v1"); assert.equal(result.ownedRuntime.containment, "owned-linux-session"); assert.equal(result.ownedRuntimeStoppedVerified, true); assert.notEqual(result.ownedRuntime.id, result.sessionId);
  checks.push("exact owned native guardian recorded before start and verified stopped before retaining the reply");
  evidence.sessionIdSha256 = hash(result.sessionId); checks.push("actual native reply retained under the exact original UUID without an invented turn ID");
  const duplicate = await api("coding/claude/turns/submit", submission); assert.equal(duplicate.duplicatePrevented, true); assert.equal(duplicate.reply, result.reply); checks.push("duplicate request reused the saved reply without another native submission");
  await api("coding/claude/turns/submit", { ...submission, requestId: randomUUID() }, 409); await api("coding/claude/turns/review", input, 401, false); checks.push("consumed approval and unauthenticated review rejected");
  const continuedInput = { ...input, text: "Synthetic continuation check only. Reply exactly Continued. Do not call tools, inspect files or do other work." }, continuedReview = await api("coding/claude/turns/review", continuedInput); assert.equal(continuedReview.scope.nativeIdentityVerified, true);
  const continued = await api("coding/claude/turns/submit", { ...continuedInput, requestId: randomUUID(), token: continuedReview.confirmation.token }); evidence.modelPromptsSubmitted = 2; assert.equal(continued.sessionId, task.sessionId); assert.equal(continued.reply.trim(), "Continued"); assert.equal(continued.nativeSessionVerified, true); assert.equal(continued.ownedRuntimeStoppedVerified, true); assert.notEqual(continued.ownedRuntime.id, result.ownedRuntime.id); evidence.ownedContainment = "verified owned Linux sessions; deliberately detached processes are not an OS sandbox claim"; checks.push("second separately reviewed native turn resumed the same UUID under a distinct stopped guardian");
  assert.equal(sourceState(), sourceBefore); checks.push("repository Git diff/status preserved");
} catch (error) { failure = error; evidence.failure = error.message; }
finally {
  try {
    await api("mode", { compartment, mode: "keyboard-only" });
    const state = await store.snapshot(compartment), turn = state.codingTurns?.find((t) => t.id === requestId), task = state.codingSessions?.find((t) => t.id === taskId);
    if (turn && !["provider-turn-completed", "failed-before-turn", "reviewed-unconfirmed"].includes(turn.status) || task && ["creating", "creation-uncertain"].includes(task.status)) throw new Error("The synthetic native outcome is unresolved; its protected identities were retained for deliberate review.");
    if ((state.codingTurns ?? []).some((t) => t.taskId === taskId && (!["provider-turn-completed", "failed-before-turn", "reviewed-unconfirmed"].includes(t.status) || t.ownedRuntime && t.ownedRuntimeStoppedVerified !== true))) throw new Error("A synthetic continuation or its owned process exit is unresolved; its protected identity was retained.");
    await store.update(compartment, "synthetic-claude-text-cleanup", (s) => { s.codingTurns = (s.codingTurns ?? []).filter((t) => t.taskId !== taskId); s.codingSessions = (s.codingSessions ?? []).filter((t) => t.id !== taskId); });
    const restored = await api("snapshot", { compartment }); assert.equal(definitions(restored), definitions(baseline)); assert.equal(digest(taskDefinitions(restored.codingSessions)), digest(taskDefinitions(baseline.codingSessions)), "Existing task definitions changed during cleanup."); assert.equal(digest(restored.codingTurns ?? []), digest(baseline.codingTurns ?? []), "Existing protected text records changed during cleanup.");
    assert.equal(definitions(await api("snapshot", { compartment: "personal" })), personal); assert.equal(await store.selection(), selection); assert.equal((JSON.parse(await privateRead(join(applicationStateRoot(), "endpoint.json")))).url, endpoint.url);
    evidence.syntheticRecordsRemoved = true; checks.push("keyboard-only cleanup preserved definitions, active selection and private link");
  } catch (error) { failure ??= error; evidence.cleanupFailure = error.message; }
}
evidence.nativeConversationHistory = "the installed CLI retains its small synthetic task history; no native user history is deleted";
const path = join(homedir(), ".local/state/strathex-switchyard/runtime-verification", `installed-reviewed-claude-text-${Date.now()}.json`); await privateWrite(path, JSON.stringify(evidence, null, 2) + "\n");
console.log(JSON.stringify({ receipt: path, checks: checks.length, modelPromptsSubmitted: evidence.modelPromptsSubmitted, nativeTurnIdSupported: false, syntheticRecordsRemoved: evidence.syntheticRecordsRemoved ?? false, taskCompletionVerified: false, failure: failure?.message ?? null }));
if (failure) throw failure;
