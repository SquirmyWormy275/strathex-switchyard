import assert from "node:assert/strict";
import test from "node:test";

import { companionBridgeVersion, isCompanionMethod } from "../src/bridge.ts";
import { CompanionService } from "../src/service.ts";
import type { ProviderMediatedFinalCurrentDecision, ProviderMediatedFinalCurrentRequest } from "../src/provider-mediated-final-current.ts";

const payload: ProviderMediatedFinalCurrentRequest = {
  schema: "sxsy-b122.provider-mediated-final-current-request",
  version: 1,
  authorizationId: "1".repeat(64),
  configurationSha256: "2".repeat(64),
  provider: "claude",
  adapterId: "sxsy-b122.module.claude",
  moduleSha256: "3".repeat(64),
  leaseId: "lease-1",
  leaseDigest: "4".repeat(64),
  operationId: "operation-1",
  action: "proof",
  routeId: "provider.proof",
  sessionId: "session-1",
  authorityId: "authority-1",
  targetSnapshotId: "5".repeat(64),
  repositoryRoot: "C:\\safe\\repo",
  containmentBindingDigest: "6".repeat(64),
  containmentFenceEpoch: 1,
  challengeNonce: "7".repeat(64),
  requestedAt: "2026-08-26T17:00:00.000Z",
  expiresAt: "2026-08-26T17:00:05.000Z"
};

test("bridge exposes one exact authenticated provider mediated final-current route", async () => {
  assert.equal(isCompanionMethod("provider-mediated.final-current"), true);
  let received: unknown;
  const decision = { schema: "sxsy-b122.provider-mediated-final-current-decision", version: 1, allowed: true } as unknown as ProviderMediatedFinalCurrentDecision;
  const service = new CompanionService({
    providerMediatedFinalCurrent: {
      async decide(input) { received = input; return decision; }
    }
  });

  const response = await service.handle({
    version: companionBridgeVersion,
    id: "provider-final-current",
    method: "provider-mediated.final-current",
    payload
  });
  assert.equal(response.ok, true);
  assert.strictEqual((response.result as { decision: unknown }).decision, decision);
  assert.deepEqual(received, payload);

  const unavailable = await new CompanionService().handle({
    version: companionBridgeVersion,
    id: "provider-final-current-unavailable",
    method: "provider-mediated.final-current",
    payload
  });
  assert.equal(unavailable.ok, false);
  assert.equal(unavailable.error?.code, "companion_unavailable");
});
