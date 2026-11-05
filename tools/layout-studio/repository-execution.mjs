/** Separately reviewed task execution through existing policy, budget and receipt ledgers. */
import { createHash } from "node:crypto";
import { join } from "node:path";
import { DurableMediatedExecutor } from "../../packages/control-plane/src/runtime.ts";
import { InMemoryExecutionBroker } from "../../packages/control-plane/src/brokers.ts";
import { commandForAction } from "../../packages/control-plane/src/command-catalog.ts";
import { NodeFileDigestReader } from "../../packages/control-plane/src/git-inspector.ts";
import { redactText } from "../../packages/control-plane/src/redaction.ts";
import { RepositoryRuntime, verifyRepositoryRuntimeManifest } from "../../apps/windows-companion/src/repository-runtime.ts";
import { RepositoryRuntimeExecutionBroker, repositoryRuntimeExecutionRecipe } from "../../apps/windows-companion/src/repository-runtime-broker.ts";
import { LinuxBubblewrapRepositoryProcessSupervisor } from "../../apps/linux-companion/src/linux-repository-runtime.ts";
import { repositoryEffectJournal } from "./repository-effect-journal.mjs";
import { createRepositoryExecutionSupervisors } from "./repository-execution-supervisor.mjs";
import { createRepositoryExecutionStaging } from "./repository-execution-staging.mjs";
import { createRepositoryExecutionStops } from "./repository-execution-stop.mjs";
import { createWindowsRepositoryExecution } from "./repository-windows-execution.mjs";
import { scopeHash } from "./confirmations.mjs";
import { connectedExecutionActions, linuxPipelineActions, linuxShieldActions } from "./repository-execution-actions.mjs";
import { pipelineEvidence, pipelineDependencies } from "./repository-pipeline.mjs";
import { validateShieldRecipe, shieldDependencies, shieldReceiptEvidence } from "./repository-shield.mjs";
const uuid=v=>typeof v==="string"&&/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/.test(v);
const sha=v=>typeof v==="string"&&/^[a-f0-9]{64}$/.test(v), tokenHash=v=>createHash("sha256").update(v).digest("hex");
const budget={version:"suite-reviewed-execution/v2",commandClasses:Object.fromEntries(connectedExecutionActions("linux").map(action=>[action,{maxConcurrent:1,timeoutMs:600000,maxAttempts:1,windowMs:3600000,maxClaimsPerWindow:20,maxCostUnitsPerWindow:20,defaultCostUnits:1}]))};
const executionPolicy=Object.freeze({workspace:"read-only-reviewed-snapshot",network:"denied",ambientCredentials:"denied",temporaryBytes:64*1024*1024,hostRepositoryWritten:false});
function proposed(input) {
  if(Object.keys(input).some(k=>!["compartment","requestId","authorityId","manifestPath","manifestSha256","action"].includes(k))||!uuid(input.requestId)||!uuid(input.authorityId)||!connectedExecutionActions("linux").includes(input.action)||!sha(input.manifestSha256)||typeof input.manifestPath!=="string"||!input.manifestPath||input.manifestPath.length>512)throw Error("Review one exact task authority, request UUID and owned host recipe; command/argument/approval fields are not accepted.");
  return {requestId:input.requestId,authorityId:input.authorityId,manifestPath:input.manifestPath,manifestSha256:input.manifestSha256,action:input.action};
}
const view=r=>({requestId:r.requestId,authorityId:r.authorityId,taskId:r.taskId,sessionId:r.sessionId,repositoryRoot:r.repositoryRoot,targetSnapshotId:r.targetSnapshotId,action:r.action,manifestPath:r.manifestPath,manifestSha256:r.manifestSha256,recipe:r.recipe,executableIdentity:r.executableIdentity,executionPolicy:r.executionPolicy,...(r.shield?{shield:r.shield}:{}),scopeDigest:r.scopeDigest,status:r.status,observedStatus:r.observedStatus??null,operationId:r.operationId??null,outcome:r.outcome??null,expiresAt:r.expiresAt,providerTaskCompletionVerified:false});
export function createRepositoryExecution({store,authority,stateDirectory,platform=process.platform,isActive=async()=>true,supervisors=createRepositoryExecutionSupervisors({store,isActive}),staging=createRepositoryExecutionStaging({store,stateDirectory:join(stateDirectory,"inputs")}),namespaceFactory=native=>new LinuxBubblewrapRepositoryProcessSupervisor(native,{additionalActions:["run_target"],readOnlyDisposable:true,temporaryBuilds:true,temporaryBytes:executionPolicy.temporaryBytes}),windowsRunner,resolveScannerFixtures,now=Date.now}={}) {
  if(platform==="win32")return createWindowsRepositoryExecution({store,authority,stateDirectory,isActive,now,runner:windowsRunner,resolveScannerFixtures});
  const generations=new Map(),pending=new Map(),seen=new Set(),runtimes=new Map(),recoveryHosts=new Map(),reader=new NodeFileDigestReader({maxFileBytes:128*1024});let closed=false;
  const current=(c,g)=>{if(closed||g!==(generations.get(c)??0))throw Error("This reviewed execution was stopped.");};
  async function exclusive(c,fn){if(pending.has(c))throw Error("Wait for the current execution review or admission.");const g=generations.get(c)??0,p=Promise.resolve().then(()=>fn(g));pending.set(c,p);seen.add(c);try{return await p;}finally{if(pending.get(c)===p)pending.delete(c);}}
  async function update(c,id,action,fn){return store.update(c,action,s=>{const r=s.repositoryExecutionReviews?.find(r=>r.requestId===id);if(!r)throw Error("The protected execution review changed.");return fn(r);});}
  async function manifest(resolved,proposal,c) {
    if(!resolved.proposed.paths.includes(proposal.manifestPath))throw Error("The recipe manifest itself must belong to this exact task-owned file grant.");
    const read=await reader.read(resolved.task.repositoryRoot,proposal.manifestPath);
    try {
      if(read.digest!==`sha256:${proposal.manifestSha256}`)throw Error("The reviewed recipe manifest bytes changed.");
      const raw=JSON.parse(read.bytes.toString("utf8"));if(!raw.recipes||Object.keys(raw.recipes).some(k=>![proposal.action,...(proposal.action==="run_target"?["stop_managed_run"]:[])].includes(k)))throw Error("This exact connected manifest permits only its reviewed action and an optional Run stop descriptor.");
      const verified=await verifyRepositoryRuntimeManifest(read.bytes,{expectedSha256:proposal.manifestSha256,repositoryRoot:resolved.task.repositoryRoot}),recipe=verified.manifest.recipes[proposal.action];
      if(!recipe||recipe.kind!=="process"||recipe.lifecycle!==(proposal.action==="run_target"?"managed":"foreground")||recipe.isolation!=="disposable"||!recipe.inputFiles?.length||recipe.timeoutMs>600000||recipe.maxOutputBytes>524288)throw Error("Connected execution requires its bounded lifecycle and exact disposable input set.");
      if(linuxPipelineActions.includes(proposal.action)&&Object.entries(recipe.environment).some(([name,value])=>name==="NODE_ENV"&&value!=="test"))throw Error("A connected pipeline cannot select a production NODE_ENV.");
      const witnesses=new Map([...resolved.files.tracked,...resolved.files.untracked].map(f=>[f.path,f]));
      for(const input of recipe.inputFiles)if(!resolved.proposed.paths.includes(input.path)||witnesses.get(input.path)?.digest!==`sha256:${input.sha256}`)throw Error("Every execution input must match this exact task-owned file snapshot.");
      const shield=await validateShieldRecipe({recipe,repositoryRoot:resolved.task.repositoryRoot,action:proposal.action,resolveFixtures:resolveScannerFixtures?input=>resolveScannerFixtures(c,input):undefined,now});
      return {verified,recipe,...(shield?{shield}:{})};
    }finally{read.bytes.fill(0);}
  }
  async function runtimeFor(c,review,resolved,g,loaded) {
    const check=async()=>{current(c,g);if(!await isActive(c))throw Error("Select this workspace before executing its reviewed task.");const fresh=await authority.assertCurrent(c,review.authorityId,review.action);if(fresh.record.taskDigest!==review.taskDigest||fresh.record.workspaceDigest!==review.workspaceDigest)throw Error("The execution task/account/workspace scope changed.");const read=await reader.read(review.repositoryRoot,review.manifestPath);try{if(read.digest!==`sha256:${review.manifestSha256}`)throw Error("The exact host recipe changed before execution.");}finally{read.bytes.fill(0);}current(c,g);};
    const journal=repositoryEffectJournal(store,c,{provider:resolved.task.provider,domain:"execution",now});
    const rawReceiptEvidence=[...linuxPipelineActions,...linuxShieldActions].includes(review.action)?await pipelineEvidence({store,compartment:c,provider:resolved.task.provider,policyVersion:resolved.snapshot.policyVersion,now}):undefined;
    const receiptEvidence=rawReceiptEvidence&&linuxShieldActions.includes(review.action)?shieldReceiptEvidence(rawReceiptEvidence):rawReceiptEvidence;
    const payload={schema:"switchyard-execution-checkpoint/v1",scopeDigest:review.scopeDigest,targetSnapshotId:review.targetSnapshotId,manifestSha256:review.manifestSha256,recipe:review.recipe,executionPolicy:review.executionPolicy};
    const checkpointDigest=scopeHash(payload),reference=`suite-execution-checkpoint:${review.requestId}`;
    const checkpointCapture={capture:async({operationId,definition,target})=>{
      await check();if(definition.action!==review.action||target.id!==review.targetSnapshotId)throw Error("The execution checkpoint scope changed.");
      await update(c,review.requestId,"execution-checkpoint-binding",r=>{if(r.status!=="executing"||r.operationId&&r.operationId!==operationId)throw Error("The exact execution operation changed.");r.operationId=operationId;r.admission??={schema:"switchyard-execution-admission/v1",operationId,action:r.action,targetSnapshotId:r.targetSnapshotId,scopeDigest:r.scopeDigest,admittedAt:now()};r.checkpoint={payload,digest:checkpointDigest};});
      return {reason:"Preserve the exact approved manifest, input witnesses and isolated execution boundary. The live repository is never changed by this path.",artifacts:[{id:`execution-${review.requestId}`,kind:"workspace_manifest",reference,sha256:checkpointDigest,bytes:Buffer.byteLength(JSON.stringify(payload))}],recovery:{artifactIds:[`execution-${review.requestId}`],steps:["Observe the exact protected native guardian and its independently verified exit; do not replay the program.","Inspect the preserved manifest and input witnesses, native result and owned staging record.","Remove only independently stopped, unchanged owned input copies. The original repository and uncertain outcome remain unchanged."]}};
    }};
    const checkpointVerifier={verify:async artifact=>{const row=(await store.snapshot(c)).repositoryExecutionReviews?.find(r=>r.requestId===review.requestId),record=row?.checkpoint;if(artifact.reference!==reference||!record||scopeHash(record.payload)!==record.digest)return {available:false,detail:"The exact execution checkpoint is unavailable."};return {available:true,sha256:record.digest,detail:"The protected recipe and input witnesses match the execution checkpoint."};}};
    const port=operationId=>supervisors.forOperation(c,{action:review.action,operationId,targetSnapshotId:review.targetSnapshotId,sessionId:review.sessionId,authorityId:review.authorityId,repositoryRoot:review.repositoryRoot,manifestSha256:review.manifestSha256,provider:resolved.task.provider},check);
    const operationControl={observe:binding=>port(binding.operationId).observeOperation(binding),cancel:async({operationId})=>{const row=(await store.snapshot(c)).repositoryExecutionReviews?.find(r=>r.requestId===review.requestId);if(row?.operationId!==operationId)return {accepted:false,summary:"The exact reviewed execution operation changed."};return supervisors.stopOperation(c,operationId);}};
    let repositoryRuntime;
    const runtime=new DurableMediatedExecutor({store:journal,authorities:authority.authorityLedger(c),policyVersion:"switchyard-task-local-authority/v1",operationScopeDigest:review.scopeDigest,now:()=>new Date(now()),budgetConfiguration:budget,checkpointCapture,checkpointVerifier,additionalCheckpointActions:connectedExecutionActions("linux"),operationControl,...(receiptEvidence?{receiptEvidence}:{}),
      targetResolver:{resolve:async()=>{await check();const actual=await authority.resolve(c,review.authorityId,review.action);if(actual.snapshot.id!==review.targetSnapshotId||actual.binding!==review.taskDigest||actual.workspace!==review.workspaceDigest)throw Error("The exact execution snapshot changed.");return actual.snapshot;}},
      dependencies:context=>{
        const native={start:async request=>{const row=(await store.snapshot(c)).repositoryExecutionReviews?.find(r=>r.requestId===review.requestId);if(row?.operationId!==request.operationId)throw Error("The protected execution operation changed before native startup.");return supervisors.forOperation(c,{action:review.action,operationId:request.operationId,targetSnapshotId:review.targetSnapshotId,sessionId:review.sessionId,authorityId:review.authorityId,repositoryRoot:review.repositoryRoot,manifestSha256:review.manifestSha256,provider:resolved.task.provider},check).start(request);},recover:async()=>[],observeOperation:async()=>({state:"not_owner",operationId:"unknown",summary:"Use the protected execution inventory."})};
        const sandbox=namespaceFactory(native);
        repositoryRuntime=new RepositoryRuntime(loaded.verified,{processSupervisor:sandbox,temporaryBuilds:true,executionRoots:{prepare:async input=>{const row=(await store.snapshot(c)).repositoryExecutionReviews?.find(r=>r.requestId===review.requestId);if(!row?.operationId)throw Error("Execution staging requires its protected checkpoint operation.");return staging.prepare(c,{operationId:row.operationId,scopeDigest:review.scopeDigest},input,check);}}});
        const broker=new RepositoryRuntimeExecutionBroker({resolve:async root=>{if(root!==review.repositoryRoot)throw Error("The execution repository changed.");return repositoryRuntime;}}),execution=new InMemoryExecutionBroker(context.policy),marker=repositoryRuntimeExecutionRecipe(review.action,resolved.snapshot);
        const pipeline=receiptEvidence?(linuxShieldActions.includes(review.action)?shieldDependencies:pipelineDependencies)({policy:context.policy,runtime:repositoryRuntime,review,target:resolved.snapshot,receiptEvidence,now,resolveScannerFixtures:resolveScannerFixtures?input=>resolveScannerFixtures(c,input):undefined}):undefined;
        execution.register(marker.id,request=>pipeline?pipeline.execute(request):broker.execute(request));
        return {execution,...(pipeline?{recipes:pipeline.recipes,testEnvironment:pipeline.testEnvironment}:{}),executionRecipeFactory:{create:(definition,target)=>definition.action===review.action&&target.id===review.targetSnapshotId?repositoryRuntimeExecutionRecipe(review.action,target):undefined}};
      }});
    await check();await runtime.sessions.upsert({id:review.sessionId,provider:"generic",surface:"bridge",capabilities:["registered","mediated"],status:"running",workspaceRoot:review.repositoryRoot,targetSnapshotId:review.targetSnapshotId,taskId:review.taskId,planRevision:resolved.record.grant.planRevision,plannedFiles:resolved.proposed.paths,adapterVersion:"switchyard-host-execution/v1",metadata:{meaning:"Host-mediated execution context; native provider permissions and coding-task completion remain unchanged",nativeProvider:resolved.task.provider,accountFingerprint:resolved.task.accountFingerprint}});
    return {runtime,check,repositoryRuntime:()=>repositoryRuntime};
  }
  async function recoverCompartment(c) {
    seen.add(c);await supervisors.reconcile(c);
    let recovery=recoveryHosts.get(c);
    if(!recovery){
      const observation=async binding=>{const r=(await store.snapshot(c)).repositoryExecutions?.find(r=>r.operationId===binding.operationId);if(!r)return {state:"not_owner",operationId:binding.operationId,summary:"No protected owned execution was found."};return supervisors.forOperation(c,r,async()=>{throw Error("Recovery cannot launch an execution.");}).observeOperation(binding);};
      recovery=new DurableMediatedExecutor({store:repositoryEffectJournal(store,c,{domain:"execution",now}),policyVersion:"switchyard-task-local-authority/v1",now:()=>new Date(now()),operationControl:{observe:observation,cancel:({operationId})=>supervisors.stopOperation(c,operationId)},dependencies:()=>({})});
      recoveryHosts.set(c,recovery);
    }
    await recovery.recoverAfterRestart();
    const cleanup=await staging.cleanupCompartment(c);await stops.recover(c);return cleanup;
  }
  const stops=createRepositoryExecutionStops({store,supervisors,isActive,now,reconcile:recoverCompartment});
  return {
    reviewStop:stops.review,applyStop:stops.apply,listStops:stops.list,
    recoverCompartment,
    async review(c,input){return exclusive(c,async g=>{
      const proposal=proposed(input);current(c,g);if(platform!=="linux")throw Error("Connected guest execution on this platform is unfinished implementation; no uncontained host substitute was selected.");
      await recoverCompartment(c);const state=await store.snapshot(c);if(state.repositoryExecutionReviews?.some(r=>r.requestId===proposal.requestId))throw Error("This execution request already has a protected review; use its retained result.");
      if((await supervisors.list(c)).some(r=>r.stoppedVerified!==true))throw Error("Stop or independently reconcile the prior owned execution before reviewing another run.");
      const resolved=await authority.resolve(c,proposal.authorityId,proposal.action),loaded=await manifest(resolved,proposal,c);current(c,g);
      const packet={...proposal,taskId:resolved.task.id,sessionId:resolved.task.sessionId,repositoryRoot:resolved.task.repositoryRoot,targetSnapshotId:resolved.snapshot.id,taskDigest:resolved.binding,workspaceDigest:resolved.workspace,recipe:loaded.recipe,executableIdentity:loaded.verified.executableIdentities.get(proposal.action),executionPolicy:{...executionPolicy,workspace:loaded.recipe.workspaceMode==="temporary-build"?"bounded-writable-copy":"read-only-reviewed-snapshot"}};
      if(loaded.shield)packet.shield=loaded.shield;
      const review={...packet,scopeDigest:scopeHash(["switchyard-execution-review/v1",c,packet]),status:"reviewed",createdAt:now()},host=await runtimeFor(c,review,resolved,g,loaded);
      const confirmation=await host.runtime.confirmations.issue({action:review.action,sessionId:review.sessionId,authorityId:review.authorityId,targetSnapshotId:review.targetSnapshotId,scopeDigest:review.scopeDigest,reason:"Execute only this exact reviewed recipe and task-owned non-production input set in the displayed isolated boundary. No provider permission or live-repository write is granted.",reauthenticated:false});
      await host.check();review.expiresAt=confirmation.record.expiresAt;review.tokenDigest=tokenHash(confirmation.token);
      await store.update(c,"repository-execution-review",s=>{const rows=s.repositoryExecutionReviews??[],held=rows.filter(r=>["executing","running","outcome-unconfirmed"].includes(r.status)||r.status==="reviewed"&&Date.parse(r.expiresAt)>now());s.repositoryExecutionReviews=[...held,...rows.filter(r=>!held.includes(r)).slice(-16)];if(s.repositoryExecutionReviews.length>=64)throw Error("The protected execution review inventory is full.");s.repositoryExecutionReviews.push(review);},{provider:resolved.task.provider});
      return {status:"requires-confirmation",review:view(review),confirmation,budget:budget.commandClasses[proposal.action]};
    });},
    async apply(c,input){return exclusive(c,async g=>{
      if(Object.keys(input).some(k=>!["compartment","requestId","token"].includes(k))||!uuid(input.requestId)||!uuid(input.token))throw Error("Execute only one exact reviewed request and its one-use approval.");
      const row=(await store.snapshot(c)).repositoryExecutionReviews?.find(r=>r.requestId===input.requestId);if(!row||row.tokenDigest!==tokenHash(input.token))throw Error("The exact execution approval is unavailable.");
      if(row.status!=="reviewed")return {...(row.outcome??{status:"incomplete",effectDisposition:"ambiguous",summary:"The prior execution outcome is unconfirmed; no replay was attempted."}),replayed:true,providerTaskCompletionVerified:false};
      if(platform!=="linux")throw Error("The guest execution implementation is not connected on this platform.");
      const resolved=await authority.resolve(c,row.authorityId,row.action),loaded=await manifest(resolved,row,c);if(resolved.snapshot.id!==row.targetSnapshotId||resolved.binding!==row.taskDigest||resolved.workspace!==row.workspaceDigest||scopeHash(loaded.verified.executableIdentities.get(row.action))!==scopeHash(row.executableIdentity)||scopeHash(loaded.shield??null)!==scopeHash(row.shield??null))throw Error("The reviewed execution scope, scanner feeds or pinned executable changed.");
      const host=await runtimeFor(c,row,resolved,g,loaded);await host.check();
      const approved=await host.runtime.confirmations.consume({action:row.action,sessionId:row.sessionId,authorityId:row.authorityId,targetSnapshotId:row.targetSnapshotId,scopeDigest:row.scopeDigest,token:input.token});if(!approved.allowed)throw Error(approved.reason);
      await update(c,row.requestId,"repository-execution-admit",r=>{current(c,g);if(r.status!=="reviewed")throw Error("This execution was already reserved.");r.status="executing";});
      let outcome;
      try {const assignment=commandForAction(row.action).assignment;outcome=await host.runtime.execute({assignment,control:assignment.control,modifier:assignment.modifier,sessionId:row.sessionId,authorityId:row.authorityId});}
      catch {outcome={status:"incomplete",effectDisposition:"ambiguous",summary:"The exact host execution did not settle. Inspect its retained operation; no automatic replay is allowed."};}
      const fresh=(await store.snapshot(c)).repositoryExecutionReviews.find(r=>r.requestId===row.requestId),native=(await store.snapshot(c)).repositoryExecutions?.find(r=>r.operationId===fresh.operationId);
      if(native?.status==="outcome-unconfirmed")outcome={...outcome,status:"incomplete",effectDisposition:"ambiguous",summary:"The exact native execution outcome remains unconfirmed; ownership was retained."};
      await update(c,row.requestId,"repository-execution-admission-result",r=>{r.outcome={...outcome,providerTaskCompletionVerified:false,nativePermissionsChanged:false};r.status=outcome.status==="running"?"running":outcome.effectDisposition==="ambiguous"?"outcome-unconfirmed":"settled";r.finishedAt=now();});
      runtimes.set(`${c}:${row.requestId}`,host);return {...outcome,replayed:false,providerTaskCompletionVerified:false,nativePermissionsChanged:false};
    });},
    async list(c){return ((await store.snapshot(c)).repositoryExecutionReviews??[]).map(view);},
    async status(c,id){await recoverCompartment(c);await runtimes.get(`${c}:${id}`)?.runtime.reconcileBudgetedOperations();if(!uuid(id))throw Error("Choose an exact execution request UUID.");const s=await store.snapshot(c),r=s.repositoryExecutionReviews?.find(r=>r.requestId===id);if(!r)throw Error("That execution is unavailable in this workspace.");const native=s.repositoryExecutions?.find(n=>n.operationId===r.operationId);if(r.status==="running"&&native?.stoppedVerified===true&&(native.status==="settled"||native.stopRequestedAt)){const observedStatus=native.status==="settled"?(native.result?.status==="completed"&&native.result.exitCode===0?"completed":native.result?.status==="timed-out"?"timed_out":"failed"):"cancelled";await update(c,id,"repository-execution-terminal-observed",row=>{if(row.status==="running"){row.status="settled";row.observedStatus=observedStatus;row.terminalObservedAt=now();}});r.status="settled";r.observedStatus=observedStatus;}return {...view(r),nativeStatus:native?.status??"not-observed",nativeExitVerified:native?.stoppedVerified===true,output:native?.result?redactText(native.result.stdout):null,diagnostic:native?.result?redactText(native.result.stderr):native?.failure?redactText(native.failure.message):null,programExitCode:native?.result?.exitCode??null,stagingCleanupPending:s.repositoryExecutionStaging?.find(n=>n.operationId===r.operationId)?.cleanupPending??false};},
    async stopCompartment(c){generations.set(c,(generations.get(c)??0)+1);await stops.stopCompartment(c);const result=await supervisors.stopCompartment(c);await Promise.allSettled([pending.get(c)].filter(Boolean));const cleanup=await staging.cleanupCompartment(c);await recoveryHosts.get(c)?.reconcileBudgetedOperations();return {...result,...cleanup};},
    async close(){closed=true;for(const c of seen)generations.set(c,(generations.get(c)??0)+1);let failure;
      try{await stops.close();await supervisors.close();}catch(error){failure=error;}
      await Promise.allSettled(pending.values());
      try{for(const c of seen)await staging.cleanupCompartment(c);for(const host of runtimes.values())await host.runtime.reconcileBudgetedOperations();for(const host of recoveryHosts.values())await host.reconcileBudgetedOperations();}catch(error){failure??=error;}
      finally{for(const host of runtimes.values())host.runtime.stopObservation();for(const host of recoveryHosts.values())host.stopObservation();runtimes.clear();recoveryHosts.clear();}
      if(failure)throw failure;
    }
  };
}
