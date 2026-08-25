import assert from "node:assert/strict";
import test from "node:test";

import { containmentReleaseScopeDigest, type ContainmentRecord } from "../../../packages/control-plane/src/containment.ts";
import { companionBridgeVersion } from "../src/bridge.ts";
import { AttestedContainmentReleaseCoordinator } from "../src/containment-release.ts";
import { CompanionService } from "../src/service.ts";

const record: ContainmentRecord = {
  repositoryRoot: "C:/work/example",
  fenceEpoch: 3,
  active: true,
  activatedAt: "2026-08-25T12:00:00.000Z",
  activatedByOperationId: "contain-op-3",
  reason: "reviewed incident",
  hookStates: [
    { name: "credential_lease_revocation", status: "completed", attempts: 1, updatedAt: "2026-08-25T12:00:01.000Z" },
    { name: "queued_operation_cancellation", status: "completed", attempts: 1, updatedAt: "2026-08-25T12:00:02.000Z" }
  ],
  hookFailures: [],
  uncontrolledPaths: ["unmediated shell"]
};

test("containment release inspects and binds the exact fence generation through preparation and release", async () => {
  const prepared: unknown[] = [];
  const released: unknown[] = [];
  const coordinator = new AttestedContainmentReleaseCoordinator({
    async prepareCommand(request) {
      prepared.push(request);
      return { status: "prepared", summary: "prepared", authorityId: "authority-3", confirmationToken: "confirmation-3" };
    },
    async releaseContainment(request) {
      released.push(request);
      return { status: "completed", summary: "released" };
    }
  }, { inspect: async (sessionId) => sessionId === "session-3" ? record : undefined });

  assert.deepEqual(await coordinator.inspect("session-3"), {
    sessionId: "session-3",
    repositoryRoot: record.repositoryRoot,
    active: true,
    fenceEpoch: 3,
    activatedByOperationId: "contain-op-3",
    hookStates: record.hookStates,
    hookFailures: [],
    uncontrolledPaths: ["unmediated shell"]
  });
  const result = await coordinator.release({
    sessionId: "session-3",
    reason: "incident complete",
    incidentStatus: "rotation_complete",
    expectedFenceEpoch: 3,
    expectedActivationOperationId: "contain-op-3"
  });
  assert.equal(result.status, "completed");
  assert.deepEqual(prepared, [{
    action: "containment_release",
    sessionId: "session-3",
    reason: "incident complete",
    confirmationScopeDigest: containmentReleaseScopeDigest({ expectedFenceEpoch: 3, expectedActivationOperationId: "contain-op-3" })
  }]);
  assert.deepEqual(released, [{
    sessionId: "session-3",
    authorityId: "authority-3",
    confirmationToken: "confirmation-3",
    reason: "incident complete",
    incidentStatus: "rotation_complete",
    expectedFenceEpoch: 3,
    expectedActivationOperationId: "contain-op-3"
  }]);
});

test("containment release refuses stale inspection fields before attestation", async () => {
  let preparations = 0;
  const coordinator = new AttestedContainmentReleaseCoordinator({
    async prepareCommand() { preparations += 1; return { status: "prepared", summary: "must not happen", authorityId: "authority", confirmationToken: "token" }; },
    async releaseContainment() { throw new Error("must not happen"); }
  }, { inspect: async () => record });

  const result = await coordinator.release({
    sessionId: "session-3",
    reason: "stale review",
    incidentStatus: "not_required",
    expectedFenceEpoch: 2,
    expectedActivationOperationId: "contain-op-3"
  });
  assert.equal(result.status, "blocked");
  assert.match(result.summary, /changed after review/i);
  assert.equal(preparations, 0);
});

test("authenticated companion service exposes only exact inspection and release payloads", async () => {
  const released: unknown[] = [];
  const coordinator = new AttestedContainmentReleaseCoordinator({
    async prepareCommand() { return { status: "prepared", summary: "prepared", authorityId: "authority-3", confirmationToken: "confirmation-3" }; },
    async releaseContainment(request) { released.push(request); return { status: "completed", summary: "released" }; }
  }, { inspect: async () => record });
  const service = new CompanionService({ containmentRelease: coordinator });

  const inspected = await service.handle({ version: companionBridgeVersion, id: "inspect", method: "containment.inspect", payload: { sessionId: "session-3" } });
  assert.equal(inspected.ok, true);
  assert.deepEqual(inspected.result, { containment: {
    sessionId: "session-3", repositoryRoot: record.repositoryRoot, active: true, fenceEpoch: 3,
    activatedByOperationId: "contain-op-3", hookStates: record.hookStates, hookFailures: [], uncontrolledPaths: ["unmediated shell"]
  } });

  const rejected = await service.handle({
    version: companionBridgeVersion,
    id: "bad-release",
    method: "containment.release",
    payload: { sessionId: "session-3", reason: "reviewed", incidentStatus: "not_required", expectedFenceEpoch: 3, expectedActivationOperationId: "contain-op-3", injected: true }
  });
  assert.equal(rejected.ok, false);
  assert.equal(rejected.error?.code, "invalid_request");

  const accepted = await service.handle({
    version: companionBridgeVersion,
    id: "release",
    method: "containment.release",
    payload: { sessionId: "session-3", reason: "reviewed", incidentStatus: "not_required", expectedFenceEpoch: 3, expectedActivationOperationId: "contain-op-3" }
  });
  assert.equal(accepted.ok, true);
  assert.equal(released.length, 1);
});
