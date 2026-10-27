import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { InMemoryCommandAdapter, AdapterRegistry } from "../src/adapters.ts";
import { InMemoryExecutionBroker, InMemoryGitBroker } from "../src/brokers.ts";
import { commandForAction } from "../src/command-catalog.ts";
import type { ManagedSession, TargetSnapshot } from "../src/contracts.ts";
import { AuthorityLedger } from "../src/authority.ts";
import { AllowlistedEvidenceAuthorizer, GateEvidenceLedger } from "../src/acceptance-evidence.ts";
import { DurableBudgetManager } from "../src/budgets.ts";
import { containmentReleaseScopeDigest, DurableContainmentManager } from "../src/containment.ts";
import { containmentIncidentReviewDigest } from "../src/containment-incidents.ts";
import { DurableMediatedExecutor, type OperationControllerObservation, type OperationReconciliationBinding } from "../src/runtime.ts";
import { SessionRegistry } from "../src/session-registry.ts";
import { targetSnapshotDigest } from "../src/snapshot.ts";
import { ProtectedJsonStore, sha256, stableJson } from "../src/store.ts";

const now = new Date(Date.now() + 60 * 60_000).toISOString();
const authorityExpiry = new Date(Date.parse(now) + 24 * 60 * 60_000).toISOString();
const oneSecondAfterNow = new Date(Date.parse(now) + 1_000).toISOString();
const targetMaterial = {
  repositoryRoot: "C:/work/example", canonicalRemote: "https://github.com/example/repo.git",
  branch: "feature/runtime", upstream: "origin/feature/runtime", head: "abc", indexTree: "tree",
  trackedManifest: "tracked", untrackedManifest: "untracked", submodules: {}, policyVersion: "policy-runtime",
  environmentFingerprint: "env", completeness: "complete" as const, reasons: [] as readonly string[]
};
const target: TargetSnapshot = {
  id: targetSnapshotDigest(targetMaterial), ...targetMaterial, capturedAt: now
};

async function withStore(run: (store: ProtectedJsonStore) => Promise<void>): Promise<void> {
  const directory = await mkdtemp(join(tmpdir(), "sxsy-b122-runtime-test-"));
  try {
    await run(new ProtectedJsonStore({ filePath: join(directory, "protected.jsonl"), clock: () => now }));
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
}

async function reviewedLocalCommitToken(runtime: DurableMediatedExecutor, selected: ManagedSession, authorityId: string, selectedTarget: TargetSnapshot): Promise<string> {
  return (await runtime.confirmations.issue({
    action: "local_commit",
    targetSnapshotId: selectedTarget.id,
    sessionId: selected.id,
    authorityId,
    reason: "isolated reviewed local commit",
    reauthenticated: true
  })).token;
}

/**
 * Deadline callbacks intentionally launch a durable cancellation sequence
 * without holding a host timer callback open.  Poll only isolated in-process
 * state so this test proves the asynchronous sequence, not timer timing.
 */
async function eventually(assertion: () => void | Promise<void>, timeoutMs = 1_000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  let lastError: unknown;
  while (Date.now() <= deadline) {
    try {
      await assertion();
      return;
    } catch (error) {
      lastError = error;
      await new Promise((resolveDelay) => setTimeout(resolveDelay, 5));
    }
  }
  throw lastError ?? new Error("Timed out waiting for the isolated deadline assertion.");
}

async function startRunningProof(
  store: ProtectedJsonStore,
  observe: (binding: OperationReconciliationBinding) => Promise<OperationControllerObservation>
) {
  const sessions = new SessionRegistry(store, { clock: () => now });
  const session = await sessions.register({
    id: "session-reconcile", provider: "codex", surface: "vscode_terminal", capabilities: ["registered", "observable", "controllable", "mediated"],
    status: "running", workspaceRoot: target.repositoryRoot, targetSnapshotId: target.id, taskId: "task-reconcile", planRevision: "plan-reconcile",
    plannedFiles: ["src/safe.ts"], adapterVersion: "trusted-adapter", metadata: {}
  });
  const authorities = new AuthorityLedger(store, { clock: () => now });
  const authority = await authorities.issue({
    repositoryRoot: target.repositoryRoot, sessionId: session.id, taskId: session.taskId, planRevision: session.planRevision,
    allowedActions: ["proof"], prohibitedActions: [], expiresAt: authorityExpiry, issuedBy: "authenticated-user"
  });
  const adapters = new AdapterRegistry();
  const proof = new InMemoryCommandAdapter();
  proof.register("proof", async () => ({
    status: "running",
    summary: "The exact proof child committed and is awaiting its terminal supervisor result.",
    effectDisposition: "committed"
  }));
  adapters.register("proof", proof);
  let cancelledSchedules = 0;
  let observations = 0;
  const runtime = new DurableMediatedExecutor({
    store, sessions, authorities, policyVersion: "policy-runtime", now: () => new Date(now), targetResolver: { resolve: async () => target },
    deadlineScheduler: { schedule: () => ({ cancel: () => { cancelledSchedules += 1; } }) },
    operationControl: {
      cancel: async () => ({ accepted: true, summary: "exact cancellation delivered" }),
      observe: async (binding) => { observations += 1; return observe(binding); }
    },
    dependencies: () => ({ adapters })
  });
  const assignment = commandForAction("proof").assignment!;
  const started = await runtime.execute({ assignment, control: assignment.control, modifier: assignment.modifier, sessionId: session.id, authorityId: authority.id });
  assert.equal(started.status, "running");
  assert.ok(started.operationId);
  return { runtime, started, cancelledSchedules: () => cancelledSchedules, observations: () => observations };
}

async function startRunningExecution(
  store: ProtectedJsonStore,
  observe: (binding: OperationReconciliationBinding) => Promise<OperationControllerObservation>,
  deadlineScheduler?: Readonly<{ schedule(delayMs: number, callback: () => void): Readonly<{ cancel(): void }> }>
) {
  const sessions = new SessionRegistry(store, { clock: () => now });
  const session = await sessions.register({
    id: "session-execution-reconcile", provider: "codex", surface: "vscode_terminal", capabilities: ["registered", "observable", "controllable", "mediated"],
    status: "running", workspaceRoot: target.repositoryRoot, targetSnapshotId: target.id, taskId: "task-execution-reconcile", planRevision: "plan-execution-reconcile",
    plannedFiles: ["src/safe.ts"], adapterVersion: "trusted-adapter", metadata: {}
  });
  const authorities = new AuthorityLedger(store, { clock: () => now });
  const authority = await authorities.issue({
    repositoryRoot: target.repositoryRoot, sessionId: session.id, taskId: session.taskId, planRevision: session.planRevision,
    allowedActions: ["run_target"], prohibitedActions: [], expiresAt: authorityExpiry, issuedBy: "authenticated-user"
  });
  let cancelledSchedules = 0;
  const runtime = new DurableMediatedExecutor({
    store, sessions, authorities, policyVersion: "policy-runtime", now: () => new Date(now), targetResolver: { resolve: async () => target },
    deadlineScheduler: deadlineScheduler ?? { schedule: () => ({ cancel: () => { cancelledSchedules += 1; } }) },
    operationControl: { cancel: async () => ({ accepted: true, summary: "unused" }), observe },
    dependencies: (context) => {
      const execution = new InMemoryExecutionBroker(context.policy);
      execution.register("run_target", async () => ({ status: "running", summary: "The exact supervised execution remains live.", effectDisposition: "committed" }));
      return {
        adapters: new AdapterRegistry(),
        execution,
        executionRecipeFactory: {
          create: () => ({ id: "run_target", executable: "node", args: ["--version"], workingDirectory: target.repositoryRoot, environment: {} })
        }
      };
    }
  });
  const assignment = commandForAction("run_target").assignment!;
  const started = await runtime.execute({ assignment, control: assignment.control, modifier: assignment.modifier, sessionId: session.id, authorityId: authority.id });
  assert.equal(started.status, "running");
  assert.ok(started.operationId);
  return { runtime, started, cancelledSchedules: () => cancelledSchedules };
}

test("durable mediated executor resolves protected session/authority/target state before dispatch and records the result", async () => {
  await withStore(async (store) => {
    const sessions = new SessionRegistry(store, { clock: () => now });
    const session: ManagedSession = await sessions.register({
      id: "session-runtime", provider: "codex", surface: "vscode_terminal", capabilities: ["registered", "observable", "controllable", "mediated"],
      status: "running", workspaceRoot: target.repositoryRoot, targetSnapshotId: target.id, taskId: "task-runtime", planRevision: "plan-runtime",
      plannedFiles: ["src/safe.ts"], adapterVersion: "trusted-adapter", metadata: {}
    });
    const authorities = new AuthorityLedger(store, { clock: () => now, idFactory: () => "authority-runtime" });
    const authority = await authorities.issue({
      repositoryRoot: target.repositoryRoot, sessionId: session.id, taskId: session.taskId, planRevision: session.planRevision,
      allowedActions: ["proof"], prohibitedActions: [], expiresAt: authorityExpiry, issuedBy: "authenticated-user"
    });
    const adapters = new AdapterRegistry();
    const proofAdapter = new InMemoryCommandAdapter();
    proofAdapter.register("proof", () => ({ status: "completed", summary: "isolated proof adapter result", effectDisposition: "committed" }));
    adapters.register("proof", proofAdapter);
    const runtime = new DurableMediatedExecutor({
      store, sessions, authorities, policyVersion: "policy-runtime", now: () => new Date(now), targetResolver: { resolve: async () => target },
      dependencies: () => ({ adapters })
    });
    const proof = commandForAction("proof").assignment!;
    const result = await runtime.execute({
      assignment: proof, control: proof.control, modifier: proof.modifier, sessionId: session.id, authorityId: authority.id
    });
    assert.equal(result.status, "completed");
    assert.ok(result.operationId);
    assert.equal((await runtime.operations.get(result.operationId!))?.state, "recorded");
    assert.equal((await runtime.receipts.audits()).length, 1);
    assert.equal((await runtime.snapshots.get(target.id))?.repositoryRoot, target.repositoryRoot);

    const repair = commandForAction("repair_mission").assignment!;
    const blocked = await runtime.execute({
      assignment: repair, control: repair.control, modifier: repair.modifier, sessionId: session.id, authorityId: authority.id
    });
    assert.equal(blocked.status, "blocked");
    assert.match(blocked.summary, /authority|policy|gate|allowlist/i);
    assert.equal((await runtime.receipts.audits()).length, 2);
  });
});

test("durable runtime issues and consumes a host-attested exact-scope confirmation once", async () => {
  await withStore(async (store) => {
    const sessions = new SessionRegistry(store, { clock: () => now });
    const session = await sessions.register({
      id: "session-confirmation", provider: "codex", surface: "vscode_terminal", capabilities: ["registered", "observable", "controllable", "mediated"],
      status: "running", workspaceRoot: target.repositoryRoot, targetSnapshotId: target.id, taskId: "task-confirmation", planRevision: "plan-confirmation",
      plannedFiles: ["src/safe.ts"], adapterVersion: "trusted-adapter", metadata: {}
    });
    const authorities = new AuthorityLedger(store, { clock: () => now, idFactory: () => "authority-confirmation" });
    const authority = await authorities.issue({
      repositoryRoot: target.repositoryRoot, sessionId: session.id, taskId: session.taskId, planRevision: session.planRevision,
      allowedActions: ["proof_adversarial"], prohibitedActions: [], expiresAt: authorityExpiry, issuedBy: "authenticated-user"
    });
    const adapters = new AdapterRegistry();
    const adapter = new InMemoryCommandAdapter();
    let calls = 0;
    let confirmationDigest: string | undefined;
    adapter.register("proof_adversarial", (request) => { calls += 1; confirmationDigest = request.confirmation?.confirmationDigest; return { status: "completed", summary: "isolated adversarial proof", effectDisposition: "committed" }; });
    adapters.register("proof_adversarial", adapter);
    const runtime = new DurableMediatedExecutor({
      store, sessions, authorities, policyVersion: "policy-runtime", now: () => new Date(now), targetResolver: { resolve: async () => target },
      confirmationAttestor: { attest: async () => ({ reauthenticated: true, operator: "isolated-test-operator" }) },
      dependencies: () => ({ adapters })
    });
    const issued = await runtime.requestConfirmation({ action: "proof_adversarial", sessionId: session.id, authorityId: authority.id, reason: "Reviewed adversarial evidence request" });
    assert.equal(issued.status, "issued");
    assert.ok(issued.token);
    const assignment = commandForAction("proof_adversarial").assignment!;
    const executed = await runtime.execute({
      assignment, control: assignment.control, modifier: assignment.modifier, sessionId: session.id, authorityId: authority.id, confirmationToken: issued.token
    });
    assert.equal(executed.status, "completed");
    assert.equal(calls, 1);
    assert.equal(confirmationDigest, sha256(issued.token!));
    const replay = await runtime.execute({
      assignment, control: assignment.control, modifier: assignment.modifier, sessionId: session.id, authorityId: authority.id, confirmationToken: issued.token
    });
    assert.equal(replay.status, "blocked");
    assert.equal(calls, 1);
  });
});

test("durable runtime resolves the current protected target before a separate Council recommendation approval", async () => {
  await withStore(async (store) => {
    const sessions = new SessionRegistry(store, { clock: () => now });
    const selected = await sessions.register({
      id: "session-council-review", provider: "codex", surface: "vscode_terminal", capabilities: ["registered", "observable"],
      status: "running", workspaceRoot: target.repositoryRoot, targetSnapshotId: target.id, plannedFiles: ["src/safe.ts"],
      adapterVersion: "trusted-adapter", metadata: {}
    });
    const calls: unknown[] = [];
    const council = {
      async execute() { return { status: "unavailable" as const, summary: "not used" }; },
      async approveRecommendation(input: Readonly<Record<string, unknown>>) {
        calls.push(input);
        return {
          id: "recommendation-1", digest: "a".repeat(64), reportId: `council-report:${"b".repeat(64)}`, reportDigest: "b".repeat(64),
          repositoryRoot: target.repositoryRoot, targetSnapshotId: target.id, participantSessionIds: [selected.id], assignments: {},
          reviewScopeDigest: "d".repeat(64), preparationOperationId: "operation-prepare", ready: true, status: "approved" as const,
          approvalOperationId: "council-review:approve-1", executionAuthorized: false as const, createdAt: now, updatedAt: now
        };
      }
    };
    const runtime = new DurableMediatedExecutor({
      store, sessions, policyVersion: "policy-runtime", now: () => new Date(now), targetResolver: { resolve: async () => target },
      dependencies: () => ({ council })
    });
    const approved = await runtime.approveCouncilRecommendation({
      recommendationId: "recommendation-1", recommendationDigest: "a".repeat(64), approvalOperationId: "council-review:approve-1",
      repositoryRoot: target.repositoryRoot, targetSnapshotId: target.id, sessionId: selected.id
    });
    assert.equal(approved.status, "approved");
    assert.equal(approved.executionAuthorized, false);
    assert.equal((calls[0] as { target: TargetSnapshot }).target.id, target.id);

    await assert.rejects(runtime.approveCouncilRecommendation({
      recommendationId: "recommendation-1", recommendationDigest: "a".repeat(64), approvalOperationId: "council-review:approve-forged",
      repositoryRoot: target.repositoryRoot, targetSnapshotId: "forged-target", sessionId: selected.id
    }), /target.*changed|does not match/i);
    assert.equal(calls.length, 1);
  });
});

test("installed preparation attests one Git-root session and binds exact authority and confirmation without enabling high consequence", async () => {
  await withStore(async (store) => {
    const sessions = new SessionRegistry(store, { clock: () => now });
    const session = await sessions.register({
      id: "session-prepared", provider: "generic", surface: "vscode_window", capabilities: ["registered"],
      status: "unknown", workspaceRoot: target.repositoryRoot, taskId: "task-prepared", planRevision: "plan-prepared",
      plannedFiles: [], adapterVersion: "installed-extension", metadata: { "sxsy-b122.kind": "git-root" }
    });
    let attestations = 0;
    const runtime = new DurableMediatedExecutor({
      store, sessions, policyVersion: "policy-runtime", now: () => new Date(now), targetResolver: { resolve: async () => target },
      confirmationAttestor: { attest: async () => { attestations += 1; return { reauthenticated: true, operator: "windows-user-presence" }; } }
    });
    const prepared = await runtime.prepareCommand({ action: "local_commit", sessionId: session.id, reason: "review exact local commit" });
    assert.equal(prepared.status, "prepared");
    assert.equal(attestations, 1);
    assert.equal(prepared.session?.capabilities.includes("mediated"), true);
    assert.equal(prepared.session?.capabilities.includes("observable"), false);
    assert.ok(prepared.authorityId);
    assert.ok(prepared.confirmationToken);
    const authority = await runtime.authorities.get(prepared.authorityId!);
    assert.deepEqual(authority?.allowedActions, ["local_commit"]);
    assert.equal(authority?.repositoryRoot, target.repositoryRoot);

    const high = await runtime.prepareCommand({ action: "pr_merge", sessionId: session.id, reason: "review exact PR merge" });
    assert.equal(high.status, "prepared");
    const assignment = commandForAction("pr_merge").assignment!;
    const blocked = await runtime.execute({
      assignment, control: assignment.control, modifier: assignment.modifier, sessionId: session.id,
      authorityId: high.authorityId, confirmationToken: high.confirmationToken
    });
    assert.equal(blocked.status, "blocked", JSON.stringify(blocked));
    assert.match(blocked.summary, /high-consequence|acceptance/i);
  });
});

test("installed agent workflow preparation reuses only the protected exact authority returned by its trusted context port", async () => {
  await withStore(async (store) => {
    const sessions = new SessionRegistry(store, { clock: () => now });
    const session = await sessions.register({
      id: "session-workflow-context", provider: "codex", surface: "vscode_terminal", capabilities: ["registered", "observable", "controllable", "mediated"],
      status: "running", workspaceRoot: target.repositoryRoot, targetSnapshotId: target.id, taskId: "task-workflow", planRevision: "plan-workflow",
      plannedFiles: [], adapterVersion: "provider-host", metadata: {}
    });
    const authorities = new AuthorityLedger(store, { clock: () => now, idFactory: () => "authority-existing" });
    const existing = await authorities.issue({
      repositoryRoot: target.repositoryRoot, sessionId: session.id, taskId: session.taskId, planRevision: session.planRevision,
      allowedActions: ["option_provider"], prohibitedActions: [], expiresAt: authorityExpiry, issuedBy: "prior-reviewed-user"
    });
    let preparedContexts = 0;
    const runtime = new DurableMediatedExecutor({
      store, sessions, authorities, policyVersion: "policy-runtime", now: () => new Date(now), targetResolver: { resolve: async () => target },
      confirmationAttestor: { attest: async () => ({ reauthenticated: true, operator: "windows-user-presence" }) },
      workflowContextPreparation: {
        prepare: async ({ definition, target: selectedTarget, session: selectedSession, operator }) => {
          preparedContexts += 1;
          assert.equal(definition.action, "option_provider");
          assert.equal(selectedTarget.id, target.id);
          assert.equal(selectedSession.id, session.id);
          assert.equal(operator, "windows-user-presence");
          return existing;
        }
      }
    });
    const prepared = await runtime.prepareCommand({ action: "option_provider", sessionId: session.id, reason: "refresh exact provider context" });
    assert.equal(prepared.status, "prepared");
    assert.equal(prepared.authorityId, existing.id);
    assert.equal(preparedContexts, 1);
    assert.equal((await authorities.list()).length, 1, "workflow preparation must not mint an incompatible replacement grant");
  });
});

test("Authority Broadcast preparation returns reviewed-artifact authority without minting an unreviewed confirmation", async () => {
  await withStore(async (store) => {
    const sessions = new SessionRegistry(store, { clock: () => now });
    const session = await sessions.register({
      id: "session-authority-broadcast", provider: "codex", surface: "vscode_terminal",
      capabilities: ["registered", "observable", "controllable", "mediated"], status: "verified_blocked",
      workspaceRoot: target.repositoryRoot, targetSnapshotId: target.id, taskId: "task-authority", planRevision: "plan-authority",
      plannedFiles: [], adapterVersion: "provider-host", metadata: {}
    });
    const authorities = new AuthorityLedger(store, { clock: () => now, idFactory: () => "authority-broadcast" });
    const authority = await authorities.issue({
      repositoryRoot: target.repositoryRoot, sessionId: session.id, taskId: session.taskId, planRevision: session.planRevision,
      allowedActions: ["authority_broadcast"], prohibitedActions: [], expiresAt: authorityExpiry, issuedBy: "reviewed-user"
    });
    let ceremonies = 0;
    const runtime = new DurableMediatedExecutor({
      store, sessions, authorities, policyVersion: "policy-runtime", now: () => new Date(now), targetResolver: { resolve: async () => target },
      confirmationAttestor: { attest: async () => { ceremonies += 1; return { reauthenticated: true, operator: "windows-user-presence" }; } },
      workflowContextPreparation: { prepare: async () => authority }
    });

    const prepared = await runtime.prepareCommand({ action: "authority_broadcast", sessionId: session.id, reason: "Prepare exact recipient packets for review" });
    assert.equal(prepared.status, "incomplete");
    assert.equal(prepared.authorityId, authority.id);
    assert.equal(prepared.session?.id, session.id);
    assert.equal(prepared.confirmationToken, undefined, "recipient review must happen before a confirmation token exists");
    assert.equal(prepared.confirmationScopeDigest, undefined);
    assert.equal(ceremonies, 1);

    const forgedReviewEcho = await runtime.prepareCommand({
      action: "authority_broadcast", sessionId: session.id, reason: "Bypass the protected artifact store", reviewScopeDigest: "a".repeat(64)
    });
    assert.equal(forgedReviewEcho.status, "blocked");
    assert.match(forgedReviewEcho.summary, /protected review|plan approval|service artifact/i);
    assert.equal(ceremonies, 1, "a public review echo must fail before another user-presence ceremony");
  });
});

test("Plan Approval uses one current-user ceremony bound to the exact reviewed plan scope through final dispatch", async () => {
  await withStore(async (store) => {
    const sessions = new SessionRegistry(store, { clock: () => now });
    const session = await sessions.register({
      id: "session-plan-approval", provider: "codex", surface: "vscode_terminal", capabilities: ["registered", "observable", "controllable", "mediated"],
      status: "running", workspaceRoot: target.repositoryRoot, targetSnapshotId: target.id, taskId: "task-plan", planRevision: "plan-7",
      plannedFiles: ["src/safe.ts"], adapterVersion: "provider-host", metadata: {}
    });
    const authorities = new AuthorityLedger(store, { clock: () => now, idFactory: () => "authority-plan-approval" });
    const authority = await authorities.issue({
      repositoryRoot: target.repositoryRoot, sessionId: session.id, taskId: session.taskId, planRevision: session.planRevision,
      allowedActions: ["plan_approval"], prohibitedActions: [], expiresAt: authorityExpiry, issuedBy: "reviewed-user"
    });
    const scopeDigest = "e".repeat(64);
    const reviewSummary = "Review exact plan plan-7 (digest) and its protected provider context before execution.";
    const planMaterial = { revision: "plan-7", originSessionId: session.id, taskId: "task-plan", objective: "Execute the exact reviewed plan", steps: [{ id: "step-1", summary: "Perform exact work", ownedFiles: ["src/safe.ts"], dependencies: [] as string[], status: "approved" as const }], decisions: ["Use mediated execution."], expectedTargetTransition: { beforeTargetSnapshotId: target.id, expectedAfterTargetSnapshotId: target.id, expectation: "unchanged" as const } };
    const plan = { digest: sha256(stableJson(planMaterial)), ...planMaterial };
    const adapters = new AdapterRegistry();
    const adapter = new InMemoryCommandAdapter();
    let calls = 0;
    let trustedScope: string | undefined;
    adapter.register("plan_approval", (request) => {
      calls += 1;
      trustedScope = request.confirmation?.confirmationScopeDigest;
      return { status: "completed", summary: "exact plan dispatched", effectDisposition: "committed" };
    });
    adapters.register("plan_approval", adapter);
    const ceremonies: Array<Readonly<{ reason: string; reviewedScopeDigest?: string; reviewedScopeSummary?: string }>> = [];
    const runtime = new DurableMediatedExecutor({
      store, sessions, authorities, policyVersion: "policy-runtime", now: () => new Date(now), targetResolver: { resolve: async () => target },
      confirmationAttestor: { attest: async (input) => { ceremonies.push(input); return { reauthenticated: true, operator: "windows-user-presence" }; } },
      workflowContextPreparation: {
        review: async () => ({
          action: "plan_approval", sessionId: session.id, targetSnapshotId: target.id, repositoryRoot: target.repositoryRoot,
          provider: "codex", contextId: "provider-context-7", observedAt: now,
          adapter: { id: "provider-context", version: "1.0.0", moduleSha256: "b".repeat(64) }, plan,
          scopeDigest, providerContextDigest: "f".repeat(64), sourceRevision: 7, summary: reviewSummary
        }),
        prepare: async (input) => {
          assert.equal(input.review?.scopeDigest, scopeDigest);
          return authority;
        }
      },
      checkpointCapture: {
        capture: async () => ({
          reason: "Preserve exact reviewed plan context before execution.",
          artifacts: [{ id: "plan-review", kind: "workspace_manifest", reference: "host://checkpoint/plan-review", sha256: "a".repeat(64) }],
          recovery: { steps: ["Inspect the exact plan review before manual recovery."], artifactIds: ["plan-review"] }
        })
      },
      checkpointVerifier: { verify: async (artifact) => ({ available: true, sha256: artifact.sha256 }) },
      dependencies: () => ({ adapters })
    });
    const reviewRequired = await runtime.prepareCommand({ action: "plan_approval", sessionId: session.id, reason: "Execute approved plan" });
    assert.equal(reviewRequired.status, "incomplete");
    assert.equal(reviewRequired.workflowReview?.scopeDigest, scopeDigest);
    assert.deepEqual(reviewRequired.workflowReview?.plan.steps, plan.steps);
    assert.equal(ceremonies.length, 0, "Windows Hello must not run before trusted UI presents the exact review packet");
    const prepared = await runtime.prepareCommand({ action: "plan_approval", sessionId: session.id, reason: "Execute approved plan", reviewScopeDigest: scopeDigest });
    assert.equal(prepared.status, "prepared");
    assert.equal(prepared.confirmationScopeDigest, scopeDigest);
    assert.equal(ceremonies[0]?.reviewedScopeDigest, scopeDigest);
    assert.match(ceremonies[0]?.reviewedScopeSummary ?? "", /Review exact plan plan-7/);
    assert.equal(ceremonies[0]?.reason, "Execute approved plan");
    const assignment = commandForAction("plan_approval").assignment!;
    const base = { assignment, control: assignment.control, modifier: assignment.modifier, sessionId: session.id, authorityId: authority.id, confirmationToken: prepared.confirmationToken };
    assert.equal((await runtime.execute(base)).status, "blocked", "a scoped confirmation cannot be consumed without its protected review digest");
    assert.equal((await runtime.execute({ ...base, confirmationScopeDigest: "d".repeat(64) })).status, "blocked", "a changed plan-review scope cannot consume the token");
    const executed = await runtime.execute({ ...base, confirmationScopeDigest: scopeDigest });
    assert.equal(executed.status, "completed", JSON.stringify(executed));
    assert.equal(calls, 1);
    assert.equal(trustedScope, scopeDigest);
  });
});

test("containment release consumes a confirmation bound to the exact reviewed fence and transactionally rejects stale generations", async () => {
  await withStore(async (store) => {
    const changedMaterial = { ...targetMaterial, head: "release-target-changed" };
    const changedTarget: TargetSnapshot = { id: targetSnapshotDigest(changedMaterial), ...changedMaterial, capturedAt: now };
    let churnAtFinalReleaseGuard = false;
    let containmentReleaseResolves = 0;
    const sessions = new SessionRegistry(store, { clock: () => now });
    const session = await sessions.register({
      id: "session-containment-release", provider: "generic", surface: "vscode_window", capabilities: ["registered", "mediated"],
      status: "running", workspaceRoot: target.repositoryRoot, targetSnapshotId: target.id, taskId: "task-containment", planRevision: "plan-containment",
      plannedFiles: [], adapterVersion: "installed-extension", metadata: { "sxsy-b122.kind": "git-root" }
    });
    const gates = new GateEvidenceLedger(store, new AllowlistedEvidenceAuthorizer(["isolated-acceptance"]), {
      clock: () => now,
      artifactVerifier: { verify: async () => true }
    });
    for (const gate of [8, 20] as const) {
      await gates.record({
        id: `isolated-gate-${gate}`, gate, status: "passed", targetSnapshotId: target.id, evidenceDigest: `digest-${gate}`,
        evidenceReference: `test://gate/${gate}`, policyVersion: "policy-runtime", evaluatedBy: "isolated-acceptance", rationale: "isolated release-path test"
      });
    }
    const containment = new DurableContainmentManager(store, {
      revokeCredentialLeases: async () => undefined,
      cancelQueuedOperations: async () => undefined
    }, { clock: () => now });
    const fence = await containment.activate({
      repositoryRoot: target.repositoryRoot,
      targetSnapshotId: target.id,
      operationId: "containment-op-7",
      reason: "isolated incident"
    });
    const assessed = await containment.incidents.assess(fence.incidentId!, {
      async execute(request) {
        return {
          schema: "sxsy-b122.containment-assessment-result", version: 1, incidentId: request.incidentId,
          repositoryRoot: request.repositoryRoot, fenceEpoch: request.fenceEpoch, step: request.step,
          operationId: request.operationId, externalId: request.externalId, effectDisposition: "committed",
          status: "passed", exposure: "none", summary: "No exposure found.", findings: []
        };
      },
      async observe() { return undefined; }
    });
    const incident = await containment.incidents.recordRotationReview({
      incidentId: fence.incidentId!, expectedIncidentDigest: containmentIncidentReviewDigest(assessed), disposition: "not_required", evidenceReference: "isolated incident review", evidenceDigest: "c".repeat(64)
    });
    const runtime = new DurableMediatedExecutor({
      store, sessions, gateEvidence: gates, policyVersion: "policy-runtime", now: () => new Date(now),
      targetResolver: {
        resolve: async ({ definition }) => {
          if (definition.action !== "containment_release" || !churnAtFinalReleaseGuard) return target;
          containmentReleaseResolves += 1;
          return containmentReleaseResolves === 1 ? target : changedTarget;
        }
      },
      enabledHighConsequenceActions: ["containment_release"],
      confirmationAttestor: { attest: async () => ({ reauthenticated: true, operator: "windows-user-presence" }) },
      dependencies: () => ({ containment })
    });
    const binding = {
      expectedFenceEpoch: 1,
      expectedActivationOperationId: "containment-op-7",
      expectedIncidentId: incident.id,
      expectedIncidentDigest: containmentIncidentReviewDigest(incident)
    } as const;
    const prepared = await runtime.prepareCommand({
      action: "containment_release", sessionId: session.id, reason: "review exact fence",
      confirmationScopeDigest: containmentReleaseScopeDigest(binding)
    });
    assert.equal(prepared.status, "prepared");
    assert.ok(prepared.authorityId);
    assert.ok(prepared.confirmationToken);

    const stale = await runtime.releaseContainment({
      sessionId: session.id, authorityId: prepared.authorityId!, confirmationToken: prepared.confirmationToken!, reason: "stale",
      ...binding, expectedFenceEpoch: 2
    });
    assert.equal(stale.status, "blocked");
    assert.equal((await containment.get(target.repositoryRoot))?.active, true);

    churnAtFinalReleaseGuard = true;
    containmentReleaseResolves = 0;
    const changed = await runtime.releaseContainment({
      sessionId: session.id, authorityId: prepared.authorityId!, confirmationToken: prepared.confirmationToken!, reason: "target changed after review",
      ...binding
    });
    assert.equal(changed.status, "incomplete", JSON.stringify(changed));
    assert.match(changed.summary, /TargetSnapshot changed after admission/i);
    assert.equal(containmentReleaseResolves, 2);
    assert.equal((await containment.get(target.repositoryRoot))?.active, true);

    churnAtFinalReleaseGuard = false;
    const preparedAgain = await runtime.prepareCommand({
      action: "containment_release", sessionId: session.id, reason: "review exact fence again",
      confirmationScopeDigest: containmentReleaseScopeDigest(binding)
    });
    assert.equal(preparedAgain.status, "prepared");
    assert.ok(preparedAgain.authorityId);
    assert.ok(preparedAgain.confirmationToken);
    const released = await runtime.releaseContainment({
      sessionId: session.id, authorityId: preparedAgain.authorityId!, confirmationToken: preparedAgain.confirmationToken!, reason: "incident resolved",
      ...binding
    });
    assert.equal(released.status, "completed", JSON.stringify(released));
    assert.equal((await containment.get(target.repositoryRoot))?.active, false);
  });
});

test("agent work receives a durable deadline signal and operation-ID cancellation never guesses a process", async () => {
  await withStore(async (store) => {
    const sessions = new SessionRegistry(store, { clock: () => now });
    const session = await sessions.register({
      id: "session-cancel", provider: "codex", surface: "vscode_terminal", capabilities: ["registered", "observable", "controllable", "mediated"],
      status: "running", workspaceRoot: target.repositoryRoot, targetSnapshotId: target.id, taskId: "task-cancel", planRevision: "plan-cancel",
      plannedFiles: ["src/safe.ts"], adapterVersion: "trusted-adapter", metadata: {}
    });
    const authorities = new AuthorityLedger(store, { clock: () => now, idFactory: () => "authority-cancel" });
    const authority = await authorities.issue({
      repositoryRoot: target.repositoryRoot, sessionId: session.id, taskId: session.taskId, planRevision: session.planRevision,
      allowedActions: ["proof"], prohibitedActions: [], expiresAt: authorityExpiry, issuedBy: "authenticated-user"
    });
    const adapters = new AdapterRegistry();
    const proof = new InMemoryCommandAdapter();
    let controlSeen: boolean | undefined;
    // Use a small handler only to observe the control object; it launches no process.
    let control: { isCancellationRequested(): Promise<boolean>; deadline: string } | undefined;
    proof.register("proof", async (request) => {
      control = request.executionControl;
      controlSeen = await request.executionControl?.isCancellationRequested();
      return { status: "running", summary: "isolated agent work is awaiting provider reconciliation" };
    });
    adapters.register("proof", proof);
    let cancelCalls = 0;
    const runtime = new DurableMediatedExecutor({
      store, sessions, authorities, policyVersion: "policy-runtime", now: () => new Date(now), targetResolver: { resolve: async () => target },
      operationControl: {
        cancel: async () => { cancelCalls += 1; return { accepted: true, summary: "isolated host cancellation accepted" }; }
      },
      dependencies: () => ({ adapters })
    });
    const assignment = commandForAction("proof").assignment!;
    const started = await runtime.execute({ assignment, control: assignment.control, modifier: assignment.modifier, sessionId: session.id, authorityId: authority.id });
    assert.equal(started.status, "running");
    assert.ok(started.operationId);
    assert.ok(control?.deadline);
    assert.equal(controlSeen, false);
    const cancelled = await runtime.cancelOperation(started.operationId!, "operator cancelled isolated proof");
    assert.equal(cancelled.status, "cancelling");
    assert.equal(cancelCalls, 1);
    assert.equal(await control?.isCancellationRequested(), true);
    assert.equal((await runtime.budgets.list("proof"))[0]?.state, "cancelling");
    assert.equal((await runtime.operations.get(started.operationId!))?.state, "cancelling");
  });
});

test("a durable budget deadline invokes only the configured host cancellation adapter and leaves no retry path", async () => {
  await withStore(async (store) => {
    let clockValue = now;
    const budgets = new DurableBudgetManager(store, { clock: () => clockValue, idFactory: () => "deadline-claim" });
    const sessions = new SessionRegistry(store, { clock: () => now });
    const session = await sessions.register({
      id: "session-deadline", provider: "codex", surface: "vscode_terminal", capabilities: ["registered", "observable", "controllable", "mediated"],
      status: "running", workspaceRoot: target.repositoryRoot, targetSnapshotId: target.id, taskId: "task-deadline", planRevision: "plan-deadline",
      plannedFiles: ["src/safe.ts"], adapterVersion: "trusted-adapter", metadata: {}
    });
    const authorities = new AuthorityLedger(store, { clock: () => now, idFactory: () => "authority-deadline" });
    const authority = await authorities.issue({
      repositoryRoot: target.repositoryRoot, sessionId: session.id, taskId: session.taskId, planRevision: session.planRevision,
      allowedActions: ["proof"], prohibitedActions: [], expiresAt: authorityExpiry, issuedBy: "authenticated-user"
    });
    const adapters = new AdapterRegistry();
    const proof = new InMemoryCommandAdapter();
    let control: { isCancellationRequested(): Promise<boolean> } | undefined;
    proof.register("proof", async (request) => { control = request.executionControl; return { status: "running", summary: "isolated long agent work", effectDisposition: "committed" }; });
    adapters.register("proof", proof);
    const schedules: Array<{ callback: () => void; cancelled: boolean }> = [];
    let hostCancels = 0;
    const runtime = new DurableMediatedExecutor({
      store, sessions, authorities, budgets, policyVersion: "policy-runtime", now: () => new Date(clockValue), targetResolver: { resolve: async () => target },
      budgetConfiguration: {
        version: "deadline-test-budget", commandClasses: {
          proof: { maxConcurrent: 1, timeoutMs: 1, maxAttempts: 1, windowMs: 60_000, maxClaimsPerWindow: 1, maxCostUnitsPerWindow: 1, defaultCostUnits: 1 }
        }
      },
      deadlineScheduler: { schedule: (_delay, callback) => {
        const entry = { callback, cancelled: false };
        schedules.push(entry);
        return { cancel: () => { entry.cancelled = true; } };
      } },
      operationControl: {
        cancel: async () => { hostCancels += 1; return { accepted: true, summary: "isolated deadline cancellation accepted" }; },
        observe: async (binding) => ({
          state: "terminal", ...binding, status: "timed_out", effectDisposition: "committed",
          summary: "The exact timed-out process tree stopped, but its prior effects were not rolled back.", evidenceDigest: "8".repeat(64),
          toolVersions: { repositorySupervisor: "deadline-test-v1" }
        })
      },
      dependencies: () => ({ adapters })
    });
    const assignment = commandForAction("proof").assignment!;
    const started = await runtime.execute({ assignment, control: assignment.control, modifier: assignment.modifier, sessionId: session.id, authorityId: authority.id });
    assert.equal(started.status, "running");
    assert.ok(schedules[0]);
    clockValue = oneSecondAfterNow;
    schedules[0]!.callback();
    await eventually(() => assert.equal(hostCancels, 1));
    assert.equal(await control?.isCancellationRequested(), true);
    assert.equal((await budgets.get("deadline-claim"))?.state, "timed_out");
    assert.equal((await runtime.operations.get(started.operationId!))?.state, "cancelling");
    const [terminal] = await runtime.reconcileBudgetedOperations();
    assert.equal(terminal?.status, "timed_out");
    const deadlineBudget = await budgets.get("deadline-claim");
    const deadlineOperation = await runtime.operations.get(started.operationId!);
    assert.equal(deadlineBudget?.state, "failed", JSON.stringify({ terminal, deadlineBudget, deadlineOperation }));
    assert.equal(deadlineOperation?.state, "recorded", "a timed-out committed effect must remain terminal and non-replayable");
    assert.equal(deadlineOperation?.details.effectDisposition, "committed", "deadline termination alone cannot claim compensation of prior effects");
    assert.equal(schedules.every((entry) => entry.cancelled), true, "terminal reconciliation must release both the deadline and bounded recovery poll");
  });
});

test("an exact terminal controller observation settles the root, receipt, budget, child boundary, and control exactly once", async () => {
  await withStore(async (store) => {
    const setup = await startRunningProof(store, async (binding) => ({
      state: "terminal", ...binding, status: "completed", effectDisposition: "committed",
      summary: "The exact supervised proof process exited successfully.", evidenceDigest: "e".repeat(64),
      toolVersions: { repositorySupervisor: "job-object-v1" }
    }));
    const operationId = setup.started.operationId!;
    const before = await setup.runtime.operations.get(operationId);
    assert.equal(before?.state, "executing");
    assert.equal(before?.childIds.length, 1);
    assert.equal((await setup.runtime.operations.get(before!.childIds[0]!))?.state, "recorded", "terminal child truth must precede root settlement");

    const reconciled = await setup.runtime.reconcileBudgetedOperations();
    assert.deepEqual(reconciled, [{ operationId, status: "completed", summary: "The exact supervised proof process exited successfully." }]);
    assert.equal((await setup.runtime.operations.get(operationId))?.state, "recorded");
    assert.equal((await setup.runtime.budgets.list("proof"))[0]?.state, "completed");
    const receipts = await setup.runtime.receipts.list();
    assert.equal(receipts.length, 1);
    assert.equal(receipts[0]?.operationId, operationId);
    assert.equal(receipts[0]?.action, "proof");
    assert.equal(setup.cancelledSchedules(), 2);
    assert.equal(setup.observations(), 1);

    assert.deepEqual(await setup.runtime.reconcileBudgetedOperations(), [], "terminal recovery must not replay or re-record the process effect");
    assert.equal((await setup.runtime.receipts.list()).length, 1);
    assert.equal(setup.observations(), 1);
  });
});

test("a normal trusted external completion settles its root receipt budget and control without controller replay", async () => {
  await withStore(async (store) => {
    const setup = await startRunningExecution(store, async (binding) => ({
      state: "active", ...binding, effectDisposition: "ambiguous", summary: "The controller should not be queried for direct host completion."
    }));
    const operationId = setup.started.operationId!;
    assert.equal((await setup.runtime.operations.get(operationId))?.state, "executing");
    assert.equal((await setup.runtime.budgets.list("run_target"))[0]?.state, "running");

    const unbound = await setup.runtime.completeExternalOperation({
      operationId, action: "run_target", status: "completed",
      summary: "This acknowledgement omitted the protected target."
    });
    assert.equal(unbound.status, "blocked");
    const ambiguousFailure = await setup.runtime.completeExternalOperation({
      operationId, action: "run_target", targetSnapshotId: target.id, status: "failed",
      summary: "The host cannot prove whether the effect began."
    });
    assert.equal(ambiguousFailure.status, "incomplete");
    assert.equal((await setup.runtime.operations.get(operationId))?.state, "executing");
    assert.equal((await setup.runtime.budgets.list("run_target"))[0]?.state, "running");

    const completed = await setup.runtime.completeExternalOperation({
      operationId, action: "run_target", targetSnapshotId: target.id, status: "completed",
      summary: "The exact supervised execution exited successfully.", evidenceDigest: "7".repeat(64),
      toolVersions: { repositorySupervisor: "host-completion-v1" }
    });
    assert.equal(completed.status, "completed");
    assert.ok(completed.receiptId);
    assert.equal((await setup.runtime.operations.get(operationId))?.state, "recorded");
    assert.equal((await setup.runtime.budgets.list("run_target"))[0]?.state, "completed");
    assert.equal(setup.cancelledSchedules(), 2);
    assert.equal((await setup.runtime.receipts.list()).length, 1);

    const repeated = await setup.runtime.completeExternalOperation({
      operationId, action: "run_target", targetSnapshotId: target.id, status: "completed",
      summary: "The exact supervised execution exited successfully.", evidenceDigest: "7".repeat(64),
      toolVersions: { repositorySupervisor: "host-completion-v1" }
    });
    assert.equal(repeated.status, "completed");
    assert.equal(repeated.receiptId, completed.receiptId);
    assert.equal((await setup.runtime.receipts.list()).length, 1);
    assert.equal(setup.cancelledSchedules(), 2);

    const conflicting = await setup.runtime.completeExternalOperation({
      operationId, action: "run_target", targetSnapshotId: target.id, status: "cancelled", effectDisposition: "committed",
      summary: "A conflicting late caller tried to replace the protected successful terminal truth."
    });
    assert.equal(conflicting.status, "completed", "a conflicting replay must return the protected terminal status");
    assert.equal(conflicting.receiptId, completed.receiptId);
    assert.notEqual(conflicting.summary, "A conflicting late caller tried to replace the protected successful terminal truth.");
    assert.equal((await setup.runtime.operations.get(operationId))?.state, "recorded");
    assert.equal((await setup.runtime.budgets.list("run_target"))[0]?.state, "completed");
    assert.equal((await setup.runtime.receipts.list()).length, 1);
    assert.equal(setup.cancelledSchedules(), 2);
  });
});

test("restart keeps exact live work active, then settles the same durable root from a terminal observation without replay", async () => {
  await withStore(async (store) => {
    const live = await startRunningExecution(store, async (binding) => ({
      state: "active", ...binding, effectDisposition: "ambiguous", summary: "The exact supervisor-owned process remains live."
    }));
    const operationId = live.started.operationId!;
    const firstRecovery = await live.runtime.recoverAfterRestart();
    assert.equal(firstRecovery.budgets[0]?.status, "running");
    assert.equal((await live.runtime.operations.get(operationId))?.state, "executing");
    assert.equal((await live.runtime.budgets.list("run_target"))[0]?.state, "running");

    const restarted = new DurableMediatedExecutor({
      store, policyVersion: "policy-runtime", now: () => new Date(now), targetResolver: { resolve: async () => target },
      operationControl: {
        cancel: async () => ({ accepted: true, summary: "unused" }),
        observe: async (binding) => ({
          state: "terminal", ...binding, status: "completed", effectDisposition: "committed",
          summary: "Restart found the exact durable process terminal.", evidenceDigest: "f".repeat(64),
          toolVersions: { repositorySupervisor: "job-object-v1" }
        })
      }
    });
    const secondRecovery = await restarted.recoverAfterRestart();
    assert.equal(secondRecovery.budgets[0]?.status, "completed");
    assert.equal((await restarted.operations.get(operationId))?.state, "recorded");
    assert.equal((await restarted.budgets.list("run_target"))[0]?.state, "completed");
  });
});

test("a newly started running operation is reconciled to terminal without waiting for a companion restart", async () => {
  await withStore(async (store) => {
    let terminal = false;
    const schedules: Array<{ delayMs: number; callback: () => void; cancelled: boolean }> = [];
    const setup = await startRunningExecution(
      store,
      async (binding) => terminal
        ? {
            state: "terminal", ...binding, status: "completed", effectDisposition: "committed",
            summary: "The exact newly started process became terminal without a restart.", evidenceDigest: "5".repeat(64),
            toolVersions: { repositorySupervisor: "live-poll-test-v1" }
          }
        : { state: "active", ...binding, effectDisposition: "ambiguous", summary: "The exact newly started process remains live." },
      {
        schedule: (delayMs, callback) => {
          const entry = { delayMs, callback, cancelled: false };
          schedules.push(entry);
          return { cancel: () => { entry.cancelled = true; } };
        }
      }
    );
    const operationId = setup.started.operationId!;
    const poll = schedules.find((entry) => entry.delayMs > 0 && entry.delayMs <= 1_000);
    assert.ok(poll, "a live post-startup operation must immediately schedule bounded no-replay reconciliation");
    terminal = true;
    poll.callback();
    await eventually(async () => {
      assert.equal((await setup.runtime.operations.get(operationId))?.state, "recorded");
      assert.equal((await setup.runtime.budgets.list("run_target"))[0]?.state, "completed");
    });
    assert.equal((await setup.runtime.receipts.list()).length, 1);
  });
});

test("restart rebinds deadlines and performs bounded no-replay reconciliation until exact live work becomes terminal", async () => {
  await withStore(async (store) => {
    const live = await startRunningExecution(store, async (binding) => ({
      state: "active", ...binding, effectDisposition: "ambiguous", summary: "The original runtime still sees exact live work."
    }));
    const operationId = live.started.operationId!;
    let terminal = false;
    const schedules: Array<{ delayMs: number; callback: () => void; cancelled: boolean }> = [];
    const restarted = new DurableMediatedExecutor({
      store,
      policyVersion: "policy-runtime",
      now: () => new Date(now),
      targetResolver: { resolve: async () => target },
      deadlineScheduler: {
        schedule: (delayMs, callback) => {
          const entry = { delayMs, callback, cancelled: false };
          schedules.push(entry);
          return { cancel: () => { entry.cancelled = true; } };
        }
      },
      operationControl: {
        cancel: async () => ({ accepted: true, summary: "exact recovered deadline cancellation accepted" }),
        observe: async (binding) => terminal
          ? {
              state: "terminal", ...binding, status: "completed", effectDisposition: "committed",
              summary: "The exact recovered process became terminal without replay.", evidenceDigest: "6".repeat(64),
              toolVersions: { repositorySupervisor: "restart-poll-test-v1" }
            }
          : { state: "active", ...binding, effectDisposition: "ambiguous", summary: "The exact recovered process remains live." }
      }
    });

    const recovered = await restarted.recoverAfterRestart();
    assert.equal(recovered.budgets[0]?.status, "running");
    assert.ok(schedules.some((entry) => entry.delayMs > 1_000), "the durable claim deadline must be rescheduled after restart");
    const poll = schedules.find((entry) => entry.delayMs > 0 && entry.delayMs <= 1_000);
    assert.ok(poll, "restart must schedule one bounded reconciliation poll while exact work remains active");
    terminal = true;
    poll.callback();
    await eventually(async () => {
      assert.equal((await restarted.operations.get(operationId))?.state, "recorded");
      assert.equal((await restarted.budgets.list("run_target"))[0]?.state, "completed");
    });
    assert.equal(schedules.filter((entry) => !entry.cancelled && entry !== poll).length, 0, "terminal reconciliation must leave no outstanding recovered deadline or poll schedule");
    assert.equal((await restarted.receipts.list()).length, 1);
  });
});

test("wrong operation/action/target bindings and ambiguous dispositions never settle or release durable work", async () => {
  const cases: readonly ((binding: OperationReconciliationBinding) => OperationControllerObservation)[] = [
    (binding) => ({ state: "terminal", ...binding, operationId: "wrong-operation", status: "completed", effectDisposition: "committed", summary: "wrong operation" }),
    (binding) => ({ state: "terminal", ...binding, action: "run_target", status: "completed", effectDisposition: "committed", summary: "wrong action" }),
    (binding) => ({ state: "terminal", ...binding, targetSnapshotId: "0".repeat(64), status: "completed", effectDisposition: "committed", summary: "wrong target" }),
    (binding) => ({ state: "terminal", ...binding, sessionId: "wrong-session", status: "completed", effectDisposition: "committed", summary: "wrong session" }),
    (binding) => ({ state: "terminal", ...binding, authorityId: "wrong-authority", status: "completed", effectDisposition: "committed", summary: "wrong authority" }),
    (binding) => ({ state: "terminal", ...binding, status: "incomplete", effectDisposition: "ambiguous", summary: "PID reuse or provider state is unknown" })
  ];
  for (const observation of cases) {
    await withStore(async (store) => {
      const setup = await startRunningProof(store, async (binding) => observation(binding));
      const operationId = setup.started.operationId!;
      const [result] = await setup.runtime.reconcileBudgetedOperations();
      assert.equal(result?.status, "running");
      assert.match(result?.summary ?? "", /mismatch|ambiguous|unresolved|unknown/i);
      assert.equal((await setup.runtime.operations.get(operationId))?.state, "executing");
      assert.equal((await setup.runtime.budgets.list("proof"))[0]?.state, "running");
      assert.equal((await setup.runtime.receipts.list()).length, 0);
      assert.equal(setup.cancelledSchedules(), 0);
    });
  }
});

test("explicit process cancellation preserves committed prior effects instead of claiming compensation", async () => {
  await withStore(async (store) => {
    const setup = await startRunningProof(store, async (binding) => ({
      state: "terminal", ...binding, status: "cancelled", effectDisposition: "committed",
      summary: "The exact supervisor-owned process tree stopped, but prior effects were not rolled back.", evidenceDigest: "9".repeat(64),
      toolVersions: { repositorySupervisor: "job-object-v1" }
    }));
    const operationId = setup.started.operationId!;
    assert.equal((await setup.runtime.cancelOperation(operationId, "operator stop" )).status, "cancelling");
    const [result] = await setup.runtime.reconcileBudgetedOperations();
    assert.equal(result?.status, "cancelled");
    assert.equal((await setup.runtime.operations.get(operationId))?.state, "recorded", "process termination alone must preserve the committed/no-replay effect truth");
    assert.equal((await setup.runtime.operations.get(operationId))?.details.effectDisposition, "committed");
    assert.equal((await setup.runtime.budgets.list("proof"))[0]?.state, "cancelled");
    assert.equal(setup.cancelledSchedules(), 2);
  });
});

test("durable runtime captures a manual-only checkpoint and settles a running budget claim before a consequential Git broker", async () => {
  await withStore(async (store) => {
    const sessions = new SessionRegistry(store, { clock: () => now });
    const session = await sessions.register({
      id: "session-git", provider: "codex", surface: "vscode_terminal", capabilities: ["registered", "observable", "controllable", "mediated"],
      status: "running", workspaceRoot: target.repositoryRoot, targetSnapshotId: target.id, taskId: "task-git", planRevision: "plan-git",
      plannedFiles: ["src/safe.ts"], adapterVersion: "trusted-adapter", metadata: {}
    });
    const authorities = new AuthorityLedger(store, { clock: () => now, idFactory: () => "authority-git" });
    const authority = await authorities.issue({
      repositoryRoot: target.repositoryRoot, sessionId: session.id, taskId: session.taskId, planRevision: session.planRevision,
      allowedActions: ["local_commit"], prohibitedActions: [], expiresAt: authorityExpiry, issuedBy: "authenticated-user"
    });
    let brokerCalls = 0;
    const runtime = new DurableMediatedExecutor({
      store,
      sessions,
      authorities,
      policyVersion: "policy-runtime",
      now: () => new Date(now),
      targetResolver: { resolve: async () => target },
      budgetConfiguration: {
        version: "runtime-git-budget-v1",
        commandClasses: {
          local_commit: {
            maxConcurrent: 1, timeoutMs: 30_000, maxAttempts: 1, windowMs: 60_000,
            maxClaimsPerWindow: 2, maxCostUnitsPerWindow: 2, defaultCostUnits: 1
          }
        }
      },
      checkpointCapture: {
        capture: async () => ({
          reason: "Preserve the reviewed worktree before a scoped commit.",
          artifacts: [{ id: "worktree-manifest", kind: "workspace_manifest", reference: "host://checkpoint/worktree-manifest", sha256: "a".repeat(64) }],
          recovery: { steps: ["Inspect the preserved worktree manifest before any manual recovery."], artifactIds: ["worktree-manifest"] }
        })
      },
      checkpointVerifier: {
        verify: async (artifact) => ({ available: true, sha256: artifact.sha256, detail: "isolated test artifact verified" })
      },
      dependencies: ({ policy }) => {
        const git = new InMemoryGitBroker(policy);
        git.register("local_commit", () => {
          brokerCalls += 1;
          return { status: "completed", summary: "simulated scoped commit", effectDisposition: "committed" };
        });
        return {
          git,
          gitMutationFactory: {
            create: () => ({ kind: "local_commit", paths: ["src/safe.ts"], message: "safe local change" })
          }
        };
      }
    });
    const assignment = commandForAction("local_commit").assignment!;
    const confirmationToken = await reviewedLocalCommitToken(runtime, session, authority.id, target);
    const result = await runtime.execute({
      assignment, control: assignment.control, modifier: assignment.modifier, sessionId: session.id, authorityId: authority.id, confirmationToken
    });

    assert.equal(result.status, "completed");
    assert.equal(brokerCalls, 1);
    assert.ok(result.operationId);
    const checkpoints = await runtime.checkpoints.list({ operationId: result.operationId });
    assert.equal(checkpoints.length, 1);
    assert.equal(checkpoints[0]?.workflow, "consequential_git");
    assert.equal(checkpoints[0]?.manualOnly, true);
    assert.deepEqual(checkpoints[0]?.recovery.prohibitedActions, ["automatic_restore", "delete", "stash", "overwrite"]);
    const claims = await runtime.budgets.list("local_commit");
    assert.equal(claims.length, 1);
    assert.equal(claims[0]?.operationId, result.operationId);
    assert.equal(claims[0]?.state, "completed");
  });
});

test("a consequential broker is not called when its required checkpoint capture is unavailable", async () => {
  await withStore(async (store) => {
    const sessions = new SessionRegistry(store, { clock: () => now });
    const session = await sessions.register({
      id: "session-no-checkpoint", provider: "codex", surface: "vscode_terminal", capabilities: ["registered", "observable", "controllable", "mediated"],
      status: "running", workspaceRoot: target.repositoryRoot, targetSnapshotId: target.id, taskId: "task-no-checkpoint", planRevision: "plan-no-checkpoint",
      plannedFiles: ["src/safe.ts"], adapterVersion: "trusted-adapter", metadata: {}
    });
    const authorities = new AuthorityLedger(store, { clock: () => now, idFactory: () => "authority-no-checkpoint" });
    const authority = await authorities.issue({
      repositoryRoot: target.repositoryRoot, sessionId: session.id, taskId: session.taskId, planRevision: session.planRevision,
      allowedActions: ["local_commit"], prohibitedActions: [], expiresAt: authorityExpiry, issuedBy: "authenticated-user"
    });
    let brokerCalls = 0;
    const runtime = new DurableMediatedExecutor({
      store, sessions, authorities, policyVersion: "policy-runtime", now: () => new Date(now), targetResolver: { resolve: async () => target },
      dependencies: ({ policy }) => {
        const git = new InMemoryGitBroker(policy);
        git.register("local_commit", () => { brokerCalls += 1; return { status: "completed", summary: "must not run" }; });
        return { git, gitMutationFactory: { create: () => ({ kind: "local_commit", paths: ["src/safe.ts"], message: "safe local change" }) } };
      }
    });
    const assignment = commandForAction("local_commit").assignment!;
    const confirmationToken = await reviewedLocalCommitToken(runtime, session, authority.id, target);
    const result = await runtime.execute({
      assignment, control: assignment.control, modifier: assignment.modifier, sessionId: session.id, authorityId: authority.id, confirmationToken
    });

    assert.equal(result.status, "unavailable");
    assert.match(result.summary, /checkpoint/i);
    assert.equal(brokerCalls, 0);
    assert.equal((await runtime.checkpoints.list()).length, 0);
    assert.equal((await runtime.budgets.list()).length, 0);
  });
});

test("consequential work is revalidated after checkpoint capture and does not run when the exact target changes", async () => {
  await withStore(async (store) => {
    const changedMaterial = { ...targetMaterial, head: "changed-head" };
    const changedTarget: TargetSnapshot = { id: targetSnapshotDigest(changedMaterial), ...changedMaterial, capturedAt: now };
    const sessions = new SessionRegistry(store, { clock: () => now });
    const session = await sessions.register({
      id: "session-revalidate", provider: "codex", surface: "vscode_terminal", capabilities: ["registered", "observable", "controllable", "mediated"],
      status: "running", workspaceRoot: target.repositoryRoot, targetSnapshotId: target.id, taskId: "task-revalidate", planRevision: "plan-revalidate",
      plannedFiles: ["src/safe.ts"], adapterVersion: "trusted-adapter", metadata: {}
    });
    const authorities = new AuthorityLedger(store, { clock: () => now, idFactory: () => "authority-revalidate" });
    const authority = await authorities.issue({
      repositoryRoot: target.repositoryRoot, sessionId: session.id, taskId: session.taskId, planRevision: session.planRevision,
      allowedActions: ["local_commit"], prohibitedActions: [], expiresAt: authorityExpiry, issuedBy: "authenticated-user"
    });
    let resolves = 0;
    let brokerCalls = 0;
    const runtime = new DurableMediatedExecutor({
      store,
      sessions,
      authorities,
      policyVersion: "policy-runtime",
      now: () => new Date(now),
      targetResolver: { resolve: async () => (++resolves <= 2 ? target : changedTarget) },
      checkpointCapture: {
        capture: async () => ({
          reason: "Preserve state before the reviewed commit.",
          artifacts: [{ id: "manifest", kind: "workspace_manifest", reference: "host://checkpoint/manifest", sha256: "b".repeat(64) }],
          recovery: { steps: ["Review the manifest manually."], artifactIds: ["manifest"] }
        })
      },
      checkpointVerifier: {
        verify: async (artifact) => ({ available: true, sha256: artifact.sha256 })
      },
      dependencies: ({ policy }) => {
        const git = new InMemoryGitBroker(policy);
        git.register("local_commit", () => { brokerCalls += 1; return { status: "completed", summary: "must not run" }; });
        return { git, gitMutationFactory: { create: () => ({ kind: "local_commit", paths: ["src/safe.ts"], message: "safe local change" }) } };
      }
    });
    const assignment = commandForAction("local_commit").assignment!;
    const confirmationToken = await reviewedLocalCommitToken(runtime, session, authority.id, target);
    const result = await runtime.execute({
      assignment, control: assignment.control, modifier: assignment.modifier, sessionId: session.id, authorityId: authority.id, confirmationToken
    });

    assert.equal(result.status, "incomplete");
    assert.match(result.summary, /changed after admission|revalid/i);
    assert.equal(resolves, 3);
    assert.equal(brokerCalls, 0);
    assert.equal((await runtime.checkpoints.list()).length, 1);
    const claims = await runtime.budgets.list("local_commit");
    assert.equal(claims.length, 1);
    assert.equal(claims[0]?.state, "failed");
    assert.equal((await runtime.snapshots.list()).length, 2);
  });
});

test("the final effect guard rejects managed-session or authority churn after admission", async () => {
  for (const changed of ["session", "authority"] as const) {
    await withStore(async (store) => {
      const sessions = new SessionRegistry(store, { clock: () => now });
      const session = await sessions.register({
        id: `session-final-${changed}`, provider: "codex", surface: "vscode_terminal", capabilities: ["registered", "observable", "controllable", "mediated"],
        status: "running", workspaceRoot: target.repositoryRoot, targetSnapshotId: target.id, taskId: `task-final-${changed}`, planRevision: "plan-final",
        plannedFiles: ["src/safe.ts"], adapterVersion: "trusted-adapter", metadata: {}
      });
      const authorities = new AuthorityLedger(store, { clock: () => now, idFactory: () => `authority-final-${changed}` });
      const authority = await authorities.issue({
        repositoryRoot: target.repositoryRoot, sessionId: session.id, taskId: session.taskId, planRevision: session.planRevision,
        allowedActions: ["local_commit"], prohibitedActions: [], expiresAt: authorityExpiry, issuedBy: "authenticated-user"
      });
      let resolves = 0;
      let brokerCalls = 0;
      const runtime = new DurableMediatedExecutor({
        store,
        sessions,
        authorities,
        policyVersion: "policy-runtime",
        now: () => new Date(now),
        targetResolver: {
          resolve: async () => {
            resolves += 1;
            if (resolves === 3) {
              if (changed === "session") await sessions.updateBinding(session.id, { planRevision: "plan-changed-after-admission" });
              else await authorities.revoke(authority.id, "revoked after admission");
            }
            return target;
          }
        },
        checkpointCapture: {
          capture: async () => ({
            reason: "Preserve state before the reviewed commit.",
            artifacts: [{ id: "manifest", kind: "workspace_manifest", reference: "host://checkpoint/manifest", sha256: "d".repeat(64) }],
            recovery: { steps: ["Review the manifest manually."], artifactIds: ["manifest"] }
          })
        },
        checkpointVerifier: { verify: async (artifact) => ({ available: true, sha256: artifact.sha256 }) },
        dependencies: ({ policy }) => {
          const git = new InMemoryGitBroker(policy);
          git.register("local_commit", () => { brokerCalls += 1; return { status: "completed", summary: "must not run" }; });
          return { git, gitMutationFactory: { create: () => ({ kind: "local_commit", paths: ["src/safe.ts"], message: "safe local change" }) } };
        }
      });
      const assignment = commandForAction("local_commit").assignment!;
      const confirmationToken = await reviewedLocalCommitToken(runtime, session, authority.id, target);

      const result = await runtime.execute({
        assignment, control: assignment.control, modifier: assignment.modifier,
        sessionId: session.id, authorityId: authority.id, confirmationToken
      });

      assert.equal(result.status, "incomplete", `${changed}: ${JSON.stringify(result)}`);
      assert.match(result.summary, changed === "session" ? /session/i : /authority/i);
      assert.equal(resolves, 3);
      assert.equal(brokerCalls, 0);
    });
  }
});

test("a checkpoint with an unavailable or mismatched recovery artifact blocks its risky broker", async () => {
  await withStore(async (store) => {
    const sessions = new SessionRegistry(store, { clock: () => now });
    const session = await sessions.register({
      id: "session-broken-checkpoint", provider: "codex", surface: "vscode_terminal", capabilities: ["registered", "observable", "controllable", "mediated"],
      status: "running", workspaceRoot: target.repositoryRoot, targetSnapshotId: target.id, taskId: "task-broken-checkpoint", planRevision: "plan-broken-checkpoint",
      plannedFiles: ["src/safe.ts"], adapterVersion: "trusted-adapter", metadata: {}
    });
    const authorities = new AuthorityLedger(store, { clock: () => now, idFactory: () => "authority-broken-checkpoint" });
    const authority = await authorities.issue({
      repositoryRoot: target.repositoryRoot, sessionId: session.id, taskId: session.taskId, planRevision: session.planRevision,
      allowedActions: ["local_commit"], prohibitedActions: [], expiresAt: authorityExpiry, issuedBy: "authenticated-user"
    });
    let brokerCalls = 0;
    const runtime = new DurableMediatedExecutor({
      store, sessions, authorities, policyVersion: "policy-runtime", now: () => new Date(now), targetResolver: { resolve: async () => target },
      checkpointCapture: {
        capture: async () => ({
          reason: "Preserve state before commit.",
          artifacts: [{ id: "manifest", kind: "workspace_manifest", reference: "host://checkpoint/missing", sha256: "c".repeat(64) }],
          recovery: { steps: ["Inspect manually."], artifactIds: ["manifest"] }
        })
      },
      checkpointVerifier: { verify: async () => ({ available: false, detail: "isolated artifact unavailable" }) },
      dependencies: ({ policy }) => {
        const git = new InMemoryGitBroker(policy);
        git.register("local_commit", () => { brokerCalls += 1; return { status: "completed", summary: "must not run" }; });
        return { git, gitMutationFactory: { create: () => ({ kind: "local_commit", paths: ["src/safe.ts"], message: "safe local change" }) } };
      }
    });
    const assignment = commandForAction("local_commit").assignment!;
    const confirmationToken = await reviewedLocalCommitToken(runtime, session, authority.id, target);
    const result = await runtime.execute({ assignment, control: assignment.control, modifier: assignment.modifier, sessionId: session.id, authorityId: authority.id, confirmationToken });
    assert.equal(result.status, "unavailable");
    assert.match(result.summary, /checkpoint artifacts/i);
    assert.equal(brokerCalls, 0);
  });
});

test("durable mediated executor never substitutes a target, authority, or acceptance evidence", async () => {
  await withStore(async (store) => {
    const runtime = new DurableMediatedExecutor({
      store,
      policyVersion: "policy-runtime",
      now: () => new Date(now),
      targetResolver: { resolve: async () => undefined }
    });
    const proof = commandForAction("proof").assignment!;
    const result = await runtime.execute({ assignment: proof, control: proof.control, modifier: proof.modifier, sessionId: "missing" });
    assert.equal(result.status, "unavailable");
    assert.match(result.summary, /session|target/i);
  });
});
