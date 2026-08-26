import { createHash, randomUUID } from "node:crypto";
import { spawn } from "node:child_process";
import { existsSync, readdirSync } from "node:fs";
import { mkdir, mkdtemp, rename, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";
import { dirname, join, resolve } from "node:path";
import { terminateOwnedProcessTree } from "./test-support/process-tree.mjs";

export const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
export const receiptDirectory = join(root, ".sxsy-verification");
const npmCliCandidates = [
  process.env.npm_execpath,
  join(dirname(process.execPath), "node_modules", "npm", "bin", "npm-cli.js"),
  resolve(dirname(process.execPath), "..", "lib", "node_modules", "npm", "bin", "npm-cli.js")
].filter(Boolean);
const npmCli = npmCliCandidates.find((candidate) => existsSync(candidate));
if (!npmCli) throw new Error("A pinned npm CLI entrypoint is required to build the packaged companion test artifact.");
/**
 * Each independently-exited child owns one test file.  Keep this manifest
 * explicit: its serialized form is the authoritative proof of exactly which
 * suite ran, rather than a glob whose expansion could vary by shell/runtime.
 */
const controlPlaneTests = [
  "acceptance-evidence", "adapters", "brokers", "budgets", "checkpoints",
  "child-saga-recovery", "command-catalog", "confirmations", "containment",
  "context-council", "dispatch", "durable-containment", "git-inspector",
  "policy", "recipes", "redaction", "runtime", "session-authority",
  "snapshot-ledger", "snapshot-operations", "snapshot-resolver", "store-receipts",
  "voice", "workflow-artifacts"
].map((name) => ({ file: `packages/control-plane/test/${name}.test.ts` }));
const companionTests = [
  "acceptance-administration", "atomic-python-venv", "authenticated-pipe", "bootstrap", "companion-lifecycle-helper", "configured-network", "configured-voice-provider", "containment-release", "control-plane",
  "configured-provider-host", "council-epoch-lifecycle", "council-resource-broker", "council-runtime", "council-workspace-isolation", "durable-credentials", "main-shutdown",
  "direct-request-cancellation", "durable-endpoint", "git-review", "hardware-signal-dispatcher", "hardware-signal-queue",
  "hardware-signal-service", "host-actions", "host-provisioning", "github-navigation",
  "instance-lifecycle", "local-checkpoints", "local-runtime", "operation-control",
  "operation-recovery", "packaged-runtime", "pipeline-adapters",
  "provider-desktop", "provider-desktop-adapter", "provider-desktop-configuration", "provider-desktop-effects", "provider-dispatch-lease", "provider-gateway", "provider-host-dispatch-provisioning", "raw-hid-installation", "raw-hid-main-wiring", "raw-hid-simulator",
  "raw-hid-protocol", "receipt-evidence", "remote-adapters", "remote-git",
  "repository-process-supervisor", "repository-recipe-evidence",
  "repository-recipe-host-evidence", "repository-runner-helper",
  "repository-runtime", "repository-runtime-broker", "scanner-fixtures",
  "repository-runtime-release-package", "router", "runtime-provisioning",
  "runtime-registry", "sandbox-installation", "sandbox-lifecycle-helper", "service", "session-freshness", "stdio",
  "voice-gateway", "voice-helper-source", "voice-runtime", "windows-job-supervisor", "windows-provider-process", "windows-sandbox",
  "windows-sandbox-helper-contract", "windows-user-presence", "windows-voice-port", "windows-voice-transcript-vault", "workflow-context-preparation", "workflow-voice-service"
].map((name) => ({ file: `apps/windows-companion/test/${name}.test.ts`, currentUserProfile: name === "packaged-runtime", ...(name === "companion-lifecycle-helper" ? { timeoutMs: 240_000 } : {}) }));
const mediatedGitTests = [
  "mediated local commit uses an exact task-owned private index and reconciles the shared index to its committed tree",
  "default-branch review creates a hook-disabled feature branch and requires a fresh target before committing",
  "detached-HEAD review creates an exact feature branch before any commit and requires a fresh target",
  "mediated local commit rejects unowned paths, a dirty shared index, containment, and a final target change"
].map((pattern) => ({ file: "apps/windows-companion/test/mediated-git.test.ts", pattern }));
const extensionTests = ["commands", "companion-bridge", "controller", "named-pipe-transport"]
  .map((name) => ({ file: `apps/vscode-extension/test/${name}.test.ts` }));
const providerHostTests = ["config", "council-resources", "dispatch-lease", "redaction", "release", "server", "service", "tls-network-e2e", "workflow-context"]
  .map((name) => ({ file: `apps/provider-adapter-host/test/${name}.test.ts`, currentUserProfile: name === "tls-network-e2e", safeTrace: name === "tls-network-e2e", ...(name === "tls-network-e2e" ? { timeoutMs: 75_000 } : {}) }));
export const requiredGroups = [
  { file: "scripts/run-isolated-tests.test.mjs" },
  { file: "scripts/b122-acceptance-evidence.test.mjs" },
  { file: "scripts/b122-scanner-fixture.test.mjs" },
  { file: "firmware/verify-require-compiler.test.mjs" },
  { file: "build:companion", args: [npmCli, "run", "build:companion"] },
  { file: "build:provider-host", args: [npmCli, "run", "build:provider-host"] },
  ...(process.platform === "win32" ? [{
    file: "deployment/windows/Test-B122ManifestGenerators.ps1",
    executable: "C:\\Windows\\System32\\WindowsPowerShell\\v1.0\\powershell.exe",
    args: ["-NoLogo", "-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass", "-File", "deployment/windows/Test-B122ManifestGenerators.ps1"]
  }, {
    file: "deployment/windows/Test-B122InstallLifecycle.ps1",
    executable: "C:\\Windows\\System32\\WindowsPowerShell\\v1.0\\powershell.exe",
    args: ["-NoLogo", "-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass", "-File", "deployment/windows/Test-B122InstallLifecycle.ps1"]
  }, {
    file: "deployment/windows/Test-B122TrustedBootstrap.ps1#powershell5",
    executable: "C:\\Windows\\System32\\WindowsPowerShell\\v1.0\\powershell.exe",
    args: ["-NoLogo", "-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass", "-File", "deployment/windows/Test-B122TrustedBootstrap.ps1"],
    timeoutMs: 240_000
  }, {
    file: "deployment/windows/Test-B122TrustedBootstrap.ps1#pwsh",
    executable: "pwsh.exe",
    args: ["-NoLogo", "-NoProfile", "-NonInteractive", "-File", "deployment/windows/Test-B122TrustedBootstrap.ps1"],
    timeoutMs: 240_000
  }, {
    file: "deployment/windows/Test-B122ProviderDesktopRelease.ps1",
    executable: "C:\\Windows\\System32\\WindowsPowerShell\\v1.0\\powershell.exe",
    args: ["-NoLogo", "-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass", "-File", "deployment/windows/Test-B122ProviderDesktopRelease.ps1"]
  }] : []),
  { file: "packages/protocol/test/b122.test.ts" },
  { file: "packages/protocol/test/raw-hid.test.ts" },
  ...controlPlaneTests,
  ...companionTests,
  ...mediatedGitTests,
  ...extensionTests,
  ...providerHostTests
];
const limit = 64 * 1024;
const patternArgument = (pattern) => pattern ? `^${pattern.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}$` : undefined;
function testCounts(output, isTestRun) {
  if (!isTestRun) return undefined;
  // Accept only Node's final, contiguous TAP summary. Test output appearing
  // earlier in stdout cannot forge this terminal block, and stderr is never
  // considered evidence.
  const summary = /(?:^|\n)1\.\.(\d+)\r?\n# tests (\d+)\r?\n# suites \d+\r?\n# pass (\d+)\r?\n# fail (\d+)\r?\n# cancelled (\d+)\r?\n# skipped (\d+)\r?\n# todo (\d+)\r?\n# duration_ms [^\r\n]+\s*$/.exec(output);
  if (!summary) return undefined;
  const [plan, total, passed, failed, cancelled, skipped, todo] = summary.slice(1).map(Number);
  if (plan !== total) return undefined;
  return { total, passed, failed, cancelled, skipped, todo };
}

const manifestRoots = [
  "packages/control-plane/test", "packages/protocol/test", "apps/windows-companion/test",
  "apps/vscode-extension/test", "apps/provider-adapter-host/test", "scripts", "firmware"
];
const portable = (value) => value.replaceAll("\\", "/");
export function discoverRequiredTestFiles(cwd = root) {
  return manifestRoots.flatMap((relative) => {
    const directory = join(cwd, relative);
    if (!existsSync(directory)) return [];
    return readdirSync(directory, { withFileTypes: true })
      .filter((entry) => entry.isFile() && /\.test\.(?:ts|mjs)$/.test(entry.name))
      .map((entry) => portable(join(relative, entry.name)));
  }).sort();
}

export function assertRequiredTestManifest(groups = requiredGroups, discovered = discoverRequiredTestFiles()) {
  const represented = new Set(groups.filter((group) => /\.test\.(?:ts|mjs)$/.test(group.file)).map((group) => portable(group.file)));
  const expected = new Set(discovered.map(portable));
  const missing = [...expected].filter((file) => !represented.has(file));
  const stale = [...represented].filter((file) => !expected.has(file));
  if (missing.length || stale.length) {
    throw new Error(`Isolated test manifest mismatch (missing=${missing.join(",") || "none"}; stale=${stale.join(",") || "none"}).`);
  }
  return { discovered: expected.size, represented: represented.size };
}

const inheritedNames = [
  "PATH", "SystemRoot", "WINDIR", "ComSpec", "PATHEXT", "OS", "SystemDrive",
  "NUMBER_OF_PROCESSORS", "PROCESSOR_ARCHITECTURE", "PROCESSOR_IDENTIFIER",
  "ProgramFiles", "ProgramFiles(x86)", "ProgramW6432", "CommonProgramFiles",
  "CommonProgramFiles(x86)", "CommonProgramW6432", "LANG", "LC_ALL", "TZ", "TERM"
];

function inheritedValue(source, name) {
  const match = Object.keys(source).find((candidate) => candidate.toLowerCase() === name.toLowerCase());
  return match ? source[match] : undefined;
}

/** No source variable crosses the child boundary unless named here. */
export function createStrictTestEnvironment(testRoot, source = process.env, { currentUserProfile = false } = {}) {
  const environment = {};
  for (const name of inheritedNames) {
    const value = inheritedValue(source, name);
    if (value !== undefined) environment[name] = value;
  }
  const id = randomUUID().replaceAll("-", "");
  const isolatedProfile = {
    HOME: testRoot,
    USERPROFILE: testRoot,
    APPDATA: join(testRoot, "AppData", "Roaming"),
    LOCALAPPDATA: join(testRoot, "AppData", "Local")
  };
  return {
    ...environment,
    ...isolatedProfile,
    XDG_CONFIG_HOME: join(testRoot, ".config"),
    TEMP: testRoot,
    TMP: testRoot,
    TMPDIR: testRoot,
    npm_config_cache: join(testRoot, ".npm-cache"),
    npm_config_userconfig: join(testRoot, ".npmrc"),
    npm_config_globalconfig: join(testRoot, "npm-global.rc"),
    npm_config_update_notifier: "false",
    npm_config_audit: "false",
    npm_config_fund: "false",
    NODE_ENV: "test",
    SXSY_TEST_MODE: "1",
    SXSY_NETWORK: "deny",
    SXSY_TEST_ROOT: testRoot,
    SXSY_TEST_DATABASE: `sxsy_test_${id}`,
    SXSY_B122_STATE_DIR: join(testRoot, "b122-state"),
    ...(currentUserProfile ? { SXSY_CURRENT_USER_DPAPI: "1" } : {})
  };
}

/** A result is recorded only after close proves this owned child has exited. */
export async function runChild(group, { cwd = root, executable = process.execPath, timeoutMs = 45_000, cleanup = rm, sourceEnvironment = process.env } = {}) {
  const effectiveTimeoutMs = group.timeoutMs ?? timeoutMs;
  if (!Number.isSafeInteger(effectiveTimeoutMs) || effectiveTimeoutMs < 1 || effectiveTimeoutMs > 300_000) throw new Error("An isolated test timeout must be an integer between 1 and 300000 milliseconds.");
  const childExecutable = group.executable ?? executable;
  const isTestRun = !group.args;
  const args = group.args ? [...group.args] : ["--experimental-transform-types", "--test", "--test-reporter=tap"]; const pattern = group.args ? undefined : patternArgument(group.pattern); if (pattern) args.push("--test-name-pattern", pattern); if (!group.args) args.push(group.file);
  const startedAt = new Date().toISOString(); const started = Date.now();
  const testRoot = await mkdtemp(join(tmpdir(), "sxsy-isolated-child-"));
  const environment = createStrictTestEnvironment(testRoot, sourceEnvironment, { currentUserProfile: group.currentUserProfile === true });
  if (group.safeTrace === true) environment.SXSY_PROVIDER_E2E_TRACE = "1";
  await Promise.all([environment.APPDATA, environment.LOCALAPPDATA, environment.XDG_CONFIG_HOME, environment.SXSY_B122_STATE_DIR].map((directory) => mkdir(directory, { recursive: true })));
  await Promise.all([environment.npm_config_userconfig, environment.npm_config_globalconfig].map((file) => writeFile(file, "", { encoding: "utf8", mode: 0o600 })));
  return new Promise((resolveChild) => {
    const child = spawn(childExecutable, args, { cwd, env: environment, detached: process.platform !== "win32", shell: false, windowsHide: true, stdio: ["ignore", "pipe", "pipe"] });
    const chunks = []; let stdoutTail = Buffer.alloc(0), outputBytes = 0, totalOutputBytes = 0, timedOut = false, spawnError = null, terminationPromise = null;
    const outputHasher = createHash("sha256");
    const add = (chunk, isStdout) => {
      const bytes = Buffer.from(chunk); totalOutputBytes += bytes.length; outputHasher.update(bytes);
      const remaining = limit - outputBytes;
      if (remaining > 0) { const captured = bytes.subarray(0, remaining); chunks.push(captured); outputBytes += captured.length; }
      if (isStdout) {
        stdoutTail = Buffer.concat([stdoutTail, bytes]);
        if (stdoutTail.length > limit) stdoutTail = stdoutTail.subarray(stdoutTail.length - limit);
      }
    };
    child.stdout.on("data", (chunk) => add(chunk, true)); child.stderr.on("data", (chunk) => add(chunk, false));
    const timer = setTimeout(() => { timedOut = true; terminationPromise = terminateOwnedProcessTree(child, environment); }, effectiveTimeoutMs);
    child.once("error", (error) => { spawnError = error.message; });
    child.once("close", async (exitCode, signal) => {
      clearTimeout(timer);
      let result;
      try {
        let processTreeTermination;
        try {
          processTreeTermination = terminationPromise
            ? await terminationPromise
            : { strategy: "natural-exit", completed: true, supervisorExitCode: null, supervisorError: null };
        } catch {
          processTreeTermination = { strategy: "termination-error", completed: false, supervisorExitCode: null, supervisorError: "process-tree-termination-failed" };
        }
        const tapTail = stdoutTail.toString("utf8");
        const safeTrace = group.safeTrace === true
          ? [...Buffer.concat(chunks).toString("utf8").matchAll(/SXSY_PROVIDER_E2E_TRACE=([a-z0-9-]{1,64})/g)].map((match) => match[1]).slice(-32)
          : [];
        const counts = testCounts(tapTail, isTestRun);
        const zeroTestPlan = isTestRun && /^1\.\.0$/m.test(tapTail);
        const testSuccess = !isTestRun || !!counts && !zeroTestPlan && counts.total >= 1 && counts.passed === counts.total && counts.failed === 0 && counts.cancelled === 0 && counts.skipped === 0 && counts.todo === 0;
        result = { file: group.file, pattern: group.pattern ?? null, command: [childExecutable, ...args], startedAt, endedAt: new Date().toISOString(), durationMs: Date.now() - started, effectiveTimeoutMs, exitCode, signal: signal ?? null, timeout: timedOut, outputDigest: outputHasher.digest("hex"), outputBytes, totalOutputBytes, outputLimitBytes: limit, outputTruncated: totalOutputBytes > outputBytes, zeroTestPlan, environmentPolicy: "strict-test-v2", safeTrace, processTreeTermination, testCounts: counts, spawnError, cleanupCompleted: false, cleanupError: null, success: !timedOut && !spawnError && processTreeTermination.completed && exitCode === 0 && testSuccess };
      } catch {
        result = { file: group.file, pattern: group.pattern ?? null, command: [childExecutable, ...args], startedAt, endedAt: new Date().toISOString(), durationMs: Date.now() - started, effectiveTimeoutMs, exitCode, signal: signal ?? null, timeout: timedOut, outputDigest: "unavailable", outputBytes, totalOutputBytes, outputLimitBytes: limit, outputTruncated: totalOutputBytes > outputBytes, zeroTestPlan: false, environmentPolicy: "strict-test-v2", safeTrace: [], processTreeTermination: { strategy: "receipt-error", completed: false, supervisorExitCode: null, supervisorError: "child-receipt-failed" }, testCounts: undefined, spawnError, cleanupCompleted: false, cleanupError: null, success: false };
      } finally {
        try {
          await cleanupIsolatedRoot(cleanup, testRoot);
          result.cleanupCompleted = true;
        } catch {
          result.cleanupError = "isolated-test-root-cleanup-failed";
          result.success = false;
        }
        resolveChild(result);
      }
    });
  });
}

async function cleanupIsolatedRoot(cleanup, testRoot) {
  const canonicalRoot = resolve(testRoot);
  const canonicalTemp = resolve(tmpdir());
  if (canonicalRoot === canonicalTemp || dirname(canonicalRoot) !== canonicalTemp || !canonicalRoot.startsWith(join(canonicalTemp, "sxsy-isolated-child-"))) {
    throw new Error("Refusing to clean a non-isolated test root.");
  }
  let failure;
  for (let attempt = 0; attempt < 6; attempt += 1) {
    try { await cleanup(canonicalRoot, { recursive: true, force: true }); return; }
    catch (error) { failure = error; }
    await new Promise((done) => setTimeout(done, 25 * 2 ** attempt));
  }
  throw failure;
}

async function writeReceipt(directory, receipt) { await mkdir(directory, { recursive: true }); const finalPath = join(directory, `isolated-test-${receipt.runId}.json`); const temporaryPath = `${finalPath}.${randomUUID()}.tmp`; try { await writeFile(temporaryPath, JSON.stringify(receipt, null, 2), { encoding: "utf8", mode: 0o600 }); await rename(temporaryPath, finalPath); return finalPath; } finally { await rm(temporaryPath, { force: true }).catch(() => {}); } }
export async function runVerification({ groups = requiredGroups, cwd = root, outputDirectory = receiptDirectory, executable = process.execPath, timeoutMs, cleanup, sourceEnvironment, receiptWriter = writeReceipt } = {}) {
  if (groups === requiredGroups) assertRequiredTestManifest(groups);
  const runId = randomUUID(); const startedAt = new Date().toISOString(); const children = []; for (const group of groups) children.push(await runChild(group, { cwd, executable, timeoutMs, cleanup, sourceEnvironment }));
  const passed = children.filter((item) => item.success).length;
  const tests = children.reduce((total, child) => total + (child.testCounts?.total ?? 0), 0);
  const passedTests = children.reduce((total, child) => total + (child.testCounts?.passed ?? 0), 0);
  const failedTests = children.reduce((total, child) => total + (child.testCounts?.failed ?? 0), 0);
  const skippedTests = children.reduce((total, child) => total + (child.testCounts?.skipped ?? 0), 0);
  const cancelledTests = children.reduce((total, child) => total + (child.testCounts?.cancelled ?? 0), 0);
  const todoTests = children.reduce((total, child) => total + (child.testCounts?.todo ?? 0), 0);
  const receipt = { version: 1, runId, startedAt, endedAt: new Date().toISOString(), requiredGroups: groups, children, totals: { required: groups.length, passed, failed: groups.length - passed, tests, passedTests, failedTests, skippedTests, cancelledTests, todoTests }, receiptWrite: { completed: true, error: null }, success: passed === groups.length };
  try { return { receipt, receiptPath: await receiptWriter(outputDirectory, receipt) }; }
  catch { receipt.receiptWrite = { completed: false, error: "atomic-receipt-write-failed" }; receipt.success = false; return { receipt, receiptPath: null }; }
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) { const { receipt, receiptPath } = await runVerification(); for (const child of receipt.children) process.stdout.write(`${child.success ? "PASS" : "FAIL"} ${child.file}${child.pattern ? ` :: ${child.pattern}` : ""}\n`); process.stdout.write(`${receiptPath ? "RECEIPT" : "RECEIPT_WRITE_FAILED"} ${receipt.runId}${receiptPath ? ` ${receiptPath}` : ""}\n`); process.exitCode = receipt.success ? 0 : 1; }
