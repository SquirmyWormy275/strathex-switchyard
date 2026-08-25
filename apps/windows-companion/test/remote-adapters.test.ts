import assert from "node:assert/strict";
import test from "node:test";

import type { WorkflowArtifact, WorkflowProviderResponse } from "../../../packages/control-plane/src/workflow-artifacts.ts";
import type { AdapterRequest } from "../../../packages/control-plane/src/adapters.ts";
import { sha256, stableJson } from "../../../packages/control-plane/src/store.ts";
import { AttestedProviderHandshakeCoordinator, ConfiguredProviderCommandAdapter, DynamicConfiguredNetworkClient, createConfiguredAutomationBroker } from "../src/remote-adapters.ts";

const providerTargetId = "a".repeat(64);
function proofEvidence() {
  const planMaterial = { revision: "plan-1", originSessionId: "session-1", taskId: "task-1", objective: "Verify the provider route.", steps: [{ id: "step-1", summary: "Verify", ownedFiles: ["src/safe.ts"], dependencies: [], status: "approved" as const }], decisions: [] as string[] };
  const plan = { digest: sha256(stableJson(planMaterial)), ...planMaterial };
  const material = { instructions: [{ id: "instructions", digest: "1".repeat(64), source: "protected_context" as const, summary: "Instructions" }], plan, documentation: [{ id: "documentation", digest: "5".repeat(64), source: "repository" as const, summary: "Documentation" }], diff: { id: "diff", digest: "2".repeat(64), source: "target_snapshot" as const, summary: "Diff" }, files: [{ id: "file", digest: "3".repeat(64), source: "repository" as const, summary: "File" }], tests: [{ id: "receipt", digest: "4".repeat(64), source: "receipt" as const, summary: "Test", status: "passed" as const }] };
  return { contextDigest: sha256(stableJson(material)), ...material };
}
function proofArtifact(): WorkflowArtifact {
  return {
    id: "artifact-proof-1", action: "proof", repositoryRoot: "C:\\repo", targetSnapshotId: providerTargetId,
    sessionId: "session-1", taskId: "task-1", planRevision: "plan-1",
    payload: { kind: "proof", evidence: proofEvidence(), claims: ["claim"], requiredBackends: ["local"], independentBackendRequired: false },
    digest: "b".repeat(64), status: "submitted", operationId: "operation-1", executionAuthorized: false,
    createdAt: "2026-08-24T00:00:00.000Z", updatedAt: "2026-08-24T00:00:00.000Z"
  };
}
function planApprovalArtifact(): WorkflowArtifact {
  const plan = proofEvidence().plan;
  return {
    id: "artifact-plan-1", action: "plan_approval", repositoryRoot: "C:\\repo", targetSnapshotId: providerTargetId,
    sessionId: "session-1", taskId: plan.taskId, planRevision: plan.revision,
    payload: { kind: "plan", mode: "approve", plan, executorSessionId: "session-1", authorityId: "authority-plan", confirmationDigest: "9".repeat(64), executeOnce: true },
    digest: "8".repeat(64), status: "submitted", operationId: "operation-plan-1", executionAuthorized: false,
    createdAt: "2026-08-24T00:00:00.000Z", updatedAt: "2026-08-24T00:00:00.000Z"
  };
}
function providerRequest(untrustedInput?: Readonly<Record<string, string>>, childSaga?: unknown) {
  return {
    definition: { action: "proof" }, operationId: "operation-1",
    target: { id: providerTargetId, repositoryRoot: "C:\\repo", policyVersion: "v1", digest: "d" },
    session: { id: "session-1", provider: "codex", surface: "vscode_terminal", capabilities: ["registered", "observable", "controllable", "mediated"], status: "running", taskId: "task-1", planRevision: "plan-1", plannedFiles: [], lastHeartbeat: "2026-08-24T00:00:00.000Z", adapterVersion: "v1", metadata: {} },
    authority: { id: "authority-proof" },
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
  assert.deepEqual(outcome.data?.workflowResult, {
    kind: "proof",
    verifiedClaims: ["claim"],
    evidenceReferences: ["receipt:1"],
    backendResults: [{ backend: "local", status: "passed" }]
  });
  assert.equal(outcome.data?.artifactId, artifact.id);
  assert.equal(acknowledged?.artifactId, artifact.id);
  assert.equal(requests.length, 1);
  const document = JSON.parse(String((requests[0] as { body: string }).body)) as Record<string, unknown>;
  assert.equal(document.schema, "sxsy-b122.workflow-command");
  assert.equal(document.authorityId, "authority-proof");
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

test("Plan Approval sends execution authorization only from dispatcher-proven current-user confirmation", async () => {
  const artifact = planApprovalArtifact();
  const requests: Array<{ body: string }> = [];
  const network = {
    async request(input: { body: string }) {
      requests.push(input);
      return { outcome: "passed", routeId: "provider.plan_approval", detail: "ok", effectDisposition: "ambiguous", body: Buffer.from(JSON.stringify({
        schema: "sxsy-b122.workflow-result", version: 1, artifactId: artifact.id, artifactDigest: artifact.digest, operationId: artifact.operationId,
        action: "plan_approval", status: "completed", effectDisposition: "committed", summary: "The exact plan execution was acknowledged.", externalId: "provider-plan-1",
        result: { kind: "plan", mode: "execution_ack", planDigest: artifact.payload.kind === "plan" ? artifact.payload.plan.digest : "", planRevision: "plan-1", originSessionId: "session-1", executorSessionId: "session-1", authorityId: "authority-plan", acknowledgementId: "ack-plan-1", executionStarted: true }
      })) };
    }
  } as unknown as DynamicConfiguredNetworkClient;
  const artifacts = { async claimForDispatch() { return artifact; }, async acknowledge() { return { ...artifact, status: "acknowledged" as const }; } };
  const adapter = new ConfiguredProviderCommandAdapter(network, artifacts);
  const base = {
    definition: { action: "plan_approval" }, operationId: "operation-plan-1",
    target: { id: providerTargetId, repositoryRoot: "C:\\repo", policyVersion: "v1", digest: "d" },
    session: { id: "session-1", provider: "codex", surface: "vscode_terminal", capabilities: ["registered", "observable", "controllable", "mediated"], status: "running", taskId: "task-1", planRevision: "plan-1", plannedFiles: [], lastHeartbeat: "2026-08-24T00:00:00.000Z", adapterVersion: "v1", metadata: {} },
    authority: { id: "authority-plan" },
    confirmation: { currentUserConfirmed: true, confirmationDigest: "9".repeat(64), action: "plan_approval", targetSnapshotId: providerTargetId, sessionId: "session-1", authorityId: "authority-plan" },
    effectGuard: { async assertCurrent() { return { allowed: true, reason: "current" }; } }
  } as unknown as AdapterRequest;

  assert.equal((await adapter.execute(base)).status, "completed");
  const document = JSON.parse(requests[0]!.body) as { executionAuthorization: unknown };
  assert.deepEqual(document.executionAuthorization, {
    executionAuthorized: true, executeOnce: true, currentUserConfirmed: true, confirmationDigest: "9".repeat(64), operationId: "operation-plan-1", artifactId: artifact.id, artifactDigest: artifact.digest,
    targetSnapshotId: providerTargetId, sessionId: "session-1", authorityId: "authority-plan", planDigest: proofEvidence().plan.digest, planRevision: "plan-1", originSessionId: "session-1"
  });

  const refused = await new ConfiguredProviderCommandAdapter(network, artifacts).execute({ ...base, confirmation: undefined } as never);
  assert.equal(refused.status, "blocked");
  const mismatchedConfirmation = await new ConfiguredProviderCommandAdapter(network, artifacts).execute({ ...base, confirmation: { ...base.confirmation!, confirmationDigest: "7".repeat(64) } } as never);
  assert.equal(mismatchedConfirmation.status, "blocked");
  assert.equal(requests.length, 1);
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

test("configured provider adapter never replays cancelled, cancelling, rejected, or acknowledged queue state", async () => {
  let requests = 0;
  const network = { async request() { requests += 1; throw new Error("must not dispatch"); } } as unknown as DynamicConfiguredNetworkClient;
  for (const [status, expectedStatus, disposition] of [
    ["cancelled", "cancelled", "not_started"],
    ["cancelling", "cancelled", "not_started"],
    ["rejected", "failed", "not_started"],
    ["acknowledged", "completed", "committed"]
  ] as const) {
    const adapter = new ConfiguredProviderCommandAdapter(network, {
      async claimForDispatch() { return { ...proofArtifact(), status }; },
      async acknowledge() { throw new Error("must not acknowledge"); }
    });
    const outcome = await adapter.execute(providerRequest());
    assert.equal(outcome.status, expectedStatus);
    assert.equal(outcome.effectDisposition, disposition);
  }
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

test("configured automation creates one observable child saga and records the gateway recovery identity", async () => {
  const childEvents: Array<readonly [string, unknown]> = [];
  const transport = {
    recoveryExternalId(input: { operationId: string; provider: string }) {
      assert.equal(input.provider, "codex");
      return input.operationId;
    },
    async request(input: { routeId: string; body?: string }) {
      assert.equal(input.routeId, "automation.repair_mission");
      const document = JSON.parse(input.body!) as Record<string, unknown>;
      assert.equal(document.schema, "sxsy-b122.remote-automation");
      return {
        outcome: "passed" as const,
        routeId: input.routeId,
        detail: "local gateway",
        effectDisposition: "ambiguous" as const,
        body: Buffer.from(JSON.stringify({
          schema: "sxsy-b122.remote-result",
          version: 1,
          status: "completed",
          summary: "Repair completed in the deterministic provider.",
          effectDisposition: "committed",
          externalId: "automation-operation-1",
          data: { simulated: true }
        }))
      };
    }
  };
  const childSaga = {
    async begin(input: unknown) { childEvents.push(["begin", input]); return { operationId: "child-automation-1", mayExecute: true }; },
    async markExecuting(input: unknown) { childEvents.push(["executing", input]); },
    async markExternalCommitted(_input: unknown, details: unknown) { childEvents.push(["external", details]); },
    async markCancelling(input: unknown) { childEvents.push(["cancelling", input]); },
    async markCompensating(input: unknown) { childEvents.push(["compensating", input]); },
    async settle(_input: unknown, outcome: unknown, details: unknown) { childEvents.push([String(outcome), details]); }
  };
  const broker = createConfiguredAutomationBroker(
    { verifyPermit() { return true; } },
    { check() { return { allowed: true, reason: "clear" }; } },
    transport as never
  );
  const outcome = await broker.execute({
    action: "repair_mission",
    operationId: "automation-operation-1",
    target: { id: providerTargetId, repositoryRoot: "C:\\repo", policyVersion: "v1" } as never,
    session: { id: "session-1", provider: "codex", surface: "vscode_terminal", capabilities: ["registered", "observable", "controllable", "mediated"], status: "running", plannedFiles: [], lastHeartbeat: "2026-08-24T00:00:00.000Z", adapterVersion: "v1", metadata: {} },
    permit: {} as never,
    effectGuard: { async assertCurrent() { return { allowed: true, reason: "current" }; } },
    childSaga: childSaga as never
  });
  assert.equal(outcome.status, "completed");
  const begun = childEvents.find(([kind]) => kind === "begin")?.[1] as { action: string; details: Record<string, string> };
  assert.equal(begun.action, "automation.repair_mission");
  assert.equal(begun.details.externalId, "automation-operation-1");
  assert.equal(childEvents.some(([kind]) => kind === "external"), true);
  assert.equal(childEvents.some(([kind]) => kind === "completed"), true);
});

test("configured provider routing aborts when durable cancellation polling fails", async () => {
  const unhandled: unknown[] = [];
  const onUnhandled = (reason: unknown): void => { unhandled.push(reason); };
  process.on("unhandledRejection", onUnhandled);
  try {
    let checks = 0;
    let transportAborted = false;
    const adapter = new ConfiguredProviderCommandAdapter({
      async request(input: { routeId: string; signal?: AbortSignal }) {
        assert.ok(input.signal);
        return new Promise<{
          outcome: "blocked";
          routeId: string;
          detail: string;
          effectDisposition: "not_started";
        }>((resolve) => {
          const finish = (): void => {
            transportAborted = true;
            resolve({ outcome: "blocked", routeId: input.routeId, detail: "cancelled", effectDisposition: "not_started" });
          };
          if (input.signal!.aborted) finish();
          else input.signal!.addEventListener("abort", finish, { once: true });
        });
      }
    } as unknown as DynamicConfiguredNetworkClient, {
      async claimForDispatch() { return proofArtifact(); },
      async acknowledge() { throw new Error("an aborted transport must not acknowledge"); }
    });
    const startedAt = Date.now();
    const request = {
      ...(providerRequest() as unknown as Record<string, unknown>),
      executionControl: {
        deadline: new Date(Date.now() + 2_000).toISOString(),
        async isCancellationRequested() {
          checks += 1;
          if (checks === 1) return false;
          throw new Error("protected cancellation ledger unavailable");
        }
      }
    } as unknown as AdapterRequest;
    const outcome = await adapter.execute(request);
    assert.equal(outcome.status, "blocked");
    assert.equal(transportAborted, true);
    assert.ok(Date.now() - startedAt < 700, "provider transport waited for its route deadline after cancellation polling failed");
    await new Promise<void>((resolve) => setImmediate(resolve));
    assert.deepEqual(unhandled, []);
  } finally {
    process.off("unhandledRejection", onUnhandled);
  }
});
