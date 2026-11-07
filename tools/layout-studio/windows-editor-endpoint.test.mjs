import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash, randomUUID } from 'node:crypto';
import { spawn } from 'node:child_process';
import { mkdtemp, readFile, realpath, rm, lstat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { windowsEditorEndpointQuery, windowsEditorEndpointResult, createWindowsEditorEndpointReader } from './windows-editor-endpoint.mjs';
import { runOwnedNativeCommand } from './owned-native-command.mjs';
import { runRuntimeCommand, runtimeGuardianStopped } from './runtime-command.mjs';
import { stopOwnedChild } from './owned-process.mjs';
import { desktopEnvironment } from './process-environment.mjs';

const digest = text => createHash('sha256').update(text).digest('hex');
const path = 'C:\\Users\\Fixture\\State\\endpoint.json';
const query = () => ({schema:'switchyard-editor-endpoint-query/v1',requestId:randomUUID(),path});
const proof = request => ({schema:'switchyard-editor-endpoint-result/v1',requestId:request.requestId,path:request.path,text:'{"synthetic":true}',sha256:digest('{"synthetic":true}'),device:'0',inode:'9007199254740993',size:'18',currentUserVerified:true,privateAclVerified:true,tokenAccessMask:8,fileModified:false});
const context = () => ({assertCurrent:async()=>{},signal:new AbortController().signal});

test('endpoint metadata refuses remote, alternate-stream, ambiguous and non-endpoint paths before native work',()=>{
  const input=query();assert.deepEqual(windowsEditorEndpointQuery(input),input);
  for(const value of ['C:relative\\endpoint.json','\\\\server\\share\\endpoint.json','\\\\?\\C:\\endpoint.json','C:\\x\\..\\endpoint.json','C:\\x\\endpoint.json:stream','C:\\NUL\\endpoint.json','C:/x/endpoint.json','C:\\x \\endpoint.json','C:\\secret.json']) assert.throws(()=>windowsEditorEndpointQuery({...query(),path:value}));
  for(const value of [{requestId:'00000000-0000-0000-0000-000000000000'},{command:'NEVER_EXECUTE'},{schema:'other'}]) assert.throws(()=>windowsEditorEndpointQuery({...query(),...value}));
});
test('endpoint proof requires exact bytes, file identity, private ownership and QUERY-only observation',()=>{
  const request=query(),value=proof(request);assert.deepEqual(windowsEditorEndpointResult(value,request),value);
  for(const change of [{requestId:randomUUID()},{path:path.toLowerCase()},{text:'{"substituted":true}'},{sha256:'0'.repeat(64)},{size:'4097'},{inode:'18446744073709551616'},{device:'4294967296'},{tokenAccessMask:10},{privateAclVerified:false},{currentUserVerified:false},{fileModified:true},{extra:true}]) assert.throws(()=>windowsEditorEndpointResult({...value,...change},request));
  for(const key of Object.keys(value)){const copy={...value};delete copy[key];assert.throws(()=>windowsEditorEndpointResult(copy,request));}
});
function fixture(t,options={}){
  let exited=true;const calls=[],scopes=[];
  const service=createWindowsEditorEndpointReader({platform:'win32',helper:async()=>({path:'C:\\Reviewed\\Switchyard.Hotkeys.exe',sha256:'a'.repeat(64)}),
    command:async(exe,args,config)=>{calls.push({exe,args,config});const scope={schema:'switchyard-runtime-command/v1',id:randomUUID(),guardianPid:12345,birth:'1',containment:'windows-job'};scopes.push(scope);await config.onGuardianReady(scope);await options.afterReady?.();return{status:'completed',exitCode:0,treeExitVerified:true,inputDelivered:true,stdout:JSON.stringify(options.proof?options.proof(proof(JSON.parse(config.inputText))):proof(JSON.parse(config.inputText)))};},
    guardianStopped:async(scope,config)=>{assert.deepEqual(scope,scopes.find(row=>row.id===scope.id));await options.observer?.(config);return exited;},stopChild:options.stopChild??stopOwnedChild});
  t.after(async()=>{exited=true;await service.close();});return{service,calls,exited:value=>{exited=value;}};
}
test('the endpoint reader verifies independent original Job retirement before returning private bytes',async t=>{
  const f=fixture(t);let checks=0;assert.equal(await f.service.read(path,{...context(),assertCurrent:async()=>{checks++;}}),'{"synthetic":true}');
  assert.ok(checks>=4);assert.deepEqual(f.calls[0].args,['--editor-endpoint-v1']);assert.equal(f.calls[0].config.timeout,10000);assert.equal(f.calls[0].config.maxOutputBytes,32768);assert.equal(f.calls[0].config.captureStderrBytes,0);assert.equal(f.calls[0].config.expectedExecutableSha256,'a'.repeat(64));
  await f.service.read(path,context());assert.notEqual(JSON.parse(f.calls[0].config.inputText).requestId,JSON.parse(f.calls[1].config.inputText).requestId);assert.deepEqual(await f.service.close(),{stoppedVerified:true,fileModified:false});assert.throws(()=>f.service.read(path,context()));
});
test('stale context, substituted proof and uncertain original helper exit cannot release endpoint bytes',async t=>{
  const wrong=fixture(t,{proof:value=>({...value,privateAclVerified:false})});await assert.rejects(wrong.service.read(path,context()));
  let current=true;const stale=fixture(t,{afterReady:async()=>{current=false;}});await assert.rejects(stale.service.read(path,{...context(),assertCurrent:async()=>assert.ok(current)}));
  const unknown=fixture(t);unknown.exited(false);await assert.rejects(unknown.service.read(path,context()));assert.throws(()=>unknown.service.read(path,context()));assert.equal(unknown.calls.length,1);await assert.rejects(unknown.service.close());unknown.exited(true);await unknown.service.close();
});
test('reader cancellation joins the original held context and reentry cannot start another helper',async t=>{
  let enter,release;const entered=new Promise(r=>enter=r),held=new Promise(r=>release=r),f=fixture(t),abort=new AbortController();let first=true,closed=false;
  const pending=assert.rejects(f.service.read(path,{signal:abort.signal,assertCurrent:async()=>{if(first){first=false;assert.throws(()=>f.service.read(path,context()));enter();await held;}}}));
  await entered;abort.abort();const closing=f.service.close().then(()=>{closed=true;});await new Promise(r=>setImmediate(r));assert.equal(closed,false);assert.equal(f.calls.length,0);release();await pending;await closing;
  let calls=0;const wrong=createWindowsEditorEndpointReader({platform:'linux',helper:async()=>{calls++;}});assert.throws(()=>wrong.read(path,context()));assert.equal(calls,0);await wrong.close();
});
test('cancellation during observer retirement cannot release already-read endpoint bytes',async t=>{
  let enter,release;const entered=new Promise(r=>enter=r),held=new Promise(r=>release=r),child={fixture:'original-status-observer'};
  const f=fixture(t,{observer:async options=>options.onGuardianChild(child),stopChild:async selected=>{assert.equal(selected,child);enter();await held;return{stopped:true};}});
  const pending=assert.rejects(f.service.read(path,context()));await entered;let closed=false;const closing=f.service.close().then(()=>{closed=true;});await new Promise(r=>setImmediate(r));assert.equal(closed,false);release();await pending;await closing;
});
test('a spawned endpoint query without its original guardian acknowledgement remains uncertain',async t=>{
  let child;const reader=createWindowsEditorEndpointReader({platform:'win32',helper:async()=>({path:'C:\\Reviewed\\Switchyard.Hotkeys.exe',sha256:'a'.repeat(64)}),command:async(_exe,_args,options)=>{child=spawn(process.execPath,['-e','setInterval(()=>{},1000)'],{stdio:'ignore'});options.onGuardianChild(child);throw Error('synthetic interruption before original guardian acknowledgement');}});
  t.after(async()=>{if(child)assert.equal((await stopOwnedChild(child)).stopped,true);await assert.rejects(reader.close());});
  await assert.rejects(reader.read(path,context()));assert.throws(()=>reader.read(path,context()));await assert.rejects(reader.close());
});

test('actual Windows endpoint reader accepts private held bytes and refuses shared files, shared parents, hard links, junctions and oversize data',{skip:process.platform!=='win32'},async t=>{
  const root=await realpath(await mkdtemp(join(tmpdir(),'switchyard-endpoint-'))),identity=await lstat(root,{bigint:true});
  const nativePath=await realpath(resolve('runtime/hotkeys/Switchyard.Hotkeys.exe')),native={path:nativePath,sha256:digest(await readFile(nativePath))};
  const reader=createWindowsEditorEndpointReader({helper:async()=>native}),resource={clients:new Set()},observers=new Set();
  const observe=scope=>runtimeGuardianStopped(scope,{windowsHelper:native.path,onGuardianChild:child=>observers.add(child)});
  t.after(async()=>{await reader.close();for(const client of resource.clients)assert.equal(await client.stop(),true);for(const child of observers)assert.equal((await stopOwnedChild(child)).stopped,true);const now=await lstat(root,{bigint:true});assert.equal(now.ino,identity.ino);assert.equal(now.dev,identity.dev);await rm(root,{recursive:true});});
  const quote=s=>"'"+s.replaceAll("'","''")+"'";
  const script=`$ErrorActionPreference='Stop';$root=${quote(root)}
$token=[Security.Principal.WindowsIdentity]::GetCurrent([Security.Principal.TokenAccessLevels]::Query)
try{$sid=$token.User;$acl=New-Object Security.AccessControl.DirectorySecurity;$acl.SetOwner($sid);$acl.SetAccessRuleProtection($true,$false);$acl.AddAccessRule((New-Object Security.AccessControl.FileSystemAccessRule($sid,'FullControl','ContainerInherit,ObjectInherit','None','Allow')));[IO.Directory]::SetAccessControl($root,$acl)}finally{$token.Dispose()}
foreach($name in @('private','shared-file','shared-parent','hard-link','oversize')){$dir=Join-Path $root $name;[IO.Directory]::CreateDirectory($dir)|Out-Null;$acl=[IO.Directory]::GetAccessControl($dir);$acl.SetOwner($sid);[IO.Directory]::SetAccessControl($dir,$acl);$file=Join-Path $dir 'endpoint.json';[IO.File]::WriteAllText($file,'{"synthetic":true}',(New-Object Text.UTF8Encoding($false)));$acl=[IO.File]::GetAccessControl($file);$acl.SetOwner($sid);[IO.File]::SetAccessControl($file,$acl)}
$everyone=New-Object Security.Principal.SecurityIdentifier('S-1-1-0')
$file=Join-Path $root 'shared-file\\endpoint.json';$acl=[IO.File]::GetAccessControl($file);$acl.AddAccessRule((New-Object Security.AccessControl.FileSystemAccessRule($everyone,'Read','Allow')));[IO.File]::SetAccessControl($file,$acl)
$dir=Join-Path $root 'shared-parent';$acl=[IO.Directory]::GetAccessControl($dir);$acl.AddAccessRule((New-Object Security.AccessControl.FileSystemAccessRule($everyone,'Read','Allow')));[IO.Directory]::SetAccessControl($dir,$acl)
New-Item -ItemType HardLink -Path (Join-Path $root 'duplicate.json') -Target (Join-Path $root 'hard-link\\endpoint.json')|Out-Null
New-Item -ItemType Junction -Path (Join-Path $root 'junction') -Target (Join-Path $root 'private')|Out-Null
[IO.File]::WriteAllText((Join-Path $root 'oversize\\endpoint.json'),('x'*4097),(New-Object Text.UTF8Encoding($false)))
Write-Output 'fixture-ready'`;
  const powershell=join(process.env.SystemRoot,'System32','WindowsPowerShell','v1.0','powershell.exe');let owner;
  const setup=await runOwnedNativeCommand({executable:powershell,args:['-NoLogo','-NoProfile','-NonInteractive','-EncodedCommand',Buffer.from(script,'utf16le').toString('base64')],env:desktopEnvironment(),text:'',resource,timeout:10000,maxOutputBytes:4096,captureStderrBytes:0,
    command:(exe,args,options)=>runRuntimeCommand(exe,args,{...options,windowsHelper:native.path}),guardianStopped:observe,onReady:async scope=>{owner=scope;},onStopped:async scope=>assert.equal(await observe(scope),true)});
  assert.ok(owner);assert.equal(setup.status,'completed');assert.equal(setup.exitCode,0);assert.equal(setup.stdout.trim(),'fixture-ready');
  assert.equal(await reader.read(join(root,'private','endpoint.json'),context()),'{"synthetic":true}');
  for(const name of ['shared-file','shared-parent','hard-link','junction','oversize'])await assert.rejects(reader.read(join(root,name,'endpoint.json'),context()),name);
});
