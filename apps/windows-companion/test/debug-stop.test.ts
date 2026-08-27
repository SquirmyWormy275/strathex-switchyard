import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { AuthorityLedger } from "../../../packages/control-plane/src/authority.ts";
import type { ManagedSession, OperationState, TargetSnapshot } from "../../../packages/control-plane/src/contracts.ts";
import { OperationSagaStore } from "../../../packages/control-plane/src/operations.ts";
import { SessionRegistry } from "../../../packages/control-plane/src/session-registry.ts";
import { targetSnapshotDigest } from "../../../packages/control-plane/src/snapshot.ts";
import { ProtectedJsonStore, type JournalAuthenticator } from "../../../packages/control-plane/src/store.ts";
import { DurableDebugStopBindingStore } from "../src/debug-stop.ts";

const now = { value: "2026-08-26T18:00:00.000Z" };
const authenticator: JournalAuthenticator = {
  provider: "debug-stop-test",
  async seal(hash) { return `test:${hash}`; },
  async verify(hash, tag) { return tag === `test:${hash}`; }
};

const targetMaterial = {
  repositoryRoot: "C:\\work\\debug-repository",
  canonicalRemote: "https://github.com/acme/debug-repository.git",
  branch: "feat/debug-stop",
  defaultBranch: "main",
  head: "1".repeat(40),
  indexTree: "2".repeat(40),
  trackedManifest: "3".repeat(64),
  untrackedManifest: "4".repeat(64),
  submodules: {},
  policyVersion: "test-policy",
  environmentFingerprint: "5".repeat(64),
  completeness: "complete" as const,
  reasons: [] as const
};
const target: TargetSnapshot = { id: targetSnapshotDigest(targetMaterial), ...targetMaterial, capturedAt: now.value };

const sourceSession: ManagedSession = {
  id: "provider-source-1",
  provider: "codex",
  surface: "vscode_terminal",
  capabilities: ["registered", "observable", "controllable", "mediated"],
  status: "running",
  workspaceRoot: target.repositoryRoot,
  targetSnapshotId: target.id,
  taskId: "task-debug",
  planRevision: "plan-debug",
  plannedFiles: ["src/server.ts"],
  lastHeartbeat: now.value,
  adapterVersion: "provider-host-v1",
  metadata: { "sxsy-b122.provider-session": "true" }
};

function effectSession(overrides: Partial<ManagedSession> = {}): ManagedSession {
  const base: ManagedSession = {
    id: "vscode-window:debug-session:managed-1",
    provider: "generic",
    surface: "vscode_window",
    capabilities: ["registered"],
    status: "running",
    workspaceRoot: target.repositoryRoot,
    targetSnapshotId: target.id,
    plannedFiles: [],
    lastHeartbeat: now.value,
    adapterVersion: "switchyard-vscode-v1",
    metadata: {
      "sxsy-b122.kind": "debug-session",
      "sxsy-b122.debugSessionId": "vscode-debug-1",
      "sxsy-b122.debugOriginOperationId": "operation-debug-origin",
      "sxsy-b122.debugOriginSessionId": sourceSession.id,
      "sxsy-b122.debugWorkspaceRoot": target.repositoryRoot,
      "sxsy-b122.debugConfiguration": "Launch API",
      "sxsy-b122.debugBindingId": "host-action-debug-1"
    }
  };
  return {
    ...base,
    ...overrides,
    metadata: overrides.metadata ?? base.metadata
  };
}

function managedRunSession(overrides: Partial<ManagedSession> = {}): ManagedSession {
  const base: ManagedSession = {
    id: "vscode-window:managed-run:managed-1",
    provider: "generic",
    surface: "vscode_window",
    capabilities: ["registered"],
    status: "running",
    workspaceRoot: target.repositoryRoot,
    targetSnapshotId: target.id,
    plannedFiles: [],
    lastHeartbeat: now.value,
    adapterVersion: "switchyard-vscode-v1",
    metadata: {
      "sxsy-b122.kind": "managed-run",
      "sxsy-b122.managedProcessId": `managed:${"8".repeat(64)}`,
      "sxsy-b122.runOriginOperationId": "operation-debug-origin",
      "sxsy-b122.runOriginSessionId": sourceSession.id,
      "sxsy-b122.runWorkspaceRoot": target.repositoryRoot
    }
  };
  return { ...base, ...overrides, metadata: overrides.metadata ?? base.metadata };
}

interface FixtureOptions {
  readonly source?: ManagedSession;
  readonly effect?: ManagedSession;
  readonly originAction?: string;
  readonly originTargetSnapshotId?: string;
  readonly originSessionId?: string;
  readonly originState?: OperationState;
  readonly target?: TargetSnapshot;
  readonly authenticated?: boolean;
}

async function fixture(context: { after(callback: () => Promise<void>): void }, options: FixtureOptions = {}) {
  const directory = await mkdtemp(join(tmpdir(), "b122-debug-stop-"));
  context.after(async () => { await rm(directory, { recursive: true, force: true }); });
  const store = new ProtectedJsonStore({
    filePath: join(directory, "protected.jsonl"),
    clock: () => now.value,
    ...(options.authenticated === false ? {} : { authenticator }),
    requireAuthenticatedProtection: options.authenticated !== false
  });
  const sessions = new SessionRegistry(store, { clock: () => now.value });
  const exactSource = await sessions.upsert(options.source ?? sourceSession);
  const exactEffect = await sessions.upsert(options.effect ?? effectSession());
  const authorities = new AuthorityLedger(store, { clock: () => now.value, idFactory: () => "authority-debug-stop" });
  const authority = await authorities.issue({
    repositoryRoot: target.repositoryRoot,
    sessionId: exactSource.id,
    taskId: exactSource.taskId,
    planRevision: exactSource.planRevision,
    allowedActions: ["stop_managed_run"],
    prohibitedActions: [],
    expiresAt: "2026-08-26T18:10:00.000Z",
    issuedBy: "TEST\\operator"
  });
  const operations = new OperationSagaStore(store, { clock: () => now.value, idFactory: () => "operation-debug-origin" });
  const begun = await operations.begin({
    id: "operation-debug-origin",
    idempotencyKey: "debug-origin-key",
    action: options.originAction ?? "debug_target",
    targetSnapshotId: options.originTargetSnapshotId ?? target.id,
    details: { sessionId: options.originSessionId ?? exactSource.id }
  });
  const terminal = options.originState ?? "recorded";
  if (terminal !== "prepared") await operations.advance(begun.operation.id, "executing");
  if (["external_committed", "recorded"].includes(terminal)) await operations.advance(begun.operation.id, "external_committed");
  if (terminal === "recorded") await operations.advance(begun.operation.id, "recorded");
  if (terminal === "failed") await operations.advance(begun.operation.id, "failed");
  if (terminal === "cancelling") await operations.advance(begun.operation.id, "cancelling");
  const resolved = { value: options.target ?? target };
  let id = 0;
  const create = () => new DurableDebugStopBindingStore({
    store,
    sessions,
    targetResolver: { async resolve() { return resolved.value; } },
    now: () => new Date(now.value),
    idFactory: () => `binding-nonce-${++id}`
  });
  return { store, sessions, authorities, operations, authority, source: exactSource, effect: exactEffect, resolved, create };
}

test("preparation binds an exact provider source to one hidden debug effect and claim consumes it once across restart", async (context) => {
  const setup = await fixture(context);
  const prepared = await setup.create().prepare({
    sourceSessionId: setup.source.id,
    effectSessionId: setup.effect.id,
    authorityId: setup.authority.id
  });

  assert.equal(prepared.binding.action, "stop_managed_run");
  assert.equal(prepared.binding.sourceSessionId, setup.source.id);
  assert.equal(prepared.binding.effectSessionId, setup.effect.id);
  assert.equal(prepared.binding.targetSnapshotId, target.id);
  assert.equal(prepared.binding.originOperationId, "operation-debug-origin");
  assert.equal(prepared.binding.effectKind, "debug_session");
  assert.equal(prepared.binding.debugSessionId, "vscode-debug-1");
  assert.equal(prepared.binding.debugBindingId, "host-action-debug-1");
  assert.match(prepared.reviewScopeDigest, /^[a-f0-9]{64}$/);

  const publicClaim = {
    bindingId: prepared.binding.id,
    reviewScopeDigest: prepared.reviewScopeDigest,
    sourceSessionId: setup.source.id,
    authorityId: setup.authority.id,
    target
  };
  assert.equal(Object.hasOwn(publicClaim, "effectSessionId"), false, "dispatch cannot inject the hidden effect session id");
  await setup.sessions.heartbeat(setup.source.id, "2026-08-26T18:00:10.000Z");
  await setup.sessions.heartbeat(setup.effect.id, "2026-08-26T18:00:10.000Z");
  const claimed = await setup.create().claim(publicClaim);
  assert.equal(claimed.sourceSession.id, setup.source.id);
  assert.equal(claimed.effectSession.id, setup.effect.id);
  assert.equal(claimed.effectSession.lastHeartbeat, "2026-08-26T18:00:10.000Z", "a newer healthy heartbeat does not invalidate immutable effect identity");
  assert.equal(claimed.binding.id, prepared.binding.id);
  await assert.rejects(() => setup.create().claim(publicClaim), /consumed|replay/i);
});

test("the same protected split-binding lifecycle selects one exact managed Run process tree", async (context) => {
  const setup = await fixture(context, { effect: managedRunSession(), originAction: "run_target" });
  const prepared = await setup.create().prepare({ sourceSessionId: setup.source.id, effectSessionId: setup.effect.id, authorityId: setup.authority.id });
  assert.equal(prepared.binding.effectKind, "managed_run");
  assert.equal(prepared.binding.managedProcessId, `managed:${"8".repeat(64)}`);
  assert.equal(prepared.binding.debugSessionId, null);
  assert.equal(prepared.binding.originOperationId, "operation-debug-origin");
  const reviewed = await setup.create().inspect({
    bindingId: prepared.binding.id,
    bindingDigest: (await import("../src/debug-stop.ts")).debugStopBindingDigest(prepared.binding),
    reviewScopeDigest: prepared.reviewScopeDigest,
    sourceSessionId: setup.source.id
  });
  assert.equal(reviewed?.effectKind, "managed_run");
  assert.equal(reviewed?.managedProcessId, `managed:${"8".repeat(64)}`);
  const claimed = await setup.create().claim({
    bindingId: prepared.binding.id,
    reviewScopeDigest: prepared.reviewScopeDigest,
    sourceSessionId: setup.source.id,
    authorityId: setup.authority.id,
    target
  });
  assert.equal(claimed.effectSession.id, setup.effect.id);
});

test("review expiry is exact at the boundary and never consumes an expired binding", async (context) => {
  const setup = await fixture(context);
  const prepared = await setup.create().prepare({ sourceSessionId: setup.source.id, effectSessionId: setup.effect.id, authorityId: setup.authority.id });
  const input = { bindingId: prepared.binding.id, reviewScopeDigest: prepared.reviewScopeDigest, sourceSessionId: setup.source.id, authorityId: setup.authority.id, target };
  now.value = new Date(Date.parse(prepared.binding.expiresAt) - 1).toISOString();
  assert.ok(await setup.create().inspect({ bindingId: prepared.binding.id, bindingDigest: (await import("../src/debug-stop.ts")).debugStopBindingDigest(prepared.binding), reviewScopeDigest: prepared.reviewScopeDigest, sourceSessionId: setup.source.id }));
  now.value = prepared.binding.expiresAt;
  assert.equal(await setup.create().inspect({ bindingId: prepared.binding.id, bindingDigest: (await import("../src/debug-stop.ts")).debugStopBindingDigest(prepared.binding), reviewScopeDigest: prepared.reviewScopeDigest, sourceSessionId: setup.source.id }), undefined);
  await assert.rejects(() => setup.create().claim(input), /expired/i);
  now.value = "2026-08-26T18:00:00.000Z";
});

test("preparation rejects non-provider sources and malformed, substituted, or ambiguous debug effects", async (context) => {
  const wrongSource = await fixture(context, { source: { ...sourceSession, provider: "generic" } });
  await assert.rejects(() => wrongSource.create().prepare({ sourceSessionId: wrongSource.source.id, effectSessionId: wrongSource.effect.id, authorityId: wrongSource.authority.id }), /source.*provider/i);

  const cases: readonly [string, Partial<ManagedSession>][] = [
    ["wrong status", { status: "verified_finished", capabilities: ["registered", "observable"] }],
    ["wrong provider", { provider: "codex" }],
    ["wrong surface", { surface: "vscode_terminal" }],
    ["wrong root", { workspaceRoot: "C:\\work\\other" }],
    ["wrong target", { targetSnapshotId: "a".repeat(64) }],
    ["wrong kind", { metadata: { ...effectSession().metadata, "sxsy-b122.kind": "debug-configuration" } }],
    ["wrong origin source", { metadata: { ...effectSession().metadata, "sxsy-b122.debugOriginSessionId": "other-source" } }],
    ["wrong origin operation", { metadata: { ...effectSession().metadata, "sxsy-b122.debugOriginOperationId": "missing-operation" } }],
    ["missing debug binding", { metadata: { ...effectSession().metadata, "sxsy-b122.debugBindingId": "" } }]
  ];
  for (const [label, override] of cases) {
    const setup = await fixture(context, { effect: effectSession(override) });
    await assert.rejects(
      () => setup.create().prepare({ sourceSessionId: setup.source.id, effectSessionId: setup.effect.id, authorityId: setup.authority.id }),
      /debug|effect|origin|registered|target|repository/i,
      label
    );
  }

  const ambiguous = await fixture(context);
  await ambiguous.sessions.upsert({ ...effectSession(), id: "second-managed-debug-effect" });
  await assert.rejects(
    () => ambiguous.create().prepare({ sourceSessionId: ambiguous.source.id, effectSessionId: ambiguous.effect.id, authorityId: ambiguous.authority.id }),
    /ambiguous|duplicate/i
  );
});

test("preparation requires the exact committed debug origin and exact scoped authority", async (context) => {
  for (const [label, options] of [
    ["wrong action", { originAction: "run_target" }],
    ["wrong target", { originTargetSnapshotId: "b".repeat(64) }],
    ["wrong source", { originSessionId: "other-source" }],
    ["not started", { originState: "prepared" as const }],
    ["failed", { originState: "failed" as const }],
    ["cancelling", { originState: "cancelling" as const }]
  ] as const) {
    const setup = await fixture(context, options);
    await assert.rejects(
      () => setup.create().prepare({ sourceSessionId: setup.source.id, effectSessionId: setup.effect.id, authorityId: setup.authority.id }),
      /origin|debug_target|committed|target|source/i,
      label
    );
  }

  const acknowledgedEffectWithPendingOriginReceipt = await fixture(context, { originState: "executing" });
  const pendingPrepared = await acknowledgedEffectWithPendingOriginReceipt.create().prepare({
    sourceSessionId: acknowledgedEffectWithPendingOriginReceipt.source.id,
    effectSessionId: acknowledgedEffectWithPendingOriginReceipt.effect.id,
    authorityId: acknowledgedEffectWithPendingOriginReceipt.authority.id
  });
  await acknowledgedEffectWithPendingOriginReceipt.operations.advance("operation-debug-origin", "external_committed");
  assert.ok(await acknowledgedEffectWithPendingOriginReceipt.create().claim({
    bindingId: pendingPrepared.binding.id,
    reviewScopeDigest: pendingPrepared.reviewScopeDigest,
    sourceSessionId: acknowledgedEffectWithPendingOriginReceipt.source.id,
    authorityId: acknowledgedEffectWithPendingOriginReceipt.authority.id,
    target
  }), "safe forward lifecycle progress does not change the immutable origin binding");

  const revoked = await fixture(context);
  await revoked.authorities.revoke(revoked.authority.id, "test revocation");
  await assert.rejects(
    () => revoked.create().prepare({ sourceSessionId: revoked.source.id, effectSessionId: revoked.effect.id, authorityId: revoked.authority.id }),
    /authority.*revoked/i
  );
});

test("claim re-derives the hidden effect and rejects target, source, effect, origin, and authority churn without consuming", async (context) => {
  const setup = await fixture(context);
  const prepared = await setup.create().prepare({ sourceSessionId: setup.source.id, effectSessionId: setup.effect.id, authorityId: setup.authority.id });
  const input = {
    bindingId: prepared.binding.id,
    reviewScopeDigest: prepared.reviewScopeDigest,
    sourceSessionId: setup.source.id,
    authorityId: setup.authority.id,
    target
  };

  setup.resolved.value = { ...target, id: targetSnapshotDigest({ ...targetMaterial, head: "f".repeat(40) }), head: "f".repeat(40) };
  await assert.rejects(() => setup.create().claim(input), /target.*changed|current target|no longer binds.*target/i);
  setup.resolved.value = target;

  await setup.sessions.updateBinding(setup.effect.id, { metadata: { ...setup.effect.metadata, "sxsy-b122.debugConfiguration": "Changed Launch" } });
  await assert.rejects(() => setup.create().claim(input), /effect|binding|changed/i);

  await setup.sessions.updateBinding(setup.effect.id, { metadata: setup.effect.metadata });
  await setup.sessions.updateBinding(setup.source.id, { planRevision: "plan-changed" });
  await assert.rejects(() => setup.create().claim(input), /source|binding|authority/i);
});

test("forged claim scope and unprotected durable state fail closed", async (context) => {
  const setup = await fixture(context);
  const prepared = await setup.create().prepare({ sourceSessionId: setup.source.id, effectSessionId: setup.effect.id, authorityId: setup.authority.id });
  await assert.rejects(() => setup.create().claim({
    bindingId: prepared.binding.id,
    reviewScopeDigest: "f".repeat(64),
    sourceSessionId: setup.source.id,
    authorityId: setup.authority.id,
    target
  }), /review scope|binding/i);

  const directory = await mkdtemp(join(tmpdir(), "b122-debug-stop-unprotected-"));
  context.after(async () => { await rm(directory, { recursive: true, force: true }); });
  const unprotectedStore = new ProtectedJsonStore({ filePath: join(directory, "journal.jsonl") });
  assert.throws(() => new DurableDebugStopBindingStore({
    store: unprotectedStore,
    sessions: new SessionRegistry(unprotectedStore),
    targetResolver: { async resolve() { return target; } }
  }), /authenticated.*protection/i);
});

test("claim rejects public effect injection, ended effects, origin churn, authority churn, and concurrent replay", async (context) => {
  const setup = await fixture(context);
  const prepared = await setup.create().prepare({ sourceSessionId: setup.source.id, effectSessionId: setup.effect.id, authorityId: setup.authority.id });
  const input = {
    bindingId: prepared.binding.id,
    reviewScopeDigest: prepared.reviewScopeDigest,
    sourceSessionId: setup.source.id,
    authorityId: setup.authority.id,
    target
  };
  const injected = { ...input, effectSessionId: setup.effect.id } as unknown as Parameters<DurableDebugStopBindingStore["claim"]>[0];
  await assert.rejects(
    () => setup.create().claim(injected),
    /closed exact field set/i,
    "a dispatch payload cannot inject even the correct hidden effect id"
  );

  await setup.sessions.setStatus(setup.effect.id, "unreachable");
  await assert.rejects(() => setup.create().claim(input), /effect.*running|debug effect/i);
  await setup.sessions.setStatus(setup.effect.id, "running");

  await setup.operations.advance("operation-debug-origin", "recorded", { sessionId: "substituted-source" });
  await assert.rejects(() => setup.create().claim(input), /origin.*source|binding changed/i);
  await setup.operations.advance("operation-debug-origin", "recorded", { sessionId: setup.source.id });

  await setup.authorities.revoke(setup.authority.id, "containment test");
  await assert.rejects(() => setup.create().claim(input), /authority.*revoked/i);

  const concurrent = await fixture(context);
  const second = await concurrent.create().prepare({ sourceSessionId: concurrent.source.id, effectSessionId: concurrent.effect.id, authorityId: concurrent.authority.id });
  const exact = {
    bindingId: second.binding.id,
    reviewScopeDigest: second.reviewScopeDigest,
    sourceSessionId: concurrent.source.id,
    authorityId: concurrent.authority.id,
    target
  };
  const claims = await Promise.allSettled(Array.from({ length: 8 }, () => concurrent.create().claim(exact)));
  assert.equal(claims.filter((claim) => claim.status === "fulfilled").length, 1);
  assert.equal(claims.filter((claim) => claim.status === "rejected").length, 7);
});
