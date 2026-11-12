/** Protected Windows editor lifecycle. No terminal launch or provider adoption. */
import { createHash } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { lstat,realpath } from 'node:fs/promises';
import { createCodingEditorJournal } from './coding-editor-journal.mjs';
import { createWindowsTerminalProcessProbe } from './windows-terminal-process.mjs';
import { windowsEditorHost } from './windows-editor-journal-contract.mjs';
import { openWindowsCodexEditorConnection } from './windows-codex-editor-connection.mjs';
import { createWindowsEditorRecovery } from './windows-editor-recovery.mjs';

const require=v=>{if(!v)throw Error('The original Windows editor lifecycle is unavailable or changed.');};
const hash=v=>createHash('sha256').update(JSON.stringify(v)).digest('hex');
const uuid=v=>typeof v==='string' && /^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/.test(v);
const fields=['requestId','editorId','ownerRequestId','loadRequestId'];
const selected=v=>{require(v && typeof v==='object' && !Array.isArray(v) && Object.keys(v).sort().join()===fields.slice().sort().join() && fields.every(k=>uuid(v[k])));return Object.freeze({...v});};
const deferred=()=>{let resolve;const promise=new Promise(r=>resolve=r);return{promise,resolve};};
async function observeHost(probe,context){
  await context.assertCurrent();const path=await realpath(process.execPath),s=await lstat(path,{bigint:true});
  require(s.isFile() && !s.isSymbolicLink() && s.size>0n && s.size<=512n*1024n*1024n);
  const digest=createHash('sha256');for await(const b of createReadStream(path))digest.update(b);await context.assertCurrent();
  return probe.inspect({processId:process.pid,expectedBirth:null,image:{path,sha256:digest.digest('hex'),device:String(s.dev),inode:String(s.ino),size:String(s.size)}},context);
}

export function createWindowsCodingEditorConnections({store,authorizations,owners,now=Date.now,platform=process.platform,
  hostProbeFactory=createWindowsTerminalProcessProbe,hostObservation=observeHost,connectionFactory=openWindowsCodexEditorConnection,probeFactory,recoveryFactory=createWindowsEditorRecovery}={}){
  require(platform==='win32' && typeof owners?.openEditorClient==='function' && [hostProbeFactory,hostObservation,connectionFactory,recoveryFactory].every(f=>typeof f==='function'));
  const journal=createCodingEditorJournal({store,authorizations,now,platform}),live=new Map(),pending=new Map(),generations=new Map(),transitions=new Map(),recoveries=new Map();
  let closed=false,closing;const key=(c,s)=>c+':'+s.requestId,generation=c=>generations.get(c)??0;
  const track=(c,fn)=>{const p=Promise.resolve().then(fn);pending.set(p,c);void p.then(()=>pending.delete(p),()=>pending.delete(p));return p;};
  const valid=r=>require(!closed && !transitions.has(r.c) && r.g===generation(r.c) && !r.stopping && !r.abort.signal.aborted && !r.connection?.observation().closed);
  async function current(r){valid(r);if(r.handle)await r.handle.assertCurrent();else {const target=await authorizations.returnTarget(r.c,r.s);if(r.target)require(hash(target)===hash(r.target));}valid(r);}
  const observation=r=>{const o=r.connection?.observation();return{requestId:r.s.requestId,status:r.stopping?'closing':o?.closed?'closed':o?.protocolAcknowledged?'acknowledged':o?.peerVerified?'connected':r.connection?'ready':'preparing',peerVerified:o?.peerVerified===true,protocolAcknowledged:o?.protocolAcknowledged===true,terminalLaunched:false,ideAttached:false,authorityGranted:false,completionVerified:false};};
  const closeResources=r=>{r.abort.abort();r.connection?.close();r.client?.close();};
  async function retireClient(client){require(client.retirementKind==='logical-channel');const result=await client.stop();require(result.stopped===true && result.logicalClientRetired===true && result.nativeProcessTerminated===false);return result;}
  function stop(r){
    if(r.stopping)return r.stopping;
    r.stopping=Promise.resolve().then(async()=>{
      closeResources(r);await r.started.promise;
      const facts={clientConnectionRetired:!r.client,carrierExitVerified:!r.connectionAttempted,queryHelpersExitVerified:!r.connectionAttempted};let hostRetired=!r.hostProbe;
      if(r.connection)try{r.retirement=await r.connection.stop();}catch{}
      if(r.retirement?.stopped===true)for(const k of Object.keys(facts))facts[k]=r.retirement[k]===true;
      if(r.client)try{await retireClient(r.client);facts.clientConnectionRetired=true;}catch{}
      if(r.hostProbe)try{hostRetired=(await r.hostProbe.close()).stoppedVerified===true;}catch{}
      const result=r.handle?await r.handle.retire(facts):{stoppedVerified:hostRetired};
      if(result.stoppedVerified && hostRetired)live.delete(key(r.c,r.s));return{...result,stoppedVerified:result.stoppedVerified && hostRetired};
    });return r.stopping;
  }
  return Object.freeze({
    open(c,input){const s=selected(input),g=generation(c);return track(c,async()=>{
      require(!closed && !transitions.has(c) && g===generation(c));
      const existing=live.get(key(c,s));if(existing){require(hash(existing.s)===hash(s));await existing.started.promise;const row=(await journal.list(c)).find(row=>row.requestId===s.requestId);require(row);return{...row,duplicatePrevented:true};}
      const r={c,s,g,abort:new AbortController(),started:deferred(),connectionAttempted:false};live.set(key(c,s),r);
      let failed;
      try{
        await current(r);r.target=structuredClone(await authorizations.returnTarget(c,s));await current(r);
        r.hostProbe=hostProbeFactory({platform});const host=await hostObservation(r.hostProbe,{signal:r.abort.signal,assertCurrent:()=>current(r)});
        require(windowsEditorHost(host) && host.processId===process.pid);require((await r.hostProbe.close()).stoppedVerified===true);r.hostProbe=null;await current(r);
        const reservation=await journal.reserve(c,s,{host});if(!reservation.handle){live.delete(key(c,s));return reservation;}r.handle=reservation.handle;await current(r);
        const originalClient=await owners.openEditorClient(c,{ownerRequestId:s.ownerRequestId,loadRequestId:s.loadRequestId},{onClient:async client=>{
          require(!r.client && client.retirementKind==='logical-channel' && typeof client.stop==='function');r.client=client;
          client.once('disconnected',()=>{void stop(r).catch(()=>{});});await current(r);await r.handle.record({kind:'upstream',binding:r.target.target.endpoint});await current(r);
        }});require(originalClient===r.client && r.client?.retirementKind==='logical-channel');await current(r);
        const original=r.target.target;r.connectionAttempted=true;
        r.connection=await connectionFactory({requestId:s.requestId,platform,client:r.client,signal:r.abort.signal,assertCurrent:()=>current(r),retireClient,
          target:{sessionId:original.sessionId,repositoryRoot:original.repositoryRoot,accountFingerprint:original.accountFingerprint},...(probeFactory?{probeFactory}:{}),
          onAcknowledged:async value=>{await current(r);await r.handle.record({kind:'acknowledged',observation:value});await current(r);},
          onOwnership:async event=>{
            require(event.requestId===s.requestId);
            if(event.kind==='retired'){r.retirement={...event};return;}
            if(['query-intent','query-ready','query-retired','query-not-started'].includes(event.kind))return r.handle.recordQuery({kind:event.kind,ownership:event.ownership});
            require(event.kind==='ingress');if(event.ownership.phase!=='stopped')await r.handle.record({kind:'ingress',ownership:event.ownership});
          }
        });void r.connection.whenClosed.then(()=>{void stop(r).catch(()=>{});});await current(r);
        return{...observation(r),duplicatePrevented:false,endpoint:r.connection.privateEndpoint};
      }catch(error){failed=error;throw error;}finally{r.started.resolve();if(failed)try{if(!(await stop(r)).stoppedVerified)failed.editorRetirementUnconfirmed=true;}catch{failed.editorRetirementUnconfirmed=true;}}
    });},
    pinPeer(c,input,peer){const s=selected(input);let copied;try{require(peer && Object.keys(peer).sort().join()==='expectedBirth,image,processId');copied=structuredClone(peer);}catch(error){return Promise.reject(error);}return track(c,async()=>{
      const r=live.get(key(c,s));require(r && hash(r.s)===hash(s) && r.connection);
      try{await current(r);await r.handle.record({kind:'peer',...copied});await current(r);await r.connection.pinPeer(copied);await current(r);return observation(r);}catch(error){try{await stop(r);}catch{error.editorRetirementUnconfirmed=true;}throw error;}
    });},
    observe(c,input){const s=selected(input);return track(c,async()=>{const r=live.get(key(c,s));require(r && hash(r.s)===hash(s));await current(r);return observation(r);});},
    stop(c,input){const s=selected(input);return track(c,async()=>{const r=live.get(key(c,s));if(!r)return journal.stopped(c,s);require(hash(r.s)===hash(s));const result=await stop(r);require(r.handle);return result;});},
    recover(c,input){const s=selected(input);return track(c,async()=>{
      require(!closed && !transitions.has(c) && !live.has(key(c,s)) && ![...recoveries.values()].includes(c));const recovery=recoveryFactory({platform});recoveries.set(recovery,c);
      try{return await journal.recover(c,s,(row,beforeEffect)=>recovery.verify(row,beforeEffect));}finally{require((await recovery.close()).stoppedVerified===true);recoveries.delete(recovery);}
    });},
    stopCompartment(c){
      require(typeof c==='string' && /^[a-z0-9][a-z0-9-]{0,63}$/.test(c));if(transitions.has(c))return transitions.get(c);generations.set(c,generation(c)+1);
      const work=Promise.resolve().then(async()=>{for(const r of live.values())if(r.c===c)closeResources(r);await Promise.allSettled([...pending].filter(([,scope])=>scope===c).map(([p])=>p));
        const results=await Promise.allSettled([...live.values()].filter(r=>r.c===c).map(stop));await closeRecoveries(c);return{stopped:results.every(r=>r.status==='fulfilled'&&r.value.stoppedVerified)&&![...live.values()].some(r=>r.c===c)&&![...recoveries.values()].includes(c)};});
      transitions.set(c,work);void work.then(()=>transitions.delete(c),()=>transitions.delete(c));return work;
    },
    close(){if(!closing){closed=true;for(const r of live.values())closeResources(r);closing=(async()=>{await Promise.allSettled([...transitions.values()]);await Promise.allSettled([...pending.keys()]);const results=await Promise.allSettled([...live.values()].map(stop));await closeRecoveries();await journal.close();return{stopped:results.every(r=>r.status==='fulfilled'&&r.value.stoppedVerified)&&live.size===0&&recoveries.size===0};})();}return closing;}
  });
  async function closeRecoveries(c){await Promise.allSettled([...recoveries].filter(([,scope])=>c===undefined||c===scope).map(async([recovery])=>{require((await recovery.close()).stoppedVerified===true);recoveries.delete(recovery);}));}
}
