#!/usr/bin/env node
/** Explicit synthetic profile proof through the normal installed application. */
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { homedir } from "node:os";
import { join } from "node:path";
import { privateRead, privateWrite, privateDirectory } from "../tools/layout-studio/private-fs.mjs";
import { applicationStateRoot } from "../deployment/suite/application.mjs";
if (process.argv.length !== 3 || process.argv[2] !== "--synthetic" || process.platform !== "linux") throw new Error("Usage on the pilot Linux host: node scripts/verify-profile-host.mjs --synthetic (normal installed application, dedicated keyboard-only validation workspace, no hardware/account effects)");
const command = join(homedir(), ".local/bin/switchyard"), compartment = "profile-validation", results = [];
async function cli(args) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { shell: false, stdio: ["ignore", "pipe", "ignore"] }); let output = "";
    const timer = setTimeout(() => { child.kill(); reject(new Error("The installed command exceeded its bound.")); }, 20000);
    child.stdout.on("data", (b) => { output += b; if (output.length > 16384) child.kill(); });
    child.once("error", () => { clearTimeout(timer); reject(new Error("The installed command was unavailable.")); });
    child.once("close", (code) => { clearTimeout(timer); code ? reject(new Error("The installed command did not verify.")) : resolve(output); });
  });
}
let endpoint, url, token;
async function connect() {
  endpoint = JSON.parse(await privateRead(join(applicationStateRoot(), "endpoint.json"))); url = new URL(endpoint.url); token = /^#access=([A-Za-z0-9_-]{43})$/.exec(url.hash)?.[1];
  if (!token || url.protocol !== "http:" || url.hostname !== "127.0.0.1") throw new Error("Start the normal installed private suite first.");
}
async function api(path, body = {}, expected = 200, authenticated = true) {
  const response = await fetch(new URL(`/api/suite/${path}`, url.origin), { method: "POST", redirect: "error", headers: { "Content-Type": "application/json", Origin: url.origin, ...(authenticated ? { Authorization: `Bearer ${token}` } : {}) }, body: JSON.stringify({ compartment, ...body }), signal: AbortSignal.timeout(15000) });
  assert.equal(response.status, expected, "The installed synthetic profile boundary returned an unexpected status."); return response.json();
}
const definitionDigest = (s) => createHash("sha256").update(JSON.stringify([s.profile, s.workflow, s.roleBindings ?? []])).digest("hex");
await connect(); const firstIdentity = JSON.parse(await cli(["status"])), privateLink = endpoint.url;
const personalBefore = definitionDigest(await api("snapshot", { compartment: "personal" }));
await api("compartment/create", { policy: "personal" });
const before = await api("snapshot"); assert.equal(before.mode, "keyboard-only");
if (before.profile && before.profile.id !== "synthetic-portability-proof") throw new Error("The validation workspace contains another profile. Its definitions were preserved.");
const profile = {
  schema: "switchyard-profile/v1", id: "synthetic-portability-proof", name: "Synthetic portability proof",
  plan: { schema: "sxsy-agentic-layout-plan/v1", profile: { schema: "sxsy-board-profile/v1", name: "Synthetic two-key keyboard; no hardware evidence", layout: "synthetic-two", controller: "unknown", source: "manual", qmkKeyboard: null,
    keys: [{ id: "one", label: "A", matrix: [0, 0], x: 0, y: 0, w: 1, h: 1, baseKeycode: "KC_A" }, { id: "two", label: "B", matrix: [0, 1], x: 1, y: 0, w: 1, h: 1, baseKeycode: "KC_B" }] },
    actions: [{ id: "return-to-task", label: "Return to task", family: "lifecycle", consequence: "read_only", confirmation: false, frequencyPerDay: 0, secondsSaved: 0, binding: { keyId: "two", modifier: "gui_ctrl" } }], study: null },
  workflow: { schema: "switchyard-workflow/v1", name: "Synthetic build", roles: [{ id: "coding", label: "Coding" }], steps: [{ id: "build", label: "Build", roleId: "coding", after: [] }] }
};
await api("profile/package/import", { document: profile }, 401, false);
const legacy = await api("profile/package/review", { document: profile }); assert.equal(legacy.migrationRequired, true);
await api("profile/package/import", { document: profile, reviewId: legacy.reviewId });
const { document } = await api("profile/package/export", { preferences: { modePreference: "personal-companion", intentAssignments: [{ actionId: "return-to-task", roleId: "coding", intent: "resume" }] } });
const stale = await api("profile/package/review", { document });
await api("workflow/save", { workflow: { ...profile.workflow, name: "Changed during synthetic review" } });
await api("profile/package/import", { document, reviewId: stale.reviewId }, 409);
const reviewed = await api("profile/package/review", { document });
const imported = await api("profile/package/import", { document, reviewId: reviewed.reviewId });
assert.equal(imported.localMode, "keyboard-only"); assert.equal(imported.localConnectionsRequireReview, true);
const exported = await api("profile/package/export"); assert.deepEqual(exported.document, document);
const futureBefore = definitionDigest(await api("snapshot"));
const unknown = await api("profile/package/review", { document: { schema: "switchyard-profile/v99", opaque: [1, 2] } }); assert.equal(unknown.preserved, true);
assert.equal(definitionDigest(await api("snapshot")), futureBefore);
results.push("legacy migration reviewed explicitly", "stale review rejected", "mode preference did not activate providers", "stable intents/compatibility round-tripped", "unknown future version preserved definitions", "unauthenticated import rejected");
assert.equal(JSON.parse(await cli(["stop"])).stopped, true); await cli(["launch", "--no-open"]); await connect();
const secondIdentity = JSON.parse(await cli(["status"])); assert.notEqual(secondIdentity.instanceId, firstIdentity.instanceId); assert.equal(endpoint.url, privateLink);
assert.deepEqual((await api("profile/package/export")).document, document); assert.equal((await api("snapshot")).mode, "keyboard-only");
assert.equal(definitionDigest(await api("snapshot", { compartment: "personal" })), personalBefore);
const home = await fetch(url.origin, { signal: AbortSignal.timeout(10000) }), homeSha256 = createHash("sha256").update(Buffer.from(await home.arrayBuffer())).digest("hex");
results.push("normal installed restart preserved package and private review link", "Personal definitions remained unchanged");
const receipt = { schema: "switchyard-profile-host-verification/v1", at: new Date().toISOString(), build: secondIdentity.build, compartment, revision: document.revision, checks: results, mode: "keyboard-only", homeSha256, microphoneOpened: false, hidOpened: false, providerContacted: false, visualAcceptance: false };
const directory = join(homedir(), ".local/state/strathex-switchyard/runtime-verification"); await privateDirectory(directory);
const path = join(directory, `profile-${Date.now()}.json`); await privateWrite(path, JSON.stringify(receipt, null, 2) + "\n");
console.log(JSON.stringify({ receipt: path, build: receipt.build, checks: results.length, keyboardOnly: true, privateLinkRetained: true, visualAcceptance: false }));
