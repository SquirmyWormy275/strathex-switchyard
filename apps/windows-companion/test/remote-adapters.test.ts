import assert from "node:assert/strict";
import test from "node:test";

import { ConfiguredProviderCommandAdapter, DynamicConfiguredNetworkClient } from "../src/remote-adapters.ts";

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
