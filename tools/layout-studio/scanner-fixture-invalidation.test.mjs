import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { fixture } from "./test-support/scanner-fixtures-fixture.mjs";
import { ReceiptLedger } from "../../packages/control-plane/src/receipts.ts";
import { repositoryEffectJournal } from "./repository-effect-journal.mjs";
import { validationActions, validationPolicyDigest, validationReceiptGuard, validationReceiptStatus } from "./repository-validation-policy.mjs";
import { scopeHash } from "./confirmations.mjs";

const ledger = (f, compartment = "personal", options = {}) => new ReceiptLedger(repositoryEffectJournal(f.store, compartment, { domain: "execution", now: f.now, ...options }), { clock: () => new Date(f.now()).toISOString() });
const issue = (f, action, compartment = "personal", options) => ledger(f, compartment, options).issue({ operationId: randomUUID(), action, targetSnapshotId: "original-target", result: "passed", completeness: "complete", evidenceDigest: "original-digest", policyVersion: "original-policy", toolVersions: {}, expiresAt: new Date(f.now() + 300000).toISOString() });

test("each reviewed registry change retires all six prior validation actions before its effect and keeps unrelated history intact", async t => {
  const f = await fixture(t); await f.store.initialize("other");
  const steps = [["install-trust", () => ({ policy: f.policy })], ["install-fixture", async () => ({ manifestPath: await f.signed() })], ["revoke-fixture", () => ({ fixtureId: "synthetic-feed", reason: "Synthetic withdrawal" })], ["remove-fixture", () => ({ fixtureId: "synthetic-feed", reason: "Remove retired allocation" })], ["revoke-trust", () => ({ authorityId: f.policy.authorityId, keyId: f.policy.keyId, reason: "Retire public key" })]];
  const run = await issue(f, "run_target"), foreign = await issue(f, "release_shield", "other");
  for (const [action, prepare] of steps) {
    const receipts = await Promise.all(validationActions.map(action => issue(f, action))), before = await f.store.snapshot("personal"), review = await f.service.review("personal", { requestId: randomUUID(), action, ...await prepare() });
    assert.deepEqual(review.review.receiptInvalidation.actions, validationActions); assert.match(review.confirmation.record.reason, /Invalidate all prior pipeline and Shield/);
    assert.equal((await ledger(f).get(receipts[0].id)).invalidatedBy, undefined, "Review alone does not retire receipts");
    const original = f.store.update; let invalidationObserved = false, mutationFailure;
    f.store.update = async (...args) => {
      if (args[1] === "repository-effect-journal") {
        const mutate = args[2];
        args[2] = async state => {
          const before = state.scannerFixtureJournal?.filter(entry => entry.kind.startsWith("b122.scanner-")).length ?? 0;
          const retired = new Set((state.repositoryExecutionJournal ?? []).filter(entry => entry.kind === "receipt.invalidated" && entry.payload.invalidatedBy === `suite:personal:review:${review.review.requestId}`).map(entry => entry.payload.receiptId));
          let value; try { value = await mutate(state); } catch (error) { mutationFailure = error.message; throw error; }
          if ((state.scannerFixtureJournal?.filter(entry => entry.kind.startsWith("b122.scanner-")).length ?? 0) !== before) { invalidationObserved = true; for (const receipt of receipts) assert.ok(retired.has(receipt.id), `Retirement must precede ${action} registry transaction`); }
          return value;
        };
      }
      try { return await original(...args); } catch(error) { mutationFailure=error.message; throw error; }
    };
    const input = { requestId: review.review.requestId, token: review.confirmation.token }, result = await f.service.apply("personal", input); f.store.update = original;
    assert.equal(result.status, "completed", `${action}: ${mutationFailure ?? "registry observer failure"}`); assert.equal(invalidationObserved, true);
    const retained = await f.store.snapshot("personal");
    assert.deepEqual(retained.repositoryExecutionJournal.slice(0, before.repositoryExecutionJournal.length), before.repositoryExecutionJournal);
    assert.equal((await f.service.apply("personal", input)).replayed, true);
    assert.deepEqual((await f.store.snapshot("personal")).repositoryExecutionJournal, retained.repositoryExecutionJournal);
    for (const receipt of receipts) assert.equal(await ledger(f).isFresh(receipt, receipt.targetSnapshotId), false);
  }
  assert.equal((await ledger(f).get(run.id)).invalidatedBy, undefined); assert.equal((await ledger(f, "other").get(foreign.id)).invalidatedBy, undefined);
});

test("a lost invalidation acknowledgement preserves retired receipts and never dispatches or replays registry effects", async t => {
  const f = await fixture(t), receipt = await issue(f, "pipeline_local_gate"), review = await f.service.review("personal", { requestId: randomUUID(), action: "install-trust", policy: f.policy });
  const original = f.store.update; let fault = true;
  f.store.update = async (...args) => { const value = await original(...args); if (fault && args[1] === "repository-effect-journal" && Array.isArray(value) && value.includes(receipt.id)) { fault = false; throw Error("Synthetic lost invalidation acknowledgement"); } return value; };
  const input = { requestId: review.review.requestId, token: review.confirmation.token }, result = await f.service.apply("personal", input); f.store.update = original;
  assert.equal(fault, false); assert.equal(result.status, "incomplete"); assert.equal(result.effectDisposition, "ambiguous"); assert.equal((await f.service.list("personal")).trusts.length, 0);
  assert.ok((await ledger(f).get(receipt.id)).invalidatedBy); assert.equal((await f.service.apply("personal", input)).replayed, true); assert.equal((await f.service.list("personal")).trusts.length, 0);
  assert.equal((await f.service.recover("personal")).stopped, true); assert.equal((await f.service.list("personal")).trusts.length, 0);
  assert.match(validationPolicyDigest(await f.store.snapshot("personal")), /^[a-f0-9]{64}$/, "Verified original host exit permits a new policy read without upgrading the uncertain result");
});

test("legacy reviews require new approval but known legacy host exit can be observed under the original kernel lease", async t => {
  const f = await fixture(t), review = await f.service.review("personal", { requestId: randomUUID(), action: "install-trust", policy: f.policy });
  const input = { requestId: review.review.requestId, token: review.confirmation.token };
  await f.store.update("personal", "synthetic-legacy-review", state => { state.scannerFixtureReviews[0].schema = "suite-scanner-fixtures/v1"; });
  await assert.rejects(f.service.apply("personal", input), /approval is unavailable/); assert.equal((await f.service.list("personal")).trusts.length, 0);
  await f.store.update("personal", "synthetic-legacy-interruption", state => { state.scannerFixtureReviews[0].status = "applying"; });
  let release, entered; const hold = new Promise(resolve => { release = resolve; }), ready = new Promise(resolve => { entered = resolve; });
  const originalLease = f.store.withResourceLock("repository-execution", scopeHash(["suite-scanner-fixtures/v1", f.stateDirectory, "personal"]), async () => { entered(); await hold; });
  await ready; assert.equal((await f.service.recover("personal")).stopped, false); release(); await originalLease;
  assert.equal((await f.service.recover("personal")).stopped, true);
  const row = (await f.store.snapshot("personal")).scannerFixtureReviews[0]; assert.equal(row.maintenanceStoppedVerified, true); assert.equal(row.status, "outcome-unconfirmed"); assert.equal((await f.service.list("personal")).trusts.length, 0);
  assert.match(validationPolicyDigest(await f.store.snapshot("personal")), /^[a-f0-9]{64}$/);
});

test("policy binding blocks late receipts atomically across each validation action, empty invalidations and uncertain maintenance", async t => {
  const f = await fixture(t), before = validationPolicyDigest(await f.store.snapshot("personal"));
  const old = { receiptGuard: validationReceiptGuard(before) };
  assert.ok(await issue(f, "pipeline_local_gate", "personal", old));
  await f.trust();
  for (const action of validationActions) await assert.rejects(issue(f, action, "personal", old), /policy changed/);
  const fresh = validationPolicyDigest(await f.store.snapshot("personal")); assert.notEqual(fresh, before);
  assert.ok(await issue(f, "pipeline_local_gate", "personal", { receiptGuard: validationReceiptGuard(fresh) }));
  const empty = await ledger(f).invalidateActions(["release_shield"], "synthetic:empty-change"); assert.deepEqual(empty, []);
  await assert.rejects(issue(f, "pipeline_local_gate", "personal", { receiptGuard: validationReceiptGuard(fresh) }), /policy changed/);
  await f.store.update("personal", "synthetic-unconfirmed-maintenance", state => { state.scannerFixtureReviews.push({ status: "outcome-unconfirmed" }); });
  const uncertain = await f.store.snapshot("personal");
  assert.throws(() => validationPolicyDigest(uncertain), /Settle or reconcile/);
  await assert.rejects(issue(f, "pipeline_local_gate", "personal", { receiptGuard: validationReceiptGuard(fresh) }), /Settle or reconcile/);
  assert.equal((await ledger(f).list()).filter(receipt => !receipt.invalidatedBy).length, 1);
});

test("receipt status retains historical result while reporting invalidation, exact expiry and unverified current scope", async t => {
  const f = await fixture(t), receipt = await issue(f, "pipeline_local_gate"), row = { outcome: { receiptId: receipt.id }, operationId: receipt.operationId, action: receipt.action, targetSnapshotId: receipt.targetSnapshotId };
  const status = () => validationReceiptStatus(f.store, "personal", row, f.now);
  assert.deepEqual(await status(), { id: receipt.id, historicalResult: "passed", completeness: "complete", invalidatedBy: null, expiresAt: receipt.expiresAt, expired: false, scopeRevalidated: false, gateEligible: false });
  await f.trust(); assert.ok((await status()).invalidatedBy); assert.equal((await status()).historicalResult, "passed"); f.advance(300000); assert.equal((await status()).expired, true);
  await assert.rejects(validationReceiptStatus(f.store, "personal", { ...row, action: "run_target" }, f.now), /unavailable or changed/);
});
