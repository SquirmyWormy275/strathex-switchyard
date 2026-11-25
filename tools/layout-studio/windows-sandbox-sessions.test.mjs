import test from "node:test";
import assert from "node:assert/strict";
import {randomUUID,createHash}from"node:crypto";
import {mkdtemp,mkdir,rm}from"node:fs/promises";
import {join}from"node:path";
import {tmpdir}from"node:os";
import {createSuiteStore}from"./suite-store.mjs";
import {privateWrite}from"./private-fs.mjs";
import {createWindowsSandboxSessions}from"./windows-sandbox-sessions.mjs";
const sha=value=>createHash("sha256").update(value).digest("hex");
const syntheticExchange=operationId=>({schema:"switchyard-windows-bounded-volume/v1",operationId,stagingRoot:`C:\\owned\\disk-${operationId}`,stagingIdentity:{device:"1",inode:"2"},imageIdentity:{device:"1",inode:"3"},mountIdentity:{device:"1",inode:"4"},footerSha256:"b".repeat(64),volumeGuid:`\\\\?\\Volume{${randomUUID()}}\\`});
// Explicit native/VM doubles; none of these tests allocate a Windows guest.
async function fixture(t){
  const root=await mkdtemp(join(tmpdir(),"switchyard-guest-session-contract-")),keys=new Map(),guests=new Set(),calls=[],stopResults=new Map(),services=[];
  const store=createSuiteStore({root:join(root,"private"),secrets:{get:async(c,p)=>keys.get(c+p),set:async(c,p,v)=>{keys.set(c+p,v);}}});await store.initialize("personal");await store.update("personal","fixture",state=>{state.mode="personal-companion";});
  const binding={operationId:randomUUID(),scopeDigest:"a".repeat(64),provider:"codex"},cwd=join(root,"lease"),configuration="synthetic exact configuration",configPath=join(cwd,"sandbox.wsb");await mkdir(cwd,{mode:0o700});await privateWrite(configPath,configuration);
  let clock=Date.now(),active=true,nativeExited=true,stopAllowed=true,hold=false,entered,hook=async()=>{},acknowledged=false,unknownStart=null;
  const entry=new Promise(resolve=>{entered=resolve;});
  const native={recover:async()=>nativeExited,close:async()=>{},call:async(c,context,input,authorize,options={})=>{
    assert.equal(c,"personal");if(!options.cleanup)await authorize();calls.push(input.action);
    if(input.action==="metadata"){assert.equal(context.operationId,binding.operationId);assert.equal(context.scopeDigest,binding.scopeDigest);assert.equal((await store.snapshot(c)).repositoryWindowsGuests?.length??0,0);return{status:"available",effectStarted:false};}
    const row=(await store.snapshot(c)).repositoryWindowsGuests.find(row=>row.operationId===context.operationId);assert.equal(row.sandboxId,context.sandboxId);
    if(input.action==="start"){
      if(unknownStart){const id=randomUUID();if(unknownStart==="exact")guests.add(context.sandboxId);if(unknownStart==="foreign")guests.add(randomUUID());await store.update(c,"synthetic-lost-native-start",state=>{state.repositoryWindowsGuests[0].nativeStartCommandId=id;state.repositoryWindowsGuestCommands=[{...context,id,action:"start",startAcknowledged:true,stoppedVerified:true,ownedRuntime:{schema:"switchyard-runtime-command/v1",id:randomUUID(),guardianPid:12345,birth:"1",containment:process.platform==="win32"?"windows-job":"owned-linux-session"}}];});throw Error("Synthetic interrupted native creation");}
      guests.add(context.sandboxId);await store.update(c,"synthetic-native-start",state=>{const row=state.repositoryWindowsGuests[0];row.startVerified=true;row.nativeStartCommandId=randomUUID();});await hook("after-start");return{status:"started",sandboxId:context.sandboxId};
    }
    if(input.action==="connect"){assert.equal(acknowledged,true);return{status:"connection-requested"};}
    if(input.action==="probe-login")return{status:"executed",guestExitCode:0};
    if(input.action==="execute"){
      assert.equal(acknowledged,true);assert.ok(row.workerRequestedAt);await hook("execute");
      if(hold){entered();await new Promise((resolve,reject)=>{const abort=()=>reject(Error("Synthetic cancelled guest worker"));options.signal.addEventListener("abort",abort,{once:true});if(options.signal.aborted)abort();});}
      return{status:"executed",guestExitCode:0};
    }
    if(input.action==="stop"){
      if(stopResults.has(context.sandboxId))return stopResults.get(context.sandboxId);
      if(stopAllowed)guests.delete(context.sandboxId);const value={status:stopAllowed?"stopped":"outcome-unconfirmed"};stopResults.set(context.sandboxId,value);return value;
    }
    if(input.action==="list")return{status:"observed",ids:[...guests]};
    throw Error("Unexpected synthetic native action");
  }};
  const create=()=>{const service=createWindowsSandboxSessions({store,stateDirectory:join(root,"sessions"),platform:"win32",native,isActive:async()=>active,now:()=>clock,sleep:async ms=>{clock+=ms;}});services.push(service);return service;};
  const service=create(),runner=service.forOperation("personal",binding,async()=>{}),spec={executable:"C:\\Windows\\System32\\WindowsSandbox.exe",args:[configPath],cwd,shell:false,environment:{SystemRoot:"C:\\Windows",WINDIR:"C:\\Windows"},timeoutMs:process.platform==="win32"?60000:5000,maxOutputBytes:4096,reviewedGuest:{operationId:binding.operationId,configurationSha256:sha(configuration)},reviewedExchangeBinding:syntheticExchange(binding.operationId),reviewedCatalogRelativePath:"sandbox-job.json"};
  const ready=async identity=>{assert.equal(identity.operationId,binding.operationId);assert.equal(identity.configurationSha256,sha(configuration));assert.equal((await store.snapshot("personal")).repositoryWindowsGuests[0].startVerified,true);acknowledged=true;};
  t.after(async()=>{active=true;nativeExited=true;guests.clear();if(unknownStart)await store.update("personal","dispose-explicit-fake-guests",state=>{for(const row of state.repositoryWindowsGuests??[])row.stoppedVerified=true;});for(const service of services){await service.recover("personal");await service.close();}await rm(root,{recursive:true,force:true});});
  return{store,service,runner,create,spec,binding,ready,calls,entered:entry,hold:()=>{hold=true;},unknownStart:value=>{unknownStart=value;},active:value=>{active=value;},stopAllowed:value=>{stopAllowed=value;},observeAbsent:()=>guests.clear(),hook:fn=>{hook=fn;},run:(signal=new AbortController().signal,onReady=ready)=>runner.run(spec,signal,()=>{throw Error("A CLI guardian is not a viewer PID");},onReady)};
}
test("prerequisite metadata uses an exact authorized host binding without reserving or adopting a guest",async t=>{
 const f=await fixture(t);let authorizations=0;assert.equal((await f.service.metadata("personal",f.binding,async()=>{authorizations++;})).effectStarted,false);assert.equal(authorizations,1);assert.deepEqual(f.calls,["metadata"]);assert.equal((await f.store.snapshot("personal")).repositoryWindowsGuests?.length??0,0);
 await assert.rejects(f.service.metadata("personal",{...f.binding,pid:123},async()=>{}));await assert.rejects(f.service.metadata("personal",f.binding,async()=>{throw Error("Revoked preflight");}),/Revoked/);assert.deepEqual(f.calls,["metadata"]);
});
test("managed guest lifecycle acknowledges exact ownership before one worker and verifies VM exit separately from native command exit",async t=>{
  const f=await fixture(t),result=await f.run();assert.equal(result.exitCode,0);assert.equal(result.hostProcessContained,true);assert.equal(result.guestSessionExit.stopped,true);assert.equal(result.pid,undefined);assert.deepEqual(f.calls,["start","connect","probe-login","execute","stop","list"]);assert.equal(await f.service.consumerStopped("personal",f.binding.operationId),true);
  await assert.rejects(f.run(),/already exists/);assert.equal(f.calls.filter(c=>c==="execute").length,1);assert.equal((await f.service.list("personal"))[0].exchangeQuotaEnforced,true);
});
test("failed guest acknowledgement starts no worker and still stops the exact newly owned guest",async t=>{
  const f=await fixture(t),result=await f.run(undefined,async()=>{throw Error("Synthetic lost backend guest identity write");});assert.equal(result.exitCode,null);assert.equal(result.guestSessionExit.stopped,true);assert.deepEqual(f.calls,["start","stop","list"]);assert.equal((await f.service.list("personal"))[0].status,"outcome-unconfirmed");
});
test("workspace revocation after observed creation retains enough ownership to stop without acknowledging another effect",async t=>{
  const f=await fixture(t);f.hook(async phase=>{if(phase==="after-start")f.active(false);});const result=await f.run();assert.equal(result.exitCode,null);assert.equal(result.guestSessionExit.stopped,true);assert.deepEqual(f.calls,["start","stop","list"]);
});
test("mode shutdown cancels the owned worker and waits for independent VM exit without a viewer PID",async t=>{
  const f=await fixture(t);f.hold();const running=f.run();await Promise.race([f.entered,running.then(()=>{throw Error("The worker never entered its owned wait");})]);const stopped=f.service.stopCompartment("personal"),result=await running;assert.equal((await stopped).stopped,true);assert.equal(result.cancelled,true);assert.equal(result.guestSessionExit.stopped,true);assert.equal(await f.service.consumerStopped("personal",f.binding.operationId),true);assert.equal(f.calls.filter(c=>c==="execute").length,1);
});
test("unknown VM stop blocks replacement and independent later absence recovers only exit without replaying the worker",async t=>{
  const f=await fixture(t);f.stopAllowed(false);const result=await f.run();assert.equal(result.guestSessionExit,undefined);assert.equal(await f.service.consumerStopped("personal",f.binding.operationId),false);const other=f.create();assert.equal((await other.recover("personal")).stopped,false);assert.equal(f.calls.filter(c=>c==="execute").length,1);
  f.observeAbsent();const runner=other.forOperation("personal",f.binding,async()=>{}),proof=await runner.reconcileReviewedOperation({...f.spec.reviewedGuest,knownSandboxId:(await f.store.snapshot("personal")).repositoryWindowsGuests[0].sandboxId});assert.equal(proof.stopped,true);assert.equal((await other.list("personal"))[0].status,"outcome-unconfirmed");assert.equal(f.calls.filter(c=>c==="execute").length,1);
});
test("a lost final guest state write retains native exit and cannot replay the same operation",async t=>{
  const f=await fixture(t),original=f.store.update;let fail=true;f.store.update=async(...args)=>{if(fail&&args[1]==="windows-guest-session-result"){fail=false;throw Error("Synthetic lost guest result write");}return original(...args);};await assert.rejects(f.run(),/lost guest result/);assert.equal(await f.service.consumerStopped("personal",f.binding.operationId),true);await f.service.recover("personal");assert.equal((await f.service.list("personal"))[0].status,"outcome-unconfirmed");await assert.rejects(f.run(),/already exists/);assert.equal(f.calls.filter(c=>c==="execute").length,1);
});
test("interrupted creation can stop only its exact acknowledged nonce; empty or foreign inventory cannot prove a pending start stopped",async t=>{
  for(const inventory of ["empty","foreign","exact"]){const f=await fixture(t);f.unknownStart(inventory);const result=await f.run();assert.equal(result.exitCode,null);assert.equal(f.calls.includes("execute"),false);const row=(await f.store.snapshot("personal")).repositoryWindowsGuests[0];assert.equal(row.stoppedVerified,inventory==="exact",inventory);assert.equal(f.calls.includes("stop"),inventory==="exact",inventory);assert.equal(row.recoveredStartWithoutReplay===true,inventory==="exact",inventory);}
});

test("managed startup requires the exact bounded volume binding before reserving or starting any guest",async t=>{
 const f=await fixture(t);
 for(const reviewedExchangeBinding of [undefined,{...f.spec.reviewedExchangeBinding,operationId:randomUUID()},{...f.spec.reviewedExchangeBinding,stagingRoot:"C:\\ordinary"}])await assert.rejects(f.runner.run({...f.spec,reviewedExchangeBinding},new AbortController().signal,()=>{},f.ready),/bounded Windows exchange/);
 assert.deepEqual(f.calls,[]);assert.equal((await f.store.snapshot("personal")).repositoryWindowsGuests?.length??0,0);
 assert.equal((await f.run()).guestSessionExit.stopped,true);
});
