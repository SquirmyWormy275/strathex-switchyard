import assert from "node:assert/strict";
import test from "node:test";
import type { AuthorityGrant, ManagedSession, TargetSnapshot } from "../src/contracts.ts";
import { commandForAction, type CommandAction } from "../src/command-catalog.ts";
import { InMemoryContainmentManager } from "../src/containment.ts";
import {
  InMemoryAutomationBroker,
  InMemoryCredentialBroker,
  InMemoryExecutionBroker,
  InMemoryGitBroker,
  InMemoryNetworkBroker,
  InMemoryTestEnvironmentBroker,
  UnavailableIsolationRuntime,
  type BrokerInvocation
} from "../src/brokers.ts";
import { PolicyEngine, type PolicyPermit } from "../src/policy.ts";
import type { RepositoryRecipe } from "../src/recipes.ts";

const now = "2026-08-23T12:00:00.000Z";
const target: TargetSnapshot = {
  id: "snapshot-1", repositoryRoot: "C:/work/example", canonicalRemote: "https://github.com/example/repo.git",
  branch: "feature/safe", head: "abc", indexTree: "tree", trackedManifest: "tracked", untrackedManifest: "untracked",
  submodules: {}, policyVersion: "policy-1", environmentFingerprint: "env-1", capturedAt: now, completeness: "complete", reasons: []
};
const session: ManagedSession = {
  id: "session-1", provider: "codex", surface: "vscode_terminal", capabilities: ["registered", "observable", "controllable", "mediated"],
  status: "running", workspaceRoot: target.repositoryRoot, targetSnapshotId: target.id, taskId: "task-1", planRevision: "plan-1",
  plannedFiles: ["src/a.ts", "src/safe.ts"], lastHeartbeat: now, adapterVersion: "test", metadata: {}
};
const grant = (action: CommandAction): AuthorityGrant => ({
  id: `authority-${action}`, repositoryRoot: target.repositoryRoot, sessionId: session.id, taskId: session.taskId,
  planRevision: session.planRevision, allowedActions: [action], prohibitedActions: [], expiresAt: "2026-08-24T12:00:00.000Z",
  issuedAt: now, issuedBy: "user"
});

function permitted(action: CommandAction): { policy: PolicyEngine; permit: PolicyPermit; invocation: BrokerInvocation } {
  const definition = commandForAction(action);
  const policy = new PolicyEngine({ version: "policy-1", now: () => new Date(now) });
  const subject = { definition, target, session, authority: grant(action) };
  const operationId = `op-${action}`;
  const confirmation = definition.requiresConfirmation
    ? policy.createConfirmation({ action, targetSnapshotId: target.id, sessionId: session.id, authorityId: grant(action).id, reason: "test", reauthenticated: true })
    : undefined;
  const result = policy.issuePermit({ ...subject, operationId, confirmationToken: confirmation?.token });
  assert.equal(result.status, "allowed");
  assert.ok(result.permit);
  return { policy, permit: result.permit, invocation: { action, operationId, target, session, authority: grant(action), permit: result.permit } };
}

const recipe: RepositoryRecipe = {
  version: "1", repositoryRoot: target.repositoryRoot,
  gates: [{ name: "test", executable: "node", args: ["--test"], timeoutMs: 10_000 }],
  productionHostPatterns: ["prod.example", "production.example"], allowedDevelopmentHosts: ["dev.example.test"], environmentAllowlist: ["SAFE_FLAG"]
};

test("execution broker only invokes an explicitly registered typed recipe with a policy permit", async () => {
  const { policy, permit, invocation } = permitted("run_target");
  const broker = new InMemoryExecutionBroker(policy);
  let executions = 0;
  broker.register("run_target", () => { executions += 1; return { status: "completed", summary: "simulated run" }; });

  const result = await broker.execute({ ...invocation, permit, recipe: { id: "run_target", executable: "node", args: ["app.js"], workingDirectory: target.repositoryRoot, environment: {} } });
  assert.equal(result.status, "completed");
  assert.equal(executions, 1);

  const unsafe = await broker.execute({ ...invocation, permit, recipe: { id: "run_target", executable: "node", args: [], workingDirectory: target.repositoryRoot, environment: {} }, shell: "node app.js" } as unknown as Parameters<typeof broker.execute>[0]);
  assert.equal(unsafe.status, "blocked");
  assert.equal(executions, 1);
});

test("containment and a refused final effect check stop execution before a registered handler", async () => {
  const contained = permitted("run_target");
  const containment = new InMemoryContainmentManager();
  containment.activate({ repositoryRoot: target.repositoryRoot, operationId: "containment", reason: "test" });
  const containedBroker = new InMemoryExecutionBroker(contained.policy, containment);
  let containedCalls = 0;
  containedBroker.register("run_target", () => { containedCalls += 1; return { status: "completed", summary: "must not run" }; });
  const recipe = { id: "run_target", executable: "node", args: ["app.js"], workingDirectory: target.repositoryRoot, environment: {} };

  const containedResult = await containedBroker.execute({ ...contained.invocation, recipe });
  assert.equal(containedResult.status, "blocked");
  assert.equal(containedCalls, 0);

  const guarded = permitted("run_target");
  const guardedBroker = new InMemoryExecutionBroker(guarded.policy);
  let guardedCalls = 0;
  let guardCalls = 0;
  guardedBroker.register("run_target", () => { guardedCalls += 1; return { status: "completed", summary: "must not run" }; });
  const guardedResult = await guardedBroker.execute({
    ...guarded.invocation,
    recipe,
    effectGuard: {
      assertCurrent: () => {
        guardCalls += 1;
        return { allowed: false, reason: "Target changed before the execution effect." };
      }
    }
  });
  assert.equal(guardedResult.status, "incomplete");
  assert.equal(guardCalls, 1);
  assert.equal(guardedCalls, 0);
});

test("Git broker refuses force semantics and containment fences every Git mutation including local commit", async () => {
  const local = permitted("local_commit");
  const broker = new InMemoryGitBroker(local.policy);
  broker.register("local_commit", () => ({ status: "completed", summary: "simulated local commit" }));
  const force = await broker.execute({ ...local.invocation, mutation: { kind: "local_commit", paths: ["src/a.ts"], message: "safe", force: true } } as unknown as Parameters<typeof broker.execute>[0]);
  assert.equal(force.status, "blocked");

  const pr = permitted("pr_upsert");
  const containment = new InMemoryContainmentManager();
  containment.activate({ repositoryRoot: target.repositoryRoot, operationId: "containment", reason: "test" });
  const outbound = new InMemoryGitBroker(pr.policy, containment);
  let writes = 0;
  outbound.register("pr_upsert", () => { writes += 1; return { status: "completed", summary: "simulated PR" }; });
  const result = await outbound.execute({ ...pr.invocation, mutation: { kind: "pr_upsert", headBranch: target.branch!, baseBranch: "main" } });
  assert.equal(result.status, "blocked");
  assert.equal(writes, 0);

  const containedLocal = permitted("local_commit");
  const localFence = new InMemoryGitBroker(containedLocal.policy, containment);
  let localWrites = 0;
  localFence.register("local_commit", () => { localWrites += 1; return { status: "completed", summary: "must not commit" }; });
  const localResult = await localFence.execute({ ...containedLocal.invocation, mutation: { kind: "local_commit", paths: ["src/a.ts"], message: "blocked by fence" } });
  assert.equal(localResult.status, "blocked");
  assert.equal(localWrites, 0);
});

test("credential, network, and test-environment brokers deny unsafe access without exposing secret material", async () => {
  const pipeline = permitted("pipeline_local_gate");
  const containment = new InMemoryContainmentManager();
  const credentials = new InMemoryCredentialBroker(pipeline.policy, containment);
  credentials.register({ id: "ci-token", repositoryRoot: target.repositoryRoot, actions: ["pipeline_local_gate"], scopes: ["read:checks"], expiresAt: "2026-08-24T12:00:00.000Z", material: "never-return-this" });
  const lease = await credentials.acquire({ ...pipeline.invocation, scope: "read:checks" });
  assert.equal(lease.status, "completed");
  assert.doesNotMatch(JSON.stringify(lease), /never-return-this/);
  assert.doesNotMatch(JSON.stringify(lease), /material/);

  const network = new InMemoryNetworkBroker(pipeline.policy, containment);
  network.respond("GET", "https://api.example.test/health", { statusCode: 200, body: "ok" });
  const allowed = await network.request({ ...pipeline.invocation, method: "GET", url: "https://api.example.test/health", allowedHosts: ["api.example.test"] });
  assert.equal(allowed.status, "completed");
  const blocked = await network.request({ ...pipeline.invocation, method: "GET", url: "https://evil.example/", allowedHosts: ["api.example.test"] });
  assert.equal(blocked.status, "blocked");

  const testEnvironment = new InMemoryTestEnvironmentBroker(pipeline.policy, containment);
  const unsafe = await testEnvironment.prepare({ ...pipeline.invocation, recipe, sourceEnvironment: { DATABASE_URL: "postgres://prod.example/app", API_TOKEN: "secret" } });
  assert.equal(unsafe.status, "blocked");
  const safe = await testEnvironment.prepare({ ...pipeline.invocation, recipe, sourceEnvironment: { SAFE_FLAG: "yes", API_TOKEN: "secret" } });
  assert.equal(safe.status, "completed");
  assert.equal(safe.environment?.environment.SAFE_FLAG, "yes");
  assert.equal(safe.environment?.environment.API_TOKEN, undefined);
  assert.match(safe.environment?.databaseName ?? "", /^sxsy_test_/);
});

test("active containment prevents a test-environment allocation before any disposable state is created", async () => {
  const pipeline = permitted("pipeline_local_gate");
  const containment = new InMemoryContainmentManager();
  containment.activate({ repositoryRoot: target.repositoryRoot, operationId: "containment", reason: "test" });
  const testEnvironment = new InMemoryTestEnvironmentBroker(pipeline.policy, containment);
  const request = { ...pipeline.invocation, recipe, sourceEnvironment: { SAFE_FLAG: "yes" } };

  const blocked = await testEnvironment.prepare(request);
  assert.equal(blocked.status, "blocked");
  assert.equal(blocked.environment, undefined);

  const released = containment.release({ repositoryRoot: target.repositoryRoot, reason: "isolated test release", reauthenticated: true, incidentStatus: "not_required" });
  assert.equal(released.status, "released");
  const afterRelease = await testEnvironment.prepare(request);
  assert.equal(afterRelease.status, "completed");
  assert.equal(afterRelease.environment?.id, "test-1");
});

test("unavailable high-risk adapters fail closed instead of pretending to isolate or automate", async () => {
  const highAction = commandForAction("full_sandbox");
  const policy = new PolicyEngine({
    version: "policy-1", now: () => new Date(now), highConsequenceActions: [highAction.action],
    gateEvidence: Object.fromEntries(highAction.acceptanceGates.map((gate) => [gate, "passed"]))
  });
  const confirmation = policy.createConfirmation({ action: highAction.action, targetSnapshotId: target.id, sessionId: session.id, authorityId: grant(highAction.action).id, reason: "test", reauthenticated: true });
  const permit = policy.issuePermit({ definition: highAction, target, session, authority: grant(highAction.action), operationId: "op-isolation", confirmationToken: confirmation.token }).permit;
  assert.ok(permit);
  const isolation = new UnavailableIsolationRuntime(policy);
  const outcome = await isolation.start({ action: highAction.action, operationId: "op-isolation", target, session, authority: grant(highAction.action), permit, profile: "full_sandbox" });
  assert.equal(outcome.status, "unavailable");

  const automation = new InMemoryAutomationBroker(policy);
  const lfg = await automation.execute({ action: "lfg", operationId: "op-lfg", target, session, authority: grant("lfg"), permit: undefined });
  assert.equal(lfg.status, "blocked");
});

test("active containment fences automation before a registered automation handler", async () => {
  const capture = permitted("compound_capture");
  const containment = new InMemoryContainmentManager();
  containment.activate({ repositoryRoot: target.repositoryRoot, operationId: "containment", reason: "test" });
  const automation = new InMemoryAutomationBroker(capture.policy, containment);
  let calls = 0;
  automation.register("compound_capture", () => { calls += 1; return { status: "completed", summary: "must not run" }; });

  const result = await automation.execute(capture.invocation);
  assert.equal(result.status, "blocked");
  assert.equal(calls, 0);
});

test("a live broker permit cannot be replayed under another durable operation or authority", async () => {
  const { policy, invocation } = permitted("run_target");
  const broker = new InMemoryExecutionBroker(policy);
  let executions = 0;
  broker.register("run_target", () => { executions += 1; return { status: "completed", summary: "isolated run" }; });
  const request = { ...invocation, recipe: { id: "run_target", executable: "node", args: ["app.js"], workingDirectory: target.repositoryRoot, environment: {} } };
  assert.equal((await broker.execute(request)).status, "completed");
  assert.equal((await broker.execute({ ...request, operationId: "op-replay" })).status, "blocked");
  assert.equal((await broker.execute({ ...request, authority: { ...grant("run_target"), id: "other-authority" } })).status, "blocked");
  assert.equal(executions, 1);
});
