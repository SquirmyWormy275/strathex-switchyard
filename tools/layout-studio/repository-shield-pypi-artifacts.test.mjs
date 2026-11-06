import test from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFile, access } from "node:fs/promises";
import { join } from "node:path";
import { scanShieldInputs, shieldCycloneDxComponent, validateShieldRequest } from "./shield-scanner-engine.mjs";
import { parseShieldScannerReport } from "./repository-shield.mjs";
import { pypiArtifactFixture, cargoArtifactFixture, npmArtifactFixture, scannerFixture } from "./test-support/shield-scanner-fixture.mjs";
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

test("Python accepts either declared artifact hash while mismatch and absent hashes retain incomplete scope", async () => {
  for (const [artifactStatus, alternative] of [["matched", 0], ["matched", 1], ["mismatched", 0], ["unsupported-integrity", 0]]) {
    const f = pypiArtifactFixture({ artifactStatus, alternative }), r = await f.scan(), c = r.sbom.components[0], a = c.artifact;
    assert.equal(a.status, artifactStatus); assert.equal(a.sha256, sha(f.content.get(a.path))); assert.equal(a.algorithm, "sha256"); assert.deepEqual(a.acceptedSha256, c.declaredSha256);
    assert.equal(a.acceptedSha256.length, artifactStatus === "unsupported-integrity" ? 0 : 2);
    assert.equal(a.acceptedSha256.includes(a.sha256), artifactStatus === "matched");
    assert.equal(r.outcome, artifactStatus === "mismatched" ? "failed" : "incomplete"); assert.equal(r.findings.length, artifactStatus === "mismatched" ? 1 : 0);
    assert.equal(r.gaps.includes("package_artifact_not_verified"), artifactStatus !== "matched");
    for (const gap of ["repository_scope_unverified", "publisher_provenance_not_verified", "artifact_contents_not_inspected", "python_environment_not_resolved", "license_metadata", "binary_or_non_utf8_input"]) assert.ok(r.gaps.includes(gap), gap);
    assert.equal(r.completeness, "incomplete"); assert.equal(r.cycloneDx.compositions[0].aggregate, "unknown"); assert.equal(r.cycloneDx.components[0].hashes, undefined);
    assert.ok(r.cycloneDx.components[0].properties.every(p => typeof p.value === "string")); assert.equal(r.cycloneDx.components[0].properties.some(p => p.name === "switchyard:artifact-observed-sha512"), false);
    assert.deepEqual(admit(r, f), r);
    if (artifactStatus === "mismatched") assert.equal(r.findings[0].fingerprint, sha(["artifact.integrity-mismatch", "PyPI", "requirements.txt", sha(f.content.get("requirements.txt")), c.name, c.version, a.path, a.sha256].join("\0")));
  }
  const f = pypiArtifactFixture(); delete f.request.packageArtifacts;
  const r = await f.scan(); assert.equal(r.sbom.components[0].artifact, undefined); assert.ok(r.gaps.includes("package_artifact_not_verified")); assert.deepEqual(admit(r, f), r);
});
test("Python selection rejects unreviewed paths, noncanonical names, duplicate pins and manifest aliases", () => {
  const f = pypiArtifactFixture();
  for (const mutate of [
    r => { r.action = "shield_change_scan"; }, r => { r.packageArtifacts.push(r.packageArtifacts[0]); }, r => { r.packageArtifacts = Array(129).fill(r.packageArtifacts[0]); },
    ...[{ ecosystem: "pypi" }, { ecosystem: "npm" }, { name: "Mixed_Name" }, { name: "../mixed-name" }, { version: "1.2.*" }, { path: "../private" }, { path: "absent.whl" }, { path: "rules.json" }, { path: "requirements.txt" }, { requirementsPath: "app.js" }, { requirementsPath: "absent/requirements.txt" }, { raw: "NEVER_RETAIN" }].map(change => r => Object.assign(r.packageArtifacts[0], change)),
    r => { r.files.find(f => f.path === "reviewed-package.whl").size = 0; }
  ]) { const request = structuredClone(f.request); mutate(request); assert.throws(() => validateShieldRequest(request)); }
  for (const path of ["Cargo.lock", "package-lock.json", "requirements-dev.txt"]) {
    const request = structuredClone(f.request); request.files.push({ path, size: 1, sha256: "a".repeat(64) }); request.packageArtifacts[0].path = path;
    assert.throws(() => validateShieldRequest(request), /manifest/);
  }
  assert.deepEqual(validateShieldRequest(f.request).packageArtifacts, f.request.packageArtifacts);
});
test("Python artifact identity requires the literal pin even where advisory version equivalence is supported", async () => {
  const f = pypiArtifactFixture();
  for (const change of [{ version: "1!2.0rc1.post2.dev3+local.4" }, { name: "another" }]) {
    const request = structuredClone(f.request); Object.assign(request.packageArtifacts[0], change);
    await assert.rejects(scanShieldInputs(request, { readInput: f.readInput }), /artifact/i);
  }
  for (const text of ["-r NEVER_READ.txt\n", "Mixed_Name>=1.2\n", "Mixed_Name @ https://NEVER_CONTACT.invalid/archive.whl\n", "mixed-name==1.0 --hash=sha512:" + "a".repeat(128), "Mixed_Name==1.0\nmixed-name==2.0\n", "\0binary", "# empty\n"]) {
    const sample = pypiArtifactFixture(); replaceFile(sample, "requirements.txt", text); await assert.rejects(sample.scan(), /artifact/i);
  }
});
test("Python requirements paths separate equal package pins and cannot borrow another file's allowed hashes", async () => {
  const f = pypiArtifactFixture({ artifactStatus: "mismatched" }), first = f.request.packageArtifacts[0], path = "requirements-dev.txt";
  const bytes = f.content.get("requirements.txt"); f.content.set(path, bytes); f.request.files.push({ path, sha256: sha(bytes), size: bytes.length }); f.request.packageArtifacts.push({ ...first, requirementsPath: path });
  const r = await f.scan(); assert.equal(r.sbom.components.length, 2); assert.equal(r.findings.length, 2); assert.equal(new Set(r.findings.map(f => f.fingerprint)).size, 2); assert.deepEqual(admit(r, f), r);
  const changed = structuredClone(r); changed.sbom.components[1].requirementsPath = "requirements.txt"; assert.throws(() => admit(changed, f));
});
test("npm, Cargo and Python share reviewed artifact bounds while keeping ecosystem identities separate", async () => {
  const sources = [npmArtifactFixture(), cargoArtifactFixture({ artifactStatus: "mismatched" }), pypiArtifactFixture({ artifactStatus: "unsupported-integrity" })];
  const f = scannerFixture({ action: "release_shield", files: Object.fromEntries(sources.flatMap(f => f.request.files.map(row => [row.path, f.content.get(row.path)]))) });
  f.request.packageArtifacts = sources.flatMap(f => f.request.packageArtifacts);
  const r = await f.scan(); assert.deepEqual(r.sbom.components.map(c => [c.ecosystem, c.artifact.status]), [["npm", "matched"], ["Cargo", "mismatched"], ["PyPI", "unsupported-integrity"]]); assert.deepEqual(admit(r, f), r);
  const changed = structuredClone(r); changed.sbom.components[2].artifact = changed.sbom.components[1].artifact; assert.throws(() => admit(changed, f));
});
test("Python rechecks both byte witnesses and preserves a failed artifact at the original finding ceiling", async () => {
  for (const changedRead of [1, 2]) {
    const f = pypiArtifactFixture(); let reads = 0;
    await assert.rejects(scanShieldInputs(f.request, { readInput: async (path, maximum) => {
      const b = await f.readInput(path, maximum); if (path !== "reviewed-package.whl" || ++reads !== changedRead) return b;
      const changed = Buffer.from(b); changed[0] ^= 1; return changed;
    } }), /changed/); assert.equal(reads, changedRead);
  }
  const f = pypiArtifactFixture({ action: "release_shield", artifactStatus: "mismatched" }); replaceFile(f, "app.js", "eval(untrusted);\n".repeat(512));
  const r = await f.scan(); assert.equal(r.findings.length, 512); assert.ok(r.gaps.includes("finding_limit")); assert.equal(r.sbom.components[0].artifact.status, "mismatched"); assert.equal(r.outcome, "failed"); assert.deepEqual(admit(r, f), r);
});
test("host admission refuses changed Python artifact bytes, allowed hash alternatives, findings or scope", async () => {
  const f = pypiArtifactFixture({ artifactStatus: "mismatched" }), r = await f.scan();
  for (const mutate of [
    ...[{ path: "app.js" }, { sha256: "a".repeat(64) }, { size: 1 }, { algorithm: "sha512" }, { acceptedSha256: [] }, { acceptedSha256: ["a".repeat(64)] }, { status: "matched" }, { status: "unsupported-integrity" }, { raw: "NEVER_RETAIN" }].map(change => r => Object.assign(r.sbom.components[0].artifact, change)),
    r => { r.sbom.components[0].artifact.acceptedSha256.reverse(); }, r => { delete r.sbom.components[0].artifact; },
    r => { r.gaps = r.gaps.filter(g => g !== "artifact_contents_not_inspected"); }, r => { r.gaps = r.gaps.filter(g => g !== "package_artifact_not_verified"); },
    r => { r.findings = []; r.outcome = "incomplete"; r.coverage.forEach(c => { c.findings = 0; }); }, r => { r.findings[0].fingerprint = "b".repeat(64); }
  ]) {
    const changed = structuredClone(r); mutate(changed); changed.cycloneDx.components = changed.sbom.components.map(shieldCycloneDxComponent); assert.throws(() => admit(changed, f));
  }
  const request = structuredClone(f.request); delete request.packageArtifacts;
  assert.throws(() => admit({ ...r, requestSha256: context({ request }).requestSha256 }, { request }));
});
async function verifyExecution(t, factory, action, windows) {
  for (const artifactStatus of ["matched", "mismatched", "unsupported-integrity"]) {
    const f = await factory(t, { action, shield: true, clean: true, pypiArtifact: artifactStatus });
    const original = () => Promise.all([readFile(join(f.root, "requirements.txt")), readFile(join(f.root, "reviewed-package.whl")), readFile(join(f.root, ".git/index")), f.run("rev-parse", "HEAD")]), before = await original();
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
  test("actual Linux " + action + " compares Python artifact alternatives with protected original receipts", { skip: process.platform !== "linux" }, t => verifyExecution(t, repositoryShieldFixture, action, false));
  test("Windows guest-double " + action + " binds Python artifact observations and exact cleanup", t => verifyExecution(t, windowsExecutionFixture, action, true));
}
