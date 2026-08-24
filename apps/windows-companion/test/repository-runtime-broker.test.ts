import assert from "node:assert/strict";
import test from "node:test";

import type { ExecutionRequest } from "../../../packages/control-plane/src/brokers.ts";
import type { TargetSnapshot } from "../../../packages/control-plane/src/contracts.ts";
import {
  RepositoryRuntimeExecutionBroker,
  SandboxedRepositoryExecutionBroker,
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

test("healthy web launch queues only its exact URL through the durable authenticated host boundary", async () => {
  const queued: unknown[] = [];
  let cleanups = 0;
  const runtime = {
    async execute(): Promise<RepositoryRuntimeResult> {
      return { status: "running", summary: "healthy", managedProcessId: `managed:${"b".repeat(64)}`, pid: 4317, url: "http://127.0.0.1:4317/" };
    },
    async terminateManagedForContainment(): Promise<boolean> { cleanups += 1; return true; }
  };
  const broker = new RepositoryRuntimeExecutionBroker(
    { async resolve() { return runtime as unknown as RepositoryRuntime; } },
    {
      containment: { async check() { return { allowed: true, reason: "clear", fenceEpoch: 0 }; } },
      hostActions: { async enqueue(input, plan) { queued.push({ input, plan }); return { version: 1, id: `host-action:${"c".repeat(64)}`, operationId: input.operationId!, commandAction: input.definition.action, hostAction: plan.hostAction, url: plan.url, createdAt: "2026-08-24T00:00:00.000Z", expiresAt: "2026-08-24T00:01:00.000Z" }; } }
    }
  );
  const outcome = await broker.execute(request({ action: "launch_web_app", recipe: repositoryRuntimeExecutionRecipe("launch_web_app", target) }));
  assert.equal(outcome.status, "running");
  assert.equal(outcome.data?.hostActionKind, "open_external_url");
  assert.equal(outcome.data?.hostActionUrl, "http://127.0.0.1:4317/");
  assert.equal(queued.length, 1);
  assert.equal(cleanups, 0);
});

test("web launch stops its exact managed child if a final host URL is unsafe", async () => {
  let cleanups = 0;
  const runtime = {
    async execute(): Promise<RepositoryRuntimeResult> { return { status: "running", summary: "unexpected URL", managedProcessId: `managed:${"d".repeat(64)}`, pid: 77, url: "http://attacker.example/" }; },
    async terminateManagedForContainment(): Promise<boolean> { cleanups += 1; return true; }
  };
  const broker = new RepositoryRuntimeExecutionBroker(
    { async resolve() { return runtime as unknown as RepositoryRuntime; } },
    { hostActions: { async enqueue() { throw new Error("must not queue"); } } }
  );
  const outcome = await broker.execute(request({ action: "launch_web_app", recipe: repositoryRuntimeExecutionRecipe("launch_web_app", target) }));
  assert.equal(outcome.status, "blocked");
  assert.equal(cleanups, 1);
});

test("debug routes one exact attested launch configuration through the authenticated VS Code host", async () => {
  const queued: unknown[] = [];
  const runtime = { async execute(): Promise<RepositoryRuntimeResult> { return { status: "running", summary: "ready", debugConfiguration: "Launch test" }; } };
  const broker = new RepositoryRuntimeExecutionBroker(
    { async resolve() { return runtime as unknown as RepositoryRuntime; } },
    { hostActions: { async enqueue(input, plan) { queued.push({ input, plan }); return { version: 1, id: `host-action:${"f".repeat(64)}`, operationId: input.operationId!, commandAction: input.definition.action, hostAction: plan.hostAction, workspaceRoot: input.target?.repositoryRoot, debugConfiguration: plan.debugConfiguration, createdAt: "2026-08-24T00:00:00.000Z", expiresAt: "2026-08-24T00:01:00.000Z" }; } } }
  );
  const outcome = await broker.execute(request({ action: "debug_target", recipe: repositoryRuntimeExecutionRecipe("debug_target", target) }));
  assert.equal(outcome.status, "running");
  assert.equal(outcome.data?.hostActionKind, "start_vscode_debug");
  assert.equal(outcome.data?.hostActionWorkspaceRoot, target.repositoryRoot);
  assert.equal(outcome.data?.hostActionDebugConfiguration, "Launch test");
  assert.equal(queued.length, 1);
});

test("venv completion selects only the exact repo-local interpreter through the authenticated VS Code host", async () => {
  const interpreter = `${target.repositoryRoot}\\.venv\\Scripts\\python.exe`;
  const runtime = { async execute(): Promise<RepositoryRuntimeResult> { return { status: "completed", summary: "venv ready", pythonInterpreter: interpreter }; } };
  const broker = new RepositoryRuntimeExecutionBroker(
    { async resolve() { return runtime as unknown as RepositoryRuntime; } },
    { hostActions: { async enqueue(input, plan) { return { version: 1, id: `host-action:${"1".repeat(64)}`, operationId: input.operationId!, commandAction: input.definition.action, hostAction: plan.hostAction, workspaceRoot: input.target?.repositoryRoot, pythonInterpreter: plan.pythonInterpreter, createdAt: "2026-08-24T00:00:00.000Z", expiresAt: "2026-08-24T00:01:00.000Z" }; } } }
  );
  const outcome = await broker.execute(request({ action: "venv", recipe: repositoryRuntimeExecutionRecipe("venv", target) }));
  assert.equal(outcome.status, "running");
  assert.equal(outcome.data?.hostActionKind, "configure_python_venv");
  assert.equal(outcome.data?.hostActionPythonInterpreter, interpreter);
});

test("pipeline and security recipes always route through the OS sandbox runner", async () => {
  let hostResolutions = 0;
  const actions: string[] = [];
  const broker = new SandboxedRepositoryExecutionBroker(
    { async resolve() { hostResolutions += 1; throw new Error("host runtime must not run"); } },
    { async runRecipe(invocation, recipeId) {
      actions.push(`${invocation.action}:${recipeId}:${invocation.profile}`);
      return { status: "completed", summary: "OS sandbox receipt verified", data: { enforced: true, receiptEvidenceEnvelope: {
        schema: "sxsy-b122.host-receipt-evidence", version: 1, producer: "repository-runtime", action: invocation.action,
        operationId: invocation.operationId, targetSnapshotId: invocation.target.id, policyVersion: invocation.target.policyVersion,
        outcome: "passed", completeness: "complete", evidenceDigest: "a".repeat(64), authenticationTag: "b".repeat(64)
      } } };
    } }
  );
  const pipeline = await broker.execute(request({ action: "pipeline_local_gate", recipe: { ...repositoryRuntimeExecutionRecipe("pipeline_local_gate", target), environment: { NODE_ENV: "test", SXSY_TEST_MODE: "1", SXSY_NETWORK: "deny" } } }));
  const shield = await broker.execute(request({ action: "shield_change_scan", recipe: repositoryRuntimeExecutionRecipe("shield_change_scan", target) }));
  assert.equal(pipeline.status, "completed");
  assert.equal(shield.status, "completed");
  assert.deepEqual(actions, ["pipeline_local_gate:pipeline_local_gate:full_sandbox", "shield_change_scan:shield_change_scan:full_sandbox"]);
  assert.equal(hostResolutions, 0);
});
