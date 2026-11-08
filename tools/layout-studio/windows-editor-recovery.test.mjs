import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID,createHash } from 'node:crypto';
import { spawn } from 'node:child_process';
import { lstat,readFile,realpath } from 'node:fs/promises';
import { resolve } from 'node:path';
import { createWindowsEditorRecovery } from './windows-editor-recovery.mjs';
import { createWindowsTerminalProcessProbe } from './windows-terminal-process.mjs';
import { queryIntentForOwner } from './windows-query-ownership.mjs';
import { stopOwnedChild } from './owned-process.mjs';

const native={path:'C:\\Synthetic\\Helper.exe',sha256:'e'.repeat(64)};
const scope=()=>({schema:'switchyard-runtime-command/v1',id:randomUUID(),guardianPid:500,birth:'638000000000000001',containment:'windows-job'});
const queryOwner=()=>({schema:'switchyard-windows-query-owner/v1',requestId:randomUUID(),role:'peer',scope:scope(),helper:{...native}});
const host=()=>({schema:'switchyard-editor-terminal-process-result/v1',requestId:randomUUID(),processId:101,birth:'133000000000000001',image:{path:'C:\\Synthetic\\node.exe',sha256:'a'.repeat(64),device:'0',inode:'9',size:'512'},currentUserVerified:true,currentSessionVerified:true,processAccessMask:0x101000,tokenAccessMask:8,processTerminated:false,windowFocused:false,taskAttached:false,accountVerified:false});
const row=()=>({schema:'switchyard-windows-editor-connection/v1',requestId:randomUUID(),host:host(),status:'reserved',queryTracking:'original-helper-intent/v1'});
const withQuery=(r,owner)=>({...r,querySequence:1,lastQueryId:owner.requestId,queryIntent:queryIntentForOwner(owner),queryOwner:{ownership:owner,stopped:false}});
const facts=(hostExitVerified,queryHelpersExitVerified=false)=>({hostExitVerified,clientConnectionRetired:hostExitVerified,carrierExitVerified:hostExitVerified,queryHelpersExitVerified});
const current=async()=>{};
const deferred=()=>{let resolve;return{promise:new Promise(r=>resolve=r),resolve:v=>resolve(v)};};

function fixture(t){
  const f={calls:[],queries:[],saved:[],exited:true,observerStopped:true,queryStopped:true,helperValid:true,afterReady:async()=>{},observedChildren:[],stoppedChildren:[]};
  const service=createWindowsEditorRecovery({platform:'win32',helper:async()=>({...native}),
    command:async(exe,args,config)=>{
      assert.equal(exe,native.path);assert.deepEqual(args,['--native-desktop-owner-v1']);assert.equal(config.timeout,10000);assert.equal(config.captureStderrBytes,0);assert.equal(config.maxOutputBytes,8192);assert.equal(config.expectedExecutableSha256,native.sha256);
      const request=JSON.parse(config.inputText);assert.equal(request.schema,'switchyard-native-focus-owner-query/v1');f.calls.push(request);
      const owned=scope();f.queries.push(owned);await config.onGuardianReady(owned);await f.afterReady(config);
      const proof={schema:'switchyard-native-focus-owner-result/v1',processId:request.processId,processStartTime:request.processStartTime,state:f.exited?'exited':'running',exited:f.exited,processAccessMask:0x101000,tokenAccessMask:8,processTerminated:false,windowFocused:false};
      return{status:'completed',exitCode:0,treeExitVerified:true,inputDelivered:true,stdout:JSON.stringify(f.proof?f.proof(proof):proof)};
    },
    guardianStopped:async(owned,options)=>{
      assert.equal(options.windowsHelper,native.path);const child={id:randomUUID()};f.observedChildren.push(child);options.onGuardianChild(child);
      if(f.queries.some(q=>q.id===owned.id))return f.observerStopped;
      f.saved.push(structuredClone(owned));return f.queryStopped;
    },
    verifySavedHelper:async(h,check)=>{assert.deepEqual(h,native);await check();return f.helperValid;},
    stopChild:async child=>{assert(f.observedChildren.includes(child));f.stoppedChildren.push(child);return{stopped:!f.stopUnknown};}
  });
  f.service=service;t.after(async()=>{f.observerStopped=true;f.stopUnknown=false;await service.close();});return f;
}

test('recovery observes only the original host and saved query Job and independently retires its observers',async t=>{
  const f=fixture(t),original=queryOwner(),r=withQuery(row(),original);f.exited=false;
  assert.deepEqual(await f.service.verify(r,current),facts(false));assert.equal(f.saved.length,0);
  f.exited=true;f.queryStopped=false;assert.deepEqual(await f.service.verify(r,current),facts(true));
  f.queryStopped=true;assert.deepEqual(await f.service.verify(r,current),facts(true,true));assert.deepEqual(f.saved,[original.scope,original.scope]);
  assert(f.calls.every(c=>c.processId===r.host.processId&&c.processStartTime===r.host.birth));assert.deepEqual(f.stoppedChildren,f.observedChildren);
  assert.deepEqual(await f.service.close(),{stoppedVerified:true,observedProcessesTerminated:false});
});

test('unknown startup, legacy checkpoints and unrelated retired queries cannot prove helper retirement',async t=>{
  const f=fixture(t),original=queryOwner(),r=withQuery(row(),original);delete r.queryOwner;
  assert.deepEqual(await f.service.verify(r,current),facts(true));
  r.queryOwner={ownership:queryOwner(),stopped:true};assert.deepEqual(await f.service.verify(r,current),facts(true));
  const legacy=row();delete legacy.queryTracking;assert.deepEqual(await f.service.verify(legacy,current),facts(true,true));
  legacy.status='ready';assert.deepEqual(await f.service.verify(legacy,current),facts(true));
  assert.equal(f.saved.length,0);
});

test('durable no-start and original retirement are sufficient but malformed sequences refuse before native access',async t=>{
  const f=fixture(t),original=queryOwner(),r=withQuery(row(),original);r.queryOwner.stopped=true;r.queryIntent=null;
  assert.deepEqual(await f.service.verify(r,current),facts(true,true));
  delete r.queryOwner;r.queryNotStarted=queryIntentForOwner(original);assert.deepEqual(await f.service.verify(r,current),facts(true,true));assert.equal(f.saved.length,0);
  for(const patch of [{querySequence:0},{querySequence:1000001},{lastQueryId:randomUUID()},{queryNotStarted:null},{querySequence:undefined},{host:{...r.host,tokenAccessMask:10}},{queryTracking:'unknown'}])assert.throws(()=>f.service.verify({...r,...patch},current));
  assert.equal(f.calls.length,2);
});

test('substituted native proof and changed saved helper bytes cannot authorize recovery',async t=>{
  const f=fixture(t),r=withQuery(row(),queryOwner());f.helperValid=false;await assert.rejects(f.service.verify(r,current));assert.equal(f.saved.length,0);
  f.helperValid=true;
  for(const patch of [{processId:102},{processStartTime:'1'},{tokenAccessMask:10},{processTerminated:true},{windowFocused:true},{extra:true}]){f.proof=v=>({...v,...patch});await assert.rejects(f.service.verify(r,current));}
  assert.equal(f.saved.length,0);assert.deepEqual(f.stoppedChildren,f.observedChildren);
});

test('input is copied and current-record checks remain joined through cancellation',async t=>{
  const f=fixture(t),r=row(),entered=deferred(),gate=deferred();let checks=0;
  const pending=f.service.verify(r,async()=>{checks++;if(checks===1){entered.resolve();await gate.promise;}}),rejected=assert.rejects(pending);await entered.promise;
  r.host.processId=999;assert.throws(()=>f.service.verify(row(),current));let closed=false;const closing=f.service.close().then(()=>{closed=true;});await new Promise(r=>setImmediate(r));assert.equal(closed,false);
  gate.resolve();await rejected;await closing;assert.equal(f.calls.length,0);
  const g=fixture(t),input=row(),original=input.host.processId;const work=g.service.verify(input,current);input.host.processId=999;await work;assert.equal(g.calls[0].processId,original);
});

test('unknown observer retirement blocks reuse and cannot become successful recovery',async t=>{
  const f=fixture(t);f.observerStopped=false;await assert.rejects(f.service.verify(row(),current));assert.throws(()=>f.service.verify(row(),current));await assert.rejects(f.service.close());f.observerStopped=true;await f.service.close();
  const g=fixture(t);g.stopUnknown=true;await assert.rejects(g.service.verify(row(),current));assert.throws(()=>g.service.verify(row(),current));g.stopUnknown=false;await g.service.close();
});

test('unsupported platform and stale protected record refuse without spawning an observer',async t=>{
  let calls=0;const unavailable=createWindowsEditorRecovery({platform:'linux',helper:async()=>{calls++;return native;}});assert.throws(()=>unavailable.verify(row(),current));await unavailable.close();assert.equal(calls,0);
  const f=fixture(t);await assert.rejects(f.service.verify(row(),async()=>{throw Error('protected row changed');}));assert.equal(f.calls.length,0);
});

test('actual Windows recovery distinguishes an owned live host from its exit and observes the original completed query Job', {skip:process.platform!=='win32'},async t=>{
  const digest=v=>createHash('sha256').update(v).digest('hex'),executable=await realpath(process.execPath),stat=await lstat(executable,{bigint:true});
  const image={path:executable,sha256:digest(await readFile(executable)),device:String(stat.dev),inode:String(stat.ino),size:String(stat.size)};
  // Capture canonical identity before ownership; package builds use a SUBST
  // drive and saved recovery evidence must never retain that alias.
  const helperPath=await realpath(resolve('runtime/hotkeys/Switchyard.Hotkeys.exe')),helper={path:helperPath,sha256:digest(await readFile(helperPath))};
  const child=spawn(executable,['-e','setInterval(()=>{},1000)'],{stdio:'ignore',windowsHide:true});let original;
  const probe=createWindowsTerminalProcessProbe({helper:async()=>helper,onOwner:async o=>{original=o;}}),recovery=createWindowsEditorRecovery({helper:async()=>helper});
  t.after(async()=>{try{await recovery.close();await probe.close();}finally{assert.equal((await stopOwnedChild(child)).stopped,true);}});
  const hostProof=await probe.inspect({processId:child.pid,expectedBirth:null,image},{assertCurrent:current,signal:new AbortController().signal});
  const r=withQuery({...row(),host:hostProof},original);
  assert.deepEqual(await recovery.verify(r,current),facts(false));assert.equal(child.exitCode,null);
  assert.equal((await stopOwnedChild(child)).stopped,true);assert.deepEqual(await recovery.verify(r,current),facts(true,true));
});
