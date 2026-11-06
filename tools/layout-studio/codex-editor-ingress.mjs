/** Parent lifecycle for one internal editor carrier. No provider or task selection. */
import { spawn } from 'node:child_process';
import { lstat, readFile, realpath, unlink } from 'node:fs/promises';
import { dirname, isAbsolute, normalize } from 'node:path';
import { fileURLToPath } from 'node:url';
import { stopOwnedChild } from './owned-process.mjs';

const MAX = 1048576, LIMIT = MAX + 65536;
const object = x => x !== null && typeof x === 'object' && !Array.isArray(x);
const require = value => { if (!value) throw Error('The original editor carrier is unavailable or changed.'); };
const identity = s => Object.freeze({ device: String(s.dev), inode: String(s.ino), uid: String(s.uid), mode: String(s.mode) });
const same = (a,b) => a && b && ['device','inode','uid','mode'].every(k=>a[k]===b[k]);
const deferred = () => { let resolve,reject;const promise=new Promise((a,b)=>{resolve=a;reject=b;});void promise.catch(()=>{});return {promise,resolve,reject}; };

export async function openCodexEditorIngress({ socketPath, assertCurrent, onOwnership, onMessage, signal } = {}) {
  require(process.platform==='linux' && typeof socketPath==='string' && isAbsolute(socketPath) && normalize(socketPath)===socketPath && Buffer.byteLength(socketPath)<=100 && !/[\x00-\x1f\x7f]/.test(socketPath));
  require(typeof assertCurrent==='function' && typeof onOwnership==='function' && typeof onMessage==='function' && signal instanceof AbortSignal);
  const directory=dirname(socketPath), uid=BigInt(process.getuid());
  const dir=await lstat(directory,{bigint:true});require(dir.isDirectory() && !dir.isSymbolicLink() && dir.uid===uid && !(dir.mode&0o077n) && await realpath(directory)===directory);
  const directoryIdentity=identity(dir);
  try { await lstat(socketPath); throw Error('The editor socket name already exists.'); } catch(error){if(error.code!=='ENOENT')throw error;}
  let child, childBirth, childExited=false, phase='reserved', peerAttempted=false, peerVerified=false, closed=false, failure, socketIdentity, stopPending, pump=Promise.resolve(), timer, queuedBytes=0, ownershipAttempted=false;
  const ready=deferred(), peer=deferred(), exited=deferred(), operations=new Set(), controller=new AbortController();
  const live=()=>{require(!closed&&!failure&&!signal.aborted&&!childExited);};
  const admission=async()=>{live();await assertCurrent();live();require(same(identity(await lstat(directory,{bigint:true})),directoryIdentity));if(socketIdentity){const named=await lstat(socketPath,{bigint:true});require(named.isSocket()&&!named.isSymbolicLink()&&same(identity(named),socketIdentity));}live();};
  const ownership=()=>Object.freeze({schema:'switchyard-editor-ingress-owner/v1',phase,directory,directoryIdentity:{...directoryIdentity},socketPath,socketIdentity:socketIdentity&&{...socketIdentity},pid:child?.pid??null,birth:childBirth??null});
  const track=fn=>{require(operations.size<64);const work=Promise.resolve().then(fn);operations.add(work);void work.then(()=>operations.delete(work),()=>operations.delete(work));return work;};
  function fail(error){failure??=error instanceof Error?error:Error('The editor carrier failed.');owner.close();}
  async function write(value){const text=JSON.stringify(value);require(typeof text==='string'&&Buffer.byteLength(text)<=LIMIT);await new Promise((resolve,reject)=>{child.stdin.write(text+'\n',error=>error?reject(Error('The editor carrier input closed.')):resolve());});}
  const owner=Object.freeze({
    get privateOwnership(){return ownership();},
    observation(){return Object.freeze({schema:'switchyard-editor-ingress-observation/v1',phase,peerVerified:peerVerified&&!closed&&!childExited&&!failure,processExitVerified:childExited,socketCleanupVerified:phase==='stopped',protocolAcknowledged:false,ideAttached:false,authorityGranted:false});},
    pinPeer(input){
      // Spend synchronously. A lost reply or changed selection never retries.
      require(!peerAttempted);peerAttempted=true;
      let selected;
      try { require(object(input)&&Object.keys(input).sort().join()==='birth,executable,executableSha256,pid');selected=Object.freeze({...input});
        require(Number.isSafeInteger(selected.pid)&&selected.pid>0&&selected.pid<=2147483647&&typeof selected.birth==='string'&&/^[1-9][0-9]{0,19}$/.test(selected.birth));
        require(typeof selected.executable==='string'&&isAbsolute(selected.executable)&&normalize(selected.executable)===selected.executable&&Buffer.byteLength(selected.executable)<=4096&&!/[\x00-\x1f\x7f]/.test(selected.executable)&&typeof selected.executableSha256==='string'&&/^[a-f0-9]{64}$/.test(selected.executableSha256));
      } catch(error){fail(error);return Promise.reject(error);}
      return track(async()=>{try{await admission();require(phase==='ready');phase='peer-requested';await onOwnership(ownership());await admission();await write({kind:'peer',...selected});await peer.promise;await admission();require(peerVerified);return owner.observation();}catch(error){fail(error);throw error;}});
    },
    send(message){
      live();require(peerVerified&&object(message));const text=JSON.stringify(message),size=Buffer.byteLength(text);require(size<=MAX&&queuedBytes+size<=2*MAX&&operations.size<64);const copied=JSON.parse(text);require(object(copied));queuedBytes+=size;
      return track(async()=>{try{await admission();require(peerVerified);await write({kind:'send',message:copied});await admission();}catch(error){fail(error);throw error;}finally{queuedBytes-=size;}});
    },
    close(){if(closed)return;closed=true;controller.abort();clearTimeout(timer);signal.removeEventListener('abort',abort);ready.reject(failure??Error('The editor carrier was stopped.'));peer.reject(failure??Error('The editor carrier was stopped.'));child?.stdin.end();},
    stop(){
      if(stopPending)return stopPending;owner.close();
      stopPending=(async()=>{
        if(child){require((await stopOwnedChild(child)).stopped);await exited.promise;}
        await Promise.allSettled([...operations]);await pump;
        require(same(identity(await lstat(directory,{bigint:true})),directoryIdentity)&&await realpath(directory)===directory);
        // Never search for or delete a name whose original socket identity was
        // not acknowledged. Abrupt loss before ready preserves uncertainty.
        try{const s=await lstat(socketPath,{bigint:true});require(childExited&&socketIdentity&&s.isSocket()&&!s.isSymbolicLink()&&same(identity(s),socketIdentity));
          const lines=(await readFile('/proc/net/unix','utf8')).split('\n');require(!lines.some(line=>line.trim().split(/\s+/).at(-1)===socketPath));await unlink(socketPath);
        }catch(error){if(error.code!=='ENOENT')throw error;}
        phase='stopped';if(ownershipAttempted)await onOwnership(ownership());return {stopped:true,socketRemoved:true,directoryRemoved:false};
      })();return stopPending;
    }
  });
  function abort(){fail(Error('The original editor selection was cancelled.'));}
  signal.addEventListener('abort',abort,{once:true});if(signal.aborted)abort();
  try{
    await admission();ownershipAttempted=true;await onOwnership(ownership());await admission();
    child=spawn('/usr/bin/setpriv',['--no-new-privs','--pdeathsig','KILL','--','/usr/bin/python3','-I','-B',fileURLToPath(new URL('./codex-editor-ingress.py',import.meta.url))],{shell:false,detached:false,stdio:['pipe','pipe','pipe']});
    child.stdin.on('error',()=>fail(Error('The editor carrier input failed.')));
    child.once('error',()=>fail(Error('The editor carrier could not start.')));
    child.once('close',(code,sig)=>{childExited=true;exited.resolve({code,signal:sig});if(!closed)fail(Error('The editor carrier closed.'));});
    child.stderr.on('data',()=>fail(Error('The editor carrier reported an unexpected diagnostic.')));
    // This child only execs setpriv -> Python. Its birth is stable across exec;
    // the retained ChildProcess handle is the exit witness, never a PID search.
    require(Number.isSafeInteger(child.pid)&&child.pid>0);
    const proc=await lstat(`/proc/${child.pid}`,{bigint:true}),text=await readFile(`/proc/${child.pid}/stat`,'utf8');require(proc.uid===uid&&Buffer.byteLength(text)<=8192);
    childBirth=text.slice(text.lastIndexOf(') ')+2).trim().split(/\s+/)[19];require(/^[1-9][0-9]{0,19}$/.test(childBirth));
    phase='started';await onOwnership(ownership());await admission();
    timer=setTimeout(()=>fail(Error('The editor carrier did not complete its bounded startup.')),8500);
    pump=(async()=>{
      let incoming=Buffer.alloc(0);
      try{
        for await(const chunk of child.stdout){require(incoming.length+chunk.length<=LIMIT+65536);incoming=Buffer.concat([incoming,chunk]);let end;
          while((end=incoming.indexOf(10))>=0){const bytes=incoming.subarray(0,end);incoming=incoming.subarray(end+1);require(bytes.length<=LIMIT);const m=JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(bytes));require(object(m));await admission();
            if(m.kind==='ready'){
              require(phase==='started'&&Object.keys(m).sort().join()==='kind,socketDevice,socketInode');const s=await lstat(socketPath,{bigint:true});require(s.isSocket()&&!s.isSymbolicLink()&&s.uid===uid&&!(s.mode&0o077n)&&String(s.dev)===m.socketDevice&&String(s.ino)===m.socketInode);
              socketIdentity=identity(s);phase='ready';await onOwnership(ownership());await admission();ready.resolve(owner);
            }else if(m.kind==='peer-verified'){
              require(phase==='peer-requested'&&Object.keys(m).join()==='kind');phase='connected';await onOwnership(ownership());await admission();peerVerified=true;clearTimeout(timer);peer.resolve();
            }else if(m.kind==='message'){
              require(peerVerified&&Object.keys(m).sort().join()==='kind,message'&&object(m.message)&&Buffer.byteLength(JSON.stringify(m.message))<=MAX);
              await onMessage(m.message,controller.signal);await admission();
            }else throw Error('The editor carrier protocol changed.');
          }
        }
        require(incoming.length===0);
      }catch(error){fail(error);}
    })();
    await write({schema:'switchyard-editor-ingress/v1',parentPid:process.pid,socketPath,directoryDevice:directoryIdentity.device,directoryInode:directoryIdentity.inode});
    await ready.promise;await admission();return owner;
  }catch(error){fail(error);try{await owner.stop();}catch{failure.editorCarrierCleanupUnconfirmed=true;}throw failure;}
}
