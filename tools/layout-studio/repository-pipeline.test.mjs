import test from "node:test";
import assert from "node:assert/strict";
import {randomUUID} from "node:crypto";
import {writeFile,readFile,access} from "node:fs/promises";
import {join} from "node:path";
import {fixture,awaitNativeReady} from "./test-support/repository-pipeline-fixture.mjs";
import {runtimeGuardianStopped} from "./runtime-command.mjs";
import {DurableBudgetManager} from "../../packages/control-plane/src/budgets.ts";
import {repositoryEffectJournal} from "./repository-effect-journal.mjs";
const linux={skip:process.platform!=="linux"};


test("both connected pipeline actions run actual isolated inputs and earn exact authenticated receipts without changing a provider task",linux,async t=>{
 for(const action of ["pipeline_local_gate","pipeline_clean_reproduction"]){
  const f=await fixture(t,{action}),head=await f.run("rev-parse","HEAD"),review=await f.execution.review("personal",f.proposed),request={requestId:f.proposed.requestId,token:review.confirmation.token};
  assert.equal(review.review.action,action);assert.equal(review.budget.maxAttempts,1);const result=await f.execution.apply("personal",request);assert.equal(result.status,"completed",JSON.stringify(result));assert.equal(result.effectDisposition,"committed");assert.equal(result.providerTaskCompletionVerified,false);assert.ok(result.receiptId);assert.equal(result.data.receiptEvidenceEnvelope.action,action);assert.equal(result.data.receiptEvidenceEnvelope.targetSnapshotId,review.review.targetSnapshotId);assert.equal(result.data.receiptEvidenceEnvelope.completeness,"complete");
  const status=await f.execution.status("personal",f.proposed.requestId);assert.equal(status.programExitCode,0);assert.equal(status.nativeExitVerified,true);assert.equal(status.stagingCleanupPending,false);assert.equal((await f.execution.apply("personal",request)).receiptId,result.receiptId);
  const state=await f.store.snapshot("personal");assert.equal(state.repositoryExecutions.length,1);assert.equal(await runtimeGuardianStopped(state.repositoryExecutions[0].ownedRuntime),true);assert.equal(state.repositoryExecutionJournal.some(e=>e.kind==="receipt.issued"),true);assert.equal(state.repositoryExecutionStaging[0].cleanupPending,false);await assert.rejects(access(state.repositoryExecutionStaging[0].path));
  assert.equal(await readFile(join(f.root,"input.txt"),"utf8"),"reviewed non-production input");assert.equal(await f.run("rev-parse","HEAD"),head);
 }
});

test("zero exit without complete typed coverage stays incomplete and retains the fact that the isolated program ran",linux,async t=>{
 for(const report of ["malformed","unavailable"]){const f=await fixture(t,{report}),review=await f.execution.review("personal",f.proposed),request={requestId:f.proposed.requestId,token:review.confirmation.token},result=await f.execution.apply("personal",request);
  assert.equal(result.status,"incomplete",JSON.stringify(result));assert.equal(result.effectDisposition,"committed");assert.equal(result.providerTaskCompletionVerified,false);if(report==="unavailable")assert.equal(result.data.receiptEvidenceEnvelope.completeness,"incomplete");
  const state=await f.store.snapshot("personal"),receipts=state.repositoryExecutionJournal.filter(e=>e.kind==="receipt.issued");assert.equal(receipts.length,report==="unavailable"?1:0);assert.equal(receipts.some(e=>e.payload.receipt.result==="passed"),false);assert.equal((await f.execution.apply("personal",request)).replayed,true);assert.equal((await f.execution.status("personal",f.proposed.requestId)).nativeExitVerified,true);assert.equal(state.repositoryExecutions.length,1);
 }
});

test("exact pipeline action grants, source witnesses and protected receipt keys cannot be substituted",linux,async t=>{
 const f=await fixture(t);await assert.rejects(f.execution.review("personal",{...f.proposed,action:"pipeline_clean_reproduction"}),/allow|prohibited|action/);
 await f.store.credential("personal","pipeline-receipt-key","corrupted",{provider:"codex"});await assert.rejects(f.execution.review("personal",f.proposed),/receipt key/);assert.equal((await f.store.snapshot("personal")).repositoryExecutions?.length??0,0);
 await f.store.credential("personal","pipeline-receipt-key",Buffer.alloc(32,7).toString("base64"),{provider:"codex"});const review=await f.execution.review("personal",f.proposed);await writeFile(join(f.root,"input.txt"),"changed after review");await assert.rejects(f.execution.apply("personal",{requestId:f.proposed.requestId,token:review.confirmation.token}));assert.equal((await f.store.snapshot("personal")).repositoryExecutions?.length??0,0);
});

test("workspace cancellation stops the actual foreground pipeline and settles its existing budget without replay",linux,async t=>{
 const f=await fixture(t,{hold:true}),review=await f.execution.review("personal",f.proposed),request={requestId:f.proposed.requestId,token:review.confirmation.token},running=f.execution.apply("personal",request);
 await awaitNativeReady(f,running);
 assert.equal((await f.execution.stopCompartment("personal")).stopped,true);const result=await running;assert.notEqual(result.status,"completed");const status=await f.execution.status("personal",f.proposed.requestId);assert.equal(status.nativeExitVerified,true);assert.equal(status.stagingCleanupPending,false);assert.equal((await f.execution.apply("personal",request)).replayed,true);
 const budgets=await new DurableBudgetManager(repositoryEffectJournal(f.store,"personal",{domain:"execution"})).list();assert.equal(budgets.some(claim=>["claimed","running","cancelling","timed_out"].includes(claim.state)),false);assert.equal((await f.store.snapshot("personal")).repositoryExecutions.length,1);
});

test("a separately approved exact stop cancels a live pipeline before its response, with immutable admission and a distinct receipt",linux,async t=>{
 const f=await fixture(t,{hold:true}),review=await f.execution.review("personal",f.proposed),request={requestId:f.proposed.requestId,token:review.confirmation.token},running=f.execution.apply("personal",request);
 await awaitNativeReady(f,running);
 const original=(await f.store.snapshot("personal")).repositoryExecutionReviews[0];assert.ok(original.admission);assert.equal(original.outcome,undefined);
 const stopId=randomUUID(),stop=await f.execution.reviewStop("personal",{requestId:f.proposed.requestId,stopId}),stopInput={stopId,token:stop.confirmation.token};const stopped=await f.execution.applyStop("personal",stopInput);assert.equal(stopped.status,"completed",JSON.stringify(stopped));assert.equal(stopped.originalOperationId,original.operationId);assert.notEqual(stopped.operationId,original.operationId);assert.ok(stopped.receiptId);
 const result=await running;assert.notEqual(result.status,"completed");assert.equal((await f.execution.applyStop("personal",stopInput)).receiptId,stopped.receiptId);assert.equal((await f.execution.apply("personal",request)).replayed,true);
 const state=await f.store.snapshot("personal");assert.deepEqual(state.repositoryExecutionReviews[0].admission,original.admission);assert.equal(state.repositoryExecutions.length,1);assert.equal(state.repositoryExecutions[0].stoppedVerified,true);assert.equal(state.repositoryExecutionStaging[0].cleanupPending,false);
});
