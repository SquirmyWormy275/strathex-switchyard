import test from "node:test";
import assert from "node:assert/strict";
import { browserSurfaceFixture, until } from "./test-support/browser-ui.mjs";

test("role shortcut review uses the selected named control and discards a late old-workspace review", () => browserSurfaceFixture(async ({ $, change, click, document, store }) => {
  const { connectWorkspace } = await import("./connection.mjs");
  const plan = { profile: { evidence: "saved-snapshot" }, actions: [{ id: "progress", label: "Check progress" }] };
  let resolveReview; const calls = [];
  $("connection-implementation").value = "switchyard.role/v1";
  connectWorkspace({ getPlan: () => plan, notify() {}, request: async (path, body) => {
    calls.push({ path, body });
    if (path === "/api/discovery") return { synthetic: true, shortcuts: true, platform: "synthetic", hostLayouts: ["US"], checkedAt: new Date().toISOString(), keyboard: { status: "saved", message: "Fixture" }, chatgpt: { status: "unavailable" } };
    if (path === "/api/transactions") return [];
    if (path === "/api/review") return new Promise(resolve => { resolveReview = resolve; });
    throw Error("No host mutation is available in this fixture");
  } });
  document.dispatchEvent(new CustomEvent("switchyard-compartment-state", { detail: await store.snapshot("personal") }));
  change("connection-action", "progress"); change("connection-role-target", "0");
  await until(() => !$("review-connection").disabled); click("review-connection");
  const sent = calls.find(c => c.path === "/api/review"); assert.equal(sent.body.implementation, "switchyard.role/v1"); assert.deepEqual(sent.body.target, { roleId: "operator", intent: "status" });
  document.dispatchEvent(new Event("switchyard-workspace-changing"));
  resolveReview({ reviewId: "old-review", shortcut: "SUPER CTRL 2", label: "old target", changes: ["old review"] });
  await new Promise(resolve => setImmediate(resolve));
  assert.equal($("host-review-dialog").open, false); assert.equal($("apply-connection").disabled, true);
  assert.equal(calls.some(c => c.path === "/api/apply"), false);
}));

test("a source-reference layout cannot enable host shortcut review", () => browserSurfaceFixture(async ({ $, change, document, store }) => {
  const { connectWorkspace } = await import("./connection.mjs");
  $("connection-implementation").value = "switchyard.role/v1";
  let discovered = false;
  connectWorkspace({ getPlan: () => ({ profile: { evidence: "source-reference" }, actions: [{ id: "progress", label: "Check progress" }] }), notify() {}, request: async path => {
    if (path === "/api/discovery") return { shortcuts: true, platform: "synthetic", hostLayouts: ["US"], checkedAt: new Date().toISOString(), keyboard: { status: "reference", message: "Fixture" }, chatgpt: { status: "focusable" } };
    if (path === "/api/transactions") { discovered = true; return []; }
    throw Error("Reference layouts cannot reach host review");
  } });
  document.dispatchEvent(new CustomEvent("switchyard-compartment-state", { detail: await store.snapshot("personal") }));
  change("connection-action", "progress"); change("connection-role-target", "0");
  await until(() => discovered); assert.equal($("review-connection").disabled, true);
}));
