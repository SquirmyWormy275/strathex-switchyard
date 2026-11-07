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
const clean={clientConnectionRetired:true,carrierExitVerified:true,queryHelpersExitVerified:true};
const ack={schema:'switchyard-codex-editor-protocol/v1',stage:'acknowledged',reason:null,accountBeforeVerified:true,exactResumeRequested:true,exactResumeReplyVerified:true,accountAfterVerified:true,protocolAcknowledged:true,transportPeerVerified:false,terminalProcessVerified:false,ideAttached:false,authorityGranted:false,completionVerified:false};
const image=(name,sha)=>({path:'C:\\Synthetic\\'+name,sha256:sha.repeat(64),device:'0',inode:'9007199254740993',size:'512'});
const host=()=>({schema:'switchyard-editor-terminal-process-result/v1',requestId:randomUUID(),processId:101,birth:'133000000000000001',image:image('node.exe','a'),currentUserVerified:true,currentSessionVerified:true,processAccessMask:0x101000,tokenAccessMask:8,processTerminated:false,windowFocused:false,taskAttached:false,accountVerified:false});
async function fixture(t) {
  const root=await mkdtemp(join(tmpdir(),'sywj-')),keys=new Map(),services=[];
  const store=createSuiteStore({root,secrets:{get:async(c,p)=>keys.get(c+p),set:async(c,p,v)=>keys.set(c+p,v)}});await store.initialize('personal');await store.update('personal','fixture-mode',s=>{s.mode='personal-companion';});
  const selected={requestId:randomUUID(),editorId:randomUUID(),ownerRequestId:randomUUID(),loadRequestId:randomUUID()},originalHost=host();
  const binding={schema:'switchyard-windows-codex-stdio-binding/v1',scope:{schema:'switchyard-runtime-command/v1',id:randomUUID(),guardianPid:200,birth:'638000000000000001',containment:'windows-job'},peerPid:300,peerBirth:'133000000000000002',peerExecutableSha256:'b'.repeat(64)};
  const target={schema:'switchyard-codex-editor-target/v1',ownerRequestId:selected.ownerRequestId,loadRequestId:selected.loadRequestId,taskId:randomUUID(),sessionId:randomUUID(),repositoryRoot:'C:\\Synthetic\\repository',repositoryIdentity:{device:'0',inode:'9'},accountFingerprint:'c'.repeat(64),permissions:'read-only/on-request',endpoint:binding};
  let active=true,hook=async()=>{};
  const owners={async editorTarget(){await hook();return{target:structuredClone(target),targetDigest:hash(target),metadataObserved:true,nativeLoadAcknowledged:true,nativeTaskLoaded:false,authorityGranted:false,terminalLaunched:false,ideAttached:false,modelPromptSubmitted:false,completionVerified:false};}};owners.editorReturnTarget=owners.editorTarget;
  const auth=createCodingEditorAuthorizations({store,owners,isActive:async()=>active});
  const service=(platform='win32')=>{const api=createCodingEditorJournal({store,authorizations:auth,platform});services.push(api);return api;},api=service();
  t.after(async()=>{hook=async()=>{};for(const service of services)await service.close();await auth.close();await rm(root,{recursive:true});});
  const consume=async()=>{const review=await auth.review('personal',selected),issued=await auth.issue('personal',{...selected,token:review.confirmation.token});return auth.consume('personal',{...selected,permit:issued.permit});};
  const ingress=phase=>({kind:'ingress',ownership:{schema:'switchyard-windows-editor-ingress-owner/v1',requestId:selected.requestId,phase,hostPid:originalHost.processId,endpoint:phase==='reserved'?null:'ws://127.0.0.1:43179/',listenerClosed:['reserved','connected'].includes(phase),socketClosed:phase!=='connected',capabilitySha256:'d'.repeat(64)}});
  const upstream=()=>({kind:'upstream',binding:structuredClone(binding)}),peer=()=>({kind:'peer',processId:400,expectedBirth:'133000000000000003',image:image('codex.exe','b')});
  const ready=async handle=>{for(const e of [upstream(),ingress('reserved'),ingress('ready')])await handle.record(e);};
  const connected=async handle=>{await ready(handle);for(const e of [peer(),ingress('peer-requested'),ingress('connected')])await handle.record(e);};
  return{root,store,selected,target,binding,host:originalHost,api,service,consume,ingress,upstream,peer,ready,connected,set active(v){active=v;},set hook(v){hook=v;}};
}

test('Windows journal reservation requires a consumed review and exact native host evidence without replay',async t=>{
  const f=await fixture(t);assert.throws(()=>f.api.reserve('personal',f.selected));
  for(const patch of [{tokenAccessMask:10},{currentUserVerified:false},{processTerminated:true},{birth:'0'},{privateToken:'never-retain'}])assert.throws(()=>f.api.reserve('personal',f.selected,{host:{...f.host,...patch}}));
  await assert.rejects(f.api.reserve('personal',f.selected,{host:f.host}));await f.consume();
  const results=await Promise.all([f.api,f.service()].map(api=>api.reserve('personal',f.selected,{host:f.host})));assert.equal(results.filter(r=>r.handle).length,1);assert.equal(results.filter(r=>r.duplicatePrevented).length,1);
  const row=(await f.store.snapshot('personal')).codingEditorConnections[0];assert.equal(row.schema,'switchyard-windows-editor-connection/v1');assert.deepEqual(row.host,f.host);
  assert.equal((await f.service().reserve('personal',f.selected,{host:f.host})).handle,undefined);
});

test('Windows journal records logical ownership and capability hashes with private opt-in historical observations',async t=>{
  const f=await fixture(t);await f.store.update('personal','fixture-observation',s=>{s.observations=[{id:'windows-editor-history',status:'recording',sources:['editor-events'],exclusions:[],events:[],createdAt:Date.now(),updatedAt:Date.now()}];});await f.consume();
  const {handle}=await f.api.reserve('personal',f.selected,{host:f.host});await f.connected(handle);await handle.record({kind:'acknowledged',observation:ack});await handle.assertCurrent();
  const row=(await f.store.snapshot('personal')).codingEditorConnections[0];assert.equal(row.upstream.kind,'logical-channel');assert.deepEqual(row.upstream.binding,f.binding);assert.equal(row.ingress.capabilitySha256,'d'.repeat(64));assert.equal(row.peer.processId,400);
  assert.equal(Object.hasOwn(row,'directory'),false);const listed=(await f.api.list('personal'))[0];assert.equal(listed.protocolAcknowledgementRecorded,true);assert.equal(listed.ideAttached,false);assert.equal(listed.authorityGranted,false);
  await handle.retire(clean);const state=await f.store.snapshot('personal'),events=state.observations[0].events;assert.deepEqual(events.map(e=>e.status),['reserved','acknowledged','stopped']);
  assert.doesNotMatch(JSON.stringify(events),/Synthetic|43179|logical-channel|capabilitySha256/);assert.ok(events.every(e=>!e.ideAttached&&!e.taskCompletionVerified));
  assert.equal(Object.hasOwn(state.codingEditorConnections[0].retirement,'upstreamExitVerified'),false);assert.equal((await readFile(join(f.root,'personal.sealed.json'),'utf8')).includes('43179'),false);
});

test('Windows journal refuses foreign processes, changed capability or endpoint and out-of-order checkpoints',async t=>{
  const f=await fixture(t);await f.consume();const {handle}=await f.api.reserve('personal',f.selected,{host:f.host});
  await assert.rejects(handle.record(f.ingress('ready')));await assert.rejects(handle.record({kind:'directory',path:'/pretend-linux'}));
  const upstream=f.upstream();upstream.binding.peerBirth='1';await assert.rejects(handle.record(upstream));await f.ready(handle);
  for(const processId of [101,200,300])await assert.rejects(handle.record({...f.peer(),processId}));await assert.rejects(handle.record({...f.peer(),image:image('different.exe','e')}));
  await handle.record(f.peer());
  for(const patch of [{capabilitySha256:'e'.repeat(64)},{hostPid:999},{endpoint:'ws://127.0.0.1:43180/'},{endpoint:'ws://localhost:43179/'},{authToken:'never-retain'}]){const event=f.ingress('peer-requested');Object.assign(event.ownership,patch);await assert.rejects(handle.record(event));}
  await handle.record(f.ingress('peer-requested'));await handle.record(f.ingress('connected'));await assert.rejects(handle.record(f.ingress('connected')));
  assert.equal(JSON.stringify((await f.store.snapshot('personal')).codingEditorConnections).includes('never-retain'),false);
});

test('Windows journal keeps uncertain helpers explicit and cleanup available after permission withdrawal',async t=>{
  const f=await fixture(t);await f.consume();const {handle}=await f.api.reserve('personal',f.selected,{host:f.host});await f.ready(handle);f.active=false;
  await assert.rejects(handle.record(f.peer()));await assert.rejects(handle.assertCurrent());
  await assert.rejects(handle.retire({...clean,upstreamExitVerified:true}));await handle.retire({...clean,queryHelpersExitVerified:false});assert.equal(handle.observation().status,'uncertain');assert.equal(handle.observation().stoppedVerified,false);
  await handle.retire(clean);assert.equal(handle.observation().stoppedVerified,true);
});

test('Windows recovery refuses a live host, foreign platform and substituted protected record without replay',async t=>{
  const f=await fixture(t);await f.consume();await f.api.reserve('personal',f.selected,{host:f.host});
  await assert.rejects(f.api.recover('personal',f.selected,async()=>({hostExitVerified:true,...clean})));
  await assert.rejects(f.service('linux').recover('personal',f.selected,async()=>({hostExitVerified:true,...clean})));
  const other=f.service();assert.equal((await other.recover('personal',f.selected,async()=>({hostExitVerified:false,...clean}))).recoveryBlocked,true);
  const uncertain=await other.recover('personal',f.selected,async()=>({hostExitVerified:true,...clean,queryHelpersExitVerified:false}));assert.equal(uncertain.status,'uncertain');
  assert.equal((await other.recover('personal',f.selected,async()=>({hostExitVerified:true,...clean}))).stoppedVerified,true);assert.equal((await other.reserve('personal',f.selected,{host:f.host})).handle,undefined);
  const g=await fixture(t);await g.consume();const {handle}=await g.api.reserve('personal',g.selected,{host:g.host});
  await assert.rejects(g.service().recover('personal',g.selected,async()=>{await g.store.update('personal','fixture-substitution',s=>{s.codingEditorConnections[0].revision=99;});return{hostExitVerified:true,...clean};}));
  await assert.rejects(handle.retire(clean));assert.equal((await g.store.snapshot('personal')).codingEditorConnections[0].revision,99);
});

test('Windows journal shutdown joins pending checkpoints and preserves the original unacknowledged reservation',async t=>{
  const f=await fixture(t);await f.consume();const {handle}=await f.api.reserve('personal',f.selected,{host:f.host});
  let enter,release;const entered=new Promise(r=>enter=r),held=new Promise(r=>release=r);f.hook=async()=>{enter();await held;};
  const pending=handle.record(f.upstream()),rejected=assert.rejects(pending);await entered;let closed=false;const closing=f.api.close().then(()=>{closed=true;});await new Promise(r=>setImmediate(r));assert.equal(closed,false);release();await rejected;await closing;
  assert.equal(handle.observation().status,'reserved');await handle.retire(clean);assert.equal(handle.observation().stoppedVerified,true);
});
