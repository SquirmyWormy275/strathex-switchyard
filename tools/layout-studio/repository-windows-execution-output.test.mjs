import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { windowsExecutionFixture as fixture } from "./test-support/windows-execution-fixture.mjs";

// The shared fixture opens no VM, account or keyboard.
test("an unavailable guest preflight remains a no-program outcome instead of claiming a committed Windows task",async t=>{
 const f=await fixture(t);f.backendStatus("unavailable");const reviewed=await f.execution.review("personal",f.proposed),result=await f.execution.apply("personal",{requestId:f.proposed.requestId,token:reviewed.confirmation.token});assert.equal(result.status,"unavailable");assert.equal(result.effectDisposition,"not_started");assert.equal(result.providerTaskCompletionVerified,false);
});
test("verified Windows output is redacted on status reads; changed bytes or a substituted root cannot change the original Run result",async t=>{
 const f=await fixture(t);f.outputs();const reviewed=await f.execution.review("personal",f.proposed),result=await f.execution.apply("personal",{requestId:f.proposed.requestId,token:reviewed.confirmation.token});assert.equal(result.status,"completed");
 const status=await f.execution.status("personal",f.proposed.requestId);assert.equal(status.artifactStatus,"available");assert.match(status.output,/synthetic output/);assert.match(status.output,/REDACTED/);assert.equal(status.output.includes("synthetic-value-123456789"),false);assert.equal(status.diagnostic,"synthetic diagnostic");assert.equal(status.programExitCode,0);
 const original=(await f.store.snapshot("personal")).repositoryExecutionReviews[0].outcome,root=(await f.store.snapshot("personal")).repositoryWindowsRuns[0].result.resultRoot;await writeFile(join(root,"process.stdout.txt"),"changed private output");const changed=await f.execution.status("personal",f.proposed.requestId);assert.equal(changed.artifactStatus,"unavailable");assert.equal(changed.output,null);assert.equal(changed.diagnostic.includes("changed private output"),false);assert.deepEqual(changed.outcome,original);
 await f.store.update("personal","synthetic-artifact-root-substitution",state=>{state.repositoryWindowsRuns[0].result.resultRoot=f.root;});const substituted=await f.execution.status("personal",f.proposed.requestId);assert.equal(substituted.artifactStatus,"unavailable");assert.equal(substituted.output,null);assert.deepEqual(substituted.outcome,original);assert.equal(f.effects(),1);
});
test("verified diagnostic output remains readable for a failed Windows task without promoting it to successful artifacts",async t=>{
 const f=await fixture(t);f.outputs();f.backendStatus("failed");const reviewed=await f.execution.review("personal",f.proposed),result=await f.execution.apply("personal",{requestId:f.proposed.requestId,token:reviewed.confirmation.token});assert.equal(result.status,"failed");assert.equal(result.data.resultRoot,undefined);assert.ok(result.data.diagnosticRoot);assert.equal(result.data.programExitCode,7);
 const status=await f.execution.status("personal",f.proposed.requestId);assert.equal(status.artifactStatus,"available");assert.equal(status.outcome.status,"failed");assert.equal(status.programExitCode,7);assert.equal(status.providerTaskCompletionVerified,false);assert.equal(status.diagnostic,"synthetic diagnostic");assert.equal(status.output.includes("synthetic-value-123456789"),false);assert.equal(f.effects(),1);
});
