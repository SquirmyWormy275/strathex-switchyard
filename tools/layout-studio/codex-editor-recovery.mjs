/** Retire recorded editor names after original host/carrier exit. Never signal or adopt a PID. */
import { lstat,readFile,realpath,readdir,unlink,rmdir } from 'node:fs/promises';
import { posix } from 'node:path';
const require=v=>{if(!v)throw Error('The original editor recovery identities did not verify.');};
const keys=(v,n)=>v && typeof v==='object' && !Array.isArray(v) && Object.keys(v).sort().join()===[...n].sort().join();
const uuid=v=>typeof v==='string' && /^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/.test(v);
const identity=s=>({device:String(s.dev),inode:String(s.ino),uid:String(s.uid),mode:String(s.mode)});
const same=(a,b)=>a && b && ['device','inode','uid','mode'].every(k=>a[k]===b[k]);
const originalProcess=v=>v && Number.isSafeInteger(v.pid) && v.pid>0 && v.pid<=2147483647 && typeof v.birth==='string' && /^[1-9][0-9]{0,19}$/.test(v.birth);
async function gone(expected) {
  require(originalProcess(expected));
  try{const text=await readFile('/proc/'+expected.pid+'/stat','utf8');require(Buffer.byteLength(text)<=8192);const fields=text.slice(text.lastIndexOf(') ')+2).trim().split(/\s+/);return fields[19]!==expected.birth || fields[0]==='Z';}
  catch(error){if(['ENOENT','ESRCH'].includes(error.code))return true;throw error;}
}
async function privateDirectory(path,expected) {
  const s=await lstat(path,{bigint:true});require(s.isDirectory() && !s.isSymbolicLink() && s.uid===BigInt(process.getuid()) && !(s.mode&0o077n) && same(identity(s),expected) && await realpath(path)===path);
}
export async function retireStoppedEditorConnection({root,row,beforeEffect}={}) {
  require(process.platform==='linux' && typeof beforeEffect==='function' && typeof root==='string' && posix.isAbsolute(root) && posix.normalize(root)===root && row?.schema==='switchyard-editor-connection/v1' && uuid(row.requestId));
  const facts={hostExitVerified:false,upstreamExitVerified:false,carrierExitVerified:false,socketRemovedVerified:false,directoryRemovedVerified:false};
  const host=row.host;if(!keys(host,['pid','birth','uid','bootId']) || !originalProcess(host) || host.uid!==String(process.getuid()) || !uuid(host.bootId))return facts;
  const boot=(await readFile('/proc/sys/kernel/random/boot_id','utf8')).trim();require(uuid(boot));const previousBoot=host.bootId!==boot;
  facts.hostExitVerified=previousBoot || await gone(host);if(!facts.hostExitVerified)return facts;
  // An unrecorded spawn window has no exact process witness. Preserve it.
  facts.upstreamExitVerified=row.upstream ? previousBoot || await gone(row.upstream) : ['reserved','directory-planned'].includes(row.status);
  facts.carrierExitVerified=row.ingress ? originalProcess(row.ingress) && (previousBoot || await gone(row.ingress)) : !['ingress-reserved','ingress-started','ready','peer-pinned','peer-requested','connected','acknowledged'].includes(row.status);
  if(!facts.upstreamExitVerified || !facts.carrierExitVerified)return facts;
  if(row.status==='reserved' && !row.directoryIntent && !row.directory){facts.socketRemovedVerified=true;facts.directoryRemovedVerified=true;return facts;}
  const intent=row.directoryIntent,path=posix.join(root,row.requestId);
  require(intent?.path===path && intent.parent?.path===root && Buffer.byteLength(path+'/s')<=100);
  await beforeEffect();await privateDirectory(root,intent.parent.identity);
  try{await lstat(path);}catch(error){if(error.code!=='ENOENT')throw error;facts.socketRemovedVerified=true;facts.directoryRemovedVerified=true;return facts;}
  if(!row.directory || row.directory.path!==path)return facts;
  await privateDirectory(path,row.directory.identity);
  const socket=path+'/s';
  try{
    const s=await lstat(socket,{bigint:true});
    if(!row.ingress?.socketIdentity || row.ingress.socketPath!==socket || !s.isSocket() || s.isSymbolicLink() || !same(identity(s),row.ingress.socketIdentity))return facts;
    const active=(await readFile('/proc/net/unix','utf8')).split('\n').some(line=>line.trim().split(/\s+/).at(-1)===socket);if(active)return facts;
    await beforeEffect();await privateDirectory(root,intent.parent.identity);await privateDirectory(path,row.directory.identity);require(same(identity(await lstat(socket,{bigint:true})),row.ingress.socketIdentity));await unlink(socket);
    facts.socketRemovedVerified=true;
  }catch(error){if(error.code!=='ENOENT')throw error;facts.socketRemovedVerified=true;}
  if((await readdir(path)).length!==0)return facts;
  await beforeEffect();await privateDirectory(root,intent.parent.identity);await privateDirectory(path,row.directory.identity);require((await readdir(path)).length===0);await rmdir(path);facts.directoryRemovedVerified=true;return facts;
}
