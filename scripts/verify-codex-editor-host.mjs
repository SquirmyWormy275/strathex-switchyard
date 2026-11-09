#!/usr/bin/env node
/** Installed relay/retained-channel proof with in-memory provider responses only. */
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { createHash } from 'node:crypto';
import { readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { homedir } from 'node:os';
import { pathToFileURL } from 'node:url';
import { applicationStatus } from '../deployment/suite/application.mjs';
import { installationRoot } from '../deployment/suite/installation.mjs';
import { verifySuiteRelease } from '../deployment/suite/release.mjs';

assert.deepEqual(process.argv.slice(2), ['--read-only-metadata']);
const app = await applicationStatus(); assert.equal(app.status, 'ready');
const root = join(installationRoot(), 'versions', app.build);
const manifest = await verifySuiteRelease(root, { expectedId: app.build, platform: 'linux', checkRuntime: true });
const source = JSON.parse(await readFile(new URL('../docs/evidence/codex-native-paginated-history-summary.json', import.meta.url)));
const moduleDigests = {}, checks = [], hash = bytes => createHash('sha256').update(bytes).digest('hex');
for (const name of ['codex-editor-history.mjs','codex-editor-relay.mjs','codex-retained-editor-client.mjs']) {
  const path = 'tools/layout-studio/' + name, digest = hash(await readFile(join(root, path)));
  assert.equal(digest, source.sourceFiles[path]); moduleDigests[path] = digest;
}
checks.push('installed history and both channel modules match the tested source');
const load = name => import(pathToFileURL(join(root, 'tools/layout-studio', name + '.mjs')).href);
const { createCodexEditorRelay } = await load('codex-editor-relay');
const { createRetainedCodexEditorClient } = await load('codex-retained-editor-client');
const { codexDesignConfig, codexAccountFingerprint } = await load('agents');
const account = { type: 'chatgpt', email: 'synthetic@example.invalid' };
const initialization = { clientInfo: { name: 'codex-tui', title: null, version: '0.167.0' }, capabilities: { requiredHumanApproval: true, experimentalApi: true, requestAttestation: false, optOutNotificationMethods: null } };
for (const retained of [false,true]) {
  const platform = retained ? 'win32' : 'linux', calls = [], delivered = [];
  const target = { sessionId: '11111111-1111-4111-8111-111111111111', repositoryRoot: retained ? 'C:\\Synthetic\\reviewed' : '/synthetic/reviewed', accountFingerprint: codexAccountFingerprint(account) };
  const native = new EventEmitter(); native.closed = false; native.restrictionsVerified = true; native.accountFingerprint = target.accountFingerprint; native.accountEpoch = 0;
  native.initializationEvidence = { clientName: 'switchyard_tasks', result: { userAgent: 'switchyard_tasks/0.167.0 (synthetic)' } };
  native.close = () => { native.closed = true; }; native.send = message => calls.push(message);
  native.request = async (method, params) => {
    calls.push({ method, params: structuredClone(params) });
    if (method === 'initialize') return { userAgent: 'codex-tui/0.167.0 (synthetic)' };
    if (method === 'config/read') return { config: codexDesignConfig() };
    if (method === 'account/read') return { account };
    if (method === 'thread/resume') return { thread: { id: target.sessionId, cwd: target.repositoryRoot, status: { type: 'idle' }, historyMode: 'paginated' }, cwd: target.repositoryRoot, sandbox: { type: 'readOnly' }, approvalPolicy: 'on-request', modelProvider: 'openai' };
    if (method === 'thread/turns/list') return { data: [{ id: 'saved-turn', items: [], itemsView: 'notLoaded', status: 'completed' }], nextCursor: null, backwardsCursor: null };
    if (method === 'thread/items/list') return { data: [{ turnId: 'saved-turn', item: { id: 'saved-item', type: 'agentMessage', text: 'Synthetic saved reply' } }], nextCursor: 'older-items', backwardsCursor: null };
    throw Error('No native effect or other provider request is allowed by this verifier.');
  };
  const client = retained ? createRetainedCodexEditorClient({ client: native, target, platform, assertCurrent: async () => {} }) : native;
  let acknowledged = 0;
  const relay = createCodexEditorRelay({ client, target, platform, assertCurrent: async () => {}, signal: new AbortController().signal, send: async m => delivered.push(m), onAcknowledged: async () => { acknowledged++; } });
  try {
    await relay.receive({ id: 'init', method: 'initialize', params: initialization }); await relay.receive({ method: 'initialized' });
    const nulls = Object.fromEntries(['history','path','model','modelProvider','runtimeWorkspaceRoots','approvalPolicy','approvalsReviewer','sandbox','permissions','config','baseInstructions','developerInstructions','personality','initialTurnsPage'].map(k => [k,null]));
    await relay.receive({ id: 'resume', method: 'thread/resume', params: { ...nulls, threadId: target.sessionId, cwd: target.repositoryRoot, excludeTurns: true } });
    assert.deepEqual(calls.find(m => m.method === 'thread/resume').params, { threadId: target.sessionId, cwd: target.repositoryRoot, sandbox: 'read-only', approvalPolicy: 'on-request', excludeTurns: true });
    checks.push(platform + ' installed native envelope preserves the reviewed resume permissions');
    await relay.receive({ id: 'turns', method: 'thread/turns/list', params: { threadId: target.sessionId, cursor: null, limit: 5, sortDirection: 'desc', itemsView: 'notLoaded' } });
    const params = { threadId: target.sessionId, turnId: null, cursor: null, limit: 100, sortDirection: 'desc' };
    await relay.receive({ id: 'items', method: 'thread/items/list', params });
    await relay.receive({ id: 'older', method: 'thread/items/list', params: { ...params, cursor: 'older-items', limit: 1 } });
    assert.equal(delivered.at(-1).result.data[0].item.text, 'Synthetic saved reply');
    assert.deepEqual(calls.slice(-3).map(m => m.method), ['account/read','thread/items/list','account/read']);
    assert.equal(acknowledged, 1); assert.equal(relay.observation().protocolAcknowledged, true);
    checks.push(platform + ' installed saved pages preserve account checks and the original continuation cursor');
    const before = calls.length;
    await assert.rejects(relay.receive({ id: 'foreign', method: 'thread/items/list', params: { ...params, cursor: 'unseen' } }));
    assert.equal(calls.length, before); assert.equal(delivered.some(m => m.id === 'foreign'), false);
    checks.push(platform + ' installed history rejects invented cursors before dispatch');
    assert.equal(calls.filter(m => m.method === 'initialize').length, retained ? 0 : 1);
    assert.equal(calls.filter(m => m.method === 'thread/resume').length, 1);
    if (retained) { assert.equal(native.closed, false); checks.push('retiring the retained logical channel preserves its native owner'); }
  } finally { await relay.stop(); if (retained) await client.stop(); }
}
const evidence = { schema: 'switchyard-installed-codex-editor-metadata/v1', sourceCommit: manifest.sourceCommit, applicationRelease: manifest.id, moduleDigests, checks, success: true, pureInMemoryOnly: true, nativeProviderRequests: 0, nativeTasksResumed: 0, modelPrompts: 0, hardwareOperations: 0, graphicalEditorAcceptance: false };
const receipt = join(homedir(), '.local/state/strathex-switchyard/runtime-verification', 'installed-codex-editor-metadata-' + Date.now() + '.json');
await writeFile(receipt, JSON.stringify(evidence, null, 2) + '\n', { flag: 'wx', mode: 0o600 });
console.log(JSON.stringify({ receipt, checks: checks.length, success: true, pureInMemoryOnly: true }));
