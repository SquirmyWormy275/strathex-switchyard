#!/usr/bin/env node
/** Installed metadata/refusal proof. No tenant, model, keyboard or new workspace. */
import assert from "node:assert/strict";
import { createHash, randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";
import { applicationStatus, applicationStateRoot } from "../deployment/suite/application.mjs";
import { installationRoot } from "../deployment/suite/installation.mjs";
import { endpointIdentity, requestInstance } from "../tools/layout-studio/instance.mjs";
import { createSuiteStore } from "../tools/layout-studio/suite-store.mjs";
import { privateDirectory, privateRead, privateWrite } from "../tools/layout-studio/private-fs.mjs";

const flags = process.argv.slice(2);
if (process.platform !== "linux" || flags.length !== 1 || flags[0] !== "--read-only-metadata") throw Error("Usage on the pilot: node scripts/verify-copilot-journal-host.mjs --read-only-metadata");
const installed = await applicationStatus(); assert.equal(installed.status, "ready");
const hash = bytes => createHash("sha256").update(bytes).digest("hex");
const endpointFile = join(applicationStateRoot(), "endpoint.json"), endpointBefore = await privateRead(endpointFile), endpoint = JSON.parse(endpointBefore), binding = endpointIdentity(endpoint);
async function current() { assert.equal(await privateRead(endpointFile), endpointBefore); const proof = await requestInstance(endpoint, { timeoutMs: 5000 }); assert.equal(proof.authenticated, true); assert.equal(proof.status, "ready"); }
await current(); // Authenticate this listener before disclosing its bearer.
async function api(path, body, expected = 200, authenticated = true) {
  await current();
  const response = await fetch(new URL("/api/suite/" + path, binding.url.origin), { method: "POST", redirect: "error", headers: { Origin: binding.url.origin, "Content-Type": "application/json", ...(authenticated ? { Authorization: "Bearer " + binding.token } : {}) }, body: JSON.stringify(body), signal: AbortSignal.timeout(15000) });
  const reader = response.body.getReader(), chunks = []; let length = 0;
  try { for (;;) { const { done, value } = await reader.read(); if (done) break; length += value.length; assert.ok(length <= 1048576); chunks.push(value); } }
  finally { if (length > 1048576) await reader.cancel(); reader.releaseLock(); }
  assert.equal(response.status, expected, "The installed fixed metadata/refusal route did not match its contract.");
  return JSON.parse(Buffer.concat(chunks).toString("utf8"));
}
const store = createSuiteStore(), selected = await store.selection(), before = await store.snapshot(selected);
const definitions = state => hash(JSON.stringify([state.profile, state.workflow, state.accounts, state.mode, state.modeSelectedAt, state.deviceSnapshots, state.deviceTransactions]));
const stateRoot = join(process.env.XDG_STATE_HOME || join(homedir(), ".local/state"), "strathex-switchyard/suite"), stateFile = join(stateRoot, selected + ".sealed.json");
const evidence = { schema: "switchyard-installed-copilot-journal-metadata/v1", at: new Date().toISOString(), applicationRelease: installed.build, checks: [], microsoftRequestsMade: 0, modelPromptsSubmitted: 0, keyboardOpened: false, microphoneOpened: false, workspaceCreated: false, frontendChanged: false, tenantAccepted: false }; let failure;
try {
  for (const path of ["tools/layout-studio/copilot.mjs", "tools/layout-studio/copilot-requests.mjs", "tools/layout-studio/suite.mjs", "tools/layout-studio/suite-store.mjs", "tools/layout-studio/confirmations.mjs"]) assert.equal(hash(await readFile(join(installationRoot(), "versions", installed.build, path))), hash(await readFile(new URL("../" + path, import.meta.url))));
  evidence.checks.push("normal installed release contains the exact request journal, account, lifecycle and route source");
  assert.equal((before.observations ?? []).some(row => row.status === "recording") || (before.voice ?? []).some(row => row.status === "recording") || (before.conversations ?? []).some(row => row.status === "pending"), false, "Preserve active user work before normal workspace initialization.");
  const snapshot = await api("snapshot", { compartment: selected }); assert.equal(Object.hasOwn(snapshot, "copilotRequests"), false); assert.equal(Object.hasOwn(snapshot, "copilotRequestTombstones"), false);
  evidence.checks.push("generic installed snapshot does not expose private request journals or tombstones");
  const sealed = hash(await privateRead(stateFile));
  const expectedCompartments = await store.list(), inventory = await api("compartment/inventory", {});
  assert.equal(inventory.schema, "switchyard-compartment-inventory/v1"); assert.equal(inventory.complete, true); assert.equal(inventory.authorityGranted, false); assert.equal(inventory.providerObserved, false); assert.equal(inventory.activeCompartment, selected); assert.deepEqual(inventory.compartments, expectedCompartments); assert.ok(inventory.compartments.some(row => row.id === selected)); assert.ok(inventory.compartments.every(row => Object.keys(row).length === 1 && typeof row.id === "string"));
  await api("compartment/inventory", {}, 401, false); await api("compartment/inventory", { compartment: selected }, 409); await api("compartment/inventory", { replay: true }, 409);
  evidence.workspaceInventoryCount = inventory.compartments.length; evidence.checks.push("complete bounded workspace metadata includes the selected identity without content, provider observation or selection/replay fields");
  await api("copilot/requests", { compartment: selected }, 401, false); evidence.checks.push("unauthenticated request inspection is refused");
  const rows = await api("copilot/requests", { compartment: selected }); assert.ok(Array.isArray(rows)); assert.equal(rows.length, (before.copilotRequests ?? []).length); assert.ok(rows.every(row => row.remoteCancellationVerified === false)); evidence.retainedRequestCount = rows.length;
  evidence.checks.push("authenticated request metadata remains separate from remote completion or cancellation");
  await api("copilot/requests", { compartment: selected, replay: true }, 409);
  let missing; do { missing = randomUUID(); } while (rows.some(row => row.id === missing));
  await api("copilot/requests/review", { compartment: selected, id: missing }, 409);
  await api("copilot/requests/resolve", { compartment: selected, id: missing, token: randomUUID(), replay: true }, 409);
  await api("copilot/login/cancel", { compartment: selected, loginId: missing }, 401, false);
  await api("copilot/login/cancel", { compartment: selected, loginId: missing, replay: true }, 409);
  await api("copilot/login/cancel", { compartment: selected, loginId: missing }, 409);
  evidence.checks.push("unknown identities and replay fields refuse before approval, credential or provider access");
  assert.equal(hash(await privateRead(stateFile)), sealed); assert.equal(definitions(await store.snapshot(selected)), definitions(before)); assert.equal(await store.selection(), selected); assert.equal(await privateRead(endpointFile), endpointBefore); assert.equal((await applicationStatus()).build, installed.build);
  const home = await fetch(binding.url.origin, { redirect: "error", signal: AbortSignal.timeout(15000) }); assert.equal(home.status, 200); evidence.homeSha256 = hash(await home.text()); const frontendSource = JSON.parse(await readFile(new URL("../docs/evidence/permission-review-source-summary.json", import.meta.url), "utf8")); assert.equal(evidence.homeSha256, frontendSource.sourceFiles["tools/layout-studio/index.html"]);
  evidence.selectedStatePreserved = true; evidence.checks.push("tested routes preserve selected sealed bytes, definitions/mode/readouts, private endpoint and exact tested Home");
} catch (error) { failure = error; evidence.failure = error.message.replaceAll(binding.url.origin, "[local application]").replaceAll(binding.token, "[redacted]").slice(0, 512); }
evidence.success = !failure; const directory = join(homedir(), ".local/state/strathex-switchyard/runtime-verification"); await privateDirectory(directory); const receipt = join(directory, "installed-copilot-journal-metadata-" + Date.now() + ".json"); await privateWrite(receipt, JSON.stringify(evidence, null, 2) + "\n");
console.log(JSON.stringify({ success: !failure, receipt, checks: evidence.checks.length, microsoftRequestsMade: 0, workspaceCreated: false, selectedStatePreserved: evidence.selectedStatePreserved ?? false, failure: evidence.failure ?? null })); if (failure) process.exitCode = 1;
