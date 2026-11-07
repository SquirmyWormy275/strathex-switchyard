import test from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFile, access } from "node:fs/promises";
import { join } from "node:path";
import { cargoPublicSource, scanShieldInputs, shieldCycloneDxComponent, validateShieldRequest } from "./shield-scanner-engine.mjs";
import { parseShieldScannerReport } from "./repository-shield.mjs";
import { cargoArtifactFixture, npmArtifactFixture, scannerFixture } from "./test-support/shield-scanner-fixture.mjs";
import { repositoryShieldFixture } from "./test-support/repository-shield-fixture.mjs";
import { windowsExecutionFixture } from "./test-support/windows-execution-fixture.mjs";
import { runtimeGuardianStopped } from "./runtime-command.mjs";
const sha = b => createHash("sha256").update(b).digest("hex");
const context = f => ({ engine: "switchyard-baseline-scanner/1", request: validateShieldRequest(f.request), requestSha256: sha(JSON.stringify(validateShieldRequest(f.request))) });
const admit = (r, f) => parseShieldScannerReport(JSON.stringify(r), context(f), f.request.action);
function replaceFile(f, path, bytes) {
  bytes = Buffer.from(bytes); f.content.set(path, bytes);
  Object.assign(f.request.files.find(row => row.path === path), { size: bytes.length, sha256: sha(bytes) });
}

test("Cargo compares reviewed raw bytes with the exact registry declaration and keeps content and publisher gaps", async () => {
  for (const artifactStatus of ["matched", "mismatched"]) {
    const f = cargoArtifactFixture({ artifactStatus }), r = await f.scan(), c = r.sbom.components[0], a = c.artifact;
    assert.equal(a.status, artifactStatus); assert.equal(a.sha256, sha(f.content.get(a.path))); assert.equal(a.algorithm, "sha256"); assert.equal(a.expectedSha256, c.declaredSha256);
    assert.equal(r.outcome, artifactStatus === "matched" ? "incomplete" : "failed"); assert.equal(r.findings.length, artifactStatus === "matched" ? 0 : 1);
    assert.equal(r.gaps.includes("package_artifact_not_verified"), artifactStatus !== "matched");
    for (const gap of ["repository_scope_unverified", "publisher_provenance_not_verified", "artifact_contents_not_inspected", "cargo_resolution_not_performed", "license_metadata", "binary_or_non_utf8_input"]) assert.ok(r.gaps.includes(gap), gap);
    assert.equal(r.completeness, "incomplete"); assert.equal(r.cycloneDx.compositions[0].aggregate, "unknown"); assert.equal(r.cycloneDx.components[0].hashes, undefined);
    assert.deepEqual(admit(r, f), r);
    if (artifactStatus === "mismatched") assert.equal(r.findings[0].fingerprint, sha(["artifact.integrity-mismatch", "Cargo", "Cargo.lock", sha(f.content.get("Cargo.lock")), "example", "1.2.3-rc.1+build.7", sha(cargoPublicSource), "reviewed-package.crate", sha(f.content.get("reviewed-package.crate"))].join("\0")));
  }
  const f = cargoArtifactFixture(); delete f.request.packageArtifacts;
  const r = await f.scan(); assert.equal(r.sbom.components[0].artifact, undefined); assert.ok(r.gaps.includes("package_artifact_not_verified")); assert.deepEqual(admit(r, f), r);
});
test("Cargo selections preserve exact source, prerelease and build identities without disclosing private registries", async () => {
  const f = cargoArtifactFixture({ artifactStatus: "mismatched" }), original = f.content.get("Cargo.lock").toString(), first = f.request.packageArtifacts[0];
  const privateSource = "registry+https://NEVER_RETAIN.invalid/private", versions = ["1.2.3-rc.1+build.7", "1.2.3-rc.1+build.8", "1.2.3-rc.1+BUILD.7"];
  const rows = [];
  for (const source of [cargoPublicSource, privateSource]) for (const version of versions) {
    rows.push(original.slice(original.indexOf("[[package]]")).replace(cargoPublicSource, source).replace(first.version, version));
    if (source !== cargoPublicSource || version !== first.version) f.request.packageArtifacts.push({ ...first, version, sourceSha256: sha(source) });
  }
  replaceFile(f, "Cargo.lock", "version = 4\n" + rows.join(""));
  const r = await f.scan(); assert.equal(r.sbom.components.length, 6); assert.equal(r.findings.length, 6); assert.equal(new Set(r.findings.map(f => f.fingerprint)).size, 6);
  assert.equal(JSON.stringify(r).includes("NEVER_RETAIN"), false); assert.equal(r.cycloneDx.components.filter(c => c.purl).length, 3); assert.deepEqual(admit(r, f), r);
  for (const change of [{ sourceSha256: "a".repeat(64) }, { version: "1.2.3" }, { name: "another" }]) {
    const request = structuredClone(f.request); Object.assign(request.packageArtifacts[0], change);
    await assert.rejects(scanShieldInputs(request, { readInput: f.readInput }), /artifact/i);
  }
});
test("Cargo rejects ambiguous selections, unreviewed bytes, invalid identities and mixed manifest aliases", () => {
  const f = cargoArtifactFixture();
  for (const mutate of [
    r => { r.action = "shield_codebase_audit"; }, r => { r.packageArtifacts.push(r.packageArtifacts[0]); }, r => { r.packageArtifacts = Array(129).fill(r.packageArtifacts[0]); },
    ...[{ ecosystem: "cargo" }, { ecosystem: "npm" }, { path: "../private" }, { path: "absent.crate" }, { path: "rules.json" }, { path: "Cargo.lock" }, { lockPath: "app.js" }, { lockPath: "missing/Cargo.lock" }, { name: "../example" }, { version: "1.2.3-01" }, { sourceSha256: null }, { sourceSha256: "A".repeat(64) }, { raw: "NEVER_RETAIN" }].map(change => r => Object.assign(r.packageArtifacts[0], change)),
    r => { r.files.find(f => f.path === "reviewed-package.crate").size = 0; },
    r => { r.files.push({ path: "nested/Cargo.lock", size: 1, sha256: "a".repeat(64) }); r.packageArtifacts.push({ ...r.packageArtifacts[0], lockPath: "nested/Cargo.lock", path: "Cargo.lock" }); }
  ]) { const request = structuredClone(f.request); mutate(request); assert.throws(() => validateShieldRequest(request)); }
  for (const path of ["nested/Cargo.lock", "package-lock.json", "requirements.txt"]) {
    const request = structuredClone(f.request); request.files.push({ path, size: 1, sha256: "a".repeat(64) }); request.packageArtifacts[0].path = path;
    assert.throws(() => validateShieldRequest(request), /manifest/);
  }
  assert.deepEqual(validateShieldRequest(f.request).packageArtifacts, f.request.packageArtifacts);
});
test("unsupported locks, absent components and Git sources cannot consume a Cargo artifact reference", async () => {
  for (const text of ["version = 5\n", "version = 4\n", "version = 4\n[metadata]\n", "\0binary"]) {
    const f = cargoArtifactFixture(); replaceFile(f, "Cargo.lock", text); await assert.rejects(f.scan(), /artifact/i);
  }
  const git = cargoArtifactFixture({ source: "git+ssh://NEVER_RETAIN.invalid/repo#" + "a".repeat(40) }); await assert.rejects(git.scan(), /registry declarations/);
  const local = cargoArtifactFixture(); replaceFile(local, "Cargo.lock", 'version = 4\n[[package]]\nname = "example"\nversion = "1.2.3-rc.1+build.7"\n'); await assert.rejects(local.scan(), /artifact/i);
});
test("mixed npm and Cargo selections share bounded reviewed inputs and cannot borrow each other's observations", async () => {
  const cargo = cargoArtifactFixture(), npm = npmArtifactFixture({ artifactStatus: "mismatched" });
  const files = Object.fromEntries([...cargo.request.files.map(f => [f.path, cargo.content.get(f.path)]), ...npm.request.files.map(f => [f.path, npm.content.get(f.path)])]);
  const f = scannerFixture({ action: "release_shield", files }); f.request.packageArtifacts = [...cargo.request.packageArtifacts, ...npm.request.packageArtifacts];
  const r = await f.scan(); assert.deepEqual(r.sbom.components.map(c => [c.ecosystem, c.artifact.status]), [["Cargo", "matched"], ["npm", "mismatched"]]); assert.deepEqual(admit(r, f), r);
  const changed = structuredClone(r); changed.sbom.components[0].artifact = r.sbom.components[1].artifact; assert.throws(() => admit(changed, f));
});
test("Cargo enforces byte witnesses on both reads and retains mismatch failure at the original finding limit", async () => {
  for (const changedRead of [1, 2]) {
    const f = cargoArtifactFixture(); let reads = 0;
    await assert.rejects(scanShieldInputs(f.request, { readInput: async (path, maximum) => {
      const b = await f.readInput(path, maximum); if (path !== "reviewed-package.crate" || ++reads !== changedRead) return b;
      const changed = Buffer.from(b); changed[0] ^= 1; return changed;
    } }), /changed/); assert.equal(reads, changedRead);
  }
  const f = cargoArtifactFixture({ action: "release_shield", artifactStatus: "mismatched" }); replaceFile(f, "app.js", "eval(untrusted);\n".repeat(512));
  const r = await f.scan(); assert.equal(r.findings.length, 512); assert.ok(r.gaps.includes("finding_limit")); assert.equal(r.sbom.components[0].artifact.status, "mismatched"); assert.equal(r.outcome, "failed"); assert.deepEqual(admit(r, f), r);
});
test("host admission binds Cargo bytes, expected checksums, failure findings and unverified scope", async () => {
  const f = cargoArtifactFixture({ artifactStatus: "mismatched" }), r = await f.scan();
  for (const mutate of [
    ...[{ path: "app.js" }, { sha256: "a".repeat(64) }, { size: 1 }, { algorithm: "sha512" }, { expectedSha256: "b".repeat(64) }, { status: "matched" }, { raw: "NEVER_RETAIN" }].map(change => r => Object.assign(r.sbom.components[0].artifact, change)),
    r => { delete r.sbom.components[0].artifact; }, r => { r.sbom.components[0].sourceSha256 = "b".repeat(64); },
    r => { r.gaps = r.gaps.filter(g => g !== "artifact_contents_not_inspected"); }, r => { r.gaps = r.gaps.filter(g => g !== "package_artifact_not_verified"); },
    r => { r.findings = []; r.outcome = "incomplete"; r.coverage.forEach(c => { c.findings = 0; }); }, r => { r.findings[0].fingerprint = "b".repeat(64); }
  ]) {
    const changed = structuredClone(r); mutate(changed);
    assert.throws(() => { changed.cycloneDx.components = changed.sbom.components.map(shieldCycloneDxComponent); admit(changed, f); });
  }
  const request = structuredClone(f.request); delete request.packageArtifacts;
  assert.throws(() => admit({ ...r, requestSha256: context({ request }).requestSha256 }, { request }));
});
async function verifyExecution(t, factory, action, windows) {
  for (const artifactStatus of ["matched", "mismatched"]) {
    const f = await factory(t, { action, shield: true, clean: true, cargoArtifact: artifactStatus });
    const original = () => Promise.all([readFile(join(f.root, "Cargo.lock")), readFile(join(f.root, "reviewed-package.crate")), readFile(join(f.root, ".git/index")), f.run("rev-parse", "HEAD")]), before = await original();
    const review = await f.execution.review("personal", f.proposed); assert.deepEqual(review.review.shield.request.packageArtifacts, f.sample.request.packageArtifacts);
    const input = { requestId: f.proposed.requestId, token: review.confirmation.token }, result = await f.execution.apply("personal", input);
    assert.equal(result.status, artifactStatus === "mismatched" ? "failed" : "incomplete", JSON.stringify(result));
    assert.equal(result.data.shieldReport.sbom.components[0].artifact.status, artifactStatus); assert.equal(result.data.receiptEvidenceEnvelope.outcome, "incomplete");
    assert.equal((await f.execution.apply("personal", input)).receiptId, result.receiptId);
    const status = await f.execution.status("personal", f.proposed.requestId); assert.equal(status.nativeExitVerified, true); assert.equal(status.receipt.gateEligible, false);
    const state = await f.store.snapshot("personal");
    if (windows) { assert.equal(f.effects(), 1); assert.equal(state.repositoryWindowsRuns[0].nativeExitVerified, true); assert.equal(state.repositoryWindowsRuns[0].cleanupPending, false); }
    else { assert.equal(await runtimeGuardianStopped(state.repositoryExecutions[0].ownedRuntime), true); assert.equal(state.repositoryExecutionStaging[0].cleanupPending, false); await assert.rejects(access(state.repositoryExecutionStaging[0].path), { code: "ENOENT" }); }
    assert.ok(state.repositoryProbes.every(row => row.stoppedVerified && row.scratchCleanupPending === false)); assert.deepEqual(await original(), before);
  }
}
for (const action of ["shield_supply_chain", "release_shield"]) {
  test("actual Linux " + action + " compares selected Cargo bytes through signed feeds and original receipts", { skip: process.platform !== "linux" }, t => verifyExecution(t, repositoryShieldFixture, action, false));
  test("Windows guest-double " + action + " retains Cargo mismatch findings, replay refusal and cleanup", t => verifyExecution(t, windowsExecutionFixture, action, true));
}
