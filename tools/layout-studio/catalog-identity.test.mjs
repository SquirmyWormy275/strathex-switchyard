import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { definitionDigest, firmwareKeyboardId, identifyCatalogSnapshot, presetKeyboardId } from "./catalog-identity.mjs";
import { createSuiteStore } from "./suite-store.mjs";
import { createSuite } from "./suite.mjs";
const catalog = JSON.parse(await readFile(new URL("./model-f-catalog.json", import.meta.url), "utf8"));
function snapshot(id = "wcass:f77") { const d = catalog.definitions[id]; return { schema: "switchyard-device-snapshot/v1", capturedAt: new Date().toISOString(), identity: { deviceId: "a".repeat(64), vialProtocol: 6, viaProtocol: 9, keyboardId: d.firmwareIdentity.keyboardId }, definition: structuredClone(d.definition), rows: d.definition.matrix.rows, cols: d.definition.matrix.cols, layoutOptions: 0 }; }
test("unsafe 64-bit preset numbers retain every source byte and agree with literal firmware headers", async () => {
  const text = await readFile(new URL("../../third_party/model-f-catalog/ploxiln/keyboards/xwhatsit/brand_new_model_f/f77/wcass/keymaps/f77-ansi_fn_opt1.vil", import.meta.url), "utf8");
  assert.equal(Number.isSafeInteger(JSON.parse(text).uid), false);
  assert.equal(presetKeyboardId(text), "0103044704470912");
  assert.equal(presetKeyboardId('{"uid":18446744073709551615}'), "ffffffffffffffff");
  assert.equal(presetKeyboardId('{"uid":9007199254740993}'), "0100000000002000");
  assert.equal(firmwareKeyboardId("/* ignored */\n#define VIAL_KEYBOARD_UID {0x01, 3, 4, 0x47, 4, 0x47, 9, 0x12}"), "0103044704470912");
  for (const bad of ['{"uid":0}', '{"uid":-1}', '{"uid":18446744073709551616}', '{"uid":1e9}', '{"uid":"1299648051169985281"}', '{"uid":1,"uid":2}']) assert.throws(() => presetKeyboardId(bad));
  for (const bad of ["#define VIAL_KEYBOARD_UID {X,2,3,4,5,6,7,8}", "#define VIAL_KEYBOARD_UID {0,0,0,0,0,0,0,0}", "#define VIAL_KEYBOARD_UID {1,2,3,4,5,6,7,256}", "#define VIAL_KEYBOARD_UID {1,2}", "#define VIAL_KEYBOARD_UID {1,2,3,4,5,6,7,8}\n#define VIAL_KEYBOARD_UID {1,2,3,4,5,6,7,8}"]) assert.throws(() => firmwareKeyboardId(bad));
});
test("all 40 definitions reconcile exact source UIDs without claiming cases, hardware lineage or physical fit", async () => {
  let count = 0;
  for (const [id, d] of Object.entries(catalog.definitions)) {
    const header = await readFile(new URL(`../../third_party/model-f-catalog/${d.firmwareIdentity.source}`, import.meta.url), "utf8"); assert.equal(firmwareKeyboardId(header), d.firmwareIdentity.keyboardId);
    const s = snapshot(id), before = JSON.stringify(s), result = identifyCatalogSnapshot(catalog, s); assert.equal(result.status, "source-identity-match", id); assert.equal(result.sourceProposalEligible, true, id); assert.ok(result.definitions.some((x) => x.id === id && x.uidMatches));
    assert.equal(result.liveConnectionVerified, false); assert.equal(result.caseIdentityVerified, false); assert.equal(result.controllerHardwareVerified, false); assert.equal(result.physicalFitVerified, false); assert.equal(JSON.stringify(s), before); count++;
  }
  assert.equal(count, 40);
  const f77 = identifyCatalogSnapshot(catalog, snapshot()); assert.deepEqual(f77.suggestedModels.map((m) => m.id), ["f77-classic", "f77-compact"]);
  const split = identifyCatalogSnapshot(catalog, snapshot("wcass:fortho_left")); assert.ok(split.suggestedModels.some((m) => m.variants.some((v) => v.totalParts === 2 && !v.wholeKeyboardVerified)));
});
test("UID/definition conflicts, unknown firmware, missing layout options and non-Vial protocols never select a compatible preset", () => {
  const changed = snapshot(); changed.definition.name += " changed"; const conflict = identifyCatalogSnapshot(catalog, changed); assert.equal(conflict.status, "identity-definition-conflict"); assert.equal(conflict.sourceProposalEligible, false); assert.deepEqual(conflict.suggestedModels, []);
  const unknown = snapshot(); unknown.identity.keyboardId = "ffffffffffffffff"; assert.equal(identifyCatalogSnapshot(catalog, unknown).status, "definition-match-uid-unverified"); assert.equal(identifyCatalogSnapshot(catalog, unknown).sourceProposalEligible, false);
  const missing = snapshot(); delete missing.layoutOptions; assert.equal(identifyCatalogSnapshot(catalog, missing).selections, null); assert.equal(identifyCatalogSnapshot(catalog, missing).sourceProposalEligible, false);
  const original = identifyCatalogSnapshot(catalog, { identity: { protocol: "original-xwhatsit-0.9" } }); assert.equal(original.status, "unsupported-identity-route"); assert.equal(original.sourceProposalEligible, false);
  for (const field of ["viaProtocol", "vialProtocol", "keyboardId"]) { const invalid = snapshot(); invalid.identity[field] = 99; assert.throws(() => identifyCatalogSnapshot(catalog, invalid), /exact supported UID/); }
  assert.equal(definitionDigest({ matrix: { rows: 1, cols: 2 }, a: 3 }), definitionDigest({ a: 3, matrix: { cols: 2, rows: 1 } })); assert.throws(() => definitionDigest({ a: NaN }), /finite JSON/);
});
test("source identification reads only the selected compartment's protected readout and preserves its stale status and mode", async () => {
  const root = await mkdtemp(join(tmpdir(), "sy-identify-")), keys = new Map(), store = createSuiteStore({ root, secrets: { get: async (id, purpose) => keys.get(`${id}:${purpose}`), set: async (id, purpose, v) => { keys.set(`${id}:${purpose}`, v); } } });
  let hidCalls = 0; const suite = createSuite({ store, devices: { read: () => { hidCalls++; throw Error("must not read HID"); } }, agents: { close() {} }, voice: { discovery: async () => ({ available: false }) } });
  try {
    await store.initialize("personal"); await store.initialize("work", "work"); const s = snapshot(); s.capturedAt = "2000-01-01T00:00:00.000Z"; await store.update("personal", "synthetic-read", (v) => { v.deviceSnapshots = [s]; });
    const response = await suite.handle("/api/suite/devices/identify", { deviceId: s.identity.deviceId, snapshot: snapshot("leyden:f77:vial") }); assert.equal(response.snapshotStatus, "historical-readout"); assert.equal(response.status, "source-identity-match"); assert.equal(response.applied, false); assert.equal(hidCalls, 0);
    await assert.rejects(suite.handle("/api/suite/devices/identify", { compartment: "work", deviceId: s.identity.deviceId }), /Read this exact device/);
    assert.equal((await store.snapshot("personal")).mode, "keyboard-only"); assert.equal((await store.snapshot("personal")).profile, null);
  } finally { await suite.close(); await rm(root, { recursive: true, force: true, maxRetries: 5, retryDelay: 50 }); }
});
