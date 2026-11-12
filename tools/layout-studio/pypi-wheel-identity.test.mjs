import test from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import * as engine from "./shield-scanner-engine.mjs";
import { parseShieldScannerReport } from "./repository-shield.mjs";
import { pypiWheelFixture, wheelOracle } from "./test-support/pypi-wheel-fixture.mjs";
const sha = value => createHash("sha256").update(value).digest("hex");
const admit = (report, fixture) => parseShieldScannerReport(JSON.stringify(report), { engine: report.engine, requestSha256: report.requestSha256, request: fixture.request }, fixture.request.action);

for (const archiveCase of ["wrong-name", "wrong-version"]) test(`a hash-matched Python wheel with ${archiveCase} cannot conceal its declared identity`, async () => {
  const f = pypiWheelFixture({ archiveCase }), report = await f.scan(), artifact = report.sbom.components[0].artifact;
  assert.equal(artifact.status, "matched"); assert.equal(report.outcome, "failed");
  assert.equal(artifact.archive.status, "mismatched");
  assert.equal(report.findings.filter(f => f.ruleId === "artifact.identity-mismatch").length, 1);
  assert.ok(report.gaps.includes("python_wheel_identity_not_verified")); assert.equal(report.completeness, "incomplete");
  assert.equal(JSON.stringify(report).includes("NEVER_COPY_PRIVATE_WHEEL"), false);
  assert.deepEqual(admit(report, f), report);
});

test("bounded wheel ZIP identities match independent Python zipfile and email parsing facts", () => {
  assert.equal(wheelOracle.schema, "switchyard-pypi-wheel-oracle/v1"); assert.equal(wheelOracle.cases.length, 15);
  for (const row of wheelOracle.cases.slice(0, 7)) {
    const bytes = Buffer.from(row.bytesBase64, "base64"), budget = { remaining: 4 * 1024 * 1024 };
    assert.equal(sha(bytes), row.sha256);
    const { record, license, ...identity } = engine.inspectPypiWheel(bytes, budget);
    assert.deepEqual(license, { status: "missing" });
    assert.deepEqual(identity, { status: "inspected", ...row.identity }); assert.equal(record.status, "verified");
    assert.equal(budget.remaining, 4 * 1024 * 1024 - row.identity.expandedBytes);
  }
  for (const row of wheelOracle.cases.slice(7)) assert.equal(engine.inspectPypiWheel(Buffer.from(row.bytesBase64, "base64")).status, "unsupported", row.id);
});

test("ZIP structure, unsafe paths, compression and metadata corruption cannot acquire wheel identity", () => {
  const row = wheelOracle.cases.find(r => r.id === "stored"), raw = Buffer.from(row.bytesBase64, "base64"), central = row.centralOffset, end = raw.length - 22;
  const mutations = [
    b => b.subarray(0, 21), b => b.subarray(0, b.length - 1), b => Buffer.concat([b, Buffer.from([0])]),
    b => { b.writeUInt16LE(1, end + 4); }, b => { b.writeUInt16LE(1, end + 6); }, b => { b.writeUInt16LE(1, end + 20); },
    b => { b.writeUInt16LE(65535, end + 10); }, b => { b.writeUInt32LE(1, end + 16); }, b => { b.writeUInt32LE(1, end + 12); },
    ...[1, 8, 0x40, 0x1000].map(flags => b => { b.writeUInt16LE(flags, central + 8); }),
    b => { b.writeUInt16LE(99, central + 10); }, b => { b.writeUInt16LE(45, central + 6); },
    b => { b.writeUInt16LE(1, central + 30); }, b => { b.writeUInt16LE(1, central + 32); }, b => { b.writeUInt16LE(1, central + 34); },
    b => { b.writeUInt32LE(4 * 1024 * 1024 + 1, central + 24); }, b => { b.writeUInt32LE(raw.length + 1, central + 20); },
    b => { b.writeUInt32LE(row.entries[1].headerOffset, central + 42); },
    b => { b[30] ^= 1; }, b => { b[14] ^= 1; b[central + 16] ^= 1; }, b => { b[6] ^= 1; },
    b => { const path = "../" + "x".repeat(row.entries[0].path.length - 3); b.write(path, 30, "ascii"); b.write(path, central + 46, "ascii"); },
    b => { const path = "C:" + "x".repeat(row.entries[0].path.length - 2); b.write(path, 30, "ascii"); b.write(path, central + 46, "ascii"); },
    b => { b.writeUInt32LE((0o120777 << 16) >>> 0, central + 38); },
  ];
  for (const [i, mutate] of mutations.entries()) { const bytes = Buffer.from(raw), changed = mutate(bytes) ?? bytes; assert.equal(engine.inspectPypiWheel(changed).status, "unsupported", String(i)); }
  const compressed = wheelOracle.cases.find(r => r.id === "deflated"), bytes = Buffer.from(compressed.bytesBase64, "base64"); bytes[30 + compressed.entries[0].path.length] = 0xff;
  assert.equal(engine.inspectPypiWheel(bytes).status, "unsupported");
  for (const remaining of [0, 1, row.identity.expandedBytes - 1]) assert.deepEqual(engine.inspectPypiWheel(raw, { remaining }), { status: "unsupported", reason: "budget" });
  assert.equal(engine.inspectPypiWheel(raw, { remaining: row.identity.expandedBytes }).status, "inspected");
  for (const remaining of [-1, Infinity, 32 * 1024 * 1024 + 1]) assert.deepEqual(engine.inspectPypiWheel(raw, { remaining }), { status: "unsupported", reason: "bounds" });
  assert.deepEqual(engine.inspectPypiWheel(Buffer.alloc(2 * 1024 * 1024 + 1)), { status: "unsupported", reason: "bounds" });
});

test("ZIP truncations and falsified expansion sizes stay inside the original decompression budget", () => {
  const row = wheelOracle.cases.find(r => r.id === "stored"), bytes = Buffer.from(row.bytesBase64, "base64");
  for (let size = 0; size < bytes.length; size++) assert.equal(engine.inspectPypiWheel(bytes.subarray(0, size)).status, "unsupported", String(size));
  const oversized = wheelOracle.cases.find(r => r.id === "expansion-over-bound"), bomb = Buffer.from(oversized.bytesBase64, "base64");
  assert.deepEqual(engine.inspectPypiWheel(bomb), { status: "unsupported", reason: "bounds" });
  let central = oversized.centralOffset;
  for (const entry of oversized.entries) {
    if (entry.path === "synthetic/data.bin") { bomb.writeUInt32LE(1, entry.headerOffset + 22); bomb.writeUInt32LE(1, central + 24); break; }
    central += 46 + Buffer.byteLength(entry.path);
  }
  const budget = { remaining: 4 * 1024 * 1024 };
  assert.deepEqual(engine.inspectPypiWheel(bomb, budget), { status: "unsupported", reason: "bounds" });
  assert.equal(budget.remaining, 0);
  assert.deepEqual(engine.inspectPypiWheel(bytes, budget), { status: "unsupported", reason: "budget" });
});

test("wheel identity, byte integrity and internal hashes remain separate from conditional applicability", async () => {
  for (const action of ["shield_supply_chain", "release_shield"]) for (const artifactStatus of ["matched", "mismatched", "unsupported-integrity"]) {
    const f = pypiWheelFixture({ action, artifactStatus, archiveCase: "equivalent", pinVersion: "1!2.0rc1.post2.dev3+local.1", marker: 'python_version < "0"' }), report = await f.scan(), artifact = report.sbom.components[0].artifact;
    assert.equal(artifact.status, artifactStatus); assert.equal(artifact.archive.status, "matched");
    assert.equal(report.outcome, artifactStatus === "mismatched" ? "failed" : "incomplete");
    for (const gap of ["python_markers_not_evaluated", "python_environment_not_resolved", "artifact_contents_not_inspected", "publisher_provenance_not_verified"]) assert.ok(report.gaps.includes(gap));
    assert.equal(report.cycloneDx.components[0].properties.find(p => p.name === "switchyard:wheel-record-verification").value, "verified");
    assert.equal(report.cycloneDx.components[0].properties.find(p => p.name === "switchyard:archive-manifest-sha256").value, artifact.archive.manifestSha256);
    assert.deepEqual(admit(report, f), report);
  }
});

test("host admission binds wheel identities, failed findings, coverage gaps and exact CycloneDX properties", async () => {
  const f = pypiWheelFixture({ archiveCase: "wrong-name" }), report = await f.scan();
  for (const mutate of [
    r => { delete r.sbom.components[0].artifact.archive; }, r => { r.sbom.components[0].artifact.archive.status = "matched"; },
    r => { r.sbom.components[0].artifact.archive.name = "mixed-name"; }, r => { r.sbom.components[0].artifact.archive.manifestSha256 = "x"; },
    r => { r.sbom.components[0].artifact.archive.metadataVersion = "9.0"; }, r => { r.sbom.components[0].artifact.archive.wheelVersion = "2.0"; },
    r => { r.sbom.components[0].artifact.archive.entries = 1025; }, r => { r.sbom.components[0].artifact.archive.expandedBytes = 4 * 1024 * 1024 + 1; },
    r => { r.sbom.components[0].artifact.archive.raw = "NEVER_EXPORT"; }, r => { r.gaps = r.gaps.filter(g => g !== "python_wheel_identity_not_verified"); },
    r => { r.findings = []; r.outcome = "incomplete"; r.coverage.forEach(c => c.findings = 0); },
    ...["switchyard:archive-manifest-sha256", "switchyard:wheel-format-version", "switchyard:wheel-metadata-version", "switchyard:wheel-record-verification"].map(name => r => { r.cycloneDx.components[0].properties.find(p => p.name === name).value = "forged"; }),
  ]) { const changed = structuredClone(report); mutate(changed); assert.throws(() => admit(changed, f)); }
  const malformed = pypiWheelFixture({ archiveCase: "future-wheel" }), r = await malformed.scan(); assert.deepEqual(admit(r, malformed), r);
  r.sbom.components[0].artifact.archive.reason = "NEVER_EXPORT"; assert.throws(() => admit(r, malformed));
});

test("wheel identity findings remain manifest-specific and visible as mismatches at the original finding ceiling", async () => {
  const f = pypiWheelFixture({ action: "release_shield", archiveCase: "wrong-version" }), bytes = f.content.get("requirements.txt"), path = "requirements-dev.txt";
  f.content.set(path, bytes); f.request.files.push({ path, size: bytes.length, sha256: sha(bytes) });
  f.request.packageArtifacts.push({ ...f.request.packageArtifacts[0], requirementsPath: path });
  const report = await f.scan(); assert.equal(report.findings.length, 2); assert.equal(new Set(report.findings.map(f => f.fingerprint)).size, 2);
  assert.deepEqual(admit(report, f), report);
  const crowded = pypiWheelFixture({ action: "release_shield", archiveCase: "wrong-name" }), content = Buffer.from("eval(untrusted);\n".repeat(512));
  crowded.content.set("app.js", content); Object.assign(crowded.request.files.find(f => f.path === "app.js"), { size: content.length, sha256: sha(content) });
  const result = await crowded.scan(); assert.equal(result.findings.length, 512); assert.ok(result.gaps.includes("finding_limit"));
  assert.equal(result.sbom.components[0].artifact.archive.status, "mismatched"); assert.equal(result.outcome, "failed");
  assert.deepEqual(admit(result, crowded), result);
});
