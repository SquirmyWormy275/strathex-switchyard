import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { windowsExecutionFixture } from "./test-support/windows-execution-fixture.mjs";
import { validateWindowsShield } from "./repository-windows-shield.mjs";
import { readFile } from "node:fs/promises";
import { join } from "node:path";

// Guest execution is doubled. Task/Git, P-256 feeds, file/output witnesses,
// protected budgets, HMAC evidence and recovery are actual host software.
test("all four Windows Shield actions retain pinned scanner observations and incomplete failed receipts; clean input cannot pass",async t=>{
 for(const action of ["shield_change_scan","shield_codebase_audit","shield_supply_chain","release_shield"]){
  const f=await windowsExecutionFixture(t,{action,shield:true}),head=await f.run("rev-parse","HEAD"),review=await f.execution.review("personal",f.proposed),input={requestId:f.proposed.requestId,token:review.confirmation.token};assert.equal(review.review.shield.completeShieldGateAvailable,false);assert.equal(review.review.recipe.workingRoot,"input");assert.equal(review.review.executionPolicy.temporaryQuotaScope,"bounded-exchange");assert.equal(review.review.executionPolicy.guestOperatingSystemDiskQuota,"not-attested");
  const result=await f.execution.apply("personal",input);assert.equal(result.status,"failed",JSON.stringify(result));assert.equal(result.effectDisposition,"committed");assert.ok(result.receiptId);assert.equal(result.providerTaskCompletionVerified,false);assert.ok(result.data.shieldReport.findings.length);assert.equal(result.data.receiptEvidenceEnvelope.outcome,"incomplete");assert.ok(result.data.receiptEvidenceEnvelope.evidence.toolVersions.guestResultManifest);assert.equal((await f.execution.apply("personal",input)).receiptId,result.receiptId);assert.equal(f.effects(),1);
  const s=await f.store.snapshot("personal"),receipt=s.repositoryExecutionJournal.find(e=>e.kind==="receipt.issued"&&e.payload.receipt.id===result.receiptId).payload.receipt;assert.equal(receipt.result,"failed");assert.equal(receipt.completeness,"incomplete");assert.deepEqual(s.repositoryExecutionReviews[0].checkpoint.payload.executionPolicy,review.review.executionPolicy);assert.equal(s.repositoryWindowsRuns[0].nativeExitVerified,true);assert.equal(s.repositoryWindowsRuns[0].cleanupPending,false);assert.equal(await f.run("rev-parse","HEAD"),head);
  if(["shield_supply_chain","release_shield"].includes(action)){assert.equal(result.data.shieldReport.cycloneDx.bomFormat,"CycloneDX");assert.equal(result.data.shieldReport.cycloneDx.compositions[0].aggregate,"unknown");}
 }
 const f=await windowsExecutionFixture(t,{action:"shield_change_scan",shield:true,clean:true}),r=await f.execution.review("personal",f.proposed),result=await f.execution.apply("personal",{requestId:f.proposed.requestId,token:r.confirmation.token});assert.equal(result.status,"incomplete",JSON.stringify(result));assert.deepEqual(result.data.shieldReport.findings,[]);assert.ok(result.receiptId);assert.equal(result.data.receiptEvidenceEnvelope.completeness,"incomplete");
});

