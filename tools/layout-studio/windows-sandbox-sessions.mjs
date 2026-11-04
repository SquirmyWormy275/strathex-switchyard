/** Managed VM lifecycle over the fixed owned native Sandbox transport. */
import { randomUUID,createHash } from "node:crypto";
import { basename,dirname,join } from "node:path";
import { privateRead } from "./private-fs.mjs";
import { scopeHash } from "./confirmations.mjs";
import { createWindowsSandboxNativeCalls } from "./windows-sandbox-native.mjs";

const schema="switchyard-windows-sandbox-session/v1",guestSchema="switchyard-windows-sandbox-guest/v1";
const uuid=value=>typeof value==="string"&&/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/.test(value);
const digest=value=>typeof value==="string"&&/^[a-f0-9]{64}$/.test(value);
const sha=value=>createHash("sha256").update(value).digest("hex"),globalLease=scopeHash([schema,"current-user"]);
const nativeContext=row=>({operationId:row.operationId,scopeDigest:row.scopeDigest,provider:row.provider,sandboxId:row.sandboxId});
const proof=row=>({schema:guestSchema,sandboxId:row.sandboxId,operationId:row.operationId,configurationSha256:row.configurationSha256,stopped:true});

export function createWindowsSandboxSessions({store,stateDirectory,platform=process.platform,native=createWindowsSandboxNativeCalls({store,stateDirectory:join(stateDirectory,"native"),platform}),isActive=async()=>true,now=Date.now,sleep=ms=>new Promise(resolve=>setTimeout(resolve,ms))}={}){
  const resources=new Map(),seen=new Set(),generations=new Map();let closed=false;
  const snapshot=c=>store.snapshot(c);
  const get=async(c,id)=>(await snapshot(c)).repositoryWindowsGuests?.find(row=>row.operationId===id);
  const update=(c,id,action,fn)=>store.update(c,action,state=>{const row=state.repositoryWindowsGuests?.find(row=>row.operationId===id);if(!row||row.schema!==schema)throw Error("The protected guest session record changed.");return fn(row);});

  async function stopObserved(c,row){
    if(row.stoppedVerified===true)return true;
    if(!await native.recover(c))return false;
    const context=nativeContext(row),authorize=async()=>{};
    if(!row.nativeStartCommandId){
      await update(c,row.operationId,"windows-guest-no-start-observed",row=>{row.status="not-started";row.stoppedVerified=true;});return true;
    }
    const start=(await snapshot(c)).repositoryWindowsGuestCommands?.find(command=>command.id===row.nativeStartCommandId);
    if(start?.stoppedVerified===true&&(start.startAcknowledged!==true||start.result?.effectStarted===false)){
      await update(c,row.operationId,"windows-guest-native-no-effect",row=>{row.status="not-started";row.stoppedVerified=true;});return true;
    }
    if(row.startVerified!==true){
      const inventory=await native.call(c,context,{action:"list"},authorize,{cleanup:true});
      const exactIntent=Boolean(start?.ownedRuntime)&&start?.startAcknowledged===true&&start?.stoppedVerified===true&&start.operationId===row.operationId&&start.scopeDigest===row.scopeDigest&&start.provider===row.provider&&start.sandboxId===row.sandboxId;
      if(!exactIntent||inventory.status!=="observed"||!inventory.ids.includes(row.sandboxId))return false;
      // This is the exact unguessable ID supplied in the durably acknowledged
      // native creation request, not a new singleton or a viewer PID.
      await update(c,row.operationId,"windows-guest-exact-start-observed",row=>{row.startVerified=true;row.recoveredStartWithoutReplay=true;});row=await get(c,row.operationId);
    }
    await native.call(c,context,{action:"stop",sandboxId:row.sandboxId},authorize,{cleanup:true});
    const inventory=await native.call(c,context,{action:"list"},authorize,{cleanup:true});
    const absent=inventory.status==="observed"&&!inventory.ids.includes(row.sandboxId);
    if(absent)await update(c,row.operationId,"windows-guest-exit-observed",row=>{row.stoppedVerified=true;row.stoppedAt=now();});
    return absent;
  }
  async function recoverUnlocked(c){
    if(!await native.recover(c))return {stopped:false};
    let stopped=true;
    for(const row of (await snapshot(c)).repositoryWindowsGuests??[]){
      if(row.schema!==schema)throw Error("Preserve an unfamiliar protected guest session schema.");
      if(resources.has(`${c}:${row.operationId}`))continue;
      if(row.stoppedVerified===true){if(!["settled","not-started","outcome-unconfirmed"].includes(row.status))await update(c,row.operationId,"windows-guest-interrupted-exit-record",row=>{row.status="outcome-unconfirmed";row.recoveredWithoutReplay=true;});continue;}
      try{if(!await stopObserved(c,row))stopped=false;}catch{stopped=false;}
      if((await get(c,row.operationId))?.stoppedVerified===true&&!["settled","not-started"].includes(row.status))await update(c,row.operationId,"windows-guest-interrupted-observed",row=>{row.status="outcome-unconfirmed";row.recoveredWithoutReplay=true;});
    }
    return {stopped};
  }
  async function recover(c){seen.add(c);return store.withResourceLock("repository-execution",globalLease,()=>recoverUnlocked(c));}
  async function stopCompartment(c){
    generations.set(c,(generations.get(c)??0)+1);
    const active=[...resources.values()].filter(resource=>resource.compartment===c);active.forEach(resource=>resource.controller.abort());
    await Promise.allSettled(active.map(resource=>resource.done));
    return recover(c);
  }

  return {
    forOperation(c,binding,authorize){
      binding=structuredClone(binding);
      if(!binding||Object.keys(binding).sort().join()!=="operationId,provider,scopeDigest"||!uuid(binding.operationId)||!digest(binding.scopeDigest)||!["codex","claude-code"].includes(binding.provider)||typeof authorize!=="function")throw Error("Bind the managed guest to one exact reviewed host operation.");
      seen.add(c);
      return {
        async run(spec,signal,_onStarted,onGuestReady){
          if(platform!=="win32"||!spec?.reviewedGuest||spec.executable!=="C:\\Windows\\System32\\WindowsSandbox.exe"||spec.args?.length!==1||basename(spec.args[0])!=="sandbox.wsb"||dirname(spec.args[0])!==spec.cwd||spec.reviewedGuest.operationId!==binding.operationId||!digest(spec.reviewedGuest.configurationSha256)||typeof spec.reviewedCatalogRelativePath!=="string"||typeof onGuestReady!=="function"||!Number.isInteger(spec.timeoutMs)||spec.timeoutMs<1000||spec.timeoutMs>600000)throw Error("Managed Sandbox execution requires the exact reviewed backend configuration and guest acknowledgement port.");
          const key=`${c}:${binding.operationId}`,generation=generations.get(c)??0;
          if(closed||resources.has(key)||[...resources.values()].some(resource=>resource.compartment===c))throw Error("This workspace already owns a guest lifecycle; no concurrent replacement was started.");
          const resource={compartment:c,controller:new AbortController(),done:null,deadlineTimer:null};resources.set(key,resource);
          resource.done=store.withResourceLock("repository-execution",globalLease,async lease=>{
            const timeout=new AbortController();resource.deadlineTimer=setTimeout(()=>timeout.abort(),spec.timeoutMs);
            const combined=AbortSignal.any([resource.controller.signal,timeout.signal,...(signal?[signal]:[])]),deadline=now()+spec.timeoutMs;
            const check=async()=>{lease.assert();if(closed||generation!==(generations.get(c)??0)||combined.aborted||now()>=deadline||!await isActive(c))throw Error("The exact guest lifecycle was stopped, expired or its workspace changed.");await store.authorize(c,{provider:binding.provider});await authorize();};
            let reserved=false,guestExitCode=null,failure=null;
            const sandboxId=randomUUID(),context={...binding,sandboxId};
            try{
              await check();const recovery=await recoverUnlocked(c);if(!recovery.stopped)throw Error("A retained guest or native owner still needs independent exit verification.");
              if((await snapshot(c)).repositoryWindowsGuests?.some(row=>row.operationId===binding.operationId))throw Error("This guest operation already exists; the recipe cannot be replayed.");
              const configuration=await privateRead(spec.args[0]);if(sha(configuration)!==spec.reviewedGuest.configurationSha256||Buffer.byteLength(configuration)>16384)throw Error("The exact reviewed guest configuration changed before native startup.");
              await store.update(c,"windows-guest-session-reserve",state=>{const all=state.repositoryWindowsGuests??[],retained=all.filter(row=>row.stoppedVerified!==true);state.repositoryWindowsGuests=[...retained,...all.filter(row=>!retained.includes(row)).slice(-16)];if(state.repositoryWindowsGuests.length>=64||all.some(row=>row.operationId===binding.operationId))throw Error("The protected guest inventory is full or changed; preserve prior ownership.");state.repositoryWindowsGuests.push({schema,...context,configurationSha256:spec.reviewedGuest.configurationSha256,catalogRelativePath:spec.reviewedCatalogRelativePath,status:"reserved",stoppedVerified:false,startVerified:false,createdAt:now(),deadline,exchangeQuotaEnforced:false});});reserved=true;
              const call=input=>native.call(c,context,input,check,{signal:combined});
              await check();const started=await call({action:"start",sandboxId,configuration,configurationSha256:spec.reviewedGuest.configurationSha256});
              if(started.status!=="started")throw Error("Native guest startup did not verify the exact newly owned ID; no recipe was acknowledged.");
              await check();await onGuestReady({schema:guestSchema,sandboxId,operationId:binding.operationId,configurationSha256:spec.reviewedGuest.configurationSha256});
              await update(c,binding.operationId,"windows-guest-acknowledged",row=>{row.recipeAcknowledgedAt=now();row.status="acknowledged";});
              await check();const connected=await call({action:"connect",sandboxId});if(connected.status!=="connection-requested")throw Error("The exact guest viewer connection remains unconfirmed.");
              let login=false;const loginDeadline=Math.min(deadline,now()+45000);
              while(now()<loginDeadline){await check();const probe=await call({action:"probe-login",sandboxId});if(probe.status==="executed"&&probe.guestExitCode===0){login=true;break;}await sleep(250);}
              if(!login)throw Error("The owned guest login session did not become ready within its deadline.");
              await check();await update(c,binding.operationId,"windows-guest-worker-reserved",row=>{if(row.workerRequestedAt!==undefined)throw Error("The exact guest worker request already exists; no replay is allowed.");row.workerRequestedAt=now();row.status="executing";});
              const executed=await call({action:"execute",sandboxId,catalogRelativePath:spec.reviewedCatalogRelativePath,timeoutMs:Math.max(1000,Math.min(600000,deadline-now()))});
              if(executed.status!=="executed")throw Error("The exact guest worker result remains unconfirmed; no worker replay is allowed.");
              guestExitCode=executed.guestExitCode;
              await update(c,binding.operationId,"windows-guest-worker-result",row=>{row.workerExitCode=guestExitCode;row.workerResultObservedAt=now();});
            }catch(error){failure=error;}
            let stoppedVerified=false,nativeExited=false,row;
            if(reserved){
              try{row=await get(c,binding.operationId);stoppedVerified=await stopObserved(c,row);nativeExited=await native.recover(c);}catch{failure??=Error("The exact guest or native command exit remains unconfirmed.");}
              await update(c,binding.operationId,"windows-guest-session-result",row=>{row.status=!failure&&stoppedVerified&&nativeExited?"settled":"outcome-unconfirmed";row.result={workerExitCode:guestExitCode,stoppedVerified,nativeCommandsExited:nativeExited,timedOut:timeout.signal.aborted||now()>=deadline,cancelled:resource.controller.signal.aborted||signal?.aborted===true,recipeReplayed:false,exchangeQuotaEnforced:false};});
              row=await get(c,binding.operationId);
            }
            if(!reserved&&failure)throw failure;
            // Never infer a WindowsSandbox.exe PID from a short CLI guardian.
            return {exitCode:guestExitCode,stdout:"",stderr:"",timedOut:timeout.signal.aborted||now()>=deadline,cancelled:resource.controller.signal.aborted||signal?.aborted===true,outputTruncated:false,hostProcessContained:nativeExited,...(stoppedVerified&&row?.startVerified===true?{guestSessionExit:proof(row)}:{})};
          }).finally(()=>{clearTimeout(resource.deadlineTimer);if(resources.get(key)===resource)resources.delete(key);});
          return resource.done;
        },
        async reconcileReviewedOperation(input){
          if(input.operationId!==binding.operationId||!digest(input.configurationSha256))return undefined;
          if(resources.has(`${c}:${binding.operationId}`))return undefined;
          await recover(c);const row=await get(c,binding.operationId);
          if(!row||row.scopeDigest!==binding.scopeDigest||row.configurationSha256!==input.configurationSha256||row.stoppedVerified!==true||row.startVerified!==true||input.knownSandboxId&&input.knownSandboxId!==row.sandboxId)return undefined;
          return proof(row);
        }
      };
    },
    recover,stopCompartment,
    async consumerStopped(c,operationId){if(resources.has(`${c}:${operationId}`))return false;const row=await get(c,operationId);return (!row||row.stoppedVerified===true)&&await native.recover(c);},
    async list(c){return ((await snapshot(c)).repositoryWindowsGuests??[]).map(row=>({operationId:row.operationId,status:row.status,startVerified:row.startVerified===true,stoppedVerified:row.stoppedVerified===true,workerExitCode:row.workerExitCode??null,exchangeQuotaEnforced:false}));},
    async close(){closed=true;const results=await Promise.all([...seen].map(stopCompartment));await native.close();if(results.some(result=>!result.stopped))throw Error("A managed guest still needs independent exit verification; its ownership and mapped files were preserved.");}
  };
}
