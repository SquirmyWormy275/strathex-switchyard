#!/usr/bin/env node
/** Complete storage contract files; existing isolated inventory/deadlines apply. */
import { join } from "node:path";
import { tmpdir } from "node:os";
import { requiredGroups, runVerification, assertRequiredTestManifest } from "./run-isolated-tests.mjs";
const suites = {
  "backend-contract": "apps/windows-companion/test/windows-sandbox.test.ts",
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
if (process.platform !== "win32" || flags.length !== 2 || flags[0] !== "--synthetic" || !Object.hasOwn(suites, suite)) throw Error("Use on Windows: node scripts/verify-windows-storage-contracts.mjs --synthetic --suite=shield-exception-ledger|ignored-authority|ignored-scanner|fixture-invalidation|validation-policy|shield-evidence|shield-policy|shield-recovery|pipeline-recovery|pipeline-policy|pipeline-evidence|fixture-removal|backend-contract|fixture-registry|fixture-maintenance|harness|leases|legacy-images|broker-owner|sandbox-native|sandbox-sessions|reviewed-run|run-owner. No disk, VM, account or keyboard is opened.");
assertRequiredTestManifest();
const groups = requiredGroups.filter(group => group.file === suites[suite]);
if (groups.length !== 1) throw Error("The complete Windows storage contract is absent or ambiguous in the required inventory.");
const result = await runVerification({ groups, outputDirectory: join(process.env.RUNNER_TEMP || tmpdir(), "switchyard-storage-contracts", suite) });
console.log(JSON.stringify({ suite, success: result.receipt.success, runId: result.receipt.runId, totals: result.receipt.totals, guestLaunched: false, accountOpened: false, keyboardOpened: false }));
for (const child of result.receipt.children.filter(child => !child.success)) console.log(JSON.stringify({ file: child.file, exitCode: child.exitCode, timeout: child.timeout, diagnostic: child.failureDiagnostic }));
process.exitCode = result.receipt.success ? 0 : 1;
