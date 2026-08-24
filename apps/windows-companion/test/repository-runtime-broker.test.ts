import assert from "node:assert/strict";
import test from "node:test";

import type { ExecutionRequest } from "../../../packages/control-plane/src/brokers.ts";
import type { TargetSnapshot } from "../../../packages/control-plane/src/contracts.ts";
import {
  RepositoryRuntimeExecutionBroker,
  repositoryRuntimeExecutionRecipe
} from "../src/repository-runtime-broker.ts";
import type { RepositoryRuntime, RepositoryRuntimeExecuteOptions, RepositoryRuntimeResult } from "../src/repository-runtime.ts";

const target: TargetSnapshot = {
  id: "target-runtime-broker",
  repositoryRoot: "C:\\repo",
  branch: "feature/runtime",
  head: "a".repeat(40),
  indexTree: "b".repeat(40),
  trackedManifest: "c".repeat(64),
  untrackedManifest: "d".repeat(64),
  canonicalRemote: "https://github.com/example/repo.git",
  submodules: {},
  policyVersion: "test",
  environmentFingerprint: "e".repeat(64),
  capturedAt: new Date().toISOString(),
  completeness: "complete",
  reasons: []
};

function request(overrides: Partial<ExecutionRequest> = {}): ExecutionRequest {
  return {
    action: "run_target",
    operationId: "operation-runtime",
    target,
    permit: { expiresAt: new Date(Date.now() + 60_000).toISOString() } as ExecutionRequest["permit"],
    recipe: repositoryRuntimeExecutionRecipe("run_target", target),
    effectGuard: { async assertCurrent() { return { allowed: true, reason: "current" }; } },
    ...overrides
  };
}

test("repository runtime broker preserves running state and binds the exact dispatch guard", async () => {
  let options: RepositoryRuntimeExecuteOptions | undefined;
  const runtime = {
    async execute(_action: string, input: RepositoryRuntimeExecuteOptions): Promise<RepositoryRuntimeResult> {
      options = input;
      return { status: "running", summary: "managed child started", managedProcessId: `managed:${"a".repeat(64)}`, pid: 1234 };
    }
  };
  const broker = new RepositoryRuntimeExecutionBroker({ async resolve() { return runtime as unknown as RepositoryRuntime; } });
  const outcome = await broker.execute(request());

  assert.equal(outcome.status, "running");
  assert.equal(outcome.data?.managedProcessId, `managed:${"a".repeat(64)}`);
  assert.equal((await options?.effectGuard?.check("run_target", target.repositoryRoot))?.allowed, true);
});

test("repository runtime broker refuses recipe/action confusion and pre-cancelled work", async () => {
  let calls = 0;
  const runtime = { async execute(): Promise<RepositoryRuntimeResult> { calls += 1; return { status: "completed", summary: "unexpected" }; } };
  const broker = new RepositoryRuntimeExecutionBroker({ async resolve() { return runtime as unknown as RepositoryRuntime; } });

  const confused = await broker.execute(request({ recipe: repositoryRuntimeExecutionRecipe("debug_target", target) }));
  assert.equal(confused.status, "blocked");
  const cancelled = await broker.execute(request({ executionControl: {
    operationId: "operation-runtime",
    deadline: new Date(Date.now() + 60_000).toISOString(),
    async isCancellationRequested() { return true; }
  } }));
  assert.equal(cancelled.status, "cancelled");
  assert.equal(calls, 0);
});

test("missing host pin remains unavailable and never falls back to recipe command text", async () => {
  const broker = new RepositoryRuntimeExecutionBroker({ async resolve() { throw new Error("No active host-attested repository runtime pin exists."); } });
  const outcome = await broker.execute(request({ recipe: { ...repositoryRuntimeExecutionRecipe("run_target", target), executable: "evil.exe", args: ["untrusted"] } }));
  assert.equal(outcome.status, "blocked");

  const unavailable = await broker.execute(request());
  assert.equal(unavailable.status, "unavailable");
  assert.match(unavailable.summary, /host-attested.*pin/i);
});
