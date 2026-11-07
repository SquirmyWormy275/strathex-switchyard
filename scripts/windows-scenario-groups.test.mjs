import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { requiredGroups } from "./run-isolated-tests.mjs";
import { windowsScenarioGroups, selectWindowsContractGroups, selectWindowsStorageScenario, windowsStorageScenarioSuites, windowsShieldScenarios, windowsStopScenarios, windowsInstallationScenarios, windowsTaskOwnerScenarios, windowsTaskOwnerLinuxScenarios } from "./windows-scenario-groups.mjs";

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
  assert.equal(uploads.length, 10); assert.equal(new Set(uploads.map(row => row[1])).size, 10);
  assert.ok(uploads.some(row => row[1] === "Retain fixed imports of the exact Node image" && row[2] === "restricted-exchange"));
  assert.match(native, /timeout-minutes: 20/); assert.match(native, /--exchange/);
  assert.match(workflow, /osv-scanner, pypi-scanner, pypi-artifact-scanner, cargo-scanner, cargo-artifact-scanner, artifact-scanner, archive-scanner, license-scanner, copilot-account, copilot-lifecycle, copilot-requests,/);
  const source = await readFile(new URL("./verify-windows-storage-contracts.mjs", import.meta.url), "utf8");
  assert.match(source, /"pypi-scanner": "tools\/layout-studio\/repository-windows-shield-pypi\.test\.mjs"/);
  assert.equal(selectWindowsContractGroups(["tools/layout-studio/repository-windows-shield-pypi.test.mjs"], requiredGroups).length, 1);
  assert.match(source, /"cargo-scanner": "tools\/layout-studio\/repository-windows-shield-cargo\.test\.mjs"/);
  assert.equal(selectWindowsContractGroups(["tools/layout-studio/repository-windows-shield-cargo.test.mjs"], requiredGroups).length, 1);
  assert.match(source, /"artifact-scanner": "tools\/layout-studio\/repository-shield-artifacts\.test\.mjs"/);
  assert.equal(selectWindowsContractGroups(["tools/layout-studio/repository-shield-artifacts.test.mjs"], requiredGroups).length, 1);
  assert.equal(selectWindowsContractGroups(["tools/layout-studio/repository-shield-npm-archives.test.mjs"], requiredGroups).length, 1);
  assert.ok(source.includes('"archive-scanner": "tools/layout-studio/repository-shield-npm-archives.test.mjs"'));
  assert.equal(selectWindowsContractGroups(["tools/layout-studio/repository-shield-cargo-artifacts.test.mjs"], requiredGroups).length, 1);
  assert.equal(selectWindowsContractGroups(["tools/layout-studio/repository-shield-pypi-artifacts.test.mjs"], requiredGroups).length, 1);
  assert.match(source, /"license-scanner": "tools\/layout-studio\/repository-windows-shield-licenses\.test\.mjs"/);
  assert.equal(selectWindowsContractGroups(["tools/layout-studio/repository-windows-shield-licenses.test.mjs"], requiredGroups).length, 1);
  for (const name of ["copilot-account-binding", "copilot-lifecycle", "copilot-requests"]) assert.equal(selectWindowsContractGroups(["tools/layout-studio/" + name + ".test.mjs"], requiredGroups).length, 1);
  const save = "tools/layout-studio/windows-scanner-recipe-files.test.mjs";
  assert.match(workflow, /task-owners, role-choices, scanner-save, mixed-scanner, history-windows-scanner/);
  const roleFile = "tools/layout-studio/role-dispatch.test.mjs";
  assert.ok(source.includes('"role-choices": "' + roleFile + '"'));
  const roleGroups = selectWindowsContractGroups([roleFile], requiredGroups);
  assert.equal(roleGroups.length, 1);
  assert.strictEqual(roleGroups[0], requiredGroups.find(group => group.file === roleFile));
  assert.equal(roleGroups[0].pattern, undefined);
  assert.ok(source.includes('"scanner-save": "' + save + '"'));
  const saveGroups = selectWindowsContractGroups([save], requiredGroups);
  assert.equal(saveGroups.length, 1); assert.ok(requiredGroups.includes(saveGroups[0]));
  assert.equal(saveGroups[0].timeoutMs, process.platform === "win32" ? 300000 : 120000);
  assert.equal(saveGroups[0].expectedSkipped ?? 0, process.platform === "win32" ? 0 : 4);
});
test("fresh native and contract lanes queue by exact ref and matrix identity instead of waiting for an unrelated whole workflow", async () => {
  const workflow = await readFile(new URL("../.github/workflows/switchyard-windows-filesystem.yml", import.meta.url), "utf8");
  assert.doesNotMatch(workflow, /^concurrency:/m);
  const native = workflow.slice(workflow.indexOf("  verify-native-filesystem:"), workflow.indexOf("  verify-storage-contracts:")), contracts = workflow.slice(workflow.indexOf("  verify-storage-contracts:"));
  assert.match(native, /    concurrency:\n      group: switchyard-windows-native-\$\{\{ github\.ref \}\}-\$\{\{ matrix\.lane \}\}\n      cancel-in-progress: false/);
  assert.match(contracts, /    concurrency:\n      group: switchyard-windows-storage-contract-\$\{\{ github\.ref \}\}-\$\{\{ matrix\.suite \}\}\n      cancel-in-progress: false/);
  assert.doesNotMatch(workflow, /cancel-in-progress: true/);
  // Every independent lane waits only for the exact-source helper artifact,
  // never for another verification lane or an unrelated complete workflow.
  assert.deepEqual([...workflow.matchAll(/^    needs: (.+)$/gm)].map(row => row[1]), ["build-state-helper", "build-state-helper"]);
  assert.match(native, /^    needs: build-state-helper$/m);
  assert.match(contracts, /^    needs: build-state-helper$/m);
  assert.match(workflow, /^  build-state-helper:\n    uses: \.\/\.github\/workflows\/switchyard-windows-state-helper\.yml$/m);
  assert.equal([...workflow.matchAll(/^      cancel-in-progress: false$/gm)].length, 2);
});

test("archived Windows release tests stage their own pinned native lease helper before the manifest runs", async () => {
  const source = await readFile(new URL("../deployment/windows/Build-B122Release.ps1", import.meta.url), "utf8");
  const archive = source.indexOf("archive --format=zip");
  const publish = source.indexOf("Invoke-B122PinnedDotNetPublish -Project (Join-Path $buildRoot 'apps\\desktop-hotkeys\\Switchyard.Hotkeys.csproj')");
  const verified = source.indexOf("throw 'Staged source state helper bytes changed.'");
  const tests = source.indexOf("Invoke-B122PinnedNpm -Arguments @('test')");
  assert.ok(archive >= 0 && publish > archive && verified > publish && tests > verified);
  const staging = source.slice(publish, tests);
  assert.match(staging, /state helper staging requires an absent destination/);
  assert.match(staging, /\[IO\.FileMode\]::CreateNew/);
  assert.match(staging, /\$stateLeaseSource\.CopyTo\(\$stateLeaseTarget\)/);
  assert.match(staging, /sourceCommit=\$sourceCommit; sha256=\$stateLeaseDigest/);
  assert.doesNotMatch(staging, /Join-Path \$repo 'runtime/);
  const cleanup = source.slice(source.indexOf("foreach($temporaryBuildTree"));
  assert.match(cleanup, /\.state-lease-helper-publish/);
  assert.match(cleanup, /\$testTempRoot,\$buildRoot\)\)\{Remove-B122OwnedBuildTree/);
});

test("installation selections cover every original case exactly once without changing assertions or deadlines", async () => {
  const file = "deployment/suite/installation.test.mjs", source = await readFile(new URL("../" + file, import.meta.url), "utf8");
  const names = [...source.matchAll(/^test\("([^"]+)"/gm)].map(row => row[1]);
  assert.deepEqual(names, windowsInstallationScenarios); assert.equal(new Set(names).size, 16);
  const selected = selectWindowsContractGroups([file], requiredGroups);
  assert.equal(selected.length, 16); assert.deepEqual(selected.map(g => g.pattern), windowsInstallationScenarios);
  for (const group of selected) {
    assert.equal(group.timeoutMs, 120000); assert.equal(group.expectedSkipped, undefined);
    assert.equal(names.filter(name => group.pattern === name).length, 1);
    assert.equal(group.pattern.startsWith("^"), false); assert.equal(group.pattern.endsWith("$"), false);
  }
  for (const name of names) assert.equal(selected.filter(group => group.pattern === name).length, 1);
  for (const broken of [selected.slice(1), [...selected, selected[0]], selected.map((g, i) => i ? g : { ...g, pattern: ".*" })]) assert.throws(() => selectWindowsContractGroups([file], broken));
});


test("every task-owner case runs once with the original bound and only its own native skip", async () => {
  const file = "tools/layout-studio/coding-task-owners.test.mjs";
  const source = await readFile(new URL("../" + file, import.meta.url), "utf8");
  const names = [...source.matchAll(/^test\("([^"\n]+)"/gm)].map(match => match[1]);
  const native = [...source.matchAll(/^test\("([^"\n]+)",\s*\{\s*skip:\s*process.platform\s*!==\s*"linux"\s*\}/gm)].map(match => match[1]);
  assert.equal(names.length, 27); assert.equal(new Set(names).size, 27);
  const workflow = await readFile(new URL("../.github/workflows/switchyard-windows-filesystem.yml", import.meta.url), "utf8");
  const matrix = workflow.match(/^        suite: \[([^\]\n]+)\]$/m)?.[1].split(",").map(value => value.trim());
  assert.equal(matrix.filter(suite => suite === "task-owners").length, 1);
  const entry = await readFile(new URL("./verify-windows-storage-contracts.mjs", import.meta.url), "utf8");
  assert.ok(entry.includes('"task-owners": "tools/layout-studio/coding-task-owners.test.mjs"'));

  assert.deepEqual(windowsTaskOwnerScenarios, names); assert.deepEqual(windowsTaskOwnerLinuxScenarios, native); assert.equal(native.length, 2);
  const groups = selectWindowsContractGroups([file], requiredGroups);
  assert.deepEqual(groups.map(group => group.pattern), names);
  for (const group of groups) {
    assert.ok(requiredGroups.includes(group)); assert.equal(group.timeoutMs, undefined);
    assert.equal(group.expectedSkipped ?? 0, process.platform !== "linux" && native.includes(group.pattern) ? 1 : 0);
  }
  for (const broken of [groups.slice(1), [...groups, groups[0]], groups.map((group, index) => index ? group : { ...group, pattern: ".*" })]) assert.throws(() => selectWindowsContractGroups([file], broken));
});

test("private pipe readback remains observable after failed setup without accepting that failure", async () => {
  const workflow = await readFile(new URL("../.github/workflows/switchyard-windows-filesystem.yml", import.meta.url), "utf8");
  const block = workflow.slice(workflow.indexOf("      - name: Verify broker metadata and protected files with a restricted token"), workflow.indexOf("      - name: Verify actual NTFS private index bytes and parser refusals"));
  assert.match(block, /if: \$\{\{ !cancelled\(\) \}\}/); assert.doesNotMatch(block, /continue-on-error/);
  assert.match(block, /\$proof\.privatePipeChecks -ne 36/); assert.match(block, /\$proof\.protectedFilesChecks -ne 16/);
  const failure = block.slice(block.indexOf("if ($code -ne 0) {"), block.indexOf("if ($proof.success"));
  assert.match(failure, /switchyard-storage-broker-protocol-verification\.json/); assert.match(failure, /throw 'An authenticated broker metadata boundary failed.'/);
  assert.ok(failure.indexOf("Set-Content") < failure.indexOf("throw"));
  assert.match(workflow, /if \(\$LASTEXITCODE -ne 0\) \{ throw 'Native setup preflight failed; no elevation was attempted.'/);
});
