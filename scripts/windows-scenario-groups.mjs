/** Fixed native scenarios: retain every assertion without extending a deadline. */
export const windowsShieldScenarios = Object.freeze([
  ...["shield_change_scan", "shield_codebase_audit", "shield_supply_chain", "release_shield"].map(action => `Windows ${action} retains pinned scanner observations and incomplete failed receipts`),
  "Windows clean Shield input cannot establish complete coverage"
]);
export const windowsStopScenarios = Object.freeze([
  "a separately approved Windows stop has its own operation, budget and receipt while preserving the original admission",
  "a failed atomic Windows stop admission sends no cancellation and cannot reuse its consumed approval",
  "a lost final Windows stop write recovers only its existing protected receipt and exact exit without another cancellation"
]);
const scenarios = Object.freeze({
  "tools/layout-studio/repository-windows-shield.test.mjs": windowsShieldScenarios,
  "tools/layout-studio/repository-windows-execution-stop.test.mjs": windowsStopScenarios
});
export function windowsScenarioGroups(file) {
  if (!Object.hasOwn(scenarios, file)) throw Error("No fixed independently executable scenario inventory exists for this file.");
  return scenarios[file].map(name => ({ file, pattern: name }));
}
export function selectWindowsContractGroups(files, requiredGroups) {
  if (!Array.isArray(files) || !files.length || files.some(file => typeof file !== "string" || !file) || new Set(files).size !== files.length || !Array.isArray(requiredGroups)) throw Error("Select exact distinct Windows contract files.");
  return files.flatMap(file => {
    const selected = requiredGroups.filter(group => group.file === file), expected = Object.hasOwn(scenarios, file) ? scenarios[file] : [undefined];
    if (selected.length !== expected.length || new Set(selected.map(group => group.pattern)).size !== expected.length || expected.some(name => !selected.some(group => group.pattern === name))) throw Error("The complete Windows contract scenario inventory is missing or ambiguous.");
    return selected;
  });
}

// One bounded CI worker per Shield scenario. The former file-level job could
// spend five independent 300-second child budgets inside one six-minute step.
export const windowsStorageScenarioSuites = Object.freeze(Object.fromEntries(
  ["shield-change", "shield-codebase", "shield-supply-chain", "shield-release", "shield-clean"].map((suite, index) => [suite, Object.freeze({ file: "tools/layout-studio/repository-windows-shield.test.mjs", pattern: windowsShieldScenarios[index] })])
));
export function selectWindowsStorageScenario(suite, requiredGroups) {
  if (!Object.hasOwn(windowsStorageScenarioSuites, suite)) throw Error("Choose an exact declared storage scenario suite.");
  const expected = windowsStorageScenarioSuites[suite];
  // Validate the entire file inventory before selecting one declared shard.
  return selectWindowsContractGroups([expected.file], requiredGroups).filter(group => group.pattern === expected.pattern);
}

// Admission and receipt-time state checks stay in independent bounded children.
export const windowsPolicyContractFiles = Object.freeze({
  policy: Object.freeze(["tools/layout-studio/repository-windows-execution.test.mjs"]),
  recovery: Object.freeze(["tools/layout-studio/repository-windows-execution-recovery.test.mjs"]),
  stop: Object.freeze(["tools/layout-studio/repository-windows-execution-stop.test.mjs"]),
  output: Object.freeze(["tools/layout-studio/repository-windows-execution-output.test.mjs"]),
  authority: Object.freeze(["tools/layout-studio/task-authority.test.mjs", "tools/layout-studio/receipt-authority-state.test.mjs"]),
  "host-stop": Object.freeze(["tools/layout-studio/repository-execution-stop.test.mjs"])
});
export function selectWindowsPolicyContractGroups(suite, requiredGroups) {
  if (suite !== undefined && !Object.hasOwn(windowsPolicyContractFiles, suite)) throw Error("Choose an exact declared Windows policy suite.");
  const files = ["scripts/run-isolated-tests.test.mjs", ...(suite === undefined ? Object.values(windowsPolicyContractFiles).flat() : windowsPolicyContractFiles[suite])];
  return selectWindowsContractGroups(files, requiredGroups);
}
