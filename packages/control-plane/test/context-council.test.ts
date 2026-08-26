import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { CouncilCoordinator } from "../src/council.ts";
import { HandoffPackageStore } from "../src/context-packages.ts";
import { ProtectedJsonStore } from "../src/store.ts";

async function withStore(run: (store: ProtectedJsonStore) => Promise<void>): Promise<void> {
  const directory = await mkdtemp(join(tmpdir(), "sxsy-b122-context-test-"));
  try {
    await run(new ProtectedJsonStore({ filePath: join(directory, "protected-audit.jsonl") }));
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
}

test("handoff packages persist only context, never create authority or execution", async () => {
  await withStore(async (store) => {
    const handoffs = new HandoffPackageStore(store, { clock: () => "2026-08-23T10:00:00.000Z", idFactory: () => "handoff-1" });
    const packet = await handoffs.create({
      repositoryRoot: "C:/repos/safe",
      targetSnapshotId: "snapshot-1",
      taskId: "task-7",
      planRevision: "plan-3",
      authorityId: "grant-9",
      plan: "Implement the declared unit behind tests.",
      decisions: ["Use the existing protocol."],
      documentation: ["docs/SXSY-B122-complete-key-specification-and-audit.md"],
      references: ["https://example.invalid/reference"],
      constraints: ["No external side effects."],
      openQuestions: ["Which adapter is available?"],
      nextActions: ["Read the test."],
      recipientSessionId: "coder-1"
    });
    assert.equal(packet.id, "handoff-1");
    assert.equal(packet.status, "queued");
    assert.match(packet.digest, /^[a-f0-9]{64}$/);
    assert.equal(packet.authorityId, "grant-9");
    assert.equal(packet.executionAuthorized, false);

    await handoffs.setRoutingDefault("immediate");
    assert.equal(await handoffs.routingDefault(), "immediate");
    await handoffs.acknowledge(packet.id, "coder-1");
    const reloaded = new HandoffPackageStore(store);
    assert.equal((await reloaded.get(packet.id))?.status, "acknowledged");
    assert.equal((await reloaded.get(packet.id))?.digest, packet.digest);
    assert.equal((await reloaded.get(packet.id))?.executionAuthorized, false);
  });
});

const session = (id: string, plannedFiles: readonly string[], resources: readonly string[] = []) => ({
  id,
  provider: "codex" as const,
  targetSnapshotId: "snapshot-1",
  status: "running" as const,
  capabilities: ["registered", "observable", "controllable", "mediated"] as const,
  lastHeartbeat: "2026-08-23T10:00:00.000Z",
  plannedFiles,
  resources,
  dependencies: [] as readonly string[],
  diffDigest: `${id}-diff`
});

test("Council reports collisions and refuses automatic coordination on overlap, stale state, or missing acknowledgements", async () => {
  await withStore(async (store) => {
    const council = new CouncilCoordinator(store, { clock: () => "2026-08-23T10:00:00.000Z", idFactory: () => "epoch-1" });
    const colliding = await council.report({ repositoryRoot: "C:/repos/safe", targetSnapshotId: "snapshot-1", participants: [
      session("agent-a", ["src/shared.ts"]),
      session("agent-b", ["src/shared.ts"])
    ] });
    assert.equal(colliding.atomic, true);
    assert.deepEqual(colliding.pathConflicts[0]?.participants, ["agent-a", "agent-b"]);
    await assert.rejects(council.beginAutomatic({ repositoryRoot: "C:/repos/safe", targetSnapshotId: "snapshot-1", participants: colliding.participants }), /overlap/i);

    const epoch = await council.beginAutomatic({ repositoryRoot: "C:/repos/safe", targetSnapshotId: "snapshot-1", participants: [
      session("agent-a", ["src/a.ts"], ["port:4100"]),
      session("agent-b", ["src/b.ts"], ["port:4200"])
    ] });
    assert.equal(epoch.status, "awaiting_pause_acknowledgements");
    await council.acknowledgePause(epoch.id, "agent-a");
    await council.acknowledgePause(epoch.id, "agent-b");
    await council.assign(epoch.id, "agent-a", ["src/a.ts"], ["port:4100"]);
    await council.assign(epoch.id, "agent-b", ["src/b.ts"], ["port:4200"]);
    await council.acknowledgeAssignment(epoch.id, "agent-a");
    await council.acknowledgeAssignment(epoch.id, "agent-b");
    assert.equal((await council.beginResume(epoch.id)).status, "awaiting_resume_acknowledgements");
    await council.acknowledgeResume(epoch.id, "agent-a");
    assert.equal((await council.get(epoch.id))?.status, "awaiting_resume_acknowledgements");
    await council.acknowledgeResume(epoch.id, "agent-b");
    assert.equal((await council.activate(epoch.id)).status, "active");

    const stopped = await council.validate(epoch.id, [
      { ...session("agent-a", ["src/a.ts"], ["port:4100"]), diffDigest: "unexpected-edit" },
      session("agent-b", ["src/b.ts"], ["port:4200"])
    ]);
    assert.equal(stopped.status, "aborted");
    assert.match(stopped.abortReason ?? "", /changed/i);
  });
});

test("Council cannot become active before every durable resume acknowledgement and has an explicit completion transition", async () => {
  await withStore(async (store) => {
    const council = new CouncilCoordinator(store, { clock: () => "2026-08-23T10:00:00.000Z", idFactory: () => "epoch-resume" });
    const epoch = await council.beginAutomatic({ repositoryRoot: "C:/repos/safe", targetSnapshotId: "snapshot-1", participants: [
      session("agent-a", ["src/a.ts"], ["port:4100"]), session("agent-b", ["src/b.ts"], ["port:4200"])
    ] });
    for (const id of ["agent-a", "agent-b"]) await council.acknowledgePause(epoch.id, id);
    await council.assign(epoch.id, "agent-a", ["src/a.ts"], ["port:4100"]);
    await council.assign(epoch.id, "agent-b", ["src/b.ts"], ["port:4200"]);
    for (const id of ["agent-a", "agent-b"]) await council.acknowledgeAssignment(epoch.id, id);
    await council.beginResume(epoch.id);
    await council.acknowledgeResume(epoch.id, "agent-a");
    await assert.rejects(council.activate(epoch.id), /resume/i);
    await council.acknowledgeResume(epoch.id, "agent-b");
    await council.activate(epoch.id);
    await council.validate(epoch.id, [
      { ...session("agent-a", ["src/a.ts"], ["port:4100"]), status: "verified_finished" },
      { ...session("agent-b", ["src/b.ts"], ["port:4200"]), status: "verified_finished" }
    ]);
    assert.equal((await council.beginCompletion(epoch.id)).status, "completion_pending");
    assert.equal((await council.complete(epoch.id)).status, "completed");
  });
});

test("Council accepts and persists a newer healthy heartbeat but aborts on regression or staleness", async () => {
  await withStore(async (store) => {
    let now = "2026-08-23T10:02:00.000Z";
    const council = new CouncilCoordinator(store, {
      clock: () => now,
      idFactory: () => "epoch-heartbeat",
      heartbeatMaxAgeMs: 5 * 60_000
    });
    const initial = session("agent-a", ["src/a.ts"], ["port:4100"]);
    const epoch = await council.beginAutomatic({
      repositoryRoot: "C:/repos/safe",
      targetSnapshotId: "snapshot-1",
      participants: [initial]
    });
    await council.acknowledgePause(epoch.id, initial.id);
    await council.assign(epoch.id, initial.id, initial.plannedFiles, initial.resources);
    await council.acknowledgeAssignment(epoch.id, initial.id);
    await council.beginResume(epoch.id);
    await council.acknowledgeResume(epoch.id, initial.id);
    await council.activate(epoch.id);

    const advancedAt = "2026-08-23T10:01:30.000Z";
    const healthy = await council.validate(epoch.id, [{ ...initial, lastHeartbeat: advancedAt }]);
    assert.equal(healthy.status, "active");
    assert.equal(healthy.participants[0]?.lastHeartbeat, advancedAt);

    const regressed = await council.validate(epoch.id, [{ ...initial, lastHeartbeat: "2026-08-23T10:01:00.000Z" }]);
    assert.equal(regressed.status, "aborted");
    assert.match(regressed.abortReason ?? "", /heartbeat.*regressed/i);

    now = "2026-08-23T10:10:00.000Z";
    const staleCouncil = new CouncilCoordinator(store, {
      clock: () => now,
      idFactory: () => "epoch-stale",
      heartbeatMaxAgeMs: 5 * 60_000
    });
    const staleEpoch = await staleCouncil.beginAutomatic({
      repositoryRoot: "C:/repos/safe",
      targetSnapshotId: "snapshot-1",
      participants: [{ ...initial, lastHeartbeat: "2026-08-23T10:09:00.000Z" }]
    });
    await staleCouncil.acknowledgePause(staleEpoch.id, initial.id);
    await staleCouncil.assign(staleEpoch.id, initial.id, initial.plannedFiles, initial.resources);
    await staleCouncil.acknowledgeAssignment(staleEpoch.id, initial.id);
    await staleCouncil.beginResume(staleEpoch.id);
    await staleCouncil.acknowledgeResume(staleEpoch.id, initial.id);
    await staleCouncil.activate(staleEpoch.id);
    now = "2026-08-23T10:15:00.001Z";
    const stale = await staleCouncil.validate(staleEpoch.id, [{ ...initial, lastHeartbeat: "2026-08-23T10:10:00.000Z" }]);
    assert.equal(stale.status, "aborted");
    assert.match(stale.abortReason ?? "", /heartbeat.*stale/i);
  });
});

test("Council assignment and resume acknowledgements bind the exact durable isolation digest", async () => {
  await withStore(async (store) => {
    const council = new CouncilCoordinator(store, { clock: () => "2026-08-23T10:00:00.000Z", idFactory: () => "epoch-isolated" });
    const epoch = await council.beginAutomatic({ repositoryRoot: "C:/repos/safe", targetSnapshotId: "snapshot-1", participants: [
      session("agent-a", ["src/a.ts"], ["port:4100"]), session("agent-b", ["src/b.ts"], ["port:4200"])
    ] });
    for (const id of ["agent-a", "agent-b"]) await council.acknowledgePause(epoch.id, id);
    const digestA = "a".repeat(64); const digestB = "b".repeat(64);
    await council.assign(epoch.id, "agent-a", ["src/a.ts"], ["port:4100"], digestA);
    await council.assign(epoch.id, "agent-b", ["src/b.ts"], ["port:4200"], digestB);
    await assert.rejects(council.acknowledgeAssignment(epoch.id, "agent-a", digestB), /isolation digest/i);
    await council.acknowledgeAssignment(epoch.id, "agent-a", digestA);
    await council.acknowledgeAssignment(epoch.id, "agent-b", digestB);
    await council.beginResume(epoch.id);
    await assert.rejects(council.acknowledgeResume(epoch.id, "agent-a", digestB), /isolation digest/i);
    await council.acknowledgeResume(epoch.id, "agent-a", digestA);
    await council.acknowledgeResume(epoch.id, "agent-b", digestB);
    assert.equal((await council.activate(epoch.id)).status, "active");
    assert.equal((await council.get(epoch.id))?.assignments["agent-a"]?.isolationDigest, digestA);
  });
});

test("Council restart discovery includes every nonterminal pre-activation epoch", async () => {
  const directory = await mkdtemp(join(tmpdir(), "b122-council-ongoing-"));
  try {
    const store = new ProtectedJsonStore({ filePath: join(directory, "journal.jsonl") });
    let id = 0;
    const council = new CouncilCoordinator(store, { idFactory: () => `epoch-${++id}` });
    const values = [session("agent-a", ["src/a.ts"]), session("agent-b", ["src/b.ts"])];
    const pause = await council.beginAutomatic({ repositoryRoot: "C:\\repo", targetSnapshotId: "a".repeat(64), participants: values.map((value) => ({ ...value, targetSnapshotId: "a".repeat(64) })) });
    const assignment = await council.beginAutomatic({ repositoryRoot: "C:\\repo", targetSnapshotId: "b".repeat(64), participants: values.map((value) => ({ ...value, targetSnapshotId: "b".repeat(64) })) });
    for (const value of values) await council.acknowledgePause(assignment.id, value.id);
    const resume = await council.beginAutomatic({ repositoryRoot: "C:\\repo", targetSnapshotId: "c".repeat(64), participants: values.map((value) => ({ ...value, targetSnapshotId: "c".repeat(64) })) });
    for (const value of values) await council.acknowledgePause(resume.id, value.id);
    for (const value of values) {
      await council.assign(resume.id, value.id, value.plannedFiles, value.resources, "d".repeat(64));
      await council.acknowledgeAssignment(resume.id, value.id, "d".repeat(64));
    }
    await council.beginResume(resume.id);
    assert.deepEqual((await council.listOngoing()).map((epoch) => epoch.id).sort(), [pause.id, assignment.id, resume.id].sort());
  } finally { await rm(directory, { recursive: true, force: true }); }
});

test("Council can durably require cleanup for an interrupted epoch before any assignment was recorded", async () => {
  const directory = await mkdtemp(join(tmpdir(), "b122-council-forced-cleanup-"));
  try {
    const store = new ProtectedJsonStore({ filePath: join(directory, "journal.jsonl") });
    const council = new CouncilCoordinator(store, { idFactory: () => "epoch-interrupted" });
    const values = [session("agent-a", ["src/a.ts"]), session("agent-b", ["src/b.ts"])];
    await council.beginAutomatic({
      repositoryRoot: "C:\\repo",
      targetSnapshotId: "a".repeat(64),
      participants: values.map((value) => ({ ...value, targetSnapshotId: "a".repeat(64) }))
    });

    const pending = await council.abort("epoch-interrupted", "repository cancellation", { cleanupRequired: true });
    assert.equal(pending.status, "abort_pending");
    assert.equal((await council.settleAbort(pending.id)).status, "aborted");
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("Council normal is truthful for an Observable-only participant instead of pretending it can pause or isolate", async () => {
  await withStore(async (store) => {
    const council = new CouncilCoordinator(store, { clock: () => "2026-08-23T10:00:00.000Z" });
    const report = await council.report({
      repositoryRoot: "C:/repos/safe",
      targetSnapshotId: "snapshot-1",
      participants: [{
        ...session("observer", ["docs/notes.md"]),
        capabilities: ["registered", "observable"],
        status: "verified_blocked"
      }]
    });
    assert.equal(report.atomic, false);
    await assert.rejects(council.beginAutomatic({
      repositoryRoot: "C:/repos/safe", targetSnapshotId: "snapshot-1", participants: report.participants
    }), /cooperative pause/i);
  });
});

test("Council recommendations are immutable durable artifacts and never authorize execution", async () => {
  await withStore(async (store) => {
    const council = new CouncilCoordinator(store, { clock: () => "2026-08-23T10:00:00.000Z", idFactory: () => "recommendation-1" });
    const prepared = await council.prepareRecommendation({ repositoryRoot: "C:/repos/safe", targetSnapshotId: "snapshot-1", participants: [
      session("agent-a", ["src/a.ts"], ["port:4100"]), session("agent-b", ["src/b.ts"], ["port:4200"])
    ] });
    assert.equal(prepared.status, "prepared");
    assert.equal(prepared.ready, true);
    assert.equal(prepared.executionAuthorized, false);
    const approved = await council.approveRecommendation(prepared.id, "operation-confirmed-1");
    assert.equal(approved.status, "approved");
    assert.equal(approved.approvalOperationId, "operation-confirmed-1");
    assert.equal(approved.executionAuthorized, false);
    const reloaded = new CouncilCoordinator(store);
    assert.equal((await reloaded.getRecommendation(prepared.id))?.digest, prepared.digest);
  });
});
