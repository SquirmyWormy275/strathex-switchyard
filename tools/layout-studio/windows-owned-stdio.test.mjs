import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { randomUUID, createHash } from 'node:crypto';
import { readFile, realpath, mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { once } from 'node:events';
import { openWindowsOwnedStdio, windowsOwnedStdioRequest, retireStoppedWindowsStdio } from './windows-owned-stdio.mjs';
import { stopOwnedChild } from './owned-process.mjs';

const sha = bytes => createHash('sha256').update(bytes).digest('hex');
const gate = () => { let resolve; const promise = new Promise(r => { resolve = r; }); return { promise, resolve }; };
const base = () => ({ schema: 'switchyard-runtime-command/v1', id: randomUUID(), role: 'owned-stdio', executable: 'C:\\Reviewed\\codex.exe', executableSha256: 'a'.repeat(64), args: ['app-server','--stdio'], cwd: 'C:\\Neutral\\private', environment: { PATH: 'C:\\Windows' } });
const helperPath = await realpath(process.execPath), helperHash = sha(await readFile(helperPath));
async function fixture(t, options = {}) {
  const events = [], abort = new AbortController(); let owned, processChild, checked, statusProcess;
  const opening = openWindowsOwnedStdio({ executable: base().executable, args: options.args ?? ['echo'], cwd: base().cwd, expectedExecutableSha256: base().executableSha256,
    platform: 'win32', signal: abort.signal, assertCurrent: options.assertCurrent ?? (async () => {}),
    onOwner: async owner => { owned = owner; events.push('retained'); await options.onOwner?.(owner); },
    onReady: async (scope, owner) => { assert.equal(owner, owned); events.push('guardian'); await options.onReady?.(scope, owner); },
    onWorker: async (worker, owner) => { assert.equal(owner, owned); events.push('worker'); await options.onWorker?.(worker, owner); },
    helper: async () => ({ path: helperPath, sha256: helperHash }),
    spawnProcess: (_exe, _args, opts) => { events.push('spawn'); processChild = spawn(process.execPath, [fileURLToPath(new URL('./test-support/windows-owned-stdio-guardian-fixture.cjs', import.meta.url))], opts); return processChild; },
    guardianStopped: async (scope, context) => {
      checked = scope; assert.equal(processChild.exitCode !== null || processChild.signalCode !== null, true);
      if (options.statusProbe) { statusProcess = spawn(process.execPath, ['-e','setInterval(()=>{},1000)'], { stdio: 'ignore' }); context.onGuardianChild(statusProcess); }
      if (options.statusThrows) throw Error('query refused'); return options.treeStopped !== false;
    } });
  t.after(async () => { abort.abort(); try { if (options.treeStopped === false) await assert.rejects(owned?.stop()); else await owned?.stop(); } finally { if (statusProcess) assert.equal((await stopOwnedChild(statusProcess)).stopped, true); } });
  return { opening, abort, events, owner: () => owned, guardian: () => processChild, checked: () => checked, statusProcess: () => statusProcess };
}
async function bytesFrom(stream, size) {
  const chunks = []; let n = 0;
  for await (const bytes of stream.iterator({ destroyOnReturn: false })) { chunks.push(bytes); n += bytes.length; if (n >= size) break; }
  return Buffer.concat(chunks);
}
const write = (stream, bytes) => new Promise((resolve, reject) => stream.write(bytes, error => error ? reject(error) : resolve()));

test('the persistent request is closed, bounded and excludes runtime injections and ambiguous paths', () => {
  const source = base(), request = windowsOwnedStdioRequest(source); source.args[0] = 'changed'; assert.equal(request.args[0], 'app-server'); assert.ok(Object.isFrozen(request.args));
  for (const patch of [{ role: 'other' }, { command: 'PRIVATE' }, { executable: '\\\\host\\share\\app.exe' }, { cwd: 'C:\\private\\..\\other' }, { cwd: 'C:\\NUL' }, { executableSha256: 'b' }, { args: ['bad\n'] }, { args: ['x'.repeat(8193)] }, { environment: { NODE_OPTIONS: '--eval=PRIVATE' } }, { environment: { PATH: 'a', path: 'b' } }, { environment: { PRIVATE_API_KEY: 'secret' } }]) assert.throws(() => windowsOwnedStdioRequest({ ...base(), ...patch }));
});

test('an actual child guardian double streams bounded bytes only after both retained startup checkpoints', async t => {
  const f = await fixture(t), owner = await f.opening; assert.deepEqual(f.events, ['retained','spawn','guardian','worker']);
  const input = Buffer.from('a'.repeat(20000)), received = bytesFrom(owner.child.stdout, input.length);
  await write(owner.child.stdin, input); assert.deepEqual(await received, input);
  const view = owner.observation(); assert.equal(view.workerStarted, true); assert.equal(view.providerInitialized, false); assert.equal(view.taskLoaded, false);
  assert.equal((await owner.stop()).treeExitVerified, true); assert.deepEqual(f.checked(), owner.scope); assert.equal(owner.observation().workerStarted, false);
});

test('cancellation joins a held suspended-worker checkpoint and never admits the byte stream', async t => {
  const entered = gate(), held = gate(), f = await fixture(t, { onWorker: async () => { entered.resolve(); await held.promise; } });
  const refused = assert.rejects(f.opening); await entered.promise; f.abort.abort(); let stopped = false;
  const retirement = f.owner().stop().then(() => { stopped = true; }); await new Promise(r => setImmediate(r)); assert.equal(stopped, false);
  held.resolve(); await refused; await retirement; assert.equal(f.owner().observation().workerStarted, false); assert.ok(f.checked());
});

test('wrong input acknowledgements and malformed output close the original process without a replacement', async t => {
  for (const mode of ['wrong-ack','bad-base64']) {
    const f = await fixture(t, { args: [mode] }), owner = await f.opening; owner.child.stdout.resume();
    const sent = write(owner.child.stdin, Buffer.from('private test')); void sent.catch(() => {}); await owner.whenClosed; await owner.stop(); await sent.catch(() => {});
    assert.equal(f.events.filter(v => v === 'spawn').length, 1); assert.equal(owner.closed, true);
  }
});

test('queued writes are bounded and a blocked writer is cancelled before verified shutdown', async t => {
  const f = await fixture(t, { args: ['hold-input'] }), owner = await f.opening;
  const pending = write(owner.child.stdin, Buffer.alloc(65536)), refused = assert.rejects(pending);
  await new Promise(r => setImmediate(r)); owner.child.stdin.write(Buffer.alloc(2097152)); await refused; await owner.stop(); assert.equal(owner.closed, true);
});

test('helper exit alone never substitutes for independent original Job retirement', async t => {
  const f = await fixture(t, { treeStopped: false }), owner = await f.opening; await assert.rejects(owner.stop());
  assert.equal(owner.observation().helperExited, true); assert.notEqual(owner.observation().phase, 'stopped'); await assert.rejects(owner.stop());
});

test('closing either exposed byte stream closes admission and retires the original helper', async t => {
  for (const stream of ['stdin','stdout']) {
    const f = await fixture(t), owner = await f.opening;
    if (stream === 'stdin') owner.child.stdin.end(); else owner.child.stdout.destroy();
    await owner.whenClosed; assert.equal((await owner.stop()).stopped, true); assert.equal(f.events.filter(v => v === 'spawn').length, 1);
  }
});

test('refused ownership registration launches no helper and retains a verifiable never-started owner', async t => {
  const f = await fixture(t, { onOwner: async () => { throw Error('registration refused'); } });
  await assert.rejects(f.opening, /registration refused/); assert.equal(f.guardian(), undefined);
  assert.equal((await f.owner().stop()).stopped, true); await f.owner().whenClosed;
});

test('failed independent status verification still retires its original owned query child', async t => {
  for (const statusThrows of [false,true]) {
    const f = await fixture(t, { treeStopped: false, statusProbe: true, statusThrows }), owner = await f.opening;
    await assert.rejects(owner.stop()); const query = f.statusProcess(); assert.ok(query);
    assert.equal(query.exitCode !== null || query.signalCode !== null, true); assert.notEqual(owner.observation().phase, 'stopped');
  }
});

test('actual Windows Job streams an owned Node worker and verifies exact scope retirement', { skip: process.platform !== 'win32' }, async t => {
  const cwd = await mkdtemp(join(tmpdir(), 'syws-')); let owner;
  t.after(async () => { if (owner) assert.equal((await owner.stop()).stopped, true); await rm(cwd, { recursive: true }); });
  const nativePath = resolve('runtime/hotkeys/Switchyard.Hotkeys.exe'), nativeHash = sha(await readFile(nativePath));
  owner = await openWindowsOwnedStdio({ executable: helperPath, args: ['-e', 'process.stdin.on("data",b=>process.stdout.write(b));setInterval(()=>{},1000)'], cwd, expectedExecutableSha256: helperHash,
    signal: new AbortController().signal, assertCurrent: async () => {}, onOwner: async value => { owner = value; }, onReady: async () => {}, onWorker: async () => {}, helper: async () => ({ path: nativePath, sha256: nativeHash }) });
  const bytes = Buffer.from('owned native byte stream '.repeat(2000)), received = bytesFrom(owner.child.stdout, bytes.length);
  await write(owner.child.stdin, bytes); assert.deepEqual(await received, bytes); assert.equal((await owner.stop()).treeExitVerified, true);
  assert.equal((await retireStoppedWindowsStdio(owner.scope, owner.privateOwnership)).guardianExitVerified, true);
  await assert.rejects(retireStoppedWindowsStdio(owner.scope, { ...owner.privateOwnership, requestId: randomUUID() }));
});

test('actual Windows guardian loss retires its original worker Job without adopting another PID', { skip: process.platform !== 'win32' }, async t => {
  const cwd = await mkdtemp(join(tmpdir(), 'sywl-')); let owner, guardian;
  t.after(async () => { if (owner) assert.equal((await owner.stop()).stopped, true); await rm(cwd, { recursive: true }); });
  const nativePath = resolve('runtime/hotkeys/Switchyard.Hotkeys.exe'), nativeHash = sha(await readFile(nativePath));
  owner = await openWindowsOwnedStdio({ executable: helperPath, args: ['-e', 'require("node:child_process").spawn(process.execPath,["-e","setInterval(()=>{},1000)"],{stdio:"ignore"});process.stdout.write("ready");setInterval(()=>{},1000)'], cwd, expectedExecutableSha256: helperHash,
    signal: new AbortController().signal, assertCurrent: async () => {}, onOwner: async value => { owner = value; }, onReady: async () => {}, onWorker: async () => {}, helper: async () => ({ path: nativePath, sha256: nativeHash }),
    spawnProcess: (...args) => { guardian = spawn(...args); return guardian; } });
  assert.equal((await bytesFrom(owner.child.stdout, 5)).toString(), 'ready'); const original = owner.scope;
  guardian.kill(); await owner.whenClosed; assert.equal((await owner.stop()).treeExitVerified, true); assert.deepEqual(owner.scope, original);
});

test('actual Windows parent stop cancels blocked worker input and unacknowledged output', { skip: process.platform !== 'win32' }, async t => {
  const cwd = await mkdtemp(join(tmpdir(), 'sywb-')); let owner;
  t.after(async () => { if (owner) assert.equal((await owner.stop()).stopped, true); await rm(cwd, { recursive: true }); });
  const nativePath = resolve('runtime/hotkeys/Switchyard.Hotkeys.exe'), nativeHash = sha(await readFile(nativePath));
  owner = await openWindowsOwnedStdio({ executable: helperPath, args: ['-e', 'process.stdout.write(Buffer.alloc(65536));setInterval(()=>{},1000)'], cwd, expectedExecutableSha256: helperHash,
    signal: new AbortController().signal, assertCurrent: async () => {}, onOwner: async value => { owner = value; }, onReady: async () => {}, onWorker: async () => {}, helper: async () => ({ path: nativePath, sha256: nativeHash }) });
  const until = Date.now() + 5000; while (owner.child.stdout.readableLength < 32768 && Date.now() < until) await new Promise(r => setTimeout(r, 10));
  assert.equal(owner.child.stdout.readableLength, 32768); const pending = write(owner.child.stdin, Buffer.alloc(65536)), refused = assert.rejects(pending);
  await new Promise(r => setTimeout(r, 50)); assert.equal((await owner.stop()).treeExitVerified, true); await refused;
});
