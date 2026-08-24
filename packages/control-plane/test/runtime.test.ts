import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { InMemoryCommandAdapter, AdapterRegistry } from "../src/adapters.ts";
import { InMemoryGitBroker } from "../src/brokers.ts";
import { commandForAction } from "../src/command-catalog.ts";
import type { ManagedSession, TargetSnapshot } from "../src/contracts.ts";
import { AuthorityLedger } from "../src/authority.ts";
import { DurableBudgetManager } from "../src/budgets.ts";
import { DurableMediatedExecutor } from "../src/runtime.ts";
import { SessionRegistry } from "../src/session-registry.ts";
import { targetSnapshotDigest } from "../src/snapshot.ts";
import { ProtectedJsonStore } from "../src/store.ts";

const now = "2026-08-23T12:00:00.000Z";
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
      allowedActions: ["proof"], prohibitedActions: [], expiresAt: "2026-08-24T12:00:00.000Z", issuedBy: "authenticated-user"
    });
    const adapters = new AdapterRegistry();
    const proofAdapter = new InMemoryCommandAdapter();
    proofAdapter.register("proof", () => ({ status: "completed", summary: "isolated proof adapter result" }));
    adapters.register("proof", proofAdapter);
    const runtime = new DurableMediatedExecutor({
      store, sessions, authorities, policyVersion: "policy-runtime", targetResolver: { resolve: async () => target },
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
      allowedActions: ["proof_adversarial"], prohibitedActions: [], expiresAt: "2026-08-24T12:00:00.000Z", issuedBy: "authenticated-user"
    });
    const adapters = new AdapterRegistry();
    const adapter = new InMemoryCommandAdapter();
    let calls = 0;
    adapter.register("proof_adversarial", () => { calls += 1; return { status: "completed", summary: "isolated adversarial proof" }; });
    adapters.register("proof_adversarial", adapter);
    const runtime = new DurableMediatedExecutor({
      store, sessions, authorities, policyVersion: "policy-runtime", targetResolver: { resolve: async () => target },
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
    const replay = await runtime.execute({
      assignment, control: assignment.control, modifier: assignment.modifier, sessionId: session.id, authorityId: authority.id, confirmationToken: issued.token
    });
    assert.equal(replay.status, "blocked");
    assert.equal(calls, 1);
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
      allowedActions: ["proof"], prohibitedActions: [], expiresAt: "2026-08-24T12:00:00.000Z", issuedBy: "authenticated-user"
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
      store, sessions, authorities, policyVersion: "policy-runtime", targetResolver: { resolve: async () => target },
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
      allowedActions: ["proof"], prohibitedActions: [], expiresAt: "2026-08-24T12:00:00.000Z", issuedBy: "authenticated-user"
    });
    const adapters = new AdapterRegistry();
    const proof = new InMemoryCommandAdapter();
    let control: { isCancellationRequested(): Promise<boolean> } | undefined;
    proof.register("proof", async (request) => { control = request.executionControl; return { status: "running", summary: "isolated long agent work" }; });
    adapters.register("proof", proof);
    let fireDeadline: (() => void) | undefined;
    let hostCancels = 0;
    const runtime = new DurableMediatedExecutor({
      store, sessions, authorities, budgets, policyVersion: "policy-runtime", now: () => new Date(clockValue), targetResolver: { resolve: async () => target },
      budgetConfiguration: {
        version: "deadline-test-budget", commandClasses: {
          proof: { maxConcurrent: 1, timeoutMs: 1, maxAttempts: 1, windowMs: 60_000, maxClaimsPerWindow: 1, maxCostUnitsPerWindow: 1, defaultCostUnits: 1 }
        }
      },
      deadlineScheduler: { schedule: (_delay, callback) => { fireDeadline = callback; return { cancel: () => { fireDeadline = undefined; } }; } },
      operationControl: { cancel: async () => { hostCancels += 1; return { accepted: true, summary: "isolated deadline cancellation accepted" }; } },
      dependencies: () => ({ adapters })
    });
    const assignment = commandForAction("proof").assignment!;
    const started = await runtime.execute({ assignment, control: assignment.control, modifier: assignment.modifier, sessionId: session.id, authorityId: authority.id });
    assert.equal(started.status, "running");
    assert.ok(fireDeadline);
    clockValue = "2026-08-23T12:00:01.000Z";
    fireDeadline!();
    await eventually(() => assert.equal(hostCancels, 1));
    assert.equal(await control?.isCancellationRequested(), true);
    assert.equal((await budgets.get("deadline-claim"))?.state, "timed_out");
    assert.equal((await runtime.operations.get(started.operationId!))?.state, "cancelling");
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
      allowedActions: ["local_commit"], prohibitedActions: [], expiresAt: "2026-08-24T12:00:00.000Z", issuedBy: "authenticated-user"
    });
    let brokerCalls = 0;
    const runtime = new DurableMediatedExecutor({
      store,
      sessions,
      authorities,
      policyVersion: "policy-runtime",
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
          return { status: "completed", summary: "simulated scoped commit" };
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
      allowedActions: ["local_commit"], prohibitedActions: [], expiresAt: "2026-08-24T12:00:00.000Z", issuedBy: "authenticated-user"
    });
    let brokerCalls = 0;
    const runtime = new DurableMediatedExecutor({
      store, sessions, authorities, policyVersion: "policy-runtime", targetResolver: { resolve: async () => target },
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
      allowedActions: ["local_commit"], prohibitedActions: [], expiresAt: "2026-08-24T12:00:00.000Z", issuedBy: "authenticated-user"
    });
    let resolves = 0;
    let brokerCalls = 0;
    const runtime = new DurableMediatedExecutor({
      store,
      sessions,
      authorities,
      policyVersion: "policy-runtime",
      targetResolver: { resolve: async () => (++resolves === 1 ? target : changedTarget) },
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
    assert.match(result.summary, /revalid/i);
    assert.equal(resolves, 2);
    assert.equal(brokerCalls, 0);
    assert.equal((await runtime.checkpoints.list()).length, 1);
    assert.equal((await runtime.budgets.list()).length, 0);
    assert.equal((await runtime.snapshots.list()).length, 2);
  });
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
      allowedActions: ["local_commit"], prohibitedActions: [], expiresAt: "2026-08-24T12:00:00.000Z", issuedBy: "authenticated-user"
    });
    let brokerCalls = 0;
    const runtime = new DurableMediatedExecutor({
      store, sessions, authorities, policyVersion: "policy-runtime", targetResolver: { resolve: async () => target },
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
      targetResolver: { resolve: async () => undefined }
    });
    const proof = commandForAction("proof").assignment!;
    const result = await runtime.execute({ assignment: proof, control: proof.control, modifier: proof.modifier, sessionId: "missing" });
    assert.equal(result.status, "unavailable");
    assert.match(result.summary, /session|target/i);
  });
});
