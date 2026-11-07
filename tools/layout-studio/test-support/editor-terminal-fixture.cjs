// Synthetic terminal protocol only. No installed CLI, account or model access.
const {createConnection}=require('node:net');
const {randomBytes}=require('node:crypto');
const [path,threadId,cwd]=process.argv.slice(2);
if(!path||!threadId||!cwd)throw Error('Synthetic terminal arguments are missing');
const socket=createConnection(path);let bytes=Buffer.alloc(0),upgraded=false,initialized=false;
const fail=()=>{process.exitCode=2;socket.destroy();};socket.on('error',fail);
function send(message){const b=Buffer.from(JSON.stringify(message)),mask=randomBytes(4);if(b.length>65535)throw Error('Synthetic frame exceeds its bound');socket.write(Buffer.concat([b.length<126?Buffer.from([129,128|b.length]):Buffer.from([129,254,b.length>>8,b.length&255]),mask,Buffer.from(b.map((v,i)=>v^mask[i%4]))]));}
socket.once('connect',()=>socket.write('GET / HTTP/1.1\r\nHost: localhost\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Key: '+randomBytes(16).toString('base64')+'\r\nSec-WebSocket-Version: 13\r\n\r\n'));
socket.on('data',chunk=>{
 try{
  bytes=Buffer.concat([bytes,chunk]);if(bytes.length>1048576)throw Error('Synthetic response exceeds its bound');
  if(!upgraded){const end=bytes.indexOf('\r\n\r\n');if(end<0)return;if(!bytes.subarray(0,end).toString().startsWith('HTTP/1.1 101'))throw Error('Synthetic upgrade refused');bytes=bytes.subarray(end+4);upgraded=true;send({id:1,method:'initialize',params:{clientInfo:{name:'codex_tui',version:'0.166.0'}}});}
  while(bytes.length>=2){if((bytes[1]&128)||bytes[0]!==129)throw Error('Unexpected synthetic response frame');let size=bytes[1]&127,offset=2;if(size===126){if(bytes.length<4)return;size=bytes.readUInt16BE(2);offset=4;}if(size===127){if(bytes.length<10)return;size=Number(bytes.readBigUInt64BE(2));offset=10;}if(!Number.isSafeInteger(size)||size>1048576)throw Error('Synthetic response exceeds its bound');if(bytes.length<offset+size)return;const message=JSON.parse(bytes.subarray(offset,offset+size));bytes=bytes.subarray(offset+size);
   if(message.id===1&&!initialized){if(!message.result||message.error)throw Error('Synthetic initialization failed');initialized=true;send({method:'initialized',params:{}});send({id:2,method:'thread/resume',params:{threadId,cwd,sandbox:'read-only',approvalPolicy:'on-request',excludeTurns:true}});}
   else if(message.id===2){if(message.result?.thread?.id!==threadId||message.result?.thread?.cwd!==cwd||message.error)throw Error('Synthetic exact resume failed');}
   else if(message.method!=='thread/status/changed')throw Error('Unexpected synthetic response');
  }
 }catch{fail();}
});
