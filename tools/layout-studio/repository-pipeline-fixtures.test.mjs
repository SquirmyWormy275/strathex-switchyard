import test from "node:test";
import assert from "node:assert/strict";
import {randomUUID} from "node:crypto";
import {writeFile} from "node:fs/promises";
import {join} from "node:path";
import {fixture} from "./test-support/repository-pipeline-fixture.mjs";
const linux={skip:process.platform!=="linux"};

test("real Linux pipeline evidence binds both operator-installed signed feeds without exposing their signing key to the namespace",linux,async t=>{
 for(const action of["pipeline_local_gate","pipeline_clean_reproduction"]){
  const f=await fixture(t,{action,signedFeeds:true}),head=await f.run("rev-parse","HEAD"),review=await f.execution.review("personal",f.proposed),input={requestId:f.proposed.requestId,token:review.confirmation.token};
  const result=await f.execution.apply("personal",input);assert.equal(result.status,"completed",JSON.stringify(result));assert.equal(result.providerTaskCompletionVerified,false);
  const evidence=result.data.receiptEvidenceEnvelope,verified=await f.fixtures.resolve("personal",{scannerFixtureIds:["synthetic-scanner"],advisoryFixtureIds:["synthetic-advisory"],observedAt:new Date()});
  assert.equal(verified.length,2);for(const feed of verified)assert.equal(evidence.evidence.toolVersions[`fixture:${feed.kind}:${feed.id}`],`manifest=sha256:${feed.manifestSha256};content=sha256:${feed.contentSha256};feed=${feed.feedVersion};tool=${feed.toolName}@${feed.toolVersion}`);assert.equal(evidence.completeness,"complete");
  assert.equal((await f.execution.apply("personal",input)).receiptId,result.receiptId);
  const status=await f.execution.status("personal",f.proposed.requestId);assert.equal(status.nativeExitVerified,true);assert.equal(status.stagingCleanupPending,false);assert.equal(await f.run("rev-parse","HEAD"),head);
 }
});
test("revoked or changed signed feeds keep a completed isolated program incomplete without manufacturing passing pipeline evidence",linux,async t=>{
 for(const fault of["revoked","changed"]){
  const f=await fixture(t,{signedFeeds:true});
  if(fault==="changed")await writeFile(join(f.fixtureDirectory,"personal/scanner-fixtures/synthetic-scanner/content.bin"),"changed fixture bytes");
  else{const review=await f.fixtures.review("personal",{requestId:randomUUID(),action:"revoke-fixture",fixtureId:"synthetic-scanner",reason:"Synthetic withdrawal before pipeline"});assert.equal((await f.fixtures.apply("personal",{requestId:review.review.requestId,token:review.confirmation.token})).status,"completed");}
  const review=await f.execution.review("personal",f.proposed),input={requestId:f.proposed.requestId,token:review.confirmation.token},result=await f.execution.apply("personal",input);
  assert.equal(result.status,"incomplete",JSON.stringify(result));assert.equal(result.effectDisposition,"committed");assert.equal(result.providerTaskCompletionVerified,false);
  const state=await f.store.snapshot("personal");assert.equal(state.repositoryExecutionJournal.some(e=>e.kind==="receipt.issued"&&e.payload.receipt.result==="passed"),false);assert.equal((await f.execution.status("personal",f.proposed.requestId)).nativeExitVerified,true);
 }
});
