/** Complete preliminary Windows backend coverage in four isolated CI jobs. */
import { resolve, join } from "node:path";
import { fileURLToPath } from "node:url";
import { tmpdir } from "node:os";
import { requiredGroups, discoverRequiredTestFiles, assertRequiredTestManifest, runVerification } from "./run-isolated-tests.mjs";
import { selectWindowsContractGroups } from "./windows-scenario-groups.mjs";

export const windowsBackendShards = Object.freeze([1, 2, 3, 4]);
export function selectWindowsBackendShard(shard, groups = requiredGroups) {
  if (!windowsBackendShards.includes(shard)) throw Error("Choose one of the four exact Windows backend shards.");
  const files = discoverRequiredTestFiles().filter(file => file.startsWith("tools/layout-studio/") || file.startsWith("deployment/suite/")
    || ["scripts/run-isolated-tests.test.mjs", "scripts/windows-backend-shards.test.mjs"].includes(file)).sort();
  if (files.length < 10) throw Error("The complete preliminary backend inventory is missing.");
  const all = selectWindowsContractGroups(files, groups);
  return all.filter((_, index) => index % windowsBackendShards.length === shard - 1);
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const args = process.argv.slice(2);
  if (process.platform !== "win32" || args.length !== 2 || args[0] !== "--synthetic" || !/^--shard=[1-4]$/.test(args[1])) throw Error("Use only on Windows: --synthetic --shard=1|2|3|4.");
  assertRequiredTestManifest(); const shard = Number(args[1].at(-1));
  const { receipt, receiptPath } = await runVerification({ groups: selectWindowsBackendShard(shard), outputDirectory: join(process.env.RUNNER_TEMP || tmpdir(), "switchyard-backend", String(shard)) });
  console.log(JSON.stringify({ shard, receiptPath, success: receipt.success, totals: receipt.totals }));
  for (const child of receipt.children.filter(child => !child.success)) console.log(JSON.stringify({ file: child.file, pattern: child.pattern, timeout: child.timeout, exitCode: child.exitCode, diagnostic: child.failureDiagnostic }));
  process.exitCode = receipt.success ? 0 : 1;
}
