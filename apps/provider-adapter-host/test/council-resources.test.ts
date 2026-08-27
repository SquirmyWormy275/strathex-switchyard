import assert from "node:assert/strict";
import test from "node:test";

import type { InstalledCouncilParticipantClient } from "../../windows-companion/src/council-participant-client.ts";
import { InstalledProviderCouncilResourceLifecycle, wrapProviderRuntimeCouncilLifecycle } from "../src/council-resources.ts";
import type { ProviderCouncilRequest, ProviderCouncilResourceHost } from "../src/state.ts";

const resourceHost: ProviderCouncilResourceHost = {
  schema: "sxsy-b122.council-resource-host", version: 1, epochId: "epoch-1", sessionId: "session-1",
  fenceDigest: "f".repeat(64), capabilities: ["held-loopback-port", "session-fenced-credential-capability"],
  resources: [
    { leaseId: "port-lease", kind: "port", fence: 1, declaration: "port", bindingType: "loopback-listener", value: "4100", environmentName: "SXSY_COUNCIL_PORT_1" },
    { leaseId: "credential-lease", kind: "credential_scope", fence: 1, declaration: "provider.health", bindingType: "opaque-credential-capability", value: "council-capability:00000000-0000-4000-8000-000000000001", environmentName: "SXSY_COUNCIL_CREDENTIAL_CAPABILITY_ID_1", credentialExpiresAt: Date.now() + 60_000 }
  ],
  environment: {}, digest: "e".repeat(64)
};
const assignment: ProviderCouncilRequest = {
  schema: "sxsy-b122.council-phase", version: 1, epochId: "epoch-1", phase: "assignment", sessionId: "session-1", targetSnapshotId: "b".repeat(64),
  repositoryRoot: "C:\\source",
  paths: [], resources: ["port", "provider.health"], assignmentDigest: "a".repeat(64), worktreeRoot: "C:\\repo", branch: "feature/council", head: "d".repeat(40), leases: [], resourceHost
};

test("provider modules receive only exact lease callbacks and port handles survive resume until explicit cleanup", async () => {
  let closed = 0;
  const participant = {
    async openPortProxy(input: Record<string, unknown>) {
      assert.equal(input.leaseId, "port-lease");
      assert.equal(input.portEnvironmentName, "SXSY_COUNCIL_PORT_1");
      return { receipt: { status: "active" }, async close() { closed += 1; } };
    },
    async credentialNetwork(input: Record<string, unknown>) {
      assert.deepEqual(input, { leaseId: "credential-lease", credentialEnvironmentName: "SXSY_COUNCIL_CREDENTIAL_CAPABILITY_ID_1", routeId: "provider.health" });
      return { outcome: "passed" };
    }
  } as unknown as InstalledCouncilParticipantClient;
  const resources = new InstalledProviderCouncilResourceLifecycle("C:\\state", async () => participant);
  await resources.callbacks.openPortProxy(assignment, { leaseId: "port-lease", onConnection() {} });
  assert.deepEqual(await resources.callbacks.credentialHealth(assignment, { leaseId: "credential-lease" }), { outcome: "passed" });
  await assert.rejects(() => resources.callbacks.credentialHealth(assignment, { leaseId: "port-lease" }), /exact requested resource/i);

  const port = wrapProviderRuntimeCouncilLifecycle({ async council(request: ProviderCouncilRequest, _signal: AbortSignal) { return { phase: request.phase }; } }, resources);
  await port.council({ ...assignment, phase: "resume", paths: undefined, resources: undefined }, new AbortController().signal);
  assert.equal(closed, 0, "resume acknowledgement must not prematurely tear down live participant resources");
  await port.cleanupCouncilResources({ schema: "sxsy-b122.council-resource-cleanup", version: 1, epochId: assignment.epochId, sessionId: assignment.sessionId, targetSnapshotId: assignment.targetSnapshotId, resourceHostDigest: resourceHost.digest, outcome: "completed" });
  assert.equal(closed, 1);
  await resources.closeAll();
  assert.equal(closed, 1, "explicit cleanup is idempotent and leaves no participant listener");
});

test("cleanup attempts every participant listener and retains only failed handles for retry", async () => {
  const twoPorts: ProviderCouncilResourceHost = {
    ...resourceHost,
    resources: [
      resourceHost.resources[0]!,
      { ...resourceHost.resources[0]!, leaseId: "port-lease-2", value: "4101", environmentName: "SXSY_COUNCIL_PORT_2" }
    ]
  };
  const request: ProviderCouncilRequest = { ...assignment, resourceHost: twoPorts };
  let created = 0;
  const closes = [0, 0];
  const participant = {
    async openPortProxy() {
      const index = created++;
      return { receipt: { status: "active" }, async close() { closes[index]! += 1; if (index === 0 && closes[index] === 1) throw new Error("first close failed"); } };
    }
  } as unknown as InstalledCouncilParticipantClient;
  const lifecycle = new InstalledProviderCouncilResourceLifecycle("C:\\state", async () => participant);
  await lifecycle.callbacks.openPortProxy(request, { leaseId: "port-lease", onConnection() {} });
  await lifecycle.callbacks.openPortProxy(request, { leaseId: "port-lease-2", onConnection() {} });

  await assert.rejects(() => lifecycle.closeAll(), /remain open/i);
  assert.deepEqual(closes, [1, 1], "one failed close must not prevent later listeners from closing");
  await lifecycle.closeAll();
  assert.deepEqual(closes, [2, 1], "only the retained failed listener is retried");
});

test("concurrent activation of one exact port lease creates only one tracked participant listener", async () => {
  let activations = 0;
  let closed = 0;
  let release!: () => void;
  const held = new Promise<void>((resolve) => { release = resolve; });
  const participant = {
    async openPortProxy() {
      activations += 1;
      await held;
      return { receipt: { status: "active" }, async close() { closed += 1; } };
    }
  } as unknown as InstalledCouncilParticipantClient;
  const lifecycle = new InstalledProviderCouncilResourceLifecycle("C:\\state", async () => participant);
  const first = lifecycle.callbacks.openPortProxy(assignment, { leaseId: "port-lease", onConnection() {} });
  await assert.rejects(() => lifecycle.callbacks.openPortProxy(assignment, { leaseId: "port-lease", onConnection() {} }), /activation in progress|already has/i);
  release();
  await first;
  assert.equal(activations, 1);
  await lifecycle.closeAll();
  assert.equal(closed, 1);
});

test("resource cleanup propagates cancellation, observes late settlement, and does not retain a successfully closed handle", async () => {
  let closeCalls = 0;
  let closeStarted!: () => void;
  let releaseClose!: () => void;
  const started = new Promise<void>((resolve) => { closeStarted = resolve; });
  const held = new Promise<void>((resolve) => { releaseClose = resolve; });
  const participant = {
    async openPortProxy() {
      return {
        receipt: { status: "active" },
        async close() { closeCalls += 1; closeStarted(); await held; }
      };
    }
  } as unknown as InstalledCouncilParticipantClient;
  const lifecycle = new InstalledProviderCouncilResourceLifecycle("C:\\state", async () => participant);
  await lifecycle.callbacks.openPortProxy(assignment, { leaseId: "port-lease", onConnection() {} });
  const controller = new AbortController();
  const cleanup = lifecycle.closeBinding({
    schema: "sxsy-b122.council-resource-cleanup", version: 1, epochId: assignment.epochId,
    sessionId: assignment.sessionId, targetSnapshotId: assignment.targetSnapshotId,
    resourceHostDigest: resourceHost.digest, outcome: "completed"
  }, controller.signal);
  await started;
  controller.abort();
  await assert.rejects(cleanup, /cancelled|remain open/i);
  releaseClose();
  await new Promise<void>((resolve) => setImmediate(resolve));
  await lifecycle.closeAll();
  assert.equal(closeCalls, 1, "a late successful close must remove the exact retained handle without a duplicate close");
});
