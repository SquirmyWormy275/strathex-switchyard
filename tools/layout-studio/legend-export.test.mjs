import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { once } from "node:events";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { newPlan, parseBoardProfile } from "./model.mjs";
import { portableProfile } from "./workspace.mjs";
import { exportAssignmentLegends } from "./legend-export.mjs";
import { createSuiteStore } from "./suite-store.mjs";
import { createSuite } from "./suite.mjs";
import { createStudioServer } from "./serve.mjs";
import { createPortablePackage } from "./portable-package.mjs";
import templateFaces from "../../third-party/cyber_engineer/template-faces.json" with { type: "json" };

function sample(count = 4) {
  const plan = newPlan(parseBoardProfile({ schema: "sxsy-board-profile/v1", name: "Synthetic F77 reference", layout: "synthetic", keys: [
    { id: "one", label: "A", matrix: [0, 0], x: 0, y: 0, baseKeycode: "KC_A" },
    { id: "two", label: "ISO", matrix: [0, 1], x: 1, y: 0, w: 1.5, h: 2, rotation: 12, shape: [{ x: 0, y: 0, w: 1.5, h: 1 }, { x: .25, y: 1, w: 1.25, h: 1 }], baseKeycode: "KC_ENTER" }
  ] }));
  plan.actions = Array.from({ length: count }, (_, i) => ({ id: `action-${i}`, label: ["Return", "Find", "Review", "Stop"][i % 4], family: "lifecycle", consequence: i % 2 ? "mutating" : "read_only", confirmation: i % 2 === 1, frequencyPerDay: 0, secondsSaved: 0, binding: { keyId: i % 2 ? "two" : "one", modifier: "gui_shift" } }));
  return portableProfile(plan, "synthetic-print", "My desk");
}
test("assignment reference retains every exact modifier, unassigned action, review issue and rotated outline without exporting local state", async () => {
  const document = sample(), before = JSON.stringify(document); document.plan.actions[3].binding = null;
  const result = await exportAssignmentLegends({ ...document, accounts: ["never-export-account"], roleBindings: [{ sessionId: "never-export-session" }] });
  assert.equal(result.manifest.assignments.length, 4); assert.equal(result.manifest.assignments[0].modifier, "GUI+Shift"); assert.deepEqual(result.manifest.unassigned, ["action-3"]);
  assert.ok(result.manifest.reviewIssues.length); assert.ok(result.content.includes("Review before use")); assert.ok(result.content.includes("rotate(12)")); assert.ok(result.content.includes("polygon")); assert.ok(result.content.includes("Unassigned"));
  assert.equal(result.content.includes("never-export"), false); assert.equal(JSON.stringify(result.manifest).includes("never-export"), false); assert.equal(result.manifest.template.capFitVerified, false);
  assert.equal(createHash("sha256").update(result.content).digest("hex"), result.sha256);
  assert.equal(JSON.stringify(sample()), before);
});
test("full source geometry and credit are hash-verified, and all page numbers refer to exact actions", async () => {
  const document = sample(17), first = await exportAssignmentLegends(document, { format: "template-svg" }), second = await exportAssignmentLegends(document, { format: "template-svg", page: 1 });
  const source = await readFile(new URL("../../third-party/cyber_engineer/pure-template.svg", import.meta.url), "utf8"), inner = source.slice(source.indexOf(">", source.indexOf("<svg")) + 1, source.lastIndexOf("</svg>"));
  assert.equal(first.manifest.template.pageCount, 2); assert.equal(first.manifest.template.calibrationMm, 15); assert.ok(first.content.includes(inner));
  assert.equal(createHash("sha256").update(source).digest("hex"), first.manifest.template.sourceSvgSha256);
  assert.ok(first.content.includes('width="210mm" height="297mm"')); assert.ok(first.content.includes("1 OF 2")); assert.ok(second.content.includes("2 OF 2"));
  assert.equal((first.content.match(/<rect /g) ?? []).length, 60); assert.equal((second.content.match(/<rect /g) ?? []).length, 8);
  // Literal retained-source coordinate, not the old approximate center. Ink
  // stays inside the face rather than painting over the clip cut lines.
  assert.ok(first.content.includes('x="53.707" y="498.0703"'));
  assert.equal(templateFaces.compact.length, 18); assert.equal(templateFaces.full.length, 15);
  for (const face of [...templateFaces.compact, ...templateFaces.full]) assert.ok(source.includes(`M ${face.x} ${face.y + face.h}`) || source.includes(`L ${face.x} ${face.y + face.h}`));
  assert.ok(second.content.includes(">16</text>")); assert.ok(second.content.includes(">17</text>"));
  const all = await exportAssignmentLegends(document, { format: "template-html" });
  assert.equal((all.content.match(/id="source-template"/g) ?? []).length, 1); assert.equal((all.content.match(/class="sheet"/g) ?? []).length, 2);
  assert.ok(Buffer.byteLength(all.content) < 900000); assert.ok(all.content.includes("@page{size:A4;margin:0}"));
});
test("long labels require explicit legible print labels and retain the full action meaning in the reference", async () => {
  const document = sample(1); document.plan.actions[0].label = "A".repeat(80);
  await assert.rejects(exportAssignmentLegends(document, { format: "template-svg" }), /shorter print label/);
  const options = { labels: { "action-0": "Anchor" } }, result = await exportAssignmentLegends(document, { ...options, format: "template-svg" });
  assert.equal(result.manifest.assignments[0].label.length, 80); assert.equal(result.manifest.assignments[0].printLabel, "Anchor");
  const reference = await exportAssignmentLegends(document, options); assert.ok(reference.content.includes("Print label: Anchor")); assert.ok(reference.content.includes("A".repeat(80)));
});
test("HTML, SVG and output names escape untrusted text and reject control or ambiguous export options", async () => {
  const document = sample(1); document.name = '<script>alert("x")</script>'; document.plan.actions[0].label = "Review <&>";
  for (const format of ["review-html", "template-svg", "template-html"]) {
    const result = await exportAssignmentLegends(document, { format }); assert.equal(result.content.includes("<script>"), false); assert.ok(result.content.includes("&lt;script&gt;")); assert.match(result.filename, /^switchyard-[a-z-]+-[a-f0-9]{12}(?:-1)?\.(?:html|svg)$/);
  }
  for (const options of [{ format: "pdf" }, { page: -1 }, { page: 5 }, { page: .5 }, { format: "template-html", page: 1 }, { labels: { unknown: "x" } }, { labels: { "action-0": "a\u0001b" } }, { labels: [] }]) await assert.rejects(exportAssignmentLegends(document, options));
  document.plan.actions[0].label = "bad\u0001text"; await assert.rejects(exportAssignmentLegends(document), /control characters/);
});
test("empty profiles preserve the blank source; no assignment or device position is invented", async () => {
  const result = await exportAssignmentLegends(sample(0), { format: "template-svg" }); assert.deepEqual(result.manifest.assignments, []); assert.equal(result.manifest.template.pageCount, 1); assert.equal(result.content.includes("<rect "), false);
});
test("portable v2 meanings retain exact roles/intents, while edited revisions cannot be printed as verified definitions", async () => {
  const document = sample(1); document.workflow = { name: "Coding", steps: [], roles: [{ id: "builder", label: "Builder" }] };
  const p = createPortablePackage(document, { intentAssignments: [{ actionId: "action-0", roleId: "builder", intent: "resume" }] });
  const result = await exportAssignmentLegends(p); assert.deepEqual(result.manifest.assignments[0].meaning, { roleId: "builder", roleLabel: "Builder", intent: "resume" }); assert.ok(result.content.includes("portable meaning; connect locally"));
  p.intentAssignments[0].intent = "cancel"; await assert.rejects(exportAssignmentLegends(p), /does not verify/);
});
test("authenticated export uses saved definitions and blocks Work, missing profiles and unauthenticated callers", async () => {
  const root = await mkdtemp(join(tmpdir(), "sy-legends-")), keys = new Map(), store = createSuiteStore({ root, secrets: { get: async (id, purpose) => keys.get(`${id}:${purpose}`), set: async (id, purpose, value) => { keys.set(`${id}:${purpose}`, value); } } });
  const suite = createSuite({ store, agents: { close() {} }, voice: { discovery: async () => ({ available: false }) } }), token = "t".repeat(43), server = createStudioServer({ suite, token, bridge: { close() {} }, discover: async () => ({}) });
  server.listen(0, "127.0.0.1"); await once(server, "listening"); const base = `http://127.0.0.1:${server.address().port}`;
  const post = (body, authenticated = true) => fetch(`${base}/api/suite/profile/legends/export`, { method: "POST", headers: { "Content-Type": "application/json", Origin: base, ...(authenticated ? { Authorization: `Bearer ${token}` } : {}) }, body: JSON.stringify(body) });
  try {
    await store.initialize("personal"); await store.initialize("work", "work"); await store.initialize("empty"); await store.saveProfile("personal", sample()); await store.saveProfile("work", sample());
    assert.equal((await post({}, false)).status, 401);
    const response = await post({ profile: { schema: "untrusted-replacement" }, options: { format: "template-svg" } }); assert.equal(response.status, 200); const result = await response.json(); assert.equal(result.manifest.name, "My desk"); assert.ok(result.content.includes("NUMBERS REFER TO ASSIGNMENT REFERENCE"));
    for (const compartment of ["work", "empty"]) assert.equal((await post({ compartment })).status, 409);
    assert.equal((await store.snapshot("personal")).mode, "keyboard-only"); assert.deepEqual((await store.exportProfile("personal")), { ...sample(), workflow: { schema: "switchyard-workflow/v1", name: "My workflow", steps: [], roles: [] } });
  } finally { server.closeAllConnections(); await new Promise((r) => server.close(r)); await server.cleanup(); await rm(root, { recursive: true, force: true, maxRetries: 5, retryDelay: 50 }); }
});
