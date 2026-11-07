import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { mkdtemp, mkdir, readFile, writeFile, copyFile, realpath, rm } from 'node:fs/promises';
import { join, dirname, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { packageWindowsEditorRuntime, windowsEditorRuntimeFiles } from './vscode-windows-runtime.mjs';
import { copyVscodeRuntime } from './copy-vscode-runtime.mjs';
const {loadWindowsEditorRuntime}=createRequire(import.meta.url)('../apps/vscode-extension/src/windows-editor-runtime.cjs');
async function fixture(t){
  const root=await realpath(await mkdtemp(join(tmpdir(),'switchyard-extension-runtime-'))),sourceRoot=join(root,'source'),outputRoot=join(root,'output');
  t.after(()=>rm(root,{recursive:true}));await mkdir(sourceRoot);
  for(const file of windowsEditorRuntimeFiles){await mkdir(dirname(join(sourceRoot,file)),{recursive:true});await copyFile(resolve(file),join(sourceRoot,file));}
  const native=join(sourceRoot,'runtime/hotkeys/Switchyard.Hotkeys.exe');await mkdir(dirname(native),{recursive:true});await writeFile(native,'Synthetic inert helper bytes; never execute.');
  return{root,sourceRoot,outputRoot,native};
}
test('the extension packages a fixed shared module graph and loads its factories without executing a native helper',async t=>{
  const f=await fixture(t),manifest=await packageWindowsEditorRuntime({...f,platform:'win32'});
  assert.equal(manifest.files.length,7);assert.deepEqual(manifest.files.slice(0,6).map(row=>row.path),windowsEditorRuntimeFiles);
  const runtime=await loadWindowsEditorRuntime(f.outputRoot,'win32');assert.ok(Object.isFrozen(runtime));assert.deepEqual(Object.keys(runtime),['createEndpointReader','createProcessProbe']);
  assert.deepEqual(await runtime.createEndpointReader().close(),{stoppedVerified:true,fileModified:false});assert.deepEqual(await runtime.createProcessProbe().close(),{stoppedVerified:true,targetProcessTerminated:false});
  await assert.rejects(loadWindowsEditorRuntime(f.outputRoot,'linux'));
  await assert.rejects(packageWindowsEditorRuntime({...f,platform:'win32'}),/EEXIST/);
});
test('Linux extension builds retain portable modules but cannot fabricate a Windows helper',async t=>{
  const f=await fixture(t),manifest=await packageWindowsEditorRuntime({...f,platform:'linux'});assert.equal(manifest.files.length,6);assert.equal(manifest.helper,null);await assert.rejects(loadWindowsEditorRuntime(f.outputRoot,'win32'));await assert.rejects(readFile(join(f.outputRoot,'runtime/hotkeys/Switchyard.Hotkeys.exe')),{code:'ENOENT'});
});
test('package loading refuses changed source bytes, helper bytes, manifest coordinates and unmanifested files',async t=>{
  const f=await fixture(t);await packageWindowsEditorRuntime({...f,platform:'win32'});
  for(const file of [windowsEditorRuntimeFiles[0],'runtime/hotkeys/Switchyard.Hotkeys.exe']){const path=join(f.outputRoot,file),bytes=await readFile(path);await writeFile(path,'changed');await assert.rejects(loadWindowsEditorRuntime(f.outputRoot,'win32'));await writeFile(path,bytes);}
  const path=join(f.outputRoot,'manifest.json'),raw=await readFile(path),manifest=JSON.parse(raw);
  for(const change of [{...manifest,extra:true},{...manifest,helper:{...manifest.helper,path:'C:\\Other\\helper.exe'}},{...manifest,files:manifest.files.slice().reverse()}]){await writeFile(path,JSON.stringify(change));await assert.rejects(loadWindowsEditorRuntime(f.outputRoot,'win32'));}await writeFile(path,raw);
  const extra=join(f.outputRoot,'unmanifested.mjs');await writeFile(extra,'throw Error("NEVER_IMPORT")');await assert.rejects(loadWindowsEditorRuntime(f.outputRoot,'win32'));await rm(extra);
});
test('a missing helper refuses Windows packaging before a manifest can claim acceptance',async t=>{
  const f=await fixture(t);await rm(f.native);await assert.rejects(packageWindowsEditorRuntime({...f,platform:'win32'}),{code:'ENOENT'});await assert.rejects(readFile(join(f.outputRoot,'manifest.json')),{code:'ENOENT'});
});
test('the extension copy step places both CommonJS bridges beside emitted JavaScript and preserves exact runtime bytes',async t=>{
  const f=await fixture(t);const manifest=await copyVscodeRuntime({root:await realpath(resolve('.')),dist:f.outputRoot,platform:'linux'});assert.equal(manifest.helper,null);
  for(const name of ['codex-daemon-status.cjs','windows-editor-runtime.cjs'])assert.deepEqual(await readFile(join(f.outputRoot,'apps/vscode-extension/src',name)),await readFile(resolve('apps/vscode-extension/src',name)));
  for(const file of windowsEditorRuntimeFiles)assert.deepEqual(await readFile(join(f.outputRoot,'windows-editor-runtime',file)),await readFile(resolve(file)));
});
