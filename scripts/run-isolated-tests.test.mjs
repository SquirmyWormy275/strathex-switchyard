import { selectWindowsPolicyContractGroups } from "./windows-scenario-groups.mjs";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import assert from "node:assert/strict";
import test from "node:test";
import { mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { assertRequiredTestManifest, createStrictTestEnvironment, linuxGroups, requiredGroups, runVerification, nativeTestOverrides, effectiveGroupTimeout } from "./run-isolated-tests.mjs";
const executable = process.execPath;
async function group(directory, name, code) { const file = join(directory, `${name}.test.mjs`); await writeFile(file, code, "utf8"); return { file }; }
async function verify(groups, outputDirectory, timeoutMs = 1_000) { return runVerification({ groups, outputDirectory, timeoutMs, executable: process.execPath }); }

test("progress identifies the active exact group without exposing child output or accepting incomplete verification", async () => {
  const directory = await mkdtemp(join(tmpdir(), "sxsy-progress-")), events = [];
  try {
    const passed = await group(directory, "pass", "import test from 'node:test';console.log('PRIVATE_CHILD_OUTPUT');test('pass',()=>{});");
    const failed = await group(directory, "fail", "import test from 'node:test';test('fail',()=>{throw Error('PRIVATE_CHILD_FAILURE')});");
    const result = await runVerification({ groups: [passed, failed], outputDirectory: directory, executable, onProgress: event => { assert.equal(Object.isFrozen(event), true); events.push(event); } });
    assert.deepEqual(events.map(e => [e.phase, e.group, e.file]), [["started", 1, passed.file], ["exited", 1, passed.file], ["started", 2, failed.file], ["exited", 2, failed.file]]);
    assert.equal(events.every(e => e.verificationComplete === false && e.requiredGroups === 2 && e.runId === result.receipt.runId), true);
    assert.equal(events[1].groupAccepted, true); assert.equal(events[3].groupAccepted, false);
    assert.equal(JSON.stringify(events).includes("PRIVATE_CHILD"), false);
    assert.equal(result.receipt.success, false); assert.equal(result.receipt.progressWrite.completed, true);
    assert.equal(result.receipt.children.every(c => c.cleanupCompleted && c.processTreeTermination.completed), true);
  } finally { await rm(directory, { recursive: true, force: true }); }
});

test("a failing progress reporter preserves final child receipts and cleanup but cannot yield accepted verification", async () => {
  const directory = await mkdtemp(join(tmpdir(), "sxsy-progress-fault-"));
  try {
    const passed = await group(directory, "pass", "import test from 'node:test';test('pass',()=>{});");
    const result = await runVerification({ groups: [passed], outputDirectory: directory, executable, onProgress: async () => { throw Error("PRIVATE_REPORTER_FAILURE"); } });
    assert.equal(result.receipt.children[0].success, true); assert.equal(result.receipt.children[0].cleanupCompleted, true);
    assert.equal(result.receipt.totals.passedTests, 1); assert.equal(result.receipt.success, false);
    assert.deepEqual(result.receipt.progressWrite, { completed: false, error: "progress-reporter-failed" });
    const saved = await readFile(result.receiptPath, "utf8"); assert.equal(saved.includes("PRIVATE_REPORTER_FAILURE"), false);
    assert.equal(JSON.parse(saved).success, false);
  } finally { await rm(directory, { recursive: true, force: true }); }
});

test("invalid progress configuration is rejected before starting any test child", async () => {
  const directory = await mkdtemp(join(tmpdir(), "sxsy-progress-preflight-")), marker = join(directory, "unexpected-child");
  try {
    await assert.rejects(runVerification({ groups: [{ file: "must-not-run", args: ["-e", `require('node:fs').writeFileSync(${JSON.stringify(marker)},'unexpected')`] }], outputDirectory: directory, onProgress: true }), /reporter function/);
    await assert.rejects(readFile(marker), { code: "ENOENT" });
  } finally { await rm(directory, { recursive: true, force: true }); }
});
test("Windows authority policy selection includes every admission/state child and rejects partial or unknown inventories", () => {
  const selected = selectWindowsPolicyContractGroups("authority", requiredGroups);
  assert.deepEqual(selected.map(g => g.file), ["scripts/run-isolated-tests.test.mjs", "tools/layout-studio/task-authority.test.mjs", "tools/layout-studio/receipt-authority-state.test.mjs"]);
  assert.ok(selected.every(g => g.pattern === undefined));
  for (const file of ["tools/layout-studio/task-authority.test.mjs", "tools/layout-studio/receipt-authority-state.test.mjs"]) {
    assert.throws(() => selectWindowsPolicyContractGroups("authority", requiredGroups.filter(g => g.file !== file)), /inventory is missing/);
    assert.equal(nativeTestOverrides(file, "win32").timeoutMs, 240000);
  }
  assert.throws(() => selectWindowsPolicyContractGroups("__proto__", requiredGroups), /exact declared/);
  assert.equal(new Set(selectWindowsPolicyContractGroups(undefined, requiredGroups).map(g => g.file)).size, 8);
});

test("runner CLI help and unsupported arguments never start the default verification manifest", () => {
  const entry = fileURLToPath(new URL("./run-isolated-tests.mjs", import.meta.url));
  const run = args => execFileSync(process.execPath, [entry, ...args], { encoding: "utf8", timeout: 5000, stdio: ["ignore", "pipe", "pipe"] });
  assert.match(run(["--help"]), /^Usage:/);
  for (const args of [["--unknown"], ["--help", "unexpected"]]) {
    assert.throws(() => run(args), error => error.status === 2 && error.stdout === "" && /^Usage:/.test(error.stderr));
  }
});

test("atomic receipt records current successful child exits", async () => { const directory = await mkdtemp(join(tmpdir(), "sxsy-receipt-")); try { const result = await verify([await group(directory, "pass", "import test from 'node:test'; test('real test',()=>{});")], directory); const saved = JSON.parse(await readFile(result.receiptPath, "utf8")); assert.equal(saved.runId, result.receipt.runId); assert.equal(saved.success, true); assert.equal(saved.children[0].exitCode, 0); assert.equal(saved.children[0].timeout, false); assert.deepEqual(saved.children[0].testCounts, { total: 1, passed: 1, failed: 0, cancelled: 0, skipped: 0, todo: 0 }); assert.equal(saved.totals.tests, 1); assert.deepEqual((await readdir(directory)).filter((name) => name.endsWith(".tmp")), []); } finally { await rm(directory, { recursive: true, force: true }); } });

test("test groups fail closed on zero-match patterns, skipped tests, and todo tests", async () => {
  const directory = await mkdtemp(join(tmpdir(), "sxsy-summary-"));
  try {
    const ordinary = await group(directory, "ordinary", "import test from 'node:test'; test('present',()=>{});");
    const zeroMatch = await runVerification({ groups: [{ ...ordinary, pattern: "absent" }], outputDirectory: directory, executable });
    assert.equal(zeroMatch.receipt.success, false);
    assert.equal(zeroMatch.receipt.children[0].zeroTestPlan, true);

    const skipped = await verify([await group(directory, "skipped", "import test from 'node:test'; test('skipped',{skip:true},()=>{});")], directory);
    assert.equal(skipped.receipt.success, false);
    assert.equal(skipped.receipt.children[0].testCounts.skipped, 1);

    const todo = await verify([await group(directory, "todo", "import test from 'node:test'; test('todo',{todo:true},()=>{});")], directory);
    assert.equal(todo.receipt.success, false);
    assert.equal(todo.receipt.children[0].testCounts.todo, 1);
  } finally { await rm(directory, { recursive: true, force: true }); }
});

test("bounded failure receipts retain the first failing test even when many later cases pass", async () => {
  const directory = await mkdtemp(join(tmpdir(), "sxsy-first-failure-"));
  try {
    const fixture = await group(directory, "first-failure", "import test from 'node:test';test('FIRST_BOUNDED_FAILURE',()=>{throw Error('ORIGINAL_FAILURE_REASON')});for(let i=0;i<50;i++)test('later '+i+' '+'z'.repeat(60),()=>{});");
    const result = await verify([fixture], directory, 5000), child = result.receipt.children[0];
    assert.equal(result.receipt.success, false); assert.equal(child.testCounts.failed, 1); assert.equal(child.testCounts.passed, 50); assert.equal(child.outputTruncated, false);
    assert.match(child.failureDiagnostic, /FIRST_BOUNDED_FAILURE/); assert.match(child.failureDiagnostic, /ORIGINAL_FAILURE_REASON/); assert.match(child.failureDiagnostic, /# fail 1/); assert.ok(child.failureDiagnostic.length <= 4096); assert.equal(child.cleanupCompleted, true);
  } finally { await rm(directory, { recursive: true, force: true }); }
});

test("platform groups accept only their exact declared skip count", async () => {
  const directory = await mkdtemp(join(tmpdir(), "sxsy-receipt-platform-skip-"));
  try {
    const fixture = await group(directory, "platform-skip", "import test from 'node:test'; test('portable',()=>{}); test('other platform',{skip:true},()=>{});");
    const accepted = await verify([{ ...fixture, expectedSkipped: 1 }], directory);
    assert.equal(accepted.receipt.success, true);
    assert.equal(accepted.receipt.children[0].testCounts.skipped, 1);
    const rejected = await verify([{ ...fixture, expectedSkipped: 2 }], directory);
    assert.equal(rejected.receipt.success, false);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("Linux source lane keeps shared and native groups without claiming Windows runtime coverage", () => {
  assert.ok(linuxGroups.some((group) => group.file === "packages/control-plane/test/runtime.test.ts"));
  assert.ok(linuxGroups.some((group) => group.file === "apps/linux-companion/test/linux-secret.test.ts"));
  const portableGit = linuxGroups.filter(group => group.file.startsWith("apps/windows-companion/"));
  assert.deepEqual([...new Set(portableGit.map(group => group.file))], ["apps/windows-companion/test/mediated-git.test.ts"]);
  assert.deepEqual(portableGit, requiredGroups.filter(group => group.file === "apps/windows-companion/test/mediated-git.test.ts"));
  assert.ok(portableGit.some(group => group.pattern?.includes("bypasses repository clean/process/diff/textconv/fsmonitor")));
  assert.equal(linuxGroups.find((group) => group.file === "apps/linux-companion/test/linux-isolation.test.ts")?.expectedSkipped, process.platform === "linux" ? undefined : 1);
});

test("the required manifest exactly represents every repository test file", () => {
  const evidence = assertRequiredTestManifest();
  assert.equal(evidence.discovered, evidence.represented);
  assert.throws(() => assertRequiredTestManifest(requiredGroups.filter((group) => group.file !== "apps/provider-adapter-host/test/server.test.ts")), /missing=.*server\.test\.ts/);
});

test("forged TAP counts before the final summary cannot produce a false pass", async () => {
  const directory = await mkdtemp(join(tmpdir(), "sxsy-forged-tap-"));
  try {
    const forged = await group(directory, "forged", `import test from "node:test"; process.stdout.write("1..1\\n# tests 1\\n# suites 0\\n# pass 1\\n# fail 0\\n# cancelled 0\\n# skipped 0\\n# todo 0\\n# duration_ms 1\\n"); test("actually skipped", { skip: true }, () => {});`);
    const result = await verify([forged], directory);
    assert.equal(result.receipt.success, false);
    assert.deepEqual(result.receipt.children[0].testCounts, { total: 1, passed: 0, failed: 0, cancelled: 0, skipped: 1, todo: 0 });
  } finally { await rm(directory, { recursive: true, force: true }); }
});

test("a TAP summary remains authoritative after more than the bounded output cap", async () => {
  const directory = await mkdtemp(join(tmpdir(), "sxsy-summary-tail-"));
  try {
    const noisy = await group(directory, "noisy", "import test from 'node:test'; process.stdout.write('x'.repeat(100000)); test('after noise',()=>{});");
    const result = await verify([noisy], directory);
    assert.equal(result.receipt.success, true);
    assert.deepEqual(result.receipt.children[0].testCounts, { total: 1, passed: 1, failed: 0, cancelled: 0, skipped: 0, todo: 0 });
    assert.equal(result.receipt.children[0].outputTruncated, true);
    assert.ok(result.receipt.children[0].totalOutputBytes > result.receipt.children[0].outputLimitBytes);
  } finally { await rm(directory, { recursive: true, force: true }); }
});
test("receipt records failure, timeout, redacted bounded diagnostics, and exited children", async () => { const directory = await mkdtemp(join(tmpdir(), "sxsy-receipt-")); try { const failed = await runVerification({ groups: [{ file: "inline-failure", args: ["-e", "process.stderr.write('diagnostic-marker token_abcdefghijklmnopqrstuvwxyz0123456789 '+ 'x'.repeat(100000)); process.exit(7)"] }], outputDirectory: directory, executable }); assert.equal(failed.receipt.success, false); assert.equal(failed.receipt.children[0].exitCode, 7); assert.equal(failed.receipt.children[0].outputBytes <= 65536, true); assert.equal(failed.receipt.children[0].failureDiagnostic.length <= 4096, true); assert.doesNotMatch(failed.receipt.children[0].failureDiagnostic, /token_abcdefghijklmnopqrstuvwxyz0123456789/); const timed = await runVerification({ groups: [{ file: "inline-timeout", args: ["-e", "setInterval(() => {}, 1000)"] }], outputDirectory: directory, timeoutMs: 25, executable }); assert.equal(timed.receipt.success, false); assert.equal(timed.receipt.children[0].timeout, true); assert.equal(timed.receipt.children[0].signal !== null || timed.receipt.children[0].exitCode !== null, true); } finally { await rm(directory, { recursive: true, force: true }); } });

test("only explicitly slow integration or release groups extend the bounded default timeout and receipts record the effective bound", async () => {
  const directory = await mkdtemp(join(tmpdir(), "sxsy-group-timeout-"));
  try {
    const tlsGroups = requiredGroups.filter((candidate) => candidate.file === "apps/provider-adapter-host/test/tls-network-e2e.test.ts");
    assert.equal(tlsGroups.length, 2);
    assert.equal(tlsGroups.every((group) => group.timeoutMs === 300_000 && typeof group.pattern === "string"), true);
    const overrides = new Map(requiredGroups.filter((candidate) => candidate.timeoutMs !== undefined).map((candidate) => [candidate.file, candidate.timeoutMs]));
    const expected = [
      ...(process.platform === "win32" ? ["copilot-account-binding", "copilot-lifecycle", "copilot-requests", "claude-coding", "agents-claude", "conversation-bindings", "codex-submissions", "claude-submissions", "windows-reviewed-inputs", "windows-index-staging", "windows-history-staging", "windows-sandbox-native", "windows-sandbox-sessions", "windows-guest-tools", "windows-exchange-images", "windows-broker-exchanges", "scanner-fixtures", "scanner-fixture-removal", "scanner-fixture-invalidation", "windows-reviewed-runner", "repository-windows-shield", "repository-windows-shield-recovery", "repository-windows-pipeline", "repository-windows-pipeline-recovery", "repository-windows-execution", "repository-windows-execution-recovery", "repository-windows-execution-stop", "repository-windows-execution-output"].map((name) => [`tools/layout-studio/${name}.test.mjs`, name.startsWith("repository-windows-execution") || name.startsWith("repository-windows-pipeline") || name.startsWith("repository-windows-shield") ? 300_000 : name === "windows-exchange-images" ? 240_000 : 120_000]) : [["tools/layout-studio/windows-exchange-images.test.mjs", 120_000]]),
      ["deployment/suite/installation.test.mjs", 120_000],
      ["deployment/suite/inspect.test.mjs", process.platform === "win32" ? 300_000 : 120_000],
      ["tools/layout-studio/scanner-review.test.mjs", process.platform === "win32" ? 240_000 : 120_000],
      ["tools/layout-studio/scanner-index-review.test.mjs", process.platform === "win32" ? 240_000 : 120_000],
      ["tools/layout-studio/scanner-history-review.test.mjs", process.platform === "win32" ? 300_000 : 120_000],
      ["tools/layout-studio/scanner-mixed-review.test.mjs", process.platform === "win32" ? 300_000 : 120_000],
      ["tools/layout-studio/scanner-recipe-draft.test.mjs", process.platform === "win32" ? 300_000 : 120_000],
      ["tools/layout-studio/scanner-recipe-save.test.mjs", process.platform === "win32" ? 300_000 : 120_000],
      ["tools/layout-studio/windows-scanner-recipe-files.test.mjs", process.platform === "win32" ? 300_000 : 120_000],
      ["tools/layout-studio/windows-terminal-process.test.mjs", process.platform === "win32" ? 120_000 : 45_000],
      ["apps/provider-adapter-host/test/tls-network-e2e.test.ts", 300_000],
      ["apps/vscode-extension/test/named-pipe-transport.test.ts", 120_000],
      ...(process.platform === "win32" ? [["tools/layout-studio/task-authority.test.mjs", 240_000], ["tools/layout-studio/task-authority-ignored-inputs.test.mjs", 240_000], ["tools/layout-studio/receipt-authority-state.test.mjs", 240_000]] : []),
      ...(process.platform === "win32" ? [["tools/layout-studio/suite.test.mjs", 120_000]] : []),
      ["tools/layout-studio/repository-recovery.test.mjs", 120_000],
      ["tools/layout-studio/repository-execution.test.mjs", process.platform === "win32" ? 480_000 : 240_000],
      ["tools/layout-studio/repository-pipeline.test.mjs", 120_000],
      ["tools/layout-studio/repository-temporary-build.test.mjs", 120_000],
      ["tools/layout-studio/repository-shield.test.mjs", 120_000],
      ["tools/layout-studio/repository-shield-index.test.mjs", 120_000],
      ["tools/layout-studio/repository-shield-history.test.mjs", 120_000],
      ["tools/layout-studio/repository-windows-shield-index.test.mjs", process.platform === "win32" ? 300_000 : 120_000],
      ["tools/layout-studio/repository-windows-shield-history.test.mjs", process.platform === "win32" ? 300_000 : 120_000],
      ["tools/layout-studio/task-index-inputs.test.mjs", process.platform === "win32" ? 300_000 : 120_000],
      ["tools/layout-studio/task-history-inputs.test.mjs", process.platform === "win32" ? 300_000 : 120_000],
      ["tools/layout-studio/task-authority-ignored-trees.test.mjs", process.platform === "win32" ? 300_000 : 120_000],
      ["tools/layout-studio/repository-shield-ignored-trees.test.mjs", process.platform === "win32" ? 300_000 : 120_000],
      ["tools/layout-studio/repository-shield-osv-source.test.mjs", process.platform === "win32" ? 300_000 : 120_000],
      ...["repository-shield-cargo", "repository-windows-shield-cargo", "repository-shield-pypi", "repository-windows-shield-pypi", "repository-shield-licenses", "repository-windows-shield-licenses"].map(name => [`tools/layout-studio/${name}.test.mjs`, process.platform === "win32" ? 300_000 : 120_000]),
      ["tools/layout-studio/repository-shield-workspaces.test.mjs", process.platform === "win32" ? 300_000 : 120_000],
      ["tools/layout-studio/repository-shield-artifacts.test.mjs", process.platform === "win32" ? 300_000 : 120_000],
      ["tools/layout-studio/repository-shield-npm-archives.test.mjs", process.platform === "win32" ? 300_000 : 120_000],
      ["tools/layout-studio/repository-shield-cargo-artifacts.test.mjs", process.platform === "win32" ? 300_000 : 120_000],
      ["tools/layout-studio/repository-shield-pypi-artifacts.test.mjs", process.platform === "win32" ? 300_000 : 120_000],
      ...["repository-shield-python-wheels", "repository-windows-shield-python-wheels", "repository-shield-python-records", "repository-windows-shield-python-records", "repository-shield-cargo-archives", "repository-windows-shield-cargo-archives"].map(name => [`tools/layout-studio/${name}.test.mjs`, process.platform === "win32" ? 300_000 : 120_000]),
      ...["repository-windows-shield","repository-windows-shield-recovery"].map(name=>[`tools/layout-studio/${name}.test.mjs`,process.platform==="win32"?300_000:120_000]),
      ["tools/layout-studio/repository-pipeline-fixtures.test.mjs", 120_000],
      ["tools/layout-studio/repository-validation-policy.test.mjs", process.platform === "win32" ? 300_000 : 120_000],
      ["tools/layout-studio/repository-ignored-scanner-inputs.test.mjs", process.platform === "win32" ? 300_000 : 120_000],
      ["tools/layout-studio/repository-shield-exceptions.test.mjs", 120_000],
      ["tools/layout-studio/repository-windows-shield-exceptions.test.mjs", process.platform === "win32" ? 300_000 : 120_000],
      ["tools/layout-studio/repository-receipt-authority.test.mjs", process.platform === "win32" ? 300_000 : 120_000],
      ["apps/windows-companion/test/authenticated-pipe.test.ts", 240_000],
      ["apps/windows-companion/test/companion-lifecycle-helper.test.ts", 240_000],
      ["apps/windows-companion/test/council-workspace-isolation.test.ts", 240_000],
      ["apps/windows-companion/test/installed-automation-e2e.test.ts", 240_000],
      ["apps/windows-companion/test/repository-runner-helper.test.ts", 240_000],
      ["deployment/windows/Test-B122ManifestGenerators.ps1", 180_000],
      ["deployment/windows/Test-B122InstallLifecycle.ps1", 240_000],
      ["deployment/windows/Test-B122ProviderDesktopRelease.ps1", 300_000],
      ["deployment/windows/Test-B122TrustedBootstrap.ps1#powershell5", 300_000],
      ["deployment/windows/Test-B122TrustedBootstrap.ps1#pwsh", 300_000]
    ];
    assert.deepEqual(overrides, new Map(process.platform === "win32" ? expected : expected.filter(([file]) => !file.startsWith("deployment/windows/"))));
    for (const name of ["copilot-account-binding", "copilot-lifecycle", "copilot-requests", "claude-coding", "agents-claude", "conversation-bindings", "codex-submissions", "claude-submissions", "windows-reviewed-inputs", "windows-index-staging", "windows-history-staging", "windows-sandbox-native", "windows-sandbox-sessions", "windows-guest-tools", "windows-exchange-images", "windows-broker-exchanges", "scanner-fixtures", "scanner-fixture-removal", "scanner-fixture-invalidation", "windows-reviewed-runner", "repository-windows-shield", "repository-windows-shield-recovery", "repository-windows-pipeline", "repository-windows-pipeline-recovery", "repository-windows-execution", "repository-windows-execution-recovery", "repository-windows-execution-stop", "repository-windows-execution-output"]) {
      assert.deepEqual(nativeTestOverrides(`tools/layout-studio/${name}.test.mjs`, "win32"), { timeoutMs: name.startsWith("repository-windows-execution") || name.startsWith("repository-windows-pipeline") || name.startsWith("repository-windows-shield") ? 300_000 : name === "windows-exchange-images" ? 240_000 : 120_000 });
      assert.deepEqual(nativeTestOverrides(`tools/layout-studio/${name}.test.mjs`, "linux"), name === "windows-exchange-images" ? { timeoutMs: 120_000 } : {});
    }
    assert.deepEqual(nativeTestOverrides("tools/layout-studio/task-authority.test.mjs", "win32"), { timeoutMs: 240_000 });
    assert.deepEqual(nativeTestOverrides("tools/layout-studio/task-authority.test.mjs", "linux"), {});
    assert.deepEqual(nativeTestOverrides("tools/layout-studio/task-index-inputs.test.mjs", "win32"), { timeoutMs: 300_000 });
    assert.deepEqual(nativeTestOverrides("deployment/suite/inspect.test.mjs", "win32"), { timeoutMs: 300_000 });
    assert.deepEqual(nativeTestOverrides("deployment/suite/inspect.test.mjs", "linux"), { timeoutMs: 120_000 });
    assert.deepEqual(nativeTestOverrides("tools/layout-studio/repository-windows-shield-history.test.mjs", "win32"), { timeoutMs: 300_000 });
    assert.deepEqual(nativeTestOverrides("tools/layout-studio/repository-windows-shield-history.test.mjs", "linux"), { timeoutMs: 120_000 });
    assert.deepEqual(nativeTestOverrides("tools/layout-studio/task-index-inputs.test.mjs", "linux"), { timeoutMs: 120_000 });
    assert.deepEqual(nativeTestOverrides("tools/layout-studio/task-history-inputs.test.mjs", "win32"), { timeoutMs: 300_000 });
    assert.deepEqual(nativeTestOverrides("tools/layout-studio/task-history-inputs.test.mjs", "linux"), { timeoutMs: 120_000 });
    assert.deepEqual(nativeTestOverrides("tools/layout-studio/repository-windows-shield-index.test.mjs", "win32"), { timeoutMs: 300_000 });
    assert.deepEqual(nativeTestOverrides("tools/layout-studio/repository-windows-shield-index.test.mjs", "linux"), { timeoutMs: 120_000 });
    assert.deepEqual(nativeTestOverrides("tools/layout-studio/suite.test.mjs", "win32"), { timeoutMs: 120_000 });
    assert.deepEqual(nativeTestOverrides("tools/layout-studio/suite.test.mjs", "linux"), {});
    assert.deepEqual(nativeTestOverrides("tools/layout-studio/repository-recovery.test.mjs", "win32"), { timeoutMs: 120_000 });
    assert.deepEqual(nativeTestOverrides("tools/layout-studio/repository-recovery.test.mjs", "linux"), { timeoutMs: 120_000 });
    assert.deepEqual(nativeTestOverrides("tools/layout-studio/repository-validation-policy.test.mjs", "win32"), { timeoutMs: 300_000 });
    assert.deepEqual(nativeTestOverrides("tools/layout-studio/repository-validation-policy.test.mjs", "linux"), { timeoutMs: 120_000 });
    assert.deepEqual(nativeTestOverrides("tools/layout-studio/repository-ignored-scanner-inputs.test.mjs", "win32"), { timeoutMs: 300_000 });
    assert.deepEqual(nativeTestOverrides("tools/layout-studio/repository-ignored-scanner-inputs.test.mjs", "linux"), { timeoutMs: 120_000 });
    assert.deepEqual(nativeTestOverrides("tools/layout-studio/task-authority-ignored-inputs.test.mjs", "win32"), { timeoutMs: 240_000 });
    assert.deepEqual(nativeTestOverrides("tools/layout-studio/task-authority-ignored-inputs.test.mjs", "linux"), {});
    for (const name of ["repository-shield-artifacts", "repository-shield-npm-archives"]) {
      assert.deepEqual(nativeTestOverrides("tools/layout-studio/" + name + ".test.mjs", "win32"), { timeoutMs: 300_000 });
      assert.deepEqual(nativeTestOverrides("tools/layout-studio/" + name + ".test.mjs", "linux"), { timeoutMs: 120_000 });
    }
    assert.deepEqual(nativeTestOverrides("unreviewed.test.mjs", "win32"), {});
    assert.deepEqual(nativeTestOverrides("tools/layout-studio/repository-execution.test.mjs", "win32"), { timeoutMs: 480_000 });
    const delayed = ["-e", "setTimeout(() => process.exit(0), 150)"];
    const overridden = await runVerification({ groups: [{ file: "bounded-override", args: delayed, timeoutMs: 1_000 }], outputDirectory: directory, timeoutMs: 50, executable });
    assert.equal(overridden.receipt.success, true);
    assert.equal(overridden.receipt.children[0].effectiveTimeoutMs, 1_000);
    assert.equal(overridden.receipt.children[0].timeout, false);
    const defaulted = await runVerification({ groups: [{ file: "bounded-default", args: delayed }], outputDirectory: directory, timeoutMs: 50, executable });
    assert.equal(defaulted.receipt.success, false);
    assert.equal(defaulted.receipt.children[0].effectiveTimeoutMs, 50);
    assert.equal(defaulted.receipt.children[0].timeout, true);
  } finally { await rm(directory, { recursive: true, force: true }); }
});

test("cleanup and receipt-write failures settle with bounded fail-closed evidence", async () => {
  const directory = await mkdtemp(join(tmpdir(), "sxsy-cleanup-failure-"));
  try {
    const fixture = await group(directory, "pass-before-cleanup", "import test from 'node:test'; test('real test',()=>{});");
    const cleanupFailure = await runVerification({ groups: [fixture], outputDirectory: directory, executable, cleanup: async () => { throw new Error("secret cleanup detail"); } });
    assert.equal(cleanupFailure.receipt.success, false);
    assert.equal(cleanupFailure.receipt.children[0].cleanupCompleted, false);
    assert.equal(cleanupFailure.receipt.children[0].cleanupError, "isolated-test-root-cleanup-failed");
    assert.doesNotMatch(JSON.stringify(cleanupFailure.receipt), /secret cleanup detail/);

    const writeFailure = await runVerification({ groups: [fixture], outputDirectory: directory, executable, receiptWriter: async () => { throw new Error("secret filesystem detail"); } });
    assert.equal(writeFailure.receiptPath, null);
    assert.equal(writeFailure.receipt.success, false);
    assert.deepEqual(writeFailure.receipt.receiptWrite, { completed: false, error: "atomic-receipt-write-failed" });
    assert.doesNotMatch(JSON.stringify(writeFailure.receipt), /secret filesystem detail/);
  } finally { await rm(directory, { recursive: true, force: true }); }
});

test("transient isolated-root cleanup failure is retried after the owned child exits", async () => {
  const directory = await mkdtemp(join(tmpdir(), "sxsy-cleanup-retry-"));
  try {
    const fixture = await group(directory, "pass-before-cleanup-retry", "import test from 'node:test'; test('real test',()=>{});");
    let cleanupCalls = 0;
    const result = await runVerification({
      groups: [fixture], outputDirectory: directory, executable,
      cleanup: async (path, options) => {
        cleanupCalls += 1;
        if (cleanupCalls === 1) throw new Error("transient Windows lock");
        await rm(path, options);
      }
    });
    assert.equal(result.receipt.success, true);
    assert.equal(result.receipt.children[0].cleanupCompleted, true);
    assert.equal(result.receipt.children[0].cleanupError, null);
    assert.equal(cleanupCalls, 2);
  } finally { await rm(directory, { recursive: true, force: true }); }
});

test("safe provider lifecycle trace records only bounded non-secret stage labels", async () => {
  const directory = await mkdtemp(join(tmpdir(), "sxsy-safe-trace-"));
  try {
    const fixture = await group(directory, "safe-trace", "import test from 'node:test'; process.stderr.write('SXSY_PROVIDER_E2E_TRACE=configuration-ready\\nSXSY_PROVIDER_E2E_TRACE=token=secret\\n'); test('real test',()=>{});");
    const result = await runVerification({ groups: [{ ...fixture, safeTrace: true }], outputDirectory: directory, executable });
    assert.equal(result.receipt.success, true);
    assert.deepEqual(result.receipt.children[0].safeTrace, ["configuration-ready", "token"]);
    assert.doesNotMatch(JSON.stringify(result.receipt.children[0].safeTrace), /secret/);
  } finally { await rm(directory, { recursive: true, force: true }); }
});

test("a verification group can pin its own executable", async () => {
  const directory = await mkdtemp(join(tmpdir(), "sxsy-executable-"));
  try {
    const result = await runVerification({ groups: [{ file: "pinned-executable", executable: process.execPath, args: ["-e", "process.exit(0)"] }], outputDirectory: directory, executable: "C:\\definitely-missing\\unsafe.exe" });
    assert.equal(result.receipt.success, true);
    assert.equal(result.receipt.children[0].command[0], process.execPath);
  } finally { await rm(directory, { recursive: true, force: true }); }
});

test("strict child environments allowlist operating-system inputs and isolate test state", async () => {
  const directory = await mkdtemp(join(tmpdir(), "sxsy-environment-"));
  try {
    const environment = createStrictTestEnvironment(join(directory, "child"), {
      PATH: process.env.PATH,
      SystemRoot: process.env.SystemRoot,
      SXSY_AMBIENT_SECRET: "must-not-cross",
      DATABASE_URL: "postgres://production.example/live",
      GH_TOKEN: "must-not-cross",
      NODE_OPTIONS: "--inspect"
    });
    assert.equal(environment.SXSY_AMBIENT_SECRET, undefined);
    assert.equal(environment.DATABASE_URL, undefined);
    assert.equal(environment.GH_TOKEN, undefined);
    assert.equal(environment.NODE_OPTIONS, undefined);
    assert.equal(environment.NODE_ENV, "test");
    assert.equal(environment.SXSY_TEST_MODE, "1");
    assert.equal(environment.SXSY_NETWORK, "deny");
    assert.match(environment.SXSY_TEST_DATABASE, /^sxsy_test_/);
    assert.equal(environment.TEMP, join(directory, "child"));
    assert.equal(environment.XDG_STATE_HOME, join(directory, "child", ".local", "state"));
    assert.equal(environment.XDG_RUNTIME_DIR, join(directory, "child", ".runtime"));

    process.env.SXSY_AMBIENT_SECRET = "must-not-cross";
    const code = "if(process.env.SXSY_AMBIENT_SECRET||process.env.DATABASE_URL||process.env.GH_TOKEN||process.env.NODE_OPTIONS||process.env.SXSY_TEST_MODE!=='1'||process.env.SXSY_NETWORK!=='deny'||!process.env.SXSY_TEST_ROOT||!process.env.SXSY_TEST_DATABASE)process.exit(19)";
    const result = await runVerification({ groups: [{ file: "strict-environment", args: ["-e", code] }], outputDirectory: directory, executable });
    assert.equal(result.receipt.success, true);
    assert.equal(result.receipt.children[0].environmentPolicy, "strict-test-v3");
  } finally {
    delete process.env.SXSY_AMBIENT_SECRET;
    await rm(directory, { recursive: true, force: true });
  }
});

test("DPAPI-capable packaged tests retain the user token but cannot read real profile or npm credentials", async () => {
  const directory = await mkdtemp(join(tmpdir(), "sxsy-profile-isolation-"));
  const realProfile = join(directory, "real-profile");
  const outputDirectory = join(directory, "receipts");
  try {
    await import("node:fs/promises").then(({ mkdir }) => mkdir(realProfile, { recursive: true }));
    await writeFile(join(realProfile, ".npmrc"), "//registry.example/:_authToken=sentinel-secret", "utf8");
    const fixture = await group(directory, "profile", `import test from "node:test"; import { readFile } from "node:fs/promises"; test("isolated", async () => { if (process.env.SXSY_CURRENT_USER_DPAPI !== "1") throw new Error("missing current-user marker"); if (process.env.HOME === ${JSON.stringify(realProfile)}) throw new Error("real profile inherited"); for (const file of [process.env.HOME + "/.npmrc", process.env.npm_config_userconfig, process.env.npm_config_globalconfig]) { const value = await readFile(file, "utf8").catch(() => ""); if (value.includes("sentinel-secret")) throw new Error("ambient npm credential inherited"); } });`);
    const result = await runVerification({ groups: [{ ...fixture, currentUserProfile: true }], outputDirectory, executable, sourceEnvironment: { ...process.env, HOME: realProfile, USERPROFILE: realProfile, APPDATA: join(realProfile, "AppData", "Roaming"), LOCALAPPDATA: join(realProfile, "AppData", "Local") } });
    assert.equal(result.receipt.success, true);
  } finally { await rm(directory, { recursive: true, force: true }); }
});

test("timeout terminates and awaits the entire task-owned descendant tree", async () => {
  const directory = await mkdtemp(join(tmpdir(), "sxsy-tree-"));
  const pidFile = join(directory, "descendant.pid");
  try {
    const code = `const{spawn}=require('node:child_process'),{writeFileSync}=require('node:fs');const c=spawn(process.execPath,['-e','setInterval(()=>{},1000)'],{stdio:'ignore'});writeFileSync(${JSON.stringify(pidFile)},String(c.pid));setInterval(()=>{},1000)`;
    const result = await runVerification({ groups: [{ file: "descendant-timeout", args: ["-e", code] }], outputDirectory: directory, timeoutMs: 500, executable });
    assert.equal(result.receipt.success, false);
    assert.equal(result.receipt.children[0].timeout, true);
    assert.equal(result.receipt.children[0].processTreeTermination.completed, true);
    const descendantPid = Number(await readFile(pidFile, "utf8"));
    await new Promise((done) => setTimeout(done, 100));
    assert.throws(() => process.kill(descendantPid, 0));
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("the reviewed Windows execution allowance passes the runner guard and invalid later bounds fail before any child starts",async()=>{
  const file="tools/layout-studio/repository-execution.test.mjs";
  assert.equal(effectiveGroupTimeout({file,timeoutMs:480_000}),480_000);
  for(const group of [{file:"unreviewed.test.mjs",timeoutMs:480_000},{file,timeoutMs:480_001},{file,timeoutMs:480_000,args:["-e","process.exit(0)"]}])assert.throws(()=>effectiveGroupTimeout(group),/explicitly reviewed/);
  const directory=await mkdtemp(join(tmpdir(),"switchyard-timeout-preflight-")),marker=join(directory,"unexpected-child");
  try{
    await assert.rejects(runVerification({groups:[{file:"first-valid-child",args:["-e",`require('node:fs').writeFileSync(${JSON.stringify(marker)},'unexpected')`]},{file:"later-invalid-bound",timeoutMs:480_001}],outputDirectory:directory}),/explicitly reviewed/);
    await assert.rejects(readFile(marker),{code:"ENOENT"});
  }finally{await rm(directory,{recursive:true,force:true});}
});
