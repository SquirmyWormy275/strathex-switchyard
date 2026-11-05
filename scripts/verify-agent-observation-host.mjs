#!/usr/bin/env node
/** One empty native task in an existing validation workspace. No model request. */
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

if (process.platform !== "linux" || process.argv.length !== 3 || process.argv[2] !== "--synthetic-native-metadata") throw Error("Usage on the pilot: node scripts/verify-agent-observation-host.mjs --synthetic-native-metadata (one empty Codex task; no model prompt)");
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
const definitions = s => hash(JSON.stringify([s.profile, s.profiles, s.workflow, s.roleBindings, s.mode, s.deviceSnapshots, s.deviceTransactions]));
const selectedDefinitions = definitions(selectedBefore), baselineDefinitions = definitions(baseline);
const directory = join(homedir(), ".local/state/strathex-switchyard/runtime-verification"), stage = join(directory, "agent-observation-" + randomUUID()), repositoryRoot = join(stage, "repository"), taskId = randomUUID();
const nativeDirectory = join(process.env.XDG_STATE_HOME || join(homedir(), ".local/state"), "strathex-switchyard/codex-tasks", compartment);
async function nativeOwners() {
  const queue = [{ pid: app.pid }], seen = new Set(), owners = [];
  while (queue.length) {
    const { pid, parentPid } = queue.shift(); if (seen.has(pid)) continue; seen.add(pid); assert.ok(seen.size <= 128);
    let p, children;
    try { p = await linuxProcess(pid); children = await readFile(`/proc/${pid}/task/${pid}/children`, "utf8"); }
    catch (error) { if (error.code === "ENOENT" || error.code === "ESRCH") continue; throw error; }
    assert.ok(children.length <= 4096); assert.equal(p.uid, app.uid); if (parentPid !== undefined && p.parentPid !== parentPid) continue;
    if (p.executable === nativeExecutable && p.cwd === nativeDirectory) owners.push({ pid: p.pid, startTicks: p.startTicks });
    for (const child of children.trim().split(/\s+/u).filter(Boolean)) { assert.match(child, /^[1-9][0-9]{0,9}$/); queue.push({ pid: Number(child), parentPid: pid }); }
  }
  return owners;
}
assert.deepEqual(await nativeOwners(), [], "A pre-existing native owner must be preserved before this proof.");
const evidence = { schema: "switchyard-installed-agent-observation/v1", at: new Date().toISOString(), sourceCommit: null, applicationRelease: installed.build, checks: [], workspaceCreated: false, modelPromptsSubmitted: 0, keyboardOpened: false, microphoneOpened: false, nativeTaskCreated: false }; let failure, observationId, captured = [], task;
try {
  for (const path of ["tools/layout-studio/agent-observation.mjs", "tools/layout-studio/coding-sessions.mjs", "tools/layout-studio/claude-coding.mjs", "tools/layout-studio/custom-agents.mjs", "tools/layout-studio/suite.mjs", "tools/layout-studio/suite-store.mjs"]) assert.equal(hash(await readFile(join(installationRoot(), "versions", installed.build, path))), hash(await readFile(new URL("../" + path, import.meta.url))));
  const manifest = JSON.parse(await readFile(join(installationRoot(), "versions", installed.build, "switchyard-release.json"), "utf8")); evidence.sourceCommit = manifest.sourceCommit;
  evidence.checks.push("the normal installed release contains the exact collector, task adapters and privacy routes");
  await privateDirectory(repositoryRoot); await execute("/usr/bin/git", ["init", "-b", "main"], { cwd: repositoryRoot, env: { PATH: "/usr/bin:/bin", HOME: "/nonexistent", GIT_CONFIG_NOSYSTEM: "1", GIT_CONFIG_GLOBAL: "/dev/null", GIT_TERMINAL_PROMPT: "0" }, timeout: 10000 });
  await api("compartment/select", { compartment }); await api("mode", { compartment, mode: "personal-companion" });
  const observation = await api("observation/start", { compartment, consent: true, sources: ["agent-events"], exclusions: [] }); observationId = observation.id;
  task = await api("coding/codex/create", { compartment, requestId: taskId, repositoryRoot, label: "Synthetic local metadata observation" }); assert.equal(task.modelPromptSubmitted, false); assert.ok(task.sessionId); evidence.nativeTaskCreated = true;
  await api("coding/codex/status", { compartment, id: taskId }); await api("coding/codex/status", { compartment, id: taskId });
  let rows = (await api("snapshot", { compartment })).observations.find(o => o.id === observationId).events;
  assert.deepEqual(rows.map(row => row.phase), ["request-reserved", "identity-bound", "status-observed"]); assert.equal(rows[0].provenance, "switchyard-local-lifecycle"); assert.equal(rows[2].provenance, "native-provider-status-observation"); assert.ok(rows.every(row => row.taskCompletionVerified === false && row.timeSavingMeasured === false));
  for (const privateValue of [taskId, task.sessionId, repositoryRoot, task.label, task.accountFingerprint]) assert.equal(JSON.stringify(rows).includes(privateValue), false);
  evidence.events = rows; evidence.nativeSessionDigest = hash(task.sessionId); evidence.checks.push("one empty native account-bound task records only local lifecycle and provider-status metadata; identical polls collapse");
  await api("observation/state", { compartment, id: observationId, status: "paused" }); await api("coding/codex/status", { compartment, id: taskId });
  assert.deepEqual((await api("snapshot", { compartment })).observations.find(o => o.id === observationId).events, rows); evidence.checks.push("pause preserves original events and prevents later status collection");
  captured = await nativeOwners(); assert.ok(captured.length >= 1); evidence.retainedNativeMetadataOwners = captured.length;
} catch (error) { failure = error; }
finally {
  try {
    if (!captured.length && evidence.nativeTaskCreated) captured = await nativeOwners();
    if (observationId) await api("observation/state", { compartment, id: observationId, status: "stopped" });
    await api("mode", { compartment, mode: "keyboard-only" });
    for (const owner of captured) { let originalAlive = false; try { const p = await linuxProcess(owner.pid); originalAlive = p.startTicks === owner.startTicks && p.state !== "Z"; } catch (error) { if (!["ENOENT", "ESRCH"].includes(error.code)) throw error; } assert.equal(originalAlive, false); }
    assert.deepEqual(await nativeOwners(), []); evidence.nativeMetadataExitVerified = true;
    if (!failure) {
      if (observationId) await api("observation/delete", { compartment, id: observationId });
      await store.update(compartment, "synthetic-observation-cleanup", state => { state.codingSessions = (state.codingSessions ?? []).filter(row => row.id !== taskId); });
      await rm(stage, { recursive: true }); evidence.ownedStagingRemoved = true;
    }
    if (await store.selection() === compartment) await api("compartment/select", { compartment: selected });
    // Normal selection/mode transitions keep their own audit records; preserve definitions.
    const restored = await api("snapshot", { compartment: selected });
    if (selected !== compartment) assert.equal(definitions(restored), selectedDefinitions);
    assert.equal(definitions(await api("snapshot", { compartment })), baselineDefinitions); assert.equal(await store.selection(), selected); await current();
    const home = await fetch(binding.url.origin, { redirect: "error", signal: AbortSignal.timeout(15000) }); assert.equal(hash(await home.text()), "20ba0095a6b9650046df34541872aa7e0a7cdc7db5182f065abb009127c6c130");
    evidence.originalDefinitionsSelectionAndFrozenHomePreserved = true; evidence.checks.push("exact native metadata processes exited, only this proof's records/staging were retired, and definitions/selection/frozen Home were preserved");
  } catch (error) { failure ??= error; evidence.cleanupFailure = true; }
}
if (failure) evidence.failure = failure.message.replaceAll(binding.url.origin, "[local application]").replaceAll(binding.token, "[redacted]").slice(0, 512);
evidence.success = !failure; await privateDirectory(directory); const receipt = join(directory, "installed-agent-observation-" + Date.now() + ".json"); await privateWrite(receipt, JSON.stringify(evidence, null, 2) + "\n");
console.log(JSON.stringify({ success: !failure, receipt, checks: evidence.checks.length, workspaceCreated: false, modelPromptsSubmitted: 0, nativeMetadataExitVerified: evidence.nativeMetadataExitVerified ?? false, ownedStagingRemoved: evidence.ownedStagingRemoved ?? false, failure: evidence.failure ?? null })); if (failure) process.exitCode = 1;
