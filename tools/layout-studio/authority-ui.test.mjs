import test from "node:test";
import assert from "node:assert/strict";
import { writeFile } from "node:fs/promises";
import { join } from "node:path";
import { authorityFixture } from "./test-support/task-authority-fixture.mjs";
import { browserSurfaceFixture, withBrowserSurface, until } from "./test-support/browser-ui.mjs";
import { createSuite } from "./suite.mjs";

async function fixture(t, fn) {
  const f = await authorityFixture(t, { executionActions: ["run_target"] }), notices = [], changes = [];
  const suite = createSuite({ store: f.store, agents: { discovery: async () => [], close: async () => {} }, voice: { discovery: async () => ({ available: false }) }, taskAuthority: { ...f.service, close: async () => {} } }); f.onCleanup(() => suite.close());
  await withBrowserSurface({ ...f, suite }, async c => {
    const { mountAuthority } = await import("./authority-ui.mjs"); mountAuthority({ notify: value => notices.push(value) });
    c.document.addEventListener("switchyard-execution-grants-changed", event => changes.push(event.detail));
    await c.refresh(); assert.equal(c.calls.length, 0); assert.equal(c.$("authority-task").value, f.task.id);
    c.change("authority-paths", "task.txt"); await fn({ ...c, notices, changes });
  });
}
async function review(c) { c.click("review-authority"); await c.responses.findLast(r => r.path.endsWith("/authority/review")).response; await until(() => c.$("authority-review-dialog").open && !c.$("confirm-authority").disabled); }
async function confirm(c) { c.click("confirm-authority"); c.$("confirm-authority").dispatchEvent(new Event("click")); await c.responses.findLast(r => /authority\/(issue|revoke)$/.test(r.path)).response; await until(() => !c.$("refresh-authorities").disabled); }

test("permission review presents literal Windows paths and readable file exclusions", () => browserSurfaceFixture(async () => {
  const { permissionScopeSummary } = await import("./authority-ui.mjs");
  const repositoryRoot = 'C:\\Work\\Client "A"\\<review>', paths = ['src\\entry.ts', 'literal "quoted".txt'];
  const summary = permissionScopeSummary({ repositoryRoot, taskId: "saved-task", provider: "codex", sessionId: "native-session", planRevision: "reviewed-plan", lifetimeMinutes: 15,
    allowedActions: ["run_target"], paths, classifications: { includedUntracked: ["new.txt"], excludedUntracked: ["private.txt"], includedIgnored: [], excludedIgnored: ["secret.txt"], excludedIgnoredTrees: ["generated"] } });
  assert.ok(summary.includes(repositoryRoot)); for (const path of paths) assert.ok(summary.includes(path));
  assert.match(summary, /Run a program/); assert.match(summary, /15 minutes/);
  assert.match(summary, /Excluded untracked files:\n  private.txt/); assert.match(summary, /Excluded ignored files:\n  secret.txt/); assert.match(summary, /Excluded generated folders:\n  generated/);
  assert.doesNotMatch(summary, /"repositoryRoot":|"allowedActions":/);
}));

test("saved native task selection performs no inspection until an explicit exact permission review", async t => fixture(t, async c => {
  assert.equal(c.counters().nativeChecks, 0); c.click("refresh-authorities"); await until(() => !c.$("refresh-authorities").disabled); assert.equal(c.counters().nativeChecks, 0);
  await review(c); assert.ok(c.counters().nativeChecks > 0); assert.match(c.$("authority-review-summary").textContent, /task.txt/); assert.ok(c.$("authority-review-summary").textContent.includes(c.root)); assert.match(c.$("authority-review-summary").textContent, /read-only|Provider tools and native permissions stay unchanged/);
  assert.equal(JSON.parse(c.$("authority-review-details").textContent).repositoryRoot, c.root); assert.equal(c.$("authority-exact-scope").open, false);
  assert.equal((await c.service.list("personal")).length, 0); c.click("cancel-authority"); assert.equal((await c.service.list("personal")).length, 0);
  await review(c); c.change("authority-plan", "changed-plan"); assert.equal(c.$("authority-review-dialog").open, false); assert.equal(c.$("confirm-authority").disabled, true);
}));

test("one confirmation issues only the reviewed file/action permission and publishes metadata for execution selection", async t => fixture(t, async c => {
  await review(c); await confirm(c); const grants = await c.service.list("personal"); assert.equal(grants.length, 1); assert.deepEqual(grants[0].proposal.paths, ["task.txt"]); assert.deepEqual(grants[0].grant.allowedActions, ["run_target"]);
  assert.equal(c.calls.filter(r => r.path.endsWith("/authority/issue")).length, 1); assert.equal(c.changes.length, 1); assert.deepEqual(c.changes[0], { compartment: "personal", authorityId: grants[0].id }); assert.match(c.$("authority-status").textContent, /no program has started/); assert.equal(c.$("authority-history").value, grants[0].id);
  c.click("revalidate-authority"); await c.responses.findLast(r => r.path.endsWith("/revalidate")).response; await until(() => !c.$("revalidate-authority").disabled); assert.match(c.$("authority-status").textContent, /Current scope verified/);
  assert.equal((await c.store.snapshot("personal")).repositoryExecutions?.length ?? 0, 0);
}));

test("changed repository bytes reject the exact approval without issuing a new grant", async t => fixture(t, async c => {
  await review(c); await writeFile(join(c.root, "task.txt"), "changed after review\n"); await confirm(c);
  assert.equal((await c.service.list("personal")).length, 0); assert.match(c.$("authority-status").textContent, /No automatic retry/); assert.equal(c.changes.length, 0);
}));

test("a separately reviewed revocation still works in keyboard-only mode and never claims to stop a process", async t => fixture(t, async c => {
  await review(c); await confirm(c); await c.store.update("personal", "synthetic-mode", s => { s.mode = "keyboard-only"; }); await c.refresh();
  assert.equal(c.$("review-authority").disabled, true); c.click("refresh-authorities"); await until(() => !c.$("refresh-authorities").disabled);
  c.click("review-authority-revoke"); assert.match(c.$("authority-review-summary").textContent, /does not undo earlier effects or prove an owned process has stopped/); await confirm(c);
  assert.equal((await c.service.list("personal"))[0].status, "revoked"); assert.match(c.$("authority-status").textContent, /owned-process status are unchanged/); assert.equal(c.$("review-authority-revoke").disabled, true);
}));

test("Work and workspace changes clear pending scope and refuse local permission controls", async t => fixture(t, async c => {
  await review(c); const before = c.calls.length; c.document.dispatchEvent(new Event("switchyard-workspace-changing")); c.document.dispatchEvent(new CustomEvent("switchyard-compartment-state", { detail: await c.store.snapshot("work") }));
  assert.equal(c.$("authority-review-dialog").open, false); assert.equal(c.$("authority-task").options.length, 0); assert.equal(c.$("authority-paths").value, ""); assert.equal(c.$("refresh-authorities").disabled, true);
  assert.equal(c.$("authority-review-summary").textContent, ""); assert.equal(c.$("authority-review-details").textContent, ""); assert.equal(c.$("authority-exact-scope").open, false);
  c.$("confirm-authority").dispatchEvent(new Event("click")); assert.equal(c.calls.length, before); assert.equal((await c.service.list("personal")).length, 0);
}));

test("a lost successful issuance reply keeps its saved grant and refresh never issues another", async t => fixture(t, async c => {
  await review(c); const original = globalThis.fetch;
  globalThis.fetch = async (path, options) => { const response = await original(path, options); if (path.endsWith("/authority/issue")) { await response.text(); throw Error("Synthetic lost grant reply"); } return response; };
  try { await confirm(c); } finally { globalThis.fetch = original; }
  assert.equal((await c.service.list("personal")).length, 1); assert.match(c.$("authority-status").textContent, /No automatic retry/); c.click("refresh-authorities"); await until(() => !c.$("refresh-authorities").disabled);
  assert.equal(c.$("authority-history").options.length, 1); assert.equal(c.calls.filter(r => r.path.endsWith("/authority/issue")).length, 1);
}));

test("a late issuance response cannot select or disclose the old permission in another workspace", async t => fixture(t, async c => {
  await review(c); let release; const waiting = new Promise(resolve => { release = resolve; }), original = globalThis.fetch;
  globalThis.fetch = async (path, options) => { const response = await original(path, options); if (path.endsWith("/authority/issue")) await waiting; return response; };
  try {
    c.click("confirm-authority"); await c.responses.findLast(r => r.path.endsWith("/authority/issue")).response;
    c.document.dispatchEvent(new Event("switchyard-workspace-changing")); c.document.dispatchEvent(new CustomEvent("switchyard-compartment-state", { detail: { ...(await c.store.snapshot("personal")), id: "another-workspace", codingSessions: [] } })); release(); await until(() => !c.$("refresh-authorities").disabled);
    assert.equal(c.$("authority-history").options.length, 0); assert.equal(c.changes.length, 0); assert.doesNotMatch(c.$("authority-status").textContent, /Task permission saved/); assert.equal((await c.service.list("personal")).length, 1);
  } finally { release(); globalThis.fetch = original; }
}));

test("a newly saved permission becomes an execution choice without reviewing or running a recipe", async t => fixture(t, async c => {
  const { mountExecution } = await import("./execution-ui.mjs"); mountExecution({ notify: value => c.notices.push(value) }); await c.refresh(); c.change("authority-paths", "task.txt");
  await review(c); await confirm(c); await until(() => c.$("execution-grant").options.length === 1 && !c.$("refresh-executions").disabled);
  assert.equal(c.$("execution-grant").value, c.changes[0].authorityId); assert.equal(c.$("review-execution").disabled, true); assert.equal(c.$("execution-review-dialog").open, false);
  assert.equal(c.calls.some(r => /execution\/(review|apply)$/.test(r.path)), false); assert.equal((await c.store.snapshot("personal")).repositoryExecutions?.length ?? 0, 0);
}));
