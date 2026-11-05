import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { createSuiteStore } from "./suite-store.mjs";
import { repositoryEffectJournal, repositoryEffectTransaction } from "./repository-effect-journal.mjs";
import { ShieldExceptionLedger, validateException } from "./shield-exception-ledger.mjs";
import { ReceiptLedger } from "../../packages/control-plane/src/receipts.ts";

async function fixture(t) {
  const root = await mkdtemp(join(tmpdir(), "sx-exceptions-")), keys = new Map(); let time = Date.UTC(2026, 10, 4);
  const now = () => time, store = createSuiteStore({ root, secrets: { get: async (c,p) => keys.get(c+p), set: async (c,p,v) => keys.set(c+p,v) }, clock: now }); await store.initialize("personal");
  const journal = repositoryEffectJournal(store, "personal", { domain: "shield-policy", now }), ledger = new ShieldExceptionLedger(journal, { now });
  t.after(() => rm(root, { recursive: true, force: true }));
  const input = { action: "shield_change_scan", targetSnapshotId: "a".repeat(64), scannerSourceSha256: "b".repeat(64), sourceReceiptId: "protected-source-receipt", fingerprint: "c".repeat(64), ruleId: "synthetic.rule", path: ".env", reason: "Synthetic test fixture is intentionally present", expiresAt: new Date(time + 3600000).toISOString() };
  const request = { action: input.action, targetSnapshotId: input.targetSnapshotId, scannerSourceSha256: input.scannerSourceSha256, findings: [{ fingerprint: input.fingerprint, ruleId: input.ruleId, path: input.path }] };
  return { store, journal, ledger, now, input, request, advance: ms => { time += ms; } };
}

test("exceptions match only exact action, target, scanner source, finding rule and path while coverage stays incomplete", async t => {
  const f = await fixture(t), exception = await f.ledger.grant(f.input, "authenticated-synthetic-review"), matched = await f.ledger.evaluate(f.request);
  assert.equal(matched.applied[0].exceptionId, exception.id); assert.equal(matched.allFindingsExcepted, true); assert.equal(matched.gateEligible, false); assert.equal(matched.completeness, "incomplete");
  for (const change of [{ action: "release_shield" }, { targetSnapshotId: "d".repeat(64) }, { scannerSourceSha256: "e".repeat(64) }, ...["fingerprint", "ruleId", "path"].map(key => ({ findings: [{ ...f.request.findings[0], [key]: key === "fingerprint" ? "f".repeat(64) : "different" }] }))]) { const result = await f.ledger.evaluate({ ...f.request, ...change }); assert.equal(result.applied.length, 0); assert.equal(result.allFindingsExcepted, false); }
  assert.equal((await f.ledger.evaluate({ ...f.request, findings: [] })).allFindingsExcepted, false);
  const partial = await f.ledger.evaluate({ ...f.request, findings: [...f.request.findings, { fingerprint: "d".repeat(64), ruleId: "another", path: "app.js" }] }); assert.equal(partial.applied.length, 1); assert.equal(partial.unexceptedFingerprints.length, 1); assert.equal(partial.allFindingsExcepted, false);
});

test("exception expiry is exact and approval time never extends the original deadline", async t => {
  const f = await fixture(t), input = validateException({ ...f.input, expiresAt: new Date(f.now() + 60000).toISOString() }, f.now());
  f.advance(59000); const granted = await f.ledger.grant(input, "authenticated-synthetic-review"); assert.equal(granted.expiresAt, input.expiresAt);
  f.advance(999); assert.equal((await f.ledger.evaluate(f.request)).allFindingsExcepted, true);
  f.advance(1); assert.equal((await f.ledger.list())[0].status, "expired"); assert.equal((await f.ledger.evaluate(f.request)).applied.length, 0); await assert.rejects(f.ledger.grant(input, "authenticated-synthetic-review"), /unexpired/);
});

test("withdrawals append audit lineage, cannot replay and never mutate or revive the original grant", async t => {
  const f = await fixture(t), id = randomUUID(), granted = await f.ledger.grant(f.input, "authenticated-synthetic-review", id), original = await f.journal.readEntries();
  await assert.rejects(f.ledger.grant(f.input, "authenticated-synthetic-review"), /active exception/); await assert.rejects(f.ledger.grant({ ...f.input, fingerprint: "e".repeat(64) }, "authenticated-synthetic-review", id), /identity is retained/);
  const retired = await f.ledger.revoke(id, "Synthetic policy withdrawal", "authenticated-synthetic-review"); assert.equal(retired.revocationReason, "Synthetic policy withdrawal");
  assert.deepEqual((await f.journal.readEntries()).slice(0, original.length), original); assert.equal((await f.ledger.evaluate(f.request)).applied.length, 0); await assert.rejects(f.ledger.revoke(id, "repeat", "authenticated-synthetic-review"), /already withdrawn/); assert.equal((await f.ledger.list())[0].status, "revoked"); assert.equal(granted.revokedAt, undefined);
});

test("broad, executable, malformed and unbounded exception proposals fail closed and operator reasons are redacted", async t => {
  const f = await fixture(t);
  for (const input of [{ ...f.input, targetSnapshotId: "*" }, { ...f.input, action: "run_target" }, { ...f.input, path: "../outside" }, { ...f.input, command: "untrusted" }, { ...f.input, reason: "" }, { ...f.input, reason: "a\nnew line" }, { ...f.input, expiresAt: new Date(f.now() + 59999).toISOString() }, { ...f.input, expiresAt: new Date(f.now() + 86400001).toISOString() }]) assert.throws(() => validateException(input, f.now()));
  const record = await f.ledger.grant({ ...f.input, reason: "Authorization: Bearer synthetic-secret-12345678901234567890" }, "authenticated-synthetic-review"); assert.equal(record.reason.includes("synthetic-secret-12345678901234567890"), false);
  await f.journal.append("shield.exception-granted/v1", { exception: { ...record, id: randomUUID(), gateEligible: true } }); await assert.rejects(f.ledger.list(), /malformed original/);
});

test("policy change and prior receipt retirement commit atomically across protected journal domains", async t => {
  const f = await fixture(t), execution = new ReceiptLedger(repositoryEffectJournal(f.store, "personal", { domain: "execution", now: f.now }), { clock: () => new Date(f.now()).toISOString() }), receipt = await execution.issue({ operationId: randomUUID(), action: f.input.action, targetSnapshotId: f.input.targetSnapshotId, result: "failed", completeness: "incomplete", evidenceDigest: "original-evidence", policyVersion: "original-policy", toolVersions: {} });
  const change = fail => f.store.update("personal", "synthetic-policy-transaction", async state => {
    const port = domain => { const transaction = repositoryEffectTransaction(state, domain, { now: f.now }); return { transaction: fn => fn(transaction), readEntries: transaction.readEntries }; };
    await new ReceiptLedger(port("execution"), { clock: () => new Date(f.now()).toISOString() }).invalidateActions([f.input.action], "synthetic:policy-change");
    const result = await new ShieldExceptionLedger(port("shield-policy"), { now: f.now }).grant(f.input, "authenticated-synthetic-review"); if (fail) throw Error("Synthetic transaction failure"); return result;
  });
  await assert.rejects(change(true), /transaction failure/); assert.equal((await execution.get(receipt.id)).invalidatedBy, undefined); assert.deepEqual(await f.ledger.list(), []);
  await change(false); assert.equal((await execution.get(receipt.id)).invalidatedBy, "synthetic:policy-change"); assert.equal((await f.ledger.list()).length, 1); assert.equal(await f.journal.verifyChain(), true);
});
