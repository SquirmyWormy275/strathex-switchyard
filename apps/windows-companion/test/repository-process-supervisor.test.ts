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
  type RepositoryProcessObservationRequest,
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
  readonly states = new Map<string, "running" | "completed" | "cancelled">();
  exitCode = 0;
  failBeforeStart = false;

  async start(request: RepositoryProcessStartRequest): Promise<RepositorySupervisedProcess> {
    this.starts.push(request);
    if (this.failBeforeStart) throw new Error("isolated supervisor refused before process creation");
    return this.handle(
      `managed:${"1".repeat(64)}`,
      43210,
      request.action,
      request.targetSnapshotId,
      "supervised",
      false,
      request.sessionId,
      request.authorityId
    );
  }

  async recover(): Promise<readonly RepositorySupervisedProcess[]> { return this.recovered; }

  async observeOperation(request: RepositoryProcessObservationRequest) {
    const candidates = [
      ...this.starts.map((start) => ({ operationId: start.operationId, action: start.action, targetSnapshotId: start.targetSnapshotId, sessionId: start.sessionId, authorityId: start.authorityId, supervisorId: `managed:${"1".repeat(64)}` })),
      ...this.recovered
    ];
    const process = candidates.find((item) => item.operationId === request.operationId && item.action === request.action
      && item.targetSnapshotId === request.targetSnapshotId && item.sessionId === request.sessionId
      && item.authorityId === request.authorityId);
    if (!process) return { state: "not_owner" as const, operationId: request.operationId, summary: "The fake supervisor does not own this operation." };
    const state = this.states.get(process.supervisorId) ?? "running";
    const common = {
      operationId: request.operationId,
      action: request.action,
      targetSnapshotId: request.targetSnapshotId,
      repositoryRoot: request.repositoryRoot,
      ...(request.sessionId ? { sessionId: request.sessionId } : {}),
      ...(request.authorityId ? { authorityId: request.authorityId } : {})
    };
    if (state === "running") return { state: "active" as const, ...common, effectDisposition: "ambiguous" as const, summary: "The exact fake-supervisor process remains live." };
    return {
      state: "terminal" as const,
      ...common,
      status: state === "completed" ? "completed" as const : "cancelled" as const,
      effectDisposition: "committed" as const,
      summary: `The exact fake-supervisor process is ${state}.`,
      evidenceDigest: createHash("sha256").update(`${process.supervisorId}:${state}`).digest("hex"),
      toolVersions: { repositorySupervisor: "fake-v1" }
    };
  }

  handle(id: string, pid: number, action: RepositoryProcessStartRequest["action"], targetSnapshotId: string, output = "", durable = false, sessionId?: string, authorityId?: string): RepositorySupervisedProcess {
    let settle!: (value: { readonly code: number; readonly signal: NodeJS.Signals | null }) => void;
    const exit = durable
      ? new Promise<{ readonly code: number; readonly signal: NodeJS.Signals | null }>((resolve) => { settle = resolve; })
      : new Promise<{ readonly code: number; readonly signal: NodeJS.Signals | null }>((resolve) => { setImmediate(() => { this.states.set(id, this.exitCode === 0 ? "completed" : "cancelled"); resolve({ code: this.exitCode, signal: null }); }); });
    this.states.set(id, "running");
    return {
      supervisorId: id,
      action,
      operationId: "operation-runtime-test",
      targetSnapshotId,
      ...(sessionId ? { sessionId } : {}),
      ...(authorityId ? { authorityId } : {}),
      pid,
      startedAt: "2026-08-24T00:00:00.000Z",
      stdout: Readable.from([output]),
      stderr: Readable.from([]),
      recovered: false,
      wait: async () => exit,
      isAlive: async () => true,
      terminateTree: async () => { this.terminated.push(id); this.states.set(id, "cancelled"); if (durable) settle({ code: 0, signal: null }); }
    };
  }
}

test("repository execution delegates exact hash-bound launches to the configured process-tree supervisor", async (context) => {
  const setup = await fixture(context);
  const supervisor = new FakeSupervisor();
  const runtime = new RepositoryRuntime(setup.verified, { effectGuard: allowEffects, processSupervisor: supervisor });
  const unbound = await runtime.execute("shield_change_scan", { operationId: "operation-runtime-test" });
  assert.equal(unbound.status, "blocked");
  assert.match(unbound.summary, /TargetSnapshot/i);
  assert.equal(supervisor.starts.length, 0);
  const result = await runtime.execute("shield_change_scan", {
    operationId: "operation-runtime-test",
    targetSnapshotId: "a".repeat(64),
    sessionId: "session-runtime-test",
    authorityId: "authority-runtime-test"
  });

  assert.equal(result.status, "completed");
  assert.equal(result.effectDisposition, "committed");
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
  assert.equal(request.targetSnapshotId, "a".repeat(64));
  assert.equal(request.sessionId, "session-runtime-test");
  assert.equal(request.authorityId, "authority-runtime-test");
  const terminal = await runtime.reconcileOperation({
    operationId: "operation-runtime-test",
    action: "shield_change_scan",
    targetSnapshotId: "a".repeat(64),
    repositoryRoot: setup.verified.canonicalRepositoryRoot,
    sessionId: "session-runtime-test",
    authorityId: "authority-runtime-test"
  });
  assert.equal(terminal.state, "terminal", "a naturally exited exact child must be observable as terminal");
  if (terminal.state === "terminal") {
    assert.equal(terminal.status, "completed");
    assert.equal(terminal.effectDisposition, "committed");
    assert.equal(terminal.sessionId, "session-runtime-test");
    assert.equal(terminal.authorityId, "authority-runtime-test");
  }
  assert.equal((await runtime.reconcileOperation({
    operationId: "operation-runtime-test", action: "shield_change_scan", targetSnapshotId: "b".repeat(64), repositoryRoot: setup.verified.canonicalRepositoryRoot
  })).state, "not_owner", "a process bound to another protected target must never be adopted");
});

test("repository runtime distinguishes a pre-start supervisor refusal from a failed child that already ran", async (context) => {
  const setup = await fixture(context);
  const beforeStart = new FakeSupervisor();
  beforeStart.failBeforeStart = true;
  const refused = await new RepositoryRuntime(setup.verified, { effectGuard: allowEffects, processSupervisor: beforeStart })
    .execute("shield_change_scan", { operationId: "operation-runtime-test", targetSnapshotId: "a".repeat(64) });
  assert.equal(refused.status, "failed");
  assert.equal(refused.effectDisposition, "not_started");

  const afterStart = new FakeSupervisor();
  afterStart.exitCode = 9;
  const failed = await new RepositoryRuntime(setup.verified, { effectGuard: allowEffects, processSupervisor: afterStart })
    .execute("shield_change_scan", { operationId: "operation-runtime-test", targetSnapshotId: "a".repeat(64) });
  assert.equal(failed.status, "failed");
  assert.equal(failed.effectDisposition, "committed");
  assert.equal(failed.exitCode, 9);
});

test("recovered durable supervisor identities can be observed and containment stops their entire owned tree", async (context) => {
  const setup = await fixture(context);
  const supervisor = new FakeSupervisor();
  const recovered = supervisor.handle(`managed:${"2".repeat(64)}`, 43211, "run_target", "b".repeat(64), "", true);
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
  const observation = await runtime.reconcileOperation({
    operationId: recovered.operationId,
    action: recovered.action,
    targetSnapshotId: "b".repeat(64),
    repositoryRoot: setup.verified.canonicalRepositoryRoot
  });
  assert.equal(observation.state, "terminal");
  if (observation.state === "terminal") {
    assert.equal(observation.status, "cancelled");
    assert.equal(observation.effectDisposition, "committed", "stopping the recovered tree does not prove rollback of its prior effects");
  }
});
