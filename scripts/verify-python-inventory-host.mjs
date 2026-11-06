#!/usr/bin/env node
/** Installed Python inventory checks using fixed in-memory inputs. No tasks, processes, accounts or packages are changed. */
import assert from "node:assert/strict";
import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { homedir } from "node:os";
import { pathToFileURL } from "node:url";
import { createHash } from "node:crypto";
import { applicationStatus } from "../deployment/suite/application.mjs";
import { installationRoot } from "../deployment/suite/installation.mjs";
import { verifySuiteRelease } from "../deployment/suite/release.mjs";
const flags = process.argv.slice(2);
if (process.platform !== "linux" || flags.length !== 1 || flags[0] !== "--read-only-metadata")
  throw Error("Usage on the pilot: node scripts/verify-python-inventory-host.mjs --read-only-metadata");
const sha = bytes => createHash("sha256").update(bytes).digest("hex"), app = await applicationStatus();
assert.equal(app.status, "ready");
const root = join(installationRoot(), "versions", app.build), manifest = await verifySuiteRelease(root, { expectedId: app.build, platform: "linux", checkRuntime: true });
assert.equal(manifest.development, false);
const sourceEvidence = JSON.parse(await readFile(new URL("../docs/evidence/pypi-markers-source-summary.json", import.meta.url), "utf8")), moduleDigests = {}, checks = [];
for (const name of ["tools/layout-studio/shield-scanner-engine.mjs", "tools/layout-studio/repository-shield.mjs"]) {
  const digest = sha(await readFile(join(root, name))); assert.equal(digest, sourceEvidence.sourceFiles[name]); moduleDigests[name] = digest;
}
checks.push("two-exact-tested-installed-inventory-module-hashes");
const load = name => import(pathToFileURL(join(root, name)).href);
const { parsePinnedRequirements, scanShieldInputs } = await load("tools/layout-studio/shield-scanner-engine.mjs"), { parseShieldScannerReport } = await load("tools/layout-studio/repository-shield.mjs");
const oraclePath = "scripts/fixtures/pypi-marker-oracle.json", oracleBytes = await readFile(new URL("../" + oraclePath, import.meta.url));
assert.equal(sha(oracleBytes), sourceEvidence.sourceFiles[oraclePath]);
const oracle = JSON.parse(oracleBytes); assert.equal(oracle.cases.length, 87); assert.equal(oracle.markersEvaluated, false);
for (const row of oracle.cases) assert.deepEqual(parsePinnedRequirements(row.input), row.components);
checks.push("eighty-seven-independent-pip-pypa-marker-facts-without-evaluation");
const oldOracleBytes = await readFile(new URL("./fixtures/pypi-requirements-oracle.json", import.meta.url)), oldOracle = JSON.parse(oldOracleBytes);
assert.equal(oldOracle.cases.length, 39);
for (const row of oldOracle.cases) assert.deepEqual(parsePinnedRequirements(row.input), row.components);
checks.push("thirty-nine-original-extras-and-preprocessing-facts");
for (const marker of ["", 'extra == "tls"', 'unknown == "x"', 'python_version < "3" < "4"', 'os_name == "x\\y"', '('.repeat(17) + 'os_name=="x"' + ')'.repeat(17), Array(65).fill('os_name=="x"').join(' or ')]) assert.throws(() => parsePinnedRequirements("ordinary==1\ndemo==2; " + marker));
checks.push("unsupported-context-and-over-budget-markers-refuse-the-whole-file");
const fixturePath = "tools/layout-studio/test-support/shield-scanner-fixture.mjs";
assert.equal(sha(await readFile(new URL("../" + fixturePath, import.meta.url))), sourceEvidence.sourceFiles[fixturePath]);
const { scannerFixture, pypiArtifactFixture } = await import("../tools/layout-studio/test-support/shield-scanner-fixture.mjs");
const marker = 'python_version < "0" and platform_version == "NEVER_COPY_INSTALLED_MARKER_LITERAL"';
const fixture = scannerFixture({ action: "release_shield", files: { "requirements.txt": "Demo[TLS]==1.2.3; " + marker }, advisory: [{ ecosystem: "PyPI", name: "demo", version: "1.2.3", advisories: [{ id: "SYNTHETIC-CONDITIONAL-PIN", severity: "high" }] }] });
const report = await scanShieldInputs(fixture.request, { readInput: fixture.readInput }), context = { engine: report.engine, requestSha256: report.requestSha256, request: fixture.request };
assert.equal(report.outcome, "failed"); assert.equal(report.completeness, "incomplete"); assert.equal(report.findings[0].ruleId, "SYNTHETIC-CONDITIONAL-PIN");
assert.deepEqual(report.sbom.components[0].marker, { sha256: sha(marker), variables: ["platform_version", "python_version"] });
assert.equal(JSON.stringify(report).includes("NEVER_COPY_INSTALLED_MARKER_LITERAL"), false);
assert.equal(report.cycloneDx.components[0].properties.find(p => p.name === "switchyard:python-marker-evaluation").value, "not-evaluated");
assert.deepEqual(parseShieldScannerReport(JSON.stringify(report), context, fixture.request.action), report);
checks.push("in-memory-conditional-advisory-findings-retain-private-literals-and-incomplete-coverage");
for (const mutate of [r => { r.gaps = r.gaps.filter(g => g !== "python_markers_not_evaluated"); }, r => { r.sbom.components[0].marker.variables = ["extra"]; }, r => { r.sbom.components[0].marker.evaluated = true; }, r => { r.cycloneDx.components[0].properties.find(p => p.name === "switchyard:python-marker-evaluation").value = "true"; }]) {
  const changed = structuredClone(report); mutate(changed); assert.throws(() => parseShieldScannerReport(JSON.stringify(changed), context, fixture.request.action));
}
checks.push("forged-marker-metadata-and-evaluation-claims-refuse-host-admission");
for (const action of ["shield_supply_chain", "release_shield"]) for (const artifactStatus of ["matched", "mismatched", "unsupported-integrity"]) {
  const f = pypiArtifactFixture({ action, artifactStatus, marker: 'python_version < "0"' }), r = await scanShieldInputs(f.request, { readInput: f.readInput });
  assert.equal(r.sbom.components[0].artifact.status, artifactStatus); assert.equal(r.outcome, artifactStatus === "mismatched" ? "failed" : "incomplete");
  assert.ok(r.gaps.includes("python_markers_not_evaluated")); assert.ok(r.gaps.includes("artifact_contents_not_inspected"));
  assert.deepEqual(parseShieldScannerReport(JSON.stringify(r), { engine: r.engine, requestSha256: r.requestSha256, request: f.request }, action), r);
}
checks.push("six-in-memory-artifact-comparisons-preserve-conditional-pin-limits");
const evidence = { schema: "switchyard-installed-python-inventory-metadata/v1", at: new Date().toISOString(), sourceCommit: manifest.sourceCommit, applicationRelease: manifest.id, moduleDigests, verifierSourceSha256: sha(await readFile(new URL(import.meta.url))), markerOracleSha256: sha(oracleBytes), extrasOracleSha256: sha(oldOracleBytes), checks, success: true, pureInMemoryOnly: true, markerExpressionsEvaluated: 0, actualScannerProcesses: 0, nativeProcessesStarted: 0, providerOrModelRequests: 0, publicRequests: 0, liveAccountChanges: 0, hardwareOperations: 0 };
const { privateDirectory } = await import("../tools/layout-studio/private-fs.mjs");
const outputRoot = join(process.env.XDG_STATE_HOME || join(homedir(), ".local/state"), "strathex-switchyard/runtime-verification"); await privateDirectory(outputRoot);
const out = join(outputRoot, "installed-python-inventory-metadata-" + Date.now() + ".json");
await writeFile(out, JSON.stringify(evidence, null, 2) + "\n", { flag: "wx", mode: 0o600 });
console.log(JSON.stringify({ receipt: out, checks: checks.length, success: true, pureInMemoryOnly: true }));
