import test from 'node:test';
import assert from 'node:assert/strict';
import { StudioWindowsNative, type WindowsEditorRuntime } from '../src/studio-windows-native.ts';
import type { WindowsEditorImage, WindowsEditorPeer } from '../src/studio-windows-task-client.ts';
import type { TerminalLike } from '../src/vscode-like.ts';
const image:WindowsEditorImage={path:'C:\\Reviewed\\codex.exe',sha256:'a'.repeat(64),device:'0',inode:'9007199254740993',size:'64'};
const terminal=(processId:PromiseLike<number|undefined>=Promise.resolve(123)):TerminalLike=>({name:'irrelevant title',processId,show(){throw Error('NEVER_FOCUS');},sendText(){throw Error('NEVER_SEND');}});
const selected=()=>({terminal:terminal(),image:{...image},assertCurrent:async()=>{},signal:new AbortController().signal});
function fixture(t:{after:(fn:()=>Promise<unknown>)=>void},options:{inspect?:(context:{signal:AbortSignal;assertCurrent:()=>void|Promise<void>})=>Promise<void>;changedBirth?:boolean;load?:()=>Promise<void>}={}){
  let reads=0,loads=0,closedReader=0,closedProbe=0;const calls:Array<{processId:number;expectedBirth:string|null;image:WindowsEditorImage}>=[];
  const runtime:WindowsEditorRuntime={createEndpointReader:()=>({read:async(path,context)=>{assert.equal(path,'C:\\State\\endpoint.json');await context.assertCurrent();reads++;return '{"synthetic":true}';},close:async()=>{closedReader++;return{stoppedVerified:true,fileModified:false};}}),
    createProcessProbe:()=>({inspect:async(input,context)=>{calls.push(input);await context.assertCurrent();await options.inspect?.(context);return{processId:input.processId,birth:options.changedBirth?'2':input.expectedBirth??'133000000000000001',image:input.image,currentUserVerified:true,currentSessionVerified:true,processAccessMask:0x101000,tokenAccessMask:8,processTerminated:false,windowFocused:false,taskAttached:false,accountVerified:false};},close:async()=>{closedProbe++;return{stoppedVerified:true,targetProcessTerminated:false};}})};
  const service=new StudioWindowsNative({endpointPath:'C:\\State\\endpoint.json',assertCurrent:async()=>{},loadRuntime:async()=>{loads++;await options.load?.();return runtime;}});
  t.after(()=>service.close());return{service,calls,counts:()=>({reads,loads,closedReader,closedProbe})};
}
test('Windows native composition retains its readers and observes only the exact Terminal PID and reviewed image',async t=>{
  const f=fixture(t);assert.equal(await f.service.readEndpoint(),'{"synthetic":true}');const options=selected(),first=await f.service.observeTerminal(options);assert.deepEqual(first,{processId:123,expectedBirth:'133000000000000001',image});assert.equal(f.calls[0].expectedBirth,null);assert.ok(Object.isFrozen(first.image));
  await f.service.observeTerminal({...selected(),expected:first});assert.equal(f.calls[1].expectedBirth,first.expectedBirth);assert.equal(f.counts().loads,1);await f.service.close();assert.deepEqual(f.counts(),{reads:1,loads:1,closedReader:1,closedProbe:1});await assert.rejects(f.service.readEndpoint());
});
test('undefined, replaced or unresolved Terminal PID cannot select another process',async t=>{
  const f=fixture(t);for(const pid of [undefined,0,-1,2147483648])await assert.rejects(f.service.observeTerminal({...selected(),terminal:terminal(Promise.resolve(pid))}));
  const expected:WindowsEditorPeer={processId:124,expectedBirth:'1',image};await assert.rejects(f.service.observeTerminal({...selected(),expected}));assert.equal(f.calls.length,0);
  await assert.rejects(f.service.observeTerminal({...selected(),terminal:terminal(new Promise(()=>{})),timeoutMs:10}));assert.equal(f.calls.length,0);
});
test('changed native birth and context cannot produce a current terminal peer',async t=>{
  const f=fixture(t,{changedBirth:true});await assert.rejects(f.service.observeTerminal({...selected(),expected:{processId:123,expectedBirth:'1',image}}));
  let current=true;const g=fixture(t,{inspect:async()=>{current=false;}});await assert.rejects(g.service.observeTerminal({...selected(),assertCurrent:async()=>assert.ok(current)}));assert.equal(g.calls.length,1);
});
test('shutdown joins the original native observation before retiring its readers',async t=>{
  let enter!:()=>void,release!:()=>void;const entered=new Promise<void>(r=>enter=r),held=new Promise<void>(r=>release=r);
  const f=fixture(t,{inspect:async context=>{enter();await held;assert.equal(context.signal.aborted,true);}}),pending=assert.rejects(f.service.observeTerminal(selected()));await entered;
  let closed=false;const closing=f.service.close().then(()=>{closed=true;});await new Promise(r=>setImmediate(r));assert.equal(closed,false);assert.equal(f.counts().closedProbe,0);release();await pending;await closing;assert.equal(f.counts().closedProbe,1);
});
test('shutdown during runtime loading joins the loader and does not create native readers',async t=>{
  let enter!:()=>void,release!:()=>void;const entered=new Promise<void>(r=>enter=r),held=new Promise<void>(r=>release=r),f=fixture(t,{load:async()=>{enter();await held;}});
  const read=assert.rejects(f.service.readEndpoint());await entered;let closed=false;const closing=f.service.close().then(()=>{closed=true;});await new Promise(r=>setImmediate(r));assert.equal(closed,false);release();await read;await closing;assert.deepEqual(f.counts(),{loads:1,reads:0,closedReader:0,closedProbe:0});
});
