import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { access, copyFile, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import { WindowsJobObjectProcessSupervisor } from "../src/windows-job-supervisor.ts";

const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), "../../..");
const project = join(repositoryRoot, "apps", "windows-companion", "repository-runner-helper", "Sxsy.B122.RepositoryRunner.csproj");
const localDotnet = join(repositoryRoot, ".tools", "dotnet", "dotnet.exe");

async function command(executable: string, args: readonly string[], environment: NodeJS.ProcessEnv, timeoutMs: number) {
  const child = spawn(executable, [...args], { cwd: repositoryRoot, env: environment, shell: false, windowsHide: true, stdio: ["ignore", "pipe", "pipe"] });
  let stdout = "";
  let stderr = "";
  child.stdout.on("data", (chunk: Buffer) => { stdout += chunk.toString("utf8"); });
  child.stderr.on("data", (chunk: Buffer) => { stderr += chunk.toString("utf8"); });
  const timer = setTimeout(() => child.kill("SIGKILL"), timeoutMs);
  const result = await new Promise<{ code: number; signal: NodeJS.Signals | null }>((resolveExit) => child.once("close", (code, signal) => resolveExit({ code: code ?? -1, signal })));
  clearTimeout(timer);
  return { ...result, stdout, stderr };
}

test("self-contained repository runner proves Job-Object child and grandchild containment", { timeout: 180_000 }, async (context) => {
  if (process.platform !== "win32") return context.skip("Windows Job Object verification runs on Windows.");
  const root = await mkdtemp(join(tmpdir(), "sxsy-b122-repository-runner-build-"));
  context.after(async () => { await rm(root, { recursive: true, force: true }); });
  const publish = join(root, "publish");
  const cliHome = join(root, "dotnet-home");
  const appData = join(root, "appdata");
  const dotnet = await access(localDotnet).then(() => localDotnet).catch(() => "dotnet.exe");
  const environment = {
    ...process.env,
    DOTNET_CLI_HOME: cliHome,
    DOTNET_NOLOGO: "1",
    DOTNET_SKIP_FIRST_TIME_EXPERIENCE: "1",
    APPDATA: appData,
    NUGET_PACKAGES: join(repositoryRoot, ".tools", "nuget-packages")
  };
  const built = await command(dotnet, ["publish", project, "-c", "Release", "-r", "win-x64", "--self-contained", "true", "-p:PublishSingleFile=true", "-o", publish, "--configfile", join(repositoryRoot, ".tools", "NuGet.Config")], environment, 120_000);
  assert.equal(built.code, 0, built.stderr || built.stdout);
  const helper = join(publish, "b122-repository-runner.exe");
  const helperDigest = createHash("sha256").update(await readFile(helper)).digest("hex");
  const selfTest = await command(helper, ["--self-test"], {}, 30_000);
  assert.equal(selfTest.code, 0, selfTest.stderr || selfTest.stdout);
  const receipt = JSON.parse(selfTest.stdout) as Record<string, unknown>;
  assert.equal(receipt.schema, "sxsy-b122.repository-runner-self-test");
  assert.equal(receipt.jobObjectCreated, true);
  assert.equal(receipt.childStartedSuspended, true);
  assert.equal(receipt.grandchildObserved, true);
  assert.equal(receipt.killOnClose, true);
  assert.equal(receipt.childTreeTerminated, true);
  assert.equal(receipt.noSurvivors, true);
  assert.match((await readFile(project, "utf8")), /RuntimeFrameworkVersion>8\.0\.30</);

  const recipeIds = [
    "full_sandbox",
    "rebuild_full_sandbox",
    "quarantine",
    "pipeline_local_gate",
    "pipeline_clean_reproduction",
    "shield_change_scan",
    "shield_codebase_audit",
    "shield_supply_chain",
    "release_shield"
  ] as const;
  for (const recipeId of recipeIds) {
    const inputRoot = join(root, `missing-${recipeId}-input`);
    const workRoot = join(root, `missing-${recipeId}-work`);
    await Promise.all([mkdir(inputRoot), mkdir(workRoot)]);
    const unavailable = await command(helper, ["--recipe", recipeId, inputRoot, workRoot, "0".repeat(64)], {}, 10_000);
    assert.equal(unavailable.code, 78, `${recipeId}: ${unavailable.stderr || unavailable.stdout}`);
    const evidence = JSON.parse(await readFile(join(workRoot, "b122-recipe-evidence.json"), "utf8")) as Record<string, unknown>;
    assert.equal(evidence.recipeId, recipeId);
    assert.equal(evidence.outcome, "incomplete");
    assert.deepEqual(evidence.unavailableDimensions, ["reviewed_recipe_configuration"]);
  }

  const recipeInput = join(root, "recipe-input");
  const recipeWork = join(root, "recipe-work");
  const recipeTools = join(recipeInput, "tools");
  const recipeConfigDirectory = join(recipeInput, ".b122");
  await Promise.all([mkdir(recipeTools, { recursive: true }), mkdir(recipeConfigDirectory, { recursive: true }), mkdir(recipeWork)]);
  const recipeHelper = join(recipeTools, "b122-repository-runner.exe");
  await copyFile(helper, recipeHelper);
  const recipeHelperDigest = createHash("sha256").update(await readFile(recipeHelper)).digest("hex");
  const recipeDefinition = {
    executable: "tools/b122-repository-runner.exe",
    executableSha256: recipeHelperDigest,
    arguments: ["--self-test"],
    workingRoot: "input",
    workingDirectory: ".",
    environment: {},
    timeoutMs: 30_000,
    maxOutputBytes: 32_768,
    coverage: [
      { dimension: "correctness", fixtureId: "self-test:v1" },
      { dimension: "isolation", fixtureId: "job-object:v1" },
      { dimension: "production_data", fixtureId: "sandbox-input:v1" },
      { dimension: "ambient_credentials", fixtureId: "minimal-env:v1" }
    ],
    scannerFixtureIds: [],
    advisoryFixtureIds: []
  };
  const recipeConfigPath = join(recipeConfigDirectory, "sandbox-recipes-v1.json");
  const secretWork = join(root, "secret-recipe-work");
  await mkdir(secretWork);
  const unsafeConfig = JSON.stringify({
    schema: "sxsy-b122.typed-recipes",
    version: 1,
    recipes: { pipeline_local_gate: { ...recipeDefinition, environment: { API_TOKEN: "must-not-cross-boundary" } } }
  });
  await writeFile(recipeConfigPath, unsafeConfig, "utf8");
  const unsafeRun = await command(helper, ["--recipe", "pipeline_local_gate", recipeInput, secretWork, createHash("sha256").update(unsafeConfig).digest("hex")], {}, 10_000);
  assert.notEqual(unsafeRun.code, 0, "secret-bearing environment names must fail closed");

  const recipeConfig = JSON.stringify({
    schema: "sxsy-b122.typed-recipes",
    version: 1,
    recipes: {
      pipeline_local_gate: recipeDefinition
    }
  });
  await writeFile(recipeConfigPath, recipeConfig, "utf8");
  const recipeConfigDigest = createHash("sha256").update(recipeConfig).digest("hex");
  const recipeRun = await command(helper, ["--recipe", "pipeline_local_gate", recipeInput, recipeWork, recipeConfigDigest], {}, 45_000);
  assert.equal(recipeRun.code, 0, recipeRun.stderr || recipeRun.stdout);
  const recipeEvidence = JSON.parse(await readFile(join(recipeWork, "b122-recipe-evidence.json"), "utf8")) as Record<string, unknown>;
  assert.equal(recipeEvidence.schema, "sxsy-b122.typed-recipe-result");
  assert.equal(recipeEvidence.recipeId, "pipeline_local_gate");
  assert.equal(recipeEvidence.outcome, "completed");
  assert.equal(recipeEvidence.configurationSha256, recipeConfigDigest);
  assert.equal(recipeEvidence.helperSha256, helperDigest);
  assert.equal(recipeEvidence.toolSha256, recipeHelperDigest);
  assert.deepEqual(recipeEvidence.unavailableDimensions, []);

  const repository = join(root, "repository");
  const stateRoot = join(root, "state");
  const marker = join(repository, "grandchild.json");
  await Promise.all([mkdir(repository), mkdir(stateRoot)]);
  await writeFile(join(repository, "tree.mjs"), [
    "import { spawn } from 'node:child_process';",
    "import { writeFile } from 'node:fs/promises';",
    "const child=spawn(process.execPath,['-e','setInterval(()=>{},1000)'],{stdio:'ignore',windowsHide:true});",
    "await writeFile(process.argv[2],JSON.stringify({grandchildPid:child.pid}),'utf8');",
    "setInterval(()=>{},1000);"
  ].join("\n"), "utf8");
  const executableDigest = createHash("sha256").update(await readFile(process.execPath)).digest("hex");
  const supervisor = new WindowsJobObjectProcessSupervisor({ helperPath: helper, helperSha256: helperDigest, stateRoot });
  const managed = await supervisor.start({
    action: "run_target",
    operationId: "operation-native-job-test",
    repositoryRoot: repository,
    manifestSha256: "a".repeat(64),
    executable: process.execPath,
    executableSha256: executableDigest,
    args: ["tree.mjs", marker],
    cwd: repository,
    environment: { SystemRoot: process.env.SystemRoot ?? "C:\\Windows", WINDIR: process.env.WINDIR ?? "C:\\Windows" },
    lifecycle: "managed",
    timeoutMs: 30_000,
    maxOutputBytes: 4_096
  });
  const markerDeadline = Date.now() + 5_000;
  while (Date.now() < markerDeadline) {
    if (await access(marker).then(() => true).catch(() => false)) break;
    await new Promise((resolveDelay) => setTimeout(resolveDelay, 25));
  }
  const grandchildPid = (JSON.parse(await readFile(marker, "utf8")) as { grandchildPid: number }).grandchildPid;
  const recovered = await new WindowsJobObjectProcessSupervisor({ helperPath: helper, helperSha256: helperDigest, stateRoot }).recover({ repositoryRoot: repository, manifestSha256: "a".repeat(64) });
  assert.equal(recovered.length, 1);
  assert.equal(recovered[0]?.supervisorId, managed.supervisorId);
  await recovered[0]!.terminateTree(50, 2_000);
  await managed.wait();
  const goneDeadline = Date.now() + 5_000;
  while (Date.now() < goneDeadline && (alive(managed.pid) || alive(grandchildPid))) await new Promise((resolveDelay) => setTimeout(resolveDelay, 25));
  assert.equal(alive(managed.pid), false);
  assert.equal(alive(grandchildPid), false);
});

function alive(pid: number): boolean {
  try { process.kill(pid, 0); return true; }
  catch { return false; }
}
