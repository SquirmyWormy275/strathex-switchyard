import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { browserSurfaceFixture, until } from "./test-support/browser-ui.mjs";
const catalog = JSON.parse(await readFile(new URL("./model-f-catalog.json", import.meta.url), "utf8"));

test("saved-readout controls inspect source and open the original typing evidence without HID or state changes", () => browserSurfaceFixture(async ({ store, refresh, $, click, calls }) => {
  const source = catalog.definitions["wcass:f77"], definition = source.definition, { rows, cols } = definition.matrix;
  const captured = { schema: "switchyard-device-snapshot/v1", identity: { deviceId: "a".repeat(64), keyboardId: source.firmwareIdentity.keyboardId, viaProtocol: 9, vialProtocol: 4 }, capturedAt: "2026-01-01T00:00:00Z", definition, rows, cols, layers: 1, keymap_raw: [Array.from({ length: rows }, () => Array(cols).fill(0x5221))], layoutOptions: 0, configurationOnly: true };
  await store.update("personal", "synthetic-cached-readout", state => { state.deviceSnapshots = [captured]; });
  const before = await store.snapshot("personal"), opened = [];
  const { mountDevices } = await import("./device-ui.mjs"); mountDevices({ onSnapshot: value => opened.push(value), getProfile: () => null, notify() {} });
  await refresh();
  assert.match($("saved-device-status").textContent, /saved evidence, not a live connection/);
  click("inspect-saved-device"); await until(() => $("saved-device-facts").children.length === 10);
  assert.match($("saved-device-facts").children[5].textContent, /historical/);
  assert.match($("saved-device-facts").children[9].textContent, /live state and controls unavailable/);
  click("use-saved-device"); assert.deepEqual(opened, [captured]);
  assert.deepEqual(await store.snapshot("personal"), before);
  assert.deepEqual(calls.map(c => c.path), ["/api/suite/devices/identify"]);
  assert.equal($("apply-device-change").disabled, true); assert.equal($("unlock-device").disabled, true);
}));

test("workspace transition clears saved readouts and prevents importing old workspace evidence", () => browserSurfaceFixture(async ({ refresh, $, document, store }) => {
  const definition = catalog.definitions["wcass:f77"].definition;
  await store.update("personal", "synthetic-cached-readout", state => { state.deviceSnapshots = [{ identity: { deviceId: "a".repeat(64) }, capturedAt: "2026-01-01T00:00:00Z", definition, rows: 16, cols: 8, layers: 1 }]; });
  const { mountDevices } = await import("./device-ui.mjs"); let opened = 0;
  mountDevices({ onSnapshot: () => { opened++; }, getProfile: () => null, notify() {} });
  await refresh(); assert.equal($("use-saved-device").disabled, false);
  document.dispatchEvent(new Event("switchyard-workspace-changing"));
  assert.equal($("use-saved-device").disabled, true); assert.equal($("inspect-saved-device").disabled, true);
  $("use-saved-device").dispatchEvent(new Event("click")); assert.equal(opened, 0);
}));
