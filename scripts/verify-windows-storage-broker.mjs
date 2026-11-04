#!/usr/bin/env node
/** Install only this exact metadata bootstrap on a disposable elevated CI host. */
import assert from "node:assert/strict";
import {createHash,randomUUID} from "node:crypto";
import {readFile} from "node:fs/promises";
import {join,isAbsolute} from "node:path";
import {tmpdir} from "node:os";
import {desktopEnvironment} from "../tools/layout-studio/process-environment.mjs";
import {runRuntimeCommand,runtimeGuardianStopped} from "../tools/layout-studio/runtime-command.mjs";
import {privateWrite} from "../tools/layout-studio/private-fs.mjs";
const flags=process.argv.slice(2),names=["--helper=","--dotnet=","--proof="];
if(process.platform!=="win32"||process.env.GITHUB_ACTIONS!=="true"||process.env.RUNNER_OS!=="Windows"||flags.length!==4||flags[0]!=="--synthetic"||names.some((name,i)=>!flags[i+1]?.startsWith(name)||!isAbsolute(flags[i+1].slice(name.length))))throw Error("Use the explicit disposable Windows broker CI proof with helper, dotnet and proof paths.");
const [helper,dotnet,assembly]=names.map((name,i)=>flags[i+1].slice(name.length)),sha=bytes=>createHash("sha256").update(bytes).digest("hex"),helperSha256=sha(await readFile(helper)),installationId=randomUUID(),owners=[],checks=[];
const evidence={schema:"switchyard-windows-storage-broker-bootstrap-proof/v1",sourceCommit:process.env.GITHUB_SHA??null,installationId,helperSha256,checks,volumeOpened:false,guestLaunched:false,accountCreated:false,normalUserSetupAccepted:false};let failure;
async function owned(executable,args,{inputText,environment=desktopEnvironment()}={}){
 const result=await runRuntimeCommand(executable,args,{windowsHelper:helper,expectedExecutableSha256:sha(await readFile(executable)),env:environment,inputText,detailed:true,timeout:120000,maxOutputBytes:65536,onGuardianReady:async frame=>{owners.push(frame);await save();}});
 assert.equal(await runtimeGuardianStopped(owners.at(-1),{windowsHelper:helper}),true,"The exact proof command has no independently verified exit.");assert.equal(result.exitCode,0,"A bootstrap proof command failed.");return result.stdout;
}
const receipt=join(process.env.RUNNER_TEMP||tmpdir(),"switchyard-storage-broker-bootstrap-verification.json");
async function save(){await privateWrite(receipt,JSON.stringify({...evidence,nativeOwners:owners},null,2)+"\n");}
async function broker(action,extra={}){return JSON.parse(await owned(helper,["--windows-storage-broker"],{inputText:JSON.stringify({schema:"switchyard-windows-storage-broker-host/v1",action,...extra})}));}
try{
 assert.equal((await broker("metadata")).status,"unavailable","Preserve any pre-existing broker installation.");checks.push("no pre-existing broker was reused");
 const whoami=join(process.env.SystemRoot||process.env.SYSTEMROOT||"C:\\Windows","System32","whoami.exe"),identity=await owned(whoami,["/user","/fo","csv","/nh"]),matches=identity.match(/S-1-5-21-(?:[0-9]{1,10}-){3}[0-9]{1,10}/g);assert.equal(matches?.length,1);const clientSid=matches[0],scope=sha(clientSid),binding={clientSid,installationId,helperSha256};evidence.ownerScope=scope;
 const installed=await broker("install-bootstrap",binding);assert.equal(installed.status,"bootstrap-ready");assert.equal(installed.installationId,installationId);assert.equal(installed.ownerScope,scope);assert.equal(installed.serviceImageSha256,helperSha256);assert.equal(installed.protocolVerified,true);assert.equal(installed.brokerImplemented,false);assert.equal(installed.serviceInstalled,true);checks.push("exact protected service installed and fresh signed metadata verified");
 const metadata=await broker("metadata");evidence.metadataObservation=metadata;assert.equal(metadata.status,"bootstrap-ready");assert.equal(metadata.installationId,installationId);assert.equal(metadata.protocolVerified,true);assert.equal(metadata.effectStarted,false);checks.push("ordinary client metadata reaches only its original installed key");
 const proof=JSON.parse(await owned(dotnet,[assembly,"--native-service"],{environment:{...desktopEnvironment(),SWITCHYARD_TEST_BROKER_INSTALLATION_ID:installationId}}));assert.equal(proof.success,true);assert.equal(proof.checks,16);assert.equal(proof.nativeServiceChecks,12);assert.equal(proof.volumeOpened,false);evidence.restrictedClientChecks=proof.nativeServiceChecks;checks.push("twelve actual restricted-client, private-cache and malformed-pipe boundaries verified");
 const removed=await broker("remove-bootstrap",binding);assert.equal(removed.status,"removed");assert.equal(removed.serviceRemovedVerified,true);assert.equal(removed.filesRemovedVerified,true);checks.push("exact SCM and captured native process exited before inventoried files were removed");
 assert.equal((await broker("metadata")).status,"unavailable");checks.push("removed broker cannot answer a new signed metadata challenge");
 evidence.nativeExitVerified=(await Promise.all(owners.map(frame=>runtimeGuardianStopped(frame,{windowsHelper:helper})))).every(Boolean);assert.equal(evidence.nativeExitVerified,true);
}catch(error){failure=error;evidence.failure="The scoped bootstrap proof did not complete; preserve its original protected installation, runtime inventory and service ownership. No retry or broad cleanup was attempted.";}
evidence.success=!failure;await save();console.log(JSON.stringify({success:evidence.success,checks:checks.length,restrictedClientChecks:evidence.restrictedClientChecks??0,metadataObservation:evidence.metadataObservation??null,receipt}));if(failure)throw Error(evidence.failure);
