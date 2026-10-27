import assert from "node:assert/strict";
import test from "node:test";
import { runPrehardwareDrill } from "./run-b122-prehardware-drill.mjs";

test("disposable pre-hardware drill proves baseline, degradation refusal, and recovery", async () => {
  const receipt = await runPrehardwareDrill();
  assert.equal(receipt.passed, true);
  assert.equal(receipt.disposableFixtureOnly, true);
  assert.equal(receipt.physicalAcceptanceEvidence, false);
  assert.equal(receipt.scenarios.baseline.passed, true);
  assert.equal(receipt.scenarios.degradedHandler.refused, true);
  assert.match(receipt.scenarios.degradedHandler.diagnostic, /expected handler/u);
  assert.equal(receipt.scenarios.substitutedIdentity.refused, true);
  assert.match(receipt.scenarios.substitutedIdentity.diagnostic, /known F77/u);
  assert.equal(receipt.scenarios.recovered.passed, true);
});
