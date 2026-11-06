import test from 'node:test';
import assert from 'node:assert/strict';
import { createConnection } from 'node:net';
import { createHash,randomBytes,randomUUID } from 'node:crypto';
import { mkdtemp,mkdir,copyFile,writeFile,readFile,readlink,readdir,chmod,unlink,rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { createSuiteStore } from './suite-store.mjs';
import { createCodingEditorAuthorizations } from './coding-editor-authorizations.mjs';
import { createCodingEditorConnections } from './coding-editor-connections.mjs';
import { openOwnedCodexListener } from './codex-owned-listener.mjs';
import { codexDesignConfig } from './agents.mjs';
const native={skip:process.platform!=='linux'};
const hash=v=>createHash('sha256').update(JSON.stringify(v)).digest('hex');
const gate=()=>{let resolve;const promise=new Promise(r=>resolve=r);return{promise,resolve};};
async function until(fn){const end=Date.now()+7000;while(Date.now()<end){const value=await fn();if(value)return value;await new Promise(r=>setTimeout(r,10));}throw Error('The composed editor checkpoint did not settle');}
async function gone(pid){try{const text=await readFile('/proc/'+pid+'/stat','utf8');return text.slice(text.lastIndexOf(') ')+2).split(' ')[0]==='Z';}catch(error){if(error.code==='ENOENT')return true;throw error;}}
let peerPromise;function peer(){return peerPromise??=(async()=>{const text=await readFile('/proc/'+process.pid+'/stat','utf8');return{pid:process.pid,birth:text.slice(text.lastIndexOf(') ')+2).split(' ')[19],executable:await readlink('/proc/'+process.pid+'/exe'),executableSha256:createHash('sha256').update(await readFile(process.execPath)).digest('hex')};})();}
function frame(value){const b=Buffer.from(JSON.stringify(value));assert.ok(b.length<65536);const mask=Buffer.from([1,7,13,19]);return Buffer.concat([b.length<126?Buffer.from([129,128|b.length]):Buffer.from([129,254,b.length>>8,b.length&255]),mask,Buffer.from(b.map((v,i)=>v^mask[i%4]))]);}
async function terminal(path,sockets){const socket=createConnection(path);sockets.push(socket);socket.on('error',()=>{});let bytes=Buffer.alloc(0);socket.on('data',b=>bytes=Buffer.concat([bytes,b]));await new Promise((r,j)=>{socket.once('connect',r);socket.once('error',j);});socket.write('GET / HTTP/1.1\r\nHost: localhost\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Key: '+randomBytes(16).toString('base64')+'\r\nSec-WebSocket-Version: 13\r\n\r\n');return{
 send:m=>socket.write(frame(m)),async upgrade(){await until(()=>bytes.includes('\r\n\r\n'));const end=bytes.indexOf('\r\n\r\n');assert.ok(bytes.subarray(0,end).toString().startsWith('HTTP/1.1 101'));bytes=bytes.subarray(end+4);},async message(){return until(()=>{if(bytes.length<2)return;assert.equal(bytes[1]&128,0);let size=bytes[1]&127,offset=2;if(size===126){if(bytes.length<4)return;size=bytes.readUInt16BE(2);offset=4;}if(size===127){if(bytes.length<10)return;size=Number(bytes.readBigUInt64BE(2));offset=10;}if(bytes.length<offset+size)return;const message=JSON.parse(bytes.subarray(offset,offset+size));bytes=bytes.subarray(offset+size);return message;});}
};}
async function fixture(t){
 const root=await mkdtemp(join(tmpdir(),'syec-')),socketRoot=await mkdtemp('/tmp/syec-'),providerRoot=join(root,'provider'),keys=new Map(),services=[],sockets=[];await mkdir(providerRoot,{mode:0o700});
 await copyFile(new URL('./test-support/codex-owned-listener-fixture.cjs',import.meta.url),join(providerRoot,'app-server'));await writeFile(join(providerRoot,'account'),'synthetic@example.invalid');await writeFile(join(providerRoot,'fixture.json'),JSON.stringify({config:codexDesignConfig(),repositoryRoot:'/synthetic/repository'}));
 const provider=await openOwnedCodexListener({executable:process.execPath,cwd:providerRoot,runtimeRoot:providerRoot}),control=await provider.connect();
 const store=createSuiteStore({root:join(root,'state'),secrets:{get:async(c,p)=>keys.get(c+p),set:async(c,p,v)=>keys.set(c+p,v)}});await store.initialize('personal');await store.update('personal','fixture',s=>{s.mode='personal-companion';});
 const selected={requestId:randomUUID(),editorId:randomUUID(),ownerRequestId:randomUUID(),loadRequestId:randomUUID()},target={schema:'switchyard-codex-editor-target/v1',ownerRequestId:selected.ownerRequestId,loadRequestId:selected.loadRequestId,taskId:randomUUID(),sessionId:randomUUID(),repositoryRoot:'/synthetic/repository',repositoryIdentity:{device:'1',inode:'2'},accountFingerprint:provider.accountFingerprint,permissions:'read-only/on-request',endpoint:await provider.inspectBinding()};
 let active=true,hook=async()=>{},bridges=0,uncertain=false;
 const owners={async editorTarget(){await control.recheckAccount();assert.deepEqual(await provider.inspectBinding(),target.endpoint);return{target:structuredClone(target),targetDigest:hash(target),metadataObserved:true,nativeLoadAcknowledged:true,nativeTaskLoaded:false,authorityGranted:false,terminalLaunched:false,ideAttached:false,modelPromptSubmitted:false,completionVerified:false};},async openEditorClient(_c,s,{onClient}){assert.equal(s.ownerRequestId,selected.ownerRequestId);bridges++;return provider.openEditorClient({onClient:async client=>{await hook();await onClient(client);}});}};owners.editorReturnTarget=owners.editorTarget;
 const authorizations=createCodingEditorAuthorizations({store,owners,isActive:async()=>active});const review=await authorizations.review('personal',selected),issued=await authorizations.issue('personal',{...selected,token:review.confirmation.token});await authorizations.consume('personal',{...selected,permit:issued.permit});
 const service=()=>{const api=createCodingEditorConnections({store,authorizations,owners,root:socketRoot});services.push(api);return api;},api=service();
 t.after(async()=>{hook=async()=>{};for(const socket of sockets)socket.destroy();const results=await Promise.all(services.map(s=>s.close()));if(!uncertain)assert.ok(results.every(r=>r.stopped));await authorizations.close();assert.equal((await provider.stop()).stopped,true);
  for(const row of (await store.snapshot('personal')).codingEditorConnections??[]){if(row.upstream)assert.equal(await gone(row.upstream.pid),true);if(row.ingress?.pid)assert.equal(await gone(row.ingress.pid),true);}
  if(!uncertain)assert.deepEqual(await readdir(socketRoot),[]);await rm(socketRoot,{recursive:true});await rm(root,{recursive:true});});
 return{api,service,selected,target,store,socketRoot,providerRoot,provider,async open(){return api.open('personal',selected);},async connect(endpoint){const t=await terminal(endpoint.socketPath,sockets);await api.pinPeer('personal',selected,await peer());await t.upgrade();return t;},get bridges(){return bridges;},set active(v){active=v;},set hook(v){hook=v;},expectUncertain(){uncertain=true;}};
}

test('protected reservation, real ingress and pinned provider compose through acknowledgement and exact retirement',native,async t=>{
 const f=await fixture(t),opened=await f.open();assert.equal(opened.status,'ready');const row=(await f.store.snapshot('personal')).codingEditorConnections[0];assert.equal(row.status,'ready');assert.equal(row.directoryIntent.path,row.directory.path);assert.ok(row.upstream.pid>0);assert.ok(row.ingress.pid>0);
 const terminal=await f.connect(opened.endpoint);terminal.send({id:1,method:'initialize',params:{clientInfo:{name:'codex_tui',version:'0.166.0'}}});assert.equal((await terminal.message()).id,1);terminal.send({method:'initialized',params:{}});
 terminal.send({id:2,method:'thread/resume',params:{threadId:f.target.sessionId,cwd:f.target.repositoryRoot,sandbox:'read-only',approvalPolicy:'on-request',excludeTurns:true}});assert.equal((await terminal.message()).result.thread.id,f.target.sessionId);
 await until(async()=>(await f.api.observe('personal',f.selected)).protocolAcknowledged);const saved=(await f.store.snapshot('personal')).codingEditorConnections[0];assert.equal(saved.status,'acknowledged');assert.equal(saved.acknowledgement.accountAfterVerified,true);assert.equal(saved.peer.pid,process.pid);
 const stopped=await f.api.stop('personal',f.selected);assert.equal(stopped.stoppedVerified,true);assert.deepEqual(await readdir(f.socketRoot),[]);assert.equal((await f.api.open('personal',f.selected)).endpoint,undefined);
});
test('a second host cannot obtain another endpoint for the same consumed selection',native,async t=>{
 const f=await fixture(t),other=f.service();const results=await Promise.all([f.open(),other.open('personal',f.selected)]);assert.equal(results.filter(r=>r.endpoint).length,1);assert.equal(results.filter(r=>r.duplicatePrevented).length,1);assert.equal(f.bridges,1);
});
test('workspace stop joins its exact carrier and bridge without replaying the consumed review',native,async t=>{
 const f=await fixture(t);await f.open();const a=f.api.stopCompartment('personal'),b=f.api.stopCompartment('personal');assert.equal(a,b);assert.equal((await a).stopped,true);
 assert.deepEqual(await readdir(f.socketRoot),[]);assert.equal((await f.store.snapshot('personal')).codingEditorConnections[0].status,'stopped');assert.equal((await f.open()).endpoint,undefined);assert.equal(f.bridges,1);
});
test('foreign peer bytes are refused before pinning and the exact unused carrier retires',native,async t=>{
 const f=await fixture(t);await f.open();await assert.rejects(f.api.pinPeer('personal',f.selected,{...await peer(),executableSha256:'0'.repeat(64)}));
 const row=(await f.store.snapshot('personal')).codingEditorConnections[0];assert.equal(row.status,'stopped');assert.equal(row.peer,undefined);assert.deepEqual(await readdir(f.socketRoot),[]);
});
test('close joins a pending upstream registration and prevents any editor protocol request',native,async t=>{
 const f=await fixture(t),entered=gate(),release=gate();f.hook=async()=>{entered.resolve();await release.promise;};const opening=f.open(),rejected=assert.rejects(opening);await entered.promise;
 let closed=false;const closing=f.api.close().then(r=>{closed=true;return r;});await new Promise(r=>setImmediate(r));assert.equal(closed,false);release.resolve();await rejected;assert.equal((await closing).stopped,true);
 const calls=await readFile(join(f.providerRoot,'calls'),'utf8');assert.equal(calls.includes('thread/resume'),false);assert.deepEqual(await readdir(f.socketRoot),[]);
});
test('a substituted socket is preserved and retirement remains uncertain',native,async t=>{
 const f=await fixture(t),opened=await f.open();await unlink(opened.endpoint.socketPath);await writeFile(opened.endpoint.socketPath,'PRIVATE replacement',{mode:0o600});f.expectUncertain();
 await assert.rejects(f.api.pinPeer('personal',f.selected,await peer()));assert.equal(await readFile(opened.endpoint.socketPath,'utf8'),'PRIVATE replacement');
 const row=(await f.store.snapshot('personal')).codingEditorConnections[0];assert.equal(row.status,'uncertain');assert.equal(row.retirement.directoryRemovedVerified,false);assert.equal((await f.api.close()).stopped,false);
});
test('inactive workspace or an unprivate socket parent prevents a new reservation or native bridge',native,async t=>{
 const f=await fixture(t);f.active=false;await assert.rejects(f.open());assert.equal(f.bridges,0);assert.equal((await f.store.snapshot('personal')).codingEditorConnections,undefined);assert.deepEqual(await readdir(f.socketRoot),[]);
 f.active=true;await chmod(f.socketRoot,0o755);try{await assert.rejects(f.open());assert.equal(f.bridges,0);assert.equal((await f.store.snapshot('personal')).codingEditorConnections,undefined);}finally{await chmod(f.socketRoot,0o700);}
});
