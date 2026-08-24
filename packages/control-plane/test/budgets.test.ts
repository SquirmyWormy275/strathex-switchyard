import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { DurableBudgetManager, type BudgetConfiguration } from "../src/budgets.ts";
import { ProtectedJsonStore } from "../src/store.ts";

const configuration: BudgetConfiguration = {
  version: "b122-budget-v1",
  commandClasses: {
    repair: {
      maxConcurrent: 1,
      timeoutMs: 1_000,
      maxAttempts: 2,
      windowMs: 60_000,
      maxClaimsPerWindow: 3,
      maxCostUnitsPerWindow: 3,
      defaultCostUnits: 1
    },
    sandbox: {
      maxConcurrent: 2,
      timeoutMs: 1_000,
      maxAttempts: 1,
      windowMs: 60_000,
      maxClaimsPerWindow: 4,
      maxCostUnitsPerWindow: 2,
      defaultCostUnits: 1
    }
  }
};

async function withStore(run: (store: ProtectedJsonStore, now: () => string, setNow: (value: string) => void) => Promise<void>): Promise<void> {
  const directory = await mkdtemp(join(tmpdir(), "sxsy-b122-budget-"));
  let time = "2026-08-23T12:00:00.000Z";
  const now = () => time;
  try {
    await run(new ProtectedJsonStore({ filePath: join(directory, "protected-audit.jsonl") }), now, (value) => { time = value; });
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
}

test("unknown budget configuration fails closed, while persisted configuration and claims survive reload", async () => {
  await withStore(async (store, now) => {
    const unknown = new DurableBudgetManager(store, { clock: now });
    const blocked = await unknown.claim({ operationId: "op-unknown", commandClass: "repair" });
    assert.equal(blocked.allowed, false);
    assert.match(blocked.reason, /configuration/i);

    const manager = new DurableBudgetManager(store, { clock: now, idFactory: () => "claim-1" });
    await manager.configure(configuration);
    const granted = await manager.claim({ operationId: "op-repair-1", commandClass: "repair" });
    assert.equal(granted.allowed, true);
    assert.equal(granted.claim?.state, "claimed");

    const restarted = new DurableBudgetManager(store, { clock: now });
    const duplicate = await restarted.claim({ operationId: "op-repair-1", commandClass: "repair" });
    assert.equal(duplicate.allowed, true);
    assert.equal(duplicate.reused, true);
    assert.equal(duplicate.claim?.id, "claim-1");
  });
});

test("concurrency, quota, cancellation, and timeout states are durable and conservative", async () => {
  await withStore(async (store, now, setNow) => {
    let nextId = 0;
    const manager = new DurableBudgetManager(store, { clock: now, idFactory: () => `claim-${++nextId}` });
    await manager.configure(configuration);

    const first = await manager.claim({ operationId: "op-one", commandClass: "repair" });
    assert.equal(first.allowed, true);
    const concurrent = await manager.claim({ operationId: "op-two", commandClass: "repair" });
    assert.equal(concurrent.allowed, false);
    assert.match(concurrent.reason, /concurrency/i);

    await manager.start(first.claim!.id);
    const cancellation = await manager.requestCancellation(first.claim!.id, "operator requested cancellation; token=do-not-record-me");
    assert.equal(cancellation.claim?.state, "cancelling");
    assert.match(cancellation.claim?.cancellationReason ?? "", /\[REDACTED\]/);
    await manager.settle(first.claim!.id, "cancelled");
    assert.equal((await manager.get(first.claim!.id))?.state, "cancelled");

    const second = await manager.claim({ operationId: "op-two", commandClass: "repair" });
    assert.equal(second.allowed, true);
    await manager.start(second.claim!.id);
    setNow("2026-08-23T12:00:02.000Z");
    const expired = await manager.expireDue();
    assert.deepEqual(expired.map((claim) => claim.id), [second.claim!.id]);
    assert.equal((await manager.get(second.claim!.id))?.state, "timed_out");
    const retryAfterTimeout = await manager.claim({ operationId: "op-two", commandClass: "repair", retryOf: second.claim!.id });
    assert.equal(retryAfterTimeout.allowed, false);
    assert.match(retryAfterTimeout.reason, /reconciled|timeout/i);

    const third = await manager.claim({ operationId: "op-three", commandClass: "sandbox", costUnits: 2 });
    assert.equal(third.allowed, true);
    const costExceeded = await manager.claim({ operationId: "op-four", commandClass: "sandbox" });
    assert.equal(costExceeded.allowed, false);
    assert.match(costExceeded.reason, /cost/i);
  });
});

test("retries are explicit, bounded, and never started in the background", async () => {
  await withStore(async (store, now) => {
    let nextId = 0;
    const manager = new DurableBudgetManager(store, { clock: now, idFactory: () => `claim-${++nextId}` });
    await manager.configure(configuration);
    const initial = await manager.claim({ operationId: "op-retry", commandClass: "repair" });
    await manager.start(initial.claim!.id);
    await manager.settle(initial.claim!.id, "failed", "adapter returned an error");

    const retry = await manager.claim({ operationId: "op-retry", commandClass: "repair", retryOf: initial.claim!.id });
    assert.equal(retry.allowed, true);
    assert.equal(retry.claim?.attempt, 2);
    assert.equal(retry.claim?.state, "claimed");
    assert.equal((await manager.get(retry.claim!.id))?.startedAt, undefined);

    await manager.start(retry.claim!.id);
    await manager.settle(retry.claim!.id, "failed");
    const denied = await manager.claim({ operationId: "op-retry", commandClass: "repair", retryOf: retry.claim!.id });
    assert.equal(denied.allowed, false);
    assert.match(denied.reason, /attempt/i);
  });
});
