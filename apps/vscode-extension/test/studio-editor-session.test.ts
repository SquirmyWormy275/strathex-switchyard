import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash, randomUUID } from 'node:crypto';
import { once } from 'node:events';
import { spawn, type ChildProcess } from 'node:child_process';
import { mkdtemp,mkdir,copyFile,writeFile,readFile,lstat,readdir,rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { StudioTaskClient } from '../src/studio-task-client.ts';
import { StudioEditorLauncher } from '../src/studio-editor-launch.ts';
import type { TerminalLike,TerminalOptionsLike,VscodeLike } from '../src/vscode-like.ts';
// @ts-expect-error Exercise shipped JavaScript protected storage.
import { createSuiteStore } from '../../../tools/layout-studio/suite-store.mjs';
// @ts-expect-error Exercise shipped Suite lifecycle composition.
import { createSuite } from '../../../tools/layout-studio/suite.mjs';
// @ts-expect-error Exercise shipped signed HTTP routing.
import { createStudioServer } from '../../../tools/layout-studio/serve.mjs';
// @ts-expect-error Own an actual provider-double carrier.
import { openOwnedCodexListener } from '../../../tools/layout-studio/codex-owned-listener.mjs';
// @ts-expect-error Use the existing production restriction shape.
import { codexDesignConfig } from '../../../tools/layout-studio/agents.mjs';
// @ts-expect-error Verify exact synthetic child exit.
import { stopOwnedChild } from '../../../tools/layout-studio/owned-process.mjs';

test('retained Terminal, signed client, protected Suite and real Linux carriers acknowledge one exact synthetic task', {skip:process.platform!=='linux'}, async t=>{
 const root=await mkdtemp(join(tmpdir(),'syes-')),runtime=await mkdtemp('/tmp/syes-'),repositoryRoot=join(root,'repository'),providerRoot=join(root,'provider'),children:ChildProcess[]=[];
 let launcher:StudioEditorLauncher|undefined,suite:any,server:any,provider:any;
 t.after(async()=>{
  await launcher?.close();if(server){server.closeAllConnections();await new Promise<void>(r=>server.close(()=>r()));}await suite?.close();if(provider)assert.equal((await provider.stop()).stopped,true);
  for(const child of children)assert.equal((await stopOwnedChild(child)).stopped,true);
  assert.deepEqual(await readdir(runtime),[]);await rm(runtime,{recursive:true});await rm(root,{recursive:true});
 });
 await mkdir(repositoryRoot);await mkdir(providerRoot,{mode:0o700});
 await copyFile(new URL('../../../tools/layout-studio/test-support/codex-owned-listener-fixture.cjs',import.meta.url),join(providerRoot,'app-server'));
 await writeFile(join(providerRoot,'account'),'synthetic@example.invalid');await writeFile(join(providerRoot,'fixture.json'),JSON.stringify({config:codexDesignConfig(),repositoryRoot}));
 provider=await openOwnedCodexListener({executable:process.execPath,cwd:providerRoot,runtimeRoot:providerRoot});const control=await provider.connect();
 const keys=new Map<string,string>(),store=createSuiteStore({root:join(root,'state'),secrets:{get:async(c:string,p:string)=>keys.get(c+p),set:async(c:string,p:string,v:string)=>{keys.set(c+p,v);}}});
 await store.initialize('personal');await store.update('personal','synthetic-mode',(s:any)=>{s.mode='personal-companion';});
 const selected={compartment:'personal',ownerRequestId:randomUUID(),loadRequestId:randomUUID()},repo=await lstat(repositoryRoot),target={schema:'switchyard-codex-editor-target/v1',ownerRequestId:selected.ownerRequestId,loadRequestId:selected.loadRequestId,taskId:randomUUID(),sessionId:randomUUID(),repositoryRoot,repositoryIdentity:{device:String(repo.dev),inode:String(repo.ino)},accountFingerprint:provider.accountFingerprint,permissions:'read-only/on-request',endpoint:await provider.inspectBinding()};
 const observe=async()=>{await control.recheckAccount();assert.deepEqual(await provider.inspectBinding(),target.endpoint);return{target:structuredClone(target),targetDigest:createHash('sha256').update(JSON.stringify(target)).digest('hex'),metadataObserved:true,nativeLoadAcknowledged:true,nativeTaskLoaded:false,authorityGranted:false,terminalLaunched:false,ideAttached:false,modelPromptSubmitted:false,completionVerified:false};};
 let bridges=0;
 const owners={editorTarget:observe,editorReturnTarget:observe,openEditorClient:async(_c:string,selection:any,{onClient}:any)=>{assert.equal(selection.ownerRequestId,selected.ownerRequestId);assert.equal(selection.loadRequestId,selected.loadRequestId);bridges++;return provider.openEditorClient({onClient});},stopCompartment:async()=>({stopped:true}),close:async()=>[]};
 suite=createSuite({store,platform:'linux',codingTaskOwners:owners,editorRuntimeRoot:runtime,agents:{discovery:async()=>[],close:async()=>{}},voice:{discovery:async()=>({available:false})}});await suite.handle('/api/suite/bootstrap');
 const token='e'.repeat(43),instance={id:randomUUID(),build:'d'.repeat(64)};server=createStudioServer({suite,token,instance,onApplicationStop:()=>suite.close(),bridge:{close(){}}});server.listen(0,'127.0.0.1');await once(server,'listening');const endpointPath=join(root,'endpoint.json');
 await writeFile(endpointPath,JSON.stringify({schema:'switchyard-active-endpoint/v1',instance,pid:process.pid,url:`http://127.0.0.1:${server.address().port}/#access=${token}`}),{mode:0o600});
 const terminals:TerminalLike[]=[],calls:TerminalOptionsLike[]=[],activeListeners=new Set<(t:TerminalLike|undefined)=>unknown>(),closeListeners=new Set<(t:TerminalLike)=>unknown>();let activeTerminal:TerminalLike|undefined;
 const window={state:{focused:true},terminals,get activeTerminal(){return activeTerminal;},createTerminal(options:TerminalOptionsLike){
  calls.push(options);assert.equal(options.shellPath,process.execPath);const args=options.shellArgs as readonly string[];assert.equal(args[0],'resume');assert.equal(args[1],'--remote');assert.ok(args[2]!.startsWith('unix://'+runtime+'/'));assert.equal(args.at(-1),target.sessionId);
  const child=spawn(process.execPath,[fileURLToPath(new URL('../../../tools/layout-studio/test-support/editor-terminal-fixture.cjs',import.meta.url)),args[2]!.slice(7),target.sessionId,repositoryRoot],{stdio:'ignore'});children.push(child);
  const terminal:TerminalLike={name:options.name,processId:once(child,'spawn').then(()=>child.pid),show(){activeTerminal=terminal;for(const listener of activeListeners)listener(terminal);}};terminals.push(terminal);return terminal;
 },onDidChangeActiveTerminal(listener:(t:TerminalLike|undefined)=>unknown){activeListeners.add(listener);return{dispose(){activeListeners.delete(listener);}};},onDidCloseTerminal(listener:(t:TerminalLike)=>unknown){closeListeners.add(listener);return{dispose(){closeListeners.delete(listener);}};}};
 launcher=new StudioEditorLauncher({client:new StudioTaskClient({endpointPath}),host:{window,workspace:{workspaceFolders:[{uri:{fsPath:repositoryRoot}}]}} as unknown as Pick<VscodeLike,'window'|'workspace'>,executable:process.execPath,assertCurrent:async()=>{assert.equal(await store.selection(),'personal');}});
 const review=await launcher.review(selected),result=await launcher.launch(review);assert.equal(result.protocolAcknowledgementObserved,true);assert.equal(result.nativeProcessObserved,true);assert.equal(result.ideAttached,false);assert.equal(result.modelPromptSubmitted,false);assert.equal(calls.length,1);assert.equal(bridges,1);
 const row=(await store.snapshot('personal')).codingEditorConnections[0];assert.equal(row.status,'acknowledged');assert.equal(row.peer.pid,children[0]!.pid);assert.equal(row.acknowledgement.accountAfterVerified,true);
 await assert.rejects(launcher.launch(review));assert.equal((await launcher.focus(review)).focusVerified,true);assert.equal(calls.length,1);
 assert.equal((await stopOwnedChild(children[0])).stopped,true);
 const deadline=Date.now()+5000;while((await store.snapshot('personal')).codingEditorConnections[0].status!=='stopped'){assert.ok(Date.now()<deadline);await new Promise(r=>setTimeout(r,15));}
 await launcher.close();assert.equal((await store.snapshot('personal')).codingEditorConnections[0].status,'stopped');assert.deepEqual(await readdir(runtime),[]);assert.equal(provider.closed,false);assert.equal(activeListeners.size,0);assert.equal(closeListeners.size,0);
 const providerCalls=await readFile(join(providerRoot,'calls'),'utf8');assert.equal(providerCalls.split('\n').filter(line=>line==='thread/resume').length,1);assert.equal(providerCalls.includes('turn/start'),false);
});
