import assert from "node:assert/strict";
import test from "node:test";

import {
  createAutomationIntent,
  parseAutomationEnvelope,
  parseAutomationProviderResult
} from "../src/automation-protocol.ts";

const confirmation = { digest: "a".repeat(64), scopeDigest: "b".repeat(64) } as const;
const testEnvironment = { id: "environment-1", egress: "deny", databaseName: "b122_test_1" } as const;
const target = { id: "c".repeat(64), repositoryRoot: "C:\\repo" };
const session = { id: "session-1", provider: "codex" };

test("each automation action has an immutable action-specific request contract", () => {
  const capture = createAutomationIntent("compound_capture", undefined, undefined);
  assert.equal(capture.kind, "compound_capture");
  assert.equal(capture.durability, "project_learning");
  assert.throws(() => createAutomationIntent("compound_capture", confirmation, undefined), /cannot carry.*confirmation/i);

  const refresh = createAutomationIntent("compound_refresh", confirmation, undefined);
  assert.equal(refresh.kind, "compound_refresh");
  assert.equal(refresh.mode, "preview_only");
  assert.equal(refresh.mutationApplied, false);

  const lfg = createAutomationIntent("lfg", confirmation, undefined);
  assert.equal(lfg.kind, "lfg");
  assert.equal(lfg.deployAuthorized, false);

  const repair = createAutomationIntent("repair_mission", confirmation, testEnvironment);
  assert.equal(repair.kind, "repair_mission");
  assert.equal(repair.testEnvironment.egress, "deny");
  assert.throws(() => createAutomationIntent("repair_mission", confirmation, undefined), /test environment/i);

  for (const [action, intent] of [["compound_capture", capture], ["compound_refresh", refresh], ["lfg", lfg], ["repair_mission", repair]] as const) {
    const parsed = parseAutomationEnvelope({
      schema: `sxsy-b122.${action.replaceAll("_", "-")}-request`,
      version: 1,
      action,
      operationId: `operation-${action}`,
      target,
      session,
      authorityId: "authority-1",
      intent
    });
    assert.equal(parsed.action, action);
    assert.deepEqual(parsed.intent, intent);
  }
  assert.throws(() => parseAutomationEnvelope({ schema: "sxsy-b122.compound-capture-request", version: 1, action: "compound_refresh", operationId: "op", target, session, authorityId: "authority-1", intent: capture }), /schema|action/i);
});

test("provider results cannot cross action schemas or hide prohibited side effects", () => {
  const common = { version: 1, status: "completed", effectDisposition: "committed", summary: "bounded", externalId: "operation-1" } as const;
  const capture = parseAutomationProviderResult({
    ...common,
    schema: "sxsy-b122.compound-capture-result",
    action: "compound_capture",
    result: { kind: "compound_capture", captureId: "capture-1", learningDigest: "d".repeat(64), verifiedProblemDigest: "e".repeat(64), documents: ["docs/learning.md"] }
  }, "compound_capture", "operation-1");
  assert.equal(capture.result.kind, "compound_capture");

  const refresh = parseAutomationProviderResult({
    ...common,
    schema: "sxsy-b122.compound-refresh-result",
    action: "compound_refresh",
    result: { kind: "compound_refresh", previewDigest: "f".repeat(64), affectedPaths: ["docs/a.md"], creates: 0, updates: 1, deletes: 0, mutationApplied: false }
  }, "compound_refresh", "operation-1");
  assert.equal(refresh.result.mutationApplied, false);
  assert.throws(() => parseAutomationProviderResult({ ...refresh, action: "compound_capture" }, "compound_capture", "operation-1"), /schema|action/i);
  assert.throws(() => parseAutomationProviderResult({ ...refresh, result: { ...refresh.result, mutationApplied: true } }, "compound_refresh", "operation-1"), /mutation|result/i);
});
