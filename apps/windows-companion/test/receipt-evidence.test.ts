import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import type { CommandResult, TargetSnapshot } from "../../../packages/control-plane/src/contracts.ts";
import type { ExecutionRequest } from "../../../packages/control-plane/src/brokers.ts";
import { commandForAction } from "../../../packages/control-plane/src/command-catalog.ts";
import { targetSnapshotDigest } from "../../../packages/control-plane/src/snapshot.ts";
import { HostReceiptEvidenceFactory, loadOrCreateHostReceiptEvidenceFactory } from "../src/receipt-evidence.ts";
import { createRepositoryRecipeEvidence, type RepositoryRecipeEvidenceBinding } from "../src/repository-runtime-broker.ts";
import type { RepositoryRuntimeResult } from "../src/repository-runtime.ts";
import type { UserSecretProtector } from "../src/windows-secret.ts";

const targetMaterial = {
  repositoryRoot: "C:\\work\\repo", branch: "feat/evidence", head: "a".repeat(40), indexTree: "b".repeat(40),
  trackedManifest: "tracked", untrackedManifest: "untracked", submodules: {}, policyVersion: "policy-v7",
  environmentFingerprint: "environment", completeness: "complete" as const, reasons: [] as readonly string[]
};
const target: TargetSnapshot = { id: targetSnapshotDigest(targetMaterial), ...targetMaterial, capturedAt: "2026-08-24T12:00:00.000Z" };

const versions = { companion: "1.2.3", node: "24.14.0", sandboxHelper: "sha256:sandbox", rawHidHelper: "sha256:hid" } as const;

function factory(now = "2026-08-24T12:01:00.000Z"): HostReceiptEvidenceFactory {
  return new HostReceiptEvidenceFactory({
    authenticationKey: Buffer.alloc(32, 7),
    policyVersion: "policy-v7",
    exactVersions: versions,
    clock: () => new Date(now)
  });
}

test("trusted complete runtime evidence is bound to action, operation, target, policy, tools, helpers, and expiry", () => {
  const evidence = factory();
  const request: ExecutionRequest = {
    action: "pipeline_local_gate", operationId: "operation-1", target,
    permit: { expiresAt: "2026-08-24T12:05:00.000Z" } as ExecutionRequest["permit"],
    recipe: { id: "sxsy-b122.repository-runtime:pipeline_local_gate", executable: "@sxsy-b122/host-pinned-runtime", args: [], workingDirectory: target.repositoryRoot, environment: {} }
  };
  const runtimeResult: RepositoryRuntimeResult = { status: "completed", summary: "passed", output: "bounded output", outputTruncated: false, exitCode: 0 };
  const binding: RepositoryRecipeEvidenceBinding = {
    manifestSha256: "c".repeat(64), helperSha256: "d".repeat(64), helperVersion: "b122-repository-runner/1", resultSha256: "e".repeat(64),
    toolVersions: { node: versions.node }, scannerFixtureIds: [], advisoryFixtureIds: [],
    coverage: [
      { dimension: "correctness", status: "covered", fixtureId: "correctness-v1" },
      { dimension: "isolation", status: "covered", fixtureId: "isolation-v1" },
      { dimension: "production_data", status: "covered", fixtureId: "production-data-v1" },
      { dimension: "ambient_credentials", status: "covered", fixtureId: "ambient-credentials-v1" }
    ],
    policyVersion: target.policyVersion, createdAt: "2026-08-24T12:00:30.000Z", expiresAt: "2026-08-24T12:05:00.000Z"
  };
  const typed = createRepositoryRecipeEvidence(request, runtimeResult, binding, Date.parse("2026-08-24T12:01:00.000Z"));
  const envelope = evidence.issueRepositoryRecipeEvidence(typed, request, binding);
  const result: CommandResult = { status: "completed", summary: "verified", operationId: "operation-1", data: { receiptEvidenceEnvelope: envelope } };
  assert.deepEqual(evidence.forResult(commandForAction("pipeline_local_gate"), result, target), {
    policyVersion: "policy-v7", evidenceDigest: envelope.evidenceDigest, toolVersions: versions, expiresAt: "2026-08-24T12:05:00.000Z"
  });
  assert.throws(() => { (envelope.exactVersions as Record<string, string>).node = "mutated"; }, /read only|extensible|assign/i);
  assert.equal(envelope.exactVersions.node, versions.node);
  assert.deepEqual(envelope.evidence, {
    recipeEvidenceSha256: typed.evidenceSha256, manifestSha256: binding.manifestSha256, helperSha256: binding.helperSha256,
    helperVersion: binding.helperVersion, resultSha256: binding.resultSha256, outputSha256: typed.output.sha256, toolVersions: binding.toolVersions
  });
  assert.throws(() => evidence.issueRepositoryRecipeEvidence({ ...typed, output: { ...typed.output, sha256: "0".repeat(64) } }, request, binding), /repository recipe evidence/i);
  assert.throws(() => factory("2026-08-24T12:05:00.000Z").issueRepositoryRecipeEvidence(typed, request, binding), /repository recipe evidence/i);
});

test("incomplete evidence never creates a passing receipt and may evidence only an incomplete result", () => {
  const evidence = factory();
  const incompleteMaterial = { ...targetMaterial, completeness: "incomplete" as const, reasons: ["unreadable file"] };
  const incompleteTarget: TargetSnapshot = { id: targetSnapshotDigest(incompleteMaterial), ...incompleteMaterial, capturedAt: target.capturedAt };
  const envelope = evidence.issue({
    producer: "scanner", action: "shield_change_scan", operationId: "operation-2", target: incompleteTarget,
    outcome: "incomplete", completeness: "incomplete", observedAt: "2026-08-24T12:00:30.000Z", expiresAt: "2026-08-24T12:05:00.000Z",
    evidence: { scannerFeedSha256: "e".repeat(64), findingCount: 1 }
  });
  assert.equal(evidence.forResult(commandForAction("shield_change_scan"), { status: "completed", summary: "not complete", operationId: "operation-2", data: { receiptEvidenceEnvelope: envelope } }, target), undefined);
  assert.deepEqual(evidence.forResult(commandForAction("shield_change_scan"), { status: "incomplete", summary: "incomplete", operationId: "operation-2", data: { receiptEvidenceEnvelope: envelope } }, incompleteTarget), {
    policyVersion: "policy-v7", evidenceDigest: envelope.evidenceDigest, toolVersions: versions, expiresAt: "2026-08-24T12:05:00.000Z"
  });
});

test("tampered, cross-target, cross-operation, wrong-version, and stale envelopes are rejected", () => {
  const evidence = factory();
  const envelope = evidence.issue({
    producer: "scanner", action: "release_shield", operationId: "operation-3", target,
    outcome: "passed", completeness: "complete", observedAt: "2026-08-24T12:00:30.000Z", expiresAt: "2026-08-24T12:05:00.000Z",
    evidence: { scannerFeedSha256: "1".repeat(64), findingCount: 0 }
  });
  const definition = commandForAction("release_shield");
  const result = (candidate: unknown, operationId = "operation-3"): CommandResult => ({ status: "completed", summary: "verified", operationId, data: { receiptEvidenceEnvelope: candidate } });
  assert.equal(evidence.forResult(definition, result({ ...envelope, evidenceDigest: "0".repeat(64) }), target), undefined);
  assert.equal(evidence.forResult(definition, result(envelope, "operation-other"), target), undefined);
  assert.equal(evidence.forResult(definition, result(envelope), { ...target, id: "snapshot-other" }), undefined);
  assert.equal(new HostReceiptEvidenceFactory({ authenticationKey: Buffer.alloc(32, 7), policyVersion: "policy-v7", exactVersions: { ...versions, node: "other" }, clock: () => new Date("2026-08-24T12:01:00.000Z") }).forResult(definition, result(envelope), target), undefined);
  assert.equal(factory("2026-08-24T12:05:00.000Z").forResult(definition, result(envelope), target), undefined);
  assert.throws(() => evidence.issue({
    producer: "scanner", action: "release_shield", operationId: "operation-bad-target", target: { ...target, id: "forged-target-id" },
    outcome: "passed", completeness: "complete", observedAt: "2026-08-24T12:00:30.000Z", expiresAt: "2026-08-24T12:05:00.000Z",
    evidence: { scannerFeedSha256: "2".repeat(64), findingCount: 0 }
  }), /target.*identity/i);
  assert.throws(() => evidence.issue({
    producer: "workspace" as never, action: "release_shield", operationId: "operation-3", target,
    outcome: "passed", completeness: "complete", observedAt: "2026-08-24T12:00:30.000Z", expiresAt: "2026-08-24T12:05:00.000Z",
    evidence: { scannerFeedSha256: "2".repeat(64), findingCount: 0 }
  } as never), /producer/i);
});

test("installed receipt key is created once behind the host protector, reloads identically, and fails closed on tamper", async (context) => {
  const folder = await mkdtemp(join(tmpdir(), "sxsy-b122-receipt-key-"));
  context.after(async () => { await rm(folder, { recursive: true, force: true }); });
  const values = new Map<string, Uint8Array>();
  let seals = 0;
  const protector: UserSecretProtector = {
    provider: "isolated-opaque-protector",
    async seal(cleartext) { const id = `opaque-${++seals}`; values.set(id, new Uint8Array(cleartext)); return id; },
    async open(sealed) { const value = values.get(sealed); if (!value) throw new Error("tampered"); return new Uint8Array(value); }
  };
  const path = join(folder, "receipt-evidence-key.json");
  const options = { filePath: path, protector, policyVersion: "policy-v7", exactVersions: versions, clock: () => new Date("2026-08-24T12:01:00.000Z") } as const;
  const first = await loadOrCreateHostReceiptEvidenceFactory(options);
  const second = await loadOrCreateHostReceiptEvidenceFactory(options);
  assert.equal(seals, 1);
  const document = JSON.parse(await readFile(path, "utf8")) as Record<string, unknown>;
  assert.deepEqual(Object.keys(document).sort(), ["protector", "schema", "sealedKey", "version"]);
  const envelope = first.issue({
    producer: "scanner", action: "shield_change_scan", operationId: "operation-key", target,
    outcome: "passed", completeness: "complete", observedAt: "2026-08-24T12:00:30.000Z", expiresAt: "2026-08-24T12:05:00.000Z",
    evidence: { scannerFeedSha256: "3".repeat(64), findingCount: 0 }
  });
  assert.ok(second.forResult(commandForAction("shield_change_scan"), { status: "completed", summary: "verified", operationId: "operation-key", data: { receiptEvidenceEnvelope: envelope } }, target));
  await writeFile(path, JSON.stringify({ ...document, sealedKey: "tampered" }), "utf8");
  await assert.rejects(() => loadOrCreateHostReceiptEvidenceFactory(options), /receipt evidence key|tamper|open/i);
  assert.equal(seals, 1);
});
