import test from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import * as engine from "./shield-scanner-engine.mjs";
import { parseShieldScannerReport } from "./repository-shield.mjs";
import oracle from "../../scripts/fixtures/cargo-archive-oracle.json" with { type: "json" };
const sha = b => createHash("sha256").update(b).digest("hex");
import { cargoArchiveFixture, crate, cargoManifest as manifest, cargoRoot as root } from "./test-support/cargo-archive-fixture.mjs";
const admit = (r, f) => parseShieldScannerReport(JSON.stringify(r), { engine: r.engine, requestSha256: r.requestSha256, request: f.request }, f.request.action);
test("independent Python TOML, USTAR and gzip facts bind the closed manifest subset", () => {
  assert.equal(oracle.cases.length, 84);
  for (const row of oracle.cases) {
    const bytes = Buffer.from(row.bytesBase64, "base64"); assert.equal(sha(bytes), row.sha256);
    const observed = engine.inspectCargoArchive(bytes); assert.equal(observed.status, row.supported ? "inspected" : "unsupported", row.id);
    if (row.supported) { assert.equal(row.toml.parsed, true); assert.equal(observed.name, row.toml.name); assert.equal(observed.version, row.toml.version); assert.equal(observed.manifestSha256, row.manifestSha256); assert.equal(observed.expandedBytes, row.expandedBytes); assert.equal(observed.entries, 2); }
  }
});
test("a matching Cargo byte hash cannot hide a different manifest identity", async () => {
  const f = cargoArchiveFixture({ text: manifest.replace('"example"', '"another"'), directory: "another-1.2.3-rc.1+build.7" }), r = await f.scan();
  assert.equal(r.sbom.components[0].artifact.status, "matched");
  assert.equal(r.sbom.components[0].artifact.archive.status, "mismatched");
  assert.equal(r.outcome, "failed"); assert.equal(r.findings[0].ruleId, "artifact.identity-mismatch"); assert.deepEqual(admit(r, f), r);
});
test("Cargo archive identity retains literal builds, bounded metadata and no execution", async () => {
  for (const action of ["shield_supply_chain", "release_shield"]) for (const artifactStatus of ["matched", "mismatched"]) {
    const f = cargoArchiveFixture({ action, artifactStatus, entries: [{ path: root + "/build.rs", content: "NEVER_EXECUTE_THIS_BUILD_SCRIPT" }] }), r = await f.scan(), a = r.sbom.components[0].artifact.archive;
    assert.equal(a.status, "matched"); assert.equal(a.name, "example"); assert.equal(a.version, "1.2.3-rc.1+build.7"); assert.equal(a.manifestSha256, sha(manifest));
    assert.equal(r.outcome, artifactStatus === "matched" ? "incomplete" : "failed"); assert.equal(JSON.stringify(r).includes("NEVER_EXECUTE"), false);
    for (const gap of ["cargo_resolution_not_performed", "license_metadata", "artifact_contents_not_inspected", "publisher_provenance_not_verified"]) assert.ok(r.gaps.includes(gap));
    assert.deepEqual(admit(r, f), r);
  }
});
test("ambiguous Cargo manifests and unsafe tar members remain explicitly unsupported", () => {
  for (const text of [manifest + 'name = "shadow"\n', manifest + '[package]\n', manifest + 'version.workspace = true\n', manifest + '[package.version]\nx = "bad"\n', manifest + '[dependencies]\na = { version = "1" }\n', manifest + 'description = """multiline"""\n', manifest + '[lib]\npath = "unterminated\n', manifest + '[lib]\nflag = maybe\n']) assert.equal(engine.inspectCargoArchive(crate(text)).status, "unsupported", text);
  for (const entry of [{ path: "../Cargo.toml" }, { path: root + "/cargo.toml" }, { path: root + "/src", type: "2" }, { path: root + "/src", content: "parent" }, { path: "another-1.0.0/extra" }]) {
    const entries = [entry, ...(entry.content ? [{ path: root + "/src/lib.rs", content: "child" }] : [])];
    assert.equal(engine.inspectCargoArchive(crate(manifest, entries)).status, "unsupported");
  }
  assert.equal(engine.inspectCargoArchive(crate(manifest, [], "wrong-root")).status, "unsupported");
});
test("Cargo archive checks retain original expansion, entry and shared budget limits", () => {
  const budget = { remaining: 2048 }; assert.equal(engine.inspectCargoArchive(crate(), budget).status, "inspected"); assert.equal(budget.remaining, 0);
  assert.deepEqual(engine.inspectCargoArchive(crate(), budget), { status: "unsupported", reason: "budget" });
  const oversized = crate(manifest, [{ path: root + "/huge", content: Buffer.alloc(4 * 1024 * 1024) }]);
  assert.equal(engine.inspectCargoArchive(oversized).reason, "bounds");
  assert.equal(engine.inspectCargoArchive(crate(manifest, Array.from({ length: 1024 }, (_, i) => ({ path: root + "/f" + i })))).reason, "bounds");
  for (const text of [manifest + "description = '" + "x".repeat(2049) + "'\n", manifest + "[" + Array(17).fill("'part'").join(".") + "]\n", manifest + "'" + "x".repeat(2049) + "' = 'value'\n"]) assert.equal(engine.inspectCargoArchive(crate(text)).status, "unsupported");
  assert.equal(engine.inspectCargoArchive(crate(manifest + "[[" + Array(17).fill("part").join(".") + "]]\n")).status, "unsupported");
});
test("Cargo host admission rejects forged archive identity, coverage and BOM claims", async () => {
  const f = cargoArchiveFixture({ text: manifest.replace("build.7", "build.8"), directory: root.replace("build.7", "build.8") }), r = await f.scan();
  for (const mutate of [x => { delete x.sbom.components[0].artifact.archive; }, x => { x.sbom.components[0].artifact.archive.status = "matched"; }, x => { x.sbom.components[0].artifact.archive.raw = "private"; }, x => { x.gaps = x.gaps.filter(g => g !== "cargo_archive_identity_not_verified"); }, x => { x.findings = []; x.outcome = "incomplete"; x.coverage.forEach(c => c.findings = 0); }, x => { x.cycloneDx.components[0].properties.find(p => p.name === "switchyard:archive-manifest-sha256").value = "a".repeat(64); }]) { const changed = structuredClone(r); mutate(changed); assert.throws(() => admit(changed, f)); }
});
test("Cargo identity failures remain source-separated and respect the original finding ceiling", async () => {
  const f = cargoArchiveFixture({ archiveStatus: "mismatched" }), source = "registry+https://NEVER_COPY_PRIVATE_REGISTRY/index";
  const original = f.content.get("Cargo.lock").toString(), lock = Buffer.from(original + original.slice(original.indexOf("[[package]]")).replace(engine.cargoPublicSource, source));
  f.content.set("Cargo.lock", lock); Object.assign(f.request.files.find(r => r.path === "Cargo.lock"), { size: lock.length, sha256: sha(lock) });
  f.request.packageArtifacts.push({ ...f.request.packageArtifacts[0], sourceSha256: sha(source) });
  const r = await f.scan(); assert.equal(r.findings.length, 2); assert.equal(new Set(r.findings.map(f => f.fingerprint)).size, 2); assert.equal(JSON.stringify(r).includes("NEVER_COPY"), false); assert.deepEqual(admit(r, f), r);
  const full = cargoArchiveFixture({ action: "release_shield", archiveStatus: "mismatched" }), content = Buffer.from("eval(untrusted);\n".repeat(512));
  full.content.set("app.js", content); Object.assign(full.request.files.find(f => f.path === "app.js"), { size: content.length, sha256: sha(content) });
  const crowded = await full.scan(); assert.equal(crowded.findings.length, 512); assert.ok(crowded.gaps.includes("finding_limit")); assert.equal(crowded.sbom.components[0].artifact.archive.status, "mismatched"); assert.equal(crowded.outcome, "failed"); assert.deepEqual(admit(crowded, full), crowded);
});
