import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import test from "node:test";
import { DurableContainmentManager } from "../src/containment.ts";
import { ProtectedJsonStore } from "../src/store.ts";

test("durable containment persists its fence and invokes revocation/cancellation hooks after recording it", async (context) => {
  const folder = await mkdtemp(join(tmpdir(), "sxsy-b122-containment-"));
  context.after(async () => { await rm(folder, { recursive: true, force: true }); });
  const store = new ProtectedJsonStore({ filePath: join(folder, "protected.jsonl"), clock: () => "2026-08-23T12:00:00.000Z" });
  const calls: string[] = [];
  const manager = new DurableContainmentManager(store, {
    revokeCredentialLeases: async (input) => { calls.push(`revoke:${input.repositoryRoot}:${input.fenceEpoch}`); },
    cancelQueuedOperations: async (input) => { calls.push(`cancel:${input.repositoryRoot}:${input.fenceEpoch}`); }
  });

  const record = await manager.activate({ repositoryRoot: "C:/work/example", operationId: "op-1", reason: "incident" });
  assert.equal(record.fenceEpoch, 1);
  assert.deepEqual(calls, ["revoke:C:/work/example:1", "cancel:C:/work/example:1"]);
  const repeated = await manager.activate({ repositoryRoot: "C:/work/example", operationId: "op-1", reason: "repeat" });
  assert.equal(repeated.fenceEpoch, 1);
  assert.deepEqual(calls, ["revoke:C:/work/example:1", "cancel:C:/work/example:1"]);
  assert.equal((await manager.check("C:/work/example", "credential")).allowed, false);

  const restarted = new DurableContainmentManager(store);
  assert.equal((await restarted.check("C:/work/example", "network")).allowed, false);
  const release = await restarted.release({ repositoryRoot: "C:/work/example", reason: "reviewed", reauthenticated: true, incidentStatus: "rotation_complete" });
  assert.equal(release.status, "released");
  assert.equal((await restarted.check("C:/work/example", "git")).allowed, true);
});

test("durable containment stays active when a revocation hook fails and records the uncertainty", async (context) => {
  const folder = await mkdtemp(join(tmpdir(), "sxsy-b122-containment-"));
  context.after(async () => { await rm(folder, { recursive: true, force: true }); });
  const store = new ProtectedJsonStore({ filePath: join(folder, "protected.jsonl") });
  const manager = new DurableContainmentManager(store, { revokeCredentialLeases: async () => { throw new Error("adapter unavailable"); } });

  const record = await manager.activate({ repositoryRoot: "C:/work/example", operationId: "op-1", reason: "incident" });
  assert.equal(record.active, true);
  assert.match(record.hookFailures?.[0] ?? "", /adapter unavailable/);
  assert.equal((await manager.check("C:/work/example", "credential")).allowed, false);
});
