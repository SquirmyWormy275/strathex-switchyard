/** Durable editor ownership checkpoints. This journal opens no process, socket or task. */
import { createHash } from 'node:crypto';
import { posix } from 'node:path';
import { appendEditorObservation } from './editor-observation.mjs';
import { windowsCodexBinding } from './windows-codex-binding.mjs';
import { windowsEditorHost, changeWindowsEditorJournal, windowsEditorRetirementFields, windowsEditorJournalStates } from './windows-editor-journal-contract.mjs';
import { windowsQueryOwnership, windowsQueryIntent, queryIntentForOwner } from './windows-query-ownership.mjs';

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
const hostIdentity = v => exact(v,['pid','birth','uid','bootId']) && processIdentity(v) && numeric(v.uid) && uuid(v.bootId);
const digest = v => typeof v==='string' && /^[a-f0-9]{64}$/.test(v);
const view = row => Object.freeze({ requestId:row.requestId, editorId:row.editorId, ownerRequestId:row.ownerRequestId, loadRequestId:row.loadRequestId, status:row.status,
  protocolAcknowledgementRecorded:row.acknowledgement!==undefined, stoppedVerified:row.status==='stopped', terminalLaunched:false, ideAttached:false, authorityGranted:false, completionVerified:false });

export function createCodingEditorJournal({ store, authorizations, now=Date.now, platform='linux' }={}) {
  require(store && typeof authorizations?.returnTarget==='function');
  require(['linux','win32'].includes(platform));
  const windows=platform==='win32',schema=windows?'switchyard-windows-editor-connection/v1':'switchyard-editor-connection/v1';
  const validHost=windows?windowsEditorHost:hostIdentity;
  const retirementFields=windows?windowsEditorRetirementFields:['upstreamExitVerified','carrierExitVerified','socketRemovedVerified','directoryRemovedVerified'];
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
    if(windows)windowsCodexBinding(observed.target.endpoint);
    return {target:structuredClone(observed.target),targetDigest:observed.targetDigest,policyDigest:policy(state)};
  }
  async function current(c,s,original) { require(hash(await capture(c,s))===hash(original)); }
  function change(row,event,target) {
    require(object(event));
    if(windows && event.kind!=='acknowledged')return changeWindowsEditorJournal(row,event,target);
    if(event.kind==='directory-intent') {
      require(row.status==='reserved' && exact(event,['kind','parent','path']) && exact(event.parent,['path','identity']) && path(event.parent.path) && identity(event.parent.identity)
        && (BigInt(event.parent.identity.mode)&0o170000n)===0o040000n && path(event.path) && event.path===posix.join(event.parent.path,row.requestId) && Buffer.byteLength(event.path+'/s')<=100);
      row.directoryIntent={parent:event.parent,path:event.path};row.status='directory-planned';return;
    }
    if(event.kind==='directory') {
      require(['reserved','directory-planned'].includes(row.status) && exact(event,['kind','path','identity']) && path(event.path) && Buffer.byteLength(event.path+'/s')<=100 && identity(event.identity) && (BigInt(event.identity.mode)&0o170000n)===0o040000n);
      if(row.directoryIntent)require(event.path===row.directoryIntent.path && event.identity.uid===row.directoryIntent.parent.identity.uid && hash(event.identity)!==hash(row.directoryIntent.parent.identity));
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
    reserve(c,input,options={}) {const s=selection(input);require(!windows && exact(options,[]) || exact(options,['host']) && validHost(options.host));const host=options.host&&structuredClone(options.host);return track(async()=>{
      const original=await capture(c,s);
      return store.withResourceLock('client-launch',key(c,s),async lock=>{
        await current(c,s,original);lock.assert();let saved,inserted=false;
        const previous=rowFor(await store.snapshot(c),s);if(previous)return {...view(previous),duplicatePrevented:true};
        await store.update(c,'coding-editor-connection-reserve',state=>{
          require(!closed && policy(state)===original.policyDigest);lock.assert();
          const previous=rowFor(state,s);if(previous){saved=structuredClone(previous);return;}
          freshAuthorization(state,s,original);
          const rows=state[field]??=[];require(rows.length<64 && !rows.some(row=>row.status!=='stopped' && !leases.has(key(c,row))));
          saved={schema,...s,...(host?{host}:{}),...(windows?{queryTracking:'original-helper-intent/v1'}:{}),taskId:original.target.taskId,targetDigest:original.targetDigest,policyDigest:original.policyDigest,status:'reserved',revision:0,createdAt:now()};rows.push(saved);appendEditorObservation(state,saved);inserted=true;
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
          // A checkpoint publishes protected bytes before replacing lease.row.
          // Observe both under its original lease so concurrent socket traffic
          // cannot mistake that in-flight publication for foreign replacement.
          assertCurrent:()=>track(()=>store.withResourceLock('client-launch',ownershipKey,async owned=>{
            require(!['stopped','uncertain'].includes(lease.row.status));await current(c,s,original);
            owned.assert();matches(await store.snapshot(c));owned.assert();
          })),
          recordQuery(event) {
            let copy;try{require(windows && exact(event,['kind','ownership']) && ['query-intent','query-ready','query-retired','query-not-started'].includes(event.kind));copy={kind:event.kind,ownership:['query-intent','query-not-started'].includes(event.kind)?windowsQueryIntent(event.ownership):windowsQueryOwnership(event.ownership)};}catch(error){return Promise.reject(error);}
            const retiring=['query-retired','query-not-started'].includes(copy.kind);
            return track(()=>store.withResourceLock('client-launch',ownershipKey,async owned=>{
              // Query admission is already inside the caller's target check.
              // Do not recursively launch another native inspection from this
              // helper checkpoint. Retirement remains possible after revocation.
              await store.authorize(c,retiring?{}:{provider:'codex'});const state=await store.snapshot(c);matches(state);owned.assert();
              const next=structuredClone(lease.row),previous=next.queryOwner;require(next.queryTracking==='original-helper-intent/v1');
              if(!retiring) {
                require(!closed && !['stopped','uncertain'].includes(next.status) && policy(state)===original.policyDigest && (!previous || previous.stopped));
              }
              if(copy.kind==='query-intent') {
                require(!next.queryIntent && next.lastQueryId!==copy.ownership.requestId);
                const sequence=(next.querySequence??0)+1;require(Number.isSafeInteger(sequence) && sequence<=1000000);
                next.querySequence=sequence;next.lastQueryId=copy.ownership.requestId;next.queryIntent=copy.ownership;next.queryNotStarted=null;
              } else if(copy.kind==='query-ready') {
                require(next.queryIntent && hash(next.queryIntent)===hash(queryIntentForOwner(copy.ownership)));
                require(!previous || previous.ownership.scope.id!==copy.ownership.scope.id);next.queryOwner={ownership:copy.ownership,stopped:false};
              } else if(copy.kind==='query-retired') {
                if(previous && hash(previous.ownership)===hash(copy.ownership) && previous.stopped && !next.queryIntent)return{recorded:true,duplicatePrevented:true};
                require(next.queryIntent && hash(next.queryIntent)===hash(queryIntentForOwner(copy.ownership)) && (!previous || previous.stopped || hash(previous.ownership)===hash(copy.ownership)));
                next.queryOwner={ownership:copy.ownership,stopped:true};next.queryIntent=null;
              } else {
                if(!next.queryIntent && next.queryNotStarted && hash(next.queryNotStarted)===hash(copy.ownership))return{recorded:true,duplicatePrevented:true};
                require(next.queryIntent && hash(next.queryIntent)===hash(copy.ownership) && (!previous || previous.stopped));
                next.queryIntent=null;next.queryNotStarted=copy.ownership;
              }
              next.revision++;next.updatedAt=now();
              await store.update(c,'coding-editor-query-'+(retiring?'retire':'reserve'),state=>{
                owned.assert();matches(state);if(!retiring)require(!closed && policy(state)===original.policyDigest);Object.assign(rowFor(state,s),next);
              },retiring?{}:{provider:'codex'});lease.row=next;return{recorded:true,duplicatePrevented:false};
            }));
          },
          record(event) {
            let copy;try {require(object(event) && Buffer.byteLength(JSON.stringify(event))<=16384);copy=structuredClone(event);if(!windows && copy.kind==='ingress' && object(copy.ownership))copy.ownership.socketIdentity??=null;}catch(error){return Promise.reject(error);}
            return track(()=>store.withResourceLock('client-launch',ownershipKey,async owned=>{
              await current(c,s,original);owned.assert();matches(await store.snapshot(c));const next=structuredClone(lease.row);change(next,copy,original.target);next.revision++;next.updatedAt=now();
              await store.update(c,'coding-editor-connection-checkpoint',state=>{require(!closed && policy(state)===original.policyDigest);owned.assert();matches(state);const row=rowFor(state,s);Object.assign(row,next);appendEditorObservation(state,row);},{provider:'codex'});
              lease.row=next;await current(c,s,original);owned.assert();return view(next);
            }));
          },
          retire(facts) {
            let copy;try{require(exact(facts,retirementFields) && Object.values(facts).every(v=>typeof v==='boolean'));copy={...facts};}catch(error){return Promise.reject(error);}
            // Retirement remains available after policy/workspace cancellation.
            // It grants no provider admission and can only update this live handle.
            return track(()=>store.withResourceLock('client-launch',ownershipKey,async owned=>{
              await store.authorize(c);const state=await store.snapshot(c);matches(state);owned.assert();
              if(lease.row.status==='stopped')return {...view(lease.row),duplicatePrevented:true};
              if(windows && copy.queryHelpersExitVerified)require(!lease.row.queryIntent && (!lease.row.queryOwner || lease.row.queryOwner.stopped===true));
              const next={...structuredClone(lease.row),status:Object.values(copy).every(Boolean)?'stopped':'uncertain',retirement:copy,revision:lease.row.revision+1,updatedAt:now()};
              await store.update(c,'coding-editor-connection-retire',state=>{owned.assert();matches(state);const row=rowFor(state,s);Object.assign(row,next);appendEditorObservation(state,row);});lease.row=next;return view(next);
            }));
          }
        });
        await current(c,s,original);freshAuthorization(await store.snapshot(c),s,original);lock.assert();
        return { ...view(saved), duplicatePrevented:false, handle };
      });
    });},
    recover(c,input,verify) {const s=selection(input);require(typeof verify==='function');return track(()=>store.withResourceLock('client-launch',key(c,s),async lock=>{
      require(!closed);await store.authorize(c);const original=structuredClone(rowFor(await store.snapshot(c),s));
      require(original?.schema===schema && uuid(original.taskId) && digest(original.targetDigest) && digest(original.policyDigest) && Number.isSafeInteger(original.revision) && original.revision>=0);
      if(original.status==='stopped')return {...view(original),duplicatePrevented:true};
      require(!leases.has(key(c,s)));
      require((windows?windowsEditorJournalStates:['reserved','directory-planned','private','upstream','ingress-reserved','ingress-started','ready','peer-pinned','peer-requested','connected','acknowledged','uncertain']).includes(original.status));
      if(!validHost(original.host))return {...view(original),recoveryBlocked:true};
      const current=async()=>{require(!closed);await store.authorize(c);lock.assert();require(hash(rowFor(await store.snapshot(c),s))===hash(original));};
      await current();const facts=await verify(structuredClone(original),current);
      require(exact(facts,['hostExitVerified',...retirementFields]) && Object.values(facts).every(v=>typeof v==='boolean'));await current();
      if(!facts.hostExitVerified)return {...view(original),recoveryBlocked:true};
      const next={...original,status:Object.values(facts).every(Boolean)?'stopped':'uncertain',retirement:{...facts},revision:original.revision+1,updatedAt:now()};
      await store.update(c,'coding-editor-connection-recover',state=>{require(!closed);lock.assert();require(hash(rowFor(state,s))===hash(original));const row=rowFor(state,s);Object.assign(row,next);appendEditorObservation(state,row);});return view(next);
    }));},
    async list(c) { await store.authorize(c);return ((await store.snapshot(c))[field]??[]).map(view); },
    stopped(c,input) {const s=selection(input);return track(async()=>{
      require(!closed);await store.authorize(c);const row=rowFor(await store.snapshot(c),s);
      require(!closed && row?.schema===schema && row.status==='stopped');
      return {...view(row),duplicatePrevented:true};
    });},
    async close() {closed=true;await Promise.allSettled([...pending]);}
  });
}
