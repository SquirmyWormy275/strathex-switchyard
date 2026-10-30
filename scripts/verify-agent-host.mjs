#!/usr/bin/env node
/** Real local SDK exchange; synthetic work, no model prompt, HID or microphone. */
import { readFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";
import assert from "node:assert/strict";
import { runtimeDirectory } from "../tools/layout-studio/physical-intent.mjs";
import { privateWrite } from "../tools/layout-studio/private-fs.mjs";
if (process.argv.length !== 3 || process.argv[2] !== "--start-and-stop") throw new Error("Usage: node scripts/verify-agent-host.mjs --start-and-stop (runs synthetic bundled examples in the host-validation workspace, then selects keyboard-only there)");
const endpoint = JSON.parse(await readFile(join(runtimeDirectory(), "active.json"), "utf8")), url = new URL(endpoint.url), token = /^#access=([A-Za-z0-9_-]{43})$/.exec(url.hash)?.[1];
if (!token || url.protocol !== "http:" || url.hostname !== "127.0.0.1") throw new Error("Start the private local suite first.");
const compartment = "host-validation", results = []; let failure, enabledByCheck = false;
async function api(path, body = {}) { const r = await fetch(new URL(path, url.origin), { method: "POST", headers: { Authorization: `Bearer ${token}`, Origin: url.origin, "Content-Type": "application/json" }, body: JSON.stringify({ compartment, ...body }), signal: AbortSignal.timeout(30000) }); const value = await r.json(); if (!r.ok) throw new Error(value.error); return value; }
async function until(fn) { const deadline = Date.now() + 20000; while (Date.now() < deadline) { const value = await fn(); if (value) return value; await new Promise((r) => setTimeout(r, 100)); } throw new Error("The real SDK exchange did not become observable within its bounded host check."); }
try {
  await api("/api/suite/bootstrap");
  await api("/api/suite/compartment/create", { policy: "personal" });
  const before = await api("/api/suite/snapshot");
  if (before.agents.some((a) => a.lastSeen && Date.now() - a.lastSeen < 30000 && a.reportedStatus !== "stopped")) throw new Error("The validation workspace already has a live adapter; leave it undisturbed.");
  enabledByCheck = true;
  await api("/api/suite/mode", { mode: "personal-companion" });
  for (const example of ["custom", "langchain"]) {
    const at = Date.now();
    const simultaneous = await Promise.all([api("/api/suite/agents/example", { example }), api("/api/suite/agents/example", { example })]);
    assert.equal(simultaneous.filter((r) => r.status === "starting").length, 1);
    assert.equal(simultaneous.filter((r) => r.duplicatePrevented).length, 1);
    const agent = await until(async () => (await api("/api/suite/snapshot")).agents.find((a) => a.id === `${example}-example` && a.protocolVersion === 2 && a.reportedStatus === "ready" && a.lastSeen >= at));
    assert.equal((await api("/api/suite/agents/example", { example })).duplicatePrevented, true);
    const queued = await api("/api/suite/agents/dispatch", { agentId: agent.id, sessionId: agent.sessionId, intent: "review" });
    await until(async () => (await api("/api/suite/snapshot")).agents.find((a) => a.id === agent.id)?.commands.find((c) => c.id === queued.commandId && c.status === "completed"));
    results.push({ example, protocol: 2, authenticatedReady: true, duplicatePrevented: true, exactReviewAcknowledged: true, evidence: "real application self-report, not independent coding-task completion" });
  }
} catch (error) { failure = error; }
finally {
  if (enabledByCheck) {
    try { const stopped = await api("/api/suite/mode", { mode: "keyboard-only" }); assert.equal(stopped.ownedProcessesStopped, true); results.push({ scenario: "keyboard-only", ownedProcessesStopped: true }); } catch (error) { failure ??= error; }
  }
  const path = join(process.env.XDG_STATE_HOME || join(homedir(), ".local/state"), "strathex-switchyard/runtime-verification", `sdk-v2-${Date.now()}.json`);
  await privateWrite(path, JSON.stringify({ schema: "switchyard-sdk-host-evidence/v1", at: new Date().toISOString(), results, failure: failure?.message ?? null, modelPrompt: false, hardwareAcceptance: false }, null, 2) + "\n");
  console.log(JSON.stringify({ evidence: path, examples: results.filter((r) => r.exactReviewAcknowledged).length, stopped: results.some((r) => r.ownedProcessesStopped), failure: failure?.message ?? null, hardwareAcceptance: false }));
}
if (failure) throw failure;
