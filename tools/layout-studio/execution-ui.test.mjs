import test from "node:test";
import assert from "node:assert/strict";
import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { executionFixture } from "./test-support/execution-fixture.mjs";
import { withBrowserSurface, until } from "./test-support/browser-ui.mjs";
import { createSuite } from "./suite.mjs";

async function fixture(t, fn, options = {}) {
  const f = await executionFixture(t, options), notices = [];
  // The outer fixture owns retirement of the real authority/execution services.
  const suite = createSuite({ store: f.store, agents: { discovery: async () => [], close: async () => {} }, voice: { discovery: async () => ({ available: false }) }, taskAuthority: { ...f.service, close: async () => {} }, repositoryExecution: { ...f.execution, close: async () => {} } });
  f.onCleanup(() => suite.close());
  await withBrowserSurface({ ...f, suite }, async c => {
    const { mountExecution } = await import("./execution-ui.mjs"); mountExecution({ notify: value => notices.push(value) }); await c.refresh();
    assert.equal(c.calls.length, 0, "opening the workspace performs no execution or provider inspection");
    c.click("refresh-executions"); await until(() => c.$("execution-grant").options.length === 1 && !c.$("refresh-executions").disabled);
    await fn({ ...c, notices });
  });
}
async function chooseFile(c, bytes) {
  c.change("execution-manifest", "run.json"); const data = bytes ?? await readFile(join(c.root, "run.json"));
  c.$("execution-manifest-file").files = [{ name: "run.json", size: data.length, arrayBuffer: async () => Uint8Array.from(data).buffer }];
  c.$("execution-manifest-file").dispatchEvent(new Event("change")); await until(() => !c.$("review-execution").disabled);
}
async function review(c) { c.click("review-execution"); await until(() => c.$("execution-review-dialog").open && !c.$("confirm-execution").disabled); }
async function confirm(c) { c.click("confirm-execution"); c.$("confirm-execution").dispatchEvent(new Event("click")); await c.responses.findLast(r => r.path.endsWith("/apply")).response; await until(() => !c.$("refresh-executions").disabled); }

test("saved permission selection and local file hashing lead to an exact cancellable review without execution", async t => fixture(t, async c => {
  assert.equal(c.effects(), 0); assert.equal(c.$("review-execution").disabled, true);
  assert.equal(c.calls.every(row => row.path.endsWith("/list")), true);
  await chooseFile(c); await review(c);
  const summary = c.$("execution-review-summary").textContent; assert.ok(summary.includes(c.root)); assert.match(summary, /program.mjs/); assert.match(summary, /denied/); assert.match(summary, /5000/); assert.match(summary, /64|67108864/);
  const request = c.calls.find(row => row.path.endsWith("execution/review")); assert.deepEqual(Object.keys(request.body).sort(), ["action", "authorityId", "compartment", "manifestPath", "manifestSha256", "requestId"]); assert.equal(request.body.manifestSha256, c.proposed.manifestSha256);
  c.click("cancel-execution"); assert.equal(c.effects(), 0); assert.equal(c.$("confirm-execution").disabled, true);
  assert.equal((await c.execution.list("personal"))[0].status, "reviewed");
}));

test("one confirmed run retains admission separately from observed process exit and never replays on refresh", async t => fixture(t, async c => {
  await chooseFile(c); await review(c); await confirm(c); assert.equal(c.effects(), 1);
  assert.equal(c.calls.filter(row => row.path.endsWith("execution/apply")).length, 1); assert.match(c.$("execution-result").textContent, /Original admission: running/);
  c.click("observe-execution"); await until(() => !c.$("observe-execution").disabled); assert.match(c.$("execution-result").textContent, /Native exit: verified/); assert.match(c.$("execution-result").textContent, /Coding task completion: not verified/); assert.match(c.$("execution-output").textContent, /synthetic program output/); assert.equal(c.$("review-execution-stop").disabled, true);
  c.click("refresh-executions"); await until(() => !c.$("refresh-executions").disabled); assert.equal(c.effects(), 1); assert.equal(await readFile(join(c.root, "task.txt"), "utf8"), "reviewed\n");
}));

test("separate stop approval reaches only the selected owned run and preserves its original admission", async t => fixture(t, async c => {
  await chooseFile(c); await review(c); await confirm(c); assert.equal(c.effects(), 1);
  c.click("review-execution-stop"); await until(() => c.$("execution-review-dialog").open && !c.$("confirm-execution").disabled); assert.match(c.$("execution-review-summary").textContent, /Prior program effects are not rolled back/);
  await confirm(c); assert.equal(c.effects(), 1); assert.equal(c.$("execution-stop-history").children.length, 1);
  c.click("observe-execution"); await until(() => !c.$("observe-execution").disabled); assert.match(c.$("execution-result").textContent, /Original admission: running/); assert.match(c.$("execution-result").textContent, /Observed result: cancelled/); assert.match(c.$("execution-result").textContent, /Program exit code: unknown/);
  const request = c.calls.find(row => row.path.endsWith("stop/apply")); assert.deepEqual(Object.keys(request.body).sort(), ["compartment", "stopId", "token"]);
}, { hold: true }));

test("changed inputs refuse execution and an unavailable result is retained without automatic retry", async t => fixture(t, async c => {
  await chooseFile(c); await review(c); await writeFile(join(c.root, "program.mjs"), "changed after review");
  await confirm(c); assert.equal(c.effects(), 0); assert.match(c.$("execution-status").textContent, /not retried/); assert.equal(c.calls.filter(row => row.path.endsWith("execution/apply")).length, 1);
  assert.equal(c.$("execution-history").options.length, 1); c.click("refresh-executions"); await until(() => !c.$("refresh-executions").disabled); assert.equal(c.effects(), 0);
}));

test("selection and workspace changes invalidate review and clear local permission data", async t => fixture(t, async c => {
  await chooseFile(c); await review(c); c.change("execution-action", "run_target"); assert.equal(c.$("execution-review-dialog").open, false); assert.equal(c.$("confirm-execution").disabled, true);
  await review(c); c.document.dispatchEvent(new Event("switchyard-workspace-changing")); c.document.dispatchEvent(new CustomEvent("switchyard-compartment-state", { detail: await c.store.snapshot("work") }));
  assert.equal(c.$("execution-review-dialog").open, false); assert.equal(c.$("refresh-executions").disabled, true); assert.equal(c.$("execution-history").options.length, 0); assert.equal(c.$("execution-grant").options.length, 0); assert.equal(c.effects(), 0);
}));


test("a file read that settles after a workspace change cannot enable execution there", async t => fixture(t, async c => {
  let release; const waiting = new Promise(resolve => { release = resolve; }), bytes = await readFile(join(c.root, "run.json"));
  c.change("execution-manifest", "run.json"); c.$("execution-manifest-file").files = [{ name: "run.json", size: bytes.length, arrayBuffer: async () => { await waiting; return Uint8Array.from(bytes).buffer; } }];
  c.$("execution-manifest-file").dispatchEvent(new Event("change"));
  try { c.document.dispatchEvent(new Event("switchyard-workspace-changing")); c.document.dispatchEvent(new CustomEvent("switchyard-compartment-state", { detail: { ...(await c.store.snapshot("personal")), id: "another-personal-workspace" } })); }
  finally { release(); }
  await until(() => !c.$("refresh-executions").disabled);
  assert.equal(c.$("review-execution").disabled, true); assert.equal(c.$("execution-grant").options.length, 0); assert.doesNotMatch(c.$("execution-file-status").textContent, /SHA-256 [a-f0-9]{64}/); assert.equal(c.effects(), 0);
}));

test("a lost successful apply reply preserves the saved operation and never repeats it", async t => fixture(t, async c => {
  await chooseFile(c); await review(c);
  const request = globalThis.fetch;
  globalThis.fetch = async (path, options) => {
    const response = await request(path, options);
    if (path.endsWith("/execution/apply")) { await response.text(); throw Error("Synthetic lost admission reply"); }
    return response;
  };
  try { await confirm(c); } finally { globalThis.fetch = request; }
  assert.equal(c.effects(), 1); assert.match(c.$("execution-status").textContent, /No confirmed result.*not retried/); assert.equal(c.$("execution-history").options.length, 1);
  c.click("refresh-executions"); await until(() => !c.$("refresh-executions").disabled); c.click("observe-execution"); await until(() => !c.$("observe-execution").disabled);
  assert.equal(c.effects(), 1); assert.match(c.$("execution-result").textContent, /Native exit: verified/); assert.match(c.$("execution-result").textContent, /Original admission: running/); assert.equal(c.calls.filter(row => row.path.endsWith("/execution/apply")).length, 1);
}));
