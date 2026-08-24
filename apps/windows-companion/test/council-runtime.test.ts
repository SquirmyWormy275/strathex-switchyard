import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { CouncilCoordinator } from "../../../packages/control-plane/src/council.ts";
import { SessionRegistry } from "../../../packages/control-plane/src/session-registry.ts";
import { ProtectedJsonStore } from "../../../packages/control-plane/src/store.ts";
import type { ManagedSession, TargetSnapshot } from "../../../packages/control-plane/src/contracts.ts";
import { DurableConfiguredCouncilExecutor } from "../src/council-runtime.ts";
import type { DynamicConfiguredNetworkClient } from "../src/remote-adapters.ts";

const at = "2026-08-24T12:00:00.000Z";
const target: TargetSnapshot = { id: "a".repeat(64), repositoryRoot: "C:\\repo", branch: "feat/test", head: "b".repeat(40), indexTree: "c".repeat(40), trackedManifest: "d".repeat(64), untrackedManifest: "e".repeat(64), submodules: {}, policyVersion: "v1", environmentFingerprint: "f".repeat(64), capturedAt: at, completeness: "complete", reasons: [] };
const session = (id: string, provider: ManagedSession["provider"], plannedFiles: readonly string[]): ManagedSession => ({ id, provider, surface: "bridge", capabilities: ["registered", "observable", "controllable", "mediated"], status: "running", workspaceRoot: target.repositoryRoot, targetSnapshotId: target.id, taskId: `task-${id}`, planRevision: "plan-1", plannedFiles, lastHeartbeat: at, adapterVersion: "provider-v1", metadata: { "sxsy-b122.providerHandshake": "exact-route-v1", "sxsy-b122.resources": JSON.stringify([`port:${id}`]), "sxsy-b122.dependencies": "[]", "sxsy-b122.diffDigest": (id === "one" ? "1" : "2").repeat(64) } });

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
    const network = { async request(input: { routeId: string; body?: string }) { const document = JSON.parse(input.body!) as Record<string, unknown>; phases.push(`${input.routeId}:${document.phase}:${document.sessionId}`); return { outcome: "passed", routeId: input.routeId, detail: "ok", body: Buffer.from(JSON.stringify({ schema: "sxsy-b122.council-ack", version: 1, epochId: document.epochId, phase: document.phase, sessionId: document.sessionId, targetSnapshotId: document.targetSnapshotId, accepted: true })) }; } } as unknown as DynamicConfiguredNetworkClient;
    const executor = new DurableConfiguredCouncilExecutor(new CouncilCoordinator(store, { clock: () => at, idFactory: () => "epoch-1" }), sessions, network, () => Date.parse(at));
    const result = await executor.execute({ action: "council_automatic", operationId: "operation-auto", target, permit: {} as never, effectGuard: { async assertCurrent() { return { allowed: true, reason: "current" }; } } });
    assert.equal(result.status, "completed");
    assert.equal(result.data?.status, "active");
    assert.deepEqual(phases, [
      "provider.council.codex:pause:one", "provider.council.claude:pause:two",
      "provider.council.codex:assignment:one", "provider.council.claude:assignment:two",
      "provider.council.codex:resume:one", "provider.council.claude:resume:two"
    ]);
  } finally { await rm(directory, { recursive: true, force: true }); }
});

test("automatic Council aborts durably on a malformed provider acknowledgement", async () => {
  const directory = await mkdtemp(join(tmpdir(), "b122-council-abort-"));
  try {
    const store = new ProtectedJsonStore({ filePath: join(directory, "journal.jsonl") });
    const sessions = new SessionRegistry(store, { clock: () => at });
    await sessions.upsert(session("one", "codex", ["src/one.ts"])); await sessions.upsert(session("two", "claude", ["src/two.ts"]));
    const network = { async request() { return { outcome: "passed", routeId: "provider.council.codex", detail: "ok", body: Buffer.from("{}") }; } } as unknown as DynamicConfiguredNetworkClient;
    const council = new CouncilCoordinator(store, { clock: () => at, idFactory: () => "epoch-2" });
    const result = await new DurableConfiguredCouncilExecutor(council, sessions, network, () => Date.parse(at)).execute({ action: "council_automatic", operationId: "operation-auto", target, permit: {} as never, effectGuard: { async assertCurrent() { return { allowed: true, reason: "current" }; } } });
    assert.equal(result.status, "incomplete");
    assert.equal((await council.get("epoch-2"))?.status, "aborted");
  } finally { await rm(directory, { recursive: true, force: true }); }
});
