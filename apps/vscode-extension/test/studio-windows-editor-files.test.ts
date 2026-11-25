import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {mkdtemp,writeFile,lstat,realpath,rename,rm,mkdir} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createWindowsEditorFileChecks} from '../src/studio-windows-editor-files.ts';
import type {WindowsEditorTarget} from '../src/studio-windows-task-client.ts';

test('actual Windows reviewed image and repository checks reject changed bytes, replaced names and stale context without executing an image',{skip:process.platform!=='win32'},async t=>{
  const root=await realpath(await mkdtemp(join(tmpdir(),'switchyard-editor-files-'))),repositoryRoot=join(root,'repo'),executable=join(root,'codex.exe'),bytes=Buffer.from('Synthetic inert executable fixture; never execute.');
  t.after(()=>rm(root,{recursive:true}));await mkdir(repositoryRoot);await writeFile(executable,bytes);const stat=await lstat(repositoryRoot,{bigint:true}),sha256=createHash('sha256').update(bytes).digest('hex'),files=createWindowsEditorFileChecks();
  const target={repositoryRoot,repositoryIdentity:{device:String(stat.dev),inode:String(stat.ino)},endpoint:{peerExecutableSha256:sha256}} as WindowsEditorTarget;
  let checks=0;const prepared=await files.image(executable,sha256,async()=>{checks++;});assert.ok(checks>=3);assert.equal(prepared.image.sha256,sha256);assert.equal(prepared.image.path,executable);await files.current(target,prepared);
  await assert.rejects(files.image(executable,'f'.repeat(64),async()=>{}));await assert.rejects(files.image(executable,sha256,async()=>{throw Error('revoked context');}));
  await rename(executable,executable+'.original');await writeFile(executable,bytes);await assert.rejects(files.current(target,prepared));await rm(executable);await rename(executable+'.original',executable);
  await writeFile(executable,'changed');await assert.rejects(files.current(target,prepared));await assert.rejects(files.image(executable,sha256,async()=>{}));
  await rename(repositoryRoot,repositoryRoot+'.original');await mkdir(repositoryRoot);await assert.rejects(files.current(target));
});
