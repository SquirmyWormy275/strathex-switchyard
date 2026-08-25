import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { DurableConfirmationLedger } from "../src/confirmations.ts";
import { ProtectedJsonStore } from "../src/store.ts";

test("durable confirmations bind exact scope and atomically reject replay after restart", async (context) => {
  const directory = await mkdtemp(join(tmpdir(), "sxsy-b122-confirmation-"));
  context.after(async () => { await rm(directory, { recursive: true, force: true }); });
  const path = join(directory, "protected.jsonl");
  const ledger = new DurableConfirmationLedger(new ProtectedJsonStore({ filePath: path }), {
    clock: () => "2026-08-23T12:00:00.000Z", tokenFactory: () => "token-1", idFactory: () => "confirmation-1"
  });
  const issued = await ledger.issue({ action: "pr_upsert", targetSnapshotId: "snapshot-1", sessionId: "session-1", authorityId: "authority-1", scopeDigest: "a".repeat(64), reason: "Reviewed PR publication", reauthenticated: true });
  assert.equal(issued.record.reauthenticated, true);
  assert.equal((await ledger.consume({ token: issued.token, action: "pr_upsert", targetSnapshotId: "wrong", sessionId: "session-1", authorityId: "authority-1" })).allowed, false);
  assert.equal((await ledger.consume({ token: issued.token, action: "pr_upsert", targetSnapshotId: "snapshot-1", sessionId: "session-1", authorityId: "authority-1", scopeDigest: "b".repeat(64) })).allowed, false);
  const restarted = new DurableConfirmationLedger(new ProtectedJsonStore({ filePath: path }), { clock: () => "2026-08-23T12:00:01.000Z" });
  assert.equal((await restarted.consume({
    token: issued.token, action: "pr_upsert", targetSnapshotId: "snapshot-1", sessionId: "session-1", authorityId: "authority-1", scopeDigest: "a".repeat(64)
  })).allowed, true);
  assert.equal((await ledger.consume({ token: issued.token, action: "pr_upsert", targetSnapshotId: "snapshot-1", sessionId: "session-1", authorityId: "authority-1" })).allowed, false);
});
