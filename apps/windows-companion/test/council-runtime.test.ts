import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { CouncilCoordinator } from "../../../packages/control-plane/src/council.ts";
import { AllowlistedEvidenceAuthorizer, GateEvidenceLedger } from "../../../packages/control-plane/src/acceptance-evidence.ts";
import { SessionRegistry } from "../../../packages/control-plane/src/session-registry.ts";
import { ProtectedJsonStore } from "../../../packages/control-plane/src/store.ts";
import type { ManagedSession, TargetSnapshot } from "../../../packages/control-plane/src/contracts.ts";
import { DurableConfiguredCouncilExecutor, LedgerCouncilAutomaticAcceptanceGate, type CouncilAutomaticAcceptanceGate, type CouncilWorkspaceIsolator } from "../src/council-runtime.ts";
import type { CouncilIsolationPlan, CouncilIsolationPrepareRequest, CouncilWorkspaceBinding } from "../src/council-workspace-isolation.ts";
import type { DynamicConfiguredNetworkClient } from "../src/remote-adapters.ts";

const at = "2026-08-24T12:00:00.000Z";
const target: TargetSnapshot = { id: "a".repeat(64), repositoryRoot: "C:\\repo", branch: "feat/test", defaultBranch: "main", head: "b".repeat(40), indexTree: "c".repeat(40), trackedManifest: "d".repeat(64), untrackedManifest: "e".repeat(64), submodules: {}, policyVersion: "v1", environmentFingerprint: "f".repeat(64), capturedAt: at, completeness: "complete", reasons: [] };
const session = (id: string, provider: ManagedSession["provider"], plannedFiles: readonly string[]): ManagedSession => ({ id, provider, surface: "bridge", capabilities: ["registered", "observable", "controllable", "mediated"], status: "running", workspaceRoot: target.repositoryRoot, targetSnapshotId: target.id, taskId: `task-${id}`, planRevision: "plan-1", plannedFiles, lastHeartbeat: at, adapterVersion: "provider-v1", metadata: { "sxsy-b122.providerHandshake": "exact-route-v1", "sxsy-b122.defaultBranch": "main", "sxsy-b122.resources": JSON.stringify([`port:${id === "one" ? "45101" : "45102"}`]), "sxsy-b122.dependencies": "[]", "sxsy-b122.diffDigest": (id === "one" ? "1" : "2").repeat(64) } });

const acceptedGate: CouncilAutomaticAcceptanceGate = { async accepted() { return true; } };

function fakeIsolation(): CouncilWorkspaceIsolator & { readonly prepared: CouncilIsolationPrepareRequest[]; readonly asserted: string[]; readonly cleaned: string[] } {
  const plans = new Map<string, CouncilIsolationPlan>();
  const prepared: CouncilIsolationPrepareRequest[] = []; const asserted: string[] = []; const cleaned: string[] = [];
  const create = (input: CouncilIsolationPrepareRequest): CouncilIsolationPlan => {
    const bindings: CouncilWorkspaceBinding[] = input.assignments.map((assignment, index) => ({
      sessionId: assignment.sessionId, paths: assignment.paths, declarations: assignment.resources,
      worktreeRoot: `C:\\host-state\\${input.epochId}\\${assignment.sessionId}`,
      branch: `sxsy-b122/council/${input.epochId}/${assignment.sessionId}`,
      head: input.targetHead,
      leases: [],
      resourceHost: {
        schema: "sxsy-b122.council-resource-host", version: 1, epochId: input.epochId, sessionId: assignment.sessionId,
        fenceDigest: (index === 0 ? "6" : "7").repeat(64), capabilities: ["held-loopback-port"], resources: [],
        environment: { SXSY_COUNCIL_SESSION_ID: assignment.sessionId }, digest: (index === 0 ? "8" : "9").repeat(64)
      },
      assignmentDigest: (index === 0 ? "3" : "4").repeat(64)
    }));
    return { epochId: input.epochId, targetSnapshotId: input.targetSnapshotId, repositoryRoot: input.repositoryRoot, targetHead: input.targetHead, defaultBranch: input.defaultBranch, stateRoot: "C:\\host-state", bindings, status: "prepared", executionAuthorized: false, createdAt: at, updatedAt: at, digest: "5".repeat(64) };
  };
  return {
    prepared, asserted, cleaned,
    async prepare(input) { prepared.push(input); const plan = create(input); plans.set(input.epochId, plan); return plan; },
    async assertCurrent(epochId) { asserted.push(epochId); const plan = plans.get(epochId); if (!plan) throw new Error("missing plan"); return plan; },
    async cleanup(epochId) { cleaned.push(epochId); const plan = plans.get(epochId); if (!plan) throw new Error("missing plan"); return { ...plan, status: "cleaned" }; }
  };
}

test("durable Council reports every fresh exact-target observable session", async () => {
  const directory = await mkdtemp(join(tmpdir(), "b122-council-runtime-"));
  try {
    const store = new ProtectedJsonStore({ filePath: join(directory, "journal.jsonl") });
    const sessions = new SessionRegistry(store, { clock: () => at });
    await sessions.upsert(session("one", "codex", ["src/one.ts"]));
    await sessions.upsert(session("two", "claude", ["src/two.ts"]));
    const executor = new DurableConfiguredCouncilExecutor(new CouncilCoordinator(store, { clock: () => at }), sessions, undefined, () => Date.parse(at));
    const result = await executor.execute({ action: "council_report", operationId: "operation-report", target, permit: {} as never, effectGuard: { async assertCurrent() { return { allowed: true, reason: "current" }; } } });
    assert.equal(result.status, "completed");
    assert.equal(result.data?.participants, 2);
    assert.equal(result.data?.atomic, true);
  } finally { await rm(directory, { recursive: true, force: true }); }
});

test("automatic Council durably pauses, assigns, and resumes every provider through exact acknowledgements", async () => {
  const directory = await mkdtemp(join(tmpdir(), "b122-council-auto-"));
  try {
    const store = new ProtectedJsonStore({ filePath: join(directory, "journal.jsonl") });
    const sessions = new SessionRegistry(store, { clock: () => at });
    await sessions.upsert(session("one", "codex", ["src/one.ts"]));
    await sessions.upsert(session("two", "claude", ["src/two.ts"]));
    const phases: string[] = [];
    const documents: Record<string, unknown>[] = [];
    const network = { async request(input: { routeId: string; body?: string }) { const document = JSON.parse(input.body!) as Record<string, unknown>; documents.push(document); phases.push(`${input.routeId}:${document.phase}:${document.sessionId}`); const resourceHost = document.resourceHost as Record<string, unknown> | undefined; return { outcome: "passed", routeId: input.routeId, detail: "ok", body: Buffer.from(JSON.stringify({ schema: "sxsy-b122.council-ack", version: 1, epochId: document.epochId, phase: document.phase, sessionId: document.sessionId, targetSnapshotId: document.targetSnapshotId, accepted: true, ...(document.assignmentDigest ? { assignmentDigest: document.assignmentDigest, resourceHostDigest: resourceHost?.digest } : {}) })) }; } } as unknown as DynamicConfiguredNetworkClient;
    const council = new CouncilCoordinator(store, { clock: () => at, idFactory: () => "epoch-1" });
    const isolation = fakeIsolation();
    let resourceProofs = 0;
    const executor = new DurableConfiguredCouncilExecutor(council, sessions, network, () => Date.parse(at), {
      isolation,
      automaticGate: acceptedGate,
      resources: { async assertPlanOperational() { resourceProofs += 1; } }
    });
    const result = await executor.execute({ action: "council_automatic", operationId: "operation-auto", target, permit: {} as never, effectGuard: { async assertCurrent() { return { allowed: true, reason: "current" }; } } });
    assert.equal(result.status, "completed");
    assert.equal(result.data?.status, "active");
    assert.deepEqual(phases, [
      "provider.council.codex:pause:one", "provider.council.claude:pause:two",
      "provider.council.codex:assignment:one", "provider.council.claude:assignment:two",
      "provider.council.codex:resume:one", "provider.council.claude:resume:two"
    ]);
    assert.deepEqual((await council.get("epoch-1"))?.resumeAcknowledgedSessionIds, ["one", "two"]);
    assert.equal(isolation.prepared.length, 1);
    assert.deepEqual(isolation.prepared[0]?.assignments.map((assignment) => assignment.sessionId), ["one", "two"]);
    assert.equal(isolation.asserted.length, 16);
    assert.equal(resourceProofs, 2);
    for (const document of documents.filter((candidate) => candidate.phase !== "pause")) {
      const resourceHost = document.resourceHost as Record<string, unknown>;
      assert.match(String(resourceHost.digest), /^[a-f0-9]{64}$/);
      assert.deepEqual(Object.keys(resourceHost.environment as Record<string, unknown>), ["SXSY_COUNCIL_SESSION_ID"]);
      assert.equal(JSON.stringify(document).includes("secret-value"), false);
    }
    assert.equal((await council.get("epoch-1"))?.assignments.one?.isolationDigest, "3".repeat(64));
  } finally { await rm(directory, { recursive: true, force: true }); }
});

test("automatic Council aborts durably when provider acknowledges a stale resource-host digest", async () => {
  const directory = await mkdtemp(join(tmpdir(), "b122-council-abort-"));
  try {
    const store = new ProtectedJsonStore({ filePath: join(directory, "journal.jsonl") });
    const sessions = new SessionRegistry(store, { clock: () => at });
    await sessions.upsert(session("one", "codex", ["src/one.ts"])); await sessions.upsert(session("two", "claude", ["src/two.ts"]));
    const network = { async request(input: { routeId: string; body?: string }) { const document = JSON.parse(input.body!) as Record<string, unknown>; return { outcome: "passed", routeId: input.routeId, detail: "ok", body: Buffer.from(JSON.stringify({ schema: "sxsy-b122.council-ack", version: 1, epochId: document.epochId, phase: document.phase, sessionId: document.sessionId, targetSnapshotId: document.targetSnapshotId, accepted: true, ...(document.assignmentDigest ? { assignmentDigest: document.assignmentDigest, resourceHostDigest: "0".repeat(64) } : {}) })) }; } } as unknown as DynamicConfiguredNetworkClient;
    const council = new CouncilCoordinator(store, { clock: () => at, idFactory: () => "epoch-2" });
    const isolation = fakeIsolation();
    const result = await new DurableConfiguredCouncilExecutor(council, sessions, network, () => Date.parse(at), { isolation, automaticGate: acceptedGate }).execute({ action: "council_automatic", operationId: "operation-auto", target, permit: {} as never, effectGuard: { async assertCurrent() { return { allowed: true, reason: "current" }; } } });
    assert.equal(result.status, "incomplete");
    assert.equal((await council.get("epoch-2"))?.status, "aborted");
    assert.deepEqual(isolation.cleaned, ["epoch-2"]);
  } finally { await rm(directory, { recursive: true, force: true }); }
});

test("automatic Council proves every assigned resource is operational before any participant resumes", async () => {
  const directory = await mkdtemp(join(tmpdir(), "b122-council-resource-proof-"));
  try {
    const store = new ProtectedJsonStore({ filePath: join(directory, "journal.jsonl") });
    const sessions = new SessionRegistry(store, { clock: () => at });
    await sessions.upsert(session("one", "codex", ["src/one.ts"]));
    await sessions.upsert(session("two", "claude", ["src/two.ts"]));
    const isolation = fakeIsolation();
    const phases: string[] = [];
    const network = {
      async request(input: { body?: string }) {
        const document = JSON.parse(input.body!) as Record<string, unknown>;
        phases.push(String(document.phase));
        const resourceHost = document.resourceHost as Record<string, unknown> | undefined;
        return {
          outcome: "passed",
          detail: "ok",
          body: Buffer.from(JSON.stringify({
            schema: "sxsy-b122.council-ack",
            version: 1,
            epochId: document.epochId,
            phase: document.phase,
            sessionId: document.sessionId,
            targetSnapshotId: document.targetSnapshotId,
            accepted: true,
            ...(document.assignmentDigest ? { assignmentDigest: document.assignmentDigest, resourceHostDigest: resourceHost?.digest } : {})
          }))
        };
      }
    } as unknown as DynamicConfiguredNetworkClient;
    let resourceProofs = 0;
    const result = await new DurableConfiguredCouncilExecutor(
      new CouncilCoordinator(store, { clock: () => at, idFactory: () => "epoch-resource-proof" }),
      sessions,
      network,
      () => Date.parse(at),
      {
        isolation,
        automaticGate: acceptedGate,
        resources: {
          async assertPlanOperational() {
            resourceProofs += 1;
            assert.equal(phases.includes("resume"), false);
            throw new Error("one assigned port proxy was never activated");
          }
        }
      }
    ).execute({ action: "council_automatic", operationId: "operation-resource-proof", target, permit: {} as never, effectGuard: { async assertCurrent() { return { allowed: true, reason: "current" }; } } });
    assert.equal(result.status, "incomplete");
    assert.equal(resourceProofs, 1);
    assert.equal(phases.includes("resume"), false);
    assert.deepEqual(isolation.cleaned, ["epoch-resource-proof"]);
  } finally { await rm(directory, { recursive: true, force: true }); }
});

test("automatic Council stays gate-disabled and does not allocate isolation without independent acceptance", async () => {
  const directory = await mkdtemp(join(tmpdir(), "b122-council-gate-"));
  try {
    const store = new ProtectedJsonStore({ filePath: join(directory, "journal.jsonl") });
    const sessions = new SessionRegistry(store, { clock: () => at });
    await sessions.upsert(session("one", "codex", ["src/one.ts"])); await sessions.upsert(session("two", "claude", ["src/two.ts"]));
    const isolation = fakeIsolation();
    const result = await new DurableConfiguredCouncilExecutor(new CouncilCoordinator(store), sessions, { async request() { throw new Error("must not run"); } } as unknown as DynamicConfiguredNetworkClient, () => Date.parse(at), { isolation }).execute({ action: "council_automatic", operationId: "operation-gated", target, permit: {} as never, effectGuard: { async assertCurrent() { return { allowed: true, reason: "current" }; } } });
    assert.equal(result.status, "unavailable");
    assert.match(result.summary, /acceptance|gate-disabled/i);
    assert.equal(isolation.prepared.length, 0);
  } finally { await rm(directory, { recursive: true, force: true }); }
});

test("automatic Council gate requires every exact-target acceptance record and rejects stale target evidence", async () => {
  const directory = await mkdtemp(join(tmpdir(), "b122-council-evidence-"));
  try {
    const store = new ProtectedJsonStore({ filePath: join(directory, "journal.jsonl") });
    const ledger = new GateEvidenceLedger(store, new AllowlistedEvidenceAuthorizer(["independent-qa"]), { clock: () => at });
    const gate = new LedgerCouncilAutomaticAcceptanceGate(ledger);
    const request = { action: "council_automatic" as const, operationId: "operation-evidence", target, permit: {} as never };
    assert.equal(await gate.accepted(request), false);
    for (const gateNumber of [4, 10, 15, 21, 24, 27] as const) {
      await ledger.record({ gate: gateNumber, status: "passed", targetSnapshotId: target.id, evidenceDigest: `sha256:gate-${gateNumber}`, policyVersion: "v1", evaluatedBy: "independent-qa", rationale: "Independent exact-target mechanism evidence." });
    }
    assert.equal(await gate.accepted(request), true);
    assert.equal(await gate.accepted({ ...request, target: { ...target, id: "changed-target" } }), false);
  } finally { await rm(directory, { recursive: true, force: true }); }
});

test("confirmed Council recommendation persists an approved non-executing artifact", async () => {
  const directory = await mkdtemp(join(tmpdir(), "b122-council-recommend-"));
  try {
    const store = new ProtectedJsonStore({ filePath: join(directory, "journal.jsonl") });
    const sessions = new SessionRegistry(store, { clock: () => at });
    await sessions.upsert(session("one", "codex", ["src/one.ts"]));
    await sessions.upsert(session("two", "claude", ["src/two.ts"]));
    const council = new CouncilCoordinator(store, { clock: () => at, idFactory: () => "recommendation-1" });
    const result = await new DurableConfiguredCouncilExecutor(council, sessions, undefined, () => Date.parse(at)).execute({ action: "council_recommend", operationId: "operation-recommend", target, permit: {} as never, effectGuard: { async assertCurrent() { return { allowed: true, reason: "current" }; } } });
    assert.equal(result.status, "completed");
    assert.equal(result.data?.recommendationId, "recommendation-1");
    const stored = await council.getRecommendation("recommendation-1");
    assert.equal(stored?.status, "approved");
    assert.equal(stored?.executionAuthorized, false);
  } finally { await rm(directory, { recursive: true, force: true }); }
});
