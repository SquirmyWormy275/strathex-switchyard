import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { access, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import test from "node:test";

// @ts-expect-error The repository-owned process-tree supervisor is JavaScript.
import { terminateOwnedProcessTree } from "../../../scripts/test-support/process-tree.mjs";

const repositoryRoot = resolve(process.cwd());
const helperRoot = join(repositoryRoot, "apps", "windows-companion", "sandbox-lifecycle-helper");
const project = join(helperRoot, "Sxsy.B122.SandboxLifecycleHelper.csproj");
const localDotnet = join(repositoryRoot, ".tools", "dotnet", "dotnet.exe");
const outputLimitBytes = 64 * 1024;

async function command(executable: string, args: readonly string[], environment: NodeJS.ProcessEnv, timeoutMs: number) {
  if (!Number.isSafeInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > 180_000) throw new Error("A helper command timeout must be bounded.");
  const child = spawn(executable, [...args], {
    cwd: repositoryRoot,
    env: environment,
    detached: process.platform !== "win32",
    shell: false,
    windowsHide: true,
    stdio: ["ignore", "pipe", "pipe"]
  });
  const stdoutChunks: Buffer[] = [];
  const stderrChunks: Buffer[] = [];
  let stdoutBytes = 0;
  let stderrBytes = 0;
  let totalOutputBytes = 0;
  const append = (target: Buffer[], chunk: Buffer, current: number) => {
    const bytes = Buffer.from(chunk);
    totalOutputBytes += bytes.length;
    const remaining = outputLimitBytes / 2 - current;
    if (remaining > 0) target.push(bytes.subarray(0, remaining));
    return current + Math.min(bytes.length, Math.max(remaining, 0));
  };
  child.stdout.on("data", (chunk: Buffer) => { stdoutBytes = append(stdoutChunks, chunk, stdoutBytes); });
  child.stderr.on("data", (chunk: Buffer) => { stderrBytes = append(stderrChunks, chunk, stderrBytes); });
  let spawnError: Error | undefined;
  child.once("error", (error) => { spawnError = error; });
  const close = new Promise<{ code: number; signal: NodeJS.Signals | null }>((resolveExit) => {
    child.once("close", (code, signal) => resolveExit({ code: code ?? -1, signal }));
  });
  let timeoutHandle: number | undefined;
  const timeout = new Promise<undefined>((resolveTimeout) => { timeoutHandle = setTimeout(resolveTimeout, timeoutMs); });
  let result = await Promise.race([close, timeout]);
  const timedOut = result === undefined;
  let processTreeTermination = { strategy: "natural-exit", completed: true, supervisorExitCode: null as number | null, supervisorError: null as string | null };
  if (timedOut) {
    processTreeTermination = await terminateOwnedProcessTree(child, environment);
    let closeBoundHandle: number | undefined;
    const closeBound = new Promise<undefined>((resolveTimeout) => { closeBoundHandle = setTimeout(resolveTimeout, 12_000); });
    result = await Promise.race([close, closeBound]);
    if (closeBoundHandle) clearTimeout(closeBoundHandle);
    if (result === undefined || !processTreeTermination.completed) throw new Error("The bounded helper command did not close its exact process tree.");
  }
  if (timeoutHandle) clearTimeout(timeoutHandle);
  if (spawnError) throw spawnError;
  return {
    ...result,
    rootPid: child.pid ?? null,
    timedOut,
    stdout: Buffer.concat(stdoutChunks).toString("utf8"),
    stderr: Buffer.concat(stderrChunks).toString("utf8"),
    totalOutputBytes,
    outputTruncated: totalOutputBytes > stdoutBytes + stderrBytes,
    processTreeTermination
  };
}

async function processIsAbsent(pid: number) {
  const deadline = Date.now() + 5_000;
  do {
    try { process.kill(pid, 0); }
    catch (error) { if ((error as NodeJS.ErrnoException).code === "ESRCH") return true; }
    await new Promise((resolveDelay) => setTimeout(resolveDelay, 50));
  } while (Date.now() < deadline);
  return false;
}

test("native sandbox lifecycle helper binds launch, focus, and termination to an exact non-reused process", async () => {
  const source = await readFile(join(helperRoot, "Program.cs"), "utf8");
  for (const required of [
    "C:\\\\Windows\\\\System32\\\\WindowsSandbox.exe",
    "CreateProcessW",
    "CREATE_SUSPENDED",
    "ResumeThread",
    "QueryFullProcessImageNameW",
    "GetProcessTimes",
    "GetFileInformationByHandle",
    "ProcessIdToSessionId",
    "EnumWindows",
    "GetWindowThreadProcessId",
    "SetForegroundWindow",
    "TerminateProcess",
    "WaitForSingleObject"
  ]) {
    assert.equal(source.includes(required), true, `native lifecycle helper is missing ${required}`);
  }
  assert.match(source, /CaptureExactIdentity[\s\S]{0,2400}GetProcessTimes/);
  assert.match(source, /Focus[\s\S]{0,3000}CaptureExactIdentity[\s\S]{0,3000}SetForegroundWindow/);
  assert.match(source, /Terminate[\s\S]{0,3000}CaptureExactIdentity[\s\S]{0,3000}TerminateProcess/);
  assert.match(source, /--self-test/);
  assert.match(source, /sxsy-b122\.sandbox-lifecycle-self-test/);
});

test("native sandbox lifecycle helper is a deterministic fixed Windows executable", async () => {
  const project = await readFile(join(helperRoot, "Sxsy.B122.SandboxLifecycleHelper.csproj"), "utf8");
  assert.match(project, /<RuntimeIdentifier>win-x64<\/RuntimeIdentifier>/);
  assert.match(project, /<SelfContained>true<\/SelfContained>/);
  assert.match(project, /<PublishSingleFile>true<\/PublishSingleFile>/);
  assert.match(project, /<TreatWarningsAsErrors>true<\/TreatWarningsAsErrors>/);
  assert.match(project, /<AssemblyName>b122-sandbox-lifecycle<\/AssemblyName>/);
});

test("sandbox lifecycle test commands cap output and terminate the complete owned tree on timeout", { timeout: 30_000 }, async (context) => {
  const temporaryRoot = await mkdtemp(join(tmpdir(), "sxsy-b122-sandbox-command-bound-"));
  context.after(async () => { await rm(temporaryRoot, { recursive: true, force: true }); });
  const childPidPath = join(temporaryRoot, "child.pid");
  const fixture = join(temporaryRoot, "tree.cjs");
  await writeFile(fixture, [
    "const { spawn } = require('node:child_process');",
    "const { writeFileSync } = require('node:fs');",
    "const child = spawn(process.execPath, ['-e', 'setInterval(() => {}, 1000)'], { stdio: 'ignore', windowsHide: true });",
    "writeFileSync(process.argv[2], String(child.pid));",
    "process.stdout.write('x'.repeat(131072));",
    "setInterval(() => {}, 1000);"
  ].join("\n"), "utf8");
  const result = await command(process.execPath, [fixture, childPidPath], process.env, 500);
  assert.equal(result.timedOut, true);
  assert.equal(result.outputTruncated, true);
  assert.equal(result.stdout.length <= outputLimitBytes / 2, true);
  assert.equal(result.processTreeTermination.completed, true);
  assert.equal(result.rootPid === null ? false : await processIsAbsent(result.rootPid), true);
  const childPid = Number((await readFile(childPidPath, "utf8")).trim());
  assert.equal(Number.isSafeInteger(childPid) && childPid > 0, true);
  assert.equal(await processIsAbsent(childPid), true);
});

test("published sandbox lifecycle executable returns the exact no-hardware self-test receipt", { timeout: 180_000 }, async (context) => {
  if (process.platform !== "win32") return context.skip("The native lifecycle executable is verified on Windows.");
  const temporaryRoot = await mkdtemp(join(tmpdir(), "sxsy-b122-sandbox-lifecycle-build-"));
  context.after(async () => { await rm(temporaryRoot, { recursive: true, force: true }); });
  const output = join(temporaryRoot, "publish");
  const dotnet = await access(localDotnet).then(() => localDotnet).catch(() => "dotnet.exe");
  const environment = {
    ...process.env,
    DOTNET_CLI_HOME: join(temporaryRoot, "dotnet-home"),
    DOTNET_NOLOGO: "1",
    DOTNET_SKIP_FIRST_TIME_EXPERIENCE: "1",
    APPDATA: join(temporaryRoot, "appdata"),
    NUGET_PACKAGES: join(repositoryRoot, ".tools", "nuget-packages")
  };
  const published = await command(dotnet, ["publish", project, "-c", "Release", "-r", "win-x64", "--self-contained", "true", "-p:PublishSingleFile=true", "-o", output, "--configfile", join(repositoryRoot, ".tools", "NuGet.Config")], environment, 120_000);
  assert.equal(published.timedOut, false);
  assert.equal(published.outputTruncated, false, "dotnet publish output exceeded the evidence bound");
  assert.equal(published.code, 0, published.stderr || published.stdout);
  const selfTest = await command(join(output, "b122-sandbox-lifecycle.exe"), ["--self-test"], {}, 30_000);
  assert.equal(selfTest.timedOut, false);
  assert.equal(selfTest.outputTruncated, false);
  assert.equal(selfTest.code, 0, selfTest.stderr || selfTest.stdout);
  const receipt = JSON.parse(selfTest.stdout) as Record<string, unknown>;
  assert.deepEqual(receipt, {
    schema: "sxsy-b122.sandbox-lifecycle-self-test",
    version: 1,
    status: "ok",
    hardwareAccessed: false
  });
});
