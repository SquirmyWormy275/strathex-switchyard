import assert from "node:assert/strict";
import test from "node:test";

import type { ManagedSession } from "../../../packages/control-plane/src/contracts.ts";
import { ConfiguredProviderHostClient, type ConfiguredProviderOperationIdentity } from "../src/configured-provider-host.ts";
import type { ProviderCommandTransport } from "../src/remote-adapters.ts";

const target = "b".repeat(64);
const repositoryRoot = "C:\\repo";
const session: ManagedSession = {
  id: "codex-session", provider: "codex", surface: "bridge", capabilities: ["registered", "observable", "controllable", "mediated"],
  status: "running", workspaceRoot: repositoryRoot, targetSnapshotId: target, plannedFiles: [],
  adapterVersion: "codex-live-v1", lastHeartbeat: "2026-08-25T12:00:00.000Z",
  metadata: { "sxsy-b122.providerHandshake": "exact-route-v1", "sxsy-b122.providerHandshakeTarget": target }
};
const operation: ConfiguredProviderOperationIdentity = {
  operationId: "operation-1", externalId: "operation-1", routeId: "provider.proof", sessionId: session.id,
  provider: "codex", targetSnapshotId: target, repositoryRoot
};

test("configured provider-host client uses exact observe, cancel, and reconcile routes", async () => {
  const routes: string[] = [];
  const transport: ProviderCommandTransport = { async request(input) {
    routes.push(input.routeId);
    const body = input.body ? JSON.parse(Buffer.from(input.body).toString("utf8")) as Record<string, unknown> : {};
    if (input.routeId === "provider.observe-session.codex") return passed(input.routeId, { schema: "sxsy-b122.provider-session-observation", version: 1, sessionId: session.id, provider: "codex", targetSnapshotId: target, repositoryRoot, status: "verified_finished", capabilities: ["registered", "observable"], adapterVersion: "codex-live-v2" });
    if (input.routeId === "provider.observe-operation.codex") return passed(input.routeId, { schema: "sxsy-b122.provider-operation-observation", version: 1, operationId: body.operationId, externalId: body.externalId, routeId: body.routeId, sessionId: body.sessionId, provider: body.provider, targetSnapshotId: body.targetSnapshotId, repositoryRoot: body.repositoryRoot, outcome: "committed", summary: "Observed exact committed effect." });
    if (input.routeId === "provider.cancel.codex") return passed(input.routeId, { schema: "sxsy-b122.provider-cancellation-ack", version: 1, operationId: operation.operationId, externalId: operation.externalId, sessionId: operation.sessionId, provider: operation.provider, targetSnapshotId: target, accepted: true, summary: "Cancellation acknowledged." });
    return passed(input.routeId, { schema: "sxsy-b122.provider-host-reconciliation", version: 1, operationsInspected: 1, operationsSettled: 1, councilsInspected: 0, councilsSettled: 0 });
  } };
  const client = new ConfiguredProviderHostClient(transport, () => "2026-08-25T12:01:00.000Z");
  assert.equal(client.recoveryExternalId({ routeId: operation.routeId, operationId: operation.operationId, provider: "codex" }), operation.operationId);
  const refreshed = await client.refreshSession(session);
  assert.equal(refreshed.status, "verified_finished");
  assert.deepEqual(refreshed.capabilities, ["registered", "observable"]);
  assert.equal((await client.observeOperation(operation)).outcome, "committed");
  assert.equal((await client.cancelOperation(operation, "operator cancellation")).accepted, true);
  assert.equal((await client.reconcile(repositoryRoot)).operationsSettled, 1);
  assert.deepEqual(routes, ["provider.observe-session.codex", "provider.observe-operation.codex", "provider.cancel.codex", "provider.reconcile"]);
});

test("configured provider-host client rejects target churn, unsupported providers, and malformed exact evidence", async () => {
  const client = new ConfiguredProviderHostClient({ async request(input) { return passed(input.routeId, { schema: "sxsy-b122.provider-session-observation", version: 1, sessionId: session.id, provider: "codex", targetSnapshotId: "0".repeat(64), repositoryRoot, status: "running", capabilities: ["registered", "observable"], adapterVersion: "codex-live-v1" }); } });
  await assert.rejects(() => client.refreshSession(session), /malformed|bound/i);
  const unsupported = { ...session, provider: "generic" as const };
  await assert.rejects(() => client.refreshSession(unsupported), /Claude|Codex/i);
  assert.equal(client.recoveryExternalId({ routeId: "provider.proof", operationId: operation.operationId, provider: "generic" }), undefined);
  await assert.rejects(() => client.observeOperation({ ...operation, repositoryRoot: "relative" }), /identity/i);
});

function passed(routeId: string, value: unknown) { return { outcome: "passed" as const, routeId, detail: "ok", effectDisposition: "ambiguous" as const, body: Buffer.from(JSON.stringify(value)) }; }
