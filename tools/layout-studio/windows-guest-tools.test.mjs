import test from"node:test";
import assert from"node:assert/strict";
import{randomUUID,createHash}from"node:crypto";
import{mkdtemp,mkdir,writeFile,readFile,lstat,link,rename,rm,access,unlink,readdir}from"node:fs/promises";
import{join}from"node:path";
import{tmpdir}from"node:os";
import{createSuiteStore}from"./suite-store.mjs";
import{createWindowsGuestTools}from"./windows-guest-tools.mjs";
const sha=bytes=>createHash("sha256").update(bytes).digest("hex");
// Explicit native/ACL doubles. Only a small owned synthetic file is linked;
// neither the installed Node runtime nor a real Windows guest is touched.
async function fixture(t,hook=async()=>{},{withNode=false,omitNode=false}={}){
  const root=await mkdtemp(join(tmpdir(),"switchyard-guest-tools-contract-")),helper=join(root,"Switchyard.Hotkeys.exe"),bytes=Buffer.from("synthetic embedded guest worker"),keys=new Map(),owners=new Map(),services=[];await writeFile(helper,bytes,{mode:0o600});
  const nodePath=join(root,"node.exe"),nodeBytes=Buffer.from("synthetic guest Node runtime"),recipeRuntime=withNode?{path:nodePath,sha256:sha(nodeBytes)}:undefined;if(withNode)await writeFile(nodePath,nodeBytes,{mode:0o600});
  const store=createSuiteStore({root:join(root,"private"),secrets:{get:async(c,p)=>keys.get(c+p),set:async(c,p,v)=>{keys.set(c+p,v);}}});await store.initialize("personal");await store.update("personal","fixture",s=>{s.mode="personal-companion";});
  let effects=0,stopped=true,consumer=true;
  const command=async(exe,args,options)=>{assert.equal(exe,helper);assert.deepEqual(args,["--stage-guest-tools"]);const input=JSON.parse(options.inputText),scope={schema:"switchyard-runtime-command/v1",id:randomUUID(),guardianPid:12345,birth:"1",containment:process.platform==="win32"?"windows-job":"owned-linux-session"};owners.set(scope.id,false);
    try{await options.onGuardianReady(scope);effects++;assert.equal(options.expectedExecutableSha256,sha(bytes));const record=(await store.snapshot("personal")).repositoryWindowsTools.find(row=>row.operationId===input.operationId);assert.equal(record.ownedRuntime.id,scope.id);assert.equal(record.stoppedVerified,false);await link(helper,join(input.stagingRoot,"b122-sandbox-worker.exe"));await hook(input);if(withNode&&!omitNode){assert.equal(input.nodeRuntime.path,nodePath);assert.equal(input.nodeRuntime.sha256,sha(nodeBytes));assert.equal(record.nodeRuntime.expectedSha256,sha(nodeBytes));await link(nodePath,join(input.stagingRoot,"node.exe"));}return{status:"completed",exitCode:0,inputDelivered:true,treeExitVerified:true,stdout:JSON.stringify({schema:input.schema,operationId:input.operationId,sourceIdentity:input.sourceIdentity,stagingIdentity:input.stagingIdentity,sha256:sha(bytes),linkedBytes:bytes.length,copiedBytes:0,toolName:"b122-sandbox-worker.exe",privateAclReadbackVerified:true,workerEmbedded:true,sandboxEnforced:false,...(withNode&&!omitNode?{nodeRuntime:{identity:input.nodeRuntime.identity,sha256:sha(nodeBytes),linkedBytes:nodeBytes.length,filename:"node.exe"}}:{})})};}finally{owners.set(scope.id,true);}
  };
  const create=(overrides={})=>{const service=createWindowsGuestTools({store,stateDirectory:join(root,"tools"),helper,recipeRuntime,platform:"win32",command,guardianStopped:async scope=>stopped&&owners.get(scope.id)===true,consumerStopped:async()=>consumer,...overrides});services.push(service);return service;};
  const service=create(),context={operationId:randomUUID(),scopeDigest:"a".repeat(64),provider:"codex"},input={expectedSha256:sha(bytes)},authorize=async()=>{};
  t.after(async()=>{stopped=true;consumer=true;for(const service of services)await service.close();await rm(root,{recursive:true,force:true});});
  return{root,helper,nodePath,nodeBytes,recipeRuntime,store,service,context,input,authorize,create,effects:()=>effects,setStopped:value=>{stopped=value;},consumer:value=>{consumer=value;},prepare:()=>service.prepare("personal",context,input,authorize)};
}
test("guest worker staging retains one exact hard-linked inode without a runtime copy and waits for guest exit",async t=>{
  const f=await fixture(t),original=await readFile(f.helper),lease=await f.prepare(),source=await lstat(f.helper,{bigint:true}),target=await lstat(join(lease.root,lease.helperFilename),{bigint:true});assert.equal(target.dev,source.dev);assert.equal(target.ino,source.ino);assert.equal(lease.copiedBytes,0);assert.equal(lease.workerEmbedded,true);assert.equal(lease.sandboxEnforced,false);assert.equal(Object.hasOwn(lease,"protections"),false);await lease.assertCurrent();
  await assert.rejects(f.prepare(),/already exists|retained/);assert.equal(f.effects(),1);f.consumer(false);await assert.rejects(lease.release(),/guest exit/);await access(lease.root);f.consumer(true);await lease.release();await assert.rejects(access(lease.root),{code:"ENOENT"});assert.deepEqual(await readFile(f.helper),original);
});
test("unknown native exit blocks replacement and a verified late stop releases the in-process staging slot",async t=>{
  const f=await fixture(t);f.setStopped(false);await assert.rejects(f.prepare());const other=f.create();await assert.rejects(other.prepare("personal",{...f.context,operationId:randomUUID()},f.input,f.authorize),/retained/);assert.equal(f.effects(),1);f.setStopped(true);assert.equal((await f.service.stopCompartment("personal")).stopped,true);
  const next=await f.service.prepare("personal",{...f.context,operationId:randomUUID()},f.input,f.authorize);assert.equal(f.effects(),2);await next.release();
});
test("unfamiliar files, changed tool bytes and replaced directories are preserved instead of handed to a guest or deleted",async t=>{
  const foreign=await fixture(t,async input=>{await writeFile(join(input.stagingRoot,"foreign"),"preserve");});await assert.rejects(foreign.prepare(),/unfamiliar/);const row=(await foreign.store.snapshot("personal")).repositoryWindowsTools[0];await assert.rejects(foreign.service.cleanup("personal",row.operationId),/unfamiliar/);assert.equal(await readFile(join(row.path,"foreign"),"utf8"),"preserve");
  const f=await fixture(t),lease=await f.prepare();await rename(lease.root,lease.root+"-original");await mkdir(lease.root,{mode:0o700});await writeFile(join(lease.root,"foreign"),"replacement");await assert.rejects(lease.release(),/replaced/);assert.equal(await readFile(join(lease.root,"foreign"),"utf8"),"replacement");await rm(lease.root,{recursive:true});await rename(lease.root+"-original",lease.root);await writeFile(join(lease.root,lease.helperFilename),"changed owned synthetic helper");await assert.rejects(lease.assertCurrent(),/changed/);await assert.rejects(lease.release(),/changed/);
});
test("failed readiness and mismatched source pins cannot deliver a native tool-link request",async t=>{
  const f=await fixture(t);await assert.rejects(f.service.prepare("personal",f.context,{expectedSha256:"f".repeat(64)},f.authorize),/bytes changed/);await assert.rejects(f.service.prepare("personal",f.context,{...f.input,executable:"untrusted"},f.authorize));assert.equal(f.effects(),0);
  const original=f.store.update;let fail=true;f.store.update=async(...args)=>{if(fail&&args[1]==="windows-tools-native-ready"){fail=false;throw Error("Synthetic lost tool readiness");}return original(...args);};await assert.rejects(f.prepare());assert.equal(f.effects(),0);assert.equal((await f.service.list("personal"))[0].status,"not-started");assert.equal((await f.service.cleanup("personal",f.context.operationId)).cleaned,true);
});
test("one trusted pinned Node runtime is hard-linked with the worker without copying or accepting request tool overrides",async t=>{
  const f=await fixture(t,undefined,{withNode:true});f.recipeRuntime.sha256="f".repeat(64);const lease=await f.prepare();assert.deepEqual((await readdir(lease.root)).sort(),["b122-sandbox-worker.exe","node.exe"]);assert.deepEqual(lease.nodeRuntime,{filename:"node.exe",sha256:sha(f.nodeBytes),bytes:f.nodeBytes.length});
  const source=await lstat(f.nodePath,{bigint:true}),target=await lstat(join(lease.root,"node.exe"),{bigint:true});assert.equal(source.dev,target.dev);assert.equal(source.ino,target.ino);assert.equal(lease.copiedBytes,0);await lease.assertCurrent();
  await assert.rejects(f.service.prepare("personal",{...f.context,operationId:randomUUID()},{...f.input,nodeRuntime:{path:f.nodePath,sha256:sha(f.nodeBytes)}},f.authorize));assert.equal(f.effects(),1);await lease.release();assert.deepEqual(await readFile(f.nodePath),f.nodeBytes);await assert.rejects(access(lease.root),{code:"ENOENT"});
});
test("changed, missing and helper-aliased Node runtime pins cannot be handed to a guest",async t=>{
  const before=await fixture(t,undefined,{withNode:true});await writeFile(before.nodePath,"changed source");await assert.rejects(before.prepare(),/bytes changed/);assert.equal(before.effects(),0);
  const aliased=await fixture(t,undefined,{withNode:true});await unlink(aliased.nodePath);await link(aliased.helper,aliased.nodePath);const other=aliased.create({recipeRuntime:{path:aliased.nodePath,sha256:aliased.input.expectedSha256}});await assert.rejects(other.prepare("personal",aliased.context,aliased.input,aliased.authorize),/distinct files/);assert.equal(aliased.effects(),0);
  const missing=await fixture(t,undefined,{withNode:true,omitNode:true});await assert.rejects(missing.prepare(),/Node runtime proof/);assert.equal((await missing.service.cleanup("personal",missing.context.operationId)).cleaned,true);assert.deepEqual(await readFile(missing.nodePath),missing.nodeBytes);
  const changed=await fixture(t,undefined,{withNode:true}),lease=await changed.prepare();await writeFile(join(lease.root,"node.exe"),"changed runtime alias");await assert.rejects(lease.assertCurrent(),/bytes changed/);await assert.rejects(lease.release(),/bytes changed/);await access(join(lease.root,"node.exe"));
});
test("restart cleanup can finish a durably recorded partial two-link removal without deleting foreign entries",async t=>{
  const f=await fixture(t,undefined,{withNode:true}),lease=await f.prepare();await f.store.update("personal","synthetic-cleanup-interruption",state=>{state.repositoryWindowsTools[0].cleanupStarted=true;});await unlink(join(lease.root,lease.helperFilename));await assert.rejects(lease.assertCurrent(),/entered cleanup/);
  await writeFile(join(lease.root,"foreign"),"preserve foreign");await assert.rejects(lease.release(),/unfamiliar/);assert.equal(await readFile(join(lease.root,"foreign"),"utf8"),"preserve foreign");await access(join(lease.root,"node.exe"));await unlink(join(lease.root,"foreign"));const restarted=f.create();assert.equal((await restarted.recover("personal")).cleanupPending,false);await assert.rejects(access(lease.root),{code:"ENOENT"});assert.deepEqual(await readFile(f.nodePath),f.nodeBytes);
});
