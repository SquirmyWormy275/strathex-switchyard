/** Internal Linux editor lifecycle; signed route and Terminal activation are separate. */
import { mkdir,lstat,readFile,realpath,readdir,rmdir } from 'node:fs/promises';
import { posix } from 'node:path';
import { createHash } from 'node:crypto';
import { createCodingEditorJournal } from './coding-editor-journal.mjs';
import { openCodexEditorIngress } from './codex-editor-ingress.mjs';
import { createCodexEditorRelay } from './codex-editor-relay.mjs';
import { stopOwnedChild } from './owned-process.mjs';

const hash=v=>createHash('sha256').update(JSON.stringify(v)).digest('hex');
const uuid=v=>typeof v==='string' && /^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/.test(v);
const fields=['requestId','editorId','ownerRequestId','loadRequestId'];
const require=v=>{if(!v)throw Error('The original editor connection is unavailable or changed.');};
const identity=s=>({device:String(s.dev),inode:String(s.ino),uid:String(s.uid),mode:String(s.mode)});
const selected=v=>{require(v && typeof v==='object' && !Array.isArray(v) && Object.keys(v).sort().join() === [...fields].sort().join() && fields.every(k=>uuid(v[k])));return Object.freeze({...v});};
async function directory(path) {
  const s=await lstat(path,{bigint:true});require(s.isDirectory() && !s.isSymbolicLink() && s.uid===BigInt(process.getuid()) && !(s.mode&0o077n) && await realpath(path)===path);return identity(s);
}
async function birth(pid) {
  require(Number.isSafeInteger(pid)&&pid>0);const s=await lstat('/proc/'+pid,{bigint:true}),text=await readFile('/proc/'+pid+'/stat','utf8');require(s.uid===BigInt(process.getuid()) && Buffer.byteLength(text)<=8192);
  const value=text.slice(text.lastIndexOf(') ')+2).trim().split(/\s+/)[19];require(/^[1-9][0-9]{0,19}$/.test(value));return value;
}

export function createCodingEditorConnections({ store, authorizations, owners, root, now=Date.now }={}) {
  require(process.platform==='linux' && typeof root==='string' && posix.isAbsolute(root) && posix.normalize(root)===root && Buffer.byteLength(root)+39<=100 && !/[\\\x00-\x1f\x7f]/.test(root));
  require(typeof owners?.openEditorClient==='function');
  const journal=createCodingEditorJournal({store,authorizations,now}),live=new Map(),pending=new Map(),generations=new Map(),transitions=new Map();let closed=false,closing;
  const key=(c,s)=>c+':'+s.requestId;
  const generation=c=>generations.get(c)??0;
  const track=(c,fn)=>{const work=Promise.resolve().then(fn);pending.set(work,c);void work.then(()=>pending.delete(work),()=>pending.delete(work));return work;};
  async function current(r) {
    require(!closed && !transitions.has(r.c) && r.g===generation(r.c) && !r.stopping && !r.abort.signal.aborted);await r.handle.assertCurrent();require(hash(await directory(root))===hash(r.parent));
    if(r.directoryIdentity)require(hash(await directory(r.directory))===hash(r.directoryIdentity));
    require(!closed && !transitions.has(r.c) && r.g===generation(r.c) && !r.stopping && !r.abort.signal.aborted);
  }
  const observation=r=>({requestId:r.s.requestId,status:r.stopping?'closing':r.relay?.observation().protocolAcknowledged?'acknowledged':r.ingress?.observation().phase??'preparing',
    peerVerified:r.ingress?.observation().peerVerified===true,protocolAcknowledged:r.relay?.observation().protocolAcknowledged===true,
    terminalLaunched:false,ideAttached:false,authorityGranted:false,completionVerified:false});
  async function stop(r) {
    if(r.stopping)return r.stopping;
    r.stopping=Promise.resolve().then(async()=>{
      r.abort.abort();r.relay?.close();r.ingress?.close();r.client?.close();
      const facts={upstreamExitVerified:!r.client,carrierExitVerified:!r.ingressAttempted,socketRemovedVerified:!r.ingressAttempted,directoryRemovedVerified:!r.directoryAttempted};
      try{await r.relay?.stop();}catch{}
      if(r.ingress)try{const result=await r.ingress.stop();facts.carrierExitVerified=result.stopped===true;facts.socketRemovedVerified=result.socketRemoved===true;}catch{}
      if(r.client)try{facts.upstreamExitVerified=(await stopOwnedChild(r.client.child)).stopped===true;}catch{}
      if(r.directoryIdentity && facts.upstreamExitVerified && facts.carrierExitVerified && facts.socketRemovedVerified)try{
        require(hash(await directory(root))===hash(r.parent) && hash(await directory(r.directory))===hash(r.directoryIdentity));require((await readdir(r.directory)).length===0);await rmdir(r.directory);facts.directoryRemovedVerified=true;
      }catch{}
      const result=await r.handle.retire(facts);if(result.stoppedVerified)live.delete(key(r.c,r.s));return result;
    });return r.stopping;
  }
  return Object.freeze({
    open(c,input) {const s=selected(input),g=generation(c);return track(c,async()=>{
      require(!closed && !transitions.has(c) && g===generation(c));const parent=await directory(root),target=await authorizations.returnTarget(c,s);require(!closed && !transitions.has(c) && g===generation(c));
      const reservation=await journal.reserve(c,s);if(!reservation.handle)return reservation;
      const r={c,s,g,parent,target:structuredClone(target),handle:reservation.handle,directory:posix.join(root,s.requestId),abort:new AbortController(),directoryAttempted:false,ingressAttempted:false};
      require(!live.has(key(c,s)));live.set(key(c,s),r);
      try{
        await current(r);require(hash(await authorizations.returnTarget(c,s))===hash(r.target));
        await r.handle.record({kind:'directory-intent',parent:{path:root,identity:parent},path:r.directory});await current(r);
        r.directoryAttempted=true;await mkdir(r.directory,{mode:0o700});r.directoryIdentity=await directory(r.directory);
        await r.handle.record({kind:'directory',path:r.directory,identity:r.directoryIdentity});await current(r);
        r.client=await owners.openEditorClient(c,{ownerRequestId:s.ownerRequestId,loadRequestId:s.loadRequestId},{onClient:async client=>{
          r.client=client;client.once('disconnected',()=>{void stop(r).catch(()=>{});});await current(r);await r.handle.record({kind:'upstream',pid:client.child.pid,birth:await birth(client.child.pid)});await current(r);
        }});await current(r);
        const original=r.target.target;
        r.relay=createCodexEditorRelay({target:{sessionId:original.sessionId,repositoryRoot:original.repositoryRoot,accountFingerprint:original.accountFingerprint},client:r.client,signal:r.abort.signal,
          assertCurrent:()=>current(r),send:message=>r.ingress.send(message),onAcknowledged:async o=>{await current(r);await r.handle.record({kind:'acknowledged',observation:o});await current(r);}});
        r.ingressAttempted=true;
        r.ingress=await openCodexEditorIngress({socketPath:r.directory+'/s',signal:r.abort.signal,assertCurrent:()=>current(r),onMessage:message=>r.relay.receive(message),
          onOwnership:async ownership=>{if(ownership.phase!=='stopped')await r.handle.record({kind:'ingress',ownership});}});
        await current(r);const o=r.ingress.privateOwnership;return{...observation(r),duplicatePrevented:false,endpoint:{socketPath:o.socketPath,socketDevice:o.socketIdentity.device,socketInode:o.socketIdentity.inode}};
      }catch(error){try{await stop(r);}catch{error.editorRetirementUnconfirmed=true;}throw error;}
    });},
    pinPeer(c,input,peer) {const s=selected(input);let copied;try{require(peer && typeof peer==='object' && !Array.isArray(peer) && Object.keys(peer).sort().join()==='birth,executable,executableSha256,pid');copied=structuredClone(peer);}catch(error){return Promise.reject(error);}return track(c,async()=>{
      const r=live.get(key(c,s));require(r && hash(r.s)===hash(s));
      try{await current(r);await r.handle.record({kind:'peer',...copied});await current(r);await r.ingress.pinPeer(copied);await current(r);return observation(r);}catch(error){try{await stop(r);}catch{error.editorRetirementUnconfirmed=true;}throw error;}
    });},
    observe(c,input) {const s=selected(input);return track(c,async()=>{const r=live.get(key(c,s));require(r && hash(r.s)===hash(s));await current(r);return observation(r);});},
    stop(c,input) {const s=selected(input);return track(c,async()=>{const r=live.get(key(c,s));require(r && hash(r.s)===hash(s));return stop(r);});},
    stopCompartment(c) {
      require(typeof c==='string' && /^[a-z0-9][a-z0-9-]{0,63}$/.test(c));if(transitions.has(c))return transitions.get(c);
      generations.set(c,generation(c)+1);
      const work=Promise.resolve().then(async()=>{
        for(const r of live.values())if(r.c===c){r.abort.abort();r.relay?.close();r.ingress?.close();r.client?.close();}
        await Promise.allSettled([...pending].filter(([,compartment])=>compartment===c).map(([work])=>work));
        const results=await Promise.allSettled([...live.values()].filter(r=>r.c===c).map(stop));
        return{stopped:results.every(r=>r.status==='fulfilled'&&r.value.stoppedVerified)&&![...live.values()].some(r=>r.c===c)};
      });transitions.set(c,work);void work.then(()=>transitions.delete(c),()=>transitions.delete(c));return work;
    },
    close() {if(!closing){closed=true;for(const r of live.values()){r.abort.abort();r.relay?.close();r.ingress?.close();r.client?.close();}closing=(async()=>{await Promise.allSettled([...transitions.values()]);await Promise.allSettled([...pending.keys()]);const results=await Promise.allSettled([...live.values()].map(stop));await journal.close();return{stopped:results.every(r=>r.status==='fulfilled'&&r.value.stoppedVerified)&&live.size===0};})();}return closing;}
  });
}
