/** One restricted Windows app-server; no task is created or resumed by startup. */
import { createHash } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { lstat, realpath } from 'node:fs/promises';
import { join } from 'node:path';
import { CodexClient, codexRestrictedProcessArguments } from './agents.mjs';
import { directoryIdentity } from './private-fs.mjs';
import { openWindowsOwnedStdio, retireStoppedWindowsStdio } from './windows-owned-stdio.mjs';
import { createRetainedCodexEditorClient } from './codex-retained-editor-client.mjs';

const require = value => { if (!value) throw Error('The original Windows Codex owner is unavailable.'); };

export async function openWindowsCodexOwner({ executable, cwd, serverNames = [], authorize, onOwner, onReady,
  platform = process.platform, openStdio = openWindowsOwnedStdio, createClient = (exe, directory, names, options) => new CodexClient(exe, directory, names, options) } = {}) {
  require(platform === 'win32' && [authorize,onOwner,onReady,openStdio,createClient].every(fn => typeof fn === 'function'));
  const controller = new AbortController(); let transport, client, closed = false, connecting, configuring, stopping, accountFingerprint;
  const editors = new Set(), editorOpenings = new Set();
  const current = () => require(!closed && !transport?.closed && !client?.closed);
  const admission = async () => { current(); await authorize(); current(); };
  await admission(); await directoryIdentity(cwd);
  for (const name of ['.git','.codex','AGENTS.md']) try { await lstat(join(cwd,name)); throw Error('Use the original neutral private Codex startup directory.'); } catch (error) { if (error.code !== 'ENOENT') throw error; }
  const canonical = await realpath(executable), image = await lstat(canonical, { bigint: true }); require(canonical === executable && image.isFile() && !image.isSymbolicLink() && image.size > 0n && image.size <= 512n * 1024n * 1024n);
  const hash = createHash('sha256'); for await (const bytes of createReadStream(canonical)) hash.update(bytes); const executableSha256 = hash.digest('hex'); await admission();
  const args = codexRestrictedProcessArguments(executable, serverNames);
  const owner = Object.freeze({
    get scope() { return transport?.scope ?? null; },
    get privateOwnership() {
      if (!transport) return null;
      // Earlier durable checkpoints contain only identities already observed.
      // Later helper/worker facts must not make original cleanup look like a
      // replacement of an earlier, explicitly absent observation.
      const { helper, worker, ...original } = transport.privateOwnership;
      return { ...original, ...(helper ? { helper } : {}), ...(worker ? { worker } : {}) };
    },
    get closed() { return closed || transport?.closed || client?.closed || false; },
    get accountFingerprint() { return accountFingerprint ?? null; },
    get binding() {
      if (owner.closed || !transport?.worker || !client?.restrictionsVerified || !accountFingerprint || client.accountFingerprint !== accountFingerprint) return null;
      return { schema: 'switchyard-windows-codex-stdio-binding/v1', scope: transport.scope, peerPid: transport.worker.pid, peerBirth: transport.worker.birth, peerExecutableSha256: executableSha256 };
    },
    connect() {
      current(); require(!configuring);
      if (connecting) return connecting;
      connecting = (async () => {
        await admission(); require(transport && !client);
        client = createClient(executable, cwd, serverNames, { spawnProcess: () => transport.child, clientInfo: { name: 'switchyard_tasks', title: 'Switchyard exact tasks', version: '0.1.0' } });
        client.on('disconnected', () => owner.close());
        await client.initialize(); await admission(); require(client.restrictionsVerified && /^[a-f0-9]{64}$/.test(client.accountFingerprint));
        accountFingerprint = client.accountFingerprint; return client;
      })().catch(error => { owner.close(); throw error; }); return connecting;
    },
    // The separate configuration probe uses this exact owned process, then
    // retires the complete Job before any task owner can be launched.
    configuration() {
      current(); require(!configuring && !connecting);
      configuring = (async () => {
        await admission(); require(transport && !client);
        client = createClient(executable, cwd, serverNames, { spawnProcess: () => transport.child, clientInfo: { name: 'switchyard_config', title: 'Switchyard configuration metadata', version: '0.1.0' } });
        client.on('disconnected', () => owner.close()); const result = await client.handshake(); await admission(); return result;
      })().catch(error => { owner.close(); throw error; }); return configuring;
    },
    openEditorClient({ target, onClient, assertCurrent = admission } = {}) {
      require(typeof onClient === 'function' && typeof assertCurrent === 'function' && !editorOpenings.size);
      const operation = Promise.resolve().then(async () => {
        await admission(); require(owner.binding && target?.accountFingerprint === accountFingerprint);
        for (const editor of editors) if (editor.closed) { require((await editor.stop()).logicalClientRetired); editors.delete(editor); }
        require(!editors.size);
        const editor = createRetainedCodexEditorClient({ client, target, assertCurrent: async () => { await admission(); await assertCurrent(); await admission(); }, platform });
        editors.add(editor);
        try { await onClient(editor); await admission(); await client.recheckAccount(); await admission(); require(!editor.closed); return editor; }
        catch (error) { editor.close(); await editor.stop(); editors.delete(editor); throw error; }
      });
      editorOpenings.add(operation); void operation.then(() => editorOpenings.delete(operation), () => editorOpenings.delete(operation)); return operation;
    },
    close() { if (closed) return; closed = true; controller.abort(); for (const editor of editors) editor.close(); client?.close(); transport?.close(); },
    stop() { if (!stopping) { owner.close(); stopping = (async () => {
      await Promise.allSettled([connecting,configuring,...editorOpenings].filter(Boolean));
      const exits = await Promise.allSettled([...editors].map(editor => editor.stop()));
      const result = transport ? await transport.stop() : { stopped: true };
      require(exits.every(exit => exit.status === 'fulfilled' && exit.value.logicalClientRetired)); editors.clear(); return result;
    })(); } return stopping; }
  });
  try {
    transport = await openStdio({ executable, args, cwd, expectedExecutableSha256: executableSha256, assertCurrent: admission, signal: controller.signal, platform,
      onOwner: async value => { require(!transport || transport === value); transport = value; if (closed) transport.close(); await admission(); await onOwner(owner); await admission(); },
      onReady: async scope => { await admission(); await onReady(scope, owner); await admission(); },
      onWorker: async () => { await admission(); } });
    await admission(); return owner;
  } catch (error) { owner.close(); try { await owner.stop(); } catch { error.retirementUnconfirmed = true; } throw error; }
}

export const retireStoppedWindowsCodexOwner = (scope, ownership) => retireStoppedWindowsStdio(scope, { ...ownership, worker: ownership?.worker ?? null });
