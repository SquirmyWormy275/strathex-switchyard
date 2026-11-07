#!/usr/bin/env node
/** Fixed in-memory installed Cargo checks. No Cargo process, package, account or task is opened. */
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
  throw Error("Usage on the pilot: node scripts/verify-cargo-inventory-host.mjs --read-only-metadata");
const sha = b => createHash("sha256").update(b).digest("hex"), app = await applicationStatus(); assert.equal(app.status, "ready");
const root = join(installationRoot(), "versions", app.build), manifest = await verifySuiteRelease(root, { expectedId: app.build, platform: "linux", checkRuntime: true }); assert.equal(manifest.development, false);
const source = JSON.parse(await readFile(new URL("../docs/evidence/cargo-quoted-manifest-source-summary.json", import.meta.url))), moduleDigests = {}, checks = [];
for (const path of ["tools/layout-studio/shield-scanner-engine.mjs", "tools/layout-studio/repository-shield.mjs"]) {
  const digest = sha(await readFile(join(root, path))); assert.equal(digest, source.sourceFiles[path]); moduleDigests[path] = digest;
}
const fixturePath = "tools/layout-studio/test-support/shield-scanner-fixture.mjs";
assert.equal(sha(await readFile(new URL("../" + fixturePath, import.meta.url))), source.sourceFiles[fixturePath]);
checks.push("two-exact-tested-installed-module-hashes-and-source-fixture");
const load = path => import(pathToFileURL(join(root, path)).href);
const { parseCargoLock, parseCargoVersion, compareCargoVersions, cargoPublicSource, cargoCycloneDxComponent, scanShieldInputs, inspectCargoArchive } = await load("tools/layout-studio/shield-scanner-engine.mjs"), { parseShieldScannerReport } = await load("tools/layout-studio/repository-shield.mjs");
const { cargoLockFixture, cargoArtifactFixture } = await import("../tools/layout-studio/test-support/shield-scanner-fixture.mjs");
const declaration = (source = cargoPublicSource) => '[[package]]\nname = "example"\nversion = "1.2.3-rc.1+build.7"\n' + (source ? 'source = ' + JSON.stringify(source) + '\n' + (source.startsWith("registry+") ? 'checksum = "' + "a".repeat(64) + '"\n' : "") : "");
const privateSource = "git+ssh://NEVER_RETAIN_PRIVATE_CARGO/repository#" + "b".repeat(40), privateRegistry = "registry+https://NEVER_RETAIN_PRIVATE_REGISTRY/index";
for (const version of [3, 4]) {
  const rows = parseCargoLock("version = " + version + "\n" + declaration(null) + declaration() + declaration(privateSource) + declaration(privateRegistry));
  assert.deepEqual(rows.map(r => r.sourceKind), ["local", "crates.io", "git", "registry"]);
  const bom = rows.map(r => cargoCycloneDxComponent({ ...r, lockPath: "Cargo.lock" }));
  assert.equal(new Set(bom.map(r => r["bom-ref"])).size, 4); assert.equal(bom.filter(r => r.purl).length, 1);
  assert.equal(bom[1].purl, "pkg:cargo/example@1.2.3-rc.1%2Bbuild.7"); assert.ok(bom.every(r => !r.hashes)); assert.equal(JSON.stringify(bom).includes("NEVER_RETAIN"), false);
}
checks.push("cargo-three-and-four-preserve-private-source-and-declared-checksum-boundaries");
const ordered = ["1.0.0-alpha", "1.0.0-alpha.1", "1.0.0-alpha.beta", "1.0.0-beta", "1.0.0-beta.2", "1.0.0-beta.11", "1.0.0-rc.1", "1.0.0"];
for (let i = 0; i < ordered.length; i++) for (let j = 0; j < ordered.length; j++) assert.equal(compareCargoVersions(ordered[i], ordered[j]), Math.sign(i - j));
assert.equal(compareCargoVersions("1.2.3-rc.1+one", "1.2.3-rc.1+two"), 0);
assert.equal(compareCargoVersions("18446744073709551614.0.0", "18446744073709551615.0.0"), -1);
assert.equal(compareCargoVersions("1.0.0-999999999999999999999999999", "1.0.0-1000000000000000000000000000"), -1);
for (const v of ["1.2.3-01", "1.2.3+a..b", "1.2.3+a_b", "18446744073709551616.0.0", "v1.2.3", "1.2.3\n", "1.2.3+" + "a".repeat(251)]) assert.throws(() => parseCargoVersion(v));
checks.push("literal-semver-and-u64-bounds-without-floating-point-precedence");
const valid = "version = 4\n" + declaration();
for (const text of [valid + declaration(), valid + 'name = "replacement"\n', valid + "[unknown]\n", valid + 'dependencies = ["a", "a"]\n', valid + 'dependencies = ["\\ud800"]\n', valid + "\0", valid + "#".repeat(8193), valid + "\n".repeat(32768), valid.replace("version = 4", "version = 5")]) assert.throws(() => parseCargoLock(text));
checks.push("ambiguous-or-over-budget-locks-refuse-the-whole-inventory");
let inventoryMismatch;
for (const action of ["shield_supply_chain", "release_shield"]) for (const clean of [false, true]) for (const cargoVersion of ["1.2.3", "1.2.3-rc.1+build.7"]) {
  const f = cargoLockFixture({ action, clean, cargoVersion }), r = await scanShieldInputs(f.request, { readInput: f.readInput }), context = { engine: r.engine, requestSha256: r.requestSha256, request: f.request };
  assert.equal(r.outcome, clean ? "incomplete" : "failed"); assert.equal(r.completeness, "incomplete"); assert.deepEqual(r.findings.map(f => f.ruleId), clean ? [] : ["RUSTSEC-synthetic-only"]);
  assert.equal(JSON.stringify(r).includes("private.invalid"), false); assert.deepEqual(parseShieldScannerReport(JSON.stringify(r), context, action), r);
  for (const gap of ["cargo_resolution_not_performed", "package_source_or_integrity", "publisher_provenance_not_verified"]) assert.ok(r.gaps.includes(gap));
  if (!clean) inventoryMismatch = { r, context, action };
}
checks.push("eight-in-memory-reports-separate-public-advisories-from-private-identities");
for (const mutate of [r => { r.sbom.components[2].sourceKind = "crates.io"; }, r => { r.cycloneDx.components[2].purl = "pkg:cargo/example@1.2.3"; }, r => { r.sbom.components[1].declaredSha256 = null; }, r => { r.gaps = r.gaps.filter(g => g !== "cargo_resolution_not_performed"); }]) {
  const changed = structuredClone(inventoryMismatch.r); mutate(changed); assert.throws(() => parseShieldScannerReport(JSON.stringify(changed), inventoryMismatch.context, inventoryMismatch.action));
}
checks.push("forged-public-source-and-resolved-inventory-claims-refuse-admission");
let artifactMismatch;
for (const action of ["shield_supply_chain", "release_shield"]) for (const source of [cargoPublicSource, privateRegistry]) for (const artifactStatus of ["matched", "mismatched"]) {
  const f = cargoArtifactFixture({ action, source, artifactStatus }), r = await scanShieldInputs(f.request, { readInput: f.readInput }), context = { engine: r.engine, requestSha256: r.requestSha256, request: f.request };
  assert.equal(r.sbom.components[0].artifact.status, artifactStatus); assert.equal(r.outcome, artifactStatus === "matched" ? "incomplete" : "failed");
  assert.ok(r.gaps.includes("artifact_contents_not_inspected")); assert.equal(JSON.stringify(r).includes("NEVER_RETAIN"), false); assert.deepEqual(parseShieldScannerReport(JSON.stringify(r), context, action), r);
  if (artifactStatus === "mismatched") artifactMismatch = { r, context, action };
}
checks.push("eight-in-memory-byte-comparisons-retain-registry-and-uninspected-content-limits");
for (const mutate of [r => { r.sbom.components[0].artifact.status = "matched"; }, r => { r.sbom.components[0].sourceSha256 = "0".repeat(64); }, r => { r.gaps = r.gaps.filter(g => g !== "package_artifact_not_verified"); }, r => { r.findings = []; r.outcome = "incomplete"; r.coverage.forEach(c => c.findings = 0); }]) {
  const changed = structuredClone(artifactMismatch.r); mutate(changed); assert.throws(() => parseShieldScannerReport(JSON.stringify(changed), artifactMismatch.context, artifactMismatch.action));
}
checks.push("forged-cargo-byte-and-failure-observations-refuse-admission");
const archiveOraclePath = "scripts/fixtures/cargo-archive-oracle.json", archiveOracleBytes = await readFile(new URL("../" + archiveOraclePath, import.meta.url)), archiveOracle = JSON.parse(archiveOracleBytes);
assert.equal(sha(archiveOracleBytes), source.sourceFiles[archiveOraclePath]); assert.equal(archiveOracle.cases.length, 58);
for (const row of archiveOracle.cases) {
  const bytes = Buffer.from(row.bytesBase64, "base64"); assert.equal(sha(bytes), row.sha256);
  const a = inspectCargoArchive(bytes); assert.equal(a.status, row.supported ? "inspected" : "unsupported");
  if (row.supported) { assert.equal(row.toml.parsed, true); assert.equal(a.name, row.toml.name); assert.equal(a.version, row.toml.version); assert.equal(a.manifestSha256, row.manifestSha256); assert.equal(a.expandedBytes, row.expandedBytes); }
}
checks.push("fifty-eight-independent-toml-ustar-gzip-facts-without-extraction");
for (const path of ["tools/layout-studio/test-support/cargo-archive-fixture.mjs", "tools/layout-studio/test-support/npm-archive-fixture.mjs"]) assert.equal(sha(await readFile(new URL("../" + path, import.meta.url))), source.sourceFiles[path]);
const { cargoArchiveFixture } = await import("../tools/layout-studio/test-support/cargo-archive-fixture.mjs");
for (const action of ["shield_supply_chain", "release_shield"]) for (const archiveStatus of ["matched", "mismatched", "unsupported"]) {
  const f = cargoArchiveFixture({ action, archiveStatus }), r = await scanShieldInputs(f.request, { readInput: f.readInput }), context = { engine: r.engine, requestSha256: r.requestSha256, request: f.request };
  assert.equal(r.sbom.components[0].artifact.archive.status, archiveStatus); assert.equal(r.outcome, archiveStatus === "mismatched" ? "failed" : "incomplete");
  assert.deepEqual(parseShieldScannerReport(JSON.stringify(r), context, action), r);
  if (archiveStatus === "mismatched") {
    const forged = structuredClone(r); forged.findings = []; forged.outcome = "incomplete"; forged.coverage.forEach(c => c.findings = 0);
    assert.throws(() => parseShieldScannerReport(JSON.stringify(forged), context, action));
  }
}
checks.push("six-in-memory-crate-reports-retain-mismatches-gaps-and-forgery-refusal");
const evidence = { schema: "switchyard-installed-cargo-inventory-metadata/v2", at: new Date().toISOString(), sourceCommit: manifest.sourceCommit, applicationRelease: manifest.id, moduleDigests, verifierSourceSha256: sha(await readFile(new URL(import.meta.url))), fixtureSha256: source.sourceFiles[fixturePath], archiveOracleSha256: sha(archiveOracleBytes), checks, success: true, pureInMemoryOnly: true, actualScannerProcesses: 0, cargoProcesses: 0, dependencyResolution: false, archiveExtractionOrExecution: false, providerOrModelRequests: 0, publicRequests: 0, liveAccountChanges: 0, hardwareOperations: 0 };
const { privateDirectory } = await import("../tools/layout-studio/private-fs.mjs"), outputRoot = join(process.env.XDG_STATE_HOME || join(homedir(), ".local/state"), "strathex-switchyard/runtime-verification"); await privateDirectory(outputRoot);
const out = join(outputRoot, "installed-cargo-inventory-metadata-" + Date.now() + ".json"); await writeFile(out, JSON.stringify(evidence, null, 2) + "\n", { flag: "wx", mode: 0o600 });
console.log(JSON.stringify({ receipt: out, checks: checks.length, success: true, pureInMemoryOnly: true }));
