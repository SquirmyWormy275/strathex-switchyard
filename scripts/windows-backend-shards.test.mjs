import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { requiredGroups, discoverRequiredTestFiles } from "./run-isolated-tests.mjs";
import { selectWindowsBackendShard, windowsBackendShards } from "./windows-backend-shards.mjs";
import costs from "./fixtures/windows-backend-costs.json" with { type: "json" };

test("native measured workloads fit evenly inside the unchanged preliminary job budget", () => {
  const known = new Map(costs.groups.map(g => [JSON.stringify([g.file, g.pattern]), g.costMs]));
  const shards = windowsBackendShards.map(shard => selectWindowsBackendShard(shard));
  const loads = shards.map(groups => groups.reduce((sum, g) => sum + (known.get(JSON.stringify([g.file, g.pattern ?? null])) ?? costs.fallbackCostMs), 0));
  assert.ok(Math.max(...loads) <= 950000, `The historical workload leaves too little room for setup: ${loads.join(",")}`);
  assert.ok(Math.max(...loads) - Math.min(...loads) < 60000, "One batch must not inherit several long native cases just because a new file shifts an array index.");
  assert.deepEqual(windowsBackendShards.map(shard => selectWindowsBackendShard(shard)), shards);
  assert.equal(costs.groups.length, 198); assert.equal(known.size, 198);
  assert.equal(costs.sourceCommit, "9f35961ca18087b2406e7e2ad716b5fe97ebc2bb");
});

test("six Windows backend shards preserve every original file and exact manifest scenario once", () => {
  assert.deepEqual(windowsBackendShards, [1, 2, 3, 4, 5, 6]);
  const shards = windowsBackendShards.map(shard => selectWindowsBackendShard(shard)), all = shards.flat();
  assert.equal(new Set(all).size, all.length); assert.ok(shards.every(group => group.length > 0));
  const files = new Set(discoverRequiredTestFiles().filter(file => file.startsWith("tools/layout-studio/") || file.startsWith("deployment/suite/")
    || ["scripts/run-isolated-tests.test.mjs", "scripts/windows-backend-shards.test.mjs"].includes(file)));
  const expected = requiredGroups.filter(group => files.has(group.file));
  assert.equal(all.length, expected.length); assert.deepEqual(new Set(all), new Set(expected));
  assert.equal(all.filter(group => group.file === "deployment/suite/installation.test.mjs").length, 16);
  assert.equal(all.filter(group => group.file === "tools/layout-studio/coding-task-owners.test.mjs").length, 26);
  for (const shard of [0, 7, 1.5, "1", undefined, null]) assert.throws(() => selectWindowsBackendShard(shard));
  for (const groups of [requiredGroups.filter(group => group.file !== "tools/layout-studio/state-lock.test.mjs"), [...requiredGroups, expected[0]], requiredGroups.map(group => group === expected[0] ? { ...group, pattern: ".*" } : group)]) assert.throws(() => selectWindowsBackendShard(1, groups));
});

test("Windows CI requires every isolated backend shard and uses the pinned Python executable without PATH expansion", async () => {
  const workflow = await readFile(new URL("../.github/workflows/b122-windows.yml", import.meta.url), "utf8");
  const backend = workflow.slice(workflow.indexOf("  verify-backend:"), workflow.indexOf("  verify-windows-release:"));
  assert.match(backend, /shard: \[1, 2, 3, 4, 5, 6\]/); assert.match(backend, /fail-fast: false/); assert.match(backend, /timeout-minutes: 20/);
  assert.match(backend, /windows-backend-shards\.mjs --synthetic --shard=\$\{\{ matrix\.shard \}\}/);
  assert.match(backend, /if: always\(\)/); assert.match(backend, /switchyard-backend-\$\{\{ matrix\.shard \}\}/);
  assert.match(workflow, /needs: \[build-state-helper, verify-backend\]/); assert.match(workflow, /needs\.verify-backend\.result/);
  assert.doesNotMatch(workflow, /test-concurrency=2|Get-Command python\.exe/);
  assert.match(workflow, /\$testPython = Join-Path \$env:pythonLocation 'python\.exe'/); assert.match(workflow, /-TestPythonPath \$testPython/);
  const release = await readFile(new URL("../deployment/windows/Build-B122Release.ps1", import.meta.url), "utf8");
  assert.match(release, /Assert-B122NoReparseAncestors -Path \$TestPythonPath/); assert.match(release, /3\.13\.3/); assert.match(release, /verification Python image changed/);
});
