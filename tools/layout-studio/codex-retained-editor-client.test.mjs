import test from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { PassThrough, Writable } from 'node:stream';
import { CodexClient, codexAccountFingerprint, codexDesignConfig } from './agents.mjs';
import { createRetainedCodexEditorClient } from './codex-retained-editor-client.mjs';
import { createCodexEditorRelay } from './codex-editor-relay.mjs';

const account = { type: 'chatgpt', email: 'retained-editor@example.invalid' };
const target = { sessionId: '11111111-1111-4111-8111-111111111111', repositoryRoot: 'C:\\Reviewed\\repo', accountFingerprint: codexAccountFingerprint(account) };
const gate = () => { let resolve; const promise = new Promise(r => { resolve = r; }); return { resolve, promise }; };
const init = { clientInfo: { name: 'codex_tui', version: '0.166.0' } };
const resume = { threadId: target.sessionId, cwd: target.repositoryRoot, sandbox: 'read-only', approvalPolicy: 'on-request', excludeTurns: true };
async function fixture(t, hooks = {}) {
  const calls = [], replies = [], child = new EventEmitter(), writes = new Set(); let killed = false, allowed = true;
  child.stdout = new PassThrough();
  const respond = value => { if (!killed) child.stdout.write(JSON.stringify(value) + '\n'); };
  child.stdin = new Writable({ write(bytes, _encoding, done) {
    const m = JSON.parse(bytes.toString()); calls.push(m);
    if (m.id !== undefined) {
      const thread = { id: target.sessionId, cwd: target.repositoryRoot, status: { type: 'idle' } };
      const result = m.method === 'initialize' ? { userAgent: m.params.clientInfo.name + '/0.166.0 (synthetic retained fixture)' }
        : m.method === 'config/read' ? { config: codexDesignConfig() } : m.method === 'account/read' ? { account: { ...account } }
        : m.method === 'thread/resume' ? { thread, cwd: target.repositoryRoot, sandbox: { type: 'readOnly' }, approvalPolicy: 'on-request', modelProvider: 'openai' } : { thread };
      const work = Promise.resolve().then(async () => { await hooks.reply?.(m, result); respond({ id: m.id, result }); }).finally(() => writes.delete(work)); writes.add(work);
    }
    done();
  } });
  child.kill = () => { if (killed) return; killed = true; child.emit('close'); child.stdout.destroy(); child.stdin.destroy(); };
  const native = new CodexClient('synthetic.exe', 'C:\\Neutral', [], { spawnProcess: () => child, clientInfo: { name: 'switchyard_tasks', version: '0.1.0' } });
  await native.initialize();
  const channels = [], create = () => { const c = createRetainedCodexEditorClient({ client: native, target, assertCurrent: async () => { assert.equal(allowed,true); await hooks.current?.(); } }); channels.push(c); return c; };
  t.after(async () => { native.close(); for (const c of channels) await c.stop(); await Promise.allSettled([...writes]); });
  return { native, calls, replies, create, notify: respond, permit: value => { allowed = value; }, killed: () => killed,
    async ready() { const c = create(); const hello = await c.request('initialize',init); c.send({method:'initialized',params:{}}); return { c, hello }; } };
}

test('retained editor protocol reuses the exact hello and shares native request IDs without another handshake', async t => {
  const f = await fixture(t), c = f.create(), delivered = [], acknowledged = [];
  const relay = createCodexEditorRelay({client:c,target,platform:'win32',signal:new AbortController().signal,assertCurrent:async()=>{},send:async m=>delivered.push(m),onAcknowledged:async o=>acknowledged.push(o)});
  t.after(()=>relay.stop());
  await relay.receive({id:71,method:'initialize',params:init});
  assert.equal(delivered[0].result.userAgent.startsWith('switchyard_tasks/'),true);
  await relay.receive({method:'initialized',params:{}});
  await Promise.all([f.native.request('thread/read',{threadId:target.sessionId,includeTurns:false}),relay.receive({id:72,method:'thread/resume',params:resume})]);
  assert.equal(acknowledged.length,1); assert.equal(relay.observation().protocolAcknowledged,true);
  assert.equal(f.calls.filter(m=>m.method==='initialize').length,1);assert.equal(f.calls.filter(m=>m.method==='initialized').length,1);
  const ids=f.calls.filter(m=>m.id!==undefined).map(m=>m.id);assert.equal(new Set(ids).size,ids.length);assert.equal(ids.includes(71),false);
  const proof=f.native.initializationEvidence;proof.result.userAgent='substituted';assert.notEqual(f.native.initializationEvidence.result.userAgent,'substituted');
  await relay.stop();assert.deepEqual(await c.stop(),{stopped:true,logicalClientRetired:true,nativeProcessTerminated:false});assert.equal(f.native.closed,false);assert.equal(f.killed(),false);
  assert.equal((await f.native.request('thread/read',{threadId:target.sessionId})).thread.id,target.sessionId);
});

test('closing a retained channel joins its pending RPC and suppresses the late reply without killing the owner', async t => {
  const entered=gate(), release=gate(); const f=await fixture(t,{reply:async m=>{if(m.method==='thread/read'){entered.resolve();await release.promise;}}});const {c}=await f.ready();
  const pending=c.request('thread/read',{threadId:target.sessionId}),refused=assert.rejects(pending);await entered.promise;let stopped=false;const stopping=c.stop().then(()=>{stopped=true;});
  await new Promise(r=>setImmediate(r));assert.equal(stopped,false);assert.equal(f.native.closed,false);release.resolve();await refused;await stopping;
  assert.equal(stopped,true);assert.equal(f.killed(),false);assert.equal(f.native.listenerCount('notification'),0);
});

test('retained configuration reads preserve the selected project and refuse ineffective restrictions', async t => {
  const f = await fixture(t), {c} = await f.ready(), params = { includeLayers: true, cwd: target.repositoryRoot };
  await c.request('config/read', params); assert.deepEqual(f.calls.at(-1).params, params);
  for (const changed of [{ includeLayers: true, cwd: 'C:\\Other' }, { includeLayers: true }, { ...params, extra: false }]) {
    const x = await fixture(t), {c} = await x.ready(), before = x.calls.length;
    await assert.rejects(c.request('config/read', changed)); assert.equal(x.calls.length, before); assert.equal(x.native.closed, false);
  }
  const bad = await fixture(t, { reply: async (m,r) => { if (m.method === 'config/read' && m.params.cwd) r.config.features.hooks = true; } }), channel = await bad.ready();
  await assert.rejects(channel.c.request('config/read', params)); assert.equal(channel.c.closed, true); assert.equal(bad.native.closed, false);
});

test('native bootstrap reuses one retained hello and forwards only reviewed metadata and narrowed resume', async t => {
  const f = await fixture(t, { reply: async (m,r) => {
    if (m.method === 'initialize') r.userAgent = r.userAgent.replace('/0.166.0', '/0.167.0');
    if (m.method === 'model/list') Object.assign(r, { data: [{ id: 'synthetic', model: 'synthetic' }], nextCursor: null });
    if (m.method === 'configRequirements/read') r.requirements = null;
  } }), c = f.create(), delivered = [], acknowledged = [];
  const relay = createCodexEditorRelay({client:c,target,platform:'win32',signal:new AbortController().signal,assertCurrent:async()=>{},send:async m=>delivered.push(m),onAcknowledged:async o=>acknowledged.push(o)});
  t.after(() => relay.stop());
  await relay.receive({ id: 'init', method: 'initialize', params: { clientInfo: { name: 'codex-tui', title: null, version: '0.167.0' }, capabilities: { requiredHumanApproval: true, experimentalApi: true, requestAttestation: false, optOutNotificationMethods: null } } });
  await relay.receive({ method: 'initialized' });
  await relay.receive({ id: 'config', method: 'config/read', params: { includeLayers: true, cwd: target.repositoryRoot } });
  await relay.receive({ id: 'models', method: 'model/list', params: { cursor: null, limit: null, includeHidden: true } });
  await relay.receive({ id: 'requirements', method: 'configRequirements/read' });
  assert.equal(f.calls.at(-2).params, null); assert.equal(f.calls.at(-2).method, 'configRequirements/read');
  const nulls = Object.fromEntries(['history','path','model','modelProvider','runtimeWorkspaceRoots','approvalPolicy','approvalsReviewer','sandbox','permissions','config','baseInstructions','developerInstructions','personality','initialTurnsPage'].map(k => [k,null]));
  await relay.receive({ id: 'resume', method: 'thread/resume', params: { ...nulls, threadId: target.sessionId, cwd: target.repositoryRoot, excludeTurns: true } });
  assert.deepEqual(f.calls.find(m => m.method === 'thread/resume').params, resume);
  assert.equal(acknowledged.length, 1); assert.equal(relay.observation().protocolAcknowledged, true);
  const count = f.calls.length;
  await relay.receive({ id: 'skills', method: 'skills/list', params: { cwds: [target.repositoryRoot], forceReload: true } });
  assert.equal(delivered.at(-1).error.code, -32601); assert.equal(f.calls.length, count);
  assert.equal(relay.observation().protocolAcknowledged, true);
  assert.equal(f.calls.filter(m => m.method === 'initialize').length, 1); assert.equal(f.calls.filter(m => m.method === 'initialized').length, 1);
});

test('retained bootstrap refuses expanded parameters and unreviewed native metadata versions before dispatch', async t => {
  for (const [method,params,version] of [
    ['model/list', { cursor: null, limit: null, includeHidden: true }, '0.166.0'],
    ['model/list', { cursor: 'another-page', limit: null, includeHidden: true }, '0.167.0'],
    ['model/list', { cursor: null, limit: 1000, includeHidden: true }, '0.167.0'],
    ['configRequirements/read', {}, '0.167.0']
  ]) {
    const f = await fixture(t, { reply: async (m,r) => { if (m.method === 'initialize') r.userAgent = r.userAgent.replace('/0.166.0', '/'+version); } }), {c} = await f.ready(), before = f.calls.length;
    await assert.rejects(c.request(method,params)); assert.equal(f.calls.length,before); assert.equal(f.native.closed,false);
  }
});
test('native paginated history crosses the retained Windows channel without another native handshake or resume', async t => {
  const page = { data: [{ turnId: 'saved-turn', item: { id: 'saved-item', type: 'agentMessage', text: 'Original saved reply' } }], nextCursor: 'older-items', backwardsCursor: null };
  const f = await fixture(t, { reply: (m,r) => {
    if (m.method === 'initialize') r.userAgent = r.userAgent.replace('/0.166.0', '/0.167.0');
    if (m.method === 'thread/resume') r.thread.historyMode = 'paginated';
    if (m.method === 'thread/items/list') { delete r.thread; Object.assign(r, page); }
  } }), c = f.create(), delivered = [];
  const relay = createCodexEditorRelay({ client: c, target, platform: 'win32', signal: new AbortController().signal, assertCurrent: async () => {}, send: async m => delivered.push(m), onAcknowledged: async () => {} });
  t.after(() => relay.stop());
  await relay.receive({ id: 'init', method: 'initialize', params: { clientInfo: { name: 'codex-tui', title: null, version: '0.167.0' }, capabilities: { requiredHumanApproval: true, experimentalApi: true, requestAttestation: false, optOutNotificationMethods: null } } });
  await relay.receive({ method: 'initialized' }); await relay.receive({ id: 'resume', method: 'thread/resume', params: resume });
  const params = { threadId: target.sessionId, turnId: null, cursor: null, limit: 100, sortDirection: 'desc' };
  await relay.receive({ id: 'items', method: 'thread/items/list', params });
  assert.deepEqual(delivered.at(-1).result, page);
  await relay.receive({ id: 'older', method: 'thread/items/list', params: { ...params, cursor: 'older-items' } });
  assert.equal(f.calls.filter(m => m.method === 'initialize').length, 1); assert.equal(f.calls.filter(m => m.method === 'thread/resume').length, 1);
  assert.deepEqual(f.calls.slice(-3).map(m => m.method), ['account/read','thread/items/list','account/read']);
  assert.equal(relay.observation().protocolAcknowledged, true);
  await relay.stop(); assert.equal(f.native.closed, false); assert.equal(f.killed(), false);
});
test('the retained history boundary rejects foreign cursors, malformed replies and unsupported versions without retiring its owner', async t => {
  const params = { threadId: target.sessionId, turnId: null, cursor: null, limit: 100, sortDirection: 'desc' };
  for (const mode of ['early','legacy','version','cursor','limit','thread','reply']) {
    const f = await fixture(t, { reply: (m,r) => {
      if (m.method === 'initialize' && mode !== 'version') r.userAgent = r.userAgent.replace('/0.166.0', '/0.167.0');
      if (m.method === 'thread/resume' && mode !== 'legacy') r.thread.historyMode = 'paginated';
      if (m.method === 'thread/items/list') { delete r.thread; Object.assign(r, { data: [{ turnId: 'saved', item: { id: 'item', type: 'agentMessage', threadId: 'foreign' } }], nextCursor: null, backwardsCursor: null }); }
    } }), { c } = await f.ready();
    if (mode !== 'early') await c.request('thread/resume', resume);
    const input = { ...params, ...(mode === 'cursor' ? { cursor: 'unseen' } : mode === 'limit' ? { limit: 101 } : mode === 'thread' ? { threadId: 'other' } : {}) }, before = f.calls.length;
    await assert.rejects(c.request('thread/items/list', input)); assert.equal(f.calls.length, before + (mode === 'reply' ? 1 : 0));
    assert.equal(c.closed, true); assert.equal(f.native.closed, false); assert.equal(f.killed(), false);
  }
});

test('retained channel rejects other tasks, effects, initialization replay and a second resume before native dispatch', async t => {
  for(const [method,params] of [['turn/start',{}],['account/logout',{}],['thread/read',{threadId:'other'}],['thread/resume',{...resume,sandbox:'workspace-write'}],['initialize',init]]) {
    const f=await fixture(t),{c}=await f.ready(),count=f.calls.length;await assert.rejects(c.request(method,params));assert.equal(f.calls.length,count);assert.equal(f.native.closed,false);
  }
  const f=await fixture(t),{c}=await f.ready();await c.request('thread/resume',resume);await assert.rejects(c.request('thread/resume',resume));assert.equal(f.calls.filter(m=>m.method==='thread/resume').length,1);
});

test('native account boundaries synchronously revoke logical channels and conflicting account replies close the owner', async t => {
  const f=await fixture(t),{c}=await f.ready();f.notify({method:'account/updated',params:{}});assert.equal(f.native.closed,true);assert.equal(c.closed,true);assert.equal(f.native.initializationEvidence,null);
  let changed=false;const g=await fixture(t,{reply:(_m,result)=>{if(changed&&result.account)result.account.email='changed@example.invalid';}}),ready=await g.ready();changed=true;
  await assert.rejects(ready.c.request('account/read',{refreshToken:false}));assert.equal(g.native.closed,true);assert.equal(ready.c.closed,true);
});

test('permission withdrawal prevents native dispatch and foreign notifications never enter the selected channel', async t => {
  const f=await fixture(t),{c}=await f.ready(),seen=[];c.on('notification',m=>seen.push(m));
  f.notify({method:'thread/status/changed',params:{threadId:'other',status:{type:'active'}}});assert.equal(seen.length,0);
  f.notify({method:'thread/status/changed',params:{threadId:target.sessionId,status:{type:'active'}}});assert.equal(seen.length,1);
  f.permit(false);const count=f.calls.length;await assert.rejects(c.request('thread/read',{threadId:target.sessionId}));assert.equal(f.calls.length,count);assert.equal(f.native.closed,false);
});

test('retained channels enforce an aggregate request bound and retire all admitted operations', async t => {
  const entered=gate(),release=gate();let held=false;const f=await fixture(t,{current:async()=>{if(held){entered.resolve();await release.promise;}}}),{c}=await f.ready();held=true;
  const count=f.calls.length,requests=Array.from({length:64},()=>assert.rejects(c.request('thread/read',{threadId:target.sessionId})));await entered.promise;
  await assert.rejects(c.request('thread/read',{threadId:target.sessionId}));release.resolve();await Promise.all(requests);assert.equal((await c.stop()).logicalClientRetired,true);assert.equal(f.calls.length,count);
});
