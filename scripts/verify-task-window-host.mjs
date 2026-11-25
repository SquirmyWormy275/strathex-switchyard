#!/usr/bin/env node
/** Opens one owned empty native session, verifies exact focus and restores focus. */
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { readFile, realpath } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import { trustedCli } from "../tools/layout-studio/agents.mjs";
import { runHypr } from "../tools/layout-studio/host.mjs";
import { runtimeEnvironment } from "../tools/layout-studio/runtime-setup.mjs";
import { runtimeDirectory } from "../tools/layout-studio/physical-intent.mjs";
import { privateWrite } from "../tools/layout-studio/private-fs.mjs";
import { stopOwnedChild } from "../tools/layout-studio/owned-process.mjs";
if (process.platform !== "linux" || process.argv.length !== 4 || process.argv[2] !== "--open-and-close-owned-claude-window") throw new Error("Usage on Omarchy: node scripts/verify-task-window-host.mjs --open-and-close-owned-claude-window /absolute/trusted/private/git/repository");
if (!process.env.XDG_RUNTIME_DIR || !process.env.WAYLAND_DISPLAY) throw new Error("The current desktop Wayland session is required for this native window trial.");
const repositoryRoot = await realpath(process.argv[3]), original = JSON.parse(await runHypr("activewindow", "-j")), sessionId = randomUUID(), compartment = "host-validation";
const endpoint = JSON.parse(await readFile(join(runtimeDirectory(), "active.json"), "utf8")), url = new URL(endpoint.url), token = /^#access=([A-Za-z0-9_-]{43})$/.exec(url.hash)?.[1];
if (!token || url.protocol !== "http:" || url.hostname !== "127.0.0.1") throw new Error("Start the private local suite first.");
async function api(path, body = {}) { const r = await fetch(new URL(path, url.origin), { method: "POST", headers: { Authorization: `Bearer ${token}`, Origin: url.origin, "Content-Type": "application/json" }, body: JSON.stringify({ compartment, ...body }), signal: AbortSignal.timeout(90000) }); const value = await r.json(); if (!r.ok) throw new Error(value.error); return value; }
let child, task, result, failure, enabled = false, restored = false, stopConfirmed = false;
let inventoryDiagnostic;
let startupUnverified = 0;
try {
  await api("/api/suite/bootstrap"); await api("/api/suite/compartment/create", { policy: "personal" }); enabled = true; await api("/api/suite/mode", { mode: "personal-companion" });
  child = spawn("/usr/bin/foot", ["--app-id", `switchyard-claude-contract-${sessionId}`, "--title", "Switchyard · empty Claude focus check", "--working-directory", repositoryRoot, "--", await trustedCli("claude-code"), "--session-id", sessionId, "--safe-mode", "--tools", "", "--strict-mcp-config", "--mcp-config", '{"mcpServers":{}}', "--setting-sources", "", "--settings", '{"disableAllHooks":true}', "--permission-mode", "plan", "--no-chrome"], { shell: false, env: { ...runtimeEnvironment(), XDG_RUNTIME_DIR: process.env.XDG_RUNTIME_DIR, WAYLAND_DISPLAY: process.env.WAYLAND_DISPLAY, DISABLE_TELEMETRY: "1", DISABLE_ERROR_REPORTING: "1", CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC: "1" }, stdio: ["ignore", "ignore", "ignore"] });
  await new Promise((resolve, reject) => { child.once("spawn", resolve); child.once("error", reject); });
  const deadline = Date.now() + 20000; let row;
  while (Date.now() < deadline && child.exitCode === null) {
    try { row = (await api("/api/suite/coding/claude/inventory", { repositoryRoot })).find((r) => r.sessionId === sessionId && r.kind === "interactive" && r.pid); }
    catch (e) {
      if (/Claude returned an unsupported/.test(e.message)) { startupUnverified++; await new Promise((r) => setTimeout(r, 150)); continue; }
      const p = spawn(await trustedCli("claude-code"), ["agents", "--json", "--all", "--cwd", repositoryRoot], { stdio: ["ignore", "pipe", "ignore"], env: runtimeEnvironment() }); let text = "";
      const timer = setTimeout(() => p.kill(), 10000);
      try { for await (const b of p.stdout) { text += b; if (text.length > 262144) { p.kill(); break; } } inventoryDiagnostic = JSON.parse(text).map((r) => ({ fields: Object.keys(r), kind: r.kind, status: /^[a-z-]{1,30}$/.test(r.status ?? "") ? r.status : typeof r.status, state: /^[a-z-]{1,30}$/.test(r.state ?? "") ? r.state : typeof r.state, integerStartedAt: Number.isSafeInteger(r.startedAt), integerPid: Number.isSafeInteger(r.pid), fullUuid: /^[a-f0-9]{8}-[a-f0-9-]{27}$/.test(r.sessionId ?? ""), exactDirectory: r.cwd === repositoryRoot })); }
      finally { clearTimeout(timer); }
      throw e;
    }
    if (row) break; await new Promise((r) => setTimeout(r, 100));
  }
  if (!row) throw new Error("The owned empty interactive session did not appear in native inventory.");
  task = await api("/api/suite/coding/claude/bind", { sessionId, repositoryRoot, label: "Synthetic native focus acceptance" });
  result = await api("/api/suite/coding/claude/focus", { id: task.id }); assert.equal(result.windowFocusVerified, true); assert.equal(result.taskResumptionVerified, false); assert.equal(result.modelPromptSubmitted, false);
  const again = await api("/api/suite/coding/claude/focus", { id: task.id }); assert.equal(again.sessionId, sessionId); assert.equal(again.windowFocusVerified, true);
} catch (e) { failure = e; }
finally {
  stopConfirmed = (await stopOwnedChild(child)).stopped;
  if (!stopConfirmed) failure ??= new Error("Owned diagnostic Foot window exit was not confirmed.");
  if (enabled) try { await api("/api/suite/mode", { mode: "keyboard-only" }); } catch (e) { failure ??= e; }
  try { const windows = JSON.parse(await runHypr("clients", "-j")); if (/^0x[a-f0-9]+$/i.test(original.address) && windows.some((w) => w.address === original.address && w.pid === original.pid)) { await runHypr("dispatch", `hl.dsp.focus({ window = "address:${original.address}" })`); const after = JSON.parse(await runHypr("activewindow", "-j")); restored = after.address === original.address && after.pid === original.pid; } } catch (e) { failure ??= e; }
  const path = join(process.env.XDG_STATE_HOME || join(homedir(), ".local/state"), "strathex-switchyard/runtime-verification", `claude-window-${Date.now()}.json`);
  await privateWrite(path, JSON.stringify({ at: new Date().toISOString(), windowFocusVerified: result?.windowFocusVerified === true, repeatUsedSameSession: !failure && Boolean(result), taskResumptionVerified: false, modelPromptSubmitted: false, ownedTerminalExited: stopConfirmed, originalFocusRestored: restored, startupUnverified, inventoryDiagnostic, failure: failure?.message ?? null }, null, 2) + "\n");
  console.log(JSON.stringify({ evidence: path, windowFocusVerified: result?.windowFocusVerified === true, ownedTerminalExited: stopConfirmed, originalFocusRestored: restored, inventoryDiagnostic, failure: failure?.message ?? null }));
}
if (failure) throw failure;
