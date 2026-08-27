import assert from "node:assert/strict";
import test from "node:test";

import type { ExecutionRequest } from "../../../packages/control-plane/src/brokers.ts";
import type { ManagedSession, TargetSnapshot } from "../../../packages/control-plane/src/contracts.ts";
import {
  RepositoryRuntimeExecutionBroker,
  SandboxedRepositoryExecutionBroker,
  repositoryRuntimeExecutionRecipe
} from "../src/repository-runtime-broker.ts";
import type { RepositoryRuntime, RepositoryRuntimeExecuteOptions, RepositoryRuntimeResult } from "../src/repository-runtime.ts";

const target: TargetSnapshot = {
  id: "f".repeat(64),
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

const providerSession: ManagedSession = {
  id: "provider-runtime-session", provider: "codex", surface: "vscode_terminal", capabilities: ["registered", "mediated"], status: "running",
  workspaceRoot: target.repositoryRoot, targetSnapshotId: target.id, taskId: "task-runtime", planRevision: "plan-runtime", plannedFiles: [],
  lastHeartbeat: "2026-08-26T20:00:00.000Z", adapterVersion: "provider-v1", metadata: { source: "trusted" }
};
const transitionedTarget: TargetSnapshot = { ...target, id: "0".repeat(64), untrackedManifest: "0".repeat(64) };
const successfulTransition = {
  async captureAndAccept() {
    return { status: "transitioned" as const, target: transitionedTarget, session: { ...providerSession, targetSnapshotId: transitionedTarget.id } };
  }
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
  const outcome = await broker.execute(request({ session: providerSession }));

  assert.equal(outcome.status, "running");
  assert.equal(outcome.data?.managedProcessId, `managed:${"a".repeat(64)}`);
  assert.deepEqual(outcome.data?.managedRun, {
    version: 1,
    kind: "managed-run",
    managedProcessId: `managed:${"a".repeat(64)}`,
    originOperationId: "operation-runtime",
    originSessionId: providerSession.id,
    workspaceRoot: target.repositoryRoot,
    targetSnapshotId: target.id
  });
  assert.equal(options?.targetSnapshotId, target.id);
  assert.equal((await options?.effectGuard?.check("run_target", target.repositoryRoot))?.allowed, true);
});

test("repository runtime broker preserves exact post-start effect disposition", async () => {
  const runtime = {
    async execute(): Promise<RepositoryRuntimeResult> {
      return {
        status: "failed",
        summary: "the exact foreground child exited unsuccessfully after starting",
        effectDisposition: "committed",
        exitCode: 9
      };
    }
  };
  const broker = new RepositoryRuntimeExecutionBroker({ async resolve() { return runtime as unknown as RepositoryRuntime; } });
  const outcome = await broker.execute(request());

  assert.equal(outcome.status, "failed");
  assert.equal(outcome.effectDisposition, "committed");
  assert.equal(outcome.data?.exitCode, 9);
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

test("repository runtime bounds never-settling cancellation reads and propagates one serialized abort", async () => {
  let runtimeCalls = 0;
  let initialReads = 0;
  const neverStarts = new RepositoryRuntimeExecutionBroker({ async resolve() {
    return { async execute(): Promise<RepositoryRuntimeResult> { runtimeCalls += 1; return { status: "completed", summary: "must not run" }; } } as unknown as RepositoryRuntime;
  } });
  const started = Date.now();
  const timedOut = await neverStarts.execute(request({ executionControl: {
    operationId: "operation-runtime",
    deadline: new Date(Date.now() + 40).toISOString(),
    async isCancellationRequested() { initialReads += 1; return new Promise<boolean>(() => undefined); }
  } }));
  assert.equal(timedOut.status, "timed_out");
  assert.equal(runtimeCalls, 0);
  assert.equal(initialReads, 1);
  assert.ok(Date.now() - started < 1_000);

  let reads = 0;
  let activeReads = 0;
  let maximumActiveReads = 0;
  const polling = new RepositoryRuntimeExecutionBroker({ async resolve() {
    return {
      async execute(_action: string, options: RepositoryRuntimeExecuteOptions): Promise<RepositoryRuntimeResult> {
        runtimeCalls += 1;
        const signal = options.signal;
        assert.ok(signal);
        if (!signal.aborted) await new Promise<void>((resolve) => signal.addEventListener("abort", () => resolve(), { once: true }));
        return { status: "cancelled", summary: "bounded durable abort observed" };
      }
    } as unknown as RepositoryRuntime;
  } });
  const bounded = await polling.execute(request({ executionControl: {
    operationId: "operation-runtime",
    deadline: new Date(Date.now() + 180).toISOString(),
    async isCancellationRequested() {
      reads += 1;
      activeReads += 1;
      maximumActiveReads = Math.max(maximumActiveReads, activeReads);
      if (reads === 1) { activeReads -= 1; return false; }
      return new Promise<boolean>(() => undefined);
    }
  } }));
  assert.equal(bounded.status, "cancelled");
  assert.equal(reads, 2);
  assert.equal(maximumActiveReads, 1);
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
  assert.equal(outcome.effectDisposition, "committed");
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
  assert.equal(outcome.effectDisposition, "committed");
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
  assert.equal(outcome.effectDisposition, "committed");
  assert.equal(outcome.data?.hostActionKind, "start_vscode_debug");
  assert.equal(outcome.data?.hostActionWorkspaceRoot, target.repositoryRoot);
  assert.equal(outcome.data?.hostActionDebugConfiguration, "Launch test");
  assert.equal(queued.length, 1);
});

test("Alt Run queues stop for the exact durable VS Code debug origin instead of an unrelated process supervisor", async () => {
  const queued: unknown[] = [];
  let runtimeStopCalls = 0;
  const runtime = {
    allowsManagedStop(action: string): boolean { return action === "debug_target"; },
    async execute(): Promise<RepositoryRuntimeResult> { runtimeStopCalls += 1; return { status: "failed", summary: "must not use the process supervisor for VS Code debug" }; }
  };
  const providerSource = {
    id: "git-session-1",
    provider: "codex" as const,
    surface: "vscode_terminal" as const,
    capabilities: ["registered" as const, "observable" as const, "controllable" as const, "mediated" as const],
    status: "running" as const,
    workspaceRoot: target.repositoryRoot,
    targetSnapshotId: target.id,
    taskId: "task-debug",
    planRevision: "plan-debug",
    plannedFiles: [],
    lastHeartbeat: "2026-08-25T00:00:00.000Z",
    adapterVersion: "provider-1.0.0",
    metadata: { "sxsy-b122.providerHandshake": "exact-route-v1" }
  };
  const debugSession = {
    id: "vscode-window:debug-session:debug-1",
    provider: "generic" as const,
    surface: "vscode_window" as const,
    capabilities: ["registered" as const],
    status: "running" as const,
    workspaceRoot: target.repositoryRoot,
    targetSnapshotId: target.id,
    plannedFiles: [],
    lastHeartbeat: "2026-08-25T00:00:00.000Z",
    adapterVersion: "1.0.0",
    metadata: {
      "sxsy-b122.kind": "debug-session",
      "sxsy-b122.debugSessionId": "debug-1",
      "sxsy-b122.debugOriginOperationId": "operation-debug-origin",
      "sxsy-b122.debugOriginSessionId": providerSource.id,
      "sxsy-b122.debugBindingId": "debug-binding-1",
      "sxsy-b122.debugWorkspaceRoot": target.repositoryRoot,
      "sxsy-b122.debugConfiguration": "Launch test"
    }
  };
  const broker = new RepositoryRuntimeExecutionBroker(
    { async resolve() { return runtime as unknown as RepositoryRuntime; } },
    { hostActions: { async enqueue(input, plan) {
      queued.push({ input, plan });
      return {
        version: 1, id: `host-action:${"2".repeat(64)}`, operationId: input.operationId!, commandAction: input.definition.action,
        hostAction: plan.hostAction, workspaceRoot: input.target?.repositoryRoot, debugConfiguration: plan.debugConfiguration,
        debugSessionId: plan.debugSessionId, debugEffectSessionId: plan.debugEffectSessionId,
        debugEffectSessionBindingDigest: plan.debugEffectSessionBindingDigest, debugSourceSessionBindingDigest: plan.debugSourceSessionBindingDigest,
        debugBindingId: plan.debugBindingId, debugOriginOperationId: plan.debugOriginOperationId,
        createdAt: "2026-08-25T00:00:00.000Z", expiresAt: "2026-08-25T00:01:00.000Z"
      };
    } } }
  );
  const legacyRawSelection = await broker.execute(request({
    action: "stop_managed_run",
    operationId: "operation-debug-stop-raw-selection",
    recipe: repositoryRuntimeExecutionRecipe("stop_managed_run", target),
    session: debugSession
  }));
  assert.equal(legacyRawSelection.status, "blocked");
  assert.equal(legacyRawSelection.effectDisposition, "not_started");
  assert.equal(queued.length, 0, "a raw bridge-selected effect cannot substitute for protected review recovery");
  const outcome = await broker.execute(request({
    action: "stop_managed_run",
    operationId: "operation-debug-stop",
    recipe: repositoryRuntimeExecutionRecipe("stop_managed_run", target),
    session: providerSource,
    effectSession: debugSession
  }));
  assert.equal(outcome.status, "running");
  assert.equal(outcome.effectDisposition, "committed");
  assert.equal(outcome.data?.hostActionKind, "stop_vscode_debug");
  assert.equal(outcome.data?.hostActionDebugSessionId, "debug-1");
  assert.equal(outcome.data?.hostActionDebugEffectSessionId, debugSession.id);
  assert.equal(outcome.data?.hostActionDebugBindingId, "debug-binding-1");
  assert.equal(outcome.data?.hostActionDebugOriginOperationId, "operation-debug-origin");
  assert.equal(outcome.data?.hostActionWorkspaceRoot, target.repositoryRoot);
  assert.equal(runtimeStopCalls, 0);
  assert.equal(queued.length, 1);
  const queuedStop = queued[0] as { input: { session?: { id: string } }; plan: Record<string, unknown> };
  assert.equal(queuedStop.input.session?.id, providerSource.id, "the durable dispatcher request remains the provider authority source");
  assert.equal(Object.hasOwn(queuedStop.input, "effectSession"), false, "the recovered debug effect never becomes a raw adapter request selection");
  assert.equal(queuedStop.plan.debugEffectSessionId, debugSession.id);
  assert.equal(queuedStop.plan.debugBindingId, "debug-binding-1");
  assert.equal(queuedStop.plan.debugOriginOperationId, "operation-debug-origin");
  assert.match(String(queuedStop.plan.debugSourceSessionBindingDigest), /^[a-f0-9]{64}$/);
  assert.match(String(queuedStop.plan.debugEffectSessionBindingDigest), /^[a-f0-9]{64}$/);
  assert.notEqual(queuedStop.plan.debugSourceSessionBindingDigest, queuedStop.plan.debugEffectSessionBindingDigest);

  const changedOrigin = { ...debugSession, metadata: { ...debugSession.metadata, "sxsy-b122.debugOriginOperationId": "" } };
  const blocked = await broker.execute(request({ action: "stop_managed_run", recipe: repositoryRuntimeExecutionRecipe("stop_managed_run", target), session: providerSource, effectSession: changedOrigin }));
  assert.notEqual(blocked.status, "running");
  assert.equal(blocked.effectDisposition, "not_started");
  assert.equal(queued.length, 1);

  const unavailableQueue = new RepositoryRuntimeExecutionBroker(
    { async resolve() { return runtime as unknown as RepositoryRuntime; } },
    { hostActions: { async enqueue(): Promise<never> { throw new Error("queue unavailable"); } } }
  );
  const notQueued = await unavailableQueue.execute(request({
    action: "stop_managed_run",
    operationId: "operation-debug-stop-not-queued",
    recipe: repositoryRuntimeExecutionRecipe("stop_managed_run", target),
    session: providerSource,
    effectSession: debugSession
  }));
  assert.equal(notQueued.status, "failed");
  assert.equal(notQueued.effectDisposition, "not_started");
});

test("Alt Run terminates only the exact reviewed managed Run process through its pinned repository runtime", async () => {
  const managedProcessId = `managed:${"8".repeat(64)}`;
  const managedRun = {
    id: "vscode-window:managed-run:operation-runtime",
    provider: "generic" as const,
    surface: "vscode_window" as const,
    capabilities: ["registered" as const],
    status: "running" as const,
    workspaceRoot: target.repositoryRoot,
    targetSnapshotId: target.id,
    plannedFiles: [],
    lastHeartbeat: "2026-08-26T20:00:00.000Z",
    adapterVersion: "switchyard-vscode-v1",
    metadata: {
      "sxsy-b122.kind": "managed-run",
      "sxsy-b122.managedProcessId": managedProcessId,
      "sxsy-b122.runOriginOperationId": "operation-run-origin",
      "sxsy-b122.runOriginSessionId": providerSession.id,
      "sxsy-b122.runWorkspaceRoot": target.repositoryRoot
    }
  };
  let stoppedWith: RepositoryRuntimeExecuteOptions | undefined;
  let hostCalls = 0;
  const runtime = {
    allowsManagedStop(action: string): boolean { return action === "run_target"; },
    async execute(action: string, options: RepositoryRuntimeExecuteOptions): Promise<RepositoryRuntimeResult> {
      assert.equal(action, "stop_managed_run");
      stoppedWith = options;
      return { status: "completed", summary: "exact managed Run process stopped", effectDisposition: "committed", managedProcessId };
    }
  };
  const broker = new RepositoryRuntimeExecutionBroker(
    { async resolve() { return runtime as unknown as RepositoryRuntime; } },
    { hostActions: { async enqueue(): Promise<never> { hostCalls += 1; throw new Error("must not enqueue"); } } }
  );
  const outcome = await broker.execute(request({
    action: "stop_managed_run",
    operationId: "operation-stop-managed-run",
    recipe: repositoryRuntimeExecutionRecipe("stop_managed_run", target),
    session: providerSession,
    effectSession: managedRun
  }));
  assert.equal(outcome.status, "completed");
  assert.equal(outcome.effectDisposition, "committed");
  assert.equal(outcome.data?.managedProcessId, managedProcessId);
  assert.equal(outcome.data?.managedRunEffectSessionId, managedRun.id);
  assert.equal(outcome.data?.managedRunOriginOperationId, "operation-run-origin");
  assert.equal(stoppedWith?.managedProcessId, managedProcessId);
  assert.equal(stoppedWith?.sessionId, providerSession.id);
  assert.equal(stoppedWith?.targetSnapshotId, target.id);
  assert.equal(hostCalls, 0, "managed Run termination never falls through to a VS Code debug host action");

  const substituted = await broker.execute(request({
    action: "stop_managed_run",
    operationId: "operation-stop-managed-run-substituted",
    recipe: repositoryRuntimeExecutionRecipe("stop_managed_run", target),
    session: providerSession,
    effectSession: { ...managedRun, metadata: { ...managedRun.metadata, "sxsy-b122.managedProcessId": `managed:${"9".repeat(63)}` } }
  }));
  assert.equal(substituted.status, "blocked");
  assert.equal(substituted.effectDisposition, "not_started");
});

test("venv completion selects only the exact repo-local interpreter through the authenticated VS Code host", async () => {
  const interpreter = `${target.repositoryRoot}\\.venv\\Scripts\\python.exe`;
  const pythonInterpreterIdentity = { canonicalPath: interpreter, sha256: "7".repeat(64), device: "1", inode: "2", size: 42, modifiedMs: 1_777_000_000_000 };
  const runtime = { async execute(): Promise<RepositoryRuntimeResult> { return { status: "completed", summary: "venv ready", pythonInterpreter: interpreter, pythonInterpreterIdentity }; } };
  let queuedTarget: string | undefined;
  const broker = new RepositoryRuntimeExecutionBroker(
    { async resolve() { return runtime as unknown as RepositoryRuntime; } },
    { targetTransitions: successfulTransition, hostActions: { async enqueue(input, plan) { queuedTarget = input.target?.id; return { version: 1, id: `host-action:${"1".repeat(64)}`, operationId: input.operationId!, commandAction: input.definition.action, hostAction: plan.hostAction, targetSnapshotId: input.target?.id, sessionId: input.session?.id, workspaceRoot: input.target?.repositoryRoot, pythonInterpreter: plan.pythonInterpreter, pythonInterpreterIdentity: plan.pythonInterpreterIdentity, createdAt: "2026-08-24T00:00:00.000Z", expiresAt: "2026-08-24T00:01:00.000Z" }; } } }
  );
  const outcome = await broker.execute(request({ action: "venv", recipe: repositoryRuntimeExecutionRecipe("venv", target), session: providerSession }));
  assert.equal(outcome.status, "running");
  assert.equal(outcome.effectDisposition, "committed");
  assert.equal(outcome.data?.hostActionKind, "configure_python_venv");
  assert.equal(outcome.data?.hostActionPythonInterpreter, interpreter);
  assert.deepEqual(outcome.data?.hostActionPythonInterpreterIdentity, pythonInterpreterIdentity);
  assert.equal(outcome.data?.previousTargetSnapshotId, target.id);
  assert.equal(outcome.data?.acceptedTargetSnapshotId, transitionedTarget.id);
  assert.equal(queuedTarget, transitionedTarget.id, "the host action is authorized against the accepted after-snapshot, never the stale pre-effect target");
});

test("post-runtime host-action rejection preserves the exact effect disposition for venv, web, and debug", async () => {
  const interpreter = `${target.repositoryRoot}\\.venv\\Scripts\\python.exe`;
  const denyGuard = { async assertCurrent() { return { allowed: false, reason: "target changed" }; } };
  const allowFence = { async check() { return { allowed: true, reason: "clear", fenceEpoch: 0 }; } };
  const denyFence = { async check(_root: string, scope: string) { return scope === "adapter"
    ? { allowed: false, reason: "contained", fenceEpoch: 1 }
    : { allowed: true, reason: "clear", fenceEpoch: 0 }; } };
  const rejectQueue = { async enqueue(): Promise<never> { throw new Error("queue unavailable"); } };

  const rejectedTransition = { async captureAndAccept(): Promise<never> { throw new Error("target transition rejected"); } };
  for (const [label, pythonInterpreter, containment, targetTransitions] of [
    ["invalid interpreter", "C:\\other\\python.exe", allowFence, successfulTransition],
    ["final fence", interpreter, denyFence, successfulTransition],
    ["target transition", interpreter, allowFence, rejectedTransition],
    ["queue failure", interpreter, allowFence, successfulTransition]
  ] as const) {
    const runtime = { async execute(): Promise<RepositoryRuntimeResult> { return { status: "completed", summary: "venv process ran", pythonInterpreter }; } };
    const broker = new RepositoryRuntimeExecutionBroker(
      { async resolve() { return runtime as unknown as RepositoryRuntime; } },
      { containment, targetTransitions, hostActions: rejectQueue }
    );
    const outcome = await broker.execute(request({ action: "venv", recipe: repositoryRuntimeExecutionRecipe("venv", target), session: providerSession }));
    assert.equal(outcome.effectDisposition, "committed", `venv ${label}`);
  }

  for (const [label, containment, effectGuard] of [
    ["final fence", denyFence, request().effectGuard],
    ["final guard", allowFence, denyGuard],
    ["queue failure", allowFence, request().effectGuard]
  ] as const) {
    let cleanups = 0;
    const runtime = {
      async execute(): Promise<RepositoryRuntimeResult> { return { status: "running", summary: "web child started", managedProcessId: `managed:${"9".repeat(64)}`, url: "http://127.0.0.1:4317/" }; },
      async terminateManagedForContainment(): Promise<boolean> { cleanups += 1; return true; }
    };
    const broker = new RepositoryRuntimeExecutionBroker(
      { async resolve() { return runtime as unknown as RepositoryRuntime; } },
      { containment, hostActions: rejectQueue }
    );
    const outcome = await broker.execute(request({ action: "launch_web_app", recipe: repositoryRuntimeExecutionRecipe("launch_web_app", target), effectGuard }));
    assert.equal(outcome.effectDisposition, "committed", `web ${label}`);
    assert.equal(cleanups, 1, `web ${label} must stop its exact child`);
  }

  for (const [label, configuration, containment, effectGuard] of [
    ["invalid configuration", "bad\nconfiguration", allowFence, request().effectGuard],
    ["final fence", "Launch test", denyFence, request().effectGuard],
    ["final guard", "Launch test", allowFence, denyGuard],
    ["queue failure", "Launch test", allowFence, request().effectGuard]
  ] as const) {
    const runtime = { async execute(): Promise<RepositoryRuntimeResult> { return { status: "running", summary: "debug plan ready", debugConfiguration: configuration }; } };
    const broker = new RepositoryRuntimeExecutionBroker(
      { async resolve() { return runtime as unknown as RepositoryRuntime; } },
      { containment, hostActions: rejectQueue }
    );
    const outcome = await broker.execute(request({ action: "debug_target", recipe: repositoryRuntimeExecutionRecipe("debug_target", target), effectGuard }));
    assert.equal(outcome.effectDisposition, "not_started", `debug ${label}`);
  }
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
