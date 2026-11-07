import test from "node:test";
import assert from "node:assert/strict";
import {randomUUID} from "node:crypto";
import {access,readFile} from "node:fs/promises";
import {join} from "node:path";
import {windowsExecutionFixture} from "./test-support/windows-execution-fixture.mjs";
test("Windows reviewed guest-double audit consumes actual historical Git blobs and authenticates a secret removed from current source",async t=>{
 for(const action of ["shield_codebase_audit","release_shield"]){
 const f=await windowsExecutionFixture(t,{action,shield:true,clean:true,historyInputs:true}),index=await readFile(join(f.root,".git/index")),head=await f.run("rev-parse","HEAD"),live=await readFile(join(f.root,"app.js"));
 for(const path of [...f.sample.content.keys()].filter(path=>path.startsWith(".switchyard-history/")))f.sample.content.set(path,Buffer.from("static fixture must not replace actual Git bytes"));
 await assert.rejects(f.service.useHistoryInputs("personal",f.grant.id,action,[".gitignore"],4,()=>{}),/task-owned/);
 const review=await f.execution.review("personal",f.proposed);assert.equal(review.review.shield.historyWitness.rows.length,2);assert.match(review.confirmation.record.reason,/historical/);const input={requestId:f.proposed.requestId,token:review.confirmation.token},result=await f.execution.apply("personal",input);assert.equal(result.status,"failed",JSON.stringify(result));assert.ok(result.receiptId);assert.ok(result.data.shieldReport.findings.some(row=>row.path.startsWith(".switchyard-history/")&&row.ruleId==="secret.private-key"));assert.equal(result.data.shieldReport.findings.some(row=>row.path==="app.js"),false);assert.equal(result.data.shieldReport.inventory.filter(row=>row.source?.kind==="git-history").length,2);assert.match(result.data.receiptEvidenceEnvelope.evidence.toolVersions.gitHistoryInputs,/^sha256:[a-f0-9]{64}$/);assert.ok(result.data.shieldReport.gaps.includes("git_history_partially_scanned"));assert.equal(result.data.receiptEvidenceEnvelope.completeness,"incomplete");assert.equal(JSON.stringify(result).includes("SYNTHETIC_WINDOWS_HISTORICAL_ONLY_SOURCE"),false);assert.equal(JSON.stringify(result).includes("SYNTHETIC_HISTORY_MESSAGE_NEVER_RETURNED"),false);assert.equal((await f.execution.apply("personal",input)).receiptId,result.receiptId);assert.equal(f.effects(),1);
 const state=await f.store.snapshot("personal");assert.equal(state.repositoryWindowsRuns[0].nativeExitVerified,true);assert.equal(state.repositoryWindowsRuns[0].cleanupPending,false);assert.ok(state.repositoryProbes.every(row=>row.stoppedVerified&&row.scratchCleanupPending===false));assert.deepEqual(await readFile(join(f.root,".git/index")),index);assert.deepEqual(await readFile(join(f.root,"app.js")),live);assert.equal(await f.run("rev-parse","HEAD"),head);await assert.rejects(access(join(f.root,".switchyard-history")),{code:"ENOENT"});
 }
});
test("changed Windows historical target refuses the original approval before a guest-double execution starts",async t=>{
 const f=await windowsExecutionFixture(t,{action:"shield_codebase_audit",shield:true,clean:true,historyInputs:true}),review=await f.execution.review("personal",f.proposed);await f.run("-c","commit.gpgsign=false","commit","--allow-empty","-m","synthetic historical target drift");await assert.rejects(f.execution.apply("personal",{requestId:f.proposed.requestId,token:review.confirmation.token}),/target changed/);assert.equal(f.effects(),0);await assert.rejects(f.execution.review("personal",{...f.proposed,requestId:randomUUID()}),/target changed/);
});
