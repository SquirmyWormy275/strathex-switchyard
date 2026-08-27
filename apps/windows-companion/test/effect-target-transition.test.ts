import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import type { ManagedSession, TargetSnapshot } from "../../../packages/control-plane/src/contracts.ts";
import { SessionRegistry } from "../../../packages/control-plane/src/session-registry.ts";
import { targetSnapshotDigest } from "../../../packages/control-plane/src/snapshot.ts";
import { TargetSnapshotLedger } from "../../../packages/control-plane/src/snapshot-ledger.ts";
import { ProtectedJsonStore } from "../../../packages/control-plane/src/store.ts";
import { DurableEffectTargetTransitionCoordinator } from "../src/effect-target-transition.ts";

function snapshot(head: string): TargetSnapshot {
  const content = {
    repositoryRoot: "C:\\repo",
    canonicalRemote: "https://github.com/acme/repo.git",
    branch: "feat/effect",
    defaultBranch: "main",
    head,
    indexTree: "2".repeat(40),
    trackedManifest: head.padEnd(64, "0").slice(0, 64),
    untrackedManifest: "3".repeat(64),
    submodules: {},
    policyVersion: "policy-1",
    environmentFingerprint: "4".repeat(64),
    completeness: "complete" as const,
    reasons: [] as const
  };
  return { id: targetSnapshotDigest(content), ...content, capturedAt: "2026-08-26T20:00:00.000Z" };
}

const before = snapshot("1".repeat(40));
const after = snapshot("5".repeat(40));

function source(): Omit<ManagedSession, "lastHeartbeat"> {
  return {
    id: "provider-session", provider: "codex", surface: "vscode_terminal", capabilities: ["registered", "mediated"], status: "running",
    workspaceRoot: before.repositoryRoot, targetSnapshotId: before.id, taskId: "task-1", planRevision: "plan-1", plannedFiles: ["src/a.ts"],
    adapterVersion: "provider-v1", metadata: { source: "trusted" }
  };
}

async function fixture(context: { after(callback: () => Promise<void>): void }) {
  const directory = await mkdtemp(join(tmpdir(), "b122-effect-transition-"));
  context.after(async () => { await rm(directory, { recursive: true, force: true }); });
  const store = new ProtectedJsonStore({ filePath: join(directory, "protected.jsonl") });
  const sessions = new SessionRegistry(store, { clock: () => "2026-08-26T20:00:00.000Z" });
  const session = await sessions.register(source());
  const targets = new TargetSnapshotLedger(store);
  await targets.record(before);
  let current = after;
  const coordinator = new DurableEffectTargetTransitionCoordinator({
    sessions,
    targets,
    targetResolver: { async resolve() { return current; } }
  });
  return { sessions, session, targets, coordinator, setCurrent(value: TargetSnapshot) { current = value; } };
}

test("records and compare-and-swaps one exact complete host-observed effect target", async (context) => {
  const setup = await fixture(context);
  const accepted = await setup.coordinator.captureAndAccept({
    action: "venv", operationId: "operation-venv", previousTarget: before, session: setup.session
  });
  assert.equal(accepted.status, "transitioned");
  assert.equal(accepted.target.id, after.id);
  assert.equal(accepted.session.targetSnapshotId, after.id);
  assert.equal((await setup.targets.get(after.id))?.id, after.id);

  const replay = await setup.coordinator.captureAndAccept({
    action: "venv", operationId: "operation-venv", previousTarget: before, session: setup.session,
    expectedTargetSnapshotId: after.id
  });
  assert.equal(replay.status, "already_transitioned");
});

test("rejects a mismatched expected transition, incomplete target, root churn, and session churn", async (context) => {
  const setup = await fixture(context);
  await assert.rejects(() => setup.coordinator.captureAndAccept({
    action: "plan_approval", operationId: "operation-plan", previousTarget: before, session: setup.session,
    expectedTargetSnapshotId: "f".repeat(64)
  }), /expected.*TargetSnapshot/i);

  setup.setCurrent({ ...after, completeness: "incomplete", reasons: ["ignored inputs unavailable"] });
  await assert.rejects(() => setup.coordinator.captureAndAccept({ action: "venv", operationId: "operation-incomplete", previousTarget: before, session: setup.session }), /complete/i);

  const rootChangedMaterial = { ...after, repositoryRoot: "C:\\other" };
  setup.setCurrent({ ...rootChangedMaterial, id: targetSnapshotDigest(rootChangedMaterial) });
  await assert.rejects(() => setup.coordinator.captureAndAccept({ action: "venv", operationId: "operation-root", previousTarget: before, session: setup.session }), /repository root/i);

  setup.setCurrent(after);
  await setup.sessions.updateBinding(setup.session.id, { planRevision: "changed" });
  await assert.rejects(() => setup.coordinator.captureAndAccept({ action: "venv", operationId: "operation-churn", previousTarget: before, session: setup.session }), /binding changed/i);
});

test("can prove an explicitly expected unchanged target without rewriting the session", async (context) => {
  const setup = await fixture(context);
  setup.setCurrent(before);
  const result = await setup.coordinator.captureAndAccept({
    action: "plan_approval", operationId: "operation-plan-unchanged", previousTarget: before, session: setup.session,
    expectedTargetSnapshotId: before.id, allowUnchanged: true
  });
  assert.equal(result.status, "unchanged");
  assert.equal(result.session.targetSnapshotId, before.id);
});
