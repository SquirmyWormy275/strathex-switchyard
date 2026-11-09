import test from "node:test";
import assert from "node:assert/strict";
import { browserSurfaceFixture, until } from "./test-support/browser-ui.mjs";
import { vialFixture } from "./test-support/vial-fixture.mjs";
import { createDeviceService } from "./devices.mjs";
const descendants = element => [element, ...(element.children ?? []).flatMap(descendants)];
function field(root, name) { const label = descendants(root).find(row => row.textContent === name && row.children?.length); assert.ok(label, name); return label.children[0]; }
function value(input, next) { input.value = String(next); input.dispatchEvent(new Event("change")); }
function press(button) { assert.equal(button.disabled, false); button.dispatchEvent(new Event("click")); }
async function fixture(fn, setup = () => {}) {
  const device = vialFixture({ optionalStorage: true }); device.definition.layouts.labels = [["Physical option", "Standard", "Split"]]; device.definition.layouts.keymap.push([`0,0${"\n".repeat(9)}e`, `0,1${"\n".repeat(9)}e`]);
  setup(device);
  let service, reviewGate;
  const devices = Object.fromEntries(["read", "apply", "restore", "identify", "unlock"].map(name => [name, (...args) => service[name](...args)]));
  devices.review = async (...args) => { const review = await service.review(...args); if (reviewGate) await reviewGate(); return review; }; devices.close = async () => {};
  return browserSurfaceFixture(async c => {
    service = createDeviceService({ ...device.options, store: c.store });
    const snapshot = await service.read("personal", device.deviceId); const { mountDevices } = await import("./device-ui.mjs"); const notices = [];
    mountDevices({ onSnapshot() {}, getProfile: () => null, notify: text => notices.push(text) });
    const pending = new Set(); c.document.addEventListener("switchyard-refresh-request", () => { const p = c.refresh(); pending.add(p); void p.finally(() => pending.delete(p)); });
    await c.refresh(); c.click("plan-saved-device");
    try { await fn({ ...c, device, snapshot, notices, gate: fn => { reviewGate = fn; }, group: kind => c.change("device-settings-kind", kind), form: () => c.$("device-settings-form") }); }
    finally { await Promise.allSettled(pending); }
  }, { devices });
}
async function review(c, button = "review-device-settings") { c.click(button); await until(() => c.$("device-review-dialog").open && !c.$("apply-device-change").disabled); }
async function apply(c) { c.click("apply-device-change"); await until(() => /applied and read back/.test(c.$("device-status").textContent) && !c.$("restore-device-change").disabled); }
async function restore(c) { c.click("restore-device-change"); await until(() => /transaction restored/.test(c.$("device-status").textContent)); }

test("cached planning performs no API read and a reviewed dual-role key preserves its ordinary typing fallback", () => fixture(async c => {
  assert.equal(c.calls.length, 0); assert.equal(c.device.writes.length, 0);
  c.change("device-key", "0:0"); const editor = c.$("device-key-editor"); value(field(editor, "Behavior"), "mod-tap");
  await review(c, "review-device-change"); assert.equal(c.device.writes.length, 0); await apply(c);
  assert.equal(c.device.raw[0][0][0], 0x6104); assert.equal(c.device.raw[0][0][1], 5);
  await restore(c); assert.deepEqual(c.device.raw[0], [[4, 5]]);
}));

test("advertised typing settings use a concrete read-only review before apply and restore", () => fixture(async c => {
  c.group("settings"); value(field(c.form(), "Tap/hold threshold (ms) · current 200"), 250);
  await review(c); assert.match(c.$("device-review-summary").textContent, /200 → 250/); assert.equal(c.device.settings.get(7), 200); assert.equal(c.device.writes.length, 0);
  await apply(c); assert.equal(c.device.settings.get(7), 250); await restore(c); assert.equal(c.device.settings.get(7), 200); assert.deepEqual(c.device.raw[0], [[4, 5]]);
}));

test("onboard macro replacement requires explicit selection, shows its text, and restores the exact original buffer", () => fixture(async c => {
  const before = Buffer.from(c.device.macro); c.group("macros"); c.click("review-device-settings"); assert.match(c.$("device-settings-status").textContent, /Explicitly choose/); assert.equal(c.calls.length, 0);
  field(c.form(), "Replace this slot with the steps below (empty clears it)").checked = true;
  press(descendants(c.form()).find(row => row.textContent === "Add a macro step")); value(field(c.form(), "Text"), "HELLO");
  await review(c); assert.match(c.$("device-review-summary").textContent, /Type “HELLO”/); assert.match(c.$("device-review-summary").textContent, /foreground application/); assert.deepEqual(c.device.macro, before);
  await apply(c); assert.equal(c.device.macro.subarray(0, 6).toString("ascii"), "HELLO\0"); await restore(c); assert.deepEqual(c.device.macro, before);
}));

test("macro keys cannot remain held, and physical options use the source-advertised choices", () => fixture(async c => {
  c.group("macros"); field(c.form(), "Replace this slot with the steps below (empty clears it)").checked = true;
  press(descendants(c.form()).find(row => row.textContent === "Add a macro step")); value(field(c.form(), "Step"), "down"); c.click("review-device-settings");
  await until(() => /Every macro-held key/.test(c.$("device-status").textContent)); assert.equal(c.device.writes.length, 0); assert.equal(c.$("device-review-dialog").open, false);
  c.group("layout"); value(field(c.form(), "Physical option"), 1); await review(c); assert.match(c.$("device-review-summary").textContent, /Standard → Split/); await apply(c); await restore(c);
  assert.deepEqual(c.device.raw[0], [[4, 5]]);
}));

test("encoder editing retains the other direction and ordinary typing through apply and restore", () => fixture(async c => {
  c.group("encoders"); value(field(c.form(), "Behavior"), "modified"); value(field(c.form(), "Key"), 6);
  await review(c); assert.equal(c.device.writes.length, 0); await apply(c); assert.deepEqual(c.device.encoders.get("0:0"), [0x0106, 5]); assert.deepEqual(c.device.raw[0], [[4, 5]]);
  await restore(c); assert.deepEqual(c.device.encoders.get("0:0"), [4, 5]);
}));

test("unplugged encoder failure exposes the saved recovery transaction without claiming success", () => fixture(async c => {
  c.group("encoders"); value(field(c.form(), "Key"), 6); await review(c); c.device.interruptEncoder(true); c.click("apply-device-change");
  await until(() => !c.$("restore-device-change").disabled && c.notices.length > 0); assert.doesNotMatch(c.$("device-status").textContent, /applied and read back/);
  assert.equal((await c.store.snapshot("personal")).deviceTransactions.at(-1).status, "recovery-pending"); c.device.reconnect(); await restore(c); assert.deepEqual(c.device.encoders.get("0:0"), [4, 5]);
}));

test("an old-workspace configuration review cannot re-enable Apply after it returns", () => fixture(async c => {
  let release, entered = false; const waiting = new Promise(resolve => { release = resolve; }); c.gate(async () => { entered = true; await waiting; });
  c.group("settings"); value(field(c.form(), "Tap/hold threshold (ms) · current 200"), 250); c.click("review-device-settings"); await until(() => entered);
  try { c.document.dispatchEvent(new Event("switchyard-workspace-changing")); await c.store.initialize("work", "work"); c.document.dispatchEvent(new CustomEvent("switchyard-compartment-state", { detail: await c.store.snapshot("work") })); }
  finally { release(); }
  await until(() => !c.$("device-picker").disabled); assert.equal(c.$("device-review-dialog").open, false); assert.equal(c.$("apply-device-change").disabled, true); assert.equal(c.device.writes.length, 0);
}));

function group(root, title) { const legend = descendants(root).find(row => row.textContent === title); const parent = descendants(root).find(row => row.children?.includes(legend)); assert.ok(parent, title); return parent; }
function check(root, name, next = true) { const input = field(root, name); input.checked = next; input.dispatchEvent(new Event("change")); }

test("tap-dance editing reviews all four outputs and restores the recorded table", () => fixture(async c => {
  c.group("tapDances"); check(c.form(), "Replace this recorded slot"); value(field(group(c.form(), "Tap"), "Key"), 4); value(field(group(c.form(), "Double tap"), "Key"), 5);
  await review(c); assert.equal(c.device.writes.length, 0); await apply(c); assert.deepEqual(c.device.tapDances[0], [4, 0, 5, 0, 200]); await restore(c); assert.deepEqual(c.device.tapDances[0], [0, 0, 0, 0, 200]); assert.deepEqual(c.device.raw[0], [[4, 5]]);
}));

test("combos require explicit replacement and existing distinct triggers, then restore byte-exactly", () => fixture(async c => {
  c.group("combos"); c.click("review-device-settings"); assert.match(c.$("device-settings-status").textContent, /Explicitly choose/); assert.equal(c.calls.length, 0);
  check(c.form(), "Replace this recorded slot"); value(field(c.form(), "Trigger 1"), 4); value(field(c.form(), "Trigger 2"), 4); value(field(group(c.form(), "Combo output"), "Key"), 6); c.click("review-device-settings"); await until(() => /distinct ordinary/.test(c.$("device-status").textContent)); assert.equal(c.device.writes.length, 0);
  value(field(c.form(), "Trigger 2"), 5); await review(c); await apply(c); assert.deepEqual(c.device.combos[0], [4, 5, 0, 0, 6]); await restore(c); assert.deepEqual(c.device.combos[0], [0, 0, 0, 0, 0]);
}));

test("named override modifiers preserve base typing and unknown rule bits only permit explicit clear", () => fixture(async c => {
  c.group("keyOverrides"); check(c.form(), "Replace this recorded slot"); value(field(group(c.form(), "Trigger"), "Key"), 4); value(field(group(c.form(), "Replacement"), "Key"), 5); check(c.form(), "Layer 0 · ordinary typing"); check(c.form(), "When the trigger key is pressed"); check(c.form(), "Enable this rule");
  c.click("review-device-settings"); await until(() => /must require a modifier/.test(c.$("device-status").textContent)); assert.equal(c.device.writes.length, 0);
  check(group(c.form(), "Required modifiers"), "Left Shift"); await review(c); await apply(c); assert.deepEqual(c.device.keyOverrides[0], [4, 5, 1, 2, 0, 0, 129]); await restore(c);
  c.click("plan-saved-device"); c.group("keyOverrides"); value(field(c.form(), "Saved slot"), 1); check(c.form(), "Replace this recorded slot"); c.click("review-device-settings"); await until(() => /unknown fields\/option bits/.test(c.$("device-status").textContent)); assert.equal(c.$("device-review-dialog").open, false);
  const original = [...c.device.keyOverrides[1]]; check(c.form(), "Clear this slot"); await review(c); await apply(c); assert.deepEqual(c.device.keyOverrides[1], [0, 0, 0, 0, 0, 0, 0]); await restore(c); assert.deepEqual(c.device.keyOverrides[1], original);
}, d => d.enableRules()));

test("alternate repeat is gated to Vial 6 and uses named modifiers and options", async () => {
  await fixture(async c => { assert.ok(!c.$("device-settings-kind").options.some(o => o.value === "alternateRepeatKeys")); }, d => d.enableRules());
  await fixture(async c => {
    c.group("alternateRepeatKeys"); check(c.form(), "Replace this recorded slot"); value(field(group(c.form(), "Repeat trigger"), "Key"), 4); value(field(group(c.form(), "Alternate"), "Key"), 5); check(c.form(), "Enable this rule"); check(c.form(), "Repeat in both directions"); check(group(c.form(), "Allowed modifiers"), "Left Shift");
    await review(c); await apply(c); assert.deepEqual(c.device.alternateRepeatKeys[0], [4, 5, 2, 10]); await restore(c); assert.deepEqual(c.device.alternateRepeatKeys[0], [0, 0, 0, 0]); assert.deepEqual(c.device.raw[0], [[4, 5]]);
  }, d => { d.enableRules(); d.protocol(6); });
});
