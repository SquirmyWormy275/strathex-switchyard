import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { once } from "node:events";
import { createSuite } from "./suite.mjs";
import { createStudioServer } from "./serve.mjs";
import { ShieldExceptionLedger } from "./shield-exception-ledger.mjs";
import { exceptionFixture } from "./test-support/shield-exceptions-fixture.mjs";

test("exact Personal exception review applies once, retires prior receipts atomically and withdraws without granting a gate", async t => {
  const f = await exceptionFixture(t), review = await f.review(); assert.equal(review.confirmation.record.action, "configure_shield_exceptions"); assert.equal((await f.service.list("personal")).exceptions.length, 0); assert.equal((await f.receipts.get(f.receipt.id)).invalidatedBy, undefined);
  const result = await f.apply(review); assert.equal(result.status, "completed"); assert.equal(result.authorityGranted, false); assert.equal(result.completeShieldGateAvailable, false); assert.equal((await f.apply(review)).receiptId, result.receiptId);
  assert.ok((await f.receipts.get(f.receipt.id)).invalidatedBy); const query = { action: "shield_change_scan", targetSnapshotId: f.target.id, scannerSourceSha256: f.engineSha256, findings: f.report.findings }, evaluation = await f.service.evaluate("personal", query); assert.equal(evaluation.allFindingsExcepted, true); assert.equal(evaluation.gateEligible, false);
  const withdrawal = await f.service.review("personal", { requestId: randomUUID(), action: "revoke", exceptionId: result.exceptionId, reason: "Withdraw synthetic acceptance" }); assert.equal((await f.service.apply("personal", { requestId: withdrawal.review.requestId, token: withdrawal.confirmation.token })).status, "completed"); assert.equal((await f.service.evaluate("personal", query)).applied.length, 0); assert.equal((await f.service.list("personal")).exceptions[0].status, "revoked");
  const snapshot = await f.store.snapshot("personal"); assert.equal(snapshot.shieldExceptionJournal.filter(entry => entry.kind === "receipt.issued").length, 2); assert.equal(snapshot.shieldExceptionJournal.filter(entry => entry.kind === "audit.recorded").length, 2);
});

test("Work, inactive mode, broad fields, unknown findings, stale receipts and changed targets cannot approve exceptions", async t => {
  const f = await exceptionFixture(t);
  await assert.rejects(f.service.review("work", f.proposal), /Personal companion/); f.active("other"); await assert.rejects(f.review(), /Personal companion/); f.active("personal");
  await assert.rejects(f.service.review("personal", { ...f.proposal, authorityGranted: true }), /closed operator/); await assert.rejects(f.service.review("personal", { ...f.proposal, fingerprint: "f".repeat(64) }), /source finding/);
  f.changeTarget(); await assert.rejects(f.review(), /target changed/); assert.equal((await f.service.list("personal")).exceptions.length, 0);
  const expired = await exceptionFixture(t); expired.advance(300000); await assert.rejects(expired.review(), /expired or retired/);
  const retired = await exceptionFixture(t); await retired.receipts.invalidate(retired.receipt.id, "synthetic:withdrawal"); await assert.rejects(retired.review(), /expired or retired/);
});

test("source expiry after one-use approval consumption still refuses the atomic policy commit", async t => {
  const f = await exceptionFixture(t); f.advance(10000); const review = await f.review(), original = f.store.update; let advanced = false;
  f.store.update = async (...args) => { const value = await original(...args); if (!advanced && args[1] === "confirmation-transaction" && value?.allowed === true) { advanced = true; f.advance(290000); } return value; };
  const result=await f.apply(review); f.store.update = original; assert.equal(result.status,"failed");assert.equal(result.effectDisposition,"not_started");assert.equal((await f.apply(review)).replayed,true);assert.equal(advanced, true); assert.equal((await f.service.list("personal")).exceptions.length, 0); assert.equal((await f.receipts.get(f.receipt.id)).invalidatedBy, undefined);
});

test("a policy transaction failure rolls back exception, audit, budget and prior-receipt retirement and cannot reuse consumed approval", async t => {
  const f = await exceptionFixture(t), review = await f.review(), before = await f.store.snapshot("personal"), original = f.store.update;
  f.store.update = async (...args) => { if (args[1] === "shield-exception-apply") { const mutate = args[2]; args[2] = async state => { await mutate(state); throw Error("Synthetic precommit failure"); }; } return original(...args); };
  const result=await f.apply(review);f.store.update = original;assert.equal(result.status,"failed");assert.equal(result.effectDisposition,"not_started");
  const after = await f.store.snapshot("personal"); assert.deepEqual(after.repositoryExecutionJournal, before.repositoryExecutionJournal); assert.deepEqual(after.shieldExceptionJournal.map(entry=>entry.kind),["audit.recorded"]); assert.equal((await f.service.list("personal")).exceptions.length, 0); const duplicate=await f.apply(review);assert.equal(duplicate.replayed,true);assert.equal(duplicate.status,"failed");assert.equal((await f.service.list("personal")).reviews[0].status,"settled");
});

test("lost commit acknowledgement returns only the retained exact outcome on retry, without another policy effect", async t => {
  const f = await exceptionFixture(t), review = await f.review(), original = f.store.update; let fail = true;
  f.store.update = async (...args) => { const result = await original(...args); if (fail && args[1] === "shield-exception-apply") { fail = false; throw Error("Synthetic lost committed acknowledgement"); } return result; };
  const first=await f.apply(review);f.store.update = original;assert.equal(first.status,"completed");assert.equal(first.acknowledgementRecovered,true);
  const result = await f.apply(review); assert.equal(result.status, "completed"); assert.equal(result.replayed, true); assert.equal((await f.service.list("personal")).exceptions.length, 1); const state = await f.store.snapshot("personal"); assert.equal(state.shieldExceptionJournal.filter(entry => entry.kind === "shield.exception-granted/v1").length, 1);
});

test("authenticated exception routes refuse Work/unknown fields and keep protected reviews and journals out of ordinary snapshots", async t => {
  const f = await exceptionFixture(t), suite = createSuite({ store: f.store, shieldExceptions: f.service, agents: { discovery: async () => [], close() {} }, voice: { discovery: async () => ({ available: false }) } }), token = "s".repeat(43), server = createStudioServer({ suite, token });
  server.listen(0, "127.0.0.1"); await once(server, "listening"); const origin = `http://127.0.0.1:${server.address().port}`;
  async function api(path, body = {}, authenticated = true) { const response = await fetch(origin + "/api/suite/" + path, { method: "POST", headers: { Origin: origin, "Content-Type": "application/json", ...(authenticated ? { Authorization: "Bearer " + token } : {}) }, body: JSON.stringify(body) }); return { status: response.status, value: await response.json() }; }
  try {
    assert.equal((await api("host/shield-exceptions/list", {}, false)).status, 401); assert.equal((await api("host/shield-exceptions/list", { compartment: "work" })).status, 409); assert.equal((await api("host/shield-exceptions/list", { command: "untrusted" })).status, 409);
    const review = await api("host/shield-exceptions/review", f.proposal); assert.equal(review.status, 200); const applied = await api("host/shield-exceptions/apply", { requestId: f.proposal.requestId, token: review.value.confirmation.token }); assert.equal(applied.status, 200); assert.equal(applied.value.status, "completed"); assert.equal((await api("host/shield-exceptions/list")).value.exceptions.length, 1);
    const snapshot = (await api("snapshot")).value; assert.equal(Object.hasOwn(snapshot, "shieldExceptionJournal"), false); assert.equal(Object.hasOwn(snapshot, "shieldExceptionReviews"), false);
  } finally { server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); await server.cleanup(); }
});

test("an exception effect observed after its original budget deadline rolls back all policy and receipt effects", async t => {
  const f = await exceptionFixture(t), review = await f.review(), grant = ShieldExceptionLedger.prototype.grant;
  ShieldExceptionLedger.prototype.grant = async function(...args) { const result = await grant.apply(this,args);f.advance(120001);return result; };
  let result;try{result=await f.apply(review);}finally{ShieldExceptionLedger.prototype.grant=grant;}
  assert.equal(result.status,"failed");assert.equal(result.effectDisposition,"not_started");assert.equal((await f.service.list("personal")).exceptions.length,0);assert.equal((await f.receipts.get(f.receipt.id)).invalidatedBy,undefined);const state=await f.store.snapshot("personal");assert.deepEqual(state.shieldExceptionJournal.map(entry=>entry.kind),["audit.recorded"]);
});
