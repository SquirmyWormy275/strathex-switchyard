import assert from "node:assert/strict";
import test from "node:test";

import { containmentReleaseScopeDigest, type ContainmentRecord } from "../../../packages/control-plane/src/containment.ts";
import { containmentIncidentReviewDigest, type ContainmentIncidentRecord } from "../../../packages/control-plane/src/containment-incidents.ts";
import { companionBridgeVersion } from "../src/bridge.ts";
import { AttestedContainmentReleaseCoordinator } from "../src/containment-release.ts";
import { CompanionService } from "../src/service.ts";

const record: ContainmentRecord = {
  repositoryRoot: "C:/work/example",
  fenceEpoch: 3,
  incidentId: `containment-incident:${"a".repeat(64)}`,
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
const incident: ContainmentIncidentRecord = {
  version: 1,
  id: record.incidentId!,
  repositoryRoot: record.repositoryRoot,
  fenceEpoch: record.fenceEpoch,
  activationOperationId: record.activatedByOperationId,
  reason: record.reason,
  createdAt: record.activatedAt,
  updatedAt: "2026-08-25T12:00:03.000Z",
  status: "ready_for_release",
  assessment: { generation: 1, purpose: "initial", targetSnapshotId: "snapshot-release", basedOnFindingIds: [], basedOnReceiptIds: [], credentialRotationRequired: false, startedAt: record.activatedAt },
  steps: (["working_tree", "history", "remote"] as const).map((step) => ({
    name: step,
    operationId: `assessment-${step}`,
    externalId: `external-${step}`,
    status: "completed" as const,
    attempts: 1,
    updatedAt: "2026-08-25T12:00:02.000Z",
    result: {
      schema: "sxsy-b122.containment-assessment-result" as const,
      version: 1 as const,
      incidentId: record.incidentId!,
      repositoryRoot: record.repositoryRoot,
      fenceEpoch: record.fenceEpoch,
      step,
      operationId: `assessment-${step}`,
      externalId: `external-${step}`,
      effectDisposition: "committed" as const,
      status: "passed" as const,
      exposure: "none" as const,
      summary: "No exposure found.",
      findings: []
    }
  })),
  permits: [],
  receipts: [],
  rotation: { disposition: "not_required", evidenceReference: "reviewed", evidenceDigest: "b".repeat(64), reviewedAt: "2026-08-25T12:00:03.000Z" }
};
const binding = {
  expectedFenceEpoch: 3,
  expectedActivationOperationId: "contain-op-3",
  expectedIncidentId: incident.id,
  expectedIncidentDigest: containmentIncidentReviewDigest(incident)
} as const;

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
  }, { inspect: async (sessionId) => sessionId === "session-3" ? { fence: record, incident } : undefined });

  assert.deepEqual(await coordinator.inspect("session-3"), {
    sessionId: "session-3",
    repositoryRoot: record.repositoryRoot,
    active: true,
    fenceEpoch: 3,
    activatedByOperationId: "contain-op-3",
    hookStates: record.hookStates,
    hookFailures: [],
    uncontrolledPaths: ["unmediated shell"],
    incident,
    incidentDigest: binding.expectedIncidentDigest
  });
  const result = await coordinator.release({
    sessionId: "session-3",
    reason: "incident complete",
    ...binding
  });
  assert.equal(result.status, "completed");
  assert.deepEqual(prepared, [{
    action: "containment_release",
    sessionId: "session-3",
    reason: "incident complete",
    confirmationScopeDigest: containmentReleaseScopeDigest(binding)
  }]);
  assert.deepEqual(released, [{
    sessionId: "session-3",
    authorityId: "authority-3",
    confirmationToken: "confirmation-3",
    reason: "incident complete",
    ...binding
  }]);
});

test("containment release refuses stale inspection fields before attestation", async () => {
  let preparations = 0;
  const coordinator = new AttestedContainmentReleaseCoordinator({
    async prepareCommand() { preparations += 1; return { status: "prepared", summary: "must not happen", authorityId: "authority", confirmationToken: "token" }; },
    async releaseContainment() { throw new Error("must not happen"); }
  }, { inspect: async () => ({ fence: record, incident }) });

  const result = await coordinator.release({
    sessionId: "session-3",
    reason: "stale review",
    ...binding,
    expectedFenceEpoch: 2
  });
  assert.equal(result.status, "blocked");
  assert.match(result.summary, /changed after review/i);
  assert.equal(preparations, 0);
});

test("containment incident administration binds reassessment, permits, and rotation to one reviewed image", async () => {
  const calls: string[] = [];
  const coordinator = new AttestedContainmentReleaseCoordinator({
    async prepareCommand() { throw new Error("not used"); },
    async releaseContainment() { throw new Error("not used"); }
  }, {
    inspect: async () => ({ fence: record, incident }),
    assess: async (input) => { calls.push(`assess:${input.incidentId}:${input.expectedIncidentDigest}`); },
    issuePermit: async (input) => {
      calls.push(`permit:${input.action}:${input.relativePaths.join(",")}`);
      return {
        id: `containment-remediation-permit:${"d".repeat(64)}`, incidentId: input.incidentId, fenceEpoch: 3,
        action: input.action, relativePaths: input.relativePaths, reviewedBy: "authenticated-vscode-current-user",
        issuedAt: "2026-08-25T12:00:04.000Z", expiresAt: input.expiresAt, networkAllowed: false, credentialAccessAllowed: false
      };
    },
    recordRotation: async (input) => { calls.push(`rotation:${input.disposition}:${input.evidenceDigest}`); }
  });
  const exact = { sessionId: "session-3", expectedIncidentId: incident.id, expectedIncidentDigest: binding.expectedIncidentDigest } as const;
  await assert.rejects(coordinator.reassess({ ...exact, expectedIncidentDigest: "0".repeat(64) }), /changed after review/i);
  await coordinator.reassess(exact);
  const permit = await coordinator.issueRemediationPermit({ ...exact, action: "remove_exposed_value", relativePaths: ["config/local.env"], expiresAt: "2026-08-25T12:05:00.000Z" });
  assert.equal(permit.permit.networkAllowed, false);
  assert.equal(permit.permit.credentialAccessAllowed, false);
  await coordinator.recordRotationReview({ ...exact, disposition: "complete", evidenceReference: "ticket-19", evidenceDigest: "e".repeat(64) });
  assert.deepEqual(calls, [
    `assess:${incident.id}:${binding.expectedIncidentDigest}`,
    "permit:remove_exposed_value:config/local.env",
    `rotation:complete:${"e".repeat(64)}`
  ]);
});

test("post-remediation verification starts and completes one fresh exact assessment generation", async () => {
  let current = incident;
  const calls: string[] = [];
  const coordinator = new AttestedContainmentReleaseCoordinator({
    async prepareCommand() { throw new Error("not used"); },
    async releaseContainment() { throw new Error("not used"); }
  }, {
    inspect: async () => ({ fence: record, incident: current }),
    beginVerification: async (input) => {
      calls.push(`begin:${input.expectedIncidentDigest}`);
      current = {
        ...current,
        status: "assessing",
        assessment: {
          generation: 2,
          purpose: "post_remediation",
          targetSnapshotId: "snapshot-remediated",
          basedOnFindingIds: [`containment-finding:${"f".repeat(64)}`],
          basedOnReceiptIds: [`containment-remediation-receipt:${"e".repeat(64)}`],
          credentialRotationRequired: true,
          sourceIncidentDigest: input.expectedIncidentDigest,
          startedAt: "2026-08-25T12:01:00.000Z"
        },
        steps: current.steps.map(({ result: _result, ...step }) => ({ ...step, status: "pending" as const, attempts: 0, updatedAt: "2026-08-25T12:01:00.000Z" }))
      };
    },
    assess: async (input) => {
      calls.push(`assess:${input.expectedIncidentDigest}`);
      current = {
        ...current,
        status: "remediation_required",
        steps: current.steps.map((step) => ({
          ...step,
          status: "completed" as const,
          attempts: 1,
          updatedAt: "2026-08-25T12:01:01.000Z",
          result: {
            ...incident.steps.find((candidate) => candidate.name === step.name)!.result!,
            operationId: step.operationId,
            externalId: step.externalId,
            status: "passed" as const,
            exposure: "none" as const,
            findings: []
          }
        }))
      };
    }
  });
  const verified = await coordinator.verifyRemediation({ sessionId: "session-3", expectedIncidentId: incident.id, expectedIncidentDigest: containmentIncidentReviewDigest(incident) });
  assert.equal(verified.incident.assessment.generation, 2);
  assert.equal(verified.incident.steps.every((step) => step.status === "completed"), true);
  assert.equal(calls.length, 2);
  assert.match(calls[0]!, /^begin:[a-f0-9]{64}$/);
  assert.match(calls[1]!, /^assess:[a-f0-9]{64}$/);
  assert.notEqual(calls[0], calls[1], "assessment must bind the new generation digest, not the pre-generation review digest");
});

test("authenticated companion service exposes only closed containment-administration payloads", async () => {
  const historyRequests: unknown[] = [];
  const coordinator = new AttestedContainmentReleaseCoordinator({
    async prepareCommand() { throw new Error("not used"); }, async releaseContainment() { throw new Error("not used"); }
  }, {
    inspect: async () => ({ fence: record, incident }),
    assess: async () => undefined,
    issuePermit: async (input) => ({
      id: `containment-remediation-permit:${"d".repeat(64)}`, incidentId: input.incidentId, fenceEpoch: 3, action: input.action,
      relativePaths: input.relativePaths, reviewedBy: "authenticated-vscode-current-user", issuedAt: "2026-08-25T12:00:04.000Z",
      expiresAt: input.expiresAt, networkAllowed: false, credentialAccessAllowed: false
    }),
    recordRotation: async () => undefined
  });
  const service = new CompanionService({
    containmentRelease: coordinator,
    containmentHistory: {
      async execute(input) {
        historyRequests.push(input);
        return {
          operationId: `containment-history:${"1".repeat(64)}`, incidentId: input.expectedIncidentId, permitId: input.permitId,
          repositoryRoot: record.repositoryRoot, branch: "feature/contained", oldHead: "2".repeat(40), newHead: "3".repeat(40),
          backupBundlePath: "C:\\state\\history\\before.bundle", backupBundleSha256: "4".repeat(64), incidentDigest: "5".repeat(64), status: "completed"
        };
      }
    }
  });
  const exact = { sessionId: "session-3", expectedIncidentId: incident.id, expectedIncidentDigest: binding.expectedIncidentDigest };
  const assessed = await service.handle({ version: 1, id: "assess", method: "containment.assess", payload: exact });
  assert.equal(assessed.ok, true);
  const permit = await service.handle({ version: 1, id: "permit", method: "containment.permit.issue", payload: { ...exact, action: "remove_exposed_value", relativePaths: ["config/local.env"], expiresAt: "2026-08-25T12:05:00.000Z" } });
  assert.equal(permit.ok, true);
  const rotation = await service.handle({ version: 1, id: "rotation", method: "containment.rotation.record", payload: { ...exact, disposition: "complete", evidenceReference: "ticket-19", evidenceDigest: "e".repeat(64) } });
  assert.equal(rotation.ok, true);
  const history = await service.handle({ version: 1, id: "history", method: "containment.history.rewrite", payload: {
    ...exact, permitId: `containment-remediation-permit:${"d".repeat(64)}`, relativePaths: ["config/local.env"], remediatedFindingIds: [`containment-finding:${"f".repeat(64)}`]
  } });
  assert.equal(history.ok, true);
  assert.equal(historyRequests.length, 1);
  const injectedHistory = await service.handle({ version: 1, id: "history-injected", method: "containment.history.rewrite", payload: {
    ...exact, permitId: `containment-remediation-permit:${"d".repeat(64)}`, relativePaths: ["config/local.env"], remediatedFindingIds: [`containment-finding:${"f".repeat(64)}`], remoteAllowed: true
  } });
  assert.equal(injectedHistory.ok, false);
  assert.equal(injectedHistory.error?.code, "invalid_request");
  const injected = await service.handle({ version: 1, id: "injected", method: "containment.permit.issue", payload: { ...exact, action: "remove_exposed_value", relativePaths: ["config/local.env"], expiresAt: "2026-08-25T12:05:00.000Z", networkAllowed: true } });
  assert.equal(injected.ok, false);
  assert.equal(injected.error?.code, "invalid_request");
});

test("authenticated companion service exposes only exact inspection and release payloads", async () => {
  const released: unknown[] = [];
  const coordinator = new AttestedContainmentReleaseCoordinator({
    async prepareCommand() { return { status: "prepared", summary: "prepared", authorityId: "authority-3", confirmationToken: "confirmation-3" }; },
    async releaseContainment(request) { released.push(request); return { status: "completed", summary: "released" }; }
  }, { inspect: async () => ({ fence: record, incident }) });
  const service = new CompanionService({ containmentRelease: coordinator });

  const inspected = await service.handle({ version: companionBridgeVersion, id: "inspect", method: "containment.inspect", payload: { sessionId: "session-3" } });
  assert.equal(inspected.ok, true);
  assert.deepEqual(inspected.result, { containment: {
    sessionId: "session-3", repositoryRoot: record.repositoryRoot, active: true, fenceEpoch: 3,
    activatedByOperationId: "contain-op-3", hookStates: record.hookStates, hookFailures: [], uncontrolledPaths: ["unmediated shell"], incident, incidentDigest: binding.expectedIncidentDigest
  } });

  const rejected = await service.handle({
    version: companionBridgeVersion,
    id: "bad-release",
    method: "containment.release",
    payload: { sessionId: "session-3", reason: "reviewed", ...binding, injected: true }
  });
  assert.equal(rejected.ok, false);
  assert.equal(rejected.error?.code, "invalid_request");

  const accepted = await service.handle({
    version: companionBridgeVersion,
    id: "release",
    method: "containment.release",
    payload: { sessionId: "session-3", reason: "reviewed", ...binding }
  });
  assert.equal(accepted.ok, true);
  assert.equal(released.length, 1);
});
