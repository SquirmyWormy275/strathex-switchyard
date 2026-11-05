import test from "node:test";
import assert from "node:assert/strict";
import { requiredGroups } from "./run-isolated-tests.mjs";
import { windowsScenarioGroups, selectWindowsContractGroups, windowsShieldScenarios, windowsStopScenarios } from "./windows-scenario-groups.mjs";

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
test("partial, duplicated, broadened or undeclared contract selections cannot silently omit native scenarios", () => {
  const valid = requiredGroups.filter(group => group.file === shield);
  for (const broken of [valid.slice(0, -1), [...valid, valid[0]], valid.map((group, index) => index ? group : { ...group, pattern: ".*" }), valid.map((group, index) => index ? group : { ...group, pattern: undefined })]) assert.throws(() => selectWindowsContractGroups([shield], broken));
  for (const files of [[], [shield, shield], ["unknown.test.mjs"], [undefined], null]) assert.throws(() => selectWindowsContractGroups(files, requiredGroups));
  assert.throws(() => windowsScenarioGroups("unknown.test.mjs"));
  assert.throws(() => selectWindowsContractGroups(["ordinary.test.mjs"], [{ file: "ordinary.test.mjs", pattern: "partial" }]));
});
