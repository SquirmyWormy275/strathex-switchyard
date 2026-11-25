import test from "node:test";
import assert from "node:assert/strict";
import { writeFile } from "node:fs/promises";
import { join } from "node:path";
import { authorityFixture } from "./test-support/task-authority-fixture.mjs";
import { connectedExecutionActions } from "./repository-execution-actions.mjs";

test("ignored input ownership is explicit, closed and restricted to pinned Shield actions before any Git query", async t => {
  const f = await authorityFixture(t, { executionActions: connectedExecutionActions("linux") });
  const base = { ...f.proposed, paths: ["task.txt", ".env"], classifications: { includedIgnored: [".env"] }, actions: ["shield_change_scan"] };
  for (const actions of [["local_commit"], ["run_target"], ["pipeline_local_gate"], ["pipeline_clean_reproduction"], ["shield_change_scan", "local_commit"], ["shield_change_scan", "run_target"]]) await assert.rejects(f.service.review("personal", { ...base, actions }), /read-only inputs to the pinned Shield/);
  for (const classifications of [{ includedIgnored: [".env"], excludedIgnored: [".env"] }, { includedIgnored: [".env"], includedUntracked: [".env"] }, { includedIgnored: ["../outside"] }, { includedIgnored: [".env"], includeAllIgnored: true }, []]) await assert.rejects(f.service.review("personal", { ...base, classifications }), /classification|path|list/);
  await assert.rejects(f.service.review("personal", { ...base, paths: ["task.txt"] }), /explicitly owned/);
  assert.equal(f.counters().calls, 0); assert.equal((await f.service.list("personal")).length, 0);
});

test("ignored secret bytes bind review, issuance and revalidation without granting commit or general execution", async t => {
  const f = await authorityFixture(t, { executionActions: connectedExecutionActions("linux") });
  await writeFile(join(f.root, ".gitignore"), "cache.txt\n.env\n"); await writeFile(join(f.root, ".env"), "synthetic-original-secret");
  const input = { ...f.proposed, paths: ["task.txt", ".env"], classifications: { includedIgnored: [".env"] }, actions: ["shield_change_scan", "shield_codebase_audit"] };
  const review = await f.service.review("personal", input); assert.deepEqual(review.scope.classifications.includedIgnored, [".env"]); assert.match(review.confirmation.record.reason, /read-only inputs to the pinned Shield/);
  await writeFile(join(f.root, ".env"), "synthetic-changed-secret"); await assert.rejects(f.service.issue("personal", { ...input, token: review.confirmation.token }), /match|scope/);
  await writeFile(join(f.root, ".env"), "synthetic-original-secret"); const fresh = await f.service.review("personal", input), grant = await f.service.issue("personal", { ...input, token: fresh.confirmation.token });
  const resolved = await f.service.resolve("personal", grant.id, "shield_change_scan"); assert.equal(resolved.files.ignored.find(file => file.path === ".env").classification, "included"); assert.equal(resolved.snapshot.completeness, "complete");
  for (const action of ["local_commit", "run_target", "pipeline_local_gate"]) await assert.rejects(f.service.resolve("personal", grant.id, action));
  await writeFile(join(f.root, ".env"), "synthetic-later-change"); assert.equal((await f.service.revalidate("personal", grant.id)).allowed, false);
  assert.equal((await f.run("ls-files", "--error-unmatch", "--", ".env").then(() => false, () => true)), true); assert.equal(await f.run("ls-files", "--stage", "--", ".env"), "");
});

test("ignored classification cannot silently include ordinary files or bypass unknown ignored inputs", async t => {
  const f = await authorityFixture(t, { executionActions: connectedExecutionActions("linux") });
  await writeFile(join(f.root, ".env"), "synthetic-untracked");
  const input = { ...f.proposed, paths: ["task.txt", ".env"], classifications: { includedIgnored: [".env"] }, actions: ["shield_change_scan"] };
  await assert.rejects(f.service.review("personal", input), /incomplete/);
  await writeFile(join(f.root, ".gitignore"), "cache.txt\n.env\n"); await writeFile(join(f.root, "cache.txt"), "unclassified ignored input");
  await assert.rejects(f.service.review("personal", input), /incomplete/);
  const exact = { ...input, classifications: { includedIgnored: [".env"], excludedIgnored: ["cache.txt"] } }, review = await f.service.review("personal", exact);
  assert.equal(review.scope.targetSnapshot.completeness, "complete");
});
