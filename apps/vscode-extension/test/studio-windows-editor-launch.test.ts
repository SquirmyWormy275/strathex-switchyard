import test, {type TestContext} from 'node:test';
import assert from 'node:assert/strict';
import {createHash,randomUUID} from 'node:crypto';
import {createServer} from 'node:http';
import {once} from 'node:events';
import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {StudioWindowsEditorLauncher} from '../src/studio-windows-editor-launch.ts';
import {StudioWindowsTaskClient,type WindowsEditorTarget} from '../src/studio-windows-task-client.ts';
import {codexWindowsTerminalResume} from '../src/codex-windows-terminal.ts';
import type {TerminalLike,TerminalOptionsLike,VscodeLike} from '../src/vscode-like.ts';
// @ts-expect-error Actual signed gateway, with explicit connection/provider doubles below.
import {createInstanceGateway} from '../../../tools/layout-studio/instance.mjs';
// @ts-expect-error Actual protected state and one-use authorization.
import {createSuiteStore} from '../../../tools/layout-studio/suite-store.mjs';
// @ts-expect-error Actual review and consumption service.
import {createCodingEditorAuthorizations} from '../../../tools/layout-studio/coding-editor-authorizations.mjs';
const digest=(value:unknown)=>createHash('sha256').update(JSON.stringify(value)).digest('hex');
async function fixture(t:TestContext){
  const root=await mkdtemp(join(tmpdir(),'switchyard-win-launch-')),selected={compartment:'personal',ownerRequestId:randomUUID(),loadRequestId:randomUUID()},executable='C:\\Reviewed\\codex.exe';
  const target:WindowsEditorTarget={schema:'switchyard-codex-editor-target/v1',ownerRequestId:selected.ownerRequestId,loadRequestId:selected.loadRequestId,taskId:randomUUID(),sessionId:randomUUID(),repositoryRoot:'C:\\Repository',repositoryIdentity:{device:'0',inode:'123'},accountFingerprint:'b'.repeat(64),permissions:'read-only/on-request',endpoint:{schema:'switchyard-windows-codex-stdio-binding/v1',scope:{schema:'switchyard-runtime-command/v1',id:randomUUID(),guardianPid:111,birth:'638000000000000001',containment:'windows-job'},peerPid:112,peerBirth:'133000000000000001',peerExecutableSha256:'c'.repeat(64)}};
  const image={path:executable,sha256:target.endpoint.peerExecutableSha256,device:'0',inode:'9007199254740993',size:'64'},endpoint={url:'ws://127.0.0.1:43179/',authToken:'s'.repeat(43)};
  const observation=()=>({target:structuredClone(target),targetDigest:digest(target),metadataObserved:true,nativeLoadAcknowledged:true,nativeTaskLoaded:false,authorityGranted:false,terminalLaunched:false,ideAttached:false,modelPromptSubmitted:false,completionVerified:false});
  const keys=new Map<string,string>(),store=createSuiteStore({root:join(root,'state'),secrets:{get:async(c:string,p:string)=>keys.get(c+':'+p),set:async(c:string,p:string,v:string)=>{keys.set(c+':'+p,v);}}});await store.initialize('personal');await store.update('personal','fixture',(s:any)=>{s.mode='personal-companion';});
  const auth=createCodingEditorAuthorizations({store,owners:{editorTarget:async()=>observation(),editorReturnTarget:async()=>observation()}}),routes:string[]=[],connections:string[]=[];
  const controls:{filesChanged?:boolean;contextChanged?:boolean;createThrows?:boolean;showThrows?:boolean;after?:(action:string)=>void|Promise<void>;afterCreate?:()=>void;nativeHold?:(signal:AbortSignal)=>Promise<void>;stopUncertain?:boolean;expectedCloseFailure?:boolean}={};
  const identity={id:randomUUID(),build:'a'.repeat(64)},token='s'.repeat(43),gateway=createInstanceGateway({token,identity,onStop:()=>{throw Error('NEVER_STOP_SUITE');},onEditorTarget:observation,onEditorAuthorization:async(action:string,{compartment,...input}:any)=>{routes.push(action);const value=await auth[action==='return-target'?'returnTarget':action](compartment,input);await controls.after?.(action);return value;},onEditorConnection:async(action:string,{compartment:_compartment,peer,...selection}:any)=>{
    connections.push(action);if(action==='pin-peer')assert.deepEqual(peer,{processId:123,expectedBirth:'133000000000000099',image});
    const flags={terminalLaunched:false,ideAttached:false,authorityGranted:false,completionVerified:false};
    const result=action==='stop'?{...selection,status:controls.stopUncertain?'uncertain':'stopped',protocolAcknowledgementRecorded:true,stoppedVerified:!controls.stopUncertain,...flags}:{requestId:selection.requestId,status:action==='open'?'ready':'acknowledged',peerVerified:action!=='open',protocolAcknowledged:action!=='open',...flags,...(action==='open'?{duplicatePrevented:false,endpoint}:{})};await controls.after?.(action);return{schema:'switchyard-editor-connection-result/v1',action,selection,result};
  }});
  let origin:string;const server=createServer((req,res)=>{assert.equal(req.headers.authorization,undefined);void gateway(req,res,origin);});server.listen(0,'127.0.0.1');await once(server,'listening');const address=server.address();assert.ok(address&&typeof address!=='string');origin=`http://127.0.0.1:${address.port}`;
  const client=new StudioWindowsTaskClient({readEndpoint:async()=>JSON.stringify({schema:'switchyard-active-endpoint/v1',instance:identity,pid:process.pid,url:origin+'/#access='+token}),assertCurrent:async()=>{}});
  const state={focused:true},terminals:TerminalLike[]=[],calls:TerminalOptionsLike[]=[],closed=new Set<(terminal:TerminalLike)=>unknown>(),active=new Set<(terminal:TerminalLike|undefined)=>unknown>();let activeTerminal:TerminalLike|undefined,nativeCalls=0,nativeClosed=0;
  const window={state,terminals,get activeTerminal(){return activeTerminal;},createTerminal(options:TerminalOptionsLike){calls.push(options);if(controls.createThrows)throw Error('synthetic partial creation');const terminal:TerminalLike={name:options.name,processId:Promise.resolve(123),show(){if(controls.showThrows)throw Error('synthetic focus failure');activeTerminal=terminal;for(const fn of active)fn(terminal);},sendText(){throw Error('NEVER_SEND_TEXT');}};terminals.push(terminal);controls.afterCreate?.();return terminal;},onDidCloseTerminal(fn:(terminal:TerminalLike)=>unknown){closed.add(fn);return{dispose(){closed.delete(fn);}};},onDidChangeActiveTerminal(fn:(terminal:TerminalLike|undefined)=>unknown){active.add(fn);return{dispose(){active.delete(fn);}};}};
  const workspace={workspaceFolders:[{uri:{fsPath:target.repositoryRoot}}]},launcher=new StudioWindowsEditorLauncher({client,host:{window,workspace} as unknown as Pick<VscodeLike,'window'|'workspace'>,executable,platform:'win32',assertCurrent:async()=>assert.ok(!controls.contextChanged),
    files:{image:async(path,sha,current)=>{await current();assert.equal(path,executable);assert.equal(sha,image.sha256);return{executable,executableIdentity:'synthetic image identity',image};},current:async()=>{assert.ok(!controls.filesChanged);}},
    native:{observeTerminal:async options=>{nativeCalls++;await options.assertCurrent();assert.equal(await options.terminal.processId,123);await controls.nativeHold?.(options.signal);assert.equal(options.signal.aborted,false);await options.assertCurrent();return{processId:123,expectedBirth:'133000000000000099',image};},close:async()=>{nativeClosed++;}}});
  t.after(async()=>{if(controls.expectedCloseFailure)await assert.rejects(launcher.close());else await launcher.close();await auth.close();server.closeAllConnections();await new Promise<void>(resolve=>server.close(()=>resolve()));assert.equal(closed.size,0);assert.equal(active.size,0);await rm(root,{recursive:true});});
  return{launcher,selected,target,endpoint,executable,controls,routes,connections,calls,terminals,state,workspace,store,counts:()=>({nativeCalls,nativeClosed}),closeTerminal:()=>{const terminal=terminals.shift()!;for(const fn of closed)fn(terminal);}};
}
test('a reviewed Windows launch consumes signed permission once, retains its Terminal, and puts the bearer only in its environment',async t=>{
  const f=await fixture(t),review=await f.launcher.review(f.selected);assert.equal(f.calls.length,0);const result=await f.launcher.launch(review);assert.equal(f.calls.length,1);
  assert.deepEqual(f.calls[0],{name:'Switchyard · Codex task',cwd:f.target.repositoryRoot,shellPath:f.executable,...codexWindowsTerminalResume(f.target.sessionId,f.target.repositoryRoot,f.endpoint)});assert.ok(!JSON.stringify(f.calls[0].shellArgs).includes(f.endpoint.authToken));assert.deepEqual(f.routes.slice(0,3),['review','issue','consume']);
  assert.equal(result.nativeProcessObserved,true);assert.equal(result.protocolAcknowledgementObserved,true);assert.equal(result.nativeTaskLoaded,false);assert.equal(result.ideAttached,false);assert.equal(result.modelPromptSubmitted,false);assert.equal(result.completionVerified,false);assert.equal((await f.store.snapshot('personal')).codingEditorAuthorizations[0].status,'consumed');
  await assert.rejects(f.launcher.launch(review));await assert.rejects(f.launcher.launch(structuredClone(review)));await f.launcher.focus(review);assert.equal(f.calls.length,1);
});
test('concurrent Windows launch requests cannot consume a review twice',async t=>{const f=await fixture(t),review=await f.launcher.review(f.selected),r=await Promise.allSettled([f.launcher.launch(review),f.launcher.launch(review)]);assert.equal(r.filter(v=>v.status==='fulfilled').length,1);assert.equal(f.calls.length,1);assert.equal(f.routes.filter(v=>v==='consume').length,1);});
test('focus, workspace, reviewed-file and context drift refuse before Windows terminal creation',async t=>{
  for(const drift of ['focus','workspace','files','context']){const f=await fixture(t),review=await f.launcher.review(f.selected);if(drift==='focus')f.state.focused=false;if(drift==='workspace')f.workspace.workspaceFolders=[];if(drift==='files')f.controls.filesChanged=true;if(drift==='context')f.controls.contextChanged=true;await assert.rejects(f.launcher.launch(review));assert.equal(f.calls.length,0);await assert.rejects(f.launcher.launch(review));}
});
test('lost scope after durable consumption or carrier opening retires the original connection without creating a terminal',async t=>{
  for(const phase of ['consume','open']){const f=await fixture(t),review=await f.launcher.review(f.selected);f.controls.after=async action=>{if(action===phase)f.state.focused=false;};await assert.rejects(f.launcher.launch(review));assert.equal(f.calls.length,0);assert.equal((await f.store.snapshot('personal')).codingEditorAuthorizations[0].status,'consumed');assert.equal(f.connections.includes('stop'),phase==='open');await assert.rejects(f.launcher.launch(review));}
});
test('partial creation and focus failure retain the attempted identity and do not dispose user terminals',async t=>{
  for(const phase of ['create','show','after-create']){const f=await fixture(t),review=await f.launcher.review(f.selected);if(phase==='create')f.controls.createThrows=true;if(phase==='show')f.controls.showThrows=true;if(phase==='after-create')f.controls.afterCreate=()=>{f.state.focused=false;};await assert.rejects(f.launcher.launch(review));assert.equal(f.launcher.observation(review).terminalCreationRequested,true);await assert.rejects(f.launcher.launch(review));await f.launcher.close();assert.equal(f.calls.length,1);assert.equal(f.terminals.length,phase==='create'?0:1);assert.equal(f.counts().nativeClosed,1);}
});
test('shutdown joins a held native terminal query before retiring the carrier and native readers',async t=>{
  const f=await fixture(t),review=await f.launcher.review(f.selected);let enter!:()=>void,release!:()=>void;const entered=new Promise<void>(r=>enter=r),held=new Promise<void>(r=>release=r);f.controls.nativeHold=async()=>{enter();await held;};const pending=assert.rejects(f.launcher.launch(review));await entered;let closed=false;const closing=f.launcher.close().then(()=>{closed=true;});await new Promise(r=>setImmediate(r));assert.equal(closed,false);assert.equal(f.counts().nativeClosed,0);release();await pending;await closing;assert.equal(f.connections.filter(v=>v==='stop').length,1);assert.equal(f.counts().nativeClosed,1);
});
test('closed terminals cannot be recreated and uncertain carrier retirement remains a failure',async t=>{
  const f=await fixture(t),review=await f.launcher.review(f.selected);await f.launcher.launch(review);f.closeTerminal();await assert.rejects(f.launcher.focus(review));await assert.rejects(f.launcher.launch(review));assert.equal(f.calls.length,1);
  const g=await fixture(t),other=await g.launcher.review(g.selected);await g.launcher.launch(other);g.controls.stopUncertain=true;g.controls.expectedCloseFailure=true;await assert.rejects(g.launcher.close());assert.equal(g.counts().nativeClosed,1);
});
