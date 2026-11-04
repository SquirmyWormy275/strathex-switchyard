/** Native NTFS input staging. This port grants no host execution or VM containment. */
import { mkdir, readdir, opendir, rmdir, rm } from "node:fs/promises";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { validateRepositoryInputs } from "../../apps/windows-companion/src/repository-inputs.ts";
import { NodeFileDigestReader } from "../../packages/control-plane/src/git-inspector.ts";
import { runOwnedNativeCommand } from "./owned-native-command.mjs";
import { runRuntimeCommand, runtimeGuardianStopped } from "./runtime-command.mjs";
import { privateDirectory, directoryIdentity } from "./private-fs.mjs";
import { scopeHash } from "./confirmations.mjs";

const schema = "switchyard-windows-reviewed-inputs/v1";
const uuid = value => typeof value === "string" && /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/.test(value);
const identity = stat => ({ device: stat.dev.toString(), inode: stat.ino.toString() });
const same = (a,b) => a?.device === b?.device && a?.inode === b?.inode;
const nativeHelper = fileURLToPath(new URL("../../runtime/hotkeys/Switchyard.Hotkeys.exe", import.meta.url));

export function createWindowsReviewedInputs({ store, stateDirectory, platform = process.platform, helper = nativeHelper, command = (exe,args,options) => runRuntimeCommand(exe,args,{...options,windowsHelper:helper}), guardianStopped = scope => runtimeGuardianStopped(scope,{windowsHelper:helper}), consumerStopped = async () => false, isActive = async () => true, now = Date.now } = {}) {
  const resources = new Map(), generations = new Map(), seen = new Set();
  const reader = new NodeFileDigestReader({maxFileBytes:4*1024*1024});
  let closed = false;
  async function update(c,id,action,fn) {
    return store.update(c,action,state=>{const row=state.repositoryWindowsInputs?.find(row=>row.operationId===id);if(!row)throw Error("The protected Windows input staging record changed.");return fn(row);});
  }
  async function verifyTree(root,inputFiles,expectedIdentity,partial=false) {
    if(!same(identity(await directoryIdentity(root)),expectedIdentity))throw Error("The original Windows input directory changed.");
    const expected=new Map(inputFiles.map(file=>[file.path,file])),directories=new Set(),found=[];
    for(const file of inputFiles){const parts=file.path.split("/");for(let end=1;end<parts.length;end++)directories.add(parts.slice(0,end).join("/"));}
    async function walk(at="") {
      for await(const entry of await opendir(join(root,at))){
        const name=at?`${at}/${entry.name}`:entry.name;
        if(entry.isSymbolicLink())throw Error("A link appeared in Windows input staging; preserve it.");
        if(entry.isDirectory()&&directories.has(name))await walk(name);
        else if(entry.isFile()&&expected.has(name))found.push(name);
        else throw Error("An unfamiliar Windows staging entry appeared; preserve it.");
      }
    }
    await walk();
    if(!partial&&found.length!==expected.size)throw Error("The exact Windows input file set changed; preserve it.");
    for(const path of found){const read=await reader.read(root,path);try{if(read.digest!==`sha256:${expected.get(path).sha256}`||read.bytes.length!==expected.get(path).size)throw Error("A reviewed Windows input copy changed; preserve it.");}finally{read.bytes.fill(0);}}
    if(!same(identity(await directoryIdentity(root)),expectedIdentity))throw Error("Windows input staging identity changed during verification.");
    return found;
  }
  async function cleanupUnlocked(c,id) {
    const row=(await store.snapshot(c)).repositoryWindowsInputs?.find(row=>row.operationId===id);
    if(!row?.cleanupPending)return {cleaned:true};
    if(row.schema!==schema||dirname(row.path)!==join(stateDirectory,c)||row.path!==join(stateDirectory,c,`inputs-${id}`))throw Error("Preserve Windows staging with an unfamiliar protected path.");
    if(row.ownedRuntime&&!await guardianStopped(row.ownedRuntime))return {cleaned:false,reason:"native-stager-exit-unconfirmed"};
    if(!row.ownedRuntime&&row.status!=="not-started")return {cleaned:false,reason:"native-stager-start-unconfirmed"};
    if(!await consumerStopped(c,id))return {cleaned:false,reason:"guest-consumer-exit-unconfirmed"};
    let actual;
    try { actual=await directoryIdentity(row.path); }
    catch(error){if(error.code!=="ENOENT")throw error;await update(c,id,"windows-inputs-removal-observed",row=>{row.cleanupPending=false;row.removalObserved=true;});return {cleaned:true};}
    if(!same(identity(actual),row.stagingIdentity))throw Error("The original Windows input directory was replaced; preserve it.");
    const found=await verifyTree(row.path,row.inputFiles,row.stagingIdentity,row.status!=="staged");
    if(!same(identity(await directoryIdentity(row.path)),row.stagingIdentity))throw Error("Windows staging identity changed before cleanup.");
    if(found.length)await rm(row.path,{recursive:true});else await rmdir(row.path);
    await update(c,id,"windows-inputs-cleaned",row=>{row.cleanupPending=false;});return {cleaned:true};
  }
  async function cleanup(c,id) {
    const row=(await store.snapshot(c)).repositoryWindowsInputs?.find(row=>row.operationId===id);
    if(!row?.cleanupPending)return {cleaned:true};
    return store.withResourceLock("repository-execution",scopeHash(["windows-reviewed-inputs",c,row.sourceIdentity]),async lease=>{lease.assert();return cleanupUnlocked(c,id);});
  }
  async function recover(c) {
    seen.add(c);let cleanupPending=false;
    for(const row of (await store.snapshot(c)).repositoryWindowsInputs??[]){
      if(!row.cleanupPending||resources.has(`${c}:${row.operationId}`))continue;
      await store.withResourceLock("repository-execution",scopeHash(["windows-reviewed-inputs",c,row.sourceIdentity]),async lease=>{
        lease.assert();const current=(await store.snapshot(c)).repositoryWindowsInputs.find(current=>current.operationId===row.operationId);
        if(!current.ownedRuntime&&current.status==="reserved")await update(c,row.operationId,"windows-inputs-no-ack-recovery",row=>{if(row.ownedRuntime)throw Error("The exact Windows reader readiness changed.");row.status="not-started";row.stoppedVerified=true;});
        if(current.ownedRuntime&&await guardianStopped(current.ownedRuntime))await update(c,row.operationId,"windows-inputs-exit-observed",row=>{row.stoppedVerified=true;});
        try{if(!(await cleanupUnlocked(c,row.operationId)).cleaned)cleanupPending=true;}catch{cleanupPending=true;}
      });
    }
    return {cleanupPending};
  }
  async function stopCompartment(c) {
    generations.set(c,(generations.get(c)??0)+1);
    const active=[...resources.values()].filter(resource=>resource.compartment===c);active.forEach(resource=>resource.controller.abort());
    await Promise.allSettled(active.map(resource=>resource.done));
    const clients=await Promise.all(active.flatMap(resource=>[...resource.clients].map(client=>client.stop().catch(()=>false))));
    for(const[key,resource]of resources)if(active.includes(resource)&&[...resource.clients].every(client=>client.closed))resources.delete(key);
    let stopped=clients.every(Boolean),cleanupPending=false;
    for(const row of (await store.snapshot(c)).repositoryWindowsInputs??[]){
      if(row.ownedRuntime&&!await guardianStopped(row.ownedRuntime)){stopped=false;continue;}
      if(row.cleanupPending){try{if(!(await cleanup(c,row.operationId)).cleaned)cleanupPending=true;}catch{cleanupPending=true;}}
    }
    return {stopped,cleanupPending};
  }
  return {
    async prepare(c,context,input,authorize) {
      context=structuredClone(context);input=structuredClone(input);
      if(platform!=="win32")throw Error("Native reviewed Windows input staging requires Windows; no host-copy substitute was selected.");
      if(!context||Object.keys(context).some(key=>!["operationId","scopeDigest","provider"].includes(key))||Object.keys(input).some(key=>!["repositoryRoot","sourceIdentity","inputFiles"].includes(key))||!uuid(context.operationId)||!/^[a-f0-9]{64}$/.test(context.scopeDigest??"")||!["codex","claude-code"].includes(context.provider)||typeof authorize!=="function")throw Error("Bind exact Windows input staging to its protected task operation and review.");
      const inputFiles=validateRepositoryInputs(input.inputFiles),sourceIdentity=structuredClone(input.sourceIdentity),generation=generations.get(c)??0,key=`${c}:${context.operationId}`;
      if(resources.has(key)||[...resources.values()].some(resource=>resource.compartment===c))throw Error("This workspace already has an owned Windows input operation; wait for its exact result.");
      const resource={compartment:c,controller:new AbortController(),clients:new Set(),done:null};resources.set(key,resource);seen.add(c);
      const check=async()=>{if(closed||generation!==(generations.get(c)??0)||!await isActive(c))throw Error("This Windows input staging was stopped or its workspace changed.");await store.authorize(c,{provider:context.provider});await authorize();};
      resource.done=(async()=>{
        let reserved=false,readyApproved=false,owner;
        const root=join(stateDirectory,c,`inputs-${context.operationId}`),inputManifestSha256=scopeHash(inputFiles),totalBytes=inputFiles.reduce((sum,file)=>sum+file.size,0);
        try {
          await check();
          if(!same(identity(await directoryIdentity(input.repositoryRoot)),sourceIdentity))throw Error("The exact source directory identity changed before Windows staging.");
          return await store.withResourceLock("repository-execution",scopeHash(["windows-reviewed-inputs",c,sourceIdentity]),async lease=>{
            const current=async()=>{lease.assert();await check();};await current();
            const state=await store.snapshot(c),rows=state.repositoryWindowsInputs??[];
            if(rows.some(row=>row.operationId===context.operationId)||rows.some(row=>row.stoppedVerified!==true&&["reserved","staging","outcome-unconfirmed"].includes(row.status))||rows.filter(row=>row.cleanupPending).reduce((sum,row)=>sum+row.totalBytes,0)+totalBytes>64*1024*1024)throw Error("Reconcile the prior native input reader or retained 64 MiB workspace quota before staging another input set.");
            await privateDirectory(join(stateDirectory,c));await mkdir(root,{mode:0o700});const stagingIdentity=identity(await directoryIdentity(root));
            try {await store.update(c,"windows-inputs-reserve",state=>{const all=state.repositoryWindowsInputs??[],retained=all.filter(row=>row.cleanupPending);state.repositoryWindowsInputs=[...retained,...all.filter(row=>!retained.includes(row)).slice(-16)];if(state.repositoryWindowsInputs.length>=32||state.repositoryWindowsInputs.some(row=>row.operationId===context.operationId)||all.some(row=>row.stoppedVerified!==true&&["reserved","staging","outcome-unconfirmed"].includes(row.status))||retained.reduce((sum,row)=>sum+row.totalBytes,0)+totalBytes>64*1024*1024)throw Error("The protected Windows input inventory or byte quota is full or changed.");state.repositoryWindowsInputs.push({schema,...structuredClone(context),path:root,sourceIdentity,stagingIdentity,inputFiles,inputManifestSha256,totalBytes,status:"reserved",cleanupPending:true,at:now()});});reserved=true;}
            catch(error){if(same(identity(await directoryIdentity(root)),stagingIdentity)&&!(await readdir(root)).length)await rmdir(root);throw error;}
            const request={schema,operationId:context.operationId,sourceRoot:input.repositoryRoot,sourceIdentity,stagingRoot:root,stagingIdentity,inputFiles,inputManifestSha256};
            const result=await runOwnedNativeCommand({executable:helper,args:["--stage-reviewed-inputs"],cwd:root,env:{},text:JSON.stringify(request),resource,signal:resource.controller.signal,timeout:45000,maxOutputBytes:4096,captureStderrBytes:1024,command,guardianStopped,
              onReady:async scope=>{owner=scope;await current();await update(c,context.operationId,"windows-inputs-native-ready",row=>{row.ownedRuntime=scope;row.status="staging";row.stoppedVerified=false;});await current();readyApproved=true;},
              onStopped:async scope=>{if(!await guardianStopped(scope))throw Error("The native input reader exit remains unconfirmed.");await update(c,context.operationId,"windows-inputs-native-exit",row=>{if(row.ownedRuntime&&row.ownedRuntime.id!==scope.id)throw Error("The exact input reader guardian changed.");row.ownedRuntime??=scope;row.stoppedVerified=true;})}
            });
            await current();
            if(result.status!=="completed"||result.exitCode!==0)throw Error("The native Windows reader rejected this exact staging operation; preserve its recorded ownership.");
            const proof=JSON.parse(result.stdout),fields=["schema","operationId","sourceIdentity","stagingIdentity","inputManifestSha256","files","bytes","privateAclReadbackVerified","classification","sandboxEnforced"];
            if(Object.keys(proof).sort().join()!==fields.sort().join()||proof.schema!==schema||proof.operationId!==context.operationId||!same(proof.sourceIdentity,sourceIdentity)||!same(proof.stagingIdentity,stagingIdentity)||proof.inputManifestSha256!==inputManifestSha256||proof.files!==inputFiles.length||proof.bytes!==totalBytes||proof.privateAclReadbackVerified!==true||proof.classification!=="reviewed-non-production-bytes"||proof.sandboxEnforced!==false)throw Error("The exact native Windows staging proof did not verify.");
            await verifyTree(root,inputFiles,stagingIdentity);
            await current();await update(c,context.operationId,"windows-inputs-staged",row=>{row.status="staged";row.proof=proof;});
            return {operationId:context.operationId,scopeDigest:context.scopeDigest,sourceRoot:input.repositoryRoot,root,inputManifestSha256,sourceIdentity,stagingIdentity,inputFiles,privateAclReadbackVerified:true,sandboxEnforced:false,
              assertCurrent:()=>store.withResourceLock("repository-execution",scopeHash(["windows-reviewed-inputs",c,sourceIdentity]),async lease=>{lease.assert();await check();await verifyTree(root,inputFiles,stagingIdentity);}),
              withConsumer:fn=>store.withResourceLock("repository-execution",scopeHash(["windows-reviewed-consumer",c,sourceIdentity]),async lease=>{lease.assert();await check();await verifyTree(root,inputFiles,stagingIdentity);return fn();}),
              release:async()=>{const result=await cleanup(c,context.operationId);if(!result.cleaned)throw Error("Windows input cleanup awaits independently verified native and guest exit.");}};
          });
        } catch(error) {
          const stopped=owner?await guardianStopped(owner).catch(()=>false):true;
          if(reserved)await update(c,context.operationId,"windows-inputs-unconfirmed",row=>{row.status=readyApproved?"outcome-unconfirmed":"not-started";if(owner&&!row.ownedRuntime)row.ownedRuntime=owner;row.stoppedVerified=stopped;}).catch(()=>{});
          throw error;
        } finally {
          const stops=await Promise.all([...resource.clients].map(client=>client.stop().catch(()=>false)));
          if(stops.every(Boolean)&&(!owner||await guardianStopped(owner)))resources.delete(key);
        }
      })();
      return resource.done;
    },
    cleanup,recover,stopCompartment,
    async list(c){return ((await store.snapshot(c)).repositoryWindowsInputs??[]).map(row=>({operationId:row.operationId,status:row.status,cleanupPending:row.cleanupPending,stoppedVerified:row.stoppedVerified===true,sandboxEnforced:false}));},
    async close(){closed=true;const results=await Promise.all([...seen].map(stopCompartment));if(results.some(result=>!result.stopped))throw Error("A native Windows input reader exit remains unconfirmed; staging was preserved.");}
  };
}
