import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import {
  access,
  copyFile,
  lstat,
  mkdir,
  mkdtemp,
  readFile,
  readdir,
  realpath,
  rename,
  rm,
  stat,
  writeFile
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import test from "node:test";

import {
  WINDOWS_SANDBOX_EXECUTABLE,
  WindowsSandboxBackend,
  WindowsSandboxIsolationRuntime,
  type WindowsSandboxEffectGuard,
  type WindowsSandboxFeatureProbe,
  type WindowsSandboxFileSystem,
  type WindowsSandboxLifecycleController,
  type WindowsSandboxProcessIdentity,
  type WindowsSandboxProcessRunner,
  type WindowsSandboxRunSpec
} from "../src/windows-sandbox.ts";

class InjectedFileSystem implements WindowsSandboxFileSystem {
  readonly writes: string[] = [];
  async mkdir(path: string): Promise<void> { await mkdir(path, { recursive: true }); }
  async realpath(path: string): Promise<string> { return realpath(path); }
  async stat(path: string) {
    if (path === WINDOWS_SANDBOX_EXECUTABLE) return { isFile: true, isDirectory: false, isSymbolicLink: false, size: 1 };
    const value = await stat(path);
    return { isFile: value.isFile(), isDirectory: value.isDirectory(), isSymbolicLink: false, size: value.size };
  }
  async lstat(path: string) {
    if (path === WINDOWS_SANDBOX_EXECUTABLE) return { isFile: true, isDirectory: false, isSymbolicLink: false, size: 1 };
    const value = await lstat(path);
    return { isFile: value.isFile(), isDirectory: value.isDirectory(), isSymbolicLink: value.isSymbolicLink(), size: value.size };
  }
  async readBytes(path: string): Promise<Uint8Array> { return readFile(path); }
  async readText(path: string): Promise<string> { return readFile(path, "utf8"); }
  async readDirectory(path: string): Promise<readonly string[]> { return readdir(path); }
  async writeBytes(path: string, contents: Uint8Array): Promise<void> { this.writes.push(path); await writeFile(path, contents); }
  async writeText(path: string, contents: string): Promise<void> { this.writes.push(path); await writeFile(path, contents, "utf8"); }
  async rename(from: string, to: string): Promise<void> { await rename(from, to); }
  async copyFile(from: string, to: string): Promise<void> { await copyFile(from, to); }
  async remove(path: string): Promise<void> { await rm(path, { recursive: true, force: true }); }
}

const available: WindowsSandboxFeatureProbe = {
  async check() { return { available: true, reason: "fake Windows Sandbox feature enabled" }; }
};

async function fixture(context: test.TestContext) {
  const base = await mkdtemp(join(tmpdir(), "sxsy-b122-windows-sandbox-"));
  const targetRoot = join(base, "repository");
  const stateRoot = join(base, "state");
  const toolsRoot = join(base, "tools");
  const destinationRoot = join(base, "validated-results");
  await Promise.all([mkdir(targetRoot), mkdir(stateRoot), mkdir(toolsRoot), mkdir(destinationRoot)]);
  await writeFile(join(targetRoot, "sandbox-job.json"), JSON.stringify({ version: 1 }), "utf8");
  await writeFile(join(toolsRoot, "b122-sandbox-worker.exe"), "fixture", "utf8");
  context.after(async () => { await rm(base, { recursive: true, force: true }); });
  return { base, targetRoot, stateRoot, toolsRoot, destinationRoot };
}

function allowGuard(calls: string[]): WindowsSandboxEffectGuard {
  return {
    async check(input) {
      calls.push(input.phase);
      return { allowed: true, reason: "test containment lease is current" };
    }
  };
}

function sha256(contents: Uint8Array | string): string {
  return createHash("sha256").update(contents).digest("hex");
}

async function sandboxRequest(setup: Awaited<ReturnType<typeof fixture>>, overrides: Readonly<Record<string, unknown>> = {}) {
  return {
    targetRoot: setup.targetRoot,
    destinationRoot: setup.destinationRoot,
    expectedRecipeCatalogSha256: sha256(await readFile(join(setup.targetRoot, "sandbox-job.json"))),
    expectedHelperSha256: sha256(await readFile(join(setup.toolsRoot, "b122-sandbox-worker.exe"))),
    ...overrides
  };
}

function successfulRunner(assertSpec?: (spec: WindowsSandboxRunSpec) => Promise<void> | void): WindowsSandboxProcessRunner {
  return {
    async run(spec, signal, onStarted) {
      assert.equal(signal.aborted, false);
      await assertSpec?.(spec);
      await onStarted(4242);
      const exchangeRoot = join(dirname(spec.args[0]!), "exchange");
      const request = JSON.parse(await readFile(join(exchangeRoot, "request.json"), "utf8")) as Record<string, unknown>;
      const outputRoot = join(exchangeRoot, "output");
      const contents = Buffer.from("validated sandbox result", "utf8");
      await mkdir(outputRoot, { recursive: true });
      await writeFile(join(outputRoot, "report.txt"), contents);
      await writeFile(join(exchangeRoot, "result-manifest.json"), JSON.stringify({
        schema: "sxsy-b122.windows-sandbox-result",
        version: 2,
        requestId: request.requestId,
        leaseId: request.leaseId,
        recipeId: request.recipeId,
        profile: request.profile,
        recipeCatalogDigest: request.recipeCatalogDigest,
        resourcePolicyDigest: request.resourcePolicyDigest,
        outcome: "completed",
        summary: "sandbox helper completed",
        resourceEnforcement: {
          jobObject: true,
          cpuHardCap: true,
          memoryLimit: true,
          processLimit: true,
          noSurvivors: true,
          activeProcessesAfterCleanup: 0
        },
        outputs: [{ path: "report.txt", size: contents.byteLength, sha256: sha256(contents) }]
      }), "utf8");
      return { pid: 4242, exitCode: 0, stdout: "x".repeat(100_000), stderr: "", timedOut: false, cancelled: false, outputTruncated: false, hostProcessContained: true };
    }
  };
}

function createBackend(
  setup: Awaited<ReturnType<typeof fixture>>,
  runner: WindowsSandboxProcessRunner,
  guardCalls: string[],
  overrides: Partial<ConstructorParameters<typeof WindowsSandboxBackend>[0]> = {}
) {
  return new WindowsSandboxBackend({
    allowedTaskRoots: [setup.base],
    stateRoot: setup.stateRoot,
    helperDirectory: setup.toolsRoot,
    helperFilename: "b122-sandbox-worker.exe",
    jobManifestRelativePath: "sandbox-job.json",
    effectGuard: allowGuard(guardCalls),
    featureProbe: available,
    runner,
    filesystem: new InjectedFileSystem(),
    idFactory: () => "11111111-2222-4333-8444-555555555555",
    now: () => new Date("2026-08-23T12:00:00.000Z"),
    timeoutMs: 5_000,
    maxProcessOutputBytes: 256,
    maxExtractedBytes: 1_024,
    ...overrides
  });
}

test("fails closed before launch when the Windows Sandbox feature is unavailable", async (context) => {
  const setup = await fixture(context);
  let launches = 0;
  const backend = createBackend(setup, { async run() { launches += 1; throw new Error("must not run"); } }, [], {
    featureProbe: { async check() { return { available: false, reason: "Containers-DisposableClientVM is disabled" }; } }
  });
  const result = await backend.run(await sandboxRequest(setup));
  assert.equal(result.status, "unavailable");
  assert.match(result.summary, /disabled/i);
  assert.equal(launches, 0);
});

test("launches the fixed Windows Sandbox executable without a shell and extracts only validated quarantine output", async (context) => {
  const setup = await fixture(context);
  const guardCalls: string[] = [];
  let configuration = "";
  const backend = createBackend(setup, successfulRunner(async (spec) => {
    assert.equal(spec.executable, WINDOWS_SANDBOX_EXECUTABLE);
    assert.equal(spec.shell, false);
    assert.deepEqual(spec.args.length, 1);
    assert.equal(spec.timeoutMs, 5_000);
    assert.equal(spec.maxOutputBytes, 256);
    configuration = await readFile(spec.args[0]!, "utf8");
  }), guardCalls);

  const result = await backend.run(await sandboxRequest(setup));
  assert.equal(result.status, "completed", result.summary);
  assert.equal(result.leaseId, "sandbox:11111111-2222-4333-8444-555555555555");
  assert.equal(result.processId, "sandbox-process:11111111-2222-4333-8444-555555555555");
  assert.equal(result.resultManifestSha256?.length, 64);
  assert.equal(result.recipeCatalogSha256, (await sandboxRequest(setup)).expectedRecipeCatalogSha256);
  assert.equal(result.sandboxHelperSha256, (await sandboxRequest(setup)).expectedHelperSha256);
  assert.deepEqual(result.validatedOutputs, [{ path: "report.txt", size: Buffer.byteLength("validated sandbox result"), sha256: sha256("validated sandbox result") }]);
  assert.deepEqual(guardCalls, ["launch", "extract"]);
  assert.match(configuration, /<Networking>Disable<\/Networking>/);
  assert.match(configuration, /<VGpu>Disable<\/VGpu>/);
  assert.match(configuration, /<MemoryInMB>4096<\/MemoryInMB>/);
  assert.match(configuration, /<ReadOnly>true<\/ReadOnly>/);
  assert.match(configuration, /C:\\B122\\tools\\b122-sandbox-worker\.exe/);
  assert.doesNotMatch(configuration, /powershell|cmd\.exe|wscript/i);
  assert.equal(await readFile(join(result.resultRoot!, "report.txt"), "utf8"), "validated sandbox result");

  const receipt = JSON.parse(await readFile(result.receiptPath!, "utf8")) as Record<string, unknown>;
  assert.equal(receipt.state, "completed");
  assert.equal(receipt.hostPid, 4242);
  assert.equal(receipt.processOutputTruncated, true);
  assert.equal(receipt.resultRoot, result.resultRoot);
  assert.equal(receipt.profile, "full_sandbox");
  assert.equal(receipt.cleanupVerified, true);
  await assert.rejects(access(join(dirname(result.receiptPath!), "exchange")));
});

test("full, fresh-full, and quarantine emit distinct fixed resource profiles and only fresh/full map host-approved persistence", async (context) => {
  const setup = await fixture(context);
  const persistent = join(setup.base, "approved-cache");
  await mkdir(persistent);
  const configurations = new Map<string, string>();
  const requests = new Map<string, Record<string, unknown>>();
  let invocation = 0;
  const ids = [
    "11111111-2222-4333-8444-555555555555",
    "22222222-2222-4333-8444-555555555555",
    "33333333-2222-4333-8444-555555555555"
  ];
  const runner = successfulRunner(async (spec) => {
    const config = await readFile(spec.args[0], "utf8");
    const exchange = join(dirname(spec.args[0]), "exchange");
    const request = JSON.parse(await readFile(join(exchange, "request.json"), "utf8")) as Record<string, unknown>;
    configurations.set(String(request.profile), config);
    requests.set(String(request.profile), request);
  });
  const backend = createBackend(setup, runner, [], {
    idFactory: () => ids[invocation++]!,
    approvedPersistentVolumes: [{ id: "build-cache", hostRoot: persistent }]
  });

  for (const [profile, recipeId] of [
    ["full_sandbox", "full_sandbox"],
    ["fresh_full_sandbox", "rebuild_full_sandbox"],
    ["quarantine", "quarantine"]
  ] as const) {
    const result = await backend.run(await sandboxRequest(setup, { profile, recipeId }));
    assert.equal(result.status, "completed");
  }

  assert.match(configurations.get("full_sandbox")!, /<MemoryInMB>4096<\/MemoryInMB>/);
  assert.match(configurations.get("fresh_full_sandbox")!, /<MemoryInMB>4096<\/MemoryInMB>/);
  assert.match(configurations.get("quarantine")!, /<MemoryInMB>2048<\/MemoryInMB>/);
  assert.match(configurations.get("fresh_full_sandbox")!, /C:\\B122\\persistent\\build-cache/);
  assert.match(configurations.get("fresh_full_sandbox")!, /approved-cache/);
  assert.doesNotMatch(configurations.get("quarantine")!, /approved-cache|B122\\persistent/);
  assert.deepEqual((requests.get("quarantine")!.resourcePolicy as Record<string, unknown>), {
    cpuRatePercent: 25,
    jobMemoryMiB: 1536,
    processMemoryMiB: 512,
    activeProcessLimit: 8,
    wallTimeMs: 5_000
  });
  assert.match(String(requests.get("quarantine")!.resourcePolicyDigest), /^[a-f0-9]{64}$/);
});

test("fails closed when the host process boundary or guest resource receipt cannot prove no survivors", async (context) => {
  const setup = await fixture(context);
  const hostUncontained: WindowsSandboxProcessRunner = {
    async run(spec, signal, onStarted) {
      const result = await successfulRunner().run(spec, signal, onStarted);
      return { ...result, hostProcessContained: false };
    }
  };
  const backend = createBackend(setup, hostUncontained, []);
  const result = await backend.run(await sandboxRequest(setup, { profile: "quarantine", recipeId: "quarantine" }));
  assert.equal(result.status, "failed");
  assert.match(result.summary, /containment|survivor/i);

  const second = await fixture(context);
  const guestUnenforced: WindowsSandboxProcessRunner = {
    async run(spec, signal, onStarted) {
      const result = await successfulRunner().run(spec, signal, onStarted);
      const manifestPath = join(dirname(spec.args[0]), "exchange", "result-manifest.json");
      const manifest = JSON.parse(await readFile(manifestPath, "utf8")) as Record<string, unknown>;
      manifest.resourceEnforcement = {
        jobObject: true,
        cpuHardCap: false,
        memoryLimit: true,
        processLimit: true,
        noSurvivors: true,
        activeProcessesAfterCleanup: 0
      };
      await writeFile(manifestPath, JSON.stringify(manifest), "utf8");
      return result;
    }
  };
  const guestResult = await createBackend(second, guestUnenforced, []).run(await sandboxRequest(second, { profile: "quarantine", recipeId: "quarantine" }));
  assert.equal(guestResult.status, "failed");
  assert.match(guestResult.summary, /CPU|memory|process-count|survivor/i);
});

test("reconciles an expired crash receipt only after the recorded host process is absent", async (context) => {
  const setup = await fixture(context);
  const live = new Set([7001]);
  const runner: WindowsSandboxProcessRunner = {
    async run() { throw new Error("not used"); },
    async isProcessActive(pid) { return live.has(pid); }
  };
  const backend = createBackend(setup, runner, [], { now: () => new Date("2026-08-24T12:00:00.000Z") });
  const rawId = "aaaaaaaa-2222-4333-8444-555555555555";
  const leaseRoot = join(setup.stateRoot, "leases", rawId);
  await mkdir(join(leaseRoot, "exchange"), { recursive: true });
  await writeFile(join(leaseRoot, "sandbox.wsb"), "stale", "utf8");
  await writeFile(join(leaseRoot, "receipt.json"), JSON.stringify({
    schema: "sxsy-b122.windows-sandbox-receipt",
    version: 2,
    leaseId: `sandbox:${rawId}`,
    processId: `sandbox-process:${rawId}`,
    requestId: `sandbox-request:${rawId}`,
    recipeId: "quarantine",
    profile: "quarantine",
    state: "running",
    targetRoot: setup.targetRoot,
    destinationRoot: setup.destinationRoot,
    createdAt: "2026-08-24T11:00:00.000Z",
    updatedAt: "2026-08-24T11:00:01.000Z",
    deadline: "2026-08-24T11:01:00.000Z",
    hostPid: 7001,
    timedOut: false,
    cancelled: false,
    processOutput: "",
    processOutputTruncated: false,
    recipeCatalogDigest: "a".repeat(64),
    helperDigest: "b".repeat(64),
    resourcePolicyDigest: "c".repeat(64),
    requestDigest: "d".repeat(64),
    configurationDigest: "e".repeat(64),
    persistentVolumeIds: [],
    cleanupVerified: false,
    summary: "crashed while running"
  }), "utf8");

  const stillRunning = await backend.reconcile();
  assert.equal(stillRunning[0]?.state, "running");
  assert.equal(stillRunning[0]?.cleanupVerified, false);
  assert.equal((await readdir(leaseRoot)).includes("exchange"), true);

  live.clear();
  const recovered = await backend.reconcile();
  assert.equal(recovered[0]?.state, "failed");
  assert.equal(recovered[0]?.cleanupVerified, true);
  assert.equal((await readdir(leaseRoot)).includes("exchange"), false);
  const receipt = JSON.parse(await readFile(join(leaseRoot, "receipt.json"), "utf8")) as Record<string, unknown>;
  assert.equal(receipt.reconciledAt, "2026-08-24T12:00:00.000Z");
});

test("host-attested catalog and helper digests are rechecked immediately before launch", async (context) => {
  const setup = await fixture(context);
  let launches = 0;
  const backend = createBackend(setup, { async run() { launches += 1; throw new Error("must not launch changed bytes"); } }, []);
  const request = await sandboxRequest(setup);
  await writeFile(join(setup.targetRoot, "sandbox-job.json"), JSON.stringify({ version: 2 }), "utf8");
  const changedCatalog = await backend.run(request);
  assert.equal(changedCatalog.status, "blocked");
  assert.match(changedCatalog.summary, /catalog changed/i);

  await writeFile(join(setup.targetRoot, "sandbox-job.json"), JSON.stringify({ version: 1 }), "utf8");
  const fresh = await sandboxRequest(setup);
  await writeFile(join(setup.toolsRoot, "b122-sandbox-worker.exe"), "changed helper", "utf8");
  const changedHelper = await backend.run(fresh);
  assert.equal(changedHelper.status, "blocked");
  assert.match(changedHelper.summary, /helper changed/i);
  assert.equal(launches, 0);
});

test("the final launch effect guard runs after canonical rechecks and prevents process creation", async (context) => {
  const setup = await fixture(context);
  let launches = 0;
  const backend = createBackend(setup, { async run() { launches += 1; throw new Error("must not run"); } }, [], {
    effectGuard: { async check(input) { return { allowed: false, reason: `${input.phase} containment revoked` }; } }
  });
  const result = await backend.run(await sandboxRequest(setup));
  assert.equal(result.status, "blocked");
  assert.match(result.summary, /launch containment revoked/i);
  assert.equal(launches, 0);
});

test("invalid quarantine content fails closed without copying any output", async (context) => {
  const setup = await fixture(context);
  const runner: WindowsSandboxProcessRunner = {
    async run(spec, _signal, onStarted) {
      await onStarted(9);
      const exchangeRoot = join(dirname(spec.args[0]!), "exchange");
      const request = JSON.parse(await readFile(join(exchangeRoot, "request.json"), "utf8")) as Record<string, unknown>;
      await mkdir(join(exchangeRoot, "output"), { recursive: true });
      await writeFile(join(exchangeRoot, "output", "report.txt"), "tampered", "utf8");
      await writeFile(join(exchangeRoot, "result-manifest.json"), JSON.stringify({
        schema: "sxsy-b122.windows-sandbox-result",
        version: 2,
        requestId: request.requestId,
        leaseId: request.leaseId,
        recipeId: request.recipeId,
        profile: request.profile,
        recipeCatalogDigest: request.recipeCatalogDigest,
        resourcePolicyDigest: request.resourcePolicyDigest,
        outcome: "completed",
        summary: "untrusted",
        resourceEnforcement: {
          jobObject: true,
          cpuHardCap: true,
          memoryLimit: true,
          processLimit: true,
          noSurvivors: true,
          activeProcessesAfterCleanup: 0
        },
        outputs: [{ path: "report.txt", size: 8, sha256: "0".repeat(64) }]
      }), "utf8");
      return { pid: 9, exitCode: 0, stdout: "", stderr: "", timedOut: false, cancelled: false, outputTruncated: false, hostProcessContained: true };
    }
  };
  const backend = createBackend(setup, runner, []);
  const result = await backend.run(await sandboxRequest(setup));
  assert.equal(result.status, "failed");
  assert.match(result.summary, /digest/i);
  await assert.rejects(readFile(join(setup.destinationRoot, "sandbox-11111111-2222-4333-8444-555555555555", "report.txt")), /ENOENT/);
});

test("timeout and cancellation receipts remain bounded and never extract output", async (context) => {
  const setup = await fixture(context);
  for (const mode of ["timeout", "cancel"] as const) {
    const backend = createBackend(setup, {
      async run(_spec, _signal, onStarted) {
        await onStarted(mode === "timeout" ? 10 : 11);
        return {
          pid: mode === "timeout" ? 10 : 11,
          exitCode: null,
          stdout: "sensitive diagnostic ".repeat(100),
          stderr: "",
          timedOut: mode === "timeout",
          cancelled: mode === "cancel",
          outputTruncated: true,
          hostProcessContained: true
        };
      }
    }, [], { idFactory: () => mode === "timeout" ? "aaaaaaaa-2222-4333-8444-555555555555" : "bbbbbbbb-2222-4333-8444-555555555555" });
    const result = await backend.run(await sandboxRequest(setup));
    assert.equal(result.status, mode === "timeout" ? "timed_out" : "cancelled");
    const receipt = JSON.parse(await readFile(result.receiptPath!, "utf8")) as { processOutput: string };
    assert.ok(Buffer.byteLength(receipt.processOutput, "utf8") <= 256);
  }
});

test("rejects mapped roots outside the canonical task-owned allowlist", async (context) => {
  const setup = await fixture(context);
  const outside = await mkdtemp(join(tmpdir(), "sxsy-b122-outside-"));
  context.after(async () => { await rm(outside, { recursive: true, force: true }); });
  const backend = createBackend(setup, successfulRunner(), []);
  const result = await backend.run(await sandboxRequest(setup, { targetRoot: outside }));
  assert.equal(result.status, "blocked");
  assert.match(result.summary, /allowlisted task root/i);
});

test("a late extraction fence blocks all writes outside quarantine", async (context) => {
  const setup = await fixture(context);
  const phases: string[] = [];
  const backend = createBackend(setup, successfulRunner(), phases, {
    effectGuard: {
      async check(input) {
        phases.push(input.phase);
        return input.phase === "extract"
          ? { allowed: false, reason: "authority changed after sandbox exit" }
          : { allowed: true, reason: "launch allowed" };
      }
    }
  });
  const result = await backend.run(await sandboxRequest(setup));
  assert.equal(result.status, "blocked");
  assert.match(result.summary, /authority changed/i);
  assert.deepEqual(phases, ["launch", "extract"]);
  await assert.rejects(readFile(join(setup.destinationRoot, "sandbox-11111111-2222-4333-8444-555555555555", "report.txt")), /ENOENT/);
});

test("the control-plane wrapper claims enforcement only for a completed concrete receipt", async (context) => {
  const setup = await fixture(context);
  const backend = createBackend(setup, successfulRunner(), []);
  const runtime = new WindowsSandboxIsolationRuntime(backend, {
    destinationRoot: setup.destinationRoot,
    permitVerifier: { verifyPermit: () => true },
    recipeCatalogDigest: sha256(await readFile(join(setup.targetRoot, "sandbox-job.json"))),
    helperDigest: sha256(await readFile(join(setup.toolsRoot, "b122-sandbox-worker.exe")))
  });
  const outcome = await runtime.start({
    action: "full_sandbox",
    operationId: "operation-1",
    target: { id: "target-1", repositoryRoot: setup.targetRoot } as never,
    profile: "full_sandbox",
    permit: {} as never,
    effectGuard: { async assertCurrent() { return { allowed: true, reason: "exact target remains current" }; } }
  });
  assert.equal(outcome.status, "completed");
  assert.equal(outcome.data?.enforced, true);
  assert.equal(outcome.data?.backend, "windows-sandbox");
});

function processIdentity(pid: number, creationFileTimeUtc = "133801632000000000"): WindowsSandboxProcessIdentity {
  return {
    pid,
    creationFileTimeUtc,
    executablePath: WINDOWS_SANDBOX_EXECUTABLE,
    executableVolumeSerialNumber: "123456789",
    executableFileIndex: "987654321",
    sessionId: 1
  };
}

test("full sandbox creates once then enters the exact durable process after companion restart", async (context) => {
  const setup = await fixture(context);
  const identities = new Map<number, "same" | "absent" | "mismatch">();
  const effects: string[] = [];
  let launches = 0;
  let focuses = 0;
  const lifecycle: WindowsSandboxLifecycleController = {
    async launch(spec, configurationSha256, signal) {
      assert.equal(signal.aborted, false);
      assert.equal(spec.executable, WINDOWS_SANDBOX_EXECUTABLE);
      assert.match(configurationSha256, /^[a-f0-9]{64}$/);
      const configuration = await readFile(spec.args[0], "utf8");
      assert.doesNotMatch(configuration, /<LogonCommand>/);
      assert.match(configuration, /<Networking>Disable<\/Networking>/);
      launches += 1;
      const identity = processIdentity(8101);
      identities.set(identity.pid, "same");
      return identity;
    },
    async inspect(identity) { return identities.get(identity.pid) ?? "absent"; },
    async focus(identity) {
      assert.equal(identities.get(identity.pid), "same");
      focuses += 1;
      return { focused: true };
    },
    async terminate() { throw new Error("enter must not terminate"); }
  };
  const first = createBackend(setup, successfulRunner(), effects, { lifecycleController: lifecycle });
  const created = await first.run(await sandboxRequest(setup));
  assert.equal(created.status, "running", created.summary);
  assert.equal(created.lifecycleEffect, "created");
  assert.equal(launches, 1);

  const restarted = createBackend(setup, successfulRunner(), effects, { lifecycleController: lifecycle });
  const entered = await restarted.run(await sandboxRequest(setup));
  assert.equal(entered.status, "running", entered.summary);
  assert.equal(entered.lifecycleEffect, "entered");
  assert.equal(entered.leaseId, created.leaseId);
  assert.equal(launches, 1);
  assert.equal(focuses, 1);
  assert.deepEqual(effects, ["launch", "focus"]);

  const receipt = JSON.parse(await readFile(created.receiptPath!, "utf8")) as Record<string, unknown>;
  assert.equal(receipt.state, "running");
  assert.deepEqual(receipt.hostProcessIdentity, processIdentity(8101));
  assert.equal(receipt.cleanupVerified, false);
});

test("full sandbox refuses a reused PID identity and never focuses or launches around it", async (context) => {
  const setup = await fixture(context);
  let identityState: "same" | "mismatch" = "same";
  let launches = 0;
  let focuses = 0;
  const lifecycle: WindowsSandboxLifecycleController = {
    async launch() {
      launches += 1;
      return processIdentity(8201, "133801632000000001");
    },
    async inspect() { return identityState; },
    async focus() { focuses += 1; return { focused: true }; },
    async terminate() { throw new Error("must not terminate reused identity"); }
  };
  const backend = createBackend(setup, successfulRunner(), [], { lifecycleController: lifecycle });
  assert.equal((await backend.run(await sandboxRequest(setup))).status, "running");
  identityState = "mismatch";
  const refused = await backend.run(await sandboxRequest(setup));
  assert.equal(refused.status, "blocked");
  assert.match(refused.summary, /identity|reused/i);
  assert.equal(launches, 1);
  assert.equal(focuses, 0);
});

test("fresh full sandbox terminates only the exact old instance and preserves approved volumes", async (context) => {
  const setup = await fixture(context);
  const persistent = join(setup.base, "approved-build-cache");
  await mkdir(persistent);
  await writeFile(join(persistent, "keep.txt"), "preserve exactly", "utf8");
  const identities = new Map<number, "same" | "absent">();
  const launched: WindowsSandboxProcessIdentity[] = [];
  const terminated: WindowsSandboxProcessIdentity[] = [];
  const effects: string[] = [];
  const ids = [
    "11111111-2222-4333-8444-555555555555",
    "22222222-2222-4333-8444-555555555555"
  ];
  let lease = 0;
  const lifecycle: WindowsSandboxLifecycleController = {
    async launch() {
      const identity = processIdentity(8301 + launched.length, String(133801632000000010n + BigInt(launched.length)));
      identities.set(identity.pid, "same");
      launched.push(identity);
      return identity;
    },
    async inspect(identity) { return identities.get(identity.pid) ?? "absent"; },
    async focus() { throw new Error("rebuild must not focus the old instance"); },
    async terminate(identity) {
      assert.equal(identities.get(identity.pid), "same");
      identities.set(identity.pid, "absent");
      terminated.push(identity);
      return { terminated: true };
    }
  };
  const backend = createBackend(setup, successfulRunner(), effects, {
    lifecycleController: lifecycle,
    idFactory: () => ids[lease++]!,
    approvedPersistentVolumes: [{ id: "build-cache", hostRoot: persistent }]
  });
  const original = await backend.run(await sandboxRequest(setup));
  assert.equal(original.status, "running");

  const rebuilt = await backend.run(await sandboxRequest(setup, { profile: "fresh_full_sandbox", recipeId: "rebuild_full_sandbox" }));
  assert.equal(rebuilt.status, "running", rebuilt.summary);
  assert.equal(rebuilt.lifecycleEffect, "rebuilt");
  assert.notEqual(rebuilt.leaseId, original.leaseId);
  assert.deepEqual(terminated, [launched[0]]);
  assert.equal(await readFile(join(persistent, "keep.txt"), "utf8"), "preserve exactly");
  assert.deepEqual(effects, ["launch", "terminate", "launch"]);

  const oldReceipt = JSON.parse(await readFile(original.receiptPath!, "utf8")) as Record<string, unknown>;
  assert.equal(oldReceipt.state, "completed");
  assert.equal(oldReceipt.cleanupVerified, true);
  await assert.rejects(access(join(dirname(original.receiptPath!), "sandbox.wsb")));
});

test("restart reconciliation cleans an ended exact full sandbox without treating a PID reuse as absent", async (context) => {
  const setup = await fixture(context);
  let state: "same" | "absent" | "mismatch" = "same";
  const lifecycle: WindowsSandboxLifecycleController = {
    async launch() { return processIdentity(8401); },
    async inspect() { return state; },
    async focus() { return { focused: true }; },
    async terminate() { return { terminated: true }; }
  };
  const backend = createBackend(setup, successfulRunner(), [], { lifecycleController: lifecycle });
  const started = await backend.run(await sandboxRequest(setup));
  assert.equal(started.status, "running");

  state = "mismatch";
  await assert.rejects(() => backend.reconcile(), /identity|reused/i);
  assert.equal((await readdir(dirname(started.receiptPath!))).includes("exchange"), true);

  state = "absent";
  const reconciled = await backend.reconcile();
  assert.equal(reconciled[0]?.state, "completed");
  assert.equal(reconciled[0]?.cleanupVerified, true);
  assert.equal((await readdir(dirname(started.receiptPath!))).includes("exchange"), false);
});

test("quarantine remains a one-shot bounded execution and never enters the interactive lifecycle", async (context) => {
  const setup = await fixture(context);
  let lifecycleCalls = 0;
  const lifecycle: WindowsSandboxLifecycleController = {
    async launch() { lifecycleCalls += 1; return processIdentity(8501); },
    async inspect() { lifecycleCalls += 1; return "absent"; },
    async focus() { lifecycleCalls += 1; return { focused: true }; },
    async terminate() { lifecycleCalls += 1; return { terminated: true }; }
  };
  const result = await createBackend(setup, successfulRunner(async (spec) => {
    assert.match(await readFile(spec.args[0], "utf8"), /<LogonCommand>/);
  }), [], { lifecycleController: lifecycle })
    .run(await sandboxRequest(setup, { profile: "quarantine", recipeId: "quarantine" }));
  assert.equal(result.status, "completed", result.summary);
  assert.equal(lifecycleCalls, 0);
});

test("target and effect guards run again immediately before exact focus and termination", async (context) => {
  const setup = await fixture(context);
  const identity = processIdentity(8601);
  const lifecycleCalls: string[] = [];
  const lifecycle: WindowsSandboxLifecycleController = {
    async launch() { lifecycleCalls.push("launch"); return identity; },
    async inspect() { lifecycleCalls.push("inspect"); return "same"; },
    async focus() { lifecycleCalls.push("focus"); return { focused: true }; },
    async terminate() { lifecycleCalls.push("terminate"); return { terminated: true }; }
  };
  const backend = createBackend(setup, successfulRunner(), [], { lifecycleController: lifecycle });
  assert.equal((await backend.run(await sandboxRequest(setup))).status, "running");
  const deniedFocus = await backend.run(await sandboxRequest(setup, {
    effectGuard: { async check(input: { phase: string }) { return { allowed: false, reason: `${input.phase} target changed` }; } }
  }));
  assert.equal(deniedFocus.status, "blocked");
  assert.match(deniedFocus.summary, /focus target changed/i);
  assert.equal(lifecycleCalls.includes("focus"), false);

  const deniedTerminate = await backend.run(await sandboxRequest(setup, {
    profile: "fresh_full_sandbox",
    recipeId: "rebuild_full_sandbox",
    effectGuard: { async check(input: { phase: string }) { return { allowed: false, reason: `${input.phase} authority changed` }; } }
  }));
  assert.equal(deniedTerminate.status, "blocked");
  assert.match(deniedTerminate.summary, /terminate authority changed/i);
  assert.equal(lifecycleCalls.includes("terminate"), false);
});
