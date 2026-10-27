import { linuxGroups, requiredGroups, runVerification } from "./run-isolated-tests.mjs";

if (process.versions.node.split(".")[0] !== "24") {
  throw new Error("SXSY-B122 source tests require the reviewed Node.js 24 runtime; run them through mise exec node@24.14.0 -- npm test.");
}

const groups = process.platform === "linux" ? linuxGroups : requiredGroups;
const { receipt, receiptPath } = await runVerification({ groups });
for (const child of receipt.children) {
  process.stdout.write(`${child.success ? "PASS" : "FAIL"} ${child.file}${child.pattern ? ` :: ${child.pattern}` : ""}${child.testCounts?.skipped ? ` (${child.testCounts.skipped} skipped)` : ""}\n`);
  if (!child.success) process.stdout.write(`FAIL_DETAIL ${JSON.stringify({ file: child.file, diagnostic: child.failureDiagnostic, testCounts: child.testCounts ?? null })}\n`);
}
process.stdout.write(`${receiptPath ? "RECEIPT" : "RECEIPT_WRITE_FAILED"} ${receipt.runId}${receiptPath ? ` ${receiptPath}` : ""}\n`);
process.exitCode = receipt.success ? 0 : 1;
