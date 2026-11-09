/** Restricted editor protocol on one original connection. Transport ownership stays with the caller. */
import { assertCodexDesignConfig, codexAccountFingerprint, reviewedCodexVersion } from './agents.mjs';
import { createCodexEditorProtocol } from './codex-editor-protocol.mjs';
import { codexAccountBoundary } from './codex-requests.mjs';
import { createCodexEditorHistory } from './codex-editor-history.mjs';

const object = v => v !== null && typeof v === 'object' && !Array.isArray(v);
const exact = (v, names) => object(v) && Object.keys(v).every(k => names.includes(k));
const id = v => Number.isSafeInteger(v) || typeof v === 'string' && v.length > 0 && v.length <= 128 && !/[\x00-\x1f\x7f]/.test(v);
const label = v => typeof v === 'string' && v.length > 0 && v.length <= 128 && !/[\x00-\x1f\x7f]/.test(v);
const require = v => { if (!v) throw Error('The original restricted editor connection did not verify.'); };
const MAX = 1048576;
const nativeResumeNulls = ['history','path','model','modelProvider','runtimeWorkspaceRoots','approvalPolicy','approvalsReviewer','sandbox','permissions','config','baseInstructions','developerInstructions','personality','initialTurnsPage'];
// Observed optional catalog/feature requests from the reviewed native TUI.
// They receive an explicit unsupported response locally; none reach the owner.
const unavailableNativeReads = new Set(['hooks/list','account/bedrock/checkGovCloudRequirements','collaborationMode/list','thread/list','thread/loaded/list','thread/goal/get','skills/list','account/rateLimits/read','plugin/installed','app/installed','app/list']);

export function createCodexEditorRelay({ target, client, assertCurrent, send, onAcknowledged, signal, platform = 'linux' } = {}) {
  const witness = createCodexEditorProtocol(target, { platform }), selected = Object.freeze({ ...target });
  const history = createCodexEditorHistory(selected.sessionId); let paginated = false;
  require(client && ['request','send','on','off','close'].every(k => typeof client[k] === 'function') && !client.closed);
  require([assertCurrent,send,onAcknowledged].every(f => typeof f === 'function') && signal instanceof AbortSignal);
  const controller = new AbortController(), seen = new Set(), notifications = new Set();
  let phase = 'initialize', closed = false, failure = false, acknowledged = false, attempted = false, nativeTui = false, accountSequence = 0, count = 0, bytes = 0, tail = Promise.resolve(), stopping;
  const live = () => { require(!closed && !signal.aborted && !client.closed); };
  const current = async () => { live(); await assertCurrent(); live(); };
  const observation = () => Object.freeze({ schema: 'switchyard-editor-relay/v1', phase, protocolAcknowledged: !closed && !client.closed && acknowledged && witness.observation().protocolAcknowledged,
    connectionClosed: closed, failed: failure, ideAttached: false, authorityGranted: false, completionVerified: false });
  const close = () => { if (closed) return; closed = true; acknowledged = false; phase = 'closed'; controller.abort(); witness.close(); signal.removeEventListener('abort', abort); client.off('notification', notify); client.off('disconnected', disconnected); client.close(); };
  const fail = () => { failure = true; close(); };
  const abort = () => close();
  const disconnected = () => fail();
  const deliver = async message => { await current(); await send(message, controller.signal); await current(); };
  const request = async (method, params) => { await current(); const reply = await client.request(method, params); await current(); return reply; };
  async function account(tag) {
    const message = { id: tag, method: 'account/read', params: { refreshToken: false } };
    acknowledged = false; require(witness.client(message));
    const result = await request(message.method, message.params);
    require(codexAccountFingerprint(result?.account) === selected.accountFingerprint && witness.server({ id: tag, result }));
    return result;
  }
  function notify(value) {
    if (closed) return;
    // Account boundaries withdraw admission synchronously, even while a reply
    // or durable acknowledgement callback is awaiting completion.
    if (codexAccountBoundary(value)) { fail(); return; }
    if (!['thread/status/changed','thread/closed'].includes(value?.method)) return;
    if (!object(value.params) || value.params.threadId !== selected.sessionId) { fail(); return; }
    if (value.method === 'thread/closed' || !['idle','active'].includes(value.params.status?.type)) { fail(); return; }
    if (!acknowledged) return;
    if (notifications.size >= 32) { fail(); return; }
    const message = { method: 'thread/status/changed', params: { threadId: selected.sessionId, status: structuredClone(value.params.status) } };
    if (Buffer.byteLength(JSON.stringify(message)) > MAX) { fail(); return; }
    const work = deliver(message).catch(fail); notifications.add(work); void work.finally(() => notifications.delete(work));
  }
  async function handle(m) {
    await current();
    if (phase === 'initialize') {
      require(m.method === 'initialize' && m.id !== undefined && exact(m.params, ['clientInfo','capabilities']));
      const info = m.params.clientInfo, caps = m.params.capabilities;
      // The reviewed native TUI advertises its own broad protocol support.
      // Translate that exact dialect into our existing restricted upstream
      // handshake. Advertising support never authorizes experimental methods,
      // notification opt-outs, attestation or any additional task effects.
      nativeTui = exact(info, ['name','title','version']) && info.name === 'codex-tui' && info.title === null && info.version === '0.167.0'
        && exact(caps, ['requiredHumanApproval','experimentalApi','requestAttestation','optOutNotificationMethods'])
        && caps.requiredHumanApproval === true && caps.experimentalApi === true && caps.requestAttestation === false && caps.optOutNotificationMethods === null;
      require(nativeTui || exact(info, ['name','title','version']) && typeof info.name === 'string' && /^[A-Za-z0-9_-]{1,64}$/.test(info.name) && label(info.version) && (info.title === undefined || label(info.title)));
      require(nativeTui || caps === undefined || exact(caps, ['experimentalApi']) && (caps.experimentalApi === undefined || caps.experimentalApi === false));
      const result = await request('initialize', nativeTui ? { clientInfo: { name: info.name, version: info.version }, capabilities: { experimentalApi: false } } : m.params);
      // A logical stdio channel returns its retained owner's exact native hello;
      // it never sends a second initialize or substitutes the terminal's name.
      const retained = client.initializationOrigin === 'retained-owner';
      require(!retained || client.retirementKind === 'logical-channel' && typeof client.initializationClientName === 'string');
      client.nativeVersion = reviewedCodexVersion(result, retained ? client.initializationClientName : info.name);
      require(!nativeTui || client.nativeVersion === info.version);
      phase = 'initialized'; await deliver({ id: m.id, result }); return;
    }
    if (phase === 'initialized') {
      require(m.method === 'initialized' && m.id === undefined && (m.params === undefined || exact(m.params, []) ));
      await current(); client.send({ method: 'initialized', params: {} }); await current();
      assertCodexDesignConfig((await request('config/read', { includeLayers: false }))?.config);
      // This read is on this exact connection, before any task request.
      await account('switchyard-before-initialize'); client.accountFingerprint = selected.accountFingerprint; client.restrictionsVerified = true;
      phase = 'ready'; return;
    }
    require(m.id !== undefined && ['ready','acknowledged'].includes(phase));
    if (nativeTui && unavailableNativeReads.has(m.method)) {
      require(m.params === undefined || object(m.params));
      await deliver({ id: m.id, error: { code: -32601, message: 'This optional feature is unavailable in the reviewed editor attachment.' } }); return;
    }
    if (m.method === 'thread/resume') {
      // Remote 0.167 resumes cannot carry CLI permission overrides. Its exact
      // null-only settings envelope is narrowed to the already reviewed scope.
      const nativeResume = nativeTui && exact(m.params, ['threadId','cwd','excludeTurns',...nativeResumeNulls])
        && m.params.threadId === selected.sessionId && m.params.cwd === selected.repositoryRoot && m.params.excludeTurns === true && nativeResumeNulls.every(k => m.params[k] === null);
      const params = nativeResume ? { threadId: selected.sessionId, cwd: selected.repositoryRoot, sandbox: 'read-only', approvalPolicy: 'on-request', excludeTurns: true } : m.params;
      require(!attempted && exact(params, ['threadId','cwd','sandbox','approvalPolicy','excludeTurns']) && params.threadId === selected.sessionId && params.cwd === selected.repositoryRoot
        && params.sandbox === 'read-only' && params.approvalPolicy === 'on-request' && (params.excludeTurns === undefined || typeof params.excludeTurns === 'boolean'));
      attempted = true; phase = 'resuming'; acknowledged = false;
      await account('switchyard-before-resume');
      require(witness.client({ ...m, params, id: 'switchyard-resume' }));
      const result = await request('thread/resume', params); require(witness.server({ id: 'switchyard-resume', result }));
      paginated = result.thread.historyMode === 'paginated';
      await account('switchyard-after-resume'); require(witness.observation().protocolAcknowledged);
      await current(); await onAcknowledged(witness.observation(), controller.signal); await current();
      await deliver({ id: m.id, result }); phase = 'acknowledged'; acknowledged = true; return;
    }
    if (m.method === 'account/read') {
      require(exact(m.params, ['refreshToken']) && (m.params.refreshToken === false || nativeTui && m.params.refreshToken === undefined));
      const result = await account('switchyard-account-' + ++accountSequence); await deliver({ id: m.id, result }); acknowledged = attempted && witness.observation().protocolAcknowledged; return;
    }
    if (m.method === 'config/read') {
      const projectRead = nativeTui && exact(m.params, ['includeLayers','cwd']) && m.params.includeLayers === true && m.params.cwd === selected.repositoryRoot;
      require(projectRead || exact(m.params, ['includeLayers']) && m.params.includeLayers === false);
      if (projectRead) await account('switchyard-before-config-' + ++accountSequence);
      const result = await request(m.method, m.params); assertCodexDesignConfig(result?.config);
      if (projectRead) await account('switchyard-after-config-' + ++accountSequence);
      await deliver({ id: m.id, result }); acknowledged = attempted && witness.observation().protocolAcknowledged; return;
    }
    if (nativeTui && ['model/list','configRequirements/read'].includes(m.method)) {
      const models = m.method === 'model/list';
      require(models ? exact(m.params, ['cursor','limit','includeHidden']) && m.params.cursor === null && m.params.limit === null && m.params.includeHidden === true : m.params === undefined || m.params === null);
      await account('switchyard-before-bootstrap-' + ++accountSequence);
      const result = await request(m.method, models ? m.params : null);
      require(object(result) && Buffer.byteLength(JSON.stringify(result)) <= MAX);
      require(models ? Array.isArray(result.data) && result.data.length <= 256 && result.data.every(model => object(model) && label(model.id) && label(model.model)) && (result.nextCursor === null || label(result.nextCursor))
        : result.requirements === null || object(result.requirements));
      await account('switchyard-after-bootstrap-' + ++accountSequence);
      await deliver({ id: m.id, result }); acknowledged = attempted && witness.observation().protocolAcknowledged; return;
    }
    if (['thread/turns/list','thread/items/list'].includes(m.method)) {
      require(nativeTui && acknowledged && paginated); history.request(m.method, m.params);
      await account('switchyard-before-history-' + ++accountSequence);
      const result = await request(m.method, m.params); history.response(m.method, m.params, result);
      await account('switchyard-after-history-' + ++accountSequence);
      await deliver({ id: m.id, result }); acknowledged = witness.observation().protocolAcknowledged; return;
    }
    if (m.method === 'thread/read') {
      const startupRead = nativeTui && phase === 'ready' && !attempted;
      require((acknowledged || startupRead) && exact(m.params, ['threadId','includeTurns']) && m.params.threadId === selected.sessionId && (m.params.includeTurns === undefined || typeof m.params.includeTurns === 'boolean')
        && (!startupRead || m.params.includeTurns !== true));
      if (startupRead) await account('switchyard-before-read-' + ++accountSequence);
      const result = await request(m.method, startupRead ? { threadId: selected.sessionId, includeTurns: false } : m.params);
      require(result?.thread?.id === selected.sessionId && result.thread.cwd === selected.repositoryRoot && ['idle','active'].includes(result.thread.status?.type));
      if (startupRead) await account('switchyard-after-read-' + ++accountSequence);
      await deliver({ id: m.id, result }); return;
    }
    // No default forwarding. Turn, login, config-write, other-task and unknown
    // requests have no authority under this reviewed attachment permission.
    throw Error('This request is outside the reviewed editor attachment.');
  }
  const relay = Object.freeze({
    observation,
    receive(value) {
      let message, size;
      try {
        live(); require(object(value)); const text = JSON.stringify(value); size = Buffer.byteLength(text); require(size <= MAX && bytes + size <= 2 * MAX && count < 64);
        message = JSON.parse(text); require(exact(message, ['id','method','params']) && typeof message.method === 'string' && /^[A-Za-z][A-Za-z0-9/_-]{0,127}$/.test(message.method) && (message.id === undefined || id(message.id)));
        if (message.id !== undefined) { const key = typeof message.id + ':' + message.id; require(!seen.has(key) && seen.size < 4096); seen.add(key); }
      } catch (error) { fail(); return Promise.reject(error); }
      count++; bytes += size;
      const operation = tail.then(() => handle(message)).catch(error => { fail(); throw error; }).finally(() => { count--; bytes -= size; });
      tail = operation.catch(() => {}); return operation;
    },
    close,
    stop() { if (!stopping) { close(); stopping = (async () => { await tail; await Promise.allSettled([...notifications]); return { closed: true, processExitVerified: false }; })(); } return stopping; }
  });
  client.on('notification', notify); client.on('disconnected', disconnected); signal.addEventListener('abort', abort, { once: true }); if (signal.aborted) close();
  return relay;
}
