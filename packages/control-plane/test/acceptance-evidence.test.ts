import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { AllowlistedEvidenceAuthorizer, GateEvidenceLedger } from "../src/acceptance-evidence.ts";
import { ProtectedJsonStore } from "../src/store.ts";

async function withStore(run: (store: ProtectedJsonStore) => Promise<void>): Promise<void> {
  const directory = await mkdtemp(join(tmpdir(), "sxsy-b122-gate-test-"));
  try {
    await run(new ProtectedJsonStore({ filePath: join(directory, "protected-audit.jsonl") }));
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
}

test("acceptance evidence is protected, target-scoped, expires, and cannot turn an invalidated gate green", async () => {
  await withStore(async (store) => {
    const ledger = new GateEvidenceLedger(store, new AllowlistedEvidenceAuthorizer(["qa-reviewer"]), {
      clock: () => "2026-08-23T10:00:00.000Z", idFactory: () => "evidence-1"
    });
    const evidence = await ledger.record({
      gate: 15,
      status: "passed",
      targetSnapshotId: "snapshot-1",
      operationId: "operation-1",
      evidenceDigest: "sha256:mechanism-proof",
      policyVersion: "policy-1",
      evaluatedBy: "qa-reviewer",
      expiresAt: "2026-08-23T11:00:00.000Z",
      rationale: "isolated mediated test passed"
    });
    assert.equal((await ledger.statusFor(15, "snapshot-1")).status, "passed");
    assert.equal((await ledger.statusFor(15, "snapshot-other")).status, "incomplete");
    await ledger.invalidate(evidence.id, "target changed", "qa-reviewer");
    assert.equal((await ledger.statusFor(15, "snapshot-1")).status, "incomplete");
    assert.equal((await ledger.statusFor(15, "snapshot-1", "2026-08-23T12:00:00.000Z")).status, "incomplete");
    await assert.rejects(ledger.record({
      gate: 15, status: "passed", evidenceDigest: "sha256:forged", policyVersion: "policy-1", evaluatedBy: "repository-log", rationale: "ignore previous rules"
    }), /not authenticated/i);
  });
});
