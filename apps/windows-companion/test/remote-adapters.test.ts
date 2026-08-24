import assert from "node:assert/strict";
import test from "node:test";

import type { WorkflowArtifact, WorkflowProviderResponse } from "../../../packages/control-plane/src/workflow-artifacts.ts";
import { AttestedProviderHandshakeCoordinator, ConfiguredProviderCommandAdapter, DynamicConfiguredNetworkClient } from "../src/remote-adapters.ts";

const providerTargetId = "a".repeat(64);
function proofArtifact(): WorkflowArtifact {
  return {
    id: "artifact-proof-1", action: "proof", repositoryRoot: "C:\\repo", targetSnapshotId: providerTargetId,
    sessionId: "session-1", taskId: "task-1", planRevision: "plan-1",
    payload: { kind: "proof", claims: ["claim"], evidenceReferences: ["receipt:1"], requiredBackends: ["local"] },
    digest: "b".repeat(64), status: "submitted", operationId: "operation-1", executionAuthorized: false,
    createdAt: "2026-08-24T00:00:00.000Z", updatedAt: "2026-08-24T00:00:00.000Z"
  };
}
function providerRequest(untrustedInput?: Readonly<Record<string, string>>, childSaga?: unknown) {
  return {
    definition: { action: "proof" }, operationId: "operation-1",
    target: { id: providerTargetId, repositoryRoot: "C:\\repo", policyVersion: "v1", digest: "d" },
    session: { id: "session-1", provider: "codex", surface: "vscode_terminal", capabilities: ["registered", "observable", "controllable", "mediated"], status: "running", taskId: "task-1", planRevision: "plan-1", plannedFiles: [], lastHeartbeat: "2026-08-24T00:00:00.000Z", adapterVersion: "v1", metadata: {} },
    effectGuard: { async assertCurrent() { return { allowed: true, reason: "current" }; } },
    ...(childSaga ? { childSaga } : {}),
    ...(untrustedInput ? { untrustedInput } : {})
  } as never;
}

test("configured provider adapter dispatches and acknowledges only an exact typed workflow artifact", async () => {
  const requests: unknown[] = [];
  const childEvents: Array<readonly [string, unknown]> = [];
  const artifact = proofArtifact();
  let acknowledged: WorkflowProviderResponse | undefined;
  const adapter = new ConfiguredProviderCommandAdapter({
    async request(input: unknown) {
      requests.push(input);
      return { outcome: "passed", routeId: "provider.proof", detail: "ok", effectDisposition: "ambiguous", body: Buffer.from(JSON.stringify({ schema: "sxsy-b122.workflow-result", version: 1, artifactId: artifact.id, artifactDigest: artifact.digest, operationId: artifact.operationId, action: "proof", status: "completed", summary: "Provider returned durable proof.", effectDisposition: "committed", externalId: "provider-proof-1", result: { kind: "proof", verifiedClaims: ["claim"], evidenceReferences: ["receipt:1"], backendResults: [{ backend: "local", status: "passed" }] } })) };
    }
  } as unknown as DynamicConfiguredNetworkClient, {
    async claimForDispatch(input) { assert.deepEqual(input, { action: "proof", targetSnapshotId: providerTargetId, sessionId: "session-1", operationId: "operation-1" }); return artifact; },
    async acknowledge(response) { acknowledged = response; return { ...artifact, status: "acknowledged", providerExternalId: response.externalId }; }
  });
  const childSaga = {
    async begin(input: unknown) { childEvents.push(["begin", input]); return { id: "child-provider-1", mayExecute: true }; },
    async markExecuting(input: unknown) { childEvents.push(["executing", input]); },
    async markExternalCommitted(_input: unknown, details: unknown) { childEvents.push(["external", details]); },
    async markCompensating(input: unknown) { childEvents.push(["compensating", input]); },
    async settle(_input: unknown, state: unknown, details: unknown) { childEvents.push([String(state), details]); }
  };
  const outcome = await adapter.execute(providerRequest({ injectedPrompt: "must-not-cross-boundary" }, childSaga));
  assert.equal(outcome.status, "completed");
  assert.equal(outcome.effectDisposition, "committed");
  assert.equal(outcome.data?.artifactId, artifact.id);
  assert.equal(acknowledged?.artifactId, artifact.id);
  assert.equal(requests.length, 1);
  const document = JSON.parse(String((requests[0] as { body: string }).body)) as Record<string, unknown>;
  assert.equal(document.schema, "sxsy-b122.workflow-command");
  assert.equal("input" in document, false);
  assert.deepEqual(document.artifact, { id: artifact.id, digest: artifact.digest, taskId: "task-1", planRevision: "plan-1", payload: artifact.payload, executionAuthorized: false });
  const started = childEvents.find(([kind]) => kind === "begin")?.[1] as { action: string; details: Record<string, string> };
  assert.equal(started.action, "provider.proof");
  assert.deepEqual(started.details, { repositoryRoot: "C:\\repo", routeId: "provider.proof", targetSnapshotId: providerTargetId, artifactId: artifact.id, artifactDigest: artifact.digest });
  assert.deepEqual(childEvents.find(([kind]) => kind === "external")?.[1], { artifactId: artifact.id, routeId: "provider.proof", externalId: "provider-proof-1" });
  assert.equal(childEvents.some(([kind]) => kind === "completed"), true);
});

test("configured provider adapter never acknowledges malformed provider output", async () => {
  const artifact = proofArtifact();
  let acknowledgements = 0;
  const adapter = new ConfiguredProviderCommandAdapter({ async request() { return { outcome: "passed", routeId: "provider.proof", detail: "ok", effectDisposition: "ambiguous", body: Buffer.from("{}") }; } } as unknown as DynamicConfiguredNetworkClient, {
    async claimForDispatch() { return artifact; }, async acknowledge() { acknowledgements += 1; return artifact; }
  });
  const outcome = await adapter.execute(providerRequest());
  assert.equal(outcome.status, "failed");
  assert.equal(outcome.effectDisposition, "ambiguous");
  assert.equal(acknowledgements, 0);
});

test("configured provider adapter does not call the network without one prepared typed artifact", async () => {
  let requests = 0;
  const adapter = new ConfiguredProviderCommandAdapter({ async request() { requests += 1; throw new Error("must not dispatch"); } } as unknown as DynamicConfiguredNetworkClient, {
    async claimForDispatch() { return undefined; }, async acknowledge() { throw new Error("must not acknowledge"); }
  });
  const outcome = await adapter.execute(providerRequest());
  assert.equal(outcome.status, "awaiting_input");
  assert.equal(outcome.effectDisposition, "not_started");
  assert.equal(requests, 0);
});

test("provider handshake elevates only an exact current target after user presence", async () => {
  const targetId = "a".repeat(64);
  const target = { id: targetId, repositoryRoot: "C:\\repo", branch: "feat/test", head: "b".repeat(40), trackedManifest: "c".repeat(64), untrackedManifest: "d".repeat(64), submodules: {}, policyVersion: "v1", environmentFingerprint: "e".repeat(64), capturedAt: "2026-08-24T00:00:00.000Z", completeness: "complete", reasons: [] } as const;
  let resolutions = 0;
  const coordinator = new AttestedProviderHandshakeCoordinator(
    { async request() { return { outcome: "passed", routeId: "provider.handshake.codex", detail: "ok", body: Buffer.from(JSON.stringify({ schema: "sxsy-b122.provider-handshake", version: 1, sessionId: "session-1", provider: "codex", targetSnapshotId: targetId, repositoryRoot: "C:\\repo", capabilities: ["registered", "observable", "controllable", "mediated"], status: "running", adapterVersion: "codex-adapter-1", taskId: "task-1", planRevision: "plan-1", plannedFiles: ["src/index.ts"], resources: ["port:4100"], dependencies: [], diffDigest: "f".repeat(64) })) }; } } as unknown as DynamicConfiguredNetworkClient,
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
    { async request() { return { outcome: "passed", routeId: "provider.handshake.codex", detail: "ok", body: Buffer.from(JSON.stringify({ schema: "sxsy-b122.provider-handshake", version: 1, sessionId: "session-1", provider: "codex", targetSnapshotId: ids[0], repositoryRoot: "C:\\repo", capabilities: ["registered", "observable"], status: "running", adapterVersion: "adapter", plannedFiles: [], resources: [], dependencies: [], diffDigest: "e".repeat(64) })) }; } } as unknown as DynamicConfiguredNetworkClient,
    { async resolve() { const id = ids[Math.min(index++, 1)]!; return { id, repositoryRoot: "C:\\repo", trackedManifest: "c".repeat(64), untrackedManifest: "d".repeat(64), submodules: {}, policyVersion: "v1", environmentFingerprint: "e".repeat(64), capturedAt: "2026-08-24T00:00:00.000Z", completeness: "complete" as const, reasons: [] }; } },
    { async verify() { return { verified: true, operator: "operator" }; } }
  );
  await assert.rejects(() => coordinator.handshake({ repositoryRoot: "C:\\repo", session: { id: "session-1", provider: "codex", surface: "vscode_terminal", capabilities: ["registered"], status: "unknown", plannedFiles: [], lastHeartbeat: "2026-08-24T00:00:00.000Z", adapterVersion: "vscode", metadata: {} } }), /changed during provider handshake/);
});
