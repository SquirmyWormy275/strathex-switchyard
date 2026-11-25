import { createHash } from 'node:crypto';
import { constants } from 'node:fs';
import { lstat, open, realpath } from 'node:fs/promises';
import { win32 } from 'node:path';
import { windowsEditorLocalPath } from './codex-windows-terminal.ts';
import { nativeImageIdentity } from './studio-terminal-process.ts';
import type { WindowsEditorImage, WindowsEditorTarget } from './studio-windows-task-client.ts';

export interface WindowsReviewedImage {readonly executable:string;readonly executableIdentity:string;readonly image:WindowsEditorImage;}
export interface WindowsEditorFileChecks {
  image(executable:string,sha256:string,current:()=>void|Promise<void>):Promise<WindowsReviewedImage>;
  current(target:WindowsEditorTarget,prepared?:WindowsReviewedImage):Promise<void>;
}
function requireValue(value:unknown):asserts value {if(!value)throw Error('The reviewed Windows editor files changed or are unavailable.');}
async function directory(path:string){
  requireValue(process.platform==='win32' && windowsEditorLocalPath(path));
  for(let name=path;;name=win32.dirname(name)){
    const entry=await lstat(name,{bigint:true});requireValue(entry.isDirectory() && !entry.isSymbolicLink() && await realpath(name)===name);
    if(win32.dirname(name)===name)break;
  }
  return lstat(path,{bigint:true});
}
/** Read-only file checks. Native process evidence is separately required after
 * VS Code returns its exact Terminal PID; these reads never grant attachment. */
export function createWindowsEditorFileChecks():WindowsEditorFileChecks {
  return Object.freeze({
    async image(executable:string,sha256:string,current:()=>void|Promise<void>){
      requireValue(process.platform==='win32' && windowsEditorLocalPath(executable) && executable.length>3 && /^[a-f0-9]{64}$/.test(sha256));
      await current();await directory(win32.dirname(executable));requireValue(await realpath(executable)===executable);
      const named=await lstat(executable,{bigint:true});requireValue(named.isFile() && !named.isSymbolicLink() && named.size>0n && named.size<=536870912n);
      const file=await open(executable,constants.O_RDONLY|(constants.O_NOFOLLOW??0));
      try{
        const before=await file.stat({bigint:true}),identity=nativeImageIdentity(before);requireValue(identity===nativeImageIdentity(named));
        const hash=createHash('sha256'),buffer=Buffer.alloc(1024*1024);let total=0;
        for(;;){await current();const read=await file.read(buffer,0,buffer.length,null);if(!read.bytesRead)break;total+=read.bytesRead;requireValue(total<=Number(before.size));hash.update(buffer.subarray(0,read.bytesRead));}
        requireValue(total===Number(before.size) && hash.digest('hex')===sha256 && nativeImageIdentity(await file.stat({bigint:true}))===identity && nativeImageIdentity(await lstat(executable,{bigint:true}))===identity && await realpath(executable)===executable);await current();
        return Object.freeze({executable,executableIdentity:identity,image:Object.freeze({path:executable,sha256,device:String(before.dev),inode:String(before.ino),size:String(before.size)})});
      }finally{await file.close();}
    },
    async current(target:WindowsEditorTarget,prepared?:WindowsReviewedImage){
      const root=await directory(target.repositoryRoot);requireValue(String(root.dev)===target.repositoryIdentity.device && String(root.ino)===target.repositoryIdentity.inode);
      if(prepared){await directory(win32.dirname(prepared.executable));const image=await lstat(prepared.executable,{bigint:true});requireValue(image.isFile() && !image.isSymbolicLink() && nativeImageIdentity(image)===prepared.executableIdentity && await realpath(prepared.executable)===prepared.executable && prepared.image.sha256===target.endpoint.peerExecutableSha256);}
    }
  });
}
