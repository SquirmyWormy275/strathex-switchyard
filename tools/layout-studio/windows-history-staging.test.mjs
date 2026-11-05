import test from "node:test";
import assert from "node:assert/strict";
import { createHash, randomUUID } from "node:crypto";
import { access, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { tmpdir } from "node:os";
import { createSuiteStore } from "./suite-store.mjs";
import { createWindowsReviewedInputs } from "./windows-reviewed-inputs.mjs";
import { directoryIdentity } from "./private-fs.mjs";
const sha = bytes => createHash("sha256").update(bytes).digest("hex");
const identity = value => ({ device: value.dev.toString(), inode: value.ino.toString() });

// Native NTFS/ACL behavior is explicitly doubled here; the real C# packet parser
// runs separately in portable proof. No guest, provider account or device opens.
async function fixture(t, alterProof = proof => proof) {
  const root=await mkdtemp(join(tmpdir(),"switchyard-windows-history-stage-")),repository=join(root,"repository"),stateDirectory=join(root,"inputs"),keys=new Map(),owners=new Map();await mkdir(repository);await writeFile(join(repository,"live.js"),"clean worktree source");await writeFile(join(repository,"unselected.env"),"synthetic unselected credential");
  const store=createSuiteStore({root:join(root,"protected"),secrets:{get:async(c,p)=>keys.get(c+p),set:async(c,p,v)=>{keys.set(c+p,v);}}});await store.initialize("personal");await store.update("personal","synthetic-mode",state=>{state.mode="personal-companion";});let effects=0;
  const command=async(_executable,args,options)=>{
    assert.deepEqual(args,["--stage-reviewed-inputs"]);const request=JSON.parse(options.inputText),scope={schema:"switchyard-runtime-command/v1",id:randomUUID(),guardianPid:12345,birth:"1",containment:process.platform==="win32"?"windows-job":"owned-linux-session"};owners.set(scope.id,false);await options.onGuardianReady(scope);effects++;
    try{
      const encoded=new Map((request.historyInputs?.files??[]).map(file=>[file.path,file.contentBase64]));
      for(const file of request.inputFiles){const bytes=encoded.has(file.path)?Buffer.from(encoded.get(file.path),"base64"):await readFile(join(request.sourceRoot,file.path));assert.equal(bytes.length,file.size);assert.equal(sha(bytes),file.sha256);const destination=join(request.stagingRoot,file.path);await mkdir(dirname(destination),{recursive:true});await writeFile(destination,bytes);}
      const proof={schema:request.schema,operationId:request.operationId,sourceIdentity:request.sourceIdentity,stagingIdentity:request.stagingIdentity,inputManifestSha256:request.inputManifestSha256,files:request.inputFiles.length,bytes:request.inputFiles.reduce((n,f)=>n+f.size,0),privateAclReadbackVerified:true,classification:"reviewed-non-production-bytes",sandboxEnforced:false,...(request.historyInputs?{historyPacketSha256:sha(JSON.stringify(request.historyInputs)),historyWitnessSha256:sha(JSON.stringify(request.historyInputs.witness))}:{})};
      return{status:"completed",exitCode:0,inputDelivered:true,treeExitVerified:true,stdout:JSON.stringify(alterProof(proof)),stderr:""};
    }finally{owners.set(scope.id,true);}
  };
  const service=createWindowsReviewedInputs({store,stateDirectory,platform:"win32",helper:process.execPath,command,guardianStopped:async scope=>owners.get(scope.id)===true,consumerStopped:async()=>true});t.after(async()=>{await service.close();await rm(root,{recursive:true,force:true});});
  const bytes=Buffer.from("SYNTHETIC_HISTORY_ONLY_PRIVATE_SOURCE\n"),path=".switchyard-history/"+"a".repeat(40)+"/live.js",row={commit:"a".repeat(40),path:"live.js",mode:"100644",objectId:createHash("sha1").update(`blob ${bytes.length}\0`).update(bytes).digest("hex"),size:bytes.length,sha256:sha(bytes)},inputFiles=[{path:"live.js",sha256:sha("clean worktree source"),size:Buffer.byteLength("clean worktree source"),classification:"non-production"},{path,sha256:row.sha256,size:row.size,classification:"non-production"}],input={repositoryRoot:repository,sourceIdentity:identity(await directoryIdentity(repository)),inputFiles},options={action:"shield_codebase_audit",historyWitness:{source:"git-history",head:"a".repeat(40),paths:["live.js"],requestedDepth:4,historyMetadataSha256:"b".repeat(64),stopping:{kind:"root",nextFirstParent:null},shallow:false,rows:[row]},historyBytes:new Map([[path,{bytes,mode:"100644"}]])};
  return{root,store,service,repository,input,options,bytes,context:{operationId:randomUUID(),scopeDigest:"a".repeat(64),provider:"codex"},authorize:async()=>{},effects:()=>effects};
}
test("Windows staging port verifies exact native packet/witness hashes, keeps original bytes and persists no source packet",async t=>{
  const f=await fixture(t),lease=await f.service.prepare("personal",f.context,f.input,f.authorize,f.options);assert.equal(f.effects(),1);assert.deepEqual(await readFile(join(lease.root,".switchyard-history", "a".repeat(40),"live.js")),f.bytes);assert.equal(await readFile(join(lease.root,"live.js"),"utf8"),"clean worktree source");await assert.rejects(access(join(lease.root,"unselected.env")),{code:"ENOENT"});await assert.rejects(access(join(f.repository,".switchyard-history")),{code:"ENOENT"});
  const state=await f.store.snapshot("personal"),serialized=JSON.stringify(state),row=state.repositoryWindowsInputs[0];assert.match(row.proof.historyPacketSha256,/^[a-f0-9]{64}$/);assert.equal(row.proof.historyWitnessSha256,sha(JSON.stringify(f.options.historyWitness)));assert.equal(serialized.includes(f.bytes.toString()),false);assert.equal(serialized.includes(f.bytes.toString("base64")),false);assert.equal(Object.hasOwn(row,"historyInputs"),false);assert.equal(lease.sandboxEnforced,false);
  await lease.release();await assert.rejects(access(lease.root),{code:"ENOENT"});assert.equal((await f.store.snapshot("personal")).repositoryWindowsInputs[0].cleanupPending,false);assert.equal(await readFile(join(f.repository,"live.js"),"utf8"),"clean worktree source");
});
test("changed or missing native history digests refuse handoff while independently stopped owned copies are cleaned",async t=>{
  for(const field of ["historyPacketSha256","historyWitnessSha256","missing"]){await t.test(field,async t=>{const f=await fixture(t,proof=>{if(field==="missing"){delete proof.historyPacketSha256;delete proof.historyWitnessSha256;}else proof[field]="c".repeat(64);return proof;});await assert.rejects(f.service.prepare("personal",f.context,f.input,f.authorize,f.options),/packet|proof/);assert.equal(f.effects(),1);await f.service.recover("personal");const row=(await f.store.snapshot("personal")).repositoryWindowsInputs[0];assert.equal(row.cleanupPending,false);assert.notEqual(row.status,"staged");await assert.rejects(access(row.path),{code:"ENOENT"});});}
});
test("private Windows staging refuses general actions, unknown fields and changed buffers before native startup or reservation",async t=>{
  const f=await fixture(t);
  for(const options of [{...f.options,action:"run_target"},{...f.options,command:"invented"},{...f.options,historyBytes:new Map()}])await assert.rejects(f.service.prepare("personal",f.context,f.input,f.authorize,options));
  assert.equal(f.effects(),0);assert.equal((await f.store.snapshot("personal")).repositoryWindowsInputs?.length??0,0);
});
test("complete encoded Windows request retains the original 512 KiB bound and cleans its empty owned reservation",async t=>{
  const f=await fixture(t),extra=Array.from({length:1000},(_,i)=>({path:`d${i}-`+"a".repeat(240)+"/"+"b".repeat(240),sha256:sha(""),size:0,classification:"non-production"}));
  await assert.rejects(f.service.prepare("personal",f.context,{...f.input,inputFiles:[...f.input.inputFiles,...extra]},f.authorize,f.options),/original 512 KiB/);assert.equal(f.effects(),0);await f.service.recover("personal");const row=(await f.store.snapshot("personal")).repositoryWindowsInputs[0];assert.equal(row.cleanupPending,false);await assert.rejects(access(row.path),{code:"ENOENT"});
});
