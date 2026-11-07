import test from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { inspectNpmArchive } from "./shield-scanner-engine.mjs";
import { parseShieldScannerReport } from "./repository-shield.mjs";
import { npmArchiveFixture } from "./test-support/npm-archive-fixture.mjs";
import { npmArtifactFixture } from "./test-support/shield-scanner-fixture.mjs";
const hash = (value, algorithm = "sha256", encoding = "hex") => createHash(algorithm).update(value).digest(encoding);
const admit = (r, f) => parseShieldScannerReport(JSON.stringify(r), { engine: r.engine, request: f.request, requestSha256: r.requestSha256 }, f.request.action);
function fixture({ license = "GPL-3.0-only", lockLicense = "MIT", allowed = ["MIT"], integrity = "matched", name = "synthetic", action = "shield_supply_chain" } = {}) {
  const f = npmArtifactFixture({ action, archiveStatus: "matched" }), bytes = npmArchiveFixture({ manifest: JSON.stringify({ name, version: "1.0.0", license }) });
  const lock = JSON.parse(f.content.get("package-lock.json")), p = lock.packages["node_modules/synthetic"];
  p.license = lockLicense; p.integrity = integrity === "unsupported" ? "sha256-unsupported" : "sha512-" + hash(integrity === "matched" ? bytes : Buffer.from("different"), "sha512", "base64");
  f.content.set("package-lock.json", Buffer.from(JSON.stringify(lock))); f.content.set("reviewed-package.tgz", bytes);
  for (const row of f.request.files) { const data = f.content.get(row.path); Object.assign(row, { size: data.length, sha256: hash(data) }); }
  const policy = Buffer.from(JSON.stringify({ ...f.policy, allowedLicenses: allowed })); f.content.set("rules.json", policy); f.request.scanner.sha256 = hash(policy); return f;
}
test("npm archive license metadata is explicit, bounded and independent from nested or deprecated fields", () => {
  for (const [fields, expected] of [
    [{}, { status: "missing" }], [{ license: "MIT OR (Apache-2.0)" }, { status: "declared", expression: "MIT OR Apache-2.0" }],
    [{ license: "SEE LICENSE IN NEVER_COPY_PRIVATE_LICENSE_PATH" }, { status: "file-only" }],
    [{ license: "LicenseRef-NEVER_COPY_PRIVATE_TEXT" }, { status: "unsupported" }],
    [{ license: "UNLICENSED" }, { status: "unsupported" }], [{ license: " UNLICENSED " }, { status: "unsupported" }], [{ license: "unlicensed" }, { status: "unsupported" }], [{ license: ["MIT"] }, { status: "unsupported" }],
    [{ license: { type: "MIT", url: "NEVER_COPY_PRIVATE_URL" } }, { status: "unsupported" }],
    [{ licenses: [{ type: "MIT" }] }, { status: "unsupported" }], [{ license: "MIT", licenses: [] }, { status: "unsupported" }],
    [{ nested: { license: "GPL-3.0-only" } }, { status: "missing" }], [{ license: "x".repeat(513) }, { status: "unsupported" }]
  ]) { const a = inspectNpmArchive(npmArchiveFixture({ manifest: JSON.stringify({ name: "synthetic", version: "1.0.0", ...fields }) })); assert.equal(a.status, "inspected"); assert.deepEqual(a.license, expected); assert.equal(JSON.stringify(a).includes("NEVER_COPY"), false); }
  for (const key of ['"license"', '"li\\u0063ense"']) assert.equal(inspectNpmArchive(npmArchiveFixture({ manifest: '{"name":"synthetic","version":"1.0.0","license":"MIT",' + key + ':"GPL-3.0-only"}' })).status, "unsupported");
});
test("a permissive npm lock declaration cannot hide disallowed obligations in the matching archive", async () => {
  for (const action of ["shield_supply_chain", "release_shield"]) for (const [license, allowed, expected] of [
    ["MIT AND GPL-3.0-only", ["MIT"], "disallowed"], ["MIT OR GPL-3.0-only", ["MIT"], "permitted"],
    ["GPL-2.0-only WITH Classpath-exception-2.0", ["MIT", "GPL-2.0-only"], "disallowed"],
    ["GPL-2.0-only WITH Classpath-exception-2.0", ["MIT", "GPL-2.0-only WITH Classpath-exception-2.0"], "permitted"],
    ["MIT", [], "unconfigured"]
  ]) { const f = fixture({ license, allowed, action }), r = await f.scan(), c = r.sbom.components[0]; assert.equal(c.license, "MIT"); assert.equal(c.artifact.licensePolicy, expected); assert.equal(c.artifact.archive.license.expression, license); assert.equal(r.findings.some(f => f.ruleId === "license.disallowed"), expected === "disallowed"); assert.equal(r.outcome, expected === "disallowed" ? "failed" : "incomplete"); assert.equal(r.gaps.includes("license_choice_not_selected"), license.includes(" OR ")); assert.ok(r.gaps.includes("artifact_contents_not_inspected")); assert.ok(r.gaps.includes("publisher_provenance_not_verified")); assert.deepEqual(admit(r, f), r); }
});
test("archive metadata does not replace disallowed npm lock terms or authorize unmatched content", async () => {
  const f = fixture({ license: "MIT", lockLicense: "GPL-3.0-only" }), r = await f.scan(); assert.equal(r.sbom.components[0].artifact.licensePolicy, "permitted"); assert.equal(r.outcome, "failed"); assert.equal(r.findings.filter(x => x.ruleId === "license.disallowed").length, 1); assert.deepEqual(admit(r, f), r);
  for (const integrity of ["matched", "mismatched", "unsupported"]) for (const name of ["synthetic", "another"]) { const f = fixture({ integrity, name }), r = await f.scan(); assert.equal(r.sbom.components[0].artifact.licensePolicy, integrity === "matched" && name === "synthetic" ? "disallowed" : "unassessed"); assert.equal(r.findings.some(x => x.ruleId === "license.disallowed"), integrity === "matched" && name === "synthetic"); assert.deepEqual(admit(r, f), r); }
});
test("npm archive admission retains declaration provenance, failed policy findings and unselected choices", async () => {
  const f = fixture(), r = await f.scan();
  for (const mutate of [x => { delete x.sbom.components[0].artifact.licensePolicy; }, x => { x.sbom.components[0].artifact.archive.license.raw = "private"; }, x => { x.sbom.components[0].artifact.archive.license.expression = "(MIT)"; }, x => { x.findings = []; x.outcome = "incomplete"; x.coverage.forEach(c => c.findings = 0); }, x => { x.cycloneDx.components[0].properties.find(p => p.name === "switchyard:archive-license-policy").value = "permitted"; }]) { const x = structuredClone(r); mutate(x); assert.throws(() => admit(x, f)); }
  const c = fixture({ license: "MIT OR GPL-3.0-only" }), choice = await c.scan(); choice.gaps = choice.gaps.filter(g => g !== "license_choice_not_selected"); assert.throws(() => admit(choice, c));
  const unknown = fixture({ license: "SEE LICENSE IN NEVER_COPY_PRIVATE_PATH" }), gap = await unknown.scan(); assert.equal(gap.sbom.components[0].artifact.licensePolicy, "unassessed"); assert.ok(gap.gaps.includes("license_metadata")); assert.equal(JSON.stringify(gap).includes("NEVER_COPY"), false); gap.gaps = gap.gaps.filter(g => g !== "license_metadata"); assert.throws(() => admit(gap, unknown));
});
test("npm lock and archive catalog properties preserve their separate declaration sources", async () => {
  const f = fixture({ license: "Unknown-Synthetic-License", allowed: ["MIT", "Unknown-Synthetic-License"] }), r = await f.scan(), properties = r.cycloneDx.components[0].properties;
  assert.equal(new Set(properties.map(p => p.name)).size, properties.length);
  assert.equal(properties.find(p => p.name === "switchyard:spdx-identifiers-listed").value, "true");
  assert.equal(properties.find(p => p.name === "switchyard:archive-spdx-identifiers-listed").value, "false");
  assert.ok(r.gaps.includes("license_metadata")); assert.deepEqual(admit(r, f), r);
});
test("npm archive license findings retain exact locations and the original finding ceiling", async () => {
  const f = fixture(), lock = JSON.parse(f.content.get("package-lock.json")); lock.packages["node_modules/second"] = { ...lock.packages["node_modules/synthetic"], name: "synthetic" };
  const bytes = Buffer.from(JSON.stringify(lock)); f.content.set("package-lock.json", bytes); Object.assign(f.request.files.find(row => row.path === "package-lock.json"), { size: bytes.length, sha256: hash(bytes) }); f.request.packageArtifacts.push({ ...f.request.packageArtifacts[0], location: "node_modules/second" });
  const r = await f.scan(); assert.equal(r.findings.length, 2); assert.equal(new Set(r.findings.map(x => x.fingerprint)).size, 2); assert.deepEqual(admit(r, f), r);
  const full = fixture({ action: "release_shield" }), content = Buffer.from("eval(untrusted);\n".repeat(512)); full.content.set("app.js", content); Object.assign(full.request.files.find(row => row.path === "app.js"), { size: content.length, sha256: hash(content) });
  const crowded = await full.scan(); assert.equal(crowded.findings.length, 512); assert.ok(crowded.gaps.includes("finding_limit")); assert.equal(crowded.sbom.components[0].artifact.licensePolicy, "disallowed"); assert.deepEqual(admit(crowded, full), crowded);
});
