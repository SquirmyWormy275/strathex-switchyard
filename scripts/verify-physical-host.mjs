#!/usr/bin/env node
/** Explicit host trial, with dated transaction backups and restoration in finally.
 * Uses synthetic planning keys; does not open/write a keyboard or claim F77 input.
 */
import { readFile, mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { homedir } from "node:os";
import { createHash } from "node:crypto";
import { runtimeDirectory, dispatchPhysicalIntent } from "../tools/layout-studio/physical-intent.mjs";
if (process.argv.length !== 3 || process.argv[2] !== "--apply-and-restore") throw new Error("Usage: node scripts/verify-physical-host.mjs --apply-and-restore (temporarily registers Super+Ctrl+1/2, trials owned actions, restores in finally)");
if (process.platform !== "linux") throw new Error("This live host acceptance script currently targets Omarchy Linux.");
const root = runtimeDirectory(), endpoint = JSON.parse(await readFile(join(root, "active.json"), "utf8")), url = new URL(endpoint.url), token = /^#access=([A-Za-z0-9_-]{43})$/.exec(url.hash)?.[1];
if (!token || url.protocol !== "http:" || url.hostname !== "127.0.0.1") throw new Error("Open the running private local workspace first.");
async function api(path, body = {}) { const r = await fetch(new URL(path, url.origin), { method: "POST", headers: { Authorization: `Bearer ${token}`, Origin: url.origin, "Content-Type": "application/json" }, body: JSON.stringify(body), signal: AbortSignal.timeout(150000) }); const value = await r.json(); if (!r.ok) throw new Error(value.error); return value; }
const config = join(process.env.XDG_CONFIG_HOME || join(homedir(), ".config"), "hypr/bindings.lua"), before = await readFile(config), digest = (b) => createHash("sha256").update(b).digest("hex");
const original = (await api("/api/suite/bootstrap")).activeCompartment, compartment = "host-validation", applied = [], results = [];
const plan = { schema: "sxsy-agentic-layout-plan/v1", profile: { schema: "sxsy-board-profile/v1", name: "Synthetic host acceptance keys · not hardware evidence", layout: "host-trial", keys: [1, 2].map((n) => ({ id: `key-${n}`, label: String(n), matrix: [0, n - 1], x: n - 1, y: 0, baseKeycode: `KC_${n}` })) }, actions: ["native", "role"].map((id, i) => ({ id, label: id === "native" ? "Show ChatGPT" : "Inspect exact example", family: "routing", consequence: "navigation", confirmation: false, frequencyPerDay: 0, secondsSaved: 0, binding: { keyId: `key-${i + 1}`, modifier: "gui_ctrl" } })), study: null };
let failure;
try {
  await api("/api/suite/compartment/create", { compartment, policy: "personal" }); await api("/api/suite/compartment/select", { compartment });
  await api("/api/suite/mode", { compartment, mode: "personal-companion" });
  await api("/api/suite/workflow/save", { compartment, workflow: { name: "Synthetic host verification", roles: [{ id: "builder", label: "Synthetic builder" }], steps: ["Check registered dispatch"] } });
  await api("/api/suite/agents/example", { compartment, example: "custom" });
  const deadline = Date.now() + 10000; let agent;
  while (Date.now() < deadline) { agent = (await api("/api/suite/snapshot", { compartment })).agents.find((a) => a.id === "custom-example" && a.reportedStatus === "ready"); if (agent) break; await new Promise((resolve) => setTimeout(resolve, 100)); }
  if (!agent) throw new Error("The owned custom example did not publish a ready session.");
  await api("/api/suite/roles/bind", { compartment, roleId: "builder", provider: "custom-agent", targetId: "custom-example", intent: "status" });
  for (const [actionId, implementation, target] of [["native", "native-chatgpt.focus/v1", null], ["role", "switchyard.role/v1", { roleId: "builder", intent: "status" }]]) {
    let review;
    try { review = await api("/api/review", { compartment, plan, actionId, implementation, target }); }
    catch (error) { if (actionId === "native" && /Open one native ChatGPT main window/.test(error.message)) { results.push({ actionId, status: "surface-unavailable", reason: error.message, acceptance: false }); continue; } throw error; }
    const tx = await api("/api/apply", { compartment, reviewId: review.reviewId }); applied.push(tx.id);
    const trial = await api("/api/trial", { compartment, id: tx.id });
    if (trial.trial !== "verified") throw new Error("Registered-dispatch trial was not verified.");
    results.push({ actionId, shortcut: trial.shortcut, transactionId: tx.id, registration: trial.status, dispatch: trial.trial, boundary: "compositor dispatcher and authenticated local intent; no physical keyboard or external task completion claim" });
  }
  await api("/api/suite/compartment/create", { compartment: "host-work-policy", policy: "work" });
  await api("/api/suite/mode", { compartment: "host-work-policy", mode: "managed-companion" });
  await api("/api/suite/compartment/select", { compartment: "host-work-policy" });
  let rejected = false; try { await dispatchPhysicalIntent({ implementation: "native-chatgpt.focus/v1" }); } catch { rejected = true; }
  if (!rejected) throw new Error("Work policy did not reject the personal physical intent.");
  results.push({ scenario: "active-work-policy", status: "rejected-personal-native-intent", networkAccount: "no tenant contacted" });
} catch (error) { failure = error; }
finally {
  for (const id of applied.toReversed()) { try { await api("/api/restore", { id }); } catch (error) { failure ??= error; } }
  try { await api("/api/suite/agents/example/stop", { compartment, example: "custom" }); } catch (error) { failure ??= error; }
  try { await api("/api/suite/compartment/select", { compartment: original }); } catch (error) { failure ??= error; }
  const after = await readFile(config), restored = digest(before) === digest(after);
  const evidence = { schema: "switchyard-host-acceptance/v1", at: new Date().toISOString(), restoredExactly: restored, beforeSha256: digest(before), afterSha256: digest(after), results, failure: failure ? failure.message : null, hardwareAcceptance: false };
  const directory = join(process.env.XDG_STATE_HOME || join(homedir(), ".local/state"), "strathex-switchyard/suite-evidence"); await mkdir(directory, { recursive: true, mode: 0o700 }); const path = join(directory, `physical-host-${Date.now()}.json`); await writeFile(path, JSON.stringify(evidence, null, 2) + "\n", { mode: 0o600 });
  console.log(JSON.stringify({ evidence: path, restoredExactly: restored, verifiedScenarios: results.filter((r) => r.dispatch === "verified" || r.status === "rejected-personal-native-intent").length, unavailableScenarios: results.filter((r) => r.status === "surface-unavailable").length, failure: evidence.failure, hardwareAcceptance: false }));
  if (!restored) failure ??= new Error("The complete host binding file was not restored exactly. Inspect the dated recovery records.");
}
if (failure) throw failure;
