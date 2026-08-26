import assert from "node:assert/strict";
import test from "node:test";
import { InMemoryContainmentManager } from "../src/containment.ts";

test("containment is idempotent, fences brokered egress, and requires a durable permit for local remediation", () => {
  const containment = new InMemoryContainmentManager();
  const first = containment.activate({ repositoryRoot: "C:/work/example", operationId: "op-1", reason: "suspected exposure" });
  const second = containment.activate({ repositoryRoot: "C:/work/example", operationId: "op-2", reason: "repeat press" });

  assert.equal(first.fenceEpoch, 1);
  assert.equal(second.fenceEpoch, 1);
  assert.equal(containment.check("C:/work/example", "git").allowed, false);
  assert.equal(containment.check("C:/work/example", "credential").allowed, false);
  assert.equal(containment.check("C:/work/example", "network").allowed, false);
  assert.equal(containment.check("C:/work/example", "local_remediation").allowed, false);
  assert.equal(containment.check("C:/work/example", "local_cleanup").allowed, true);
});

test("containment survives an in-memory restart snapshot and cannot be released by a toggle", () => {
  const original = new InMemoryContainmentManager();
  const active = original.activate({ repositoryRoot: "C:/work/example", operationId: "op-1", reason: "incident" });
  const restored = InMemoryContainmentManager.restore(original.exportState());

  assert.equal(restored.check("C:/work/example", "git").allowed, false);
  const binding = { expectedFenceEpoch: 1, expectedActivationOperationId: "op-1", expectedIncidentId: active.incidentId!, expectedIncidentDigest: "0".repeat(64) } as const;
  assert.equal(restored.release({ repositoryRoot: "C:/work/example", reason: "done", reauthenticated: false, ...binding }).status, "blocked");
  assert.equal(restored.release({ repositoryRoot: "C:/work/example", reason: "done", reauthenticated: true, ...binding }).status, "blocked");
  assert.equal(restored.check("C:/work/example", "git").allowed, false);
});
