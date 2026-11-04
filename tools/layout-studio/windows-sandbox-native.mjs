/** Fixed Windows Sandbox CLI calls; this transport never claims VM containment. */
import { randomUUID, createHash } from "node:crypto";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { privateDirectory } from "./private-fs.mjs";
import { runOwnedNativeCommand } from "./owned-native-command.mjs";
import { runRuntimeCommand, runtimeGuardianStopped } from "./runtime-command.mjs";
import { scopeHash } from "./confirmations.mjs";

const schema="switchyard-windows-sandbox-cli/v1", nativeHelper=fileURLToPath(new URL("../../runtime/hotkeys/Switchyard.Hotkeys.exe",import.meta.url));
const uuid=value=>typeof value==="string"&&/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/.test(value);
const dig=value=>typeof value==="string"&&/^[a-f0-9]{64}$/.test(value);
const fields={metadata:[],list:[],start:["sandboxId","configuration","configurationSha256"],stop:["sandboxId"],connect:["sandboxId"],"probe-login":["sandboxId"],execute:["sandboxId","catalogRelativePath","timeoutMs"]};
const statuses={metadata:["available","unavailable"],list:["observed","unavailable"],start:["started","blocked","outcome-unconfirmed","unavailable"],stop:["stopped","outcome-unconfirmed","unavailable"],connect:["connection-requested","outcome-unconfirmed","absent","unavailable"],"probe-login":["executed","dispatch-unconfirmed","absent","unavailable"],execute:["executed","dispatch-unconfirmed","absent","unavailable"]};
const once=new Set(["start","connect","execute","stop"]),leaseKey=scopeHash(["switchyard-windows-sandbox-cli","current-user"]);
const commandField=action=>({start:"nativeStartCommandId",connect:"nativeConnectCommandId",execute:"nativeExecuteCommandId",stop:"nativeStopCommandId"}[action]);

function request(input,context){
  if(!input||!Object.hasOwn(fields,input.action)||Object.keys(input).sort().join()!==["action",...fields[input.action]].sort().join())throw Error("Choose only one closed Sandbox verb and its exact structured fields.");
  if(fields[input.action].includes("sandboxId")&&(!uuid(input.sandboxId)||input.sandboxId!==context.sandboxId))throw Error("The native Sandbox verb belongs to a different exact guest identity.");
  if(input.action==="start"&&(!dig(input.configurationSha256)||typeof input.configuration!=="string"||Buffer.byteLength(input.configuration)>16384||createHash("sha256").update(input.configuration).digest("hex")!==input.configurationSha256))throw Error("Bind one bounded exact guest configuration and its UTF-8 byte digest.");
  if(input.action==="execute"&&(!Number.isSafeInteger(input.timeoutMs)||input.timeoutMs<1000||input.timeoutMs>600000||typeof input.catalogRelativePath!=="string"||input.catalogRelativePath.length>512||input.catalogRelativePath.split("/").some(part=>!part||part==="."||part==="..")||/[\\\x00-\x1f\x7f:"<>|*?]/.test(input.catalogRelativePath)))throw Error("Use only the fixed guest worker and a bounded literal catalog path.");
  return {schema,...structuredClone(input)};
}
function response(value,input){
  const allowed=["schema","action","status","reason","effectStarted",...({metadata:["aliasType"],list:["ids"],start:["sandboxId","configurationSha256"],stop:["sandboxId","absentObserved"],connect:["sandboxId"],"probe-login":["sandboxId","guestExitCode"],execute:["sandboxId","guestExitCode"]}[input.action])];
  if(!value||typeof value!=="object"||Array.isArray(value)||Object.keys(value).some(k=>!allowed.includes(k))||value.schema!==schema||value.action!==input.action||!statuses[input.action].includes(value.status)||typeof value.effectStarted!=="boolean")throw Error("The exact native Sandbox response did not verify.");
  if(value.status==="observed"&&(!Array.isArray(value.ids)||value.ids.length>64||value.ids.some(id=>!uuid(id))||new Set(value.ids).size!==value.ids.length))throw Error("The native Sandbox inventory is unknown, not empty.");
  if(value.sandboxId!==undefined&&value.sandboxId!==input.sandboxId||value.configurationSha256!==undefined&&value.configurationSha256!==input.configurationSha256)throw Error("The native Sandbox response crossed its exact identity or configuration.");
  if(value.status==="started"&&(value.sandboxId!==input.sandboxId||value.configurationSha256!==input.configurationSha256)||value.status==="stopped"&&(value.sandboxId!==input.sandboxId||value.absentObserved!==true)||value.status==="executed"&&(!Number.isInteger(value.guestExitCode)||value.guestExitCode<0||value.guestExitCode>0xffffffff))throw Error("The native Sandbox postcondition remains unconfirmed.");
  return value;
}

export function createWindowsSandboxNativeCalls({store,stateDirectory,platform=process.platform,helper=nativeHelper,command=(exe,args,options)=>runRuntimeCommand(exe,args,{...options,windowsHelper:helper}),guardianStopped=scope=>runtimeGuardianStopped(scope,{windowsHelper:helper}),isActive=async()=>true,now=Date.now}={}){
  const active=new Map(),seen=new Set();let closed=false;
  const update=(c,id,action,fn)=>store.update(c,action,state=>{const row=state.repositoryWindowsGuestCommands?.find(row=>row.id===id);if(!row)throw Error("The protected guest command record changed.");return fn(row,state);});
  async function recoverUnlocked(c){
    for(const row of (await store.snapshot(c)).repositoryWindowsGuestCommands??[]){
      if(row.stoppedVerified===true)continue;
      if(row.ownedRuntime&&await guardianStopped(row.ownedRuntime))await update(c,row.id,"windows-guest-native-exit-observed",row=>{row.stoppedVerified=true;});
      else if(!row.ownedRuntime&&row.status==="reserved")await update(c,row.id,"windows-guest-native-no-ack",row=>{row.stoppedVerified=true;row.status="not-started";});
    }
    return !(await store.snapshot(c)).repositoryWindowsGuestCommands?.some(row=>row.stoppedVerified!==true);
  }
  async function stopCompartment(c){
    const resource=active.get(c);resource?.controller.abort();await Promise.allSettled([resource?.done].filter(Boolean));
    const stopped=await Promise.all([...(resource?.clients??[])].map(client=>client.stop().catch(()=>false)));
    return {stopped:stopped.every(Boolean)&&!(await store.snapshot(c)).repositoryWindowsGuestCommands?.some(row=>row.stoppedVerified!==true),guestSessionStoppedVerified:false};
  }
  return {
    async call(c,context,input,authorize,{cleanup=false,signal}={}){
      context=structuredClone(context);input=request(input,context);
      if(platform!=="win32"||!context||Object.keys(context).sort().join()!=="operationId,provider,sandboxId,scopeDigest"||!uuid(context.operationId)||!uuid(context.sandboxId)||!dig(context.scopeDigest)||!["codex","claude-code"].includes(context.provider)||typeof authorize!=="function"||cleanup&&input.action!=="stop")throw Error("Native Sandbox control requires its exact host operation and Windows transport.");
      if(closed&&!cleanup||active.has(c))throw Error("Wait for the existing native guest command; no concurrent replacement was started.");
      const resource={controller:new AbortController(),clients:new Set(),done:null};active.set(c,resource);seen.add(c);
      resource.done=store.withResourceLock("repository-execution",leaseKey,async lease=>{
        const check=async()=>{lease.assert();if(!cleanup){if(closed||resource.controller.signal.aborted||signal?.aborted||!await isActive(c))throw Error("The native Sandbox command was stopped or its workspace changed.");await store.authorize(c,{provider:context.provider});await authorize();}
          if(!["metadata","list"].includes(input.action)){const row=(await store.snapshot(c)).repositoryWindowsGuests?.find(row=>row.operationId===context.operationId);if(!row||row.scopeDigest!==context.scopeDigest||row.sandboxId!==context.sandboxId||row.provider!==context.provider||input.action==="start"&&row.configurationSha256!==input.configurationSha256||input.action!=="start"&&row.startVerified!==true)throw Error("No exact protected guest ownership authorizes this native verb.");}
        };
        let id,owner,ready=false;
        try{
          await check();if(!await recoverUnlocked(c))throw Error("A prior native guest command has unknown exit; preserve its ownership.");
          const state=await store.snapshot(c),prior=(state.repositoryWindowsGuestCommands??[]).find(row=>row.operationId===context.operationId&&row.action===input.action),guest=state.repositoryWindowsGuests?.find(row=>row.operationId===context.operationId);
          if(once.has(input.action)&&(prior||guest?.[commandField(input.action)]))return {...(prior?.result??guest?.nativeResults?.[input.action]??{schema,action:input.action,status:"outcome-unconfirmed",effectStarted:prior?.startAcknowledged===true}),replayed:true};
          if(guest?.stoppedVerified===true&&!["metadata","list","stop"].includes(input.action))throw Error("This exact guest already has verified exit; it cannot receive a new native effect.");
          id=randomUUID();await privateDirectory(join(stateDirectory,c));
          await store.update(c,"windows-guest-native-reserve",state=>{const all=state.repositoryWindowsGuestCommands??[],retained=all.filter(row=>row.stoppedVerified!==true||once.has(row.action)&&state.repositoryWindowsGuests?.some(guest=>guest.operationId===row.operationId&&guest.stoppedVerified!==true));state.repositoryWindowsGuestCommands=[...retained,...all.filter(row=>!retained.includes(row)).slice(-16)];const guest=state.repositoryWindowsGuests?.find(guest=>guest.operationId===context.operationId);if(state.repositoryWindowsGuestCommands.length>=128||once.has(input.action)&&(all.some(row=>row.operationId===context.operationId&&row.action===input.action)||guest?.[commandField(input.action)]))throw Error("The native guest command inventory is full or changed; preserve prior evidence.");state.repositoryWindowsGuestCommands.push({id,...context,action:input.action,requestDigest:scopeHash(input),status:"reserved",stoppedVerified:false,at:now()});if(once.has(input.action))guest[commandField(input.action)]=id;});
          const result=await runOwnedNativeCommand({executable:helper,args:["--windows-sandbox-cli"],cwd:join(stateDirectory,c),env:{},text:JSON.stringify(input),resource,signal:cleanup?undefined:AbortSignal.any([resource.controller.signal,...(signal?[signal]:[])]),timeout:input.action==="execute"?Math.min(600000,input.timeoutMs+10000):90000,maxOutputBytes:65536,captureStderrBytes:0,command,guardianStopped,
            onReady:async scope=>{owner=scope;await check();await update(c,id,"windows-guest-native-ready",(row,state)=>{row.ownedRuntime=scope;row.status="running";row.startAcknowledged=true;if(input.action==="start"){const guest=state.repositoryWindowsGuests.find(guest=>guest.operationId===context.operationId);if(guest.nativeStartCommandId!==id)throw Error("The exact guest start reservation changed; no replay is allowed.");guest.status="starting";}});await check();ready=true;},
            onStopped:async scope=>{if(!await guardianStopped(scope))throw Error("Native Sandbox CLI exit remains unconfirmed.");await update(c,id,"windows-guest-native-exited",row=>{if(row.ownedRuntime&&row.ownedRuntime.id!==scope.id)throw Error("The exact native guest command guardian changed.");row.ownedRuntime??=scope;row.stoppedVerified=true;});}
          });
          if(result.status!=="completed"||result.exitCode!==0)throw Error("The fixed native Sandbox operation did not return a verified result.");
          const value=response(JSON.parse(result.stdout),input);await check();await update(c,id,"windows-guest-native-result",(row,state)=>{row.status="settled";row.result=value;const guest=state.repositoryWindowsGuests?.find(guest=>guest.operationId===context.operationId);if(once.has(input.action)){guest.nativeResults??={};guest.nativeResults[input.action]=value;}if(input.action==="start"&&value.status==="started"){guest.startVerified=true;guest.status="started";}if(input.action==="stop"&&value.status==="stopped")guest.stoppedVerified=true;});return value;
        }catch(error){if(id)await update(c,id,"windows-guest-native-unconfirmed",row=>{row.status=ready?"outcome-unconfirmed":"not-started";if(owner)row.ownedRuntime??=owner;}).catch(()=>{});throw error;}
        finally{await Promise.all([...resource.clients].map(client=>client.stop().catch(()=>false)));}
      }).finally(()=>{if(active.get(c)===resource)active.delete(c);});
      return resource.done;
    },
    recover:c=>store.withResourceLock("repository-execution",leaseKey,()=>recoverUnlocked(c)),
    stopCompartment,
    async close(){closed=true;const results=await Promise.all([...seen].map(stopCompartment));if(results.some(result=>!result.stopped))throw Error("A native Sandbox CLI guardian exit is unknown; no VM-exit claim was inferred.");}
  };
}
