import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID,createHash } from 'node:crypto';
import { mkdtemp,rm,readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createSuiteStore } from './suite-store.mjs';
import { createCodingEditorAuthorizations } from './coding-editor-authorizations.mjs';
import { createCodingEditorJournal } from './coding-editor-journal.mjs';

const hash=v=>createHash('sha256').update(JSON.stringify(v)).digest('hex');
const identity={device:'1',inode:'2',uid:'1000',mode:String(0o40700)},socketIdentity={...identity,inode:'3',mode:String(0o140600)};
const clean={upstreamExitVerified:true,carrierExitVerified:true,socketRemovedVerified:true,directoryRemovedVerified:true};
const ack={schema:'switchyard-codex-editor-protocol/v1',stage:'acknowledged',reason:null,accountBeforeVerified:true,exactResumeRequested:true,exactResumeReplyVerified:true,accountAfterVerified:true,protocolAcknowledged:true,transportPeerVerified:false,terminalProcessVerified:false,ideAttached:false,authorityGranted:false,completionVerified:false};
async function fixture(t) {
 const root=await mkdtemp(join(tmpdir(),'syej-')),keys=new Map(),services=[];
 const store=createSuiteStore({root,secrets:{get:async(c,p)=>keys.get(c+p),set:async(c,p,v)=>keys.set(c+p,v)}});await store.initialize('personal');await store.update('personal','fixture',s=>{s.mode='personal-companion';});
 const selected={requestId:randomUUID(),editorId:randomUUID(),ownerRequestId:randomUUID(),loadRequestId:randomUUID()};
 const target={ownerRequestId:selected.ownerRequestId,loadRequestId:selected.loadRequestId,taskId:randomUUID(),sessionId:randomUUID(),repositoryRoot:'/synthetic/repository',repositoryIdentity:{device:'1',inode:'9'},accountFingerprint:'a'.repeat(64),permissions:'read-only/on-request',endpoint:{socketPath:'/synthetic/owner',socketDevice:'1',socketInode:'10',peerPid:100,peerBirth:'111',peerExecutableSha256:'b'.repeat(64)}};
 let active=true,hook=async()=>{},at;
 const owners={async editorTarget(){await hook();return{target:structuredClone(target),targetDigest:hash(target),metadataObserved:true,nativeLoadAcknowledged:true,nativeTaskLoaded:false,authorityGranted:false,terminalLaunched:false,ideAttached:false,modelPromptSubmitted:false,completionVerified:false};}};owners.editorReturnTarget=owners.editorTarget;
 const auth=createCodingEditorAuthorizations({store,owners,isActive:async()=>active});
 const service=()=>{const s=createCodingEditorJournal({store,authorizations:auth,now:()=>at??Date.now()});services.push(s);return s;};const api=service();
 t.after(async()=>{hook=async()=>{};for(const s of services)await s.close();await auth.close();await rm(root,{recursive:true});});
 async function consume(){const review=await auth.review('personal',selected),issued=await auth.issue('personal',{...selected,token:review.confirmation.token});return auth.consume('personal',{...selected,permit:issued.permit});}
 return{root,store,selected,target,auth,api,service,consume,set active(v){active=v;},set hook(v){hook=v;},set at(v){at=v;}};
}
const ingress=phase=>({kind:'ingress',ownership:{schema:'switchyard-editor-ingress-owner/v1',phase,directory:'/private/editor',directoryIdentity:{...identity},socketPath:'/private/editor/s',socketIdentity:['reserved','started'].includes(phase)?null:{...socketIdentity},pid:phase==='reserved'?null:300,birth:phase==='reserved'?null:'333'}});
async function connected(handle){for(const event of [{kind:'directory',path:'/private/editor',identity},{kind:'upstream',pid:200,birth:'222'},ingress('reserved'),ingress('started'),ingress('ready'),{kind:'peer',pid:400,birth:'444',executable:'/native/codex',executableSha256:'b'.repeat(64)},ingress('peer-requested'),ingress('connected')])await handle.record(event);}

test('only a consumed reviewed selection can reserve ownership, and another host cannot replay even an untouched reservation',async t=>{
 const f=await fixture(t);await assert.rejects(f.api.reserve('personal',f.selected));await f.consume();
 const results=await Promise.all([f.api,f.service()].map(api=>api.reserve('personal',f.selected)));assert.equal(results.filter(r=>r.handle).length,1);assert.equal(results.filter(r=>r.duplicatePrevented).length,1);
 const saved=(await f.store.snapshot('personal')).codingEditorConnections;assert.equal(saved.length,1);assert.equal(saved[0].status,'reserved');
 const again=await f.service().reserve('personal',f.selected);assert.equal(again.handle,undefined);assert.equal(again.duplicatePrevented,true);
});
test('an unknown unfinished host record prevents a new reviewed connection without affecting a locally retained owner',async t=>{
 const f=await fixture(t);await f.consume();await f.api.reserve('personal',f.selected);f.selected.requestId=randomUUID();await f.consume();
 await assert.rejects(f.service().reserve('personal',f.selected));assert.equal((await f.store.snapshot('personal')).codingEditorConnections.length,1);
 assert.ok((await f.api.reserve('personal',f.selected)).handle);assert.equal((await f.store.snapshot('personal')).codingEditorConnections.length,2);
});
test('recovery cannot adopt a live local handle or a record without its original host identity',async t=>{
 const f=await fixture(t);await f.consume();await f.api.reserve('personal',f.selected);let checks=0;const verify=async()=>{checks++;return{hostExitVerified:true,...clean};};
 await assert.rejects(f.api.recover('personal',f.selected,verify));assert.equal((await f.service().recover('personal',f.selected,verify)).recoveryBlocked,true);assert.equal(checks,0);
});
test('recovery rechecks protected ownership after independent verification and preserves a replacement record',async t=>{
 const f=await fixture(t);await f.consume();await f.api.reserve('personal',f.selected,{host:{pid:1,birth:'100',uid:'1000',bootId:'11111111-1111-4111-8111-111111111111'}});
 await assert.rejects(f.service().recover('personal',f.selected,async()=>{await f.store.update('personal','fixture-substitution',s=>{s.codingEditorConnections[0].revision=99;});return{hostExitVerified:true,...clean};}));
 assert.equal((await f.store.snapshot('personal')).codingEditorConnections[0].revision,99);assert.equal((await f.store.snapshot('personal')).codingEditorConnections[0].status,'reserved');
});
test('the complete journal records immutable process/socket checkpoints while exposing no live attachment authority',async t=>{
 const f=await fixture(t);await f.store.update('personal','fixture-consent',s=>{s.observations=[{id:'editor-history',status:'recording',sources:['editor-events'],exclusions:[],events:[],createdAt:Date.now(),updatedAt:Date.now()}];});await f.consume();const {handle}=await f.api.reserve('personal',f.selected);await connected(handle);await handle.record({kind:'acknowledged',observation:ack});await handle.assertCurrent();
 const row=(await f.store.snapshot('personal')).codingEditorConnections[0];assert.equal(row.revision,9);assert.equal(row.ingress.pid,300);assert.equal(row.upstream.pid,200);assert.equal(row.peer.pid,400);assert.deepEqual(row.directory.identity,identity);
 const listed=(await f.api.list('personal'))[0];assert.equal(listed.protocolAcknowledgementRecorded,true);assert.equal(listed.ideAttached,false);assert.equal(listed.authorityGranted,false);assert.equal(listed.terminalLaunched,false);assert.equal(Object.hasOwn(listed,'directory'),false);
 await handle.retire(clean);assert.equal(handle.observation().stoppedVerified,true);assert.equal((await f.service().reserve('personal',f.selected)).handle,undefined);
 const events=(await f.store.snapshot('personal')).observations[0].events;assert.deepEqual(events.map(e=>e.status),['reserved','acknowledged','stopped']);assert.equal(new Set(events.map(e=>e.subjectDigest)).size,1);
 assert.doesNotMatch(JSON.stringify(events),/\/synthetic|\/private|\/native/);assert.ok(events.every(e=>e.ideAttached===false&&e.taskCompletionVerified===false));
 const sealed=await readFile(join(f.root,'personal.sealed.json'),'utf8');assert.equal(sealed.includes('editor-protocol-acknowledged'),false);
});

test('an aborted editor journal transaction cannot retain its observation or a partial reservation',async t=>{
 const f=await fixture(t);await f.store.update('personal','fixture-consent',s=>{s.observations=[{id:'editor-history',status:'recording',sources:['editor-events'],exclusions:[],events:[],createdAt:Date.now(),updatedAt:Date.now()}];});await f.consume();
 const original=f.store.update,before=await readFile(join(f.root,'personal.sealed.json'));
 f.store.update=(c,op,fn,options)=>original(c,op,async state=>{const result=await fn(state);if(op==='coding-editor-connection-reserve')throw Error('Synthetic commit refusal');return result;},options);
 try {await assert.rejects(f.api.reserve('personal',f.selected),/Synthetic commit refusal/);} finally {f.store.update=original;}
 assert.deepEqual(await readFile(join(f.root,'personal.sealed.json')),before);assert.equal((await f.store.snapshot('personal')).observations[0].events.length,0);
 const {handle}=await f.api.reserve('personal',f.selected);await f.store.update('personal','fixture-pause',s=>{s.observations[0].status='paused';});await connected(handle);await handle.record({kind:'acknowledged',observation:ack});
 await f.store.update('personal','fixture-resume',s=>{s.observations[0].status='recording';});await handle.retire({...clean,carrierExitVerified:false});await handle.retire(clean);await handle.retire(clean);
 assert.deepEqual((await f.store.snapshot('personal')).observations[0].events.map(e=>e.status),['reserved','uncertain','stopped']);
});
test('a planned directory pins its private parent and exact request name before creation is recorded',async t=>{
 const f=await fixture(t);await f.consume();const {handle}=await f.api.reserve('personal',f.selected),path='/private/'+f.selected.requestId;
 await assert.rejects(handle.record({kind:'directory-intent',parent:{path:'/private',identity},path:'/private/other'}));
 await handle.record({kind:'directory-intent',parent:{path:'/private',identity},path});assert.equal(handle.observation().status,'directory-planned');
 await assert.rejects(handle.record({kind:'directory',path,identity}));await assert.rejects(handle.record({kind:'directory',path:path+'-changed',identity:{...identity,inode:'99'}}));
 await handle.record({kind:'directory',path,identity:{...identity,inode:'99'}});const row=(await f.store.snapshot('personal')).codingEditorConnections[0];assert.equal(row.directoryIntent.path,path);assert.equal(row.directory.path,path);
});
test('reservation cannot revive an expired consumed creation permit, while an existing connection can still record its lifetime',async t=>{
 for(const at of [0,Date.now()+60000]){const f=await fixture(t);await f.consume();f.at=at;await assert.rejects(f.api.reserve('personal',f.selected));assert.equal((await f.store.snapshot('personal')).codingEditorConnections,undefined);}
 const f=await fixture(t);await f.consume();const {handle}=await f.api.reserve('personal',f.selected);f.at=Date.now()+60000;await handle.record({kind:'directory',path:'/private/editor',identity});assert.equal(handle.observation().status,'private');
});
test('out-of-order, substituted identities and unverified peer bytes cannot advance a checkpoint',async t=>{
 const f=await fixture(t);await f.consume();const {handle}=await f.api.reserve('personal',f.selected);
 await assert.rejects(handle.record({kind:'upstream',pid:200,birth:'222'}));await assert.rejects(handle.record({kind:'directory',path:'/a/../editor',identity}));await assert.rejects(handle.record({kind:'directory',path:'/private/editor',identity:{...identity,mode:String(0o40755)}}));
 await handle.record({kind:'directory',path:'/private/editor',identity});await handle.record({kind:'upstream',pid:200,birth:'222'});await handle.record(ingress('reserved'));await handle.record(ingress('started'));
 const changed=ingress('ready');changed.ownership.pid=999;await assert.rejects(handle.record(changed));await handle.record(ingress('ready'));
 for(const patch of [{executableSha256:'c'.repeat(64)},{pid:100},{pid:200},{pid:300}])await assert.rejects(handle.record({kind:'peer',pid:400,birth:'444',executable:'/native/codex',executableSha256:'b'.repeat(64),...patch}));
 assert.equal(handle.observation().status,'ready');
});
test('failed acknowledgement, replayed transitions and unrelated private fields are preserved as refusals',async t=>{
 const f=await fixture(t);await f.consume();const {handle}=await f.api.reserve('personal',f.selected);await connected(handle);
 for(const observation of [{...ack,protocolAcknowledged:false},{...ack,ideAttached:true},{...ack,privateText:'PRIVATE'}, {...ack,accountAfterVerified:false}])await assert.rejects(handle.record({kind:'acknowledged',observation}));
 assert.equal(handle.observation().protocolAcknowledgementRecorded,false);await handle.record({kind:'acknowledged',observation:ack});await assert.rejects(handle.record({kind:'acknowledged',observation:ack}));
 assert.equal(JSON.stringify((await f.store.snapshot('personal')).codingEditorConnections).includes('PRIVATE'),false);
});
test('policy or account drift prevents new checkpoints while original cleanup remains recordable',async t=>{
 const f=await fixture(t);await f.consume();const {handle}=await f.api.reserve('personal',f.selected);await handle.record({kind:'directory',path:'/private/editor',identity});
 f.active=false;await assert.rejects(handle.record({kind:'upstream',pid:200,birth:'222'}));await assert.rejects(handle.assertCurrent());
 await handle.retire({...clean,carrierExitVerified:false});assert.equal(handle.observation().status,'uncertain');assert.equal(handle.observation().stoppedVerified,false);
 await handle.retire(clean);assert.equal(handle.observation().stoppedVerified,true);
});
test('a final admission failure leaves a durable spent reservation and no replacement handle',async t=>{
 const f=await fixture(t);await f.consume();let changed=false;
 f.hook=async()=>{if((await f.store.snapshot('personal')).codingEditorConnections?.length){changed=true;f.target.accountFingerprint='c'.repeat(64);}};
 await assert.rejects(f.api.reserve('personal',f.selected));assert.equal(changed,true);assert.equal((await f.store.snapshot('personal')).codingEditorConnections.length,1);
 f.hook=async()=>{};f.target.accountFingerprint='a'.repeat(64);assert.equal((await f.service().reserve('personal',f.selected)).handle,undefined);
});
test('external journal replacement cannot be overwritten by a retained handle or its cleanup',async t=>{
 const f=await fixture(t);await f.consume();const {handle}=await f.api.reserve('personal',f.selected);
 await f.store.update('personal','fixture-replacement',s=>{s.codingEditorConnections[0].revision=99;});
 await assert.rejects(handle.record({kind:'directory',path:'/private/editor',identity}));await assert.rejects(handle.retire(clean));assert.equal((await f.store.snapshot('personal')).codingEditorConnections[0].revision,99);
});
test('shutdown joins pending checkpoints, copies event input and leaves cleanup separate',async t=>{
 const f=await fixture(t);await f.consume();const {handle}=await f.api.reserve('personal',f.selected);
 const event={kind:'directory',path:'/private/editor',identity:{...identity}},work=handle.record(event);event.path='/changed';await work;assert.equal((await f.store.snapshot('personal')).codingEditorConnections[0].directory.path,'/private/editor');
 let entered,release;const waiting=new Promise(r=>entered=r),held=new Promise(r=>release=r);f.hook=async()=>{entered();await held;};
 const pending=handle.record({kind:'upstream',pid:200,birth:'222'}),rejected=assert.rejects(pending);await waiting;let closed=false;const stop=f.api.close().then(()=>closed=true);await new Promise(r=>setImmediate(r));assert.equal(closed,false);release();await rejected;await stop;
 assert.equal(handle.observation().status,'private');await handle.retire(clean);assert.equal(handle.observation().stoppedVerified,true);
});
