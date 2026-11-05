import test from "node:test";
import assert from "node:assert/strict";
import { once } from "node:events";
import { createStudioServer } from "./serve.mjs";
import { createSuite } from "./suite.mjs";
import { randomUUID } from "node:crypto";
import { mkdtemp, rm, readFile, writeFile, readdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createScannerAuthority, signScannerFixture } from "../../scripts/b122-scanner-fixture.mjs";
import { createSuiteStore } from "./suite-store.mjs";
import { createScannerFixtures } from "./scanner-fixtures.mjs";
import { repositoryEffectJournal } from "./repository-effect-journal.mjs";
import { ReceiptLedger } from "../../packages/control-plane/src/receipts.ts";
import { DurableBudgetManager } from "../../packages/control-plane/src/budgets.ts";

async function fixture(t) {
  const root = await mkdtemp(join(tmpdir(), "sx-fixtures-")), keys = new Map(); let time = Date.UTC(2026, 10, 4), active = "personal";
  const store = createSuiteStore({ root: join(root, "private"), secrets: { get: async (c,p) => keys.get(c+p), set: async (c,p,v) => { keys.set(c+p,v); } } });
  await store.initialize("personal"); await store.update("personal", "synthetic-companion", s => { s.mode = "personal-companion"; });
  const now = () => time, authority = await createScannerAuthority({ outputDirectory: join(root, "authority"), authorityId: "synthetic-authority", allowedKinds: ["scanner", "advisory"], expiresAt: new Date(time + 86400000).toISOString(), now: new Date(time) });
  const policy = JSON.parse(await readFile(authority.trustPolicyPath, "utf8")), stateDirectory = join(root, "fixtures"), service = createScannerFixtures({ store, stateDirectory, isActive: async c => active === c, now });
  async function perform(action, payload) { const review = await service.review("personal", { requestId: randomUUID(), action, ...payload }); const input = { requestId: review.review.requestId, token: review.confirmation.token }; return { review, input, result: await service.apply("personal", input) }; }
  async function signed(id = "synthetic-feed", kind = "scanner") {
    const contentPath = join(root, id + "-source.bin"); await writeFile(contentPath, "synthetic signed evidence bytes");
    const outputDirectory = join(root, id);
    await signScannerFixture({ ...authority, contentPath, outputDirectory, id, kind, feedVersion: "synthetic-v1", toolName: "synthetic-tool", toolVersion: "1.0.0", expiresAt: new Date(time + 3600000).toISOString(), maximumAgeSeconds: 3600, now: new Date(time) });
    return join(outputDirectory, "manifest.json");
  }
  t.after(async () => { active = "personal"; await service.close(); await rm(root, { recursive: true, force: true }); });
  return { root, store, service, policy, stateDirectory, now, signed, perform, trust: () => perform("install-trust", { policy }), advance: ms => { time += ms; }, active: c => { active = c; } };
}

test("Personal fixture maintenance has an exact one-use approval, protected receipt and no task authority or public key/path exposure", async t => {
  const f = await fixture(t), review = await f.service.review("personal", { requestId: randomUUID(), action: "install-trust", policy: f.policy });
  assert.equal((await f.service.list("personal")).trusts.length, 0); assert.equal(review.confirmation.record.action, "configure_scanner_fixtures");
  assert.equal(JSON.stringify(review.review).includes("BEGIN PUBLIC KEY"), false); const input = { requestId: review.review.requestId, token: review.confirmation.token }, result = await f.service.apply("personal", input);
  assert.equal(result.status, "completed"); assert.equal(result.authorityGranted, false); const listed = await f.service.list("personal"); assert.equal(listed.trusts.length, 1); assert.equal(Object.hasOwn(listed.trusts[0], "publicKeyPem"), false);
  const repeat = await f.service.apply("personal", input); assert.equal(repeat.replayed, true); assert.equal(repeat.receiptId, result.receiptId);
  const receipts = await new ReceiptLedger(repositoryEffectJournal(f.store, "personal", { domain: "fixtures", now: f.now })).list(); assert.equal(receipts.length, 1); assert.equal(receipts[0].action, "configure_scanner_fixtures"); assert.equal(receipts[0].result, "passed");
});
test("signed scanner/advisory packages are reviewed, copied, freshly verified and independently revoked", async t => {
  const f = await fixture(t); await f.trust(); const scanner = await f.signed(), advisory = await f.signed("advisory-feed", "advisory");
  assert.equal((await f.perform("install-fixture", { manifestPath: scanner })).result.status, "completed"); assert.equal((await f.perform("install-fixture", { manifestPath: advisory })).result.status, "completed");
  const resolve = () => f.service.resolve("personal", { scannerFixtureIds: ["synthetic-feed"], advisoryFixtureIds: ["advisory-feed"], observedAt: new Date(f.now()) });
  assert.equal((await resolve()).length, 2); const listed = await f.service.list("personal"); assert.equal(listed.fixtures.some(r => Object.hasOwn(r, "packageRoot")), false);
  assert.equal((await f.perform("revoke-fixture", { fixtureId: "synthetic-feed", reason: "Synthetic withdrawal" })).result.status, "completed"); await assert.rejects(resolve(), /not actively installed/);
  assert.equal((await f.perform("revoke-trust", { authorityId: f.policy.authorityId, keyId: f.policy.keyId, reason: "Synthetic authority withdrawal" })).result.status, "completed");
  await assert.rejects(f.service.resolve("personal", { scannerFixtureIds: [], advisoryFixtureIds: ["advisory-feed"], observedAt: new Date(f.now()) }), /authority.*unavailable|revoked/);
});
test("changed signed source or trust state cannot inherit a prior review", async t => {
  const f = await fixture(t); await f.trust(); const first = await f.signed(), replacement = await f.signed("other-feed", "advisory");
  const review = await f.service.review("personal", { requestId: randomUUID(), action: "install-fixture", manifestPath: first }); await writeFile(first, await readFile(replacement));
  await assert.rejects(f.service.apply("personal", { requestId: review.review.requestId, token: review.confirmation.token }), /changed after review/); assert.equal((await f.service.list("personal")).fixtures.length, 0);
  const second = await f.service.review("personal", { requestId: randomUUID(), action: "install-fixture", manifestPath: replacement });
  await f.perform("revoke-trust", { authorityId: f.policy.authorityId, keyId: f.policy.keyId, reason: "Withdraw before old review" });
  await assert.rejects(f.service.apply("personal", { requestId: second.review.requestId, token: second.confirmation.token }), /state changed after review/);
});
test("Work, inactive/keyboard-only mode, private signing keys and authority overrides cannot start fixture administration", async t => {
  const f = await fixture(t), proposal = { requestId: randomUUID(), action: "install-trust", policy: f.policy }; await f.store.initialize("work", "work");
  await assert.rejects(f.service.review("work", proposal), /Personal companion/); await assert.rejects(f.service.list("work"), /Personal companion/);
  await assert.rejects(f.service.review("personal", { ...proposal, approved: true }), /closed operator/); f.active("work"); await assert.rejects(f.service.review("personal", proposal), /Personal companion/); f.active("personal");
  await f.store.update("personal", "synthetic-mode", s => { s.mode = "keyboard-only"; }); await assert.rejects(f.service.review("personal", proposal), /Personal companion/);
  await f.store.update("personal", "synthetic-mode", s => { s.mode = "personal-companion"; });
  await assert.rejects(f.service.review("personal", { ...proposal, policy: { ...f.policy, publicKeyPem: await readFile(join(f.root, "authority/private-key.pem"), "utf8") } }), /only a public key/);
  await assert.rejects(f.service.review("personal", { requestId: randomUUID(), action: "install-fixture", manifestPath: "https://untrusted.invalid/feed.json" }), /absolute signed fixture/);
  if (process.platform === "win32") await assert.rejects(f.service.review("personal", { requestId: randomUUID(), action: "install-fixture", manifestPath: "\\\\untrusted\\share\\feed.json" }), /local drive/);
  assert.equal((await f.service.list("personal")).trusts.length, 0);
});
test("expiry and changed workspace bindings refuse approval before any registry effect", async t => {
  const f = await fixture(t), review = await f.service.review("personal", { requestId: randomUUID(), action: "install-trust", policy: f.policy });
  f.advance(300001); await assert.rejects(f.service.apply("personal", { requestId: review.review.requestId, token: review.confirmation.token }), /expired/);
  const fresh = await f.service.review("personal", { requestId: randomUUID(), action: "install-trust", policy: f.policy }); await f.store.update("personal", "synthetic-account-change", s => { s.accounts.push("synthetic-account"); });
  await assert.rejects(f.service.apply("personal", { requestId: fresh.review.requestId, token: fresh.confirmation.token }), /workspace changed/); assert.equal((await f.service.list("personal")).trusts.length, 0);
});
test("a lost committed fixture acknowledgement preserves exact files and original outcome, then releases only known-stopped host budget without replay", async t => {
  const f = await fixture(t); await f.trust(); const manifestPath = await f.signed(), review = await f.service.review("personal", { requestId: randomUUID(), action: "install-fixture", manifestPath }), original = f.store.update; let fail = true;
  f.store.update = async (...args) => { const value = await original(...args); if (fail && value?.kind === "b122.scanner-fixture.install.v1") { fail = false; throw Error("Synthetic lost committed fixture acknowledgement"); } return value; };
  const input = { requestId: review.review.requestId, token: review.confirmation.token }, result = await f.service.apply("personal", input); assert.equal(result.status, "incomplete");
  const path = join(f.stateDirectory, "personal/scanner-fixtures/synthetic-feed/content.bin"), bytes = await readFile(path); assert.equal((await f.service.list("personal")).fixtures.length, 1);
  assert.equal((await f.service.recover("personal")).stopped, true); const repeat = await f.service.apply("personal", input); assert.equal(repeat.replayed, true); assert.equal(repeat.status, "incomplete"); assert.deepEqual(await readFile(path), bytes);
  const budgets = await new DurableBudgetManager(repositoryEffectJournal(f.store, "personal", { domain: "fixtures", now: f.now }), { clock: () => new Date(f.now()).toISOString() }).list(); assert.equal(budgets.some(b => b.operationId === review.review.requestId && b.state === "running"), false);
  assert.equal((await f.perform("revoke-fixture", { fixtureId: "synthetic-feed", reason: "Disable original uncertain installation" })).result.status, "completed");
});


test("lost admission acknowledgement settles its durable unstarted claim even when the claim ID was not returned", async t => {
  const f = await fixture(t), review = await f.service.review("personal", { requestId: randomUUID(), action: "install-trust", policy: f.policy }), original = f.store.update; let fail = true;
  f.store.update = async (...args) => { const value = await original(...args); if (fail && args[1] === "repository-effect-journal" && typeof value === "string") { fail = false; throw Error("Synthetic lost admission acknowledgement"); } return value; };
  const result = await f.service.apply("personal", { requestId: review.review.requestId, token: review.confirmation.token }); assert.equal(result.effectDisposition, "not_started"); assert.equal((await f.service.list("personal")).trusts.length, 0);
  const budgets = await new DurableBudgetManager(repositoryEffectJournal(f.store, "personal", { domain: "fixtures", now: f.now }), { clock: () => new Date(f.now()).toISOString() }).list();
  assert.equal(budgets.filter(b => b.operationId === review.review.requestId).length, 1); assert.equal(budgets.some(b => b.state === "running"), false);
});
test("scope cancellation after an observed registry effect preserves facts without passing a receipt or replaying the effect", async t => {
  const f = await fixture(t), review = await f.service.review("personal", { requestId: randomUUID(), action: "install-trust", policy: f.policy }), original = f.store.update;
  let entered, release; const ready = new Promise(r => { entered = r; }), hold = new Promise(r => { release = r; });
  f.store.update = async (...args) => { const result = await original(...args); if (args[1] === "scanner-fixture-effect-observed") { entered(); await hold; } return result; };
  const applying = f.service.apply("personal", { requestId: review.review.requestId, token: review.confirmation.token }); await ready;
  const stopped = f.service.stopCompartment("personal"); release(); assert.equal((await applying).status, "incomplete"); assert.equal((await stopped).stopped, true);
  assert.equal((await f.service.list("personal")).trusts.length, 1); await f.service.recover("personal");
  const receipts = await new ReceiptLedger(repositoryEffectJournal(f.store, "personal", { domain: "fixtures", now: f.now })).list(); assert.deepEqual(receipts, []);
});
test("the authenticated Suite routes connect exact fixture review/apply, refuse Work and omit private ownership from ordinary snapshots", async t => {
  const f = await fixture(t); await f.store.initialize("work", "work");
  const suite = createSuite({ store: f.store, fixtureAdministration: f.service, agents: { discovery: async () => [], close() {} }, voice: { discovery: async () => ({ available: false }) } });
  const token = "r".repeat(43), server = createStudioServer({ suite, token }); server.listen(0, "127.0.0.1"); await once(server, "listening"); const origin = `http://127.0.0.1:${server.address().port}`;
  async function api(path, body = {}, auth = true) { const r = await fetch(origin + "/api/suite/" + path, { method: "POST", headers: { Origin: origin, "Content-Type": "application/json", ...(auth ? { Authorization: "Bearer " + token } : {}) }, body: JSON.stringify(body) }); return { status: r.status, value: await r.json() }; }
  try {
    assert.equal((await api("host/scanner-fixtures/list", {}, false)).status, 401);
    assert.equal((await api("host/scanner-fixtures/list", { compartment: "work" })).status, 409); assert.equal((await api("host/scanner-fixtures/recover", { compartment: "work" })).status, 409);
    const review = await api("host/scanner-fixtures/review", { requestId: randomUUID(), action: "install-trust", policy: f.policy }); assert.equal(review.status, 200);
    const applied = await api("host/scanner-fixtures/apply", { requestId: review.value.review.requestId, token: review.value.confirmation.token }); assert.equal(applied.status, 200); assert.equal(applied.value.status, "completed");
    assert.equal((await api("host/scanner-fixtures/list", { executable: "untrusted" })).status, 409);
    const snapshot = (await api("snapshot")).value; assert.equal(Object.hasOwn(snapshot, "scannerFixtureJournal"), false); assert.equal(Object.hasOwn(snapshot, "scannerFixtureReviews"), false);
  } finally { server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); await server.cleanup(); }
});

test("a foreign live maintenance claim blocks admission without being settled or attributed to the new review", async t => {
  const f = await fixture(t), budgets = new DurableBudgetManager(repositoryEffectJournal(f.store, "personal", { domain: "fixtures", now: f.now }), { clock: () => new Date(f.now()).toISOString() }), foreign = randomUUID();
  await budgets.configure({ version: "synthetic-existing-claim", commandClasses: { configure_scanner_fixtures: { maxConcurrent: 1, timeoutMs: 120000, maxAttempts: 1, windowMs: 3600000, maxClaimsPerWindow: 24, maxCostUnitsPerWindow: 24, defaultCostUnits: 1 } } });
  const claim = await budgets.claim({ operationId: foreign, commandClass: "configure_scanner_fixtures" }); assert.equal(claim.allowed, true); await budgets.start(claim.claim.id);
  const review = await f.service.review("personal", { requestId: randomUUID(), action: "install-trust", policy: f.policy }), result = await f.service.apply("personal", { requestId: review.review.requestId, token: review.confirmation.token });
  assert.equal(result.effectDisposition, "not_started"); assert.equal((await f.service.list("personal")).trusts.length, 0); assert.equal((await budgets.get(claim.claim.id)).state, "running");
});

test("a late effect cannot earn a passing receipt after the original maintenance budget expires", async t => {
  const f = await fixture(t), review = await f.service.review("personal", { requestId: randomUUID(), action: "install-trust", policy: f.policy }), original = f.store.update;
  f.store.update = async (...args) => { const value = await original(...args); if (args[1] === "scanner-fixture-effect-observed") f.advance(120001); return value; };
  const result = await f.service.apply("personal", { requestId: review.review.requestId, token: review.confirmation.token });
  assert.equal(result.status, "incomplete"); assert.equal((await f.service.list("personal")).trusts.length, 1);
  assert.deepEqual(await new ReceiptLedger(repositoryEffectJournal(f.store, "personal", { domain: "fixtures", now: f.now })).list(), []);
  assert.equal((await f.service.recover("personal")).stopped, true);
});

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
