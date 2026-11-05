import test from "node:test";
import assert from "node:assert/strict";
import { createHash, randomUUID } from "node:crypto";
import { mkdtemp, rm, readFile, access, copyFile, rename, mkdir } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { createSuiteStore } from "./suite-store.mjs";
import { createRepositoryExecutionSupervisors } from "./repository-execution-supervisor.mjs";
import { runRuntimeCommand, runtimeGuardianStopped } from "./runtime-command.mjs";
import { LinuxBubblewrapRepositoryProcessSupervisor } from "../../apps/linux-companion/src/linux-repository-runtime.ts";
const sha = value => createHash("sha256").update(value).digest("hex");
async function fixture(t, handler) {
  const root = await mkdtemp(join(tmpdir(),"switchyard-owned-execution-")), keys = new Map(), owners = new Map(), services = [], calls=[];
  const store=createSuiteStore({root:join(root,"state"),secrets:{get:async(c,p)=>keys.get(c+p),set:async(c,p,v)=>{keys.set(c+p,v);}}});
  await store.initialize("personal"); await store.update("personal","fixture-mode",s=>{s.mode="personal-companion";}); let effects=0, stopped=true, authorized=true;
  const command=async(executable,args,options)=>{
    const owner={schema:"switchyard-runtime-command/v1",id:randomUUID(),guardianPid:12345,birth:"1",containment:process.platform==="linux"?"owned-linux-session":"windows-job"}; owners.set(owner.id,false);
    calls.push({executable,args,options,owner});
    try { await handler?.("before-ready",{store,options,owner}); await options.onGuardianReady(owner); effects++; await handler?.("effect",{store,options,owner}); }
    finally { owners.set(owner.id,true); }
    return {status:"completed",exitCode:0,stdout:"synthetic exact program output",stderr:"",inputDelivered:true,treeExitVerified:true};
  };
  const create=(extra={})=>{const s=createRepositoryExecutionSupervisors({store,command,guardianStopped:async scope=>stopped&&owners.get(scope.id)===true,...extra});services.push(s);return s;};
  const service=create(), binding={action:"run_target",operationId:randomUUID(),targetSnapshotId:"a".repeat(64),authorityId:randomUUID(),sessionId:"native-fixture-session",repositoryRoot:root,manifestSha256:"b".repeat(64),provider:"codex"};
  const request={...Object.fromEntries(Object.entries(binding).filter(([k])=>k!=="provider")),executionRoot:root,isolation:"disposable",executable:process.execPath,executableSha256:sha(await readFile(process.execPath)),args:["--version"],cwd:root,environment:{},lifecycle:"managed",timeoutMs:10000,maxOutputBytes:4096};
  const port=(s=service,b=binding)=>s.forOperation("personal",b,async()=>{if(!authorized)throw Error("Synthetic scope revoked");});
  t.after(async()=>{stopped=true;for(const id of owners.keys())owners.set(id,true);await Promise.all(services.map(s=>s.close()));await rm(root,{recursive:true,force:true});});
  return {root,store,service,create,binding,request,port,calls,effects:()=>effects,stopped:v=>{stopped=v;},authorize:v=>{authorized=v;}};
}
const output = async stream => {let text="";for await(const chunk of stream)text+=chunk;return text;};
test("native zero exit cannot recover a passing pipeline or Shield observation after restart",async t=>{
  const f=await fixture(t);
  for(const action of ["pipeline_local_gate","pipeline_clean_reproduction","shield_change_scan","shield_codebase_audit","shield_supply_chain","release_shield"]){
    const binding={...f.binding,operationId:randomUUID(),action},request={...f.request,operationId:binding.operationId,action,lifecycle:"foreground"},process=await f.port(f.service,binding).start(request);await process.wait();
    const reopened=f.create(),observed=await f.port(reopened,binding).observeOperation(request);assert.equal(observed.state,"terminal");assert.equal(observed.status,"incomplete");assert.equal(observed.effectDisposition,"committed");assert.equal(observed.evidenceDigest,undefined);assert.equal(observed.toolVersions,undefined);
  }
  assert.equal(f.effects(),6);
});
test("the runtime supervisor persists exact ownership before acknowledgement and preserves a trusted bounded native result",async t=>{
  let ready=false; const f=await fixture(t,async(stage,{store,options,owner})=>{if(stage==="effect"){const r=(await store.snapshot("personal")).repositoryExecutions[0];assert.equal(r.ownedRuntime.id,owner.id);assert.equal(r.stoppedVerified,false);assert.equal(r.status,"running");assert.equal(options.expectedExecutableSha256,f.request.executableSha256);ready=true;}});
  const process=await f.port().start(f.request), text=output(process.stdout);assert.match(process.supervisorId,/^managed:[a-f0-9]{64}$/);assert.equal((await process.wait()).terminalEvidence,"trusted");assert.equal(await text,"synthetic exact program output");assert.equal(ready,true);
  const row=(await f.store.snapshot("personal")).repositoryExecutions[0];assert.equal(row.stoppedVerified,true);assert.equal(row.status,"settled");
  const observation=await f.port().observeOperation(f.request);assert.equal(observation.state,"terminal");assert.equal(observation.status,"completed");assert.equal(observation.effectDisposition,"committed");assert.match(observation.summary,/task completion remains unverified/);
  await assert.rejects(f.port().start(f.request),/protected startup/);assert.equal(f.effects(),1);
  for(const extra of [{operationId:randomUUID()},{manifestSha256:"c".repeat(64)},{sessionId:"other"},{args:Array(257).fill("too many")},{command:"untrusted"}])await assert.rejects(f.port().start({...f.request,...extra}));
  assert.equal(f.effects(),1);assert.equal(Object.hasOwn((await f.service.list("personal"))[0],"executionRoot"),false);
  const noAck={...f.binding,operationId:randomUUID(),schema:"switchyard-owned-execution/v1",status:"reserved",stoppedVerified:false};await f.store.update("personal","synthetic-crash-before-ack",s=>{s.repositoryExecutions.push(noAck);});
  const restarted=f.create();assert.equal((await restarted.reconcile("personal")).stopped,true);const retained=(await f.store.snapshot("personal")).repositoryExecutions.find(r=>r.operationId===noAck.operationId);assert.equal(retained.noStartAcknowledgementVerified,true);assert.equal(retained.status,"not-started");assert.equal(f.effects(),1);
});
test("concurrent host calls and independent instances cannot replay an execution operation",async t=>{
  let enter,release;const entered=new Promise(r=>{enter=r;}),gate=new Promise(r=>{release=r;});const f=await fixture(t,async stage=>{if(stage==="effect"){enter();await gate;}});
  const first=await f.port().start(f.request);await entered;
  await assert.rejects(f.port().start(f.request),/already has an owned/);
  const second=f.create(), pending=assert.rejects(f.port(second).start(f.request),/protected startup/);release();await first.wait();await pending;assert.equal(f.effects(),1);
});
test("durable readiness is cancellable before its writer returns without acknowledging startup early",async t=>{
  let enter,releaseReady,releaseEffect;
  const entered=new Promise(resolve=>{enter=resolve;}),readyGate=new Promise(resolve=>{releaseReady=resolve;}),effectGate=new Promise(resolve=>{releaseEffect=resolve;});
  const f=await fixture(t,async stage=>{if(stage==="effect")await effectGate;});
  t.after(()=>{releaseReady();releaseEffect();});
  const update=f.store.update;
  f.store.update=async(...args)=>{const result=await update(...args);if(args[1]==="repository-execution-ready"){enter();await readyGate;}return result;};
  let acknowledged=false;
  const pending=f.port().start(f.request).then(value=>{acknowledged=true;return value;});
  try {
    await entered;
    const row=(await f.store.snapshot("personal")).repositoryExecutions[0];
    assert.equal(row.status,"running");assert.equal(row.ownedRuntime.id,f.calls[0].owner.id);
    assert.equal(acknowledged,false,"startup acknowledgement must wait for persistence and its final guard");
    assert.equal(await f.service.canStop("personal",f.binding.operationId),true,"an observable durable owner must already have its exact stop controller");
    assert.equal(await f.service.canStop("personal",randomUUID()),false);
    releaseReady();const child=await pending;
    const stop=f.service.stopOperation("personal",f.binding.operationId);
    releaseEffect();assert.equal((await stop).accepted,true);await child.wait();
    await assert.rejects(f.port().start(f.request),/protected startup/);assert.equal(f.calls.length,1);
  } finally {releaseReady();releaseEffect();await pending.catch(()=>{});}
});
test("startup, exit and final persistence faults retain conservative outcomes without another native effect",async t=>{
  for(const boundary of ["repository-execution-ready","repository-execution-native-exit","repository-execution-result"]){
    const f=await fixture(t), update=f.store.update;let fail=true;f.store.update=async(...args)=>{if(fail&&args[1]===boundary){fail=false;throw Error("Synthetic persistence failure");}return update(...args);};
    if(boundary==="repository-execution-ready")await assert.rejects(f.port().start(f.request),/protected startup/);
    else {const p=await f.port().start(f.request);assert.equal((await p.wait()).terminalEvidence,"ambiguous");}
    const row=(await f.store.snapshot("personal")).repositoryExecutions[0];assert.equal(row.status,boundary==="repository-execution-ready"?"not-started":"outcome-unconfirmed");
    assert.equal(f.effects(),boundary==="repository-execution-ready"?0:1);await assert.rejects(f.port().start(f.request),/protected startup/);assert.equal(f.calls.length,1);
  }
});
test("unknown native exit survives another host instance and blocks replacement until independently observed",async t=>{
  const f=await fixture(t);f.stopped(false);const p=await f.port().start(f.request);assert.equal((await p.wait()).terminalEvidence,"ambiguous");
  assert.equal((await f.service.stopCompartment("personal")).stopped,false);await assert.rejects(f.service.close(),/independent exit/);
  const other=f.create(), next={...f.binding,operationId:randomUUID()};await assert.rejects(f.port(other,next).start({...f.request,operationId:next.operationId}),/protected startup/);assert.equal(f.calls.length,1);
  f.stopped(true);assert.equal((await other.stopCompartment("personal")).stopped,true);assert.equal((await f.store.snapshot("personal")).repositoryExecutions[0].status,"outcome-unconfirmed");
  const retry=await f.port(other,next).start({...f.request,operationId:next.operationId});assert.equal((await retry.wait()).terminalEvidence,"trusted");assert.equal(f.effects(),2);
});
test("scope revocation before readiness prevents effects and shutdown cannot accept a late native result",async t=>{
  const before=await fixture(t,async stage=>{if(stage==="before-ready")before.authorize(false);});await assert.rejects(before.port().start(before.request),/protected startup/);assert.equal(before.effects(),0);
  let enter;const entered=new Promise(r=>{enter=r;});const f=await fixture(t,async(stage,{options,store})=>{if(stage==="effect"){enter();await new Promise(resolve=>{options.signal.addEventListener("abort",resolve,{once:true});if(options.signal.aborted)resolve();});assert.equal(typeof (await store.snapshot("personal")).repositoryExecutions[0].stopRequestedAt,"number","workspace cancellation must be durable before abort delivery");}});
  const p=await f.port().start(f.request);await entered;const stop=f.service.stopCompartment("personal");assert.equal((await p.wait()).terminalEvidence,"ambiguous");assert.equal((await stop).stopped,true);assert.equal((await f.store.snapshot("personal")).repositoryExecutions[0].status,"outcome-unconfirmed");
  assert.equal((await f.port().observeOperation(f.request)).status,"cancelled","verified stop can settle cancellation without inventing a program result");
});
test("actual Linux supervised execution returns only after protected native readiness and independent exit",{skip:process.platform!=="linux"},async t=>{
  const f=await fixture(t), native=f.create({command:runRuntimeCommand,guardianStopped:runtimeGuardianStopped});
  const request={...f.request,args:["-e","process.stdout.write('native exact output')"],environment:{PATH:"/usr/bin:/bin"}};
  const p=await f.port(native).start(request), text=output(p.stdout);assert.equal((await p.wait()).code,0);assert.equal(await text,"native exact output");
  const row=(await f.store.snapshot("personal")).repositoryExecutions[0];assert.equal(await runtimeGuardianStopped(row.ownedRuntime),true);assert.equal(row.stoppedVerified,true);assert.equal(f.effects(),0);
  assert.equal((await f.port(native).observeOperation({...request,authorityId:randomUUID()})).state,"not_owner");
  const tool=join(f.root,"reviewed-printf"),executionRoot=join(f.root,"inputs");await mkdir(executionRoot);await copyFile("/usr/bin/printf",tool);
  const original=sha(await readFile(tool)),binding={...f.binding,operationId:randomUUID()};
  const upgrading=f.create({guardianStopped:runtimeGuardianStopped,command:(exe,args,options)=>runRuntimeCommand(exe,args,{...options,onGuardianReady:async frame=>{await options.onGuardianReady(frame);await rename(tool,tool+"-old");await copyFile("/usr/bin/false",tool);}})});
  const pinned=new LinuxBubblewrapRepositoryProcessSupervisor(f.port(upgrading,binding),{additionalActions:["run_target"],readOnlyDisposable:true});
  const child=await pinned.start({...request,operationId:binding.operationId,executionRoot,cwd:executionRoot,executable:tool,executableSha256:original,args:["reviewed native inode"]}),pinnedOutput=output(child.stdout),diagnostic=output(child.stderr);
  assert.equal((await child.wait()).code,0,await diagnostic);assert.equal(await pinnedOutput,"reviewed native inode");assert.notEqual(sha(await readFile(tool)),original,"atomic tool replacement must not replace the reviewed executable descriptor");
});
