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
