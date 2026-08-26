import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { AuthorityLedger } from "../../../packages/control-plane/src/authority.ts";
import type { ManagedSession, TargetSnapshot } from "../../../packages/control-plane/src/contracts.ts";
import type { ReanchorApplyRequest, ReanchorLifecyclePhase } from "../../../packages/control-plane/src/reanchor.ts";
import { SessionRegistry } from "../../../packages/control-plane/src/session-registry.ts";
import { TargetSnapshotLedger } from "../../../packages/control-plane/src/snapshot-ledger.ts";
import { targetSnapshotDigest } from "../../../packages/control-plane/src/snapshot.ts";
import { ProtectedJsonStore } from "../../../packages/control-plane/src/store.ts";
import { InstalledDurableReanchorRuntime } from "../src/reanchor-runtime.ts";

const now = "2026-08-25T12:00:00.000Z";

function snapshot(head: string, options: { readonly completeness?: "complete" | "incomplete"; readonly reasons?: readonly string[] } = {}): TargetSnapshot {
  const completeness = options.completeness ?? "complete";
  const material = {
    repositoryRoot: "C:/work/installed-reanchor",
    canonicalRemote: "https://github.com/example/installed-reanchor.git",
    branch: "feature/reanchor",
    upstream: "origin/feature/reanchor",
    head,
    indexTree: `tree-${head}`,
    trackedManifest: `tracked-${head}`,
    untrackedManifest: "untracked-clean",
    submodules: {},
    policyVersion: "policy-v1",
    environmentFingerprint: "environment-v1",
    completeness,
    reasons: options.reasons ?? []
  };
  return { id: targetSnapshotDigest(material), ...material, capturedAt: now };
}

const oldTarget = snapshot("old-head");
const newTarget = snapshot("new-head");
const changedTarget = snapshot("changed-again");

const registeredSession: Omit<ManagedSession, "lastHeartbeat"> & { readonly lastHeartbeat?: string } = {
  id: "installed-reanchor-session",
  provider: "codex",
  surface: "vscode_terminal",
  capabilities: ["registered", "observable", "controllable", "mediated"],
  status: "running",
  workspaceRoot: oldTarget.repositoryRoot,
  targetSnapshotId: oldTarget.id,
  taskId: "installed-reanchor-task",
  planRevision: "plan-v4",
  plannedFiles: ["src/exact.ts"],
  adapterVersion: "installed-provider-v1",
  metadata: { "sxsy-b122.kind": "provider" }
};

async function withStore(run: (store: ProtectedJsonStore) => Promise<void>): Promise<void> {
  const directory = await mkdtemp(join(tmpdir(), "sxsy-b122-installed-reanchor-"));
  try {
    await run(new ProtectedJsonStore({ filePath: join(directory, "protected.jsonl"), clock: () => now }));
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
}

function committed(input: ReanchorApplyRequest, id = "installed-reanchor-effect") {
  return {
    disposition: "committed" as const,
    acknowledgement: {
      schema: "sxsy-b122.reanchor-acknowledgement" as const,
      version: 1 as const,
      requestId: input.requestId,
      operationId: input.operationId,
      externalEffectId: id,
      sessionId: input.sessionId,
      authorityId: input.authorityId,
      oldTargetSnapshotId: input.oldTargetSnapshotId,
      newTargetSnapshotId: input.newTargetSnapshotId,
      cooperativeStopAcknowledged: true as const,
      resumed: false as const,
      summary: "The provider stopped and reported the exact reviewed context."
    }
  };
}

async function harness(store: ProtectedJsonStore, options: {
  readonly recordOld?: boolean;
  readonly resolve?: (call: number, session: ManagedSession | undefined) => TargetSnapshot | undefined;
  readonly presenceVerified?: boolean;
  readonly lifecycleProbe?: (phase: ReanchorLifecyclePhase) => Promise<void> | void;
  readonly onApply?: (input: ReanchorApplyRequest) => void;
  readonly expectedPresenceNewTargetId?: string;
} = {}) {
  const sessions = new SessionRegistry(store, { clock: () => now });
  await sessions.register(registeredSession);
  const snapshots = new TargetSnapshotLedger(store);
  if (options.recordOld !== false) await snapshots.record(oldTarget);
  const authorities = new AuthorityLedger(store, { clock: () => now, idFactory: () => "must-not-issue" });
  const authority = await authorities.issue({
    id: "installed-reanchor-authority",
    repositoryRoot: oldTarget.repositoryRoot,
    sessionId: registeredSession.id,
    taskId: registeredSession.taskId,
    planRevision: registeredSession.planRevision,
    allowedActions: ["reanchor"],
    prohibitedActions: ["credential.read", "network.open"],
    expiresAt: "2026-08-25T12:10:00.000Z",
    issuedBy: "TEST\\Reviewer"
  });
  let resolveCalls = 0;
  let presenceCalls = 0;
  let applyCalls = 0;
  const runtime = new InstalledDurableReanchorRuntime({
    store,
    sessions,
    authorities,
    snapshots,
    targets: {
      async resolve(input) {
        resolveCalls += 1;
        assert.equal(input.definition.action, "reanchor");
        return options.resolve?.(resolveCalls, input.session) ?? newTarget;
      }
    },
    containment: { async inspect() { return { allowed: true, fenceEpoch: 11, reason: "No containment fence." }; } },
    effectGuard: { async assertCurrent() { return { allowed: true, reason: "The host-derived target is current." }; } },
    presence: {
      async verify(prompt) {
        presenceCalls += 1;
        assert.match(prompt, /Re-anchor/i);
        assert.match(prompt, new RegExp(oldTarget.id));
        assert.match(prompt, new RegExp(options.expectedPresenceNewTargetId ?? newTarget.id));
        return options.presenceVerified === false ? { verified: false } : { verified: true, operator: "TEST\\Reviewer" };
      }
    },
    applier: {
      async apply(input) {
        applyCalls += 1;
        options.onApply?.(input);
        return committed(input);
      }
    },
    clock: () => now,
    confirmationTokenFactory: () => "installed-current-user-token",
    confirmationIdFactory: () => "installed-current-user-confirmation",
    lifecycleProbe: options.lifecycleProbe
  });
  return { runtime, sessions, snapshots, authorities, authority, counts: { get resolve() { return resolveCalls; }, get presence() { return presenceCalls; }, get apply() { return applyCalls; } } };
}

test("installed Re-anchor derives both targets and authority from protected host state, confirms presence, and never resumes", async () => {
  await withStore(async (store) => {
    let providerRequest: ReanchorApplyRequest | undefined;
    const context = await harness(store, { onApply(input) { providerRequest = input; } });
    const review = await context.runtime.begin({ sessionId: registeredSession.id, authorityId: context.authority.id, reason: "Reconcile the exact managed task context." });
    assert.equal(review.state, "pending_confirmation");
    assert.equal(review.oldTargetSnapshotId, oldTarget.id);
    assert.equal(review.newTargetSnapshotId, newTarget.id);
    assert.equal(JSON.stringify(review).includes("installed-current-user-token"), false);

    const result = await context.runtime.confirmAndApply({ requestId: review.requestId });
    assert.equal(result.state, "recorded");
    assert.equal(result.receipt?.resumed, false);
    assert.equal(providerRequest?.oldTargetSnapshotId, oldTarget.id);
    assert.equal(providerRequest?.newTargetSnapshotId, newTarget.id);
    assert.equal(providerRequest?.cooperativeStopRequested, true);
    assert.equal(providerRequest?.resumeAuthorized, false);
    const rebound = await context.sessions.get(registeredSession.id);
    assert.equal(rebound?.targetSnapshotId, newTarget.id);
    assert.equal(rebound?.status, "unknown");
    assert.equal(rebound?.metadata["sxsy-b122.reanchor.resumeAuthorized"], "false");
    assert.equal(context.counts.presence, 1);
    assert.equal(context.counts.apply, 1);
  });
});

test("installed Re-anchor rejects client-supplied snapshots or confirmation claims and missing/incomplete host targets", async () => {
  await withStore(async (store) => {
    const context = await harness(store);
    await assert.rejects(() => context.runtime.begin({
      sessionId: registeredSession.id,
      authorityId: context.authority.id,
      reason: "Attempt to inject a target.",
      oldTarget,
      newTarget,
      currentUserConfirmed: true,
      confirmationToken: "forbidden"
    } as never), /closed|field/i);
    assert.equal(context.counts.apply, 0);
  });
  await withStore(async (store) => {
    const context = await harness(store, { recordOld: false });
    await assert.rejects(() => context.runtime.begin({ sessionId: registeredSession.id, authorityId: context.authority.id, reason: "Missing old state." }), /old TargetSnapshot|protected.*snapshot/i);
  });
  await withStore(async (store) => {
    const incomplete = snapshot("incomplete", { completeness: "incomplete", reasons: ["Host capture did not finish."] });
    const context = await harness(store, { resolve: () => incomplete });
    await assert.rejects(() => context.runtime.begin({ sessionId: registeredSession.id, authorityId: context.authority.id, reason: "Incomplete new state." }), /complete.*TargetSnapshot|incomplete/i);
  });
});

test("installed Re-anchor requires live exact authority and host-owned user presence before provider dispatch", async () => {
  await withStore(async (store) => {
    const context = await harness(store, { presenceVerified: false });
    const review = await context.runtime.begin({ sessionId: registeredSession.id, authorityId: context.authority.id, reason: "Presence denial case." });
    await assert.rejects(() => context.runtime.confirmAndApply({ requestId: review.requestId }), /presence|approve/i);
    assert.equal(context.counts.apply, 0);
    assert.equal((await context.runtime.get(review.requestId))?.state, "pending_confirmation");
  });
  await withStore(async (store) => {
    const context = await harness(store);
    const review = await context.runtime.begin({ sessionId: registeredSession.id, authorityId: context.authority.id, reason: "Authority revocation case." });
    await context.authorities.revoke(context.authority.id, "Test revocation before the final effect.");
    const result = await context.runtime.confirmAndApply({ requestId: review.requestId });
    assert.equal(result.state, "rejected");
    assert.equal(context.counts.apply, 0);
  });
});

test("installed Re-anchor final host resolution rejects target churn before provider dispatch", async () => {
  await withStore(async (store) => {
    const context = await harness(store, { resolve: (call) => call <= 2 ? newTarget : changedTarget });
    const review = await context.runtime.begin({ sessionId: registeredSession.id, authorityId: context.authority.id, reason: "Detect target churn." });
    const result = await context.runtime.confirmAndApply({ requestId: review.requestId });
    assert.equal(result.state, "rejected");
    assert.equal(context.counts.apply, 0);
    assert.equal((await context.sessions.get(registeredSession.id))?.targetSnapshotId, oldTarget.id);
  });
});

test("installed Re-anchor restart recovers an exact post-CAS crash without provider replay", async () => {
  await withStore(async (store) => {
    const first = await harness(store, {
      lifecycleProbe(phase) { if (phase === "session_compare_and_swap_returned") throw new Error("installed crash after CAS"); }
    });
    const review = await first.runtime.begin({ sessionId: registeredSession.id, authorityId: first.authority.id, reason: "Restart recovery case." });
    await assert.rejects(() => first.runtime.confirmAndApply({ requestId: review.requestId }), /installed crash after CAS/);
    assert.equal(first.counts.apply, 1);

    let replayed = 0;
    const restarted = new InstalledDurableReanchorRuntime({
      store,
      sessions: first.sessions,
      authorities: first.authorities,
      snapshots: first.snapshots,
      targets: { async resolve() { return newTarget; } },
      containment: { async inspect() { return { allowed: true, fenceEpoch: 11, reason: "No containment fence." }; } },
      effectGuard: { async assertCurrent() { return { allowed: true, reason: "Current." }; } },
      presence: { async verify() { throw new Error("recovery must not request presence"); } },
      applier: { async apply(input) { replayed += 1; return committed(input, "must-not-replay"); } },
      clock: () => "2026-08-25T12:00:30.000Z"
    });
    const recovered = (await restarted.recover()).find((item) => item.requestId === review.requestId);
    assert.equal(recovered?.state, "recorded");
    assert.equal(recovered?.receipt?.sessionRebindOutcome, "already_rebound");
    assert.equal(replayed, 0);
    assert.equal((await first.sessions.get(registeredSession.id))?.status, "unknown");
  });
});

test("installed Re-anchor repairs context drift even when a fresh host capture has the same target identity", async () => {
  await withStore(async (store) => {
    let providerCalls = 0;
    const context = await harness(store, {
      resolve: () => ({ ...oldTarget, capturedAt: "2026-08-25T12:00:01.000Z" }),
      expectedPresenceNewTargetId: oldTarget.id,
      onApply(input) {
        providerCalls += 1;
        assert.equal(input.oldTargetSnapshotId, oldTarget.id);
        assert.equal(input.newTargetSnapshotId, oldTarget.id);
      }
    });
    const review = await context.runtime.begin({ sessionId: registeredSession.id, authorityId: context.authority.id, reason: "Repair provider context drift without a repository change." });
    assert.equal(review.oldTargetSnapshotId, oldTarget.id);
    assert.equal(review.newTargetSnapshotId, oldTarget.id);
    const completed = await context.runtime.confirmAndApply({ requestId: review.requestId });
    assert.equal(completed.state, "recorded");
    assert.equal(completed.receipt?.resumed, false);
    assert.equal(providerCalls, 1);
    assert.equal((await context.sessions.get(registeredSession.id))?.status, "unknown");
    assert.equal((await context.runtime.confirmAndApply({ requestId: review.requestId })).state, "recorded");
    assert.equal(providerCalls, 1, "the same-target Re-anchor receipt must remain no-replay idempotent");
  });
});
