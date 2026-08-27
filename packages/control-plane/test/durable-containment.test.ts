import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import test from "node:test";
import { DurableContainmentManager, type ContainmentReleaseBinding } from "../src/containment.ts";
import { containmentIncidentReviewDigest, type ContainmentAssessmentEffectPort } from "../src/containment-incidents.ts";
import { ProtectedJsonStore } from "../src/store.ts";

const noExposureAssessment: ContainmentAssessmentEffectPort = {
  async execute(request) {
    return {
      schema: "sxsy-b122.containment-assessment-result",
      version: 1,
      incidentId: request.incidentId,
      repositoryRoot: request.repositoryRoot,
      fenceEpoch: request.fenceEpoch,
      step: request.step,
      operationId: request.operationId,
      externalId: request.externalId,
      effectDisposition: "committed",
      status: "passed",
      exposure: "none",
      summary: "No exposure found.",
      findings: []
    };
  },
  async observe() { return undefined; }
};

async function readyReleaseBinding(manager: DurableContainmentManager, incidentId: string): Promise<ContainmentReleaseBinding & Readonly<{ expectedAssessmentTargetSnapshotId: string }>> {
  const assessed = await manager.incidents.assess(incidentId, noExposureAssessment);
  const incident = await manager.incidents.recordRotationReview({
    incidentId,
    expectedIncidentDigest: containmentIncidentReviewDigest(assessed),
    disposition: "not_required",
    evidenceReference: "reviewed-no-credential-finding",
    evidenceDigest: "a".repeat(64)
  });
  return {
    expectedFenceEpoch: incident.fenceEpoch,
    expectedActivationOperationId: incident.activationOperationId,
    expectedIncidentId: incident.id,
    expectedIncidentDigest: containmentIncidentReviewDigest(incident),
    expectedAssessmentTargetSnapshotId: incident.assessment.targetSnapshotId
  };
}

test("durable containment persists its fence and invokes revocation/cancellation hooks after recording it", async (context) => {
  const folder = await mkdtemp(join(tmpdir(), "sxsy-b122-containment-"));
  context.after(async () => { await rm(folder, { recursive: true, force: true }); });
  const store = new ProtectedJsonStore({ filePath: join(folder, "protected.jsonl"), clock: () => "2026-08-23T12:00:00.000Z" });
  const calls: string[] = [];
  const manager = new DurableContainmentManager(store, {
    revokeCredentialLeases: async (input) => { calls.push(`revoke:${input.repositoryRoot}:${input.fenceEpoch}`); },
    cancelQueuedOperations: async (input) => { calls.push(`cancel:${input.repositoryRoot}:${input.fenceEpoch}`); }
  });

  const record = await manager.activate({ repositoryRoot: "C:/work/example", operationId: "op-1", reason: "incident" });
  assert.equal(record.fenceEpoch, 1);
  assert.deepEqual(calls, ["revoke:C:/work/example:1", "cancel:C:/work/example:1"]);
  const repeated = await manager.activate({ repositoryRoot: "C:/work/example", operationId: "op-1", reason: "repeat" });
  assert.equal(repeated.fenceEpoch, 1);
  assert.deepEqual(calls, ["revoke:C:/work/example:1", "cancel:C:/work/example:1"]);
  assert.equal((await manager.check("C:/work/example", "credential")).allowed, false);

  const restarted = new DurableContainmentManager(store);
  assert.equal((await restarted.check("C:/work/example", "network")).allowed, false);
  const binding = await readyReleaseBinding(restarted, record.incidentId!);
  assert.equal((await restarted.release({
    repositoryRoot: "C:/work/example",
    reason: "stale inspection",
    reauthenticated: true,
    ...binding,
    expectedFenceEpoch: 2
  })).status, "blocked");
  assert.equal((await restarted.release({
    repositoryRoot: "C:/work/example",
    reason: "wrong activation",
    reauthenticated: true,
    ...binding,
    expectedActivationOperationId: "op-other"
  })).status, "blocked");
  const release = await restarted.release({ repositoryRoot: "C:/work/example", reason: "reviewed", reauthenticated: true, ...binding });
  assert.equal(release.status, "released");
  assert.equal((await restarted.incidents.get(binding.expectedIncidentId))?.status, "released");
  assert.equal((await restarted.check("C:/work/example", "git")).allowed, true);
});

test("durable containment stays active when a revocation hook fails and records the uncertainty", async (context) => {
  const folder = await mkdtemp(join(tmpdir(), "sxsy-b122-containment-"));
  context.after(async () => { await rm(folder, { recursive: true, force: true }); });
  const store = new ProtectedJsonStore({ filePath: join(folder, "protected.jsonl") });
  const manager = new DurableContainmentManager(store, { revokeCredentialLeases: async () => { throw new Error("adapter unavailable"); } });

  const record = await manager.activate({ repositoryRoot: "C:/work/example", operationId: "op-1", reason: "incident" });
  assert.equal(record.active, true);
  assert.match(record.hookFailures?.[0] ?? "", /adapter unavailable/);
  assert.equal((await manager.check("C:/work/example", "credential")).allowed, false);
  const binding = await readyReleaseBinding(manager, record.incidentId!);
  assert.equal((await manager.release({ repositoryRoot: "C:/work/example", reason: "unsafe", reauthenticated: true, ...binding })).status, "blocked");

  const recoveredCalls: string[] = [];
  const recovered = new DurableContainmentManager(store, {
    revokeCredentialLeases: async ({ fenceEpoch }) => { recoveredCalls.push(`revoke:${fenceEpoch}`); },
    cancelQueuedOperations: async ({ fenceEpoch }) => { recoveredCalls.push(`cancel:${fenceEpoch}`); }
  });
  assert.equal((await recovered.check("C:/work/example", "network")).allowed, false, "startup must reconcile failed hooks before the first decision");
  assert.deepEqual(recoveredCalls, ["revoke:1", "cancel:1"]);
  const reconciled = await recovered.activate({ repositoryRoot: "C:/work/example", operationId: "op-repeat", reason: "retry" });
  assert.equal(reconciled.fenceEpoch, 1);
  assert.deepEqual(recoveredCalls, ["revoke:1", "cancel:1"], "repeated activation must not replay completed startup recovery");
  assert.equal(reconciled.hookFailures, undefined);
  assert.deepEqual(reconciled.hookStates?.map(({ name, status }) => ({ name, status })), [
    { name: "credential_lease_revocation", status: "completed" },
    { name: "queued_operation_cancellation", status: "completed" }
  ]);
  assert.equal((await recovered.release({ repositoryRoot: "C:/work/example", reason: "reconciled", reauthenticated: true, ...binding })).status, "released");
});

test("durable containment resumes exact idempotent hooks after every crash boundary", async (context) => {
  const parent = await mkdtemp(join(tmpdir(), "sxsy-b122-containment-crash-"));
  context.after(async () => { await rm(parent, { recursive: true, force: true }); });
  const scenarios = [
    { phase: "fence_persisted", expectedBefore: [] as string[], expectedAfter: ["revoke:1", "cancel:1"] },
    { phase: "hook_claimed", expectedBefore: [] as string[], expectedAfter: ["revoke:1", "cancel:1"] },
    { phase: "hook_effect_completed", expectedBefore: ["revoke:1"], expectedAfter: ["revoke:1", "revoke:1", "cancel:1"] },
    { phase: "hook_completion_persisted", expectedBefore: ["revoke:1"], expectedAfter: ["revoke:1", "cancel:1"] }
  ] as const;

  for (const scenario of scenarios) {
    const store = new ProtectedJsonStore({ filePath: join(parent, `${scenario.phase}.jsonl`), clock: () => "2026-08-23T12:00:00.000Z" });
    const calls: string[] = [];
    const effects = new Set<string>();
    let crashed = false;
    const hooks = {
      revokeCredentialLeases: async ({ repositoryRoot, fenceEpoch }: { repositoryRoot: string; fenceEpoch: number }) => { calls.push(`revoke:${fenceEpoch}`); effects.add(`revoke:${repositoryRoot}:${fenceEpoch}`); },
      cancelQueuedOperations: async ({ repositoryRoot, fenceEpoch }: { repositoryRoot: string; fenceEpoch: number }) => { calls.push(`cancel:${fenceEpoch}`); effects.add(`cancel:${repositoryRoot}:${fenceEpoch}`); }
    };
    const crashing = new DurableContainmentManager(store, hooks, {
      lifecycleProbe: async ({ phase, hook }) => {
        if (!crashed && phase === scenario.phase && (phase === "fence_persisted" || hook === "credential_lease_revocation")) {
          crashed = true;
          throw new Error(`simulated crash at ${phase}`);
        }
      }
    });
    await assert.rejects(crashing.activate({ repositoryRoot: "C:/work/example", operationId: `op-${scenario.phase}`, reason: "incident" }), /simulated crash/);
    assert.deepEqual(calls, scenario.expectedBefore, `unexpected pre-crash calls at ${scenario.phase}`);
    assert.equal((await crashing.check("C:/work/example", "network")).allowed, false, "the fence must precede every crash seam");

    const restarted = new DurableContainmentManager(store, hooks);
    assert.equal((await restarted.check("C:/work/example", "adapter")).allowed, false, "startup recovery must finish before the first containment decision");
    assert.deepEqual(calls, scenario.expectedAfter, `startup did not resume exact hooks at ${scenario.phase}`);
    const reconciled = await restarted.activate({ repositoryRoot: "C:/work/example", operationId: "repeat", reason: "recover" });
    assert.deepEqual(calls, scenario.expectedAfter, `repeated activation replayed startup-reconciled hooks at ${scenario.phase}`);
    assert.equal(effects.size, 2, "replayed idempotent hook keys must not create duplicate effects");
    assert.equal(reconciled.fenceEpoch, 1);
    assert.equal(reconciled.hookFailures, undefined);
    assert.equal(reconciled.hookStates?.every((state) => state.status === "completed"), true);
    const repeated = await restarted.activate({ repositoryRoot: "C:/work/example", operationId: "repeat-again", reason: "idempotent" });
    assert.deepEqual(calls, scenario.expectedAfter, "completed exact hook acknowledgements must not replay");
    assert.equal(repeated.fenceEpoch, 1);
  }
});

test("durable containment bounds an unacknowledged hook without blocking another repository", async (context) => {
  const folder = await mkdtemp(join(tmpdir(), "sxsy-b122-containment-timeout-"));
  context.after(async () => { await rm(folder, { recursive: true, force: true }); });
  const store = new ProtectedJsonStore({ filePath: join(folder, "protected.jsonl") });
  const firstRepository = "C:/work/first";
  const secondRepository = "C:/work/second";
  const seeded = new DurableContainmentManager(store);
  await seeded.activate({ repositoryRoot: firstRepository, operationId: "op-first", reason: "incident" });
  await seeded.activate({ repositoryRoot: secondRepository, operationId: "op-second", reason: "incident" });

  let rejectLateFirst!: (reason?: unknown) => void;
  const neverAcknowledged = new Promise<void>((_resolve, reject) => { rejectLateFirst = reject; });
  const calls: string[] = [];
  const restarted = new DurableContainmentManager(store, {
    revokeCredentialLeases: async ({ repositoryRoot, fenceEpoch }) => {
      calls.push(`revoke:${repositoryRoot}:${fenceEpoch}`);
      if (repositoryRoot === firstRepository) return neverAcknowledged;
    },
    cancelQueuedOperations: async ({ repositoryRoot, fenceEpoch }) => { calls.push(`cancel:${repositoryRoot}:${fenceEpoch}`); }
  }, { hookTimeoutMs: 800 });

  let secondDeadline!: NodeJS.Timeout;
  const second = await Promise.race([
    restarted.get(secondRepository),
    new Promise<never>((_resolve, reject) => {
      secondDeadline = setTimeout(() => reject(new Error("An unrelated repository was serialized behind a stalled hook.")), 400);
    })
  ]).finally(() => clearTimeout(secondDeadline));
  assert.equal(second?.hookStates?.every((state) => state.status === "completed"), true);
  const secondBinding = await readyReleaseBinding(restarted, second!.incidentId!);
  assert.equal((await restarted.release({
    repositoryRoot: secondRepository,
    reason: "reconciled",
    reauthenticated: true,
    ...secondBinding
  })).status, "released");

  const first = await restarted.get(firstRepository);
  const revocation = first?.hookStates?.find((state) => state.name === "credential_lease_revocation");
  assert.equal(revocation?.status, "failed");
  assert.match(revocation?.failure ?? "", /timed out before a durable acknowledgement/);
  assert.equal(first?.hookStates?.find((state) => state.name === "queued_operation_cancellation")?.status, "completed");
  const firstBinding = await readyReleaseBinding(restarted, first!.incidentId!);
  assert.equal((await restarted.release({
    repositoryRoot: firstRepository,
    reason: "unsafe",
    reauthenticated: true,
    ...firstBinding
  })).status, "blocked");
  assert.deepEqual(calls, [
    `revoke:${firstRepository}:1`,
    `revoke:${secondRepository}:1`,
    `cancel:${secondRepository}:1`,
    `cancel:${firstRepository}:1`
  ]);

  // The adapter may settle after the durable deadline. Its rejection is still
  // observed and cannot change the recorded failure or create an unhandled one.
  rejectLateFirst(new Error("late adapter rejection"));
  await new Promise<void>((resolve) => setImmediate(resolve));
  assert.equal((await restarted.get(firstRepository))?.hookStates?.find((state) => state.name === "credential_lease_revocation")?.status, "failed");
});
