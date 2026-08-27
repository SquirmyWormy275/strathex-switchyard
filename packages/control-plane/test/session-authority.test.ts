import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { AuthorityLedger } from "../src/authority.ts";
import { ProtectedJsonStore } from "../src/store.ts";
import { sessionBindingDigest, SessionCapabilityError, SessionRegistry } from "../src/session-registry.ts";

async function withStore(run: (store: ProtectedJsonStore) => Promise<void>): Promise<void> {
  const directory = await mkdtemp(join(tmpdir(), "sxsy-b122-session-test-"));
  try {
    await run(new ProtectedJsonStore({ filePath: join(directory, "protected-audit.jsonl") }));
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
}

test("session registry never infers verified blocked or finished state without observability", async () => {
  await withStore(async (store) => {
    const registry = new SessionRegistry(store, { clock: () => "2026-08-23T10:00:00.000Z" });
    await registry.register({
      id: "session-1",
      provider: "codex",
      surface: "vscode_terminal",
      capabilities: ["registered"],
      status: "unknown",
      workspaceRoot: "C:/repos/one",
      plannedFiles: [],
      adapterVersion: "1.0.0",
      metadata: { terminalId: "7" }
    });

    await assert.rejects(registry.setStatus("session-1", "verified_blocked"), SessionCapabilityError);
    await registry.setCapabilities("session-1", ["registered", "observable", "controllable"]);
    await registry.setStatus("session-1", "verified_blocked");
    assert.equal((await registry.requireCapabilities("session-1", ["observable"])).allowed, true);

    const reloaded = new SessionRegistry(store);
    assert.equal((await reloaded.get("session-1"))?.status, "verified_blocked");
    assert.equal((await reloaded.listByStatus("verified_blocked")).length, 1);
  });
});

test("heartbeats persist, stale state is explicit, and a heartbeat never guesses a new working state", async () => {
  await withStore(async (store) => {
    const registry = new SessionRegistry(store, { clock: () => "2026-08-23T10:00:00.000Z" });
    await registry.register({
      id: "session-2",
      provider: "claude",
      surface: "vscode_terminal",
      capabilities: ["registered", "observable"],
      status: "running",
      plannedFiles: [],
      adapterVersion: "1.0.0",
      metadata: {}
    });
    await registry.markStale("2026-08-23T10:10:00.000Z", 1_000);
    assert.equal((await registry.get("session-2"))?.status, "stale");
    await registry.heartbeat("session-2", "2026-08-23T10:11:00.000Z");
    assert.equal((await registry.get("session-2"))?.status, "stale");
  });
});

test("trusted companion persistence can upsert a normalized session without retaining a stale elevated capability", async () => {
  await withStore(async (store) => {
    const registry = new SessionRegistry(store, { clock: () => "2026-08-23T10:00:00.000Z" });
    await registry.register({
      id: "session-upsert", provider: "codex", surface: "vscode_terminal", capabilities: ["registered", "observable", "mediated"],
      status: "running", plannedFiles: ["src/one.ts"], adapterVersion: "trusted", metadata: { source: "trusted-host" }
    });
    const normalized = await registry.upsert({
      id: "session-upsert", provider: "generic", surface: "vscode_terminal", capabilities: ["registered"],
      status: "unknown", plannedFiles: [], adapterVersion: "bridge", metadata: { source: "json-registration" }
    });
    assert.deepEqual(normalized.capabilities, ["registered"]);
    assert.equal(normalized.status, "unknown");
    assert.equal((await new SessionRegistry(store).get("session-upsert"))?.provider, "generic");
  });
});

test("session target compare-and-swap rebinds once, forces unknown state, and is idempotent only for the exact operation", async () => {
  await withStore(async (store) => {
    const registry = new SessionRegistry(store, { clock: () => "2026-08-25T12:00:00.000Z" });
    const original = await registry.register({
      id: "session-reanchor", provider: "codex", surface: "vscode_terminal", capabilities: ["registered", "controllable"],
      status: "running", workspaceRoot: "C:/repos/one", targetSnapshotId: "a".repeat(64), taskId: "task-1", planRevision: "plan-7",
      plannedFiles: ["src/a.ts"], adapterVersion: "provider-v1", metadata: { source: "trusted-host" }
    });
    const expectedBindingDigest = sessionBindingDigest(original);
    const rebound = await registry.compareAndSwapTarget({
      sessionId: original.id,
      expectedBindingDigest,
      oldTargetSnapshotId: "a".repeat(64),
      newTargetSnapshotId: "b".repeat(64),
      operationId: `reanchor-operation:${"c".repeat(64)}`
    });
    assert.equal(rebound.outcome, "rebound");
    assert.equal(rebound.session?.targetSnapshotId, "b".repeat(64));
    assert.equal(rebound.session?.status, "unknown", "Re-anchor must not infer that the provider resumed or is running");
    assert.equal(rebound.session?.metadata["sxsy-b122.reanchor.operationId"], `reanchor-operation:${"c".repeat(64)}`);
    assert.equal(rebound.session?.metadata["sxsy-b122.reanchor.resumeAuthorized"], "false");

    const repeated = await new SessionRegistry(store).compareAndSwapTarget({
      sessionId: original.id,
      expectedBindingDigest,
      oldTargetSnapshotId: "a".repeat(64),
      newTargetSnapshotId: "b".repeat(64),
      operationId: `reanchor-operation:${"c".repeat(64)}`
    });
    assert.equal(repeated.outcome, "already_rebound");

    await registry.updateBinding(original.id, { taskId: "substituted-after-rebind" });
    const changedReplay = await registry.compareAndSwapTarget({
      sessionId: original.id,
      expectedBindingDigest,
      oldTargetSnapshotId: "a".repeat(64),
      newTargetSnapshotId: "b".repeat(64),
      operationId: `reanchor-operation:${"c".repeat(64)}`
    });
    assert.equal(changedReplay.outcome, "unknown", "operation markers cannot hide a post-CAS task/adapter/metadata change");

    const confused = await registry.compareAndSwapTarget({
      sessionId: original.id,
      expectedBindingDigest,
      oldTargetSnapshotId: "a".repeat(64),
      newTargetSnapshotId: "d".repeat(64),
      operationId: `reanchor-operation:${"e".repeat(64)}`
    });
    assert.equal(confused.outcome, "unknown");
    assert.equal((await registry.get(original.id))?.targetSnapshotId, "b".repeat(64));
  });
});

test("effect target transition compare-and-swap preserves liveness and is idempotent only for one exact action", async () => {
  await withStore(async (store) => {
    const registry = new SessionRegistry(store);
    const original = await registry.register({
      id: "session-effect-transition", provider: "codex", surface: "vscode_terminal", capabilities: ["registered", "mediated"],
      status: "running", workspaceRoot: "C:/repos/effect", targetSnapshotId: "5".repeat(64), taskId: "task-effect", planRevision: "plan-effect",
      plannedFiles: ["src/effect.ts"], adapterVersion: "provider-v1", metadata: { source: "trusted-host" }
    });
    const expectedBindingDigest = sessionBindingDigest(original);
    const input = {
      sessionId: original.id,
      expectedBindingDigest,
      oldTargetSnapshotId: original.targetSnapshotId!,
      newTargetSnapshotId: "6".repeat(64),
      operationId: `operation:${"7".repeat(64)}`,
      action: "venv"
    } as const;

    const transitioned = await registry.compareAndSwapEffectTarget(input);
    assert.equal(transitioned.outcome, "transitioned");
    assert.equal(transitioned.session?.targetSnapshotId, input.newTargetSnapshotId);
    assert.equal(transitioned.session?.status, original.status, "an accepted effect transition does not invent a lifecycle change");
    assert.equal(transitioned.session?.metadata["sxsy-b122.effectTransition.action"], "venv");
    assert.equal(transitioned.session?.metadata["sxsy-b122.effectTransition.operationId"], input.operationId);

    const replayed = await new SessionRegistry(store).compareAndSwapEffectTarget(input);
    assert.equal(replayed.outcome, "already_transitioned");
    assert.equal(replayed.session?.targetSnapshotId, input.newTargetSnapshotId);

    const confused = await registry.compareAndSwapEffectTarget({ ...input, action: "plan_approval" });
    assert.equal(confused.outcome, "unknown", "an operation/action pair cannot be reinterpreted as another transition");

    await registry.updateBinding(original.id, { planRevision: "changed-after-transition" });
    const changedReplay = await registry.compareAndSwapEffectTarget(input);
    assert.equal(changedReplay.outcome, "unknown", "post-transition binding churn prevents replay from being treated as idempotent");
  });
});

test("concurrent target compare-and-swap lets only one exact re-anchor operation own the binding", async () => {
  await withStore(async (store) => {
    const registry = new SessionRegistry(store);
    const original = await registry.register({
      id: "session-race", provider: "claude", surface: "vscode_terminal", capabilities: ["registered", "controllable"],
      status: "running", workspaceRoot: "C:/repos/race", targetSnapshotId: "1".repeat(64), taskId: "task", planRevision: "plan",
      plannedFiles: [], adapterVersion: "provider-v1", metadata: {}
    });
    const expectedBindingDigest = sessionBindingDigest(original);
    const [one, two] = await Promise.all([
      registry.compareAndSwapTarget({ sessionId: original.id, expectedBindingDigest, oldTargetSnapshotId: "1".repeat(64), newTargetSnapshotId: "2".repeat(64), operationId: `reanchor-operation:${"3".repeat(64)}` }),
      registry.compareAndSwapTarget({ sessionId: original.id, expectedBindingDigest, oldTargetSnapshotId: "1".repeat(64), newTargetSnapshotId: "4".repeat(64), operationId: `reanchor-operation:${"5".repeat(64)}` })
    ]);
    assert.deepEqual([one.outcome, two.outcome].sort(), ["rebound", "unknown"]);
    assert.ok(["2".repeat(64), "4".repeat(64)].includes((await registry.get(original.id))?.targetSnapshotId ?? ""));
  });
});

test("a later exact Re-anchor can advance a session already carrying an older Re-anchor receipt", async () => {
  await withStore(async (store) => {
    const registry = new SessionRegistry(store);
    const original = await registry.register({
      id: "session-sequence", provider: "codex", surface: "vscode_terminal", capabilities: ["registered", "controllable"],
      status: "running", workspaceRoot: "C:/repos/sequence", targetSnapshotId: "6".repeat(64), taskId: "task", planRevision: "plan",
      plannedFiles: [], adapterVersion: "provider-v1", metadata: {}
    });
    const first = await registry.compareAndSwapTarget({
      sessionId: original.id, expectedBindingDigest: sessionBindingDigest(original), oldTargetSnapshotId: "6".repeat(64),
      newTargetSnapshotId: "7".repeat(64), operationId: `reanchor-operation:${"8".repeat(64)}`
    });
    assert.equal(first.outcome, "rebound");
    const second = await registry.compareAndSwapTarget({
      sessionId: original.id, expectedBindingDigest: sessionBindingDigest(first.session!), oldTargetSnapshotId: "7".repeat(64),
      newTargetSnapshotId: "9".repeat(64), operationId: `reanchor-operation:${"a".repeat(64)}`
    });
    assert.equal(second.outcome, "rebound");
    assert.equal(second.session?.targetSnapshotId, "9".repeat(64));
    assert.equal(second.session?.metadata["sxsy-b122.reanchor.operationId"], `reanchor-operation:${"a".repeat(64)}`);
  });
});

test("authority is exact-scoped, expires, and survives revocation/reload", async () => {
  await withStore(async (store) => {
    const ledger = new AuthorityLedger(store, {
      clock: () => "2026-08-23T10:00:00.000Z",
      idFactory: () => "grant-1"
    });
    const grant = await ledger.issue({
      repositoryRoot: "C:/repos/one",
      sessionId: "session-1",
      taskId: "task-1",
      planRevision: "plan-7",
      allowedActions: ["proof.normal"],
      prohibitedActions: ["commit.merge"],
      expiresAt: "2026-08-23T11:00:00.000Z",
      issuedBy: "authenticated-user"
    });

    assert.equal((await ledger.evaluate({
      authorityId: grant.id,
      repositoryRoot: "C:/repos/one",
      sessionId: "session-1",
      taskId: "task-1",
      planRevision: "plan-7",
      action: "proof.normal"
    })).allowed, true);
    assert.equal((await ledger.evaluate({
      authorityId: grant.id,
      repositoryRoot: "C:/repos/two",
      sessionId: "session-1",
      taskId: "task-1",
      planRevision: "plan-7",
      action: "proof.normal"
    })).allowed, false);
    assert.equal((await ledger.evaluate({
      authorityId: grant.id,
      repositoryRoot: "C:/repos/one",
      sessionId: "session-1",
      taskId: "task-1",
      planRevision: "plan-7",
      action: "commit.merge"
    })).allowed, false);
    const expired = await ledger.evaluate({
      authorityId: grant.id,
      repositoryRoot: "C:/repos/one",
      sessionId: "session-1",
      taskId: "task-1",
      planRevision: "plan-7",
      action: "proof.normal",
      now: "2026-08-23T11:01:00.000Z"
    });
    assert.equal(expired.allowed, false);
    assert.match(expired.reason, /expired/i);

    await ledger.revoke(grant.id, "operator containment");
    const reloaded = new AuthorityLedger(store, { clock: () => "2026-08-23T10:30:00.000Z" });
    const decision = await reloaded.evaluate({
      authorityId: grant.id,
      repositoryRoot: "C:/repos/one",
      sessionId: "session-1",
      taskId: "task-1",
      planRevision: "plan-7",
      action: "proof.normal"
    });
    assert.equal(decision.allowed, false);
    assert.match(decision.reason, /revoked/i);
  });
});
