import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import {
  DurableContainmentIncidentCoordinator,
  type ContainmentAssessmentEffectPort,
  type ContainmentAssessmentRequest,
  type ContainmentAssessmentResult
} from "../src/containment-incidents.ts";
import { DurableContainmentManager } from "../src/containment.ts";
import { ProtectedJsonStore, sha256 } from "../src/store.ts";

async function fixture(context: test.TestContext, options: ConstructorParameters<typeof DurableContainmentIncidentCoordinator>[1] = {}) {
  const directory = await mkdtemp(join(tmpdir(), "sxsy-b122-incident-"));
  context.after(() => rm(directory, { recursive: true, force: true }));
  const store = new ProtectedJsonStore({ filePath: join(directory, "audit.jsonl") });
  const coordinator = new DurableContainmentIncidentCoordinator(store, options);
  const incident = await coordinator.activate({
    repositoryRoot: "C:/work/example",
    fenceEpoch: 7,
    activationOperationId: "operation-containment-7",
    reason: "suspected token exposure"
  });
  return { store, coordinator, incident };
}

class AssessmentPort implements ContainmentAssessmentEffectPort {
  readonly calls: ContainmentAssessmentRequest[] = [];
  readonly observations: ContainmentAssessmentRequest[] = [];
  readonly committed = new Map<string, ContainmentAssessmentResult>();
  failAfterCommit = false;

  async execute(request: ContainmentAssessmentRequest): Promise<ContainmentAssessmentResult> {
    this.calls.push(request);
    const result: ContainmentAssessmentResult = request.step === "working_tree"
      ? {
          ...binding(request),
          effectDisposition: "committed",
          status: "failed",
          exposure: "found",
          summary: "token=ghp_1234567890abcdef was found and must not be logged",
          findings: [{ id: "finding-worktree-token", relativePath: "config/local.env", credentialRelated: true }]
        }
      : {
          ...binding(request),
          effectDisposition: "committed",
          status: "passed",
          exposure: "none",
          summary: `${request.step} has no exposure`,
          findings: []
        };
    this.committed.set(request.externalId, result);
    if (this.failAfterCommit) throw new Error("response lost after external commit");
    return result;
  }

  async observe(request: ContainmentAssessmentRequest): Promise<ContainmentAssessmentResult | undefined> {
    this.observations.push(request);
    return this.committed.get(request.externalId);
  }
}

test("incident assessment is durable, redacts values, and never replays a committed child", async (context) => {
  const { store, coordinator, incident } = await fixture(context);
  const port = new AssessmentPort();
  port.failAfterCommit = true;

  const interrupted = await coordinator.assess(incident.id, port);
  assert.equal(interrupted.steps.find((step) => step.name === "working_tree")?.status, "ambiguous");
  assert.equal(port.calls.length, 1);

  const restarted = new DurableContainmentIncidentCoordinator(store);
  port.failAfterCommit = false;
  const completed = await restarted.assess(incident.id, port);
  assert.equal(port.calls.filter((call) => call.step === "working_tree").length, 1);
  assert.equal(port.observations.filter((call) => call.step === "working_tree").length, 1);
  assert.equal(completed.steps.every((step) => step.status === "completed"), true);
  const serialized = JSON.stringify(completed);
  assert.doesNotMatch(serialized, /ghp_1234567890abcdef/);
  assert.match(serialized, /\[REDACTED\]/);
  assert.equal(completed.status, "remediation_required");
});

test("remote unknown and missing credential remediation keep release unavailable", async (context) => {
  const { coordinator, incident } = await fixture(context);
  const port = new AssessmentPort();
  const original = port.execute.bind(port);
  port.execute = async (request) => request.step === "remote"
    ? { ...binding(request), effectDisposition: "committed", status: "incomplete", exposure: "unknown", summary: "remote could not be determined", findings: [] }
    : original(request);
  const assessed = await coordinator.assess(incident.id, port);
  assert.equal(assessed.status, "assessment_incomplete");
  await assert.rejects(coordinator.assertReadyForRelease(incident.id), /assessment.*incomplete/i);
});

test("remediation permits are exact, one-time, no-egress, and invalid across fence generations", async (context) => {
  let now = Date.parse("2026-08-25T12:00:00.000Z");
  const { coordinator, incident } = await fixture(context, { now: () => new Date(now).toISOString() });
  await coordinator.assess(incident.id, new AssessmentPort());
  const permit = await coordinator.issueRemediationPermit({
    incidentId: incident.id,
    action: "remove_exposed_value",
    relativePaths: ["config/local.env"],
    expiresAt: "2026-08-25T12:05:00.000Z",
    reviewedBy: "windows-current-user"
  });
  assert.equal(permit.networkAllowed, false);
  assert.equal(permit.credentialAccessAllowed, false);
  await assert.rejects(coordinator.recordRemediation({
    permitId: permit.id,
    incidentId: incident.id,
    action: permit.action,
    relativePaths: ["other.env"],
    remediatedFindingIds: ["finding-worktree-token"],
    evidenceDigest: sha256("receipt")
  }), /path/i);
  await coordinator.recordRemediation({
    permitId: permit.id,
    incidentId: incident.id,
    action: permit.action,
    relativePaths: permit.relativePaths,
    remediatedFindingIds: ["finding-worktree-token"],
    evidenceDigest: sha256("receipt")
  });
  await assert.rejects(coordinator.recordRemediation({
    permitId: permit.id,
    incidentId: incident.id,
    action: permit.action,
    relativePaths: permit.relativePaths,
    remediatedFindingIds: ["finding-worktree-token"],
    evidenceDigest: sha256("receipt")
  }), /consumed/i);

  await coordinator.recordRotationReview({
    incidentId: incident.id,
    disposition: "complete",
    evidenceReference: "credential-rotation-ticket-17",
    evidenceDigest: sha256("rotation evidence")
  });
  assert.equal((await coordinator.assertReadyForRelease(incident.id)).status, "ready_for_release");

  const replacement = await coordinator.activate({
    repositoryRoot: incident.repositoryRoot,
    fenceEpoch: 8,
    activationOperationId: "operation-containment-8",
    reason: "new exposure generation"
  });
  assert.notEqual(replacement.id, incident.id);
  await assert.rejects(coordinator.assertReadyForRelease(incident.id), /newer.*fence/i);
  now += 10 * 60_000;
  await assert.rejects(coordinator.issueRemediationPermit({
    incidentId: replacement.id,
    action: "remove_exposed_value",
    relativePaths: ["config/local.env"],
    expiresAt: "2026-08-25T12:05:00.000Z",
    reviewedBy: "windows-current-user"
  }), /expired|assessment/i);
});

test("release readiness requires exact finding receipts and credential-rotation evidence", async (context) => {
  const { coordinator, incident } = await fixture(context);
  await coordinator.assess(incident.id, new AssessmentPort());
  await coordinator.recordRotationReview({
    incidentId: incident.id,
    disposition: "complete",
    evidenceReference: "credential-rotation-ticket-18",
    evidenceDigest: sha256("rotation evidence")
  });
  await assert.rejects(coordinator.assertReadyForRelease(incident.id), /finding.*remediation/i);
});

test("durable containment atomically opens and automatically resumes the incident assessment", async (context) => {
  const directory = await mkdtemp(join(tmpdir(), "sxsy-b122-incident-manager-"));
  context.after(() => rm(directory, { recursive: true, force: true }));
  const store = new ProtectedJsonStore({ filePath: join(directory, "audit.jsonl") });
  const port = new AssessmentPort();
  const manager = new DurableContainmentManager(store, {
    revokeCredentialLeases: async () => undefined,
    cancelQueuedOperations: async () => undefined
  }, { incidentAssessmentPort: port });
  const fence = await manager.activate({ repositoryRoot: "C:/work/atomic", operationId: "operation-containment-atomic", reason: "atomic incident" });
  assert.match(fence.incidentId ?? "", /^containment-incident:/);
  const incident = await manager.incidents.get(fence.incidentId!);
  assert.equal(incident?.steps.every((step) => step.status === "completed"), true);
  assert.equal(port.calls.length, 3);
  assert.equal((await manager.check(fence.repositoryRoot, "local_remediation")).allowed, false);
  assert.equal((await manager.check(fence.repositoryRoot, "local_cleanup")).allowed, true);
  const finding = incident?.steps.flatMap((step) => step.result?.findings ?? [])[0];
  assert.ok(finding);
  const permit = await manager.incidents.issueRemediationPermit({
    incidentId: incident!.id,
    action: "remove_exposed_value",
    relativePaths: [finding.relativePath],
    expiresAt: "2099-01-01T00:00:00.000Z",
    reviewedBy: "windows-current-user"
  });
  assert.equal((await manager.check(fence.repositoryRoot, "local_remediation", {
    permitId: permit.id,
    incidentId: incident!.id,
    fenceEpoch: incident!.fenceEpoch,
    action: permit.action,
    relativePaths: permit.relativePaths,
    remediatedFindingIds: [finding.id]
  })).allowed, true);
  const entries = await store.readEntries();
  const fenceSequence = entries.find((entry) => entry.kind === "containment.saved")?.sequence;
  const incidentSequence = entries.find((entry) => entry.kind === "containment.incident.saved.v1")?.sequence;
  assert.equal(typeof fenceSequence, "number");
  assert.equal(incidentSequence, (fenceSequence ?? 0) + 1);
});

function binding(request: ContainmentAssessmentRequest) {
  return {
    schema: "sxsy-b122.containment-assessment-result" as const,
    version: 1 as const,
    incidentId: request.incidentId,
    repositoryRoot: request.repositoryRoot,
    fenceEpoch: request.fenceEpoch,
    step: request.step,
    operationId: request.operationId,
    externalId: request.externalId
  };
}
