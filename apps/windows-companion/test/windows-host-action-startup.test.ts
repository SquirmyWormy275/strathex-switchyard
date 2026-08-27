import assert from "node:assert/strict";
import test from "node:test";

import { startStandaloneHardwareSignalDispatch } from "../src/main.ts";

test("standalone startup recovers before host-action and hardware consumers can observe queues", async () => {
  const order: string[] = [];
  await startStandaloneHardwareSignalDispatch({
    endpoint: { async ready() { order.push("recovery"); } },
    windowsHostActionConsumer: { async start() { order.push("windows-host-actions"); } },
    hardwareSignalDispatcher: { async start() { order.push("hardware-signals"); } }
  });
  assert.deepEqual(order, ["recovery", "windows-host-actions", "hardware-signals"]);
});

test("a failed Windows host-action consumer prevents hardware intake from starting", async () => {
  let hardwareStarts = 0;
  await assert.rejects(startStandaloneHardwareSignalDispatch({
    endpoint: { async ready() {} },
    windowsHostActionConsumer: { async start() { throw new Error("host-action recovery failed"); } },
    hardwareSignalDispatcher: { async start() { hardwareStarts += 1; } }
  }), /host-action recovery failed/);
  assert.equal(hardwareStarts, 0);
});
