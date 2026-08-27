import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { AuthorityLedger } from "../../../packages/control-plane/src/authority.ts";
import { commandForAction } from "../../../packages/control-plane/src/command-catalog.ts";
import type { ManagedSession, TargetSnapshot } from "../../../packages/control-plane/src/contracts.ts";
import { SessionRegistry } from "../../../packages/control-plane/src/session-registry.ts";
import { ProtectedJsonStore, sha256, stableJson } from "../../../packages/control-plane/src/store.ts";
import { WorkflowCoordinatorContextStore, type CoordinatorEvidenceBundle } from "../../../packages/control-plane/src/workflow-artifacts.ts";
import type { ConfiguredProviderWorkflowContextObservation } from "../src/configured-provider-host.ts";
import { InstalledWorkflowContextPreparationCoordinator } from "../src/workflow-context-preparation.ts";

const targetId = "a".repeat(64);
const repositoryRoot = "C:\\repo";
const session: ManagedSession = {
  id: "codex-session", provider: "codex", surface: "bridge", capabilities: ["registered", "observable", "controllable", "mediated"],
  status: "running", workspaceRoot: repositoryRoot, targetSnapshotId: targetId, taskId: "task-1", planRevision: "plan-1",
  plannedFiles: ["src/safe.ts"], lastHeartbeat: "2026-08-25T12:00:00.000Z", adapterVersion: "codex-live-v1",
  metadata: { "sxsy-b122.providerHandshake": "exact-route-v1", "sxsy-b122.providerHandshakeTarget": targetId }
};
const target: TargetSnapshot = {
  id: targetId, repositoryRoot, branch: "feature/workflow", head: "b".repeat(40), trackedManifest: "c".repeat(64),
  untrackedManifest: "d".repeat(64), submodules: {}, policyVersion: "v1", environmentFingerprint: "e".repeat(64),
  capturedAt: "2026-08-25T12:00:00.000Z", completeness: "complete", reasons: []
};

test("installed workflow preparation records authority-neutral provider evidence and issues one exact reusable local grant", async (context) => {
  const fixture = await setup(context);
  const coordinator = new InstalledWorkflowContextPreparationCoordinator({
    provider: { async observeWorkflowContext() { return observation(); } },
    contexts: fixture.contexts, authorities: fixture.authorities, sessions: fixture.sessions,
    targets: { async resolve() { fixture.resolutions += 1; return target; } },
    now: () => new Date("2026-08-25T12:00:00.000Z")
  });

  const first = await coordinator.prepare({ definition: commandForAction("proof"), target, session, operator: "DOMAIN\\operator" });
  const second = await coordinator.prepare({ definition: commandForAction("proof"), target, session, operator: "DOMAIN\\operator" });
  assert.equal(second.id, first.id);
  assert.deepEqual(first.allowedActions, ["proof", "authority_refresh", "authority_broadcast"]);
  assert.equal((await fixture.authorities.list()).length, 1);
  assert.ok(fixture.resolutions >= 4);

  const protectedContext = await fixture.contexts.current(session.id, target.id);
  assert.equal(protectedContext?.authorityId, first.id);
  assert.equal(protectedContext?.sourceRevision, 7);
  assert.deepEqual(protectedContext?.provenance, {
    provider: "codex", contextId: "context-7", observedAt: "2026-08-25T12:00:01.000Z",
    adapterId: "installed.codex", adapterVersion: "codex-live-v1", moduleSha256: "f".repeat(64),
    providerContextDigest: "8".repeat(64), envelopeDigest: "9".repeat(64)
  });
});

test("Authority Refresh reuses existing protected authority and never mints authority from provider pending-request data", async (context) => {
  const fixture = await setup(context);
  let observed = observation();
  const coordinator = new InstalledWorkflowContextPreparationCoordinator({
    provider: { async observeWorkflowContext() { return observed; } },
    contexts: fixture.contexts, authorities: fixture.authorities, sessions: fixture.sessions,
    targets: { async resolve() { return target; } }, now: () => new Date("2026-08-25T12:00:00.000Z")
  });
  const original = await coordinator.prepare({ definition: commandForAction("proof"), target, session, operator: "operator" });
  const refreshed = await coordinator.prepare({ definition: commandForAction("authority_refresh"), target, session, operator: "operator" });
  assert.equal(refreshed.id, original.id);
  assert.equal((await fixture.authorities.list()).length, 1);

  observed = { ...observation(), sourceRevision: 8, contextId: "context-8", contextDigest: "7".repeat(64), envelopeDigest: "6".repeat(64), pendingRequest: { ...observation().pendingRequest!, action: "plan_approval" } };
  await assert.rejects(() => coordinator.prepare({ definition: commandForAction("authority_refresh"), target, session, operator: "operator" }), /pending action|existing protected (?:authority|context)/i);
  assert.equal((await fixture.authorities.list()).length, 1);
});

test("installed workflow preparation revokes newly issued authority when the final target changes", async (context) => {
  const fixture = await setup(context);
  let resolution = 0;
  const coordinator = new InstalledWorkflowContextPreparationCoordinator({
    provider: { async observeWorkflowContext() { return observation(); } },
    contexts: fixture.contexts, authorities: fixture.authorities, sessions: fixture.sessions,
    targets: { async resolve() { resolution += 1; return resolution < 3 ? target : { ...target, id: "0".repeat(64) }; } },
    now: () => new Date("2026-08-25T12:00:00.000Z")
  });
  await assert.rejects(() => coordinator.prepare({ definition: commandForAction("proof"), target, session, operator: "operator" }), /target changed/i);
  const grants = await fixture.authorities.list();
  assert.equal(grants.length, 1);
  assert.ok(grants[0]?.revokedAt);
  const recorded = await fixture.contexts.current(session.id, target.id);
  assert.equal(recorded?.authorityId, grants[0]?.id);
});

test("Plan Approval review binds the exact plan and refuses provider-context churn before the single confirmation", async (context) => {
  const fixture = await setup(context);
  let observed = observation();
  const coordinator = new InstalledWorkflowContextPreparationCoordinator({
    provider: { async observeWorkflowContext() { return observed; } },
    contexts: fixture.contexts, authorities: fixture.authorities, sessions: fixture.sessions,
    targets: { async resolve() { return target; } }, now: () => new Date("2026-08-25T12:00:00.000Z")
  });
  const definition = commandForAction("plan_approval");
  const review = await coordinator.review({ definition, target, session });
  assert.match(review.summary, new RegExp(observation().evidence.plan.digest));
  assert.match(review.summary, new RegExp(`${target.id} -> ${target.id} \\(unchanged\\)`));
  assert.match(review.scopeDigest, /^[a-f0-9]{64}$/);
  const authority = await coordinator.prepare({ definition, target, session, operator: "operator", review });
  assert.equal(authority.allowedActions.includes("plan_approval"), true);

  const fixtureChanged = await setup(context);
  observed = observation();
  const changedCoordinator = new InstalledWorkflowContextPreparationCoordinator({
    provider: { async observeWorkflowContext() { return observed; } },
    contexts: fixtureChanged.contexts, authorities: fixtureChanged.authorities, sessions: fixtureChanged.sessions,
    targets: { async resolve() { return target; } }, now: () => new Date("2026-08-25T12:00:00.000Z")
  });
  const staleReview = await changedCoordinator.review({ definition, target, session });
  observed = { ...observation(), sourceRevision: 8, contextId: "context-8", contextDigest: "7".repeat(64), envelopeDigest: "6".repeat(64) };
  await assert.rejects(() => changedCoordinator.prepare({ definition, target, session, operator: "operator", review: staleReview }), /changed after review/i);
  assert.equal((await fixtureChanged.authorities.list()).length, 0);
});

async function setup(context: test.TestContext) {
  const directory = await mkdtemp(join(tmpdir(), "b122-workflow-preparation-"));
  context.after(async () => rm(directory, { recursive: true, force: true }));
  const store = new ProtectedJsonStore({ filePath: join(directory, "journal.jsonl") });
  const sessions = new SessionRegistry(store, { clock: () => "2026-08-25T12:00:00.000Z" });
  await sessions.upsert(session);
  const authorities = new AuthorityLedger(store, {
    clock: () => "2026-08-25T12:00:00.000Z",
    idFactory: (() => { let value = 0; return () => `authority-${++value}`; })()
  });
  return { store, sessions, authorities, contexts: new WorkflowCoordinatorContextStore(store), resolutions: 0 };
}

function observation(): ConfiguredProviderWorkflowContextObservation {
  const evidence = coordinatorEvidence();
  return {
    schema: "sxsy-b122.provider-workflow-context-observation", version: 1,
    sessionId: session.id, provider: "codex", targetSnapshotId: target.id, repositoryRoot, branch: target.branch!, head: target.head!,
    taskId: session.taskId!, planRevision: session.planRevision!, requestNonce: "1".repeat(64), contextId: "context-7", sourceRevision: 7,
    plannedFiles: session.plannedFiles, resources: [], dependencies: [], diffDigest: evidence.diff.digest,
    evidence, pendingDecisions: [{ id: "decision-1", question: "Which exact option?", context: "Current reviewed plan." }],
    pendingRequest: { requestId: "pending-1", targetSnapshotId: target.id, planRevision: session.planRevision!, planDigest: evidence.plan.digest, action: "proof" },
    adapter: { id: "installed.codex", version: "codex-live-v1", moduleSha256: "f".repeat(64) },
    contextDigest: "8".repeat(64), observedAt: "2026-08-25T12:00:01.000Z", envelopeDigest: "9".repeat(64)
  };
}

function coordinatorEvidence(): CoordinatorEvidenceBundle {
  const planMaterial = {
    revision: "plan-1", originSessionId: session.id, taskId: "task-1", objective: "Finish exact workflow preparation.",
    steps: [{ id: "step-1", summary: "Implement exact path", ownedFiles: ["src/safe.ts"], dependencies: [], status: "approved" as const }],
    decisions: ["Use the protected local coordinator."],
    expectedTargetTransition: { beforeTargetSnapshotId: target.id, expectedAfterTargetSnapshotId: target.id, expectation: "unchanged" as const }
  };
  const plan = { digest: sha256(stableJson(planMaterial)), ...planMaterial };
  const material = {
    instructions: [{ id: "instructions", digest: "1".repeat(64), source: "protected_context" as const, summary: "Accepted instructions." }],
    plan,
    documentation: [{ id: "spec", digest: "2".repeat(64), source: "repository" as const, summary: "Accepted specification." }],
    diff: { id: "diff", digest: "3".repeat(64), source: "target_snapshot" as const, summary: "Exact diff." },
    files: [{ id: "src", digest: "4".repeat(64), source: "repository" as const, summary: "Relevant file." }],
    tests: [{ id: "tests", digest: "5".repeat(64), source: "receipt" as const, summary: "Isolated tests.", status: "passed" as const }]
  };
  return { contextDigest: sha256(stableJson(material)), ...material };
}
