import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import {
  copyFile,
  lstat,
  mkdir,
  mkdtemp,
  readFile,
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
        version: 1,
        requestId: request.requestId,
        leaseId: request.leaseId,
        recipeId: request.recipeId,
        recipeCatalogDigest: request.recipeCatalogDigest,
        outcome: "completed",
        summary: "sandbox helper completed",
        outputs: [{ path: "report.txt", size: contents.byteLength, sha256: sha256(contents) }]
      }), "utf8");
      return { pid: 4242, exitCode: 0, stdout: "x".repeat(100_000), stderr: "", timedOut: false, cancelled: false, outputTruncated: false };
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
  assert.equal(result.status, "completed");
  assert.equal(result.leaseId, "sandbox:11111111-2222-4333-8444-555555555555");
  assert.equal(result.processId, "sandbox-process:11111111-2222-4333-8444-555555555555");
  assert.equal(result.resultManifestSha256?.length, 64);
  assert.equal(result.recipeCatalogSha256, (await sandboxRequest(setup)).expectedRecipeCatalogSha256);
  assert.equal(result.sandboxHelperSha256, (await sandboxRequest(setup)).expectedHelperSha256);
  assert.deepEqual(result.validatedOutputs, [{ path: "report.txt", size: Buffer.byteLength("validated sandbox result"), sha256: sha256("validated sandbox result") }]);
  assert.deepEqual(guardCalls, ["launch", "extract"]);
  assert.match(configuration, /<Networking>Disable<\/Networking>/);
  assert.match(configuration, /<VGpu>Disable<\/VGpu>/);
  assert.match(configuration, /<ReadOnly>true<\/ReadOnly>/);
  assert.match(configuration, /C:\\B122\\tools\\b122-sandbox-worker\.exe/);
  assert.doesNotMatch(configuration, /powershell|cmd\.exe|wscript/i);
  assert.equal(await readFile(join(result.resultRoot!, "report.txt"), "utf8"), "validated sandbox result");

  const receipt = JSON.parse(await readFile(result.receiptPath!, "utf8")) as Record<string, unknown>;
  assert.equal(receipt.state, "completed");
  assert.equal(receipt.hostPid, 4242);
  assert.equal(receipt.processOutputTruncated, true);
  assert.equal(receipt.resultRoot, result.resultRoot);
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
        version: 1,
        requestId: request.requestId,
        leaseId: request.leaseId,
        recipeId: request.recipeId,
        recipeCatalogDigest: request.recipeCatalogDigest,
        outcome: "completed",
        summary: "untrusted",
        outputs: [{ path: "report.txt", size: 8, sha256: "0".repeat(64) }]
      }), "utf8");
      return { pid: 9, exitCode: 0, stdout: "", stderr: "", timedOut: false, cancelled: false, outputTruncated: false };
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
          outputTruncated: true
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
