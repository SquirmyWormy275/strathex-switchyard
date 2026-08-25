import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { CouncilCoordinator, type CouncilParticipant } from "../../../packages/control-plane/src/council.ts";
import type { ManagedSession } from "../../../packages/control-plane/src/contracts.ts";
import { SessionRegistry } from "../../../packages/control-plane/src/session-registry.ts";
import { ProtectedJsonStore } from "../../../packages/control-plane/src/store.ts";
import { CouncilEpochLifecycleManager, type CouncilEpochLifecycleIsolation, type CouncilEpochLifecycleScheduler } from "../src/council-epoch-lifecycle.ts";
import type { CouncilIsolationPlan } from "../src/council-workspace-isolation.ts";

const targetSnapshotId = "a".repeat(64);
const repositoryRoot = "C:\\repo";

function managed(id: string, heartbeat: string, status: ManagedSession["status"] = "running"): ManagedSession {
  return {
    id,
    provider: id === "one" ? "codex" : "claude",
    surface: "bridge",
    capabilities: ["registered", "observable", "controllable", "mediated"],
    status,
    workspaceRoot: repositoryRoot,
    targetSnapshotId,
    taskId: `task-${id}`,
    planRevision: "plan-1",
    plannedFiles: [`src/${id}.ts`],
    lastHeartbeat: heartbeat,
    adapterVersion: "provider-v1",
    metadata: {
      "sxsy-b122.providerHandshake": "exact-route-v1",
      "sxsy-b122.resources": JSON.stringify([`port:${id === "one" ? 45101 : 45102}`]),
      "sxsy-b122.dependencies": "[]",
      "sxsy-b122.diffDigest": (id === "one" ? "1" : "2").repeat(64)
    }
  };
}

function participant(value: ManagedSession): CouncilParticipant {
  return {
    id: value.id,
    targetSnapshotId,
    status: value.status,
    capabilities: value.capabilities,
    lastHeartbeat: value.lastHeartbeat,
    plannedFiles: value.plannedFiles,
    resources: JSON.parse(value.metadata["sxsy-b122.resources"]!) as string[],
    dependencies: [],
    diffDigest: value.metadata["sxsy-b122.diffDigest"]!
  };
}

async function activate(council: CouncilCoordinator, values: readonly ManagedSession[], epochId: string): Promise<void> {
  const epoch = await council.beginAutomatic({ repositoryRoot, targetSnapshotId, participants: values.map(participant) });
  assert.equal(epoch.id, epochId);
  for (const value of values) await council.acknowledgePause(epoch.id, value.id);
  for (const value of values) await council.assign(epoch.id, value.id, value.plannedFiles, participant(value).resources, (value.id === "one" ? "3" : "4").repeat(64));
  for (const value of values) await council.acknowledgeAssignment(epoch.id, value.id, (value.id === "one" ? "3" : "4").repeat(64));
  await council.beginResume(epoch.id);
  for (const value of values) await council.acknowledgeResume(epoch.id, value.id, (value.id === "one" ? "3" : "4").repeat(64));
  await council.activate(epoch.id);
}

function isolation(): CouncilEpochLifecycleIsolation & { recovered: string[]; asserted: string[]; cleaned: string[]; failCurrent: boolean } {
  const state = { recovered: [] as string[], asserted: [] as string[], cleaned: [] as string[], failCurrent: false };
  const plan = (epochId: string, status: CouncilIsolationPlan["status"]): CouncilIsolationPlan => ({
    epochId,
    targetSnapshotId,
    repositoryRoot,
    targetHead: "b".repeat(40),
    defaultBranch: "main",
    stateRoot: "C:\\host-state",
    bindings: [],
    status,
    executionAuthorized: false,
    createdAt: "2026-08-25T10:00:00.000Z",
    updatedAt: "2026-08-25T10:00:00.000Z",
    digest: "5".repeat(64)
  });
  return Object.assign(state, {
    async recover(epochId: string) { state.recovered.push(epochId); return plan(epochId, "prepared"); },
    async assertCurrent(epochId: string) { state.asserted.push(epochId); if (state.failCurrent) throw new Error("isolation fence lost"); return plan(epochId, "prepared"); },
    async cleanup(epochId: string) { state.cleaned.push(epochId); return plan(epochId, "cleaned"); }
  });
}

function scheduler(): CouncilEpochLifecycleScheduler & { callbacks: Array<() => void>; cleared: number } {
  const state = { callbacks: [] as Array<() => void>, cleared: 0 };
  return Object.assign(state, {
    setInterval(callback: () => void) { state.callbacks.push(callback); return callback; },
    clearInterval() { state.cleared += 1; }
  });
}

test("Council startup recovers active epochs, advances heartbeats, and disposes its ongoing verifier", async () => {
  const directory = await mkdtemp(join(tmpdir(), "b122-council-lifecycle-"));
  try {
    let now = "2026-08-25T10:02:00.000Z";
    const store = new ProtectedJsonStore({ filePath: join(directory, "journal.jsonl") });
    const sessions = new SessionRegistry(store, { clock: () => now });
    const initial = [managed("one", "2026-08-25T10:00:00.000Z"), managed("two", "2026-08-25T10:00:00.000Z")];
    for (const value of initial) await sessions.upsert(value);
    const council = new CouncilCoordinator(store, { clock: () => now, idFactory: () => "epoch-live" });
    await activate(council, initial, "epoch-live");
    for (const value of initial) await sessions.upsert({ ...value, lastHeartbeat: "2026-08-25T10:01:30.000Z" });
    const resources = isolation();
    const timers = scheduler();
    const lifecycle = new CouncilEpochLifecycleManager(council, sessions, resources, {
      now: () => Date.parse(now),
      heartbeatMaxAgeMs: 5 * 60_000,
      scheduler: timers,
      pollIntervalMs: 1_000
    });

    await lifecycle.start();
    assert.deepEqual(resources.recovered, ["epoch-live"]);
    assert.deepEqual(resources.asserted, ["epoch-live"]);
    assert.equal((await council.get("epoch-live"))?.participants[0]?.lastHeartbeat, "2026-08-25T10:01:30.000Z");
    assert.equal(timers.callbacks.length, 1);

    const changed = managed("one", "2026-08-25T10:01:45.000Z");
    await sessions.upsert({ ...changed, metadata: { ...changed.metadata, "sxsy-b122.diffDigest": "9".repeat(64) } });
    await lifecycle.reconcileNow();
    assert.equal((await council.get("epoch-live"))?.status, "aborted");
    assert.deepEqual(resources.cleaned, ["epoch-live"]);

    await lifecycle.dispose();
    assert.equal(timers.cleared, 1);
    await lifecycle.dispose();
    assert.equal(timers.cleared, 1);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("Council lifecycle durably completes and cleans only when every exact participant is freshly verified finished", async () => {
  const directory = await mkdtemp(join(tmpdir(), "b122-council-finished-"));
  try {
    const now = "2026-08-25T10:02:00.000Z";
    const store = new ProtectedJsonStore({ filePath: join(directory, "journal.jsonl") });
    const sessions = new SessionRegistry(store, { clock: () => now });
    const initial = [managed("one", "2026-08-25T10:00:00.000Z"), managed("two", "2026-08-25T10:00:00.000Z")];
    for (const value of initial) await sessions.upsert(value);
    const council = new CouncilCoordinator(store, { clock: () => now, idFactory: () => "epoch-finished" });
    await activate(council, initial, "epoch-finished");
    for (const value of initial) await sessions.upsert({ ...value, status: "verified_finished", lastHeartbeat: "2026-08-25T10:01:30.000Z" });
    const resources = isolation();
    const lifecycle = new CouncilEpochLifecycleManager(council, sessions, resources, { now: () => Date.parse(now), scheduler: scheduler() });

    await lifecycle.start();
    assert.equal((await council.get("epoch-finished"))?.status, "completed");
    assert.deepEqual(resources.cleaned, ["epoch-finished"]);
    await lifecycle.dispose();
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("Council lifecycle aborts and cleans on participant-set or isolation-fence loss", async () => {
  for (const fault of ["extra-session", "isolation"] as const) {
    const directory = await mkdtemp(join(tmpdir(), `b122-council-${fault}-`));
    try {
      const now = "2026-08-25T10:02:00.000Z";
      const store = new ProtectedJsonStore({ filePath: join(directory, "journal.jsonl") });
      const sessions = new SessionRegistry(store, { clock: () => now });
      const initial = [managed("one", "2026-08-25T10:01:00.000Z"), managed("two", "2026-08-25T10:01:00.000Z")];
      for (const value of initial) await sessions.upsert(value);
      const council = new CouncilCoordinator(store, { clock: () => now, idFactory: () => `epoch-${fault}` });
      await activate(council, initial, `epoch-${fault}`);
      const resources = isolation();
      if (fault === "extra-session") await sessions.upsert(managed("three", "2026-08-25T10:01:30.000Z"));
      else resources.failCurrent = true;
      const lifecycle = new CouncilEpochLifecycleManager(council, sessions, resources, { now: () => Date.parse(now), scheduler: scheduler() });

      await lifecycle.start();
      const epoch = await council.get(`epoch-${fault}`);
      assert.equal(epoch?.status, "aborted");
      assert.match(epoch?.abortReason ?? "", fault === "extra-session" ? /participant set/i : /isolation/i);
      assert.deepEqual(resources.cleaned, [`epoch-${fault}`]);
      await lifecycle.dispose();
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  }
});

test("Council lifecycle aborts and cleans when an installed port backend disappears", async () => {
  const directory = await mkdtemp(join(tmpdir(), "b122-council-resource-loss-"));
  try {
    const now = "2026-08-25T10:02:00.000Z";
    const store = new ProtectedJsonStore({ filePath: join(directory, "journal.jsonl") });
    const sessions = new SessionRegistry(store, { clock: () => now });
    const initial = [managed("one", "2026-08-25T10:01:00.000Z"), managed("two", "2026-08-25T10:01:00.000Z")];
    for (const value of initial) await sessions.upsert(value);
    const council = new CouncilCoordinator(store, { clock: () => now, idFactory: () => "epoch-resource-loss" });
    await activate(council, initial, "epoch-resource-loss");
    const workspace = isolation();
    let checks = 0;
    const lifecycle = new CouncilEpochLifecycleManager(council, sessions, workspace, {
      now: () => Date.parse(now),
      scheduler: scheduler(),
      resources: {
        async assertPlanOperational() {
          checks += 1;
          throw new Error("installed Council port backend disappeared");
        }
      }
    });

    await lifecycle.start();
    assert.equal(checks, 1);
    assert.equal((await council.get("epoch-resource-loss"))?.status, "aborted");
    assert.deepEqual(workspace.cleaned, ["epoch-resource-loss"]);
    await lifecycle.dispose();
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
