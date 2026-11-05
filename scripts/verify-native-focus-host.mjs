#!/usr/bin/env node
/** Normal installed gateway proof. No prompt, keyboard, launcher or voice change. */
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";
import { applicationStatus, applicationStateRoot } from "../deployment/suite/application.mjs";
import { installationRoot } from "../deployment/suite/installation.mjs";
import { createSuiteStore } from "../tools/layout-studio/suite-store.mjs";
import { privateRead, privateWrite } from "../tools/layout-studio/private-fs.mjs";
import { endpointIdentity, requestInstance } from "../tools/layout-studio/instance.mjs";
import { nativeChatgptWindow, nativeVscodeWindow, runHypr } from "../tools/layout-studio/host.mjs";
import { runtimeGuardianStopped } from "../tools/layout-studio/runtime-command.mjs";

const flags = process.argv.slice(2), client = flags[1]?.slice(9) ?? "chatgpt";
if (process.platform !== "linux" || ![1, 2].includes(flags.length) || flags[0] !== "--synthetic" || flags.length === 2 && !["--client=chatgpt", "--client=vscode"].includes(flags[1])) throw Error("Use on the pilot: node scripts/verify-native-focus-host.mjs --synthetic [--client=chatgpt|vscode]. Open the exact native main window first.");
const target = client === "vscode" ? { inspect: nativeVscodeWindow, classes: ["code", "com.microsoft.VSCode"] } : { inspect: nativeChatgptWindow, classes: ["chatgpt"] };
const installed = await applicationStatus(); assert.equal(installed.status, "ready");
const hash = bytes => createHash("sha256").update(bytes).digest("hex"), definitions = state => hash(JSON.stringify([state.profile, state.workflow, state.roleBindings ?? [], state.mode]));
const endpointFile = join(applicationStateRoot(), "endpoint.json"), endpointBefore = await privateRead(endpointFile), endpoint = JSON.parse(endpointBefore), binding = endpointIdentity(endpoint);
const current = async () => { assert.equal(await privateRead(endpointFile), endpointBefore); const proof = await requestInstance(endpoint); assert.equal(proof.authenticated, true); assert.equal(proof.status, "ready"); };
await current(); // Authenticate the listener before disclosing its bearer.
async function api(path, body = {}, expected = 200, authenticated = true) {
  await current();
  const response = await fetch(new URL("/api/suite/" + path, binding.url.origin), { method: "POST", redirect: "error", headers: { "Content-Type": "application/json", Origin: binding.url.origin, ...(authenticated ? { Authorization: "Bearer " + binding.token } : {}) }, body: JSON.stringify(body), signal: AbortSignal.timeout(30000) });
  assert.equal(response.status, expected, "The fixed installed focus request was refused.");
  const text = await response.text(); assert.ok(Buffer.byteLength(text) <= 1048576); return JSON.parse(text);
}
const store = createSuiteStore(), selected = await store.selection(), personal = definitions(await store.snapshot("personal")), compartment = "native-focus-validation", checks = [];
const evidence = { schema: "switchyard-installed-native-main-window-proof/v1", at: new Date().toISOString(), applicationRelease: installed.build, client, checks, modelPromptsSubmitted: 0, keyboardOpened: false, microphoneOpened: false, launcherChanged: false, overlaySettingsChanged: false, frontendChanged: false, accountAccepted: false, taskResumptionAccepted: false };
let baseline, failure, stage = "installed-source-binding";
try {
  for (const path of ["tools/layout-studio/host.mjs", "tools/layout-studio/native-process.mjs", "tools/layout-studio/task-window.mjs", "tools/layout-studio/suite.mjs", "tools/layout-studio/suite-store.mjs", "tools/layout-studio/physical-intent.mjs", "tools/layout-studio/workspace.mjs"]) assert.equal(hash(await readFile(join(installationRoot(), "versions", installed.build, path))), hash(await readFile(new URL("../" + path, import.meta.url))));
  checks.push("normal installed release contains the exact native target and active-policy source");
  stage = "original-workspace-preflight";
  const original = await target.inspect(), active = await api("snapshot", { compartment: selected });
  assert.equal(active.policy, "personal", "Preserve an active Work environment.");
  assert.equal(active.observations.some(row => row.status === "recording") || active.voice.some(row => row.status === "recording") || active.conversations.some(row => row.status === "pending") || (active.codingTurns ?? []).some(row => ["submitting", "submitted", "cancellation-requested"].includes(row.status)), false, "Preserve active user work.");
  const guardians = new Map();
  function retained(value) { if (!value || typeof value !== "object") return; if (value.ownedRuntime?.schema === "switchyard-runtime-command/v1") guardians.set(value.ownedRuntime.id, value.ownedRuntime); for (const child of Object.values(value)) retained(child); }
  retained(await store.snapshot(selected));
  for (const guardian of guardians.values()) assert.equal(await runtimeGuardianStopped(guardian), true, "Preserve an existing owned native process.");
  stage = "empty-validation-workspace";
  await api("compartment/create", { compartment, policy: "personal" }); const candidate = await store.snapshot(compartment);
  assert.equal(candidate.mode, "keyboard-only"); assert.equal(candidate.profile, null); assert.equal(candidate.workflow.roles.length, 0);
  for (const key of ["conversations", "observations", "voice", "agents", "codingSessions", "codingTurns", "roleBindings", "repositoryExecutions", "repositoryAuthorities"]) assert.equal((candidate[key] ?? []).length, 0);
  baseline = candidate; // Only an independently verified empty fixture may restore.
  await api("intent", { implementation: `native-${client}.focus/v1` }, 401, false); checks.push("unauthenticated focus refuses before native dispatch");
  await api("compartment/select", { compartment });
  await api("intent", { implementation: `native-${client}.focus/v1` }, 409); checks.push("keyboard-only validation workspace refuses native provider effects");
  stage = "exact-main-window-focus";
  await api("mode", { compartment, mode: "personal-companion" });
  const result = await api("intent", { implementation: `native-${client}.focus/v1` });
  assert.equal(result.windowFocusVerified, true); assert.equal(result.modelPromptSubmitted, false); assert.equal(result.accountVerified, false); assert.equal(result.taskResumptionVerified, false);
  assert.deepEqual(await target.inspect(), original);
  const windows = JSON.parse(await runHypr("clients", "-j")).filter(row => target.classes.includes(row.initialClass));
  assert.equal(windows.filter(row => row.mapped).length, 1); assert.equal(windows.filter(row => row.mapped && row.floating).length, 0);
  evidence.mappedMainWindows = 1; evidence.mappedFloatingOverlays = 0;
  checks.push("normal installed authenticated gateway focuses only the unchanged exact native main window, with one mapped main window and zero floating overlays");
} catch (error) { failure = error; evidence.failure = { stage, category: error.name }; }
finally {
  try {
    if (baseline) {
      await api("mode", { compartment, mode: "keyboard-only" });
      if (await store.selection() === compartment) await api("compartment/select", { compartment: selected });
      assert.equal(await store.selection(), selected); assert.equal(definitions(await store.snapshot("personal")), personal); assert.equal(definitions(await store.snapshot(compartment)), definitions(baseline));
      await current(); assert.equal((await applicationStatus()).build, installed.build);
      const home = await fetch(binding.url.origin, { redirect: "error", signal: AbortSignal.timeout(15000) }); evidence.homeSha256 = hash(await home.text()); assert.equal(evidence.homeSha256, "20ba0095a6b9650046df34541872aa7e0a7cdc7db5182f065abb009127c6c130");
      evidence.validationRestored = true; checks.push("original selection, Personal definitions, empty keyboard-only validation, private endpoint and frozen Home restore exactly");
    }
  } catch (error) { failure ??= error; evidence.restoreFailure = { category: error.name }; }
}
evidence.success = !failure;
const name = "installed-native-main-window-" + Date.now() + ".json"; await privateWrite(join(homedir(), ".local/state/strathex-switchyard/runtime-verification", name), JSON.stringify(evidence, null, 2) + "\n");
console.log(JSON.stringify({ success: evidence.success, receipt: name, client, checks: checks.length, validationRestored: evidence.validationRestored ?? false, modelPromptsSubmitted: 0 }));
if (failure) process.exitCode = 1;
