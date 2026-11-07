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
// Exact named cases retain every installation assertion and the original
// 120-second child bound; no case or production check is shortened.
export const windowsInstallationScenarios = Object.freeze([
  "installation keeps current and one rollback version, records dated backups, preserves data and removes only owned entries",
  "unowned or edited desktop entries and corrupted new releases preserve the current application",
  "a failed persistent write restores every earlier launcher and the exact previous installation record",
  "forced owner exit leaves a durable journal; another installer restores the exact before state without touching unrelated files",
  "recovery preflights all edits before writing, and respects a committed update whose pending marker survived",
  "active host connections block uninstall before any application stop or persistent mutation",
  "uninstall verifies exact owner exit and restores host connections before removing persistent program entries",
  "a restoration conflict retains all program entries and resumes the previous running application",
  "a second registered instance blocks uninstall without stopping either owner",
  "unconfirmed owner exit leaves a durable removal journal and blocks restoration until recovery",
  "a failed uninstall write restores the owned program and keeps restart recovery durable",
  "a dated verified recovery entry restores an interrupted uninstall even after the main loader was removed",
  "an explicit no-start update stops the previous generation without restarting the new one",
  "the stable installed loader verifies and addresses the actual application across update and rollback",
  "pre-promotion owner loss recovers only verified staging copies and exact incomplete source prefixes",
  "interrupted installation recovery accepts the full release file ceiling plus its manifest and preserves unrelated edits"
]);
// Task-owner scenarios keep the original 45-second child bound. Each owns
// its fixture; native Linux-only cases retain their declared skip elsewhere.
export const windowsTaskOwnerScenarios = Object.freeze([
  "persistent metadata ownership binds one original task/account/repository without task creation or IDE authority",
  "two service instances serialize duplicate admission through the real private kernel lease",
  "changed creator account or original task repository refuses binding and retires the exact owned listener",
  "persistence failures preserve no-replay request identity and cannot deliver later task reads",
  "unconfirmed native exit blocks replacement and recovery can only retire the original saved identity",
  "replaced protected ownership or revoked permission cannot return metadata from an older live connection",
  "protected task registry composes the actual owned Unix listener and bridge while the provider is a controlled double",
  "late ownership drift and stopped startup cannot acknowledge a retained connection as current",
  "verified exit of an in-memory owner cannot retire a substituted protected native identity",
  "reviewed owned loading consumes one exact token and preserves request identity across duplicate and restarted callers",
  "load refuses substituted token, changed owner contents, policy or task permissions before a native resume",
  "active and unfamiliar task states refuse loading without changing running permissions",
  "load boundaries refuse asynchronous drift and retain exact late acknowledgement without replay",
  "concurrent reviewed requests cannot load one original owner twice",
  "shutdown joins an in-flight load and prevents its late native effect",
  "authenticated Studio routes compose real protected review/load state without accepting prompts or granting IDE authority",
  "normal workspace selection retires exact owned connections and refuses inactive or externally selected task routes",
  "keyboard-only mode joins task-owner shutdown and preserves failed retirement without enabling new starts",
  "an external workspace change during native project setup refuses the late task effect",
  "a failed bridge close still attempts original native owner retirement and cannot upgrade the uncertain bridge exit",
  "project task choices preserve exact scope and refuse stale or invalid metadata without native effects",
  "a dedicated editor client uses only the original acknowledged task owner and rechecks after registration",
  "authenticated editor routes consume one reviewed launch permission without launching a terminal or exposing its protected record",
  "editor target preparation binds the acknowledged load and original endpoint without another resume, launch or authority claim",
  "editor preparation refuses stale load, changed policy/account, non-idle task and incomplete endpoint identity",
  "asynchronous editor inspection cannot conceal load replacement, endpoint drift or a policy change at its last boundary",
  "the editor client authenticates the real Studio route and reads original protected target metadata without another native effect"
]);
export const windowsTaskOwnerLinuxScenarios = Object.freeze([
  "protected task registry composes the actual owned Unix listener and bridge while the provider is a controlled double",
  "the editor client authenticates the real Studio route and reads original protected target metadata without another native effect"
]);
const scenarios = Object.freeze({
  "tools/layout-studio/coding-task-owners.test.mjs": windowsTaskOwnerScenarios,
  "deployment/suite/installation.test.mjs": windowsInstallationScenarios,
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
