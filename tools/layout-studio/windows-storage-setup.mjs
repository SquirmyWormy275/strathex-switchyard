/** One-use Personal host maintenance; never provider/task or volume authority. */
import {createHash,randomUUID} from "node:crypto";
import {DurableBudgetManager} from "../../packages/control-plane/src/budgets.ts";
import {OperationSagaStore} from "../../packages/control-plane/src/operations.ts";
import {ReceiptLedger} from "../../packages/control-plane/src/receipts.ts";
import {suiteConfirmations,scopeHash} from "./confirmations.mjs";
import {repositoryEffectJournal} from "./repository-effect-journal.mjs";
import {createWindowsStorageNative} from "./windows-storage-native.mjs";
const action="configure_windows_storage",policyVersion="suite-windows-storage-setup/v1",uuid=value=>typeof value==="string"&&/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/.test(value),hash=value=>createHash("sha256").update(value).digest("hex");
const workspace=state=>scopeHash([state.id,state.policy,state.mode,state.modeSelectedAt??null,state.accounts]);
const limits={version:policyVersion,commandClasses:{[action]:{maxConcurrent:1,timeoutMs:360000,maxAttempts:1,windowMs:3600000,maxClaimsPerWindow:4,maxCostUnitsPerWindow:4,defaultCostUnits:1}}};
const view=row=>({requestId:row.requestId,action:row.action,installationId:row.installationId,ownerScope:row.binding.ownerScope,helperSha256:row.binding.helperSha256,setupSha256:row.binding.setupSha256,brokerImageSha256:row.brokerImageSha256,scopeDigest:row.scopeDigest,status:row.status,expiresAt:row.expiresAt,result:row.result??null});
const observation=value=>value.status==="bootstrap-ready"?{status:value.status,installationId:value.installationId,ownerScope:value.ownerScope,serviceImageSha256:value.serviceImageSha256,protocolVerified:value.protocolVerified}:{status:value.status,installationAbsentVerified:value.installationAbsentVerified===true};
export function createWindowsStorageSetup({store,platform=process.platform,native=createWindowsStorageNative({store,platform}),isActive=async()=>true,now=Date.now}={}){
 let closed=false,generation=0,pending=null,active=null,seen=false;
 const journal=repositoryEffectJournal(store,"personal",{domain:"storage",now});
 function ledger(transaction,source=journal){const port=transaction?{transaction:fn=>fn(transaction),readEntries:transaction.readEntries}:source,clock=()=>new Date(now()).toISOString();return {operations:new OperationSagaStore(port,{clock}),budgets:new DurableBudgetManager(port,{clock}),receipts:new ReceiptLedger(port,{clock})};}
 async function state(compartment,requireMode=true){if(compartment!=="personal")throw Error("Windows host setup is administered only from Personal; Work and imported task authority cannot request it.");const current=await store.snapshot(compartment);if(current.policy!=="personal"||requireMode&&current.mode!=="personal-companion")throw Error("Choose Personal companion mode before reviewing Windows host setup.");if(closed||platform!=="win32")throw Error("Windows storage setup is unavailable on this host.");if(!await isActive(compartment))throw Error("Select Personal before managing its Windows host setup.");seen=true;return current;}
 async function exclusive(compartment,fn){await state(compartment);if(pending)throw Error("Wait for the current exact Windows setup operation.");const captured=generation;const work=Promise.resolve().then(()=>store.withResourceLock("windows-storage","primary-personal-host",async lease=>fn(captured,lease)));pending=work;try{return await work;}finally{if(pending===work)pending=null;}}
 function assertState(current,row,captured,lease){lease.assert();if(closed||captured!==generation||current.id!=="personal"||current.policy!=="personal"||current.mode!=="personal-companion"||workspace(current)!==row.workspaceDigest)throw Error("The reviewed Windows setup workspace or operating mode changed.");}
 async function update(id,event,fn){return store.update("personal",event,current=>{const row=current.windowsStorageReviews?.find(row=>row.requestId===id);if(!row)throw Error("The original Windows setup review changed.");return fn(row,current);});}
 async function recover(){
  if(platform!=="win32"||pending)return;const exits=await native.reconcile();seen=true;if(!exits.stopped)return;
  const {operations,receipts}=ledger();
  for(const row of (await store.snapshot("personal")).windowsStorageReviews??[]){
   if(!["applying","outcome-unconfirmed"].includes(row.status))continue;
   const operation=await operations.get(row.requestId),receipt=operation?.details.receiptId?await receipts.get(operation.details.receiptId):undefined;
   if(operation?.state!=="recorded"||operation.action!==action||receipt?.operationId!==row.requestId||receipt.action!==action||receipt.targetSnapshotId!==row.scopeDigest||receipt.result!=="passed"||receipt.completeness!=="complete"||!row.nativeResult?.nativeExitVerified)continue;
   await update(row.requestId,"windows-storage-receipt-recovery",saved=>{saved.status="settled";saved.result={status:"completed",operationId:row.requestId,receiptId:receipt.id,installationId:row.installationId,action:row.action,brokerImplemented:false,volumeOpened:false,nativeExitVerified:true,recoveredWithoutReplay:true};});
  }
 }
 return {
  recover,
  async inspect(compartment){
   if(platform!=="win32")return {status:"unavailable",setupSupported:false,brokerImplemented:false,volumeOpened:false};await state(compartment,false);await recover();
   return store.withResourceLock("windows-storage","primary-personal-host",async lease=>{const current=await state(compartment,false),scope=workspace(current),check=async()=>{lease.assert();if(workspace(await state(compartment,false))!==scope)throw Error("The host setup observation scope changed.");};const binding=await native.identity({check}),observed=await native.observe(binding,{check});return {setupSupported:true,...observation(observed),ownerScope:binding.ownerScope,helperSha256:binding.helperSha256,setupSha256:binding.setupSha256,brokerImplemented:false,volumeOpened:false};});
  },
  async review(compartment,input){
   if(Object.keys(input).some(key=>!["compartment","requestId","action"].includes(key))||!uuid(input.requestId)||!["install-bootstrap","remove-bootstrap"].includes(input.action))throw Error("Review one fixed Windows setup action and new request UUID; paths, programs, privileges and approval assertions are not accepted.");
   await state(compartment);await recover();return exclusive(compartment,async(captured,lease)=>{
    const current=await state(compartment),workspaceDigest=workspace(current),base={workspaceDigest},check=async()=>assertState(await state(compartment),base,captured,lease);
    if(current.windowsStorageReviews?.some(row=>row.requestId===input.requestId||["applying","outcome-unconfirmed"].includes(row.status)))throw Error("Preserve the existing Windows setup operation and reconcile its original result before creating another.");
    const binding=await native.identity({check}),observed=observation(await native.observe(binding,{check}));
    if(input.action==="install-bootstrap"&&(observed.status!=="unavailable"||!observed.installationAbsentVerified))throw Error("The original installation is present or unverified; unavailable metadata alone cannot authorize replacement.");
    if(input.action==="remove-bootstrap"&&observed.status!=="bootstrap-ready")throw Error("Removal requires the exact original installation and a fresh signed metadata response.");
    const installationId=input.action==="install-bootstrap"?randomUUID():observed.installationId,brokerImageSha256=input.action==="install-bootstrap"?binding.helperSha256:observed.serviceImageSha256,scopeDigest=scopeHash([policyVersion,input.requestId,input.action,installationId,brokerImageSha256,binding,workspaceDigest,observed]);
    const confirmation=await suiteConfirmations(store,"personal",undefined,now).issue({action,targetSnapshotId:scopeDigest,scopeDigest,reason:input.action==="install-bootstrap"?"Install only this metadata bootstrap for the current Windows user. The native installer may request UAC; no volume is created, mounted or authorized.":"Remove only the original verified metadata service after exact process exit. Unknown state is preserved.",reauthenticated:false});
    await check();const row={schema:"switchyard-windows-storage-review/v1",requestId:input.requestId,action:input.action,installationId,brokerImageSha256,binding,workspaceDigest,observed,scopeDigest,tokenDigest:hash(confirmation.token),expiresAt:confirmation.record.expiresAt,status:"reviewed"};
    await store.update("personal","windows-storage-review",saved=>{assertState(saved,row,captured,lease);const rows=saved.windowsStorageReviews??[],retained=rows.filter(candidate=>["applying","outcome-unconfirmed"].includes(candidate.status)||candidate.status==="reviewed"&&Date.parse(candidate.expiresAt)>now());saved.windowsStorageReviews=[...retained,...rows.filter(candidate=>!retained.includes(candidate)).slice(-16)];if(saved.windowsStorageReviews.length>=32||saved.windowsStorageReviews.some(candidate=>candidate.requestId===row.requestId))throw Error("The host setup inventory is full or changed; original reviews were preserved.");saved.windowsStorageReviews.push(row);});
    return {status:"requires-confirmation",review:view(row),confirmation,budget:limits.commandClasses[action],brokerImplemented:false,volumeOpened:false};
   });
  },
  async apply(compartment,input){
   if(Object.keys(input).some(key=>!["compartment","requestId","token"].includes(key))||!uuid(input.requestId)||!uuid(input.token))throw Error("Apply only one exact Windows setup review and its one-use approval.");await state(compartment);await recover();
   return exclusive(compartment,async(captured,lease)=>{
    const current=await state(compartment),row=current.windowsStorageReviews?.find(row=>row.requestId===input.requestId);if(!row||row.tokenDigest!==hash(input.token))throw Error("The exact Windows setup approval is unavailable.");
    if(row.status!=="reviewed")return {...(row.result??{status:"incomplete",effectDisposition:"ambiguous",operationId:row.requestId,summary:"The original setup outcome is unconfirmed; no elevation was replayed."}),replayed:true};
    const check=async()=>assertState(await state(compartment),row,captured,lease);await check();
    const binding=await native.identity({check}),before=observation(await native.observe(binding,{check}));if(scopeHash(binding)!==scopeHash(row.binding)||scopeHash(before)!==scopeHash(row.observed))throw Error("The reviewed native images, user or original installation changed.");
    const approval=await suiteConfirmations(store,"personal",undefined,now).consume({action,targetSnapshotId:row.scopeDigest,scopeDigest:row.scopeDigest,token:input.token});if(!approval.allowed)throw Error(approval.reason);
    await update(row.requestId,"windows-storage-reserve",(saved,latest)=>{assertState(latest,row,captured,lease);if(saved.status!=="reviewed")throw Error("The original Windows setup approval was already reserved.");saved.status="applying";});
    const controller=new AbortController();active=controller;let claimId,result,nativeResult,attempted=false,phase="admission";
    try{
     claimId=await journal.transaction(async transaction=>{const {operations,budgets}=ledger(transaction);await budgets.configure(limits);const begun=await operations.begin({id:row.requestId,idempotencyKey:row.requestId,action,targetSnapshotId:row.scopeDigest,details:{maintenanceAction:row.action,installationId:row.installationId}});if(begun.reused)throw Error("The original setup operation cannot be replayed.");const claimed=await budgets.claim({operationId:row.requestId,commandClass:action,requestedBy:"authenticated-personal-host-review"});if(!claimed.allowed)throw Error(claimed.reason);const started=await budgets.start(claimed.claim.id);if(!started.allowed)throw Error(started.reason);await operations.advance(row.requestId,"executing");return claimed.claim.id;});
     await check();const claim=await ledger().budgets.get(claimId);if(claim?.state!=="running"||Date.parse(claim.expiresAt)<=now())throw Error("The exact host setup budget expired before elevation.");
     phase="native-setup";attempted=true;nativeResult=await native.perform({action:row.action,installationId:row.installationId,brokerImageSha256:row.brokerImageSha256,binding:row.binding},{check,signal:controller.signal});
     await update(row.requestId,"windows-storage-native-facts",saved=>{saved.nativeResult=nativeResult;});
     if(nativeResult.status!=="completed"||nativeResult.nativeExitVerified!==true)throw Error("The native installer did not verify complete setup and exit.");
     phase="post-effect-observation";await check();const after=observation(await native.observe(row.binding,{check}));
     if(row.action==="install-bootstrap"?(after.status!=="bootstrap-ready"||after.installationId!==row.installationId||after.serviceImageSha256!==row.brokerImageSha256||after.ownerScope!==row.binding.ownerScope||after.protocolVerified!==true):(after.status!=="unavailable"||!after.installationAbsentVerified))throw Error("The original setup effect did not match its fresh authenticated host observation.");
     phase="receipt-recording";
     const guarded={...store,update:(id,event,fn,options)=>store.update(id,event,saved=>{assertState(saved,row,captured,lease);return fn(saved);},options)},guardedJournal=repositoryEffectJournal(guarded,"personal",{domain:"storage",now});
     const receipt=await guardedJournal.transaction(async transaction=>{const {operations,budgets,receipts}=ledger(transaction);await operations.advance(row.requestId,"external_committed");const receipt=await receipts.issue({operationId:row.requestId,action,targetSnapshotId:row.scopeDigest,result:"passed",completeness:"complete",evidenceDigest:scopeHash([row.scopeDigest,nativeResult,after]),policyVersion,toolVersions:{setup:`sha256:${row.binding.setupSha256}`,helper:`sha256:${row.binding.helperSha256}`}});await operations.advance(row.requestId,"recorded",{receiptId:receipt.id,commandStatus:"completed"});await budgets.settle(claimId,"completed");return receipt;});
     result={status:"completed",effectDisposition:"committed",operationId:row.requestId,receiptId:receipt.id,installationId:row.installationId,action:row.action,nativeExitVerified:true,brokerImplemented:false,volumeOpened:false};
    }catch{
     const notStarted=!attempted||nativeResult?.effectStarted===false,knownExit=nativeResult?.nativeExitVerified===true;
     if(notStarted||knownExit&&nativeResult?.status==="completed"){const {operations,budgets}=ledger(),operation=await operations.get(row.requestId);if(operation&&!['recorded','failed','cancelled'].includes(operation.state)){if(operation.state==="external_committed")await operations.advance(row.requestId,"compensating");await operations.advance(row.requestId,"failed",{commandStatus:"incomplete"});}if(claimId)await budgets.settle(claimId,nativeResult?.status==="cancelled"?"cancelled":"failed");}
     result={status:nativeResult?.status==="cancelled"?"cancelled":"incomplete",effectDisposition:notStarted?"not_started":"ambiguous",operationId:row.requestId,installationId:row.installationId,failurePhase:phase,nativeExitVerified:knownExit,brokerImplemented:false,volumeOpened:false,summary:"Preserve the original host setup scope, native ownership and protected staging; no automatic elevation or installation retry is permitted."};
    }finally{if(active===controller)active=null;}
    await update(row.requestId,"windows-storage-result",saved=>{saved.status=result.status==="completed"||result.effectDisposition==="not_started"?"settled":"outcome-unconfirmed";saved.result=result;});return {...result,replayed:false};
   });
  },
  async list(compartment){if(compartment!=="personal")throw Error("Windows setup evidence belongs to Personal host maintenance.");return ((await store.snapshot(compartment)).windowsStorageReviews??[]).map(view);},
  async stopCompartment(compartment){if(compartment!=="personal")return {stopped:true};generation++;active?.abort();const nativeStop=await native.stop();await Promise.allSettled([pending].filter(Boolean));const uncertain=seen&&((await store.snapshot("personal")).windowsStorageReviews??[]).some(row=>["applying","outcome-unconfirmed"].includes(row.status)&&row.nativeResult?.status!=="completed"&&row.nativeResult?.effectStarted!==false);return {stopped:nativeStop.stopped&&!uncertain,elevatedSetupOutcomeInferred:false};},
  async close(){if(closed)return;const stopped=await this.stopCompartment("personal");closed=true;await native.close();if(!stopped.stopped)throw Error("The original elevated setup outcome still requires reconciliation; no exit was inferred.");}
 };
}
