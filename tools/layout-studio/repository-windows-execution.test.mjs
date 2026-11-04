import test from "node:test";
import assert from "node:assert/strict";
import { createHash, randomUUID } from "node:crypto";
import { writeFile, readFile } from "node:fs/promises";
import { join } from "node:path";
import { authorityFixture } from "./test-support/task-authority-fixture.mjs";
import { createRepositoryExecution } from "./repository-execution.mjs";
import { scopeHash } from "./confirmations.mjs";
const sha = value => createHash("sha256").update(value).digest("hex");

// The policy, task grant, Git inspection, encrypted ledgers and input reads are
// real. The Windows runner is an explicit double; no VM or account is opened.
async function fixture(t) {
  const f = await authorityFixture(t, { executionActions: ["run_target"] }), prerequisites = { helperSha256: "c".repeat(64), recipeRuntime: { path: "C:\\owned\\node.exe", sha256: "b".repeat(64) }, nodeVersion: "24.14.0" };
  const program = Buffer.from("process.stdout.write('synthetic Windows recipe')"), catalog = Buffer.from(JSON.stringify({ schema: "sxsy-b122.windows-sandbox-catalog", version: 1, recipes: [{ id: "run_target", executable: "C:\\B122\\tools\\node.exe", executableSha256: prerequisites.recipeRuntime.sha256, arguments: ["{INPUT_ROOT}\\program.mjs"], workingRoot: "work", workingDirectory: ".", environment: {}, timeoutMs: 5000, maxOutputBytes: 4096, artifacts: [] }] }));
  const input = (path, bytes) => ({ path, sha256: sha(bytes), size: bytes.length, classification: "non-production" });
  const bytes = Buffer.from(JSON.stringify({ schema: "switchyard-windows-reviewed-run/v1", version: 1, recipeId: "run_target", catalogPath: "guest.json", catalogSha256: sha(catalog), inputFiles: [input("program.mjs", program), input("guest.json", catalog)] }));
  for (const [path, body] of [["run.json",bytes],["guest.json",catalog],["program.mjs",program]]) await writeFile(join(f.root,path),body);
  const grantInput = { ...f.proposed, paths: ["task.txt", "run.json", "guest.json", "program.mjs"], classifications: { includedUntracked: ["run.json", "guest.json", "program.mjs"] }, actions: ["run_target"] }, approved = await f.service.review("personal",grantInput), grant = await f.service.issue("personal",{...grantInput,token:approved.confirmation.token});
  let stopHook=async()=>undefined;let stopRequests=0;let effects=0,hold=false,backendStatus="completed",entered;const waiting=new Map(),entry=new Promise(resolve=>{entered=resolve;});
  const runner = {
    prerequisites:async()=>structuredClone(prerequisites),recover:async()=>({cleaned:true}),list:async c=>(await f.store.snapshot(c)).repositoryWindowsRuns??[],
    run:async(c,context,plan,guard,signal)=>{
      await guard();const state=await f.store.snapshot(c),review=state.repositoryExecutionReviews.find(row=>row.operationId===context.operationId);
      assert.equal(review.checkpoint.digest,scopeHash(review.checkpoint.payload));assert.equal(review.engine,"windows-sandbox");assert.equal(review.scopeDigest,context.scopeDigest);assert.equal(context.provider,"codex");assert.equal(plan.manifestSha256,sha(bytes));assert.ok(state.repositoryExecutionJournal.some(event=>event.kind==="checkpoint.created"));effects++;
      await f.store.update(c,"synthetic-Windows-native-ready",state=>{(state.repositoryWindowsRuns??=[]).push({schema:"switchyard-windows-reviewed-runner/v1",...context,planDigest:scopeHash(plan),status:"executing",cleanupPending:true});});entered();
      let cancelled=false;if(hold)await new Promise(resolve=>{waiting.set(context.operationId,()=>{cancelled=true;resolve();});signal.addEventListener("abort",()=>{cancelled=true;resolve();},{once:true});if(signal.aborted){cancelled=true;resolve();}});waiting.delete(context.operationId);
      const result={status:cancelled?"cancelled":backendStatus,summary:"Synthetic Windows backend result",receiptPath:join(f.stage,"synthetic-windows-receipt.json")};
      await f.store.update(c,"synthetic-Windows-native-result",state=>{const row=state.repositoryWindowsRuns.find(row=>row.operationId===context.operationId);row.status="settled";row.cleanupPending=false;row.nativeExitVerified=true;row.result=result;row.backendObservation=result;});return result;
    },
    stopOperation:async(_c,id)=>{stopRequests++;const override=await stopHook(id);if(override)return override;const wake=waiting.get(id);wake?.();return{accepted:Boolean(wake),stopped:Boolean(wake)};},
    stopCompartment:async()=>{for(const wake of waiting.values())wake();return{stopped:true,cleaned:true};},close:async()=>{for(const wake of waiting.values())wake();}
  };
  const services=[];const create=()=>{const execution=createRepositoryExecution({store:f.store,authority:f.service,stateDirectory:join(f.stage,"execution"),platform:"win32",windowsRunner:runner,isActive:async()=>true,now:f.now});services.push(execution);return execution;};
  f.onCleanup(async()=>{for(const execution of services)await execution.close();});const execution=create(),proposed={requestId:randomUUID(),authorityId:grant.id,manifestPath:"run.json",manifestSha256:sha(bytes),action:"run_target"};
  return {backendStatus:value=>{backendStatus=value;},onStop:fn=>{stopHook=fn;},stopRequests:()=>stopRequests,...f,execution,create,proposed,grant,grantInput,prerequisites,effects:()=>effects,hold:()=>{hold=true;},entered:entry};
}
test("Studio Windows admission uses the exact task grant, one-use review, checkpoint, budget and protected terminal receipt",async t=>{
 const f=await fixture(t),head=await f.run("rev-parse","HEAD"),review=await f.execution.review("personal",f.proposed);assert.equal(review.review.engine,"windows-sandbox");assert.equal(review.review.executionPolicy.temporaryBytes,67108864);
 await assert.rejects(f.execution.apply("personal",{requestId:f.proposed.requestId,token:randomUUID()}),/approval/);assert.equal(f.effects(),0);
 const request={requestId:f.proposed.requestId,token:review.confirmation.token},result=await f.execution.apply("personal",request);assert.equal(result.status,"completed",JSON.stringify(result));assert.equal(result.providerTaskCompletionVerified,false);assert.equal(result.nativePermissionsChanged,false);assert.equal(f.effects(),1);
 const status=await f.execution.status("personal",f.proposed.requestId);assert.equal(status.nativeExitVerified,true);assert.equal(status.stagingCleanupPending,false);assert.equal(status.outcome.status,"completed");assert.equal((await f.execution.apply("personal",request)).replayed,true);assert.equal(f.effects(),1);
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
test("workspace shutdown cancels an admitted Windows operation and reconciles its budget without another program",async t=>{
 const f=await fixture(t);f.hold();const review=await f.execution.review("personal",f.proposed),running=f.execution.apply("personal",{requestId:f.proposed.requestId,token:review.confirmation.token});await f.entered;
 assert.equal((await f.execution.stopCompartment("personal")).stopped,true);const result=await running;assert.equal(result.status,"cancelled",JSON.stringify(result));assert.equal(f.effects(),1);const status=await f.execution.status("personal",f.proposed.requestId);assert.equal(status.nativeExitVerified,true);assert.equal(status.outcome.status,"cancelled");
});
test("a restarted Studio adapter recovers only exact Windows exit/results and never reruns a settled request",async t=>{
 const f=await fixture(t),review=await f.execution.review("personal",f.proposed),request={requestId:f.proposed.requestId,token:review.confirmation.token};assert.equal((await f.execution.apply("personal",request)).status,"completed");const other=f.create();assert.equal((await other.status("personal",f.proposed.requestId)).outcome.status,"completed");assert.equal((await other.apply("personal",request)).replayed,true);assert.equal(f.effects(),1);
});

test("a separately approved Windows stop has its own operation, budget and receipt while preserving the original admission",async t=>{
 const f=await fixture(t);f.hold();const reviewed=await f.execution.review("personal",f.proposed),running=f.execution.apply("personal",{requestId:f.proposed.requestId,token:reviewed.confirmation.token});await f.entered;
 const before=(await f.store.snapshot("personal")).repositoryExecutionReviews[0].admission,stopId=randomUUID(),review=await f.execution.reviewStop("personal",{requestId:f.proposed.requestId,stopId});assert.equal(review.status,"requires-confirmation");assert.equal(review.budget.timeoutMs,120000);
 await assert.rejects(f.execution.applyStop("personal",{stopId,token:randomUUID()}),/approval/);assert.equal(f.stopRequests(),0);
 const applied={stopId,token:review.confirmation.token},stopped=await f.execution.applyStop("personal",applied),result=await running;assert.equal(stopped.status,"completed",JSON.stringify(stopped));assert.equal(stopped.stoppedVerified,true);assert.equal(stopped.originalAdmissionUnchanged,true);assert.equal(result.status,"cancelled");assert.notEqual(stopped.operationId,result.operationId);assert.notEqual(stopped.receiptId,result.receiptId);assert.equal(f.effects(),1);assert.equal(f.stopRequests(),1);
 assert.deepEqual((await f.store.snapshot("personal")).repositoryExecutionReviews[0].admission,before);assert.equal((await f.execution.applyStop("personal",applied)).replayed,true);assert.equal(f.stopRequests(),1);
 const other=f.create();assert.equal((await other.listStops("personal"))[0].result.receiptId,stopped.receiptId);assert.equal((await other.applyStop("personal",applied)).replayed,true);
});
test("a failed atomic Windows stop admission sends no cancellation and cannot reuse its consumed approval",async t=>{
 const f=await fixture(t);f.hold();const reviewed=await f.execution.review("personal",f.proposed),running=f.execution.apply("personal",{requestId:f.proposed.requestId,token:reviewed.confirmation.token});await f.entered;
 await assert.rejects(f.execution.reviewStop("personal",{requestId:f.proposed.requestId,stopId:randomUUID(),pid:42}));
 const stopId=randomUUID(),review=await f.execution.reviewStop("personal",{requestId:f.proposed.requestId,stopId}),original=f.store.update;let fail=true;f.store.update=async(...args)=>{if(fail&&args[1]==="repository-effect-journal"){fail=false;throw Error("Synthetic atomic stop admission loss");}return original(...args);};
 const input={stopId,token:review.confirmation.token},result=await f.execution.applyStop("personal",input);assert.equal(result.status,"incomplete");assert.equal(result.effectDisposition,"not_started");assert.equal(f.stopRequests(),0);assert.equal((await f.execution.applyStop("personal",input)).replayed,true);assert.equal(f.stopRequests(),0);
 await f.execution.stopCompartment("personal");assert.equal((await running).status,"cancelled");
});

test("a lost final Windows stop write recovers only its existing protected receipt and exact exit without another cancellation",async t=>{
 const f=await fixture(t);f.hold();const review=await f.execution.review("personal",f.proposed),running=f.execution.apply("personal",{requestId:f.proposed.requestId,token:review.confirmation.token});await f.entered;const stopId=randomUUID(),stop=await f.execution.reviewStop("personal",{requestId:f.proposed.requestId,stopId}),original=f.store.update;let fail=true;
 f.store.update=async(...args)=>{if(fail&&args[1]==="windows-stop-result"){fail=false;throw Error("Synthetic lost stop result");}return original(...args);};const request={stopId,token:stop.confirmation.token};await assert.rejects(f.execution.applyStop("personal",request),/lost stop result/);assert.equal((await running).status,"cancelled");assert.equal(f.stopRequests(),1);
 const other=f.create();await other.status("personal",f.proposed.requestId);const recovered=await other.applyStop("personal",request);assert.equal(recovered.status,"completed");assert.equal(recovered.recoveredWithoutReplay,true);assert.ok(recovered.receiptId);assert.equal(f.stopRequests(),1);assert.equal(f.effects(),1);
});
test("accepted cancellation without independent exit stays incomplete and later exit cannot upgrade it without a recorded receipt",async t=>{
 const f=await fixture(t);f.hold();const review=await f.execution.review("personal",f.proposed),running=f.execution.apply("personal",{requestId:f.proposed.requestId,token:review.confirmation.token});await f.entered;const stopId=randomUUID(),stop=await f.execution.reviewStop("personal",{requestId:f.proposed.requestId,stopId});f.onStop(async()=>{f.advance(121000);return{accepted:true,stopped:false};});
 const request={stopId,token:stop.confirmation.token},result=await f.execution.applyStop("personal",request);assert.equal(result.status,"incomplete");assert.equal(result.stoppedVerified,false);assert.equal(f.stopRequests(),1);
 await f.execution.stopCompartment("personal");assert.equal((await running).status,"cancelled");await f.execution.status("personal",f.proposed.requestId);const recovered=await f.execution.applyStop("personal",request);assert.equal(recovered.status,"incomplete");assert.equal(recovered.stoppedVerified,true);assert.equal(recovered.recoveredWithoutReplay,true);assert.equal(recovered.receiptId,undefined);assert.equal(f.stopRequests(),1);assert.equal(f.effects(),1);
});

test("an unavailable guest preflight remains a no-program outcome instead of claiming a committed Windows task",async t=>{
 const f=await fixture(t);f.backendStatus("unavailable");const reviewed=await f.execution.review("personal",f.proposed),result=await f.execution.apply("personal",{requestId:f.proposed.requestId,token:reviewed.confirmation.token});assert.equal(result.status,"unavailable");assert.equal(result.effectDisposition,"not_started");assert.equal(result.providerTaskCompletionVerified,false);
});
