import test from "node:test";
import assert from "node:assert/strict";
import { readFile, writeFile, readdir } from "node:fs/promises";
import { join } from "node:path";
import { fixture as registryFixture } from "./test-support/scanner-fixtures-fixture.mjs";
import { withBrowserSurface, until } from "./test-support/browser-ui.mjs";
import { createSuite } from "./suite.mjs";

async function fixture(t, fn) {
  const f = await registryFixture(t), notices = [];
  await f.store.initialize("work", "work");
  const suite = createSuite({ store: f.store, fixtureAdministration: { ...f.service, close: async () => {} }, agents: { discovery: async () => [], close() {} }, voice: { discovery: async () => ({ available: false }) } });
  try { await withBrowserSurface({ ...f, suite }, async c => {
    const { mountFeeds } = await import("./feed-ui.mjs"); mountFeeds({ notify: v => notices.push(v) }); await c.refresh(); assert.equal(c.calls.length, 0);
    await fn({ ...c, notices });
  }); } finally { await suite.close(); }
}
async function policy(c, value = c.policy) {
  c.$("feed-policy-file").files = [new File([JSON.stringify(value)], "public-trust.json", { type: "application/json" })];
  c.change("feed-policy-file", "public-trust.json"); await until(() => !c.$("feed-policy-file").disabled);
}
async function load(c) { c.click("load-feeds"); await c.responses.findLast(r => r.path.endsWith("scanner-fixtures/list")).response; await until(() => !c.$("load-feeds").disabled); }
async function review(c) { c.click("review-feed"); await c.responses.findLast(r => r.path.endsWith("scanner-fixtures/review")).response; await until(() => c.$("feed-review-dialog").open && !c.$("confirm-feed").disabled); }
async function apply(c) { c.click("confirm-feed"); c.$("confirm-feed").dispatchEvent(new Event("click")); await c.responses.findLast(r => r.path.endsWith("scanner-fixtures/apply")).response; await until(() => !c.$("load-feeds").disabled); }
async function install(c) { await policy(c); await review(c); await apply(c); const path = await c.signed(); c.change("feed-action", "install-fixture"); c.change("feed-manifest", path); await review(c); await apply(c); return path; }

test("a public trust file requires exact key review and separate approval; cancellation trusts nothing", async t => fixture(t, async c => {
  await policy(c); assert.equal(c.calls.length, 0); await review(c);
  assert.match(c.$("feed-review-summary").textContent, /synthetic-authority/); assert.ok(c.$("feed-review-summary").textContent.includes(c.policy.keyId)); assert.match(c.$("feed-review-summary").textContent, /All prior pipeline and Shield receipts/);
  assert.equal(c.$("feed-review-summary").textContent.includes("BEGIN PUBLIC KEY"), false); assert.equal((await c.service.list("personal")).trusts.length, 0);
  c.click("cancel-feed"); await until(() => !c.$("feed-review-dialog").open); assert.equal(c.$("confirm-feed").disabled, true);
  await review(c); await apply(c); assert.equal((await c.service.list("personal")).trusts.length, 1); assert.match(c.$("feed-status").textContent, /No task permission/); assert.equal(c.calls.filter(r => r.path.endsWith("scanner-fixtures/apply")).length, 1);
}));

test("private signing keys and oversized policies never leave the browser form", async t => fixture(t, async c => {
  await policy(c, { ...c.policy, publicKeyPem: "-----BEGIN PRIVATE KEY-----\nPRIVATE_TEST_BYTES\n-----END PRIVATE KEY-----" }); assert.equal(c.calls.length, 0); assert.equal(c.$("review-feed").disabled, true); assert.match(c.$("feed-status").textContent, /private signing key/);
  c.$("feed-policy-file").files = [{ size: 16385, text: async () => { throw Error("Must not read oversized file"); } }]; c.change("feed-policy-file", "large.json"); await until(() => !c.$("feed-policy-file").disabled); assert.equal(c.calls.length, 0); assert.equal(c.$("review-feed").disabled, true); assert.match(c.$("feed-status").textContent, /16 KiB/);
  await policy(c, { ...c.policy, secret: "MUST_REMAIN_LOCAL" }); assert.equal(c.calls.length, 0); assert.equal(c.$("review-feed").disabled, true);
  const escaped = JSON.stringify({ ...c.policy, publicKeyPem: "-----BEGIN PRIVATE KEY-----\nABC\n-----END PRIVATE KEY-----" }).replaceAll("PRIVATE", "\\u0050RIVATE");
  c.$("feed-policy-file").files = [new File([escaped], "private.json")]; c.change("feed-policy-file", "private.json"); await until(() => !c.$("feed-policy-file").disabled); assert.equal(c.calls.length, 0); assert.equal(c.$("review-feed").disabled, true);
}));

test("signed feed installation, revocation and exact retained-file removal remain separate reviewed effects", async t => fixture(t, async c => {
  await install(c); const installed = join(c.stateDirectory, "personal/scanner-fixtures/synthetic-feed/content.bin"); assert.equal(await readFile(installed, "utf8"), "synthetic signed evidence bytes");
  c.change("feed-action", "remove-fixture"); assert.equal(c.$("feed-target").options.length, 0); assert.equal(c.$("review-feed").disabled, true);
  c.change("feed-action", "revoke-fixture"); c.change("feed-reason", "Retire synthetic test feed"); await review(c); await apply(c); assert.equal((await c.service.list("personal")).fixtures[0].status, "revoked");
  c.change("feed-action", "remove-fixture"); await review(c); assert.match(c.$("feed-review-summary").textContent, /remainingFiles/); await apply(c); await assert.rejects(readFile(installed), /ENOENT/); assert.equal((await c.service.list("personal")).storage.allocatedCount, 0);
  c.change("feed-action", "revoke-trust"); await review(c); await apply(c); assert.equal((await c.service.list("personal")).trusts[0].status, "revoked"); assert.equal(c.calls.filter(r => r.path.endsWith("scanner-fixtures/apply")).length, 5);
  assert.equal(c.calls.some(r => /coding\/execution|coding\/authority/.test(r.path)), false);
}));

test("changed signed source cannot use the old frontend approval", async t => fixture(t, async c => {
  await policy(c); await review(c); await apply(c); const path = await c.signed(); c.change("feed-action", "install-fixture"); c.change("feed-manifest", path); await review(c);
  await writeFile(path, await readFile(await c.signed("other-feed"))); await apply(c);
  assert.equal((await c.service.list("personal")).fixtures.length, 0); assert.match(c.$("feed-status").textContent, /changed after review/); assert.equal(c.$("confirm-feed").disabled, true);
}));

test("lost successful replies retain registry history without automatic reinstallation", async t => fixture(t, async c => {
  await policy(c); await review(c); const original = globalThis.fetch;
  globalThis.fetch = async (path, options) => { const response = await original(path, options); if (path.endsWith("scanner-fixtures/apply")) { await response.text(); throw Error("Synthetic lost registry reply"); } return response; };
  try { await apply(c); } finally { globalThis.fetch = original; }
  assert.equal((await c.service.list("personal")).trusts.length, 1); assert.match(c.$("feed-status").textContent, /outcome unconfirmed/); assert.match(c.$("feed-history").children[0].textContent, /settled/);
  await load(c); assert.equal(c.calls.filter(r => r.path.endsWith("scanner-fixtures/apply")).length, 1);
}));

test("interrupted maintenance inspection preserves uncertain files and does not upgrade or replay installation", async t => fixture(t, async c => {
  await policy(c); await review(c); await apply(c); const path = await c.signed(); c.change("feed-action", "install-fixture"); c.change("feed-manifest", path); await review(c);
  const update = c.store.update; let fail = true;
  c.store.update = async (...args) => { const result = await update(...args); if (fail && result?.kind === "b122.scanner-fixture.install.v1") { fail = false; throw Error("Synthetic lost installation acknowledgement"); } return result; };
  await apply(c); assert.match(c.$("feed-status").textContent, /incomplete/); assert.match(c.$("feed-history").children[0].textContent, /outcome-unconfirmed/);
  const retained = join(c.stateDirectory, "personal/scanner-fixtures/synthetic-feed"), before = await readdir(retained), bytes = await readFile(join(retained, "content.bin"));
  c.click("recover-feeds"); await c.responses.findLast(r => r.path.endsWith("scanner-fixtures/recover")).response; await until(() => !c.$("recover-feeds").disabled);
  assert.deepEqual(await readdir(retained), before); assert.deepEqual(await readFile(join(retained, "content.bin")), bytes); assert.match(c.$("feed-history").children[0].textContent, /outcome-unconfirmed/); assert.equal(c.calls.filter(r => r.path.endsWith("scanner-fixtures/apply")).length, 2);
}));

test("form changes, Work policy and delayed public-file reads cannot carry trust approval across workspaces", async t => fixture(t, async c => {
  await policy(c); await review(c); c.change("feed-action", "install-fixture"); assert.equal(c.$("feed-review-dialog").open, false); assert.equal(c.$("confirm-feed").disabled, true);
  c.change("feed-action", "install-trust"); let release; c.$("feed-policy-file").files = [{ size: 100, text: () => new Promise(r => { release = r; }) }]; c.change("feed-policy-file", "slow.json"); await until(() => typeof release === "function");
  c.document.dispatchEvent(new Event("switchyard-workspace-changing")); c.document.dispatchEvent(new CustomEvent("switchyard-compartment-state", { detail: await c.store.snapshot("work") })); release(JSON.stringify(c.policy)); await new Promise(r => setImmediate(r));
  assert.equal(c.$("feed-policy-detail").textContent, ""); assert.equal(c.$("load-feeds").disabled, true); assert.equal(c.$("review-feed").disabled, true); const count = c.calls.length; c.$("confirm-feed").dispatchEvent(new Event("click")); assert.equal(c.calls.length, count); assert.equal((await c.service.list("personal")).trusts.length, 0);
}));

test("keyboard-only Personal permits metadata inspection while refusing registry mutations", async t => fixture(t, async c => {
  await c.store.update("personal", "synthetic-mode", s => { s.mode = "keyboard-only"; }); await c.refresh(); await load(c);
  assert.equal(c.$("review-feed").disabled, true); assert.equal(c.$("recover-feeds").disabled, true); assert.equal(c.calls.length, 1); assert.match(c.$("feed-inventory").textContent, /Stored feed bytes: 0/);
}));

test("a late registry review cannot reopen an approval after the selected action changes", async t => fixture(t, async c => {
  await policy(c); const original = globalThis.fetch; let release;
  globalThis.fetch = async (path, options) => { const response = await original(path, options); if (path.endsWith("scanner-fixtures/review")) await new Promise(r => { release = r; }); return response; };
  try {
    c.click("review-feed"); await c.responses.findLast(r => r.path.endsWith("scanner-fixtures/review")).response; await until(() => typeof release === "function");
    c.change("feed-action", "install-fixture"); release(); await until(() => !c.$("feed-action").disabled);
    assert.equal(c.$("feed-review-dialog").open, false); assert.equal(c.$("confirm-feed").disabled, true); assert.equal(c.$("feed-review-summary").textContent, ""); assert.equal((await c.service.list("personal")).trusts.length, 0);
  } finally { release?.(); globalThis.fetch = original; }
}));
