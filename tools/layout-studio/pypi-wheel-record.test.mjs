import test from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { inspectPypiWheel } from "./shield-scanner-engine.mjs";
import { parseShieldScannerReport } from "./repository-shield.mjs";
import { pypiWheelFixture, wheelRecordOracle } from "./test-support/pypi-wheel-fixture.mjs";
const sha = b => createHash("sha256").update(b).digest("hex");
const admit = (r, f) => parseShieldScannerReport(JSON.stringify(r), { engine: r.engine, requestSha256: r.requestSha256, request: f.request }, f.request.action);

test("a wheel with matching outer hash and identity cannot conceal changed RECORD members", async () => {
  const f = pypiWheelFixture({ archiveCase: "record-changed-content" }), r = await f.scan(), a = r.sbom.components[0].artifact;
  assert.equal(a.status, "matched"); assert.equal(a.archive.status, "matched");
  assert.equal(r.outcome, "failed"); assert.equal(a.archive.record.status, "mismatched");
  assert.equal(r.findings.filter(f => f.ruleId === "artifact.record-mismatch").length, 1);
  assert.ok(r.gaps.includes("python_wheel_record_not_verified")); assert.deepEqual(admit(r, f), r);
});

test("independent Python ZIP, CSV and hash facts bind supported RECORD declarations", () => {
  assert.equal(wheelRecordOracle.cases.length, 30);
  const good = new Set(["sha256", "sha384", "sha512", "quoted-crlf", "signatures"]);
  const mismatch = new Set(["changed-content", "wrong-size", "missing-member", "extra-member", "duplicate-member", "self-hash", "self-size", "missing-self", "listed-signature", "directory-row", "missing-hash"]);
  for (const row of wheelRecordOracle.cases) {
    const bytes = Buffer.from(row.bytesBase64, "base64"); assert.equal(sha(bytes), row.sha256);
    const observed = inspectPypiWheel(bytes), id = row.id.slice(7);
    if (id === "empty-record") { assert.equal(observed.status, "unsupported"); continue; }
    assert.equal(observed.status, "inspected", id); assert.equal(observed.record.sha256, row.recordSha256);
    assert.equal(observed.record.status, good.has(id) ? "verified" : mismatch.has(id) ? "mismatched" : "unsupported", id);
    if (good.has(id)) {
      assert.equal(observed.record.files, row.regularFiles - 1 - (id === "signatures" ? 2 : 0));
      assert.ok(row.csvFacts.filter(f => f.path !== "mixed_name-1.2.0.dist-info/RECORD").every(f => f.present && f.digestMatches));
    }
  }
});

test("RECORD verification keeps original integrity, environment and publisher limits for both actions", async () => {
  for (const action of ["shield_supply_chain", "release_shield"]) for (const artifactStatus of ["matched", "mismatched", "unsupported-integrity"]) {
    const f = pypiWheelFixture({ action, artifactStatus, archiveCase: "record-signatures", marker: 'python_version < "0"' }), r = await f.scan(), a = r.sbom.components[0].artifact;
    assert.equal(a.status, artifactStatus); assert.equal(a.archive.record.status, "verified"); assert.equal(a.archive.record.files, 4);
    assert.equal(r.outcome, artifactStatus === "mismatched" ? "failed" : "incomplete"); assert.equal(r.completeness, "incomplete");
    for (const gap of ["python_markers_not_evaluated", "python_environment_not_resolved", "publisher_provenance_not_verified", "artifact_contents_not_inspected"]) assert.ok(r.gaps.includes(gap));
    assert.equal(JSON.stringify(r).includes("NEVER_"), false); assert.deepEqual(admit(r, f), r);
  }
});

test("unsupported RECORD declarations preserve identity and an explicit unverified gap", async () => {
  for (const archiveCase of ["record-weak-hash", "record-missing-size", "record-bad-quotes", "record-byte-bound"]) {
    const f = pypiWheelFixture({ archiveCase }), r = await f.scan();
    assert.equal(r.sbom.components[0].artifact.archive.status, "matched"); assert.equal(r.sbom.components[0].artifact.archive.record.status, "unsupported");
    assert.equal(r.outcome, "incomplete"); assert.ok(r.gaps.includes("python_wheel_record_not_verified")); assert.deepEqual(admit(r, f), r);
    for (const mutate of [x => { x.gaps = x.gaps.filter(g => g !== "python_wheel_record_not_verified"); }, x => { x.sbom.components[0].artifact.archive.record.reason = "NEVER_EXPORT"; }, x => { x.sbom.components[0].artifact.archive.record.files = 4; }]) {
      const changed = structuredClone(r); mutate(changed); assert.throws(() => admit(changed, f));
    }
  }
});

test("host admission refuses deleted RECORD failures, open observations and substituted BOM facts", async () => {
  const f = pypiWheelFixture({ archiveCase: "record-changed-content" }), r = await f.scan();
  for (const mutate of [
    x => { delete x.sbom.components[0].artifact.archive.record; }, x => { x.sbom.components[0].artifact.archive.record.status = "verified"; },
    x => { x.sbom.components[0].artifact.archive.record.sha256 = "bad"; }, x => { x.sbom.components[0].artifact.archive.record.files = 0; },
    x => { x.sbom.components[0].artifact.archive.record.files = x.sbom.components[0].artifact.archive.entries; }, x => { x.sbom.components[0].artifact.archive.record.raw = "NEVER_EXPORT"; },
    x => { x.gaps = x.gaps.filter(g => g !== "python_wheel_record_not_verified"); },
    x => { x.findings = []; x.outcome = "incomplete"; x.coverage.forEach(c => c.findings = 0); },
    x => { x.findings[0].fingerprint = "a".repeat(64); },
    ...["switchyard:wheel-record-sha256", "switchyard:wheel-record-verification", "switchyard:wheel-record-files"].map(name => x => { x.cycloneDx.components[0].properties.find(p => p.name === name).value = "forged"; }),
  ]) { const changed = structuredClone(r); mutate(changed); assert.throws(() => admit(changed, f)); }
});

test("RECORD mismatch fingerprints distinguish reviewed manifests and retain the original finding ceiling", async () => {
  const f = pypiWheelFixture({ action: "release_shield", archiveCase: "record-changed-content" }), path = "requirements-dev.txt", bytes = f.content.get("requirements.txt");
  f.content.set(path, bytes); f.request.files.push({ path, size: bytes.length, sha256: sha(bytes) }); f.request.packageArtifacts.push({ ...f.request.packageArtifacts[0], requirementsPath: path });
  const r = await f.scan(); assert.equal(r.findings.length, 2); assert.equal(new Set(r.findings.map(f => f.fingerprint)).size, 2); assert.deepEqual(admit(r, f), r);
  const crowded = pypiWheelFixture({ action: "release_shield", archiveCase: "record-changed-content" }), content = Buffer.from("eval(untrusted);\n".repeat(512));
  crowded.content.set("app.js", content); Object.assign(crowded.request.files.find(f => f.path === "app.js"), { size: content.length, sha256: sha(content) });
  const result = await crowded.scan(); assert.equal(result.findings.length, 512); assert.ok(result.gaps.includes("finding_limit"));
  assert.equal(result.sbom.components[0].artifact.archive.record.status, "mismatched"); assert.equal(result.outcome, "failed"); assert.deepEqual(admit(result, crowded), result);
});
