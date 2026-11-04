#!/usr/bin/env node
/** Copied executable proof: actual owned command, no installed runtime fallback. */
import assert from "node:assert/strict";
import {createHash,randomUUID} from "node:crypto";
import {mkdtemp,copyFile,readFile,readdir,rm} from "node:fs/promises";
import {homedir,tmpdir} from "node:os";
import {join,isAbsolute} from "node:path";
import {privateDirectory,privateWrite} from "../tools/layout-studio/private-fs.mjs";
import {desktopEnvironment} from "../tools/layout-studio/process-environment.mjs";
import {runRuntimeCommand,runtimeGuardianStopped} from "../tools/layout-studio/runtime-command.mjs";
const flags=process.argv.slice(2),helper=flags[1]?.startsWith("--helper=")?flags[1].slice(9):undefined;
if(process.platform!=="win32"||flags.length!==2||flags[0]!=="--synthetic"||!helper||!isAbsolute(helper))throw Error("Usage on Windows: node scripts/verify-windows-standalone-helper.mjs --synthetic --helper=ABSOLUTE_BUILT_HELPER");
const root=await mkdtemp(join(process.env.LOCALAPPDATA||homedir(),"switchyard-standalone-")),image=join(root,"Switchyard.Hotkeys.exe"),cache=join(root,"extracted"),receipt=join(process.env.RUNNER_TEMP||tmpdir(),"switchyard-standalone-helper-verification.json");
const sha=bytes=>createHash("sha256").update(bytes).digest("hex"),expected=sha(await readFile(helper));
const evidence={schema:"switchyard-windows-standalone-helper-proof/v1",sourceCommit:process.env.GITHUB_SHA??null,helperSha256:expected,guestLaunched:false,accountOpened:false,serviceInstalled:false};let owner,failure,phase="copy";
try{
 await copyFile(helper,image);assert.equal(sha(await readFile(image)),expected);assert.deepEqual(await readdir(root),["Switchyard.Hotkeys.exe"]);await privateDirectory(cache);
 const overrides={PATH:join(process.env.SystemRoot||process.env.SYSTEMROOT||"C:\\Windows","System32"),DOTNET_ROOT:join(root,"no-installed-runtime"),DOTNET_ROOT_X64:join(root,"no-installed-runtime"),DOTNET_MULTILEVEL_LOOKUP:"0",DOTNET_BUNDLE_EXTRACT_BASE_DIR:cache,TEMP:cache,TMP:cache};
 // Windows keys are case-insensitive: remove Path/Temp aliases before overriding.
 const environment={...Object.fromEntries(Object.entries(desktopEnvironment()).filter(([name])=>!Object.keys(overrides).includes(name.toUpperCase()))),...overrides};
 assert.equal(new Set(Object.keys(environment).map(name=>name.toUpperCase())).size,Object.keys(environment).length);phase="owned-command";
 const result=await runRuntimeCommand(image,["--windows-sandbox-cli"],{windowsHelper:helper,cwd:root,env:environment,expectedExecutableSha256:expected,inputText:JSON.stringify({schema:"switchyard-windows-sandbox-cli/v1",action:"metadata"}),detailed:true,timeout:90000,maxOutputBytes:65536,onGuardianReady:async frame=>{owner=frame;evidence.nativeOwner=frame;await privateWrite(join(root,"owned-command.json"),JSON.stringify({operationId:randomUUID(),owner:frame,helperSha256:expected}));}});phase="metadata";
 assert.equal(result.exitCode,0,"The copied helper requires an unshipped runtime or failed its metadata query.");const metadata=JSON.parse(result.stdout);assert.equal(metadata.schema,"switchyard-windows-sandbox-cli/v1");assert.equal(metadata.action,"metadata");assert.equal(metadata.effectStarted,false);assert.ok(["available","unavailable"].includes(metadata.status));assert.equal(metadata.storage.privilegeStateUnchanged,true);
 phase="native-exit";assert.equal(await runtimeGuardianStopped(owner,{windowsHelper:helper}),true);evidence.nativeExitVerified=true;evidence.noAdjacentRuntimeRequired=true;
 phase="runtime-location";const deployment=await runRuntimeCommand(image,["--runtime-package-metadata"],{windowsHelper:helper,cwd:root,env:environment,expectedExecutableSha256:expected,detailed:true,timeout:90000,maxOutputBytes:8192,onGuardianReady:async frame=>{owner=frame;evidence.deploymentOwner=frame;}});assert.equal(deployment.exitCode,0);evidence.runtimeDeployment=JSON.parse(deployment.stdout);assert.equal(evidence.runtimeDeployment.schema,"switchyard-runtime-package-metadata/v1");assert.equal(await runtimeGuardianStopped(owner,{windowsHelper:helper}),true);
 evidence.bundleExtractionObserved=(await readdir(cache)).length>0;assert.equal(evidence.bundleExtractionObserved,true);assert.equal(evidence.runtimeDeployment.extractionBaseSha256,sha(cache));assert.equal(evidence.runtimeDeployment.nativeModules.some(module=>module.name==="coreclr.dll"&&module.location==="configured-extraction"),true);phase="cleanup";
 assert.equal((await readdir(root)).every(name=>["Switchyard.Hotkeys.exe","extracted","owned-command.json"].includes(name)),true);await rm(root,{recursive:true});evidence.isolatedCopyRemoved=true;
}catch(error){failure=error;evidence.failurePhase=phase;evidence.diagnostic=String(error.message).slice(0,512);evidence.failure="The exact copied-helper proof did not complete; preserve its owned staging and native evidence.";}
evidence.success=!failure;await privateWrite(receipt,JSON.stringify(evidence,null,2)+"\n");console.log(JSON.stringify({success:evidence.success,nativeExitVerified:evidence.nativeExitVerified??false,isolatedCopyRemoved:evidence.isolatedCopyRemoved??false,failurePhase:evidence.failurePhase??null,diagnostic:evidence.diagnostic??null,runtimeDeployment:evidence.runtimeDeployment??null,receipt}));if(failure)throw Error(evidence.failure);
