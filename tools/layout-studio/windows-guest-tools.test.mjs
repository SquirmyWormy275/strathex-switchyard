import test from"node:test";
import assert from"node:assert/strict";
import{randomUUID,createHash}from"node:crypto";
import{mkdtemp,mkdir,writeFile,readFile,lstat,link,rename,rm,access}from"node:fs/promises";
import{join}from"node:path";
import{tmpdir}from"node:os";
import{createSuiteStore}from"./suite-store.mjs";
import{createWindowsGuestTools}from"./windows-guest-tools.mjs";
const sha=bytes=>createHash("sha256").update(bytes).digest("hex");
// Explicit native/ACL doubles. Only a small owned synthetic file is linked;
// neither the installed Node runtime nor a real Windows guest is touched.
async function fixture(t,hook=async()=>{}){
  const root=await mkdtemp(join(tmpdir(),"switchyard-guest-tools-contract-")),helper=join(root,"Switchyard.Hotkeys.exe"),bytes=Buffer.from("synthetic embedded guest worker"),keys=new Map(),owners=new Map(),services=[];await writeFile(helper,bytes,{mode:0o600});
  const store=createSuiteStore({root:join(root,"private"),secrets:{get:async(c,p)=>keys.get(c+p),set:async(c,p,v)=>{keys.set(c+p,v);}}});await store.initialize("personal");await store.update("personal","fixture",s=>{s.mode="personal-companion";});
  let effects=0,stopped=true,consumer=true;
  const command=async(exe,args,options)=>{assert.equal(exe,helper);assert.deepEqual(args,["--stage-guest-tools"]);const input=JSON.parse(options.inputText),scope={schema:"switchyard-runtime-command/v1",id:randomUUID(),guardianPid:12345,birth:"1",containment:process.platform==="win32"?"windows-job":"owned-linux-session"};owners.set(scope.id,false);
    try{await options.onGuardianReady(scope);effects++;const record=(await store.snapshot("personal")).repositoryWindowsTools.find(row=>row.operationId===input.operationId);assert.equal(record.ownedRuntime.id,scope.id);assert.equal(record.stoppedVerified,false);await link(helper,join(input.stagingRoot,"b122-sandbox-worker.exe"));await hook(input);return{status:"completed",exitCode:0,inputDelivered:true,treeExitVerified:true,stdout:JSON.stringify({schema:input.schema,operationId:input.operationId,sourceIdentity:input.sourceIdentity,stagingIdentity:input.stagingIdentity,sha256:sha(bytes),linkedBytes:bytes.length,copiedBytes:0,toolName:"b122-sandbox-worker.exe",privateAclReadbackVerified:true,workerEmbedded:true,sandboxEnforced:false})};}finally{owners.set(scope.id,true);}
  };
  const create=()=>{const service=createWindowsGuestTools({store,stateDirectory:join(root,"tools"),helper,platform:"win32",command,guardianStopped:async scope=>stopped&&owners.get(scope.id)===true,consumerStopped:async()=>consumer});services.push(service);return service;};
  const service=create(),context={operationId:randomUUID(),scopeDigest:"a".repeat(64),provider:"codex"},input={expectedSha256:sha(bytes)},authorize=async()=>{};
  t.after(async()=>{stopped=true;consumer=true;for(const service of services)await service.close();await rm(root,{recursive:true,force:true});});
  return{root,helper,store,service,context,input,authorize,create,effects:()=>effects,setStopped:value=>{stopped=value;},consumer:value=>{consumer=value;},prepare:()=>service.prepare("personal",context,input,authorize)};
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
