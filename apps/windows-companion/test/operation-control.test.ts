import assert from "node:assert/strict";
import test from "node:test";

import { HardwareSignalTriggerOperationQueueControl, HostActionOperationQueueControl, InstalledOperationControl, UnavailableInstalledRepositoryProcessSupervisor, WorkflowArtifactOperationQueueControl, type ExactOperationQueueControl, type ManagedProcessOperationControl } from "../src/operation-control.ts";
import type { OperationReconciliationBinding } from "../../../packages/control-plane/src/runtime.ts";

const binding: OperationReconciliationBinding = {
  operationId: "operation-2",
  action: "run_target",
  targetSnapshotId: "a".repeat(64),
  repositoryRoot: "C:\\repo",
  sessionId: "session-operation-control",
  authorityId: "authority-operation-control"
};

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
  async reconcileOperation(expected: OperationReconciliationBinding) {
    this.calls.push(`process:observe:${expected.operationId}:${expected.action}:${expected.targetSnapshotId}`);
    return {
      state: "terminal" as const,
      operationId: expected.operationId,
      action: expected.action,
      targetSnapshotId: expected.targetSnapshotId,
      repositoryRoot: expected.repositoryRoot,
      sessionId: expected.sessionId,
      authorityId: expected.authorityId,
      status: "completed" as const,
      effectDisposition: "committed" as const,
      summary: "owned process tree exited",
      evidenceDigest: "b".repeat(64),
      toolVersions: { repositorySupervisor: "test-v1" }
    };
  }
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

test("containment also cancels registered direct repository effects such as an active voice loop", async () => {
  const calls: string[] = [];
  const control = new InstalledOperationControl({
    repositoryEffects: [{
      async cancelRepository(repositoryRoot, reason) {
        calls.push(`${repositoryRoot}:${reason}`);
        return 1;
      }
    }]
  });
  assert.deepEqual(await control.cancelQueuedOperations({ repositoryRoot: "C:\\repo", fenceEpoch: 7 }), {
    queued: 0,
    managedProcesses: 0,
    repositoryEffects: 1
  });
  assert.deepEqual(calls, ["C:\\repo:Containment fence 7 cancelled exact repository-bound queued work."]);
});

test("bound reconciliation returns one exact terminal controller result and never treats missing legacy queues as owners", async () => {
  const missing = new Queue("No exact durable host item", 0); const processes = new Processes();
  const control = new InstalledOperationControl({ queues: [missing], processes });
  assert.deepEqual(await control.observe(binding), {
    state: "terminal",
    operationId: binding.operationId,
    action: binding.action,
    targetSnapshotId: binding.targetSnapshotId,
    repositoryRoot: binding.repositoryRoot,
    sessionId: binding.sessionId,
    authorityId: binding.authorityId,
    status: "completed",
    effectDisposition: "committed",
    summary: "owned process tree exited",
    evidenceDigest: "b".repeat(64),
    toolVersions: { repositorySupervisor: "test-v1" }
  });
  assert.deepEqual(processes.calls, [`process:observe:operation-2:run_target:${"a".repeat(64)}`]);
});

test("unbound, conflicting, and active observations remain ambiguous and cannot produce a terminal result", async () => {
  const active = new Queue("active queue", 0);
  const control = new InstalledOperationControl({ queues: [active] });
  assert.deepEqual(await control.observe(binding), {
    state: "active",
    operationId: binding.operationId,
    action: binding.action,
    targetSnapshotId: binding.targetSnapshotId,
    repositoryRoot: binding.repositoryRoot,
    sessionId: binding.sessionId,
    authorityId: binding.authorityId,
    effectDisposition: "ambiguous",
    summary: "At least one exact host controller remains active or cannot prove a terminal effect; no work was replayed."
  });
  assert.deepEqual(await control.reconcile(binding.operationId), {
    settled: false,
    summary: "Exact terminal reconciliation requires the durable operation, action, and target binding; no work was replayed."
  });
});

test("host-action control adapts only exact durable queue bindings and treats terminal acknowledgements as settled", async () => {
  const calls: string[] = [];
  const control = new HostActionOperationQueueControl({
    async cancelPendingByOperation(operationId, reason) { calls.push(`operation:${operationId}:${reason}`); return 1; },
    async cancelQueuedForRepository(repositoryRoot, reason) { calls.push(`repository:${repositoryRoot}:${reason}`); return 2; },
    async observeOperation(operationId, action, targetSnapshotId, repositoryRoot) {
      calls.push(`observe:${operationId}`);
      return {
        outcome: operationId === "done" || operationId === "wrong-binding" ? "committed" : "unresolved",
        note: "exact host observation",
        ...(action ? { binding: { action, targetSnapshotId: operationId === "wrong-binding" ? "f".repeat(64) : targetSnapshotId, repositoryRoot } } : {})
      };
    }
  });
  assert.equal(await control.cancelByOperation("operation-1", "cancel"), 1);
  assert.equal(await control.cancelQueuedForRepository("C:\\repo", "contain"), 2);
  assert.deepEqual(await control.observeOperation("done"), { settled: true, summary: "exact host observation" });
  assert.deepEqual(await control.observeOperation("pending"), { settled: false, summary: "exact host observation" });
  assert.deepEqual(await control.observeBoundOperation({ ...binding, operationId: "done" }), {
    state: "terminal", ...binding, operationId: "done", status: "completed", effectDisposition: "committed", summary: "exact host observation"
  });
  assert.deepEqual(await control.observeBoundOperation({ ...binding, operationId: "wrong-binding" }), {
    state: "active", ...binding, operationId: "wrong-binding", effectDisposition: "ambiguous",
    summary: "The durable host action does not prove the exact protected action and target binding; terminal state remains ambiguous."
  });
  assert.deepEqual(calls, ["operation:operation-1:cancel", "repository:C:\\repo:contain", "observe:done", "observe:pending", "observe:done", "observe:wrong-binding"]);
});

test("host-action failure without an exact effect disposition remains ambiguous", async () => {
  const control = new HostActionOperationQueueControl({
    async cancelPendingByOperation() { return 0; },
    async cancelQueuedForRepository() { return 0; },
    async observeOperation() {
      return {
        outcome: "failed", note: "The host reported failure after a bounded action.",
        binding: { action: binding.action, targetSnapshotId: binding.targetSnapshotId, repositoryRoot: binding.repositoryRoot }
      };
    }
  });
  assert.deepEqual(await control.observeBoundOperation(binding), {
    state: "active", ...binding, effectDisposition: "ambiguous",
    summary: "The durable host action reports failure without an exact effect disposition; terminal state remains ambiguous and no work was replayed."
  });
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
      return operationId === "done" ? { status: "acknowledged", providerEffectDisposition: "committed" as const, action: binding.action, targetSnapshotId: binding.targetSnapshotId, repositoryRoot: binding.repositoryRoot }
        : operationId === "legacy-done" ? { status: "acknowledged", action: binding.action, targetSnapshotId: binding.targetSnapshotId, repositoryRoot: binding.repositoryRoot }
          : operationId === "conflicting-done" ? { status: "acknowledged", providerEffectDisposition: "not_started" as const, action: binding.action, targetSnapshotId: binding.targetSnapshotId, repositoryRoot: binding.repositoryRoot }
            : operationId === "rejected" ? { status: "rejected", providerEffectDisposition: "not_started" as const, action: binding.action, targetSnapshotId: binding.targetSnapshotId, repositoryRoot: binding.repositoryRoot }
              : operationId === "legacy-rejected" ? { status: "rejected", action: binding.action, targetSnapshotId: binding.targetSnapshotId, repositoryRoot: binding.repositoryRoot }
                : operationId === "canonical-root" ? { status: "acknowledged", providerEffectDisposition: "committed" as const, action: binding.action, targetSnapshotId: binding.targetSnapshotId, repositoryRoot: "c:/REPO/" }
        : operationId === "wrong-target" ? { status: "acknowledged", action: binding.action, targetSnapshotId: "f".repeat(64), repositoryRoot: binding.repositoryRoot }
          : operationId === "pending" ? { status: "cancelling", action: binding.action, targetSnapshotId: binding.targetSnapshotId, repositoryRoot: binding.repositoryRoot }
            : operationId === "compensated-cancel" ? { status: "cancelled", providerEffectDisposition: "compensated" as const, action: binding.action, targetSnapshotId: binding.targetSnapshotId, repositoryRoot: binding.repositoryRoot }
              : operationId === "not-started-cancel" ? { status: "cancelled", providerEffectDisposition: "not_started" as const, action: binding.action, targetSnapshotId: binding.targetSnapshotId, repositoryRoot: binding.repositoryRoot }
                : operationId === "unproved-cancel" ? { status: "cancelled", providerEffectDisposition: "committed" as const, action: binding.action, targetSnapshotId: binding.targetSnapshotId, repositoryRoot: binding.repositoryRoot }
                  : operationId === "missing-disposition-cancel" ? { status: "cancelled", action: binding.action, targetSnapshotId: binding.targetSnapshotId, repositoryRoot: binding.repositoryRoot }
            : undefined;
    }
  });
  assert.equal(await control.cancelByOperation("submitted", "cancel"), 1);
  assert.equal(await control.cancelByOperation("done", "cancel"), 0);
  assert.equal(await control.cancelByOperation("missing", "cancel"), 0);
  assert.equal(await control.cancelQueuedForRepository("C:\\repo", "contain"), 2);
  assert.deepEqual(await control.observeOperation("done"), { settled: true, summary: "The exact provider workflow artifact is durably acknowledged." });
  assert.deepEqual(await control.observeOperation("legacy-done"), { settled: false, summary: "The acknowledged provider workflow artifact lacks a consistent durable effect disposition." });
  assert.deepEqual(await control.observeOperation("pending"), { settled: false, summary: "The exact provider workflow artifact remains cancelling; its external effect was not guessed or replayed." });
  assert.deepEqual(await control.observeOperation("missing"), { settled: false, summary: "No exact durable provider workflow artifact is bound to this operation." });
  assert.deepEqual(await control.observeBoundOperation({ ...binding, operationId: "done" }), {
    state: "terminal", ...binding, operationId: "done", status: "completed", effectDisposition: "committed",
    summary: "The exact provider workflow artifact is durably acknowledged."
  });
  assert.deepEqual(await control.observeBoundOperation({ ...binding, operationId: "legacy-done" }), {
    state: "active", ...binding, operationId: "legacy-done", effectDisposition: "ambiguous",
    summary: "The acknowledged provider workflow does not prove a committed effect disposition."
  });
  assert.deepEqual(await control.observeBoundOperation({ ...binding, operationId: "conflicting-done" }), {
    state: "active", ...binding, operationId: "conflicting-done", effectDisposition: "ambiguous",
    summary: "The acknowledged provider workflow does not prove a committed effect disposition."
  });
  assert.deepEqual(await control.observeBoundOperation({ ...binding, operationId: "rejected" }), {
    state: "terminal", ...binding, operationId: "rejected", status: "failed", effectDisposition: "not_started",
    summary: "The exact provider workflow artifact is durably rejected before effect."
  });
  assert.deepEqual(await control.observeBoundOperation({ ...binding, operationId: "legacy-rejected" }), {
    state: "active", ...binding, operationId: "legacy-rejected", effectDisposition: "ambiguous",
    summary: "The rejected provider workflow does not prove that no effect started."
  });
  assert.deepEqual(await control.observeBoundOperation({ ...binding, operationId: "canonical-root" }), {
    state: "terminal", ...binding, operationId: "canonical-root", status: "completed", effectDisposition: "committed",
    summary: "The exact provider workflow artifact is durably acknowledged."
  });
  assert.deepEqual(await control.observeBoundOperation({ ...binding, operationId: "wrong-target" }), {
    state: "active", ...binding, operationId: "wrong-target", effectDisposition: "ambiguous",
    summary: "The durable provider workflow artifact does not prove the exact protected action and target binding; terminal state remains ambiguous."
  });
  assert.deepEqual(await control.observeBoundOperation({ ...binding, operationId: "compensated-cancel" }), {
    state: "terminal", ...binding, operationId: "compensated-cancel", status: "cancelled", effectDisposition: "compensated",
    summary: "The exact provider workflow artifact has a durable compensated cancellation."
  });
  assert.deepEqual(await control.observeBoundOperation({ ...binding, operationId: "not-started-cancel" }), {
    state: "terminal", ...binding, operationId: "not-started-cancel", status: "cancelled", effectDisposition: "not_started",
    summary: "The exact provider workflow artifact has a durable pre-effect cancellation."
  });
  assert.deepEqual(await control.observeBoundOperation({ ...binding, operationId: "unproved-cancel" }), {
    state: "active", ...binding, operationId: "unproved-cancel", effectDisposition: "ambiguous",
    summary: "The cancelled provider workflow does not prove that no effect began or that a compensator completed."
  });
  assert.deepEqual(await control.observeBoundOperation({ ...binding, operationId: "missing-disposition-cancel" }), {
    state: "active", ...binding, operationId: "missing-disposition-cancel", effectDisposition: "ambiguous",
    summary: "The cancelled provider workflow does not prove that no effect began or that a compensator completed."
  });
  assert.deepEqual(calls, ["operation:submitted", "operation:done", "operation:missing", "repository:C:\\repo", "observe:done", "observe:legacy-done", "observe:pending", "observe:missing", "observe:done", "observe:legacy-done", "observe:conflicting-done", "observe:rejected", "observe:legacy-rejected", "observe:canonical-root", "observe:wrong-target", "observe:compensated-cancel", "observe:not-started-cancel", "observe:unproved-cancel", "observe:missing-disposition-cancel"]);
});

test("operation control rejects non-canonical command actions at its public reconciliation boundary", async () => {
  const control = new InstalledOperationControl();
  await assert.rejects(
    () => control.observe({ operationId: "operation-invalid-action", action: "repository_child_selected_action" as never }),
    /action.*invalid|canonical/i
  );
});

test("the hardware trigger envelope delivers exact cancellation but never claims command-effect terminal truth", async () => {
  const calls: string[] = [];
  let legacySettled = true;
  const control = new HardwareSignalTriggerOperationQueueControl({
    async cancelByOperation(operationId, reason) { calls.push(`operation:${operationId}:${reason}`); return 1; },
    async cancelQueuedForRepository(repositoryRoot, reason) { calls.push(`repository:${repositoryRoot}:${reason}`); return 2; },
    async observeOperation(operationId) {
      calls.push(`observe:${operationId}`);
      return { settled: legacySettled, summary: legacySettled ? "The hardware signal was handled." : "The hardware signal remains pending." };
    }
  });
  const exact = { operationId: "hardware-operation", action: "proof" as const, targetSnapshotId: "a".repeat(64), repositoryRoot: "C:\\repo" };

  assert.equal(await control.cancelByOperation(exact.operationId, "operator cancellation"), 1);
  assert.equal(await control.cancelQueuedForRepository(exact.repositoryRoot, "containment"), 2);
  assert.deepEqual(await control.observeBoundOperation(exact), {
    state: "not_owner",
    operationId: exact.operationId,
    summary: "The durable hardware inbox proves only trigger delivery and cancellation, not the mediated command's terminal effect."
  });
  legacySettled = false;
  assert.deepEqual(await control.observeBoundOperation(exact), {
    state: "not_owner",
    operationId: exact.operationId,
    summary: "The durable hardware inbox proves only trigger delivery and cancellation, not the mediated command's terminal effect."
  });
  assert.deepEqual(calls, [
    "operation:hardware-operation:operator cancellation",
    "repository:C:\\repo:containment"
  ], "terminal reconciliation must not consult or promote the trigger-envelope status");
});

test("missing packaged Job-Object helper never falls back to an unsupervised child process", async () => {
  const supervisor = new UnavailableInstalledRepositoryProcessSupervisor();
  assert.deepEqual(await supervisor.recover({ repositoryRoot: "C:\\repo", manifestSha256: "a".repeat(64) }), []);
  await assert.rejects(() => supervisor.start({} as never), /packaged.*Job-Object.*unavailable/i);
});
