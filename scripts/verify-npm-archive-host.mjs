#!/usr/bin/env node
/** Fixed installed metadata and memory-only reports. Never invokes npm or a scanner process. */
import assert from "node:assert/strict";
import { readFile, writeFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import { join } from "node:path";
import { homedir } from "node:os";
import { pathToFileURL } from "node:url";
import { applicationStatus } from "../deployment/suite/application.mjs";
import { installationRoot } from "../deployment/suite/installation.mjs";
import { verifySuiteRelease } from "../deployment/suite/release.mjs";
const flags = process.argv.slice(2);
if (process.platform !== "linux" || flags.length !== 1 || flags[0] !== "--read-only-metadata") throw Error("Usage on the pilot: node scripts/verify-npm-archive-host.mjs --read-only-metadata");
const sha = b => createHash("sha256").update(b).digest("hex"), app = await applicationStatus(); assert.equal(app.status, "ready");
const root = join(installationRoot(), "versions", app.build), manifest = await verifySuiteRelease(root, { expectedId: app.build, platform: "linux", checkRuntime: true }); assert.equal(manifest.development, false);
const source = JSON.parse(await readFile(new URL("../docs/evidence/npm-archive-license-source-summary.json", import.meta.url))), moduleDigests = {}, checks = [];
for (const path of ["tools/layout-studio/shield-scanner-engine.mjs", "tools/layout-studio/repository-shield.mjs"]) { const digest = sha(await readFile(join(root, path))); assert.equal(digest, source.sourceFiles[path]); moduleDigests[path] = digest; }
for (const path of ["tools/layout-studio/test-support/shield-scanner-fixture.mjs", "tools/layout-studio/test-support/npm-archive-fixture.mjs"]) assert.equal(sha(await readFile(new URL("../" + path, import.meta.url))), source.sourceFiles[path]);
checks.push("two-tested-installed-module-hashes-and-exact-fixture-sources");
const { inspectNpmArchive, scanShieldInputs } = await import(pathToFileURL(join(root, "tools/layout-studio/shield-scanner-engine.mjs")).href), { parseShieldScannerReport } = await import(pathToFileURL(join(root, "tools/layout-studio/repository-shield.mjs")).href);
const { npmArchiveFixture } = await import("../tools/layout-studio/test-support/npm-archive-fixture.mjs"), { npmArtifactFixture } = await import("../tools/layout-studio/test-support/shield-scanner-fixture.mjs");
for (const [license, status] of [[undefined, "missing"], ["MIT OR Apache-2.0", "declared"], ["UNLICENSED", "unsupported"], [" UNLICENSED ", "unsupported"], ["SEE LICENSE IN NEVER_RETAIN_PRIVATE_PATH", "file-only"], [{ type: "MIT" }, "unsupported"], ["LicenseRef-NEVER_RETAIN_TEXT", "unsupported"]]) {
  const a = inspectNpmArchive(npmArchiveFixture({ manifest: JSON.stringify({ name: "synthetic", version: "1.0.0", license }) })); assert.equal(a.status, "inspected"); assert.equal(a.license.status, status); assert.equal(JSON.stringify(a).includes("NEVER_RETAIN"), false);
}
checks.push("seven-declaration-metadata-cases-without-raw-text-or-paths");
for (const action of ["shield_supply_chain", "release_shield"]) for (const scenario of ["matched", "mismatched", "unsupported", "license-disallowed"]) {
  const f = npmArtifactFixture({ action, archiveStatus: scenario }), r = await scanShieldInputs(f.request, { readInput: f.readInput }), a = r.sbom.components[0].artifact, context = { engine: r.engine, request: f.request, requestSha256: r.requestSha256 };
  assert.equal(r.sbom.components[0].license, "MIT"); assert.equal(a.licensePolicy, scenario === "matched" ? "permitted" : scenario === "license-disallowed" ? "disallowed" : "unassessed"); assert.equal(r.outcome, ["mismatched", "license-disallowed"].includes(scenario) ? "failed" : "incomplete"); assert.equal(r.gaps.includes("license_choice_not_selected"), scenario === "matched"); assert.ok(r.gaps.includes("artifact_contents_not_inspected")); assert.deepEqual(parseShieldScannerReport(JSON.stringify(r), context, action), r);
  if (scenario === "license-disallowed") { const forged = structuredClone(r); forged.findings = []; forged.outcome = "incomplete"; forged.coverage.forEach(c => c.findings = 0); assert.throws(() => parseShieldScannerReport(JSON.stringify(forged), context, action)); }
}
checks.push("eight-in-memory-reports-preserve-lock-and-archive-policy-boundaries");
const evidence = { schema: "switchyard-installed-npm-archive-metadata/v1", at: new Date().toISOString(), sourceCommit: manifest.sourceCommit, applicationRelease: manifest.id, moduleDigests, verifierSourceSha256: sha(await readFile(new URL(import.meta.url))), checks, success: true, pureInMemoryOnly: true, inMemoryReports: 8, npmProcesses: 0, scannerProcesses: 0, archiveExtractionOrExecution: false, providerOrModelRequests: 0, publicRequests: 0, liveAccountChanges: 0, hardwareOperations: 0 };
const { privateDirectory } = await import("../tools/layout-studio/private-fs.mjs"), directory = join(process.env.XDG_STATE_HOME || join(homedir(), ".local/state"), "strathex-switchyard/runtime-verification"); await privateDirectory(directory);
const out = join(directory, "installed-npm-archive-metadata-" + Date.now() + ".json"); await writeFile(out, JSON.stringify(evidence, null, 2) + "\n", { flag: "wx", mode: 0o600 }); console.log(JSON.stringify({ receipt: out, checks: checks.length, success: true, pureInMemoryOnly: true }));
