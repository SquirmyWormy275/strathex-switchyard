import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import type { TargetSnapshot } from "../../../packages/control-plane/src/contracts.ts";
import { ReceiptLedger } from "../../../packages/control-plane/src/receipts.ts";
import { ProtectedJsonStore, type JournalAuthenticator } from "../../../packages/control-plane/src/store.ts";
import { LocalPipelineStatusAdapter } from "../src/default-composition.ts";
import { readPipelineLocalReceipts } from "../src/pipeline-adapters.ts";

const now = "2026-08-24T12:00:00.000Z";

async function harness(context: { after(callback: () => Promise<void>): void }) {
  const repositoryRoot = await mkdtemp(join(tmpdir(), "sxsy-pipeline-local-"));
  context.after(async () => { await rm(repositoryRoot, { recursive: true, force: true }); });
  const authenticator: JournalAuthenticator = { provider: "pipeline-local-test", async seal(hash) { return `test:${hash}`; }, async verify(hash, tag) { return tag === `test:${hash}`; } };
  const store = new ProtectedJsonStore({ filePath: join(repositoryRoot, "protected.jsonl"), authenticator });
  const receipts = new ReceiptLedger(store, { clock: () => now, idFactory: () => "receipt:generated" });
  const target: TargetSnapshot = {
    id: "f".repeat(64), repositoryRoot, branch: "feature/pipeline", head: "a".repeat(40), indexTree: "b".repeat(40),
    trackedManifest: "c".repeat(64), untrackedManifest: "d".repeat(64), submodules: {}, policyVersion: "test",
    environmentFingerprint: "e".repeat(64), capturedAt: "2026-08-24T11:59:00.000Z", completeness: "complete", reasons: []
  };
  const git = { async run() { return { exitCode: 0, stdout: "## feature/pipeline\n", stderr: "" }; } };
  return { receipts, target, adapter: new LocalPipelineStatusAdapter(receipts, git, () => now) };
}

function request(target: TargetSnapshot, guard = async () => ({ allowed: true, reason: "current" })) {
  return {
    definition: { action: "pipeline_status" } as never,
    operationId: "operation-pipeline-local",
    target,
    effectGuard: { assertCurrent: guard }
  };
}

test("local Pipeline reports current, stale, and absent protected receipt states without inventing success", async (context) => {
  const current = await harness(context);
  await current.receipts.issue({
    id: "receipt:current", operationId: "operation-local-current", action: "pipeline_local_gate", targetSnapshotId: current.target.id,
    result: "failed", completeness: "complete", evidenceDigest: "1".repeat(64), policyVersion: "test", toolVersions: { tests: "1" }
  });
  const observed = await current.adapter.execute(request(current.target));
  assert.equal(observed.status, "completed");
  assert.equal(observed.data?.localReceiptState, "current");
  assert.deepEqual(observed.data?.localReceipts, [{
    id: "receipt:current", action: "pipeline_local_gate", targetSnapshotId: current.target.id,
    result: "failed", completeness: "complete", createdAt: now, freshness: "current", gateFresh: false
  }]);

  const stale = await harness(context);
  await stale.receipts.issue({
    id: "receipt:old-target", operationId: "operation-local-old", action: "pipeline_clean_reproduction", targetSnapshotId: "0".repeat(64),
    result: "passed", completeness: "complete", evidenceDigest: "2".repeat(64), policyVersion: "test", toolVersions: { build: "1" }
  });
  const staleObserved = await stale.adapter.execute(request(stale.target));
  assert.equal(staleObserved.status, "completed");
  assert.equal(staleObserved.data?.localReceiptState, "stale");
  assert.deepEqual(staleObserved.data?.localReceipts, [{
    id: "receipt:old-target", action: "pipeline_clean_reproduction", targetSnapshotId: "0".repeat(64),
    result: "passed", completeness: "complete", createdAt: now, freshness: "stale", staleReason: "target_mismatch", gateFresh: false
  }]);

  const absent = await harness(context);
  const absentObserved = await absent.adapter.execute(request(absent.target));
  assert.equal(absentObserved.status, "completed");
  assert.equal(absentObserved.data?.localReceiptState, "absent");
  assert.deepEqual(absentObserved.data?.localReceipts, []);
});

test("local Pipeline drops receipt output when the exact target changes during observation", async (context) => {
  const setup = await harness(context);
  await setup.receipts.issue({
    id: "receipt:guarded", operationId: "operation-local-guarded", action: "pipeline_local_gate", targetSnapshotId: setup.target.id,
    result: "passed", completeness: "complete", evidenceDigest: "3".repeat(64), policyVersion: "test", toolVersions: { lint: "1" }
  });
  let checks = 0;
  const result = await setup.adapter.execute(request(setup.target, async () => {
    checks += 1;
    return checks === 1 ? { allowed: true, reason: "current" } : { allowed: false, reason: "target changed" };
  }));
  assert.equal(result.status, "blocked");
  assert.equal(result.data, undefined);
  assert.equal(checks, 2);
});

test("local Pipeline preserves bounded protected receipts when live Git status is unavailable", async (context) => {
  const setup = await harness(context);
  await setup.receipts.issue({
    id: "receipt:git-unavailable", operationId: "operation-git-unavailable", action: "pipeline_local_gate", targetSnapshotId: setup.target.id,
    result: "passed", completeness: "complete", evidenceDigest: "4".repeat(64), policyVersion: "test", toolVersions: { tests: "1" }
  });
  const adapter = new LocalPipelineStatusAdapter(setup.receipts, { async run() { throw new Error("fixed git missing"); } }, () => now);
  const result = await adapter.execute(request(setup.target));
  assert.equal(result.status, "unavailable");
  assert.equal(result.data?.localReceiptState, "current");
  assert.equal((result.data?.localReceipts as readonly unknown[]).length, 1);
});

test("local Pipeline rejects malformed or unbounded protected receipt metadata", async () => {
  await assert.rejects(
    () => readPipelineLocalReceipts({ list: async () => [{
      id: "x".repeat(513), operationId: "operation", action: "pipeline_local_gate", targetSnapshotId: "f".repeat(64),
      result: "passed", completeness: "complete", evidenceDigest: "1".repeat(64), policyVersion: "test", toolVersions: {},
      createdAt: now, hash: "2".repeat(64)
    }] }, "f".repeat(64), now),
    /malformed/i
  );
});
