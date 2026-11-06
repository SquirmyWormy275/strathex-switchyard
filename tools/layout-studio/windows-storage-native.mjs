/** Fixed Windows setup/metadata transport with durable exact guardian ownership. */
import {createHash,randomUUID} from "node:crypto";
import {open,realpath,lstat} from "node:fs/promises";
import {dirname} from "node:path";
import {fileURLToPath} from "node:url";
import {runOwnedNativeCommand} from "./owned-native-command.mjs";
import {runtimeGuardianStopped,runRuntimeCommand} from "./runtime-command.mjs";
import {desktopEnvironment} from "./process-environment.mjs";
import {validateWindowsExchangeBinding} from "./windows-sandbox-native.mjs";
import {directoryIdentity} from "./private-fs.mjs";
const helper=fileURLToPath(new URL("../../runtime/hotkeys/Switchyard.Hotkeys.exe",import.meta.url)),setup=fileURLToPath(new URL("../../runtime/hotkeys/Switchyard.Setup.exe",import.meta.url));
const sha=bytes=>createHash("sha256").update(bytes).digest("hex"),sid=value=>typeof value==="string"&&/^S-1-5-21-(?:[0-9]{1,10}-){3}[0-9]{1,10}$/.test(value),uuid=value=>typeof value==="string"&&value!=="00000000-0000-0000-0000-000000000000"&&/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/.test(value),digest=value=>typeof value==="string"&&/^[a-f0-9]{64}$/.test(value);
const hostSchema="switchyard-windows-storage-broker-host/v1",exact=(value,keys)=>value&&typeof value==="object"&&!Array.isArray(value)&&Object.keys(value).sort().join()===keys.slice().sort().join();
function exchangeProof(value,verb){
 const keys=["state","effectStarted","attached","mounted","detachedVerified","exchangeQuotaEnforced","virtualBytes","backingBytes","sandboxEnforced"],states={create:"created",attach:"mounted",detach:"detached",retire:"retired"};
 if(!exact(value,keys)||!["created","mounted","detached","retired","outcome-unconfirmed"].includes(value.state)||value.virtualBytes!==67108864||value.backingBytes!==67109376||value.sandboxEnforced!==false||![value.effectStarted,value.attached,value.mounted,value.detachedVerified,value.exchangeQuotaEnforced].every(v=>typeof v==="boolean"))throw Error("The exact bounded exchange proof did not verify.");
 const mounted=value.state==="mounted",detached=["created","detached","retired"].includes(value.state);
 if(value.attached!==mounted||value.mounted!==mounted||value.exchangeQuotaEnforced!==mounted||value.detachedVerified!==detached||value.effectStarted!==(verb!=="inspect")||value.state!=="outcome-unconfirmed"&&verb!=="inspect"&&value.state!==states[verb])throw Error("The bounded exchange effect or observation contradicts its original request.");
 return structuredClone(value);
}
export function createWindowsStorageNative({store,platform=process.platform,helperPath=helper,setupPath=setup,command=runRuntimeCommand,guardianStopped=frame=>runtimeGuardianStopped(frame,{windowsHelper:helperPath}),now=Date.now}={}){
 const resources=new Map();let closed=false,seen=false;
 const current=()=>{if(closed||platform!=="win32")throw Error("The fixed Windows storage setup transport is unavailable on this host.");};
 async function pin(path){
  const parent=await directoryIdentity(dirname(path)),canonical=await realpath(path),file=await open(path,"r");
  try{const stat=await file.stat({bigint:true}),named=await lstat(path,{bigint:true}),resolved=await lstat(canonical,{bigint:true}),currentParent=await directoryIdentity(dirname(path));if(parent.dev!==currentParent.dev||parent.ino!==currentParent.ino||!stat.isFile()||!named.isFile()||named.isSymbolicLink()||!resolved.isFile()||resolved.isSymbolicLink()||stat.dev!==named.dev||stat.ino!==named.ino||stat.dev!==resolved.dev||stat.ino!==resolved.ino||stat.size!==named.size||stat.size!==resolved.size||stat.size<1n||stat.size>134217728n)throw Error("The installed native setup image is missing, redirected or oversized.");const hash=createHash("sha256"),buffer=Buffer.alloc(65536);let total=0;while(true){const {bytesRead}=await file.read(buffer,0,buffer.length,null);if(!bytesRead)break;total+=bytesRead;if(total>134217728)throw Error("The installed native setup image exceeded its bound.");hash.update(buffer.subarray(0,bytesRead));}if(BigInt(total)!==stat.size)throw Error("The installed native setup image changed.");return hash.digest("hex");}finally{await file.close();}
 }
 async function update(id,action,fn){return store.update("personal",action,state=>{const row=state.windowsStorageNative?.find(row=>row.id===id);if(!row)throw Error("The original Windows storage guardian record changed.");return fn(row);});}
 async function reconcile(){
  current();seen=true;let stopped=true;
  for(const row of (await store.snapshot("personal")).windowsStorageNative??[]){
   if(row.ownedRuntime&&row.stoppedVerified!==true){if(await guardianStopped(row.ownedRuntime))await update(row.id,"windows-storage-native-observed-exit",saved=>{saved.stoppedVerified=true;});else stopped=false;}
   else if(!row.ownedRuntime&&row.status==="reserved"&&!resources.has(row.id))await update(row.id,"windows-storage-native-no-ack",saved=>{saved.status="not-started";saved.stoppedVerified=true;});
  }
  return {stopped};
 }
 async function run(kind,path,args,{expectedSha256,inputText,check=async()=>{},signal,timeout=15000}={}){
  current();await check();if(!(await reconcile()).stopped)throw Error("A prior storage guardian has no independent exit; no replacement was started.");
  const id=randomUUID(),resource={controller:new AbortController(),clients:new Set()},onAbort=()=>resource.controller.abort();signal?.addEventListener("abort",onAbort,{once:true});if(signal?.aborted)onAbort();resources.set(id,resource);
  try{await store.update("personal","windows-storage-native-reserve",state=>{const rows=state.windowsStorageNative??[],retained=rows.filter(row=>row.stoppedVerified!==true);state.windowsStorageNative=[...retained,...rows.filter(row=>!retained.includes(row)).slice(-16)];if(state.windowsStorageNative.length>=64)throw Error("The storage guardian inventory is full; preserve its original evidence.");state.windowsStorageNative.push({id,kind,executableSha256:expectedSha256,status:"reserved",stoppedVerified:false,at:now()});});}catch(error){resources.delete(id);signal?.removeEventListener("abort",onAbort);throw error;}
  let saved=false,result;
  try{
   result=await runOwnedNativeCommand({executable:path,args,cwd:dirname(path),env:desktopEnvironment(),text:inputText,expectedExecutableSha256:expectedSha256,timeout,maxOutputBytes:16384,captureStderrBytes:0,resource,signal:resource.controller.signal,command:(exe,argv,options)=>command(exe,argv,{...options,windowsHelper:helperPath}),guardianStopped,
    onReady:async scope=>{if(scope.containment!=="windows-job")throw Error("Windows setup requires its exact native Job Object guardian.");await update(id,"windows-storage-native-ready",row=>{row.ownedRuntime=scope;row.status="running";});saved=true;await check();},
    onStopped:async scope=>{if(!await guardianStopped(scope))throw Error("The original Windows storage guardian has no independently verified exit.");if(saved)await update(id,"windows-storage-native-exit",row=>{if(row.ownedRuntime.id!==scope.id)throw Error("The exact storage guardian changed.");row.stoppedVerified=true;});}});
   await update(id,"windows-storage-native-result",row=>{row.status="settled";row.exitCode=result.exitCode;row.resultDigest=sha(result.stdout);});
   let value;try{value=JSON.parse(result.stdout);}catch{throw Error("The fixed Windows storage helper returned no bounded structured result.");}
   return {value,status:result.status,exitCode:result.exitCode,nativeRecordId:id,nativeExitVerified:true};
  }finally{
   signal?.removeEventListener("abort",onAbort);const exits=await Promise.all([...resource.clients].map(client=>client.stop().catch(()=>false)));
   if(!result)await update(id,"windows-storage-native-unconfirmed",row=>{row.status=saved?"outcome-unconfirmed":"not-started";if(!saved&&exits.every(Boolean))row.stoppedVerified=true;});
   if(exits.every(Boolean))resources.delete(id);
  }
 }
 async function identity(context={}){
  current();const helperSha256=await pin(helperPath),setupSha256=await pin(setupPath),result=await run("identity",setupPath,["--metadata"],{...context,expectedSha256:setupSha256});const value=result.value;
  if(result.exitCode!==0||!value||Object.keys(value).sort().join()!=="clientSid,effectStarted,schema,status"||value.schema!=="switchyard-windows-native-setup/v1"||value.status!=="available"||value.effectStarted!==false||!sid(value.clientSid))throw Error("The exact native Windows setup identity did not verify.");
  return {clientSid:value.clientSid,ownerScope:sha(value.clientSid),helperSha256,setupSha256};
 }
 async function broker(binding,action,body,context={}){
  current();if(!binding||!sid(binding.clientSid)||binding.ownerScope!==sha(binding.clientSid)||!digest(binding.helperSha256)||await pin(helperPath)!==binding.helperSha256)throw Error("The original broker client or helper image changed.");
  const result=await run(action,helperPath,["--windows-storage-broker"],{...context,timeout:60000,expectedSha256:binding.helperSha256,inputText:JSON.stringify({schema:hostSchema,action,...body})}),value=result.value;
  if(result.status!=="completed"||result.exitCode!==0||value?.schema!==hostSchema||value.action!==action||value.brokerImplemented!==false)throw Error("The original fixed broker transport did not verify.");
  return {...result,value};
 }
 function installation(value,binding){
  if(!exact(value,["installationId","ownerScope","serviceImageSha256"])||!uuid(value.installationId)||value.ownerScope!==binding.ownerScope||!digest(value.serviceImageSha256))throw Error("Bind the exact original protected broker installation.");return value;
 }
 function exchangeRequest(input,binding){
  if(!exact(input,["installation","verb","requestId","operationId","taskScopeSha256","inputManifestSha256"])||!["create","inspect","attach","detach","retire"].includes(input.verb)||!uuid(input.requestId)||!uuid(input.operationId)||![input.taskScopeSha256,input.inputManifestSha256].every(digest))throw Error("Use only a fixed broker exchange verb and exact original operation, task and inputs.");
  const {installation:scope,...fields}=input;return {...installation(scope,binding),...fields};
 }
 async function exchangeCall(binding,input,context,lookup){
  const fields=exchangeRequest(input,binding),action=lookup?"exchange-result":"exchange";
  const {value,...owned}=await broker(binding,action,fields,context),keys=["schema","action","status",...Object.keys(fields),"protocolVerified","proof","brokerImplemented",...(lookup?["effectStarted"]:[])];
  const statusValid=lookup?["absent","reserved","recorded"].includes(value.status)&&value.effectStarted===false:value.status==="exchange-observed";
  if(!exact(value,keys)||Object.entries(fields).some(([key,expected])=>value[key]!==expected)||value.protocolVerified!==true||!statusValid)throw Error("The exact original broker exchange result scope did not verify.");
  if(lookup&&value.status!=="recorded"){if(value.proof!==null)throw Error("An unrecorded exchange cannot claim a completed native proof.");return {status:value.status,proof:null,nativeRecordId:owned.nativeRecordId,nativeExitVerified:true};}
  return {status:lookup?"recorded":"observed",proof:exchangeProof(value.proof,input.verb),nativeRecordId:owned.nativeRecordId,nativeExitVerified:true};
 }
 return {
  identity,reconcile,
  async probeExchange(binding,context={}){
   const {value,...owned}=await broker(binding,"probe-exchange",{},context),base=["schema","action","status","exchangeSupported","effectStarted","brokerImplemented"];
   if(value.effectStarted!==false||!["available","unavailable"].includes(value.status)||value.exchangeSupported!==(value.status==="available")||!exact(value,value.status==="available"?[...base,"installationId","ownerScope","serviceImageSha256","protocolVerified"]:base))throw Error("The read-only broker exchange capability did not verify.");
   if(value.status==="unavailable")return {status:"unavailable",effectStarted:false,nativeRecordId:owned.nativeRecordId,nativeExitVerified:true};
   const scope=installation({installationId:value.installationId,ownerScope:value.ownerScope,serviceImageSha256:value.serviceImageSha256},binding);if(value.protocolVerified!==true)throw Error("The original broker capability did not authenticate.");return {status:"available",installation:scope,effectStarted:false,nativeRecordId:owned.nativeRecordId,nativeExitVerified:true};
  },
  exchange:(binding,input,context={})=>exchangeCall(binding,input,context,false),
  lookupExchange:(binding,input,context={})=>exchangeCall(binding,input,context,true),
  async exchangeBinding(binding,input,context={}){
   if(!exact(input,["installation","operationId","taskScopeSha256","inputManifestSha256"])||!uuid(input.operationId)||![input.taskScopeSha256,input.inputManifestSha256].every(digest))throw Error("Observe only one original protected exchange mapping scope.");
   const {installation:scope,...operation}=input,fields={...installation(scope,binding),...operation},{value,...owned}=await broker(binding,"exchange-binding",fields,context);
   if(!exact(value,["schema","action","status","binding","protocolVerified","effectStarted","brokerImplemented"])||value.status!=="mapping-verified"||value.protocolVerified!==true||value.effectStarted!==false)throw Error("The read-only native exchange mapping did not verify.");
   const mapped=validateWindowsExchangeBinding(value.binding,input.operationId),expected={...scope,taskScopeSha256:input.taskScopeSha256,inputManifestSha256:input.inputManifestSha256};
   if(!mapped.broker||Object.entries(expected).some(([key,v])=>mapped.broker[key]!==v))throw Error("The mapping belongs to another original broker, task or reviewed input manifest.");return {binding:mapped,nativeRecordId:owned.nativeRecordId,nativeExitVerified:true};
  },
  async observe(binding,context={}){
   current();if(!binding||!sid(binding.clientSid)||!digest(binding.helperSha256)||await pin(helperPath)!==binding.helperSha256)throw Error("The reviewed helper identity changed before broker observation.");
   const result=await run("broker-metadata",helperPath,["--windows-storage-broker"],{...context,expectedSha256:binding.helperSha256,inputText:JSON.stringify({schema:"switchyard-windows-storage-broker-host/v1",action:"metadata"})});const value=result.value;
   if(result.exitCode!==0||!value||value.schema!=="switchyard-windows-storage-broker-host/v1"||value.action!=="metadata"||value.effectStarted!==false||value.brokerImplemented!==false||!["bootstrap-ready","unavailable"].includes(value.status))throw Error("The original broker metadata response did not verify.");
   if(value.status==="bootstrap-ready"&&(!uuid(value.installationId)||value.ownerScope!==binding.ownerScope||!digest(value.serviceImageSha256)||value.protocolVerified!==true||value.storage?.privilegeStateUnchanged!==true||value.storage?.effectStarted!==false||value.storage?.brokerImplemented!==false))throw Error("The signed broker installation scope did not verify.");
   return {status:value.status,...(value.status==="bootstrap-ready"?{installationId:value.installationId,ownerScope:value.ownerScope,serviceImageSha256:value.serviceImageSha256,protocolVerified:true}:{installationAbsentVerified:value.installationAbsentVerified===true}),nativeRecordId:result.nativeRecordId};
  },
  async perform(input,context={}){
   current();const {action,installationId,brokerImageSha256,binding}=input;
   if(!["install-bootstrap","remove-bootstrap"].includes(action)||!uuid(installationId)||!digest(brokerImageSha256)||!binding||!sid(binding.clientSid)||!digest(binding.setupSha256)||!digest(binding.helperSha256)||await pin(helperPath)!==binding.helperSha256||await pin(setupPath)!==binding.setupSha256||action==="install-bootstrap"&&brokerImageSha256!==binding.helperSha256)throw Error("The exact reviewed native setup scope or image changed.");
   const args=[`--${action}`,binding.clientSid,installationId,binding.helperSha256,...(action==="remove-bootstrap"?[brokerImageSha256]:[])],result=await run(action,setupPath,args,{...context,expectedSha256:binding.setupSha256,timeout:300000}),value=result.value;
   const expected={completed:[0,true],cancelled:[1223,false],unavailable:[2,false],"outcome-unconfirmed":[3,true]}[value?.status];
   if(!value||Object.keys(value).sort().join()!=="effectStarted,schema,status"||value.schema!=="switchyard-windows-native-setup/v1"||!expected||result.exitCode!==expected[0]||value.effectStarted!==expected[1])throw Error("The exact native setup did not return a verified terminal result.");
   return {...value,nativeRecordId:result.nativeRecordId,nativeExitVerified:result.nativeExitVerified};
  },
  async stop(){const results=await Promise.all([...resources.values()].flatMap(resource=>{resource.controller.abort();return [...resource.clients].map(client=>client.stop().catch(()=>false));})),retained=seen&&platform==="win32"?await reconcile():{stopped:true};return {stopped:results.every(Boolean)&&retained.stopped,elevatedSetupOutcomeInferred:false};},
  async close(){if(closed)return;const result=await this.stop();closed=true;if(!result.stopped)throw Error("A retained storage guardian still needs independent exit verification.");}
 };
}
