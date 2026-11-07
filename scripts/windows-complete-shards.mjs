/** Complete source verification across bounded workers. Package acceptance is separate. */
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { mkdir, readFile, writeFile, lstat, readdir } from "node:fs/promises";
import { resolve, join, isAbsolute } from "node:path";
import { fileURLToPath } from "node:url";
import { requiredGroups, assertRequiredTestManifest, effectiveGroupTimeout, runVerification, root } from "./run-isolated-tests.mjs";
import costs from "./fixtures/windows-backend-costs.json" with { type: "json" };

const hash = value => createHash("sha256").update(value).digest("hex");
const key = group => JSON.stringify([group.file, group.pattern ?? null]);
const integer = value => Number.isSafeInteger(value) && value >= 0;
const same = (actual, expected, message) => assert.deepEqual(actual, expected, message);
export const completeWindowsShards = Object.freeze([...Array.from({ length: 20 }, (_, i) => String(i + 1)), "assembly"]);
assert.equal(costs.schema, "switchyard-windows-backend-costs/v1");
assert(Array.isArray(costs.groups) && costs.groups.length <= 640);
assert.equal(costs.fallbackCostMs, 60000);
const estimates = new Map();
for (const row of costs.groups) {
  assert(typeof row.file === "string" && (row.pattern === null || typeof row.pattern === "string"));
  assert(integer(row.costMs) && row.costMs >= 1 && row.costMs <= 600000 && !estimates.has(key(row)));
  estimates.set(key(row), row.costMs);
}
export const completeWindowsCost = group => estimates.get(key(group)) ?? costs.fallbackCostMs;
const builtOutputConsumers = new Set([
  "apps/windows-companion/test/packaged-runtime.test.ts",
  "apps/windows-companion/test/main-shutdown.test.ts"
]);
const requiresAssembly = group => Boolean(group.args) || builtOutputConsumers.has(group.file);

export function selectCompleteWindowsShard(shard, groups = requiredGroups) {
  assert(completeWindowsShards.includes(shard), "Select an exact complete Windows shard.");
  same(groups, requiredGroups, "The original complete manifest cannot be changed.");
  assertRequiredTestManifest(groups);
  // Builds, PowerShell verification and tests that read compiled outputs share
  // one worker, retaining their original dependency order.
  if (shard === "assembly") return groups.filter(requiresAssembly);
  const loads = Array(20).fill(0), assignments = new Map();
  const ranked = groups.filter(group => !requiresAssembly(group)).map((group, index) => ({ group, index, cost: completeWindowsCost(group) }))
    .sort((a, b) => b.cost - a.cost || a.index - b.index);
  for (const { group, cost } of ranked) {
    const worker = loads.indexOf(Math.min(...loads));
    loads[worker] += cost; assignments.set(group, String(worker + 1));
  }
  return groups.filter(group => assignments.get(group) === shard);
}

const exactKeys = (value, keys) => value && typeof value === "object" && !Array.isArray(value)
  && Object.keys(value).sort().join() === keys.slice().sort().join();
function validateScope(scope) {
  assert(exactKeys(scope, ["platform", "sourceCommit", "sourceTree", "nodeVersion", "nodeExecutable", "nodeSha256", "pythonVersion", "pythonExecutable", "pythonSha256", "helperSha256", "dotnetManifestSha256"]));
  assert.equal(scope.platform, "win32"); assert.equal(scope.nodeVersion, "24.14.0"); assert.equal(scope.pythonVersion, "3.13.3");
  for (const field of ["sourceCommit", "sourceTree"]) assert.match(scope[field], /^[a-f0-9]{40}$/);
  for (const field of ["nodeSha256", "pythonSha256", "helperSha256", "dotnetManifestSha256"]) assert.match(scope[field], /^[a-f0-9]{64}$/);
  for (const field of ["nodeExecutable", "pythonExecutable"]) assert(typeof scope[field] === "string" && /^[A-Za-z]:\\/.test(scope[field]) && !/[\0\r\n]/.test(scope[field]));
}
function expectedCommand(group, scope) {
  if (group.args) return [group.executable ?? scope.nodeExecutable, ...group.args];
  const args = [scope.nodeExecutable, "--experimental-transform-types", "--test", "--test-reporter=tap"];
  if (group.pattern) args.push("--test-name-pattern", "^" + group.pattern.replace(/[$.*+?^{}()|[\]\\]/g, "\\$&") + "$");
  return [...args, group.file];
}
function totalsFor(children) {
  return {
    required: children.length, passed: children.filter(c => c.success).length, failed: children.filter(c => !c.success).length,
    tests: children.reduce((n, c) => n + (c.testCounts?.total ?? 0), 0),
    passedTests: children.reduce((n, c) => n + (c.testCounts?.passed ?? 0), 0),
    failedTests: children.reduce((n, c) => n + (c.testCounts?.failed ?? 0), 0),
    skippedTests: children.reduce((n, c) => n + (c.testCounts?.skipped ?? 0), 0),
    cancelledTests: children.reduce((n, c) => n + (c.testCounts?.cancelled ?? 0), 0),
    todoTests: children.reduce((n, c) => n + (c.testCounts?.todo ?? 0), 0)
  };
}

/** Audit exact original receipts; never turn partial TAP into a complete run. */
export function auditCompleteWindowsReceipts(envelopes, scope) {
  validateScope(scope); assertRequiredTestManifest();
  assert(Array.isArray(envelopes) && envelopes.length === completeWindowsShards.length, "Every complete-source worker is required.");
  const byShard = new Map(), runIds = new Set(), children = new Map(), cohorts = [];
  for (const envelope of envelopes) {
    assert(exactKeys(envelope, ["schema", "shard", "scope", "receiptText", "receiptSha256"]));
    assert.equal(envelope.schema, "switchyard-complete-windows-shard/v1");
    assert(completeWindowsShards.includes(envelope.shard) && !byShard.has(envelope.shard), "A shard is missing, duplicated or unknown.");
    same(envelope.scope, scope, "Source or native toolchain identity changed between workers.");
    assert(typeof envelope.receiptText === "string" && Buffer.byteLength(envelope.receiptText) <= 4 * 1024 * 1024);
    assert.equal(hash(envelope.receiptText), envelope.receiptSha256);
    const receipt = JSON.parse(envelope.receiptText), groups = selectCompleteWindowsShard(envelope.shard);
    assert.equal(receipt.version, 1); assert.equal(receipt.success, true);
    assert.match(receipt.runId, /^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/);
    assert(!runIds.has(receipt.runId), "A receipt was reused by another shard."); runIds.add(receipt.runId);
    same(receipt.receiptWrite, { completed: true, error: null });
    same(receipt.progressWrite, { completed: true, error: null });
    same(receipt.requiredGroups, groups, "The whole original group inventory and order must match.");
    assert(Array.isArray(receipt.children) && receipt.children.length === groups.length);
    assert(Number.isFinite(Date.parse(receipt.startedAt)) && Date.parse(receipt.endedAt) >= Date.parse(receipt.startedAt));
    for (const [i, child] of receipt.children.entries()) {
      const group = groups[i], id = key(group);
      assert(!children.has(id), "A test group was executed twice.");
      same([child.file, child.pattern], [group.file, group.pattern ?? null]);
      same(child.command, expectedCommand(group, scope));
      assert.equal(child.effectiveTimeoutMs, effectiveGroupTimeout(group));
      assert.equal(child.environmentPolicy, "strict-test-v3");
      assert.equal(child.outputLimitBytes, 65536);
      assert.equal(child.outputTruncated, false); assert.match(child.outputDigest, /^[a-f0-9]{64}$/);
      assert(integer(child.outputBytes) && integer(child.totalOutputBytes) && child.outputBytes === child.totalOutputBytes && child.outputBytes <= child.outputLimitBytes);
      assert(integer(child.durationMs)); assert.equal(child.success, true); assert.equal(child.exitCode, 0);
      assert.equal(child.signal, null); assert.equal(child.timeout, false); assert.equal(child.spawnError, null);
      assert.equal(child.zeroTestPlan, false); assert.equal(child.failureDiagnostic, null);
      assert.equal(child.cleanupCompleted, true); assert.equal(child.cleanupError, null);
      assert.equal(child.processTreeTermination?.completed, true); assert.equal(child.processTreeTermination.supervisorError, null);
      if (group.args) assert.equal(child.testCounts, undefined);
      else {
        const c = child.testCounts; assert(exactKeys(c, ["total", "passed", "failed", "cancelled", "skipped", "todo"]));
        assert(Object.values(c).every(integer) && c.total >= 1 && c.passed + c.skipped === c.total);
        same([c.failed, c.cancelled, c.todo, c.skipped], [0, 0, 0, group.expectedSkipped ?? 0]);
      }
      children.set(id, child);
    }
    same(receipt.totals, totalsFor(receipt.children));
    byShard.set(envelope.shard, envelope);
    cohorts.push({ shard: envelope.shard, receiptId: receipt.runId, receiptSha256: envelope.receiptSha256, totals: receipt.totals });
  }
  assert.equal(children.size, requiredGroups.length);
  for (const group of requiredGroups) assert(children.has(key(group)));
  const ordered = requiredGroups.map(group => children.get(key(group)));
  return { schema: "switchyard-complete-windows-verification/v1", scope, complete: true, distributed: true,
    manifestSha256: hash(JSON.stringify(requiredGroups)), totals: totalsFor(ordered),
    cohorts: completeWindowsShards.map(shard => cohorts.find(row => row.shard === shard)),
    originalCommandsBoundsSkipsAndCleanupVerified: true, packageAcceptance: false };
}

async function fileDigest(path, limit = 128 * 1024 * 1024) {
  const info = await lstat(path); assert(info.isFile() && !info.isSymbolicLink() && info.size > 0 && info.size <= limit);
  const bytes = await readFile(path); assert.equal(bytes.length, info.size); return hash(bytes);
}
async function nativeScope(python) {
  assert.equal(process.platform, "win32"); assert.equal(process.versions.node, "24.14.0");
  assert(isAbsolute(python) && !/[\0\r\n]/.test(python));
  const git = args => execFileSync("git", args, { cwd: root, encoding: "utf8", timeout: 10000 }).trim();
  assert.equal(git(["status", "--porcelain", "--untracked-files=no"]), "", "Tracked source must remain unchanged.");
  const manifest = await readFile(join(root, "deployment/windows/dotnet-toolchain.json")), pins = JSON.parse(manifest);
  assert.equal(await fileDigest(join(root, ".tools/dotnet/dotnet.exe")), pins.dotnetExeSha256);
  assert.equal(await fileDigest(join(root, ".tools/NuGet.Config")), pins.nugetConfigSha256);
  const pythonVersion = execFileSync(python, ["-I", "-B", "-c", "import sys;print('.'.join(map(str,sys.version_info[:3])))"], { encoding: "utf8", timeout: 10000 }).trim();
  const scope = { platform: "win32", sourceCommit: git(["rev-parse", "HEAD"]), sourceTree: git(["rev-parse", "HEAD^{tree}"]),
    nodeVersion: process.versions.node, nodeExecutable: process.execPath, nodeSha256: await fileDigest(process.execPath),
    pythonVersion, pythonExecutable: python, pythonSha256: await fileDigest(python),
    helperSha256: await fileDigest(join(root, "runtime/hotkeys/Switchyard.Hotkeys.exe")), dotnetManifestSha256: hash(manifest) };
  validateScope(scope); return scope;
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const args = process.argv.slice(2);
  assert.equal(process.platform, "win32", "Complete Windows execution requires a native Windows worker.");
  assert(args.length === 4 && args[0] === "--synthetic" && args[2].startsWith("--python=") && args[3].startsWith("--output="), "Use --synthetic --shard=1..20|assembly or --collect=directory, then --python=absolute-path --output=absolute-path.");
  const python = args[2].slice(9), output = args[3].slice(9), scope = await nativeScope(python);
  assert(isAbsolute(output) && !/[\0\r\n]/.test(output));
  if (args[1].startsWith("--shard=")) {
    const shard = args[1].slice(8), groups = selectCompleteWindowsShard(shard);
    await mkdir(output, { recursive: true });
    const result = await runVerification({ groups, outputDirectory: output, onProgress: p => console.log("SXSY-COMPLETE-WINDOWS-PROGRESS " + JSON.stringify({ shard, ...p })) });
    same(await nativeScope(python), scope);
    assert(result.receiptPath, "A bounded original receipt is required even after failure.");
    const receiptText = await readFile(result.receiptPath, "utf8");
    const envelope = { schema: "switchyard-complete-windows-shard/v1", shard, scope, receiptText, receiptSha256: hash(receiptText) };
    await writeFile(join(output, "complete-shard-" + shard + ".json"), JSON.stringify(envelope) + "\n", { flag: "wx", mode: 0o600 });
    console.log(JSON.stringify({ shard, success: result.receipt.success, totals: result.receipt.totals }));
    process.exitCode = result.receipt.success ? 0 : 1;
  } else {
    assert(args[1].startsWith("--collect=")); const directory = args[1].slice(10);
    assert(isAbsolute(directory) && !/[\0\r\n]/.test(directory));
    const expected = completeWindowsShards.map(shard => "complete-shard-" + shard + ".json");
    same((await readdir(directory)).sort(), expected.slice().sort(), "The receipt directory must contain exactly this run's complete shard set.");
    const envelopes = [];
    for (const name of expected) {
      const path = join(directory, name); await fileDigest(path, 5 * 1024 * 1024);
      envelopes.push(JSON.parse(await readFile(path, "utf8")));
    }
    const result = auditCompleteWindowsReceipts(envelopes, scope); same(await nativeScope(python), scope);
    await writeFile(output, JSON.stringify(result, null, 2) + "\n", { flag: "wx", mode: 0o600 });
    console.log(JSON.stringify({ complete: true, totals: result.totals, source: scope.sourceCommit, packageAcceptance: false }));
  }
}

