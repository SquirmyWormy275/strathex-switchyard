import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { AuthorityLedger } from "../../../packages/control-plane/src/authority.ts";
import type { BrokerConfirmation } from "../../../packages/control-plane/src/brokers.ts";
import type { ManagedSession, TargetSnapshot } from "../../../packages/control-plane/src/contracts.ts";
import { SessionRegistry } from "../../../packages/control-plane/src/session-registry.ts";
import { ProtectedJsonStore } from "../../../packages/control-plane/src/store.ts";
import type { AutomationOperationProposal } from "../../../packages/control-plane/src/automation-operation-manifest.ts";
import { DurableAutomationManifestReviewQueue } from "../src/automation-manifest-review.ts";

const digest = (character: string): string => character.repeat(64);
const exactContent = (value: string) => {
  const bytes = Buffer.from(value, "utf8");
  return {
    afterDigest: createHash("sha256").update(bytes).digest("hex"),
    content: { encoding: "base64" as const, byteLength: bytes.length, data: bytes.toString("base64") }
  };
};
const now = { value: "2026-08-26T12:00:00.000Z" };
const target: TargetSnapshot = {
  id: digest("1"), repositoryRoot: "C:\\work\\repo", canonicalRemote: "https://github.com/acme/repo.git",
  branch: "feat/automation", defaultBranch: "main", head: "2".repeat(40), indexTree: "3".repeat(40),
  trackedManifest: digest("4"), untrackedManifest: digest("5"), submodules: {}, policyVersion: "test",
  environmentFingerprint: digest("6"), capturedAt: now.value, completeness: "complete", reasons: []
};
const session: ManagedSession = {
  id: "automation-session", provider: "codex", surface: "vscode_terminal",
  capabilities: ["registered", "observable", "controllable", "mediated"], status: "running",
  workspaceRoot: target.repositoryRoot, targetSnapshotId: target.id, taskId: "task-automation", planRevision: "plan-automation",
  plannedFiles: ["docs/solutions/learning.md"], lastHeartbeat: now.value, adapterVersion: "installed-provider-v1", metadata: {}
};
const proposal: AutomationOperationProposal = {
  kind: "compound_refresh",
  audit: ["drift", "overlap", "supersession", "contradiction"],
  mutations: [{ path: "docs/solutions/learning.md", mutation: "update", beforeDigest: digest("7"), ...exactContent("# Refreshed learning\n") }],
  commit: {
    planned: true,
    message: "Refresh durable learning",
    messageDigest: createHash("sha256").update("Refresh durable learning", "utf8").digest("hex")
  }
};

async function setup(context: { after(callback: () => Promise<void>): void }, options: Readonly<{ mediated?: boolean; target?: TargetSnapshot }> = {}) {
  const directory = await mkdtemp(join(tmpdir(), "b122-automation-review-"));
  context.after(async () => { await rm(directory, { recursive: true, force: true }); });
  const store = new ProtectedJsonStore({ filePath: join(directory, "journal.jsonl"), clock: () => now.value });
  const sessions = new SessionRegistry(store, { clock: () => now.value });
  const selected = await sessions.upsert({ ...session, capabilities: options.mediated === false ? ["registered", "observable", "controllable"] : session.capabilities });
  const authorities = new AuthorityLedger(store, { clock: () => now.value });
  const authority = await authorities.issue({
    repositoryRoot: target.repositoryRoot, sessionId: selected.id, taskId: selected.taskId, planRevision: selected.planRevision,
    allowedActions: ["compound_refresh"], prohibitedActions: [], expiresAt: "2026-08-26T12:10:00.000Z", issuedBy: "TEST\\operator"
  });
  const resolved = { value: options.target ?? target };
  const queue = new DurableAutomationManifestReviewQueue({
    store, sessions, authorities, targetResolver: { async resolve() { return resolved.value; } }, now: () => new Date(now.value)
  });
  return { store, sessions, authorities, authority, queue, resolved, selected };
}

function confirmation(input: Readonly<{ digest: string; scope: string; authorityId: string }>): BrokerConfirmation {
  return {
    currentUserConfirmed: true, confirmationDigest: input.digest, confirmationScopeDigest: input.scope,
    action: "compound_refresh", targetSnapshotId: target.id, sessionId: session.id, authorityId: input.authorityId
  };
}

test("prepared automation review is durably approved and consumed exactly once across restart", async (context) => {
  const fixture = await setup(context);
  const prepared = await fixture.queue.prepare({ action: "compound_refresh", sessionId: session.id, authorityId: fixture.authority.id, proposal });
  assert.equal(prepared.status, "prepared");
  assert.ok(prepared.manifest);
  const approved = await fixture.queue.approve({
    manifestId: prepared.manifest!.id,
    manifestDigest: prepared.manifest!.digest,
    reviewScopeDigest: prepared.reviewScopeDigest!,
    confirmationToken: "reviewed-current-user-token",
    confirmationExpiresAt: "2026-08-26T12:04:00.000Z"
  });
  assert.equal(approved.status, "approved");
  assert.ok(approved.approval);
  const exactConfirmation = confirmation({ digest: approved.approval!.confirmationDigest, scope: prepared.reviewScopeDigest!, authorityId: fixture.authority.id });
  const consumed = await fixture.queue.consume({ action: "compound_refresh", target, session: fixture.selected, authority: fixture.authority, confirmation: exactConfirmation });
  assert.equal(consumed?.manifest.id, prepared.manifest!.id);
  assert.equal(await fixture.queue.consume({ action: "compound_refresh", target, session: fixture.selected, authority: fixture.authority, confirmation: exactConfirmation }), undefined);
  const restarted = new DurableAutomationManifestReviewQueue({
    store: fixture.store, sessions: fixture.sessions, authorities: fixture.authorities,
    targetResolver: { async resolve() { return target; } }, now: () => new Date(now.value)
  });
  assert.equal(await restarted.consume({ action: "compound_refresh", target, session: fixture.selected, authority: fixture.authority, confirmation: exactConfirmation }), undefined);
});

test("automation review refuses unmediated sessions, incomplete targets, and absent exact authority", async (context) => {
  const unmediated = await setup(context, { mediated: false });
  assert.equal((await unmediated.queue.prepare({ action: "compound_refresh", sessionId: session.id, authorityId: unmediated.authority.id, proposal })).status, "blocked");

  const incomplete = await setup(context, { target: { ...target, id: digest("a"), completeness: "incomplete", reasons: ["untracked input unknown"] } });
  assert.equal((await incomplete.queue.prepare({ action: "compound_refresh", sessionId: session.id, authorityId: incomplete.authority.id, proposal })).status, "unavailable");

  const exact = await setup(context);
  assert.equal((await exact.queue.prepare({ action: "compound_refresh", sessionId: session.id, authorityId: "missing-authority", proposal })).status, "blocked");
});

test("approval fails closed after target, session, authority, or artifact churn", async (context) => {
  const fixture = await setup(context);
  const prepared = await fixture.queue.prepare({ action: "compound_refresh", sessionId: session.id, authorityId: fixture.authority.id, proposal });
  assert.ok(prepared.manifest && prepared.reviewScopeDigest);
  fixture.resolved.value = { ...target, id: digest("b"), head: "c".repeat(40) };
  const churned = await fixture.queue.approve({
    manifestId: prepared.manifest.id, manifestDigest: prepared.manifest.digest, reviewScopeDigest: prepared.reviewScopeDigest,
    confirmationToken: "reviewed-current-user-token", confirmationExpiresAt: "2026-08-26T12:04:00.000Z"
  });
  assert.equal(churned.status, "blocked");
  fixture.resolved.value = target;
  await fixture.authorities.revoke(fixture.authority.id, "test churn");
  assert.equal((await fixture.queue.approve({
    manifestId: prepared.manifest.id, manifestDigest: prepared.manifest.digest, reviewScopeDigest: prepared.reviewScopeDigest,
    confirmationToken: "reviewed-current-user-token", confirmationExpiresAt: "2026-08-26T12:04:00.000Z"
  })).status, "blocked");
  assert.equal((await fixture.queue.approve({
    manifestId: prepared.manifest.id, manifestDigest: digest("d"), reviewScopeDigest: prepared.reviewScopeDigest,
    confirmationToken: "reviewed-current-user-token", confirmationExpiresAt: "2026-08-26T12:04:00.000Z"
  })).status, "blocked");
});

test("consume rejects forged confirmation scope and actor bindings without burning the exact approval", async (context) => {
  const fixture = await setup(context);
  const prepared = await fixture.queue.prepare({ action: "compound_refresh", sessionId: session.id, authorityId: fixture.authority.id, proposal });
  const approved = await fixture.queue.approve({
    manifestId: prepared.manifest!.id, manifestDigest: prepared.manifest!.digest, reviewScopeDigest: prepared.reviewScopeDigest!,
    confirmationToken: "reviewed-current-user-token", confirmationExpiresAt: "2026-08-26T12:04:00.000Z"
  });
  const forged = confirmation({ digest: approved.approval!.confirmationDigest, scope: digest("e"), authorityId: fixture.authority.id });
  assert.equal(await fixture.queue.consume({ action: "compound_refresh", target, session: fixture.selected, authority: fixture.authority, confirmation: forged }), undefined);
  const exact = confirmation({ digest: approved.approval!.confirmationDigest, scope: prepared.reviewScopeDigest!, authorityId: fixture.authority.id });
  assert.ok(await fixture.queue.consume({ action: "compound_refresh", target, session: fixture.selected, authority: fixture.authority, confirmation: exact }));
});

test("concurrent consumers cannot replay one exact approved automation manifest", async (context) => {
  const fixture = await setup(context);
  const prepared = await fixture.queue.prepare({ action: "compound_refresh", sessionId: session.id, authorityId: fixture.authority.id, proposal });
  const approved = await fixture.queue.approve({
    manifestId: prepared.manifest!.id, manifestDigest: prepared.manifest!.digest, reviewScopeDigest: prepared.reviewScopeDigest!,
    confirmationToken: "reviewed-current-user-token", confirmationExpiresAt: "2026-08-26T12:04:00.000Z"
  });
  const exact = confirmation({ digest: approved.approval!.confirmationDigest, scope: prepared.reviewScopeDigest!, authorityId: fixture.authority.id });
  const results = await Promise.all(Array.from({ length: 8 }, () => fixture.queue.consume({ action: "compound_refresh", target, session: fixture.selected, authority: fixture.authority, confirmation: exact })));
  assert.equal(results.filter(Boolean).length, 1);
});
