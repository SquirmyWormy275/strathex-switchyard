import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { createConnection } from 'node:net';
import { createHash, randomBytes } from 'node:crypto';
import { mkdtemp, lstat, readFile, readlink, rmdir, rename, writeFile, unlink } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { stopOwnedChild } from './owned-process.mjs';
import { createCodexEditorProtocol } from './codex-editor-protocol.mjs';
import { codexAccountFingerprint } from './agents.mjs';
const native = { skip: process.platform !== 'linux' };
const script = fileURLToPath(new URL('./codex-editor-ingress.py', import.meta.url));
let identityPromise;
function identity() { return identityPromise ??= (async () => { const text = await readFile(`/proc/${process.pid}/stat`, 'utf8'); return {kind:'peer',pid:process.pid,birth:text.slice(text.lastIndexOf(') ')+2).split(' ')[19],executable:await readlink(`/proc/${process.pid}/exe`),executableSha256:createHash('sha256').update(await readFile(process.execPath)).digest('hex')}; })(); }
async function until(fn) { const deadline=Date.now()+5000; while(Date.now()<deadline){const x=await fn();if(x)return x;await new Promise(r=>setTimeout(r,10));}throw Error('Owned ingress checkpoint did not settle'); }
function frame(data,{opcode=1,final=true,masked=true}={}) { const p=Buffer.isBuffer(data)?data:Buffer.from(JSON.stringify(data));const h=Buffer.alloc(p.length<126?2:p.length<65536?4:10);h[0]=(final?128:0)|opcode;h[1]=(masked?128:0)|(p.length<126?p.length:p.length<65536?126:127);if(h.length===4)h.writeUInt16BE(p.length,2);if(h.length===10)h.writeBigUInt64BE(BigInt(p.length),2);const mask=Buffer.from([11,29,37,53]);return Buffer.concat(masked?[h,mask,Buffer.from(p.map((b,i)=>b^mask[i%4]))]:[h,p]); }
async function fixture(t, change={}, options={}) {
 const root=await mkdtemp(join(tmpdir(),'sxe-')),path=join(root,'s'),d=await lstat(root,{bigint:true}),sockets=[],messages=[];
 const injected = `import os,signal,sys,runpy
original=signal.alarm
zeros=0
def alarm(seconds):
 global zeros
 if seconds==0:
  zeros+=1
  if zeros==2:os.kill(os.getpid(),signal.SIGTERM)
 return original(seconds)
signal.alarm=alarm
sys.argv=[sys.argv[1]]
runpy.run_path(sys.argv[0],run_name='__main__')`;
 const child=spawn('/usr/bin/setpriv',['--no-new-privs','--pdeathsig','KILL','--','/usr/bin/python3','-I','-B',...(options.cleanupSignal?['-c',injected,script]:[script])],{stdio:['pipe','pipe','pipe']});
 let output='',stderr='',exit;const closed=new Promise(r=>child.once('close',(code,signal)=>{exit={code,signal};r(exit);}));child.stdin.on('error',()=>{});child.stdout.setEncoding('utf8');child.stderr.setEncoding('utf8');child.stderr.on('data',x=>stderr+=x);child.stdout.on('data',x=>{output+=x;let end;while((end=output.indexOf('\n'))>=0){messages.push(JSON.parse(output.slice(0,end)));output=output.slice(end+1);}});
 child.stdin.write(JSON.stringify({schema:'switchyard-editor-ingress/v1',parentPid:process.pid,socketPath:path,directoryDevice:String(d.dev),directoryInode:String(d.ino),...change})+'\n');
 t.after(async()=>{for(const s of sockets)s.destroy();child.stdin.end();if(!exit)await stopOwnedChild(child);await closed;assert.equal(stderr,'');await assert.rejects(lstat(path),{code:'ENOENT'});await rmdir(root);});
 const send=value=>child.stdin.write(JSON.stringify(value)+'\n');
 async function connect(peerChange={},headersChange='',partial=false,requestPath='/'){
  await until(()=>messages.find(x=>x.kind==='ready')||exit);assert.equal(exit,undefined);
  const named=await lstat(path,{bigint:true}),ready=messages[0];assert.equal(ready.socketDevice,String(named.dev));assert.equal(ready.socketInode,String(named.ino));assert.equal(Number(named.mode)&0o077,0);
  const socket=createConnection(path);sockets.push(socket);socket.on('error',()=>{});let wire=Buffer.alloc(0),handshake;
  socket.on('data',chunk=>wire=Buffer.concat([wire,chunk]));await new Promise((resolve,reject)=>{socket.once('connect',resolve);socket.once('error',reject);});
  const key=randomBytes(16).toString('base64');socket.write(partial?'GET / HTTP/1.1\r\n':`GET ${requestPath} HTTP/1.1\r\nHost: localhost\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Version: 13\r\nSec-WebSocket-Key: ${key}\r\n${headersChange}\r\n`);
  send({...await identity(),...peerChange});
  async function upgrade(){await until(()=>wire.includes('\r\n\r\n')||exit);assert.equal(exit,undefined);const end=wire.indexOf('\r\n\r\n');handshake=wire.subarray(0,end).toString();wire=wire.subarray(end+4);assert.ok(handshake.startsWith('HTTP/1.1 101'));assert.ok(handshake.includes(createHash('sha1').update(key+'258EAFA5-E914-47DA-95CA-C5AB0DC85B11').digest('base64')));await until(()=>messages.some(x=>x.kind==='peer-verified'));}
  async function nextFrame(){return until(()=>{if(wire.length<2)return false;assert.equal(wire[1]&128,0);let n=wire[1]&127,offset=2;if(n===126){if(wire.length<4)return false;n=wire.readUInt16BE(2);offset=4;}if(n===127){if(wire.length<10)return false;n=Number(wire.readBigUInt64BE(2));offset=10;}if(wire.length<offset+n)return false;const f={opcode:wire[0]&15,data:wire.subarray(offset,offset+n)};wire=wire.subarray(offset+n);return f;});}
  return {socket,upgrade,nextFrame,wire:()=>wire};
 }
 return {root,path,child,closed,messages,send,connect,exit:()=>exit};
}

test('exact kernel peer exchanges Unicode JSON over one bounded masked WebSocket and closes its owned socket',native,async t=>{
 for(const requestPath of ['/','/rpc']){
 const f=await fixture(t),c=await f.connect({},'',false,requestPath);await c.upgrade();c.socket.write(frame({id:1,method:'fixture/read',params:{text:'私用'}}));await until(()=>f.messages.some(x=>x.kind==='message'));assert.deepEqual(f.messages.at(-1),{kind:'message',message:{id:1,method:'fixture/read',params:{text:'私用'}}});
 f.send({kind:'send',message:{id:1,result:{text:'exact'}}});const reply=await c.nextFrame();assert.equal(reply.opcode,1);assert.deepEqual(JSON.parse(reply.data),{id:1,result:{text:'exact'}});
 c.socket.write(frame(Buffer.from([3,232]),{opcode:8}));assert.equal((await c.nextFrame()).opcode,8);assert.deepEqual(await f.closed,{code:0,signal:null});
 assert.equal(f.messages.some(x=>'ideAttached'in x||'protocolAcknowledged'in x),false);
 }
});

test('wrong terminal PID, birth or executable digest receives no upgrade and cannot submit JSON',native,async t=>{
 for(const change of [{pid:process.pid+1},{birth:'1'},{executableSha256:'0'.repeat(64)},{executable:'/unconfirmed'}]){const f=await fixture(t),c=await f.connect(change);assert.equal((await f.closed).code,2);assert.equal(c.wire().length,0);assert.deepEqual(f.messages.map(m=>m.kind),['ready']);}
});

test('fragmented Unicode, extended payload lengths and ping control frames retain message boundaries',native,async t=>{
 const f=await fixture(t),c=await f.connect();await c.upgrade();const bytes=Buffer.from(JSON.stringify({id:2,result:'私用'+ 'x'.repeat(70000)})),split=bytes.indexOf(Buffer.from('私'))+1;
 c.socket.write(frame(bytes.subarray(0,split),{final:false}));c.socket.write(frame(Buffer.from('ping'),{opcode:9}));c.socket.write(frame(bytes.subarray(split),{opcode:0}));const pong=await c.nextFrame();assert.equal(pong.opcode,10);assert.equal(pong.data.toString(),'ping');await until(()=>f.messages.some(x=>x.kind==='message'));assert.deepEqual(f.messages.at(-1).message,JSON.parse(bytes));
 f.send({kind:'send',message:{id:2,result:'y'.repeat(70000)}});assert.equal(JSON.parse((await c.nextFrame()).data).result.length,70000);
});

test('unsupported, unmasked, oversized and malformed JSON frames fail before forwarding contents',native,async t=>{
 const oversized=Buffer.from([129,255,0,0,0,0,0,16,0,1]);
 for(const bytes of [frame({}, {masked:false}),frame({}, {opcode:2}),frame({}, {opcode:0}),oversized,frame(Buffer.from('{"id":1,"id":2}')),frame(Buffer.from([255])),frame(Buffer.from('[]')),frame(Buffer.from([1]),{opcode:8})]){const f=await fixture(t),c=await f.connect();await c.upgrade();c.socket.write(bytes);assert.equal((await f.closed).code,2);assert.equal(f.messages.some(x=>x.kind==='message'),false);}
});

test('handshake extensions, browser origins and duplicate headers fail before peer readiness',native,async t=>{
 for(const path of ['/rpc/','/rpc?token=x','/%72pc','/other']){
  const f=await fixture(t),c=await f.connect({},'',false,path);
  assert.equal((await f.closed).code,2);assert.equal(c.wire().length,0);
  assert.deepEqual(f.messages.map(x=>x.kind),['ready']);
 }
 for(const headers of ['Origin: https://untrusted.invalid\r\n','Sec-WebSocket-Extensions: permessage-deflate\r\n','Sec-WebSocket-Version: 13\r\n']){const f=await fixture(t),c=await f.connect({},headers);assert.equal((await f.closed).code,2);assert.equal(c.wire().length,0);assert.deepEqual(f.messages.map(x=>x.kind),['ready']);}
});

test('wrong directory identity refuses before binding and invalid parent messages retire the original socket',native,async t=>{
 const wrong=await fixture(t,{directoryInode:'1'});assert.equal((await wrong.closed).code,2);assert.deepEqual(wrong.messages,[]);
 const f=await fixture(t),c=await f.connect();await c.upgrade();f.send({kind:'send',message:[],private:'NEVER_RETAIN'});assert.equal((await f.closed).code,2);
});

test('a replaced socket name is preserved and only the original owned socket is retired',native,async t=>{
 const f=await fixture(t),c=await f.connect();await c.upgrade();const moved=join(f.root,'owned-original');await rename(f.path,moved);await writeFile(f.path,'replacement',{flag:'wx',mode:0o600});
 try{c.socket.write(frame({id:3}));assert.equal((await f.closed).code,2);assert.equal(await readFile(f.path,'utf8'),'replacement');assert.equal((await lstat(moved)).isSocket(),true);}finally{await unlink(f.path);await unlink(moved);}
});

test('an unconfirmed peer expires within the fixed handshake deadline and removes the owned socket',native,async t=>{
 const start=Date.now(),f=await fixture(t);await until(()=>f.messages.some(x=>x.kind==='ready'));assert.equal((await f.closed).code,2);assert.ok(Date.now()-start<11000);assert.deepEqual(f.messages.map(x=>x.kind),['ready']);await assert.rejects(lstat(f.path),{code:'ENOENT'});
});

test('abrupt owner loss independently stops the ingress process and preserves exact socket identity for owner cleanup',native,async t=>{
 const root=await mkdtemp(join(tmpdir(),'sxe-loss-')),path=join(root,'s'),d=await lstat(root,{bigint:true});
 const wrapper=`import{spawn}from'node:child_process';const c=spawn('/usr/bin/setpriv',['--no-new-privs','--pdeathsig','KILL','--','/usr/bin/python3','-I','-B',${JSON.stringify(script)}],{stdio:['pipe','pipe','ignore']});c.stdin.on('error',()=>{});c.stdin.write(JSON.stringify({...${JSON.stringify({schema:'switchyard-editor-ingress/v1',socketPath:path,directoryDevice:String(d.dev),directoryInode:String(d.ino)})},parentPid:process.pid})+'\\n');let s='';c.stdout.on('data',b=>{s+=b;const i=s.indexOf('\\n');if(i>=0)console.log(JSON.stringify({childPid:c.pid,...JSON.parse(s.slice(0,i))}));});`;
 const owner=spawn(process.execPath,['--input-type=module','-e',wrapper],{stdio:['ignore','pipe','ignore']});let output='';owner.stdout.on('data',b=>output+=b);const closed=new Promise(r=>owner.once('close',r));let nativePid,named;
 async function state(pid){try{const data=await readFile(`/proc/${pid}/stat`,'utf8');const f=data.slice(data.lastIndexOf(') ')+2).split(' ');return {birth:f[19],state:f[0]};}catch(e){if(['ENOENT','ESRCH'].includes(e.code))return null;throw e;}}
 t.after(async()=>{if(owner.exitCode===null&&owner.signalCode===null)owner.kill('SIGKILL');await closed;if(nativePid)await until(async()=>{const s=await state(nativePid);return !s||s.state==='Z';});if(named){const actual=await lstat(path,{bigint:true});assert.equal(actual.dev,named.dev);assert.equal(actual.ino,named.ino);await unlink(path);}await rmdir(root);});
 const ready=await until(()=>{try{return JSON.parse(output);}catch{return false;}});assert.equal(ready.kind,'ready');nativePid=ready.childPid;named=await lstat(path,{bigint:true});assert.equal(String(named.ino),ready.socketInode);const original=await state(nativePid);assert.ok(original);owner.kill('SIGKILL');await closed;
 await until(async()=>{const current=await state(nativePid);return !current||current.birth===original.birth&&current.state==='Z';});
});

test('explicit owner stop cleans the exact socket without leaking an interpreter traceback',native,async t=>{
 const f=await fixture(t),c=await f.connect();await c.upgrade();f.child.kill('SIGTERM');assert.equal((await f.closed).code,2);await assert.rejects(lstat(f.path),{code:'ENOENT'});
});

test('peer-bound synthetic account and task frames feed the protocol witness without claiming real IDE attachment',native,async t=>{
 const f=await fixture(t),c=await f.connect();await c.upgrade();
 const account={type:'chatgpt',email:'synthetic@example.invalid'},sessionId='11111111-1111-4111-8111-111111111111',repositoryRoot='/synthetic/project';
 const witness=createCodexEditorProtocol({sessionId,repositoryRoot,accountFingerprint:codexAccountFingerprint(account)});let count=0;
 async function exchange(request,result){c.socket.write(frame(request));await until(()=>f.messages.filter(m=>m.kind==='message').length>count);const message=f.messages.filter(m=>m.kind==='message')[count++].message;assert.deepEqual(message,request);assert.equal(witness.client(message),true);const response={id:request.id,result};assert.equal(witness.server(response),true);f.send({kind:'send',message:response});assert.deepEqual(JSON.parse((await c.nextFrame()).data),response);}
 await exchange({id:1,method:'account/read',params:{refreshToken:false}},{account});
 await exchange({id:2,method:'thread/resume',params:{threadId:sessionId,cwd:repositoryRoot,sandbox:'read-only',approvalPolicy:'on-request'}},{thread:{id:sessionId,cwd:repositoryRoot,status:{type:'idle'}},cwd:repositoryRoot,sandbox:{type:'readOnly'},approvalPolicy:'on-request',modelProvider:'openai'});
 assert.equal(witness.observation().protocolAcknowledged,false);await exchange({id:3,method:'account/read',params:{refreshToken:false}},{account});assert.equal(witness.observation().protocolAcknowledged,true);assert.equal(witness.observation().ideAttached,false);assert.equal(witness.observation().authorityGranted,false);
 assert.equal(witness.server({method:'account/updated',params:{authMode:'chatgpt'}}),false);assert.equal(witness.observation().protocolAcknowledged,false);witness.close();
});

test('a deterministic SIGTERM during final cleanup cannot interrupt exact socket retirement',native,async t=>{
 const f=await fixture(t,{}, {cleanupSignal:true}),c=await f.connect();await c.upgrade();f.child.stdin.end();assert.equal((await f.closed).code,0);await assert.rejects(lstat(f.path),{code:'ENOENT'});
});

test('stop interrupts peer identity, accept and partial HTTP waits without relying on input EOF or the eight-second deadline',native,async t=>{
 for(const stage of ['identity','accept','http']){
  const f=await fixture(t);await until(()=>f.messages.some(m=>m.kind==='ready'));
  if(stage==='accept')f.send(await identity());
  if(stage==='http')await f.connect({},'',true);
  const started=Date.now();f.child.kill('SIGTERM');assert.equal((await f.closed).code,2);assert.ok(Date.now()-started<2000);await assert.rejects(lstat(f.path),{code:'ENOENT'});
 }
});
