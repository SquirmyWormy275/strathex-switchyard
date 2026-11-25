import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { windowsExecutionFixture as fixture } from "./test-support/windows-execution-fixture.mjs";

// The shared fixture opens no VM, account or keyboard.
test("workspace shutdown cancels an admitted Windows operation and reconciles its budget without another program",async t=>{
 const f=await fixture(t);f.hold();const review=await f.execution.review("personal",f.proposed),running=f.execution.apply("personal",{requestId:f.proposed.requestId,token:review.confirmation.token});await f.entered;
 assert.equal((await f.execution.stopCompartment("personal")).stopped,true);const result=await running;assert.equal(result.status,"cancelled",JSON.stringify(result));assert.equal(f.effects(),1);const status=await f.execution.status("personal",f.proposed.requestId);assert.equal(status.nativeExitVerified,true);assert.equal(status.outcome.status,"cancelled");
});
test("a restarted Studio adapter recovers only exact Windows exit/results and never reruns a settled request",async t=>{
 const f=await fixture(t),review=await f.execution.review("personal",f.proposed),request={requestId:f.proposed.requestId,token:review.confirmation.token};assert.equal((await f.execution.apply("personal",request)).status,"completed");const other=f.create();assert.equal((await other.status("personal",f.proposed.requestId)).outcome.status,"completed");assert.equal((await other.apply("personal",request)).replayed,true);assert.equal(f.effects(),1);
});
test("accepted cancellation without independent exit stays incomplete and later exit cannot upgrade it without a recorded receipt",async t=>{
 const f=await fixture(t);f.hold();const review=await f.execution.review("personal",f.proposed),running=f.execution.apply("personal",{requestId:f.proposed.requestId,token:review.confirmation.token});await f.entered;const stopId=randomUUID(),stop=await f.execution.reviewStop("personal",{requestId:f.proposed.requestId,stopId});f.onStop(async()=>{f.advance(121000);return{accepted:true,stopped:false};});
 const request={stopId,token:stop.confirmation.token},result=await f.execution.applyStop("personal",request);assert.equal(result.status,"incomplete");assert.equal(result.stoppedVerified,false);assert.equal(f.stopRequests(),1);
 await f.execution.stopCompartment("personal");assert.equal((await running).status,"cancelled");await f.execution.status("personal",f.proposed.requestId);const recovered=await f.execution.applyStop("personal",request);assert.equal(recovered.status,"incomplete");assert.equal(recovered.stoppedVerified,true);assert.equal(recovered.recoveredWithoutReplay,true);assert.equal(recovered.receiptId,undefined);assert.equal(f.stopRequests(),1);assert.equal(f.effects(),1);
});
