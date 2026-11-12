import test from "node:test";
import assert from "node:assert/strict";
import { createHash, randomUUID } from "node:crypto";
import { mkdtemp, mkdir, readFile, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { scannerFixture } from "./test-support/shield-scanner-fixture.mjs";
import { shieldFixturePins } from "./repository-shield.mjs";
import { attestWindowsShield } from "./repository-windows-shield.mjs";
import { HostReceiptEvidenceFactory } from "../../apps/windows-companion/src/receipt-evidence.ts";
import { repositoryRuntimeExecutionRecipe } from "../../apps/windows-companion/src/repository-runtime-broker.ts";
import { targetSnapshotDigest } from "../../packages/control-plane/src/snapshot.ts";
const sha=b=>createHash("sha256").update(b).digest("hex");

async function fixture(t,action="shield_supply_chain"){
 const stateDirectory=await mkdtemp(join(tmpdir(),"sx-shield-evidence-")),operationId=randomUUID(),now=()=>Date.UTC(2026,10,4);t.after(()=>rm(stateDirectory,{recursive:true,force:true}));
 const material={repositoryRoot:stateDirectory,branch:"feature/scan",head:"1".repeat(40),indexTree:"2".repeat(40),trackedManifest:"tracked",untrackedManifest:"untracked",submodules:{},policyVersion:"synthetic-policy",environmentFingerprint:"environment",completeness:"complete",reasons:[]},target={...material,id:targetSnapshotDigest(material),capturedAt:new Date(now()).toISOString()},request={action,operationId,target,recipe:repositoryRuntimeExecutionRecipe(action,target)};
 const sample=scannerFixture({action,files:{"app.js":"-----BEGIN PRIVATE KEY-----","package-lock.json":JSON.stringify({lockfileVersion:3,packages:{"node_modules/example":{version:"1.0.0",license:"MIT"}}})},advisory:[{ecosystem:"npm",name:"example",version:"1.0.0",advisories:[{id:"GHSA-synthetic-only",severity:"high"}]}]}),report=await sample.scan();
 const fixtures=["scanner","advisory"].map(kind=>({id:sample.request[kind].id,kind,manifestSha256:"3".repeat(64),contentSha256:sample.request[kind].sha256,feedVersion:"synthetic-v1",toolName:"switchyard-baseline-scanner",toolVersion:"1",expiresAt:new Date(now()+3600000).toISOString()}));
 const review={action,operationId,scopeDigest:"a".repeat(64),manifestSha256:"b".repeat(64),catalogSha256:"c".repeat(64),executableIdentity:{helperSha256:"d".repeat(64),recipeRuntime:{sha256:"e".repeat(64)}},recipe:{maxOutputBytes:524288},shield:{engine:report.engine,engineSha256:sha(await readFile(new URL("./shield-scanner-engine.mjs",import.meta.url))),requestSha256:report.requestSha256,request:sample.request,feeds:shieldFixturePins(fixtures)}};
 const root=join(stateDirectory,"windows/personal/results",operationId,"sandbox-"+randomUUID());await mkdir(root,{recursive:true});const result={status:"completed",summary:"Explicit guest double",resultRoot:root,programExitCode:0,resultManifestSha256:"f".repeat(64),recipeCatalogSha256:review.catalogSha256,sandboxHelperSha256:review.executableIdentity.helperSha256,validatedOutputs:[]},native={operationId,action,scopeDigest:review.scopeDigest,nativeExitVerified:true,result};
 const input={store:{snapshot:async()=>({repositoryWindowsRuns:[native]})},compartment:"personal",stateDirectory,review,request,result,receiptEvidence:new HostReceiptEvidenceFactory({authenticationKey:Buffer.alloc(32,5),policyVersion:target.policyVersion,exactVersions:{suite:"synthetic"},clock:()=>new Date(now())}),resolveScannerFixtures:async()=>fixtures,guard:async()=>{},now};
 const write=async(text=JSON.stringify(report))=>{await writeFile(join(root,"process.stdout.txt"),text);result.validatedOutputs=[{path:"process.stdout.txt",size:Buffer.byteLength(text),sha256:sha(text)}];};await write();return{input,report,fixtures,native,result,root,write};
}
test("Windows Shield authenticates report and native manifest separately, including scoped CycloneDX data and fresh exact feed hashes",async t=>{
 for(const action of ["shield_change_scan","shield_supply_chain"]){const f=await fixture(t,action),r=await attestWindowsShield(f.input);assert.equal(r.status,"failed",JSON.stringify(r));assert.equal(r.data.receiptEvidenceEnvelope.outcome,"incomplete");assert.equal(r.data.receiptEvidenceEnvelope.evidence.resultSha256,sha(JSON.stringify(f.report)));assert.equal(r.data.receiptEvidenceEnvelope.evidence.toolVersions.guestResultManifest,"sha256:"+f.result.resultManifestSha256);assert.equal(r.data.shieldReport.requestSha256,f.input.review.shield.requestSha256);}
});
test("Windows Shield refuses substituted report scope, findings, sources, BOM, native ownership, feeds and authority even after zero exit",async t=>{
 for(const fault of ["extra-field","covered","source","finding","feed","scope","request","gaps","bom","exit","catalog","helper","changed-output","post-read-feed","final-guard"]){
  const f=await fixture(t);
  if(fault==="extra-field")f.report.approved=true;if(fault==="covered")f.report.coverage[0].status="covered";if(fault==="source")f.report.inventory[0].sha256="0".repeat(64);if(fault==="finding")f.report.findings[0].path="outside.txt";if(fault==="feed")f.report.scanner.id="other";if(fault==="scope")f.report.scope="whole-repository";if(fault==="request")f.report.requestSha256="0".repeat(64);if(fault==="gaps")f.report.gaps=[];if(fault==="bom")f.report.cycloneDx.compositions[0].aggregate="complete";await f.write();
  if(fault==="exit")f.native.nativeExitVerified=false;if(fault==="catalog")f.result.recipeCatalogSha256="0".repeat(64);if(fault==="helper")f.result.sandboxHelperSha256="0".repeat(64);if(fault==="changed-output")await writeFile(join(f.root,"process.stdout.txt"),"changed");
  if(fault==="post-read-feed"){let n=0;f.input.resolveScannerFixtures=async()=>{if(++n===2)throw Error("Synthetic revocation after report inspection");return f.fixtures;};}if(fault==="final-guard"){let n=0;f.input.guard=async()=>{if(++n===2)throw Error("Synthetic final authority revocation");};}
  const r=await attestWindowsShield(f.input);assert.equal(r.status,"incomplete",fault);assert.equal(r.data?.receiptEvidenceEnvelope,undefined,fault);
 }
});
