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
  symlink,
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
  type WindowsSandboxReviewedExchangeLease,
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
      const exchangeRoot = spec.reviewedExchangeBinding ? join(spec.reviewedExchangeBinding.stagingRoot, "mount") : join(dirname(spec.args[0]!), "exchange");
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
      const exchangeRoot = spec.reviewedExchangeBinding ? join(spec.reviewedExchangeBinding.stagingRoot, "mount") : join(dirname(spec.args[0]!), "exchange");
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

test("the control-plane sandbox wrapper aborts when durable cancellation polling fails", async () => {
  const unhandled: unknown[] = [];
  const onUnhandled = (reason: unknown): void => { unhandled.push(reason); };
  process.on("unhandledRejection", onUnhandled);
  try {
    let checks = 0;
    let backendAborted = false;
    const backend = {
      async execute(input: { signal: AbortSignal }) {
        return new Promise<{ status: "cancelled"; summary: string }>((resolve) => {
          const finish = (): void => { backendAborted = true; resolve({ status: "cancelled", summary: "Sandbox operation cancelled." }); };
          if (input.signal.aborted) finish();
          else input.signal.addEventListener("abort", finish, { once: true });
        });
      }
    };
    const runtime = new WindowsSandboxIsolationRuntime(backend as never, {
      destinationRoot: "C:\\validated-results",
      permitVerifier: { verifyPermit: () => true },
      recipeCatalogDigest: "a".repeat(64),
      helperDigest: "b".repeat(64)
    });
    const startedAt = Date.now();
    const outcome = await runtime.start({
      action: "full_sandbox",
      operationId: "operation-cancellation-ledger",
      target: { id: "target-1", repositoryRoot: "C:\\repo" } as never,
      profile: "full_sandbox",
      permit: {} as never,
      effectGuard: { async assertCurrent() { return { allowed: true, reason: "current" }; } },
      executionControl: {
        operationId: "operation-cancellation-ledger",
        deadline: new Date(Date.now() + 2_000).toISOString(),
        async isCancellationRequested() {
          checks += 1;
          if (checks === 1) return false;
          throw new Error("protected cancellation ledger unavailable");
        }
      }
    });
    assert.equal(outcome.status, "cancelled");
    assert.equal(backendAborted, true);
    assert.ok(Date.now() - startedAt < 700, "Windows Sandbox waited for its deadline after cancellation polling failed");
    await new Promise<void>((resolve) => setImmediate(resolve));
    assert.deepEqual(unhandled, []);
  } finally {
    process.off("unhandledRejection", onUnhandled);
  }
});

test("the control-plane sandbox wrapper serializes a never-settling cancellation poll", async () => {
  let checks = 0;
  let backendAborted = false;
  const runtime = new WindowsSandboxIsolationRuntime({
    async execute(input: { signal: AbortSignal }) {
      return new Promise<{ status: "cancelled"; summary: string }>((resolve) => {
        const finish = (): void => { backendAborted = true; resolve({ status: "cancelled", summary: "Sandbox operation cancelled." }); };
        if (input.signal.aborted) finish();
        else input.signal.addEventListener("abort", finish, { once: true });
      });
    }
  } as never, {
    destinationRoot: "C:\\validated-results",
    permitVerifier: { verifyPermit: () => true },
    recipeCatalogDigest: "a".repeat(64),
    helperDigest: "b".repeat(64)
  });
  const startedAt = Date.now();
  const outcome = await runtime.start({
    action: "full_sandbox",
    operationId: "operation-cancellation-hang",
    target: { id: "target-1", repositoryRoot: "C:\\repo" } as never,
    profile: "full_sandbox",
    permit: {} as never,
    effectGuard: { async assertCurrent() { return { allowed: true, reason: "current" }; } },
    executionControl: {
      operationId: "operation-cancellation-hang",
      deadline: new Date(Date.now() + 360).toISOString(),
      async isCancellationRequested() {
        checks += 1;
        if (checks === 1) return false;
        return new Promise<boolean>(() => undefined);
      }
    }
  });
  assert.equal(outcome.status, "cancelled");
  assert.equal(backendAborted, true);
  assert.equal(checks, 2, "a never-settling poll must not permit overlapping cancellation reads");
  assert.ok(Date.now() - startedAt < 800, "Windows Sandbox outlived its exact durable deadline");
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

// These mapping capabilities and guest-exit observations are explicit doubles.
// Actual NTFS staging has its own native journey; no VM is launched here.
async function reviewedInputFixture(setup: Awaited<ReturnType<typeof fixture>>) {
  const root=join(setup.base,"reviewed-inputs");await mkdir(root);
  const catalog=await readFile(join(setup.targetRoot,"sandbox-job.json"));await writeFile(join(root,"sandbox-job.json"),catalog);
  await writeFile(join(setup.targetRoot,"unselected.env"),"synthetic private bytes");
  const inputFiles=[{path:"sandbox-job.json",sha256:sha256(catalog),size:catalog.length,classification:"non-production" as const}];
  let checks=0;
  const lease={operationId:"aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee",sourceRoot:setup.targetRoot,root,inputFiles,inputManifestSha256:sha256(JSON.stringify(inputFiles)),privateAclReadbackVerified:true as const,sandboxEnforced:false as const,withConsumer:async<T>(effect:()=>Promise<T>)=>effect(),assertCurrent:async()=>{checks++;assert.equal(sha256(await readFile(join(root,"sandbox-job.json"))),sha256(catalog));}};
  return {lease,checks:()=>checks};
}

test("reviewed guest mapping contains only its exact staged inputs and retains a separate operation binding",async context=>{
  const setup=await fixture(context),inputs=await reviewedInputFixture(setup);
  const inner=successfulRunner(async spec=>{const xml=await readFile(spec.args[0]!,"utf8");assert.ok(xml.includes(`<HostFolder>${inputs.lease.root}</HostFolder>`));assert.ok(!xml.includes(`<HostFolder>${setup.targetRoot}</HostFolder>`));assert.ok(!xml.includes("<LogonCommand>"),"The guest cannot start its recipe before native identity acknowledgement");const request=JSON.parse(await readFile(join(dirname(spec.args[0]!),"exchange/request.json"),"utf8"));assert.equal(request.hostOwnsGuestShutdown,true);await assert.rejects(access(join(inputs.lease.root,"unselected.env")),{code:"ENOENT"});});
  let launches=0;
  const runner:WindowsSandboxProcessRunner={run:async(...args)=>{launches++;const identity={schema:"switchyard-windows-sandbox-guest/v1" as const,sandboxId:"12345678-1234-4567-8123-123456789abc",...args[0].reviewedGuest!};await args[3]!(identity);return {...await inner.run(...args),guestSessionExit:{...identity,stopped:true}};}};
  const backend=createBackend(setup,runner,[],{requireReviewedInputs:true});
  const result=await backend.run({...await sandboxRequest(setup),operationId:inputs.lease.operationId,reviewedInputs:inputs.lease});assert.equal(result.status,"completed",result.summary);assert.ok(inputs.checks()>=4);
  const receipt=JSON.parse(await readFile(result.receiptPath!,"utf8"));assert.equal(receipt.reviewedInputRoot,inputs.lease.root);assert.equal(receipt.reviewedInputManifestSha256,inputs.lease.inputManifestSha256);assert.equal(receipt.reviewedInputOperationId,inputs.lease.operationId);assert.equal(receipt.guestExitVerified,true);
  const duplicate=await backend.run({...await sandboxRequest(setup),operationId:inputs.lease.operationId,reviewedInputs:inputs.lease});assert.equal(duplicate.replayed,true);assert.equal(duplicate.resultRoot,result.resultRoot);assert.equal(launches,1);
  await access(inputs.lease.root);assert.equal(await readFile(join(setup.targetRoot,"unselected.env"),"utf8"),"synthetic private bytes");
});

test("a viewer exit cannot authorize reviewed guest extraction, exchange cleanup or restart replacement",async context=>{
  const setup=await fixture(context),inputs=await reviewedInputFixture(setup),backend=createBackend(setup,successfulRunner(),[],{requireReviewedInputs:true});
  const result=await backend.run({...await sandboxRequest(setup),operationId:inputs.lease.operationId,reviewedInputs:inputs.lease});assert.equal(result.status,"failed");assert.match(result.summary,/guest exit remains unconfirmed/i);
  const receipt=JSON.parse(await readFile(result.receiptPath!,"utf8"));assert.equal(receipt.guestStartAttempted,true);assert.equal(receipt.guestExitVerified,false);assert.equal(receipt.cleanupVerified,false);await access(join(dirname(result.receiptPath!),"exchange/request.json"));await access(inputs.lease.root);assert.deepEqual(await readdir(setup.destinationRoot),[]);
  await assert.rejects(backend.reconcile(),/independent stop proof/);
  const again=await backend.run({...await sandboxRequest(setup),operationId:inputs.lease.operationId,reviewedInputs:inputs.lease});assert.equal(again.status,"blocked");
});

test("reviewed mapping refuses absent, deserialized, wrong-operation and changed input capabilities before launch",async context=>{
  for(const invalid of ["missing","serialized","operation","catalog","digest","late"]){
    const setup=await fixture(context),inputs=await reviewedInputFixture(setup);let launches=0;
    const backend=createBackend(setup,{run:async()=>{launches++;throw Error("unexpected guest launch");}},[],{requireReviewedInputs:true});
    let lease=inputs.lease;
    if(invalid==="serialized")lease=JSON.parse(JSON.stringify(lease));
    if(invalid==="operation")lease={...lease,operationId:"ffffffff-bbbb-4ccc-8ddd-eeeeeeeeeeee"};
    if(invalid==="catalog")lease={...lease,inputFiles:[{...lease.inputFiles[0]!,path:"different.json"}]};
    if(invalid==="digest")lease={...lease,inputManifestSha256:"f".repeat(64)};
    if(invalid==="late")lease={...lease,assertCurrent:async()=>{await inputs.lease.assertCurrent();if(inputs.checks()>=3)throw Error("Synthetic input revocation before launch");}};
    const result=await backend.run({...await sandboxRequest(setup),operationId:inputs.lease.operationId,...(invalid!=="missing"?{reviewedInputs:lease}:{})});
    assert.notEqual(result.status,"completed",invalid);assert.equal(launches,0,invalid);await access(inputs.lease.root);
  }
});

test("guest acknowledgement and exit evidence cannot cross an operation, configuration or VM identity",async context=>{
  for(const fault of ["ready-operation","ready-write","exit-id","exit-config"]){
    const setup=await fixture(context),inputs=await reviewedInputFixture(setup),inner=successfulRunner();let recipes=0;
    const fs=new InjectedFileSystem(),write=fs.writeText.bind(fs);let failedWrite=false;
    fs.writeText=async(path,text)=>{if(fault==="ready-write"&&!failedWrite&&path.includes("receipt.json.")&&JSON.parse(text).guestSessionId){failedWrite=true;throw Error("Synthetic lost VM identity write");}return write(path,text);};
    const runner:WindowsSandboxProcessRunner={run:async(...args)=>{
      const identity={schema:"switchyard-windows-sandbox-guest/v1" as const,sandboxId:"12345678-1234-4567-8123-123456789abc",...args[0].reviewedGuest!};
      await args[3]!({...identity,...(fault==="ready-operation"?{operationId:"ffffffff-bbbb-4ccc-8ddd-eeeeeeeeeeee"}:{})});
      recipes++;const result=await inner.run(...args);
      return {...result,guestSessionExit:{...identity,stopped:true,...(fault==="exit-id"?{sandboxId:"ffffffff-bbbb-4ccc-8ddd-eeeeeeeeeeee"}:{}),...(fault==="exit-config"?{configurationSha256:"f".repeat(64)}:{})}};
    }};
    const backend=createBackend(setup,runner,[],{requireReviewedInputs:true,filesystem:fs});
    const result=await backend.run({...await sandboxRequest(setup),operationId:inputs.lease.operationId,reviewedInputs:inputs.lease});
    assert.equal(result.status,"failed",fault);assert.equal(recipes,fault.startsWith("ready")?0:1,fault);assert.deepEqual(await readdir(setup.destinationRoot),[],fault);await access(inputs.lease.root);await access(join(dirname(result.receiptPath!),"exchange/request.json"));await assert.rejects(backend.reconcile(),/independent stop proof/);
  }
});

test("restart observes exact guest exit without upgrading an unconfirmed program or extracting its output",async context=>{
  const setup=await fixture(context),inputs=await reviewedInputFixture(setup),inner=successfulRunner();let executions=0,available=false,wrong=false;
  const identity={schema:"switchyard-windows-sandbox-guest/v1" as const,sandboxId:"12345678-1234-4567-8123-123456789abc",operationId:inputs.lease.operationId,configurationSha256:""};
  const runner:WindowsSandboxProcessRunner={run:async(...args)=>{executions++;identity.configurationSha256=args[0].reviewedGuest!.configurationSha256;await args[3]!(identity);return inner.run(...args);},reconcileReviewedOperation:async input=>{assert.equal(input.operationId,identity.operationId);assert.equal(input.knownSandboxId,identity.sandboxId);return available?{...identity,stopped:true,...(wrong?{configurationSha256:"f".repeat(64)}:{})}:undefined;}};
  const backend=createBackend(setup,runner,[],{requireReviewedInputs:true});
  const failed=await backend.run({...await sandboxRequest(setup),operationId:inputs.lease.operationId,reviewedInputs:inputs.lease});assert.equal(failed.status,"failed");
  available=true;wrong=true;await assert.rejects(backend.reconcile(),/independent stop proof/);await access(join(dirname(failed.receiptPath!),"exchange/request.json"));
  wrong=false;const [receipt]=await backend.reconcile();assert.equal(receipt!.state,"failed");assert.equal(receipt!.guestExitVerified,true);assert.equal(receipt!.cleanupVerified,true);assert.deepEqual(await readdir(setup.destinationRoot),[]);await assert.rejects(access(join(dirname(failed.receiptPath!),"exchange")),{code:"ENOENT"});await access(inputs.lease.root);assert.equal(executions,1);
});


// These volume capabilities deliberately use ordinary temporary test folders.
// Native Windows mount/extent/ACL admission is accepted in its separate CI lane.
async function reviewedExchangeFixture(setup: Awaited<ReturnType<typeof fixture>>, operationId: string) {
  const stagingRoot=join(setup.base,`disk-${operationId}`),root=join(stagingRoot,"mount");await mkdir(root,{recursive:true});
  await writeFile(join(stagingRoot,"exchange.vhd"),"synthetic original volume owner");
  let held=0,checks=0,current=true;
  const lease:WindowsSandboxReviewedExchangeLease={schema:"switchyard-windows-bounded-volume/v1",operationId,root,maximumBytes:67108864,privateAclReadbackVerified:true,exchangeQuotaEnforced:true,sandboxEnforced:false,
    nativeBinding:{schema:"switchyard-windows-bounded-volume/v1",operationId,stagingRoot,stagingIdentity:{device:"1",inode:"2"},imageIdentity:{device:"1",inode:"3"},mountIdentity:{device:"1",inode:"4"},footerSha256:"a".repeat(64),volumeGuid:"\\\\?\\Volume{11111111-2222-4333-8444-555555555555}\\"},
    async assertCurrent(){assert.equal(current,true,"Synthetic volume identity changed");assert.ok(held>0);checks++;},
    async withConsumer<T>(effect:()=>Promise<T>){held++;try{return await effect();}finally{held--;}}
  };
  return{lease,held:()=>held,checks:()=>checks,revoke:()=>{current=false;}};
}
function exactGuestRunner(inner:WindowsSandboxProcessRunner):WindowsSandboxProcessRunner {
  return{async run(...args){const identity={schema:"switchyard-windows-sandbox-guest/v1" as const,sandboxId:"12345678-1234-4567-8123-123456789abc",...args[0].reviewedGuest!};await args[3]!(identity);return{...await inner.run(...args),guestSessionExit:{...identity,stopped:true}};}};
}
test("bounded guest mapping holds its native consumer lease, validates output without resolving the mount and leaves retirement to its original owner",async context=>{
 const setup=await fixture(context),inputs=await reviewedInputFixture(setup),exchange=await reviewedExchangeFixture(setup,inputs.lease.operationId);let launches=0;
 const filesystem=new InjectedFileSystem(),originalRealpath=filesystem.realpath.bind(filesystem);filesystem.realpath=async path=>{assert.ok(path!==exchange.lease.root&&!path.startsWith(exchange.lease.root+"/"),"Generic realpath must not resolve the trusted volume mount");return originalRealpath(path);};
 const inner=successfulRunner(async spec=>{launches++;assert.equal(exchange.held(),1);assert.deepEqual(spec.reviewedExchangeBinding,exchange.lease.nativeBinding);const xml=await readFile(spec.args[0],"utf8");assert.ok(xml.includes(`<HostFolder>${exchange.lease.root}</HostFolder>`));});
 const backend=createBackend(setup,exactGuestRunner(inner),[],{requireReviewedInputs:true,requireBoundedExchange:true,filesystem}),request={...await sandboxRequest(setup),operationId:inputs.lease.operationId,reviewedInputs:inputs.lease,reviewedExchange:exchange.lease};
 const result=await backend.run(request);assert.equal(result.status,"completed",result.summary);assert.equal(exchange.held(),0);assert.ok(exchange.checks()>=4);assert.equal(await readFile(join(result.resultRoot!,"report.txt"),"utf8"),"validated sandbox result");
 const receipt=JSON.parse(await readFile(result.receiptPath!,"utf8"));assert.equal(receipt.reviewedExchangeRoot,exchange.lease.root);assert.equal(receipt.reviewedExchangeBindingSha256,sha256(JSON.stringify(exchange.lease.nativeBinding)));assert.equal(receipt.exchangeQuotaEnforced,true);assert.equal(receipt.cleanupVerified,true);
 await access(join(exchange.lease.root,"request.json"));assert.equal(await readFile(join(exchange.lease.nativeBinding.stagingRoot,"exchange.vhd"),"utf8"),"synthetic original volume owner");
 assert.equal((await backend.run(request)).replayed,true);assert.equal(launches,1);
 const altered={...exchange.lease,nativeBinding:{...exchange.lease.nativeBinding,footerSha256:"f".repeat(64)}};assert.equal((await backend.run({...request,reviewedExchange:altered})).status,"blocked");assert.equal(launches,1);
});
test("bounded backend refuses missing, serialized, wrong-scope, unbounded and overlapping exchange capabilities without guest effects",async context=>{
 for(const invalid of ["missing","serialized","operation","binding","quota","path","overlap"]){
  const setup=await fixture(context),inputs=await reviewedInputFixture(setup),exchange=await reviewedExchangeFixture(setup,inputs.lease.operationId);let launches=0;
  const lease:any={...exchange.lease,nativeBinding:{...exchange.lease.nativeBinding}};
  if(invalid==="serialized"){delete lease.assertCurrent;delete lease.withConsumer;}
  if(invalid==="operation")lease.operationId="bbbbbbbb-bbbb-4ccc-8ddd-eeeeeeeeeeee";
  if(invalid==="binding")lease.nativeBinding.operationId="bbbbbbbb-bbbb-4ccc-8ddd-eeeeeeeeeeee";
  if(invalid==="quota")lease.exchangeQuotaEnforced=false;
  if(invalid==="path")lease.root=setup.targetRoot;
  if(invalid==="overlap"){lease.nativeBinding.stagingRoot=setup.targetRoot;lease.root=join(setup.targetRoot,"mount");}
  const backend=createBackend(setup,exactGuestRunner(successfulRunner(()=>{launches++;})),[],{requireReviewedInputs:true,requireBoundedExchange:true});
  const result=await backend.run({...await sandboxRequest(setup),operationId:inputs.lease.operationId,reviewedInputs:inputs.lease,...(invalid==="missing"?{}:{reviewedExchange:lease})});assert.ok(["blocked","unavailable"].includes(result.status),`${invalid}: ${result.summary}`);assert.equal(launches,0);assert.equal(exchange.held(),0);await access(join(exchange.lease.nativeBinding.stagingRoot,"exchange.vhd"));
 }
});
test("bounded exchange survives an unknown guest exit and cannot be extracted or replayed on restart",async context=>{
 const setup=await fixture(context),inputs=await reviewedInputFixture(setup),exchange=await reviewedExchangeFixture(setup,inputs.lease.operationId);let launches=0;
 const backend=createBackend(setup,successfulRunner(()=>{launches++;}),[],{requireReviewedInputs:true,requireBoundedExchange:true}),request={...await sandboxRequest(setup),operationId:inputs.lease.operationId,reviewedInputs:inputs.lease,reviewedExchange:exchange.lease};
 const result=await backend.run(request);assert.equal(result.status,"failed");assert.match(result.summary,/guest exit remains unconfirmed/i);await access(join(exchange.lease.root,"result-manifest.json"));assert.equal((await readdir(setup.destinationRoot)).length,0);assert.equal((await backend.run(request)).status,"blocked");assert.equal(launches,1);assert.equal(exchange.held(),0);
});
test("a protected broker exchange must bind the same exact reviewed input manifest before any guest or output effect",async context=>{
 for(const variant of ["matching","other-inputs","invalid-scope","unknown-field","null-scope","false-scope"]){
  const setup=await fixture(context),inputs=await reviewedInputFixture(setup),exchange=await reviewedExchangeFixture(setup,inputs.lease.operationId);let launches=0;
  let broker:any={installationId:"12345678-1234-4567-8123-123456789abc",ownerScope:"a".repeat(64),serviceImageSha256:"b".repeat(64),taskScopeSha256:"c".repeat(64),inputManifestSha256:inputs.lease.inputManifestSha256};
  if(variant==="other-inputs")broker.inputManifestSha256="f".repeat(64);if(variant==="invalid-scope")broker.taskScopeSha256="unreviewed";if(variant==="unknown-field")broker.approved=true;if(variant==="null-scope")broker=null;if(variant==="false-scope")broker=false;
  const lease={...exchange.lease,nativeBinding:{...exchange.lease.nativeBinding,broker}},backend=createBackend(setup,exactGuestRunner(successfulRunner(()=>{launches++;})),[],{requireReviewedInputs:true,requireBoundedExchange:true});
  const result=await backend.run({...await sandboxRequest(setup),operationId:inputs.lease.operationId,reviewedInputs:inputs.lease,reviewedExchange:lease});
  assert.equal(result.status,variant==="matching"?"completed":"blocked",variant+": "+result.summary);assert.equal(launches,variant==="matching"?1:0);assert.equal(exchange.held(),0);await access(join(exchange.lease.nativeBinding.stagingRoot,"exchange.vhd"));
  if(variant!=="matching")assert.deepEqual(await readdir(setup.destinationRoot),[]);
 }
});
test("bounded output still rejects links and a revoked native volume before extraction",async context=>{
 for(const failure of ["link","revoked"]){
  const setup=await fixture(context),inputs=await reviewedInputFixture(setup),exchange=await reviewedExchangeFixture(setup,inputs.lease.operationId),inner=successfulRunner();
  const runner=exactGuestRunner({async run(...args){const result=await inner.run(...args);if(failure==="revoked")exchange.revoke();else{const report=join(exchange.lease.root,"output/report.txt");await rm(report);await symlink(join(setup.targetRoot,"unselected.env"),report);}return result;}});
  const backend=createBackend(setup,runner,[],{requireReviewedInputs:true,requireBoundedExchange:true});const result=await backend.run({...await sandboxRequest(setup),operationId:inputs.lease.operationId,reviewedInputs:inputs.lease,reviewedExchange:exchange.lease});assert.equal(result.status,"failed",result.summary);assert.equal((await readdir(setup.destinationRoot)).length,0);await access(join(exchange.lease.nativeBinding.stagingRoot,"exchange.vhd"));assert.equal(exchange.held(),0);
 }
});


function failedGuestProgram(exitCode=7,change:(manifest:any)=>void=()=>{}):WindowsSandboxProcessRunner {
 const inner=successfulRunner();return{async run(...args){const result=await inner.run(...args),spec=args[0],root=spec.reviewedExchangeBinding?join(spec.reviewedExchangeBinding.stagingRoot,"mount"):join(dirname(spec.args[0]!),"exchange"),manifest=JSON.parse(await readFile(join(root,"result-manifest.json"),"utf8"));manifest.outcome="failed";manifest.processExitCode=exitCode;manifest.outputs=[];
 for(const [path,text] of [["process.stdout.txt","captured failing program output"],["process.stderr.txt","synthetic failure diagnostic"]]){const bytes=Buffer.from(text);await writeFile(join(root,"output",path),bytes);manifest.outputs.push({path,size:bytes.length,sha256:sha256(bytes)});}change(manifest);await writeFile(join(root,"result-manifest.json"),JSON.stringify(manifest));return{...result,exitCode:exitCode>>>0};}};
}
test("a failed reviewed guest retains only verified bounded logs while keeping a failed task result and the original volume owner",async context=>{
 for(const exitCode of [7,-1073741515]){
  const setup=await fixture(context),inputs=await reviewedInputFixture(setup),exchange=await reviewedExchangeFixture(setup,inputs.lease.operationId);let launches=0;
  const inner=failedGuestProgram(exitCode),runner=exactGuestRunner({async run(...args){launches++;return inner.run(...args);}}),backend=createBackend(setup,runner,[],{requireReviewedInputs:true,requireBoundedExchange:true}),request={...await sandboxRequest(setup),operationId:inputs.lease.operationId,reviewedInputs:inputs.lease,reviewedExchange:exchange.lease};
  const result=await backend.run(request);assert.equal(result.status,"failed",result.summary);assert.equal(result.resultRoot,undefined);assert.ok(result.diagnosticRoot);assert.equal(result.programExitCode,exitCode>>>0);assert.deepEqual((await readdir(result.diagnosticRoot!)).sort(),["process.stderr.txt","process.stdout.txt"]);assert.equal(await readFile(join(result.diagnosticRoot!,"process.stderr.txt"),"utf8"),"synthetic failure diagnostic");
  const receipt=JSON.parse(await readFile(result.receiptPath!,"utf8"));assert.equal(receipt.state,"failed");assert.equal(receipt.diagnosticRoot,result.diagnosticRoot);assert.equal(receipt.cleanupVerified,true);await access(join(exchange.lease.nativeBinding.stagingRoot,"exchange.vhd"));
  const duplicate=await backend.run(request);assert.equal(duplicate.replayed,true);assert.equal(duplicate.status,"failed");assert.equal(duplicate.diagnosticRoot,result.diagnosticRoot);assert.equal(duplicate.programExitCode,result.programExitCode);assert.equal(launches,1);
 }
});
test("mismatched exit evidence, arbitrary artifacts, false resource claims and changed log hashes cannot be extracted as failure diagnostics",async context=>{
 for(const invalid of ["exit","artifact","resource","digest","bound"]){
  const setup=await fixture(context),inputs=await reviewedInputFixture(setup),exchange=await reviewedExchangeFixture(setup,inputs.lease.operationId);
  const inner=failedGuestProgram(7,manifest=>{if(invalid==="exit")manifest.processExitCode=8;if(invalid==="artifact")manifest.outputs[0].path="report.txt";if(invalid==="resource")manifest.resourceEnforcement.noSurvivors=false;if(invalid==="digest")manifest.outputs[0].sha256="f".repeat(64);});
  const backend=createBackend(setup,exactGuestRunner(inner),[],{requireReviewedInputs:true,requireBoundedExchange:true,...(invalid==="bound"?{maxProcessOutputBytes:4}:{})}),result=await backend.run({...await sandboxRequest(setup),operationId:inputs.lease.operationId,reviewedInputs:inputs.lease,reviewedExchange:exchange.lease});
  assert.equal(result.status,"failed");assert.equal(result.diagnosticRoot,undefined);assert.equal(result.resultRoot,undefined);assert.equal((await readdir(setup.destinationRoot)).length,0);await access(join(exchange.lease.nativeBinding.stagingRoot,"exchange.vhd"));
 }
});
test("a failed program still cannot release diagnostic bytes before independent exact VM exit",async context=>{
 const setup=await fixture(context),inputs=await reviewedInputFixture(setup),exchange=await reviewedExchangeFixture(setup,inputs.lease.operationId),backend=createBackend(setup,failedGuestProgram(),[],{requireReviewedInputs:true,requireBoundedExchange:true});
 const result=await backend.run({...await sandboxRequest(setup),operationId:inputs.lease.operationId,reviewedInputs:inputs.lease,reviewedExchange:exchange.lease});assert.equal(result.status,"failed");assert.equal(result.diagnosticRoot,undefined);assert.match(result.summary,/guest exit remains unconfirmed/i);assert.equal((await readdir(setup.destinationRoot)).length,0);await access(join(exchange.lease.root,"result-manifest.json"));
});
