#!/usr/bin/env node
/** Actual installed one-shot lock metadata, without changing keys, LEDs or modes. */
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { homedir } from "node:os";
import { join } from "node:path";
import { applicationStateRoot } from "../deployment/suite/application.mjs";
import { privateRead, privateWrite } from "../tools/layout-studio/private-fs.mjs";
import { createSuiteStore } from "../tools/layout-studio/suite-store.mjs";
import { createKeyboardIndicators } from "../tools/layout-studio/keyboard-indicators.mjs";

if (process.platform !== "linux" || process.argv.length !== 3 || process.argv[2] !== "--read-only") throw new Error("Usage on the pilot: node scripts/verify-keyboard-indicators-host.mjs --read-only (normal app running; no key, LED, device or mode changes)");
const endpoint = JSON.parse(await privateRead(join(applicationStateRoot(), "endpoint.json"))), url = new URL(endpoint.url), token = /^#access=([A-Za-z0-9_-]{43})$/.exec(url.hash)?.[1]; assert.ok(token && url.hostname === "127.0.0.1" && url.protocol === "http:");
const store = createSuiteStore(), reader = createKeyboardIndicators(), checks = [], digest = v => createHash("sha256").update(JSON.stringify(v)).digest("hex"), compartment = "profile-validation";
async function api(path, authenticated = true, targetCompartment = compartment) {
  const r = await fetch(new URL(`/api/suite/${path}`, url.origin), { method: "POST", redirect: "error", headers: { "Content-Type": "application/json", Origin: url.origin, ...(authenticated ? { Authorization: `Bearer ${token}` } : {}) }, body: JSON.stringify({ compartment: targetCompartment }), signal: AbortSignal.timeout(15000) });
  if (!authenticated) return r.status;
  assert.equal(r.status, 200, `Installed ${path} did not verify.`); return r.json();
}
const definitions = s => digest([s.profile, s.workflow, s.roleBindings ?? [], s.mode]);
const beforeWorkspace = await api("snapshot"), personal = definitions(await api("snapshot", true, "personal")), selection = await store.selection(); assert.equal(beforeWorkspace.mode, "keyboard-only");
let result, stable, failure;
try {
  const before = await reader.read(); result = await api("host/keyboard-indicators"); const after = await reader.read();
  assert.equal(result.schema, "switchyard-keyboard-indicators/v1"); assert.equal(result.platform, "linux"); assert.equal(result.provenance, "Linux LED class brightness"); assert.equal(result.keyboardWritten, false); assert.equal(result.physicalDeviceLinked, false); assert.equal(result.physicalLightVerified, false); assert.equal(result.liveDesktopStateVerified, false); assert.ok(Math.abs(Date.now()-result.observedAt) < 15000); checks.push("authenticated installed one-shot Linux indicator contract and observation freshness verified");
  stable = digest(before.observations) === digest(after.observations); if (stable) { assert.deepEqual(result.observations, before.observations); checks.push("installed result matches independent stable kernel observations before and after"); } else checks.push("kernel indicators changed externally during the read; no stable-value assertion made");
  assert.equal(await api("host/keyboard-indicators", false), 401); checks.push("unauthenticated indicator read rejected");
  assert.equal(definitions(await api("snapshot", true, "personal")), personal); assert.equal(definitions(await api("snapshot")), definitions(beforeWorkspace)); assert.equal(await store.selection(), selection); assert.equal((JSON.parse(await privateRead(join(applicationStateRoot(), "endpoint.json")))).url, endpoint.url); checks.push("Personal and keyboard-only definitions, selection and private link preserved");
} catch (error) { failure = error; }
finally { assert.equal((await reader.close()).stopped, true); }
const path = join(homedir(), ".local/state/strathex-switchyard/runtime-verification", `installed-keyboard-indicators-${Date.now()}.json`);
await privateWrite(path, JSON.stringify({ schema: "switchyard-installed-keyboard-indicators/v1", at: new Date().toISOString(), checks, stableKernelObservation: stable, available: result?.available ?? false, inputInstances: result?.observations.length ?? 0, keyboardWritten: false, deviceLinked: false, physicalLightVerified: false, liveDesktopStateVerified: false, failure: failure?.message ?? null }, null, 2)+"\n");
console.log(JSON.stringify({ receipt: path, checks: checks.length, available: result?.available ?? false, stableKernelObservation: stable, keyboardWritten: false, failure: failure?.message ?? null })); if (failure) throw failure;
