#!/usr/bin/env node
/** Exercise the actual installed-account task API using one durable empty task. */
import assert from "node:assert/strict";
import { readFile, realpath } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import { privateRead, privateWrite } from "../tools/layout-studio/private-fs.mjs";
import { runtimeDirectory } from "../tools/layout-studio/physical-intent.mjs";
if (process.argv.length !== 4 || process.argv[2] !== "--create-empty-and-stop") throw new Error("Usage: node scripts/verify-claude-host.mjs --create-empty-and-stop /absolute/trusted/private/git/repository (creates one empty tools-disabled background task, reviews its exact stop, stops it and tests replay rejection)");
const repositoryRoot = await realpath(process.argv[3]), directory = join(process.env.XDG_STATE_HOME || join(homedir(), ".local/state"), "strathex-switchyard/runtime-verification"), requestPath = join(directory, "claude-suite-request.json");
let request;
try { request = JSON.parse(await privateRead(requestPath)); }
catch (e) { if (e.code !== "ENOENT") throw e; request = { requestId: randomUUID(), repositoryRoot, label: "Synthetic empty Claude task acceptance" }; await privateWrite(requestPath, JSON.stringify(request) + "\n"); }
if (request.repositoryRoot !== repositoryRoot) throw new Error("The durable acceptance request belongs to another exact directory. Preserve it; do not silently create a second task.");
const endpoint = JSON.parse(await readFile(join(runtimeDirectory(), "active.json"), "utf8")), url = new URL(endpoint.url), token = /^#access=([A-Za-z0-9_-]{43})$/.exec(url.hash)?.[1];
if (!token || url.protocol !== "http:" || url.hostname !== "127.0.0.1") throw new Error("Start the private local suite first.");
const compartment = "host-validation", results = []; let failure, enabled = false;
async function api(path, body = {}) { const r = await fetch(new URL(path, url.origin), { method: "POST", headers: { Authorization: `Bearer ${token}`, Origin: url.origin, "Content-Type": "application/json" }, body: JSON.stringify({ compartment, ...body }), signal: AbortSignal.timeout(90000) }); const value = await r.json(); if (!r.ok) throw new Error(value.error); return value; }
try {
  await api("/api/suite/bootstrap"); await api("/api/suite/compartment/create", { policy: "personal" }); enabled = true;
  await api("/api/suite/mode", { mode: "personal-companion" });
  const discovery = await api("/api/suite/coding/claude/discovery"); assert.equal(discovery.available, true, discovery.reason);
  const task = await api("/api/suite/coding/claude/create", request);
  assert.equal(task.status, "registered"); assert.equal(task.launchPolicy, "tools-disabled/plan");
  assert.equal((await api("/api/suite/coding/claude/create", request)).duplicatePrevented, true);
  const observed = await api("/api/suite/coding/claude/status", { id: task.id }); assert.equal(observed.sessionId, task.sessionId); assert.equal(observed.observation.completionVerified, false);
  results.push({ scenario: "actual-empty-task", version: discovery.version, exactSessionObserved: true, duplicatePrevented: true, modelPromptSubmitted: false });
  const review = await api("/api/suite/coding/claude/stop/review", { id: task.id });
  if (review.effect !== "already-stopped") {
    assert.equal(review.status, "requires-confirmation");
    const stopped = await api("/api/suite/coding/claude/stop", { id: task.id, token: review.confirmation.token });
    assert.equal(stopped.effect, "provider-reported-stopped");
    await assert.rejects(api("/api/suite/coding/claude/stop", { id: task.id, token: review.confirmation.token }), /already been consumed/);
    results.push({ scenario: "reviewed-exact-stop", providerReadbackStopped: true, replayRejected: true, taskCompletionVerified: false });
  } else results.push({ scenario: "previous-acceptance-task", providerReadbackStopped: true, duplicateTaskNotCreated: true });
} catch (e) { failure = e; }
finally {
  if (enabled) try { assert.equal((await api("/api/suite/mode", { mode: "keyboard-only" })).ownedProcessesStopped, true); } catch (e) { failure ??= e; }
  const evidence = join(directory, `claude-suite-${Date.now()}.json`);
  await privateWrite(evidence, JSON.stringify({ at: new Date().toISOString(), results, failure: failure?.message ?? null, modelPromptSubmitted: false, hardwareAcceptance: false }, null, 2) + "\n");
  console.log(JSON.stringify({ evidence, scenarios: results.length, failure: failure?.message ?? null, modelPromptSubmitted: false, hardwareAcceptance: false }));
}
if (failure) throw failure;
