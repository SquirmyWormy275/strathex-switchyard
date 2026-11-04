import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID, createHash } from "node:crypto";
import { writeFile, readFile, access, mkdir, mkdtemp, rm } from "node:fs/promises";
import { join, dirname } from "node:path";
import { authorityFixture } from "./test-support/task-authority-fixture.mjs";
import { createRepositoryExecution } from "./repository-execution.mjs";
import { createRepositoryExecutionSupervisors } from "./repository-execution-supervisor.mjs";
import { DurableBudgetManager } from "../../packages/control-plane/src/budgets.ts";
import { repositoryEffectJournal } from "./repository-effect-journal.mjs";
import { createRepositoryExecutionStaging } from "./repository-execution-staging.mjs";
const sha=bytes=>createHash("sha256").update(bytes).digest("hex");
async function fixture(t,{native=false,hold=false}={}) {
  const f=await authorityFixture(t,{executionActions:["run_target"]});
  const program="process.stdout.write('exact reviewed run output')",programPath=join(f.root,"program.mjs");await writeFile(programPath,program);
  const recipe={schema:"sxsy-b122.repository-runtime",version:1,repositoryRoot:f.root,allowedHttpsUrls:[],recipes:{run_target:{kind:"process",executable:process.execPath,args:["program.mjs"],cwd:".",environment:{},lifecycle:"managed",isolation:"disposable",timeoutMs:5000,maxOutputBytes:4096,inputFiles:[{path:"program.mjs",sha256:sha(program),size:Buffer.byteLength(program),classification:"non-production"}]}}};
  const bytes=JSON.stringify(recipe);await writeFile(join(f.root,"run.json"),bytes);
  const grantInput={...f.proposed,paths:["task.txt","program.mjs","run.json"],classifications:{includedUntracked:["program.mjs","run.json"]},actions:["run_target"]};
  const approval=await f.service.review("personal",grantInput),grant=await f.service.issue("personal",{...grantInput,token:approval.confirmation.token});
  let effects=0;const owners=new Map();
  const command=async(_exe,_args,options)=>{const owner={schema:"switchyard-runtime-command/v1",id:randomUUID(),guardianPid:12345,birth:"1",containment:process.platform==="linux"?"owned-linux-session":"windows-job"};owners.set(owner.id,false);await options.onGuardianReady(owner);effects++;if(hold)await new Promise(resolve=>{options.signal.addEventListener("abort",resolve,{once:true});if(options.signal.aborted)resolve();});owners.set(owner.id,true);return {status:"completed",exitCode:0,stdout:"synthetic program output",stderr:"",inputDelivered:true,treeExitVerified:true};};
  const supervisors=native?undefined:createRepositoryExecutionSupervisors({store:f.store,command,guardianStopped:async scope=>owners.get(scope.id)===true});
  // A portable test double exercises broker contracts without claiming a Windows/Linux OS boundary.
  const staging=native?undefined:createRepositoryExecutionStaging({store:f.store,stateDirectory:join(f.stage,"execution","inputs"),guardianStopped:async scope=>owners.get(scope.id)===true,providerFactory:state=>({async prepare(input){const base=join(state,"repository-execution-roots");await mkdir(base,{recursive:true});const root=await mkdtemp(join(base,"inputs-"));for(const file of input.inputFiles){const target=join(root,file.path);await mkdir(dirname(target),{recursive:true});await writeFile(target,await readFile(join(input.repositoryRoot,file.path)));}return {root,isolation:"disposable",protections:{productionData:"denied",ambientCredentials:"denied"},release:()=>rm(root,{recursive:true})};}})});
  const execution=createRepositoryExecution({store:f.store,authority:f.service,stateDirectory:join(f.stage,"execution"),platform:native?process.platform:"linux",now:f.now,...(native?{}:{supervisors,staging,namespaceFactory:port=>port})});
  f.onCleanup(()=>execution.close());
  const proposed={requestId:randomUUID(),authorityId:grant.id,manifestPath:"run.json",manifestSha256:sha(bytes),action:"run_target"};
  return {...f,execution,grant,grantInput,recipe,proposed,effects:()=>effects};
}
async function settled(f,id){const deadline=Date.now()+10000;let status;while(Date.now()<deadline){status=await f.execution.status("personal",id);if(status.nativeStatus==="settled"&&!status.stagingCleanupPending)return status;await new Promise(r=>setTimeout(r,20));}throw Error("Owned execution did not settle within its expected proof bound: "+JSON.stringify(status));}
test("reviewed execution uses separate action authority, approval, checkpoint, budget and duplicate receipt boundaries",async t=>{
  const f=await fixture(t),before=await f.run("rev-parse","HEAD"),review=await f.execution.review("personal",f.proposed);
  assert.equal(review.review.executionPolicy.network,"denied");assert.equal(review.review.executionPolicy.hostRepositoryWritten,false);
  for(const bad of [{...f.proposed,requestId:randomUUID(),command:"untrusted"},{...f.proposed,requestId:randomUUID(),manifestPath:"../outside"}])await assert.rejects(f.execution.review("personal",bad));
  await assert.rejects(f.execution.apply("personal",{requestId:f.proposed.requestId,token:randomUUID()}),/approval/);assert.equal(f.effects(),0);
  const input={requestId:f.proposed.requestId,token:review.confirmation.token},result=await f.execution.apply("personal",input);assert.equal(result.status,"running",JSON.stringify(result));assert.equal(result.providerTaskCompletionVerified,false);
  const status=await settled(f,f.proposed.requestId);assert.equal(status.nativeExitVerified,true);assert.equal(status.output,"synthetic program output");
  assert.equal(status.status,"settled");assert.equal(status.outcome.status,"running","terminal observation preserves the original admission result");
  const snapshot=await f.store.snapshot("personal"),row=snapshot.repositoryExecutionReviews[0];assert.ok(row.checkpoint);assert.equal(row.operationId,result.operationId);assert.equal(snapshot.repositoryExecutionJournal.some(e=>e.kind==="checkpoint.created"),true);
  assert.equal((await f.execution.apply("personal",input)).replayed,true);assert.equal(f.effects(),1);assert.equal(await f.run("rev-parse","HEAD"),before);assert.equal(await readFile(join(f.root,"task.txt"),"utf8"),"reviewed\n");
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
test("actual Linux host broker connects reviewed task inputs, namespace and owned guardian without a live repository write",{skip:process.platform!=="linux"},async t=>{
  const f=await fixture(t,{native:true}),review=await f.execution.review("personal",f.proposed),before=await f.run("rev-parse","HEAD");
  const result=await f.execution.apply("personal",{requestId:f.proposed.requestId,token:review.confirmation.token});assert.equal(result.status,"running",JSON.stringify(result));
  const status=await settled(f,f.proposed.requestId);assert.equal(status.output,"exact reviewed run output",JSON.stringify(status));assert.equal(status.programExitCode,0);assert.equal(status.providerTaskCompletionVerified,false);assert.equal(await f.run("rev-parse","HEAD"),before);
});
