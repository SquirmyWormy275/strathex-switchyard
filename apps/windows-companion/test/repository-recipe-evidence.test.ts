import assert from "node:assert/strict";
import test from "node:test";

import type { ExecutionRequest } from "../../../packages/control-plane/src/brokers.ts";
import type { TargetSnapshot } from "../../../packages/control-plane/src/contracts.ts";
import {
  createRepositoryRecipeEvidence,
  verifyRepositoryRecipeEvidence,
  type RepositoryRecipeEvidenceBinding
} from "../src/repository-runtime-broker.ts";
import type { RepositoryRuntimeResult } from "../src/repository-runtime.ts";

const now = Date.parse("2026-08-24T12:00:00.000Z");
const target: TargetSnapshot = {
  id: "target-evidence",
  repositoryRoot: "C:\\repo",
  branch: "feature/evidence",
  head: "a".repeat(40),
  indexTree: "b".repeat(40),
  trackedManifest: "c".repeat(64),
  untrackedManifest: "d".repeat(64),
  canonicalRemote: "https://github.com/example/repo.git",
  submodules: {},
  policyVersion: "policy-evidence-v1",
  environmentFingerprint: "e".repeat(64),
  capturedAt: new Date(now).toISOString(),
  completeness: "complete",
  reasons: []
};

function request(action = "shield_change_scan"): ExecutionRequest {
  return {
    action: action as ExecutionRequest["action"],
    operationId: "operation-evidence",
    target,
    permit: { expiresAt: new Date(now + 60_000).toISOString() } as ExecutionRequest["permit"],
    recipe: { id: `sxsy-b122.repository-runtime:${action}`, executable: "@sxsy-b122/host-pinned-runtime", args: [], workingDirectory: target.repositoryRoot, environment: {} },
    effectGuard: { async assertCurrent() { return { allowed: true, reason: "current" }; } }
  };
}

function binding(overrides: Partial<RepositoryRecipeEvidenceBinding> = {}): RepositoryRecipeEvidenceBinding {
  return {
    manifestSha256: "1".repeat(64),
    helperSha256: "2".repeat(64),
    helperVersion: "b122-repository-runner/1",
    resultSha256: "3".repeat(64),
    toolVersions: { secretScanner: "fixture-scanner-1" },
    scannerFixtureIds: ["scanner-fixture-2026-08-24"],
    advisoryFixtureIds: [],
    coverage: [
      { dimension: "secrets", status: "covered", fixtureId: "scanner-fixture-2026-08-24" },
      { dimension: "pii", status: "covered", fixtureId: "scanner-fixture-2026-08-24" },
      { dimension: "security_defects", status: "covered", fixtureId: "scanner-fixture-2026-08-24" }
    ],
    policyVersion: target.policyVersion,
    createdAt: new Date(now).toISOString(),
    expiresAt: new Date(now + 60_000).toISOString(),
    ...overrides
  };
}

const result: RepositoryRuntimeResult = { status: "completed", summary: "host verified", output: "untrusted stdout cannot set metadata", outputTruncated: false, exitCode: 0 };

test("complete evidence is host-derived and bound to the exact operation, target, policy, tools, helper, and output", () => {
  const envelope = createRepositoryRecipeEvidence(request(), result, binding(), now);
  assert.equal(envelope.outcome, "passed");
  assert.equal(envelope.completeness, "complete");
  assert.equal(envelope.targetSnapshotId, target.id);
  assert.equal(envelope.operationId, "operation-evidence");
  assert.equal(envelope.output.bytes, Buffer.byteLength(result.output!, "utf8"));
  assert.match(envelope.evidenceSha256, /^[a-f0-9]{64}$/);
  assert.deepEqual(verifyRepositoryRecipeEvidence(envelope, request(), binding(), now), { valid: true, reason: "Repository recipe evidence is current and exactly bound." });
});

test("missing scanner coverage or freshness is incomplete and can never be issued as a pass", () => {
  const incomplete = createRepositoryRecipeEvidence(request(), result, binding({ coverage: [
    { dimension: "secrets", status: "covered", fixtureId: "scanner-fixture-2026-08-24" },
    { dimension: "pii", status: "unavailable" },
    { dimension: "security_defects", status: "covered", fixtureId: "scanner-fixture-2026-08-24" }
  ] }), now);
  assert.equal(incomplete.outcome, "incomplete");
  assert.equal(incomplete.completeness, "incomplete");
  assert.deepEqual(incomplete.unavailableDimensions, ["pii"]);
});

test("tampered or stale evidence fails verification without trusting recipe stdout", () => {
  const exactBinding = binding();
  const envelope = createRepositoryRecipeEvidence(request(), result, exactBinding, now);
  const tampered = { ...envelope, helperSha256: "f".repeat(64) };
  assert.equal(verifyRepositoryRecipeEvidence(tampered, request(), exactBinding, now).valid, false);
  assert.deepEqual(verifyRepositoryRecipeEvidence(envelope, request(), exactBinding, now + 120_000), { valid: false, reason: "Repository recipe evidence is expired or future-dated." });
});
