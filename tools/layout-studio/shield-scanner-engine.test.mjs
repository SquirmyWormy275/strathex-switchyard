import test from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdtemp, readFile, writeFile, symlink, link, rm, realpath } from "node:fs/promises";
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
  for (const gap of ["binary_or_non_utf8_input", "unsupported_dependency_ecosystem", "unsupported_npm_package"]) assert.ok(r.gaps.includes(gap)); assert.equal(r.outcome, "incomplete");
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
