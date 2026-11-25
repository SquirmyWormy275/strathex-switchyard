import test from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFile, writeFile, access } from "node:fs/promises";
import { join } from "node:path";
import { authorityFixture } from "./test-support/task-authority-fixture.mjs";
import { createRepositoryInspection } from "./repository-inspection.mjs";
import { createTaskAuthority } from "./task-authority.mjs";
import { runRuntimeCommand, runtimeGuardianStopped } from "./runtime-command.mjs";
import { createSuite } from "./suite.mjs";
import { createStudioServer } from "./serve.mjs";
const sha = bytes => createHash("sha256").update(bytes).digest("hex");
async function stageDifferent(f) {
  const staged = "SYNTHETIC_INDEX_ONLY_SECRET\n☃\n", live = "clean worktree source\n";
  await writeFile(join(f.root, "task.txt"), staged); await f.run("add", "task.txt"); await writeFile(join(f.root, "task.txt"), live);
  return { staged, live, index: await readFile(join(f.root, ".git/index")), head: (await f.run("rev-parse", "HEAD")).trim() };
}
test("authenticated task-bound index witness reads staged bytes distinct from worktree without source disclosure, authority, model prompts or index writes", async t => {
  const f = await authorityFixture(t), before = await stageDifferent(f);
  const suite = createSuite({ store: f.store, taskAuthority: f.service, agents: { close: async () => {} }, coding: { close: async () => {} } }); f.onCleanup(() => suite.close());
  const token = "J".repeat(43), server = createStudioServer({ suite, token, discover: async () => ({}) }); await new Promise(resolve => server.listen(0, "127.0.0.1", resolve)); f.onCleanup(() => new Promise(resolve => { server.closeAllConnections(); server.close(resolve); }));
  const origin = `http://127.0.0.1:${server.address().port}`, api = (body, authenticated = true) => fetch(origin + "/api/suite/coding/authority/index-inputs", { method: "POST", headers: { "Content-Type": "application/json", Origin: origin, ...(authenticated ? { Authorization: `Bearer ${token}` } : {}) }, body: JSON.stringify(body) });
  assert.equal((await api({ taskId: f.task.id, paths: ["task.txt"] }, false)).status, 401); assert.equal(f.counters().calls, 0);
  const initial = await f.store.snapshot("personal"), response = await api({ taskId: f.task.id, paths: ["task.txt"] }), report = await response.json(); assert.equal(response.status, 200, JSON.stringify(report));
  assert.equal(report.rows.length, 1); assert.equal(report.rows[0].path, "task.txt"); assert.equal(report.rows[0].sha256, sha(before.staged)); assert.notEqual(report.rows[0].sha256, sha(before.live)); assert.equal(report.rows[0].objectId, (await f.run("rev-parse", ":task.txt")).trim()); assert.equal(report.rows[0].size, Buffer.byteLength(before.staged)); assert.equal(report.rows[0].mode, "100644");
  assert.equal(report.head, before.head); assert.equal(report.taskId, f.task.id); assert.equal(report.observationOnly, true); assert.equal(report.scanPerformed, false); assert.equal(report.authorityGranted, false); assert.equal(report.sourceBytesWitnessed, true); assert.equal(report.sourceBytesReturned, false); assert.equal(report.nativePermissionsChanged, false); assert.equal(report.gateEligible, false); assert.equal(report.completeness, "incomplete"); assert.ok(!JSON.stringify(report).includes("SYNTHETIC_INDEX_ONLY_SECRET")); assert.ok(!JSON.stringify(report).includes("clean worktree"));
  assert.deepEqual(await readFile(join(f.root, ".git/index")), before.index); assert.equal(await readFile(join(f.root, "task.txt"), "utf8"), before.live); assert.equal((await f.run("rev-parse", "HEAD")).trim(), before.head);
  const after = await f.store.snapshot("personal"); for (const key of ["taskAuthorities", "taskAuthorityJournal", "repositoryExecutionReviews", "repositoryExecutions", "codingTurns"]) assert.deepEqual(after[key], initial[key]);
  assert.equal(after.repositoryProbes.length, 6); assert.ok(after.repositoryProbes.every(p => p.stoppedVerified && p.scratchCleanupPending === false)); for (const p of after.repositoryProbes) await assert.rejects(access(p.scratch), { code: "ENOENT" });
  const calls = f.counters().calls;
  for (const body of [{ taskId: f.task.id, paths: ["task.txt"], objectId: report.rows[0].objectId }, { taskId: f.task.id, paths: ["task.txt"], command: "cat-file" }, { taskId: f.task.id, paths: ["../foreign"] }, { taskId: f.task.id, paths: ["task.txt", "TASK.txt"] }]) assert.ok((await api(body)).status >= 400);
  assert.equal(f.counters().calls, calls);
});
test("index witnesses refuse revision, selected or unrelated index drift, account drift and changed policy after native blob exit", async t => {
  for (const mode of ["selected-index", "unrelated-index", "head", "account", "policy"]) {
    await t.test(mode, async t => {
      const f = await authorityFixture(t); await stageDifferent(f); let changed = false;
      const inspection = createRepositoryInspection({ store: f.store, now: f.now, guardianStopped: async () => true, command: async (...args) => {
        const result = await f.command(...args);
        if (args[1].includes("cat-file") && !changed) {
          changed = true;
          if (mode === "selected-index") await f.run("add", "task.txt");
          if (mode === "unrelated-index") { await writeFile(join(f.root, "new.txt"), "unrelated"); await f.run("add", "new.txt"); }
          if (mode === "head") await f.run("-c", "commit.gpgsign=false", "commit", "-m", "changed head");
          if (mode === "account") await f.store.update("personal", "fixture-account-drift", s => { s.codingSessions[0].accountFingerprint = "b".repeat(64); });
          if (mode === "policy") await f.store.update("personal", "fixture-policy-drift", s => { s.mode = "keyboard-only"; });
        }
        return result;
      } });
      const service = createTaskAuthority({ store: f.store, inspection, now: f.now, checkNative: async () => {} }); f.onCleanup(() => service.close());
      await assert.rejects(service.indexInputs("personal", { taskId: f.task.id, paths: ["task.txt"] }), mode === "policy" ? /Keyboard-only mode/ : /changed/);
      assert.ok(changed); const state = await f.store.snapshot("personal"); assert.ok(state.repositoryProbes.every(p => p.stoppedVerified && p.scratchCleanupPending === false)); assert.equal(state.taskAuthorities?.length ?? 0, 0);
    });
  }
});
test("real Linux guardians consume only derived index object IDs, verify their own exits and reject non-UTF-8 bytes safely", { skip: process.platform !== "linux" }, async t => {
  const f = await authorityFixture(t), before = await stageDifferent(f), scopes = [];
  const inspection = createRepositoryInspection({ store: f.store, now: f.now, command: async (executable, args, options) => {
    assert.equal(options.env.GIT_NO_REPLACE_OBJECTS, "1"); assert.equal(options.env.GIT_NO_LAZY_FETCH, "1"); assert.equal(options.env.GIT_ALLOW_PROTOCOL, "");
    if (args.includes("cat-file")) { assert.deepEqual(args.slice(-2), ["cat-file", "--batch"]); assert.match(options.inputText, /^[a-f0-9]{40}\n$/); }
    const ready = options.onGuardianReady; return runRuntimeCommand(executable, args, { ...options, onGuardianReady: async scope => { scopes.push(scope); await ready(scope); } });
  } });
  f.onCleanup(() => inspection.close());
  const report = await inspection.indexInputs("personal", f.task, ["task.txt"]);
  assert.equal(report.rows[0].sha256, sha(before.staged)); assert.equal(scopes.length, 6); for (const scope of scopes) assert.equal(await runtimeGuardianStopped(scope), true);
  assert.deepEqual(await readFile(join(f.root, ".git/index")), before.index);
  await writeFile(join(f.root, "task.txt"), Buffer.from([255, 254, 0, 128])); await f.run("add", "task.txt");
  await assert.rejects(inspection.indexInputs("personal", f.task, ["task.txt"]), /valid UTF-8/);
  for (const scope of scopes) assert.equal(await runtimeGuardianStopped(scope), true);
  const state = await f.store.snapshot("personal"); assert.ok(state.repositoryProbes.every(p => p.stoppedVerified && p.scratchCleanupPending === false));
});
test("private index consumption requires exact Shield-owned sources, clears borrowed bytes and fences revocation during consumption", async t => {
  const f=await authorityFixture(t,{executionActions:["shield_change_scan"]}),before=await stageDifferent(f),proposal={...f.proposed,actions:["shield_change_scan"]},review=await f.service.review("personal",proposal),grant=await f.service.issue("personal",{...proposal,token:review.confirmation.token});
  const indexBefore=await readFile(join(f.root,".git/index"));let borrowed;
  const result=await f.service.useIndexInputs("personal",grant.id,"shield_change_scan",["task.txt"],(report,bytes)=>{borrowed=bytes.get("task.txt");assert.equal(borrowed.toString(),before.staged);assert.equal(report.rows[0].sha256,sha(before.staged));return "private host consumer finished";});
  assert.equal(result,"private host consumer finished");assert.ok(borrowed.every(n=>n===0));
  const calls=f.counters().calls;
  await assert.rejects(f.service.useIndexInputs("personal",grant.id,"local_commit",["task.txt"],()=>{}),/only to the connected/);
  await assert.rejects(f.service.useIndexInputs("personal",grant.id,"shield_change_scan",[".gitignore"],()=>{}),/task-owned/);assert.equal(f.counters().calls,calls);
  await assert.rejects(f.service.useIndexInputs("personal",grant.id,"shield_change_scan",["task.txt"],async(_report,bytes)=>{borrowed=bytes.get("task.txt");await f.service.revoke("personal",grant.id);}),/changed/);assert.ok(borrowed.every(n=>n===0));
  assert.deepEqual(await readFile(join(f.root,".git/index")),indexBefore);assert.ok((await f.store.snapshot("personal")).repositoryProbes.every(p=>p.stoppedVerified&&p.scratchCleanupPending===false));
});
