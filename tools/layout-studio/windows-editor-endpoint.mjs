/** Native read of the private Suite endpoint; no filesystem or identity fallback. */
import { createHash, randomUUID } from 'node:crypto';
import { dirname, win32 } from 'node:path';
import { windowsLocalExecutablePath, packagedWindowsEditorHelper } from './windows-terminal-process.mjs';
import { runOwnedNativeCommand } from './owned-native-command.mjs';
import { runRuntimeCommand, runtimeGuardianStopped } from './runtime-command.mjs';
import { stopOwnedChild } from './owned-process.mjs';
import { desktopEnvironment } from './process-environment.mjs';

const require = value => { if (!value) throw Error('The private Windows Suite endpoint did not verify.'); };
const exact = (value, keys) => value && typeof value === 'object' && !Array.isArray(value) && Object.keys(value).sort().join() === keys.slice().sort().join();
const decimal = (value, zero = false) => typeof value === 'string' && (zero ? /^(0|[1-9][0-9]{0,19})$/ : /^[1-9][0-9]{0,19}$/).test(value) && BigInt(value) <= 0xffffffffffffffffn;
export function windowsEditorEndpointQuery(value) {
  require(exact(value, ['schema','requestId','path']) && value.schema === 'switchyard-editor-endpoint-query/v1'
    && typeof value.requestId === 'string' && /^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/.test(value.requestId) && value.requestId !== '00000000-0000-0000-0000-000000000000'
    && windowsLocalExecutablePath(value.path) && win32.basename(value.path) === 'endpoint.json');
  return Object.freeze({ ...value });
}
export function windowsEditorEndpointResult(value, input) {
  const query = windowsEditorEndpointQuery(input);
  require(exact(value, ['schema','requestId','path','text','sha256','device','inode','size','currentUserVerified','privateAclVerified','tokenAccessMask','fileModified'])
    && value.schema === 'switchyard-editor-endpoint-result/v1' && value.requestId === query.requestId && value.path === query.path
    && value.currentUserVerified === true && value.privateAclVerified === true && value.tokenAccessMask === 8 && value.fileModified === false
    && decimal(value.device,true) && BigInt(value.device) <= 0xffffffffn && decimal(value.inode) && decimal(value.size) && BigInt(value.size) <= 4096n
    && typeof value.text === 'string' && String(Buffer.byteLength(value.text)) === value.size && createHash('sha256').update(value.text).digest('hex') === value.sha256);
  const parsed = JSON.parse(value.text); require(parsed && typeof parsed === 'object' && !Array.isArray(parsed));
  return Object.freeze({ ...value });
}

export function createWindowsEditorEndpointReader({ platform = process.platform, helper = packagedWindowsEditorHelper, command = runRuntimeCommand,
  guardianStopped = runtimeGuardianStopped, stopChild = stopOwnedChild } = {}) {
  require([helper,command,guardianStopped,stopChild].every(fn => typeof fn === 'function'));
  const resource = { clients: new Set(), controller: new AbortController() }, observers = new Set();
  let pending, closed = false, uncertain = false, unrecordedSpawn = false;
  async function retire() {
    const results = await Promise.all([...resource.clients].map(client => client.stop().catch(() => false)));
    const queries = await Promise.all([...observers].map(child => stopChild(child).then(r => r.stopped === true, () => false)));
    require(results.every(Boolean) && queries.every(Boolean) && !unrecordedSpawn);
    resource.clients.clear(); observers.clear();
  }
  return Object.freeze({
    read(path, { assertCurrent, signal } = {}) {
      const query = windowsEditorEndpointQuery({ schema:'switchyard-editor-endpoint-query/v1', requestId:randomUUID(), path });
      require(platform === 'win32' && !closed && !pending && !uncertain && typeof assertCurrent === 'function' && signal instanceof AbortSignal);
      const controller = new AbortController(), abort = () => controller.abort();
      signal.addEventListener('abort',abort,{once:true}); resource.controller.signal.addEventListener('abort',abort,{once:true});
      if (signal.aborted || resource.controller.signal.aborted) abort();
      const current = async () => { require(!closed && !controller.signal.aborted); await assertCurrent(); require(!closed && !controller.signal.aborted); };
      const work = Promise.resolve().then(async () => {
        let owner, text, retired = false;
        try {
          await current(); const native = await helper();
          require(exact(native,['path','sha256']) && windowsLocalExecutablePath(native.path) && /^[a-f0-9]{64}$/.test(native.sha256)); await current();
          const observe = scope => guardianStopped(scope,{windowsHelper:native.path,onGuardianChild:child=>observers.add(child)});
          const result = await runOwnedNativeCommand({ executable:native.path, args:['--editor-endpoint-v1'], cwd:dirname(native.path), env:desktopEnvironment(),
            expectedExecutableSha256:native.sha256, text:JSON.stringify(query)+'\n', resource, signal:controller.signal, timeout:10000, maxOutputBytes:32768, captureStderrBytes:0,
            command:(exe,args,options)=>command(exe,args,{...options,windowsHelper:native.path}), guardianStopped:observe, stopChild,
            onReady:async scope=>{require(scope.containment==='windows-job');owner=scope;await current();},
            onStopped:async scope=>{require(owner && await observe(scope));retired=true;}
          });
          await current(); require(owner && retired && result.status==='completed' && result.exitCode===0);
          text=windowsEditorEndpointResult(JSON.parse(result.stdout),query).text;return text;
        } finally {
          signal.removeEventListener('abort',abort); resource.controller.signal.removeEventListener('abort',abort);
          if (!owner && [...resource.clients].some(client=>!!client.child)) unrecordedSpawn=true;
          try { await retire(); } catch { uncertain=true; throw Error('The original Windows endpoint reader has not verified complete retirement.'); }
          if(text!==undefined)await current();
        }
      });
      pending=work; void work.then(()=>{pending=undefined;},()=>{pending=undefined;}); return work;
    },
    async close() { closed=true;resource.controller.abort();await pending?.catch(()=>{});await retire();return {stoppedVerified:true,fileModified:false}; }
  });
}
