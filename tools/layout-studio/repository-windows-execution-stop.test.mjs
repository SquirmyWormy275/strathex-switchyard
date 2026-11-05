import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { windowsStopScenarios } from "../../scripts/windows-scenario-groups.mjs";
import { windowsExecutionFixture as fixture } from "./test-support/windows-execution-fixture.mjs";

// The shared fixture opens no VM, account or keyboard.
test(windowsStopScenarios[0],async t=>{
 const f=await fixture(t);f.hold();const reviewed=await f.execution.review("personal",f.proposed),running=f.execution.apply("personal",{requestId:f.proposed.requestId,token:reviewed.confirmation.token});await f.entered;
 const before=(await f.store.snapshot("personal")).repositoryExecutionReviews[0].admission,stopId=randomUUID(),review=await f.execution.reviewStop("personal",{requestId:f.proposed.requestId,stopId});assert.equal(review.status,"requires-confirmation");assert.equal(review.budget.timeoutMs,120000);
 await assert.rejects(f.execution.applyStop("personal",{stopId,token:randomUUID()}),/approval/);assert.equal(f.stopRequests(),0);
 const applied={stopId,token:review.confirmation.token},stopped=await f.execution.applyStop("personal",applied),result=await running;assert.equal(stopped.status,"completed",JSON.stringify(stopped));assert.equal(stopped.stoppedVerified,true);assert.equal(stopped.originalAdmissionUnchanged,true);assert.equal(result.status,"cancelled");assert.notEqual(stopped.operationId,result.operationId);assert.notEqual(stopped.receiptId,result.receiptId);assert.equal(f.effects(),1);assert.equal(f.stopRequests(),1);
 assert.deepEqual((await f.store.snapshot("personal")).repositoryExecutionReviews[0].admission,before);assert.equal((await f.execution.applyStop("personal",applied)).replayed,true);assert.equal(f.stopRequests(),1);
 const other=f.create();assert.equal((await other.listStops("personal"))[0].result.receiptId,stopped.receiptId);assert.equal((await other.applyStop("personal",applied)).replayed,true);
});
test(windowsStopScenarios[1],async t=>{
 const f=await fixture(t);f.hold();const reviewed=await f.execution.review("personal",f.proposed),running=f.execution.apply("personal",{requestId:f.proposed.requestId,token:reviewed.confirmation.token});await f.entered;
 await assert.rejects(f.execution.reviewStop("personal",{requestId:f.proposed.requestId,stopId:randomUUID(),pid:42}));
 const stopId=randomUUID(),review=await f.execution.reviewStop("personal",{requestId:f.proposed.requestId,stopId}),original=f.store.update;let fail=true;f.store.update=async(...args)=>{if(fail&&args[1]==="repository-effect-journal"){fail=false;throw Error("Synthetic atomic stop admission loss");}return original(...args);};
 const input={stopId,token:review.confirmation.token},result=await f.execution.applyStop("personal",input);assert.equal(result.status,"incomplete");assert.equal(result.effectDisposition,"not_started");assert.equal(f.stopRequests(),0);assert.equal((await f.execution.applyStop("personal",input)).replayed,true);assert.equal(f.stopRequests(),0);
 await f.execution.stopCompartment("personal");assert.equal((await running).status,"cancelled");
});
test(windowsStopScenarios[2],async t=>{
 const f=await fixture(t);f.hold();const review=await f.execution.review("personal",f.proposed),running=f.execution.apply("personal",{requestId:f.proposed.requestId,token:review.confirmation.token});await f.entered;const stopId=randomUUID(),stop=await f.execution.reviewStop("personal",{requestId:f.proposed.requestId,stopId}),original=f.store.update;let fail=true;
 f.store.update=async(...args)=>{if(fail&&args[1]==="windows-stop-result"){fail=false;throw Error("Synthetic lost stop result");}return original(...args);};const request={stopId,token:stop.confirmation.token};await assert.rejects(f.execution.applyStop("personal",request),/lost stop result/);assert.equal((await running).status,"cancelled");assert.equal(f.stopRequests(),1);
 const other=f.create();await other.status("personal",f.proposed.requestId);const recovered=await other.applyStop("personal",request);assert.equal(recovered.status,"completed");assert.equal(recovered.recoveredWithoutReplay,true);assert.ok(recovered.receiptId);assert.equal(f.stopRequests(),1);assert.equal(f.effects(),1);
});
