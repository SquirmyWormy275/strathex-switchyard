#!/usr/bin/env node
/** Portable policy machinery on native Windows; all guest execution is doubled. */
import { join } from "node:path";
import { tmpdir } from "node:os";
import { requiredGroups, runVerification, assertRequiredTestManifest } from "./run-isolated-tests.mjs";

if (process.platform !== "win32" || process.argv.length !== 3 || process.argv[2] !== "--synthetic") throw Error("Usage on Windows: node scripts/verify-windows-policy.mjs --synthetic. This check opens no VM, account or keyboard.");
assertRequiredTestManifest();
const files = ["scripts/run-isolated-tests.test.mjs", "tools/layout-studio/repository-windows-execution.test.mjs"];
const groups = files.map(file => {
  const group = requiredGroups.find(group => group.file === file);
  if (!group) throw Error("A required Windows policy test group is missing.");
  return group;
});
const result = await runVerification({ groups, outputDirectory: join(process.env.RUNNER_TEMP || tmpdir(), "switchyard-policy-verification") });
console.log(JSON.stringify({ success: result.receipt.success, runId: result.receipt.runId, totals: result.receipt.totals, guestLaunched: false, accountOpened: false, keyboardOpened: false }));
for (const child of result.receipt.children.filter(child => !child.success)) console.log(JSON.stringify({ file: child.file, exitCode: child.exitCode, timeout: child.timeout, diagnostic: child.failureDiagnostic }));
process.exitCode = result.receipt.success ? 0 : 1;
