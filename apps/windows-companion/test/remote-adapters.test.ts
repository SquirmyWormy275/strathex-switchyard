import assert from "node:assert/strict";
import test from "node:test";

import { AttestedProviderHandshakeCoordinator, ConfiguredProviderCommandAdapter, DynamicConfiguredNetworkClient } from "../src/remote-adapters.ts";

test("configured provider adapter accepts only an exact authenticated route result", async () => {
  const requests: unknown[] = [];
  const adapter = new ConfiguredProviderCommandAdapter({
    async request(input: unknown) { requests.push(input); return { outcome: "passed", routeId: "provider.proof", detail: "ok", body: Buffer.from(JSON.stringify({ schema: "sxsy-b122.remote-result", version: 1, status: "completed", summary: "Provider returned durable proof." })) }; }
  } as unknown as DynamicConfiguredNetworkClient);
  const outcome = await adapter.execute({ definition: { action: "proof" } as never, operationId: "operation-1", target: { id: "target-1", repositoryRoot: "C:\\repo", policyVersion: "v1", digest: "d" } as never, effectGuard: { async assertCurrent() { return { allowed: true, reason: "current" }; } } });
  assert.equal(outcome.status, "completed");
  assert.equal(requests.length, 1);
});

test("configured provider adapter never converts malformed provider output into completion", async () => {
  const adapter = new ConfiguredProviderCommandAdapter({ async request() { return { outcome: "passed", routeId: "provider.proof", detail: "ok", body: Buffer.from("{}") }; } } as unknown as DynamicConfiguredNetworkClient);
  const outcome = await adapter.execute({ definition: { action: "proof" } as never, operationId: "operation-1", target: { id: "target-1", repositoryRoot: "C:\\repo", policyVersion: "v1", digest: "d" } as never });
  assert.equal(outcome.status, "failed");
});

test("provider handshake elevates only an exact current target after user presence", async () => {
  const targetId = "a".repeat(64);
  const target = { id: targetId, repositoryRoot: "C:\\repo", branch: "feat/test", head: "b".repeat(40), trackedManifest: "c".repeat(64), untrackedManifest: "d".repeat(64), submodules: {}, policyVersion: "v1", environmentFingerprint: "e".repeat(64), capturedAt: "2026-08-24T00:00:00.000Z", completeness: "complete", reasons: [] } as const;
  let resolutions = 0;
  const coordinator = new AttestedProviderHandshakeCoordinator(
    { async request() { return { outcome: "passed", routeId: "provider.handshake.codex", detail: "ok", body: Buffer.from(JSON.stringify({ schema: "sxsy-b122.provider-handshake", version: 1, sessionId: "session-1", provider: "codex", targetSnapshotId: targetId, repositoryRoot: "C:\\repo", capabilities: ["registered", "observable", "controllable", "mediated"], status: "running", adapterVersion: "codex-adapter-1", taskId: "task-1", planRevision: "plan-1", plannedFiles: ["src/index.ts"] })) }; } } as unknown as DynamicConfiguredNetworkClient,
    { async resolve() { resolutions += 1; return target; } },
    { async verify() { return { verified: true, operator: "DOMAIN\\operator" }; } },
    () => "2026-08-24T00:00:01.000Z"
  );
  const session = await coordinator.handshake({ repositoryRoot: "C:\\repo", session: { id: "session-1", provider: "codex", surface: "vscode_terminal", capabilities: ["registered"], status: "unknown", workspaceRoot: "C:\\repo", plannedFiles: [], lastHeartbeat: "2026-08-24T00:00:00.000Z", adapterVersion: "vscode", metadata: {} } });
  assert.deepEqual(session.capabilities, ["registered", "observable", "controllable", "mediated"]);
  assert.equal(session.targetSnapshotId, targetId);
  assert.equal(session.taskId, "task-1");
  assert.equal(resolutions, 2);
});

test("provider handshake refuses capability installation when target churns", async () => {
  const ids = ["a".repeat(64), "f".repeat(64)];
  let index = 0;
  const coordinator = new AttestedProviderHandshakeCoordinator(
    { async request() { return { outcome: "passed", routeId: "provider.handshake.codex", detail: "ok", body: Buffer.from(JSON.stringify({ schema: "sxsy-b122.provider-handshake", version: 1, sessionId: "session-1", provider: "codex", targetSnapshotId: ids[0], repositoryRoot: "C:\\repo", capabilities: ["registered", "observable"], status: "running", adapterVersion: "adapter", plannedFiles: [] })) }; } } as unknown as DynamicConfiguredNetworkClient,
    { async resolve() { const id = ids[Math.min(index++, 1)]!; return { id, repositoryRoot: "C:\\repo", trackedManifest: "c".repeat(64), untrackedManifest: "d".repeat(64), submodules: {}, policyVersion: "v1", environmentFingerprint: "e".repeat(64), capturedAt: "2026-08-24T00:00:00.000Z", completeness: "complete" as const, reasons: [] }; } },
    { async verify() { return { verified: true, operator: "operator" }; } }
  );
  await assert.rejects(() => coordinator.handshake({ repositoryRoot: "C:\\repo", session: { id: "session-1", provider: "codex", surface: "vscode_terminal", capabilities: ["registered"], status: "unknown", plannedFiles: [], lastHeartbeat: "2026-08-24T00:00:00.000Z", adapterVersion: "vscode", metadata: {} } }), /changed during provider handshake/);
});
