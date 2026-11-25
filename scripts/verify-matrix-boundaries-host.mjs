#!/usr/bin/env node
/** Read-only installed rejection checks. No consent, capture, unlock or relock. */
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { homedir } from "node:os";
import { join } from "node:path";
import { applicationStateRoot } from "../deployment/suite/application.mjs";
import { privateRead, privateWrite } from "../tools/layout-studio/private-fs.mjs";
import { createSuiteStore } from "../tools/layout-studio/suite-store.mjs";
if (process.platform !== "linux" || process.argv.length !== 3 || process.argv[2] !== "--read-only") throw new Error("Usage: node scripts/verify-matrix-boundaries-host.mjs --read-only (normal app running; no device operation or capture)");
const endpoint = JSON.parse(await privateRead(join(applicationStateRoot(), "endpoint.json"))), url = new URL(endpoint.url), token = /^#access=([A-Za-z0-9_-]{43})$/.exec(url.hash)?.[1];
assert.ok(token && url.hostname === "127.0.0.1" && url.protocol === "http:");
const store = createSuiteStore(), selected = await store.selection(), checks = [], digest = (v) => createHash("sha256").update(JSON.stringify(v)).digest("hex");
async function api(path, body = {}, expected = 200, authenticated = true) {
  const response = await fetch(new URL(`/api/suite/${path}`, url.origin), { method: "POST", redirect: "error", headers: { "Content-Type": "application/json", Origin: url.origin, ...(authenticated ? { Authorization: `Bearer ${token}` } : {}) }, body: JSON.stringify({ compartment: selected, ...body }), signal: AbortSignal.timeout(15000) });
  assert.equal(response.status, expected, `Installed ${path} returned an unexpected status.`); return response.json();
}
const before = digest(await api("snapshot")), inactive = selected === "profile-validation" ? "personal" : "profile-validation", inactiveBefore = digest(await api("snapshot", { compartment: inactive }));
let failure;
try {
  const denied = await api("devices/matrix/review", { deviceId: "0".repeat(64) }, 401, false); assert.ok(denied.error); checks.push("unauthenticated matrix review rejected");
  const consent = await api("devices/matrix/start", { reviewId: "unknown", consent: false }, 409); assert.match(consent.error, /consent/); checks.push("unknown review and absent explicit consent rejected");
  const sample = await api("devices/matrix/sample", { id: "unknown" }, 409); assert.match(sample.error, /exact active/); checks.push("unconsented switch-state read rejected");
  const stop = await api("devices/matrix/stop", {}, 409); assert.match(stop.error, /exact active/); checks.push("missing test identity rejected");
  const other = await api("devices/matrix/review", { compartment: inactive, deviceId: "0".repeat(64) }, 409); assert.match(other.error, /selected workspace/); checks.push("inactive workspace cannot start a key review");
  assert.equal(digest(await api("snapshot")), before); assert.equal(digest(await api("snapshot", { compartment: inactive })), inactiveBefore); assert.equal(await store.selection(), selected); assert.equal(JSON.parse(await privateRead(join(applicationStateRoot(), "endpoint.json"))).url, endpoint.url); checks.push("workspace state, selection and private endpoint preserved");
} catch (error) { failure = error; }
const path = join(homedir(), ".local/state/strathex-switchyard/runtime-verification", `installed-matrix-boundaries-${Date.now()}.json`);
await privateWrite(path, JSON.stringify({ schema: "switchyard-installed-matrix-boundaries/v1", at: new Date().toISOString(), checks, hidOpened: false, keySamplesCaptured: false, keyboardWritten: false, hardwareAcceptance: false, failure: failure?.message ?? null }, null, 2) + "\n");
console.log(JSON.stringify({ receipt: path, checks: checks.length, hidOpened: false, keySamplesCaptured: false, failure: failure?.message ?? null })); if (failure) throw failure;
