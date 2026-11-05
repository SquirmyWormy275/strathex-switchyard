import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { access, readFile } from "node:fs/promises";
import { join } from "node:path";
import { windowsExecutionFixture } from "./test-support/windows-execution-fixture.mjs";

test("Windows reviewed guest-double scan consumes actual Git index bytes, preserves worktree and authenticates original provenance",async t=>{
  const f=await windowsExecutionFixture(t,{action:"shield_change_scan",shield:true,clean:true,stagedIndex:true}),beforeIndex=await readFile(join(f.root,".git/index")),beforeHead=await f.run("rev-parse","HEAD"),live=await readFile(join(f.root,"app.js"));
  // A static fixture buffer must never substitute for fresh bound index bytes.
  f.sample.content.set(".switchyard-index/app.js",Buffer.from("wrong static fixture bytes"));
  const review=await f.execution.review("personal",f.proposed);assert.equal(review.review.shield.indexWitness.rows[0].objectId,(await f.run("rev-parse",":app.js")).trim());
  const input={requestId:f.proposed.requestId,token:review.confirmation.token},result=await f.execution.apply("personal",input);assert.equal(result.status,"failed",JSON.stringify(result));assert.ok(result.receiptId);assert.ok(result.data.shieldReport.findings.some(finding=>finding.path===".switchyard-index/app.js"&&finding.ruleId==="secret.private-key"));assert.equal(result.data.shieldReport.findings.some(finding=>finding.path==="app.js"),false);assert.equal(result.data.shieldReport.inventory.find(file=>file.source)?.source.path,"app.js");assert.match(result.data.receiptEvidenceEnvelope.evidence.toolVersions.gitIndexInputs,/^sha256:[a-f0-9]{64}$/);assert.equal(result.data.receiptEvidenceEnvelope.completeness,"incomplete");assert.equal(JSON.stringify(result).includes("SYNTHETIC_WINDOWS_STAGED_ONLY_SOURCE"),false);assert.equal((await f.execution.apply("personal",input)).receiptId,result.receiptId);
  assert.equal(f.effects(),1);const state=await f.store.snapshot("personal");assert.equal(state.repositoryWindowsRuns[0].nativeExitVerified,true);assert.equal(state.repositoryWindowsRuns[0].cleanupPending,false);assert.ok(state.repositoryProbes.every(probe=>probe.stoppedVerified&&probe.scratchCleanupPending===false));assert.deepEqual(await readFile(join(f.root,".git/index")),beforeIndex);assert.deepEqual(await readFile(join(f.root,"app.js")),live);assert.equal(await f.run("rev-parse","HEAD"),beforeHead);await assert.rejects(access(join(f.root,".switchyard-index")),{code:"ENOENT"});
});
test("changed Windows index target refuses the original approval before a guest-double execution starts",async t=>{
  const f=await windowsExecutionFixture(t,{action:"shield_change_scan",shield:true,clean:true,stagedIndex:true}),review=await f.execution.review("personal",f.proposed);await f.run("add","app.js");
  await assert.rejects(f.execution.apply("personal",{requestId:f.proposed.requestId,token:review.confirmation.token}),/target changed/);assert.equal(f.effects(),0);await assert.rejects(f.execution.review("personal",{...f.proposed,requestId:randomUUID()}),/target changed/);
});
