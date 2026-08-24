import assert from "node:assert/strict";
import test from "node:test";

import { HostActionOperationQueueControl, InstalledOperationControl, UnavailableInstalledRepositoryProcessSupervisor, WorkflowArtifactOperationQueueControl, type ExactOperationQueueControl, type ManagedProcessOperationControl } from "../src/operation-control.ts";

class Queue implements ExactOperationQueueControl {
  readonly calls: string[] = [];
  constructor(private readonly label: string, private readonly count: number) {}
  async cancelByOperation(operationId: string, reason: string) { this.calls.push(`${this.label}:operation:${operationId}:${reason}`); return this.count; }
  async cancelQueuedForRepository(repositoryRoot: string, reason: string) { this.calls.push(`${this.label}:repository:${repositoryRoot}:${reason}`); return this.count; }
  async observeOperation(operationId: string) { this.calls.push(`${this.label}:observe:${operationId}`); return { settled: this.count > 0, summary: `${this.label} observed exact state` }; }
}

class Processes implements ManagedProcessOperationControl {
  readonly calls: string[] = [];
  async cancelOperation(operationId: string, reason: string) { this.calls.push(`process:operation:${operationId}:${reason}`); return 1; }
  async cancelRepository(repositoryRoot: string, reason: string) { this.calls.push(`process:repository:${repositoryRoot}:${reason}`); return 2; }
  async reconcileOperation(operationId: string) { this.calls.push(`process:observe:${operationId}`); return { settled: true, summary: "owned process tree exited" }; }
}

test("operation cancellation reaches only exact durable queues and supervisor-owned process trees", async () => {
  const host = new Queue("host", 1); const provider = new Queue("provider", 1); const hardware = new Queue("hardware", 0); const processes = new Processes();
  const control = new InstalledOperationControl({ queues: [host, provider, hardware], processes });
  assert.deepEqual(await control.cancel({ operationId: "operation-1", reason: "operator cancelled" }), {
    accepted: true, summary: "Cancellation reached 2 exact queued item(s) and 1 supervisor-owned process tree(s); no unrelated process was targeted."
  });
  assert.deepEqual(host.calls, ["host:operation:operation-1:operator cancelled"]);
  assert.deepEqual(processes.calls, ["process:operation:operation-1:operator cancelled"]);
});

test("containment hook cancels exact repository queues and managed trees without a global process kill", async () => {
  const host = new Queue("host", 1); const hardware = new Queue("hardware", 1); const processes = new Processes();
  const control = new InstalledOperationControl({ queues: [host, hardware], processes });
  assert.deepEqual(await control.cancelQueuedOperations({ repositoryRoot: "C:\\repo", fenceEpoch: 4 }), { queued: 2, managedProcesses: 2 });
  assert.deepEqual(host.calls, ["host:repository:C:\\repo:Containment fence 4 cancelled exact repository-bound queued work."]);
  assert.deepEqual(processes.calls, ["process:repository:C:\\repo:Containment fence 4 cancelled exact repository-bound queued work."]);
});

test("reconciliation observes every exact controller and leaves uncertainty unsettled", async () => {
  const settled = new Queue("settled", 1); const unresolved = new Queue("unresolved", 0); const processes = new Processes();
  const control = new InstalledOperationControl({ queues: [settled, unresolved], processes });
  assert.deepEqual(await control.reconcile("operation-2"), {
    settled: false,
    summary: "Exact host observation remains unresolved in 1 controller(s); no work was replayed."
  });
});

test("host-action control adapts only exact durable queue bindings and treats terminal acknowledgements as settled", async () => {
  const calls: string[] = [];
  const control = new HostActionOperationQueueControl({
    async cancelPendingByOperation(operationId, reason) { calls.push(`operation:${operationId}:${reason}`); return 1; },
    async cancelQueuedForRepository(repositoryRoot, reason) { calls.push(`repository:${repositoryRoot}:${reason}`); return 2; },
    async observeOperation(operationId) { calls.push(`observe:${operationId}`); return { outcome: operationId === "done" ? "committed" : "unresolved", note: "exact host observation" }; }
  });
  assert.equal(await control.cancelByOperation("operation-1", "cancel"), 1);
  assert.equal(await control.cancelQueuedForRepository("C:\\repo", "contain"), 2);
  assert.deepEqual(await control.observeOperation("done"), { settled: true, summary: "exact host observation" });
  assert.deepEqual(await control.observeOperation("pending"), { settled: false, summary: "exact host observation" });
  assert.deepEqual(calls, ["operation:operation-1:cancel", "repository:C:\\repo:contain", "observe:done", "observe:pending"]);
});

test("provider workflow control cancels and observes only exact durable artifact bindings", async () => {
  const calls: string[] = [];
  const control = new WorkflowArtifactOperationQueueControl({
    async cancelByOperation(operationId) {
      calls.push(`operation:${operationId}`);
      return operationId === "submitted" ? { status: "cancelling" } : operationId === "prepared" ? { status: "cancelled" } : operationId === "done" ? { status: "acknowledged" } : undefined;
    },
    async cancelQueuedForRepository(repositoryRoot) {
      calls.push(`repository:${repositoryRoot}`);
      return [{ status: "cancelled" }, { status: "cancelling" }];
    },
    async observeOperation(operationId) {
      calls.push(`observe:${operationId}`);
      return operationId === "done" ? { status: "acknowledged" } : operationId === "pending" ? { status: "cancelling" } : undefined;
    }
  });
  assert.equal(await control.cancelByOperation("submitted", "cancel"), 1);
  assert.equal(await control.cancelByOperation("done", "cancel"), 0);
  assert.equal(await control.cancelByOperation("missing", "cancel"), 0);
  assert.equal(await control.cancelQueuedForRepository("C:\\repo", "contain"), 2);
  assert.deepEqual(await control.observeOperation("done"), { settled: true, summary: "The exact provider workflow artifact is durably acknowledged." });
  assert.deepEqual(await control.observeOperation("pending"), { settled: false, summary: "The exact provider workflow artifact remains cancelling; its external effect was not guessed or replayed." });
  assert.deepEqual(await control.observeOperation("missing"), { settled: false, summary: "No exact durable provider workflow artifact is bound to this operation." });
  assert.deepEqual(calls, ["operation:submitted", "operation:done", "operation:missing", "repository:C:\\repo", "observe:done", "observe:pending", "observe:missing"]);
});

test("missing packaged Job-Object helper never falls back to an unsupervised child process", async () => {
  const supervisor = new UnavailableInstalledRepositoryProcessSupervisor();
  assert.deepEqual(await supervisor.recover({ repositoryRoot: "C:\\repo", manifestSha256: "a".repeat(64) }), []);
  await assert.rejects(() => supervisor.start({} as never), /packaged.*Job-Object.*unavailable/i);
});
