import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import test from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdtemp, readFile, writeFile, symlink, link, rm, realpath } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { scanShieldInputs, shieldActions, shieldEngineVersion, validateShieldRequest, createShieldFileReader, parsePinnedRequirements, pypiIdentity, parsePypiVersion, pypiVersionKey, comparePypiVersions, npmLicenseDeclaration, parseNpmVersion, compareNpmVersions } from "./shield-scanner-engine.mjs";
const sha = b => createHash("sha256").update(b).digest("hex");
import { parseShieldScannerReport } from "./repository-shield.mjs";
import {scannerFixture} from "./test-support/shield-scanner-fixture.mjs";

test("npm SemVer keeps exact build identity and rejects malformed or imprecise inventory and report versions", async () => {
  const order = ["1.0.0-alpha", "1.0.0-alpha.1", "1.0.0-alpha.beta", "1.0.0-beta", "1.0.0-beta.2", "1.0.0-beta.11", "1.0.0-rc.1", "1.0.0"];
  for (let i = 1; i < order.length; i++) assert.equal(compareNpmVersions(order[i - 1], order[i]), -1);
  assert.equal(compareNpmVersions("1.0.0+first", "1.0.0+second"), 0);
  assert.equal(compareNpmVersions("9007199254740990.0.0", "9007199254740991.0.0"), -1);
  const version = "1.2.3-rc.2+build.01", file = v => JSON.stringify({ lockfileVersion: 3, packages: { "node_modules/example": { version: v, license: "MIT" } } });
  const f = scannerFixture({ action: "shield_supply_chain", files: { "package-lock.json": file(version) }, advisory: [
    { ecosystem: "npm", name: "example", version, advisories: [{ id: "GHSA-exact-build", severity: "high" }] },
    { ecosystem: "npm", name: "example", version: "1.2.3-rc.2+other", advisories: [{ id: "GHSA-other-build", severity: "critical" }] },
  ] }), report = await f.scan(), shield = { engine: report.engine, requestSha256: report.requestSha256, request: f.request };
  assert.deepEqual(report.findings.map(f => f.ruleId), ["GHSA-exact-build"]); assert.equal(report.sbom.components[0].version, version);
  assert.deepEqual(parseShieldScannerReport(JSON.stringify(report), shield, f.request.action), report);
  for (const invalid of ["01.2.3", "1.2.3-01", "1.2.3-a..b", "1.2.3+..", "1.2.3+" + "x".repeat(251), "9007199254740992.0.0", "1.0.0-9007199254740992", "v1.2.3", "1.2.3 "]) {
    assert.throws(() => parseNpmVersion(invalid));
    const bad = scannerFixture({ action: "shield_supply_chain", files: { "package-lock.json": file(invalid) } }), scanned = await bad.scan();
    assert.equal(scanned.sbom.components.length, 0); assert.ok(scanned.gaps.includes("unsupported_npm_package"));
    const altered = structuredClone(report); altered.sbom.components[0].version = invalid;
    assert.throws(() => parseShieldScannerReport(JSON.stringify(altered), shield, f.request.action));
  }
});

test("license exceptions are exact atomic policy entries with precedence above AND and OR", () => {
  const pair = "GPL-2.0-only WITH Classpath-exception-2.0";
  assert.deepEqual(npmLicenseDeclaration("(GPL-2.0-only\tWITH  Classpath-exception-2.0)", [pair]), { expression: pair, allowed: true, choice: false });
  assert.equal(npmLicenseDeclaration(pair, ["GPL-2.0-only", "Classpath-exception-2.0"]).allowed, false);
  assert.equal(npmLicenseDeclaration("GPL-2.0-only", [pair]).allowed, false);
  assert.equal(npmLicenseDeclaration("GPL-2.0-only WITH Bison-exception-2.2", [pair]).allowed, false);
  assert.equal(npmLicenseDeclaration(pair, [pair.toLowerCase().replace(" with ", " WITH ")]).allowed, true);
  assert.equal(npmLicenseDeclaration("GPL-2.0+ WITH Classpath-exception-2.0", [pair]).allowed, false);
  assert.deepEqual(npmLicenseDeclaration(`${pair} AND Apache-2.0 OR MIT`, [pair, "Apache-2.0"]), { expression: `${pair} AND Apache-2.0 OR MIT`, allowed: true, choice: true });
  assert.equal(npmLicenseDeclaration(`${pair} AND (Apache-2.0 OR MIT)`, [pair]).allowed, false);
  assert.equal(npmLicenseDeclaration(`MIT OR ${pair}`, ["MIT"]).choice, true);
  const bound = Array(32).fill("A WITH B").join(" OR "); assert.equal(npmLicenseDeclaration(bound, ["A WITH B"]).expression, bound);
  assert.equal(npmLicenseDeclaration(Array(33).fill("A WITH B").join(" OR ")), null);
});

test("malformed exception syntax cannot borrow an allowed base license or alternative", () => {
  for (const expression of ["MIT WITH", "MIT with Unknown", "MIT WITH(Unknown)", "(MIT) WITH Unknown", "MIT WITH Unknown+", "MIT WITH OR", "MIT WITH NONE", "MIT WITH NOASSERTION", "MIT WITH LicenseRef-private", "MIT WITH DocumentRef-private", "MIT WITH A WITH B", "MIT WITH A.B+", "MIT WITH " + "x".repeat(81)]) {
    assert.equal(npmLicenseDeclaration(expression, ["MIT"]), null, expression);
    assert.equal(npmLicenseDeclaration("MIT OR " + expression, ["MIT"]), null, expression);
  }
});

test("signed rule policy can explicitly permit a complete exception pair without permitting its base", async () => {
  const pair = "GPL-2.0-only WITH Classpath-exception-2.0";
  const f = scannerFixture({ action: "shield_supply_chain", allowedLicenses: [pair], files: { "package-lock.json": JSON.stringify({ lockfileVersion: 3, packages: {
    "node_modules/with-exception": { version: "1.0.0", license: pair },
    "node_modules/base-only": { version: "1.0.0", license: "GPL-2.0-only" }
  } }) } });
  const report = await f.scan();
  assert.equal(report.findings.filter(f => f.ruleId === "license.disallowed").length, 1);
  assert.deepEqual(report.sbom.components.map(c => c.license), [pair, "GPL-2.0-only"]);
  assert.equal(report.gaps.includes("license_metadata"), false); assert.equal(report.completeness, "incomplete");
  const shield = { engine: shieldEngineVersion, request: f.request, requestSha256: sha(JSON.stringify(f.request)) };
  assert.equal(parseShieldScannerReport(JSON.stringify(report), shield, f.request.action).cycloneDx.components[0].licenses[0].license.name, pair);
});

test("license declaration AND/OR precedence, grouping and case-insensitive policy preserve required obligations without choosing a branch", () => {
  for (const [value, allowed, expression, choice] of [
    ["MIT", true, "MIT", false], ["mit", true, "mit", false], ["( MIT OR GPL-3.0-only )", true, "MIT OR GPL-3.0-only", true],
    ["MIT AND GPL-3.0-only", false, "MIT AND GPL-3.0-only", false], ["MIT OR Apache-2.0 AND GPL-3.0-only", true, "MIT OR Apache-2.0 AND GPL-3.0-only", true],
    ["(MIT OR Apache-2.0) AND GPL-3.0-only", false, "(MIT OR Apache-2.0) AND GPL-3.0-only", true], ["MIT AND(Apache-2.0 OR GPL-3.0-only)", true, "MIT AND (Apache-2.0 OR GPL-3.0-only)", true],
    ["GPL-2.0+", false, "GPL-2.0+", false]
  ]) {
    const result = npmLicenseDeclaration(value, ["MIT", "Apache-2.0"]); assert.deepEqual(result, { expression, allowed, choice }); assert.equal(npmLicenseDeclaration(result.expression)?.expression, result.expression);
  }
  assert.equal(npmLicenseDeclaration("GPL-2.0+", ["GPL-2.0-only"]).allowed, false, "No inferred equivalence or later-version approval");
  assert.equal(npmLicenseDeclaration("GPL-2.0+", ["gpl-2.0+"]).allowed, true);
  const long = Array(64).fill("MIT").join(" OR "); assert.equal(npmLicenseDeclaration(long, ["MIT"]).expression, long);
});
test("unsupported or malicious license syntax cannot obtain a partial permitted branch", () => {
  for (const value of [null, {}, ["MIT"], "", "NONE", "NOASSERTION", "(MIT) WITH Classpath-exception-2.0", "MIT OR GPL-2.0-only WITH LicenseRef-private", "LicenseRef-private", "MIT OR LicenseRef-private", "DocumentRef-other:LicenseRef-private", "SEE LICENSE IN LICENSE", "MIT or Apache-2.0", "MIT AND", "OR MIT", "MIT MIT", "()", "(MIT", "MIT)", "MIT+OR Apache-2.0", "MIT\nOR Apache-2.0", "MIT\0", "MIT;globalThis.NEVER_EXECUTE=1", "(".repeat(17) + "MIT" + ")".repeat(17), "x".repeat(81), Array(65).fill("MIT").join(" OR ")]) assert.equal(npmLicenseDeclaration(value, ["MIT"]), null, String(value));
});
test("license policy remains a unique literal-identifier allowlist including exact exception pairs without accepting compound policies or case aliases", async () => {
  for (const allowedLicenses of [["MIT", "mit"], ["MIT OR GPL-3.0-only"], ["MIT WITH (Unknown)"], ["MIT with Unknown"], ["MIT WITH Unknown", "mit WITH unknown"], ["MIT  WITH Unknown"], ["MIT WITH Unknown OR Apache-2.0"], ["GPL+arbitrary"], ["NONE"], ["LicenseRef-private"]]) {
    const f = scannerFixture({ action: "shield_supply_chain" }); f.policy.allowedLicenses = allowedLicenses;
    const bytes = Buffer.from(JSON.stringify(f.policy)); f.content.set(f.request.scanner.path, bytes); f.request.scanner.sha256 = sha(bytes);
    await assert.rejects(f.scan(), /license policy/);
  }
});
test("actual npm lock scans distinguish a permitted alternative, required disallowed license and unsupported reference with exact BOM/report binding", async () => {
  const licenses = { choice: "(MIT OR GPL-3.0-only)", required: "MIT AND GPL-3.0-only", unsupported: "MIT OR LicenseRef-private", precedence: "MIT OR Apache-2.0 AND GPL-3.0-only" };
  const lock = JSON.stringify({ lockfileVersion: 3, packages: Object.fromEntries(Object.entries(licenses).map(([name, license]) => ["node_modules/" + name, { version: "1.0.0", license }])) });
  const f = scannerFixture({ action: "shield_supply_chain", files: { "package-lock.json": lock } }), report = await f.scan();
  assert.equal(report.outcome, "failed"); assert.equal(report.completeness, "incomplete"); assert.equal(report.findings.filter(f => f.ruleId === "license.disallowed").length, 1);
  assert.ok(report.gaps.includes("license_choice_not_selected")); assert.ok(report.gaps.includes("license_metadata"));
  assert.deepEqual(report.sbom.components.map(c => c.license), ["MIT OR GPL-3.0-only", "MIT AND GPL-3.0-only", null, "MIT OR Apache-2.0 AND GPL-3.0-only"]);
  const shield = { engine: shieldEngineVersion, request: f.request, requestSha256: sha(JSON.stringify(f.request)) };
  assert.equal(parseShieldScannerReport(JSON.stringify(report), shield, f.request.action).outcome, "failed");
  const changed = structuredClone(report); changed.sbom.components[0].license = "MIT OR GPL-3.0-only WITH Unknown"; assert.throws(() => parseShieldScannerReport(JSON.stringify(changed), shield, f.request.action));
  const mismatched = structuredClone(report); mismatched.cycloneDx.components[0].licenses[0].license.name = "MIT"; assert.throws(() => parseShieldScannerReport(JSON.stringify(mismatched), shield, f.request.action));
  assert.equal(report.cycloneDx.components[0].licenses[0].license.name, "MIT OR GPL-3.0-only", "Declared text, not an SPDX-list validation claim or selected legal license");
});

test("actual baseline matches secrets, PII and JavaScript defects without returning source excerpts or matched values", async () => {
  const token = "ghp_" + "X".repeat(36), email = "synthetic-person@example.invalid", f = scannerFixture({ files: { "app.js": `const token='${token}';\nconst person='${email}';\neval(input);\n-----BEGIN PRIVATE KEY-----` } }), r = await f.scan();
  assert.equal(r.outcome, "failed"); assert.deepEqual(r.findings.map(f => f.ruleId).sort(), ["javascript.dynamic-code", "pii.email", "secret.github-token", "secret.private-key"]);
  assert.equal(r.findings.find(f => f.ruleId === "javascript.dynamic-code").line, 3); assert.equal(r.completeness, "incomplete");
  const serialized = JSON.stringify(r); for (const privateText of [token, email, "eval(input)"]) assert.equal(serialized.includes(privateText), false);
  assert.equal(r.inventory[0].sha256, f.request.files[0].sha256); assert.deepEqual((await f.scan()).findings, r.findings);
});
test("all four actions remain non-passing with explicit scope, history, permission and provenance gaps", async () => {
  for (const action of shieldActions) { const r = await scannerFixture({ action }).scan(); assert.equal(r.outcome, "incomplete"); assert.equal(r.completeness, "incomplete"); assert.ok(r.gaps.includes("repository_scope_unverified")); assert.ok(r.coverage.every(c => c.status === "incomplete")); if(["shield_change_scan","shield_codebase_audit"].includes(action))assert.equal(r.cycloneDx,null);
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
  for (const gap of ["binary_or_non_utf8_input", "unsupported_cargo_lock", "unsupported_npm_package"]) assert.ok(r.gaps.includes(gap)); assert.equal(r.outcome, "incomplete");
});
test("aliased npm packages match advisories by their real locked identity and retain distinct reproducible CycloneDX references", async () => {
  const lock=JSON.stringify({lockfileVersion:3,packages:{"":{},"node_modules/alias":{name:"@example/real",version:"1.0.0",license:"MIT"},"node_modules/parent/node_modules/alias":{name:"@example/real",version:"1.0.0",license:"MIT"}}}),f=scannerFixture({action:"shield_supply_chain",files:{"package-lock.json":lock},advisory:[{ecosystem:"npm",name:"@example/real",version:"1.0.0",advisories:[{id:"GHSA-synthetic-alias",severity:"high"}]}]}),r=await f.scan();
  assert.equal(r.findings.filter(f=>f.ruleId==="GHSA-synthetic-alias").length,2);assert.equal(r.sbom.components.every(c=>c.name==="@example/real"&&c.installedAs==="alias"),true);assert.equal(r.gaps.includes("advisory_package_coverage"),false);
  assert.equal(r.cycloneDx.bomFormat,"CycloneDX");assert.equal(r.cycloneDx.specVersion,"1.6");assert.equal(new Set(r.cycloneDx.components.map(c=>c["bom-ref"])).size,2);assert.deepEqual((await f.scan()).cycloneDx,r.cycloneDx);assert.equal(r.cycloneDx.compositions[0].aggregate,"unknown");assert.equal(r.cycloneDx.dependencies,undefined);assert.ok(r.cycloneDx.components.every(c=>c.hashes===undefined));assert.equal(r.completeness,"incomplete");
});
test("workspace links use exact root-contained lock metadata, preserve aliases and never read or execute local package sources", async () => {
  const metadata={name:"@example/local",version:"2.1.0",license:"GPL-3.0",scripts:{install:"NEVER_EXECUTE_WORKSPACE_SCRIPT"}},lock=JSON.stringify({lockfileVersion:3,packages:{"":{},"packages/local":metadata,"node_modules/workspace-alias":{resolved:"packages/local",link:true},"node_modules/parent/node_modules/local":{resolved:"packages/local",link:true}}}),f=scannerFixture({action:"shield_supply_chain",files:{"package-lock.json":lock},advisory:[{ecosystem:"npm",name:"@example/local",version:"2.1.0",advisories:[{id:"GHSA-synthetic-local",severity:"high"}]}]}),reads=[];
  const report=await scanShieldInputs(f.request,{readInput:async(path,maximum)=>{reads.push(path);return f.readInput(path,maximum);}});
  assert.equal(report.sbom.components.length,2);assert.ok(report.sbom.components.every(component=>component.name==="@example/local"&&component.version==="2.1.0"&&component.workspace.path==="packages/local"&&component.workspace.lockMetadataSha256===sha(JSON.stringify(metadata))&&component.integritySha256===null));assert.deepEqual(report.sbom.components.map(component=>component.installedAs),["workspace-alias","local"]);
  assert.equal(report.findings.filter(finding=>finding.ruleId==="GHSA-synthetic-local").length,2);assert.equal(report.findings.filter(finding=>finding.ruleId==="license.disallowed").length,2);assert.equal(report.gaps.includes("unsupported_npm_package"),false);assert.ok(report.gaps.includes("workspace_source_unverified"));assert.ok(report.gaps.includes("package_source_or_integrity"));assert.equal(report.completeness,"incomplete");
  assert.deepEqual(reads,["rules.json","advisory.json","package-lock.json"]);assert.equal(JSON.stringify(report).includes("NEVER_EXECUTE_WORKSPACE_SCRIPT"),false);assert.equal(new Set(report.cycloneDx.components.map(component=>component["bom-ref"])).size,2);assert.ok(report.cycloneDx.components.every(component=>component.properties.some(property=>property.name==="switchyard:workspace-source"&&property.value==="not-verified")));assert.equal(report.cycloneDx.dependencies,undefined);assert.deepEqual((await f.scan()).cycloneDx,report.cycloneDx);
});
test("external, missing, cyclic, malformed and ambiguous workspace links stay unsupported without following a filesystem link", async () => {
  const base={"":{},"packages/local":{name:"@example/local",version:"1.0.0",license:"MIT"},"node_modules/local":{resolved:"packages/local",link:true}};
  const faults=[p=>p["node_modules/local"].resolved="../outside",p=>p["node_modules/local"].resolved="/outside",p=>p["node_modules/local"].resolved="file:packages/local",p=>p["node_modules/local"].resolved="https://untrusted.invalid",p=>p["node_modules/local"].resolved="packages\\local",p=>p["node_modules/local"].resolved=".git/objects/private",p=>p["node_modules/local"].resolved="__proto__",p=>{delete p["packages/local"];},p=>{p["packages/local"]={resolved:"node_modules/local",link:true};},p=>{delete p["packages/local"].version;},p=>{delete p["packages/local"].name;},p=>{p["packages/local"].resolved="https://untrusted.invalid";},p=>{p["node_modules/local"].name="forged";},p=>{p["node_modules/local"].link="true";},p=>{p["notnode_modules/local"]=p["node_modules/local"];delete p["node_modules/local"];},p=>{p["node_modules/local/extra"]=p["node_modules/local"];delete p["node_modules/local"];}];
  for(const mutate of faults){const packages=structuredClone(base);mutate(packages);const f=scannerFixture({action:"shield_supply_chain",files:{"package-lock.json":JSON.stringify({lockfileVersion:3,packages})}}),report=await f.scan();assert.equal(report.sbom.components.some(component=>component.workspace),false);assert.ok(report.gaps.includes("unsupported_npm_package"));assert.equal(report.completeness,"incomplete");}
});
test("the actual development lock inventories local workspaces as declared metadata without claiming source, artifact or graph verification",async()=>{
  const lock=await readFile(new URL("../../package-lock.json",import.meta.url),"utf8"),parsed=JSON.parse(lock),links=Object.entries(parsed.packages).filter(([,record])=>record.link===true),report=await scannerFixture({action:"shield_supply_chain",files:{"package-lock.json":lock}}).scan();assert.equal(links.length,4);assert.equal(report.sbom.components.filter(component=>component.workspace).length,4);assert.equal(report.sbom.components.length,7);assert.ok(report.sbom.components.filter(component=>component.workspace).every(component=>component.license==="UNLICENSED"));assert.ok(report.gaps.includes("workspace_source_unverified"));assert.equal(report.gaps.includes("unsupported_npm_package"),false);assert.equal(report.cycloneDx.compositions[0].aggregate,"unknown");assert.equal(report.cycloneDx.metadata.properties.find(property=>property.name==="switchyard:dependency-graph").value,"not-collected");
});
test("CycloneDX records an integrity-string hash as metadata without presenting it as downloaded package bytes or a complete graph",async()=>{
  const integrity="sha512-"+Buffer.alloc(64,2).toString("base64"),lock=JSON.stringify({lockfileVersion:2,packages:{"node_modules/example":{version:"1.0.0",license:"MIT",integrity,resolved:"https://registry.npmjs.org/example/-/example-1.0.0.tgz"}}}),r=await scannerFixture({action:"shield_supply_chain",files:{"package-lock.json":lock}}).scan(),c=r.cycloneDx.components[0];
  assert.equal(c.properties.find(p=>p.name==="switchyard:integrity-string-sha256").value,sha(integrity));assert.equal(c.hashes,undefined);assert.equal(r.cycloneDx.metadata.properties.find(p=>p.name==="switchyard:publisher-provenance").value,"not-verified");assert.equal(r.cycloneDx.metadata.properties.find(p=>p.name==="switchyard:dependency-graph").value,"not-collected");assert.ok(r.gaps.includes("advisory_feed_missing"));
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
  const root = await realpath(await mkdtemp(join(tmpdir(), "switchyard-scanner-"))); t.after(() => rm(root, { recursive: true, force: true })); await writeFile(join(root, "input"), "bounded"); const read = createShieldFileReader(root);
  assert.equal((await read("input", 7)).toString(), "bounded"); await assert.rejects(read("input", 6)); await assert.rejects(read("../input", 7));
  await link(join(root, "input"), join(root, "hard")); await assert.rejects(read("input", 7));
  if (process.platform !== "win32") { await symlink(join(root, "input"), join(root, "symbolic")); await assert.rejects(read("symbolic", 7)); }
});


test("offline Python verifier rejects missing scope and incompatible actions or public queries before installed access", () => {
  const entry = fileURLToPath(new URL("../../scripts/verify-shield-host.mjs", import.meta.url));
  for (const args of [["--synthetic", "--pep440-requirements"], ["--synthetic", "--action=shield_change_scan", "--pep440-requirements"], ["--synthetic", "--action=shield_supply_chain", "--pep440-requirements", "--osv-advisory"]]) {
    assert.throws(() => execFileSync(process.execPath, [entry, ...args], { encoding: "utf8", timeout: 5000, stdio: ["ignore", "pipe", "pipe"] }), error => error.status === 1 && error.stderr.includes("Usage: node scripts/verify-shield-host.mjs"));
  }
});

test("bounded PEP 440 version identities and ordering match the independent PyPA oracle", async () => {
  const oracle = JSON.parse(await readFile(new URL("../../scripts/fixtures/pep440-oracle.json", import.meta.url), "utf8"));
  assert.equal(oracle.schema, "switchyard-pep440-oracle/v1");
  for (const [left, rank] of oracle.cases) {
    parsePypiVersion(left);
    for (const [right, otherRank] of oracle.cases) {
      const expected = Math.sign(rank - otherRank);
      assert.equal(comparePypiVersions(left, right), expected, left + " vs " + right);
      assert.equal(pypiVersionKey(left) === pypiVersionKey(right), expected === 0, left + " identity vs " + right);
    }
  }
  for (const version of [...oracle.invalid, " 1.0", "1.0\n", "１.０", "1.".repeat(32)+"0", "1+"+"x".repeat(127)]) assert.throws(() => parsePypiVersion(version));
});

test("non-final Python pins keep literal versions, match equivalent advisory identities and percent-encode package URLs", async () => {
  const version = "01!02.0RC01.post02.dev03+LOCAL-001";
  assert.deepEqual(parsePinnedRequirements("Example_Package=="+version), [{ ecosystem: "PyPI", name: "example-package", version, declaredSha256: [] }]);
  const f = scannerFixture({ action: "shield_supply_chain", files: { "requirements.txt": "Example_Package=="+version }, advisory: [{ ecosystem: "PyPI", name: "example-package", version: "1!2.0rc1.post2.dev3+local.1", advisories: [{ id: "SYNTHETIC-PEP440", severity: "high" }] }] }), report = await f.scan();
  assert.equal(report.outcome, "failed"); assert.equal(report.sbom.components[0].version, version); assert.equal(report.findings.some(f => f.ruleId === "SYNTHETIC-PEP440"), true);
  assert.equal(report.cycloneDx.components[0].purl, "pkg:pypi/example-package@01%2102.0rc01.post02.dev03%2Blocal-001");
  assert.equal(report.gaps.includes("unsupported_python_requirements"), false); assert.equal(report.gaps.includes("python_environment_not_resolved"), true);
  parseShieldScannerReport(JSON.stringify(report), { engine: report.engine, requestSha256: report.requestSha256, request: f.request }, f.request.action);
  const duplicate = scannerFixture({ action: "shield_supply_chain", files: { "requirements.txt": "example==1.0" }, advisory: [{ ecosystem: "PyPI", name: "example", version: "1", advisories: [] }, { ecosystem: "PyPI", name: "example", version: "01.0.0", advisories: [{ id: "NEVER_HIDE", severity: "high" }] }] });
  await assert.rejects(duplicate.scan(), /Duplicate advisory/);
});

test("Python requirement pins normalize distribution names and retain declared hashes without resolving an environment", () => {
  const continuation = String.fromCharCode(92), text = ["# synthetic declarations", "Requests==2.19.1 " + continuation, "  --hash=sha256:" + "b".repeat(64) + " " + continuation, "  --hash=sha256:" + "a".repeat(64), "My___Package.name == 2026.10 # metadata only"].join("\r\n");
  assert.deepEqual(parsePinnedRequirements(text), [{ ecosystem: "PyPI", name: "requests", version: "2.19.1", declaredSha256: ["a".repeat(64), "b".repeat(64)] }, { ecosystem: "PyPI", name: "my-package-name", version: "2026.10", declaredSha256: [] }]);
  assert.deepEqual(parsePinnedRequirements("# empty declared input\n"), []);
  assert.deepEqual(pypiIdentity("PyYAML", "6.0.2"), { ecosystem: "PyPI", name: "pyyaml", version: "6.0.2" });
  for (const version of ["0", "1.0", "2026.10.2", "1.2.3.4"]) assert.ok(parsePypiVersion(version).release.length);
});

test("Python requirement includes, indexes, URLs, editable paths, markers, extras and unsupported syntax never become partial package inventory", () => {
  const values = ["-r private.txt", "--index-url https://user:NEVER_COPY_SECRET@example.invalid/simple", "-e ../private", "name @ https://example.invalid/source.whl", "name>=1.0", "name[extra]==1.0", "name==1.0; python_version<'3.12'", "name==1.0rcX", "name==1!", "name==1.0..post1", "name==1.0+", "name==1.*", "name==1.0dev1post2", "name==1.0\nNAME==1.0", "name==1.0 --hash=sha256:"+"a".repeat(63), "name==1.0 --hash=sha256:"+"a".repeat(64)+" --hash=sha256:"+"a".repeat(64), "name==1.0 " + String.fromCharCode(92), "name==1.0\0"];
  for (const value of values) assert.throws(() => parsePinnedRequirements("ordinary==1.0\n" + value));
  assert.throws(() => parsePinnedRequirements("#".repeat(256*1024+1))); assert.throws(() => parsePinnedRequirements("\n".repeat(8193)));
});

test("Python source inventory matches only its own exact PyPI advisory identity and never turns requirement hashes into artifact verification", async () => {
  const f = scannerFixture({ action: "shield_supply_chain", files: { "requirements.txt": "Requests==2.19.1 --hash=sha256:"+"a".repeat(64) }, advisory: [{ ecosystem: "npm", name: "requests", version: "2.19.1", advisories: [{ id: "OSV-WRONG-ECOSYSTEM", severity: "critical" }] }, { ecosystem: "PyPI", name: "Requests", version: "2.19.1", advisories: [{ id: "PYSEC-synthetic", severity: "unknown" }] }] }), reads = [];
  const report = await scanShieldInputs(f.request, { readInput: async (path, maximum) => { reads.push(path); return f.readInput(path, maximum); } });
  assert.deepEqual(reads, ["rules.json", "advisory.json", "requirements.txt"]); assert.equal(report.outcome, "failed"); assert.equal(report.sbom.schema, "switchyard-lock-inventory/v2"); assert.equal(report.sbom.components[0].ecosystem, "PyPI");
  assert.deepEqual(report.findings.map(f => f.ruleId), ["PYSEC-synthetic"]); for (const gap of ["license_metadata", "package_source_or_integrity", "python_environment_not_resolved", "advisory_severity_unassessed", "repository_scope_unverified"]) assert.ok(report.gaps.includes(gap));
  assert.equal(report.gaps.includes("dependency_manifest_missing"), false); assert.equal(report.cycloneDx.components[0].purl, "pkg:pypi/requests@2.19.1"); assert.equal(report.cycloneDx.components[0].hashes, undefined); assert.equal(report.cycloneDx.dependencies, undefined); assert.equal(report.cycloneDx.compositions[0].aggregate, "unknown");
  const shield = { engine: report.engine, requestSha256: report.requestSha256, request: f.request }; assert.deepEqual(parseShieldScannerReport(JSON.stringify(report), shield, f.request.action), report);
  for (const mutate of [r => { r.sbom.components[0].requirementsPath = "unselected.env"; }, r => { r.sbom.components[0].name = "Requests"; }, r => { r.sbom.components[0].declaredSha256 = ["a".repeat(63)]; }, r => { r.cycloneDx.components[0].purl = "pkg:npm/requests@2.19.1"; }, r => { r.cycloneDx.components[0].hashes = [{ alg: "SHA-256", content: "a".repeat(64) }]; }]) { const altered = structuredClone(report); mutate(altered); assert.throws(() => parseShieldScannerReport(JSON.stringify(altered), shield, f.request.action)); }
});

test("mixed npm and Python manifests retain distinct BOM identities; unsupported requirements disclose no source or partial package list", async () => {
  const lock = JSON.stringify({ lockfileVersion: 3, packages: { "node_modules/shared": { version: "1.0.0", license: "MIT" } } }), report = await scannerFixture({ action: "release_shield", files: { "package-lock.json": lock, "requirements-dev.txt": "shared==1.0.0" }, advisory: [{ ecosystem: "npm", name: "shared", version: "1.0.0", advisories: [] }, { ecosystem: "PyPI", name: "shared", version: "1.0.0", advisories: [] }] }).scan();
  assert.equal(report.sbom.components.length, 2); assert.deepEqual(report.sbom.components.map(c => c.ecosystem), ["npm", "PyPI"]); assert.equal(new Set(report.cycloneDx.components.map(c => c["bom-ref"])).size, 2); assert.equal(report.outcome, "incomplete");
  const invalid = await scannerFixture({ action: "shield_supply_chain", files: { "requirements.txt": "ordinary==1.0\n-r NEVER_COPY_SOURCE.txt\n" } }).scan(); assert.deepEqual(invalid.sbom.components, []); assert.ok(invalid.gaps.includes("unsupported_python_requirements")); assert.ok(invalid.gaps.includes("dependency_manifest_missing")); assert.equal(JSON.stringify(invalid).includes("NEVER_COPY_SOURCE"), false);
});
