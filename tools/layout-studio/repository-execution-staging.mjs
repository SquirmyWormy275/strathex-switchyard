/** Owned input copies may be removed only after every recorded guardian exited. */
import { readdir, rm } from "node:fs/promises";
import { join, dirname } from "node:path";
import { LinuxDisposableExecutionRootProvider } from "../../apps/linux-companion/src/linux-repository-inputs.ts";
import { NodeFileDigestReader } from "../../packages/control-plane/src/git-inspector.ts";
import { directoryIdentity } from "./private-fs.mjs";
import { runtimeGuardianStopped } from "./runtime-command.mjs";
const identity = s => `${s.dev}:${s.ino}`;
export function createRepositoryExecutionStaging({store,stateDirectory,guardianStopped=runtimeGuardianStopped,providerFactory=(root,options)=>new LinuxDisposableExecutionRootProvider(root,options)}={}) {
  const leases=new Map(), reader=new NodeFileDigestReader({maxFileBytes:4*1024*1024});
  async function mark(c,id,fn) {return store.update(c,"repository-execution-staging",s=>{const row=s.repositoryExecutionStaging?.find(r=>r.operationId===id);if(!row)throw Error("The execution staging identity changed.");return fn(row);});}
  async function exactContents(row) {
    const expected=new Map(row.inputFiles.map(f=>[f.path,f])), files=[];
    async function walk(path="") {
      for(const entry of await readdir(join(row.path,path),{withFileTypes:true})) {
        const relative=path?`${path}/${entry.name}`:entry.name;
        if(entry.isSymbolicLink())throw Error("A symbolic link appeared in execution staging; preserve it for review.");
        if(entry.isDirectory()) {if(![...expected.keys()].some(p=>p.startsWith(relative+"/")))throw Error("An unowned staging directory appeared; preserve it for review.");await walk(relative);}
        else if(entry.isFile()) {if(!expected.has(relative))throw Error("An unowned staging file appeared; preserve it for review.");files.push(relative);}
        else throw Error("An unfamiliar staging entry appeared; preserve it for review.");
      }
    }
    await walk(); if(files.length!==expected.size)throw Error("The reviewed staging input set changed; preserve it for review.");
    for(const path of files) {const read=await reader.read(row.path,path);try{if(read.digest!==`sha256:${expected.get(path).sha256}`||read.bytes.length!==expected.get(path).size)throw Error("A staged input changed after review; preserve it for recovery.");}finally{read.bytes.fill(0);}}
  }
  async function cleanup(c,operationId) {
    const state=await store.snapshot(c), row=state.repositoryExecutionStaging?.find(r=>r.operationId===operationId);
    if(!row||!row.cleanupPending)return {cleaned:true};
    if(row.schema!=="switchyard-execution-staging/v1"||dirname(row.path)!==join(stateDirectory,c,"repository-execution-roots")||!/^inputs-[A-Za-z0-9]{6}$/.test(row.path.split(/[\\/]/).at(-1)))throw Error("Preserve staging with an unfamiliar protected path.");
    for(const native of state.repositoryExecutions?.filter(r=>r.operationId===operationId)??[]) {
      if(native.ownedRuntime&&!await guardianStopped(native.ownedRuntime))return {cleaned:false,reason:"native-exit-unconfirmed"};
      if(!native.ownedRuntime&&native.status!=="not-started")return {cleaned:false,reason:"native-start-outcome-unconfirmed"};
    }
    let current;try{current=await directoryIdentity(row.path);}catch(error){if(error.code!=="ENOENT")throw error;await mark(c,operationId,r=>{r.cleanupPending=false;r.removalObserved=true;});return {cleaned:true};}
    if(identity(current)!==row.identity)throw Error("The original execution staging directory was replaced; preserve it for review.");
    await exactContents(row);
    if(identity(await directoryIdentity(row.path))!==row.identity)throw Error("Execution staging changed before cleanup.");
    const lease=leases.get(`${c}:${operationId}`);if(lease)await lease.release();else await rm(row.path,{recursive:true});
    leases.delete(`${c}:${operationId}`);await mark(c,operationId,r=>{r.cleanupPending=false;});return {cleaned:true};
  }
  return {
    async prepare(c,context,input,authorize,{indexBytes,historyBytes}={}) {
      if(input.isolation!=="disposable"||!input.inputFiles?.length)throw Error("Connected execution requires exact reviewed disposable inputs.");
      await authorize();const lease=await providerFactory(join(stateDirectory,c),{indexBytes,historyBytes}).prepare(input), nativeIdentity=identity(await directoryIdentity(lease.root));
      let saved=false;
      try {
        await store.update(c,"repository-execution-staging-reserve",s=>{
          const rows=s.repositoryExecutionStaging??[],retained=rows.filter(r=>r.cleanupPending);s.repositoryExecutionStaging=[...retained,...rows.filter(r=>!retained.includes(r)).slice(-16)];
          if(s.repositoryExecutionStaging.length>=64||s.repositoryExecutionStaging.some(r=>r.operationId===context.operationId))throw Error("The owned staging inventory is full or already reserved.");
          s.repositoryExecutionStaging.push({schema:"switchyard-execution-staging/v1",operationId:context.operationId,scopeDigest:context.scopeDigest,path:lease.root,identity:nativeIdentity,inputFiles:structuredClone(input.inputFiles),cleanupPending:true});
        });saved=true;leases.set(`${c}:${context.operationId}`,lease);await authorize();
        return {...lease,release:()=>cleanup(c,context.operationId)};
      }catch(error){if(saved)await cleanup(c,context.operationId);else await lease.release();throw error;}
    },
    cleanup,
    async cleanupCompartment(c) {let pending=false;for(const r of (await store.snapshot(c)).repositoryExecutionStaging??[])if(r.cleanupPending){try{if(!(await cleanup(c,r.operationId)).cleaned)pending=true;}catch{pending=true;}}return {cleanupPending:pending};}
  };
}
