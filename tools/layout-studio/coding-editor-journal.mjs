/** Durable editor ownership checkpoints. This journal opens no process, socket or task. */
import { createHash } from 'node:crypto';
import { posix } from 'node:path';

const field = 'codingEditorConnections';
const uuid = v => typeof v === 'string' && /^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/.test(v);
const hash = v => createHash('sha256').update(JSON.stringify(v)).digest('hex');
const object = v => v !== null && typeof v === 'object' && !Array.isArray(v);
const exact = (v, keys) => object(v) && Object.keys(v).sort().join() === [...keys].sort().join();
const require = v => { if (!v) throw Error('The original editor ownership reservation changed or is unavailable.'); };
const fields = ['requestId','editorId','ownerRequestId','loadRequestId'];
function selection(v) { require(exact(v, fields) && fields.every(k => uuid(v[k]))); return Object.freeze({ ...v }); }
const policy = state => hash([state.policy,state.mode,state.accounts]);
const path = v => typeof v === 'string' && posix.isAbsolute(v) && posix.normalize(v) === v && Buffer.byteLength(v) <= 100 && !/[\\\x00-\x1f\x7f]/.test(v);
const numeric = v => typeof v === 'string' && /^[0-9]{1,20}$/.test(v);
const identity = v => exact(v,['device','inode','uid','mode']) && Object.values(v).every(numeric) && BigInt(v.inode)>0n && (BigInt(v.mode)&0o077n)===0n;
const processIdentity = v => Number.isSafeInteger(v.pid) && v.pid>0 && v.pid<=2147483647 && typeof v.birth==='string' && /^[1-9][0-9]{0,19}$/.test(v.birth);
const digest = v => typeof v==='string' && /^[a-f0-9]{64}$/.test(v);
const view = row => Object.freeze({ requestId:row.requestId, editorId:row.editorId, ownerRequestId:row.ownerRequestId, loadRequestId:row.loadRequestId, status:row.status,
  protocolAcknowledgementRecorded:row.acknowledgement!==undefined, stoppedVerified:row.status==='stopped', terminalLaunched:false, ideAttached:false, authorityGranted:false, completionVerified:false });

export function createCodingEditorJournal({ store, authorizations, now=Date.now }={}) {
  require(store && typeof authorizations?.returnTarget==='function');
  let closed=false; const pending=new Set(), leases=new Map();
  const track = fn => { const work=Promise.resolve().then(fn);pending.add(work);void work.then(()=>pending.delete(work),()=>pending.delete(work));return work; };
  const key=(c,s)=>'editor:'+c+':'+s.requestId;
  const rowFor=(state,s)=>{const row=state[field]?.find(r=>r.requestId===s.requestId);if(row)require(fields.every(k=>row[k]===s[k]));return row;};
  function freshAuthorization(state,s,original) {
    const row=state.codingEditorAuthorizations?.find(r=>r.requestId===s.requestId),at=now();
    require(row?.schema==='switchyard-editor-authorization/v1' && row.status==='consumed' && fields.every(k=>row[k]===s[k]) && row.targetDigest===original.targetDigest && row.policyDigest===original.policyDigest
      && Number.isSafeInteger(at) && Number.isSafeInteger(row.createdAt) && row.expiresAt===row.createdAt+30000 && Number.isSafeInteger(row.consumedAt)
      && row.consumedAt>=row.createdAt && row.consumedAt<row.expiresAt && at>=row.consumedAt && at<row.expiresAt);
  }
  async function capture(c,s) {
    require(!closed);await store.authorize(c,{provider:'codex'});require(!closed);
    const observed=await authorizations.returnTarget(c,s),state=await store.snapshot(c);
    require(!closed && observed?.metadataObserved===true && observed.nativeLoadAcknowledged===true && ['nativeTaskLoaded','authorityGranted','terminalLaunched','ideAttached','modelPromptSubmitted','completionVerified'].every(k=>observed[k]===false)
      && observed.targetDigest===hash(observed.target) && observed.target.ownerRequestId===s.ownerRequestId && observed.target.loadRequestId===s.loadRequestId
      && uuid(observed.target.taskId) && uuid(observed.target.sessionId) && observed.target.permissions==='read-only/on-request' && digest(observed.target.accountFingerprint) && digest(observed.target.endpoint?.peerExecutableSha256));
    return {target:structuredClone(observed.target),targetDigest:observed.targetDigest,policyDigest:policy(state)};
  }
  async function current(c,s,original) { require(hash(await capture(c,s))===hash(original)); }
  function change(row,event,target) {
    require(object(event));
    if(event.kind==='directory') {
      require(row.status==='reserved' && exact(event,['kind','path','identity']) && path(event.path) && Buffer.byteLength(event.path+'/s')<=100 && identity(event.identity) && (BigInt(event.identity.mode)&0o170000n)===0o040000n);
      row.directory={path:event.path,identity:event.identity};row.status='private';return;
    }
    if(event.kind==='upstream') {
      require(row.status==='private' && exact(event,['kind','pid','birth']) && processIdentity(event));
      row.upstream={pid:event.pid,birth:event.birth};row.status='upstream';return;
    }
    if(event.kind==='peer') {
      require(row.status==='ready' && exact(event,['kind','pid','birth','executable','executableSha256']) && processIdentity(event)
        && typeof event.executable==='string' && posix.isAbsolute(event.executable) && posix.normalize(event.executable)===event.executable && Buffer.byteLength(event.executable)<=4096 && !/[\\\x00-\x1f\x7f]/.test(event.executable)
        && event.executableSha256===target.endpoint.peerExecutableSha256 && event.pid!==target.endpoint.peerPid && event.pid!==row.upstream.pid && event.pid!==row.ingress.pid);
      row.peer={pid:event.pid,birth:event.birth,executable:event.executable,executableSha256:event.executableSha256};row.status='peer-pinned';return;
    }
    if(event.kind==='ingress') {
      require(exact(event,['kind','ownership']));const o=event.ownership;
      require(exact(o,['schema','phase','directory','directoryIdentity','socketPath','socketIdentity','pid','birth']) && o.schema==='switchyard-editor-ingress-owner/v1'
        && o.directory===row.directory?.path && hash(o.directoryIdentity)===hash(row.directory.identity) && o.socketPath===row.directory.path+'/s');
      const prior={reserved:'upstream',started:'ingress-reserved',ready:'ingress-started','peer-requested':'peer-pinned',connected:'peer-requested'}[o.phase];require(prior && row.status===prior);
      require(o.phase==='reserved' ? o.pid===null && o.birth===null : processIdentity(o));
      require(['reserved','started'].includes(o.phase) ? o.socketIdentity===null : identity(o.socketIdentity) && (BigInt(o.socketIdentity.mode)&0o170000n)===0o140000n);
      if(row.ingress?.pid!==null && row.ingress?.pid!==undefined)require(o.pid===row.ingress.pid && o.birth===row.ingress.birth);
      if(row.ingress?.socketIdentity)require(hash(o.socketIdentity)===hash(row.ingress.socketIdentity));
      row.ingress=o;row.status=['reserved','started'].includes(o.phase)?'ingress-'+o.phase:o.phase;return;
    }
    if(event.kind==='acknowledged') {
      require(row.status==='connected' && exact(event,['kind','observation']));const o=event.observation;
      require(exact(o,['schema','stage','reason','accountBeforeVerified','exactResumeRequested','exactResumeReplyVerified','accountAfterVerified','protocolAcknowledged','transportPeerVerified','terminalProcessVerified','ideAttached','authorityGranted','completionVerified'])
        && o.schema==='switchyard-codex-editor-protocol/v1' && o.stage==='acknowledged' && o.reason===null
        && ['accountBeforeVerified','exactResumeRequested','exactResumeReplyVerified','accountAfterVerified','protocolAcknowledged'].every(k=>o[k]===true)
        && ['transportPeerVerified','terminalProcessVerified','ideAttached','authorityGranted','completionVerified'].every(k=>o[k]===false));
      row.acknowledgement=o;row.status='acknowledged';return;
    }
    throw Error('This editor ownership checkpoint is not supported.');
  }
  return Object.freeze({
    reserve(c,input) {const s=selection(input);return track(async()=>{
      const original=await capture(c,s);
      return store.withResourceLock('client-launch',key(c,s),async lock=>{
        await current(c,s,original);lock.assert();let saved,inserted=false;
        const previous=rowFor(await store.snapshot(c),s);if(previous)return {...view(previous),duplicatePrevented:true};
        await store.update(c,'coding-editor-connection-reserve',state=>{
          require(!closed && policy(state)===original.policyDigest);lock.assert();
          const previous=rowFor(state,s);if(previous){saved=structuredClone(previous);return;}
          freshAuthorization(state,s,original);
          const rows=state[field]??=[];require(rows.length<64);
          saved={schema:'switchyard-editor-connection/v1',...s,taskId:original.target.taskId,targetDigest:original.targetDigest,policyDigest:original.policyDigest,status:'reserved',revision:0,createdAt:now()};rows.push(saved);inserted=true;
        },{provider:'codex'});
        // A saved row, including a stopped or interrupted one, never issues a
        // new handle after a lost reply or across host instances.
        const ownershipKey=key(c,s);
        const persisted=rowFor(await store.snapshot(c),s);
        require(hash(persisted)===hash(saved));
        if(!inserted)return {...view(saved),duplicatePrevented:true};
        require(!leases.has(ownershipKey));const lease={row:structuredClone(saved)};leases.set(ownershipKey,lease);
        const matches=state=>{require(leases.get(ownershipKey)===lease && hash(rowFor(state,s))===hash(lease.row));};
        const handle=Object.freeze({
          observation:()=>view(lease.row),
          assertCurrent:()=>track(async()=>{require(!['stopped','uncertain'].includes(lease.row.status));await current(c,s,original);matches(await store.snapshot(c));}),
          record(event) {
            let copy;try {require(object(event) && Buffer.byteLength(JSON.stringify(event))<=16384);copy=structuredClone(event);if(copy.kind==='ingress' && object(copy.ownership))copy.ownership.socketIdentity??=null;}catch(error){return Promise.reject(error);}
            return track(()=>store.withResourceLock('client-launch',ownershipKey,async owned=>{
              await current(c,s,original);owned.assert();matches(await store.snapshot(c));const next=structuredClone(lease.row);change(next,copy,original.target);next.revision++;next.updatedAt=now();
              await store.update(c,'coding-editor-connection-checkpoint',state=>{require(!closed && policy(state)===original.policyDigest);owned.assert();matches(state);Object.assign(rowFor(state,s),next);},{provider:'codex'});
              lease.row=next;await current(c,s,original);owned.assert();return view(next);
            }));
          },
          retire(facts) {
            let copy;try{require(exact(facts,['upstreamExitVerified','carrierExitVerified','socketRemovedVerified','directoryRemovedVerified']) && Object.values(facts).every(v=>typeof v==='boolean'));copy={...facts};}catch(error){return Promise.reject(error);}
            // Retirement remains available after policy/workspace cancellation.
            // It grants no provider admission and can only update this live handle.
            return track(()=>store.withResourceLock('client-launch',ownershipKey,async owned=>{
              await store.authorize(c);const state=await store.snapshot(c);matches(state);owned.assert();
              if(lease.row.status==='stopped')return {...view(lease.row),duplicatePrevented:true};
              const next={...structuredClone(lease.row),status:Object.values(copy).every(Boolean)?'stopped':'uncertain',retirement:copy,revision:lease.row.revision+1,updatedAt:now()};
              await store.update(c,'coding-editor-connection-retire',state=>{owned.assert();matches(state);Object.assign(rowFor(state,s),next);});lease.row=next;return view(next);
            }));
          }
        });
        await current(c,s,original);freshAuthorization(await store.snapshot(c),s,original);lock.assert();
        return { ...view(saved), duplicatePrevented:false, handle };
      });
    });},
    async list(c) { await store.authorize(c);return ((await store.snapshot(c))[field]??[]).map(view); },
    async close() {closed=true;await Promise.allSettled([...pending]);}
  });
}
