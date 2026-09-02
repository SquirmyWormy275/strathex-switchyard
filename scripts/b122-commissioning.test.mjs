import assert from "node:assert/strict";
import test from "node:test";
import { createCommissioningPlan, lifecycleCases, verifyCommissioning } from "./b122-commissioning.mjs";

function fixture(plan) {
  const device = { hidrawNode: "/dev/hidraw9", sysfsPath: "/sys/devices/pci0000:00/usb9/9-1/9-1:1.0/0003:1234:5678.0001", vendorId: "1234", productId: "5678", serial: "b122-observed-unit", reportDescriptorSha256: "a".repeat(64) };
  const capture = { schema: "sxsy-b122-hidraw-capture/v1", readOnly: true, deviceNodesOpened: false, candidates: [{ hidrawNode: device.hidrawNode, sysfsPath: device.sysfsPath, reportDescriptorSha256: device.reportDescriptorSha256, usb: { vendorId: device.vendorId, productId: device.productId, serial: device.serial } }] };
  const observations = {
    schema: "sxsy-b122-commissioning-observations/v1", device,
    slots: plan.slots.map((slot) => ({ control: slot.control, modifier: slot.modifier, outcome: slot.expectedOutcome, handler: slot.expectedHandler })),
    lifecycle: Object.fromEntries(lifecycleCases.map((name) => [name, { passed: true, observedAt: "2026-09-02T00:00:00.000Z", evidence: `operator-observed ${name}` }]))
  };
  return { capture, observations };
}

test("plan covers all 176 canonical slots with 65 assigned and 111 inert", async () => {
  const plan = await createCommissioningPlan();
  assert.equal(plan.slots.length, 176);
  assert.equal(plan.slots.filter((slot) => slot.expectedOutcome === "dispatched").length, 65);
  assert.equal(plan.slots.filter((slot) => slot.expectedOutcome === "inert").length, 111);
  assert.equal(new Set(plan.slots.map((slot) => `${slot.control}:${slot.modifier}`)).size, 176);
  assert.equal(plan.physicalPositionStatus, "unassigned-within-bank");
});

test("a complete exact observation receipt verifies without mutating acceptance", async () => {
  const plan = await createCommissioningPlan();
  const receipt = await verifyCommissioning(fixture(plan));
  assert.equal(receipt.passed, true);
  assert.equal(receipt.totals.slots, 176);
  assert.equal(receipt.acceptanceMutationPerformed, false);
});

test("missing, duplicate, unknown, and semantically wrong slots fail closed", async (context) => {
  const plan = await createCommissioningPlan();
  await context.test("missing", async () => { const value = fixture(plan); value.observations.slots.pop(); await assert.rejects(verifyCommissioning(value), /missing/u); });
  await context.test("duplicate", async () => { const value = fixture(plan); value.observations.slots.push(value.observations.slots[0]); await assert.rejects(verifyCommissioning(value), /Duplicate/u); });
  await context.test("unknown", async () => { const value = fixture(plan); value.observations.slots.push({ control: "NOT_A_CONTROL", modifier: "normal", outcome: "inert", handler: null }); await assert.rejects(verifyCommissioning(value), /unknown/u); });
  await context.test("wrong handler", async () => { const value = fixture(plan); value.observations.slots[0].handler = "b122.WRONG:normal"; await assert.rejects(verifyCommissioning(value), /expected handler/u); });
  await context.test("assigned made inert", async () => { const value = fixture(plan); value.observations.slots[0].outcome = "inert"; await assert.rejects(verifyCommissioning(value), /expected dispatched/u); });
});

test("the known F77 serial and placeholder identities cannot be accepted as B122", async () => {
  const plan = await createCommissioningPlan();
  const f77 = fixture(plan); f77.observations.device.serial = "vial:f64c2b3c"; f77.capture.candidates[0].usb.serial = "vial:f64c2b3c";
  await assert.rejects(verifyCommissioning(f77), /known F77/u);
  const placeholder = fixture(plan); placeholder.observations.device.vendorId = "0000";
  await assert.rejects(verifyCommissioning(placeholder), /placeholder/u);
});

test("every lifecycle case needs timestamped positive evidence", async () => {
  const plan = await createCommissioningPlan();
  const value = fixture(plan); value.observations.lifecycle.suspendResume = { passed: false, observedAt: "not-a-date", evidence: "" };
  await assert.rejects(verifyCommissioning(value), /suspendResume/u);
});
