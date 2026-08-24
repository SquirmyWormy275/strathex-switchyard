import assert from "node:assert/strict";
import test from "node:test";
import { createHash } from "node:crypto";
import { assignments, canonicalManifestJson, controls, manifest, manifestSha256, protocolVersion, assignmentFor, handlerFor } from "../src/b122.ts";

test("the protocol exposes exactly 22 logical controls and 65 settled chord assignments", () => {
  assert.equal(controls.length, 22);
  assert.equal(assignments.length, 65);
  assert.equal(new Set(assignments.map((item) => `${item.control}:${item.modifier}`)).size, 65);
  assert.equal(new Set(assignments.map((item) => item.handler)).size, 65);
  for (const assignment of assignments) assert.equal(assignment.handler, handlerFor(assignment.control, assignment.modifier));
});

test("unassigned Ctrl combinations stay unassigned", () => {
  assert.equal(assignmentFor("REANCHOR", "ctrl"), undefined);
  assert.equal(assignmentFor("PROOF", "ctrl_alt"), undefined);
  assert.equal(assignmentFor("COMMIT", "ctrl_shift"), undefined);
});

test("high-consequence controls are disabled pending gates", () => {
  for (const [control, modifier] of [
    ["COUNCIL", "shift"], ["COMMIT", "alt"], ["COMMIT", "shift_alt"],
    ["COMPOUND", "shift_alt"], ["PIPELINE", "ctrl_shift_alt"],
    ["SHIELD", "ctrl_shift_alt"], ["SANDBOX", "alt"], ["SANDBOX", "shift_alt"],
    ["SANDBOX", "ctrl_shift_alt"]
  ] as const) {
    assert.equal(assignmentFor(control, modifier)?.capability, "disabled_pending_gates");
  }
});

test("the canonical machine-readable manifest has a checked SHA-256 identity", () => {
  assert.equal(manifest.schema, "sxsy-b122-control-map/v1");
  assert.deepEqual(manifest.controls, controls);
  assert.deepEqual(manifest.assignments, assignments);
  assert.equal(createHash("sha256").update(canonicalManifestJson).digest("hex"), manifestSha256);
  assert.match(manifestSha256, /^[0-9a-f]{64}$/);
});
