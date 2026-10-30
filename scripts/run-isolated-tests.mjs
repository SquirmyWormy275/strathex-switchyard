import { createHash, randomUUID } from "node:crypto";
import { spawn } from "node:child_process";
import { existsSync, readdirSync } from "node:fs";
import { mkdir, mkdtemp, realpath, rename, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";
import { dirname, isAbsolute, join, resolve } from "node:path";
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
  "acceptance-evidence", "adapters", "automation-operation-manifest", "automation-proposal-protocol", "automation-protocol", "brokers", "budgets", "checkpoints",
  "child-saga-recovery", "command-catalog", "confirmations", "containment",
  "containment-incidents", "context-council", "dispatch", "durable-containment", "git-inspector",
  "host-path", "policy", "reanchor", "recipes", "redaction", "runtime", "session-authority",
  "snapshot-ledger", "snapshot-operations", "snapshot-resolver", "store-receipts",
  "voice", "workflow-artifacts"
].map((name) => ({ file: `packages/control-plane/test/${name}.test.ts` }));
const companionTests = [
  "acceptance-administration", "atomic-python-venv", "authenticated-pipe", "automation-child-effects", "automation-effect-executor", "automation-high-consequence", "automation-installed-runtime", "automation-manifest-coordinator", "automation-manifest-review", "automation-proposal-source", "automation-refresh-git", "bootstrap", "companion-lifecycle-helper", "configured-network", "configured-voice-provider", "containment-assessment", "containment-history-remediation", "containment-release", "containment-remote-evidence", "containment-remote-evaluator", "containment-remote-host", "control-plane",
  "configured-provider-host", "council-epoch-lifecycle", "council-resource-broker", "council-runtime", "council-workspace-isolation", "default-composition-handoff", "durable-credentials", "installed-automation-e2e", "main-shutdown",
  "debug-stop", "direct-request-cancellation", "durable-endpoint", "effect-target-transition", "git-review", "hardware-signal-dispatcher", "hardware-signal-queue",
  "hardware-signal-service", "host-actions", "host-provisioning", "github-navigation",
  "instance-lifecycle", "local-automation-broker", "local-checkpoints", "local-runtime", "operation-control",
  "operation-recovery", "packaged-runtime", "pipeline-adapters", "pipeline-local-receipts", "reanchor-bootstrap", "reanchor-runtime", "reanchor-service",
  "provider-desktop", "provider-desktop-adapter", "provider-desktop-configuration", "provider-desktop-effects", "provider-dispatch-lease", "provider-gateway", "provider-host-dispatch-provisioning", "provider-mediated-final-current", "provider-mediated-final-current-service", "raw-hid-installation", "raw-hid-main-wiring", "raw-hid-simulator",
  "raw-hid-protocol", "receipt-evidence", "remote-adapters", "remote-git",
  "repository-process-supervisor", "repository-recipe-evidence",
  "repository-recipe-host-evidence", "repository-runner-helper",
  "repository-runtime", "repository-runtime-broker", "scanner-fixtures",
  "repository-runtime-release-package", "router", "runtime-provisioning",
  "runtime-registry", "sandbox-installation", "sandbox-lifecycle-helper", "service", "session-freshness", "stdio",
  "voice-gateway", "voice-helper-source", "voice-runtime", "windows-job-supervisor", "windows-provider-process", "windows-sandbox",
  "windows-host-action-consumer", "windows-host-action-effects", "windows-host-action-startup", "windows-sandbox-helper-contract", "windows-user-presence", "windows-voice-port", "windows-voice-transcript-vault", "workflow-context-preparation", "workflow-voice-service"
].map((name) => ({
  file: `apps/windows-companion/test/${name}.test.ts`,
  currentUserProfile: name === "packaged-runtime",
    ...(name === "authenticated-pipe" ? { expectedSkipped: process.platform === "win32" ? 2 : 5 } : {}),
  ...(name === "packaged-runtime" && process.platform !== "win32" ? { expectedSkipped: 1 } : {}),
  ...(["authenticated-pipe", "companion-lifecycle-helper"].includes(name) ? { timeoutMs: 240_000 } : {}),
  ...(["council-workspace-isolation", "installed-automation-e2e", "repository-runner-helper"].includes(name) ? { timeoutMs: 240_000 } : {})
}));
const mediatedGitTests = [
  "mediated local commit uses an exact task-owned private index and reconciles the shared index to its committed tree",
  "default-branch review creates a hook-disabled feature branch and requires a fresh target before committing",
  "detached-HEAD review creates an exact feature branch before any commit and requires a fresh target",
  "mediated local commit rejects unowned paths, a dirty shared index, containment, and a final target change"
].map((pattern) => ({ file: "apps/windows-companion/test/mediated-git.test.ts", pattern }));
const extensionTests = ["commands", "companion-bridge", "controller", "named-pipe-transport", "operator-status"]
  .map((name) => ({
    file: `apps/vscode-extension/test/${name}.test.ts`,
    ...(name === "controller" && process.platform !== "linux" ? { expectedSkipped: 1 } : {}),
    ...(name === "named-pipe-transport" ? { timeoutMs: 120_000, expectedSkipped: process.platform === "win32" ? 1 : 7 } : {})
  }));
const providerHostTests = ["backends", "config", "council-resources", "dispatch-lease", "linux-path-security", "main", "reanchor", "redaction", "release", "server", "service", "workflow-context"]
  .map((name) => ({
    file: `apps/provider-adapter-host/test/${name}.test.ts`,
    ...(name === "linux-path-security" && process.platform !== "linux" ? { expectedSkipped: 1 } : {})
  }));
const providerTlsNetworkTests = [
  "provider secret generation validates and Initialize emits its exact ready-to-provision receipt",
  "packaged provider host lifecycle and the production pinned network broker interoperate over exact loopback TLS"
].map((pattern) => ({
  file: "apps/provider-adapter-host/test/tls-network-e2e.test.ts",
  pattern,
  currentUserProfile: true,
  safeTrace: true,
  timeoutMs: 300_000,
  expectedSkipped: process.platform === "win32" ? 0 : 1
}));
const linuxSkippedOnNonLinux = new Map([
  ["linux-isolation", 1],
  ["linux-lifecycle", 2],
  ["linux-user-presence", 2],
  ["linux-process-supervisor", 3],
  ["linux-repository-runtime", 3]
]);
const linuxCompanionTests = ["linux-secret", "linux-isolation", "linux-lifecycle", "linux-user-presence", "linux-pipewire-audio", "linux-hidraw", "linux-process-supervisor", "linux-repository-runtime", "omarchy-capabilities", "omarchy-identity", "omarchy-host-action", "omarchy-host-action-consumer"]
  .map((name) => ({
    file: `apps/linux-companion/test/${name}.test.ts`,
    ...(process.platform !== "linux" && linuxSkippedOnNonLinux.has(name) ? { expectedSkipped: linuxSkippedOnNonLinux.get(name) } : {})
  }));
export function nativeTestOverrides(file, platform = process.platform) {
  const protectedNativeGroups = ["claude-coding", "agents-claude", "conversation-bindings", "codex-submissions", "claude-submissions"].map((name) => `tools/layout-studio/${name}.test.mjs`);
  return platform === "win32" && protectedNativeGroups.includes(file) ? { timeoutMs: 120_000 } : {};
}
export const requiredGroups = [
  { file: "scripts/run-isolated-tests.test.mjs" },
  { file: "scripts/verify-runtime-platform.test.mjs" },
  { file: "deployment/suite/release.test.mjs" },
  { file: "deployment/suite/application.test.mjs" },
  { file: "deployment/suite/runtime-maintenance.test.mjs" },
  { file: "deployment/suite/connection-restoration.test.mjs" },
  { file: "deployment/suite/installation.test.mjs", timeoutMs: 120_000 },
  { file: "scripts/install-workflow-shortcut.test.mjs", ...(process.platform !== "linux" ? { expectedSkipped: 2 } : {}) },
  { file: "scripts/workflow-capture.test.mjs" },
  { file: "scripts/codex-thread-status.test.mjs" },
  { file: "scripts/codex-daemon-status.test.mjs", ...(process.platform === "win32" ? { expectedSkipped: 2 } : {}) },
  { file: "tools/layout-studio/model.test.mjs" },
  { file: "tools/layout-studio/catalog.test.mjs" },
  { file: "tools/layout-studio/catalog-identity.test.mjs" },
  { file: "tools/layout-studio/readout-profiles.test.mjs" },
  { file: "tools/layout-studio/configuration.test.mjs", ...(process.platform !== "linux" ? { expectedSkipped: 1 } : {}) },
  { file: "tools/layout-studio/suite.test.mjs" },
  { file: "tools/layout-studio/devices.test.mjs" },
  { file: "tools/layout-studio/vial-dynamic.test.mjs" },
  { file: "tools/layout-studio/vial-encoders.test.mjs" },
  { file: "tools/layout-studio/vial-rules.test.mjs" },
  { file: "tools/layout-studio/integrations.test.mjs" },
  { file: "tools/layout-studio/physical-intent.test.mjs" },
  { file: "tools/layout-studio/instance.test.mjs" },
  { file: "tools/layout-studio/foreground.test.mjs" },
  { file: "tools/layout-studio/keyboard-indicators.test.mjs" },
  { file: "tools/layout-studio/portable-package.test.mjs" },
  { file: "tools/layout-studio/legend-export.test.mjs" },
  { file: "tools/layout-studio/windows-host.test.mjs" },
  { file: "tools/layout-studio/state-lock.test.mjs", ...(process.platform !== "linux" ? { expectedSkipped: 1 } : {}) },
  { file: "tools/layout-studio/runtime.test.mjs", ...(process.platform === "win32" ? { expectedSkipped: 1 } : {}) },
  // The separate native CI helper step executes all fourteen boundary cases.
  // Source-only Windows groups have no built helper and must skip exactly these.
  { file: "tools/layout-studio/runtime-command.test.mjs", ...(process.platform === "win32" ? { expectedSkipped: 14 } : {}) },
  { file: "tools/layout-studio/runtime-lifecycle.test.mjs" },
  { file: "tools/layout-studio/runtime-consumers.test.mjs" },
  { file: "tools/layout-studio/private-fs.test.mjs" },
  { file: "tools/layout-studio/coding-sessions.test.mjs" },
  { file: "tools/layout-studio/codex-stdio-tasks.test.mjs" },
  { file: "tools/layout-studio/codex-turn.test.mjs" },
  // Protected Windows fault matrices each start many short native lock helpers.
  // Keep their cold-process allowance bounded without relaxing assertions/skips.
  { file: "tools/layout-studio/agents-claude.test.mjs", ...nativeTestOverrides("tools/layout-studio/agents-claude.test.mjs") },
  { file: "tools/layout-studio/conversation-bindings.test.mjs", ...nativeTestOverrides("tools/layout-studio/conversation-bindings.test.mjs") },
  { file: "tools/layout-studio/codex-submissions.test.mjs", ...nativeTestOverrides("tools/layout-studio/codex-submissions.test.mjs") },
  { file: "tools/layout-studio/claude-submissions.test.mjs", ...nativeTestOverrides("tools/layout-studio/claude-submissions.test.mjs") },
  // Native Windows kernel leases start the system PowerShell helper per state
  // transaction. Nine exact-task scenarios passed in 44.99 s on a cold runner;
  // allow bounded process/pipe cleanup without relaxing any assertion or skip.
  { file: "tools/layout-studio/claude-coding.test.mjs", ...nativeTestOverrides("tools/layout-studio/claude-coding.test.mjs") },
  { file: "tools/layout-studio/task-window.test.mjs" },
  { file: "tools/layout-studio/voice-queue.test.mjs" },
  { file: "tools/layout-studio/owned-process.test.mjs", ...(process.platform !== "linux" ? { expectedSkipped: 1 } : {}) },
  { file: "scripts/b122-commissioning.test.mjs" },
  { file: "scripts/run-b122-prehardware-drill.test.mjs" },
  { file: "scripts/b122-acceptance-evidence.test.mjs" },
  { file: "scripts/b122-scanner-fixture.test.mjs" },
  { file: "firmware/verify-require-compiler.test.mjs" },
  { file: "build:companion", args: [npmCli, "run", "build:companion"] },
  { file: "build:linux-companion", args: [npmCli, "run", "build:linux-companion"] },
  { file: "build:provider-host", args: [npmCli, "run", "build:provider-host"] },
  { file: "build:vscode", args: [npmCli, "run", "build:vscode"] },
  ...(process.platform === "win32" ? [{
    file: "deployment/windows/Test-B122ManifestGenerators.ps1",
    executable: "C:\\Windows\\System32\\WindowsPowerShell\\v1.0\\powershell.exe",
    args: ["-NoLogo", "-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass", "-File", "deployment/windows/Test-B122ManifestGenerators.ps1"],
    timeoutMs: 180_000
  }, {
    file: "deployment/windows/Test-B122InstallLifecycle.ps1",
    executable: "C:\\Windows\\System32\\WindowsPowerShell\\v1.0\\powershell.exe",
    args: ["-NoLogo", "-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass", "-File", "deployment/windows/Test-B122InstallLifecycle.ps1"],
    timeoutMs: 240_000
  }, {
    file: "deployment/windows/Test-B122TrustedBootstrap.ps1#powershell5",
    executable: "C:\\Windows\\System32\\WindowsPowerShell\\v1.0\\powershell.exe",
    args: ["-NoLogo", "-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass", "-File", "deployment/windows/Test-B122TrustedBootstrap.ps1"],
    timeoutMs: 300_000
  }, {
    file: "deployment/windows/Test-B122TrustedBootstrap.ps1#pwsh",
    executable: "pwsh.exe",
    args: ["-NoLogo", "-NoProfile", "-NonInteractive", "-File", "deployment/windows/Test-B122TrustedBootstrap.ps1"],
    timeoutMs: 300_000
  }, {
    file: "deployment/windows/Test-B122ProviderDesktopRelease.ps1",
    executable: "C:\\Windows\\System32\\WindowsPowerShell\\v1.0\\powershell.exe",
    args: ["-NoLogo", "-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass", "-File", "deployment/windows/Test-B122ProviderDesktopRelease.ps1"],
    timeoutMs: 300_000,
    safeTrace: true
  }] : []),
  { file: "packages/protocol/test/b122.test.ts" },
  { file: "packages/protocol/test/raw-hid.test.ts" },
  ...controlPlaneTests,
  ...companionTests,
  ...mediatedGitTests,
  ...extensionTests,
  ...linuxCompanionTests,
  ...providerHostTests,
  ...providerTlsNetworkTests
];
/** The native Linux source lane omits Windows-only runtime contracts. */
export const linuxGroups = requiredGroups
  .filter((group) => !group.file.startsWith("apps/windows-companion/") && !group.file.startsWith("deployment/windows/"));
const limit = 64 * 1024;
const diagnosticLimit = 4096;
function failureDiagnostic(chunks) {
  return Buffer.concat(chunks).toString("utf8").slice(-diagnosticLimit)
    .replace(/[A-Za-z0-9+\/_=-]{32,}/g, "[redacted]")
    .replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, "?");
}
const patternArgument = (pattern) => pattern ? `^${pattern.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}$` : undefined;
function testCounts(output, isTestRun) {
  if (!isTestRun) return undefined;
  // Accept only Node's final, contiguous TAP summary. Test output appearing
  // earlier in stdout cannot forge this terminal block, and stderr is never
  // considered evidence.
  const summary = /(?:^|\n)1\.\.(\d+)\r?\n# tests (\d+)\r?\n# suites \d+\r?\n# pass (\d+)\r?\n# fail (\d+)\r?\n# cancelled (\d+)\r?\n# skipped (\d+)\r?\n# todo (\d+)\r?\n# duration_ms [^\r\n]+\s*$/.exec(output);
  if (!summary) return undefined;
  const [plan, total, passed, failed, cancelled, skipped, todo] = summary.slice(1).map(Number);
  // Node's final `# tests` count includes nested subtests while the terminal
  // plan counts only top-level tests. Require a non-empty, internally
  // possible relationship without rejecting valid nested TAP.
  if (plan < 1 || total < plan) return undefined;
  return { total, passed, failed, cancelled, skipped, todo };
}

const manifestRoots = [
  "packages/control-plane/test", "packages/protocol/test", "apps/windows-companion/test",
  "apps/vscode-extension/test", "apps/provider-adapter-host/test", "apps/linux-companion/test", "tools/layout-studio", "scripts", "firmware", "deployment/suite"
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
  "ProgramData", "ProgramFiles", "ProgramFiles(x86)", "ProgramW6432", "CommonProgramFiles",
  "CommonProgramFiles(x86)", "CommonProgramW6432", "LANG", "LC_ALL", "TZ", "TERM",
  "DOTNET_ROOT", "NUGET_PACKAGES", "SXSY_B122_NUGET_CONFIG", "SXSY_B122_NUGET_FEED"
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
    XDG_STATE_HOME: join(testRoot, ".local", "state"),
    XDG_RUNTIME_DIR: join(testRoot, ".runtime"),
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
  const expectedSkipped = group.expectedSkipped ?? 0;
  if (!Number.isSafeInteger(expectedSkipped) || expectedSkipped < 0) throw new Error("An isolated test expectedSkipped value must be a non-negative integer.");
  const childExecutable = group.executable ?? executable;
  const isTestRun = !group.args;
  const args = group.args ? [...group.args] : ["--experimental-transform-types", "--test", "--test-reporter=tap"]; const pattern = group.args ? undefined : patternArgument(group.pattern); if (pattern) args.push("--test-name-pattern", pattern); if (!group.args) args.push(group.file);
  const startedAt = new Date().toISOString(); const started = Date.now();
  const configuredTestParent = inheritedValue(sourceEnvironment, "SXSY_B122_TEST_TEMP_ROOT");
  if (configuredTestParent !== undefined && (!isAbsolute(configuredTestParent) || /[\0\r\n"]/u.test(configuredTestParent))) throw new Error("The isolated test parent is invalid.");
  const requestedParent = configuredTestParent ?? tmpdir();
  await mkdir(requestedParent, { recursive: true });
  // Release builds use a short SUBST drive on Windows. Keep private test state
  // on the actual local drive; private storage deliberately rejects drive
  // redirection rather than treating that temporary build alias as authority.
  const testParent = await realpath(requestedParent);
  const testRoot = await mkdtemp(join(testParent, "i-"));
  const environment = createStrictTestEnvironment(testRoot, sourceEnvironment, { currentUserProfile: group.currentUserProfile === true });
  if (group.safeTrace === true) environment.SXSY_PROVIDER_E2E_TRACE = "1";
  await Promise.all([environment.APPDATA, environment.LOCALAPPDATA, environment.XDG_CONFIG_HOME, environment.XDG_STATE_HOME, environment.XDG_RUNTIME_DIR, environment.SXSY_B122_STATE_DIR].map((directory) => mkdir(directory, { recursive: true, mode: 0o700 })));
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
        const testSuccess = !isTestRun || !!counts && !zeroTestPlan && counts.total >= 1 && counts.passed + counts.skipped === counts.total && counts.failed === 0 && counts.cancelled === 0 && counts.skipped === expectedSkipped && counts.todo === 0;
        const success = !timedOut && !spawnError && processTreeTermination.completed && exitCode === 0 && testSuccess;
        result = { file: group.file, pattern: group.pattern ?? null, command: [childExecutable, ...args], startedAt, endedAt: new Date().toISOString(), durationMs: Date.now() - started, effectiveTimeoutMs, exitCode, signal: signal ?? null, timeout: timedOut, outputDigest: outputHasher.digest("hex"), outputBytes, totalOutputBytes, outputLimitBytes: limit, outputTruncated: totalOutputBytes > outputBytes, zeroTestPlan, environmentPolicy: "strict-test-v3", safeTrace, processTreeTermination, testCounts: counts, failureDiagnostic: success ? null : failureDiagnostic(chunks), spawnError, cleanupCompleted: false, cleanupError: null, success };
      } catch {
        result = { file: group.file, pattern: group.pattern ?? null, command: [childExecutable, ...args], startedAt, endedAt: new Date().toISOString(), durationMs: Date.now() - started, effectiveTimeoutMs, exitCode, signal: signal ?? null, timeout: timedOut, outputDigest: "unavailable", outputBytes, totalOutputBytes, outputLimitBytes: limit, outputTruncated: totalOutputBytes > outputBytes, zeroTestPlan: false, environmentPolicy: "strict-test-v3", safeTrace: [], processTreeTermination: { strategy: "receipt-error", completed: false, supervisorExitCode: null, supervisorError: "child-receipt-failed" }, testCounts: undefined, spawnError, cleanupCompleted: false, cleanupError: null, success: false };
      } finally {
        try {
          await cleanupIsolatedRoot(cleanup, testRoot, testParent);
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

async function cleanupIsolatedRoot(cleanup, testRoot, testParent) {
  const canonicalRoot = resolve(testRoot);
  const canonicalParent = resolve(testParent);
  if (canonicalRoot === canonicalParent || dirname(canonicalRoot) !== canonicalParent || !canonicalRoot.startsWith(join(canonicalParent, "i-"))) {
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
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) { const { receipt, receiptPath } = await runVerification(); for (const child of receipt.children) { process.stdout.write(`${child.success ? "PASS" : "FAIL"} ${child.file}${child.pattern ? ` :: ${child.pattern}` : ""}\n`); if (!child.success) process.stdout.write(`FAIL_DETAIL ${JSON.stringify({ file: child.file, pattern: child.pattern, exitCode: child.exitCode, signal: child.signal, timeout: child.timeout, spawnError: child.spawnError, cleanupCompleted: child.cleanupCompleted, cleanupError: child.cleanupError, processTreeTermination: child.processTreeTermination, testCounts: child.testCounts ?? null, safeTrace: child.safeTrace, diagnostic: child.failureDiagnostic })}\n`); } process.stdout.write(`${receiptPath ? "RECEIPT" : "RECEIPT_WRITE_FAILED"} ${receipt.runId}${receiptPath ? ` ${receiptPath}` : ""}\n`); process.exitCode = receipt.success ? 0 : 1; }
