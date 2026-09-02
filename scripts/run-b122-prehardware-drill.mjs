#!/usr/bin/env node
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { createCommissioningPlan, lifecycleCases, verifyCommissioning } from "./b122-commissioning.mjs";

function evidence(plan) {
  const device = { hidrawNode: "/dev/hidraw-test", sysfsPath: "/sys/devices/sxsy-disposable-fixture", vendorId: "1234", productId: "5678", serial: "disposable-b122-fixture", reportDescriptorSha256: "b".repeat(64) };
  return {
    capture: { schema: "sxsy-b122-hidraw-capture/v1", readOnly: true, deviceNodesOpened: false, candidates: [{ hidrawNode: device.hidrawNode, sysfsPath: device.sysfsPath, reportDescriptorSha256: device.reportDescriptorSha256, usb: { vendorId: device.vendorId, productId: device.productId, serial: device.serial } }] },
    observations: {
      schema: "sxsy-b122-commissioning-observations/v1", device,
      slots: plan.slots.map((slot) => ({ control: slot.control, modifier: slot.modifier, outcome: slot.expectedOutcome, handler: slot.expectedHandler })),
      lifecycle: Object.fromEntries(lifecycleCases.map((name) => [name, { passed: true, observedAt: "2026-09-02T00:00:00.000Z", evidence: `disposable fixture: ${name}` }]))
    }
  };
}

async function rejected(operation) {
  try { await operation(); return null; }
  catch (error) { return error.message; }
}

export async function runPrehardwareDrill() {
  const plan = await createCommissioningPlan();
  const initial = evidence(plan);
  const baseline = await verifyCommissioning(initial);

  const degraded = evidence(plan);
  degraded.observations.slots[0].handler = "b122.DEGRADED:normal";
  const degradationError = await rejected(() => verifyCommissioning(degraded));
  if (!degradationError) throw new Error("Degraded handler unexpectedly verified.");

  const substituted = evidence(plan);
  substituted.observations.device.serial = "vial:f64c2b3c";
  substituted.capture.candidates[0].usb.serial = "vial:f64c2b3c";
  const substitutionError = await rejected(() => verifyCommissioning(substituted));
  if (!substitutionError) throw new Error("Known non-B122 identity unexpectedly verified.");

  const recovered = await verifyCommissioning(evidence(plan));
  return {
    schema: "sxsy-b122-prehardware-drill/v1",
    disposableFixtureOnly: true,
    physicalAcceptanceEvidence: false,
    scenarios: {
      baseline: { passed: baseline.passed },
      degradedHandler: { refused: true, diagnostic: degradationError },
      substitutedIdentity: { refused: true, diagnostic: substitutionError },
      recovered: { passed: recovered.passed }
    },
    passed: true
  };
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  runPrehardwareDrill().then((receipt) => process.stdout.write(`${JSON.stringify(receipt, null, 2)}\n`)).catch((error) => { process.stderr.write(`ERROR: ${error.message}\n`); process.exitCode = 1; });
}
