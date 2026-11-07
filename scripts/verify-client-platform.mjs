/** Bounded native client and reviewed-input checks, independent of the complete release lane. */
import { requiredGroups, runVerification } from "./run-isolated-tests.mjs";
const files = new Set(["tools/layout-studio/client-launch.test.mjs", "tools/layout-studio/physical-intent.test.mjs", "tools/layout-studio/native-focus-gateway.test.mjs", "tools/layout-studio/windows-terminal-process.test.mjs", "tools/layout-studio/windows-terminal-peer.test.mjs", "tools/layout-studio/integrations.test.mjs", "tools/layout-studio/suite.test.mjs", "deployment/suite/release.test.mjs", "apps/windows-companion/test/repository-runtime.test.ts"]);
const groups = requiredGroups.filter(g => files.has(g.file));
if (groups.length !== files.size) throw new Error("The exact client platform verification inventory changed.");
const { receipt, receiptPath } = await runVerification({ groups });
for (const child of receipt.children) if (!child.success) console.log("FAIL_DETAIL " + JSON.stringify({ file: child.file, diagnostic: child.failureDiagnostic, counts: child.testCounts, timeout: child.timeout }));
console.log(JSON.stringify({ schema: "switchyard-client-platform-verification/v1", platform: process.platform, receiptPath, runId: receipt.runId, success: receipt.success, totals: receipt.totals, meaning: "Native metadata and protocol/ownership boundaries; no Windows URI, account, window or device acceptance inferred" }));
process.exitCode = receipt.success ? 0 : 1;
