import assert from "node:assert/strict";
import test from "node:test";
import { randomUUID } from "node:crypto";
import { readFile, writeFile, access } from "node:fs/promises";
import { join } from "node:path";
import { createRepositoryInspection, fixedGitExecutable } from "./repository-inspection.mjs";
import { authorityFixture as fixture } from "./test-support/task-authority-fixture.mjs";
import { createTaskAuthority } from "./task-authority.mjs";
import { createSuite } from "./suite.mjs";

test("normal Windows suite authority routes distinguish exact reviewed grants from connected Run and pipeline capabilities", async t => {
  const f = await fixture(t); let nativeChecks = 0;
  const suite = createSuite({store:f.store,platform:"win32",agents:{close:async()=>{}},coding:{status:async(c,id)=>{assert.equal(c,"personal");assert.equal(id,f.task.id);nativeChecks++;},close:async()=>{}},
    taskAuthorityFactory:options=>createTaskAuthority({...options,inspection:f.inspection}),
    repositoryExecution:{recoverCompartment:async()=>({cleaned:true}),close:async()=>{}}});
  f.onCleanup(()=>suite.close());
  const body={...f.proposed,actions:["run_target"]},review=await suite.handle("/api/suite/coding/authority/review",body);
  assert.deepEqual(review.scope.allowedActions,["run_target"]);assert.ok(nativeChecks>=2);
  await assert.rejects(suite.handle("/api/suite/coding/authority/issue",{...body,token:randomUUID()}));
  const grant=await suite.handle("/api/suite/coding/authority/issue",{...body,token:review.confirmation.token});assert.deepEqual(grant.connectedExecutionActions,["run_target","pipeline_local_gate","pipeline_clean_reproduction","shield_change_scan","shield_codebase_audit","shield_supply_chain","release_shield"]);assert.deepEqual(grant.proposal.actions,["run_target"]);assert.equal(grant.nativePermissionsChanged,false);
  for(const action of ["debug_target","launch_web_app","venv"]) await assert.rejects(suite.handle("/api/suite/coding/authority/review",{...body,actions:[action]}),/explicitly connected/);
  await assert.rejects(suite.handle("/api/suite/coding/authority/review",{...body,compartment:"work"}));
});

test("task authority binds real Git contents to one reviewed task/plan, consumes approval once and detects later edits", async t => {
  const f = await fixture(t), beforeHead = await f.run("rev-parse", "HEAD");
  const review = await f.service.review("personal", f.proposed);
  assert.equal(review.scope.targetSnapshot.completeness, "complete"); assert.equal(review.scope.targetSnapshot.upstream, undefined); assert.deepEqual(review.scope.allowedActions, ["local_commit"]);
  await assert.rejects(f.service.issue("personal", { ...f.proposed, planRevision: "changed-plan", token: review.confirmation.token }), /match|scope/i);
  const issued = await f.service.issue("personal", { ...f.proposed, token: review.confirmation.token });
  assert.equal(issued.nativePermissionsChanged, false); assert.equal(issued.localCommitExecutionImplemented, false);
  assert.equal(issued.grant.taskId, f.task.id); assert.deepEqual(issued.proposal.paths, ["task.txt"]);
  assert.equal((await f.service.revalidate("personal", issued.id)).allowed, true);
  await assert.rejects(f.service.issue("personal", { ...f.proposed, token: review.confirmation.token }), /consumed|used/i);
  await writeFile(join(f.root, "task.txt"), "edited after approval\n");
  assert.equal((await f.service.revalidate("personal", issued.id)).allowed, false);
  assert.equal(await f.run("rev-parse", "HEAD"), beforeHead);
  assert.equal((await f.store.snapshot("personal")).repositoryProbes.every(p => p.stoppedVerified), true);
  for (const p of (await f.store.snapshot("personal")).repositoryProbes) if (p.scratch) await assert.rejects(access(p.scratch), { code: "ENOENT" });
  const sealed = await readFile(join(f.stage, "private/personal.sealed.json"), "utf8");
  assert.equal(sealed.includes("synthetic-session"), false); assert.equal(sealed.includes(review.confirmation.token), false);
});

test("authority rejects broader actions, unsafe paths, unknown inputs and credential-bearing origins", async t => {
  const f = await fixture(t);
  for (const paths of [["../outside"], [".git/config"], ["NUL"], ["task.txt."], ["task.txt", "task.txt"], ["folder\\file"]]) await assert.rejects(f.service.review("personal", { ...f.proposed, paths }), /path|list/i);
  await assert.rejects(f.service.review("personal", { ...f.proposed, actions: ["run_target"] }), /only host-mediated/i);
  assert.equal(f.counters().calls, 0);
  await writeFile(join(f.root, "scratch.txt"), "unclassified\n");
  await assert.rejects(f.service.review("personal", f.proposed), /incomplete/i);
  await writeFile(join(f.root, "cache.txt"), "ignored but still hashed\n");
  const classified = { ...f.proposed, classifications: { excludedUntracked: ["scratch.txt"], excludedIgnored: ["cache.txt"] } };
  const review = await f.service.review("personal", classified);
  await writeFile(join(f.root, "cache.txt"), "changed excluded input\n");
  await assert.rejects(f.service.issue("personal", { ...classified, token: review.confirmation.token }), /match|scope/i);
  await f.run("remote", "set-url", "origin", "https://private-secret@github.com/example/synthetic.git");
  await assert.rejects(f.service.review("personal", classified), /incomplete/i);
  assert.equal((await f.service.list("personal")).length, 0);
});

test("workspace/account changes fence issuance, with cross-compartment and keyboard-only denials before native queries", async t => {
  const f = await fixture(t), review = await f.service.review("personal", f.proposed);
  await f.store.update("personal", "account-change", s => { s.accounts.push("another-login"); });
  await assert.rejects(f.service.issue("personal", { ...f.proposed, token: review.confirmation.token }), /match|scope/i);
  const before = f.counters().calls;
  f.setActive(false); await assert.rejects(f.service.review("personal", f.proposed), /select this workspace/i); f.setActive(true);
  await f.store.update("personal", "mode", s => { s.mode = "keyboard-only"; });
  await assert.rejects(f.service.review("personal", f.proposed), /keyboard-only/i);
  await assert.rejects(f.service.review("work", f.proposed), /bind a verified/i);
  assert.equal(f.counters().calls, before);
});

test("expired and revoked grants cannot be replayed, and suspension permanently revokes existing grants", async t => {
  const f = await fixture(t);
  const review = await f.service.review("personal", f.proposed), issued = await f.service.issue("personal", { ...f.proposed, token: review.confirmation.token });
  const count = f.counters().calls; f.advance(16 * 60000);
  assert.equal((await f.service.revalidate("personal", issued.id)).allowed, false); assert.equal(f.counters().calls, count);
  const nextReview = await f.service.review("personal", f.proposed), next = await f.service.issue("personal", { ...f.proposed, token: nextReview.confirmation.token });
  await f.service.stopCompartment("personal");
  assert.equal((await f.service.revalidate("personal", next.id)).allowed, false);
  assert.ok((await f.service.revoke("personal", next.id)).grant.revokedAt);
  await assert.rejects(f.service.revoke("work", next.id), /unavailable/i);
});

test("unsettled native guardians survive restart and prevent replacement until independently verified stopped", async t => {
  const f = await fixture(t), scope = { schema: "switchyard-runtime-command/v1", id: randomUUID(), guardianPid: 12345, birth: "1", containment: process.platform === "linux" ? "owned-linux-session" : "windows-job" };
  await f.store.update("personal", "uncertain-probe", s => { s.repositoryProbes = [{ taskId: f.task.id, ownedRuntime: scope, stoppedVerified: false }]; });
  const blocked = createRepositoryInspection({ store: f.store, command: f.command, guardianStopped: async () => false });
  await assert.rejects(blocked.capture("personal", f.task, { includedUntracked: [], excludedUntracked: [], excludedIgnored: [] }), /not verified exit/i);
  assert.equal(f.counters().calls, 0); assert.equal((await blocked.stopCompartment("personal")).stopped, false); await assert.rejects(blocked.close(), /guardian.*verified exit/);
  await f.service.review("personal", f.proposed);
  assert.equal((await f.store.snapshot("personal")).repositoryProbes.every(p => p.stoppedVerified), true);
});

test("read-only inspection disables repository fsmonitor commands and never advances the task branch", async t => {
  const f = await fixture(t), marker = join(f.stage, "unexpected-hook"), head = await f.run("rev-parse", "HEAD");
  // This executable is configured as data; the inspected Git argv must override it.
  await f.run("config", "core.fsmonitor", `touch '${marker.replaceAll("'", "")}'`);
  await f.service.review("personal", f.proposed);
  await assert.rejects(access(marker), { code: "ENOENT" });
  await f.run("config", "--unset", "core.fsmonitor");
  assert.equal(await f.run("rev-parse", "HEAD"), head);
});


test("suspending an acknowledged repository probe discards late results and records exact guardian exit", async t => {
  const f = await fixture(t); let ready;
  const acknowledged = new Promise(resolve => { ready = resolve; });
  const command = async (_exe, _args, options) => {
    await options.onGuardianReady({ schema: "switchyard-runtime-command/v1", id: randomUUID(), guardianPid: 12345, birth: "1", containment: process.platform === "linux" ? "owned-linux-session" : "windows-job" });
    ready();
    await new Promise(resolve => { if (options.signal.aborted) resolve(); else options.signal.addEventListener("abort", resolve, { once: true }); });
    throw Object.assign(new Error("Synthetic cancelled query"), { code: "CANCELLED" });
  };
  const probe = createRepositoryInspection({ store: f.store, command, guardianStopped: async () => true });
  const pending = probe.capture("personal", f.task, { includedUntracked: [], excludedUntracked: [], excludedIgnored: [] }).then(() => { throw new Error("A cancelled probe returned an accepted snapshot"); }, e => e);
  await acknowledged; assert.equal((await f.store.snapshot("personal")).repositoryProbes.at(-1).stoppedVerified, false);
  assert.equal((await probe.stopCompartment("personal")).stopped, true);
  assert.match((await pending).message, /stopped/i);
  assert.equal((await f.store.snapshot("personal")).repositoryProbes.at(-1).stoppedVerified, true);
  assert.deepEqual(await f.service.list("personal"), []); await probe.close();
});


test("Git root spelling is canonicalized through native realpath and another real directory is rejected", async t => {
  const f = await fixture(t), classifications = { includedUntracked: [], excludedUntracked: [], excludedIgnored: [] };
  let redirect = false;
  const command = async (exe, args, options) => {
    const result = await f.command(exe, args, options);
    if (args.at(-2) === "rev-parse" && args.at(-1) === "--show-toplevel") return { ...result, stdout: (redirect ? f.stage : f.root + "/../repository") + "\n" };
    return result;
  };
  const reader = createRepositoryInspection({ store: f.store, command, guardianStopped: async () => true });
  assert.equal((await reader.capture("personal", f.task, classifications)).snapshot.repositoryRoot, f.root);
  redirect = true; assert.equal((await reader.capture("personal", f.task, classifications)).snapshot.completeness, "incomplete");
  await reader.close();
});
