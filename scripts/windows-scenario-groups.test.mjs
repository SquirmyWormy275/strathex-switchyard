import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { requiredGroups } from "./run-isolated-tests.mjs";
import { windowsScenarioGroups, selectWindowsContractGroups, selectWindowsStorageScenario, windowsStorageScenarioSuites, windowsShieldScenarios, windowsStopScenarios } from "./windows-scenario-groups.mjs";

const shield = "tools/layout-studio/repository-windows-shield.test.mjs", stop = "tools/layout-studio/repository-windows-execution-stop.test.mjs";
test("both Windows verification entry points select all eight independent Shield and stop scenarios with their unchanged child bounds", () => {
  const groups = selectWindowsContractGroups([shield, stop], requiredGroups);
  assert.equal(groups.length, 8); assert.equal(groups.filter(group => group.file === shield).length, 5); assert.equal(groups.filter(group => group.file === stop).length, 3);
  for (const [file, names] of [[shield, windowsShieldScenarios], [stop, windowsStopScenarios]]) {
    const declared = windowsScenarioGroups(file), actual = groups.filter(group => group.file === file);
    assert.deepEqual(actual.map(group => group.pattern), declared.map(group => group.pattern));
    for (const [index, group] of actual.entries()) {
      assert.ok(requiredGroups.includes(group)); assert.equal(group.pattern, names[index]); assert.equal(group.pattern.includes("^"), false); assert.equal(group.pattern.endsWith("$"), false);
      assert.equal(group.timeoutMs, process.platform === "win32" ? 300000 : file === shield ? 120000 : undefined);
    }
  }
  const harness = selectWindowsContractGroups(["scripts/run-isolated-tests.test.mjs"], requiredGroups); assert.equal(harness.length, 1); assert.equal(harness[0].pattern, undefined);
});

test("the actual storage CI matrix schedules every Shield scenario exactly once on independent workers", async () => {
  const workflow = await readFile(new URL("../.github/workflows/switchyard-windows-filesystem.yml", import.meta.url), "utf8");
  const matrix = workflow.match(/^        suite: \[([^\]\n]+)\]$/m)?.[1].split(",").map(value => value.trim());
  assert.ok(matrix); assert.equal(new Set(matrix).size, matrix.length); assert.equal(matrix.includes("shield-policy"), false);
  const selections = matrix.filter(suite => Object.hasOwn(windowsStorageScenarioSuites, suite)).flatMap(suite => selectWindowsStorageScenario(suite, requiredGroups));
  assert.deepEqual(selections.map(group => group.pattern), windowsShieldScenarios);
  assert.ok(selections.every(group => requiredGroups.includes(group)));
  assert.equal(selections.length, 5);
  for (const suite of Object.keys(windowsStorageScenarioSuites)) {
    assert.equal(selectWindowsStorageScenario(suite, requiredGroups).length, 1);
    assert.throws(() => selectWindowsStorageScenario(suite, requiredGroups.filter(group => group.file !== shield || group.pattern !== windowsShieldScenarios[4])));
  }
  for (const suite of ["shield-policy", ".*", "shield-change|shield-clean", "", undefined]) assert.throws(() => selectWindowsStorageScenario(suite, requiredGroups));
  assert.match(workflow, /timeout-minutes: 6/);
});
test("partial, duplicated, broadened or undeclared contract selections cannot silently omit native scenarios", () => {
  const valid = requiredGroups.filter(group => group.file === shield);
  for (const broken of [valid.slice(0, -1), [...valid, valid[0]], valid.map((group, index) => index ? group : { ...group, pattern: ".*" }), valid.map((group, index) => index ? group : { ...group, pattern: undefined })]) assert.throws(() => selectWindowsContractGroups([shield], broken));
  for (const files of [[], [shield, shield], ["unknown.test.mjs"], [undefined], null]) assert.throws(() => selectWindowsContractGroups(files, requiredGroups));
  assert.throws(() => windowsScenarioGroups("unknown.test.mjs"));
  assert.throws(() => selectWindowsContractGroups(["ordinary.test.mjs"], [{ file: "ordinary.test.mjs", pattern: "partial" }]));
});

test("native filesystem, setup and restricted exchange CI lanes preserve every original proof on independent workers", async () => {
  const workflow = await readFile(new URL("../.github/workflows/switchyard-windows-filesystem.yml", import.meta.url), "utf8");
  const native = workflow.slice(workflow.indexOf("  verify-native-filesystem:"), workflow.indexOf("  verify-storage-contracts:"));
  assert.match(native, /lane: \[filesystem, native-setup, restricted-exchange\]/);
  assert.match(native, /fail-fast: false/);
  for (const [name, lane] of [
    ["Verify actual NTFS private index bytes and parser refusals", "filesystem"],
    ["Verify actual NTFS private history bytes and parser refusals", "filesystem"],
    ["Verify the exact metadata broker service lifecycle", "filesystem"],
    ["Verify native protected staging and scoped broker removal", "native-setup"],
    ["Verify bounded storage through a client without volume privilege", "restricted-exchange"],
    ["Verify actual native filesystems and guardians without opening a guest", "filesystem"]
  ]) assert.ok(native.includes(`- name: ${name}\n        if: matrix.lane == '${lane}'\n`));
  const uploads = [...native.matchAll(/- name: (Retain[^\n]+)\n        if: always\(\) && matrix\.lane == '(filesystem|native-setup|restricted-exchange)'/g)];
  assert.equal(uploads.length, 9); assert.equal(new Set(uploads.map(row => row[1])).size, 9);
  assert.match(native, /timeout-minutes: 20/); assert.match(native, /--exchange/);
  assert.match(workflow, /osv-scanner, pypi-scanner, license-scanner,/);
  const source = await readFile(new URL("./verify-windows-storage-contracts.mjs", import.meta.url), "utf8");
  assert.match(source, /"pypi-scanner": "tools\/layout-studio\/repository-windows-shield-pypi\.test\.mjs"/);
  assert.equal(selectWindowsContractGroups(["tools/layout-studio/repository-windows-shield-pypi.test.mjs"], requiredGroups).length, 1);
  assert.match(source, /"license-scanner": "tools\/layout-studio\/repository-windows-shield-licenses\.test\.mjs"/);
  assert.equal(selectWindowsContractGroups(["tools/layout-studio/repository-windows-shield-licenses.test.mjs"], requiredGroups).length, 1);
});
test("fresh native and contract lanes queue by exact ref and matrix identity instead of waiting for an unrelated whole workflow", async () => {
  const workflow = await readFile(new URL("../.github/workflows/switchyard-windows-filesystem.yml", import.meta.url), "utf8");
  assert.doesNotMatch(workflow, /^concurrency:/m);
  const native = workflow.slice(workflow.indexOf("  verify-native-filesystem:"), workflow.indexOf("  verify-storage-contracts:")), contracts = workflow.slice(workflow.indexOf("  verify-storage-contracts:"));
  assert.match(native, /    concurrency:\n      group: switchyard-windows-native-\$\{\{ github\.ref \}\}-\$\{\{ matrix\.lane \}\}\n      cancel-in-progress: false/);
  assert.match(contracts, /    concurrency:\n      group: switchyard-windows-storage-contract-\$\{\{ github\.ref \}\}-\$\{\{ matrix\.suite \}\}\n      cancel-in-progress: false/);
  assert.doesNotMatch(workflow, /cancel-in-progress: true|^    needs:/m);
  assert.equal([...workflow.matchAll(/^      cancel-in-progress: false$/gm)].length, 2);
});
