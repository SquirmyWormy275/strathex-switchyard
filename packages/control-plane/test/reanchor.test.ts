import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import type { AuthorityGrant, ManagedSession, TargetSnapshot } from "../src/contracts.ts";
import type { CoordinatorEvidenceBundle } from "../src/workflow-artifacts.ts";
import { DurableConfirmationLedger } from "../src/confirmations.ts";
import {
  canonicalReanchorApplyRequest,
  DurableReanchorCoordinator,
  type ReanchorApplyOutcome,
  type ReanchorApplyRequest,
  type ReanchorCoordinatorDependencies,
  type ReanchorLifecyclePhase
} from "../src/reanchor.ts";
import { sessionBindingDigest, type SessionTargetRebindRequest, type SessionTargetRebindResult } from "../src/session-registry.ts";
import { targetSnapshotDigest } from "../src/snapshot.ts";
import { ProtectedJsonStore, sha256, stableJson } from "../src/store.ts";

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

function contextEvidence(): CoordinatorEvidenceBundle {
  const planMaterial = {
    revision: session.planRevision!,
    originSessionId: session.id,
    taskId: session.taskId!,
    objective: "Reread the exact task brief and reconcile current work.",
    steps: [{ id: "step-one", summary: "Inspect the current work.", ownedFiles: ["src/one.ts"], dependencies: [], status: "approved" as const }],
    decisions: ["Automatic resume is forbidden."],
    expectedTargetTransition: { beforeTargetSnapshotId: oldTarget.id, expectedAfterTargetSnapshotId: oldTarget.id, expectation: "unchanged" as const }
  };
  const material = {
    instructions: [{ id: "instructions-one", digest: sha256("protected instructions"), source: "protected_context" as const, summary: "Original protected instructions." }],
    plan: { digest: sha256(stableJson(planMaterial)), ...planMaterial },
    documentation: [{ id: "documentation-one", digest: sha256("project documentation"), source: "repository" as const, summary: "Repository documentation." }],
    diff: { id: "diff-one", digest: sha256("current diff"), source: "target_snapshot" as const, summary: "Current worktree diff." },
    files: [{ id: "file-one", digest: sha256("src/one.ts"), source: "repository" as const, summary: "Current planned file." }],
    tests: [{ id: "test-one", digest: sha256("test result"), source: "receipt" as const, summary: "Current test evidence.", status: "passed" as const }]
  };
  return { contextDigest: sha256(stableJson(material)), ...material };
}

function committed(input: ReanchorApplyRequest, externalEffectId: string, summary: string): Extract<ReanchorApplyOutcome, { readonly disposition: "committed" }> {
  return {
    disposition: "committed",
    acknowledgement: {
      schema: "sxsy-b122.reanchor-acknowledgement",
      version: 1,
      requestId: input.requestId,
      operationId: input.operationId,
      externalEffectId,
      sessionId: input.sessionId,
      authorityId: input.authorityId,
      oldTargetSnapshotId: input.oldTargetSnapshotId,
      newTargetSnapshotId: input.newTargetSnapshotId,
      cooperativeStopAcknowledged: true,
      resumed: false,
      artifactDigest: input.artifactDigest,
      rereadEvidence: input.rereadEvidence,
      report: {
        summary,
        discrepancies: ["The provider reread found one target transition."],
        risks: ["The managed session remains stopped."],
        questions: ["Should a separately authorized action resume this work?"],
        result: "reanchored_without_resume"
      }
    }
  };
}

async function withStore(run: (store: ProtectedJsonStore) => Promise<void>): Promise<void> {
  const directory = await mkdtemp(join(tmpdir(), "sxsy-b122-reanchor-test-"));
  try {
    await run(new ProtectedJsonStore({ filePath: join(directory, "protected.jsonl"), clock: () => baseNow }));
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
}

function dependencies(overrides: Partial<ReanchorCoordinatorDependencies> = {}): ReanchorCoordinatorDependencies {
  let currentSession = session;
  return {
    sessions: {
      async get() { return currentSession; },
      async compareAndSwapTarget(input: SessionTargetRebindRequest): Promise<SessionTargetRebindResult> {
        if (currentSession.targetSnapshotId === input.newTargetSnapshotId && currentSession.status === "unknown"
          && currentSession.metadata["sxsy-b122.reanchor.operationId"] === input.operationId
          && currentSession.metadata["sxsy-b122.reanchor.oldTargetSnapshotId"] === input.oldTargetSnapshotId
          && currentSession.metadata["sxsy-b122.reanchor.newTargetSnapshotId"] === input.newTargetSnapshotId
          && currentSession.metadata["sxsy-b122.reanchor.resumeAuthorized"] === "false") {
          return { outcome: "already_rebound", reason: "The exact session operation already owns this binding.", session: currentSession };
        }
        if (input.sessionId !== currentSession.id || input.expectedBindingDigest !== sessionBindingDigest(currentSession)
          || input.oldTargetSnapshotId !== currentSession.targetSnapshotId) return { outcome: "unknown", reason: "The exact session binding changed." };
        currentSession = {
          ...currentSession,
          targetSnapshotId: input.newTargetSnapshotId,
          status: "unknown",
          metadata: {
            ...currentSession.metadata,
            "sxsy-b122.reanchor.operationId": input.operationId,
            "sxsy-b122.reanchor.oldTargetSnapshotId": input.oldTargetSnapshotId,
            "sxsy-b122.reanchor.newTargetSnapshotId": input.newTargetSnapshotId,
            "sxsy-b122.reanchor.resumeAuthorized": "false"
          }
        };
        return { outcome: "rebound", reason: "The exact protected session binding was re-anchored.", session: currentSession };
      }
    },
    authorities: { async get() { return authority; } },
    snapshots: { async isCurrent(target, expectedSession) { return target.id === newTarget.id && expectedSession.id === session.id; } },
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
    previewer: {
      async preview() {
        return {
          summary: "Read-only context comparison complete.",
          discrepancies: ["HEAD changed."],
          risks: [],
          questions: [],
          contextEvidence: contextEvidence()
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
          return { summary: "Read-only context comparison complete.", discrepancies: ["HEAD changed."], risks: [], questions: ["Is the new plan revision expected?"], contextEvidence: contextEvidence() };
        }
      },
      applier: {
        async apply(input) {
          effects += 1;
          assert.equal(input.cooperativeStopRequested, true);
          assert.equal(input.resumeAuthorized, false);
          assert.equal(input.credentials, undefined);
          assert.equal(input.network, undefined);
          return committed(input, "provider-reanchor-effect-1", "Provider accepted the exact re-anchor packet.");
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
    assert.equal(completed.receipt?.sessionRebindOutcome, "rebound");
    assert.equal(completed.receipt?.resumed, false);
    assert.deepEqual(completed.receipt?.report, {
      summary: "Provider accepted the exact re-anchor packet.",
      discrepancies: ["The provider reread found one target transition."],
      risks: ["The managed session remains stopped."],
      questions: ["Should a separately authorized action resume this work?"],
      result: "reanchored_without_resume"
    });
    assert.equal(completed.receipt?.result, "reanchored_without_resume");
    const repeated = await coordinator.apply(created.request.id);
    assert.equal(repeated.receipt?.id, completed.receipt?.id);
    assert.equal(effects, 1, "an idempotent repeat must never replay the provider effect");
    assert.equal((await coordinator.request(request())).request.id, created.request.id);
  });
});

test("provider Re-anchor request decoding is closed, artifact-bound, and rejects target or report-material substitution", async () => {
  await withStore(async (store) => {
    let captured: ReanchorApplyRequest | undefined;
    const coordinator = new DurableReanchorCoordinator(store, dependencies({
      applier: { async apply(input) { captured = input; return committed(input, "canonical-request-effect", "Canonical request accepted."); } }
    }), { clock: () => baseNow });
    const created = await coordinator.request(request());
    await reviewAndConfirm(coordinator, created.request.id);
    await coordinator.apply(created.request.id);
    assert.ok(captured);
    const wire = JSON.parse(JSON.stringify(captured)) as Record<string, unknown>;
    assert.deepEqual(canonicalReanchorApplyRequest(wire), captured);
    assert.throws(() => canonicalReanchorApplyRequest({ ...wire, callerSelectedRoute: "provider.health" }), /closed|malformed/i);
    assert.throws(() => canonicalReanchorApplyRequest({ ...wire, newTargetSnapshotId: oldTarget.id }), /target|binding|artifact/i);
    assert.throws(() => canonicalReanchorApplyRequest({ ...wire, confirmationScopeDigest: "0".repeat(64) }), /artifact|binding|scope/i);
    assert.throws(() => canonicalReanchorApplyRequest({ ...wire, requiredRereads: ["current_work"] }), /reread|artifact|binding/i);
  });
});

test("restart preserves pending work and two consumers cannot both execute it", async () => {
  await withStore(async (store) => {
    let effects = 0;
    let releaseEffect!: () => void;
    const effectGate = new Promise<void>((resolve) => { releaseEffect = resolve; });
    const shared = dependencies({
      applier: {
        async apply(input) {
          effects += 1;
          await effectGate;
          return committed(input, "single-consumer-effect", "Committed once.");
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
      applier: { async apply(input) { effects += 1; return committed(input, "possibly-committed-effect", "Provider replied committed."); } }
    }), {
      clock: () => baseNow,
      lifecycleProbe(phase: ReanchorLifecyclePhase) { if (phase === "external_effect_returned") throw new Error("simulated process loss"); }
    });
    const created = await crashing.request(request());
    await reviewAndConfirm(crashing, created.request.id);
    await assert.rejects(() => crashing.apply(created.request.id), /simulated process loss/);
    assert.equal((await crashing.get(created.request.id))?.state, "executing");

    const restarted = new DurableReanchorCoordinator(store, dependencies({
      applier: { async apply(input) { effects += 1; return committed(input, "replayed", "must not run"); } }
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
      applier: { async apply(input) { effects += 1; return committed(input, "durable-provider-effect", "Committed."); } }
    }), {
      clock: () => baseNow,
      lifecycleProbe(phase) { if (phase === "external_committed_persisted") throw new Error("crash before receipt"); }
    });
    const created = await crashing.request(request());
    await reviewAndConfirm(crashing, created.request.id);
    await assert.rejects(() => crashing.apply(created.request.id), /crash before receipt/);
    assert.equal((await crashing.get(created.request.id))?.state, "external_committed");

    const restarted = new DurableReanchorCoordinator(store, dependencies({
      applier: { async apply(input) { effects += 1; return committed(input, "replayed", "must not run"); } }
    }), { clock: () => "2026-08-25T12:00:30.000Z" });
    const recovered = await restarted.recover();
    const completed = recovered.find((item) => item.request.id === created.request.id);
    assert.equal(completed?.state, "recorded");
    assert.equal(completed?.receipt?.externalEffectId, "durable-provider-effect");
    assert.equal(completed?.receipt?.createdAt, baseNow, "receipt material is deterministic from the durable external-commit marker, not recovery time");
    assert.equal(effects, 1);
  });
});

test("a crash after the session CAS recovers the exact rebind without replaying the provider effect", async () => {
  await withStore(async (store) => {
    let effects = 0;
    const shared = dependencies({
      applier: { async apply(input) { effects += 1; return committed(input, "provider-effect-before-cas-crash", "Committed exactly once."); } }
    });
    const crashing = new DurableReanchorCoordinator(store, shared, {
      clock: () => baseNow,
      lifecycleProbe(phase) { if (phase === "session_compare_and_swap_returned") throw new Error("crash after session CAS"); }
    });
    const created = await crashing.request(request());
    await reviewAndConfirm(crashing, created.request.id);
    await assert.rejects(() => crashing.apply(created.request.id), /crash after session CAS/);
    assert.equal((await crashing.get(created.request.id))?.state, "external_committed");

    const restarted = new DurableReanchorCoordinator(store, shared, { clock: () => "2026-08-25T12:00:30.000Z" });
    const recovered = (await restarted.recover()).find((item) => item.request.id === created.request.id);
    assert.equal(recovered?.state, "recorded");
    assert.equal(recovered?.receipt?.sessionRebindOutcome, "already_rebound");
    assert.equal(recovered?.receipt?.resumed, false);
    assert.equal(effects, 1);
  });
});

test("legacy committed journals become visible ambiguity and never replay or invent a protected rebind", async () => {
  await withStore(async (store) => {
    let effects = 0;
    const coordinator = new DurableReanchorCoordinator(store, dependencies({
      applier: { async apply(input) { effects += 1; return committed(input, "must-not-run", "must not run"); } }
    }), {
      clock: () => baseNow,
      lifecycleProbe(phase) { if (phase === "executing_persisted") throw new Error("legacy journal seam"); }
    });
    const created = await coordinator.request(request());
    await reviewAndConfirm(coordinator, created.request.id);
    await assert.rejects(() => coordinator.apply(created.request.id), /legacy journal seam/);
    await store.append("reanchor.external_committed", {
      event: "external_committed",
      requestId: created.request.id,
      effect: {
        version: 1,
        requestId: created.request.id,
        operationId: created.request.operationId,
        externalEffectId: "legacy-provider-effect",
        summary: "Legacy provider reported a commit.",
        committedAt: baseNow
      }
    });
    await store.append("reanchor.recorded", {
      event: "recorded",
      requestId: created.request.id,
      receipt: {
        version: 1,
        id: `reanchor-receipt:${sha256(created.request.id)}`,
        requestId: created.request.id,
        operationId: created.request.operationId,
        oldTargetSnapshotId: oldTarget.id,
        newTargetSnapshotId: newTarget.id,
        sessionId: session.id,
        authorityId: authority.id,
        previewDigest: (await coordinator.get(created.request.id))?.preview?.previewDigest,
        confirmationDigest: (await coordinator.get(created.request.id))?.confirmation?.confirmationTokenDigest,
        externalEffectId: "legacy-provider-effect",
        evidenceDigest: "0".repeat(64),
        result: "reanchored",
        createdAt: baseNow
      }
    });

    const restarted = new DurableReanchorCoordinator(store, dependencies({
      applier: { async apply(input) { effects += 1; return committed(input, "replayed", "must not run"); } }
    }), { clock: () => "2026-08-25T12:00:30.000Z" });
    const recovered = (await restarted.recover()).find((item) => item.request.id === created.request.id);
    assert.equal(recovered?.state, "ambiguous");
    assert.match(recovered?.summary ?? "", /legacy|manual reconciliation/i);
    assert.equal(recovered?.receipt, undefined);
    assert.equal(effects, 0);
  });
});

test("provider acknowledgement summaries are redacted before durable persistence", async () => {
  await withStore(async (store) => {
    const secret = "ghp_1234567890abcdefghijklmnopqrstuvwxyzABCD";
    const coordinator = new DurableReanchorCoordinator(store, dependencies({
      applier: {
        async apply(input) {
          const outcome = committed(input, "redacted-provider-effect", `Provider echoed ${secret} for person@example.com`);
          return {
            ...outcome,
            acknowledgement: {
              ...outcome.acknowledgement,
              report: {
                ...outcome.acknowledgement.report,
                discrepancies: [`Credential ${secret} changed.`],
                risks: ["Contact person@example.com"],
                questions: [`Reuse ${secret}?`]
              }
            }
          };
        }
      }
    }), { clock: () => baseNow });
    const created = await coordinator.request(request());
    await reviewAndConfirm(coordinator, created.request.id);
    const completed = await coordinator.apply(created.request.id);
    assert.equal(completed.state, "recorded");
    assert.doesNotMatch(JSON.stringify(await store.readEntries()), new RegExp(secret));
    assert.doesNotMatch(completed.externalEffect?.summary ?? "", /person@example\.com/);
    assert.match(completed.externalEffect?.summary ?? "", /REDACTED/);
    assert.doesNotMatch(JSON.stringify(completed.receipt?.report), /person@example\.com/);
    assert.match(JSON.stringify(completed.receipt?.report), /REDACTED/);
  });
});

test("stale target, authority, session anchor, containment epoch, or effect guard rejects before apply", async () => {
  const cases: readonly [string, Partial<ReanchorCoordinatorDependencies>][] = [
    ["snapshot", { snapshots: { async isCurrent() { return false; } } }],
    ["authority", { authorities: { async get() { return { ...authority, revokedAt: baseNow }; } } }],
    ["session", { sessions: {
      async get() { return { ...session, targetSnapshotId: newTarget.id }; },
      async compareAndSwapTarget() { return { outcome: "unknown", reason: "The session binding changed." }; }
    } }],
    ["fence", { containment: { async inspect() { return { allowed: true, fenceEpoch: 8, reason: "Fence generation changed." }; } } }],
    ["effect guard", { effectGuard: { async assertCurrent() { return { allowed: false, reason: "Final target changed." }; } } }]
  ];
  for (const [label, override] of cases) {
    await withStore(async (store) => {
      let effects = 0;
      const stable = dependencies({ applier: { async apply(input) { effects += 1; return committed(input, "must-not-run", "must not run"); } } });
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
      applier: { async apply(input) { effects += 1; return committed(input, "must-not-run", "must not run"); } }
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
      applier: { async apply(input) { effects += 1; return committed(input, "must-not-run", "must not run"); } }
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
      applier: { async apply(input) { effects += 1; return committed(input, "real-confirmed-effect", "Applied once."); } }
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

test("a provider acknowledgement must echo both exact targets and cannot claim automatic resume", async () => {
  await withStore(async (store) => {
    let rebinds = 0;
    const coordinator = new DurableReanchorCoordinator(store, dependencies({
      sessions: {
        async get() { return session; },
        async compareAndSwapTarget() { rebinds += 1; return { outcome: "rebound", reason: "must not run", session: { ...session, targetSnapshotId: newTarget.id, status: "unknown" } }; }
      },
      applier: {
        async apply(input) {
          const accepted = committed(input, "malformed-provider-ack", "Provider claimed success.");
          return {
            ...accepted,
            acknowledgement: {
              ...accepted.acknowledgement,
              newTargetSnapshotId: "0".repeat(64),
              resumed: true
            }
          } as never;
        }
      }
    }), { clock: () => baseNow });
    const created = await coordinator.request(request());
    await reviewAndConfirm(coordinator, created.request.id);
    const result = await coordinator.apply(created.request.id);
    assert.equal(result.state, "ambiguous", "a response after dispatch that changes either target or resume state cannot be trusted");
    assert.equal(rebinds, 0);
    assert.equal(result.receipt, undefined);
  });
});

test("a stop-only provider acknowledgement cannot impersonate the required context reread and work inspection", async () => {
  await withStore(async (store) => {
    let rebinds = 0;
    const coordinator = new DurableReanchorCoordinator(store, dependencies({
      sessions: {
        async get() { return session; },
        async compareAndSwapTarget() { rebinds += 1; return { outcome: "unknown", reason: "must not run" }; }
      },
      applier: {
        async apply(input) {
          return {
            disposition: "committed",
            acknowledgement: {
              schema: "sxsy-b122.reanchor-acknowledgement",
              version: 1,
              requestId: input.requestId,
              operationId: input.operationId,
              externalEffectId: "stop-only-effect",
              sessionId: input.sessionId,
              authorityId: input.authorityId,
              oldTargetSnapshotId: input.oldTargetSnapshotId,
              newTargetSnapshotId: input.newTargetSnapshotId,
              cooperativeStopAcknowledged: true,
              resumed: false,
              report: {
                summary: "Stopped.", discrepancies: [], risks: [], questions: [], result: "reanchored_without_resume"
              }
            }
          } as never;
        }
      }
    }), { clock: () => baseNow });
    const created = await coordinator.request(request());
    await reviewAndConfirm(coordinator, created.request.id);
    const result = await coordinator.apply(created.request.id);
    assert.equal(result.state, "ambiguous");
    assert.equal(rebinds, 0);
    assert.equal(result.receipt, undefined);
  });
});

test("an uncertain session compare-and-swap records ambiguity after provider commit and never reports re-anchored", async () => {
  await withStore(async (store) => {
    let effects = 0;
    let rebinds = 0;
    const coordinator = new DurableReanchorCoordinator(store, dependencies({
      sessions: {
        async get() { return session; },
        async compareAndSwapTarget() { rebinds += 1; return { outcome: "unknown", reason: "The protected binding changed before CAS." }; }
      },
      applier: { async apply(input) { effects += 1; return committed(input, "provider-effect-before-cas", "Provider acknowledged the exact report."); } }
    }), { clock: () => baseNow });
    const created = await coordinator.request(request());
    await reviewAndConfirm(coordinator, created.request.id);
    const result = await coordinator.apply(created.request.id);
    assert.equal(result.state, "ambiguous");
    assert.equal(result.receipt, undefined);
    assert.equal(effects, 1);
    assert.equal(rebinds, 1);
    assert.equal((await coordinator.apply(created.request.id)).state, "ambiguous");
    assert.equal(effects, 1, "CAS uncertainty is reconciliation-only and cannot replay the provider effect");
  });
});

test("post-effect target churn prevents session rebinding and leaves reconciliation-visible ambiguity", async () => {
  await withStore(async (store) => {
    let current = true;
    let effects = 0;
    let rebinds = 0;
    const coordinator = new DurableReanchorCoordinator(store, dependencies({
      snapshots: { async isCurrent() { return current; } },
      sessions: {
        async get() { return session; },
        async compareAndSwapTarget() { rebinds += 1; return { outcome: "unknown", reason: "must not run" }; }
      },
      applier: {
        async apply(input) {
          effects += 1;
          current = false;
          return committed(input, "provider-effect-before-target-churn", "Provider stopped and reported before the target changed.");
        }
      }
    }), { clock: () => baseNow });
    const created = await coordinator.request(request());
    await reviewAndConfirm(coordinator, created.request.id);
    const result = await coordinator.apply(created.request.id);
    assert.equal(result.state, "ambiguous");
    assert.equal(effects, 1);
    assert.equal(rebinds, 0, "a post-effect final-target failure must not rebind the protected session");
    assert.equal(result.receipt, undefined);
    assert.equal((await coordinator.apply(created.request.id)).state, "ambiguous");
    assert.equal(effects, 1);
  });
});

test("a CAS replay with correct markers but changed task binding cannot produce a Re-anchor receipt", async () => {
  await withStore(async (store) => {
    const coordinator = new DurableReanchorCoordinator(store, dependencies({
      sessions: {
        async get() { return session; },
        async compareAndSwapTarget(input) {
          return {
            outcome: "already_rebound",
            reason: "A changed binding attempted to reuse the operation markers.",
            session: {
              ...session,
              taskId: "substituted-task",
              targetSnapshotId: input.newTargetSnapshotId,
              status: "unknown",
              metadata: {
                ...session.metadata,
                "sxsy-b122.reanchor.operationId": input.operationId,
                "sxsy-b122.reanchor.oldTargetSnapshotId": input.oldTargetSnapshotId,
                "sxsy-b122.reanchor.newTargetSnapshotId": input.newTargetSnapshotId,
                "sxsy-b122.reanchor.resumeAuthorized": "false"
              }
            }
          };
        }
      },
      applier: { async apply(input) { return committed(input, "provider-effect-before-binding-substitution", "Provider acknowledged the exact report."); } }
    }), { clock: () => baseNow });
    const created = await coordinator.request(request());
    await reviewAndConfirm(coordinator, created.request.id);
    const result = await coordinator.apply(created.request.id);
    assert.equal(result.state, "ambiguous");
    assert.equal(result.receipt, undefined);
    assert.match(result.summary ?? "", /mismatched binding|unknown/i);
  });
});

test("provider not-started and ambiguous summaries are redacted before terminal journal persistence", async () => {
  for (const disposition of ["not_started", "ambiguous"] as const) {
    await withStore(async (store) => {
      const secret = `ghp_${disposition}1234567890abcdefghijklmnopqrstuvwxyz`;
      const coordinator = new DurableReanchorCoordinator(store, dependencies({
        applier: { async apply() { return { disposition, summary: `Provider leaked ${secret} and person@example.com` }; } }
      }), { clock: () => baseNow });
      const created = await coordinator.request(request());
      await reviewAndConfirm(coordinator, created.request.id);
      const result = await coordinator.apply(created.request.id);
      assert.equal(result.state, disposition === "not_started" ? "rejected" : "ambiguous");
      const journal = JSON.stringify(await store.readEntries());
      assert.doesNotMatch(journal, new RegExp(secret));
      assert.doesNotMatch(journal, /person@example\.com/);
      assert.match(result.summary ?? "", /REDACTED/);
    });
  }
});

test("untrusted read-only preview text is redacted before it enters the protected journal", async () => {
  await withStore(async (store) => {
    const secret = "ghp_preview1234567890abcdefghijklmnopqrstuvwxyz";
    const coordinator = new DurableReanchorCoordinator(store, dependencies({
      previewer: {
        async preview() {
          return {
            summary: `Preview echoed ${secret}`,
            discrepancies: ["Contact person@example.com"],
            risks: [`token=${secret}`],
            questions: ["Proceed without exposing the value?"],
            contextEvidence: contextEvidence()
          };
        }
      }
    }), { clock: () => baseNow });
    const created = await coordinator.request(request());
    const preview = await coordinator.preview(created.request.id);
    const journal = JSON.stringify(await store.readEntries());
    assert.doesNotMatch(journal, new RegExp(secret));
    assert.doesNotMatch(journal, /person@example\.com/);
    assert.match(preview.summary, /REDACTED/);
    assert.match(preview.discrepancies[0] ?? "", /REDACTED/);
  });
});
