#!/usr/bin/env node
/** Read-only installed workflow compatibility and in-memory validation. Never edits profiles. */
import assert from "node:assert/strict";
import {readFile,writeFile}from"node:fs/promises";
import{createHash}from"node:crypto";
import{join}from"node:path";
import{homedir}from"node:os";
import{pathToFileURL}from"node:url";
import{applicationStatus}from"../deployment/suite/application.mjs";
import{installationRoot}from"../deployment/suite/installation.mjs";
import{verifySuiteRelease}from"../deployment/suite/release.mjs";

const flags=process.argv.slice(2);

if(process.platform!=="linux"||flags.length!==1||flags[0]!=="--read-only-metadata")throw Error("Usage on the pilot: node scripts/verify-workflow-host.mjs --read-only-metadata");

const sha=b=>createHash("sha256").update(b).digest("hex"),app=await applicationStatus();
assert.equal(app.status,"ready");
const root=join(installationRoot(),"versions",app.build),manifest=await verifySuiteRelease(root,{expectedId:app.build,platform:"linux",checkRuntime:true}),source=JSON.parse(await readFile(new URL("../docs/evidence/workflow-identity-source-summary.json",import.meta.url),"utf8")),path="tools/layout-studio/workflow.mjs",digest=sha(await readFile(join(root,path)));
assert.equal(digest,source.sourceFiles[path]);
assert.equal(manifest.development,false);
const checks=["exact-tested-installed-workflow-module"];

const{parseWorkflow,reconcileWorkflow}=await import(pathToFileURL(join(root,path)).href),valid={name:"Synthetic review",roles:[{id:"builder",label:"Builder"}],steps:[{id:"build",label:"Build",roleId:"builder",after:[]},{id:"review",label:"Review",after:["build"]}]};

for(const value of[undefined,null,1,true,["builder"],{},"","bad id"]){assert.throws(()=>parseWorkflow({...valid,roles:[{id:value,label:"Builder"}],steps:[]}));
assert.throws(()=>parseWorkflow({...valid,steps:[{id:value,label:"Build",after:[]}]}));
}checks.push("sixteen-in-memory-non-string-and-invalid-id-refusals");

for(const after of[["build","build"],[1],[null],[["build"]]])assert.throws(()=>parseWorkflow({...valid,steps:[valid.steps[0],{...valid.steps[1],after}]}));
checks.push("duplicate-and-malformed-ordering-refusals");

const reordered=reconcileWorkflow({name:"Synthetic review",roles:["Builder"],steps:["Review","Build"]},parseWorkflow(valid));
assert.deepEqual(reordered.steps.map(s=>s.id),["review","build"]);
assert.equal(reordered.steps[1].roleId,"builder");
const renamed=reconcileWorkflow({name:"Synthetic review",roles:["Implementer"],steps:["Build","Review"]},parseWorkflow(valid));
assert.notEqual(renamed.roles[0].id,"builder");
assert.equal(renamed.steps[0].roleId,null);
checks.push("unchanged-labels-retain-identity-and-renamed-roles-lose-old-meaning");

const{createSuiteStore}=await import(pathToFileURL(join(root,"tools/layout-studio/suite-store.mjs")).href),store=createSuiteStore(),ids=(await store.list()).map(r=>r.id);
let workflows=0;
for(const id of ids){const p=join(homedir(),".local/state/strathex-switchyard/suite",id+".sealed.json"),before=await readFile(p),s=await store.snapshot(id);
for(const w of[s.workflow,...(s.profiles??[]).map(r=>r.profile?.workflow),...(s.profileHistory??[]).map(r=>r.profile?.workflow)].filter(Boolean)){parseWorkflow(w);
workflows++;
}assert.deepEqual(await readFile(p),before);
}checks.push("all-saved-workflows-validate-with-byte-identical-sealed-files");

const r={schema:"switchyard-installed-workflow-identity-metadata/v1",at:new Date().toISOString(),sourceCommit:manifest.sourceCommit,applicationRelease:manifest.id,moduleDigests:{[path]:digest},verifierSourceSha256:sha(await readFile(new URL(import.meta.url))),checks,success:true,workspaces:ids.length,workflows,unchangedSealedFiles:ids.length,metadataOnly:true,workflowEdits:0,providerOrModelRequests:0,liveAccountChanges:0,hardwareOperations:0};
const out=join(homedir(),".local/state/strathex-switchyard/runtime-verification/installed-workflow-identity-metadata-"+Date.now()+".json");
await writeFile(out,JSON.stringify(r,null,2)+"\n",{flag:"wx",mode:0o600});
console.log(JSON.stringify({receipt:out,checks:checks.length,success:true,workspaces:ids.length,workflows,unchangedSealedFiles:ids.length}));
