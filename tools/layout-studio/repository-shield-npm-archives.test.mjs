import test from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { gzipSync, gunzipSync } from "node:zlib";
import { inspectNpmArchive, shieldCycloneDxComponent, validateShieldRequest } from "./shield-scanner-engine.mjs";
import { parseShieldScannerReport } from "./repository-shield.mjs";
import { npmArchiveFixture, ustarFixture, archiveHeaderChecksum, npmCliArchiveFixture } from "./test-support/npm-archive-fixture.mjs";
import { npmArtifactFixture } from "./test-support/shield-scanner-fixture.mjs";
import { repositoryShieldFixture } from "./test-support/repository-shield-fixture.mjs";
import { windowsExecutionFixture } from "./test-support/windows-execution-fixture.mjs";
import { verifyNpmArtifactExecution } from "./test-support/assert-npm-artifact-execution.mjs";
const sha = b => createHash("sha256").update(b).digest("hex");
const context = f => ({ engine: "switchyard-baseline-scanner/1", request: validateShieldRequest(f.request), requestSha256: sha(JSON.stringify(validateShieldRequest(f.request))) });

test("bounded archive metadata supports USTAR prefixes, directories, NUL regular files and exact package identity", () => {
  const manifest = JSON.stringify({ name: "@scope/package", version: "1.2.3-beta.1+build", scripts: { install: "NEVER_EXECUTE" }, nested: [{ text: "quote: \\\", brace } and array [" }] });
  const tar = ustarFixture([{ path: "package/", type: "5" }, { path: "package.json", prefix: "package", type: "\0", content: manifest },
    { path: "package/lib/", type: "5" }, { path: "package/lib/opaque.bin", content: Buffer.from([0xff, 0, 255]) }]);
  const result = inspectNpmArchive(gzipSync(tar));
  assert.deepEqual(result, { status: "inspected", name: "@scope/package", version: "1.2.3-beta.1+build", manifestSha256: sha(manifest), license: { status: "missing" }, entries: 4, expandedBytes: tar.length });
  // No executable/member bytes or private metadata enter the fixed observation.
  assert.ok(!JSON.stringify(result).includes("NEVER_EXECUTE"));
  assert.equal(inspectNpmArchive(npmArchiveFixture({ entries: [{ path: "package/README", content: "ordinary" }] })).status, "inspected");
});
test("archive identity never accepts a good prefix followed by corrupt headers, truncation, concatenated tar or excess output", () => {
  const good = npmArchiveFixture(), raw = gunzipSync(good);
  const cases = [Buffer.from("not gzip"), good.subarray(0, -1), Buffer.concat([good, Buffer.from("junk")]),
    gzipSync(raw.subarray(0, -512)), gzipSync(raw.subarray(0, raw.length - 1)), gzipSync(Buffer.concat([raw, raw])),
    gzipSync(Buffer.alloc(4 * 1024 * 1024 + 1)), Buffer.alloc(2 * 1024 * 1024 + 1),
    npmArchiveFixture({ entries: [{ path: "package/later", content: "x", changeHeader: h => h.write("gnuXX", 257) }] })];
  const crc = Buffer.from(good); crc[crc.length - 8] ^= 1; cases.push(crc);
  for (const offset of [0, 124, 148, 300, raw.length - 1]) { const bad = Buffer.from(raw); bad[offset] ^= 1; cases.push(gzipSync(bad)); }
  const padding = Buffer.from(raw); padding[1023] = 1; cases.push(gzipSync(padding));
  for (const bytes of cases) assert.equal(inspectNpmArchive(bytes).status, "unsupported");
  assert.equal(inspectNpmArchive(gzipSync(Buffer.alloc(4 * 1024 * 1024 + 1))).reason, "bounds");
  // Gzip member concatenation is legal; the complete joined tar is still parsed.
  assert.equal(inspectNpmArchive(Buffer.concat([gzipSync(raw.subarray(0, 512)), gzipSync(raw.subarray(512))])).status, "inspected");
});
test("archive paths, extension entries, duplicate members and file-parent collisions remain unsupported", () => {
  for (const path of ["../package/package.json", "/package/file", "package/../escape", "package/./file", "package//file", "package\\file", "package/C:drive", "other/file", "package/package.json", "package/PACKAGE.JSON"]) {
    assert.equal(inspectNpmArchive(npmArchiveFixture({ entries: [{ path, content: "x" }] })).status, "unsupported", path);
  }
  for (const type of ["1", "2", "3", "4", "6", "7", "x", "g", "L", "K", "S"]) {
    assert.equal(inspectNpmArchive(npmArchiveFixture({ entries: [{ path: "package/extension", type, content: "" }] })).status, "unsupported", type);
  }
  for (const entries of [
    [{ path: "package/file", content: "x" }, { path: "package/file/child", content: "x" }],
    [{ path: "package/file/child", content: "x" }, { path: "package/file", content: "x" }],
    [{ path: "package/data/", type: "5", content: "x" }],
    [{ path: "package/file", changeHeader: h => h.write("target", 157) }],
    [{ path: "package/file", changeHeader: h => { h[99] = 120; } }],
    [{ path: "package/file", changeHeader: h => { h[124] = 0x80; } }]
  ]) assert.equal(inspectNpmArchive(npmArchiveFixture({ entries })).status, "unsupported");
  const missing = ustarFixture([{ path: "package/other.json", content: "{}" }]);
  assert.equal(inspectNpmArchive(gzipSync(missing)).reason, "manifest");
  const duplicate = ustarFixture([{ path: "package/", type: "5" }, { path: "package", type: "5" }]);
  assert.equal(inspectNpmArchive(gzipSync(duplicate)).reason, "paths");
});
test("archive manifest refuses ambiguous identity, duplicate escaped keys, excessive nesting and invalid UTF-8", () => {
  for (const manifest of [
    "null", "[]", "{}", "{", '{"name":"synthetic","version":1}', '{"name":"synthetic","version":"1.0"}',
    '{"name":"wrong","name":"synthetic","version":"1.0.0"}',
    '{"name":"wrong","na\\u006de":"synthetic","version":"1.0.0"}',
    '{"name":"synthetic","version":"1.0.0","data":{"x":1,"x":2}}',
    '{"name":"synthetic","version":"1.0.0","data":' + "[".repeat(33) + "0" + "]".repeat(33) + "}",
    JSON.stringify({ name: "synthetic", version: "1.0.0", data: "x".repeat(65536) }),
    Buffer.concat([Buffer.from('{"name":"synthetic","version":"1.0.0","data":"'), Buffer.from([0xff]), Buffer.from('"}')]),
    "\ufeff" + JSON.stringify({ name: "synthetic", version: "1.0.0" })
  ]) assert.equal(inspectNpmArchive(npmArchiveFixture({ manifest })).reason, "manifest");
  const maximum = npmArchiveFixture({ entries: Array.from({ length: 1023 }, (_, i) => ({ path: "package/file-" + i })) });
  assert.equal(inspectNpmArchive(maximum).entries, 1024);
  assert.equal(inspectNpmArchive(npmArchiveFixture({ entries: Array.from({ length: 1024 }, (_, i) => ({ path: "package/file-" + i })) })).reason, "bounds");
});
test("archive checksum, octal numeric fields and complete terminators are required even when identity matches", () => {
  for (const offset of [100, 108, 116, 124, 136, 148]) for (const char of ["8", "-", "x"]) {
    const bytes = gunzipSync(npmArchiveFixture()); bytes[offset] = char.charCodeAt(0);
    if (offset !== 148) archiveHeaderChecksum(bytes.subarray(0, 512));
    assert.equal(inspectNpmArchive(gzipSync(bytes)).status, "unsupported");
  }
  for (const terminators of [0, 1]) assert.equal(inspectNpmArchive(gzipSync(ustarFixture([{ path: "package/package.json", content: '{"name":"synthetic","version":"1.0.0"}' }], { terminators }))).status, "unsupported");
});
test("actual offline npm pack bytes and aggregate decompression reservations keep their exact bounds", () => {
  const npm = inspectNpmArchive(npmCliArchiveFixture());
  assert.equal(npm.status, "inspected"); assert.equal(npm.name, "@switchyard-fixture/archive-identity"); assert.equal(npm.version, "1.2.3-beta.1+build");
  const budget = { remaining: 6144 }, bytes = npmArchiveFixture();
  for (let i = 0; i < 3; i++) assert.equal(inspectNpmArchive(bytes, budget).status, "inspected");
  assert.equal(budget.remaining, 0); assert.deepEqual(inspectNpmArchive(bytes, budget), { status: "unsupported", reason: "budget" });
  const limited = { remaining: 1024 }; assert.equal(inspectNpmArchive(bytes, limited).reason, "budget"); assert.equal(limited.remaining, 0);
  const failed = { remaining: 4 * 1024 * 1024 }; assert.equal(inspectNpmArchive(bytes.subarray(0, -1), failed).reason, "compression"); assert.equal(failed.remaining, 0);
});
test("archive observation binds exact manifest identity, findings, reviewed bytes and BOM while retaining unverified content", async () => {
  for (const archiveStatus of ["matched", "mismatched", "unsupported"]) {
    const f = npmArtifactFixture({ archiveStatus }), result = await f.scan();
    assert.equal(result.sbom.components[0].artifact.status, "matched");
    assert.equal(result.sbom.components[0].artifact.archive.status, archiveStatus);
    assert.equal(result.outcome, archiveStatus === "mismatched" ? "failed" : "incomplete");
    assert.deepEqual(parseShieldScannerReport(JSON.stringify(result), context(f), f.request.action), result);
  }
  const f = npmArtifactFixture({ archiveStatus: "mismatched" }), result = await f.scan();
  for (const mutate of [
    r => { delete r.sbom.components[0].artifact.archive; },
    ...[{ status: "matched" }, { status: "verified" }, { name: null }, { version: "wrong" }, { manifestSha256: "x" }, { entries: 0 }, { entries: 1024 }, { entries: 1025 }, { expandedBytes: 4 * 1024 * 1024 + 512 }, { expandedBytes: 1536 }, { expandedBytes: 1537 }, { raw: "NEVER_RETAIN" }].map(change => r => Object.assign(r.sbom.components[0].artifact.archive, change)),
    r => { r.gaps = r.gaps.filter(g => g !== "npm_archive_identity_not_verified"); },
    r => { r.gaps = r.gaps.filter(g => g !== "artifact_contents_not_inspected"); },
    r => { r.findings = []; r.outcome = "incomplete"; r.coverage.forEach(c => { c.findings = 0; }); }
  ]) {
    const altered = structuredClone(result); mutate(altered); altered.cycloneDx.components = altered.sbom.components.map(shieldCycloneDxComponent);
    assert.throws(() => parseShieldScannerReport(JSON.stringify(altered), context(f), f.request.action));
  }
  const bomChanged = structuredClone(result); bomChanged.cycloneDx.components[0].properties.find(p => p.name === "switchyard:archive-identity").value = "matched";
  assert.throws(() => parseShieldScannerReport(JSON.stringify(bomChanged), context(f), f.request.action));
  const unsupported = npmArtifactFixture({ archiveStatus: "unsupported" }), incomplete = await unsupported.scan();
  incomplete.sbom.components[0].artifact.archive.reason = "NEVER_RETAIN";
  incomplete.cycloneDx.components = incomplete.sbom.components.map(shieldCycloneDxComponent);
  assert.throws(() => parseShieldScannerReport(JSON.stringify(incomplete), context(unsupported), unsupported.request.action));
});
test("archive declarations compare alias targets and literal versions independently from byte integrity", async () => {
  for (const [name, version, declaredName, corruptIntegrity, expected] of [
    ["synthetic", "1.0.1", "synthetic", false, "mismatched"],
    ["synthetic", "1.0.0+build", "synthetic", false, "mismatched"],
    ["@scope/actual", "1.0.0", "@scope/actual", false, "matched"],
    ["synthetic", "1.0.0", "synthetic", true, "matched"]
  ]) {
    const f = npmArtifactFixture({ archiveStatus: "matched" }), bytes = npmArchiveFixture({ name, version });
    const lock = JSON.parse(f.content.get("package-lock.json"));
    lock.packages["node_modules/synthetic"].name = declaredName;
    lock.packages["node_modules/synthetic"].integrity = "sha512-" + createHash("sha512").update(corruptIntegrity ? Buffer.from("different") : bytes).digest("base64");
    f.content.set("reviewed-package.tgz", bytes); f.content.set("package-lock.json", Buffer.from(JSON.stringify(lock)));
    for (const file of f.request.files) { const b = f.content.get(file.path); file.size = b.length; file.sha256 = sha(b); }
    const r = await f.scan(), component = r.sbom.components[0];
    assert.equal(component.artifact.archive.status, expected);
    assert.equal(component.name, declaredName); assert.equal(component.installedAs, "synthetic");
    assert.equal(component.artifact.status, corruptIntegrity ? "mismatched" : "matched");
    assert.equal(r.findings.some(f => f.ruleId === "artifact.identity-mismatch"), expected === "mismatched");
    assert.equal(r.findings.some(f => f.ruleId === "artifact.integrity-mismatch"), corruptIntegrity);
    assert.deepEqual(parseShieldScannerReport(JSON.stringify(r), context(f), f.request.action), r);
  }
});

for (const action of ["shield_supply_chain", "release_shield"]) {
  test("actual Linux " + action + " compares archive identities through original signed receipts and cleanup", { skip: process.platform !== "linux" }, t => verifyNpmArtifactExecution(t, repositoryShieldFixture, action, false, { archives: true }));
  test("Windows guest-double " + action + " retains archive identity findings, replay refusal and cleanup", t => verifyNpmArtifactExecution(t, windowsExecutionFixture, action, true, { archives: true }));
}
