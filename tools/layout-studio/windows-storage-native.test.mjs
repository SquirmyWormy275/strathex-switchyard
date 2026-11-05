import test from "node:test";
import assert from "node:assert/strict";
import {randomUUID,createHash} from "node:crypto";
import {mkdtemp,writeFile,rm} from "node:fs/promises";
import {join} from "node:path";
import {tmpdir} from "node:os";
import {createSuiteStore} from "./suite-store.mjs";
import {createWindowsStorageNative} from "./windows-storage-native.mjs";
const sha=value=>createHash("sha256").update(value).digest("hex"),clientSid="S-1-5-21-1-2-3-1001";
async function fixture(t){
 const root=await mkdtemp(join(tmpdir(),"switchyard-storage-port-")),keys=new Map(),helperPath=join(root,"Switchyard.Hotkeys.exe"),setupPath=join(root,"Switchyard.Setup.exe");await writeFile(helperPath,"inert helper fixture");await writeFile(setupPath,"inert setup fixture");
 const store=createSuiteStore({root:join(root,"state"),secrets:{get:async(c,p)=>keys.get(c+p),set:async(c,p,v)=>{keys.set(c+p,v);}}});await store.initialize("personal");const owners=new Map(),calls=[];let installed=null,effects=0,knownExit=true,brokerHandler=null;
 const command=async(executable,args,options)=>{
  const frame={schema:"switchyard-runtime-command/v1",id:randomUUID(),guardianPid:12345,birth:"1",containment:"windows-job"};owners.set(frame.id,false);calls.push({executable,args,options});
  let value,exitCode=0;
  try{
   await options.onGuardianReady(frame);const row=(await store.snapshot("personal")).windowsStorageNative.find(row=>row.ownedRuntime?.id===frame.id);assert.equal(row.status,"running");assert.equal(row.stoppedVerified,false);
   if(executable===setupPath&&args[0]==="--metadata")value={schema:"switchyard-windows-native-setup/v1",status:"available",clientSid,effectStarted:false};
   else if(executable===helperPath){const proposal=JSON.parse(options.inputText);if(brokerHandler&&proposal.action!=="metadata")value=await brokerHandler(proposal);else{assert.deepEqual(proposal,{schema:"switchyard-windows-storage-broker-host/v1",action:"metadata"});value={schema:"switchyard-windows-storage-broker-host/v1",action:"metadata",brokerImplemented:false,effectStarted:false,...(installed?{status:"bootstrap-ready",...installed,protocolVerified:true,storage:{privilegeStateUnchanged:true,effectStarted:false,brokerImplemented:false}}:{status:"unavailable",installationAbsentVerified:true})};}}
   else {effects++;assert.equal(executable,setupPath);assert.equal(args[1],clientSid);if(args[0]==="--install-bootstrap")installed={installationId:args[2],serviceImageSha256:args[3],ownerScope:sha(clientSid)};else if(args[0]==="--remove-bootstrap"){assert.equal(args[4],installed.serviceImageSha256);installed=null;}else throw Error("Unexpected native action");value={schema:"switchyard-windows-native-setup/v1",status:"completed",effectStarted:true};}
  }finally{owners.set(frame.id,true);}
  return {status:"completed",exitCode,stdout:JSON.stringify(value),stderr:"",treeExitVerified:true,inputDelivered:true};
 };
 const native=createWindowsStorageNative({store,platform:"win32",helperPath,setupPath,command,guardianStopped:async frame=>knownExit&&owners.get(frame.id)===true});
 t.after(async()=>{knownExit=true;for(const id of owners.keys())owners.set(id,true);await native.close();await rm(root,{recursive:true,force:true});});return {root,store,native,helperPath,setupPath,calls,effects:()=>effects,knownExit:value=>{knownExit=value;},brokerHandler:value=>{brokerHandler=value;}};
}
test("fixed storage transport persists readiness and independent exit for metadata and exact setup/remove",async t=>{
 const f=await fixture(t),binding=await f.native.identity();assert.deepEqual(binding,{clientSid,ownerScope:sha(clientSid),helperSha256:sha("inert helper fixture"),setupSha256:sha("inert setup fixture")});assert.equal((await f.native.observe(binding)).installationAbsentVerified,true);
 const installationId=randomUUID(),scope={action:"install-bootstrap",installationId,brokerImageSha256:binding.helperSha256,binding};assert.equal((await f.native.perform(scope)).status,"completed");assert.equal(f.effects(),1);assert.equal((await f.native.observe(binding)).installationId,installationId);
 assert.equal((await f.native.perform({...scope,action:"remove-bootstrap"})).status,"completed");assert.equal((await f.native.observe(binding)).status,"unavailable");assert.equal(f.effects(),2);
 const rows=(await f.store.snapshot("personal")).windowsStorageNative;assert.equal(rows.length,6);assert.equal(rows.every(row=>row.status==="settled"&&row.stoppedVerified===true&&row.resultDigest),true);assert.equal((await f.native.reconcile()).stopped,true);
 assert.equal(f.calls.every(call=>call.options.captureStderrBytes===0&&call.options.expectedExecutableSha256&&call.options.windowsHelper===f.helperPath),true);
});
test("changed reviewed helper/setup bytes and invalid scope fail before any setup action",async t=>{
 for(const target of ["helperPath","setupPath"]){const f=await fixture(t),binding=await f.native.identity(),before=f.calls.length;await writeFile(f[target],"changed installed image");await assert.rejects(f.native.perform({action:"install-bootstrap",installationId:randomUUID(),brokerImageSha256:binding.helperSha256,binding}),/changed/);assert.equal(f.calls.length,before);assert.equal(f.effects(),0);}
 const f=await fixture(t),binding=await f.native.identity();for(const extra of [{action:"shell"},{installationId:"foreign"},{brokerImageSha256:"b".repeat(64)}])await assert.rejects(f.native.perform({action:"install-bootstrap",installationId:randomUUID(),brokerImageSha256:binding.helperSha256,binding,...extra}));assert.equal(f.effects(),0);
});
test("failed protected readiness prevents the native action and retains a conservative no-start observation",async t=>{
 const f=await fixture(t),binding=await f.native.identity(),update=f.store.update;let fault=true;f.store.update=async(...args)=>{if(fault&&args[1]==="windows-storage-native-ready"){fault=false;throw Error("Synthetic lost readiness");}return update(...args);};
 await assert.rejects(f.native.perform({action:"install-bootstrap",installationId:randomUUID(),brokerImageSha256:binding.helperSha256,binding}));assert.equal(f.effects(),0);const last=(await f.store.snapshot("personal")).windowsStorageNative.at(-1);assert.equal(last.status,"not-started");assert.equal(last.stoppedVerified,true);
});
test("unknown native exit blocks new metadata and actions until the original guardian independently exits",async t=>{
 const f=await fixture(t),binding=await f.native.identity();f.knownExit(false);await assert.rejects(f.native.observe(binding));const count=f.calls.length;assert.equal((await f.native.reconcile()).stopped,false);await assert.rejects(f.native.identity(),/no independent exit/);assert.equal(f.calls.length,count);f.knownExit(true);assert.equal((await f.native.reconcile()).stopped,true);assert.equal((await f.native.observe(binding)).status,"unavailable");
});
test("the Windows-only storage transport cannot select a fallback on another platform",async()=>{
 let calls=0;const native=createWindowsStorageNative({platform:"linux",command:async()=>{calls++;}});await assert.rejects(native.identity(),/unavailable/);assert.equal(calls,0);await native.close();
});
const hostSchema="switchyard-windows-storage-broker-host/v1",proof=(state,effectStarted)=>({state,effectStarted,attached:state==="mounted",mounted:state==="mounted",detachedVerified:["created","detached","retired"].includes(state),exchangeQuotaEnforced:state==="mounted",virtualBytes:67108864,backingBytes:67109376,sandboxEnforced:false});
async function exchangeFixture(t){
 const f=await fixture(t),binding=await f.native.identity(),installation={installationId:randomUUID(),ownerScope:binding.ownerScope,serviceImageSha256:"c".repeat(64)},request={installation,verb:"create",requestId:randomUUID(),operationId:randomUUID(),taskScopeSha256:"d".repeat(64),inputManifestSha256:"e".repeat(64)};
 const answer=(input,extra={})=>({...input,status:input.action==="exchange-result"?"recorded":"exchange-observed",protocolVerified:true,proof:proof({create:"created",inspect:"mounted",attach:"mounted",detach:"detached",retire:"retired"}[input.verb],input.verb!=="inspect"),brokerImplemented:false,...(input.action==="exchange-result"?{effectStarted:false}:{}),...extra});
 f.brokerHandler(input=>answer(input));return {...f,binding,installation,request,answer};
}
test("broker capability observation requires an exact fresh authenticated installation and cannot start an exchange",async t=>{
 const f=await exchangeFixture(t);f.brokerHandler(input=>({schema:hostSchema,action:input.action,status:"available",exchangeSupported:true,effectStarted:false,brokerImplemented:false,protocolVerified:true,...f.installation}));
 const result=await f.native.probeExchange(f.binding);assert.equal(result.status,"available");assert.deepEqual(result.installation,f.installation);assert.equal(result.nativeExitVerified,true);assert.equal(f.effects(),0);
 f.brokerHandler(input=>({schema:hostSchema,action:input.action,status:"unavailable",exchangeSupported:false,effectStarted:false,brokerImplemented:false}));assert.equal((await f.native.probeExchange(f.binding)).status,"unavailable");
 f.brokerHandler(input=>({schema:hostSchema,action:input.action,status:"available",exchangeSupported:true,effectStarted:true,brokerImplemented:false,protocolVerified:true,...f.installation}));await assert.rejects(f.native.probeExchange(f.binding),/capability/);
});
test("fixed exchange and read-only result lookup preserve original IDs and native ownership without replaying a missing effect",async t=>{
 const f=await exchangeFixture(t),observed=await f.native.exchange(f.binding,f.request);assert.equal(observed.status,"observed");assert.equal(observed.proof.state,"created");assert.equal(observed.nativeExitVerified,true);
 for(const status of ["absent","reserved","recorded"]){f.brokerHandler(input=>f.answer(input,{status,proof:status==="recorded"?proof("created",true):null}));const result=await f.native.lookupExchange(f.binding,f.request);assert.equal(result.status,status);assert.equal(result.nativeExitVerified,true);assert.deepEqual(result.proof,status==="recorded"?proof("created",true):null);}
 const inputs=f.calls.filter(call=>call.executable===f.helperPath).map(call=>JSON.parse(call.options.inputText));assert.deepEqual(inputs.map(input=>input.action),["exchange","exchange-result","exchange-result","exchange-result"]);assert.equal(inputs.every(input=>input.requestId===f.request.requestId&&input.operationId===f.request.operationId&&input.installationId===f.installation.installationId),true);
 assert.equal((await f.store.snapshot("personal")).windowsStorageNative.every(row=>row.stoppedVerified===true&&row.status==="settled"),true);
});
test("unfamiliar exchange selectors fail before a native command, while substituted peer scope and quota claims are rejected",async t=>{
 const f=await exchangeFixture(t),before=f.calls.length;
 for(const extra of [{path:"C:\\foreign"},{approved:true},{virtualBytes:1},{verb:"format"},{requestId:"foreign"}])await assert.rejects(f.native.exchange(f.binding,{...f.request,...extra}));assert.equal(f.calls.length,before);
 for(const extra of [{operationId:randomUUID()},{ownerScope:"f".repeat(64)},{proof:proof("mounted",true)},{proof:{...proof("created",true),virtualBytes:134217728}},{proof:{...proof("created",true),exchangeQuotaEnforced:true}},{protocolVerified:false},{unknown:true}]){f.brokerHandler(input=>f.answer(input,extra));await assert.rejects(f.native.exchange(f.binding,f.request));}
 f.brokerHandler(input=>f.answer(input,{status:"reserved",proof:proof("created",true)}));await assert.rejects(f.native.lookupExchange(f.binding,f.request),/unrecorded/);
});
test("native mapping requires the exact original broker, operation, task and input manifest",async t=>{
 const f=await exchangeFixture(t),{verb,requestId,...request}=f.request,mapped={schema:"switchyard-windows-bounded-volume/v1",operationId:request.operationId,stagingRoot:`C:\\protected\\disk-${request.operationId}`,stagingIdentity:{device:"1",inode:"2"},imageIdentity:{device:"1",inode:"3"},mountIdentity:{device:"1",inode:"4"},footerSha256:"f".repeat(64),volumeGuid:`\\\\?\\Volume{${randomUUID()}}\\`,broker:{...f.installation,taskScopeSha256:request.taskScopeSha256,inputManifestSha256:request.inputManifestSha256}};
 f.brokerHandler(input=>({schema:hostSchema,action:input.action,status:"mapping-verified",binding:mapped,protocolVerified:true,effectStarted:false,brokerImplemented:false}));assert.deepEqual((await f.native.exchangeBinding(f.binding,request)).binding,mapped);
 for(const field of ["installationId","taskScopeSha256","inputManifestSha256"]){const original=mapped.broker[field];mapped.broker[field]=field==="installationId"?randomUUID():"a".repeat(64);await assert.rejects(f.native.exchangeBinding(f.binding,request));mapped.broker[field]=original;}
 mapped.broker.approved=true;await assert.rejects(f.native.exchangeBinding(f.binding,request));
});
test("changed installed helper bytes cannot send any previously observed broker effect",async t=>{
 const f=await exchangeFixture(t),before=f.calls.length;await writeFile(f.helperPath,"changed source bytes");await assert.rejects(f.native.exchange(f.binding,f.request),/changed/);assert.equal(f.calls.length,before);
});
