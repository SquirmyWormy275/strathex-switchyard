#!/usr/bin/env node
/** Actual NTFS packet staging on a disposable CI worker; no task/guest claim. */
import assert from "node:assert/strict";
import { createHash, randomUUID } from "node:crypto";
import { createReadStream } from "node:fs";
import { access, mkdir, mkdtemp, readFile, realpath, rm, writeFile } from "node:fs/promises";
import { basename, isAbsolute, join } from "node:path";
import { tmpdir } from "node:os";
import { createSuiteStore } from "../tools/layout-studio/suite-store.mjs";
import { createWindowsReviewedInputs } from "../tools/layout-studio/windows-reviewed-inputs.mjs";
import { directoryIdentity, privateWrite } from "../tools/layout-studio/private-fs.mjs";
import { runRuntimeCommand, runtimeGuardianStopped } from "../tools/layout-studio/runtime-command.mjs";
const flags=process.argv.slice(2),selected=flags[1]?.startsWith("--helper=")?flags[1].slice(9):undefined;
if(process.platform!=="win32"||process.env.GITHUB_ACTIONS!=="true"||process.env.RUNNER_OS!=="Windows"||flags.length!==2||flags[0]!=="--synthetic"||!selected||!isAbsolute(selected)||basename(selected).toLowerCase()!=="switchyard.hotkeys.exe")throw Error("Use the disposable Windows CI index proof: --synthetic --helper=BUILT_SWITCHYARD_HELPER. No user task, provider, guest, service or keyboard is selected.");
const helper=await realpath(selected),sha=bytes=>createHash("sha256").update(bytes).digest("hex"),identity=value=>({device:value.dev.toString(),inode:value.ino.toString()});
async function helperDigest(){const hash=createHash("sha256");for await(const bytes of createReadStream(helper))hash.update(bytes);return hash.digest("hex");}
const helperSha256=await helperDigest(),root=await mkdtemp(join(process.env.RUNNER_TEMP||tmpdir(),"switchyard-index-native-")),checks=[],owners=[],keys=new Map(),receipt={schema:"switchyard-windows-index-native-proof/v1",sourceCommit:process.env.GITHUB_SHA??null,helperSha256,scope:"native-packet-staging-not-task-or-guest",checks,sourceGitObserved:false,providerAccountOpened:false,guestLaunched:false,serviceOpened:false,volumeOpened:false,keyboardOpened:false,modelPromptsSubmitted:0};let service,failure,mutation;
try{
  const source=join(root,"repository");await mkdir(source);await mkdir(join(source,".switchyard-index"));await writeFile(join(source,"live.js"),"clean worktree source");await writeFile(join(source,".switchyard-index/live.js"),"physical alias must stay untouched");await writeFile(join(source,"unselected.env"),"synthetic unselected credential");
  const bytes=Buffer.from("-----BEGIN PRIVATE KEY-----\nsynthetic disposable index source\n"),path=".switchyard-index/live.js",row={path:"live.js",mode:"100644",objectId:createHash("sha1").update(`blob ${bytes.length}\0`).update(bytes).digest("hex"),size:bytes.length,sha256:sha(bytes)},options={action:"shield_change_scan",indexWitness:{source:"git-index",head:"a".repeat(40),indexMetadataSha256:"b".repeat(64),rows:[row]},indexBytes:new Map([[path,{bytes,mode:"100644"}]])},input={repositoryRoot:source,sourceIdentity:identity(await directoryIdentity(source)),inputFiles:[{path:"live.js",sha256:sha("clean worktree source"),size:Buffer.byteLength("clean worktree source"),classification:"non-production"},{path,sha256:row.sha256,size:row.size,classification:"non-production"}]};
  const store=createSuiteStore({root:join(root,"protected"),secrets:{get:async(c,p)=>keys.get(c+p),set:async(c,p,v)=>{keys.set(c+p,v);}}});await store.initialize("personal");await store.update("personal","synthetic-mode",state=>{state.mode="personal-companion";});
  const stopped=scope=>runtimeGuardianStopped(scope,{windowsHelper:helper}),command=async(executable,args,options)=>{
    let inputText=options.inputText;
    if(mutation){const request=JSON.parse(inputText);if(mutation==="general-action")request.indexInputs.action="run_target";else request.indexInputs.witness.rows[0].objectId="c".repeat(40);inputText=JSON.stringify(request);}
    const ready=options.onGuardianReady;
    return runRuntimeCommand(executable,args,{...options,inputText,windowsHelper:helper,onGuardianReady:async scope=>{owners.push(scope);await ready(scope);}});
  };
  service=createWindowsReviewedInputs({store,stateDirectory:join(root,"inputs"),helper,command,guardianStopped:stopped,consumerStopped:async()=>true});
  const context=()=>({operationId:randomUUID(),scopeDigest:"a".repeat(64),provider:"codex"}),lease=await service.prepare("personal",context(),input,async()=>{},options);
  assert.deepEqual(await readFile(join(lease.root,path)),bytes);assert.equal(await readFile(join(lease.root,"live.js"),"utf8"),"clean worktree source");await assert.rejects(access(join(lease.root,"unselected.env")),{code:"ENOENT"});
  const positive=(await store.snapshot("personal")).repositoryWindowsInputs[0];assert.equal(positive.proof.privateAclReadbackVerified,true);assert.equal(positive.proof.indexWitnessSha256,sha(JSON.stringify(options.indexWitness)));assert.match(positive.proof.indexPacketSha256,/^[a-f0-9]{64}$/);assert.equal(positive.proof.sandboxEnforced,false);await lease.assertCurrent();
  checks.push("actual native NTFS reader validates private ACL, root identities, Git object/content hashes and both exact packet/witness digests");
  await lease.release();await assert.rejects(access(lease.root),{code:"ENOENT"});checks.push("actual independent native exit permits removal of only the original reviewed private copies");
  for(const fault of ["general-action","wrong-object"]){mutation=fault;await assert.rejects(service.prepare("personal",context(),input,async()=>{},options),/native Windows reader rejected/);mutation=undefined;await service.recover("personal");const row=(await store.snapshot("personal")).repositoryWindowsInputs.at(-1);assert.equal(row.cleanupPending,false);assert.notEqual(row.status,"staged");await assert.rejects(access(row.path),{code:"ENOENT"});checks.push(fault+": malformed packet injected after JS validation is refused by the actual native parser; stopped owned reservation cleans without handoff");}
  const state=await store.snapshot("personal");assert.equal(JSON.stringify(state).includes(bytes.toString("base64")),false);assert.equal(JSON.stringify(state).includes(bytes.toString()),false);assert.equal(state.repositoryWindowsInputs.length,3);assert.equal(owners.length,3);assert.ok(state.repositoryWindowsInputs.every(row=>row.stoppedVerified&&row.cleanupPending===false));for(const scope of owners)assert.equal(await stopped(scope),true);
  checks.push("three exact native guardian exits independently verify; protected state retains hashes and no encoded or plaintext source packet");
  assert.equal(await readFile(join(source,"live.js"),"utf8"),"clean worktree source");assert.equal(await readFile(join(source,path),"utf8"),"physical alias must stay untouched");assert.equal(await readFile(join(source,"unselected.env"),"utf8"),"synthetic unselected credential");assert.equal(await helperDigest(),helperSha256);checks.push("original worktree, physical alias, unselected credential and reviewed helper image remain unchanged");
  await service.close();service=null;await rm(root,{recursive:true});receipt.ownedScratchRemoved=true;receipt.independentlyStoppedGuardians=owners.length;receipt.success=true;
}catch(error){failure=error;receipt.success=false;receipt.failure=String(error.message).slice(0,500);receipt.ownedScratchRemoved=false;receipt.retainedOwnedRoot=root;try{await service?.close();}catch{receipt.cleanupUnconfirmed=true;}}
const receiptPath=join(process.env.RUNNER_TEMP||tmpdir(),"switchyard-windows-index-native.json");await privateWrite(receiptPath,JSON.stringify(receipt,null,2)+"\n");console.log(JSON.stringify({success:receipt.success,checks:checks.length,receipt:receiptPath,nativeFilesystemAccepted:receipt.success===true,guestAccepted:false,ownedScratchRemoved:receipt.ownedScratchRemoved}));if(failure)process.exitCode=1;
