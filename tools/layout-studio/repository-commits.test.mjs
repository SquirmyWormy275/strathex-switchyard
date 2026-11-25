import assert from "node:assert/strict";
import test from "node:test";
import { randomUUID } from "node:crypto";
import { readFile, writeFile, rm } from "node:fs/promises";
import { join } from "node:path";
import { authorityFixture } from "./test-support/task-authority-fixture.mjs";
import { createRepositoryCommits } from "./repository-commits.mjs";
import { runtimeGuardianStopped } from "./runtime-command.mjs";
async function fixture(t) {
  const f = await authorityFixture(t), service = createRepositoryCommits({ store: f.store, authority: f.service, stateDirectory: join(f.stage, "effects"), now: f.now });
  f.onCleanup(() => service.close()); return { ...f, commits: service };
}
async function grant(f, proposed = f.proposed) { const review = await f.service.review("personal", proposed); return f.service.issue("personal", { ...proposed, token: review.confirmation.token }); }
const proposal = authorityId => ({ requestId: randomUUID(), authorityId, message: "Reviewed synthetic suite commit", author: { name: "Synthetic reviewed author", email: "synthetic@example.invalid" } });
test("commit review rejects commands, broader actions and guessed or unsafe authors before native inspection", async t => {
  const f = await fixture(t), p = proposal(randomUUID());
  for (const input of [{ ...p, force: true }, { ...p, paths: ["../outside"] }, { ...p, action: "pr_upsert" }, { ...p, message: " unsafe whitespace " }, { ...p, author: { name: "unsafe\nname", email: "x@example.invalid" } }, { ...p, author: { name: "good", email: "invalid" } }]) await assert.rejects(f.commits.review("personal", input), /exact|Review|UTF-8/);
  assert.equal(f.counters().calls, 0); assert.equal((await f.commits.list("personal")).length, 0);
});
test("separate commit approval is target/author/message bound and revocation or changed files cannot execute it", async t => {
  const f = await fixture(t), authority = await grant(f), p = proposal(authority.id), review = await f.commits.review("personal", p);
  assert.equal(review.review.nativePermissionsChanged, false); assert.equal(review.review.files[0].path, "task.txt"); assert.equal(review.review.files[0].digest.startsWith("sha256:"), true);
  await assert.rejects(f.commits.execute("personal", { requestId: p.requestId, token: review.confirmation.token, message: "substituted" }), /exact reviewed/);
  await assert.rejects(f.commits.execute("personal", { requestId: p.requestId, token: randomUUID() }), /does not match/);
  await writeFile(join(f.root, "task.txt"), "changed after effect review\n");
  await assert.rejects(f.commits.execute("personal", { requestId: p.requestId, token: review.confirmation.token }), /target changed/);
  assert.equal((await f.store.snapshot("personal")).repositoryEffects, undefined);
  await writeFile(join(f.root, "task.txt"), "reviewed\n"); await f.service.revoke("personal", authority.id);
  await assert.rejects(f.commits.execute("personal", { requestId: p.requestId, token: review.confirmation.token }), /revoked/);
});
test("the suite commit service uses the existing exact task grant, native guardians and durable result for duplicate HTTP requests", { skip: process.platform !== "linux" ? "Native Linux suite Git journey; native Windows guardian transport has a separate helper lane" : false }, async t => {
  const f = await fixture(t);
  await writeFile(join(f.root, "delete.txt"), "tracked before deletion\n"); await f.run("add", "delete.txt"); await f.run("-c", "commit.gpgSign=false", "commit", "-m", "synthetic deletion baseline"); await rm(join(f.root, "delete.txt"));
  const authority = await grant(f, { ...f.proposed, paths: ["task.txt", "delete.txt"] }), p = proposal(authority.id), review = await f.commits.review("personal", p), before = await f.run("rev-parse", "HEAD");
  assert.equal(review.review.files.find(f => f.path === "delete.txt").state, "tracked_missing");
  const request = { requestId: p.requestId, token: review.confirmation.token }, outcome = await f.commits.execute("personal", request);
  assert.equal(outcome.status, "completed", JSON.stringify(outcome)); assert.equal(outcome.replayed, false); assert.equal(outcome.nativePermissionsChanged, false); assert.equal(outcome.providerTaskCompletionVerified, false);
  const committed = await f.run("rev-parse", "HEAD"); assert.notEqual(committed, before); assert.equal(await f.run("show", "HEAD:task.txt"), "reviewed\n"); assert.equal((await f.run("ls-tree", "--name-only", "HEAD")).includes("delete.txt"), false);
  assert.equal(await f.run("show", "-s", "--format=%an <%ae>"), "Synthetic reviewed author <synthetic@example.invalid>\n"); assert.equal(await f.run("diff", "--cached", "--name-only"), "");
  const state = await f.store.snapshot("personal"), record = state.repositoryEffects.find(r => r.id === outcome.operationId); assert.equal(record.status, "settled"); assert.equal(record.commands.every(n => n.stoppedVerified), true);
  for (const native of record.commands) assert.equal(await runtimeGuardianStopped(native.ownedRuntime), true);
  const count = record.commands.length, replay = await f.commits.execute("personal", request); assert.equal(replay.replayed, true); assert.equal(replay.operationId, outcome.operationId); assert.equal(replay.receiptId, outcome.receiptId); assert.equal(await f.run("rev-parse", "HEAD"), committed);
  assert.equal((await f.store.snapshot("personal")).repositoryEffects.find(r => r.id === outcome.operationId).commands.length, count);
  assert.equal((await readFile(join(f.stage, "private/personal.sealed.json"), "utf8")).includes(p.message), false);
});
