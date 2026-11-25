'use strict';
// Keep native import() in CommonJS: TypeScript must not rewrite it to require().
const { createHash } = require('node:crypto');
const { constants } = require('node:fs');
const { lstat, open, realpath, readdir } = require('node:fs/promises');
const { resolve, join } = require('node:path');
const { pathToFileURL } = require('node:url');
const files = Object.freeze(['windows-editor-endpoint.mjs','windows-terminal-process.mjs','owned-native-command.mjs','runtime-command.mjs','owned-process.mjs','process-environment.mjs'].map(name=>'tools/layout-studio/'+name));
const helperPath='runtime/hotkeys/Switchyard.Hotkeys.exe';
const requireValue=value=>{if(!value)throw Error('The installed Windows editor runtime did not verify.');};
const exact=(value,names)=>value && typeof value==='object' && !Array.isArray(value) && Object.keys(value).sort().join()===names.slice().sort().join();
async function bytes(path,maximum){
  const before=await lstat(path,{bigint:true});requireValue(before.isFile() && !before.isSymbolicLink() && before.size>0n && before.size<=BigInt(maximum) && await realpath(path)===path);
  const file=await open(path,constants.O_RDONLY|(constants.O_NOFOLLOW??0));
  try{const held=await file.stat({bigint:true}),value=await file.readFile(),after=await lstat(path,{bigint:true});
    requireValue([held,after].every(s=>s.dev===before.dev && s.ino===before.ino && s.size===before.size && s.mtimeNs===before.mtimeNs && s.ctimeNs===before.ctimeNs) && BigInt(value.length)===before.size);return value;
  }finally{await file.close();}
}
async function inventory(root,at=''){
  const entries=await readdir(join(root,at),{withFileTypes:true});requireValue(entries.length<=16);const found=[];
  for(const entry of entries){const name=at?at+'/'+entry.name:entry.name;requireValue(name.length<=128 && !entry.isSymbolicLink());
    if(entry.isDirectory()){requireValue(name.split('/').length<=3);found.push(...await inventory(root,name));}else{requireValue(entry.isFile());found.push(name);}}
  return found;
}
async function loadWindowsEditorRuntime(root=resolve(__dirname,'../../../windows-editor-runtime'),platform=process.platform){
  requireValue(platform==='win32');root=await realpath(root);
  const raw=await bytes(join(root,'manifest.json'),8192),manifest=JSON.parse(raw.toString('utf8'));
  requireValue(exact(manifest,['schema','platform','files','helper']) && manifest.schema==='switchyard-vscode-windows-runtime/v1' && manifest.platform==='win32' && Array.isArray(manifest.files) && manifest.files.length===7);
  const expected=[...files,helperPath];requireValue(JSON.stringify(manifest.files.map(row=>row.path))===JSON.stringify(expected));
  requireValue(JSON.stringify((await inventory(root)).sort())===JSON.stringify([...expected,'manifest.json'].sort()));
  for(const row of manifest.files){requireValue(exact(row,['path','sha256','size']) && /^[a-f0-9]{64}$/.test(row.sha256) && Number.isSafeInteger(row.size) && row.size>0);
    const value=await bytes(join(root,row.path),row.path===helperPath?536870912:131072);requireValue(value.length===row.size && createHash('sha256').update(value).digest('hex')===row.sha256);}
  requireValue(exact(manifest.helper,['path','sha256','size']) && JSON.stringify(manifest.helper)===JSON.stringify(manifest.files.at(-1)));
  const selected=Object.freeze({path:join(root,helperPath),sha256:manifest.helper.sha256});
  const endpoint=await import(pathToFileURL(join(root,files[0])).href),process=await import(pathToFileURL(join(root,files[1])).href);
  requireValue((await bytes(join(root,'manifest.json'),8192)).equals(raw));
  // Bind the verified helper; callers cannot redirect the native executable.
  return Object.freeze({createEndpointReader:()=>endpoint.createWindowsEditorEndpointReader({helper:async()=>selected}),createProcessProbe:()=>process.createWindowsTerminalProcessProbe({helper:async()=>selected})});
}
module.exports={loadWindowsEditorRuntime};
