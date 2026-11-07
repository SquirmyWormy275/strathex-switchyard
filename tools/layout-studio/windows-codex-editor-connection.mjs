/** Compose one retained provider client and one authenticated Windows terminal.
 * The caller supplies original ownership and durable callbacks; this module
 * never starts/adopts a provider or grants permission to load a saved task. */
import { createCodexEditorProtocol } from './codex-editor-protocol.mjs';
import { createCodexEditorRelay } from './codex-editor-relay.mjs';
import { openWindowsEditorIngress } from './windows-editor-ingress.mjs';

const require = value => { if (!value) throw Error('The original Windows editor session did not verify.'); };

export async function openWindowsCodexEditorConnection({ requestId, target, client, assertCurrent, onOwnership, onAcknowledged, retireClient, signal,
  platform = process.platform, probeFactory } = {}) {
  require(platform === 'win32' && typeof requestId === 'string' && /^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/.test(requestId));
  require([assertCurrent, onOwnership, onAcknowledged, retireClient].every(fn => typeof fn === 'function') && signal instanceof AbortSignal);
  require(client && !client.closed && ['request','send','on','off','close'].every(k => typeof client[k] === 'function'));
  createCodexEditorProtocol(target, { platform }).close();
  const selected = Object.freeze({ ...target }), controller = new AbortController();
  let ingress, relay, closed = false, stopping, failure, startupFinished;
  const started = new Promise(resolve => { startupFinished = resolve; });
  const live = () => require(!closed && !signal.aborted && !client.closed && !ingress?.closed);
  const current = async () => { live(); await assertCurrent(); live(); };
  const close = () => {
    if (closed) return; closed = true; controller.abort(); signal.removeEventListener('abort', close);
    client.off('disconnected', disconnected); relay?.close(); ingress?.close(); client.close();
  };
  const disconnected = () => { failure = true; close(); };
  const observation = () => {
    const transport = ingress?.observation(), protocol = relay?.observation();
    const peerVerified = !closed && !client.closed && transport?.peerVerified === true;
    return Object.freeze({ schema: 'switchyard-windows-codex-editor-connection/v1', requestId, closed: closed || client.closed || ingress?.closed === true,
      failed: Boolean(failure) || protocol?.failed === true, peerVerified,
      protocolAcknowledged: peerVerified && protocol?.protocolAcknowledged === true,
      terminalLaunched: false, nativeTaskLoaded: false, ideAttached: false, authorityGranted: false, completionVerified: false });
  };
  const owner = Object.freeze({
    observation,
    get privateEndpoint() { live(); require(ingress); return ingress.privateEndpoint; },
    pinPeer(peer) {
      live(); require(ingress);
      // Ingress copies and spends the pin synchronously, before any callback.
      return ingress.pinPeer(peer).then(async () => { await current(); return observation(); }).catch(error => { failure = true; close(); throw error; });
    },
    close,
    stop() {
      if (stopping) return stopping; close();
      stopping = (async () => {
        // A caller can cancel while listener creation or retention is awaiting.
        // Join startup before deciding which original resources need retirement.
        await started;
        const facts = { relayJoined: false, carrierExitVerified: false, upstreamExitVerified: false };
        try { if (relay) await relay.stop(); facts.relayJoined = true; } catch {}
        try { if (ingress) facts.carrierExitVerified = (await ingress.stop()).stopped === true; else facts.carrierExitVerified = !failure?.retirementUnconfirmed; } catch {}
        try { facts.upstreamExitVerified = (await retireClient(client)).stopped === true; } catch {}
        require(Object.values(facts).every(value => value === true));
        const result = Object.freeze({ stopped: true, ...facts, terminalProcessTerminated: false });
        await onOwnership({ kind: 'retired', requestId, ...result }); return result;
      })(); return stopping;
    }
  });
  client.on('disconnected', disconnected); signal.addEventListener('abort', close, { once: true }); if (signal.aborted) close();
  try {
    await current();
    relay = createCodexEditorRelay({ target: selected, platform, client, signal: controller.signal, assertCurrent: current,
      send: async message => { await current(); require(ingress); await ingress.send(message); await current(); },
      onAcknowledged: async (value, abortSignal) => {
        await current(); require(ingress.observation().peerVerified === true);
        await onAcknowledged(value, abortSignal); await current(); require(ingress.observation().peerVerified === true);
      } });
    ingress = await openWindowsEditorIngress({ requestId, platform, ...(probeFactory ? { probeFactory } : {}), signal: controller.signal, assertCurrent: current,
      onMessage: message => relay.receive(message), onOwnership: async ownership => {
        // Stopped evidence is retained during retirement, after admission closes.
        if (ownership.phase !== 'stopped') await current();
        await onOwnership({ kind: 'ingress', requestId, ownership });
        if (ownership.phase !== 'stopped') await current();
      } });
    void ingress.whenClosed.then(() => { close(); void owner.stop().catch(() => {}); });
    await current(); startupFinished(); return owner;
  } catch (error) {
    failure = error; close(); startupFinished();
    try { await owner.stop(); } catch { error.editorRetirementUnconfirmed = true; } throw error;
  }
}
