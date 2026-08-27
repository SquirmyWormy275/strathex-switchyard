import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { createHash, generateKeyPairSync } from "node:crypto";
import { access, copyFile, mkdir, mkdtemp, readFile, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import { ProtectedJsonStore } from "../../../packages/control-plane/src/store.ts";
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
    NUGET_PACKAGES: process.env.NUGET_PACKAGES ?? join(repositoryRoot, ".tools", "nuget-packages")
  };
  const built = await command(dotnet, ["publish", project, "-c", "Release", "-r", "win-x64", "--self-contained", "true", "-p:PublishSingleFile=true", "-p:UseSharedCompilation=false", "--disable-build-servers", "-o", publish, "--configfile", process.env.SXSY_B122_NUGET_CONFIG ?? join(repositoryRoot, ".tools", "NuGet.Config")], environment, 120_000);
  assert.equal(built.code, 0, built.stderr || built.stdout);
  const helper = join(publish, "b122-repository-runner.exe");
  const helperDigest = createHash("sha256").update(await readFile(helper)).digest("hex");
  const selfTest = await command(helper, ["--self-test"], {}, 30_000);
  assert.equal(selfTest.code, 0, selfTest.stderr || selfTest.stdout);
  const legacyHelperShape = await command(helper, ["--observe", join(root, "legacy.request.json"), join(root, "legacy.state.json")], {}, 5_000);
  assert.equal(legacyHelperShape.code, 64, "a helper invocation without the immutable request digest must fail closed");
  const receipt = JSON.parse(selfTest.stdout) as Record<string, unknown>;
  assert.equal(receipt.schema, "sxsy-b122.repository-runner-self-test");
  assert.equal(receipt.jobObjectCreated, true);
  assert.equal(receipt.childStartedSuspended, true);
  assert.equal(receipt.atomicJobAssignment, true);
  assert.equal(receipt.grandchildObserved, true);
  assert.equal(receipt.killOnClose, true);
  assert.equal(receipt.childTreeTerminated, true);
  assert.equal(receipt.noSurvivors, true);
  assert.match((await readFile(project, "utf8")), /RuntimeFrameworkVersion>8\.0\.30</);
  assert.match(await readFile(join(dirname(project), "Program.cs"), "utf8"), /trusted_bootstrap/, "the independently trusted installer action must remain explicitly allowlisted");

  const postCreateMarker = join(root, "post-create.json");
  const postCreate = spawn(helper, ["--self-test-post-create", postCreateMarker], { cwd: root, env: {}, shell: false, windowsHide: true, stdio: "ignore" });
  const postCreateClosed = new Promise<void>((resolveExit) => postCreate.once("close", () => resolveExit()));
  try {
    const postCreateDeadline = Date.now() + 5_000;
    while (Date.now() < postCreateDeadline && !(await access(postCreateMarker).then(() => true).catch(() => false))) await new Promise((resolveDelay) => setTimeout(resolveDelay, 25));
    const postCreateReceipt = JSON.parse(await readFile(postCreateMarker, "utf8")) as { schema: string; supervisorPid: number; childPid: number; atomicallyAssigned: boolean };
    assert.equal(postCreateReceipt.schema, "sxsy-b122.repository-runner-post-create");
    assert.equal(postCreateReceipt.supervisorPid, postCreate.pid);
    assert.equal(postCreateReceipt.atomicallyAssigned, true);
    postCreate.kill("SIGKILL");
    await postCreateClosed;
    const postCreateGone = Date.now() + 5_000;
    while (Date.now() < postCreateGone && alive(postCreateReceipt.childPid)) await new Promise((resolveDelay) => setTimeout(resolveDelay, 25));
    assert.equal(alive(postCreateReceipt.childPid), false, "a supervisor killed immediately after CreateProcess must not strand its suspended child");
  } finally {
    if (postCreate.exitCode === null && postCreate.signalCode === null) postCreate.kill("SIGKILL");
    await Promise.race([postCreateClosed, new Promise((resolveDelay) => setTimeout(resolveDelay, 5_000))]);
  }

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

  const linkedRepository = join(root, "linked-repository");
  const linkedOutside = join(root, "linked-outside");
  const linkedWorkingDirectory = join(linkedRepository, "working-link");
  await Promise.all([mkdir(linkedRepository), mkdir(linkedOutside)]);
  await symlink(linkedOutside, linkedWorkingDirectory, "junction");
  const linkedStatePath = join(root, "linked-supervisor.state.json");
  const linkedRequestPath = join(root, "linked-supervisor.request.json");
  await writeFile(linkedRequestPath, JSON.stringify({
    schema: "sxsy-b122.repository-supervisor-request",
    version: 3,
    supervisorId: `managed:${"e".repeat(64)}`,
    operationId: "operation-linked-working-directory",
    action: "run_target",
    targetSnapshotId: "b".repeat(64),
    sessionId: null,
    authorityId: null,
    repositoryRoot: linkedRepository,
    manifestSha256: "a".repeat(64),
    helperPath: helper,
    helperSha256: helperDigest,
    executable: process.execPath,
    executableSha256: createHash("sha256").update(await readFile(process.execPath)).digest("hex"),
    arguments: ["--version"],
    workingDirectory: linkedWorkingDirectory,
    environment: { SystemRoot: process.env.SystemRoot ?? "C:\\Windows", WINDIR: process.env.WINDIR ?? "C:\\Windows" },
    lifecycle: "foreground",
    timeoutMs: 5_000,
    maxOutputBytes: 4_096,
    controlToken: "c".repeat(64),
    statePath: linkedStatePath,
    bindingAckPath: join(root, `${"e".repeat(64)}.binding-ack`),
    terminalPath: join(root, `${"e".repeat(64)}.terminal.json`)
  }), "utf8");
  const linkedRequestDigest = createHash("sha256").update(await readFile(linkedRequestPath)).digest("hex");
  const linkedLaunch = await command(helper, ["--supervise", linkedRequestPath, linkedStatePath, linkedRequestDigest], {}, 10_000);
  assert.notEqual(linkedLaunch.code, 0, "the final native helper must reject a reparse-point working directory before CreateProcess");
  assert.equal(await access(linkedStatePath).then(() => true).catch(() => false), false);

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
  const protectedStore = new ProtectedJsonStore({
    filePath: join(root, "protected.jsonl"),
    authenticator: { provider: "native-test", async seal(hash) { return `sealed:${hash}`; }, async verify(hash, tag) { return tag === `sealed:${hash}`; } },
    requireAuthenticatedProtection: true
  });
  const supervisor = new WindowsJobObjectProcessSupervisor({ helperPath: helper, helperSha256: helperDigest, stateRoot, protectedStore });
  const managed = await supervisor.start({
    action: "run_target",
    operationId: "operation-native-job-test",
    targetSnapshotId: "b".repeat(64),
    sessionId: "session-native-job-test",
    authorityId: "authority-native-job-test",
    repositoryRoot: repository,
    manifestSha256: "a".repeat(64),
    executable: process.execPath,
    executableSha256: executableDigest,
    args: ["tree.mjs", marker],
    cwd: repository,
    environment: { SystemRoot: process.env.SystemRoot ?? "C:\\Windows", WINDIR: process.env.WINDIR ?? "C:\\Windows" },
    lifecycle: "managed",
    timeoutMs: 10_000,
    maxOutputBytes: 4_096
  });
  let managedStderr = "";
  managed.stderr.on("data", (chunk: Buffer | string) => { managedStderr += chunk.toString(); });
  const requestPath = join(stateRoot, `${managed.supervisorId.slice("managed:".length)}.request.json`);
  const statePath = join(stateRoot, `${managed.supervisorId.slice("managed:".length)}.state.json`);
  const persistedRequest = JSON.parse(await readFile(requestPath, "utf8")) as Record<string, unknown>;
  const boundHelperPath = String(persistedRequest.helperPath);
  const boundStatePath = String(persistedRequest.statePath);
  const persistedState = JSON.parse(await readFile(statePath, "utf8")) as Record<string, unknown>;
  assert.equal(persistedRequest.version, 3);
  assert.equal(persistedRequest.targetSnapshotId, "b".repeat(64));
  assert.equal(persistedState.version, 3);
  assert.equal(persistedState.targetSnapshotId, "b".repeat(64));

  const legacyRoot = join(root, "legacy-state");
  await mkdir(legacyRoot);
  const legacyRequestPath = join(legacyRoot, `${"d".repeat(64)}.request.json`);
  const legacyStatePath = join(legacyRoot, `${"d".repeat(64)}.state.json`);
  const legacyRequest: Record<string, unknown> = {
    ...persistedRequest,
    version: 1,
    supervisorId: `managed:${"d".repeat(64)}`,
    operationId: "legacy-unbound-operation",
    statePath: legacyStatePath
  };
  delete legacyRequest.targetSnapshotId;
  await writeFile(legacyRequestPath, JSON.stringify(legacyRequest), "utf8");
  const legacyRequestDigest = createHash("sha256").update(await readFile(legacyRequestPath)).digest("hex");
  const legacy = await command(helper, ["--supervise", legacyRequestPath, legacyStatePath, legacyRequestDigest], {}, 5_000);
  assert.notEqual(legacy.code, 0, "a v1 request without an exact target binding must fail closed");
  assert.equal(await access(legacyStatePath).then(() => true).catch(() => false), false);
  const markerDeadline = Date.now() + 5_000;
  while (Date.now() < markerDeadline) {
    if (await access(marker).then(() => true).catch(() => false)) break;
    await new Promise((resolveDelay) => setTimeout(resolveDelay, 25));
  }
  assert.equal(await access(marker).then(() => true).catch(() => false), true, managedStderr || "the signed native supervisor did not release its child after the protected binding acknowledgement");
  const grandchildPid = (JSON.parse(await readFile(marker, "utf8")) as { grandchildPid: number }).grandchildPid;
  const originalRequestBytes = await readFile(requestPath);
  const requestSha256 = createHash("sha256").update(originalRequestBytes).digest("hex");
  const changedRequest = { ...persistedRequest, targetSnapshotId: "c".repeat(64) };
  await writeFile(requestPath, JSON.stringify(changedRequest), "utf8");
  const changedRequestObservation = await command(boundHelperPath, ["--observe", requestPath, boundStatePath, requestSha256], {}, 5_000);
  assert.equal(changedRequestObservation.code, 65, "a same-user request rewrite must not change the helper's operation/action/target/root binding");
  await writeFile(requestPath, originalRequestBytes);
  const rawRunningState = await readFile(boundStatePath, "utf8");
  const forgedTerminalState = rawRunningState.replace('"state":"running"', '"state":"completed"').replace('"exitCode":null', '"exitCode":0');
  assert.notEqual(forgedTerminalState, rawRunningState, "native state fixture must actually forge both terminal fields");
  await writeFile(boundStatePath, forgedTerminalState, "utf8");
  const forgedObservation = await command(boundHelperPath, ["--observe", requestPath, boundStatePath, requestSha256], {}, 5_000);
  assert.equal(forgedObservation.code, 0, `an active exact Job must override a same-user child-forged terminal state file: ${forgedObservation.stderr || forgedObservation.stdout}`);
  const recovered = await new WindowsJobObjectProcessSupervisor({ helperPath: helper, helperSha256: helperDigest, stateRoot, protectedStore }).recover({ repositoryRoot: repository, manifestSha256: "a".repeat(64) });
  assert.equal(recovered.length, 1);
  assert.equal(recovered[0]?.supervisorId, managed.supervisorId);
  assert.equal(recovered[0]?.targetSnapshotId, "b".repeat(64));
  const live = await supervisor.observeOperation({ operationId: "operation-native-job-test", action: "run_target", targetSnapshotId: "b".repeat(64), repositoryRoot: repository, manifestSha256: "a".repeat(64), sessionId: "session-native-job-test", authorityId: "authority-native-job-test" });
  assert.equal(live.state, "active");
  assert.equal((await supervisor.observeOperation({ operationId: "operation-native-job-test", action: "run_target", targetSnapshotId: "c".repeat(64), repositoryRoot: repository, manifestSha256: "a".repeat(64), sessionId: "session-native-job-test", authorityId: "authority-native-job-test" })).state, "not_owner");
  assert.equal((await supervisor.observeOperation({ operationId: "operation-native-job-test", action: "run_target", targetSnapshotId: "b".repeat(64), repositoryRoot: repository, manifestSha256: "a".repeat(64), sessionId: "wrong-session", authorityId: "authority-native-job-test" })).state, "not_owner");
  await recovered[0]!.terminateTree(50, 2_000);
  await managed.wait();
  const terminalPath = String(persistedRequest.terminalPath);
  const signingPublicKeySpki = String(persistedState.signingPublicKeySpki);
  const signingPublicKeySha256 = String(persistedState.signingPublicKeySha256);
  const verifiedTerminal = await command(helper, ["--verify-terminal", terminalPath, signingPublicKeySpki, signingPublicKeySha256], {}, 5_000);
  assert.equal(verifiedTerminal.code, 0, verifiedTerminal.stderr || verifiedTerminal.stdout);
  const originalTerminalBytes = await readFile(terminalPath);
  const forgedTerminal = JSON.parse(originalTerminalBytes.toString("utf8")) as { signature: string };
  forgedTerminal.signature = `${forgedTerminal.signature.slice(0, -2)}AA`;
  await writeFile(terminalPath, JSON.stringify(forgedTerminal), "utf8");
  const forgedTerminalVerification = await command(helper, ["--verify-terminal", terminalPath, signingPublicKeySpki, signingPublicKeySha256], {}, 5_000);
  assert.notEqual(forgedTerminalVerification.code, 0, "a forged terminal signature must fail closed");
  await writeFile(terminalPath, originalTerminalBytes);
  const alternateKey = generateKeyPairSync("ec", { namedCurve: "prime256v1" }).publicKey.export({ format: "der", type: "spki" });
  const alternateSpki = alternateKey.toString("base64");
  const alternateSpkiSha256 = createHash("sha256").update(alternateKey).digest("hex");
  const substitutedKeyVerification = await command(helper, ["--verify-terminal", terminalPath, alternateSpki, alternateSpkiSha256], {}, 5_000);
  assert.notEqual(substitutedKeyVerification.code, 0, "a substituted terminal signing key must fail closed");
  const restartedTerminalSupervisor = new WindowsJobObjectProcessSupervisor({ helperPath: helper, helperSha256: helperDigest, stateRoot, protectedStore });
  const terminalBinding = { operationId: "operation-native-job-test", action: "run_target" as const, targetSnapshotId: "b".repeat(64), repositoryRoot: repository, manifestSha256: "a".repeat(64), sessionId: "session-native-job-test", authorityId: "authority-native-job-test" };
  const terminalAfterRestart = await restartedTerminalSupervisor.observeOperation(terminalBinding);
  assert.equal(terminalAfterRestart.state, "terminal", "the native helper signature must preserve exact terminal truth after the companion disappears");
  if (terminalAfterRestart.state !== "terminal") throw new Error("expected signed terminal recovery");
  assert.equal(terminalAfterRestart.effectDisposition, "committed");
  assert.deepEqual(await restartedTerminalSupervisor.observeOperation(terminalBinding), terminalAfterRestart, "repeated reconciliation must settle identically without redispatch");
  assert.deepEqual(await restartedTerminalSupervisor.recover({ repositoryRoot: repository, manifestSha256: "a".repeat(64) }), [], "terminal processes must never be recovered as live work");
  const goneDeadline = Date.now() + 5_000;
  while (Date.now() < goneDeadline && (alive(managed.pid) || alive(grandchildPid))) await new Promise((resolveDelay) => setTimeout(resolveDelay, 25));
  assert.equal(alive(managed.pid), false);
  assert.equal(alive(grandchildPid), false);
});

function alive(pid: number): boolean {
  try { process.kill(pid, 0); return true; }
  catch { return false; }
}
