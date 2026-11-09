/** Logical editor channel on one already authenticated native stdio client.
 * No native handshake, new process or process-exit claim belongs to this channel. */
import { EventEmitter } from 'node:events';
import { assertCodexDesignConfig, codexAccountFingerprint, reviewedCodexVersion } from './agents.mjs';
import { createCodexEditorProtocol } from './codex-editor-protocol.mjs';
import { codexAccountBoundary } from './codex-requests.mjs';

const exact = (v, keys) => v && typeof v === 'object' && !Array.isArray(v) && Object.keys(v).every(k => keys.includes(k));
const require = value => { if (!value) throw Error('The original retained editor channel did not verify.'); };
const MAX = 1048576;

export function createRetainedCodexEditorClient({ client, target, assertCurrent, platform = 'win32' } = {}) {
  createCodexEditorProtocol(target, { platform }).close();
  const selected = Object.freeze({ ...target }), initialization = client?.initializationEvidence;
  require(client && !client.closed && client.restrictionsVerified && client.accountFingerprint === selected.accountFingerprint
    && ['request','on','off','close'].every(k => typeof client[k] === 'function') && typeof assertCurrent === 'function'
    && exact(initialization, ['clientName','result']) && typeof initialization.clientName === 'string');
  const nativeVersion = reviewedCodexVersion(initialization.result, initialization.clientName);
  const original = JSON.stringify(initialization), epoch = client.accountEpoch, channel = new EventEmitter(), pending = new Set();
  let closed = false, phase = 'initialize', resumed = false, bytes = 0, stopping;
  const live = () => require(!closed && !client.closed && client.restrictionsVerified && client.accountEpoch === epoch
    && client.accountFingerprint === selected.accountFingerprint && JSON.stringify(client.initializationEvidence) === original);
  const current = async () => { live(); await assertCurrent(); live(); };
  const close = reason => {
    if (closed) return; closed = true; channel.closeReason = reason;
    client.off('notification', notification); client.off('disconnected', disconnected); channel.emit('disconnected', reason);
  };
  const disconnected = reason => close(reason);
  const notification = value => {
    if (closed) return;
    if (codexAccountBoundary(value)) { close(Error('The original native account changed.')); return; }
    if (!['thread/status/changed','thread/closed'].includes(value?.method)) return;
    // This shared stream may also serve task metadata. Only the selected task
    // can be observed by this channel; foreign notifications are never relayed.
    if (value.params?.threadId !== selected.sessionId) return;
    try { live(); const text = JSON.stringify(value); require(Buffer.byteLength(text) <= MAX); channel.emit('notification', JSON.parse(text)); }
    catch (error) { close(error); }
  };
  Object.defineProperties(channel, {
    closed: { get: () => closed || client.closed },
    retirementKind: { value: 'logical-channel' },
    initializationClientName: { value: initialization.clientName },
    initializationOrigin: { value: 'retained-owner' }
  });
  channel.nativeVersion = nativeVersion;
  channel.close = close;
  channel.send = value => {
    try {
      live(); require(phase === 'initialized' && exact(value, ['method','params']) && value.method === 'initialized'
        && (value.params === undefined || exact(value.params, [])));
      // The original native stream has already received this notification.
      phase = 'ready';
    } catch (error) { close(error); throw error; }
  };
  channel.request = (method, input) => {
    let params, size;
    try { live(); const text = JSON.stringify(input); size = Buffer.byteLength(text); require(size <= MAX && bytes + size <= 2 * MAX && pending.size < 64); params = JSON.parse(text); }
    catch (error) { close(error); return Promise.reject(error); }
    bytes += size;
    const work = Promise.resolve().then(async () => {
      await current();
      if (method === 'initialize') {
        require(phase === 'initialize' && exact(params, ['clientInfo','capabilities']) && exact(params.clientInfo, ['name','title','version'])
          && /^[A-Za-z0-9_-]{1,64}$/.test(params.clientInfo.name ?? '') && typeof params.clientInfo.version === 'string' && params.clientInfo.version.length > 0 && params.clientInfo.version.length <= 128
          && (params.capabilities === undefined || exact(params.capabilities, ['experimentalApi']) && [undefined,false].includes(params.capabilities.experimentalApi)));
        phase = 'initialized';
        // Return the exact original hello, including its original client name.
        // The relay records the provenance instead of inventing a new handshake.
        return structuredClone(initialization.result);
      }
      require(phase === 'ready');
      if (method === 'account/read') require(exact(params, ['refreshToken']) && params.refreshToken === false);
      else if (method === 'config/read') require(exact(params, ['includeLayers']) && params.includeLayers === false
        || exact(params, ['includeLayers','cwd']) && params.includeLayers === true && params.cwd === selected.repositoryRoot);
      else if (method === 'model/list') require(nativeVersion === '0.167.0' && exact(params, ['cursor','limit','includeHidden']) && params.cursor === null && params.limit === null && params.includeHidden === true);
      else if (method === 'configRequirements/read') require(nativeVersion === '0.167.0' && params === null);
      else if (method === 'thread/read') require(exact(params, ['threadId','includeTurns']) && params.threadId === selected.sessionId && [undefined,true,false].includes(params.includeTurns));
      else if (method === 'thread/resume') {
        require(!resumed && exact(params, ['threadId','cwd','sandbox','approvalPolicy','excludeTurns']) && params.threadId === selected.sessionId
          && params.cwd === selected.repositoryRoot && params.sandbox === 'read-only' && params.approvalPolicy === 'on-request' && [undefined,true,false].includes(params.excludeTurns));
        resumed = true;
      } else throw Error('This request is outside the retained editor channel.');
      const result = await client.request(method, params); await current();
      if (method === 'account/read') {
        try { require(codexAccountFingerprint(result?.account) === selected.accountFingerprint); }
        catch (error) { client.close(Object.assign(error, { code: 'ACCOUNT_UNCONFIRMED' })); throw error; }
      }
      if (method === 'config/read') assertCodexDesignConfig(result?.config);
      if (method.startsWith('thread/')) require(result?.thread?.id === selected.sessionId && result.thread.cwd === selected.repositoryRoot);
      if (method === 'thread/resume') require(result.cwd === selected.repositoryRoot && result.sandbox?.type === 'readOnly' && result.approvalPolicy === 'on-request' && result.modelProvider === 'openai');
      return result;
    }).catch(error => { close(error); throw error; }).finally(() => { pending.delete(work); bytes -= size; });
    pending.add(work); return work;
  };
  channel.stop = () => {
    if (!stopping) { close(); stopping = (async () => { await Promise.allSettled([...pending]); return { stopped: true, logicalClientRetired: true, nativeProcessTerminated: false }; })(); }
    return stopping;
  };
  client.on('notification', notification); client.on('disconnected', disconnected); live(); return channel;
}
