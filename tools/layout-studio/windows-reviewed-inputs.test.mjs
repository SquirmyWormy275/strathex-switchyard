import test from "node:test";
import assert from "node:assert/strict";
import { createHash, randomUUID } from "node:crypto";
import { mkdtemp, mkdir, readFile, writeFile, readdir, rename, rm, access } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { createSuiteStore } from "./suite-store.mjs";
import { createWindowsReviewedInputs } from "./windows-reviewed-inputs.mjs";
import { directoryIdentity } from "./private-fs.mjs";
const hash=bytes=>createHash("sha256").update(bytes).digest("hex");
const identity=stat=>({device:stat.dev.toString(),inode:stat.ino.toString()});

// The native command here is an explicit contract double. Actual NTFS sharing,
// ACL and reparse-point checks belong to the separate Windows native journey.
async function fixture(t,hook) {
  const root=await mkdtemp(join(tmpdir(),"switchyard-windows-input-contract-")),repositoryRoot=join(root,"repository"),stateDirectory=join(root,"inputs"),keys=new Map(),owners=new Map(),services=[];
  await mkdir(repositoryRoot);await mkdir(join(repositoryRoot,"src"));await writeFile(join(repositoryRoot,"src/task.bin"),Buffer.from([0,1,255,128]));await writeFile(join(repositoryRoot,"unselected.env"),"synthetic unselected credential");
  const store=createSuiteStore({root:join(root,"private"),secrets:{get:async(c,p)=>keys.get(c+p),set:async(c,p,v)=>{keys.set(c+p,v);}}});await store.initialize("personal");await store.update("personal","fixture-mode",state=>{state.mode="personal-companion";});
  let effects=0,stopped=true,consumerExited=true,authorized=true;
  const command=async(exe,args,options)=>{
    assert.equal(exe,process.execPath);assert.deepEqual(args,["--stage-reviewed-inputs"]);const request=JSON.parse(options.inputText),scope={schema:"switchyard-runtime-command/v1",id:randomUUID(),guardianPid:12345,birth:"1",containment:process.platform==="win32"?"windows-job":"owned-linux-session"};owners.set(scope.id,false);
    try{
      await options.onGuardianReady(scope);effects++;
      const row=(await store.snapshot("personal")).repositoryWindowsInputs[0];assert.equal(row.ownedRuntime.id,scope.id);assert.equal(row.stoppedVerified,false);assert.equal(row.path,request.stagingRoot);await hook?.("effect",{request,options,scope});
      for(const file of request.inputFiles){const bytes=await readFile(join(request.sourceRoot,file.path));assert.equal(hash(bytes),file.sha256);assert.equal(bytes.length,file.size);const path=join(request.stagingRoot,file.path);await mkdir(dirname(path),{recursive:true});await writeFile(path,bytes);}
      await hook?.("after-copy",{request,options,scope});
      return {status:"completed",exitCode:0,inputDelivered:true,treeExitVerified:true,stdout:JSON.stringify({schema:request.schema,operationId:request.operationId,sourceIdentity:request.sourceIdentity,stagingIdentity:request.stagingIdentity,inputManifestSha256:request.inputManifestSha256,files:request.inputFiles.length,bytes:request.inputFiles.reduce((sum,file)=>sum+file.size,0),privateAclReadbackVerified:true,classification:"reviewed-non-production-bytes",sandboxEnforced:false}),stderr:""};
    }finally{owners.set(scope.id,true);}
  };
  const create=(options={})=>{const service=createWindowsReviewedInputs({store,stateDirectory,platform:"win32",helper:process.execPath,command,guardianStopped:async scope=>stopped&&owners.get(scope.id)===true,consumerStopped:async()=>consumerExited,...options});services.push(service);return service;};
  const service=create(),context={operationId:randomUUID(),scopeDigest:"a".repeat(64),provider:"codex"},input={repositoryRoot,sourceIdentity:identity(await directoryIdentity(repositoryRoot)),inputFiles:[{path:"src/task.bin",sha256:hash(Buffer.from([0,1,255,128])),size:4,classification:"non-production"}]},authorize=async()=>{if(!authorized)throw Error("Synthetic task scope revoked");};
  t.after(async()=>{stopped=true;consumerExited=true;for(const scope of owners.keys())owners.set(scope,true);await Promise.all(services.map(service=>service.close()));await rm(root,{recursive:true,force:true});});
  return {root,store,repositoryRoot,service,create,context,input,authorize,effects:()=>effects,stopped:value=>{stopped=value;},consumer:value=>{consumerExited=value;},authorized:value=>{authorized=value;}};
}
test("Windows input contract persists readiness, copies only reviewed binary bytes and makes no sandbox claim",async t=>{
  const f=await fixture(t),lease=await f.service.prepare("personal",f.context,f.input,f.authorize);assert.deepEqual(await readFile(join(lease.root,"src/task.bin")),Buffer.from([0,1,255,128]));assert.deepEqual(await readdir(lease.root),["src"]);assert.equal(lease.sandboxEnforced,false);assert.equal(Object.hasOwn(lease,"protections"),false);await lease.withConsumer(()=>lease.assertCurrent());
  await assert.rejects(f.service.prepare("personal",f.context,f.input,f.authorize),/Reconcile|exists|owned/);assert.equal(f.effects(),1);f.consumer(false);await assert.rejects(lease.release(),/guest exit/);await access(lease.root);f.consumer(true);await lease.release();await assert.rejects(access(lease.root),{code:"ENOENT"});assert.equal((await f.service.list("personal"))[0].cleanupPending,false);
});
test("unknown native reader exit blocks replacement across instances and leaves staging until independently observed",async t=>{
  const f=await fixture(t);f.stopped(false);await assert.rejects(f.service.prepare("personal",f.context,f.input,f.authorize));await assert.rejects(f.service.close(),/exit remains unconfirmed/);
  const other=f.create();await assert.rejects(other.prepare("personal",{...f.context,operationId:randomUUID()},f.input,f.authorize),/Reconcile/);assert.equal(f.effects(),1);f.stopped(true);assert.equal((await other.recover("personal")).cleanupPending,false);assert.equal((await other.list("personal"))[0].status,"outcome-unconfirmed");
});
test("unexpected files, modified inputs and replacement directories cannot pass handoff or cleanup",async t=>{
  const foreign=await fixture(t,async(stage,{request})=>{if(stage==="after-copy")await writeFile(join(request.stagingRoot,"foreign"),"preserve");});await assert.rejects(foreign.service.prepare("personal",foreign.context,foreign.input,foreign.authorize),/unfamiliar/);const row=(await foreign.store.snapshot("personal")).repositoryWindowsInputs[0];await assert.rejects(foreign.service.cleanup("personal",row.operationId),/unfamiliar/);assert.equal(await readFile(join(row.path,"foreign"),"utf8"),"preserve");
  const f=await fixture(t),lease=await f.service.prepare("personal",f.context,f.input,f.authorize);await writeFile(join(lease.root,"src/task.bin"),"changed");await assert.rejects(lease.assertCurrent(),/changed/);await assert.rejects(lease.release(),/changed/);await rename(lease.root,lease.root+"-original");await mkdir(lease.root);await writeFile(join(lease.root,"foreign"),"replacement");await assert.rejects(lease.release(),/replaced/);assert.equal(await readFile(join(lease.root,"foreign"),"utf8"),"replacement");
});
test("a failed readiness write starts no native copy, while stopped scopes cannot accept late copy results",async t=>{
  const before=await fixture(t),original=before.store.update;let fail=true;before.store.update=async(...args)=>{if(fail&&args[1]==="windows-inputs-native-ready"){fail=false;throw Error("Synthetic readiness persistence failure");}return original(...args);};await assert.rejects(before.service.prepare("personal",before.context,before.input,before.authorize));assert.equal(before.effects(),0);assert.equal((await before.service.list("personal"))[0].status,"not-started");await before.service.cleanup("personal",before.context.operationId);
  let entered,release;const ready=new Promise(resolve=>{entered=resolve;}),hold=new Promise(resolve=>{release=resolve;});const f=await fixture(t,async(stage,{options})=>{if(stage==="effect"){entered();await hold;if(options.signal.aborted)throw Error("Synthetic cancellation");}});
  const pending=f.service.prepare("personal",f.context,f.input,f.authorize).catch(error=>error);await ready;const stop=f.service.stopCompartment("personal");release();assert.match((await pending).message,/cancellation|stopped/);assert.equal((await stop).stopped,true);assert.equal((await f.service.list("personal"))[0].cleanupPending,false);
});
