import test from "node:test";
import assert from "node:assert/strict";
import { createHash, randomUUID } from "node:crypto";
import { mkdtemp, mkdir, writeFile, readFile, access, rename, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createSuiteStore } from "./suite-store.mjs";
import { directoryIdentity } from "./private-fs.mjs";
import { createRepositoryExecutionStaging } from "./repository-execution-staging.mjs";
const sha=v=>createHash("sha256").update(v).digest("hex");
async function fixture(t){
  const root=await mkdtemp(join(tmpdir(),"switchyard-execution-staging-")),keys=new Map(),stateDirectory=join(root,"inputs");
  const store=createSuiteStore({root:join(root,"private"),secrets:{get:async(c,p)=>keys.get(c+p),set:async(c,p,v)=>{keys.set(c+p,v);}}});await store.initialize("personal");
  t.after(()=>rm(root,{recursive:true,force:true}));let stopped=false;
  const service=()=>createRepositoryExecutionStaging({store,stateDirectory,guardianStopped:async()=>stopped});
  const operationId=randomUUID(),base=join(stateDirectory,"personal","repository-execution-roots");await mkdir(base,{recursive:true});const path=await mkdtemp(join(base,"inputs-"));await writeFile(join(path,"exact"),"reviewed");const id=await directoryIdentity(path);
  await store.update("personal","synthetic-staging",s=>{s.repositoryExecutionStaging=[{schema:"switchyard-execution-staging/v1",operationId,path,identity:`${id.dev}:${id.ino}`,inputFiles:[{path:"exact",size:8,sha256:sha("reviewed"),classification:"non-production"}],cleanupPending:true}];s.repositoryExecutions=[{operationId,status:"outcome-unconfirmed",ownedRuntime:{id:randomUUID()}}];});
  return {root,store,path,operationId,service,stopped:v=>{stopped=v;}};
}
test("cleanup preserves live or changed staging and does not upgrade the original unknown execution outcome",async t=>{
  const f=await fixture(t),service=f.service();assert.equal((await service.cleanup("personal",f.operationId)).cleaned,false);assert.equal(await readFile(join(f.path,"exact"),"utf8"),"reviewed");
  f.stopped(true);await writeFile(join(f.path,"exact"),"changed!");await assert.rejects(service.cleanup("personal",f.operationId),/changed/);await writeFile(join(f.path,"exact"),"reviewed");
  await writeFile(join(f.path,"unowned"),"preserve");await assert.rejects(service.cleanup("personal",f.operationId),/unowned/);assert.equal(await readFile(join(f.path,"unowned"),"utf8"),"preserve");await rm(join(f.path,"unowned"));
  assert.equal((await service.cleanup("personal",f.operationId)).cleaned,true);await assert.rejects(access(f.path),{code:"ENOENT"});assert.equal((await f.store.snapshot("personal")).repositoryExecutions[0].status,"outcome-unconfirmed");
});
test("a fresh staging service removes only the original stopped input directory and retains replacements",async t=>{
  const f=await fixture(t);f.stopped(true);await rename(f.path,f.path+"-retained");await mkdir(f.path);await writeFile(join(f.path,"foreign"),"preserve");
  assert.equal((await f.service().cleanupCompartment("personal")).cleanupPending,true);assert.equal(await readFile(join(f.path,"foreign"),"utf8"),"preserve");assert.equal(await readFile(join(f.path+"-retained","exact"),"utf8"),"reviewed");
  await rm(f.path,{recursive:true});await rename(f.path+"-retained",f.path);assert.equal((await f.service().cleanupCompartment("personal")).cleanupPending,false);
  assert.equal((await f.store.snapshot("personal")).repositoryExecutionStaging[0].cleanupPending,false);
});
