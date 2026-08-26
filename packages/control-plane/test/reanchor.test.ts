import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import type { AuthorityGrant, ManagedSession, TargetSnapshot } from "../src/contracts.ts";
import { DurableConfirmationLedger } from "../src/confirmations.ts";
import {
  DurableReanchorCoordinator,
  type ReanchorCoordinatorDependencies,
  type ReanchorLifecyclePhase
} from "../src/reanchor.ts";
import { targetSnapshotDigest } from "../src/snapshot.ts";
import { ProtectedJsonStore, sha256 } from "../src/store.ts";

const baseNow = "2026-08-25T12:00:00.000Z";

function snapshot(head: string, capturedAt = baseNow): TargetSnapshot {
  const material = {
    repositoryRoot: "C:/work/reanchor",
    canonicalRemote: "https://github.com/example/reanchor.git",
    branch: "feature/reanchor",
    upstream: "origin/feature/reanchor",
    head,
    indexTree: `tree-${head}`,
    trackedManifest: `tracked-${head}`,
    untrackedManifest: "untracked-clean",
    submodules: {},
    policyVersion: "policy-v1",
    environmentFingerprint: "environment-v1",
    completeness: "complete" as const,
    reasons: [] as readonly string[]
  };
  return { id: targetSnapshotDigest(material), ...material, capturedAt };
}

const oldTarget = snapshot("old-head", "2026-08-25T11:59:00.000Z");
const newTarget = snapshot("new-head");

const session: ManagedSession = {
  id: "managed-session-reanchor",
  provider: "codex",
  surface: "vscode_terminal",
  capabilities: ["registered", "observable", "controllable", "mediated"],
  status: "running",
  workspaceRoot: oldTarget.repositoryRoot,
  targetSnapshotId: oldTarget.id,
  taskId: "task-reanchor",
  planRevision: "plan-v3",
  plannedFiles: ["src/one.ts"],
  lastHeartbeat: baseNow,
  adapterVersion: "codex-host-v1",
  metadata: { "sxsy-b122.kind": "provider" }
};

const authority: AuthorityGrant = {
  id: "authority-reanchor",
  repositoryRoot: oldTarget.repositoryRoot,
  sessionId: session.id,
  taskId: session.taskId,
  planRevision: session.planRevision,
  allowedActions: ["reanchor"],
  prohibitedActions: ["credential.read", "network.open"],
  issuedAt: "2026-08-25T11:55:00.000Z",
  expiresAt: "2026-08-25T12:10:00.000Z",
  issuedBy: "TEST\\Reviewer"
};

const request = () => ({
  oldTarget,
  newTarget,
  reason: "The managed agent must stop and reconcile its exact task context.",
  session,
  authority
});

async function withStore(run: (store: ProtectedJsonStore) => Promise<void>): Promise<void> {
  const directory = await mkdtemp(join(tmpdir(), "sxsy-b122-reanchor-test-"));
  try {
    await run(new ProtectedJsonStore({ filePath: join(directory, "protected.jsonl"), clock: () => baseNow }));
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
}

function dependencies(overrides: Partial<ReanchorCoordinatorDependencies> = {}): ReanchorCoordinatorDependencies {
  return {
    sessions: { async get() { return session; } },
    authorities: { async get() { return authority; } },
    snapshots: { async isCurrent(target) { return target.id === newTarget.id; } },
    containment: { async inspect() { return { allowed: true, fenceEpoch: 7, reason: "No active containment fence." }; } },
    effectGuard: { async assertCurrent() { return { allowed: true, reason: "Exact target remains current." }; } },
    confirmations: {
      async consume(input) {
        return {
          allowed: true,
          reason: "Protected current-user confirmation consumed.",
          record: {
            id: "confirmation-reanchor",
            action: input.action,
            targetSnapshotId: input.targetSnapshotId,
            sessionId: input.sessionId,
            authorityId: input.authorityId,
            scopeDigest: input.scopeDigest,
            reason: "Reviewed exact re-anchor preview.",
            reauthenticated: true,
            tokenDigest: sha256(input.token),
            createdAt: baseNow,
            expiresAt: "2026-08-25T12:02:00.000Z",
            consumedAt: baseNow
          }
        };
      }
    },
    ...overrides
  };
}

async function reviewAndConfirm(coordinator: DurableReanchorCoordinator, requestId: string): Promise<void> {
  const preview = await coordinator.preview(requestId);
  await coordinator.confirm({
    requestId,
    currentUserConfirmed: true,
    confirmationToken: "current-user-confirmation-token",
    confirmationScopeDigest: preview.confirmationScopeDigest
  });
}

test("re-anchor is preview-only until exact human confirmation and records one deterministic idempotent receipt", async () => {
  await withStore(async (store) => {
    let previews = 0;
    let effects = 0;
    const coordinator = new DurableReanchorCoordinator(store, dependencies({
      previewer: {
        async preview() {
          previews += 1;
          return { summary: "Read-only context comparison complete.", discrepancies: ["HEAD changed."], risks: [], questions: ["Is the new plan revision expected?"] };
        }
      },
      applier: {
        async apply(input) {
          effects += 1;
          assert.equal(input.cooperativeStopRequested, true);
          assert.equal(input.resumeAuthorized, false);
          assert.equal(input.credentials, undefined);
          assert.equal(input.network, undefined);
          return { disposition: "committed", externalEffectId: "provider-reanchor-effect-1", summary: "Provider accepted the exact re-anchor packet." };
        }
      }
    }), { clock: () => baseNow });

    const created = await coordinator.request(request());
    assert.equal(created.state, "pending_preview");
    await assert.rejects(() => coordinator.apply(created.request.id), /preview|confirmation/i);
    assert.equal(effects, 0);

    const preview = await coordinator.preview(created.request.id);
    assert.equal(previews, 1);
    assert.equal(effects, 0, "read-only preview must not cross the apply boundary");
    await assert.rejects(() => coordinator.confirm({
      requestId: created.request.id,
      currentUserConfirmed: true,
      confirmationToken: "current-user-confirmation-token",
      confirmationScopeDigest: "0".repeat(64)
    }), /scope/i);

    await coordinator.confirm({
      requestId: created.request.id,
      currentUserConfirmed: true,
      confirmationToken: "current-user-confirmation-token",
      confirmationScopeDigest: preview.confirmationScopeDigest
    });
    const completed = await coordinator.apply(created.request.id);
    assert.equal(completed.state, "recorded");
    assert.match(completed.receipt?.id ?? "", /^reanchor-receipt:[a-f0-9]{64}$/);
    assert.equal(completed.receipt?.oldTargetSnapshotId, oldTarget.id);
    assert.equal(completed.receipt?.newTargetSnapshotId, newTarget.id);
    const repeated = await coordinator.apply(created.request.id);
    assert.equal(repeated.receipt?.id, completed.receipt?.id);
    assert.equal(effects, 1, "an idempotent repeat must never replay the provider effect");
    assert.equal((await coordinator.request(request())).request.id, created.request.id);
  });
});

test("restart preserves pending work and two consumers cannot both execute it", async () => {
  await withStore(async (store) => {
    let effects = 0;
    let releaseEffect!: () => void;
    const effectGate = new Promise<void>((resolve) => { releaseEffect = resolve; });
    const shared = dependencies({
      applier: {
        async apply() {
          effects += 1;
          await effectGate;
          return { disposition: "committed", externalEffectId: "single-consumer-effect", summary: "Committed once." };
        }
      }
    });
    const first = new DurableReanchorCoordinator(store, shared, { clock: () => baseNow });
    const created = await first.request(request());
    const restarted = new DurableReanchorCoordinator(store, shared, { clock: () => baseNow });
    assert.equal((await restarted.get(created.request.id))?.state, "pending_preview");
    await reviewAndConfirm(restarted, created.request.id);

    const one = first.apply(created.request.id);
    for (let attempt = 0; attempt < 100 && effects === 0; attempt += 1) await new Promise((resolve) => setTimeout(resolve, 1));
    assert.equal(effects, 1, "the first durable consumer must reach the bounded effect gate");
    const competing = await restarted.apply(created.request.id);
    assert.equal(competing.state, "executing");
    releaseEffect();
    assert.equal((await one).state, "recorded");
    assert.equal(effects, 1);
  });
});

test("a crash after an externally committed effect recovers as ambiguous and never replays", async () => {
  await withStore(async (store) => {
    let effects = 0;
    const crashing = new DurableReanchorCoordinator(store, dependencies({
      applier: { async apply() { effects += 1; return { disposition: "committed", externalEffectId: "possibly-committed-effect", summary: "Provider replied committed." }; } }
    }), {
      clock: () => baseNow,
      lifecycleProbe(phase: ReanchorLifecyclePhase) { if (phase === "external_effect_returned") throw new Error("simulated process loss"); }
    });
    const created = await crashing.request(request());
    await reviewAndConfirm(crashing, created.request.id);
    await assert.rejects(() => crashing.apply(created.request.id), /simulated process loss/);
    assert.equal((await crashing.get(created.request.id))?.state, "executing");

    const restarted = new DurableReanchorCoordinator(store, dependencies({
      applier: { async apply() { effects += 1; return { disposition: "committed", externalEffectId: "replayed", summary: "must not run" }; } }
    }), { clock: () => "2026-08-25T12:00:30.000Z" });
    const recovered = await restarted.recover();
    assert.equal(recovered.find((item) => item.request.id === created.request.id)?.state, "ambiguous");
    assert.equal((await restarted.apply(created.request.id)).state, "ambiguous");
    assert.equal(effects, 1, "an executing or ambiguous external boundary is reconciliation-only");
  });
});

test("a durable external-commit marker is finalized after restart without executing again", async () => {
  await withStore(async (store) => {
    let effects = 0;
    const crashing = new DurableReanchorCoordinator(store, dependencies({
      applier: { async apply() { effects += 1; return { disposition: "committed", externalEffectId: "durable-provider-effect", summary: "Committed." }; } }
    }), {
      clock: () => baseNow,
      lifecycleProbe(phase) { if (phase === "external_committed_persisted") throw new Error("crash before receipt"); }
    });
    const created = await crashing.request(request());
    await reviewAndConfirm(crashing, created.request.id);
    await assert.rejects(() => crashing.apply(created.request.id), /crash before receipt/);
    assert.equal((await crashing.get(created.request.id))?.state, "external_committed");

    const restarted = new DurableReanchorCoordinator(store, dependencies({
      applier: { async apply() { effects += 1; return { disposition: "committed", externalEffectId: "replayed", summary: "must not run" }; } }
    }), { clock: () => "2026-08-25T12:00:30.000Z" });
    const recovered = await restarted.recover();
    const completed = recovered.find((item) => item.request.id === created.request.id);
    assert.equal(completed?.state, "recorded");
    assert.equal(completed?.receipt?.externalEffectId, "durable-provider-effect");
    assert.equal(completed?.receipt?.createdAt, baseNow, "receipt material is deterministic from the durable external-commit marker, not recovery time");
    assert.equal(effects, 1);
  });
});

test("stale target, authority, session anchor, containment epoch, or effect guard rejects before apply", async () => {
  const cases: readonly [string, Partial<ReanchorCoordinatorDependencies>][] = [
    ["snapshot", { snapshots: { async isCurrent() { return false; } } }],
    ["authority", { authorities: { async get() { return { ...authority, revokedAt: baseNow }; } } }],
    ["session", { sessions: { async get() { return { ...session, targetSnapshotId: newTarget.id }; } } }],
    ["fence", { containment: { async inspect() { return { allowed: true, fenceEpoch: 8, reason: "Fence generation changed." }; } } }],
    ["effect guard", { effectGuard: { async assertCurrent() { return { allowed: false, reason: "Final target changed." }; } } }]
  ];
  for (const [label, override] of cases) {
    await withStore(async (store) => {
      let effects = 0;
      const stable = dependencies({ applier: { async apply() { effects += 1; return { disposition: "committed", externalEffectId: "must-not-run", summary: "must not run" }; } } });
      const coordinator = new DurableReanchorCoordinator(store, stable, { clock: () => baseNow });
      const created = await coordinator.request(request());
      await reviewAndConfirm(coordinator, created.request.id);
      const final = new DurableReanchorCoordinator(store, { ...stable, ...override }, { clock: () => baseNow });
      const rejected = await final.apply(created.request.id);
      assert.equal(rejected.state, "rejected", `${label} must reject`);
      assert.equal(effects, 0, `${label} must reject before the apply port`);
    });
  }
});

test("default composition has no credential, network, or mutation effect and closed requests reject extra payloads", async () => {
  await withStore(async (store) => {
    const coordinator = new DurableReanchorCoordinator(store, dependencies(), { clock: () => baseNow });
    await assert.rejects(
      () => coordinator.request({ ...request(), credential: "forbidden" } as ReturnType<typeof request>),
      /closed|field/i
    );
    const created = await coordinator.request(request());
    const preview = await coordinator.preview(created.request.id);
    assert.equal(preview.discrepancies.some((item) => /head/i.test(item)), true);
    await coordinator.confirm({ requestId: created.request.id, currentUserConfirmed: true, confirmationToken: "current-user-confirmation-token", confirmationScopeDigest: preview.confirmationScopeDigest });
    const rejected = await coordinator.apply(created.request.id);
    assert.equal(rejected.state, "rejected");
    assert.match(rejected.summary ?? "", /apply adapter|unavailable/i);
  });
});

test("expired human confirmation cannot cross the effect boundary and the deterministic request remains idempotent", async () => {
  await withStore(async (store) => {
    let now = baseNow;
    let effects = 0;
    const coordinator = new DurableReanchorCoordinator(store, dependencies({
      applier: { async apply() { effects += 1; return { disposition: "committed", externalEffectId: "must-not-run", summary: "must not run" }; } }
    }), { clock: () => now, confirmationLifetimeMs: 1_000 });
    const created = await coordinator.request(request());
    await reviewAndConfirm(coordinator, created.request.id);
    now = "2026-08-25T12:00:02.000Z";
    const expired = await coordinator.apply(created.request.id);
    assert.equal(expired.state, "rejected");
    assert.equal(effects, 0);
    assert.equal((await coordinator.request(request())).request.id, created.request.id, "an expired repeat focuses the protected prior request instead of creating or replaying work");
  });
});

test("a client assertion without a protected reauthenticated confirmation cannot authorize apply", async () => {
  await withStore(async (store) => {
    let effects = 0;
    const coordinator = new DurableReanchorCoordinator(store, dependencies({
      confirmations: {
        async consume(input) {
          return {
            allowed: true,
            reason: "Token exists but did not cross current-user reauthentication.",
            record: {
              id: "confirmation-unattested",
              action: input.action,
              targetSnapshotId: input.targetSnapshotId,
              sessionId: input.sessionId,
              authorityId: input.authorityId,
              scopeDigest: input.scopeDigest,
              reason: "Unattested.",
              reauthenticated: false,
              tokenDigest: sha256(input.token),
              createdAt: baseNow,
              expiresAt: "2026-08-25T12:02:00.000Z",
              consumedAt: baseNow
            }
          };
        }
      },
      applier: { async apply() { effects += 1; return { disposition: "committed", externalEffectId: "must-not-run", summary: "must not run" }; } }
    }), { clock: () => baseNow });
    const created = await coordinator.request(request());
    const preview = await coordinator.preview(created.request.id);
    await assert.rejects(() => coordinator.confirm({
      requestId: created.request.id,
      currentUserConfirmed: true,
      confirmationToken: "current-user-confirmation-token",
      confirmationScopeDigest: preview.confirmationScopeDigest
    }), /reauthenticated|protected confirmation/i);
    await assert.rejects(() => coordinator.apply(created.request.id), /confirmation/i);
    assert.equal(effects, 0);
  });
});

test("the real durable confirmation ledger is consumed once for the exact reviewed re-anchor scope", async () => {
  await withStore(async (store) => {
    let effects = 0;
    const confirmations = new DurableConfirmationLedger(store, {
      clock: () => baseNow,
      tokenFactory: () => "real-ledger-current-user-token",
      idFactory: () => "real-ledger-confirmation",
      ttlMs: 120_000
    });
    const coordinator = new DurableReanchorCoordinator(store, dependencies({
      confirmations,
      applier: { async apply() { effects += 1; return { disposition: "committed", externalEffectId: "real-confirmed-effect", summary: "Applied once." }; } }
    }), { clock: () => baseNow });
    const created = await coordinator.request(request());
    const preview = await coordinator.preview(created.request.id);
    const issued = await confirmations.issue({
      action: "reanchor",
      targetSnapshotId: newTarget.id,
      sessionId: session.id,
      authorityId: authority.id,
      scopeDigest: preview.confirmationScopeDigest,
      reason: "The current user reviewed the exact re-anchor preview.",
      reauthenticated: true
    });
    await coordinator.confirm({
      requestId: created.request.id,
      currentUserConfirmed: true,
      confirmationToken: issued.token,
      confirmationScopeDigest: preview.confirmationScopeDigest
    });
    assert.equal((await coordinator.apply(created.request.id)).state, "recorded");
    assert.equal(effects, 1);
    const consumed = await confirmations.get(issued.record.id);
    assert.equal(consumed?.consumedAt, baseNow);
    assert.equal(consumed?.scopeDigest, preview.confirmationScopeDigest);
  });
});
