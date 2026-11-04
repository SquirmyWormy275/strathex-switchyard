import assert from "node:assert/strict";
import { createHash, randomUUID } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { authorityFixture } from "./task-authority-fixture.mjs";
import { createRepositoryExecution } from "../repository-execution.mjs";
import { scopeHash } from "../confirmations.mjs";
const sha = value => createHash("sha256").update(value).digest("hex");

// Real task/Git/crypto/kernel boundaries; the Windows guest runner is doubled.
export async function windowsExecutionFixture(t) {
  const f = await authorityFixture(t, { executionActions: ["run_target"] }), prerequisites = { helperSha256: "c".repeat(64), recipeRuntime: { path: "C:\\owned\\node.exe", sha256: "b".repeat(64) }, nodeVersion: "24.14.0" };
  const program = Buffer.from("process.stdout.write('synthetic Windows recipe')"), catalog = Buffer.from(JSON.stringify({ schema: "sxsy-b122.windows-sandbox-catalog", version: 1, recipes: [{ id: "run_target", executable: "C:\\B122\\tools\\node.exe", executableSha256: prerequisites.recipeRuntime.sha256, arguments: ["{INPUT_ROOT}\\program.mjs"], workingRoot: "work", workingDirectory: ".", environment: {}, timeoutMs: 5000, maxOutputBytes: 4096, artifacts: [] }] }));
  const input = (path, bytes) => ({ path, sha256: sha(bytes), size: bytes.length, classification: "non-production" });
  const bytes = Buffer.from(JSON.stringify({ schema: "switchyard-windows-reviewed-run/v1", version: 1, recipeId: "run_target", catalogPath: "guest.json", catalogSha256: sha(catalog), inputFiles: [input("program.mjs", program), input("guest.json", catalog)] }));
  for (const [path, body] of [["run.json",bytes],["guest.json",catalog],["program.mjs",program]]) await writeFile(join(f.root,path),body);
  const grantInput = { ...f.proposed, paths: ["task.txt", "run.json", "guest.json", "program.mjs"], classifications: { includedUntracked: ["run.json", "guest.json", "program.mjs"] }, actions: ["run_target"] }, approved = await f.service.review("personal",grantInput), grant = await f.service.issue("personal",{...grantInput,token:approved.confirmation.token});
  let stopHook=async()=>undefined;let stopRequests=0;let effects=0,hold=false,artifacts=false,backendStatus="completed",entered;const waiting=new Map(),entry=new Promise(resolve=>{entered=resolve;});
  const runner = {
    prerequisites:async()=>structuredClone(prerequisites),recover:async()=>({cleaned:true}),list:async c=>(await f.store.snapshot(c)).repositoryWindowsRuns??[],
    run:async(c,context,plan,guard,signal)=>{
      await guard();const state=await f.store.snapshot(c),review=state.repositoryExecutionReviews.find(row=>row.operationId===context.operationId);
      assert.equal(review.checkpoint.digest,scopeHash(review.checkpoint.payload));assert.equal(review.engine,"windows-sandbox");assert.equal(review.scopeDigest,context.scopeDigest);assert.equal(context.provider,"codex");assert.equal(plan.manifestSha256,sha(bytes));assert.ok(state.repositoryExecutionJournal.some(event=>event.kind==="checkpoint.created"));effects++;
      await f.store.update(c,"synthetic-Windows-native-ready",state=>{(state.repositoryWindowsRuns??=[]).push({schema:"switchyard-windows-reviewed-runner/v1",...context,planDigest:scopeHash(plan),status:"executing",cleanupPending:true});});entered();
      let cancelled=false;if(hold)await new Promise(resolve=>{waiting.set(context.operationId,()=>{cancelled=true;resolve();});signal.addEventListener("abort",()=>{cancelled=true;resolve();},{once:true});if(signal.aborted){cancelled=true;resolve();}});waiting.delete(context.operationId);
      const result={status:cancelled?"cancelled":backendStatus,summary:"Synthetic Windows backend result",receiptPath:join(f.stage,"synthetic-windows-receipt.json")};
      if(artifacts){
        const root=join(f.stage,"execution","windows",c,"results",context.operationId,"sandbox-11111111-2222-4333-8444-555555555555");await mkdir(root,{recursive:true});result[backendStatus==="failed"?"diagnosticRoot":"resultRoot"]=root;result.programExitCode=backendStatus==="failed"?7:0;result.validatedOutputs=[];
        for(const [path,text] of [["process.stdout.txt","synthetic output\nAuthorization: Bearer synthetic-value-123456789"],["process.stderr.txt","synthetic diagnostic"]]){const bytes=Buffer.from(text);await writeFile(join(root,path),bytes);result.validatedOutputs.push({path,size:bytes.length,sha256:sha(bytes)});}
      }
      await f.store.update(c,"synthetic-Windows-native-result",state=>{const row=state.repositoryWindowsRuns.find(row=>row.operationId===context.operationId);row.status="settled";row.cleanupPending=false;row.nativeExitVerified=true;row.result=result;row.backendObservation=result;});return result;
    },
    stopOperation:async(_c,id)=>{stopRequests++;const override=await stopHook(id);if(override)return override;const wake=waiting.get(id);wake?.();return{accepted:Boolean(wake),stopped:Boolean(wake)};},
    stopCompartment:async()=>{for(const wake of waiting.values())wake();return{stopped:true,cleaned:true};},close:async()=>{for(const wake of waiting.values())wake();}
  };
  const services=[];const create=()=>{const execution=createRepositoryExecution({store:f.store,authority:f.service,stateDirectory:join(f.stage,"execution"),platform:"win32",windowsRunner:runner,isActive:async()=>true,now:f.now});services.push(execution);return execution;};
  f.onCleanup(async()=>{for(const execution of services)await execution.close();});const execution=create(),proposed={requestId:randomUUID(),authorityId:grant.id,manifestPath:"run.json",manifestSha256:sha(bytes),action:"run_target"};
  return {outputs:()=>{artifacts=true;},backendStatus:value=>{backendStatus=value;},onStop:fn=>{stopHook=fn;},stopRequests:()=>stopRequests,...f,execution,create,proposed,grant,grantInput,prerequisites,effects:()=>effects,hold:()=>{hold=true;},entered:entry};
}
