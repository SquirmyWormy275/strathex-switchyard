import test from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdtemp, writeFile, symlink, link, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { scanShieldInputs, shieldActions, shieldEngineVersion, validateShieldRequest, createShieldFileReader } from "./shield-scanner-engine.mjs";
const sha = b => createHash("sha256").update(b).digest("hex");
import {scannerFixture} from "./test-support/shield-scanner-fixture.mjs";

test("actual baseline matches secrets, PII and JavaScript defects without returning source excerpts or matched values", async () => {
  const token = "ghp_" + "X".repeat(36), email = "synthetic-person@example.invalid", f = scannerFixture({ files: { "app.js": `const token='${token}';\nconst person='${email}';\neval(input);\n-----BEGIN PRIVATE KEY-----` } }), r = await f.scan();
  assert.equal(r.outcome, "failed"); assert.deepEqual(r.findings.map(f => f.ruleId).sort(), ["javascript.dynamic-code", "pii.email", "secret.github-token", "secret.private-key"]);
  assert.equal(r.findings.find(f => f.ruleId === "javascript.dynamic-code").line, 3); assert.equal(r.completeness, "incomplete");
  const serialized = JSON.stringify(r); for (const privateText of [token, email, "eval(input)"]) assert.equal(serialized.includes(privateText), false);
  assert.equal(r.inventory[0].sha256, f.request.files[0].sha256); assert.deepEqual((await f.scan()).findings, r.findings);
});
test("all four actions remain non-passing with explicit scope, history, permission and provenance gaps", async () => {
  for (const action of shieldActions) { const r = await scannerFixture({ action }).scan(); assert.equal(r.outcome, "incomplete"); assert.equal(r.completeness, "incomplete"); assert.ok(r.gaps.includes("repository_scope_unverified")); assert.ok(r.coverage.every(c => c.status === "incomplete"));
    if (["shield_codebase_audit", "release_shield"].includes(action)) { assert.ok(r.gaps.includes("git_history_not_scanned")); assert.ok(r.gaps.includes("source_permissions_not_witnessed")); }
    if (["shield_supply_chain", "release_shield"].includes(action)) { assert.ok(r.gaps.includes("publisher_provenance_not_verified")); assert.ok(r.gaps.includes("advisory_feed_missing")); }
  }
});
test("npm locked inventory checks exact advisory versions and licenses without confusing registry integrity with publisher provenance", async () => {
  const lock = JSON.stringify({ lockfileVersion: 3, packages: { "": { name: "example" }, "node_modules/example": { version: "1.2.3", license: "GPL-3.0", resolved: "https://registry.npmjs.org/example/-/example-1.2.3.tgz", integrity: "sha512-" + Buffer.alloc(64, 1).toString("base64") } } });
  const f = scannerFixture({ action: "shield_supply_chain", files: { "package-lock.json": lock }, advisory: [{ ecosystem: "npm", name: "example", version: "1.2.3", advisories: [{ id: "GHSA-synthetic-one", severity: "high" }] }] }), r = await f.scan();
  assert.equal(r.outcome, "failed"); assert.equal(r.sbom.components[0].name, "example"); assert.equal(r.sbom.components[0].version, "1.2.3"); assert.equal(r.findings.length, 2); assert.ok(r.gaps.includes("publisher_provenance_not_verified")); assert.equal(r.gaps.includes("package_source_or_integrity"), false); assert.equal(r.gaps.includes("advisory_package_coverage"), false);
  const other = scannerFixture({ action: "shield_supply_chain", files: { "package-lock.json": lock.replace("1.2.3", "1.2.4") }, advisory: [{ ecosystem: "npm", name: "example", version: "1.2.3", advisories: [] }] }); assert.ok((await other.scan()).gaps.includes("advisory_package_coverage"));
});
test("binary, unsupported ecosystems, workspace links and invalid locks cannot establish coverage", async () => {
  const r = await scannerFixture({ action: "release_shield", files: { "image.bin": Buffer.from([0, 255]), "Cargo.lock": "unsupported", "package-lock.json": JSON.stringify({ lockfileVersion: 3, packages: { "node_modules/local": { link: true } } }) } }).scan();
  for (const gap of ["binary_or_non_utf8_input", "unsupported_dependency_ecosystem", "unsupported_npm_package"]) assert.ok(r.gaps.includes(gap)); assert.equal(r.outcome, "incomplete");
});
test("arbitrary feed patterns, executable fields, rule identifiers and ambiguous inventory are rejected", async () => {
  for (const change of [p => { p.pattern = "(a+)+"; }, p => { p.rules = ["unreviewed.execute"]; }, p => { p.engine = "future"; }, p => { p.rules.push(p.rules[0]); }]) { const f = scannerFixture(); change(f.policy); const b = Buffer.from(JSON.stringify(f.policy)); f.content.set("rules.json", b); f.request.scanner.sha256 = sha(b); await assert.rejects(f.scan()); }
  const f = scannerFixture(); for (const bad of [{ ...f.request, scope: "entire-repository" }, { ...f.request, files: [...f.request.files, f.request.files[0]] }, { ...f.request, files: [{ ...f.request.files[0], path: "../secret" }] }, { ...f.request, executable: "/bin/sh" }]) assert.throws(() => validateShieldRequest(bad));
});
test("changed source/feed bytes and finding overflow fail closed without leaking matches", async () => {
  const f = scannerFixture(); f.content.set("app.js", Buffer.from("changed")); await assert.rejects(f.scan(), /changed|oversized/);
  const g = scannerFixture(); g.content.set("rules.json", Buffer.from("changed")); await assert.rejects(g.scan(), /changed/);
  const h = scannerFixture({ files: { "app.js": "eval(x);\n".repeat(600) } }), r = await h.scan(); assert.equal(r.findings.length, 512); assert.ok(r.gaps.includes("finding_limit")); assert.equal(r.outcome, "failed");
});
test("filesystem reader enforces exact read bounds and refuses symlinks, hardlinks and traversal", async t => {
  const root = await mkdtemp(join(tmpdir(), "switchyard-scanner-")); t.after(() => rm(root, { recursive: true, force: true })); await writeFile(join(root, "input"), "bounded"); const read = createShieldFileReader(root);
  assert.equal((await read("input", 7)).toString(), "bounded"); await assert.rejects(read("input", 6)); await assert.rejects(read("../input", 7));
  await link(join(root, "input"), join(root, "hard")); await assert.rejects(read("input", 7));
  if (process.platform !== "win32") { await symlink(join(root, "input"), join(root, "symbolic")); await assert.rejects(read("symbolic", 7)); }
});
