import assert from "node:assert/strict";
import test from "node:test";
import type { AuthorityGrant, ManagedSession, TargetSnapshot } from "../src/contracts.ts";
import { commandForAction } from "../src/command-catalog.ts";
import { PolicyEngine } from "../src/policy.ts";

const now = "2026-08-23T12:00:00.000Z";

const target = (completeness: TargetSnapshot["completeness"] = "complete"): TargetSnapshot => ({
  id: "snapshot-1",
  repositoryRoot: "C:/work/example",
  canonicalRemote: "https://github.com/example/repo.git",
  branch: "feature/safe",
  head: "abc123",
  indexTree: "tree123",
  trackedManifest: "tracked",
  untrackedManifest: "untracked",
  submodules: {},
  policyVersion: "policy-1",
  environmentFingerprint: "env-1",
  capturedAt: now,
  completeness,
  reasons: completeness === "complete" ? [] : ["untracked file could not be classified"]
});

const mediatedSession = (): ManagedSession => ({
  id: "session-1",
  provider: "codex",
  surface: "vscode_terminal",
  capabilities: ["registered", "observable", "controllable", "mediated"],
  status: "running",
  workspaceRoot: "C:/work/example",
  targetSnapshotId: "snapshot-1",
  taskId: "task-1",
  planRevision: "plan-1",
  plannedFiles: ["src/a.ts"],
  lastHeartbeat: now,
  adapterVersion: "test",
  metadata: {}
});

const authority = (action: string): AuthorityGrant => ({
  id: "authority-1",
  repositoryRoot: "C:/work/example",
  sessionId: "session-1",
  taskId: "task-1",
  planRevision: "plan-1",
  allowedActions: [action],
  prohibitedActions: [],
  expiresAt: "2026-08-24T12:00:00.000Z",
  issuedAt: now,
  issuedBy: "user"
});

test("policy requires a mediated capability and matching scoped authority for a mutation", () => {
  const definition = commandForAction("local_commit");
  const policy = new PolicyEngine({ version: "policy-1", now: () => new Date(now) });
  const managedOnly = { ...mediatedSession(), capabilities: ["registered", "observable"] as const };

  assert.equal(policy.authorize({ definition, target: target(), session: managedOnly, authority: authority(definition.action) }).status, "blocked");
  assert.equal(policy.authorize({ definition, target: target(), session: mediatedSession(), authority: authority(definition.action) }).status, "allowed");
});

test("untrusted request input cannot enable a high-consequence action", () => {
  const definition = commandForAction("direct_main");
  const policy = new PolicyEngine({ version: "policy-1", now: () => new Date(now) });

  const decision = policy.authorize({
    definition,
    target: target(),
    session: mediatedSession(),
    authority: authority(definition.action),
    // This models attacker-controlled repository/log/request content. Policy deliberately ignores it.
    untrustedInput: { acceptanceGates: "passed", enableHighConsequence: "true" }
  });
  assert.equal(decision.status, "blocked");
  assert.match(decision.reason, /not enabled/i);
});

test("high-consequence permissions need trusted gate evidence and a one-time reauthenticated confirmation", () => {
  const definition = commandForAction("council_automatic");
  const policy = new PolicyEngine({
    version: "policy-1",
    now: () => new Date(now),
    highConsequenceActions: [definition.action],
    gateEvidence: Object.fromEntries(definition.acceptanceGates.map((gate) => [gate, "passed"])),
    requireReauthenticationForHighConsequence: true
  });
  const subject = { definition, target: target(), session: mediatedSession(), authority: authority(definition.action), operationId: "operation-council" };

  assert.equal(policy.authorize(subject).status, "awaiting_confirmation");
  const confirmation = policy.createConfirmation({
    action: definition.action,
    targetSnapshotId: target().id,
    authorityId: authority(definition.action).id,
    sessionId: mediatedSession().id,
    reason: "Review guarded coordination",
    reauthenticated: true
  });
  const permitted = policy.issuePermit({ ...subject, confirmationToken: confirmation.token });
  assert.equal(permitted.status, "allowed");
  assert.ok(permitted.permit);
  assert.equal(policy.verifyPermit(permitted.permit, {
    action: definition.action, operationId: "operation-council", targetSnapshotId: target().id,
    sessionId: mediatedSession().id, authorityId: authority(definition.action).id
  }), true);

  // The confirmation was consumed to create the permit and cannot be replayed.
  assert.equal(policy.issuePermit({ ...subject, confirmationToken: confirmation.token }).status, "blocked");
});

test("policy rejects authority that is scoped to a different selected task or plan revision", () => {
  const definition = commandForAction("local_commit");
  const policy = new PolicyEngine({ version: "policy-1", now: () => new Date(now) });
  assert.equal(policy.authorize({
    definition, target: target(), session: mediatedSession(), authority: { ...authority(definition.action), taskId: "task-other" }
  }).status, "blocked");
  assert.equal(policy.authorize({
    definition, target: target(), session: mediatedSession(), authority: { ...authority(definition.action), planRevision: "plan-other" }
  }).status, "blocked");
});

test("incomplete target snapshots block gate-bearing work even with valid authority", () => {
  const definition = commandForAction("release_shield");
  const policy = new PolicyEngine({ version: "policy-1", now: () => new Date(now) });
  const decision = policy.authorize({
    definition,
    target: target("incomplete"),
    session: mediatedSession(),
    authority: authority(definition.action)
  });
  assert.equal(decision.status, "incomplete");
  assert.match(decision.reason, /complete TargetSnapshot/i);
});
