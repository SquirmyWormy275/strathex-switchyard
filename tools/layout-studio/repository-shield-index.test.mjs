import test from "node:test";
import assert from "node:assert/strict";
import { createHash, randomUUID } from "node:crypto";
import { access, readFile, writeFile, mkdir, readdir } from "node:fs/promises";
import { join } from "node:path";
import { repositoryShieldFixture } from "./test-support/repository-shield-fixture.mjs";
import { scannerFixture } from "./test-support/shield-scanner-fixture.mjs";
import { validateShieldRequest, scanShieldInputs } from "./shield-scanner-engine.mjs";
import { parseShieldScannerReport } from "./repository-shield.mjs";
import { resolveShieldIndexWitness, bindShieldIndexWitness, shieldIndexStagingBytes } from "./shield-index-inputs.mjs";
import { runtimeGuardianStopped } from "./runtime-command.mjs";
import { authorityFixture } from "./test-support/task-authority-fixture.mjs";
import { LinuxDisposableExecutionRootProvider } from "../../apps/linux-companion/src/linux-repository-inputs.ts";
const sha = bytes => createHash("sha256").update(bytes).digest("hex"), linux = { skip: process.platform !== "linux" };
function indexSample() {
  const f = scannerFixture({ files: { "app.js": "const clean = true;" } }), bytes = Buffer.from("-----BEGIN PRIVATE KEY-----\nsynthetic\n"), path = ".switchyard-index/app.js", objectId = createHash("sha1").update(`blob ${bytes.length}\0`).update(bytes).digest("hex");
  const source = { kind: "git-index", path: "app.js", objectId, mode: "100644" }, entry = { path, sha256: sha(bytes), size: bytes.length, source };
  f.request.files.push(entry);f.content.set(path, bytes);
  const report = { schema: "switchyard-git-index-inputs/v1", sourceBytesWitnessed: true, sourceBytesReturned: false, head: "a".repeat(40), indexMetadataSha256: "b".repeat(64), rows: [{ path: source.path, objectId, mode: source.mode, sha256: entry.sha256, size: entry.size }] };
  return { ...f, entry, report, bytes };
}
test("scanner preserves both worktree and index origin, exact hashes and redacted findings; a host without index staging refuses admission", async () => {
  const f = indexSample(), request = validateShieldRequest(f.request), report = await scanShieldInputs(request, { readInput: async path => f.content.get(path) });
  assert.deepEqual(report.inventory.find(row => row.source)?.source, f.entry.source); assert.ok(report.findings.some(row => row.path === f.entry.path && row.ruleId === "secret.private-key")); assert.equal(report.findings.some(row => row.path === "app.js"), false); assert.ok(!JSON.stringify(report).includes("-----BEGIN PRIVATE KEY-----")); assert.equal(report.completeness, "incomplete");
  assert.deepEqual(parseShieldScannerReport(JSON.stringify(report), { engine: report.engine, request, requestSha256: report.requestSha256 }, request.action), report);
  const changed=structuredClone(report);delete changed.inventory.find(row=>row.source).source;assert.throws(()=>parseShieldScannerReport(JSON.stringify(changed),{engine:report.engine,request,requestSha256:report.requestSha256},request.action));
  await assert.rejects(resolveShieldIndexWitness(request), /no connected/);
  const witness=await resolveShieldIndexWitness(request,async(paths,consume)=>{assert.deepEqual(paths,["app.js"]);return consume(f.report);});assert.deepEqual(witness,bindShieldIndexWitness(request,f.report));
  const staged=shieldIndexStagingBytes({request,indexWitness:witness},f.report,new Map([["app.js",f.bytes]]));assert.equal(staged.get(f.entry.path).bytes,f.bytes);
  for(const patch of [{objectId:"c".repeat(40)},{sha256:"d".repeat(64)},{mode:"100755"},{size:0}]){const changed=structuredClone(f.report);Object.assign(changed.rows[0],patch);assert.throws(()=>bindShieldIndexWitness(request,changed));}
});
test("scanner index declarations reject invented origins, executable modes, aliases, duplicate sources and changed byte witnesses", () => {
  const f=indexSample();
  for(const patch of [{path:"app.js"},{path:".switchyard-index/foreign.js"},{source:{...f.entry.source,kind:"worktree"}},{source:{...f.entry.source,mode:"120000"}},{source:{...f.entry.source,objectId:"HEAD:app.js"}},{source:{...f.entry.source,command:"cat-file"}},{source:{...f.entry.source,path:"../foreign"}},{source:null}]){const changed=structuredClone(f.request);Object.assign(changed.files.at(-1),patch);assert.throws(()=>validateShieldRequest(changed));}
  const unlabelled=structuredClone(f.request);delete unlabelled.files.at(-1).source;assert.throws(()=>validateShieldRequest(unlabelled));
  const witness=bindShieldIndexWitness(f.request,f.report);assert.throws(()=>shieldIndexStagingBytes({request:f.request,indexWitness:{...witness,head:"c".repeat(40)}},f.report,new Map([["app.js",f.bytes]])));assert.throws(()=>shieldIndexStagingBytes({request:f.request,indexWitness:witness},f.report,new Map()));
});
test("identical staged and worktree content keeps separate finding identities for secrets, vulnerabilities and license policy", async () => {
  for(const supply of [false,true]){
    const text=supply?JSON.stringify({lockfileVersion:3,packages:{"node_modules/synthetic":{version:"1.0.0",license:"GPL-3.0-only"}}}):"-----BEGIN PRIVATE KEY-----\nsynthetic\n",path=supply?"package-lock.json":"app.js",bytes=Buffer.from(text),f=scannerFixture({action:supply?"shield_supply_chain":"shield_change_scan",files:{[path]:text},advisory:[{ecosystem:"npm",name:"synthetic",version:"1.0.0",advisories:[{id:"GHSA-synthetic-only",severity:"high"}]}]}),alias=".switchyard-index/"+path;
    const source={kind:"git-index",path,objectId:createHash("sha1").update(`blob ${bytes.length}\0`).update(bytes).digest("hex"),mode:"100644"};f.request.files.push({path:alias,sha256:sha(bytes),size:bytes.length,source});f.content.set(alias,bytes);
    const request=validateShieldRequest(f.request),report=await scanShieldInputs(request,{readInput:async path=>f.content.get(path)});
    assert.ok(report.findings.some(f=>f.path===path));assert.ok(report.findings.some(f=>f.path===alias));assert.equal(new Set(report.findings.map(f=>f.fingerprint)).size,report.findings.length);assert.equal(report.findings.length,supply?4:2);parseShieldScannerReport(JSON.stringify(report),{engine:report.engine,request,requestSha256:report.requestSha256},request.action);
  }
});
test("Linux isolated Shield scans staged-only secret bytes alongside clean worktree input and authenticates original Git provenance", linux, async t => {
  const f=await repositoryShieldFixture(t,{clean:true,stagedIndex:true}),beforeIndex=await readFile(join(f.root,".git/index")),beforeHead=await f.run("rev-parse","HEAD"),live=await readFile(join(f.root,"app.js"));
  await assert.rejects(access(join(f.root,".switchyard-index")),{code:"ENOENT"});
  const review=await f.execution.review("personal",f.proposed);assert.equal(review.review.shield.indexWitness.rows[0].path,"app.js");assert.equal(review.review.shield.indexWitness.rows[0].objectId,(await f.run("rev-parse",":app.js")).trim());
  const input={requestId:f.proposed.requestId,token:review.confirmation.token},result=await f.execution.apply("personal",input);assert.equal(result.status,"failed",JSON.stringify(result));assert.ok(result.receiptId);assert.equal(result.data.shieldReport.findings.some(row=>row.path==="app.js"),false);assert.ok(result.data.shieldReport.findings.some(row=>row.path===".switchyard-index/app.js"&&row.ruleId==="secret.private-key"));assert.ok(result.data.receiptEvidenceEnvelope.evidence.toolVersions.gitIndexInputs);assert.equal(result.data.receiptEvidenceEnvelope.completeness,"incomplete");assert.equal(result.data.shieldReport.inventory.find(row=>row.path===".switchyard-index/app.js").source.path,"app.js");assert.equal((await f.execution.apply("personal",input)).receiptId,result.receiptId);
  const state=await f.store.snapshot("personal");assert.equal(state.repositoryExecutions.length,1);assert.equal(await runtimeGuardianStopped(state.repositoryExecutions[0].ownedRuntime),true);assert.equal(state.repositoryExecutionStaging[0].cleanupPending,false);await assert.rejects(access(state.repositoryExecutionStaging[0].path),{code:"ENOENT"});assert.ok(state.repositoryProbes.every(p=>p.stoppedVerified&&p.scratchCleanupPending===false));
  assert.deepEqual(await readFile(join(f.root,"app.js")),live);assert.deepEqual(await readFile(join(f.root,".git/index")),beforeIndex);assert.equal(await f.run("rev-parse","HEAD"),beforeHead);await assert.rejects(access(join(f.root,".switchyard-index")),{code:"ENOENT"});
  await f.run("add","app.js");await assert.rejects(f.execution.review("personal",{...f.proposed,requestId:randomUUID()}),/target changed/);
});
test("index drift during private scanner staging removes owned copies and starts no scanner program", linux, async t => {
  const f=await repositoryShieldFixture(t,{clean:true,stagedIndex:true}),consume=f.service.useIndexInputs.bind(f.service);let calls=0;
  f.service.useIndexInputs=(c,id,action,paths,fn)=>consume(c,id,action,paths,async(report,bytes)=>{const result=await fn(report,bytes);if(++calls===3)await f.run("add","app.js");return result;});
  const review=await f.execution.review("personal",f.proposed),result=await f.execution.apply("personal",{requestId:f.proposed.requestId,token:review.confirmation.token});assert.notEqual(result.status,"completed");assert.ok(calls>=3);const state=await f.store.snapshot("personal");assert.equal(state.repositoryExecutions?.length??0,0);assert.equal(state.repositoryExecutionStaging.length,1);assert.equal(state.repositoryExecutionStaging[0].cleanupPending,false);await assert.rejects(access(state.repositoryExecutionStaging[0].path),{code:"ENOENT"});await assert.rejects(access(join(f.root,".switchyard-index")),{code:"ENOENT"});
});
test("private index byte injection refuses general execution, changed bytes and physical worktree substitution", linux, async t => {
  const f=await authorityFixture(t),path=".switchyard-index/app.js",bytes=Buffer.from("exact staged bytes"),input={path,sha256:sha(bytes),size:bytes.length,classification:"non-production"},state=join(f.stage,"stage-inputs");
  await mkdir(join(f.root,".switchyard-index"));await writeFile(join(f.root,path),"physical alias must never substitute");
  const mapping=new Map([[path,{bytes,mode:"100644"}]]),provider=new LinuxDisposableExecutionRootProvider(state,{indexBytes:mapping}),base={action:"shield_change_scan",repositoryRoot:f.root,isolation:"disposable",inputFiles:[input]};
  const lease=await provider.prepare(base);assert.deepEqual(await readFile(join(lease.root,path)),bytes);await lease.release();
  for(const action of ["run_target","pipeline_local_gate"])await assert.rejects(provider.prepare({...base,action}),/general execution/);
  for(const value of [{bytes:Buffer.from("different bytes!!!"),mode:"100644"},{bytes,mode:"120000"}])await assert.rejects(new LinuxDisposableExecutionRootProvider(state,{indexBytes:new Map([[path,value]])}).prepare(base),/changed before staging/);
  await assert.rejects(new LinuxDisposableExecutionRootProvider(state,{indexBytes:new Map([[path,{bytes,mode:"100644"}]])}).prepare({...base,inputFiles:[input,{...input,path:".switchyard-index/other.js"}]}),/substitution is refused/);
  assert.deepEqual(await readdir(join(state,"repository-execution-roots")),[]);assert.equal(await readFile(join(f.root,path),"utf8"),"physical alias must never substitute");
});
