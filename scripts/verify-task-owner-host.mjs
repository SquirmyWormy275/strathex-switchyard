#!/usr/bin/env node
/** Installed task-owner metadata/refusal proof. No provider start, resume, model or new workspace. */
import assert from "node:assert/strict";
import { createHash, randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { applicationStatus, applicationStateRoot } from "../deployment/suite/application.mjs";
import { installationRoot } from "../deployment/suite/installation.mjs";
import { endpointIdentity, requestInstance } from "../tools/layout-studio/instance.mjs";
import { createSuiteStore } from "../tools/layout-studio/suite-store.mjs";
import { privateDirectory, privateRead, privateWrite } from "../tools/layout-studio/private-fs.mjs";

const flags = process.argv.slice(2);
if (process.platform !== "linux" || flags.length !== 1 || flags[0] !== "--read-only-metadata") throw Error("Usage on the pilot: node scripts/verify-task-owner-host.mjs --read-only-metadata");
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
const evidence = { schema: "switchyard-installed-task-owner-metadata/v1", at: new Date().toISOString(), applicationRelease: installed.build, checks: [], nativeProviderStarts: 0, nativeTaskLoads: 0, modelPromptsSubmitted: 0, keyboardOpened: false, microphoneOpened: false, workspaceCreated: false, frontendChanged: false, nativeTaskLoadingAccepted: false, ideAttachmentAccepted: false }; let failure;
try {
  for (const path of ["tools/layout-studio/coding-task-owners.mjs", "tools/layout-studio/coding-editor-authorizations.mjs", "packages/control-plane/src/confirmations.ts", "tools/layout-studio/codex-owned-listener.mjs", "tools/layout-studio/codex-stdio-tasks.mjs", "tools/layout-studio/suite.mjs", "tools/layout-studio/suite-store.mjs", "tools/layout-studio/confirmations.mjs", "tools/layout-studio/instance.mjs", "tools/layout-studio/serve.mjs", "tools/layout-studio/cvss-v2-metrics.mjs", "tools/layout-studio/cvss-v4-metrics.mjs", "tools/layout-studio/cvss-v4-data.mjs", "tools/layout-studio/osv-advisory-source.mjs"]) assert.equal(hash(await readFile(join(installationRoot(), "versions", installed.build, path))), hash(await readFile(new URL("../" + path, import.meta.url))));
  evidence.checks.push("normal installed release contains the exact task owner, resume boundary, state and route source");
  assert.equal((before.observations ?? []).some(row => row.status === "recording") || (before.voice ?? []).some(row => row.status === "recording") || (before.conversations ?? []).some(row => row.status === "pending"), false, "Preserve active user work before normal workspace initialization.");
  const snapshot = await api("snapshot", { compartment: selected }); assert.equal(Object.hasOwn(snapshot, "codingTaskOwners"), false); assert.equal(Object.hasOwn(snapshot, "codingTaskLoads"), false); assert.equal(Object.hasOwn(snapshot, "codingEditorAuthorizations"), false);
  evidence.checks.push("generic installed snapshot does not expose private request journals or tombstones");
  const sealed = hash(await privateRead(stateFile));
  const expectedCompartments = await store.list(), inventory = await api("compartment/inventory", {});
  assert.equal(inventory.schema, "switchyard-compartment-inventory/v1"); assert.equal(inventory.complete, true); assert.equal(inventory.authorityGranted, false); assert.equal(inventory.providerObserved, false); assert.equal(inventory.activeCompartment, selected); assert.deepEqual(inventory.compartments, expectedCompartments); assert.ok(inventory.compartments.some(row => row.id === selected)); assert.ok(inventory.compartments.every(row => Object.keys(row).length === 1 && typeof row.id === "string"));
  await api("compartment/inventory", {}, 401, false); await api("compartment/inventory", { compartment: selected }, 409); await api("compartment/inventory", { replay: true }, 409);
  evidence.workspaceInventoryCount = inventory.compartments.length; evidence.checks.push("complete bounded workspace metadata includes the selected identity without content, provider observation or selection/replay fields");
  const missingRole = "verification-missing-role-" + randomUUID();
  assert.equal(before.workflow.roles.some(role => role.id === missingRole), false);
  await api("roles/choices", { roleId: missingRole, intent: "status" }, 409);
  await api("roles/choices", { roleId: missingRole, intent: "status", compartment: selected }, 409);
  await api("roles/bind-choice", { roleId: missingRole, intent: "status", provider: "custom-agent", targetKind: "custom-agent", targetId: "missing", choiceDigest: "0".repeat(64) }, 409);
  evidence.checks.push("installed guided role routes refuse unknown roles and caller-selected workspaces without saving bindings or dispatching commands");
  const prefix = "coding/codex/owners/", permitted = before.policy === "personal" && before.mode !== "keyboard-only";
  await api(prefix + "list", { compartment: selected }, 401, false); evidence.checks.push("unauthenticated owner inspection is refused");
  for (const [route, field] of [["list", "codingTaskOwners"], ["loads", "codingTaskLoads"]]) {
    const rows = await api(prefix + route, { compartment: selected }, permitted ? 200 : 409);
    if (permitted) {
      assert.ok(Array.isArray(rows)); assert.equal(rows.length, (before[field] ?? []).length);
      const allowed = route === "list" ? ["requestId", "taskId", "status", "stoppedVerified", "metadataObserved", "nativeTaskLoaded", "ideAttached", "completionVerified"] : ["requestId", "ownerRequestId", "taskId", "status", "nativeLoadAcknowledged", "nativeTaskLoaded", "modelPromptSubmitted", "ideAttached", "completionVerified"];
      assert.ok(rows.every(row => Object.keys(row).every(key => allowed.includes(key)) && row.nativeTaskLoaded === false && row.ideAttached === false && row.completionVerified === false));
    }
  }
  evidence.metadataPermitted = permitted; evidence.checks.push("owner and load metadata honor mode/policy and expose no native attachment or completion claim");
  const missing = randomUUID(); assert.equal((before.codingTaskOwners ?? []).some(row => row.requestId === missing), false);
  await api(prefix + "list", { compartment: selected, replay: true }, 409);
  await api(prefix + "open", { compartment: selected, requestId: missing, taskId: randomUUID(), prompt: "refuse-before-native-start" }, 409);
  await api(prefix + "review-load", { compartment: selected, ownerRequestId: missing }, 409);
  await api(prefix + "load", { compartment: selected, ownerRequestId: missing, requestId: randomUUID(), token: randomUUID(), replay: true }, 409);
  evidence.checks.push("unknown owner and unexpected effect fields refuse before provider start or task resume");
  const { StudioTaskClient } = await import("../apps/vscode-extension/src/studio-task-client.ts"), editor = new StudioTaskClient({ endpointPath: endpointFile, assertCurrent: current });
  try {
    const unusedProject = join(homedir(), "switchyard-metadata-only-" + randomUUID());
    if (permitted) {
      const projects = await editor.editorProjects();
      assert.equal(projects.compartment, selected); assert.equal(projects.complete, true);
      assert.equal(projects.nativeObserved, false); assert.equal(projects.authorityGranted, false); assert.equal(projects.freshReviewRequired, true);
      assert.ok(Object.isFrozen(projects) && Object.isFrozen(projects.projects));
      assert.ok(projects.projects.length <= 64);
      for (const project of projects.projects) assert.ok(Object.isFrozen(project) && project.repositoryRoot.startsWith("/") && Number.isSafeInteger(project.taskCount) && project.taskCount > 0);
      evidence.projectInventory = { permitted: true, projectCount: projects.projects.length, complete: projects.complete, nativeObserved: projects.nativeObserved, authorityGranted: projects.authorityGranted };
    } else {
      await assert.rejects(editor.editorProjects());
      evidence.projectInventory = { permitted: false, policyRefusalVerified: true };
    }
    evidence.checks.push("signed saved-project inventory obeys selected-workspace policy without provider inspection, task authority or a filesystem crawl");
    await api("coding/codex/editor-projects", {}, 401, false);
    for (const selection of [{ compartment: selected }, { repositoryRoot: unusedProject }, { prompt: "never" }]) await api("coding/codex/editor-projects", selection, 409);
    evidence.checks.push("project discovery refuses unauthenticated calls and caller-selected workspace, project and effect fields");
    if (permitted) {
      const choices = await editor.editorChoices(unusedProject);
      assert.equal(choices.compartment, selected); assert.equal(choices.repositoryRoot, unusedProject);
      assert.deepEqual(choices.choices, []); assert.equal(choices.complete, true);
      assert.equal(choices.nativeObserved, false); assert.equal(choices.authorityGranted, false); assert.equal(choices.freshReviewRequired, true);
    } else await assert.rejects(editor.editorChoices(unusedProject));
    evidence.checks.push("signed exact-project choices are empty for an unused project or refuse by policy without native inspection or task authority");
    await api("coding/codex/editor-choices", { repositoryRoot: unusedProject, compartment: selected }, 409);
    await api("coding/codex/editor-choices", { repositoryRoot: unusedProject, prompt: "never" }, 409);
    await assert.rejects(editor.editorChoices("relative"));
    evidence.checks.push("task-choice selection and effect fields and relative project paths refuse without creating a project or native task");
    await assert.rejects(editor.editorTarget({ compartment: selected, ownerRequestId: missing, loadRequestId: randomUUID() }), /^Error: The original Switchyard instance did not authenticate or validate\.$/);
    const input = { compartment: selected, ownerRequestId: missing, loadRequestId: randomUUID(), requestId: randomUUID(), editorId: randomUUID() };
    assert.equal((before.codingEditorAuthorizations ?? []).some(row => row.requestId === input.requestId), false);
    await assert.rejects(editor.reviewEditor(input), /^Error: The original Switchyard instance did not authenticate or validate\.$/);
    await assert.rejects(editor.issueEditor({ ...input, token: randomUUID() }), /^Error: The original Switchyard instance did not authenticate or validate\.$/);
    await assert.rejects(editor.consumeEditor({ ...input, permit: randomUUID() }), /^Error: The original Switchyard instance did not authenticate or validate\.$/);
    await assert.rejects(editor.returnEditorTarget(input), /^Error: The original Switchyard instance did not authenticate or validate\.$/);
    evidence.signedEditorAuthorizationRefusals = 4;
    evidence.checks.push("signed editor review, issue, consume and return refuse unknown ownership without confirmation, permit or terminal effects");
  }
  finally { editor.close(); }
  evidence.signedEditorUnknownOwnerRefused = true; evidence.checks.push("exact-source editor consumer refuses an unknown installed target without a bearer, terminal or native task effect");
  const installedRoot = join(installationRoot(), "versions", installed.build), { cvssV2Metrics } = await import(pathToFileURL(join(installedRoot, "tools/layout-studio/cvss-v2-metrics.mjs"))), { normalizeOsvRecord } = await import(pathToFileURL(join(installedRoot, "tools/layout-studio/osv-advisory-source.mjs")));
  const vector = "AV:N/AC:L/Au:N/C:C/I:C/A:C/E:F/RL:OF/RC:C/TD:N", calculated = cvssV2Metrics(vector);
  assert.deepEqual([calculated.baseScore, calculated.temporalScore, calculated.environmentalScore, calculated.severity], [10, 8.3, 0, "high"]);
  const record = { id: "OSV-synthetic-installed-v2", modified: new Date().toISOString(), affected: [{ package: { ecosystem: "npm", name: "synthetic" }, versions: ["1.0.0"] }], severity: [{ type: "CVSS_V2", score: vector }, { type: "CVSS_V3", score: "CVSS:3.1/AV:N/AC:L/PR:N/UI:N/S:U/C:H/I:H/A:H" }] }, normalized = normalizeOsvRecord(record, { ecosystem: "npm", name: "synthetic", version: "1.0.0" }, Date.now());
  assert.equal(normalized.advisory.severity, "critical"); assert.equal(normalized.evidence.cvssV2Context.localEnvironmentVerified, false); assert.equal(normalized.evidence.cvssV2Context.baseSeverityReduced, false);
  evidence.installedCvssV2 = { baseScore: calculated.baseScore, temporalScore: calculated.temporalScore, environmentalScore: calculated.environmentalScore, nativeRating: calculated.severity, mixedRating: normalized.advisory.severity, publicQueries: 0, scannerExecuted: false };
  evidence.checks.push("installed V2 calculator and mixed-version collector retain base ratings from synthetic offline metrics without query or scan");
  const { cvssV4Metrics } = await import(pathToFileURL(join(installedRoot, "tools/layout-studio/cvss-v4-metrics.mjs")));
  const v4Vector = "CVSS:4.0/AV:N/AC:L/AT:N/PR:N/UI:N/VC:H/VI:H/VA:H/SC:N/SI:N/SA:N/E:U/MVC:N/MVI:N/MVA:N", v4 = cvssV4Metrics(v4Vector);
  assert.deepEqual([v4.baseScore, v4.threatScore, v4.environmentalScore, v4.score, v4.severity], [9.3, 8.1, 0, 0, "critical"]);
  const v4Record = { ...record, id: "OSV-synthetic-installed-v4", severity: [{ type: "CVSS_V4", score: v4Vector }] }, v4Normalized = normalizeOsvRecord(v4Record, { ecosystem: "npm", name: "synthetic", version: "1.0.0" }, Date.now());
  assert.equal(v4Normalized.advisory.severity, "critical"); assert.equal(v4Normalized.evidence.cvssV4Context.localEnvironmentVerified, false); assert.equal(v4Normalized.evidence.cvssV4Context.baseSeverityReduced, false);
  evidence.installedCvssV4 = { baseScore: v4.baseScore, threatScore: v4.threatScore, environmentalScore: v4.environmentalScore, suppliedContextScore: v4.score, retainedRating: v4Normalized.advisory.severity, publicQueries: 0, scannerExecuted: false };
  evidence.checks.push("installed V4 calculator and collector retain critical base severity despite zero supplied context without a query, scanner or task");
  assert.equal(hash(await readFile(join(installedRoot, "tools/layout-studio/shield-scanner-engine.mjs"))), hash(await readFile(new URL("../tools/layout-studio/shield-scanner-engine.mjs", import.meta.url))));
  const { spdxLicenseMembership } = await import(pathToFileURL(join(installedRoot, "tools/layout-studio/shield-scanner-engine.mjs")));
  for (const [expression, listed, deprecated] of [["MIT", true, false], ["Apache-2.0 WITH LLVM-exception", true, false], ["GPL-2.0+", true, true], ["MIT OR Unlisted-Synthetic-License", false, false], ["MIT WITH Unlisted-Synthetic-Exception", false, false]]) {
    assert.deepEqual(spdxLicenseMembership(expression), { version: "3.29.0", listed, deprecated });
  }
  evidence.installedSpdxCatalog = { version: "3.29.0", cases: 5, unknownTermsRetained: true, deprecationObserved: true, licenseTextVerified: false, publicQueries: 0 };
  evidence.checks.push("installed SPDX membership preserves separate license/exception IDs, unknown alternatives and deprecation without claiming text or publisher verification");
  for (const ecosystem of ["npm", "PyPI", "crates.io"]) {
    const source = { id: "OSV-synthetic-installed-boundaries", modified: new Date().toISOString(), affected: [{ package: { ecosystem, name: "synthetic" }, ranges: [{ type: ecosystem === "PyPI" ? "ECOSYSTEM" : "SEMVER", events: [{ limit: "1.2.3" }, { introduced: "1.2.0" }, { last_affected: "1.2.3" }, { limit: "2.0.0" }] }] }] };
    assert.equal(normalizeOsvRecord(source, { ecosystem, name: "synthetic", version: "1.2.3" }, Date.now()).advisory.severity, "unknown");
    for (const version of ["1.1.9", "1.2.4"]) assert.throws(() => normalizeOsvRecord(source, { ecosystem, name: "synthetic", version }, Date.now()));
  }
  evidence.installedOsvBoundaries = { ecosystems: ["npm", "PyPI", "crates.io"], inclusiveEndpointVerified: true, unionLimitsVerified: true, excludedVersionsRefused: true, publicQueries: 0, scannerExecuted: false };
  evidence.checks.push("installed advisory matching retains inclusive endpoints and union limits without a public query or scanner effect");
  assert.equal(hash(await privateRead(stateFile)), sealed); assert.equal(definitions(await store.snapshot(selected)), definitions(before)); assert.equal(await store.selection(), selected); assert.equal(await privateRead(endpointFile), endpointBefore); assert.equal((await applicationStatus()).build, installed.build);
  const home = await fetch(binding.url.origin, { redirect: "error", signal: AbortSignal.timeout(15000) }); assert.equal(home.status, 200); evidence.homeSha256 = hash(await home.text()); const frontendSource = JSON.parse(await readFile(new URL("../docs/evidence/voice-ui-source-summary.json", import.meta.url), "utf8")); assert.equal(evidence.homeSha256, frontendSource.sourceFiles["tools/layout-studio/index.html"]);
  evidence.selectedStatePreserved = true; evidence.checks.push("tested routes preserve selected sealed bytes, definitions/mode/readouts, private endpoint and exact tested Home");
} catch (error) { failure = error; evidence.failure = error.message.replaceAll(binding.url.origin, "[local application]").replaceAll(binding.token, "[redacted]").slice(0, 512); }
evidence.success = !failure; const directory = join(homedir(), ".local/state/strathex-switchyard/runtime-verification"); await privateDirectory(directory); const receipt = join(directory, "installed-task-owner-metadata-" + Date.now() + ".json"); await privateWrite(receipt, JSON.stringify(evidence, null, 2) + "\n");
console.log(JSON.stringify({ success: !failure, receipt, checks: evidence.checks.length, nativeProviderStarts: 0, nativeTaskLoads: 0, workspaceCreated: false, selectedStatePreserved: evidence.selectedStatePreserved ?? false, failure: evidence.failure ?? null })); if (failure) process.exitCode = 1;
