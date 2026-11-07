import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { connect } from 'node:net';
import { EventEmitter, once } from 'node:events';
import { codexAccountFingerprint, codexDesignConfig } from './agents.mjs';
import { editorServerFrame } from './editor-websocket-frames.mjs';
import { openWindowsCodexEditorConnection } from './windows-codex-editor-connection.mjs';
import { createRetainedCodexEditorClient } from './codex-retained-editor-client.mjs';

const gate = () => { let resolve; const promise = new Promise(r => { resolve = r; }); return { promise, resolve }; };
const account = { type: 'chatgpt', email: 'synthetic-editor@example.invalid' };
const target = { sessionId: '11111111-1111-4111-8111-111111111111', repositoryRoot: 'C:\\Reviewed Projects\\repository', accountFingerprint: codexAccountFingerprint(account) };
const peer = { processId: 321, expectedBirth: '133000000000000001', image: { path: 'C:\\Reviewed\\codex.exe', sha256: 'a'.repeat(64), device: '0', inode: '1', size: '512' } };
const initialize = { id: 1, method: 'initialize', params: { clientInfo: { name: 'codex_tui', version: '0.166.0' } } };
const resume = () => ({ id: 2, method: 'thread/resume', params: { threadId: target.sessionId, cwd: target.repositoryRoot, sandbox: 'read-only', approvalPolicy: 'on-request', excludeTurns: true } });
function frame(message) {
  const bytes = Buffer.from(JSON.stringify(message)), wire = editorServerFrame(1, bytes), n = wire.length - bytes.length;
  const header = Buffer.from(wire.subarray(0, n)), mask = Buffer.from([1,3,5,7]); header[1] |= 128;
  for (let i = 0; i < bytes.length; i++) bytes[i] ^= mask[i % 4]; return Buffer.concat([header, mask, bytes]);
}
async function terminal(t, owner) {
  const endpoint = owner.privateEndpoint, url = new URL(endpoint.url), socket = connect({ host: '127.0.0.1', port: Number(url.port) });
  let bytes = Buffer.alloc(0), changed = gate(), ended = false; const endedGate = gate();
  socket.on('data', b => { bytes = Buffer.concat([bytes, b]); assert.ok(bytes.length <= 2097152); changed.resolve(); });
  socket.on('error', () => {}); socket.on('close', () => { ended = true; changed.resolve(); endedGate.resolve(); });
  t.after(() => socket.destroy()); await once(socket, 'connect', { signal: AbortSignal.timeout(5000) });
  const wait = async () => { assert.equal(ended, false); let timer; try { await Promise.race([changed.promise, new Promise((_, reject) => { timer = setTimeout(() => reject(Error('bounded socket read')), 5000); })]); } finally { clearTimeout(timer); } changed = gate(); };
  const take = async n => { while (bytes.length < n) await wait(); const chunk = Buffer.from(bytes.subarray(0,n)); bytes = bytes.subarray(n); return chunk; };
  socket.write('GET / HTTP/1.1\r\nHost: ' + url.host + '\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Version: 13\r\nSec-WebSocket-Key: BwcHBwcHBwcHBwcHBwcHBw==\r\nAuthorization: Bearer ' + endpoint.authToken + '\r\n\r\n');
  while (!bytes.includes('\r\n\r\n')) await wait(); assert.match((await take(bytes.indexOf('\r\n\r\n') + 4)).toString(), /^HTTP\/1.1 101 /);
  return { socket, ended: endedGate.promise, send: value => socket.write(frame(value)), async receive() {
    const header = await take(2); assert.equal(header[0], 129); assert.equal(header[1] & 128, 0); let n = header[1];
    if (n === 126) n = (await take(2)).readUInt16BE(); else if (n === 127) n = Number((await take(8)).readBigUInt64BE());
    assert.ok(n <= 1048576); return JSON.parse((await take(n)).toString());
  } };
}
async function fixture(t, options = {}) {
  const calls = [], records = [], acknowledged = [], abort = new AbortController(), retired = []; const client = new EventEmitter();
  client.closed = false; client.close = () => { if (!client.closed) { client.closed = true; client.emit('disconnected'); } };
  client.send = value => calls.push(structuredClone(value));
  client.request = async (method, params) => {
    calls.push({ method, params: structuredClone(params) });
    const thread = { id: target.sessionId, cwd: target.repositoryRoot, status: { type: 'idle' } };
    const result = method === 'initialize' ? { userAgent: params.clientInfo.name + '/0.166.0 (synthetic)' }
      : method === 'config/read' ? { config: codexDesignConfig() } : method === 'account/read' ? { account: { ...account } }
      : method === 'thread/resume' ? { thread, cwd: target.repositoryRoot, sandbox: { type: 'readOnly' }, approvalPolicy: 'on-request', modelProvider: 'openai' } : { thread };
    await options.reply?.(method, result); return result;
  };
  let checks = 0;
  const probe = { close: async () => ({ stoppedVerified: options.helperStopped !== false }), inspectPeer: async (selected, context) => {
    checks++; await context.assertCurrent(); await options.peerCheck?.();
    return { schema: 'switchyard-editor-terminal-peer-result/v1', requestId: randomUUID(), processId: selected.processId, birth: selected.expectedBirth, image: { ...selected.image }, connection: { ...selected.connection }, connectionVerified: true, currentUserVerified: true, currentSessionVerified: true, processAccessMask: 0x101000, tokenAccessMask: 8, processTerminated: false, windowFocused: false, taskAttached: false, accountVerified: false };
  } };
  let connectionClient = client;
  if (options.retained) {
    client.accountFingerprint = target.accountFingerprint; client.restrictionsVerified = true; client.accountEpoch = 0;
    client.initializationEvidence = { clientName: 'switchyard_tasks', result: { userAgent: 'switchyard_tasks/0.166.0 (synthetic retained owner)' } };
    connectionClient = createRetainedCodexEditorClient({ client, target, assertCurrent: async () => {} });
  }
  const owner = await openWindowsCodexEditorConnection({ requestId: randomUUID(), target, client: connectionClient, platform: 'win32', signal: abort.signal, probeFactory: () => probe,
    assertCurrent: options.assertCurrent ?? (async () => {}), onOwnership: async value => { records.push(value); await options.onOwnership?.(value); },
    onAcknowledged: async (value, signal) => { acknowledged.push(value); await options.onAcknowledged?.(value, signal); },
    retireClient: async original => { assert.equal(original, connectionClient); retired.push(original); await options.retire?.(); return options.retained ? connectionClient.stop() : { stopped: options.upstreamStopped !== false }; } });
  t.after(async () => { if (options.upstreamStopped === false || options.helperStopped === false || options.retirementRefused) await assert.rejects(owner.stop()); else await owner.stop(); });
  return { owner, client, calls, records, acknowledged, abort, retired, checks: () => checks, async connected() {
    const pin = owner.pinPeer(peer), connection = await terminal(t, owner); await pin; return connection;
  }, async ready() { const connection = await this.connected(); connection.send(initialize); assert.equal((await connection.receive()).id, 1); connection.send({ method: 'initialized', params: {} }); return connection; } };
}

test('Windows transport and exact-task protocol complete one real socket exchange with durable acknowledgement', async t => {
  const f = await fixture(t), c = await f.ready(); c.send(resume()); const reply = await c.receive();
  assert.equal(reply.result.cwd, target.repositoryRoot); assert.equal(f.owner.observation().protocolAcknowledged, true);
  assert.deepEqual(f.calls.map(row => row.method), ['initialize','initialized','config/read','account/read','account/read','thread/resume','account/read']);
  assert.equal(f.acknowledged.length, 1); assert.ok(f.checks() >= 6);
  const token = f.owner.privateEndpoint.authToken, publicValue = JSON.stringify(f.owner.observation());
  for (const value of [token, account.email, target.accountFingerprint, target.sessionId, target.repositoryRoot]) assert.equal(publicValue.includes(value), false);
  assert.equal(JSON.stringify(f.records).includes(token), false);
  for (const key of ['nativeTaskLoaded','terminalLaunched','ideAttached','authorityGranted','completionVerified']) assert.equal(f.owner.observation()[key], false);
  assert.equal((await f.owner.stop()).stopped, true); assert.equal(f.retired.length, 1); assert.equal(f.owner.observation().protocolAcknowledged, false);
});

test('an authenticated Windows socket can retire its logical editor channel while the original task owner stays live', async t => {
  const f = await fixture(t, { retained: true }), c = await f.ready(); c.send(resume()); assert.equal((await c.receive()).result.thread.id,target.sessionId);
  assert.equal(f.owner.observation().protocolAcknowledged,true);assert.equal(f.calls.some(m=>['initialize','initialized'].includes(m.method)),false);
  const result=await f.owner.stop();await c.ended;assert.equal(result.clientConnectionRetired,true);assert.equal(result.upstreamExitVerified,false);assert.equal(result.carrierExitVerified,true);
  assert.equal(f.client.closed,false);assert.equal(f.retired.length,1);assert.equal(f.records.filter(r=>r.kind==='retired')[0].upstreamExitVerified,false);
});

test('foreign task, login, model and permission requests never reach the retained provider', async t => {
  for (const message of [{ id: 2, method: 'account/logout', params: {} }, { id: 2, method: 'turn/start', params: {} }, { ...resume(), params: { ...resume().params, sandbox: 'workspace-write' } }, { ...resume(), params: { ...resume().params, threadId: randomUUID() } }]) {
    const f = await fixture(t), c = await f.ready(); c.send(message); await c.ended; await f.owner.stop();
    assert.equal(f.calls.some(row => ['account/logout','turn/start','thread/resume'].includes(row.method)), false); assert.equal(f.acknowledged.length, 0);
  }
});

test('changed peer or account on the same socket withdraws the original session without reconnecting', async t => {
  for (const change of ['peer','account']) {
    let allowed = true; const f = await fixture(t, { peerCheck: () => assert.equal(allowed, true) }), c = await f.ready();
    c.send(resume()); await c.receive(); assert.equal(f.owner.observation().protocolAcknowledged, true);
    if (change === 'peer') { allowed = false; c.send({ id: 3, method: 'thread/read', params: { threadId: target.sessionId, includeTurns: false } }); }
    else f.client.emit('notification', { method: 'account/updated', params: {} });
    await c.ended; await f.owner.stop(); assert.equal(f.owner.observation().protocolAcknowledged, false); assert.equal(f.calls.some(row => row.method === 'thread/read'), false);
  }
});

test('cancellation joins an in-flight acknowledgement before any accepted retirement and suppresses its reply', async t => {
  const entered = gate(), held = gate(); let callbackSignal;
  const f = await fixture(t, { onAcknowledged: async (_value, signal) => { callbackSignal = signal; entered.resolve(); await held.promise; } }), c = await f.ready();
  c.send(resume()); await entered.promise; f.abort.abort(); assert.equal(callbackSignal.aborted, true);
  let stopped = false; const stopping = f.owner.stop().then(() => { stopped = true; }); await new Promise(r => setImmediate(r)); assert.equal(stopped, false);
  assert.equal(f.retired.length, 0); held.resolve(); await stopping; await c.ended; assert.equal(stopped, true); assert.equal(f.owner.observation().protocolAcknowledged, false);
});

test('uncertain provider or native helper exit cannot produce a successful retirement record', async t => {
  for (const option of ['upstreamStopped','helperStopped']) {
    const f = await fixture(t, { [option]: false }), c = await f.connected(); await assert.rejects(f.owner.stop()); await c.ended;
    assert.equal(f.records.some(row => row.kind === 'retired'), false); assert.equal(f.retired.length, 1); await assert.rejects(f.owner.stop()); assert.equal(f.retired.length, 1);
  }
});

test('changed native repository or account response never returns a task acknowledgement', async t => {
  for (const change of ['repository','account']) {
    let reads = 0; const f = await fixture(t, { reply: (method, result) => {
      if (change === 'repository' && method === 'thread/resume') result.thread.cwd = 'C:\\Different';
      if (change === 'account' && method === 'account/read' && ++reads === 3) result.account.email = 'other@example.invalid';
    } }), c = await f.ready(); c.send(resume()); await c.ended; await f.owner.stop();
    assert.equal(f.acknowledged.length, 0); assert.equal(f.owner.observation().protocolAcknowledged, false);
  }
});

test('failed startup retention joins and retires the original provider without publishing an endpoint', async () => {
  const client = new EventEmitter(), entered = gate(), release = gate(), records = []; let retired = 0;
  client.closed = false; client.close = () => { client.closed = true; }; client.send = () => assert.fail('No native notification'); client.request = () => assert.fail('No native request');
  const abort = new AbortController();
  const opening = openWindowsCodexEditorConnection({ requestId: randomUUID(), target, client, platform: 'win32', signal: abort.signal,
    assertCurrent: async () => {}, onAcknowledged: async () => assert.fail('No task acknowledgement'),
    onOwnership: async value => { records.push(value); if (value.ownership?.phase === 'ready') { entered.resolve(); await release.promise; } },
    probeFactory: () => ({ close: async () => ({ stoppedVerified: true }) }),
    retireClient: async original => { assert.equal(original, client); retired++; return { stopped: true }; } });
  const refused = assert.rejects(opening); await entered.promise; abort.abort(); assert.equal(client.closed, true); assert.equal(retired, 0);
  release.resolve(); await refused; assert.equal(retired, 1); assert.equal(records.filter(row => row.kind === 'retired').length, 1);
});

test('retirement still checks the original provider after durable carrier retention fails', async t => {
  const f = await fixture(t, { retirementRefused: true, onOwnership: async value => { if (value.ownership?.phase === 'stopped') throw Error('retention refused'); } });
  await assert.rejects(f.owner.stop()); assert.equal(f.retired.length, 1); assert.equal(f.records.some(row => row.kind === 'retired'), false);
});
