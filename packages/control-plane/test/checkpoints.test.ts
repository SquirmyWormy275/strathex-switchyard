import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { CheckpointLedger } from "../src/checkpoints.ts";
import { ProtectedJsonStore } from "../src/store.ts";

const digest = (character: string): string => character.repeat(64);

async function withStore(run: (store: ProtectedJsonStore, filePath: string) => Promise<void>): Promise<void> {
  const directory = await mkdtemp(join(tmpdir(), "sxsy-b122-checkpoint-"));
  const filePath = join(directory, "protected-audit.jsonl");
  try {
    await run(new ProtectedJsonStore({ filePath }), filePath);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
}

test("checkpoint ledger persists immutable, redacted recovery artifacts and never restores work", async () => {
  await withStore(async (store) => {
    const ledger = new CheckpointLedger(store, {
      clock: () => "2026-08-23T12:00:00.000Z",
      idFactory: () => "checkpoint-1"
    });
    const checkpoint = await ledger.create({
      repositoryRoot: "C:/repos/safe",
      targetSnapshotId: "snapshot-1",
      operationId: "op-repair-1",
      workflow: "repair_mission",
      reason: "Preserve work before repair; token=do-not-record-me",
      artifacts: [{
        id: "working-tree-manifest",
        kind: "workspace_manifest",
        reference: "C:/recovery/manifest.json?token=do-not-record-me",
        sha256: digest("a")
      }],
      recovery: {
        steps: ["Inspect the manifest before choosing any manual recovery action."],
        artifactIds: ["working-tree-manifest"]
      }
    });

    assert.equal(checkpoint.manualOnly, true);
    assert.deepEqual(checkpoint.recovery.prohibitedActions, ["automatic_restore", "delete", "stash", "overwrite"]);
    assert.match(checkpoint.reason, /\[REDACTED\]/);
    assert.match(checkpoint.artifacts[0]?.reference ?? "", /\[REDACTED\]/);
    assert.equal(CheckpointLedger.verifyIntegrity(checkpoint), true);
    assert.equal(CheckpointLedger.verifyIntegrity({ ...checkpoint, reason: "modified in memory" }), false);

    const observation = await ledger.recordRecoveryObservation({
      checkpointId: checkpoint.id,
      operator: "operator-1",
      outcome: "restore_requested",
      note: "An operator must review the referenced artifact; no action was executed."
    });
    assert.equal(observation.outcome, "restore_requested");

    const restarted = new CheckpointLedger(store);
    const loaded = await restarted.get(checkpoint.id);
    assert.deepEqual(loaded?.artifacts, checkpoint.artifacts);
    assert.equal(loaded?.integrityHash, checkpoint.integrityHash);
    assert.equal((await restarted.recoveryObservations(checkpoint.id)).length, 1);
    assert.equal((await restarted.recoveryPlan(checkpoint.id))?.manualOnly, true);
    const verification = await restarted.verifyArtifacts(checkpoint.id, {
      verify: async () => ({ available: true, sha256: digest("f"), detail: "Digest differs; do not mutate the artifact." })
    });
    assert.equal(verification[0]?.status, "mismatched");
    assert.deepEqual((await restarted.get(checkpoint.id))?.artifacts, checkpoint.artifacts);
  });
});

test("a tampered checkpoint artifact is rejected by the protected chain rather than silently recovered", async () => {
  await withStore(async (store, filePath) => {
    const ledger = new CheckpointLedger(store, { clock: () => "2026-08-23T12:00:00.000Z", idFactory: () => "checkpoint-2" });
    await ledger.create({
      repositoryRoot: "C:/repos/safe",
      targetSnapshotId: "snapshot-2",
      workflow: "environment_rebuild",
      reason: "Preserve environment manifest before rebuild.",
      artifacts: [{ id: "environment-lock", kind: "environment_manifest", reference: "C:/recovery/environment.lock", sha256: digest("b") }],
      recovery: { steps: ["Review the lock file manually."], artifactIds: ["environment-lock"] }
    });
    const raw = await readFile(filePath, "utf8");
    await writeFile(filePath, raw.replace(digest("b"), digest("c")), "utf8");

    const restarted = new CheckpointLedger(new ProtectedJsonStore({ filePath }));
    await assert.rejects(restarted.list(), /hash mismatch|chain breaks|integrity/i);
  });
});
