#!/usr/bin/env node
/** Explicit empty-task or reviewed-text metadata journey in the existing workspace. */
import assert from "node:assert/strict";
import { createHash, randomUUID } from "node:crypto";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { readFile, rm } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";
import { applicationStatus, applicationStateRoot } from "../deployment/suite/application.mjs";
import { installationRoot } from "../deployment/suite/installation.mjs";
import { endpointIdentity, requestInstance } from "../tools/layout-studio/instance.mjs";
import { createSuiteStore } from "../tools/layout-studio/suite-store.mjs";
import { privateDirectory, privateRead, privateWrite } from "../tools/layout-studio/private-fs.mjs";
import { linuxProcess } from "../tools/layout-studio/native-process.mjs";
import { trustedCli } from "../tools/layout-studio/agents.mjs";

if (process.platform !== "linux" || process.argv.length !== 3 || !["--synthetic-native-metadata", "--synthetic-reviewed-text-metadata"].includes(process.argv[2])) throw Error("Usage on the pilot: node scripts/verify-agent-observation-host.mjs --synthetic-native-metadata (one empty Codex task; no model prompt) or --synthetic-reviewed-text-metadata (one reviewed tiny native Codex turn)");
const reviewedText = process.argv[2] === "--synthetic-reviewed-text-metadata";
const hash = value => createHash("sha256").update(value).digest("hex"), execute = promisify(execFile);
const installed = await applicationStatus(); assert.equal(installed.status, "ready");
const endpointFile = join(applicationStateRoot(), "endpoint.json"), endpointBefore = await privateRead(endpointFile), endpoint = JSON.parse(endpointBefore), binding = endpointIdentity(endpoint);
const app = await linuxProcess(endpoint.pid), nativeExecutable = await trustedCli("codex");
async function current() { assert.equal(await privateRead(endpointFile), endpointBefore); const proof = await requestInstance(endpoint); assert.equal(proof.authenticated, true); assert.equal(proof.pid, app.pid); assert.equal(proof.status, "ready"); assert.equal((await linuxProcess(app.pid)).startTicks, app.startTicks); }
await current();
async function api(path, body) {
  await current();
  const r = await fetch(new URL("/api/suite/" + path, binding.url.origin), { method: "POST", redirect: "error", headers: { Origin: binding.url.origin, "Content-Type": "application/json", Authorization: "Bearer " + binding.token }, body: JSON.stringify(body), signal: AbortSignal.timeout(150000) });
  const reader = r.body.getReader(), chunks = []; let length = 0;
  try { for (;;) { const part = await reader.read(); if (part.done) break; length += part.value.length; assert.ok(length <= 1048576); chunks.push(part.value); } }
  finally { if (length > 1048576) await reader.cancel(); reader.releaseLock(); }
  const value = JSON.parse(Buffer.concat(chunks).toString("utf8")); assert.equal(r.status, 200, "The exact installed metadata journey refused; preserve the original outcome."); return value;
}
const compartment = "authority-validation", store = createSuiteStore();
assert.ok((await store.list()).some(row => row.id === compartment), "Reuse the existing verification workspace; this proof never creates a workspace.");
const selected = await store.selection(), selectedBefore = await api("snapshot", { compartment: selected }), baseline = await api("snapshot", { compartment });
assert.equal(baseline.mode, "keyboard-only");
assert.equal([selectedBefore, baseline].some(s => (s.observations ?? []).some(o => o.status === "recording" || o.status === "paused") || (s.voice ?? []).some(v => v.status === "recording") || (s.conversations ?? []).some(c => c.status === "pending")), false, "Preserve active user work before a native proof.");
assert.equal((baseline.codingSessions ?? []).length, 0, "Preserve existing task bindings; the proof requires the idle validation workspace.");
if (reviewedText) {
  assert.equal((baseline.codingTurns ?? []).length, 0, "Preserve every existing validation turn before the reviewed-text proof.");
  assert.equal([selectedBefore, baseline].some(s => (s.codingTurns ?? []).some(turn => ["reserved", "submitting", "submitted", "outcome-unconfirmed", "cancellation-requested"].includes(turn.status))), false, "Preserve active or unresolved user turns before a native proof.");
}
const definitions = s => hash(JSON.stringify([s.profile, s.profiles, s.workflow, s.roleBindings, s.mode, s.deviceSnapshots, s.deviceTransactions]));
const selectedDefinitions = definitions(selectedBefore), baselineDefinitions = definitions(baseline);
const directory = join(homedir(), ".local/state/strathex-switchyard/runtime-verification"), stage = join(directory, "agent-observation-" + randomUUID()), repositoryRoot = join(stage, "repository"), taskId = randomUUID(), textRequestId = randomUUID();
const nativeDirectory = join(process.env.XDG_STATE_HOME || join(homedir(), ".local/state"), "strathex-switchyard/codex-tasks", compartment);
async function nativeOwners() {
  try { const owner = await linuxProcess(app.pid); if (owner.startTicks !== app.startTicks || owner.uid !== app.uid) return []; }
  catch (error) { if (["ENOENT", "ESRCH"].includes(error.code)) return []; throw error; }
  const queue = [{ pid: app.pid }], seen = new Set(), owners = [];
  while (queue.length) {
    const { pid, parentPid } = queue.shift(); if (seen.has(pid)) continue; seen.add(pid); assert.ok(seen.size <= 128);
    let p, children;
    try { p = await linuxProcess(pid); children = await readFile(`/proc/${pid}/task/${pid}/children`, "utf8"); }
    catch (error) { if (error.code === "ENOENT" || error.code === "ESRCH") continue; throw error; }
    assert.ok(children.length <= 4096); assert.equal(p.uid, app.uid); if (parentPid !== undefined && p.parentPid !== parentPid) continue;
    if (p.executable === nativeExecutable && [nativeDirectory, repositoryRoot].includes(p.cwd)) owners.push({ pid: p.pid, startTicks: p.startTicks, kind: p.cwd === nativeDirectory ? "task-metadata" : "task-text" });
    for (const child of children.trim().split(/\s+/u).filter(Boolean)) { assert.match(child, /^[1-9][0-9]{0,9}$/); queue.push({ pid: Number(child), parentPid: pid }); }
  }
  return owners;
}
assert.deepEqual(await nativeOwners(), [], "A pre-existing native owner must be preserved before this proof.");
const evidence = { schema: reviewedText ? "switchyard-installed-text-observation/v1" : "switchyard-installed-agent-observation/v1", at: new Date().toISOString(), sourceCommit: null, applicationRelease: installed.build, checks: [], workspaceCreated: false, modelPromptsSubmitted: 0, keyboardOpened: false, microphoneOpened: false, nativeTaskCreated: false }; let failure, observationId, captured = [], task, textTurn;
async function captureOwners() { for (const owner of await nativeOwners()) if (!captured.some(old => old.pid === owner.pid && old.startTicks === owner.startTicks)) captured.push(owner); }
try {
  for (const path of ["tools/layout-studio/agent-observation.mjs", "tools/layout-studio/reviewed-task-text.mjs", "tools/layout-studio/codex-submissions.mjs", "tools/layout-studio/codex-turn.mjs", "tools/layout-studio/coding-sessions.mjs", "tools/layout-studio/claude-coding.mjs", "tools/layout-studio/custom-agents.mjs", "tools/layout-studio/suite.mjs", "tools/layout-studio/suite-store.mjs"]) assert.equal(hash(await readFile(join(installationRoot(), "versions", installed.build, path))), hash(await readFile(new URL("../" + path, import.meta.url))));
  const manifest = JSON.parse(await readFile(join(installationRoot(), "versions", installed.build, "switchyard-release.json"), "utf8")); evidence.sourceCommit = manifest.sourceCommit;
  evidence.checks.push("the normal installed release contains the exact collector, task adapters and privacy routes");
  await privateDirectory(repositoryRoot); await execute("/usr/bin/git", ["init", "-b", "main"], { cwd: repositoryRoot, env: { PATH: "/usr/bin:/bin", HOME: "/nonexistent", GIT_CONFIG_NOSYSTEM: "1", GIT_CONFIG_GLOBAL: "/dev/null", GIT_TERMINAL_PROMPT: "0" }, timeout: 10000 });
  await api("compartment/select", { compartment }); await api("mode", { compartment, mode: "personal-companion" });
  const observation = await api("observation/start", { compartment, consent: true, sources: ["agent-events"], exclusions: [] }); observationId = observation.id;
  evidence.nativeTaskCreationAttempted = true; evidence.nativeTaskCreated = null;
  task = await api("coding/codex/create", { compartment, requestId: taskId, repositoryRoot, label: "Synthetic local metadata observation" }); assert.equal(task.modelPromptSubmitted, false); assert.ok(task.sessionId); evidence.nativeTaskCreated = true;
  await api("coding/codex/status", { compartment, id: taskId }); await api("coding/codex/status", { compartment, id: taskId });
  let rows = (await api("snapshot", { compartment })).observations.find(o => o.id === observationId).events;
  assert.deepEqual(rows.map(row => row.phase), ["request-reserved", "identity-bound", "status-observed"]); assert.equal(rows[0].provenance, "switchyard-local-lifecycle"); assert.equal(rows[2].provenance, "native-provider-status-observation"); assert.ok(rows.every(row => row.taskCompletionVerified === false && row.timeSavingMeasured === false));
  for (const privateValue of [taskId, task.sessionId, repositoryRoot, task.label, task.accountFingerprint]) assert.equal(JSON.stringify(rows).includes(privateValue), false);
  evidence.events = rows; evidence.nativeSessionDigest = hash(task.sessionId); evidence.checks.push("one empty native account-bound task records only local lifecycle and provider-status metadata; identical polls collapse");
  await captureOwners();
  if (reviewedText) {
    const input = { compartment, taskId, text: "Synthetic metadata transport check only. Reply with exactly the single word Ready. Do not call tools, inspect files, execute commands or do other work." };
    const review = await api("coding/codex/turns/review", input); assert.equal(review.modelPromptSubmitted, false); assert.equal(review.scope.sessionId, task.sessionId); assert.equal(review.scope.repositoryRoot, repositoryRoot);
    assert.deepEqual((await api("snapshot", { compartment })).observations.find(o => o.id === observationId).events, rows);
    const submission = { ...input, requestId: textRequestId, token: review.confirmation.token }; evidence.modelSubmissionAttempted = true; evidence.modelPromptsSubmitted = null;
    let finished = false;
    const pending = api("coding/codex/turns/submit", submission).finally(() => { finished = true; }); void pending.catch(() => undefined);
    while (!finished) { await captureOwners(); await new Promise(resolve => setTimeout(resolve, 100)); }
    textTurn = await pending; assert.equal(textTurn.status, "provider-turn-completed"); assert.equal(textTurn.nativeSessionVerified, true); assert.equal(textTurn.nativeTurnIdSupported, true); assert.equal(textTurn.taskCompletionVerified, false); evidence.modelPromptsSubmitted = 1; assert.equal(textTurn.reply.trim(), "Ready");
    rows = (await api("snapshot", { compartment })).observations.find(o => o.id === observationId).events;
    assert.deepEqual(rows.slice(3).map(row => row.phase), ["text-request-reserved", "text-identity-bound", "text-reply-recorded"]);
    assert.ok(rows.slice(3).every(row => row.provenance === "switchyard-local-lifecycle" && row.taskCompletionVerified === false && row.timeSavingMeasured === false));
    assert.equal(new Set(rows.slice(3).map(row => row.subjectDigest)).size, 1); assert.notEqual(rows[0].subjectDigest, rows[3].subjectDigest);
    for (const value of [taskId, task.sessionId, task.accountFingerprint, task.label, repositoryRoot, textRequestId, textTurn.turnId, input.text, textTurn.reply]) assert.equal(JSON.stringify(rows).includes(value), false);
    const duplicate = await api("coding/codex/turns/submit", submission); assert.equal(duplicate.duplicatePrevented, true); assert.equal(duplicate.turnId, textTurn.turnId);
    assert.deepEqual((await api("snapshot", { compartment })).observations.find(o => o.id === observationId).events, rows);
    evidence.events = rows; evidence.nativeTurnDigest = hash(textTurn.turnId); evidence.replySha256 = hash(textTurn.reply); evidence.duplicateReturnedSavedResult = true;
    evidence.checks.push("one separately reviewed native turn records three local text phases with distinct correlation and no content; duplicate submission adds no turn or events");
  }
  await api("observation/state", { compartment, id: observationId, status: "paused" }); await api("coding/codex/status", { compartment, id: taskId });
  assert.deepEqual((await api("snapshot", { compartment })).observations.find(o => o.id === observationId).events, rows); evidence.checks.push("pause preserves original events and prevents later status collection");
  await captureOwners(); assert.ok(captured.length >= 1); evidence.retainedNativeMetadataOwners = (await nativeOwners()).filter(owner => owner.kind === "task-metadata").length; evidence.capturedNativeOwners = captured.length; evidence.capturedTextOwners = captured.filter(owner => owner.kind === "task-text").length;
} catch (error) { failure = error; }
finally {
  const safely = async (phase, fn) => {
    try { await fn(); return true; }
    catch (error) { failure ??= error; evidence.cleanupFailure = true; (evidence.cleanupFailures ??= []).push({ phase, category: error.name }); return false; }
  };
  await safely("capture-owned-native", async () => { if (!captured.length && evidence.nativeTaskCreationAttempted) await captureOwners(); });
  await safely("stop-recording", async () => { if (observationId) await api("observation/state", { compartment, id: observationId, status: "stopped" }); });
  await safely("stop-owned-compartment", () => api("mode", { compartment, mode: "keyboard-only" }));
  await safely("verify-native-exit", async () => {
    for (const owner of captured) {
      let exited = false; const deadline = Date.now() + 5000;
      while (Date.now() < deadline) {
        try { const p = await linuxProcess(owner.pid); if (p.startTicks !== owner.startTicks || p.state === "Z") { exited = true; break; } }
        catch (error) { if (["ENOENT", "ESRCH"].includes(error.code)) { exited = true; break; } throw error; }
        await new Promise(resolve => setTimeout(resolve, 50));
      }
      assert.equal(exited, true);
    }
    assert.deepEqual(await nativeOwners(), []); evidence.nativeMetadataExitVerified = true;
  });
  if (!failure && evidence.nativeMetadataExitVerified) await safely("retire-owned-proof", async () => {
    if (textTurn) { const deleted = await api("coding/codex/turns/delete", { compartment, id: textRequestId }); assert.equal(deleted.deleted, true); }
    if (observationId) await api("observation/delete", { compartment, id: observationId });
    await store.update(compartment, "synthetic-observation-cleanup", state => { state.codingSessions = (state.codingSessions ?? []).filter(row => row.id !== taskId); });
    await rm(stage, { recursive: true }); evidence.ownedStagingRemoved = true;
  });
  await safely("restore-selection-and-definitions", async () => {
    if (await store.selection() === compartment) await api("compartment/select", { compartment: selected });
    // Preserve fresh mode fences and normal audit bookkeeping.
    const restored = await api("snapshot", { compartment: selected });
    if (selected !== compartment) assert.equal(definitions(restored), selectedDefinitions);
    assert.equal(definitions(await api("snapshot", { compartment })), baselineDefinitions); assert.equal(await store.selection(), selected); await current();
    const home = await fetch(binding.url.origin, { redirect: "error", signal: AbortSignal.timeout(15000) }); assert.equal(hash(await home.text()), "20ba0095a6b9650046df34541872aa7e0a7cdc7db5182f065abb009127c6c130");
    evidence.originalDefinitionsSelectionAndFrozenHomePreserved = true;
  });
  if (!failure) evidence.checks.push("exact native processes exited, only this proof's records/staging were retired, and definitions/selection/frozen Home were preserved");
}
if (failure) evidence.failure = failure.message.replaceAll(binding.url.origin, "[local application]").replaceAll(binding.token, "[redacted]").slice(0, 512);
evidence.success = !failure; await privateDirectory(directory); const receipt = join(directory, (reviewedText ? "installed-text-observation-" : "installed-agent-observation-") + Date.now() + ".json"); await privateWrite(receipt, JSON.stringify(evidence, null, 2) + "\n");
console.log(JSON.stringify({ success: !failure, receipt, checks: evidence.checks.length, workspaceCreated: false, modelPromptsSubmitted: evidence.modelPromptsSubmitted, nativeMetadataExitVerified: evidence.nativeMetadataExitVerified ?? false, ownedStagingRemoved: evidence.ownedStagingRemoved ?? false, failure: evidence.failure ?? null })); if (failure) process.exitCode = 1;
