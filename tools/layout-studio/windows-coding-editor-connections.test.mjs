import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash,randomUUID } from 'node:crypto';
import { mkdtemp,rm,readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join,resolve } from 'node:path';
import { connect } from 'node:net';
import { EventEmitter,once } from 'node:events';
import { createSuiteStore } from './suite-store.mjs';
import { createSuite } from './suite.mjs';
import { createStudioServer } from './serve.mjs';
import { createCodingEditorAuthorizations } from './coding-editor-authorizations.mjs';
import { createWindowsCodingEditorConnections } from './windows-coding-editor-connections.mjs';
import { createWindowsTerminalProcessProbe } from './windows-terminal-process.mjs';
import { createRetainedCodexEditorClient } from './codex-retained-editor-client.mjs';
import { codexAccountFingerprint,codexDesignConfig } from './agents.mjs';
import { queryIntentForOwner } from './windows-query-ownership.mjs';
import { editorServerFrame } from './editor-websocket-frames.mjs';
import { StudioWindowsTaskClient } from '../../apps/vscode-extension/src/studio-windows-task-client.ts';
import { StudioWindowsEditorLauncher } from '../../apps/vscode-extension/src/studio-windows-editor-launch.ts';

const gate=()=>{let resolve;const promise=new Promise(r=>resolve=r);return{promise,resolve};};
const hash=v=>createHash('sha256').update(JSON.stringify(v)).digest('hex');
const image=(name,sha)=>({path:'C:\\Synthetic\\'+name,sha256:sha.repeat(64),device:'0',inode:'9',size:'512'});
const host=()=>({schema:'switchyard-editor-terminal-process-result/v1',requestId:randomUUID(),processId:process.pid,birth:'133000000000000001',image:image('node.exe','a'),currentUserVerified:true,currentSessionVerified:true,processAccessMask:0x101000,tokenAccessMask:8,processTerminated:false,windowFocused:false,taskAttached:false,accountVerified:false});
const peer={processId:321,expectedBirth:'133000000000000003',image:image('codex.exe','b')};
const scope=()=>({schema:'switchyard-runtime-command/v1',id:randomUUID(),guardianPid:500,birth:'638000000000000001',containment:'windows-job'});
async function until(fn){const end=Date.now()+5000;while(Date.now()<end){const value=await fn();if(value)return value;await new Promise(r=>setTimeout(r,10));}throw Error('The bounded Windows lifecycle did not settle.');}
async function terminal(t,endpoint){
  const url=new URL(endpoint.url),socket=connect({host:'127.0.0.1',port:Number(url.port)});let bytes=Buffer.alloc(0);
  socket.on('data',b=>{bytes=Buffer.concat([bytes,b]);assert(bytes.length<=2097152);});socket.on('error',()=>{});t.after(()=>socket.destroy());await once(socket,'connect',{signal:AbortSignal.timeout(5000)});
  socket.write('GET / HTTP/1.1\r\nHost: '+url.host+'\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Version: 13\r\nSec-WebSocket-Key: BwcHBwcHBwcHBwcHBwcHBw==\r\nAuthorization: Bearer '+endpoint.authToken+'\r\n\r\n');
  await until(()=>bytes.includes('\r\n\r\n'));const n=bytes.indexOf('\r\n\r\n')+4;assert.match(bytes.subarray(0,n).toString(),/^HTTP\/1.1 101 /);bytes=bytes.subarray(n);
  return{socket,send(message){const b=Buffer.from(JSON.stringify(message)),wire=editorServerFrame(1,b),header=Buffer.from(wire.subarray(0,wire.length-b.length)),mask=Buffer.from([1,3,5,7]);header[1]|=128;socket.write(Buffer.concat([header,mask,Buffer.from(b.map((v,i)=>v^mask[i%4]))]));},async receive(){return until(()=>{if(bytes.length<2)return;let n=bytes[1],offset=2;assert.equal(n&128,0);if(n===126){if(bytes.length<4)return;n=bytes.readUInt16BE(2);offset=4;}if(n===127){if(bytes.length<10)return;n=Number(bytes.readBigUInt64BE(2));offset=10;}if(bytes.length<offset+n)return;const m=JSON.parse(bytes.subarray(offset,offset+n));bytes=bytes.subarray(offset+n);return m;});}};
}

async function fixture(t,{nativeHost=false}={}){
  const root=await mkdtemp(join(tmpdir(),'sywlc-')),keys=new Map(),services=[],cleanup=[];
  const store=createSuiteStore({root,secrets:{get:async(c,p)=>keys.get(c+p),set:async(c,p,v)=>keys.set(c+p,v)}});await store.initialize('personal');await store.update('personal','fixture-mode',s=>{s.mode='personal-companion';});
  const selected={requestId:randomUUID(),editorId:randomUUID(),ownerRequestId:randomUUID(),loadRequestId:randomUUID()},account={type:'chatgpt',email:'synthetic-lifecycle@example.invalid'};
  const binding={schema:'switchyard-windows-codex-stdio-binding/v1',scope:scope(),peerPid:300,peerBirth:'133000000000000002',peerExecutableSha256:peer.image.sha256};
  const target={schema:'switchyard-codex-editor-target/v1',ownerRequestId:selected.ownerRequestId,loadRequestId:selected.loadRequestId,taskId:randomUUID(),sessionId:randomUUID(),repositoryRoot:'C:\\Synthetic\\repository',repositoryIdentity:{device:'0',inode:'9'},accountFingerprint:codexAccountFingerprint(account),permissions:'read-only/on-request',endpoint:binding};
  const f={store,root,selected,target,services,cleanup,calls:[],clients:[],active:true,registrations:0,hostChecks:0,helperStopped:true,hostStopped:true,uncertain:false,beforeClient:async()=>{},beforeHost:async()=>{},beforePeer:async()=>{}};
  const provider=new EventEmitter();provider.closed=false;provider.restrictionsVerified=true;provider.accountFingerprint=target.accountFingerprint;provider.accountEpoch=0;
  provider.initializationEvidence={clientName:'switchyard_tasks',result:{userAgent:'switchyard_tasks/0.166.0 (synthetic)'}};
  provider.close=()=>{provider.closed=true;provider.emit('disconnected');};provider.send=m=>f.calls.push(m);
  provider.request=async(method,params)=>{f.calls.push({method,params});const thread={id:target.sessionId,cwd:target.repositoryRoot,status:{type:'idle'}};return method==='account/read'?{account}:method==='config/read'?{config:codexDesignConfig()}:method==='thread/resume'?{thread,cwd:target.repositoryRoot,sandbox:{type:'readOnly'},approvalPolicy:'on-request',modelProvider:'openai'}:{thread};};f.provider=provider;
  const owners={async editorTarget(){return{target:structuredClone(target),targetDigest:hash(target),metadataObserved:true,nativeLoadAcknowledged:true,nativeTaskLoaded:false,authorityGranted:false,terminalLaunched:false,ideAttached:false,modelPromptSubmitted:false,completionVerified:false};},async openEditorClient(_c,s,{onClient}){assert.equal(s.ownerRequestId,selected.ownerRequestId);f.registrations++;const client=createRetainedCodexEditorClient({client:provider,target:{sessionId:target.sessionId,repositoryRoot:target.repositoryRoot,accountFingerprint:target.accountFingerprint},platform:'win32',assertCurrent:async()=>{assert(f.active);}});f.clients.push(client);await f.beforeClient();await onClient(client);return client;}};owners.editorReturnTarget=owners.editorTarget;f.owners=owners;
  const auth=createCodingEditorAuthorizations({store,owners,isActive:async()=>f.active});const review=await auth.review('personal',selected),issued=await auth.issue('personal',{...selected,token:review.confirmation.token});await auth.consume('personal',{...selected,permit:issued.permit});
  let nativeOptions={};if(nativeHost){const path=resolve('runtime/hotkeys/Switchyard.Hotkeys.exe'),sha256=createHash('sha256').update(await readFile(path)).digest('hex');nativeOptions={hostProbeFactory:()=>createWindowsTerminalProcessProbe({helper:async()=>({path,sha256})})};}
  const options={store,authorizations:auth,owners,platform:'win32',...(nativeHost?nativeOptions:{hostProbeFactory:()=>({close:async()=>({stoppedVerified:f.hostStopped})}),hostObservation:async(_probe,context)=>{f.hostChecks++;await f.beforeHost();await context.assertCurrent();return host();}}),
    probeFactory:callbacks=>({close:async()=>({stoppedVerified:f.helperStopped}),inspectPeer:async(query,context)=>{
      const ownership={schema:'switchyard-windows-query-owner/v1',requestId:randomUUID(),role:'peer',scope:scope(),helper:{path:'C:\\Synthetic\\Helper.exe',sha256:'e'.repeat(64)}};
      await callbacks.onIntent(queryIntentForOwner(ownership));try{await callbacks.onOwner(ownership);await f.beforePeer();await context.assertCurrent();return{...host(),schema:'switchyard-editor-terminal-peer-result/v1',requestId:randomUUID(),processId:query.processId,birth:query.expectedBirth,image:query.image,connection:query.connection,connectionVerified:true};}finally{await callbacks.onRetired(ownership);}
    }})};
  f.service=extra=>{const api=createWindowsCodingEditorConnections({...options,...extra});services.push(api);return api;};f.api=f.service();
  f.open=()=>f.api.open('personal',selected);f.ready=async(endpoint,pin=p=>f.api.pinPeer('personal',selected,p))=>{const pinning=pin(peer);const [,terminalClient]=await Promise.all([pinning,terminal(t,endpoint)]);terminalClient.send({id:1,method:'initialize',params:{clientInfo:{name:'codex_tui',version:'0.166.0'}}});assert.equal((await terminalClient.receive()).id,1);terminalClient.send({method:'initialized',params:{}});return terminalClient;};
  f.resume=async terminal=>{terminal.send({id:2,method:'thread/resume',params:{threadId:target.sessionId,cwd:target.repositoryRoot,sandbox:'read-only',approvalPolicy:'on-request',excludeTurns:true}});assert.equal((await terminal.receive()).result.thread.id,target.sessionId);};
  t.after(async()=>{for(const close of cleanup.toReversed())await close();for(const api of services){const result=await api.close();if(!f.uncertain)assert.equal(result.stopped,true);}for(const client of f.clients)await client.stop();assert.equal(provider.closed,false);await auth.close();await rm(root,{recursive:true});});return f;
}

test('Windows lifecycle composes consumed review, protected journal, retained client and real authenticated socket',async t=>{
  const f=await fixture(t),opened=await f.open();assert.equal(opened.status,'ready');const terminal=await f.ready(opened.endpoint);await f.resume(terminal);await until(async()=>(await f.api.observe('personal',f.selected)).protocolAcknowledged);
  const row=(await f.store.snapshot('personal')).codingEditorConnections[0];assert.equal(row.status,'acknowledged');assert.equal(row.queryOwner.stopped,true);assert.equal(row.queryIntent,null);assert(row.querySequence>=3);assert.equal(row.upstream.kind,'logical-channel');
  assert.equal(JSON.stringify(row).includes(opened.endpoint.authToken),false);assert.equal((await readFile(join(f.root,'personal.sealed.json'),'utf8')).includes(opened.endpoint.authToken),false);
  assert.equal((await f.api.stop('personal',f.selected)).stoppedVerified,true);assert.equal(f.provider.closed,false);assert.equal((await f.open()).endpoint,undefined);assert.equal(f.registrations,1);assert.equal(f.calls.filter(c=>c.method==='initialize').length,0);
});

test('competing hosts cannot create another client for a consumed selection and disconnect retires the winner',async t=>{
  const f=await fixture(t),other=f.service(),results=await Promise.all([f.open(),other.open('personal',f.selected)]);assert.equal(results.filter(r=>r.endpoint).length,1);assert.equal(f.registrations,1);
  const winner=results[0].endpoint?f.api:other,opened=results.find(r=>r.endpoint),terminal=await f.ready(opened.endpoint,p=>winner.pinPeer('personal',f.selected,p));terminal.socket.destroy();
  await until(async()=>(await f.store.snapshot('personal')).codingEditorConnections[0].status==='stopped');assert.equal((await winner.stop('personal',f.selected)).stoppedVerified,true);assert.equal(f.provider.closed,false);
});

test('shutdown joins host observation and client registration without creating a replacement or protocol request',async t=>{
  for(const stage of ['beforeHost','beforeClient']){const f=await fixture(t),entered=gate(),held=gate();f[stage]=async()=>{entered.resolve();await held.promise;};const opening=f.open(),rejected=assert.rejects(opening);await Promise.race([entered.promise,opening.then(()=>assert.fail('Startup skipped the held boundary'))]);
    let done=false;const closing=f.api.close().then(r=>{done=true;return r;});await new Promise(r=>setImmediate(r));assert.equal(done,false);held.resolve();await rejected;assert.equal((await closing).stopped,true);assert.equal(f.calls.length,0);
  }
});

test('foreign peer bytes and permission withdrawal retire the original carrier while helper uncertainty stays explicit',async t=>{
  const f=await fixture(t);await f.open();await assert.rejects(f.api.pinPeer('personal',f.selected,{...peer,image:image('changed.exe','d')}));assert.equal((await f.store.snapshot('personal')).codingEditorConnections[0].status,'stopped');
  const g=await fixture(t);await g.open();g.active=false;await assert.rejects(g.api.observe('personal',g.selected));assert.equal((await g.api.stopCompartment('personal')).stopped,true);
  const h=await fixture(t);await h.open();h.helperStopped=false;h.uncertain=true;assert.equal((await h.api.stop('personal',h.selected)).stoppedVerified,false);assert.equal((await h.store.snapshot('personal')).codingEditorConnections[0].status,'uncertain');assert.equal((await h.api.close()).stopped,false);
});

test('recovery keeps an uncertain observer reachable until its own shutdown verifies',async t=>{
  const f=await fixture(t);let clean=false,closes=0;const api=f.service({recoveryFactory:()=>({verify:async()=>{throw Error('must not observe missing row');},close:async()=>{closes++;return{stoppedVerified:clean};}})});
  await assert.rejects(api.recover('personal',f.selected));assert.equal(closes,1);await assert.rejects(api.recover('personal',f.selected));assert.equal(closes,1);clean=true;assert.equal((await api.stopCompartment('personal')).stopped,true);assert.equal(closes,2);
});

test('actual Windows host proof composes with protected state and synthetic provider/peer through socket acknowledgement', {skip:process.platform!=='win32'},async t=>{
  const f=await fixture(t,{nativeHost:true}),opened=await f.open(),terminal=await f.ready(opened.endpoint);await f.resume(terminal);await until(async()=>(await f.api.observe('personal',f.selected)).protocolAcknowledged);
  const row=(await f.store.snapshot('personal')).codingEditorConnections[0];assert.equal(row.host.processId,process.pid);assert.equal(row.host.tokenAccessMask,8);assert.equal((await f.api.stop('personal',f.selected)).stoppedVerified,true);
});

async function routed(f){
  const events=[],retired=async()=>{assert((await f.store.snapshot('personal')).codingEditorConnections?.every(r=>r.status==='stopped'));};
  const owners={...f.owners,stopCompartment:async()=>{await retired();events.push('owner-stop');return{stopped:true};},close:async()=>{await retired();events.push('owner-close');return[];}};
  const suite=createSuite({store:f.store,platform:'win32',codingTaskOwners:owners,codingEditorConnectionsFactory:options=>{assert.equal(options.platform,'win32');events.push('constructed');return f.api;},agents:{discovery:async()=>[],close:async()=>{}},voice:{discovery:async()=>({available:false})}});
  f.cleanup.push(()=>suite.close());await suite.handle('/api/suite/bootstrap');assert.equal(events.length,0);return{suite,events};
}

test('signed Windows Suite routes complete a synthetic return and retire the carrier before task-owner shutdown',async t=>{
  const f=await fixture(t),{suite,events}=await routed(f),token='s'.repeat(43),instance={id:randomUUID(),build:'a'.repeat(64)};
  const server=createStudioServer({suite,token,instance,onApplicationStop:()=>suite.close(),bridge:{close(){}}});server.listen(0,'127.0.0.1');await once(server,'listening');f.cleanup.push(async()=>{server.closeAllConnections();await new Promise((r,j)=>server.close(e=>e?j(e):r()));});
  const origin='http://127.0.0.1:'+server.address().port,names={open:'openEditorConnection','pin-peer':'pinEditorPeer',observe:'observeEditorConnection',stop:'stopEditorConnection',recover:'recoverEditorConnection'};
  // The endpoint reader is explicitly doubled; wire parsing, signing and
  // platform response contracts are the actual Windows extension client.
  const client=new StudioWindowsTaskClient({readEndpoint:async()=>JSON.stringify({schema:'switchyard-active-endpoint/v1',url:origin+'/#access='+token,instance,pid:process.pid}),assertCurrent:async()=>{}});f.cleanup.push(async()=>client.close());
  const call=(action,extra={})=>client[names[action]]({compartment:'personal',...f.selected,...extra});
  const opened=await call('open');assert.deepEqual(events,['constructed']);const terminal=await f.ready(opened.endpoint,p=>call('pin-peer',{peer:p}));await f.resume(terminal);await until(async()=>(await call('observe')).protocolAcknowledged);
  assert.equal((await call('open')).endpoint,undefined);assert.equal(f.registrations,1);assert.equal((await call('stop')).stoppedVerified,true);assert.equal((await call('recover')).duplicatePrevented,true);
  await suite.close();assert.equal(events.at(-1),'owner-close');assert.equal(f.provider.closed,false);
});

test('Windows workspace and keyboard-only transitions join the editor before stopping its task owner',async t=>{
  for(const transition of ['workspace','mode']){const f=await fixture(t),{suite,events}=await routed(f);await suite.handle('/api/suite/coding/codex/editor-connections/open',f.selected);
    if(transition==='workspace'){await suite.handle('/api/suite/compartment/create',{compartment:'second'});await suite.handle('/api/suite/compartment/select',{compartment:'second'});assert.equal(await f.store.selection(),'second');}
    else assert.equal((await suite.handle('/api/suite/mode',{mode:'keyboard-only'})).ownedProcessesStopped,true);
    assert(events.includes('owner-stop'));assert.equal((await f.store.snapshot('personal')).codingEditorConnections[0].status,'stopped');
  }
});

test('the reviewed Windows launcher crosses signed Suite routes, protected state and a real authenticated carrier with explicit host/provider doubles',async t=>{
  const f=await fixture(t),{suite,events}=await routed(f),token='s'.repeat(43),instance={id:randomUUID(),build:'a'.repeat(64)};
  const server=createStudioServer({suite,token,instance,onApplicationStop:()=>suite.close(),bridge:{close(){}}});server.listen(0,'127.0.0.1');await once(server,'listening');f.cleanup.push(async()=>{server.closeAllConnections();await new Promise((r,j)=>server.close(e=>e?j(e):r()));});
  const client=new StudioWindowsTaskClient({readEndpoint:async()=>JSON.stringify({schema:'switchyard-active-endpoint/v1',url:'http://127.0.0.1:'+server.address().port+'/#access='+token,instance,pid:process.pid}),assertCurrent:async()=>assert(f.active)});
  const terminals=[],calls=[],activeListeners=new Set(),closeListeners=new Set();let activeTerminal,wireWork,nativeClosed=false;
  const window={state:{focused:true},terminals,get activeTerminal(){return activeTerminal;},onDidCloseTerminal(fn){closeListeners.add(fn);return{dispose(){closeListeners.delete(fn);}};},onDidChangeActiveTerminal(fn){activeListeners.add(fn);return{dispose(){activeListeners.delete(fn);}};},createTerminal(options){
    calls.push(options);const endpoint={url:options.shellArgs[2],authToken:options.env.SWITCHYARD_CODEX_REMOTE_TOKEN};assert.equal(options.shellPath,peer.image.path);assert(!options.shellArgs.includes(endpoint.authToken));
    wireWork=(async()=>{const wire=await terminal(t,endpoint);wire.send({id:1,method:'initialize',params:{clientInfo:{name:'codex_tui',version:'0.166.0'}}});assert.equal((await wire.receive()).id,1);wire.send({method:'initialized',params:{}});await f.resume(wire);})();void wireWork.catch(()=>{});
    const object={name:options.name,processId:Promise.resolve(peer.processId),show(){activeTerminal=object;for(const fn of activeListeners)fn(object);},sendText(){throw Error('NEVER_SEND_TEXT');}};terminals.push(object);return object;
  }};
  const launcher=new StudioWindowsEditorLauncher({client,host:{window,workspace:{workspaceFolders:[{uri:{fsPath:f.target.repositoryRoot}}]}},executable:peer.image.path,platform:'win32',assertCurrent:async()=>assert(f.active),
    files:{image:async(_path,_sha,current)=>{await current();return{executable:peer.image.path,executableIdentity:'explicit synthetic file identity',image:peer.image};},current:async()=>assert(f.active)},
    native:{observeTerminal:async options=>{await options.assertCurrent();assert.equal(await options.terminal.processId,peer.processId);return peer;},close:async()=>{nativeClosed=true;}}});
  f.cleanup.push(()=>launcher.close());const review=await launcher.review({compartment:'personal',ownerRequestId:f.selected.ownerRequestId,loadRequestId:f.selected.loadRequestId});assert.equal(calls.length,0);
  const result=await launcher.launch(review);await wireWork;assert.equal(result.protocolAcknowledgementObserved,true);assert.equal(result.nativeProcessObserved,true);assert.equal(result.ideAttached,false);assert.equal(result.modelPromptSubmitted,false);assert.equal(calls.length,1);assert.equal(f.registrations,1);
  const row=(await f.store.snapshot('personal')).codingEditorConnections.find(r=>r.requestId===review.selection.requestId);assert.equal(row.status,'acknowledged');assert.equal(row.queryOwner.stopped,true);assert.equal(JSON.stringify(row).includes(calls[0].env.SWITCHYARD_CODEX_REMOTE_TOKEN),false);
  await assert.rejects(launcher.launch(review));await launcher.focus(review);assert.equal(calls.length,1);await launcher.close();assert.equal(nativeClosed,true);assert.equal(closeListeners.size,0);assert.equal(activeListeners.size,0);await suite.close();assert.equal(events.at(-1),'owner-close');assert.equal(f.provider.closed,false);
});
