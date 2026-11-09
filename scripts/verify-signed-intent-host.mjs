#!/usr/bin/env node
/** Installed signed-dispatch refusal proof: no native focus, provider, key or account effect. */
import assert from "node:assert/strict";
import { createHash, randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { applicationStatus, applicationStateRoot } from "../deployment/suite/application.mjs";
import { installationRoot } from "../deployment/suite/installation.mjs";
import { verifySuiteRelease } from "../deployment/suite/release.mjs";
import { createSuiteStore } from "../tools/layout-studio/suite-store.mjs";
import { privateDirectory, privateRead, privateWrite } from "../tools/layout-studio/private-fs.mjs";

const flags = process.argv.slice(2);
if (process.platform !== "linux" || flags.length !== 1 || flags[0] !== "--read-only-metadata") throw Error("Usage on the pilot: node scripts/verify-signed-intent-host.mjs --read-only-metadata");
const hash = bytes => createHash("sha256").update(bytes).digest("hex");
const app = await applicationStatus(); assert.equal(app.status, "ready");
const root = join(installationRoot(), "versions", app.build), manifest = await verifySuiteRelease(root, { expectedId: app.build, platform: "linux", checkRuntime: true });
assert.equal(manifest.development, false);
const endpointPath = join(applicationStateRoot(), "endpoint.json"), endpointBytes = await privateRead(endpointPath), endpoint = JSON.parse(endpointBytes);
const clock = Date.now(), store = createSuiteStore({ clock: () => clock }), selected = await store.selection(), inventory = await store.list(), before = await store.snapshot(selected);
const statePath = join(homedir(), ".local/state/strathex-switchyard/suite", selected + ".sealed.json"), sealed = hash(await privateRead(statePath));
const evidence = { schema: "switchyard-installed-signed-intent-metadata/v1", sourceCommit: manifest.sourceCommit, release: manifest.id, checks: [], sourceFiles: {}, nativeFocusEffects: 0, nativeProviderStarts: 0, modelPrompts: 0, physicalKeyboardEvents: 0, workspaceCreated: false };
let failure;
try {
  for (const [summary, files] of [
    ["signed-physical-intent-source-summary.json", ["tools/layout-studio/physical-intent-contract.mjs", "tools/layout-studio/physical-intent.mjs"]],
    ["editor-project-choices-source-summary.json", ["tools/layout-studio/instance.mjs"]],
    ["frontend-host-provenance-source-summary.json", ["tools/layout-studio/serve.mjs"]]
  ]) {
    const source = JSON.parse(await readFile(new URL("../docs/evidence/" + summary, import.meta.url), "utf8"));
    const sourceFiles = source.sourceFiles ?? Object.fromEntries(source.files.map(file => [file.path, file.sha256]));
    for (const file of files) {
      const digest = hash(await readFile(join(root, file))); assert.equal(digest, sourceFiles[file]); evidence.sourceFiles[file] = digest;
    }
  }
  evidence.checks.push("installed dispatch, gateway, route and closed contract match the tested source hashes");
  const { requestPhysicalIntent } = await import(pathToFileURL(join(root, "tools/layout-studio/instance.mjs")));
  const { closedIntent } = await import(pathToFileURL(join(root, "tools/layout-studio/physical-intent-contract.mjs")));
  for (const roleId of [1, true, null, [], {}, undefined]) assert.throws(() => closedIntent({ implementation: "switchyard.role/v1", roleId, intent: "status" }), /closed intent/);
  evidence.checks.push("installed role identities reject non-string coercion without a request");
  let roleId;
  do { roleId = "verification-missing-" + randomUUID(); } while ((before.workflow?.roles ?? []).some(role => role.id === roleId) || (before.roleBindings ?? []).some(binding => binding.roleId === roleId));
  const selection = { implementation: "switchyard.role/v1", roleId, intent: "status", requestId: randomUUID() };
  // This nonexistent role has no bound provider or native action. A signed
  // not-confirmed reply proves routing without introducing a user effect.
  await assert.rejects(requestPhysicalIntent(endpoint, selection), /^Error: The active compartment did not confirm this physical intent\./);
  evidence.checks.push("the authenticated installed route refuses an absent role without a provider or native effect");
  assert.notEqual(endpoint.pid, process.pid);
  await assert.rejects(requestPhysicalIntent({ ...endpoint, pid: process.pid }, { ...selection, requestId: randomUUID() }), /did not authenticate/);
  evidence.checks.push("a different saved PID refuses before dispatch");
  const differentBuild = (endpoint.instance.build[0] === "a" ? "b" : "a") + endpoint.instance.build.slice(1);
  await assert.rejects(requestPhysicalIntent({ ...endpoint, instance: { ...endpoint.instance, build: differentBuild } }, { ...selection, requestId: randomUUID() }), /did not authenticate/);
  evidence.checks.push("a substituted build cannot enter the installed intent route");
  await assert.rejects(requestPhysicalIntent(endpoint, { ...selection, requestId: randomUUID() }, { now: () => Date.now() - 11000 }), /did not authenticate/);
  evidence.checks.push("an expired signed intent refuses without retry");
  await assert.rejects(requestPhysicalIntent(endpoint, { ...selection, compartment: selected }), /exact closed intent/);
  evidence.checks.push("caller-selected compartment fields refuse locally before dispatch");
} catch (error) { failure = error; evidence.failure = error.name; }
try {
  assert.equal(hash(await privateRead(statePath)), sealed); assert.deepEqual(await store.snapshot(selected), before);
  assert.equal(await store.selection(), selected); assert.deepEqual(await store.list(), inventory);
  assert.equal(await privateRead(endpointPath), endpointBytes); assert.equal((await applicationStatus()).build, app.build);
  evidence.selectedStatePreserved = true; evidence.checks.push("selected sealed bytes, complete workspace inventory, private endpoint and installed generation are unchanged");
} catch (error) { failure ??= error; evidence.failure ??= error.name; evidence.selectedStatePreserved = false; }
evidence.success = !failure;
const directory = join(homedir(), ".local/state/strathex-switchyard/runtime-verification"); await privateDirectory(directory);
const receipt = join(directory, "installed-signed-intent-metadata-" + Date.now() + ".json"); await privateWrite(receipt, JSON.stringify(evidence, null, 2) + "\n");
console.log(JSON.stringify({ success: evidence.success, receipt, checks: evidence.checks.length, selectedStatePreserved: evidence.selectedStatePreserved, nativeFocusEffects: 0, nativeProviderStarts: 0, modelPrompts: 0, physicalKeyboardEvents: 0 }));
if (failure) process.exitCode = 1;
