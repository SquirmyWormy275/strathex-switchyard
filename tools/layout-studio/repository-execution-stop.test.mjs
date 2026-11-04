import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { createSuiteStore } from "./suite-store.mjs";
import { createRepositoryExecutionStops } from "./repository-execution-stop.mjs";
import { repositoryEffectJournal } from "./repository-effect-journal.mjs";
import { ReceiptLedger } from "../../packages/control-plane/src/receipts.ts";
import { DurableBudgetManager } from "../../packages/control-plane/src/budgets.ts";

async function fixture(t) {
  const root = await mkdtemp(join(tmpdir(), "switchyard-exact-stop-")), keys = new Map();
  const store = createSuiteStore({ root, secrets: { get: async(c,p)=>keys.get(c+p), set: async(c,p,v)=>{keys.set(c+p,v);} } });
  await store.initialize("personal");
  const requestId=randomUUID(), operationId=randomUUID(), outcome={status:"running",operationId,providerTaskCompletionVerified:false};
  await store.update("personal","fixture",state=>{state.mode="personal-companion";state.repositoryExecutionReviews=[{requestId,operationId,sessionId:"exact-native-task",authorityId:randomUUID(),targetSnapshotId:"a".repeat(64),manifestSha256:"b".repeat(64),outcome}];state.repositoryExecutions=[{operationId,provider:"codex",supervisorId:`managed:${"c".repeat(64)}`,commandDigest:"d".repeat(64),ownedRuntime:{id:randomUUID()},stoppedVerified:false}];});
  let calls=0, live=true, knownExit=true, time=Date.now();
  const supervisors={canStop:async(c,id)=>c==="personal"&&id===operationId&&live,stopOperation:async(c,id)=>{assert.equal(c,"personal");assert.equal(id,operationId);const state=await store.snapshot(c),row=state.repositoryExecutionStops.at(-1);assert.equal(row.status,"executing");const claims=await new DurableBudgetManager(repositoryEffectJournal(store,c,{domain:"execution-stop"})).list();assert.equal(claims.some(claim=>claim.operationId===row.stopId&&claim.state==="running"),true);calls++;live=!knownExit;await store.update(c,"synthetic-native-exit",state=>{state.repositoryExecutions[0].stoppedVerified=knownExit;});return {accepted:knownExit};}};
  const create=()=>createRepositoryExecutionStops({store,supervisors,now:()=>time});
  const service=create();t.after(async()=>{await service.close();await rm(root,{recursive:true,force:true});});
  return {store,service,create,requestId,operationId,outcome,proposal:{requestId,stopId:randomUUID()},calls:()=>calls,live:value=>{live=value;},knownExit:value=>{knownExit=value;},advance:value=>{time+=value;}};
}
test("exact stop approval reserves a separate budget and receipt and duplicates cannot deliver another stop",async t=>{
  const f=await fixture(t);await assert.rejects(f.service.review("personal",{...f.proposal,pid:12345}),/process IDs/);const review=await f.service.review("personal",f.proposal);
  await assert.rejects(f.service.apply("personal",{stopId:f.proposal.stopId,token:randomUUID()}),/approval/);assert.equal(f.calls(),0);
  const input={stopId:f.proposal.stopId,token:review.confirmation.token},result=await f.service.apply("personal",input);assert.equal(result.status,"completed",JSON.stringify(result));assert.equal(result.originalOutcomeUnchanged,true);assert.equal(result.providerTaskCompletionVerified,false);assert.equal(f.calls(),1);
  assert.deepEqual((await f.store.snapshot("personal")).repositoryExecutionReviews[0].outcome,f.outcome);const receipts=await new ReceiptLedger(repositoryEffectJournal(f.store,"personal",{domain:"execution-stop"})).list();assert.equal(receipts.length,1);assert.equal(receipts[0].action,"stop_managed_run");
  const replay=await f.service.apply("personal",input);assert.equal(replay.replayed,true);assert.equal(replay.receiptId,result.receiptId);assert.equal(f.calls(),1);
});
test("changed workspace, expired approvals and lost exact handles cannot stop another process",async t=>{
  for(const change of ["workspace","expired","handle"]){const f=await fixture(t),review=await f.service.review("personal",f.proposal);if(change==="workspace")await f.store.update("personal","changed-workspace",state=>{state.taskAuthorityEpoch=1;});else if(change==="expired")f.advance(300001);else f.live(false);await assert.rejects(f.service.apply("personal",{stopId:f.proposal.stopId,token:review.confirmation.token}));assert.equal(f.calls(),0);}
});
test("a lost final stop write recovers only its protected receipt and independently verified exit without replay",async t=>{
  const f=await fixture(t),review=await f.service.review("personal",f.proposal),original=f.store.update;let fail=true;f.store.update=async(...args)=>{if(fail&&args[1]==="repository-execution-stop-result"){fail=false;throw Error("Synthetic lost stop result write");}return original(...args);};
  const input={stopId:f.proposal.stopId,token:review.confirmation.token};await assert.rejects(f.service.apply("personal",input),/lost stop result/);assert.equal(f.calls(),1);assert.equal((await f.service.apply("personal",input)).status,"incomplete");
  const restarted=f.create();await restarted.recover("personal");const recovered=await restarted.apply("personal",input);assert.equal(recovered.status,"completed");assert.equal(recovered.recoveredWithoutReplay,true);assert.equal(f.calls(),1);assert.deepEqual((await f.store.snapshot("personal")).repositoryExecutionReviews[0].outcome,f.outcome);await restarted.close();
});
test("unconfirmed stop exit retains its budget and later exit observation releases bookkeeping without a passing receipt",async t=>{
  const f=await fixture(t);f.knownExit(false);const review=await f.service.review("personal",f.proposal),input={stopId:f.proposal.stopId,token:review.confirmation.token},result=await f.service.apply("personal",input);assert.equal(result.status,"incomplete");assert.equal(result.stoppedVerified,false);assert.equal((await f.service.apply("personal",input)).replayed,true);assert.equal(f.calls(),1);
  const journal=repositoryEffectJournal(f.store,"personal",{domain:"execution-stop"}),budgets=new DurableBudgetManager(journal);assert.equal((await budgets.list()).some(c=>c.state==="running"),true);await f.service.recover("personal");assert.equal((await budgets.list()).some(c=>c.state==="running"),true);
  await f.store.update("personal","independent-later-exit",state=>{state.repositoryExecutions[0].stoppedVerified=true;});await f.service.recover("personal");const recovered=await f.service.apply("personal",input);assert.equal(recovered.status,"incomplete");assert.equal(recovered.recoveredWithoutReplay,true);assert.equal((await new ReceiptLedger(journal).list()).length,0);assert.equal((await budgets.list()).some(c=>["claimed","running","cancelling","timed_out"].includes(c.state)),false);assert.equal(f.calls(),1);
});
