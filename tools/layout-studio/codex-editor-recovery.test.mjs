import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { fileURLToPath } from 'node:url';
import { mkdtemp,mkdir,copyFile,writeFile,readFile,readdir,lstat,unlink,rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { createSuiteStore } from './suite-store.mjs';
import { createCodingEditorConnections } from './coding-editor-connections.mjs';
import { retireStoppedCodexListener } from './codex-owned-listener.mjs';
import { runtimeGuardianStopped } from './runtime-command.mjs';
import { stopOwnedChild } from './owned-process.mjs';
import { codexDesignConfig } from './agents.mjs';
const native={skip:process.platform!=='linux'};
async function until(fn){const end=Date.now()+10000;while(Date.now()<end){const value=await fn();if(value)return value;await new Promise(r=>setTimeout(r,15));}throw Error('The exact crash fixture checkpoint did not settle');}
async function gone(pid){try{const s=await readFile('/proc/'+pid+'/stat','utf8');return s.slice(s.lastIndexOf(') ')+2).split(' ')[0]==='Z';}catch(e){if(['ENOENT','ESRCH'].includes(e.code))return true;throw e;}}
async function fixture(t){
 const root=await mkdtemp(join(tmpdir(),'syerc-')),socketRoot=await mkdtemp(join(tmpdir(),'e-')),providerRoot=join(root,'provider');await mkdir(providerRoot,{mode:0o700});
 await copyFile(new URL('./test-support/codex-owned-listener-fixture.cjs',import.meta.url),join(providerRoot,'app-server'));await writeFile(join(providerRoot,'account'),'synthetic@example.invalid');await writeFile(join(providerRoot,'fixture.json'),JSON.stringify({config:codexDesignConfig(),repositoryRoot:'/synthetic/repository'}));
 const child=spawn(process.execPath,[fileURLToPath(new URL('./test-support/editor-recovery-fixture.mjs',import.meta.url))],{stdio:['pipe','pipe','ignore']});let text='',proof,api;
 child.stdout.on('data',b=>{text+=b;assert.ok(Buffer.byteLength(text)<16384);});child.stdin.end(JSON.stringify({root,socketRoot,providerRoot})+'\n');
 t.after(async()=>{assert.equal((await stopOwnedChild(child)).stopped,true);await api?.close();if(proof){await until(()=>runtimeGuardianStopped(proof.providerScope));assert.equal((await retireStoppedCodexListener(proof.providerScope,proof.providerOwnership)).stopped,true);}
  if(proof){const row=(await store.snapshot('personal')).codingEditorConnections[0];if(row.upstream)await until(()=>gone(row.upstream.pid));if(row.ingress?.pid)await until(()=>gone(row.ingress.pid));}
  await rm(socketRoot,{recursive:true});await rm(root,{recursive:true});});
 proof=await until(()=>{if(child.exitCode!==null || child.signalCode)throw Error('The synthetic editor host exited before readiness.');try{return JSON.parse(text);}catch{return false;}});
 const store=createSuiteStore({root:join(root,'state'),secrets:{get:async()=>Buffer.alloc(32,23).toString('base64'),set:async()=>{throw Error('The fixed synthetic key must exist.');}}});let providerCalls=0;
 api=createCodingEditorConnections({store,root:socketRoot,owners:{openEditorClient(){providerCalls++;throw Error('Recovery must not open a provider.');}},authorizations:{returnTarget(){providerCalls++;throw Error('Recovery must not open account metadata.');}}});
 const row=(await store.snapshot('personal')).codingEditorConnections[0];assert.equal(row.host.pid,child.pid);assert.equal(row.status,'ready');
 async function crash(){
  // EOF can let Python remove its socket before the parent-death SIGKILL.
  // Hold this exact fixture carrier first so the stale-socket crash scenario
  // is deterministic; the kernel still kills a stopped child on parent loss.
  const carrier=()=>readFile(`/proc/${row.ingress.pid}/stat`,'utf8').then(s=>s.slice(s.lastIndexOf(') ')+2).split(' '));
  assert.equal((await carrier())[19],row.ingress.birth);process.kill(row.ingress.pid,'SIGSTOP');
  await until(async()=>{const fields=await carrier();assert.equal(fields[19],row.ingress.birth);return fields[0]==='T';});
  assert.equal((await lstat(proof.opened.endpoint.socketPath)).isSocket(),true);
  const exited=once(child,'close');child.kill('SIGKILL');await exited;for(const pid of [row.upstream.pid,row.ingress.pid])await until(()=>gone(pid));
 }
 return{root,socketRoot,store,api,proof,row,crash,get providerCalls(){return providerCalls;}};
}

test('a live original host is not adopted; abrupt host and carrier loss permits exact stale-socket recovery without a provider call',native,async t=>{
 const f=await fixture(t),before=JSON.stringify((await f.store.snapshot('personal')).codingEditorConnections);
 const blocked=await f.api.recover('personal',f.proof.selected);assert.equal(blocked.recoveryBlocked,true);assert.equal(blocked.stoppedVerified,false);assert.equal(JSON.stringify((await f.store.snapshot('personal')).codingEditorConnections),before);
 await f.crash();assert.equal((await lstat(f.proof.opened.endpoint.socketPath)).isSocket(),true);
 const result=await f.api.recover('personal',f.proof.selected);assert.equal(result.stoppedVerified,true);assert.equal(f.providerCalls,0);assert.deepEqual(await readdir(f.socketRoot),[]);
 const row=(await f.store.snapshot('personal')).codingEditorConnections[0];assert.equal(row.retirement.hostExitVerified,true);assert.equal(row.retirement.upstreamExitVerified,true);assert.equal(row.retirement.carrierExitVerified,true);
 assert.equal((await f.api.recover('personal',f.proof.selected)).duplicatePrevented,true);
});
test('crash recovery preserves a substituted socket and does not upgrade uncertain retirement',native,async t=>{
 const f=await fixture(t);await f.crash();const path=f.proof.opened.endpoint.socketPath;await unlink(path);await writeFile(path,'PRIVATE replacement',{mode:0o600});
 const result=await f.api.recover('personal',f.proof.selected);assert.equal(result.stoppedVerified,false);assert.equal(result.status,'uncertain');assert.equal(await readFile(path,'utf8'),'PRIVATE replacement');assert.equal(f.providerCalls,0);
});
test('crash recovery retires the original socket but preserves unfamiliar directory contents',native,async t=>{
 const f=await fixture(t);await f.crash();const row=f.row;await writeFile(join(row.directory.path,'foreign'),'PRIVATE preserved',{mode:0o600});
 const result=await f.api.recover('personal',f.proof.selected);assert.equal(result.status,'uncertain');const saved=(await f.store.snapshot('personal')).codingEditorConnections[0];assert.equal(saved.retirement.socketRemovedVerified,true);assert.equal(saved.retirement.directoryRemovedVerified,false);assert.equal(await readFile(join(row.directory.path,'foreign'),'utf8'),'PRIVATE preserved');assert.equal(f.providerCalls,0);
});
