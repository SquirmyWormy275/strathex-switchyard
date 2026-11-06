#!/usr/bin/env node
/** Actual native PE and no-effect setup preflight; never displays a UAC prompt. */
import assert from "node:assert/strict";
import {createHash,randomUUID} from "node:crypto";
import {readFile} from "node:fs/promises";
import {join,isAbsolute} from "node:path";
import {tmpdir} from "node:os";
import {runRuntimeCommand,runtimeGuardianStopped,runtimeWorkerStartFailureEvidence} from "../tools/layout-studio/runtime-command.mjs";
import {desktopEnvironment} from "../tools/layout-studio/process-environment.mjs";
import {privateWrite} from "../tools/layout-studio/private-fs.mjs";
import {verifyNativeSetupImage} from "./windows-setup-image.mjs";
const flags=process.argv.slice(2);
if(process.platform!=="win32"||flags.length!==3||flags[0]!=="--synthetic"||!flags[1].startsWith("--helper=")||!flags[2].startsWith("--setup=")||!isAbsolute(flags[1].slice(9))||!isAbsolute(flags[2].slice(8)))throw Error("Use the Windows-only no-effect native setup proof with exact helper and setup images.");
const helper=flags[1].slice(9),setup=flags[2].slice(8),bytes=await readFile(setup),expected=createHash("sha256").update(bytes).digest("hex"),checks=[],owners=[],receipt=join(process.env.RUNNER_TEMP||tmpdir(),"switchyard-native-setup-verification.json");
const evidence={schema:"switchyard-native-setup-proof/v1",sourceCommit:process.env.GITHUB_SHA??null,setupSha256:expected,checks,elevationRequested:false,serviceInstalled:false,volumeOpened:false};let failure;
async function execute(args,code){const result=await runRuntimeCommand(setup,args,{windowsHelper:helper,expectedExecutableSha256:expected,env:desktopEnvironment(),timeout:30000,maxOutputBytes:8192,detailed:true,onGuardianReady:async frame=>{owners.push(frame);}});assert.equal(result.exitCode,code);assert.equal(await runtimeGuardianStopped(owners.at(-1),{windowsHelper:helper}),true);return JSON.parse(result.stdout);}
try{
 evidence.image=verifyNativeSetupImage(bytes);checks.push("native x64 image limits dependent DLL loading to System32 and defers UI libraries until their first call");
 const metadata=await execute(["--metadata"],0);assert.equal(metadata.schema,"switchyard-windows-native-setup/v1");assert.equal(metadata.status,"available");assert.match(metadata.clientSid,/^S-1-5-21-(?:[0-9]+-){3}[0-9]+$/);assert.equal(metadata.effectStarted,false);checks.push("metadata observes only the current native user without elevation");
 const unknown=await execute(["--untrusted-command"],2);assert.equal(unknown.status,"unavailable");assert.equal(unknown.effectStarted,false);checks.push("unknown commands cannot select a program, path or effect");
 const changed=await execute(["--install-bootstrap",metadata.clientSid,randomUUID(),"0".repeat(64)],2);assert.equal(changed.status,"unavailable");assert.equal(changed.effectStarted,false);checks.push("changed adjacent helper bytes are refused before any elevation or installation");
 evidence.nativeExitVerified=(await Promise.all(owners.map(frame=>runtimeGuardianStopped(frame,{windowsHelper:helper})))).every(Boolean);assert.equal(evidence.nativeExitVerified,true);checks.push("all exact native guardians exited independently");
 assert.equal(await runtimeGuardianStopped({...owners[0],guardianPid:process.pid},{windowsHelper:helper}),true);process.kill(process.pid,0);checks.push("an unrelated live PID with a different creation time cannot replace an exited guardian or its original empty Job Object");
}catch(error){failure=error;evidence.diagnostic=String(error.message).slice(0,512);evidence.workerStartFailure=runtimeWorkerStartFailureEvidence(error.runtimeWorkerStartFailure)??null;}
evidence.success=!failure;await privateWrite(receipt,JSON.stringify({...evidence,nativeOwners:owners},null,2)+"\n");console.log(JSON.stringify({success:evidence.success,checks:checks.length,diagnostic:evidence.diagnostic??null,workerStartFailure:evidence.workerStartFailure??null,receipt}));if(failure)throw Error("The native setup no-effect proof failed; no UAC or service acceptance is claimed.");
