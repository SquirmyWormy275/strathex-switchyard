/** One exact embedded worker hard link; no copied native runtime or tool override. */
import {createHash}from"node:crypto";
import {constants}from"node:fs";
import {open,lstat,mkdir,readdir,unlink,rmdir}from"node:fs/promises";
import {join,dirname}from"node:path";
import {fileURLToPath}from"node:url";
import {privateDirectory,directoryIdentity}from"./private-fs.mjs";
import {runOwnedNativeCommand}from"./owned-native-command.mjs";
import {runRuntimeCommand,runtimeGuardianStopped}from"./runtime-command.mjs";
import {scopeHash}from"./confirmations.mjs";
const schema="switchyard-windows-guest-tools/v1",toolName="b122-sandbox-worker.exe",defaultHelper=fileURLToPath(new URL("../../runtime/hotkeys/Switchyard.Hotkeys.exe",import.meta.url));
const uuid=value=>typeof value==="string"&&/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/.test(value),digest=value=>typeof value==="string"&&/^[a-f0-9]{64}$/.test(value);
const identity=stat=>({device:stat.dev.toString(),inode:stat.ino.toString()}),same=(a,b)=>a?.device===b?.device&&a?.inode===b?.inode;
async function image(path,expectedSha256,expectedIdentity){
  const file=await open(path,constants.O_RDONLY|(constants.O_NOFOLLOW??0));
  try{
    const before=await file.stat({bigint:true}),named=await lstat(path,{bigint:true});
    if(!before.isFile()||!named.isFile()||named.isSymbolicLink()||!same(identity(before),identity(named))||expectedIdentity&&!same(identity(before),expectedIdentity)||before.size<1n||before.size>128n*1024n*1024n)throw Error("The exact bounded native helper file identity changed.");
    const hash=createHash("sha256"),chunk=Buffer.alloc(65536);let total=0;
    for(;;){const{bytesRead}=await file.read(chunk,0,Math.min(chunk.length,Number(before.size)-total+1),total);if(!bytesRead)break;total+=bytesRead;if(total>Number(before.size))throw Error("The native helper grew during verification.");hash.update(chunk.subarray(0,bytesRead));}
    const after=await file.stat({bigint:true}),current=await lstat(path,{bigint:true});
    if(total!==Number(before.size)||before.size!==after.size||before.mtimeNs!==after.mtimeNs||before.ctimeNs!==after.ctimeNs||!same(identity(before),identity(current))||current.isSymbolicLink()||hash.digest("hex")!==expectedSha256)throw Error("The exact native helper bytes changed.");
    return{identity:identity(before),bytes:total};
  }finally{await file.close();}
}
export function createWindowsGuestTools({store,stateDirectory,platform=process.platform,helper=defaultHelper,command=(exe,args,options)=>runRuntimeCommand(exe,args,{...options,windowsHelper:helper}),guardianStopped=scope=>runtimeGuardianStopped(scope,{windowsHelper:helper}),consumerStopped=async()=>false,isActive=async()=>true,now=Date.now}={}){
  const resources=new Map(),generations=new Map(),seen=new Set();let closed=false;
  const update=(c,id,action,fn)=>store.update(c,action,state=>{const row=state.repositoryWindowsTools?.find(row=>row.operationId===id);if(!row)throw Error("The protected guest-tool record changed.");return fn(row);});
  const key=source=>scopeHash([schema,source]);
  async function verify(row,partial=false){
    if(row.schema!==schema||row.path!==join(stateDirectory,row.compartment,`tools-${row.operationId}`)||!same(identity(await directoryIdentity(row.path)),row.stagingIdentity))throw Error("Preserve a replaced or unfamiliar guest-tool directory.");
    const names=await readdir(row.path);if(partial&&names.length===0)return;
    if(names.length!==1||names[0]!==toolName)throw Error("An unfamiliar guest-tool staging entry appeared; preserve it.");
    const checked=await image(join(row.path,toolName),row.expectedSha256,row.sourceIdentity);if(checked.bytes!==row.bytes)throw Error("The original guest-tool hard link changed; preserve it.");
    if(!same(identity(await directoryIdentity(row.path)),row.stagingIdentity))throw Error("The guest-tool directory changed during verification.");
  }
  async function cleanupUnlocked(c,id){
    const row=(await store.snapshot(c)).repositoryWindowsTools?.find(row=>row.operationId===id);if(!row?.cleanupPending)return{cleaned:true};
    if(row.ownedRuntime&&!await guardianStopped(row.ownedRuntime))return{cleaned:false,reason:"native-tool-stager-exit-unconfirmed"};
    if(!row.ownedRuntime&&row.status!=="not-started")return{cleaned:false,reason:"native-tool-start-unconfirmed"};
    if(!await consumerStopped(c,id))return{cleaned:false,reason:"guest-exit-unconfirmed"};
    try{await directoryIdentity(row.path);}catch(error){if(error.code!=="ENOENT")throw error;await update(c,id,"windows-tools-removal-observed",row=>{row.cleanupPending=false;});return{cleaned:true};}
    await verify(row,row.status!=="staged");
    if((await readdir(row.path)).length)await unlink(join(row.path,toolName));await rmdir(row.path);await update(c,id,"windows-tools-cleaned",row=>{row.cleanupPending=false;});return{cleaned:true};
  }
  async function cleanup(c,id){const row=(await store.snapshot(c)).repositoryWindowsTools?.find(row=>row.operationId===id);if(!row?.cleanupPending)return{cleaned:true};return store.withResourceLock("repository-execution",key(row.sourceIdentity),()=>cleanupUnlocked(c,id));}
  async function recover(c){seen.add(c);let cleanupPending=false;
    for(const row of (await store.snapshot(c)).repositoryWindowsTools??[]){if(!row.cleanupPending||resources.has(`${c}:${row.operationId}`))continue;await store.withResourceLock("repository-execution",key(row.sourceIdentity),async()=>{if(!row.ownedRuntime&&row.status==="reserved")await update(c,row.operationId,"windows-tools-no-ack",row=>{if(row.ownedRuntime)throw Error("Tool readiness changed during no-ack recovery.");row.status="not-started";row.stoppedVerified=true;});if(row.ownedRuntime&&await guardianStopped(row.ownedRuntime))await update(c,row.operationId,"windows-tools-exit-observed",row=>{row.stoppedVerified=true;});try{if(!(await cleanupUnlocked(c,row.operationId)).cleaned)cleanupPending=true;}catch{cleanupPending=true;}});}
    return{cleanupPending};
  }
  async function stopCompartment(c){generations.set(c,(generations.get(c)??0)+1);const active=[...resources.values()].filter(r=>r.compartment===c);active.forEach(r=>r.controller.abort());await Promise.allSettled(active.map(r=>r.done));const stopped=await Promise.all(active.flatMap(r=>[...r.clients].map(client=>client.stop().catch(()=>false))));for(const[k,r]of resources)if(active.includes(r)&&[...r.clients].every(client=>client.closed))resources.delete(k);const nativeStopped=!(await store.snapshot(c)).repositoryWindowsTools?.some(row=>row.ownedRuntime&&row.stoppedVerified!==true);return{stopped:stopped.every(Boolean)&&nativeStopped,...await recover(c)};}
  return{
    async prepare(c,context,input,authorize){
      context=structuredClone(context);input=structuredClone(input);
      if(platform!=="win32"||!context||Object.keys(context).sort().join()!=="operationId,provider,scopeDigest"||!uuid(context.operationId)||!digest(context.scopeDigest)||!["codex","claude-code"].includes(context.provider)||!input||Object.keys(input).join()!=="expectedSha256"||!digest(input.expectedSha256)||typeof authorize!=="function")throw Error("Bind the fixed native guest worker to its exact reviewed Windows operation; tool paths and commands are not accepted.");
      const id=context.operationId,generation=generations.get(c)??0,resourceKey=`${c}:${id}`;
      if(closed||resources.has(resourceKey)||[...resources.values()].some(r=>r.compartment===c))throw Error("Wait for this workspace's owned tool staging; no replacement was started.");
      const resource={compartment:c,controller:new AbortController(),clients:new Set(),done:null};resources.set(resourceKey,resource);seen.add(c);
      const check=async()=>{if(closed||generation!==(generations.get(c)??0)||!await isActive(c))throw Error("This guest-tool staging was stopped or its workspace changed.");await store.authorize(c,{provider:context.provider});await authorize();};
      resource.done=(async()=>{let reserved=false,ready=false,owner;
        try{
          await check();const source=await image(helper,input.expectedSha256);
          return await store.withResourceLock("repository-execution",key(source.identity),async lease=>{
            const current=async()=>{lease.assert();await check();};await current();
            if((await store.snapshot(c)).repositoryWindowsTools?.some(row=>row.operationId===id||row.stoppedVerified!==true))throw Error("The prior native guest tool is retained or already exists; no staging replay is allowed.");
            await image(helper,input.expectedSha256,source.identity);await privateDirectory(join(stateDirectory,c));const root=join(stateDirectory,c,`tools-${id}`);await mkdir(root,{mode:0o700});const stagingIdentity=identity(await directoryIdentity(root));
            try{await store.update(c,"windows-tools-reserve",state=>{const all=state.repositoryWindowsTools??[],retained=all.filter(row=>row.cleanupPending);state.repositoryWindowsTools=[...retained,...all.filter(row=>!retained.includes(row)).slice(-16)];if(state.repositoryWindowsTools.length>=64||all.some(row=>row.operationId===id||row.stoppedVerified!==true))throw Error("The protected guest-tool inventory is full or changed.");state.repositoryWindowsTools.push({schema,compartment:c,...context,path:root,sourceIdentity:source.identity,stagingIdentity,bytes:source.bytes,expectedSha256:input.expectedSha256,status:"reserved",stoppedVerified:false,cleanupPending:true,at:now()});});reserved=true;}
            catch(error){if(same(identity(await directoryIdentity(root)),stagingIdentity)&&!(await readdir(root)).length)await rmdir(root);throw error;}
            const result=await runOwnedNativeCommand({executable:helper,args:["--stage-guest-tools"],cwd:root,env:{},text:JSON.stringify({schema,operationId:id,sourceIdentity:source.identity,stagingRoot:root,stagingIdentity,expectedSha256:input.expectedSha256}),resource,signal:resource.controller.signal,timeout:60000,maxOutputBytes:4096,captureStderrBytes:512,command,guardianStopped,
              onReady:async scope=>{owner=scope;await current();await update(c,id,"windows-tools-native-ready",row=>{row.ownedRuntime=scope;row.status="staging";});await current();ready=true;},
              onStopped:async scope=>{if(!await guardianStopped(scope))throw Error("The native guest-tool stager exit remains unconfirmed.");await update(c,id,"windows-tools-native-exit",row=>{if(row.ownedRuntime&&row.ownedRuntime.id!==scope.id)throw Error("The exact tool-stager guardian changed.");row.ownedRuntime??=scope;row.stoppedVerified=true;});}
            });
            if(result.status!=="completed"||result.exitCode!==0){const diagnostic=/^Native guest-tool staging failed at ([a-z-]+); Win32=([0-9]+)\./.exec(result.stderr??"");if(diagnostic)await update(c,id,"windows-tools-native-diagnostic",row=>{row.failure={phase:diagnostic[1],win32:Number(diagnostic[2])};});throw Error("The native worker hard link was not verified. Same-volume NTFS is required; no runtime-copy fallback was selected."+(diagnostic?` Phase ${diagnostic[1]}, Win32 ${diagnostic[2]}.`:""));}
            const proof=JSON.parse(result.stdout),names=["schema","operationId","sourceIdentity","stagingIdentity","sha256","linkedBytes","copiedBytes","toolName","privateAclReadbackVerified","workerEmbedded","sandboxEnforced"];
            if(Object.keys(proof).sort().join()!==names.sort().join()||proof.schema!==schema||proof.operationId!==id||!same(proof.sourceIdentity,source.identity)||!same(proof.stagingIdentity,stagingIdentity)||proof.sha256!==input.expectedSha256||proof.linkedBytes!==source.bytes||proof.copiedBytes!==0||proof.toolName!==toolName||proof.privateAclReadbackVerified!==true||proof.workerEmbedded!==true||proof.sandboxEnforced!==false)throw Error("The exact native embedded-worker proof did not verify.");
            await current();await verify((await store.snapshot(c)).repositoryWindowsTools.find(row=>row.operationId===id));await update(c,id,"windows-tools-staged",row=>{row.status="staged";row.proof=proof;});
            return{root,helperFilename:toolName,helperSha256:input.expectedSha256,privateAclReadbackVerified:true,workerEmbedded:true,copiedBytes:0,sandboxEnforced:false,assertCurrent:()=>store.withResourceLock("repository-execution",key(source.identity),async()=>{await check();await verify((await store.snapshot(c)).repositoryWindowsTools.find(row=>row.operationId===id));}),release:async()=>{if(!(await cleanup(c,id)).cleaned)throw Error("Guest tools await independently verified native and guest exit.");}};
          });
        }catch(error){if(reserved)await update(c,id,"windows-tools-unconfirmed",row=>{row.status=ready?"outcome-unconfirmed":"not-started";if(owner)row.ownedRuntime??=owner;}).catch(()=>{});throw error;}
        finally{await Promise.all([...resource.clients].map(client=>client.stop().catch(()=>false)));if(!owner||await guardianStopped(owner).catch(()=>false))resources.delete(resourceKey);}
      })();return resource.done;
    },
    cleanup,recover,stopCompartment,
    async list(c){return((await store.snapshot(c)).repositoryWindowsTools??[]).map(row=>({operationId:row.operationId,status:row.status,cleanupPending:row.cleanupPending,stoppedVerified:row.stoppedVerified===true,copiedBytes:0,sandboxEnforced:false}));},
    async close(){closed=true;const results=await Promise.all([...seen].map(stopCompartment));if(results.some(r=>!r.stopped))throw Error("A native guest-tool stager still has unknown exit; its link was preserved.");}
  };
}
