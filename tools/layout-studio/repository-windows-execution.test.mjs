import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { windowsExecutionFixture as fixture } from "./test-support/windows-execution-fixture.mjs";

// The shared fixture opens no VM, account or keyboard.
test("Studio Windows admission uses the exact task grant, one-use review, checkpoint, budget and protected terminal receipt",async t=>{
 const f=await fixture(t),head=await f.run("rev-parse","HEAD");
 await f.store.update("personal","synthetic-explicit-host-observation",s=>{s.observations=[{id:"host-proof",status:"recording",sources:["host-action-events"],exclusions:[],events:[],updatedAt:f.now()}];});
 const review=await f.execution.review("personal",f.proposed);assert.equal(review.review.engine,"windows-sandbox");assert.equal(review.review.executionPolicy.temporaryBytes,67108864);
 await assert.rejects(f.execution.apply("personal",{requestId:f.proposed.requestId,token:randomUUID()}),/approval/);assert.equal(f.effects(),0);
 const request={requestId:f.proposed.requestId,token:review.confirmation.token},result=await f.execution.apply("personal",request);assert.equal(result.status,"completed",JSON.stringify(result));assert.equal(result.providerTaskCompletionVerified,false);assert.equal(result.nativePermissionsChanged,false);assert.equal(f.effects(),1);
 const status=await f.execution.status("personal",f.proposed.requestId);assert.equal(status.nativeExitVerified,true);assert.equal(status.stagingCleanupPending,false);assert.equal(status.outcome.status,"completed");assert.equal((await f.execution.apply("personal",request)).replayed,true);assert.equal(f.effects(),1);
 const events=(await f.store.snapshot("personal")).observations[0].events;assert.deepEqual(events.map(e=>[e.phase,e.status]),[["host-action-prepared","prepared"],["host-action-result-recorded","completed"]]);assert.ok(events.every(e=>e.intent==="run_target"&&e.provenance==="switchyard-local-host-action"&&e.taskCompletionVerified===false));assert.equal(JSON.stringify(events).includes(f.root),false);
 assert.equal(await f.run("rev-parse","HEAD"),head);assert.equal(await readFile(join(f.root,"task.txt"),"utf8"),"reviewed\n");
});
test("shell fields, absent file ownership, changed inputs and replacement prerequisites cannot reach Windows startup",async t=>{
 const f=await fixture(t);await assert.rejects(f.execution.review("personal",{...f.proposed,command:"injected"}));await assert.rejects(f.execution.review("personal",{...f.proposed,requestId:randomUUID(),manifestPath:"../outside"}));
 const review=await f.execution.review("personal",f.proposed);f.prerequisites.helperSha256="d".repeat(64);await assert.rejects(f.execution.apply("personal",{requestId:f.proposed.requestId,token:review.confirmation.token}),/prerequisite changed/);assert.equal(f.effects(),0);
 f.prerequisites.helperSha256="c".repeat(64);await writeFile(join(f.root,"program.mjs"),"changed after review");await assert.rejects(f.execution.apply("personal",{requestId:f.proposed.requestId,token:review.confirmation.token}));assert.equal(f.effects(),0);
});
test("a commit-only or revoked task grant cannot authorize Windows Run",async t=>{
 const f=await fixture(t),commitInput={...f.grantInput,actions:["local_commit"]},reviewed=await f.service.review("personal",commitInput),commit=await f.service.issue("personal",{...commitInput,token:reviewed.confirmation.token});
 await assert.rejects(f.execution.review("personal",{...f.proposed,authorityId:commit.id}));const review=await f.execution.review("personal",f.proposed);await f.service.revoke("personal",f.grant.id);await assert.rejects(f.execution.apply("personal",{requestId:f.proposed.requestId,token:review.confirmation.token}));assert.equal(f.effects(),0);
});
test("a failed protected checkpoint write starts no Windows program and cannot replay its consumed admission",async t=>{
 const f=await fixture(t),review=await f.execution.review("personal",f.proposed),original=f.store.update;f.store.update=async(...args)=>{if(args[1]==="windows-execution-checkpoint")throw Error("Synthetic checkpoint write loss");return original(...args);};
 const request={requestId:f.proposed.requestId,token:review.confirmation.token},result=await f.execution.apply("personal",request);assert.notEqual(result.status,"completed");assert.equal(f.effects(),0);assert.equal((await f.execution.apply("personal",request)).replayed,true);assert.equal(f.effects(),0);
});
