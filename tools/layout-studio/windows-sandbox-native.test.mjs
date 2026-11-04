import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID,createHash } from "node:crypto";
import { mkdtemp,rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { createSuiteStore } from "./suite-store.mjs";
import { scopeHash } from "./confirmations.mjs";
import { createWindowsSandboxNativeCalls,validateWindowsExchangeBinding } from "./windows-sandbox-native.mjs";
const schema="switchyard-windows-sandbox-cli/v1",sha=value=>createHash("sha256").update(value).digest("hex");
const syntheticExchange=operationId=>({schema:"switchyard-windows-bounded-volume/v1",operationId,stagingRoot:`C:\\owned\\disk-${operationId}`,stagingIdentity:{device:"1",inode:"2"},imageIdentity:{device:"1",inode:"3"},mountIdentity:{device:"1",inode:"4"},footerSha256:"b".repeat(64),volumeGuid:`\\\\?\\Volume{${randomUUID()}}\\`});
// Explicit native/VM doubles. This suite tests the protected transport, not WSB.
async function fixture(t){
  const root=await mkdtemp(join(tmpdir(),"switchyard-sandbox-native-contract-")),keys=new Map(),owners=new Map(),services=[];
  const store=createSuiteStore({root:join(root,"private"),secrets:{get:async(c,p)=>keys.get(c+p),set:async(c,p,v)=>{keys.set(c+p,v);}}});await store.initialize("personal");
  const context={operationId:randomUUID(),sandboxId:randomUUID(),scopeDigest:"a".repeat(64),provider:"codex"},configuration="synthetic bounded configuration";
  const exchangeBinding=syntheticExchange(context.operationId);
  await store.update("personal","fixture",state=>{state.mode="personal-companion";state.repositoryWindowsGuests=[{...context,configurationSha256:sha(configuration),exchangeBindingSha256:scopeHash(exchangeBinding),status:"reserved",stoppedVerified:false}];});
  let effects=0,stopped=true,active=true,badInventory=false,observationHook=async()=>{};
  const command=async(exe,args,options)=>{
    assert.equal(exe,process.execPath);assert.deepEqual(args,["--windows-sandbox-cli"]);
    const input=JSON.parse(options.inputText),scope={schema:"switchyard-runtime-command/v1",id:randomUUID(),guardianPid:12345,birth:"1",containment:process.platform==="win32"?"windows-job":"owned-linux-session"};owners.set(scope.id,false);
    try{
      await options.onGuardianReady(scope);effects++;
      const record=(await store.snapshot("personal")).repositoryWindowsGuestCommands.at(-1);assert.equal(record.ownedRuntime.id,scope.id);assert.equal(record.status,"running");assert.equal(record.stoppedVerified,false);
      let value={schema,action:input.action,status:"available",aliasType:"current-user-AppExecLink",effectStarted:false};
      if(input.action==="list")value={schema,action:input.action,status:"observed",ids:badInventory?null:[],effectStarted:false};
      if(input.action==="start")value={schema,action:input.action,status:"started",sandboxId:input.sandboxId,configurationSha256:input.configurationSha256,effectStarted:true};
      if(input.action==="execute")value={schema,action:input.action,status:"executed",sandboxId:input.sandboxId,guestExitCode:7,effectStarted:true};
      if(input.action==="stop")value={schema,action:input.action,status:"stopped",sandboxId:input.sandboxId,absentObserved:true,effectStarted:true};
      await observationHook(input.action);return {status:"completed",exitCode:0,inputDelivered:true,treeExitVerified:true,stdout:JSON.stringify(value)};
    }finally{owners.set(scope.id,true);}
  };
  const create=()=>{const service=createWindowsSandboxNativeCalls({store,stateDirectory:join(root,"commands"),platform:"win32",helper:process.execPath,command,guardianStopped:async scope=>stopped&&owners.get(scope.id)===true,isActive:async()=>active});services.push(service);return service;};
  const service=create(),start={action:"start",sandboxId:context.sandboxId,configuration,configurationSha256:sha(configuration),exchangeBinding},authorize=async()=>{};
  t.after(async()=>{stopped=true;for(const s of services){await s.recover("personal");await s.close();}await rm(root,{recursive:true,force:true});});
  return {store,service,create,context,start,authorize,effects:()=>effects,setStopped:value=>{stopped=value;},setActive:value=>{active=value;},observationHook:fn=>{observationHook=fn;},badInventory:()=>{badInventory=true;},call:input=>service.call("personal",context,input,authorize)};
}
test("native Sandbox commands persist ownership before acknowledgement and retain the guest exit code separately",async t=>{
  const f=await fixture(t);assert.equal((await f.call({action:"metadata"})).effectStarted,false);assert.equal((await f.call(f.start)).status,"started");
  const executed=await f.call({action:"execute",sandboxId:f.context.sandboxId,catalogRelativePath:"sandbox-job.json",timeoutMs:5000});assert.equal(executed.guestExitCode,7,"CLI exit zero is not guest exit zero");
  assert.equal((await f.call({action:"stop",sandboxId:f.context.sandboxId})).absentObserved,true);
  const before=f.effects();await f.store.update("personal","synthetic-retire-command-history",state=>{state.repositoryWindowsGuestCommands=[];});
  const duplicate=await f.call({action:"execute",sandboxId:f.context.sandboxId,catalogRelativePath:"sandbox-job.json",timeoutMs:5000});assert.equal(duplicate.replayed,true);assert.equal(duplicate.guestExitCode,7);assert.equal(f.effects(),before,"VM tombstones survive retired command history");
});
test("malformed inventory, foreign VM IDs, changed configuration and inactive scope cannot authorize native effects",async t=>{
  const f=await fixture(t);for(const input of [{action:"shell",command:"untrusted"},{...f.start,sandboxId:randomUUID()},{...f.start,configuration:"changed"},{...f.start,command:"injected"}])await assert.rejects(f.call(input));assert.equal(f.effects(),0);
  f.setActive(false);await assert.rejects(f.call(f.start));assert.equal(f.effects(),0);f.setActive(true);f.badInventory();await assert.rejects(f.call({action:"list"}),/unknown, not empty/);
});
test("a failed native readiness write delivers no VM request and cannot replay its reserved start",async t=>{
  const f=await fixture(t),original=f.store.update;let fail=true;f.store.update=async(...args)=>{if(fail&&args[1]==="windows-guest-native-ready"){fail=false;throw Error("Synthetic lost native readiness");}return original(...args);};
  await assert.rejects(f.call(f.start));assert.equal(f.effects(),0);const duplicate=await f.call(f.start);assert.equal(duplicate.replayed,true);assert.equal(duplicate.status,"outcome-unconfirmed");assert.equal(f.effects(),0);assert.equal((await f.store.snapshot("personal")).repositoryWindowsGuests[0].startVerified,undefined);
});
test("unknown native exit blocks replacement across instances without inventing a stopped guest",async t=>{
  const f=await fixture(t);f.setStopped(false);await assert.rejects(f.call(f.start));const other=f.create();await assert.rejects(other.call("personal",f.context,{action:"metadata"},f.authorize),/unknown exit/);assert.equal(f.effects(),1);await assert.rejects(other.close(),/guardian exit is unknown/);
  f.setStopped(true);assert.equal(await f.service.recover("personal"),true);assert.equal((await f.store.snapshot("personal")).repositoryWindowsGuests[0].stoppedVerified,false);assert.equal((await f.call(f.start)).replayed,true);assert.equal(f.effects(),1);
});
test("a lost native result write preserves an uncertain start and original native owner without a second VM effect",async t=>{
  const f=await fixture(t),original=f.store.update;let fail=true;f.store.update=async(...args)=>{if(fail&&args[1]==="windows-guest-native-result"){fail=false;throw Error("Synthetic lost native result");}return original(...args);};
  await assert.rejects(f.call(f.start));assert.equal(f.effects(),1);const row=(await f.store.snapshot("personal")).repositoryWindowsGuestCommands[0];assert.equal(row.stoppedVerified,true);assert.ok(row.ownedRuntime);assert.equal(row.status,"outcome-unconfirmed");const duplicate=await f.call(f.start);assert.equal(duplicate.replayed,true);assert.equal(duplicate.status,"outcome-unconfirmed");assert.equal(f.effects(),1);
});
test("revocation after native creation preserves exact ownership facts for cleanup while refusing another program action",async t=>{
  const f=await fixture(t);f.observationHook(async action=>{if(action==="start")f.setActive(false);});
  assert.equal((await f.call(f.start)).status,"started");assert.equal((await f.store.snapshot("personal")).repositoryWindowsGuests[0].startVerified,true);
  await assert.rejects(f.call({action:"execute",sandboxId:f.context.sandboxId,catalogRelativePath:"sandbox-job.json",timeoutMs:5000}));assert.equal(f.effects(),1);
  const stopped=await f.service.call("personal",f.context,{action:"stop",sandboxId:f.context.sandboxId},f.authorize,{cleanup:true});assert.equal(stopped.absentObserved,true);assert.equal(f.effects(),2);
});

test("only an exact bounded exchange binding can reach native start admission",async t=>{
  const f=await fixture(t),binding=f.start.exchangeBinding;
  assert.deepEqual(validateWindowsExchangeBinding(binding,f.context.operationId),binding);
  for(const exchangeBinding of [undefined,{...binding,operationId:randomUUID()},{...binding,mountIdentity:{device:"1",inode:"replacement"}},{...binding,volumeGuid:"C:\\"},{...binding,stagingRoot:"C:\\ordinary"},{...binding,quota:true}])await assert.rejects(f.call({...f.start,exchangeBinding}));
  const altered={...binding,footerSha256:"c".repeat(64)};await assert.rejects(f.call({...f.start,exchangeBinding:altered}),/protected guest ownership/);assert.equal(f.effects(),0);
});
