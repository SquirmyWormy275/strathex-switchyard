/** Read-only recovery of the saved Windows editor host and carrier query Job.
 * Never signal/adopt the host, provider or terminal; never replay a task effect. */
import { createHash } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { lstat,realpath } from 'node:fs/promises';
import { dirname,join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { verifySuiteRelease } from '../../deployment/suite/release.mjs';
import { windowsEditorHost,windowsEditorIngressOwnership,windowsEditorJournalStates } from './windows-editor-journal-contract.mjs';
import { windowsQueryOwnership,windowsQueryIntent,queryIntentForOwner } from './windows-query-ownership.mjs';
import { windowsCodexBinding } from './windows-codex-binding.mjs';
import { windowsLocalExecutablePath } from './windows-terminal-process.mjs';
import { validateNativeFocusOwnerExit } from './windows-native-focus.mjs';
import { runOwnedNativeCommand } from './owned-native-command.mjs';
import { runRuntimeCommand,runtimeGuardianStopped } from './runtime-command.mjs';
import { stopOwnedChild } from './owned-process.mjs';
import { desktopEnvironment } from './process-environment.mjs';

const require=v=>{if(!v)throw Error('The original Windows editor recovery evidence did not verify.');};
const exact=(v,keys)=>v && typeof v==='object' && !Array.isArray(v) && Object.keys(v).sort().join()===keys.slice().sort().join();
const same=(a,b)=>JSON.stringify(a)===JSON.stringify(b);
const uuid=v=>typeof v==='string' && /^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/.test(v);
const validHelper=v=>exact(v,['path','sha256']) && windowsLocalExecutablePath(v.path) && /^[a-f0-9]{64}$/.test(v.sha256??'');
async function packagedHelper(){
  const root=fileURLToPath(new URL('../../',import.meta.url)),release=await verifySuiteRelease(root,{platform:'win32',checkRuntime:true});require(!release.development);
  const file=release.files.find(f=>f.path==='runtime/hotkeys/Switchyard.Hotkeys.exe');require(file);return{path:join(root,file.path),sha256:file.sha256};
}
async function inspectSavedHelper(helper,current){
  require(validHelper(helper));await current();const file=await lstat(helper.path,{bigint:true});
  require(file.isFile() && !file.isSymbolicLink() && file.size>0n && file.size<=512n*1024n*1024n && await realpath(helper.path)===helper.path);
  const digest=createHash('sha256');for await(const chunk of createReadStream(helper.path))digest.update(chunk);
  const after=await lstat(helper.path,{bigint:true});require(after.dev===file.dev && after.ino===file.ino && after.size===file.size && digest.digest('hex')===helper.sha256);await current();return true;
}
function selectedRow(value){
  require(value && typeof value==='object' && Buffer.byteLength(JSON.stringify(value))<=32768);
  const row=structuredClone(value);require(row.schema==='switchyard-windows-editor-connection/v1' && uuid(row.requestId) && windowsEditorHost(row.host) && windowsEditorJournalStates.includes(row.status));
  if(row.upstream)require(exact(row.upstream,['kind','binding']) && row.upstream.kind==='logical-channel' && windowsCodexBinding(row.upstream.binding).peerPid!==row.host.processId);
  if(row.ingress)windowsEditorIngressOwnership(row.ingress,{requestId:row.requestId,hostPid:row.host.processId});
  if(row.queryOwner){require(exact(row.queryOwner,['ownership','stopped']) && typeof row.queryOwner.stopped==='boolean');windowsQueryOwnership(row.queryOwner.ownership);}
  if(row.queryIntent)windowsQueryIntent(row.queryIntent);
  if(row.queryNotStarted)windowsQueryIntent(row.queryNotStarted);
  require(row.queryTracking===undefined || row.queryTracking==='original-helper-intent/v1');
  if(row.queryTracking){
    if(row.querySequence===undefined)require(!row.lastQueryId && !row.queryIntent && !row.queryOwner && !row.queryNotStarted);
    else {
      require(Number.isSafeInteger(row.querySequence) && row.querySequence>=1 && row.querySequence<=1000000 && uuid(row.lastQueryId));
      if(row.queryIntent)require(row.queryIntent.requestId===row.lastQueryId && !row.queryNotStarted);
      else if(row.queryNotStarted)require(row.queryNotStarted.requestId===row.lastQueryId && (!row.queryOwner || row.queryOwner.stopped));
      else require(row.queryOwner?.stopped===true && row.queryOwner.ownership.requestId===row.lastQueryId);
    }
  }
  return row;
}

export function createWindowsEditorRecovery({platform=process.platform,helper=packagedHelper,command=runRuntimeCommand,guardianStopped=runtimeGuardianStopped,stopChild=stopOwnedChild,verifySavedHelper=inspectSavedHelper}={}){
  require([helper,command,guardianStopped,stopChild,verifySavedHelper].every(f=>typeof f==='function'));
  const resource={clients:new Set(),controller:new AbortController()},observers=new Set();let pending,closed=false,uncertain=false;
  const verifyScope=(scope,native)=>guardianStopped(scope,{windowsHelper:native.path,onGuardianChild:child=>observers.add(child)});
  async function retireObservers(){
    const results=await Promise.all([...resource.clients].map(client=>client.stop().catch(()=>false)));
    const queries=await Promise.all([...observers].map(child=>stopChild(child).then(r=>r.stopped===true,()=>false)));
    require(results.every(Boolean) && queries.every(Boolean));resource.clients.clear();observers.clear();
  }
  return Object.freeze({
    verify(input,beforeEffect){
      require(platform==='win32' && !closed && !pending && !uncertain && typeof beforeEffect==='function');const row=selectedRow(input);
      const current=async()=>{require(!closed && !resource.controller.signal.aborted);await beforeEffect();require(!closed && !resource.controller.signal.aborted);};
      const work=Promise.resolve().then(async()=>{
        const facts={hostExitVerified:false,clientConnectionRetired:false,carrierExitVerified:false,queryHelpersExitVerified:false};
        try{
          await current();const native=await helper();require(validHelper(native));await current();
          let hostObserverStopped=false;
          const owner={processId:row.host.processId,processStartTime:row.host.birth};
          const result=await runOwnedNativeCommand({executable:native.path,args:['--native-desktop-owner-v1'],cwd:dirname(native.path),env:desktopEnvironment(),expectedExecutableSha256:native.sha256,
            text:JSON.stringify({schema:'switchyard-native-focus-owner-query/v1',...owner})+'\n',resource,signal:resource.controller.signal,timeout:10000,maxOutputBytes:8192,captureStderrBytes:0,
            command:(exe,args,options)=>command(exe,args,{...options,windowsHelper:native.path}),guardianStopped:scope=>verifyScope(scope,native),stopChild,
            onReady:async scope=>{require(scope.containment==='windows-job');await current();},onStopped:async scope=>{require(await verifyScope(scope,native));hostObserverStopped=true;}
          });
          await current();require(hostObserverStopped && result.status==='completed' && result.exitCode===0);
          facts.hostExitVerified=validateNativeFocusOwnerExit(JSON.parse(result.stdout),owner);if(!facts.hostExitVerified)return facts;
          // Both logical client and listener live inside this exact saved host.
          facts.clientConnectionRetired=true;facts.carrierExitVerified=true;
          if(row.queryTracking!=='original-helper-intent/v1'){
            // Older checkpoints cannot exclude an unrecorded query startup.
            facts.queryHelpersExitVerified=!row.ingress && ['reserved','upstream'].includes(row.status);return facts;
          }
          if(row.queryIntent){
            if(!row.queryOwner || !same(row.queryIntent,queryIntentForOwner(row.queryOwner.ownership)))return facts;
          }else if(row.queryOwner && !row.queryOwner.stopped)return facts;
          if(row.queryOwner && !row.queryOwner.stopped){
            const original=windowsQueryOwnership(row.queryOwner.ownership);require(await verifySavedHelper(original.helper,current));await current();
            facts.queryHelpersExitVerified=await verifyScope(original.scope,original.helper)===true;await current();
          }else facts.queryHelpersExitVerified=!row.queryIntent;
          return facts;
        }finally{try{await retireObservers();}catch(error){uncertain=true;throw error;}}
      });pending=work;void work.then(()=>{pending=undefined;},()=>{pending=undefined;});return work;
    },
    async close(){closed=true;resource.controller.abort();await pending?.catch(()=>{});await retireObservers();return{stoppedVerified:true,observedProcessesTerminated:false};}
  });
}
