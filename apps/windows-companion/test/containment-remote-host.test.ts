import assert from "node:assert/strict";
import { createHash, generateKeyPairSync } from "node:crypto";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import test from "node:test";

import type { ManagedSession, TargetSnapshot } from "../../../packages/control-plane/src/contracts.ts";
import { containmentIncidentReviewDigest, type ContainmentAssessmentRequest, type ContainmentIncidentRecord } from "../../../packages/control-plane/src/containment-incidents.ts";
import { ProtectedJsonStore } from "../../../packages/control-plane/src/store.ts";
import {
  createContainmentRemoteEvidenceAdministration,
  containmentRemoteDetectorManifest,
  DurableContainmentRemoteEvidenceRegistry,
  type ContainmentRemoteTrustPolicy
} from "../src/containment-remote-evidence.ts";
import { InstalledContainmentRemoteCoordinator } from "../src/containment-remote-host.ts";
import type { LocalGitRunner } from "../src/mediated-git.ts";

const now = "2026-08-25T12:00:00.000Z";
const incidentId = `containment-incident:${"1".repeat(64)}`;
const authenticator = {
  provider: "containment-remote-host-test",
  async seal(hash: string) { return `test:${hash}`; },
  async verify(hash: string, tag: string) { return tag === `test:${hash}`; }
};

function incident(repositoryRoot: string, targetSnapshotId: string): ContainmentIncidentRecord {
  return {
    version: 1, id: incidentId, repositoryRoot, fenceEpoch: 7, activationOperationId: "containment-activation-7",
    reason: "reviewed incident", createdAt: now, updatedAt: now, status: "assessment_incomplete",
    assessment: { generation: 1, purpose: "initial", targetSnapshotId, basedOnFindingIds: [], basedOnReceiptIds: [], credentialRotationRequired: false, startedAt: now },
    steps: (["working_tree", "history", "remote"] as const).map((step) => ({
      name: step,
      operationId: `containment-assessment:${step === "working_tree" ? "2" : step === "history" ? "3" : "4"}`.padEnd("containment-assessment:".length + 64, step === "working_tree" ? "2" : step === "history" ? "3" : "4"),
      externalId: `containment-assessment:${step === "working_tree" ? "5" : step === "history" ? "6" : "7"}`.padEnd("containment-assessment:".length + 64, step === "working_tree" ? "5" : step === "history" ? "6" : "7"),
      status: step === "remote" ? "pending" : "completed",
      attempts: step === "remote" ? 0 : 1,
      updatedAt: now,
      ...(step === "remote" ? {} : { result: {
        schema: "sxsy-b122.containment-assessment-result" as const, version: 1 as const, incidentId, repositoryRoot, fenceEpoch: 7,
        step, operationId: `containment-assessment:${step === "working_tree" ? "2" : "3"}`.padEnd("containment-assessment:".length + 64, step === "working_tree" ? "2" : "3"),
        externalId: `containment-assessment:${step === "working_tree" ? "5" : "6"}`.padEnd("containment-assessment:".length + 64, step === "working_tree" ? "5" : "6"),
        effectDisposition: "committed" as const, status: "passed" as const, exposure: "none" as const, summary: "Clean.", findings: []
      } })
    })),
    permits: [], receipts: []
  };
}

function remoteRequest(value: ContainmentIncidentRecord): ContainmentAssessmentRequest {
  const step = value.steps.find((candidate) => candidate.name === "remote")!;
  return {
    schema: "sxsy-b122.containment-assessment-request", version: 1, incidentId: value.id, repositoryRoot: value.repositoryRoot,
    fenceEpoch: value.fenceEpoch, step: "remote", operationId: step.operationId, externalId: step.externalId,
    egressAllowed: false, revealSecretValues: false
  };
}

function session(repositoryRoot: string, targetSnapshotId: string): ManagedSession {
  return {
    id: "session-contained", provider: "codex", surface: "vscode_terminal",
    capabilities: ["registered", "observable", "controllable", "mediated"], status: "running",
    workspaceRoot: repositoryRoot, targetSnapshotId, plannedFiles: [], lastHeartbeat: now,
    adapterVersion: "test", metadata: {}
  };
}

function target(repositoryRoot: string, id: string, canonicalRemote?: string): TargetSnapshot {
  return {
    id, repositoryRoot, ...(canonicalRemote ? { canonicalRemote } : {}), branch: "feature/contained", head: "8".repeat(40), indexTree: "9".repeat(40),
    trackedManifest: "a".repeat(64), untrackedManifest: "b".repeat(64), submodules: {}, policyVersion: "containment-policy-9",
    environmentFingerprint: "c".repeat(64), capturedAt: now, completeness: "complete", reasons: []
  };
}

class InventoryGit implements LocalGitRunner {
  constructor(private readonly root: string, private readonly remotes: Readonly<Record<string, Readonly<{ fetch: readonly string[]; push: readonly string[] }>>>) {}
  async run(args: readonly string[]) {
    if (args[0] === "rev-parse") return { exitCode: 0, stdout: `${this.root}\n`, stderr: "" };
    if (args.length === 1 && args[0] === "remote") return { exitCode: 0, stdout: `${Object.keys(this.remotes).join("\n")}${Object.keys(this.remotes).length ? "\n" : ""}`, stderr: "" };
    if (args[0] === "remote" && args[1] === "get-url") {
      const name = args.at(-1)!;
      const remote = this.remotes[name];
      if (!remote) return { exitCode: 2, stdout: "", stderr: "missing" };
      const values = args.includes("--push") ? remote.push : remote.fetch;
      return { exitCode: 0, stdout: `${values.join("\n")}\n`, stderr: "" };
    }
    throw new Error(`Unexpected Git arguments: ${args.join(" ")}`);
  }
}

async function setup(context: test.TestContext, configured: boolean) {
  const root = await mkdtemp(join(tmpdir(), "sxsy-containment-remote-host-"));
  context.after(async () => { await rm(root, { recursive: true, force: true }); });
  const repositoryRoot = resolve(root, "repository");
  await mkdir(repositoryRoot);
  const targetSnapshotId = `target:${"d".repeat(64)}`;
  const currentIncident = incident(repositoryRoot, targetSnapshotId);
  const currentSession = session(repositoryRoot, targetSnapshotId);
  const currentTarget = target(repositoryRoot, targetSnapshotId, configured ? "https://github.com/example/switchyard.git" : undefined);
  const store = new ProtectedJsonStore({ filePath: join(root, "protected.jsonl"), clock: () => now, authenticator });
  const registry = new DurableContainmentRemoteEvidenceRegistry(store, { now: () => new Date(now), nonceFactory: () => "e".repeat(64) });
  const administration = createContainmentRemoteEvidenceAdministration({
    registry, now: () => new Date(now),
    presence: { async verify() { return { verified: true, operator: "TEST\\Security" }; } }
  });
  const remotes: Readonly<Record<string, Readonly<{ fetch: readonly string[]; push: readonly string[] }>>> = configured ? {
    origin: {
      fetch: ["https://github.com/example/switchyard.git"],
      push: ["https://github.com/example/switchyard.git"]
    }
  } : {};
  const coordinator = new InstalledContainmentRemoteCoordinator({
    policyVersion: "containment-policy-9", stateDirectory: join(root, "state"),
    incidents: { async get(id: string) { return id === currentIncident.id ? currentIncident : undefined; } },
    sessions: { async get(id: string) { return id === currentSession.id ? currentSession : undefined; }, async list() { return [currentSession]; } },
    targets: { async resolve() { return currentTarget; } }, registry, administration,
    git: new InventoryGit(repositoryRoot, remotes), now: () => new Date(now)
  });
  return { root, repositoryRoot, currentIncident, currentSession, currentTarget, registry, coordinator };
}

test("installed remote challenge derives the exact target and all configured endpoints without caller-selected refs", async (context) => {
  const fixture = await setup(context, true);
  const keys = generateKeyPairSync("ec", { namedCurve: "prime256v1" });
  const publicKeyPem = keys.publicKey.export({ type: "spki", format: "pem" }).toString();
  const keyId = createHash("sha256").update(keys.publicKey.export({ type: "spki", format: "der" })).digest("hex");
  const trust: ContainmentRemoteTrustPolicy = {
    schema: "sxsy-b122.containment-remote-trust-policy", version: 2, purpose: "containment-remote-assessment",
    authorityId: "independent-remote-auditor", keyId, publicKeyPem,
    gitExecutableSha256: "f".repeat(64), detectorManifestId: containmentRemoteDetectorManifest.id,
    networkPolicy: "public-https-dns-pinned-no-redirect-v1", expiresAt: "2026-08-26T12:00:00.000Z"
  };
  const trustPath = join(fixture.root, "trust.json");
  await writeFile(trustPath, JSON.stringify(trust), "utf8");
  await fixture.coordinator.installTrustPolicy(trustPath);
  const exact = {
    sessionId: fixture.currentSession.id,
    expectedIncidentId: fixture.currentIncident.id,
    expectedIncidentDigest: containmentIncidentReviewDigest(fixture.currentIncident),
    expiresAt: "2026-08-25T12:10:00.000Z"
  };
  const challenge = await fixture.coordinator.issueChallenge(exact);
  assert.equal(challenge.incidentId, fixture.currentIncident.id);
  assert.equal(challenge.targetSnapshotId, fixture.currentTarget.id);
  assert.deepEqual(challenge.configuredRemotes, [
    { name: "origin", canonicalIdentity: "https://github.com/example/switchyard.git" }
  ]);
  const challengeDocument = JSON.parse(await readFile(challenge.challengePath, "utf8"));
  assert.equal(challengeDocument.gitExecutableSha256, "f".repeat(64));
  assert.equal(challengeDocument.detectorManifestId, containmentRemoteDetectorManifest.id);
  assert.equal(challengeDocument.networkPolicy, "public-https-dns-pinned-no-redirect-v1");
  assert.match(challenge.challengePath.replaceAll("\\", "/"), /\/challenges\/[a-f0-9]{64}\.json$/);
  const unresolved = await fixture.coordinator.execute(remoteRequest(fixture.currentIncident));
  assert.equal(unresolved.status, "incomplete");
  assert.equal(unresolved.effectDisposition, "not_started");
  await assert.rejects(fixture.coordinator.issueChallenge({ ...exact, expectedIncidentDigest: "0".repeat(64) }), /changed after.*review/i);
});

test("installed remote assessment records an explicit clean proof when the host has zero configured remotes", async (context) => {
  const fixture = await setup(context, false);
  const request = remoteRequest(fixture.currentIncident);
  const result = await fixture.coordinator.execute(request);
  assert.equal(result.status, "passed");
  assert.equal(result.exposure, "none");
  assert.equal(result.effectDisposition, "committed");
  assert.deepEqual(result.findings, []);
  await fixture.coordinator.validateRelease({ sessionId: fixture.currentSession.id, incident: fixture.currentIncident, expectedIncidentDigest: containmentIncidentReviewDigest(fixture.currentIncident) });
});
