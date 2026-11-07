/** Persistent Windows Job-owned byte transport. No provider/task authority. */
import { spawn } from 'node:child_process';
import { EventEmitter } from 'node:events';
import { Readable, Writable } from 'node:stream';
import { createHash, randomUUID } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { join, win32 } from 'node:path';
import { fileURLToPath } from 'node:url';
import { verifySuiteRelease } from '../../deployment/suite/release.mjs';
import { desktopEnvironment } from './process-environment.mjs';
import { guardianScope } from './owned-native-command.mjs';
import { runtimeGuardianStopped, runtimeSuspendedWorkerEvidence } from './runtime-command.mjs';
import { stopOwnedChild } from './owned-process.mjs';
import { editorJsonObject } from './editor-websocket-frames.mjs';

const schema = 'switchyard-runtime-command/v1', role = 'owned-stdio', CHUNK = 16384, QUEUE = 2097152;
const exact = (v, keys) => v && typeof v === 'object' && !Array.isArray(v) && Object.keys(v).sort().join() === keys.slice().sort().join();
const require = v => { if (!v) throw Error('The original Windows stdio owner did not verify.'); };
const digest = v => typeof v === 'string' && /^[a-f0-9]{64}$/.test(v);
const uuid = v => typeof v === 'string' && /^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/.test(v) && v !== '00000000-0000-0000-0000-000000000000';
const path = v => typeof v === 'string' && v.isWellFormed() && /^[A-Za-z]:\\/.test(v) && win32.normalize(v) === v && Buffer.byteLength(v) <= 4096
  && !/[\x00-\x1f\x7f<>:"/|?*]/.test(v.slice(3)) && v.slice(3).split('\\').every(p => p && !/[. ]$/.test(p) && !/^(?:CON|PRN|AUX|NUL|COM[1-9]|LPT[1-9])(?:\.|$)/i.test(p));
const deferred = () => { let resolve, reject; const promise = new Promise((a,b) => { resolve = a; reject = b; }); void promise.catch(() => {}); return { promise, resolve, reject }; };

export function windowsOwnedStdioRequest(value) {
  require(exact(value, ['schema','id','role','executable','executableSha256','args','cwd','environment']) && value.schema === schema && value.role === role && uuid(value.id)
    && path(value.executable) && path(value.cwd) && digest(value.executableSha256) && Array.isArray(value.args) && value.args.length <= 256
    && value.args.every(a => typeof a === 'string' && a.isWellFormed() && a.length <= 8192 && !/[\0\r\n]/.test(a)));
  const env = value.environment;
  require(env && typeof env === 'object' && !Array.isArray(env) && Object.keys(env).length <= 64 && new Set(Object.keys(env).map(k => k.toUpperCase())).size === Object.keys(env).length
    && Object.entries(env).every(([k,v]) => /^(?:[A-Za-z_][A-Za-z0-9_]*|ProgramFiles\(x86\)|CommonProgramFiles\(x86\))$/i.test(k) && typeof v === 'string' && v.isWellFormed() && v.length <= 8192 && !v.includes('\0'))
    && JSON.stringify(desktopEnvironment(env)) === JSON.stringify(env) && Buffer.byteLength(JSON.stringify(value)) <= 1048576);
  return Object.freeze({ ...value, args: Object.freeze([...value.args]), environment: Object.freeze({ ...env }) });
}
async function packagedHelper() {
  const root = fileURLToPath(new URL('../../', import.meta.url)), release = await verifySuiteRelease(root); require(!release.development);
  const image = release.files.find(row => row.path === 'runtime/hotkeys/Switchyard.Hotkeys.exe'); require(image);
  return { path: join(root, image.path), sha256: image.sha256 };
}

export async function openWindowsOwnedStdio({ executable, args, cwd, expectedExecutableSha256, assertCurrent, onOwner, onReady, onWorker, signal,
  platform = process.platform, helper = packagedHelper, spawnProcess = spawn, guardianStopped = runtimeGuardianStopped, stopChild = stopOwnedChild } = {}) {
  require(platform === 'win32' && [assertCurrent,onOwner,onReady,onWorker,helper,spawnProcess,guardianStopped,stopChild].every(f => typeof f === 'function') && signal instanceof AbortSignal);
  const request = windowsOwnedStdioRequest({ schema, id: randomUUID(), role, executable, executableSha256: expectedExecutableSha256, args, cwd, environment: desktopEnvironment() });
  const ready = deferred(), exited = deferred(), startup = deferred(), controller = new AbortController(), callbacks = new Set(), statusChildren = new Set();
  let guardian, native, scope, worker, phase = 'reserved', closed = false, helperExited = false, failure, stopping, timer, inputSequence = 0, outputSequence = 0, inputAck, outputAck, writes = 0;
  let buffer = Buffer.alloc(0), frames = Promise.resolve(), pendingFrameBytes = 0;
  const live = () => require(!closed && !signal.aborted && !helperExited);
  const current = async () => { live(); await assertCurrent(); live(); };
  const envelope = fields => ({ schema, id: request.id, role, ...fields });
  const send = fields => { live(); require(guardian && !guardian.stdin.destroyed && guardian.stdin.writableLength <= 65536); guardian.stdin.write(JSON.stringify(envelope(fields)) + '\n'); };
  const child = new EventEmitter(); child.pid = undefined; child.exitCode = null; child.signalCode = null;
  const track = fn => { const work = Promise.resolve().then(fn); callbacks.add(work); void work.then(() => callbacks.delete(work), () => callbacks.delete(work)); return work; };
  const acknowledgeOutput = () => { if (outputAck === undefined || closed) return; const sequence = outputAck; outputAck = undefined; try { send({ event: 'output-ack', sequence }); } catch { fail(); } };
  child.stdout = new Readable({ highWaterMark: 32768, read() { acknowledgeOutput(); }, destroy(error, done) { owner.close(); done(error); } }); child.stdout.on('error', () => {});
  child.stdin = new Writable({ highWaterMark: 32768, write(bytes, _encoding, done) {
    void track(async () => {
      require(bytes.length <= QUEUE && phase === 'running');
      for (let offset = 0; offset < bytes.length; offset += CHUNK) {
        await current(); require(!inputAck && inputSequence < Number.MAX_SAFE_INTEGER - 1);
        const pending = deferred(), sequence = ++inputSequence; inputAck = { sequence, ...pending };
        send({ event: 'input', sequence, bytes: bytes.subarray(offset, offset + CHUNK).toString('base64') });
        await pending.promise; await current();
      }
    }).then(() => done(), error => { fail(); done(error); });
  }, final(done) { owner.close(); done(); }, destroy(error, done) { owner.close(); done(error); } });
  child.stdin.on('error', () => {});
  const originalWrite = child.stdin.write.bind(child.stdin);
  child.stdin.write = (value, encoding, callback) => {
    if (typeof encoding === 'function') { callback = encoding; encoding = undefined; }
    try {
      live(); const size = typeof value === 'string' ? Buffer.byteLength(value, encoding) : value.byteLength;
      require(Number.isSafeInteger(size) && writes < 64 && child.stdin.writableLength + size <= QUEUE); writes++;
      return originalWrite(value, encoding, error => { writes--; callback?.(error); });
    } catch (error) { fail(); if (callback) callback(error); return false; }
  };
  child.kill = () => { owner.close(); return true; };
  const observation = () => Object.freeze({ schema: 'switchyard-windows-owned-stdio/v1', phase, closed, helperExited, workerStarted: phase === 'running' && !closed,
    providerInitialized: false, accountVerified: false, taskLoaded: false, completionVerified: false });
  const owner = Object.freeze({
    child, observation, whenClosed: exited.promise,
    get scope() { return scope && { ...scope }; },
    get worker() { return worker && { ...worker }; },
    get closed() { return closed; },
    close() {
      if (closed) return; closed = true; controller.abort(); clearTimeout(timer); signal.removeEventListener('abort', fail);
      ready.reject(failure ?? Error('The Windows stdio owner stopped.')); inputAck?.reject(Error('The Windows stdio input stopped.')); inputAck = undefined;
      child.stdin.destroy(); child.stdout.push(null);
      try { if (guardian && !guardian.stdin.destroyed) guardian.stdin.end(JSON.stringify(envelope({ event: 'stop' })) + '\n'); } catch {}
      if (!guardian) exited.resolve();
    },
    stop() {
      if (stopping) return stopping; owner.close();
      stopping = (async () => {
        await startup.promise; await Promise.allSettled([...callbacks]); await frames;
        if (guardian) {
          let deadline; try { await Promise.race([exited.promise, new Promise(resolve => { deadline = setTimeout(resolve, 4000); })]); } finally { clearTimeout(deadline); }
          require((await stopChild(guardian)).stopped === true && helperExited);
        }
        let treeStopped = !scope, queriesStopped = true;
        if (scope) try { treeStopped = await guardianStopped(scope, { windowsHelper: native.path, onGuardianChild: child => { statusChildren.add(child); } }); } catch {}
        for (const child of statusChildren) try { if ((await stopChild(child)).stopped !== true) queriesStopped = false; } catch { queriesStopped = false; }
        require(treeStopped === true && queriesStopped);
        phase = 'stopped'; return { stopped: true, helperExitVerified: true, treeExitVerified: true, providerInitialized: false, taskLoaded: false };
      })(); return stopping;
    }
  });
  function fail() { failure ??= Error('The original Windows stdio transport failed.'); owner.close(); }
  async function handle(frame) {
    require(frame.schema === schema && frame.id === request.id && frame.role === role);
    const base = ['schema','id','role','event'];
    if (frame.event === 'stopped') {
      require(exact(frame, [...base,'workerExitCode','treeExitVerified','containment']) && worker && frame.treeExitVerified === true && frame.containment === 'windows-job'
        && Number.isInteger(frame.workerExitCode) && frame.workerExitCode >= 0 && frame.workerExitCode <= 0xffffffff);
      child.exitCode = frame.workerExitCode; owner.close(); return;
    }
    if (closed) return;
    if (frame.event === 'ready') {
      require(phase === 'reserved' && exact(frame, [...base,'guardianPid','birth','containment']) && frame.guardianPid === guardian.pid && frame.containment === 'windows-job');
      scope = guardianScope(frame); phase = 'guardian-ready'; await current(); await onReady(Object.freeze({ ...scope }), owner); await current(); send({ start: true }); return;
    }
    if (frame.event === 'worker-suspended') {
      require(phase === 'guardian-ready'); const { role: _, ...value } = frame;
      const checked = runtimeSuspendedWorkerEvidence(value, { schema, id: request.id, guardianPid: guardian.pid, birth: scope.birth, executableSha256: expectedExecutableSha256 }); require(checked);
      worker = { pid: checked.workerPid, birth: checked.workerBirth, executableSha256: checked.executableSha256 }; child.pid = worker.pid; phase = 'worker-suspended';
      await current(); await onWorker(Object.freeze({ ...worker }), owner); await current();
      send({ workerPid: worker.pid, workerBirth: worker.birth, executableSha256: expectedExecutableSha256, startWorker: true }); return;
    }
    if (frame.event === 'running') {
      require(phase === 'worker-suspended' && exact(frame, [...base,'workerPid','workerBirth']) && frame.workerPid === worker.pid && frame.workerBirth === worker.birth);
      await current(); phase = 'running'; clearTimeout(timer); ready.resolve(); return;
    }
    require(phase === 'running');
    if (frame.event === 'input-ack') {
      require(exact(frame, [...base,'sequence']) && inputAck && frame.sequence === inputAck.sequence); const pending = inputAck; inputAck = undefined; pending.resolve(); return;
    }
    require(frame.event === 'output' && exact(frame, [...base,'sequence','bytes']) && outputAck === undefined && frame.sequence === outputSequence + 1
      && Number.isSafeInteger(frame.sequence) && frame.sequence < Number.MAX_SAFE_INTEGER && typeof frame.bytes === 'string' && frame.bytes.length <= 21848);
    const bytes = Buffer.from(frame.bytes, 'base64'); require(bytes.length > 0 && bytes.length <= CHUNK && bytes.toString('base64') === frame.bytes);
    await current(); outputSequence = frame.sequence; outputAck = frame.sequence; if (child.stdout.push(bytes)) acknowledgeOutput();
  }
  signal.addEventListener('abort', fail, { once: true }); if (signal.aborted) fail();
  try {
    await onOwner(owner); await current(); native = await helper(); require(native && typeof native.path === 'string' && digest(native.sha256));
    const hash = createHash('sha256'); for await (const bytes of createReadStream(native.path)) hash.update(bytes); require(hash.digest('hex') === native.sha256); await current();
    guardian = spawnProcess(native.path, ['--owned-stdio'], { shell: false, windowsHide: true, stdio: ['pipe','pipe','ignore'], env: desktopEnvironment() });
    guardian.stdin.on('error', fail); guardian.on('error', fail);
    guardian.once('close', (code, signal) => { helperExited = true; child.signalCode = signal; child.exitCode ??= code; owner.close(); exited.resolve(); child.emit('close', child.exitCode, signal); });
    guardian.stdout.on('data', bytes => {
      try {
        require(buffer.length + bytes.length + pendingFrameBytes <= 65536); buffer = Buffer.concat([buffer,bytes]); let end;
        while ((end = buffer.indexOf(10)) >= 0) {
          require(end <= 32768); const data = Buffer.from(buffer.subarray(0,end)); buffer = buffer.subarray(end+1); pendingFrameBytes += data.length;
          frames = frames.then(() => handle(editorJsonObject(data))).catch(fail).finally(() => { pendingFrameBytes -= data.length; data.fill(0); });
        }
        require(buffer.length <= 32768);
      } catch { fail(); }
    });
    timer = setTimeout(fail, 30000); guardian.stdin.write(JSON.stringify(request) + '\n');
    await ready.promise; await current(); startup.resolve(); return owner;
  } catch (error) {
    failure ??= error; owner.close(); startup.resolve();
    try { await owner.stop(); } catch { error.retirementUnconfirmed = true; } throw error;
  }
}
