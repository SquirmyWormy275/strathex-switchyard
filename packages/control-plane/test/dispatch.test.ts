import assert from "node:assert/strict";
import test from "node:test";
import { assignmentFor } from "../../protocol/src/b122.ts";
import { AdapterRegistry, InMemoryCommandAdapter } from "../src/adapters.ts";
import { InMemoryExecutionBroker, InMemoryGitBroker, InMemoryTestEnvironmentBroker, type GitMutation } from "../src/brokers.ts";
import { commandCatalog, commandForAction, type CommandAction } from "../src/command-catalog.ts";
import { InMemoryContainmentManager } from "../src/containment.ts";
import type { AuthorityGrant, ManagedSession, TargetSnapshot } from "../src/contracts.ts";
import { CommandDispatcher } from "../src/dispatch.ts";
import { PolicyEngine } from "../src/policy.ts";
import type { RepositoryRecipe } from "../src/recipes.ts";
import { sha256 } from "../src/store.ts";

const now = "2026-08-23T12:00:00.000Z";
const target: TargetSnapshot = {
  id: "snapshot-1", repositoryRoot: "C:/work/example", canonicalRemote: "https://github.com/example/repo.git",
  branch: "feature/safe", head: "abc", indexTree: "tree", trackedManifest: "tracked", untrackedManifest: "untracked",
  submodules: {}, policyVersion: "policy-1", environmentFingerprint: "env-1", capturedAt: now, completeness: "complete", reasons: []
};
const session: ManagedSession = {
  id: "session-1", provider: "codex", surface: "vscode_terminal", capabilities: ["registered", "observable", "controllable", "mediated"],
  status: "running", workspaceRoot: target.repositoryRoot, targetSnapshotId: target.id, taskId: "task-1", planRevision: "plan-1",
  plannedFiles: ["src/safe.ts"], lastHeartbeat: now, adapterVersion: "test", metadata: {}
};
const grant = (action: CommandAction): AuthorityGrant => ({
  id: `authority-${action}`, repositoryRoot: target.repositoryRoot, sessionId: session.id, taskId: session.taskId, planRevision: session.planRevision,
  allowedActions: [action], prohibitedActions: [], expiresAt: "2026-08-24T12:00:00.000Z", issuedAt: now, issuedBy: "user"
});
const recipe: RepositoryRecipe = {
  version: "1", repositoryRoot: target.repositoryRoot,
  gates: [{ name: "test", executable: "node", args: ["--test"], timeoutMs: 10_000 }],
  productionHostPatterns: ["prod.example"], allowedDevelopmentHosts: [], environmentAllowlist: []
};

function dispatcher(policy = new PolicyEngine({ version: "policy-1", now: () => new Date(now) })) {
  return new CommandDispatcher({
    policy,
    sessions: { get: (id) => id === session.id ? session : undefined },
    authorities: { get: (id) => id.startsWith("authority-") ? grant(id.slice("authority-".length) as CommandAction) : undefined }
  });
}

test("dispatcher has an honest, non-throwing disposition for all 65 settled commands", async () => {
  const controlPlane = dispatcher();
  const results = await Promise.all(commandCatalog.map(async (definition) => {
    const assignment = definition.assignment!;
    return controlPlane.dispatch({
      assignment, control: assignment.control, modifier: assignment.modifier,
      sessionId: session.id, targetSnapshot: target, authorityId: `authority-${definition.action}`
    });
  }));
  assert.equal(results.length, 65);
  for (const result of results) assert.match(result.status, /^(completed|failed|awaiting_input|awaiting_confirmation|unavailable|incomplete|blocked|cancelled|timed_out)$/);
});

test("dispatcher rejects a forged or mismatched assignment before an adapter or broker is reached", async () => {
  const controlPlane = dispatcher();
  const proof = assignmentFor("PROOF", "normal")!;
  const result = await controlPlane.dispatch({ assignment: proof, control: "VSCODE", modifier: "normal", sessionId: session.id, targetSnapshot: target });
  assert.equal(result.status, "blocked");
  assert.match(result.summary, /mismatch/i);
});

test("high-consequence Git action is policy-blocked before any mutation factory or Git adapter runs", async () => {
  const policy = new PolicyEngine({ version: "policy-1", now: () => new Date(now) });
  let mutationFactoryCalls = 0;
  let gitCalls = 0;
  const git = new InMemoryGitBroker(policy);
  git.register("merge_pr", () => { gitCalls += 1; return { status: "completed", summary: "should not run" }; });
  const controlPlane = new CommandDispatcher({
    policy,
    sessions: { get: () => session },
    authorities: { get: () => grant("pr_merge") },
    git,
    gitMutationFactory: { create: () => { mutationFactoryCalls += 1; return { kind: "merge_pr", pullRequest: 7, head: "abc", baseBranch: "main" }; } }
  });
  const assignment = commandForAction("pr_merge").assignment!;
  const result = await controlPlane.dispatch({ assignment, control: assignment.control, modifier: assignment.modifier, sessionId: session.id, targetSnapshot: target, authorityId: "authority-pr_merge" });
  assert.equal(result.status, "blocked");
  assert.equal(mutationFactoryCalls, 0);
  assert.equal(gitCalls, 0);
});

test("a registered low-risk adapter action completes only through its explicit adapter", async () => {
  const adapters = new AdapterRegistry();
  const adapter = new InMemoryCommandAdapter();
  adapter.register("focus_vscode", () => ({ status: "completed", summary: "simulated VS Code focus" }));
  adapters.register("focus_vscode", adapter);
  const controlPlane = new CommandDispatcher({ policy: new PolicyEngine({ version: "policy-1", now: () => new Date(now) }), adapters });
  const assignment = commandForAction("focus_vscode").assignment!;
  const result = await controlPlane.dispatch({ assignment, control: assignment.control, modifier: assignment.modifier });
  assert.equal(result.status, "completed");
});

test("Plan Approval reaches an agent adapter only with dispatcher-proven current-user confirmation bound to the exact scope", async () => {
  const policy = new PolicyEngine({ version: "policy-1", now: () => new Date(now) });
  const adapters = new AdapterRegistry();
  const adapter = new InMemoryCommandAdapter();
  let observed: unknown;
  adapter.register("plan_approval", (request) => {
    observed = request.confirmation;
    return { status: "completed", summary: "The exact approved plan started.", effectDisposition: "committed" };
  });
  adapters.register("plan_approval", adapter);
  const definition = commandForAction("plan_approval");
  const authority = grant("plan_approval");
  const confirmation = policy.createConfirmation({ action: definition.action, targetSnapshotId: target.id, sessionId: session.id, authorityId: authority.id, reason: "approve exact plan", reauthenticated: true });
  const controlPlane = new CommandDispatcher({ policy, sessions: { get: () => session }, authorities: { get: () => authority }, adapters });
  const assignment = definition.assignment!;

  const missing = await controlPlane.dispatch({ assignment, control: assignment.control, modifier: assignment.modifier, sessionId: session.id, targetSnapshot: target, authorityId: authority.id });
  assert.equal(missing.status, "awaiting_confirmation");
  assert.equal(observed, undefined);

  const completed = await controlPlane.dispatch({ assignment, control: assignment.control, modifier: assignment.modifier, sessionId: session.id, targetSnapshot: target, authorityId: authority.id, confirmationToken: confirmation.token });
  assert.equal(completed.status, "completed");
  assert.deepEqual(observed, { currentUserConfirmed: true, confirmationDigest: sha256(confirmation.token), action: "plan_approval", targetSnapshotId: target.id, sessionId: session.id, authorityId: authority.id });
});

test("pipeline local gate crosses the disposable test-environment broker before its typed execution recipe", async () => {
  const policy = new PolicyEngine({ version: "policy-1", now: () => new Date(now) });
  const execution = new InMemoryExecutionBroker(policy);
  execution.register("pipeline_local_gate", () => ({ status: "completed", summary: "simulated isolated gate" }));
  const controlPlane = new CommandDispatcher({
    policy,
    sessions: { get: () => session }, authorities: { get: () => grant("pipeline_local_gate") },
    execution,
    testEnvironment: new InMemoryTestEnvironmentBroker(policy),
    recipes: { forTarget: () => recipe },
    executionRecipeFactory: { create: (definition, resolvedTarget) => ({ id: definition.action, executable: "node", args: ["--test"], workingDirectory: resolvedTarget.repositoryRoot, environment: {} }) }
  });
  const assignment = commandForAction("pipeline_local_gate").assignment!;
  const result = await controlPlane.dispatch({ assignment, control: assignment.control, modifier: assignment.modifier, sessionId: session.id, targetSnapshot: target, authorityId: "authority-pipeline_local_gate" });
  assert.equal(result.status, "completed");
  assert.match(result.summary, /isolated gate/i);
});

test("authenticated emergency containment is an explicit broker fence, never a release toggle", async () => {
  const definition = commandForAction("emergency_containment");
  const policy = new PolicyEngine({
    version: "policy-1", now: () => new Date(now), highConsequenceActions: [definition.action],
    gateEvidence: Object.fromEntries(definition.acceptanceGates.map((gate) => [gate, "passed"]))
  });
  const confirmation = policy.createConfirmation({ action: definition.action, targetSnapshotId: target.id, sessionId: session.id, authorityId: grant(definition.action).id, reason: "incident", reauthenticated: true });
  const containment = new InMemoryContainmentManager();
  let finalGuardCalls = 0;
  const controlPlane = new CommandDispatcher({
    policy,
    sessions: { get: () => session },
    authorities: { get: () => grant(definition.action) },
    containment,
    governance: {
      admit: async () => ({
        allowed: true,
        summary: "isolated final-current admission",
        effectGuard: {
          assertCurrent: async () => {
            finalGuardCalls += 1;
            return { allowed: true, reason: "The exact target, session, and authority remain current." };
          }
        }
      }),
      observeResult: async (_input, _admission, result) => result
    }
  });
  const assignment = definition.assignment!;
  const result = await controlPlane.dispatch({ assignment, control: assignment.control, modifier: assignment.modifier, sessionId: session.id, targetSnapshot: target, authorityId: grant(definition.action).id, confirmationToken: confirmation.token });
  assert.equal(result.status, "completed");
  assert.equal(finalGuardCalls, 1);
  assert.equal(containment.check(target.repositoryRoot, "git").allowed, false);
});

test("emergency containment cannot activate after its final target guard refuses", async () => {
  const definition = commandForAction("emergency_containment");
  const policy = new PolicyEngine({
    version: "policy-1", now: () => new Date(now), highConsequenceActions: [definition.action],
    gateEvidence: Object.fromEntries(definition.acceptanceGates.map((gate) => [gate, "passed"]))
  });
  const authority = grant(definition.action);
  const confirmation = policy.createConfirmation({ action: definition.action, targetSnapshotId: target.id, sessionId: session.id, authorityId: authority.id, reason: "incident", reauthenticated: true });
  const containment = new InMemoryContainmentManager();
  const controlPlane = new CommandDispatcher({
    policy,
    sessions: { get: () => session },
    authorities: { get: () => authority },
    containment,
    governance: {
      admit: async () => ({
        allowed: true,
        summary: "isolated final-current admission",
        effectGuard: { assertCurrent: async () => ({ allowed: false, reason: "The protected target changed after admission." }) }
      }),
      observeResult: async (_input, _admission, result) => result
    }
  });
  const assignment = definition.assignment!;

  const result = await controlPlane.dispatch({
    assignment, control: assignment.control, modifier: assignment.modifier,
    sessionId: session.id, targetSnapshot: target, authorityId: authority.id, confirmationToken: confirmation.token
  });

  assert.equal(result.status, "incomplete");
  assert.match(result.summary, /changed after admission/i);
  assert.equal(containment.check(target.repositoryRoot, "git").allowed, true);
});

test("administrative containment release crosses one operation-bound final guard immediately before release", async () => {
  const definition = commandForAction("containment_release");
  const policy = new PolicyEngine({
    version: "policy-1", now: () => new Date(now), highConsequenceActions: [definition.action],
    gateEvidence: Object.fromEntries(definition.acceptanceGates.map((gate) => [gate, "passed"]))
  });
  const authority = grant(definition.action);
  const confirmation = policy.createConfirmation({ action: definition.action, targetSnapshotId: target.id, sessionId: session.id, authorityId: authority.id, reason: "release reviewed fence", reauthenticated: true });
  let releases = 0;
  let guardedOperationId: string | undefined;
  const containment = {
    activate: () => { throw new Error("not used"); },
    check: () => ({ allowed: false, reason: "active" }),
    release: () => { releases += 1; return { status: "released" as const, reason: "The exact reviewed fence was released." }; }
  };
  const controlPlane = new CommandDispatcher({ policy, sessions: { get: () => session }, authorities: { get: () => authority }, containment });

  const result = await controlPlane.dispatchContainmentRelease({
    targetSnapshot: target,
    sessionId: session.id,
    authorityId: authority.id,
    confirmationToken: confirmation.token,
    effectGuardFactory: (operationId) => ({
      assertCurrent: async (input) => {
        guardedOperationId = operationId;
        assert.equal(input.operationId, operationId);
        assert.equal(input.action, "containment_release");
        assert.equal(input.target.id, target.id);
        assert.equal(input.session?.id, session.id);
        assert.equal(input.authority?.id, authority.id);
        return { allowed: true, reason: "The exact release binding remains current." };
      }
    }),
    review: {
      reauthenticated: true,
      reason: "release reviewed fence",
      expectedFenceEpoch: 1,
      expectedActivationOperationId: "containment-activation-1",
      expectedIncidentId: `containment-incident:${"a".repeat(64)}`,
      expectedIncidentDigest: "b".repeat(64),
      expectedAssessmentTargetSnapshotId: target.id
    }
  });

  assert.equal(result.status, "completed");
  assert.equal(releases, 1);
  assert.equal(guardedOperationId, result.operationId);
});

test("administrative containment release remains active when its final guard refuses", async () => {
  const definition = commandForAction("containment_release");
  const policy = new PolicyEngine({
    version: "policy-1", now: () => new Date(now), highConsequenceActions: [definition.action],
    gateEvidence: Object.fromEntries(definition.acceptanceGates.map((gate) => [gate, "passed"]))
  });
  const authority = grant(definition.action);
  const confirmation = policy.createConfirmation({ action: definition.action, targetSnapshotId: target.id, sessionId: session.id, authorityId: authority.id, reason: "release reviewed fence", reauthenticated: true });
  let releases = 0;
  const containment = {
    activate: () => { throw new Error("not used"); },
    check: () => ({ allowed: false, reason: "active" }),
    release: () => { releases += 1; return { status: "released" as const, reason: "must not run" }; }
  };
  const controlPlane = new CommandDispatcher({ policy, sessions: { get: () => session }, authorities: { get: () => authority }, containment });

  const result = await controlPlane.dispatchContainmentRelease({
    targetSnapshot: target,
    sessionId: session.id,
    authorityId: authority.id,
    confirmationToken: confirmation.token,
    effectGuardFactory: () => ({ assertCurrent: async () => ({ allowed: false, reason: "The authority changed after review." }) }),
    review: {
      reauthenticated: true,
      reason: "release reviewed fence",
      expectedFenceEpoch: 1,
      expectedActivationOperationId: "containment-activation-1",
      expectedIncidentId: `containment-incident:${"a".repeat(64)}`,
      expectedIncidentDigest: "b".repeat(64),
      expectedAssessmentTargetSnapshotId: target.id
    }
  });

  assert.equal(result.status, "incomplete");
  assert.match(result.summary, /authority changed/i);
  assert.equal(releases, 0);
});

test("active containment blocks Council before the coordinator can receive a report request", async () => {
  const policy = new PolicyEngine({ version: "policy-1", now: () => new Date(now) });
  const containment = new InMemoryContainmentManager();
  containment.activate({ repositoryRoot: target.repositoryRoot, operationId: "containment", reason: "test" });
  let councilCalls = 0;
  const controlPlane = new CommandDispatcher({
    policy,
    sessions: { get: () => session },
    authorities: { get: () => grant("council_report") },
    containment,
    council: {
      execute: async () => {
        councilCalls += 1;
        return { status: "completed", summary: "must not run" };
      }
    }
  });
  const assignment = commandForAction("council_report").assignment!;

  const result = await controlPlane.dispatch({
    assignment, control: assignment.control, modifier: assignment.modifier,
    sessionId: session.id, targetSnapshot: target, authorityId: "authority-council_report"
  });
  assert.equal(result.status, "blocked");
  assert.equal(councilCalls, 0);
});

test("dispatcher asks trusted mutation factories for structured Git data rather than parsing raw input", async () => {
  const policy = new PolicyEngine({ version: "policy-1", now: () => new Date(now) });
  const git = new InMemoryGitBroker(policy);
  git.register("local_commit", () => ({ status: "completed", summary: "simulated owned-path commit" }));
  let factoryCalls = 0;
  const expected: GitMutation = { kind: "local_commit", paths: ["src/safe.ts"], message: "safe" };
  const controlPlane = new CommandDispatcher({
    policy, sessions: { get: () => session }, authorities: { get: () => grant("local_commit") }, git,
    gitMutationFactory: { create: () => { factoryCalls += 1; return expected; } }
  });
  const assignment = commandForAction("local_commit").assignment!;
  const confirmation = policy.createConfirmation({
    action: "local_commit", targetSnapshotId: target.id, sessionId: session.id, authorityId: "authority-local_commit",
    reason: "isolated reviewed local commit", reauthenticated: true
  });
  const result = await controlPlane.dispatch({ assignment, control: assignment.control, modifier: assignment.modifier, sessionId: session.id, targetSnapshot: target, authorityId: "authority-local_commit", confirmationToken: confirmation.token, input: { shell: "git push --force" } });
  assert.equal(result.status, "completed");
  assert.equal(factoryCalls, 1);
});

test("a local commit cannot reach its mutation factory or broker without an exact reviewed confirmation", async () => {
  const policy = new PolicyEngine({ version: "policy-1", now: () => new Date(now) });
  const git = new InMemoryGitBroker(policy);
  let factoryCalls = 0;
  let brokerCalls = 0;
  git.register("local_commit", () => { brokerCalls += 1; return { status: "completed", summary: "must not run" }; });
  const controlPlane = new CommandDispatcher({
    policy,
    sessions: { get: () => session },
    authorities: { get: () => grant("local_commit") },
    git,
    gitMutationFactory: { create: () => { factoryCalls += 1; return { kind: "local_commit", paths: ["src/safe.ts"], message: "must not run" }; } }
  });
  const assignment = commandForAction("local_commit").assignment!;
  const result = await controlPlane.dispatch({
    assignment, control: assignment.control, modifier: assignment.modifier,
    sessionId: session.id, targetSnapshot: target, authorityId: "authority-local_commit"
  });
  assert.equal(result.status, "awaiting_confirmation");
  assert.equal(factoryCalls, 0);
  assert.equal(brokerCalls, 0);
});

test("dispatcher advances an injected durable lifecycle and records the result before settling", async () => {
  const events: string[] = [];
  const operations = {
    claim: async () => ({ operationId: "durable-op", existing: false }),
    markExecuting: async () => { events.push("executing"); },
    recordResult: async (_lease: unknown, result: { status: string }) => { events.push(`record:${result.status}`); return { receiptId: "receipt-1" }; },
    settle: async (_lease: unknown, status: string) => { events.push(`settle:${status}`); }
  };
  const adapters = new AdapterRegistry();
  const adapter = new InMemoryCommandAdapter();
  adapter.register("focus_vscode", () => ({ status: "completed", summary: "simulated focus" }));
  adapters.register("focus_vscode", adapter);
  const controlPlane = new CommandDispatcher({ policy: new PolicyEngine({ version: "policy-1", now: () => new Date(now) }), adapters, operations });
  const assignment = commandForAction("focus_vscode").assignment!;
  const result = await controlPlane.dispatch({ assignment, control: assignment.control, modifier: assignment.modifier });
  assert.equal(result.receiptId, "receipt-1");
  assert.deepEqual(events, ["executing", "record:completed", "settle:completed"]);
});
