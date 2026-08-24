import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Readable } from "node:stream";
import test from "node:test";

import {
  RepositoryRuntime,
  computeRepositoryRuntimeManifestDigest,
  loadVerifiedRepositoryRuntimeManifest,
  type RepositoryProcessStartRequest,
  type RepositoryProcessSupervisor,
  type RepositoryRuntimeManifest,
  type RepositorySupervisedProcess,
  type RuntimeEffectGuard
} from "../src/repository-runtime.ts";

const allowEffects: RuntimeEffectGuard = {
  async check() { return { allowed: true, reason: "isolated test permit" }; }
};

async function fixture(context: test.TestContext) {
  const base = await mkdtemp(join(tmpdir(), "sxsy-b122-process-supervisor-"));
  const repositoryRoot = join(base, "repository");
  const hostRoot = join(base, "host-owned");
  await Promise.all([mkdir(repositoryRoot), mkdir(hostRoot)]);
  context.after(async () => { await rm(base, { recursive: true, force: true }); });
  await writeFile(join(repositoryRoot, "task.mjs"), "process.stdout.write('supervised')", "utf8");
  const value: RepositoryRuntimeManifest = {
    schema: "sxsy-b122.repository-runtime",
    version: 1,
    repositoryRoot,
    allowedHttpsUrls: [],
    recipes: {
      shield_change_scan: {
        kind: "process",
        executable: process.execPath,
        args: ["task.mjs"],
        cwd: ".",
        environment: { SXSY_TEST_MODE: "1" },
        lifecycle: "foreground",
        isolation: "repository",
        timeoutMs: 2_000,
        maxOutputBytes: 4_096
      },
      run_target: {
        kind: "process",
        executable: process.execPath,
        args: ["task.mjs"],
        cwd: ".",
        environment: { SXSY_TEST_MODE: "1" },
        lifecycle: "managed",
        isolation: "repository",
        timeoutMs: 20_000,
        maxOutputBytes: 4_096
      },
      stop_managed_run: {
        kind: "stop",
        managedActions: ["run_target"],
        gracefulTimeoutMs: 100,
        forceTimeoutMs: 500
      }
    }
  };
  const contents = JSON.stringify(value);
  const manifestPath = join(hostRoot, "repository-runtime.json");
  await writeFile(manifestPath, contents, "utf8");
  const verified = await loadVerifiedRepositoryRuntimeManifest({
    filePath: manifestPath,
    expectedSha256: computeRepositoryRuntimeManifestDigest(contents),
    repositoryRoot
  });
  return { repositoryRoot, verified };
}

class FakeSupervisor implements RepositoryProcessSupervisor {
  readonly starts: RepositoryProcessStartRequest[] = [];
  readonly terminated: string[] = [];
  recovered: RepositorySupervisedProcess[] = [];

  async start(request: RepositoryProcessStartRequest): Promise<RepositorySupervisedProcess> {
    this.starts.push(request);
    return this.handle(`managed:${"1".repeat(64)}`, 43210, request.action, "supervised", false);
  }

  async recover(): Promise<readonly RepositorySupervisedProcess[]> { return this.recovered; }

  handle(id: string, pid: number, action: RepositoryProcessStartRequest["action"], output = "", durable = false): RepositorySupervisedProcess {
    let settle!: (value: { readonly code: number; readonly signal: NodeJS.Signals | null }) => void;
    const exit = durable
      ? new Promise<{ readonly code: number; readonly signal: NodeJS.Signals | null }>((resolve) => { settle = resolve; })
      : new Promise<{ readonly code: number; readonly signal: NodeJS.Signals | null }>((resolve) => { setImmediate(() => resolve({ code: 0, signal: null })); });
    return {
      supervisorId: id,
      action,
      operationId: "operation-runtime-test",
      pid,
      startedAt: "2026-08-24T00:00:00.000Z",
      stdout: Readable.from([output]),
      stderr: Readable.from([]),
      recovered: false,
      wait: async () => exit,
      isAlive: async () => true,
      terminateTree: async () => { this.terminated.push(id); if (durable) settle({ code: 0, signal: null }); }
    };
  }
}

test("repository execution delegates exact hash-bound launches to the configured process-tree supervisor", async (context) => {
  const setup = await fixture(context);
  const supervisor = new FakeSupervisor();
  const runtime = new RepositoryRuntime(setup.verified, { effectGuard: allowEffects, processSupervisor: supervisor });
  const result = await runtime.execute("shield_change_scan", { operationId: "operation-runtime-test" });

  assert.equal(result.status, "completed");
  assert.equal(result.output, "supervised");
  assert.equal(supervisor.starts.length, 1);
  const request = supervisor.starts[0]!;
  assert.equal(request.executable, process.execPath);
  assert.equal(request.executableSha256, createHash("sha256").update(await import("node:fs/promises").then(({ readFile }) => readFile(process.execPath))).digest("hex"));
  assert.deepEqual(request.environment, { SXSY_TEST_MODE: "1" });
  assert.equal(request.repositoryRoot, setup.verified.canonicalRepositoryRoot);
  assert.equal(request.manifestSha256, setup.verified.digest);
  assert.equal(request.lifecycle, "foreground");
  assert.equal(request.operationId, "operation-runtime-test");
});

test("recovered durable supervisor identities can be observed and containment stops their entire owned tree", async (context) => {
  const setup = await fixture(context);
  const supervisor = new FakeSupervisor();
  const recovered = supervisor.handle(`managed:${"2".repeat(64)}`, 43211, "run_target", "", true);
  supervisor.recovered = [{ ...recovered, recovered: true }];
  const runtime = new RepositoryRuntime(setup.verified, { effectGuard: allowEffects, processSupervisor: supervisor });

  await runtime.recoverManagedProcesses();
  const listed = runtime.listManagedProcesses();
  assert.equal(listed.length, 1);
  assert.equal(listed[0]?.id, recovered.supervisorId);
  assert.equal(listed[0]?.pid, recovered.pid);

  const stopped = await runtime.execute("stop_managed_run", { managedProcessId: recovered.supervisorId });
  assert.equal(stopped.status, "completed");
  assert.deepEqual(supervisor.terminated, [recovered.supervisorId]);
});
