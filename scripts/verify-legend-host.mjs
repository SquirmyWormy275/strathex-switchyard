#!/usr/bin/env node
/** Normal pilot update and protected export proof; never prints private content or URLs. */
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { realpath, rm } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";
import { privateRead, privateWrite } from "../tools/layout-studio/private-fs.mjs";
import { applicationStateRoot } from "../deployment/suite/application.mjs";
import { verifySuiteRelease } from "../deployment/suite/release.mjs";
import { exportAssignmentLegends } from "../tools/layout-studio/legend-export.mjs";

const [flag, input, expected] = process.argv.slice(2);
if (process.platform !== "linux" || flag !== "--update" || !input || !/^[a-f0-9]{64}$/.test(expected ?? "") || process.argv.length !== 5) throw new Error("Usage on the pilot: node scripts/verify-legend-host.mjs --update /absolute/verified/bundle EXPECTED_SHA256");
const bundle = await realpath(input), manifest = await verifySuiteRelease(bundle, { expectedId: expected, platform: "linux", checkRuntime: true });
const digest = (value) => createHash("sha256").update(typeof value === "string" ? value : JSON.stringify(value)).digest("hex");
const checks = [], evidence = { schema: "switchyard-legend-host-verification/v1", at: new Date().toISOString(), sourceCommit: manifest.sourceCommit, applicationRelease: expected, checks, outputs: [], microphoneOpened: false, keyboardWritten: false, providerPrompted: false, printerOrCapFitVerified: false, frontendVisualAcceptance: false };
async function cli(args) {
  return new Promise((resolve, reject) => {
    const child = spawn(join(homedir(), ".local/bin/switchyard"), args, { shell: false, stdio: ["ignore", "pipe", "ignore"] }); let output = "", settled = false;
    const timer = setTimeout(() => { child.kill(); finish(new Error("The installed command exceeded its deadline; preserve recovery state.")); }, 120000);
    function finish(error, value) { if (settled) return; settled = true; clearTimeout(timer); error ? reject(error) : resolve(value); }
    child.stdout.on("data", (b) => { output += b; if (Buffer.byteLength(output) > 65536) { child.kill(); finish(new Error("The installed command exceeded its response bound.")); } });
    child.once("error", () => finish(new Error("The normal installed command is unavailable.")));
    child.once("close", (code) => { if (code) finish(new Error("The normal installed command did not verify; preserve recovery state.")); else { try { finish(null, JSON.parse(output)); } catch { finish(new Error("The installed command returned unsupported output.")); } } });
  });
}
let url, token;
async function connect() { const endpoint = JSON.parse(await privateRead(join(applicationStateRoot(), "endpoint.json"))); url = new URL(endpoint.url); token = /^#access=([A-Za-z0-9_-]{43})$/.exec(url.hash)?.[1]; assert.ok(token && url.protocol === "http:" && url.hostname === "127.0.0.1", "The installed private endpoint is unsupported."); return digest(endpoint.url); }
async function api(path, body = {}, authenticated = true) {
  const response = await fetch(new URL(`/api/suite/${path}`, url.origin), { method: "POST", redirect: "error", headers: { "Content-Type": "application/json", Origin: url.origin, ...(authenticated ? { Authorization: `Bearer ${token}` } : {}) }, body: JSON.stringify(body), signal: AbortSignal.timeout(20000) });
  if (!authenticated) return response.status;
  assert.equal(response.status, 200, "The installed export proof returned an unexpected HTTP status."); return response.json();
}
const definitions = (s) => digest([s.profile, s.workflow, s.roleBindings ?? [], s.mode]);
let failure;
try {
  const link = await connect(), personal = definitions(await api("snapshot", { compartment: "personal" })), document = await api("profile/package/export", { compartment: "profile-validation" });
  const update = await cli(["update", bundle, expected]); assert.ok(update.current === expected && update.cleanupPending == null, "The normal application update did not finish."); assert.equal(await connect(), link, "The private endpoint changed."); assert.equal((await cli(["status"])).build, expected); checks.push("normal installed update and exact backend release verified");
  const labels = Object.fromEntries(document.document.plan.actions.map((a, i) => [a.id, `Action ${i + 1}`]));
  for (const format of ["review-html", "template-svg", "template-html"]) {
    const options = { format, labels }, reference = await exportAssignmentLegends(document.document, options), actual = await api("profile/legends/export", { compartment: "profile-validation", options });
    assert.equal(digest(actual.manifest), digest(reference.manifest), "Installed assignment meanings or print provenance differed."); assert.equal(actual.sha256, reference.sha256); assert.equal(digest(actual.content), reference.sha256);
    evidence.outputs.push({ format, sha256: actual.sha256, bytes: Buffer.byteLength(actual.content), assignments: actual.manifest.assignments.length, pages: actual.manifest.template.pageCount }); checks.push(`installed ${format} matched the exact source implementation`);
  }
  assert.equal(await api("profile/legends/export", {}, false), 401); checks.push("unauthenticated export rejected without opening private definitions");
  assert.equal(definitions(await api("snapshot", { compartment: "personal" })), personal, "Personal definitions or mode changed."); assert.equal(digest(await api("profile/package/export", { compartment: "profile-validation" })), digest(document), "The validation package changed."); assert.equal((await api("snapshot", { compartment: "profile-validation" })).mode, "keyboard-only"); assert.equal(await connect(), link, "The private endpoint changed.");
  const home = await fetch(url.origin, { signal: AbortSignal.timeout(15000) }); evidence.homeSha256 = digest(Buffer.from(await home.arrayBuffer()).toString("utf8")); assert.equal(evidence.homeSha256, "20ba0095a6b9650046df34541872aa7e0a7cdc7db5182f065abb009127c6c130"); evidence.frontend = manifest.frontend.digest; checks.push("definitions, package, modes, private link and exact frozen Home preserved");
  if (bundle.startsWith(join(process.cwd(), "artifacts/switchyard-suite") + "/")) { await verifySuiteRelease(bundle, { expectedId: expected }); await rm(bundle, { recursive: true }); evidence.disposableBundleRemoved = true; }
} catch (error) { failure = error; evidence.failure = error.message; }
const path = join(homedir(), ".local/state/strathex-switchyard/runtime-verification", `assignment-legends-${Date.now()}.json`); await privateWrite(path, JSON.stringify(evidence, null, 2) + "\n");
console.log(JSON.stringify({ receipt: path, sourceCommit: manifest.sourceCommit, applicationRelease: expected, checks: checks.length, disposableBundleRemoved: evidence.disposableBundleRemoved ?? false, failure: failure?.message ?? null }));
if (failure) throw failure;
