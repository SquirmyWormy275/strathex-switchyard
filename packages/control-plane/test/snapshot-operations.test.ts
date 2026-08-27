import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { DurableOperationCoordinator, OperationSagaStore, ResourceLeaseConflictError } from "../src/operations.ts";
import { ReceiptLedger } from "../src/receipts.ts";
import { TargetSnapshotFactory, type GitInspection, type GitInspector, IncompleteTargetSnapshotError } from "../src/snapshot.ts";
import { ProtectedJsonStore } from "../src/store.ts";

class FakeInspector implements GitInspector {
  private readonly value: GitInspection;

  constructor(value: GitInspection) {
    this.value = value;
  }

  async inspect(): Promise<GitInspection> {
    return this.value;
  }
}

async function withStore(run: (store: ProtectedJsonStore) => Promise<void>): Promise<void> {
  const directory = await mkdtemp(join(tmpdir(), "sxsy-b122-operation-test-"));
  try {
    await run(new ProtectedJsonStore({ filePath: join(directory, "protected-audit.jsonl") }));
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
}

const completeInspection: GitInspection = {
  repositoryRoot: "C:/repos/one",
  canonicalRemote: "https://github.com/example/one.git",
  branch: "feature/safe",
  upstream: "origin/feature/safe",
  head: "0123456789abcdef",
  indexTree: "fedcba9876543210",
  trackedFiles: [
    { path: "src/a.ts", digest: "digest-a" },
    { path: "src/b.ts", digest: "digest-b" }
  ],
  untrackedFiles: [{ path: "scratch.txt", digest: "digest-scratch", classification: "included" }],
  submodules: { "vendor/tool": "abc" }
};

test("TargetSnapshot binds the complete working state and fails closed on unknown content", async () => {
  const complete = new TargetSnapshotFactory(new FakeInspector(completeInspection), {
    clock: () => "2026-08-23T10:00:00.000Z"
  });
  const snapshot = await complete.capture({
    policyVersion: "policy-v1",
    environment: { toolVersions: { git: "2.50", scanner: "1.2" }, dependencyFingerprint: "lock-digest" }
  });
  assert.equal(snapshot.completeness, "complete");
  assert.equal(snapshot.repositoryRoot, "C:/repos/one");
  assert.ok(snapshot.trackedManifest.length > 20);
  const changedPolicy = await complete.revalidate(snapshot, {
    policyVersion: "policy-v2",
    environment: { toolVersions: { git: "2.50", scanner: "1.2" }, dependencyFingerprint: "lock-digest" }
  });
  assert.equal(changedPolicy.current, false);

  const incomplete = new TargetSnapshotFactory(new FakeInspector({
    ...completeInspection,
    untrackedFiles: [{ path: "unknown.bin", classification: "unknown" }]
  }));
  const incompleteSnapshot = await incomplete.capture({ policyVersion: "policy-v1", environment: {} });
  assert.equal(incompleteSnapshot.completeness, "incomplete");
  assert.match(incompleteSnapshot.reasons.join(" "), /untracked/i);
  assert.throws(() => incomplete.assertComplete(incompleteSnapshot), IncompleteTargetSnapshotError);
});

test("operations are idempotent, parent/child durable, and reconcile children without replaying a saga", async () => {
  await withStore(async (store) => {
    const operations = new OperationSagaStore(store, {
      clock: () => "2026-08-23T10:00:00.000Z",
      idFactory: (() => {
        let n = 0;
        return () => `op-${++n}`;
      })()
    });
    const first = await operations.begin({
      action: "commit.pr_upsert",
      targetSnapshotId: "snapshot-1",
      idempotencyKey: "github|repo|main|feature|request-1"
    });
    const repeated = await operations.begin({
      action: "commit.pr_upsert",
      targetSnapshotId: "snapshot-1",
      idempotencyKey: "github|repo|main|feature|request-1"
    });
    assert.equal(repeated.reused, true);
    assert.equal(repeated.operation.id, first.operation.id);

    const child = await operations.beginChild(first.operation.id, {
      action: "github.create_pr",
      targetSnapshotId: "snapshot-1",
      idempotencyKey: "github|repo|main|feature|request-1|create"
    });
    await operations.advance(child.operation.id, "executing");
    await operations.advance(child.operation.id, "external_committed", { providerReference: "pr-77" });
    await operations.advance(first.operation.id, "executing");
    await operations.advance(first.operation.id, "external_committed");
    await assert.rejects(operations.advance(first.operation.id, "recorded"), /child .* unresolved/i);

    const afterCrash = new OperationSagaStore(store);
    const candidates = await afterCrash.reconciliationCandidates();
    assert.deepEqual(candidates.map((operation) => operation.id), [first.operation.id, child.operation.id]);
    const reconciled = await afterCrash.reconcilePending({
      reconcile: async (operation) => ({ state: operation.id === child.operation.id ? "recorded" : undefined, details: { providerState: "exists" } })
    });
    assert.equal(reconciled.find((result) => result.operationId === child.operation.id)?.outcome, "recorded");
    assert.equal((await afterCrash.get(child.operation.id))?.state, "recorded");
    assert.equal((await afterCrash.get(first.operation.id))?.state, "external_committed");
    assert.deepEqual((await afterCrash.get(first.operation.id))?.childIds, [child.operation.id]);
  });
});

test("resource leases serialize conflicting work and expire rather than silently overlapping", async () => {
  await withStore(async (store) => {
    const operations = new OperationSagaStore(store, {
      clock: () => "2026-08-23T10:00:00.000Z",
      idFactory: (() => {
        let n = 0;
        return () => `lease-op-${++n}`;
      })()
    });
    const one = (await operations.begin({ action: "council.partition", targetSnapshotId: "snapshot-1", idempotencyKey: "one" })).operation;
    const two = (await operations.begin({ action: "council.partition", targetSnapshotId: "snapshot-1", idempotencyKey: "two" })).operation;
    const lease = await operations.acquireLease({ operationId: one.id, resource: "path:src", holder: "session-a", durationMs: 1_000 });
    await assert.rejects(
      operations.acquireLease({ operationId: two.id, resource: "path:src", holder: "session-b", durationMs: 1_000 }),
      ResourceLeaseConflictError
    );
    const afterExpiry = await operations.acquireLease({
      operationId: two.id,
      resource: "path:src",
      holder: "session-b",
      durationMs: 1_000,
      now: "2026-08-23T10:00:02.000Z"
    });
    assert.notEqual(afterExpiry.id, lease.id);
    assert.equal(afterExpiry.fence, lease.fence + 1);
  });
});

test("durable dispatch coordination focuses active work and records a result before completion", async () => {
  await withStore(async (store) => {
    const operations = new OperationSagaStore(store, {
      clock: () => "2026-08-23T10:00:00.000Z",
      idFactory: (() => {
        let n = 0;
        return () => `dispatch-op-${++n}`;
      })()
    });
    const receipts = new ReceiptLedger(store, {
      clock: () => "2026-08-23T10:00:00.000Z",
      idFactory: (() => {
        let n = 0;
        return () => `ledger-${++n}`;
      })()
    });
    const coordinator = new DurableOperationCoordinator(operations, receipts);
    const first = await coordinator.claim({ action: "pr_upsert", targetSnapshotId: "snapshot-1", sessionId: "session-1", authorityId: "grant-1" });
    const duplicate = await coordinator.claim({ action: "pr_upsert", targetSnapshotId: "snapshot-1", sessionId: "session-1", authorityId: "grant-1" });
    assert.equal(duplicate.existing, true);
    assert.equal(duplicate.operationId, first.operationId);
    const firstDetails = (await operations.get(first.operationId))?.details;
    assert.equal(firstDetails?.sessionId, "session-1");
    assert.equal(firstDetails?.authorityId, "grant-1");
    assert.equal(firstDetails?.targetBound, "true");

    const changedAuthority = await coordinator.claim({ action: "pr_upsert", targetSnapshotId: "snapshot-1", sessionId: "session-1", authorityId: "grant-2" });
    assert.equal(changedAuthority.existing, false, "a changed authority must not be confused with the protected active operation binding");
    await coordinator.settle(changedAuthority, "blocked");

    await coordinator.markExecuting(first);
    const persisted = await coordinator.recordResult(first, {
      action: "pr_upsert",
      targetSnapshotId: "snapshot-1",
      authorityId: "grant-1",
      status: "completed",
      summary: "PR upsert completed through the broker.",
      policyVersion: "policy-v1",
      evidenceDigest: "evidence-v1",
      toolVersions: { git: "2.50" }
    });
    assert.ok(persisted.receiptId);
    assert.equal((await operations.get(first.operationId))?.state, "recorded");
    assert.equal((await receipts.get(persisted.receiptId!))?.operationId, first.operationId);

    const later = await coordinator.claim({ action: "pr_upsert", targetSnapshotId: "snapshot-1", sessionId: "session-1", authorityId: "grant-1" });
    assert.equal(later.existing, false);
    assert.notEqual(later.operationId, first.operationId);

    const blocked = await coordinator.claim({ action: "proof", sessionId: "session-1" });
    await coordinator.settle(blocked, "blocked");
    assert.equal((await operations.get(blocked.operationId))?.state, "failed");
    assert.equal((await receipts.audits()).some((audit) => audit.operationId === blocked.operationId && audit.status === "blocked"), true);
  });
});
