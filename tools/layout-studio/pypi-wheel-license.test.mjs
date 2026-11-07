import test from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { inspectPypiWheel } from "./shield-scanner-engine.mjs";
import { parseShieldScannerReport } from "./repository-shield.mjs";
import { pypiWheelFixture, wheelLicenseOracle } from "./test-support/pypi-wheel-fixture.mjs";
const sha = x => createHash("sha256").update(x).digest("hex");
const admit = (r, f) => parseShieldScannerReport(JSON.stringify(r), { engine: r.engine, request: f.request, requestSha256: r.requestSha256 }, f.request.action);
function fixture(options = {}, allowed = ["MIT"]) {
  const f = pypiWheelFixture({ archiveCase: "license-and", ...options }), policy = Buffer.from(JSON.stringify({ ...f.policy, allowedLicenses: allowed }));
  f.content.set("rules.json", policy); f.request.scanner.sha256 = sha(policy); return f;
}
test("wheel license declarations retain bounded header facts without private text or file paths", () => {
  assert.equal(wheelLicenseOracle.cases.length, 17);
  for (const row of wheelLicenseOracle.cases) {
    const bytes = Buffer.from(row.bytesBase64, "base64"); assert.equal(sha(bytes), row.sha256);
    const a = inspectPypiWheel(bytes);
    if (row.expected === null) assert.equal(a.status, "unsupported");
    else { assert.equal(a.status, "inspected", row.id); assert.deepEqual(a.license, row.expected, row.id); }
    assert.equal(JSON.stringify(a).includes("NEVER_COPY"), false);
  }
});
test("only a verified matching wheel applies its declared SPDX policy", async () => {
  for (const action of ["shield_supply_chain", "release_shield"]) for (const [archiveCase, allowed, expected] of [
    ["license-and", ["MIT"], "disallowed"], ["license-or", ["MIT"], "permitted"], ["license-mit", [], "unconfigured"],
    ["license-file", ["MIT"], "unassessed"], ["license-record-mismatch", ["MIT"], "unassessed"], ["license-wrong-name", ["MIT"], "unassessed"]
  ]) {
    const f = fixture({ action, archiveCase }, allowed), r = await f.scan(), a = r.sbom.components[0].artifact;
    assert.equal(a.licensePolicy, expected); assert.equal(r.findings.some(x => x.ruleId === "license.disallowed"), expected === "disallowed");
    assert.equal(r.gaps.includes("license_choice_not_selected"), archiveCase === "license-or"); assert.ok(r.gaps.includes("license_metadata"));
    assert.ok(r.gaps.includes("artifact_contents_not_inspected")); assert.equal(r.completeness, "incomplete"); assert.deepEqual(admit(r, f), r);
  }
  for (const artifactStatus of ["mismatched", "unsupported-integrity"]) { const f = fixture({ artifactStatus }), r = await f.scan(); assert.equal(r.sbom.components[0].artifact.licensePolicy, "unassessed"); assert.deepEqual(admit(r, f), r); }
});
test("wheel license admission preserves failed findings, canonical metadata and unselected alternatives", async () => {
  const f = fixture(), r = await f.scan(); assert.equal(r.outcome, "failed");
  for (const change of [x => { delete x.sbom.components[0].artifact.licensePolicy; }, x => { x.sbom.components[0].artifact.archive.license.raw = "private"; }, x => { x.sbom.components[0].artifact.archive.license.expression = "(MIT)"; }, x => { x.findings = []; x.outcome = "incomplete"; x.coverage.forEach(c => c.findings = 0); }, x => { x.cycloneDx.components[0].properties.find(p => p.name === "switchyard:archive-license-policy").value = "permitted"; }]) { const copy = structuredClone(r); change(copy); assert.throws(() => admit(copy, f)); }
  const alternatives = fixture({ archiveCase: "license-or" }), choice = await alternatives.scan(); choice.gaps = choice.gaps.filter(g => g !== "license_choice_not_selected"); assert.throws(() => admit(choice, alternatives));
  const unset = fixture({ archiveCase: "license-mit" }, []), noPolicy = await unset.scan(); noPolicy.gaps = noPolicy.gaps.filter(g => g !== "license_policy"); assert.throws(() => admit(noPolicy, unset));
  for (const gap of ["license_metadata", "package_source_or_integrity", "python_environment_not_resolved"]) { const forged = structuredClone(r); forged.gaps = forged.gaps.filter(g => g !== gap); assert.throws(() => admit(forged, f)); }
});
test("wheel license fingerprints separate requirements files and preserve the finding ceiling", async () => {
  const f = fixture(), bytes = f.content.get("requirements.txt"), path = "extra/requirements.txt";
  f.content.set(path, bytes); f.request.files.push({ ...f.request.files.find(r => r.path === "requirements.txt"), path });
  f.request.packageArtifacts.push({ ...f.request.packageArtifacts[0], requirementsPath: path });
  const r = await f.scan(); assert.equal(r.findings.length, 2); assert.equal(new Set(r.findings.map(x => x.fingerprint)).size, 2); assert.deepEqual(admit(r, f), r);
  const full = fixture({ action: "release_shield" }), source = Buffer.from("eval(untrusted);\n".repeat(512)); full.content.set("app.js", source); Object.assign(full.request.files.find(x => x.path === "app.js"), { size: source.length, sha256: sha(source) });
  const crowded = await full.scan(); assert.equal(crowded.findings.length, 512); assert.ok(crowded.gaps.includes("finding_limit")); assert.equal(crowded.sbom.components[0].artifact.licensePolicy, "disallowed"); assert.deepEqual(admit(crowded, full), crowded);
});
test("a rejected duplicate license header retains its original reserved expansion charge", () => {
  const row = wheelLicenseOracle.cases.find(r => r.id === "license-duplicate"), budget = { remaining: 8 * 1024 * 1024 };
  assert.equal(inspectPypiWheel(Buffer.from(row.bytesBase64, "base64"), budget).status, "unsupported");
  assert.equal(budget.remaining, 4 * 1024 * 1024);
});
