#!/usr/bin/env node
/** Every scenario in complete storage files; original per-child deadlines apply. */
import { join } from "node:path";
import { tmpdir } from "node:os";
import { selectWindowsContractGroups } from "./windows-scenario-groups.mjs";
import { requiredGroups, runVerification, assertRequiredTestManifest } from "./run-isolated-tests.mjs";
const suites = {
  "history-scanner": "tools/layout-studio/repository-shield-history.test.mjs",
  "history-inputs": "tools/layout-studio/git-history-inputs.test.mjs",
  "history-authority": "tools/layout-studio/task-history-inputs.test.mjs",
  "index-inputs": "tools/layout-studio/git-index-inputs.test.mjs",
  "index-bytes": "tools/layout-studio/windows-index-inputs.test.mjs",
  "index-staging": "tools/layout-studio/windows-index-staging.test.mjs",
  "index-scanner": "tools/layout-studio/repository-windows-shield-index.test.mjs",
  "index-authority": "tools/layout-studio/task-index-inputs.test.mjs",
  "osv-source": "tools/layout-studio/osv-advisory-source.test.mjs",
  "osv-scanner": "tools/layout-studio/repository-shield-osv-source.test.mjs",
  "ignored-tree-policy": "tools/layout-studio/ignored-tree-policy.test.mjs",
  "ignored-tree-authority": "tools/layout-studio/task-authority-ignored-trees.test.mjs",
  "ignored-tree-scanner": "tools/layout-studio/repository-shield-ignored-trees.test.mjs",
  "backend-contract": "apps/windows-companion/test/windows-sandbox.test.ts",
  "receipt-authority": "tools/layout-studio/repository-receipt-authority.test.mjs",
  "receipt-authority-state": "tools/layout-studio/receipt-authority-state.test.mjs",
  "shield-exceptions": "tools/layout-studio/shield-exceptions.test.mjs",
  "shield-exception-execution": "tools/layout-studio/repository-windows-shield-exceptions.test.mjs",
  "shield-exception-ledger": "tools/layout-studio/shield-exception-ledger.test.mjs",
  "ignored-authority": "tools/layout-studio/task-authority-ignored-inputs.test.mjs",
  "ignored-scanner": "tools/layout-studio/repository-ignored-scanner-inputs.test.mjs",
  "fixture-invalidation": "tools/layout-studio/scanner-fixture-invalidation.test.mjs",
  "validation-policy": "tools/layout-studio/repository-validation-policy.test.mjs",
  "fixture-registry": "apps/windows-companion/test/scanner-fixtures.test.ts",
  "shield-evidence": "tools/layout-studio/windows-shield-evidence.test.mjs",
  "shield-policy": "tools/layout-studio/repository-windows-shield.test.mjs",
  "shield-recovery": "tools/layout-studio/repository-windows-shield-recovery.test.mjs",
  "pipeline-recovery": "tools/layout-studio/repository-windows-pipeline-recovery.test.mjs",
  "pipeline-policy": "tools/layout-studio/repository-windows-pipeline.test.mjs",
  "pipeline-evidence": "tools/layout-studio/windows-pipeline-evidence.test.mjs",
  "fixture-removal": "tools/layout-studio/scanner-fixture-removal.test.mjs",
  "fixture-maintenance": "tools/layout-studio/scanner-fixtures.test.mjs",
  harness: "scripts/run-isolated-tests.test.mjs",
  leases: "tools/layout-studio/state-lock.test.mjs",
  "legacy-images": "tools/layout-studio/windows-exchange-images.test.mjs",
  "broker-owner": "tools/layout-studio/windows-broker-exchanges.test.mjs",
  "sandbox-native": "tools/layout-studio/windows-sandbox-native.test.mjs",
  "sandbox-sessions": "tools/layout-studio/windows-sandbox-sessions.test.mjs",
  "reviewed-run": "tools/layout-studio/windows-reviewed-run.test.mjs",
  "run-owner": "tools/layout-studio/windows-reviewed-runner.test.mjs"
};
const flags = process.argv.slice(2), suite = flags[1]?.startsWith("--suite=") ? flags[1].slice(8) : undefined;
if (process.platform !== "win32" || flags.length !== 2 || flags[0] !== "--synthetic" || !Object.hasOwn(suites, suite)) throw Error("Use on Windows: node scripts/verify-windows-storage-contracts.mjs --synthetic --suite=history-scanner|history-inputs|history-authority|index-inputs|index-bytes|index-staging|index-scanner|index-authority|osv-source|osv-scanner|ignored-tree-policy|ignored-tree-authority|ignored-tree-scanner|receipt-authority|receipt-authority-state|shield-exceptions|shield-exception-execution|shield-exception-ledger|ignored-authority|ignored-scanner|fixture-invalidation|validation-policy|shield-evidence|shield-policy|shield-recovery|pipeline-recovery|pipeline-policy|pipeline-evidence|fixture-removal|backend-contract|fixture-registry|fixture-maintenance|harness|leases|legacy-images|broker-owner|sandbox-native|sandbox-sessions|reviewed-run|run-owner. No disk, VM, account or keyboard is opened.");
assertRequiredTestManifest();
const groups = selectWindowsContractGroups([suites[suite]], requiredGroups);
const result = await runVerification({ groups, outputDirectory: join(process.env.RUNNER_TEMP || tmpdir(), "switchyard-storage-contracts", suite) });
console.log(JSON.stringify({ suite, success: result.receipt.success, runId: result.receipt.runId, totals: result.receipt.totals, guestLaunched: false, accountOpened: false, keyboardOpened: false }));
for (const child of result.receipt.children.filter(child => !child.success)) console.log(JSON.stringify({ file: child.file, exitCode: child.exitCode, timeout: child.timeout, diagnostic: child.failureDiagnostic }));
process.exitCode = result.receipt.success ? 0 : 1;
