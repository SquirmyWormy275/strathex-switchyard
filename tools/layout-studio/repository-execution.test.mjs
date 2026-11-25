import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { readFile, access } from "node:fs/promises";
import { join } from "node:path";
import { executionFixture as fixture } from "./test-support/execution-fixture.mjs";
import { DurableBudgetManager } from "../../packages/control-plane/src/budgets.ts";
import { repositoryEffectJournal } from "./repository-effect-journal.mjs";
async function settled(f,id){const deadline=Date.now()+10000;let status;while(Date.now()<deadline){status=await f.execution.status("personal",id);if(status.nativeStatus==="settled"&&!status.stagingCleanupPending)return status;await new Promise(r=>setTimeout(r,20));}throw Error("Owned execution did not settle within its expected proof bound: "+JSON.stringify(status));}
test("reviewed execution uses separate action authority, approval, checkpoint, budget and duplicate receipt boundaries",async t=>{
  const f=await fixture(t),before=await f.run("rev-parse","HEAD");
  await f.store.update("personal","synthetic-explicit-host-observation",s=>{s.observations=[{id:"host-proof",status:"recording",sources:["host-action-events"],exclusions:[],events:[],updatedAt:f.now()}];});
  const review=await f.execution.review("personal",f.proposed);
  assert.equal(review.review.executionPolicy.network,"denied");assert.equal(review.review.executionPolicy.hostRepositoryWritten,false);
  for(const bad of [{...f.proposed,requestId:randomUUID(),command:"untrusted"},{...f.proposed,requestId:randomUUID(),manifestPath:"../outside"},{...f.proposed,requestId:randomUUID(),operationScopeDigest:"a".repeat(64)}])await assert.rejects(f.execution.review("personal",bad));
  await assert.rejects(f.execution.apply("personal",{requestId:f.proposed.requestId,token:randomUUID()}),/approval/);assert.equal(f.effects(),0);
  const input={requestId:f.proposed.requestId,token:review.confirmation.token},result=await f.execution.apply("personal",input);assert.equal(result.status,"running",JSON.stringify(result));assert.equal(result.providerTaskCompletionVerified,false);
  const status=await settled(f,f.proposed.requestId);assert.equal(status.nativeExitVerified,true);assert.equal(status.output,"synthetic program output");
  assert.equal(status.status,"settled");assert.equal(status.outcome.status,"running","terminal observation preserves the original admission result");
  const snapshot=await f.store.snapshot("personal"),row=snapshot.repositoryExecutionReviews[0];assert.ok(row.checkpoint);assert.equal(row.operationId,result.operationId);assert.equal(snapshot.repositoryExecutionJournal.some(e=>e.kind==="checkpoint.created"),true);
  const events=snapshot.observations[0].events;assert.equal(events[0].phase,"host-action-prepared");assert.ok(events.every(e=>e.intent==="run_target"&&e.provenance==="switchyard-local-host-action"&&e.taskCompletionVerified===false));assert.equal(JSON.stringify(events).includes(f.root),false);
  assert.equal((await f.execution.apply("personal",input)).replayed,true);assert.equal(f.effects(),1);assert.equal(await f.run("rev-parse","HEAD"),before);assert.equal(await readFile(join(f.root,"task.txt"),"utf8"),"reviewed\n");
  assert.deepEqual((await f.store.snapshot("personal")).observations[0].events,events);
  const stage=snapshot.repositoryExecutionStaging[0];assert.equal(stage.cleanupPending,false);await assert.rejects(access(stage.path),{code:"ENOENT"});
});
test("commit-only grants cannot authorize runs and changed inputs or revoked execution approvals cannot start programs",async t=>{
  const f=await fixture(t),commitInput={...f.grantInput,actions:["local_commit"]},review=await f.service.review("personal",commitInput),commit=await f.service.issue("personal",{...commitInput,token:review.confirmation.token});
  await assert.rejects(f.execution.review("personal",{...f.proposed,authorityId:commit.id}),/not.*allow|prohibited|action/i);
  const accepted=await f.execution.review("personal",f.proposed);await f.service.revoke("personal",f.grant.id);await assert.rejects(f.execution.apply("personal",{requestId:f.proposed.requestId,token:accepted.confirmation.token}),/revoked/);assert.equal(f.effects(),0);
});
test("workspace cancellation settles only verified stop facts and releases the budget without changing the original admission",async t=>{
  const f=await fixture(t,{hold:true}),review=await f.execution.review("personal",f.proposed),admission=await f.execution.apply("personal",{requestId:f.proposed.requestId,token:review.confirmation.token});assert.equal(admission.status,"running");
  assert.equal((await f.execution.stopCompartment("personal")).stopped,true);
  const status=await f.execution.status("personal",f.proposed.requestId);assert.equal(status.observedStatus,"cancelled");assert.equal(status.outcome.status,"running");assert.equal(status.nativeStatus,"outcome-unconfirmed");assert.equal(status.nativeExitVerified,true);assert.equal(status.programExitCode,null);
  const budgets=await new DurableBudgetManager(repositoryEffectJournal(f.store,"personal",{domain:"execution"})).list();assert.equal(budgets.some(c=>["claimed","running","cancelling","timed_out"].includes(c.state)),false);assert.equal(f.effects(),1);
});
test("a separately approved per-run stop reaches only its owned handle and retains a distinct duplicate receipt",async t=>{
  const f=await fixture(t,{hold:true}),review=await f.execution.review("personal",f.proposed),admission=await f.execution.apply("personal",{requestId:f.proposed.requestId,token:review.confirmation.token});assert.equal(admission.status,"running");
  const stopId=randomUUID(),stop=await f.execution.reviewStop("personal",{requestId:f.proposed.requestId,stopId}),input={stopId,token:stop.confirmation.token};
  const result=await f.execution.applyStop("personal",input);assert.equal(result.status,"completed",JSON.stringify(result));assert.equal(result.originalOperationId,admission.operationId);assert.equal(result.originalOutcomeUnchanged,true);
  assert.equal((await f.execution.applyStop("personal",input)).receiptId,result.receiptId);const status=await f.execution.status("personal",f.proposed.requestId);assert.equal(status.observedStatus,"cancelled");assert.equal(status.outcome.status,"running");assert.equal(status.programExitCode,null);assert.equal(status.nativeExitVerified,true);assert.equal(f.effects(),1);
  const next={...f.proposed,requestId:randomUUID()},nextReview=await f.execution.review("personal",next),nextRun=await f.execution.apply("personal",{requestId:next.requestId,token:nextReview.confirmation.token});assert.equal(nextRun.status,"running",JSON.stringify(nextRun));assert.notEqual(nextRun.operationId,admission.operationId);assert.equal(f.effects(),2);
  const original=await f.execution.apply("personal",{requestId:f.proposed.requestId,token:review.confirmation.token});assert.equal(original.replayed,true);assert.equal(original.operationId,admission.operationId);await f.execution.stopCompartment("personal");
});
test("actual Linux host broker connects reviewed task inputs, namespace and owned guardian without a live repository write",{skip:process.platform!=="linux"},async t=>{
  const f=await fixture(t,{native:true}),review=await f.execution.review("personal",f.proposed),before=await f.run("rev-parse","HEAD");
  const result=await f.execution.apply("personal",{requestId:f.proposed.requestId,token:review.confirmation.token});assert.equal(result.status,"running",JSON.stringify(result));
  const status=await settled(f,f.proposed.requestId);assert.equal(status.output,"exact reviewed run output",JSON.stringify(status));assert.equal(status.programExitCode,0);assert.equal(status.providerTaskCompletionVerified,false);assert.equal(await f.run("rev-parse","HEAD"),before);
});
