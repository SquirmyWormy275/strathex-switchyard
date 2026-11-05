#!/usr/bin/env node
/** Portable policy machinery on native Windows; all guest execution is doubled. */
import { join } from "node:path";
import { tmpdir } from "node:os";
import { selectWindowsContractGroups } from "./windows-scenario-groups.mjs";
import { requiredGroups, runVerification, assertRequiredTestManifest } from "./run-isolated-tests.mjs";

const suites = {
  policy: "tools/layout-studio/repository-windows-execution.test.mjs",
  recovery: "tools/layout-studio/repository-windows-execution-recovery.test.mjs",
  stop: "tools/layout-studio/repository-windows-execution-stop.test.mjs",
  output: "tools/layout-studio/repository-windows-execution-output.test.mjs",
  authority: "tools/layout-studio/task-authority.test.mjs",
  "host-stop": "tools/layout-studio/repository-execution-stop.test.mjs"
};
const flags = process.argv.slice(2), suite = flags[1]?.startsWith("--suite=") ? flags[1].slice(8) : undefined;
if (process.platform !== "win32" || flags[0] !== "--synthetic" || flags.length > 2 || flags.length === 2 && !Object.hasOwn(suites, suite)) throw Error("Usage on Windows: node scripts/verify-windows-policy.mjs --synthetic [--suite=policy|recovery|stop|output|authority|host-stop]. This check opens no VM, account or keyboard.");
assertRequiredTestManifest();
const files = ["scripts/run-isolated-tests.test.mjs", ...(suite ? [suites[suite]] : Object.values(suites))];
const groups = selectWindowsContractGroups(files, requiredGroups);
const result = await runVerification({ groups, outputDirectory: join(process.env.RUNNER_TEMP || tmpdir(), "switchyard-policy-verification") });
console.log(JSON.stringify({ suite: suite ?? "all", success: result.receipt.success, runId: result.receipt.runId, totals: result.receipt.totals, guestLaunched: false, accountOpened: false, keyboardOpened: false }));
for (const child of result.receipt.children.filter(child => !child.success)) console.log(JSON.stringify({ file: child.file, exitCode: child.exitCode, timeout: child.timeout, diagnostic: child.failureDiagnostic }));
process.exitCode = result.receipt.success ? 0 : 1;
