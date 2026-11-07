import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID, createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { requiredGroups, effectiveGroupTimeout } from "./run-isolated-tests.mjs";
import { completeWindowsShards, selectCompleteWindowsShard, completeWindowsCost, auditCompleteWindowsReceipts } from "./windows-complete-shards.mjs";

const hash = text => createHash("sha256").update(text).digest("hex");
const scope = { platform: "win32", sourceCommit: "a".repeat(40), sourceTree: "b".repeat(40),
  nodeVersion: "24.14.0", nodeExecutable: "C:\\toolchain\\node.exe", nodeSha256: "c".repeat(64),
  pythonVersion: "3.13.3", pythonExecutable: "C:\\toolchain\\python.exe", pythonSha256: "d".repeat(64),
  helperSha256: "e".repeat(64), dotnetManifestSha256: "f".repeat(64) };
const at = "2026-11-07T00:00:00.000Z";
function counts(children) {
  const sum = field => children.reduce((n, c) => n + (c.testCounts?.[field] ?? 0), 0);
  return { required: children.length, passed: children.length, failed: 0, tests: sum("total"), passedTests: sum("passed"),
    failedTests: 0, skippedTests: sum("skipped"), cancelledTests: 0, todoTests: 0 };
}
function envelope(shard) {
  const groups = selectCompleteWindowsShard(shard);
  const children = groups.map(g => {
    const command = g.args ? [g.executable ?? scope.nodeExecutable, ...g.args] : [scope.nodeExecutable, "--experimental-transform-types", "--test", "--test-reporter=tap",
      ...(g.pattern ? ["--test-name-pattern", "^" + g.pattern.replace(/[$.*+?^{}()|[\]\\]/g, "\\$&") + "$"] : []), g.file];
    return { file: g.file, pattern: g.pattern ?? null, command, startedAt: at, endedAt: at, durationMs: 1, effectiveTimeoutMs: effectiveGroupTimeout(g),
      exitCode: 0, signal: null, timeout: false, outputDigest: "a".repeat(64), outputBytes: 100, totalOutputBytes: 100, outputLimitBytes: 65536,
      outputTruncated: false, zeroTestPlan: false, environmentPolicy: "strict-test-v3", safeTrace: [],
      processTreeTermination: { strategy: "natural-exit", completed: true, supervisorExitCode: null, supervisorError: null },
      ...(g.args ? {} : { testCounts: { total: 1 + (g.expectedSkipped ?? 0), passed: 1, skipped: g.expectedSkipped ?? 0, failed: 0, cancelled: 0, todo: 0 } }),
      failureDiagnostic: null, spawnError: null, cleanupCompleted: true, cleanupError: null, success: true };
  });
  const receiptText = JSON.stringify({ version: 1, runId: randomUUID(), startedAt: at, endedAt: at, requiredGroups: groups, children,
    totals: counts(children), receiptWrite: { completed: true, error: null }, progressWrite: { completed: true, error: null }, success: true });
  return { schema: "switchyard-complete-windows-shard/v1", shard, scope, receiptText, receiptSha256: hash(receiptText) };
}
const fixture = () => completeWindowsShards.map(envelope);
function changeReceipt(envelopes, mutate, index = 0) {
  const e = envelopes[index], r = JSON.parse(e.receiptText); mutate(r); e.receiptText = JSON.stringify(r); e.receiptSha256 = hash(e.receiptText);
}
test("complete Windows workers cover the original manifest once, preserving build/install dependencies and all child bounds", () => {
  const selections = completeWindowsShards.map(shard => selectCompleteWindowsShard(shard)), all = selections.flat();
  assert.equal(all.length, requiredGroups.length); assert.equal(new Set(all).size, requiredGroups.length);
  assert.deepEqual(new Set(all), new Set(requiredGroups));
  const consumers = new Set(["apps/windows-companion/test/packaged-runtime.test.ts", "apps/windows-companion/test/main-shutdown.test.ts"]);
  const assembly = selections.at(-1);
  assert.deepEqual(assembly, requiredGroups.filter(g => g.args || consumers.has(g.file)));
  for (const file of consumers) {
    const index = assembly.findIndex(g => g.file === file);
    assert(index > assembly.findIndex(g => g.file === "build:companion"));
    assert(index > assembly.findIndex(g => g.file === "build:vscode"));
  }
  assert(selections.slice(0, -1).every(groups => groups.length > 0 && groups.every(g => !g.args && !consumers.has(g.file))));
  assert(selections.slice(0, -1).every(groups => groups.reduce((n, g) => n + completeWindowsCost(g), 0) <= 950000));
  for (const bad of ["0", "21", "01", 1, undefined]) assert.throws(() => selectCompleteWindowsShard(bad));
  for (const changed of [requiredGroups.slice(1), [...requiredGroups, requiredGroups[0]], requiredGroups.map((g, i) => i ? g : { ...g, timeoutMs: 45001 })]) assert.throws(() => selectCompleteWindowsShard("1", changed));
});
test("the complete receipt audit accepts only a full same-source cohort and reports package acceptance separately", () => {
  const rows = fixture(), result = auditCompleteWindowsReceipts(rows.reverse(), scope);
  assert.equal(result.complete, true); assert.equal(result.packageAcceptance, false);
  assert.equal(result.totals.required, requiredGroups.length);
  assert.deepEqual(result.cohorts.map(c => c.shard), completeWindowsShards);
  assert.equal(result.totals.passedTests, requiredGroups.filter(g => !g.args).length);
  assert.equal(result.totals.skippedTests, requiredGroups.reduce((n, g) => n + (g.expectedSkipped ?? 0), 0));
  assert.equal(result.manifestSha256, hash(JSON.stringify(requiredGroups)));
});
test("missing, repeated, substituted and different-source worker envelopes cannot become complete evidence", () => {
  for (const mutate of [
    rows => rows.pop(), rows => { rows[1] = rows[0]; }, rows => { rows[0].shard = "unknown"; },
    rows => { rows[0].scope = { ...scope, sourceCommit: "0".repeat(40) }; },
    rows => { rows[0].scope = { ...scope, sourceTree: "0".repeat(40) }; },
    rows => { rows[0].scope = { ...scope, helperSha256: "0".repeat(64) }; },
    rows => { rows[0].scope = { ...scope, nodeSha256: "0".repeat(64) }; },
    rows => { rows[0].receiptSha256 = "0".repeat(64); },
    rows => { rows[0].approved = true; },
    rows => { changeReceipt(rows, r => { r.runId = JSON.parse(rows[1].receiptText).runId; }); }
  ]) { const rows = fixture(); mutate(rows); assert.throws(() => auditCompleteWindowsReceipts(rows, scope)); }
  assert.throws(() => auditCompleteWindowsReceipts(fixture(), { ...scope, platform: "linux" }));
});
test("a nominally successful receipt cannot hide failure, omitted scenarios, changed commands, bounds, skips or cleanup", () => {
  for (const mutate of [
    r => { r.success = false; }, r => { r.requiredGroups.pop(); }, r => { r.children.pop(); },
    r => { r.requiredGroups[0].pattern = ".*"; }, r => { r.children[0].command.push("--test-skip-pattern", ".*"); },
    r => { r.children[0].effectiveTimeoutMs++; }, r => { r.children[0].outputLimitBytes++; },
    r => { r.children[0].success = false; }, r => { r.children[0].timeout = true; },
    r => { r.children[0].exitCode = 1; }, r => { r.children[0].testCounts.failed = 1; },
    r => { r.children[0].testCounts.skipped++; }, r => { r.children[0].zeroTestPlan = true; },
    r => { delete r.children[0].testCounts; }, r => { r.children[0].cleanupCompleted = false; },
    r => { r.children[0].processTreeTermination.completed = false; }, r => { r.children[0].outputTruncated = true; },
    r => { r.totals.passedTests++; }, r => { r.receiptWrite.completed = false; }, r => { r.progressWrite.completed = false; }
  ]) { const rows = fixture(); changeReceipt(rows, mutate); assert.throws(() => auditCompleteWindowsReceipts(rows, scope)); }
  const rows = fixture(); changeReceipt(rows, r => { r.children.reverse(); }, rows.length - 1);
  assert.throws(() => auditCompleteWindowsReceipts(rows, scope));
});
test("the complete native workflow retains every shard, original limits, exact helper and a mandatory receipt audit", async () => {
  const workflow = await readFile(new URL("../.github/workflows/switchyard-windows-complete.yml", import.meta.url), "utf8");
  const matrix = workflow.match(/shard: \[([^\]\n]+)\]/)?.[1].split(",").map(s => s.trim().replaceAll('"', ""));
  assert.deepEqual(matrix, completeWindowsShards); assert.match(workflow, /fail-fast: false/);
  assert.match(workflow, /timeout-minutes: 20/); assert.doesNotMatch(workflow, /workflow_dispatch|cancel-in-progress: true|SkipVerification/);
  assert.match(workflow, /needs: \[build-state-helper, verify-complete\]/);
  assert.match(workflow, /uses: \.\/\.github\/actions\/install-state-helper/g);
  assert.match(workflow, /--collect=/); assert.match(workflow, /complete-shard-\*\.json/);
  const release = await readFile(new URL("../.github/workflows/b122-windows.yml", import.meta.url), "utf8");
  assert.match(release, /timeout-minutes: 90/); assert.match(release, /Build-B122Release\.ps1/);
});

