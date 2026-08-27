import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test, { type TestContext } from "node:test";

import { ProtectedJsonStore, type JournalAuthenticator } from "../../../packages/control-plane/src/store.ts";
import { DurableHardwareSignalInbox } from "../src/hardware-signal-queue.ts";

const authenticator: JournalAuthenticator = {
  provider: "hardware-signal-isolated-test",
  async seal(hash) { return `test:${hash}`; },
  async verify(hash, tag) { return tag === `test:${hash}`; }
};

async function fixture(context: TestContext) {
  const folder = await mkdtemp(join(tmpdir(), "sxsy-b122-hardware-signal-"));
  context.after(async () => { await rm(folder, { recursive: true, force: true }); });
  let token = 0;
  const store = new ProtectedJsonStore({
    filePath: join(folder, "protected.jsonl"),
    authenticator,
    clock: () => "2026-08-24T12:00:00.000Z"
  });
  return {
    store,
    inbox: new DurableHardwareSignalInbox(store, {
      now: () => "2026-08-24T12:00:00.000Z",
      claimTokenFactory: () => `claim-token-${++token}`
    })
  };
}

const signal = {
  type: "signal" as const,
  connectionEpoch: 7,
  counter: 11,
  bootNonce: 13,
  control: "SHIELD" as const,
  modifier: "normal" as const,
  assigned: true
};
const deviceId = "a".repeat(64);
const binding = { windowSessionId: "window-1", workspaceRoots: ["C:\\repo"] } as const;

test("persists a canonical hardware signal before reporting acceptance and deduplicates its device epoch tuple", async (context) => {
  const { inbox } = await fixture(context);
  const first = await inbox.accept(deviceId, signal);
  const duplicate = await inbox.accept(deviceId, signal);

  assert.equal(first.status, "accepted");
  assert.equal(duplicate.status, "duplicate");
  assert.equal(duplicate.signalId, first.signalId);
  assert.deepEqual(await inbox.status(), { pending: 1, claimed: 0, completed: 0, needsReconciliation: 0 });
});

test("atomically grants one exact window claim and requires the same token and binding to complete it", async (context) => {
  const { inbox } = await fixture(context);
  await inbox.accept(deviceId, signal);

  const [left, right] = await Promise.all([
    inbox.claim(binding),
    inbox.claim({ windowSessionId: "window-2", workspaceRoots: ["C:\\repo"] })
  ]);
  const claim = left ?? right;
  assert.ok(claim);
  assert.equal([left, right].filter(Boolean).length, 1);
  assert.equal(claim.control, "SHIELD");
  assert.equal(claim.modifier, "normal");

  await assert.rejects(() => inbox.complete({
    signalId: claim.signalId,
    claimToken: "wrong-token",
    windowSessionId: claim.windowSessionId,
    workspaceRoots: claim.workspaceRoots,
    outcome: "handled",
    summary: "wrong"
  }), /claim|token/i);
  await assert.rejects(() => inbox.complete({
    signalId: claim.signalId,
    claimToken: claim.claimToken,
    windowSessionId: claim.windowSessionId,
    workspaceRoots: claim.workspaceRoots,
    outcome: "handled",
    summary: "A client tried to forge completion without server dispatch."
  }), /dispatch receipt/i);
  const dispatch = await inbox.recordDispatch({
    signalId: claim.signalId,
    claimToken: claim.claimToken,
    windowSessionId: claim.windowSessionId,
    workspaceRoots: claim.workspaceRoots,
    handler: "b122.SHIELD:normal",
    resultStatus: "completed"
  });
  await inbox.complete({
    signalId: claim.signalId,
    claimToken: claim.claimToken,
    windowSessionId: claim.windowSessionId,
    workspaceRoots: claim.workspaceRoots,
    outcome: "handled",
    summary: "The canonical chord crossed the mediated dispatch flow.",
    dispatchReceiptId: dispatch.dispatchReceiptId
  });
  assert.equal(await inbox.claim(binding), undefined);
  assert.deepEqual(await inbox.status(), { pending: 0, claimed: 0, completed: 1, needsReconciliation: 0 });
});

test("rejects an empty focus binding and a forged handler receipt for another chord", async (context) => {
  const { inbox } = await fixture(context);
  await inbox.accept(deviceId, signal);
  await assert.rejects(() => inbox.claim({ windowSessionId: "window-1", workspaceRoots: [] }), /at least one/i);
  const claim = await inbox.claim(binding);
  assert.ok(claim);
  await assert.rejects(() => inbox.recordDispatch({
    signalId: claim.signalId,
    claimToken: claim.claimToken,
    windowSessionId: claim.windowSessionId,
    workspaceRoots: claim.workspaceRoots,
    handler: "b122.COMMIT:shift_alt",
    resultStatus: "blocked"
  }), /canonical|match/i);
});

test("only explicit failure before dispatch requeues; a crashed claim becomes reconciliation-required", async (context) => {
  const { inbox, store } = await fixture(context);
  await inbox.accept(deviceId, signal);
  const first = await inbox.claim(binding);
  assert.ok(first);
  await inbox.complete({
    signalId: first.signalId,
    claimToken: first.claimToken,
    windowSessionId: first.windowSessionId,
    workspaceRoots: first.workspaceRoots,
    outcome: "failed_before_dispatch",
    summary: "No command preparation or dispatch request was sent."
  });
  const second = await inbox.claim(binding);
  assert.ok(second);
  assert.notEqual(second.claimToken, first.claimToken);
  await inbox.recordDispatch({ ...second, handler: "b122.SHIELD:normal", resultStatus: "running", operationId: "operation-crashed-hardware" });

  const restarted = new DurableHardwareSignalInbox(store, { claimTokenFactory: () => "restart-token" });
  await restarted.recoverAfterRestart();
  assert.equal(await restarted.claim(binding), undefined);
  assert.deepEqual(await restarted.status(), { pending: 0, claimed: 0, completed: 0, needsReconciliation: 1 });
  assert.deepEqual(await restarted.observeOperation("operation-crashed-hardware"), {
    settled: false,
    summary: "The exact hardware dispatch needs reconciliation after restart; it was not replayed."
  });
});

test("a protected-store failure prevents acceptance so firmware can retry without an ACK", async (context) => {
  const { inbox } = await fixture(context);
  const broken = inbox as unknown as { store: { transaction<T>(work: unknown): Promise<T> } };
  broken.store = { async transaction() { throw new Error("durable append failed"); } };
  await assert.rejects(() => inbox.accept(deviceId, signal), /durable append failed/i);
  assert.deepEqual(await inbox.status().catch(() => undefined), undefined);
});

test("host cancellation terminates only the exact operation-bound hardware claim and survives restart", async (context) => {
  const { inbox, store } = await fixture(context);
  await inbox.accept(deviceId, signal);
  const claim = await inbox.claim(binding);
  assert.ok(claim);
  await inbox.recordDispatch({ ...claim, handler: "b122.SHIELD:normal", resultStatus: "running", operationId: "operation-hardware" });

  assert.equal(await inbox.cancelByOperation("operation-hardware", "Operator cancelled exact durable work."), 1);
  assert.equal(await inbox.cancelByOperation("operation-hardware", "Operator cancelled exact durable work."), 0);
  await assert.rejects(() => inbox.complete({ ...claim, outcome: "handled", summary: "late completion" }), /claim|completed|cancel/i);
  assert.deepEqual(await inbox.status(), { pending: 0, claimed: 0, completed: 1, needsReconciliation: 0 });
  const restarted = new DurableHardwareSignalInbox(store);
  assert.deepEqual(await restarted.status(), { pending: 0, claimed: 0, completed: 1, needsReconciliation: 0 });
  assert.deepEqual(await restarted.observeOperation("operation-hardware"), {
    settled: true,
    summary: "The exact hardware dispatch was durably cancelled."
  });
});

test("containment cancels a claimed pre-dispatch signal only for its exact canonical repository binding", async (context) => {
  const { inbox } = await fixture(context);
  await inbox.accept(deviceId, signal);
  const claim = await inbox.claim(binding);
  assert.ok(claim);
  assert.equal(await inbox.cancelQueuedForRepository("C:\\other", "unrelated containment"), 0);
  assert.equal(await inbox.cancelQueuedForRepository("C:\\repo", "repository containment"), 1);
  assert.deepEqual(await inbox.status(), { pending: 0, claimed: 0, completed: 1, needsReconciliation: 0 });
});
