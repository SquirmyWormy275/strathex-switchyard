import test from 'node:test';
import assert from 'node:assert/strict';
import { createConnection } from 'node:net';
import { createHash,randomBytes } from 'node:crypto';
import { mkdtemp,lstat,readFile,readlink,readdir,rmdir,rename,writeFile,unlink,copyFile,rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { openCodexEditorIngress } from './codex-editor-ingress.mjs';
import { openOwnedCodexListener } from './codex-owned-listener.mjs';
import { createCodexEditorRelay } from './codex-editor-relay.mjs';
import { codexDesignConfig } from './agents.mjs';
const native={skip:process.platform!=='linux'};
const gate=()=>{let resolve;const promise=new Promise(r=>resolve=r);return{promise,resolve};};
async function until(fn){const deadline=Date.now()+5000;while(Date.now()<deadline){const result=await fn();if(result)return result;await new Promise(r=>setTimeout(r,10));}throw Error('Parent carrier checkpoint did not settle');}
let peerPromise;function peer(){return peerPromise??=(async()=>{const text=await readFile(`/proc/${process.pid}/stat`,'utf8');return{pid:process.pid,birth:text.slice(text.lastIndexOf(') ')+2).split(' ')[19],executable:await readlink(`/proc/${process.pid}/exe`),executableSha256:createHash('sha256').update(await readFile(process.execPath)).digest('hex')};})();}
function frame(value){const data=Buffer.from(JSON.stringify(value));assert.ok(data.length<65536);const mask=Buffer.from([7,11,13,17]);return Buffer.concat([data.length<126?Buffer.from([129,128|data.length]):Buffer.from([129,254,data.length>>8,data.length&255]),mask,Buffer.from(data.map((b,i)=>b^mask[i%4]))]);}
async function fixture(t,options={}){
 const directory=await mkdtemp(join(tmpdir(),'sxep-')),socketPath=join(directory,'s'),records=[],messages=[],abort=new AbortController(),sockets=[];let owner,unconfirmed=false;
 t.after(async()=>{abort.abort();for(const s of sockets)s.destroy();if(owner){if(unconfirmed)await assert.rejects(owner.stop());else await owner.stop();}assert.deepEqual(await readdir(directory),[]);await rmdir(directory);});
 const settings={socketPath,signal:abort.signal,assertCurrent:async()=>{},onOwnership:async o=>records.push(o),onMessage:async m=>messages.push(m),...options};
 async function open(){owner=await openCodexEditorIngress(settings);return owner;}
 async function connect(){const socket=createConnection(socketPath);sockets.push(socket);socket.on('error',()=>{});let bytes=Buffer.alloc(0);socket.on('data',b=>bytes=Buffer.concat([bytes,b]));await new Promise((a,b)=>{socket.once('connect',a);socket.once('error',b);});const key=randomBytes(16).toString('base64');socket.write(`GET / HTTP/1.1\r\nHost: localhost\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Key: ${key}\r\nSec-WebSocket-Version: 13\r\n\r\n`);
  return {socket,receivedBytes:()=>bytes.length,async upgrade(){await until(()=>bytes.includes('\r\n\r\n'));const end=bytes.indexOf('\r\n\r\n');assert.ok(bytes.subarray(0,end).toString().startsWith('HTTP/1.1 101'));bytes=bytes.subarray(end+4);},async message(){return until(()=>{if(bytes.length<2)return false;assert.equal(bytes[1]&128,0);let length=bytes[1]&127,offset=2;if(length===126){if(bytes.length<4)return false;length=bytes.readUInt16BE(2);offset=4;}else if(length===127){if(bytes.length<10)return false;length=Number(bytes.readBigUInt64BE(2));offset=10;}if(bytes.length<offset+length)return false;const result=JSON.parse(bytes.subarray(offset,offset+length));bytes=bytes.subarray(offset+length);return result;});}};
 }
 return{directory,socketPath,records,messages,abort,settings,open,connect,expectUnconfirmedCleanup(){unconfirmed=true;},get owner(){return owner;}};
}

test('parent records intent before binding, pins one peer, joins messages and retires the exact child/socket',native,async t=>{
 const f=await fixture(t),owner=await f.open();assert.deepEqual(f.records.map(x=>x.phase),['reserved','started','ready']);assert.equal(f.records[0].pid,null);assert.ok(f.records[1].pid>0);assert.match(f.records[1].birth,/^[0-9]+$/);assert.equal(owner.observation().peerVerified,false);
 const c=await f.connect();const observation=await owner.pinPeer(await peer());await c.upgrade();assert.equal(observation.peerVerified,true);assert.equal(observation.ideAttached,false);assert.equal(observation.authorityGranted,false);
 c.socket.write(frame({id:1,method:'fixture/read'}));await until(()=>f.messages.length);assert.deepEqual(f.messages,[{id:1,method:'fixture/read'}]);await owner.send({id:1,result:{ok:true}});assert.deepEqual(await c.message(),{id:1,result:{ok:true}});
 const pending=owner.stop();assert.equal(owner.stop(),pending);assert.deepEqual(await pending,{stopped:true,socketRemoved:true,directoryRemoved:false});assert.equal(owner.observation().peerVerified,false);assert.equal(owner.observation().processExitVerified,true);assert.equal(f.records.at(-1).phase,'stopped');await assert.rejects(lstat(f.socketPath),{code:'ENOENT'});
});
test('an exact synthetic terminal peer crosses ingress and a dedicated pinned upstream connection for one acknowledged task',native,async t=>{
 let relay,provider,client;
 const f=await fixture(t,{onMessage:async m=>relay.receive(m)}),root=await mkdtemp(join(tmpdir(),'syrelay-')),repositoryRoot='/synthetic/repository',sessionId='11111111-1111-4111-8111-111111111111',acks=[];
 try{
  await copyFile(new URL('./test-support/codex-owned-listener-fixture.cjs',import.meta.url),join(root,'app-server'));
  await writeFile(join(root,'account'),'synthetic@example.invalid');await writeFile(join(root,'fixture.json'),JSON.stringify({config:codexDesignConfig(),repositoryRoot}));
  provider=await openOwnedCodexListener({executable:process.execPath,cwd:root,runtimeRoot:root});await provider.connect();
  client=await provider.openEditorClient({onClient:async c=>{assert.equal(c.sequence,0);}});
  relay=createCodexEditorRelay({target:{sessionId,repositoryRoot,accountFingerprint:provider.accountFingerprint},client,signal:f.abort.signal,assertCurrent:async()=>{assert.ok(provider.binding);await provider.inspectBinding();},send:async m=>f.owner.send(m),onAcknowledged:async o=>acks.push(o)});
  const ingress=await f.open(),terminal=await f.connect();await ingress.pinPeer(await peer());await terminal.upgrade();
  terminal.socket.write(frame({id:1,method:'initialize',params:{clientInfo:{name:'codex_tui',version:'0.166.0'}}}));assert.equal((await terminal.message()).id,1);
  terminal.socket.write(frame({method:'initialized',params:{}}));await until(()=>relay.observation().phase==='ready');
  const before=(await readFile(join(root,'calls'),'utf8')).trim().split('\n').length;
  terminal.socket.write(frame({id:2,method:'thread/resume',params:{threadId:sessionId,cwd:repositoryRoot,sandbox:'read-only',approvalPolicy:'on-request',excludeTurns:true}}));
  const reply=await terminal.message();assert.equal(reply.id,2);assert.equal(reply.result.thread.id,sessionId);await until(()=>relay.observation().protocolAcknowledged);
  const calls=(await readFile(join(root,'calls'),'utf8')).trim().split('\n');assert.deepEqual(calls.slice(before),['account/read','thread/resume','account/read']);assert.equal(acks.length,1);assert.equal(ingress.observation().peerVerified,true);assert.equal(relay.observation().ideAttached,false);
  terminal.socket.write(frame({id:3,method:'turn/start',params:{threadId:sessionId,input:[{type:'text',text:'NEVER_FORWARD'}]}}));await until(()=>relay.observation().connectionClosed);assert.equal((await readFile(join(root,'calls'),'utf8')).includes('turn/start'),false);
 }finally{
  if(relay)await relay.stop();if(f.owner)await f.owner.stop();if(provider)assert.equal((await provider.stop()).stopped,true);if(client)assert.equal(client.closed,true);await rm(root,{recursive:true});
 }
});

test('early cancellation performs no bind and cancellation joins an outstanding admission callback',native,async t=>{
 const f=await fixture(t);f.abort.abort();await assert.rejects(f.open(),/unavailable|cancelled/);assert.deepEqual(f.records,[]);
 const entered=gate(),release=gate();const g=await fixture(t,{assertCurrent:async()=>{entered.resolve();await release.promise;}});let settled=false;const pending=g.open().finally(()=>settled=true);void pending.catch(()=>{});await entered.promise;g.abort.abort();await new Promise(r=>setImmediate(r));assert.equal(settled,false);release.resolve();await assert.rejects(pending,/unavailable|cancelled/);assert.deepEqual(g.records,[]);
});

test('a spent peer request never retries after wrong identity or lost acknowledgement',native,async t=>{
 const f=await fixture(t),owner=await f.open();await f.connect();await assert.rejects(owner.pinPeer({...await peer(),birth:'1'}),/closed|changed|unavailable/);assert.throws(()=>owner.pinPeer({}),/unavailable/);await owner.stop();assert.equal(f.records.filter(x=>x.phase==='peer-requested').length,1);
});

test('stop joins the in-flight consumer and its cancelled signal without publishing peer attachment',native,async t=>{
 const entered=gate(),release=gate();let observedSignal;const f=await fixture(t,{onMessage:async(_m,signal)=>{observedSignal=signal;entered.resolve();await release.promise;}}),owner=await f.open(),c=await f.connect();await owner.pinPeer(await peer());await c.upgrade();c.socket.write(frame({id:4}));await entered.promise;let stopped=false;const pending=owner.stop().then(x=>{stopped=true;return x;});await until(()=>observedSignal.aborted);assert.equal(stopped,false);release.resolve();await pending;assert.equal(owner.observation().ideAttached,false);
});

test('queued sends copy input before async admission and enforce bounded aggregate storage',native,async t=>{
 const f=await fixture(t),owner=await f.open(),c=await f.connect();await owner.pinPeer(await peer());await c.upgrade();
 // Changing an input after send cannot change queued bytes.
 const message={id:5,result:{value:'original'}},sent=owner.send(message);message.result.value='replacement';await sent;assert.equal((await c.message()).result.value,'original');
 const payload={id:6,result:'x'.repeat(1048500)};const first=owner.send(payload),second=owner.send(payload);assert.throws(()=>owner.send(payload),/unavailable/);await Promise.all([first,second]);assert.equal((await c.message()).result.length,1048500);assert.equal((await c.message()).result.length,1048500);
});

test('substituted socket names refuse parent cleanup and preserve both original and replacement evidence',native,async t=>{
 const f=await fixture(t),owner=await f.open(),c=await f.connect();await owner.pinPeer(await peer());await c.upgrade();const saved=join(f.directory,'original');await rename(f.socketPath,saved);await writeFile(f.socketPath,'replacement',{mode:0o600,flag:'wx'});await assert.rejects(owner.send({id:42,result:'NEVER_FORWARD'}),/changed|unavailable/);const stop=owner.stop();await assert.rejects(stop,/changed|unavailable/);assert.equal(c.receivedBytes(),0);assert.equal(owner.observation().socketCleanupVerified,false);assert.equal(await readFile(f.socketPath,'utf8'),'replacement');assert.equal((await lstat(saved)).isSocket(),true);
 await unlink(f.socketPath);await unlink(saved);
 // A rejected retirement stays rejected. The exact synthetic names above were
 // explicitly checked and retired here; teardown must not retry owner cleanup.
 f.abort.abort();assert.equal(owner.stop(),stop);f.expectUnconfirmedCleanup();
});

test('failed ownership persistence at ready retires the child without delivering an owner',native,async t=>{
 const records=[];const f=await fixture(t,{onOwnership:async o=>{records.push(o);if(o.phase==='ready')throw Error('Synthetic durable record failure');}});await assert.rejects(f.open(),/Synthetic durable record failure/);assert.deepEqual(records.map(x=>x.phase),['reserved','started','ready','stopped']);await assert.rejects(lstat(f.socketPath),{code:'ENOENT'});
});

test('cancellation during peer ownership persistence joins that callback and never publishes readiness',native,async t=>{
 const entered=gate(),release=gate();const f=await fixture(t,{onOwnership:async record=>{if(record.phase==='connected'){entered.resolve();await release.promise;}}}),owner=await f.open();await f.connect();
 const pending=owner.pinPeer(await peer());void pending.catch(()=>{});await entered.promise;assert.equal(owner.observation().peerVerified,false);f.abort.abort();await assert.rejects(pending,/cancelled|stopped|changed/);let stopped=false;const stop=owner.stop().then(v=>{stopped=true;return v;});await new Promise(r=>setImmediate(r));assert.equal(stopped,false);release.resolve();await stop;assert.equal(owner.observation().peerVerified,false);assert.equal(owner.observation().socketCleanupVerified,true);
});
