import test from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { npmArtifactSha512, scanShieldInputs, shieldCycloneDxComponent, validateShieldRequest } from "./shield-scanner-engine.mjs";
import { parseShieldScannerReport } from "./repository-shield.mjs";
import { npmArtifactFixture } from "./test-support/shield-scanner-fixture.mjs";
import { repositoryShieldFixture } from "./test-support/repository-shield-fixture.mjs";
import { windowsExecutionFixture } from "./test-support/windows-execution-fixture.mjs";
import { verifyNpmArtifactExecution } from "./test-support/assert-npm-artifact-execution.mjs";
const sha = b => createHash("sha256").update(b).digest("hex");
const context = f => ({ engine: "switchyard-baseline-scanner/1", request: validateShieldRequest(f.request), requestSha256: sha(JSON.stringify(validateShieldRequest(f.request))) });

test("artifact integrity accepts only canonical single SHA-512 declarations across all final-byte padding cases", () => {
  for (let i = 0; i < 256; i++) {
    const bytes = Buffer.alloc(64, i), encoded = bytes.toString("base64");
    assert.equal(npmArtifactSha512("sha512-" + encoded), bytes.toString("hex"));
    const alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
    const alias = encoded.slice(0, 85) + alphabet[alphabet.indexOf(encoded[85]) + 1] + "==";
    assert.deepEqual(Buffer.from(alias, "base64"), bytes); assert.equal(npmArtifactSha512("sha512-" + alias), null);
  }
  const good = "sha512-" + Buffer.alloc(64).toString("base64");
  for (const value of [null, {}, "", good + " ", " " + good, good + "\n", good.replace("sha512", "SHA512"), good.replace("sha512", "sha256"), good + " " + good, good + "?option", "sha512-" + "A".repeat(84) + "==", good.replace("==", "")]) assert.equal(npmArtifactSha512(value), null);
});
test("selected bytes match, mismatch or retain unsupported integrity without claiming publishers or archive contents", async () => {
  for (const artifactStatus of ["matched", "mismatched", "unsupported-integrity"]) {
    const f = npmArtifactFixture({ artifactStatus }), r = await f.scan(), a = r.sbom.components[0].artifact;
    assert.equal(a.status, artifactStatus); assert.equal(a.sha256, sha(f.content.get(a.path))); assert.equal(a.observedSha512, createHash("sha512").update(f.content.get(a.path)).digest("hex"));
    assert.equal(r.outcome, artifactStatus === "mismatched" ? "failed" : "incomplete"); assert.equal(r.findings.length, artifactStatus === "mismatched" ? 1 : 0);
    assert.equal(r.gaps.includes("package_artifact_not_verified"), artifactStatus !== "matched");
    for (const gap of ["repository_scope_unverified", "publisher_provenance_not_verified", "artifact_contents_not_inspected", "binary_or_non_utf8_input"]) assert.ok(r.gaps.includes(gap), gap);
    assert.equal(r.completeness, "incomplete"); assert.equal(r.cycloneDx.compositions[0].aggregate, "unknown"); assert.equal(r.cycloneDx.components[0].hashes, undefined);
    assert.deepEqual(parseShieldScannerReport(JSON.stringify(r), context(f), f.request.action), r);
  }
  const f = npmArtifactFixture(); delete f.request.packageArtifacts;
  const r = await f.scan(); assert.equal(r.sbom.components[0].artifact, undefined); assert.ok(r.gaps.includes("package_artifact_not_verified"));
});
test("artifact selection rejects unreviewed paths, aliases, duplicate locations, controls and non-supply-chain actions", () => {
  const f = npmArtifactFixture();
  for (const mutate of [
    r => { r.action = "shield_change_scan"; }, r => { r.packageArtifacts = []; }, r => { r.packageArtifacts = {}; }, r => { r.packageArtifacts = [null]; },
    r => { r.packageArtifacts.push(r.packageArtifacts[0]); }, r => { r.packageArtifacts = Array(129).fill(r.packageArtifacts[0]); },
    ...[{ path: "../private" }, { path: "/private" }, { path: "absent.tgz" }, { path: "rules.json" }, { path: "package-lock.json" }, { lockPath: "app.js" }, { lockPath: "absent/package-lock.json" }, { location: "packages/local" }, { location: ".git/node_modules/synthetic" }, { location: "node_modules/../synthetic" }, { raw: "NEVER_RETAIN" }].map(change => r => Object.assign(r.packageArtifacts[0], change)),
    r => { r.files.find(f => f.path === "reviewed-package.tgz").size = 0; }
  ]) { const request = structuredClone(f.request); mutate(request); assert.throws(() => validateShieldRequest(request)); }
  assert.deepEqual(validateShieldRequest(f.request).packageArtifacts, f.request.packageArtifacts);
});
test("an artifact cannot disappear behind an unsupported manifest, missing package or workspace link", async () => {
  for (const text of ["{", JSON.stringify({ lockfileVersion: 1, packages: {} }), JSON.stringify({ lockfileVersion: 3, packages: {} }), JSON.stringify({ lockfileVersion: 3, packages: { "packages/local": { name: "synthetic", version: "1.0.0", license: "MIT" }, "node_modules/synthetic": { link: true, resolved: "packages/local" } } })]) {
    const f = npmArtifactFixture(), bytes = Buffer.from(text); f.content.set("package-lock.json", bytes);
    Object.assign(f.request.files.find(row => row.path === "package-lock.json"), { size: bytes.length, sha256: sha(bytes) }); await assert.rejects(f.scan(), /artifact/i);
  }
});
test("artifact reads enforce original bytes before comparison and during the ordinary scan pass", async () => {
  for (const changedRead of [1, 2]) {
    const f = npmArtifactFixture(); let reads = 0;
    await assert.rejects(scanShieldInputs(f.request, { readInput: async (path, maximum) => {
      const b = await f.readInput(path, maximum); if (path !== "reviewed-package.tgz" || ++reads !== changedRead) return b;
      const changed = Buffer.from(b); changed[0] ^= 1; return changed;
    } }), /changed/); assert.equal(reads, changedRead);
  }
});
test("host admission binds artifact observations and failed mismatch findings to the exact reviewed request", async () => {
  const f = npmArtifactFixture({ artifactStatus: "mismatched" }), r = await f.scan();
  for (const mutate of [
    ...[{ path: "app.js" }, { path: "NEVER_RETAIN" }, { sha256: "a".repeat(64) }, { size: 1 }, { algorithm: "sha1" }, { observedSha512: "A".repeat(128) }, { expectedSha512: "b".repeat(128) }, { expectedSha512: "x" }, { status: "matched" }, { status: "verified-publisher" }, { raw: "NEVER_RETAIN" }].map(change => r => Object.assign(r.sbom.components[0].artifact, change)),
    r => { delete r.sbom.components[0].artifact; },
    r => { r.gaps = r.gaps.filter(g => g !== "artifact_contents_not_inspected"); },
    r => { r.gaps = r.gaps.filter(g => g !== "package_artifact_not_verified"); },
    r => { r.findings = []; r.outcome = "incomplete"; r.coverage.forEach(c => { c.findings = 0; }); }
  ]) {
    const altered = structuredClone(r); mutate(altered); altered.cycloneDx.components = altered.sbom.components.map(shieldCycloneDxComponent);
    assert.throws(() => parseShieldScannerReport(JSON.stringify(altered), context(f), f.request.action));
  }
  const request = structuredClone(f.request); delete request.packageArtifacts;
  const unreviewed = context({ request }), altered = { ...r, requestSha256: unreviewed.requestSha256 };
  assert.throws(() => parseShieldScannerReport(JSON.stringify(altered), unreviewed, request.action));
});
for (const action of ["shield_supply_chain", "release_shield"]) {
  test("actual Linux " + action + " compares artifact bytes with signed feeds, non-passing receipts and cleanup", { skip: process.platform !== "linux" }, t => verifyNpmArtifactExecution(t, repositoryShieldFixture, action, false));
  test("Windows guest-double " + action + " binds artifact bytes, integrity outcomes and original receipts", t => verifyNpmArtifactExecution(t, windowsExecutionFixture, action, true));
}
