import test from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { codexAccountFingerprint, codexDesignConfig } from './agents.mjs';
import { createCodexEditorRelay } from './codex-editor-relay.mjs';

const account = { type: 'chatgpt', email: 'editor@example.invalid' };
const target = { sessionId: '11111111-1111-4111-8111-111111111111', repositoryRoot: '/original/repository', accountFingerprint: codexAccountFingerprint(account) };
const initialize = { id: 1, method: 'initialize', params: { clientInfo: { name: 'codex_tui', version: '0.166.0' } } };
// Captured from the installed 0.167 binary in an empty network-isolated home.
const nativeInitialize = { id: 'initialize', method: 'initialize', params: {
  clientInfo: { name: 'codex-tui', title: null, version: '0.167.0' },
  capabilities: { requiredHumanApproval: true, experimentalApi: true, requestAttestation: false, optOutNotificationMethods: null }
} };
const resumed = () => ({ thread: { id: target.sessionId, cwd: target.repositoryRoot, status: { type: 'idle' } }, cwd: target.repositoryRoot, sandbox: { type: 'readOnly' }, approvalPolicy: 'on-request', modelProvider: 'openai' });
const resume = (id = 2) => ({ id, method: 'thread/resume', params: { threadId: target.sessionId, cwd: target.repositoryRoot, sandbox: 'read-only', approvalPolicy: 'on-request', excludeTurns: true } });
const nativeResume = () => ({ id: 'native-resume', method: 'thread/resume', params: {
  threadId: target.sessionId, cwd: target.repositoryRoot, excludeTurns: true,
  ...Object.fromEntries(['history','path','model','modelProvider','runtimeWorkspaceRoots','approvalPolicy','approvalsReviewer','sandbox','permissions','config','baseInstructions','developerInstructions','personality','initialTurnsPage'].map(k => [k, null]))
} });
const gate = () => { let resolve; const promise = new Promise(r => resolve = r); return { promise, resolve }; };
const turnPage = () => ({ data: [{ id: 'saved-turn', items: [], itemsView: 'notLoaded', status: 'completed', error: null }], nextCursor: null, backwardsCursor: 'saved-turn-cursor' });
const itemPage = () => ({ data: [{ turnId: 'saved-turn', item: { id: 'saved-item', type: 'agentMessage', text: 'Saved reply', phase: 'final_answer' }, startedAtMs: null, completedAtMs: null }], nextCursor: 'next-items', backwardsCursor: 'saved-item-cursor' });
const pageRequest = (items = false, cursor = null) => ({ id: items ? 'item-page' : 'turn-page', method: items ? 'thread/items/list' : 'thread/turns/list', params: { threadId: target.sessionId, cursor, limit: items ? 100 : 5, sortDirection: 'desc', ...(items ? { turnId: null } : { itemsView: 'notLoaded' }) } });
async function paginatedFixture(t, reply) {
  const f = fixture(t, { reply: async (m,r) => {
    if (m.method === 'initialize') r.userAgent = 'codex-tui/0.167.0 (synthetic)';
    if (m.method === 'thread/resume') r.thread.historyMode = 'paginated';
    if (['thread/turns/list','thread/items/list'].includes(m.method)) { delete r.thread; Object.assign(r, m.method === 'thread/turns/list' ? turnPage() : itemPage()); }
    await reply?.(m,r);
  } });
  await f.relay.receive(nativeInitialize); await f.relay.receive({ method: 'initialized' }); await f.relay.receive(nativeResume()); return f;
}
function fixture(t, options = {}) {
  const calls = [], delivered = [], acknowledgements = [], abort = new AbortController();
  const client = new EventEmitter(); client.closed = false;
  client.close = () => { if (client.closed) return; client.closed = true; client.emit('disconnected'); };
  client.send = m => { calls.push(structuredClone(m)); };
  client.request = async (method, params) => {
    const row = { method, params: structuredClone(params) }; calls.push(row);
    const reply = method === 'initialize' ? { userAgent: params.clientInfo.name + '/0.166.0 (synthetic)' }
      : method === 'config/read' ? { config: codexDesignConfig() }
      : method === 'account/read' ? { account: { ...account } }
      : method === 'thread/resume' ? resumed() : { thread: resumed().thread };
    await options.reply?.(row, reply); return reply;
  };
  const relay = createCodexEditorRelay({ target, client, signal: abort.signal, assertCurrent: options.assertCurrent ?? (async () => {}),
    send: async m => { delivered.push(structuredClone(m)); await options.send?.(m); },
    onAcknowledged: async (observation, signal) => { acknowledgements.push(observation); await options.onAcknowledged?.(observation, signal); } });
  t.after(() => relay.stop());
  return { calls, delivered, acknowledgements, abort, client, relay, async ready() { await relay.receive(initialize); await relay.receive({ method: 'initialized', params: {} }); } };
}

test('one connection brackets the exact resume with account reads and withholds its reply until acknowledgement is retained', async t => {
  const entered = gate(), release = gate(), f = fixture(t, { onAcknowledged: async () => { entered.resolve(); await release.promise; } }); await f.ready();
  const work = f.relay.receive(resume()); await entered.promise;
  assert.deepEqual(f.calls.map(c => c.method), ['initialize','initialized','config/read','account/read','account/read','thread/resume','account/read']);
  assert.equal(f.delivered.some(m => m.id === 2), false); assert.equal(f.relay.observation().protocolAcknowledged, false);
  release.resolve(); await work; assert.equal(f.delivered.at(-1).result.thread.id, target.sessionId); assert.equal(f.relay.observation().protocolAcknowledged, true);
  assert.equal(f.relay.observation().ideAttached, false); assert.equal(f.relay.observation().authorityGranted, false);
});
test('native 0.167 startup normalizes capabilities and empty account reads without expanding provider authority', async t => {
  const f = fixture(t, { reply: async (m,r) => { if (m.method === 'initialize') r.userAgent = 'codex-tui/0.167.0 (synthetic)'; } });
  await f.relay.receive(nativeInitialize); await f.relay.receive({ method: 'initialized' });
  assert.deepEqual(f.calls[0], { method: 'initialize', params: { clientInfo: { name: 'codex-tui', version: '0.167.0' }, capabilities: { experimentalApi: false } } });
  await f.relay.receive({ id: 1, method: 'account/read', params: {} });
  await f.relay.receive({ id: 2, method: 'thread/read', params: { threadId: target.sessionId } });
  assert.deepEqual(f.calls.filter(m => m.method === 'account/read').map(m => m.params), Array(4).fill({ refreshToken: false }));
  assert.deepEqual(f.calls.filter(m => m.method === 'thread/read'), [{ method: 'thread/read', params: { threadId: target.sessionId, includeTurns: false } }]);
  assert.equal(f.delivered.at(-1).result.thread.id, target.sessionId);
  assert.equal(f.acknowledgements.length, 0); assert.equal(f.relay.observation().protocolAcknowledged, false);
  assert.equal(f.calls.some(m => m.method === 'thread/resume'), false);
});
test('native startup shape, version and pre-resume reads stay closed to expanded or foreign requests', async t => {
  const changed = [m => m.params.clientInfo.version = '0.168.0', m => m.params.clientInfo.name = 'other',
    m => m.params.capabilities.requiredHumanApproval = false, m => m.params.capabilities.requestAttestation = true,
    m => m.params.capabilities.optOutNotificationMethods = ['account/updated'], m => m.params.capabilities.extra = false];
  for (const mutate of changed) {
    const f = fixture(t), m = structuredClone(nativeInitialize); mutate(m);
    await assert.rejects(f.relay.receive(m)); assert.deepEqual(f.calls, []);
  }
  for (const params of [{ threadId: target.sessionId, includeTurns: true }, { threadId: 'foreign' }]) {
    const f = fixture(t, { reply: async (m,r) => { if (m.method === 'initialize') r.userAgent = 'codex-tui/0.167.0 (synthetic)'; } });
    await f.relay.receive(nativeInitialize); await f.relay.receive({ method: 'initialized' });
    await assert.rejects(f.relay.receive({ id: 2, method: 'thread/read', params }));
    assert.equal(f.calls.some(m => m.method === 'thread/read'), false);
  }
  const generic = fixture(t); await generic.ready();
  await assert.rejects(generic.relay.receive({ id: 2, method: 'thread/read', params: { threadId: target.sessionId } }));
  assert.equal(generic.calls.some(m => m.method === 'thread/read'), false);
});
test('native pre-resume metadata is withheld if its original account changes during the read', async t => {
  let changed = false;
  const f = fixture(t, { reply: async (m,r) => {
    if (m.method === 'initialize') r.userAgent = 'codex-tui/0.167.0 (synthetic)';
    if (m.method === 'thread/read') changed = true;
    if (m.method === 'account/read' && changed) r.account.email = 'other@example.invalid';
  } });
  await f.relay.receive(nativeInitialize); await f.relay.receive({ method: 'initialized' });
  await assert.rejects(f.relay.receive({ id: 2, method: 'thread/read', params: { threadId: target.sessionId } }));
  assert.equal(f.delivered.some(m => m.id === 2), false); assert.equal(f.relay.observation().protocolAcknowledged, false);
});
test('acknowledged legacy reads check the original account before querying and before releasing history', async t => {
  for (const change of ['before', 'during']) {
    let changed = false;
    const f = fixture(t, { reply: async (m,r) => {
      if (m.method === 'thread/read' && change === 'during') changed = true;
      if (m.method === 'account/read' && changed) r.account.email = 'other@example.invalid';
    } });
    await f.ready(); await f.relay.receive(resume()); changed = change === 'before';
    await assert.rejects(f.relay.receive({ id: 3, method: 'thread/read', params: { threadId: target.sessionId, includeTurns: true } }));
    assert.equal(f.calls.filter(m => m.method === 'thread/read').length, change === 'before' ? 0 : 1);
    assert.equal(f.delivered.some(m => m.id === 3), false); assert.equal(f.relay.observation().protocolAcknowledged, false);
    assert.equal(f.client.closed, true); assert.equal(f.acknowledgements.length, 1);
  }
});
test('repeated acknowledged legacy reads retain one original acknowledgement after fresh account checks', async t => {
  const f = fixture(t); await f.ready(); await f.relay.receive(resume());
  for (const id of [3, 4]) {
    await f.relay.receive({ id, method: 'thread/read', params: { threadId: target.sessionId, includeTurns: true } });
    assert.deepEqual(f.calls.slice(-3).map(m => m.method), ['account/read', 'thread/read', 'account/read']);
    assert.equal(f.delivered.at(-1).id, id); assert.equal(f.relay.observation().protocolAcknowledged, true);
  }
  assert.equal(f.acknowledgements.length, 1);
});
test('native project configuration reads preserve exact cwd, effective restrictions and original account', async t => {
  const ready = async hooks => {
    const f = fixture(t, { reply: async (m,r) => { if (m.method === 'initialize') r.userAgent = 'codex-tui/0.167.0 (synthetic)'; await hooks?.(m,r); } });
    await f.relay.receive(nativeInitialize); await f.relay.receive({ method: 'initialized' }); return f;
  };
  const request = { id: 'project-trust', method: 'config/read', params: { includeLayers: true, cwd: target.repositoryRoot } };
  const f = await ready((m,r) => { if (m.method === 'config/read') r.layers = [{ source: 'synthetic exact project' }]; });
  await f.relay.receive(request);
  assert.deepEqual(f.calls.slice(-3).map(m => m.method), ['account/read','config/read','account/read']);
  assert.deepEqual(f.calls.at(-2).params, request.params);
  assert.deepEqual(f.delivered.at(-1).result.layers, [{ source: 'synthetic exact project' }]);
  assert.equal(f.acknowledgements.length, 0);
  for (const params of [{ includeLayers: true, cwd: '/other' }, { includeLayers: true }, { includeLayers: true, cwd: target.repositoryRoot, extra: false }]) {
    const x = await ready(), before = x.calls.length;
    await assert.rejects(x.relay.receive({ ...request, params })); assert.equal(x.calls.length, before);
  }
  for (const failure of ['config','account']) {
    let projectRead = false;
    const x = await ready((m,r) => {
      if (m.method === 'config/read' && m.params.cwd) { projectRead = true; if (failure === 'config') r.config.features.hooks = true; }
      if (m.method === 'account/read' && projectRead && failure === 'account') r.account.email = 'other@example.invalid';
    });
    await assert.rejects(x.relay.receive(request)); assert.equal(x.delivered.some(m => m.id === request.id), false);
  }
});

test('unreviewed requests, effects, foreign task IDs and expanded permissions never reach the provider', async t => {
  for (const method of ['turn/start','turn/steer','thread/start','thread/fork','account/logout','account/login/start','config/value/write','unknown/method']) {
    const f = fixture(t); await f.ready(); const prior = f.calls.length; await assert.rejects(f.relay.receive({ id: 2, method, params: {} })); assert.equal(f.calls.length, prior); assert.equal(f.client.closed, true);
  }
  for (const change of [{ threadId: '22222222-2222-4222-8222-222222222222' }, { cwd: '/other' }, { sandbox: 'workspace-write' }, { approvalPolicy: 'never' }, { config: {} }, { model: 'other' }]) {
    const f = fixture(t); await f.ready(); const m = resume(); Object.assign(m.params, change); await assert.rejects(f.relay.receive(m)); assert.equal(f.calls.some(c => c.method === 'thread/resume'), false);
  }
});

test('native resume derives permissions from the reviewed target and rejects every client override', async t => {
  const ready = async () => {
    const f = fixture(t, { reply: async (m,r) => { if (m.method === 'initialize') r.userAgent = 'codex-tui/0.167.0 (synthetic)'; } });
    await f.relay.receive(nativeInitialize); await f.relay.receive({ method: 'initialized' }); return f;
  };
  const f = await ready(); await f.relay.receive(nativeResume());
  assert.deepEqual(f.calls.find(m => m.method === 'thread/resume').params, resume().params);
  assert.equal(f.acknowledgements.length, 1); assert.equal(f.relay.observation().protocolAcknowledged, true);
  await assert.rejects(f.relay.receive({ ...nativeResume(), id: 'replayed' }));
  assert.equal(f.calls.filter(m => m.method === 'thread/resume').length, 1);
  for (const [key,value] of Object.entries({ threadId: 'other', cwd: '/other', history: [], path: '/rollout', model: 'other', modelProvider: 'other', runtimeWorkspaceRoots: [], approvalPolicy: 'never', approvalsReviewer: 'guardian_subagent', sandbox: 'workspace-write', permissions: {}, config: {}, baseInstructions: 'changed', developerInstructions: 'changed', personality: 'friendly', initialTurnsPage: {}, excludeTurns: false, extra: null })) {
    const x = await ready(), m = nativeResume(); m.params[key] = value;
    await assert.rejects(x.relay.receive(m)); assert.equal(x.calls.some(m => m.method === 'thread/resume'), false);
  }
});

test('native bootstrap reads return original account-bound metadata and never forward optional capabilities', async t => {
  const f = fixture(t, { reply: async (m,r) => {
    if (m.method === 'initialize') r.userAgent = 'codex-tui/0.167.0 (synthetic)';
    if (m.method === 'model/list') Object.assign(r, { data: [{ id: 'synthetic', model: 'synthetic' }], nextCursor: null });
    if (m.method === 'configRequirements/read') r.requirements = { allowedSandboxModes: ['read-only'] };
  } });
  await f.relay.receive(nativeInitialize); await f.relay.receive({ method: 'initialized' });
  await f.relay.receive({ id: 'models', method: 'model/list', params: { cursor: null, limit: null, includeHidden: true } });
  assert.deepEqual(f.calls.slice(-3).map(m => m.method), ['account/read','model/list','account/read']);
  await f.relay.receive({ id: 'requirements', method: 'configRequirements/read' });
  assert.deepEqual(f.calls.at(-2), { method: 'configRequirements/read', params: null });
  assert.deepEqual(f.delivered.at(-1).result.requirements, { allowedSandboxModes: ['read-only'] });
  const before = f.calls.length;
  for (const [i,method] of ['hooks/list','account/bedrock/checkGovCloudRequirements','collaborationMode/list','thread/list','thread/loaded/list','thread/goal/get','skills/list','account/rateLimits/read','plugin/installed','app/installed','app/list'].entries()) {
    await f.relay.receive({ id: 'optional-'+i, method, params: {} });
    assert.equal(f.delivered.at(-1).error.code, -32601); assert.equal(f.calls.length, before); assert.equal(f.relay.observation().connectionClosed, false);
  }
  assert.equal(f.acknowledgements.length, 0);
  await assert.rejects(f.relay.receive({ id: 'effects', method: 'turn/start', params: {} }));
  assert.equal(f.calls.length, before);
});

test('native bootstrap metadata refuses expanded queries, malformed replies and changed accounts before delivery', async t => {
  const ready = async hook => {
    const f = fixture(t, { reply: async (m,r) => {
      if (m.method === 'initialize') r.userAgent = 'codex-tui/0.167.0 (synthetic)';
      if (m.method === 'model/list') Object.assign(r, { data: [{ id: 'synthetic', model: 'synthetic' }], nextCursor: null });
      if (m.method === 'configRequirements/read') r.requirements = null;
      await hook?.(m,r);
    } });
    await f.relay.receive(nativeInitialize); await f.relay.receive({ method: 'initialized' }); return f;
  };
  const models = { id: 'models', method: 'model/list', params: { cursor: null, limit: null, includeHidden: true } };
  for (const input of [{ ...models, params: { ...models.params, cursor: 'other-page' } }, { ...models, params: { ...models.params, limit: 1000 } }, { id: 'requirements', method: 'configRequirements/read', params: {} }]) {
    const f = await ready(), count = f.calls.length; await assert.rejects(f.relay.receive(input)); assert.equal(f.calls.length, count);
  }
  for (const failure of ['model-shape','requirements-shape','account']) {
    let read = false;
    const f = await ready((m,r) => {
      if (['model/list','configRequirements/read'].includes(m.method)) read = true;
      if (m.method === 'model/list' && failure === 'model-shape') r.data = [{ id: 'bad', model: null }];
      if (m.method === 'configRequirements/read' && failure === 'requirements-shape') r.requirements = [];
      if (m.method === 'account/read' && read && failure === 'account') r.account.email = 'other@example.invalid';
    });
    const input = failure === 'requirements-shape' ? { id: 'requirements', method: 'configRequirements/read' } : models;
    await assert.rejects(f.relay.receive(input)); assert.equal(f.delivered.some(m => m.id === input.id), false);
    assert.equal(f.relay.observation().protocolAcknowledged, false);
  }
});
test('native paginated history reads only the resumed task with account checks around each bounded page', async t => {
  const f = fixture(t, { reply: async (m,r) => {
    if (m.method === 'initialize') r.userAgent = 'codex-tui/0.167.0 (synthetic)';
    if (m.method === 'thread/resume') r.thread.historyMode = 'paginated';
    if (m.method === 'thread/turns/list') { delete r.thread; Object.assign(r, turnPage()); }
  } });
  await f.relay.receive(nativeInitialize); await f.relay.receive({ method: 'initialized' }); await f.relay.receive(nativeResume());
  const params = { threadId: target.sessionId, cursor: null, limit: 5, sortDirection: 'desc', itemsView: 'notLoaded' };
  await f.relay.receive({ id: 'turn-page', method: 'thread/turns/list', params });
  assert.deepEqual(f.delivered.at(-1).result, turnPage());
  assert.deepEqual(f.calls.slice(-3).map(m => m.method), ['account/read','thread/turns/list','account/read']);
  assert.deepEqual(f.calls.at(-2).params, params);
  assert.equal(f.relay.observation().protocolAcknowledged, true); assert.equal(f.acknowledgements.length, 1);
});
test('native history follows only cursors returned by that task and page family', async t => {
  const f = await paginatedFixture(t);
  await f.relay.receive(pageRequest()); await f.relay.receive(pageRequest(true));
  assert.deepEqual(f.delivered.at(-1).result, itemPage());
  await f.relay.receive({ ...pageRequest(true, 'next-items'), id: 'older-items' });
  assert.equal(f.calls.at(-2).params.cursor, 'next-items');
  await f.relay.receive({ ...pageRequest(false, 'saved-turn-cursor'), id: 'older-turn', params: { ...pageRequest(false, 'saved-turn-cursor').params, limit: 1 } });
  assert.equal(f.calls.at(-2).params.limit, 1);
  assert.equal(f.relay.observation().protocolAcknowledged, true);
  for (const input of [pageRequest(false, 'next-items'), pageRequest(true, 'saved-turn-cursor'), pageRequest(true, 'invented')]) {
    const x = await paginatedFixture(t); await x.relay.receive(pageRequest()); await x.relay.receive(pageRequest(true));
    const before = x.calls.length; await assert.rejects(x.relay.receive({ ...input, id: 'foreign-cursor' })); assert.equal(x.calls.length, before);
  }
});
test('native history refuses expanded parameters, legacy history and pages requested before resume', async t => {
  for (const items of [false,true]) for (const changed of [{ threadId: 'other' }, { cursor: {} }, { limit: 1000 }, { limit: 0 }, { limit: 1.5 }, { sortDirection: 'asc' }, { extra: false }, ...(items ? [{ turnId: 'foreign-turn' }] : [{ itemsView: 'full' }])]) {
    const f = await paginatedFixture(t), input = pageRequest(items); Object.assign(input.params, changed);
    const before = f.calls.length; await assert.rejects(f.relay.receive(input)); assert.equal(f.calls.length, before);
  }
  const legacy = await paginatedFixture(t, (m,r) => { if (m.method === 'thread/resume') delete r.thread.historyMode; });
  await assert.rejects(legacy.relay.receive(pageRequest())); assert.equal(legacy.calls.some(m => m.method === 'thread/turns/list'), false);
  const early = fixture(t, { reply: (m,r) => { if (m.method === 'initialize') r.userAgent = 'codex-tui/0.167.0 (synthetic)'; } });
  await early.relay.receive(nativeInitialize); await early.relay.receive({ method: 'initialized' });
  await assert.rejects(early.relay.receive(pageRequest())); assert.equal(early.calls.some(m => m.method === 'thread/turns/list'), false);
});
test('malformed, oversized or account-changed native history is withheld before delivery', async t => {
  const corruptions = [r => r.data = {}, r => r.nextCursor = 'bad\n', r => r.backwardsCursor = 'x'.repeat(2049), r => r.data.push(structuredClone(r.data[0])), r => r.data[0].threadId = 'foreign'];
  for (const items of [false,true]) for (const corrupt of [...corruptions, items ? r => r.data[0].item.threadId = 'foreign' : r => r.data[0].itemsView = 'full', r => { r.data = Array.from({ length: items ? 101 : 6 }, (_,i) => items ? { ...itemPage().data[0], item: { ...itemPage().data[0].item, id: 'item-'+i } } : { ...turnPage().data[0], id: 'turn-'+i }); }, ...(items ? [r => r.data[0].item.text = 'x'.repeat(1048576)] : [])]) {
    const input = pageRequest(items), f = await paginatedFixture(t, (m,r) => { if (m.method === input.method) corrupt(r); });
    await assert.rejects(f.relay.receive(input)); assert.equal(f.delivered.some(m => m.id === input.id), false);
  }
  let read = false;
  const f = await paginatedFixture(t, (m,r) => { if (m.method === 'thread/items/list') read = true; if (read && m.method === 'account/read') r.account.email = 'changed@example.invalid'; });
  await assert.rejects(f.relay.receive(pageRequest(true))); assert.equal(f.delivered.some(m => m.id === 'item-page'), false);
});
test('closing during a saved history read joins it and suppresses both its reply and queued pages', async t => {
  const entered = gate(), release = gate();
  const f = await paginatedFixture(t, async m => { if (m.method === 'thread/items/list') { entered.resolve(); await release.promise; } });
  const pending = f.relay.receive(pageRequest(true)), rejected = assert.rejects(pending); await entered.promise;
  const queued = assert.rejects(f.relay.receive(pageRequest())); let stopped = false;
  const stop = f.relay.stop().then(() => { stopped = true; }); await new Promise(r => setImmediate(r)); assert.equal(stopped, false);
  release.resolve(); await Promise.all([rejected,queued,stop]);
  assert.equal(f.delivered.some(m => ['item-page','turn-page'].includes(m.id)), false);
  assert.equal(f.calls.some(m => m.method === 'thread/turns/list'), false); assert.equal(stopped, true);
});
test('unreviewed versions and experimental initialization are refused before any task request', async t => {
  const f = fixture(t, { reply: async (m,r) => { if (m.method === 'initialize') r.userAgent = 'codex_tui/0.168.0 (unverified)'; } });
  await assert.rejects(f.relay.receive(initialize)); assert.deepEqual(f.calls.map(c => c.method), ['initialize']);
  for (const capabilities of [{ experimentalApi: true }, { optOutNotificationMethods: ['account/updated'] }, null]) {
    const x = fixture(t); await assert.rejects(x.relay.receive({ ...initialize, params: { ...initialize.params, capabilities } })); assert.deepEqual(x.calls, []);
  }
});
test('changed account on either side of resume invalidates without returning the task acknowledgement', async t => {
  for (const changedRead of [1,2,3]) {
    let reads = 0; const f = fixture(t, { reply: async (m,r) => { if (m.method === 'account/read' && ++reads === changedRead) r.account.email = 'other@example.invalid'; } });
    if (changedRead === 1) await assert.rejects(f.ready()); else { await f.ready(); await assert.rejects(f.relay.receive(resume())); }
    assert.equal(f.delivered.some(m => m.id === 2), false); assert.equal(f.relay.observation().protocolAcknowledged, false); assert.equal(f.client.closed, true);
  }
});
test('wrong native task or permissions and ineffective configuration invalidate before delivery', async t => {
  for (const mutate of [r => { r.thread.id = 'foreign'; }, r => { r.cwd = '/other'; }, r => { r.sandbox.type = 'workspaceWrite'; }, r => { r.approvalPolicy = 'never'; }, r => { r.modelProvider = 'other'; }]) {
    const f = fixture(t, { reply: async (m,r) => { if (m.method === 'thread/resume') mutate(r); } }); await f.ready(); await assert.rejects(f.relay.receive(resume())); assert.equal(f.acknowledgements.length, 0);
  }
  const f = fixture(t, { reply: async (m,r) => { if (m.method === 'config/read') r.config.features.hooks = true; } }); await assert.rejects(f.ready()); assert.equal(f.calls.some(c => c.method === 'thread/resume'), false);
});
test('duplicate client IDs, second resume and client replies cannot replay an effect', async t => {
  for (const message of [resume(), resume(3), { id: 3, result: {} }]) {
    const f = fixture(t); await f.ready(); await f.relay.receive(resume()); await assert.rejects(f.relay.receive(message)); assert.equal(f.calls.filter(c => c.method === 'thread/resume').length, 1);
  }
  const f = fixture(t); await f.ready(); await f.relay.receive(resume('1')); assert.equal(f.relay.observation().protocolAcknowledged, true);
});
test('account boundaries or cancellation during a pending durable callback prevent acknowledgement and join that callback', async t => {
  for (const event of ['account','abort']) {
    const entered = gate(), release = gate(); let receivedSignal;
    const f = fixture(t, { onAcknowledged: async (_o,signal) => { receivedSignal = signal; entered.resolve(); await release.promise; } }); await f.ready();
    const work = f.relay.receive(resume()); const rejected = assert.rejects(work); await entered.promise;
    if (event === 'account') f.client.emit('notification', { method: 'account/updated', params: {} }); else f.abort.abort();
    assert.equal(receivedSignal.aborted, true); let stopped = false; const stop = f.relay.stop().then(() => stopped = true); await new Promise(r => setImmediate(r)); assert.equal(stopped, false);
    release.resolve(); await rejected; await stop; assert.equal(f.delivered.some(m => m.id === 2), false); assert.equal(f.relay.observation().protocolAcknowledged, false);
  }
});
test('account notifications and original task unloading withdraw live acknowledgement synchronously', async t => {
  for (const message of [{ method: 'account/updated', params: {} }, { method: 'account/login/completed', params: { success: true } }, { method: 'thread/closed', params: { threadId: target.sessionId } }, { method: 'thread/status/changed', params: { threadId: target.sessionId, status: { type: 'notLoaded' } } }]) {
    const f = fixture(t); await f.ready(); await f.relay.receive(resume()); f.client.emit('notification', message); assert.equal(f.relay.observation().protocolAcknowledged, false); assert.equal(f.client.closed, true);
  }
});
test('only exact task reads and bounded status notifications reach the terminal after acknowledgement', async t => {
  const f = fixture(t); await f.ready(); await f.relay.receive(resume());
  await f.relay.receive({ id: 3, method: 'thread/read', params: { threadId: target.sessionId, includeTurns: true } }); assert.equal(f.delivered.at(-1).id, 3);
  f.client.emit('notification', { method: 'item/commandExecution/requestApproval', id: 9, params: { command: 'PRIVATE_NEVER_FORWARD' } });
  f.client.emit('notification', { method: 'thread/status/changed', params: { threadId: target.sessionId, status: { type: 'active' } } }); await new Promise(r => setImmediate(r));
  assert.equal(f.delivered.at(-1).method, 'thread/status/changed'); assert.equal(JSON.stringify(f.delivered).includes('PRIVATE'), false);
  await assert.rejects(f.relay.receive({ id: 4, method: 'thread/read', params: { threadId: 'foreign' } })); assert.equal(f.calls.filter(c => c.method === 'thread/read').length, 1);
});
test('queued input is copied, bounded and cancelled without starting a pending request', async t => {
  const entered = gate(), release = gate(); const f = fixture(t, { assertCurrent: async () => { entered.resolve(); await release.promise; } });
  const first = f.relay.receive(initialize), rejected = assert.rejects(first); await entered.promise;
  const queued = []; for (let i = 0; i < 63; i++) queued.push(assert.rejects(f.relay.receive({ id: i+2, method: 'account/read', params: { refreshToken: false } })));
  await assert.rejects(f.relay.receive({ id: 1000, method: 'account/read', params: { refreshToken: false } })); release.resolve(); await rejected; await Promise.all(queued); assert.deepEqual(f.calls, []);
  const x = fixture(t); const m = structuredClone(initialize), work = x.relay.receive(m); m.params.clientInfo.name = 'changed'; await work; assert.equal(x.calls[0].params.clientInfo.name, 'codex_tui');
});
test('unconfirmed send or retention never reports an attached editor or live protocol acknowledgement', async t => {
  for (const hook of ['send','onAcknowledged']) {
    const f = fixture(t, { [hook]: async m => { if (hook === 'onAcknowledged' || m.id === 2) throw Error('PRIVATE transport failure'); } }); await f.ready(); await assert.rejects(f.relay.receive(resume()));
    assert.equal(f.relay.observation().protocolAcknowledged, false); assert.equal(f.relay.observation().ideAttached, false); assert.equal(JSON.stringify(f.relay.observation()).includes('PRIVATE'), false);
  }
});
