/** Complete preliminary Windows backend coverage in five isolated CI jobs. */
import { resolve, join } from "node:path";
import { fileURLToPath } from "node:url";
import { tmpdir } from "node:os";
import { requiredGroups, discoverRequiredTestFiles, assertRequiredTestManifest, runVerification } from "./run-isolated-tests.mjs";
import { selectWindowsContractGroups } from "./windows-scenario-groups.mjs";
import costs from "./fixtures/windows-backend-costs.json" with { type: "json" };

// Historical observations guide placement only. Original group objects and
// execution deadlines go unchanged to the isolated verifier.
const key = group => JSON.stringify([group.file, group.pattern ?? null]);
if (costs.schema !== "switchyard-windows-backend-costs/v1" || !Array.isArray(costs.groups) || costs.groups.length > 640 || costs.fallbackCostMs !== 60000) throw Error("The native scheduling estimates are invalid.");
const estimates = new Map();
for (const group of costs.groups) {
  if (typeof group.file !== "string" || !(group.pattern === null || typeof group.pattern === "string") || !Number.isSafeInteger(group.costMs) || group.costMs < 1 || group.costMs > 600000 || estimates.has(key(group))) throw Error("A native scheduling estimate is invalid or duplicated.");
  estimates.set(key(group), group.costMs);
}

export const windowsBackendShards = Object.freeze([1, 2, 3, 4, 5]);
export function selectWindowsBackendShard(shard, groups = requiredGroups) {
  if (!windowsBackendShards.includes(shard)) throw Error("Choose one of the five exact Windows backend shards.");
  const files = discoverRequiredTestFiles().filter(file => file.startsWith("tools/layout-studio/") || file.startsWith("deployment/suite/")
    || ["scripts/run-isolated-tests.test.mjs", "scripts/windows-backend-shards.test.mjs"].includes(file)).sort();
  if (files.length < 10) throw Error("The complete preliminary backend inventory is missing.");
  const all = selectWindowsContractGroups(files, groups);
  const loads = windowsBackendShards.map(() => 0), assignment = new Map();
  const ranked = all.map((group, index) => ({ group, index, cost: estimates.get(key(group)) ?? costs.fallbackCostMs }))
    .sort((a, b) => b.cost - a.cost || a.index - b.index);
  for (const { group, cost } of ranked) {
    const target = loads.indexOf(Math.min(...loads));
    loads[target] += cost; assignment.set(group, target);
  }
  return all.filter(group => assignment.get(group) === shard - 1);
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const args = process.argv.slice(2);
  if (process.platform !== "win32" || args.length !== 2 || args[0] !== "--synthetic" || !/^--shard=[1-5]$/.test(args[1])) throw Error("Use only on Windows: --synthetic --shard=1|2|3|4|5.");
  assertRequiredTestManifest(); const shard = Number(args[1].at(-1));
  const { receipt, receiptPath } = await runVerification({ groups: selectWindowsBackendShard(shard), outputDirectory: join(process.env.RUNNER_TEMP || tmpdir(), "switchyard-backend", String(shard)),
    onProgress: progress => console.log("SXSY-WINDOWS-BACKEND-PROGRESS " + JSON.stringify({ shard, ...progress })) });
  console.log(JSON.stringify({ shard, receiptPath, success: receipt.success, totals: receipt.totals }));
  for (const child of receipt.children.filter(child => !child.success)) console.log(JSON.stringify({ file: child.file, pattern: child.pattern, timeout: child.timeout, exitCode: child.exitCode, diagnostic: child.failureDiagnostic }));
  process.exitCode = receipt.success ? 0 : 1;
}
