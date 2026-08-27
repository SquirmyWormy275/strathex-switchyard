import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { createHash, randomBytes } from "node:crypto";
import { access, copyFile, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

// @ts-expect-error The repository-owned process-tree supervisor is JavaScript.
import { terminateOwnedProcessTree } from "../../../scripts/test-support/process-tree.mjs";

const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), "../../..");
const project = join(repositoryRoot, "apps", "windows-companion", "companion-lifecycle-helper", "Sxsy.B122.CompanionLifecycleHelper.csproj");
const localDotnet = join(repositoryRoot, ".tools", "dotnet", "dotnet.exe");

test("packaged companion supervisor proves kill-on-close containment and refuses generic launch", { timeout: 180_000 }, async (context) => {
  if (process.platform !== "win32") return context.skip("Windows Job Object verification runs on Windows.");
  const root = await mkdtemp(join(tmpdir(), "sxsy-b122-companion-supervisor-"));
  context.after(async () => { await rm(root, { recursive: true, force: true }); });
  const publish = join(root, "publish");
  const dotnet = await access(localDotnet).then(() => localDotnet).catch(() => "dotnet.exe");
  const environment = {
    ...process.env,
    DOTNET_CLI_HOME: join(root, "dotnet-home"),
    DOTNET_NOLOGO: "1",
    DOTNET_SKIP_FIRST_TIME_EXPERIENCE: "1",
    APPDATA: join(root, "appdata"),
    LOCALAPPDATA: join(root, "localappdata"),
    NUGET_PACKAGES: process.env.NUGET_PACKAGES ?? join(repositoryRoot, ".tools", "nuget-packages")
  };
  const built = await command(dotnet, ["publish", project, "-c", "Release", "-r", "win-x64", "--self-contained", "true", "-p:PublishSingleFile=true", "-p:DefineConstants=B122_TEST_HOOKS", "-o", publish, "--configfile", process.env.SXSY_B122_NUGET_CONFIG ?? join(repositoryRoot, ".tools", "NuGet.Config")], environment, 120_000);
  assert.equal(built.code, 0, built.stderr || built.stdout);
  const helper = join(publish, "b122-companion-supervisor.exe");
  const selfTest = await command(helper, ["--self-test"], {}, 30_000);
  assert.equal(selfTest.code, 0, selfTest.stderr || selfTest.stdout);
  assert.deepEqual(JSON.parse(selfTest.stdout), {
    schema: "sxsy-b122.companion-supervisor-self-test",
    version: 1,
    status: "passed",
    capturedProcesses: 2,
    activeProcesses: 0
  });
  const identityReceipt = await command(helper, ["--process-identity", String(process.pid)], {}, 10_000);
  assert.equal(identityReceipt.code, 0, identityReceipt.stderr || identityReceipt.stdout);
  const identity = JSON.parse(identityReceipt.stdout) as Record<string, unknown>;
  assert.deepEqual(Object.keys(identity).sort(), ["creationFileTimeUtc", "pid", "schema", "sessionId", "version"]);
  assert.equal(identity.schema, "sxsy-b122.windows-process-identity");
  assert.equal(identity.version, 1);
  assert.equal(identity.pid, process.pid);
  assert.match(String(identity.creationFileTimeUtc), /^[1-9][0-9]{10,19}$/);
  assert.equal(Number.isSafeInteger(identity.sessionId) && Number(identity.sessionId) >= 0, true);

  const bundle = join(root, "bundle");
  const runtime = join(bundle, "runtime");
  const mainDirectory = join(bundle, "app", "dist", "apps", "windows-companion", "src");
  await mkdir(runtime, { recursive: true });
  await mkdir(mainDirectory, { recursive: true });
  const node = join(runtime, "node.exe");
  const main = join(mainDirectory, "main.js");
  await copyFile(process.execPath, node);
  await writeFile(main, "setInterval(() => {}, 1000);\n", "utf8");

  const windows = process.env.SystemRoot ?? process.env.SYSTEMROOT;
  const local = process.env.LOCALAPPDATA;
  const roaming = process.env.APPDATA;
  assert.ok(windows && local && roaming, "Windows Known Folder environment is required by this packaged test");
  const createLifecycleFixture = async (name: string) => {
    const lifecycleState = join(root, name);
    const logs = join(lifecycleState, "logs");
    const temporary = join(lifecycleState, "supervisor-temp");
    await mkdir(logs, { recursive: true });
    await mkdir(temporary, { recursive: true });
    const lifecycleRequest = join(lifecycleState, "companion-supervisor.request.json");
    const lifecycleStatePath = join(lifecycleState, "companion-supervisor.state.json");
    const startingIntent = join(lifecycleState, "companion-supervisor.starting.json");
    const supervisorId = `companion:${randomBytes(32).toString("hex")}`;
    await writeFile(lifecycleRequest, JSON.stringify({
      schema: "sxsy-b122.companion-supervisor-request", version: 1, supervisorId,
      bundleRoot: bundle, bundleId: "a".repeat(64), helperPath: helper, helperSha256: await sha256(helper),
      nodePath: node, nodeSha256: await sha256(node), mainPath: main, mainSha256: await sha256(main),
      arguments: [main], workingDirectory: bundle, stateRoot: lifecycleState,
      stdoutPath: join(logs, "companion.stdout.log"), stderrPath: join(logs, "companion.stderr.log"),
      environment: {
        SystemRoot: windows, WINDIR: windows, TEMP: temporary, TMP: temporary,
        LOCALAPPDATA: local, APPDATA: roaming,
        SXSY_B122_COMPANION_SUPERVISOR_REQUEST: lifecycleRequest,
        SXSY_B122_COMPANION_SUPERVISOR_STATE: lifecycleStatePath
      },
      controlToken: randomBytes(32).toString("hex"), statePath: lifecycleStatePath
    }), "utf8");
    return { lifecycleState, lifecycleRequest, lifecycleStatePath, startingIntent, supervisorId };
  };

  const normal = await createLifecycleFixture("lifecycle-state");
  const started = await command(helper, ["--start", normal.lifecycleRequest, normal.lifecycleStatePath, normal.startingIntent], {}, 12_000);
  assert.equal(started.code, 0, started.stderr || started.stdout);
  const startReceipt = JSON.parse(started.stdout) as Record<string, unknown>;
  assert.equal(startReceipt.schema, "sxsy-b122.companion-supervisor-start");
  assert.equal(startReceipt.supervisorId, normal.supervisorId);
  const supervisorPid = Number(startReceipt.supervisorPid);
  const running = await waitForJson(normal.lifecycleStatePath, (value) => value.status === "running" && Number(value.activeProcesses) > 0, 10_000);
  const childPid = Number(running.childPid);
  assert.equal(processExists(childPid), true, "the exact contained companion child did not start");
  const termination = await command(helper, ["--terminate", normal.lifecycleRequest, normal.lifecycleStatePath, "0", "5000"], {}, 10_000);
  assert.equal(termination.code, 0, termination.stderr || termination.stdout);
  assert.deepEqual(JSON.parse(termination.stdout), { schema: "sxsy-b122.companion-supervisor-termination", version: 1, supervisorId: normal.supervisorId, status: "terminated", activeProcesses: 0 });
  assert.equal(await processIsAbsent(supervisorPid), true, "the persistent supervisor survived exact termination");
  assert.equal(await processIsAbsent(childPid), true, "the terminated companion Job retained its child");
  const terminal = JSON.parse(await readFile(normal.lifecycleStatePath, "utf8")) as Record<string, unknown>;
  assert.equal(terminal.status, "terminated", "the launcher regressed the concurrent termination receipt");

  const preIntent = await createLifecycleFixture("pre-intent-window");
  const preIntentMarker = join(preIntent.lifecycleState, "pre-intent.marker");
  const preIntentStarter = controlledSpawn(helper, ["--test-start-pause-after-create", preIntent.lifecycleRequest, preIntent.lifecycleStatePath, preIntent.startingIntent, preIntentMarker], {});
  const preIntentLauncherPid = Number(await waitForText(preIntentMarker, 10_000));
  await assert.rejects(readFile(preIntent.startingIntent, "utf8"), { code: "ENOENT" });
  assert.equal(preIntentStarter.child.kill(), true, "the exact pre-intent starter could not be killed for injection");
  await preIntentStarter.closed(8_000);
  assert.equal(await processIsAbsent(preIntentLauncherPid), true, "the atomically Job-bound pre-intent launcher survived its starter");
  await assert.rejects(readFile(preIntent.lifecycleStatePath, "utf8"), { code: "ENOENT" });

  const preAssign = await createLifecycleFixture("pre-assign-window");
  const preAssignMarker = join(preAssign.lifecycleState, "pre-assign.marker");
  const preAssignStarter = controlledSpawn(helper, ["--test-launch-pause-after-child-create", preAssign.lifecycleRequest, preAssign.lifecycleStatePath, preAssign.startingIntent, preAssignMarker], {});
  const preAssignChildPid = Number(await waitForText(preAssignMarker, 10_000));
  const preAssignIntent = JSON.parse(await readFile(preAssign.startingIntent, "utf8")) as Record<string, unknown>;
  const preAssignLauncherPid = Number(preAssignIntent.launchPid);
  const reconcile = controlledSpawn(helper, ["--reconcile", preAssign.lifecycleRequest, preAssign.lifecycleStatePath], {});
  assert.equal(process.kill(preAssignLauncherPid), true, "the exact pre-assignment launcher could not be killed for injection");
  const reconciled = await reconcile.closed(10_000);
  assert.equal(reconciled.code, 1, reconciled.stderr || reconciled.stdout);
  assert.equal((JSON.parse(reconciled.stdout) as Record<string, unknown>).status, "request_only_contained");
  const failedStarter = await preAssignStarter.closed(15_000);
  assert.notEqual(failedStarter.code, 0, "a starter unexpectedly claimed success after its launcher was killed");
  assert.equal(await processIsAbsent(preAssignLauncherPid), true, "the pre-assignment launcher survived reconciliation");
  assert.equal(await processIsAbsent(preAssignChildPid), true, "the starting Job retained a pre-assignment child");

  const state = join(root, "state");
  await mkdir(state);
  const request = join(state, "companion-supervisor.request.json");
  const statePath = join(state, "companion-supervisor.state.json");
  await writeFile(request, JSON.stringify({ schema: "sxsy-b122.companion-supervisor-request", version: 1, executable: process.execPath }), "utf8");
  const rejected = await command(helper, ["--launch", request, statePath], {}, 10_000);
  assert.notEqual(rejected.code, 0);
  assert.match(rejected.stderr, /schema|invalid|failed closed/i);
  await assert.rejects(readFile(statePath, "utf8"), (error: unknown) => !!error && typeof error === "object" && "code" in error && (error as { code?: unknown }).code === "ENOENT");
});

async function sha256(path: string): Promise<string> { return createHash("sha256").update(await readFile(path)).digest("hex"); }

async function waitForJson(path: string, predicate: (value: Record<string, unknown>) => boolean, timeoutMs: number): Promise<Record<string, unknown>> {
  const deadline = Date.now() + timeoutMs;
  do {
    try { const value = JSON.parse(await readFile(path, "utf8")) as Record<string, unknown>; if (predicate(value)) return value; } catch { /* not published yet */ }
    await new Promise((resolveDelay) => setTimeout(resolveDelay, 50));
  } while (Date.now() < deadline);
  throw new Error(`Timed out waiting for ${path}.`);
}

async function waitForText(path: string, timeoutMs: number): Promise<string> {
  const deadline = Date.now() + timeoutMs;
  do {
    try { return (await readFile(path, "utf8")).trim(); } catch { /* not published yet */ }
    await new Promise((resolveDelay) => setTimeout(resolveDelay, 25));
  } while (Date.now() < deadline);
  throw new Error(`Timed out waiting for ${path}.`);
}

async function processIsAbsent(pid: number): Promise<boolean> { const deadline = Date.now() + 5_000; do { if (!processExists(pid)) return true; await new Promise((resolveDelay) => setTimeout(resolveDelay, 50)); } while (Date.now() < deadline); return false; }
function processExists(pid: number): boolean { try { process.kill(pid, 0); return true; } catch (error) { return (error as NodeJS.ErrnoException).code !== "ESRCH"; } }

function controlledSpawn(executable: string, args: readonly string[], environment: NodeJS.ProcessEnv): {
  child: ReturnType<typeof spawn>;
  closed: (timeoutMs: number) => Promise<{ code: number; stdout: string; stderr: string }>;
} {
  const child = spawn(executable, [...args], { cwd: repositoryRoot, env: { ...process.env, ...environment }, shell: false, windowsHide: true, stdio: ["ignore", "pipe", "pipe"] });
  let stdout = "";
  let stderr = "";
  let outputBytes = 0;
  child.stdout.on("data", (chunk: Buffer) => { outputBytes += chunk.length; if (stdout.length < 64 * 1024) stdout += chunk.subarray(0, Math.max(0, 64 * 1024 - stdout.length)).toString("utf8"); });
  child.stderr.on("data", (chunk: Buffer) => { outputBytes += chunk.length; if (stderr.length < 64 * 1024) stderr += chunk.subarray(0, Math.max(0, 64 * 1024 - stderr.length)).toString("utf8"); });
  const close = new Promise<number>((resolveExit, rejectExit) => { child.once("error", rejectExit); child.once("close", (value) => resolveExit(value ?? -1)); });
  return {
    child,
    closed: async (timeoutMs: number) => {
      let resolveTimeout!: (value: undefined) => void;
      const timeout = new Promise<undefined>((resolve) => { resolveTimeout = resolve; });
      const timeoutHandle = setTimeout(() => resolveTimeout(undefined), timeoutMs);
      let code = await Promise.race([close, timeout]);
      clearTimeout(timeoutHandle);
      if (code === undefined) {
        const termination = await terminateOwnedProcessTree(child, { ...process.env, ...environment });
        const closed = await Promise.race([close, new Promise<undefined>((resolveTimeout) => setTimeout(resolveTimeout, 12_000))]);
        if (!termination.completed || closed === undefined) throw new Error("The controlled companion-helper process left an owned process tree.");
        code = closed;
        throw new Error(`The controlled companion-helper process exceeded ${timeoutMs}ms (exit ${code}).`);
      }
      if (outputBytes > 128 * 1024) throw new Error("The controlled companion-helper process exceeded its output cap.");
      return { code, stdout: stdout.trim(), stderr: stderr.trim() };
    }
  };
}

async function command(executable: string, args: readonly string[], environment: NodeJS.ProcessEnv, timeoutMs: number): Promise<{ code: number; stdout: string; stderr: string }> {
  const child = spawn(executable, [...args], { cwd: repositoryRoot, env: environment, detached: process.platform !== "win32", shell: false, windowsHide: true, stdio: ["ignore", "pipe", "pipe"] });
  let stdout = "";
  let stderr = "";
  let outputBytes = 0;
  child.stdout.on("data", (chunk: Buffer) => { outputBytes += chunk.length; if (stdout.length < 64 * 1024) stdout += chunk.subarray(0, Math.max(0, 64 * 1024 - stdout.length)).toString("utf8"); });
  child.stderr.on("data", (chunk: Buffer) => { outputBytes += chunk.length; if (stderr.length < 64 * 1024) stderr += chunk.subarray(0, Math.max(0, 64 * 1024 - stderr.length)).toString("utf8"); });
  const close = new Promise<number>((resolveExit, rejectExit) => { child.once("error", rejectExit); child.once("close", (value) => resolveExit(value ?? -1)); });
  let resolveTimeout!: (value: undefined) => void;
  const timeout = new Promise<undefined>((resolve) => { resolveTimeout = resolve; });
  const timeoutHandle = setTimeout(() => resolveTimeout(undefined), timeoutMs);
  let code = await Promise.race([close, timeout]);
  clearTimeout(timeoutHandle);
  if (code === undefined) {
    const termination = await terminateOwnedProcessTree(child, environment);
    const closed = await Promise.race([close, new Promise<undefined>((resolveTimeout) => setTimeout(resolveTimeout, 12_000))]);
    if (!termination.completed || closed === undefined) throw new Error("The bounded companion-helper command left an owned process tree.");
    code = closed;
  }
  if (outputBytes > 128 * 1024) throw new Error("The bounded companion-helper command exceeded its output cap.");
  return { code, stdout: stdout.trim(), stderr: stderr.trim() };
}
