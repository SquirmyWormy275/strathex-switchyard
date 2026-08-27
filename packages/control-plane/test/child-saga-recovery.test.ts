import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { InMemoryAutomationBroker, InMemoryGitBroker } from "../src/brokers.ts";
import { commandForAction } from "../src/command-catalog.ts";
import type { AuthorityGrant, ManagedSession, TargetSnapshot } from "../src/contracts.ts";
import { CommandDispatcher } from "../src/dispatch.ts";
import { DurableOperationCoordinator, NoReplayOperationRecovery, OperationSagaStore, type ChildOperationSaga } from "../src/operations.ts";
import { PolicyEngine } from "../src/policy.ts";
import { ReceiptLedger } from "../src/receipts.ts";
import { ProtectedJsonStore } from "../src/store.ts";

async function withStore(run: (store: ProtectedJsonStore) => Promise<void>): Promise<void> {
  const directory = await mkdtemp(join(tmpdir(), "sxsy-b122-child-saga-test-"));
  try {
    await run(new ProtectedJsonStore({ filePath: join(directory, "protected-audit.jsonl") }));
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
}

test("broker child sagas prevent replay, preserve ambiguity, and reconcile only through observation adapters", async () => {
  await withStore(async (store) => {
    const operations = new OperationSagaStore(store, {
      clock: () => "2026-08-23T12:00:00.000Z",
      idFactory: (() => {
        let next = 0;
        return () => `child-op-${++next}`;
      })()
    });
    const receipts = new ReceiptLedger(store, { clock: () => "2026-08-23T12:00:00.000Z" });
    const coordinator = new DurableOperationCoordinator(operations, receipts);
    const parent = await coordinator.claim({ action: "pr_upsert", targetSnapshotId: "snapshot-1", sessionId: "session-1" });
    await coordinator.markExecuting(parent);

    const saga = coordinator.childSaga(parent);
    const child = await saga.begin({
      action: "git.pr_upsert.create_or_update",
      idempotencyScope: "provider:github:head:feature/safe",
      details: { provider: "github" }
    });
    assert.equal(child.parentOperationId, parent.operationId);
    assert.equal(child.targetSnapshotId, "snapshot-1");
    assert.equal(child.mayExecute, true);

    await saga.markExecuting(child, {
      providerOperationId: child.operationId,
      sessionId: "session-1",
      authorityId: "authority-1"
    });
    assert.equal((await operations.get(child.operationId))?.details.providerOperationId, child.operationId);
    assert.equal((await operations.get(child.operationId))?.details.sessionId, "session-1");
    assert.equal((await operations.get(child.operationId))?.details.authorityId, "authority-1");
    await saga.settle(child, "ambiguous", { providerObservation: "response_lost" });
    assert.equal((await operations.get(child.operationId))?.state, "executing");
    assert.equal((await operations.get(child.operationId))?.details.providerObservation, "response_lost");

    const reused = await saga.begin({
      action: "git.pr_upsert.create_or_update",
      idempotencyScope: "provider:github:head:feature/safe"
    });
    assert.equal(reused.existing, true);
    assert.equal(reused.mayExecute, false);
    await assert.rejects(saga.markExecuting(reused), /reconciled rather than replayed/i);

    await assert.rejects(
      coordinator.recordResult(parent, {
        action: "pr_upsert",
        targetSnapshotId: "snapshot-1",
        status: "completed",
        summary: "Provider reported completion but its child response is ambiguous.",
        policyVersion: "policy-1",
        evidenceDigest: "ambiguous-evidence",
        toolVersions: { git: "2.50" }
      }),
      /child .* unresolved/i
    );
    assert.equal((await receipts.list()).length, 0, "an unresolved child must prevent a fresh gate-bearing receipt");

    let observations = 0;
    const recovery: NoReplayOperationRecovery = coordinator.createNoReplayRecovery();
    recovery.register("git.pr_upsert.create_or_update", {
      reconcile: async (operation) => {
        observations += 1;
        assert.equal(operation.id, child.operationId);
        return { state: "recorded", details: { providerReference: "pr-77" }, note: "Provider confirms the PR exists." };
      }
    });
    const recovered = await recovery.recoverPending();
    assert.equal(observations, 1);
    assert.equal(recovered.find((result) => result.operationId === child.operationId)?.outcome, "recorded");
    assert.equal((await operations.get(child.operationId))?.state, "recorded");
    // Bootstrap recovery closes the lost root only as incomplete. It mints no
    // green receipt and releases the scope for a fresh explicit generation.
    assert.equal((await operations.get(parent.operationId))?.state, "recorded");
    assert.equal((await operations.get(parent.operationId))?.details.commandStatus, "incomplete");
    assert.equal((await receipts.list()).length, 0);

    const staleRecording = await coordinator.recordResult(parent, {
      action: "pr_upsert",
      targetSnapshotId: "snapshot-1",
      status: "completed",
      summary: "PR upsert completed through the broker after child reconciliation.",
      policyVersion: "policy-1",
      evidenceDigest: "evidence-1",
      toolVersions: { git: "2.50" }
    });
    assert.equal(staleRecording.receiptId, undefined, "a restarted caller cannot backfill a green receipt onto the recovered incomplete root");
    const next = await coordinator.claim({ action: "pr_upsert", targetSnapshotId: "snapshot-1", sessionId: "session-1" });
    assert.equal(next.existing, false);
    assert.notEqual(next.operationId, parent.operationId);
  });
});

test("a crash after durable child creation is reconciled instead of becoming replayable prepared work", async () => {
  await withStore(async (store) => {
    const operations = new OperationSagaStore(store);
    const coordinator = new DurableOperationCoordinator(operations, new ReceiptLedger(store));
    const parent = await coordinator.claim({ action: "compound_capture", targetSnapshotId: "snapshot-1", sessionId: "session-1" });
    await coordinator.markExecuting(parent);
    const saga = coordinator.childSaga(parent);
    const child = await saga.begin({ action: "automation.compound_capture.write", idempotencyScope: "provider:compound:packet-1" });
    assert.equal(child.state, "prepared");

    const repeated = await saga.begin({ action: "automation.compound_capture.write", idempotencyScope: "provider:compound:packet-1" });
    assert.equal(repeated.mayExecute, false);
    assert.equal((await operations.reconciliationCandidates()).some((operation) => operation.id === child.operationId), true);

    const recovery = coordinator.createNoReplayRecovery();
    recovery.register("automation.compound_capture.write", {
      reconcile: async (operation) => {
        assert.equal(operation.id, child.operationId);
        return { state: "failed", note: "Provider confirms that no capture request was accepted." };
      }
    });
    await recovery.recoverPending();
    assert.equal((await operations.get(child.operationId))?.state, "failed");
    assert.equal((await operations.get(parent.operationId))?.state, "failed");
    const retry = await coordinator.claim({ action: "compound_capture", targetSnapshotId: "snapshot-1", sessionId: "session-1" });
    assert.equal(retry.existing, false);
  });
});

test("restart closes push-to-PR and PR-to-merge partial roots as incomplete without replay or a green receipt", async () => {
  await withStore(async (store) => {
    const operations = new OperationSagaStore(store, { idFactory: (() => { let id = 0; return () => `recovery-${++id}`; })() });
    const receipts = new ReceiptLedger(store);
    const coordinator = new DurableOperationCoordinator(operations, receipts);

    const upsert = await coordinator.claim({ action: "pr_upsert", targetSnapshotId: "snapshot-upsert", sessionId: "session-1" });
    await coordinator.markExecuting(upsert);
    const upsertSaga = coordinator.childSaga(upsert);
    const upsertBoundary = await upsertSaga.begin({ action: "pr_upsert.composite", idempotencyScope: "dispatch-boundary" });
    await upsertSaga.markExecuting(upsertBoundary);
    await upsertSaga.settle(upsertBoundary, "ambiguous", { brokerStatus: "crashed" });
    const pushed = await upsertSaga.begin({ action: "git.push-reviewed-head", idempotencyScope: "push" });
    await upsertSaga.markExecuting(pushed); await upsertSaga.markExternalCommitted(pushed); await upsertSaga.settle(pushed, "completed");
    const createPull = await upsertSaga.begin({ action: "github.pr-upsert", idempotencyScope: "pull" });
    await upsertSaga.markExecuting(createPull); await upsertSaga.settle(createPull, "ambiguous", { providerObservation: "response_lost" });

    const merge = await coordinator.claim({ action: "pr_merge", targetSnapshotId: "snapshot-merge", sessionId: "session-1" });
    await coordinator.markExecuting(merge);
    const mergeSaga = coordinator.childSaga(merge);
    const mergeBoundary = await mergeSaga.begin({ action: "pr_merge.composite", idempotencyScope: "dispatch-boundary" });
    await mergeSaga.markExecuting(mergeBoundary); await mergeSaga.settle(mergeBoundary, "ambiguous", { brokerStatus: "crashed" });
    const merged = await mergeSaga.begin({ action: "github.pr-merge", idempotencyScope: "merge" });
    await mergeSaga.markExecuting(merged); await mergeSaga.markExternalCommitted(merged, { pullRequest: "17" });

    const recovery = coordinator.createNoReplayRecovery();
    recovery.register("github.pr-upsert", { reconcile: async () => ({ state: "failed", note: "No exact PR exists; creation did not commit." }) });
    recovery.register("github.pr-merge", { reconcile: async () => ({ state: "recorded", note: "Exact PR #17 is merged at the reviewed head." }) });
    const recovered = await recovery.recoverPending();

    assert.equal((await operations.get(createPull.operationId))?.state, "failed");
    assert.equal((await operations.get(merged.operationId))?.state, "recorded");
    assert.equal((await operations.get(upsertBoundary.operationId))?.details.commandStatus, "incomplete");
    assert.equal((await operations.get(mergeBoundary.operationId))?.details.commandStatus, "incomplete");
    assert.equal((await operations.get(upsert.operationId))?.details.commandStatus, "incomplete");
    assert.equal((await operations.get(merge.operationId))?.details.commandStatus, "incomplete");
    assert.equal(recovered.find((result) => result.operationId === upsert.operationId)?.outcome, "recorded");
    assert.equal(recovered.find((result) => result.operationId === merge.operationId)?.outcome, "recorded");
    assert.deepEqual(await receipts.list(), []);
    assert.equal((await coordinator.claim({ action: "pr_upsert", targetSnapshotId: "snapshot-upsert", sessionId: "session-1" })).existing, false);
    assert.equal((await coordinator.claim({ action: "pr_merge", targetSnapshotId: "snapshot-merge", sessionId: "session-1" })).existing, false);
  });
});

test("a pre-effect unavailable composite settles its boundary and remains intentionally retryable", async () => {
  await withStore(async (store) => {
    const now = "2026-08-23T12:00:00.000Z";
    const target: TargetSnapshot = {
      id: "snapshot-unavailable", repositoryRoot: "C:/work/example", branch: "feature/safe", head: "abc", indexTree: "tree",
      trackedManifest: "tracked", untrackedManifest: "untracked", submodules: {}, policyVersion: "policy-1",
      environmentFingerprint: "env-1", capturedAt: now, completeness: "complete", reasons: []
    };
    const session: ManagedSession = {
      id: "session-unavailable", provider: "codex", surface: "vscode_terminal", capabilities: ["registered", "observable", "controllable", "mediated"],
      status: "running", workspaceRoot: target.repositoryRoot, targetSnapshotId: target.id, taskId: "task-1", planRevision: "plan-1",
      plannedFiles: ["src/safe.ts"], lastHeartbeat: now, adapterVersion: "test", metadata: {}
    };
    const authority: AuthorityGrant = {
      id: "authority-compound", repositoryRoot: target.repositoryRoot, sessionId: session.id, taskId: session.taskId, planRevision: session.planRevision,
      allowedActions: ["compound_capture"], prohibitedActions: [], issuedAt: now, expiresAt: "2026-08-24T12:00:00.000Z", issuedBy: "user"
    };
    const policy = new PolicyEngine({ version: "policy-1", now: () => new Date(now) });
    const operations = new OperationSagaStore(store);
    const coordinator = new DurableOperationCoordinator(operations, new ReceiptLedger(store));
    const automation = new InMemoryAutomationBroker(policy);
    let calls = 0;
    automation.register("compound_capture", () => {
      calls += 1;
      return { status: "unavailable", summary: "The exact provider route is not configured; no request was sent.", effectDisposition: "not_started" };
    });
    const dispatcher = new CommandDispatcher({
      policy,
      sessions: { get: (id) => id === session.id ? session : undefined },
      authorities: { get: (id) => id === authority.id ? authority : undefined },
      operations: coordinator,
      automation,
      automationManifestReviews: { consume: async () => ({ manifest: {} as never, approval: {} as never }) }
    });
    const assignment = commandForAction("compound_capture").assignment!;
    const request = { assignment, control: assignment.control, modifier: assignment.modifier, targetSnapshot: target, sessionId: session.id, authorityId: authority.id } as const;
    const dispatch = () => dispatcher.dispatch({ ...request, confirmationToken: policy.createConfirmation({ action: "compound_capture", targetSnapshotId: target.id, sessionId: session.id, authorityId: authority.id, reason: "reviewed capture", reauthenticated: true }).token });

    assert.equal((await dispatch()).status, "unavailable");
    assert.equal((await dispatch()).status, "unavailable");
    assert.equal(calls, 2, "a later intentional press may retry after a known pre-effect refusal");
    const all = await operations.list();
    assert.equal(all.filter((operation) => !operation.parentId).length, 2);
    assert.equal(all.filter((operation) => operation.parentId).every((operation) => operation.state === "failed"), true);
  });
});

test("an explicitly committed partial composite is recorded without replay on the stale target", async () => {
  await withStore(async (store) => {
    const now = "2026-08-23T12:00:00.000Z";
    const target: TargetSnapshot = {
      id: "snapshot-partial-commit", repositoryRoot: "C:/work/example", branch: "main", head: "abc", indexTree: "tree",
      trackedManifest: "tracked", untrackedManifest: "untracked", submodules: {}, policyVersion: "policy-1",
      environmentFingerprint: "env-1", capturedAt: now, completeness: "complete", reasons: []
    };
    const session: ManagedSession = {
      id: "session-partial-commit", provider: "codex", surface: "vscode_terminal", capabilities: ["registered", "observable", "controllable", "mediated"],
      status: "running", workspaceRoot: target.repositoryRoot, targetSnapshotId: target.id, taskId: "task-1", planRevision: "plan-1",
      plannedFiles: ["src/safe.ts"], lastHeartbeat: now, adapterVersion: "test", metadata: {}
    };
    const authority: AuthorityGrant = {
      id: "authority-partial-commit", repositoryRoot: target.repositoryRoot, sessionId: session.id, taskId: session.taskId, planRevision: session.planRevision,
      allowedActions: ["compound_capture"], prohibitedActions: [], issuedAt: now, expiresAt: "2026-08-24T12:00:00.000Z", issuedBy: "user"
    };
    const policy = new PolicyEngine({ version: "policy-1", now: () => new Date(now) });
    const operations = new OperationSagaStore(store);
    const coordinator = new DurableOperationCoordinator(operations, new ReceiptLedger(store));
    const automation = new InMemoryAutomationBroker(policy);
    let calls = 0;
    automation.register("compound_capture", () => {
      calls += 1;
      return { status: "incomplete", summary: "One exact preparatory effect committed; capture a fresh target before continuing.", effectDisposition: "committed" };
    });
    const dispatcher = new CommandDispatcher({
      policy,
      sessions: { get: (id) => id === session.id ? session : undefined },
      authorities: { get: (id) => id === authority.id ? authority : undefined },
      operations: coordinator,
      automation,
      automationManifestReviews: { consume: async () => ({ manifest: {} as never, approval: {} as never }) }
    });
    const assignment = commandForAction("compound_capture").assignment!;
    const request = { assignment, control: assignment.control, modifier: assignment.modifier, targetSnapshot: target, sessionId: session.id, authorityId: authority.id } as const;
    const dispatch = () => dispatcher.dispatch({ ...request, confirmationToken: policy.createConfirmation({ action: "compound_capture", targetSnapshotId: target.id, sessionId: session.id, authorityId: authority.id, reason: "reviewed capture", reauthenticated: true }).token });

    assert.equal((await dispatch()).status, "incomplete");
    assert.equal((await dispatch()).status, "incomplete");
    assert.equal(calls, 1, "the same stale target cannot replay a known committed partial effect");
    const all = await operations.list();
    const parent = all.find((operation) => !operation.parentId);
    const boundary = all.find((operation) => operation.parentId && operation.action.endsWith(".composite"));
    assert.equal(parent?.state, "recorded");
    assert.equal(parent?.details.commandStatus, "incomplete");
    assert.equal(parent?.details.noReplay, "true");
    assert.equal(boundary?.state, "recorded");
  });
});

test("an unavailable response without explicit no-effect proof remains ambiguous and cannot replay", async () => {
  await withStore(async (store) => {
    const now = "2026-08-23T12:00:00.000Z";
    const target: TargetSnapshot = {
      id: "snapshot-response-lost", repositoryRoot: "C:/work/example", branch: "feature/safe", head: "abc", indexTree: "tree",
      trackedManifest: "tracked", untrackedManifest: "untracked", submodules: {}, policyVersion: "policy-1",
      environmentFingerprint: "env-1", capturedAt: now, completeness: "complete", reasons: []
    };
    const session: ManagedSession = {
      id: "session-response-lost", provider: "codex", surface: "vscode_terminal", capabilities: ["registered", "observable", "controllable", "mediated"],
      status: "running", workspaceRoot: target.repositoryRoot, targetSnapshotId: target.id, taskId: "task-1", planRevision: "plan-1",
      plannedFiles: ["src/safe.ts"], lastHeartbeat: now, adapterVersion: "test", metadata: {}
    };
    const authority: AuthorityGrant = {
      id: "authority-response-lost", repositoryRoot: target.repositoryRoot, sessionId: session.id, taskId: session.taskId, planRevision: session.planRevision,
      allowedActions: ["compound_capture"], prohibitedActions: [], issuedAt: now, expiresAt: "2026-08-24T12:00:00.000Z", issuedBy: "user"
    };
    const policy = new PolicyEngine({ version: "policy-1", now: () => new Date(now) });
    const operations = new OperationSagaStore(store);
    const coordinator = new DurableOperationCoordinator(operations, new ReceiptLedger(store));
    const automation = new InMemoryAutomationBroker(policy);
    let calls = 0;
    automation.register("compound_capture", () => {
      calls += 1;
      // A request may have been accepted before the response was lost. The
      // status alone is deliberately insufficient to prove a safe retry.
      return { status: "unavailable", summary: "Provider response was lost after submission." };
    });
    const dispatcher = new CommandDispatcher({
      policy,
      sessions: { get: (id) => id === session.id ? session : undefined },
      authorities: { get: (id) => id === authority.id ? authority : undefined },
      operations: coordinator,
      automation,
      automationManifestReviews: { consume: async () => ({ manifest: {} as never, approval: {} as never }) }
    });
    const assignment = commandForAction("compound_capture").assignment!;
    const request = { assignment, control: assignment.control, modifier: assignment.modifier, targetSnapshot: target, sessionId: session.id, authorityId: authority.id } as const;
    const dispatch = () => dispatcher.dispatch({ ...request, confirmationToken: policy.createConfirmation({ action: "compound_capture", targetSnapshotId: target.id, sessionId: session.id, authorityId: authority.id, reason: "reviewed capture", reauthenticated: true }).token });

    assert.equal((await dispatch()).status, "failed", "durable recording refuses to terminalize an unresolved child");
    assert.equal((await dispatch()).status, "running", "a repeated press focuses the unresolved operation");
    assert.equal(calls, 1, "an ambiguous provider outcome is never replayed");
    const boundary = (await operations.list()).find((operation) => operation.parentId && operation.action.endsWith(".composite"));
    assert.equal(boundary?.state, "executing");
    assert.equal(boundary?.details.externalEffect, "ambiguous");
  });
});

test("a completed label without explicit commit proof remains ambiguous and cannot replay", async () => {
  await withStore(async (store) => {
    const now = "2026-08-23T12:00:00.000Z";
    const target: TargetSnapshot = {
      id: "snapshot-unproven-complete", repositoryRoot: "C:/work/example", branch: "feature/safe", head: "abc", indexTree: "tree",
      trackedManifest: "tracked", untrackedManifest: "untracked", submodules: {}, policyVersion: "policy-1",
      environmentFingerprint: "env-1", capturedAt: now, completeness: "complete", reasons: []
    };
    const session: ManagedSession = {
      id: "session-unproven-complete", provider: "codex", surface: "vscode_terminal", capabilities: ["registered", "observable", "controllable", "mediated"],
      status: "running", workspaceRoot: target.repositoryRoot, targetSnapshotId: target.id, taskId: "task-1", planRevision: "plan-1",
      plannedFiles: ["src/safe.ts"], lastHeartbeat: now, adapterVersion: "test", metadata: {}
    };
    const authority: AuthorityGrant = {
      id: "authority-unproven-complete", repositoryRoot: target.repositoryRoot, sessionId: session.id, taskId: session.taskId, planRevision: session.planRevision,
      allowedActions: ["compound_capture"], prohibitedActions: [], issuedAt: now, expiresAt: "2026-08-24T12:00:00.000Z", issuedBy: "user"
    };
    const policy = new PolicyEngine({ version: "policy-1", now: () => new Date(now) });
    const operations = new OperationSagaStore(store);
    const coordinator = new DurableOperationCoordinator(operations, new ReceiptLedger(store));
    const automation = new InMemoryAutomationBroker(policy);
    let calls = 0;
    automation.register("compound_capture", () => {
      calls += 1;
      return { status: "completed", summary: "A peer supplied a success label without an effect receipt." };
    });
    const dispatcher = new CommandDispatcher({
      policy,
      sessions: { get: (id) => id === session.id ? session : undefined },
      authorities: { get: (id) => id === authority.id ? authority : undefined },
      operations: coordinator,
      automation,
      automationManifestReviews: { consume: async () => ({ manifest: {} as never, approval: {} as never }) }
    });
    const assignment = commandForAction("compound_capture").assignment!;
    const request = { assignment, control: assignment.control, modifier: assignment.modifier, targetSnapshot: target, sessionId: session.id, authorityId: authority.id } as const;
    const dispatch = () => dispatcher.dispatch({ ...request, confirmationToken: policy.createConfirmation({ action: "compound_capture", targetSnapshotId: target.id, sessionId: session.id, authorityId: authority.id, reason: "reviewed capture", reauthenticated: true }).token });

    assert.equal((await dispatch()).status, "failed");
    assert.equal((await dispatch()).status, "running");
    assert.equal(calls, 1);
    const boundary = (await operations.list()).find((operation) => operation.parentId && operation.action.endsWith(".composite"));
    assert.equal(boundary?.state, "executing");
    assert.equal(boundary?.details.externalEffect, "ambiguous");
  });
});

test("durable dispatch gives Git, automation, and Council handlers a scoped child-saga capability", async () => {
  await withStore(async (store) => {
    const now = "2026-08-23T12:00:00.000Z";
    const target: TargetSnapshot = {
      id: "snapshot-1", repositoryRoot: "C:/work/example", canonicalRemote: "https://github.com/example/repo.git",
      branch: "feature/safe", head: "abc", indexTree: "tree", trackedManifest: "tracked", untrackedManifest: "untracked",
      submodules: {}, policyVersion: "policy-1", environmentFingerprint: "env-1", capturedAt: now, completeness: "complete", reasons: []
    };
    const session: ManagedSession = {
      id: "session-1", provider: "codex", surface: "vscode_terminal", capabilities: ["registered", "observable", "controllable", "mediated"],
      status: "running", workspaceRoot: target.repositoryRoot, targetSnapshotId: target.id, taskId: "task-1", planRevision: "plan-1",
      plannedFiles: ["src/safe.ts"], lastHeartbeat: now, adapterVersion: "test", metadata: {}
    };
    const policy = new PolicyEngine({ version: "policy-1", now: () => new Date(now) });
    const authority = (action: AuthorityGrant["allowedActions"][number]): AuthorityGrant => ({
      id: `authority-${action}`, repositoryRoot: target.repositoryRoot, sessionId: session.id, taskId: session.taskId, planRevision: session.planRevision,
      allowedActions: [action], prohibitedActions: [], issuedAt: now, expiresAt: "2026-08-24T12:00:00.000Z", issuedBy: "user"
    });
    const authorities = new Map([
      ["authority-local_commit", authority("local_commit")],
      ["authority-compound_capture", authority("compound_capture")],
      ["authority-council_report", authority("council_report")]
    ]);
    const operations = new OperationSagaStore(store);
    const coordinator = new DurableOperationCoordinator(operations, new ReceiptLedger(store));
    const git = new InMemoryGitBroker(policy);
    const automation = new InMemoryAutomationBroker(policy);
    const seen: string[] = [];
    const settleChild = async (saga: ChildOperationSaga | undefined, action: string, scope: string): Promise<void> => {
      if (!saga) throw new Error("Composite broker did not receive its child-saga capability.");
      const child = await saga.begin({ action, idempotencyScope: scope });
      await saga.markExecuting(child);
      await saga.markExternalCommitted(child, { providerReference: `${scope}-accepted` });
      await saga.settle(child, "completed");
      seen.push(action);
    };
    git.register("local_commit", async (request) => {
      assert.ok(request.childSaga);
      await settleChild(request.childSaga, "git.local_commit.write", "git:commit-1");
      return { status: "completed", summary: "Simulated mediated local commit.", effectDisposition: "committed" };
    });
    automation.register("compound_capture", async (request) => {
      assert.ok(request.childSaga);
      await settleChild(request.childSaga, "automation.compound_capture.write", "automation:packet-1");
      return { status: "completed", summary: "Simulated mediated Compound capture.", effectDisposition: "committed" };
    });
    const council = {
      execute: async (request: Readonly<{ action: "council_report" | "council_automatic" | "council_recommend"; childSaga?: ChildOperationSaga }>) => {
        assert.equal(request.action, "council_report");
        assert.ok(request.childSaga);
        await settleChild(request.childSaga, "council.report.assemble", "council:report-1");
        return { status: "completed" as const, summary: "Simulated mediated Council report.", effectDisposition: "committed" as const };
      }
    };
    const dispatcher = new CommandDispatcher({
      policy,
      sessions: { get: (id) => id === session.id ? session : undefined },
      authorities: { get: (id) => authorities.get(id) },
      operations: coordinator,
      git,
      automation,
      automationManifestReviews: { consume: async () => ({ manifest: {} as never, approval: {} as never }) },
      council,
      gitMutationFactory: { create: () => ({ kind: "local_commit", paths: ["src/safe.ts"], message: "safe commit" }) }
    });

    for (const action of ["local_commit", "compound_capture", "council_report"] as const) {
      const definition = commandForAction(action);
      const assignment = definition.assignment!;
      const confirmation = action === "local_commit" || action === "compound_capture"
        ? policy.createConfirmation({ action, targetSnapshotId: target.id, sessionId: session.id, authorityId: `authority-${action}`, reason: "isolated reviewed effect", reauthenticated: true })
        : undefined;
      const result = await dispatcher.dispatch({
        assignment, control: assignment.control, modifier: assignment.modifier,
        targetSnapshot: target, sessionId: session.id, authorityId: `authority-${action}`,
        ...(confirmation ? { confirmationToken: confirmation.token } : {})
      });
      assert.equal(result.status, "completed");
    }
    assert.deepEqual(seen, ["git.local_commit.write", "automation.compound_capture.write", "council.report.assemble"]);
    const children = (await operations.list()).filter((operation) => operation.parentId);
    assert.equal(children.length, 6, "each composite has an automatic boundary plus its provider-specific child");
    assert.equal(children.every((operation) => operation.state === "recorded" && operation.targetSnapshotId === target.id), true);
  });
});
