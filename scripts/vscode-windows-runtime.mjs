/** Fixed source/runtime inventory for the extension; no dependency download. */
import { createHash } from 'node:crypto';
import { constants } from 'node:fs';
import { lstat, open, realpath, mkdir, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';

export const windowsEditorRuntimeFiles = Object.freeze(['windows-editor-endpoint.mjs','windows-terminal-process.mjs','owned-native-command.mjs','runtime-command.mjs','owned-process.mjs','process-environment.mjs'].map(name=>'tools/layout-studio/'+name));
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
async function read(path, maximum) {
  const canonical=await realpath(path),before=await lstat(path,{bigint:true});
  if(canonical!==path || !before.isFile() || before.isSymbolicLink() || before.size<1n || before.size>BigInt(maximum))throw Error('The extension runtime source is not a bounded original file.');
  const file=await open(path,constants.O_RDONLY|(constants.O_NOFOLLOW??0));
  try {
    const held=await file.stat({bigint:true}),bytes=await file.readFile(),after=await lstat(path,{bigint:true});
    if([held,after].some(s=>s.dev!==before.dev || s.ino!==before.ino || s.size!==before.size || s.mtimeNs!==before.mtimeNs || s.ctimeNs!==before.ctimeNs) || BigInt(bytes.length)!==before.size)throw Error('The extension runtime source changed during packaging.');
    return bytes;
  } finally {await file.close();}
}
export async function packageWindowsEditorRuntime({sourceRoot,outputRoot,platform=process.platform}) {
  if(!['linux','win32'].includes(platform) || await realpath(sourceRoot)!==sourceRoot)throw Error('Choose the original extension source root.');
  await mkdir(outputRoot,{recursive:true});
  if(await realpath(outputRoot)!==outputRoot)throw Error('The extension runtime output is redirected.');
  const rows=[];
  async function add(path,maximum) {
    const bytes=await read(join(sourceRoot,path),maximum),target=join(outputRoot,path);await mkdir(dirname(target),{recursive:true});
    if(await realpath(dirname(target))!==dirname(target))throw Error('The extension runtime output parent is redirected.');
    await writeFile(target,bytes,{flag:'wx',mode:0o600});const row={path,sha256:hash(bytes),size:bytes.length};rows.push(row);return row;
  }
  for(const path of windowsEditorRuntimeFiles)await add(path,131072);
  const helper=platform==='win32'?await add('runtime/hotkeys/Switchyard.Hotkeys.exe',536870912):null;
  const manifest={schema:'switchyard-vscode-windows-runtime/v1',platform,files:rows,helper};
  await writeFile(join(outputRoot,'manifest.json'),JSON.stringify(manifest,null,2)+'\n',{flag:'wx',mode:0o600});return manifest;
}
