#!/usr/bin/env node
/** Pilot proof: normal update, in-place runtime adoption and read-only import/HID checks. */
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { realpath, rm } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";
import { privateRead, privateWrite } from "../tools/layout-studio/private-fs.mjs";
import { applicationStateRoot } from "../deployment/suite/application.mjs";
import { verifySuiteRelease } from "../deployment/suite/release.mjs";
import { runtimeRoot } from "../tools/layout-studio/runtime-setup.mjs";
import { readRuntimeSelection, readRuntimeRelease } from "../tools/layout-studio/runtime-storage.mjs";
import { localVoice } from "../tools/layout-studio/voice.mjs";

const [flag, input, expected] = process.argv.slice(2);
if (process.platform !== "linux" || flag !== "--adopt" || !input || !/^[a-f0-9]{64}$/.test(expected ?? "") || process.argv.length !== 5) throw new Error("Usage on the pilot: node scripts/verify-runtime-host.mjs --adopt /absolute/verified/bundle EXPECTED_SHA256");
const bundle = await realpath(input), manifest = await verifySuiteRelease(bundle, { expectedId: expected, platform: "linux", checkRuntime: true });
const command = join(homedir(), ".local/bin/switchyard"), checks = [];
async function cli(args) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { shell: false, stdio: ["ignore", "pipe", "ignore"] }); let output = "";
    const timer = setTimeout(() => { child.kill(); reject(new Error("Installed runtime verification exceeded its bound; preserve its journals.")); }, 240000);
    child.stdout.on("data", b => { output += b; if (Buffer.byteLength(output) > 65536) child.kill(); });
    child.once("error", () => { clearTimeout(timer); reject(new Error("The normal installed command is unavailable.")); });
    child.once("close", code => { clearTimeout(timer); if (code) reject(new Error("The normal installed runtime operation did not verify; preserve recovery state.")); else { try { resolve(JSON.parse(output)); } catch { reject(new Error("The normal command returned an unsupported result.")); } } });
  });
}
let endpoint, url, token;
async function connect() { endpoint = JSON.parse(await privateRead(join(applicationStateRoot(), "endpoint.json"))); url = new URL(endpoint.url); token = /^#access=([A-Za-z0-9_-]{43})$/.exec(url.hash)?.[1]; assert.ok(token && url.protocol === "http:" && url.hostname === "127.0.0.1"); }
async function api(path, body = {}) {
  const response = await fetch(new URL(`/api/suite/${path}`, url.origin), { method: "POST", redirect: "error", headers: { "Content-Type": "application/json", Origin: url.origin, Authorization: `Bearer ${token}` }, body: JSON.stringify(body), signal: AbortSignal.timeout(15000) });
  assert.equal(response.status, 200, "The installed read-only runtime proof returned an unexpected HTTP status."); return response.json();
}
const digest = value => createHash("sha256").update(JSON.stringify(value)).digest("hex");
const definitions = value => digest([value.profile, value.workflow, value.roleBindings ?? [], value.mode]);
const evidence = { schema: "switchyard-runtime-host-verification/v1", at: new Date().toISOString(), sourceCommit: manifest.sourceCommit, applicationRelease: manifest.id, checks, microphoneOpened: false, keyboardWritten: false, providerPrompted: false, visualAcceptance: false };
let failure;
try {
  await connect(); const privateLink = endpoint.url, personal = definitions(await api("snapshot", { compartment: "personal" })), profile = await api("profile/package/export", { compartment: "profile-validation" });
  const wasManaged = Boolean((await readRuntimeSelection(runtimeRoot()))?.current);
  const updated = await cli(["update", bundle, expected]); assert.equal(updated.current, expected); assert.ok(updated.cleanupPending == null); await connect(); assert.equal(endpoint.url, privateLink);
  const ready = await cli(["status"]); assert.equal(ready.build, expected); checks.push("normal application update and exact build verified");
  const adopted = await cli(["runtime", "install"]); assert.equal(adopted.status, "verified"); assert.equal(adopted.packages, 48); assert.deepEqual(adopted.extraDistributions, []); assert.equal(adopted.modelLoaded, true);
  if (wasManaged) assert.equal(adopted.unchanged, true);
  else { assert.deepEqual(adopted.installedComponents, []); assert.deepEqual(adopted.reusedComponents, ["python", "model"]); }
  const selection = await readRuntimeSelection(runtimeRoot()), record = await readRuntimeRelease(runtimeRoot(), selection.current); assert.equal(record.components.python.location, "venv"); assert.equal(record.components.model.location, "base.en");
  const afterAdoption = await cli(["status"]); assert.equal(afterAdoption.build, expected);
  if (!wasManaged) { assert.notEqual(afterAdoption.instanceId, ready.instanceId); checks.push("both legacy components adopted in place with 48 exact dependencies and offline CPU model load", "normal running owner stopped and restarted through its installed launcher"); }
  else { assert.equal(afterAdoption.instanceId, ready.instanceId); checks.push("existing managed runtime verified and reused without restarting the application"); }
  const updatedRuntime = await cli(["runtime", "update"]); assert.equal(updatedRuntime.unchanged, true); assert.equal((await cli(["status"])).instanceId, afterAdoption.instanceId); checks.push("matching update reused software without downloads, rebuild or application restart");
  const voice = localVoice(); assert.equal((await voice.discovery()).available, true); await voice.close();
  const interfaces = await api("devices/list", { compartment: "profile-validation" }); assert.ok(Array.isArray(interfaces)); evidence.configurationInterfaces = interfaces.length;
  const checked = await cli(["runtime", "check"]); assert.equal(checked.status, "verified"); assert.equal(checked.modelLoaded, true); assert.equal(checked.packages, 48); checks.push("selected voice paths and installed HID enumeration worked; recorded software inventory remained unchanged");
  await connect(); assert.equal(endpoint.url, privateLink); assert.equal(definitions(await api("snapshot", { compartment: "personal" })), personal); assert.deepEqual(await api("profile/package/export", { compartment: "profile-validation" }), profile); assert.equal((await api("snapshot", { compartment: "profile-validation" })).mode, "keyboard-only");
  const home = await fetch(url.origin); evidence.homeSha256 = createHash("sha256").update(Buffer.from(await home.arrayBuffer())).digest("hex"); assert.equal(evidence.homeSha256, "20ba0095a6b9650046df34541872aa7e0a7cdc7db5182f065abb009127c6c130");
  evidence.runtimeRelease = selection.current; evidence.frontend = manifest.frontend.digest; evidence.applicationBackup = updated.backup; evidence.privateLinkRetained = true; checks.push("Personal definitions, validation package/mode, private review link and exact frozen Home bytes preserved");
  // Remove only this verified disposable build after the installed copy and
  // all checks succeed. Current/rollback program versions remain installed.
  if (bundle.startsWith(join(process.cwd(), "artifacts/switchyard-suite") + "/")) { await verifySuiteRelease(bundle, { expectedId: expected }); await rm(bundle, { recursive: true }); evidence.disposableBundleRemoved = true; }
} catch (error) { failure = error; evidence.failure = error.message; }
const path = join(homedir(), ".local/state/strathex-switchyard/runtime-verification", `runtime-lifecycle-${Date.now()}.json`); await privateWrite(path, JSON.stringify(evidence, null, 2) + "\n");
console.log(JSON.stringify({ receipt: path, sourceCommit: manifest.sourceCommit, applicationRelease: expected, checks: checks.length, configurationInterfaces: evidence.configurationInterfaces ?? null, disposableBundleRemoved: evidence.disposableBundleRemoved ?? false, failure: failure?.message ?? null }));
if (failure) throw failure;
