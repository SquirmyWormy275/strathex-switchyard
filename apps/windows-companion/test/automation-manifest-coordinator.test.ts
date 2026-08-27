import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { AuthorityLedger } from "../../../packages/control-plane/src/authority.ts";
import type { ManagedSession, TargetSnapshot } from "../../../packages/control-plane/src/contracts.ts";
import { SessionRegistry } from "../../../packages/control-plane/src/session-registry.ts";
import { ProtectedJsonStore } from "../../../packages/control-plane/src/store.ts";
import type { AutomationOperationProposal } from "../../../packages/control-plane/src/automation-operation-manifest.ts";
import { InstalledAutomationManifestCoordinator } from "../src/automation-manifest-coordinator.ts";
import { DurableAutomationManifestReviewQueue } from "../src/automation-manifest-review.ts";

const d = (value: string): string => value.repeat(64);
const exactContent = (value: string) => {
  const bytes = Buffer.from(value, "utf8");
  return {
    afterDigest: createHash("sha256").update(bytes).digest("hex"),
    content: { encoding: "base64" as const, byteLength: bytes.length, data: bytes.toString("base64") }
  };
};
const now = { value: "2026-08-26T13:00:00.000Z" };
const target: TargetSnapshot = {
  id: d("1"), repositoryRoot: "C:\\repo", canonicalRemote: "https://github.com/acme/repo.git", branch: "feat/automation",
  defaultBranch: "main", head: "2".repeat(40), indexTree: "3".repeat(40), trackedManifest: d("4"), untrackedManifest: d("5"),
  submodules: {}, policyVersion: "test", environmentFingerprint: d("6"), capturedAt: now.value, completeness: "complete", reasons: []
};
const session: ManagedSession = {
  id: "managed-automation", provider: "codex", surface: "vscode_terminal", capabilities: ["registered", "observable", "controllable", "mediated"],
  status: "running", workspaceRoot: target.repositoryRoot, targetSnapshotId: target.id, taskId: "task", planRevision: "plan", plannedFiles: ["docs/learning.md"],
  lastHeartbeat: now.value, adapterVersion: "provider-v1", metadata: {}
};
const proposal: AutomationOperationProposal = {
  kind: "compound_capture", solvedProblemEvidenceDigest: d("7"), verifiedOutcomeEvidenceDigest: d("8"), nonTrivialRationale: "Verified durable resolution.",
  documents: [{ path: "docs/learning.md", mutation: "create", beforeDigest: null, ...exactContent("# Durable learning\n") }], instructionFileMutation: { kind: "none" }
};

async function setup(context: { after(callback: () => Promise<void>): void }) {
  const root = await mkdtemp(join(tmpdir(), "b122-automation-coordinator-"));
  context.after(async () => { await rm(root, { recursive: true, force: true }); });
  const store = new ProtectedJsonStore({ filePath: join(root, "journal.jsonl"), clock: () => now.value });
  const sessions = new SessionRegistry(store, { clock: () => now.value });
  await sessions.upsert(session);
  const authorities = new AuthorityLedger(store, { clock: () => now.value });
  const authority = await authorities.issue({ repositoryRoot: target.repositoryRoot, sessionId: session.id, taskId: session.taskId, planRevision: session.planRevision, allowedActions: ["compound_capture"], prohibitedActions: [], expiresAt: "2026-08-26T13:10:00.000Z", issuedBy: "TEST\\operator" });
  const resolved = { value: target };
  const resolver = { async resolve() { return resolved.value; } };
  const queue = new DurableAutomationManifestReviewQueue({ store, sessions, authorities, targetResolver: resolver, now: () => new Date(now.value) });
  const calls: unknown[] = [];
  const source = { async propose(input: unknown) { calls.push(input); return proposal; } };
  const containment = { async check() { return { allowed: true, reason: "clear" }; } };
  const coordinator = new InstalledAutomationManifestCoordinator({ sessions, authorities, targetResolver: resolver, queue, source, containment, now: () => new Date(now.value) });
  return { coordinator, authority, resolved, calls, sessions, authorities, queue, source, containment };
}

test("installed proposal coordinator observes an exact protected binding and returns an inert review manifest", async (context) => {
  const fixture = await setup(context);
  const result = await fixture.coordinator.prepare({ action: "compound_capture", sessionId: session.id, authorityId: fixture.authority.id });
  assert.equal(result.status, "prepared");
  assert.equal(result.manifest?.proposal.kind, "compound_capture");
  assert.match(result.reviewScopeDigest!, /^[a-f0-9]{64}$/);
  assert.equal(fixture.calls.length, 1);
  assert.deepEqual(fixture.calls[0], { action: "compound_capture", target, session, authority: fixture.authority });
});

test("proposal preparation fences containment and rejects target churn after provider observation", async (context) => {
  const fixture = await setup(context);
  const denied = new InstalledAutomationManifestCoordinator({
    sessions: fixture.sessions, authorities: fixture.authorities, targetResolver: { async resolve() { return target; } }, queue: fixture.queue, source: fixture.source,
    containment: { async check() { return { allowed: false, reason: "contained" }; } }, now: () => new Date(now.value)
  });
  assert.equal((await denied.prepare({ action: "compound_capture", sessionId: session.id, authorityId: fixture.authority.id })).status, "blocked");
  assert.equal(fixture.calls.length, 0);

  const changed = { ...target, id: d("a"), head: "b".repeat(40) };
  const churningSource = { async propose() { fixture.resolved.value = changed; return proposal; } };
  const churning = new InstalledAutomationManifestCoordinator({
    sessions: fixture.sessions, authorities: fixture.authorities, targetResolver: { async resolve() { return fixture.resolved.value; } }, queue: fixture.queue,
    source: churningSource, containment: fixture.containment, now: () => new Date(now.value)
  });
  assert.notEqual((await churning.prepare({ action: "compound_capture", sessionId: session.id, authorityId: fixture.authority.id })).status, "prepared");
});

test("proposal preparation fails closed for an absent source or unmediated current session", async (context) => {
  const fixture = await setup(context);
  const absent = new InstalledAutomationManifestCoordinator({
    sessions: fixture.sessions, authorities: fixture.authorities, targetResolver: { async resolve() { return target; } }, queue: fixture.queue,
    containment: fixture.containment, now: () => new Date(now.value)
  });
  assert.equal((await absent.prepare({ action: "compound_capture", sessionId: session.id, authorityId: fixture.authority.id })).status, "unavailable");
  await fixture.sessions.setCapabilities(session.id, ["registered", "observable", "controllable"]);
  assert.equal((await fixture.coordinator.prepare({ action: "compound_capture", sessionId: session.id, authorityId: fixture.authority.id })).status, "blocked");
});
