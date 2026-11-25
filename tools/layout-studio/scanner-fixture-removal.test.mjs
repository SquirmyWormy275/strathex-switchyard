import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { readFile, writeFile, readdir } from "node:fs/promises";
import { join } from "node:path";
import { ReceiptLedger } from "../../packages/control-plane/src/receipts.ts";
import { repositoryEffectJournal } from "./repository-effect-journal.mjs";
import { fixture } from "./test-support/scanner-fixtures-fixture.mjs";

test("removal is a separate approved effect, reports quota without paths and cannot reinstate or replace the retired identity", async t => {
  const f = await fixture(t); await f.trust(); const manifestPath = await f.signed();
  await f.perform("install-fixture", { manifestPath }); const before = await f.service.list("personal");
  assert.equal(before.storage.allocatedCount, 1); assert.ok(before.storage.allocatedBytes > 0); assert.equal(JSON.stringify(before.storage).includes(f.stateDirectory), false);
  await assert.rejects(f.service.review("personal", { requestId: randomUUID(), action: "remove-fixture", fixtureId: "synthetic-feed", reason: "remove active feed" }), /Separately revoke/);
  await f.perform("revoke-fixture", { fixtureId: "synthetic-feed", reason: "withdraw" }); assert.equal((await f.service.list("personal")).storage.allocatedBytes, before.storage.allocatedBytes);
  const removed = await f.perform("remove-fixture", { fixtureId: "synthetic-feed", reason: "Explicit retention complete" }); assert.equal(removed.result.status, "completed");
  assert.equal(removed.review.review.summary.remainingFiles.length, 2); assert.equal(JSON.stringify(removed.review.review).includes(f.stateDirectory), false);
  const after = await f.service.list("personal"); assert.equal(after.storage.allocatedCount, 0); assert.equal(after.fixtures[0].status, "removed"); assert.equal(after.trusts[0].status, "active");
  await assert.rejects(readdir(join(f.stateDirectory, "personal/scanner-fixtures/synthetic-feed")), { code: "ENOENT" });
  const duplicate = await f.service.apply("personal", removed.input); assert.equal(duplicate.replayed, true); assert.equal(duplicate.receiptId, removed.result.receiptId);
  await assert.rejects(f.service.review("personal", { requestId: randomUUID(), action: "install-fixture", manifestPath }), /already retained/);
});

test("changed reviewed removal files are preserved before approval consumption or passing receipt", async t => {
  const f = await fixture(t); await f.trust(); await f.perform("install-fixture", { manifestPath: await f.signed() }); await f.perform("revoke-fixture", { fixtureId: "synthetic-feed", reason: "withdraw" });
  const review = await f.service.review("personal", { requestId: randomUUID(), action: "remove-fixture", fixtureId: "synthetic-feed", reason: "remove" }), path = join(f.stateDirectory, "personal/scanner-fixtures/synthetic-feed/content.bin");
  await writeFile(path, "preserve substituted bytes");
  await assert.rejects(f.service.apply("personal", { requestId: review.review.requestId, token: review.confirmation.token }), /Preserve/);
  assert.equal(await readFile(path, "utf8"), "preserve substituted bytes"); assert.equal((await f.service.list("personal")).storage.allocatedCount, 1);
  const receipts = await new ReceiptLedger(repositoryEffectJournal(f.store, "personal", { domain: "fixtures", now: f.now })).list(); assert.equal(receipts.some(r => r.operationId === review.review.requestId), false);
});

test("interrupted removal gets a fresh review of original remaining files without upgrading the original uncertain result", async t => {
  const f = await fixture(t); await f.trust(); await f.perform("install-fixture", { manifestPath: await f.signed() }); await f.perform("revoke-fixture", { fixtureId: "synthetic-feed", reason: "withdraw" });
  const review = await f.service.review("personal", { requestId: randomUUID(), action: "remove-fixture", fixtureId: "synthetic-feed", reason: "remove" }), original = f.store.update; let fail = true;
  // The removal-started journal commits, but its acknowledgement is lost.
  // No unlink is dispatched and the original operation stays incomplete.
  f.store.update = async (...args) => { const value = await original(...args); if (fail && value?.kind === "b122.scanner-fixture.removal-started.v1") { fail = false; throw Error("Synthetic lost removal-started acknowledgement"); } return value; };
  const input = { requestId: review.review.requestId, token: review.confirmation.token }, result = await f.service.apply("personal", input); assert.equal(result.status, "incomplete");
  assert.equal((await f.service.list("personal")).storage.allocatedCount, 1); await f.service.recover("personal");
  const replay = await f.service.apply("personal", input); assert.equal(replay.status, "incomplete"); assert.equal(replay.replayed, true);
  const fresh = await f.perform("remove-fixture", { fixtureId: "synthetic-feed", reason: "Fresh exact retained-files review" }); assert.equal(fresh.review.review.summary.reconcilesPriorRemoval, true); assert.equal(fresh.result.status, "completed");
  assert.equal((await f.service.list("personal")).storage.allocatedCount, 0);
  const retained = (await f.store.snapshot("personal")).scannerFixtureReviews.find(r => r.requestId === review.review.requestId); assert.equal(retained.result.status, "incomplete");
  const receipts = await new ReceiptLedger(repositoryEffectJournal(f.store, "personal", { domain: "fixtures", now: f.now })).list(); assert.equal(receipts.some(r => r.operationId === review.review.requestId), false);
});

test("lost final removal acknowledgement keeps the original result incomplete while committed quota is released", async t => {
  const f = await fixture(t); await f.trust(); await f.perform("install-fixture", { manifestPath: await f.signed() }); await f.perform("revoke-fixture", { fixtureId: "synthetic-feed", reason: "withdraw" });
  const review = await f.service.review("personal", { requestId: randomUUID(), action: "remove-fixture", fixtureId: "synthetic-feed", reason: "remove" }), original = f.store.update; let fail = true;
  f.store.update = async (...args) => { const value = await original(...args); if (fail && value?.kind === "b122.scanner-fixture.remove.v1") { fail = false; throw Error("Synthetic lost removed acknowledgement"); } return value; };
  const input = { requestId: review.review.requestId, token: review.confirmation.token }, result = await f.service.apply("personal", input); assert.equal(result.status, "incomplete");
  const listed = await f.service.list("personal"); assert.equal(listed.fixtures[0].status, "removed"); assert.equal(listed.storage.allocatedCount, 0);
  await f.service.recover("personal"); assert.equal((await f.service.apply("personal", input)).status, "incomplete");
  assert.equal((await new ReceiptLedger(repositoryEffectJournal(f.store, "personal", { domain: "fixtures", now: f.now })).list()).some(r => r.operationId === review.review.requestId), false);
});
