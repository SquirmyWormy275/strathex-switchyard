import test from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { randomUUID, createHash } from 'node:crypto';
import { mkdtemp, mkdir, rm, realpath, writeFile, readFile, copyFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { CodexClient, codexAccountFingerprint, codexDesignConfig, codexRestrictedProcessArguments } from './agents.mjs';
import { openWindowsCodexOwner, retireStoppedWindowsCodexOwner } from './codex-windows-owner.mjs';
import { openWindowsOwnedStdio } from './windows-owned-stdio.mjs';
import { createCodexWindowsTasks } from './codex-windows-tasks.mjs';
import { createCodingTaskOwners } from './coding-task-owners.mjs';
import { createSuiteStore } from './suite-store.mjs';
import { repositoryIdentity } from './coding-task-identity.mjs';
import { createWindowsTerminalProcessProbe } from './windows-terminal-process.mjs';
import { windowsCodexBinding } from './windows-codex-binding.mjs';
import { stopOwnedChild } from './owned-process.mjs';

const account = { type: 'chatgpt', email: 'windows-fixture@example.invalid' }, fingerprint = codexAccountFingerprint(account);
const gate = () => { let resolve; const promise = new Promise(r => { resolve = r; }); return { promise, resolve }; };
async function fixture(t, hooks = {}) {
  const root = await realpath(await mkdtemp(join(tmpdir(), 'sywt-'))), repositoryRoot = join(root,'repo'), executable = await realpath(process.execPath); await mkdir(repositoryRoot);
  const calls = [], owners = [], transports = [], clients = [], keys = new Map(); let allowed = true;
  const controls = { fingerprint, stopped: true, expectUncertain: false, observation: 'idle', config: { ...codexDesignConfig(), mcp_servers: { synthetic: { enabled: true } } } };
  const store = createSuiteStore({ root: join(root,'state'), secrets: { get: async (c,p) => keys.get(c+p), set: async (c,p,v) => keys.set(c+p,v) } });
  await store.initialize('personal'); await store.update('personal','fixture-mode',s => { s.mode = 'personal-companion'; });
  const authorize = store.authorize.bind(store); store.authorize = async (...args) => { if (!allowed) throw Error('permission withdrawn'); return authorize(...args); };
  const openOwner = options => openWindowsCodexOwner({ ...options, platform: 'win32',
    probeFactory: () => ({
      inspect: async (input,context) => {
        calls.push('process-inspect');await context.assertCurrent();await hooks.inspect?.(input);await context.assertCurrent();
        return {processId:input.processId,birth:input.expectedBirth,image:{...input.image},currentUserVerified:true,currentSessionVerified:true,processAccessMask:0x101000,tokenAccessMask:8,
          processTerminated:false,windowFocused:false,taskAttached:false,accountVerified:false};
      },close:async()=>{calls.push('probe-stop');await hooks.probeStop?.();return{stoppedVerified:true};}
    }),
    onOwner: async owner => { owners.push(owner); calls.push('owner-retained'); await options.onOwner(owner); },
    openStdio: async input => {
      assert.equal(input.executable, executable); assert.deepEqual(input.args, codexRestrictedProcessArguments(executable, options.serverNames));
      const id = randomUUID(); const transport = { closed: false, child: { exact: true }, scope: null, worker: null,
        privateOwnership: { schema: 'switchyard-windows-owned-stdio-owner/v1', requestId: id, executable, executableSha256: input.expectedExecutableSha256, cwd: input.cwd, helper: null, worker: null },
        close() { this.closed = true; }, async stop() { calls.push('job-stop'); this.close(); return { stopped: controls.stopped }; } };
      transports.push(transport); await input.onOwner(transport); await input.assertCurrent();
      transport.scope = { schema: 'switchyard-runtime-command/v1', id, guardianPid: 200 + transports.length, birth: '638000000000000001', containment: 'windows-job' };
      await input.onReady(transport.scope); await input.assertCurrent();
      transport.worker = { pid: 400 + transports.length, birth: '133000000000000001', executableSha256: input.expectedExecutableSha256 }; transport.privateOwnership.worker = transport.worker;
      await input.onWorker(transport.worker); await input.assertCurrent(); calls.push('worker-running'); return transport;
    },
    createClient: (_exe,_cwd,names, clientOptions) => {
      assert.equal(clientOptions.spawnProcess(), transports.at(-1).child); const client = new EventEmitter(); clients.push(client);
      client.closed = false; client.accountEpoch = 0; client.serverNames = names;
      client.close = () => { if (client.closed) return; client.closed = true; client.emit('disconnected'); };
      client.handshake = async () => { calls.push('configuration'); await hooks.configuration?.(); return controls.config; };
      client.initialize = async () => { calls.push('initialize'); await hooks.initialize?.(); client.restrictionsVerified = true; client.accountFingerprint = controls.fingerprint; };
      Object.defineProperty(client,'initializationEvidence',{get:()=>client.restrictionsVerified && !client.closed ? {clientName:'switchyard_tasks',result:{userAgent:'switchyard_tasks/0.166.0 (synthetic fixture)'}} : null});
      client.recheckAccount = async () => { if (client.closed || client.accountFingerprint !== controls.fingerprint) { client.close(); throw Error('account changed'); } return client.accountFingerprint; };
      client.request = async (method,params) => {
        calls.push(method); assert.equal(client.closed,false); await hooks.request?.(method,params);
        if (method === 'config/read') return { config: { ...codexDesignConfig(names), mcp_servers: Object.fromEntries(names.map(n => [n,{ enabled: false }])) } };
        const thread = { id: '11111111-1111-4111-8111-111111111111', cwd: repositoryRoot, status: { type: controls.observation } };
        if (method === 'thread/list') return { data: [thread] };
        if (method === 'thread/read') return { thread };
        if (method === 'thread/resume') return { thread, cwd: repositoryRoot, sandbox: { type: 'readOnly' }, approvalPolicy: 'on-request' };
        throw Error('No model, login or task creation in this fixture');
      }; return client;
    }
  });
  const driverOptions = { store, root: join(root,'tasks'), resolveCli: async () => executable, openOwner, onReserved: async () => { calls.push('reserved'); await hooks.reserved?.(); },
    onReady: async () => { calls.push('ready'); await hooks.ready?.(); }, onListening: async () => { calls.push('listening'); }, onAuthenticated: async () => { calls.push('authenticated'); } };
  const driver = createCodexWindowsTasks(driverOptions);
  const services = [];
  t.after(async () => { allowed = true; controls.stopped = true; for (const service of services) await service.close();
    try { await driver.close(); } catch (error) { if (!controls.expectUncertain || !transports.every(t=>t.closed) || !clients.every(c=>c.closed)) throw error; }
    for (const owner of owners) {
    try { const result = await owner.stop(); assert.ok(result.stopped || controls.expectUncertain && owner.closed); }
    catch (error) { if (!controls.expectUncertain || !owner.closed) throw error; }
  } await rm(root,{ recursive: true }); });
  return { root, repositoryRoot, store, executable, driver, driverOptions, openOwner, calls, owners, transports, clients, controls, services, permit: value => { allowed = value; } };
}

test('Windows configuration and exact task metadata use separately retired owned Jobs in order', async t => {
  const f = await fixture(t); assert.equal((await f.driver.account('personal')).fingerprint, fingerprint);
  assert.equal(f.owners.length, 2); assert.equal(f.transports[0].closed, true); assert.equal(f.transports[1].closed, false);
  assert.ok(f.calls.indexOf('job-stop') < f.calls.indexOf('reserved')); assert.ok(f.calls.indexOf('ready') < f.calls.lastIndexOf('worker-running'));
  assert.ok(f.calls.indexOf('listening') < f.calls.indexOf('initialize')); assert.ok(f.calls.indexOf('initialize') < f.calls.indexOf('authenticated'));
  assert.deepEqual(await f.driver.list('personal'), [{ id: '11111111-1111-4111-8111-111111111111', observation: 'idle' }]);
  const result = await f.driver.resume('11111111-1111-4111-8111-111111111111', f.repositoryRoot, 'personal'); assert.equal(result.modelPromptSubmitted, false);
  assert.equal(f.calls.includes('turn/start'), false); const owner = f.owners[1]; assert.equal(owner.binding.schema, 'switchyard-windows-codex-stdio-binding/v1');
  assert.equal((await f.driver.stopCompartment('personal')).stopped, true); assert.equal(owner.binding, null);
});

test('a failed configuration Job retirement blocks the task owner without a replacement', async t => {
  const f = await fixture(t); f.controls.stopped = false; f.controls.expectUncertain = true;
  try { await assert.rejects(f.driver.account('personal')); await assert.rejects(f.driver.account('personal')); assert.equal(f.owners.length, 1); assert.equal(f.calls.includes('reserved'), false); }
  finally { f.controls.stopped = true; }
});

test('permission withdrawal during configuration joins that probe and prevents task startup', async t => {
  const entered = gate(), release = gate(), f = await fixture(t, { configuration: async () => { entered.resolve(); await release.promise; } });
  const pending = f.driver.account('personal'), refused = assert.rejects(pending); await entered.promise; f.permit(false);
  let stopped = false; const stopping = f.driver.stopCompartment('personal').then(() => { stopped = true; }); await new Promise(r => setImmediate(r)); assert.equal(stopped,false);
  release.resolve(); await refused; await stopping; assert.equal(f.owners.length,1); assert.equal(f.calls.includes('reserved'),false);
});

test('an account boundary withdraws the exact owned task binding and closes its Job', async t => {
  const f = await fixture(t); await f.driver.account('personal'); const owner = f.owners[1]; f.controls.fingerprint = 'b'.repeat(64);
  await assert.rejects(f.driver.account('personal')); assert.equal(owner.closed,true); assert.equal(owner.binding,null); assert.equal(f.owners.length,2);
});

test('provider startup refuses an adopted repository or project configuration in its neutral directory', async t => {
  const f = await fixture(t), cwd = join(f.root,'neutral'); await mkdir(cwd); await writeFile(join(cwd,'AGENTS.md'),'synthetic project instructions');
  let retained = false; await assert.rejects(f.openOwner({ executable:f.executable,cwd,serverNames:[],authorize:async()=>{},onOwner:async()=>{retained=true;},onReady:async()=>{} }), /neutral/);
  assert.equal(retained,false); assert.equal(f.transports.length,0);
});

test('the original Windows task owner retains one logical editor and joins registration during shutdown', async t => {
  const f=await fixture(t);await f.driver.account('personal');const owner=f.owners[1],entered=gate(),release=gate();let editor;
  const target={sessionId:'11111111-1111-4111-8111-111111111111',repositoryRoot:'C:\\Reviewed\\repo',accountFingerprint:fingerprint};
  const opening=owner.openEditorClient({target,onClient:async value=>{editor=value;entered.resolve();await release.promise;}}),refused=assert.rejects(opening);
  await entered.promise;assert.throws(()=>owner.openEditorClient({target,onClient:async()=>{}}));let stopped=false;const stopping=owner.stop().then(()=>{stopped=true;});
  await new Promise(r=>setImmediate(r));assert.equal(stopped,false);assert.equal(editor.closed,true);release.resolve();await refused;await stopping;
  assert.equal(f.owners.length,2);assert.equal(f.calls.filter(v=>v==='initialize').length,1);assert.equal((await editor.stop()).logicalClientRetired,true);
});

test('Windows binding metadata refuses substituted coordinates, extra fields and process/guardian confusion', () => {
  const value={schema:'switchyard-windows-codex-stdio-binding/v1',scope:{schema:'switchyard-runtime-command/v1',id:randomUUID(),guardianPid:200,birth:'638000000000000001',containment:'windows-job'},peerPid:400,peerBirth:'133000000000000001',peerExecutableSha256:'a'.repeat(64)};
  assert.deepEqual(windowsCodexBinding(value),value);const copied=windowsCodexBinding(value);copied.scope.id=randomUUID();assert.notEqual(copied.scope.id,value.scope.id);
  for(const patch of [{schema:'foreign'},{peerPid:200},{peerPid:0},{peerPid:0x80000000},{peerBirth:'0'},{peerBirth:'18446744073709551616'},{peerExecutableSha256:'A'.repeat(64)},{token:'never-retain'},{scope:{...value.scope,containment:'owned-linux-session'}},{scope:{...value.scope,id:'00000000-0000-0000-0000-000000000000'}},{scope:{...value.scope,extra:true}}])assert.throws(()=>windowsCodexBinding({...value,...patch}));
  for(const field of Object.keys(value)){const copy={...value};delete copy[field];assert.throws(()=>windowsCodexBinding(copy));}
});

test('Windows binding inspection joins one original query and refuses changed process evidence', async t => {
  const entered=gate(),release=gate();let hold=true;
  const f=await fixture(t,{inspect:async input=>{if(hold){entered.resolve();await release.promise;}else input.expectedBirth='1';}});await f.driver.account('personal');const owner=f.owners[1];
  const first=owner.inspectBinding();await entered.promise;const second=owner.inspectBinding();assert.equal(first,second);release.resolve();assert.deepEqual(await first,owner.binding);assert.equal(f.calls.filter(v=>v==='process-inspect').length,1);
  hold=false;await assert.rejects(owner.inspectBinding());assert.equal(owner.closed,true);assert.equal((await owner.stop()).stopped,true);assert.equal(f.calls.includes('probe-stop'),true);
});

test('Windows shutdown waits for held process inspection and still retires the original task Job', async t => {
  const entered=gate(),release=gate(),f=await fixture(t,{inspect:async()=>{entered.resolve();await release.promise;}});await f.driver.account('personal');const owner=f.owners[1];
  const inspection=owner.inspectBinding(),refused=assert.rejects(inspection);await entered.promise;let stopped=false;const stopping=owner.stop().then(()=>{stopped=true;});await new Promise(r=>setImmediate(r));assert.equal(stopped,false);
  release.resolve();await refused;await stopping;assert.equal(f.calls.includes('probe-stop'),true);assert.equal(f.transports.every(t=>t.closed),true);
});

test('uncertain query-helper retirement cannot skip the original Windows Job stop or claim success', async t => {
  const f=await fixture(t,{probeStop:async()=>{throw Error('synthetic query helper exit unconfirmed');}});f.controls.expectUncertain=true;
  await f.driver.account('personal');const owner=f.owners[1];await owner.inspectBinding();const before=f.calls.filter(v=>v==='job-stop').length;
  await assert.rejects(owner.stop());assert.equal(f.calls.filter(v=>v==='job-stop').length,before+1);assert.equal(f.transports.every(t=>t.closed),true);assert.equal(owner.binding,null);
});

test('the protected Windows registry requires the original one-use load review and preserves metadata-only observations', async t => {
  const f = await fixture(t), task = { schema:'switchyard-coding-session/v1',launchPolicy:'read-only/on-request',nativeTransport:'owned-stdio',id:randomUUID(),provider:'codex',status:'registered',sessionId:'11111111-1111-4111-8111-111111111111',accountFingerprint:fingerprint,repositoryRoot:f.repositoryRoot,repositoryIdentity:await repositoryIdentity(f.repositoryRoot) };
  await f.store.update('personal','fixture-task',s=>{s.codingSessions=[task];});
  const service = createCodingTaskOwners({store:f.store,platform:'win32',root:join(f.root,'registry'),resolveCli:async()=>f.executable,driverFactory:options=>createCodexWindowsTasks({...options,openOwner:f.openOwner})});f.services.push(service);
  const request={requestId:randomUUID(),taskId:task.id};assert.equal((await service.open('personal',request)).status,'bound');assert.equal((await service.read('personal',request.requestId)).observation,'idle');
  await assert.rejects(service.load('personal',{ownerRequestId:request.requestId,requestId:randomUUID(),token:randomUUID()}));
  const review=await service.reviewLoad('personal',request.requestId), load={ownerRequestId:request.requestId,requestId:randomUUID(),token:review.confirmation.token};
  assert.equal((await service.load('personal',load)).nativeLoadAcknowledged,true);assert.equal((await service.load('personal',load)).duplicatePrevented,true);assert.equal(f.calls.filter(v=>v==='thread/resume').length,1);
  const selection={ownerRequestId:request.requestId,loadRequestId:load.requestId},before=f.calls.filter(v=>v==='thread/resume').length;
  const target=await service.editorTarget('personal',selection);assert.deepEqual(windowsCodexBinding(target.target.endpoint),f.owners[1].binding);assert.equal(target.nativeLoadAcknowledged,true);
  for(const key of ['nativeTaskLoaded','authorityGranted','terminalLaunched','ideAttached','modelPromptSubmitted','completionVerified'])assert.equal(target[key],false);
  assert.equal(f.calls.filter(v=>v==='thread/resume').length,before);assert.ok(f.calls.filter(v=>v==='process-inspect').length>=2);
  await assert.rejects(service.editorTarget('personal',{...selection,loadRequestId:randomUUID()}));f.controls.observation='active';await assert.rejects(service.editorTarget('personal',selection));assert.equal((await service.editorReturnTarget('personal',selection)).targetDigest,target.targetDigest);f.controls.observation='idle';
  await f.store.update('personal','fixture-load-drift',s=>{s.codingTaskLoads[0].acknowledgedThreadId=randomUUID();});await assert.rejects(service.editorTarget('personal',selection));
  const row=(await f.store.snapshot('personal')).codingTaskOwners[0];assert.equal(row.scope.containment,'windows-job');assert.equal((await service.stop('personal',request.requestId)).stopped,true);
});

test('a refused Windows transport checkpoint can retire the original Job from its earlier saved identities', async t => {
  const f = await fixture(t), task = { schema:'switchyard-coding-session/v1',launchPolicy:'read-only/on-request',nativeTransport:'owned-stdio',id:randomUUID(),provider:'codex',status:'registered',sessionId:'11111111-1111-4111-8111-111111111111',accountFingerprint:fingerprint,repositoryRoot:f.repositoryRoot,repositoryIdentity:await repositoryIdentity(f.repositoryRoot) };
  await f.store.update('personal','fixture-task',s=>{s.codingSessions=[task];});
  const service=createCodingTaskOwners({store:f.store,platform:'win32',root:join(f.root,'registry-failed'),resolveCli:async()=>f.executable,
    driverFactory:options=>createCodexWindowsTasks({...options,openOwner:f.openOwner,onListening:async()=>{throw Error('transport checkpoint refused');}})});f.services.push(service);
  await assert.rejects(service.open('personal',{requestId:randomUUID(),taskId:task.id}), /checkpoint refused/);
  const row=(await f.store.snapshot('personal')).codingTaskOwners[0];assert.equal(row.status,'stopped');assert.equal(row.stoppedVerified,true);
  assert.equal(f.transports.every(t=>t.closed),true);assert.equal(f.calls.includes('initialize'),false);
});

test('the synthetic native provider answers restricted RPC under CommonJS and module package parents', async t => {
  const root=await realpath(await mkdtemp(join(tmpdir(),'sywm-'))),executable=await realpath(process.execPath),sessionId='11111111-1111-4111-8111-111111111111';
  t.after(()=>rm(root,{recursive:true}));
  for(const type of ['commonjs','module']){
    const parent=join(root,type),cwd=join(parent,'neutral');await mkdir(cwd,{recursive:true});
    await writeFile(join(parent,'package.json'),JSON.stringify({type}));
    await copyFile(new URL('./test-support/codex-windows-stdio-fixture.cjs',import.meta.url),join(cwd,'app-server'));
    await writeFile(join(cwd,'fixture.json'),JSON.stringify({sessionId,repositoryRoot:cwd,account,config:codexDesignConfig()}));
    const client=new CodexClient(executable,cwd,[],{clientInfo:{name:'switchyard_tasks',title:'Synthetic task fixture',version:'0.1.0'}});
    try{
      await assert.doesNotReject(()=>client.initialize(),`restricted RPC under a ${type} package parent`);assert.equal(client.restrictionsVerified,true);assert.equal(client.accountFingerprint,fingerprint);
      assert.equal((await client.request('thread/read',{threadId:sessionId,includeTurns:false})).thread.id,sessionId);
      const calls=(await readFile(join(cwd,'calls'),'utf8')).trim().split('\n');assert(calls.includes('initialize'));assert(calls.includes('config/read'));assert(!calls.includes('turn/start'));assert(!calls.includes('thread/resume'));
    }finally{client.close();assert.equal((await stopOwnedChild(client.child)).stopped,true);}
  }
});

test('actual Windows Jobs carry restricted task RPC and recover original retirement with a synthetic provider', { skip: process.platform !== 'win32' }, async t => {
  const root=await realpath(await mkdtemp(join(tmpdir(),'sywn-'))),repositoryRoot=join(root,'repo');await mkdir(repositoryRoot);
  const executable=await realpath(process.execPath),helper=resolve('runtime/hotkeys/Switchyard.Hotkeys.exe'),helperSha=createHash('sha256').update(await readFile(helper)).digest('hex'),owners=[];
  const sessionId='11111111-1111-4111-8111-111111111111';
  const openOwner=async input=>{
      await copyFile(new URL('./test-support/codex-windows-stdio-fixture.cjs',import.meta.url),join(input.cwd,'app-server'));
      await writeFile(join(input.cwd,'fixture.json'),JSON.stringify({sessionId,repositoryRoot,account,config:codexDesignConfig()}));
      return openWindowsCodexOwner({...input,onOwner:async owner=>{owners.push(owner);await input.onOwner(owner);},
        probeFactory:()=>createWindowsTerminalProcessProbe({helper:async()=>({path:helper,sha256:helperSha})}),
        openStdio:options=>openWindowsOwnedStdio({...options,helper:async()=>({path:helper,sha256:helperSha})})});
    };
  const driver=createCodexWindowsTasks({root:join(root,'tasks'),store:{authorize:async()=>{}},resolveCli:async()=>executable,openOwner});let registry;
  t.after(async()=>{if(registry)assert.ok((await registry.close()).every(r=>r.stopped));assert.ok((await driver.close()).every(r=>r.stopped));for(const owner of owners)assert.equal((await owner.stop()).stopped,true);await rm(root,{recursive:true});});
  assert.equal((await driver.account('personal')).fingerprint,fingerprint);assert.equal(owners.length,2);assert.equal(owners[0].closed,true);
  assert.equal((await driver.read(sessionId,repositoryRoot,'personal')).id,sessionId);assert.equal((await driver.resume(sessionId,repositoryRoot,'personal')).modelPromptSubmitted,false);
  const original=owners[1],scope=original.scope,ownership=original.privateOwnership;assert.equal(scope.containment,'windows-job');assert.equal(original.binding.peerBirth,ownership.worker.birth);
  assert.deepEqual(await original.inspectBinding(),original.binding);
  let retained;const editor=await original.openEditorClient({target:{sessionId,repositoryRoot,accountFingerprint:fingerprint},onClient:async value=>{retained=value;}});assert.equal(editor,retained);
  const hello=await editor.request('initialize',{clientInfo:{name:'codex_tui',version:'0.166.0'}});assert.match(hello.userAgent,/^switchyard_tasks\/0\.166\.0 /);editor.send({method:'initialized',params:{}});
  assert.equal((await editor.request('thread/read',{threadId:sessionId,includeTurns:false})).thread.id,sessionId);assert.equal((await editor.stop()).nativeProcessTerminated,false);assert.equal(original.closed,false);
  assert.equal((await driver.read(sessionId,repositoryRoot,'personal')).id,sessionId);
  assert.equal((await driver.stopCompartment('personal')).stopped,true);assert.equal((await retireStoppedWindowsCodexOwner(scope,ownership)).guardianExitVerified,true);
  const calls=(await readFile(join(root,'tasks/personal/calls'),'utf8')).trim().split('\n');assert.equal(calls.filter(v=>v==='initialize').length,2);assert.equal(calls.filter(v=>v==='thread/resume').length,1);assert.equal(calls.includes('turn/start'),false);
  const keys=new Map(),store=createSuiteStore({root:join(root,'state'),secrets:{get:async(c,p)=>keys.get(c+p),set:async(c,p,v)=>keys.set(c+p,v)}});
  const task={schema:'switchyard-coding-session/v1',launchPolicy:'read-only/on-request',nativeTransport:'owned-stdio',id:randomUUID(),provider:'codex',status:'registered',sessionId,accountFingerprint:fingerprint,repositoryRoot,repositoryIdentity:await repositoryIdentity(repositoryRoot)};
  await store.initialize('personal');await store.update('personal','fixture-native-task',s=>{s.mode='personal-companion';s.codingSessions=[task];});
  registry=createCodingTaskOwners({store,platform:'win32',root:join(root,'registry'),resolveCli:async()=>executable,driverFactory:options=>createCodexWindowsTasks({...options,openOwner})});
  const ownerRequestId=randomUUID();await registry.open('personal',{requestId:ownerRequestId,taskId:task.id});const review=await registry.reviewLoad('personal',ownerRequestId),loadRequestId=randomUUID();
  await registry.load('personal',{ownerRequestId,requestId:loadRequestId,token:review.confirmation.token});const selected={ownerRequestId,loadRequestId},observed=await registry.editorTarget('personal',selected);
  assert.equal(observed.nativeLoadAcknowledged,true);assert.equal(observed.authorityGranted,false);assert.equal(observed.target.endpoint.scope.containment,'windows-job');assert.equal(observed.target.repositoryRoot,repositoryRoot);
  const registeredEditor=await registry.openEditorClient('personal',selected,{onClient:async()=>{}});assert.equal((await registeredEditor.stop()).nativeProcessTerminated,false);
  assert.equal((await registry.read('personal',ownerRequestId)).observation,'idle');assert.equal((await registry.stop('personal',ownerRequestId)).stopped,true);
});
