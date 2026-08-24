import { createHash, randomUUID } from "node:crypto";
import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
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
  "authenticated-pipe", "bootstrap", "configured-network", "control-plane",
  "council-runtime", "council-workspace-isolation", "durable-credentials",
  "durable-endpoint", "git-review", "hardware-signal-queue",
  "hardware-signal-service", "host-actions", "host-provisioning",
  "instance-lifecycle", "local-checkpoints", "local-runtime", "operation-control",
  "operation-recovery", "packaged-runtime", "pipeline-adapters",
  "provider-desktop", "raw-hid-installation", "raw-hid-main-wiring",
  "raw-hid-protocol", "receipt-evidence", "remote-adapters", "remote-git",
  "repository-process-supervisor", "repository-recipe-evidence",
  "repository-recipe-host-evidence", "repository-runner-helper",
  "repository-runtime", "repository-runtime-broker",
  "repository-runtime-release-package", "router", "runtime-provisioning",
  "runtime-registry", "sandbox-installation", "service", "session-freshness", "stdio",
  "windows-job-supervisor", "windows-provider-process", "windows-sandbox",
  "windows-user-presence", "workflow-voice-service"
].map((name) => ({ file: `apps/windows-companion/test/${name}.test.ts`, currentUserProfile: name === "packaged-runtime" }));
const mediatedGitTests = [
  "mediated local commit uses an exact task-owned private index and reconciles the shared index to its committed tree",
  "default-branch review creates a hook-disabled feature branch and requires a fresh target before committing",
  "mediated local commit rejects unowned paths, a dirty shared index, containment, and a final target change"
].map((pattern) => ({ file: "apps/windows-companion/test/mediated-git.test.ts", pattern }));
const extensionTests = ["commands", "companion-bridge", "controller", "named-pipe-transport"]
  .map((name) => ({ file: `apps/vscode-extension/test/${name}.test.ts` }));
export const requiredGroups = [
  { file: "build:companion", args: [npmCli, "run", "build:companion"] },
  ...(process.platform === "win32" ? [{
    file: "deployment/windows/Test-B122ManifestGenerators.ps1",
    executable: "C:\\Windows\\System32\\WindowsPowerShell\\v1.0\\powershell.exe",
    args: ["-NoLogo", "-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass", "-File", "deployment/windows/Test-B122ManifestGenerators.ps1"]
  }, {
    file: "deployment/windows/Test-B122InstallLifecycle.ps1",
    executable: "C:\\Windows\\System32\\WindowsPowerShell\\v1.0\\powershell.exe",
    args: ["-NoLogo", "-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass", "-File", "deployment/windows/Test-B122InstallLifecycle.ps1"]
  }] : []),
  { file: "packages/protocol/test/b122.test.ts" },
  { file: "packages/protocol/test/raw-hid.test.ts" },
  ...controlPlaneTests,
  ...companionTests,
  ...mediatedGitTests,
  ...extensionTests
];
const limit = 64 * 1024;
const digest = (value) => createHash("sha256").update(value).digest("hex");
const patternArgument = (pattern) => pattern ? `^${pattern.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}$` : undefined;
const numeric = (pattern, output) => Number(pattern.exec(output)?.[1] ?? 0);
function testCounts(output, isTestRun) {
  if (!isTestRun) return undefined;
  // TAP finishes with stable counts before the child exits, so bounded capture
  // still contains exact file-level test totals.
  return { total: numeric(/^# tests (\d+)$/m, output), passed: numeric(/^# pass (\d+)$/m, output), failed: numeric(/^# fail (\d+)$/m, output) };
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
  const currentProfile = Object.fromEntries(["HOME", "USERPROFILE", "APPDATA", "LOCALAPPDATA", "HOMEDRIVE", "HOMEPATH"]
    .flatMap((name) => inheritedValue(source, name) === undefined ? [] : [[name, inheritedValue(source, name)]]));
  return {
    ...environment,
    ...(currentUserProfile ? currentProfile : isolatedProfile),
    XDG_CONFIG_HOME: join(testRoot, ".config"),
    TEMP: testRoot,
    TMP: testRoot,
    TMPDIR: testRoot,
    npm_config_cache: join(testRoot, ".npm-cache"),
    npm_config_update_notifier: "false",
    npm_config_audit: "false",
    npm_config_fund: "false",
    NODE_ENV: "test",
    SXSY_TEST_MODE: "1",
    SXSY_NETWORK: "deny",
    SXSY_TEST_ROOT: testRoot,
    SXSY_TEST_DATABASE: `sxsy_test_${id}`,
    SXSY_B122_STATE_DIR: join(testRoot, "b122-state")
  };
}

/** A result is recorded only after close proves this owned child has exited. */
export async function runChild(group, { cwd = root, executable = process.execPath, timeoutMs = 45_000 } = {}) {
  const childExecutable = group.executable ?? executable;
  const isTestRun = !group.args;
  const args = group.args ? [...group.args] : ["--experimental-transform-types", "--test", "--test-reporter=tap"]; const pattern = group.args ? undefined : patternArgument(group.pattern); if (pattern) args.push("--test-name-pattern", pattern); if (!group.args) args.push(group.file);
  const startedAt = new Date().toISOString(); const started = Date.now();
  const testRoot = await mkdtemp(join(tmpdir(), "sxsy-isolated-child-"));
  const environment = createStrictTestEnvironment(testRoot, process.env, { currentUserProfile: group.currentUserProfile === true });
  await Promise.all([environment.APPDATA, environment.LOCALAPPDATA, environment.XDG_CONFIG_HOME, environment.SXSY_B122_STATE_DIR].map((directory) => mkdir(directory, { recursive: true })));
  return new Promise((resolveChild) => {
    const child = spawn(childExecutable, args, { cwd, env: environment, detached: process.platform !== "win32", shell: false, windowsHide: true, stdio: ["ignore", "pipe", "pipe"] });
    const chunks = []; let outputBytes = 0, timedOut = false, spawnError = null, terminationPromise = null;
    const add = (chunk) => { const bytes = Buffer.from(chunk); const remaining = limit - outputBytes; if (remaining > 0) { const captured = bytes.subarray(0, remaining); chunks.push(captured); outputBytes += captured.length; } };
    child.stdout.on("data", add); child.stderr.on("data", add);
    const timer = setTimeout(() => { timedOut = true; terminationPromise = terminateOwnedProcessTree(child, environment); }, timeoutMs);
    child.once("error", (error) => { spawnError = error.message; });
    child.once("close", async (exitCode, signal) => {
      clearTimeout(timer);
      const processTreeTermination = terminationPromise
        ? await terminationPromise
        : { strategy: "natural-exit", completed: true, supervisorExitCode: null, supervisorError: null };
      const output = Buffer.concat(chunks).toString("utf8");
      const result = { file: group.file, pattern: group.pattern ?? null, command: [childExecutable, ...args], startedAt, endedAt: new Date().toISOString(), durationMs: Date.now() - started, exitCode, signal: signal ?? null, timeout: timedOut, outputDigest: digest(output), outputBytes, outputLimitBytes: limit, environmentPolicy: "strict-test-v1", processTreeTermination, testCounts: testCounts(output, isTestRun), spawnError, success: !timedOut && !spawnError && processTreeTermination.completed && exitCode === 0 };
      await rm(testRoot, { recursive: true, force: true });
      resolveChild(result);
    });
  });
}

async function writeReceipt(directory, receipt) { await mkdir(directory, { recursive: true }); const finalPath = join(directory, `isolated-test-${receipt.runId}.json`); const temporaryPath = `${finalPath}.${randomUUID()}.tmp`; await writeFile(temporaryPath, JSON.stringify(receipt, null, 2), { encoding: "utf8", mode: 0o600 }); await rename(temporaryPath, finalPath); return finalPath; }
export async function runVerification({ groups = requiredGroups, cwd = root, outputDirectory = receiptDirectory, executable = process.execPath, timeoutMs } = {}) {
  const runId = randomUUID(); const startedAt = new Date().toISOString(); const children = []; for (const group of groups) children.push(await runChild(group, { cwd, executable, timeoutMs }));
  const passed = children.filter((item) => item.success).length;
  const tests = children.reduce((total, child) => total + (child.testCounts?.total ?? 0), 0);
  const passedTests = children.reduce((total, child) => total + (child.testCounts?.passed ?? 0), 0);
  const failedTests = children.reduce((total, child) => total + (child.testCounts?.failed ?? 0), 0);
  const receipt = { version: 1, runId, startedAt, endedAt: new Date().toISOString(), requiredGroups: groups, children, totals: { required: groups.length, passed, failed: groups.length - passed, tests, passedTests, failedTests }, success: passed === groups.length };
  return { receipt, receiptPath: await writeReceipt(outputDirectory, receipt) };
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) { const { receipt, receiptPath } = await runVerification(); for (const child of receipt.children) process.stdout.write(`${child.success ? "PASS" : "FAIL"} ${child.file}${child.pattern ? ` :: ${child.pattern}` : ""}\n`); process.stdout.write(`RECEIPT ${receipt.runId} ${receiptPath}\n`); process.exitCode = receipt.success ? 0 : 1; }
