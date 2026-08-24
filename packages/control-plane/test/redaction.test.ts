import assert from "node:assert/strict";
import test from "node:test";
import { redactRecord, redactText, untrustedSummary } from "../src/redaction.ts";

test("redacts credentials and production DSNs before they can enter audit text", () => {
  const value = redactText("token=gho_abcdefghi postgres://prod:pass@db.example/app");
  assert.doesNotMatch(value, /gho_|postgres:/i);
  assert.match(value, /\[REDACTED\]/);
});

test("redacts sensitive record fields and makes untrusted output display-safe", () => {
  const record = redactRecord({ apiKey: "secret", note: "hello\nworld", ordinary: 3 });
  assert.equal(record.apiKey, "[REDACTED]");
  assert.equal(record.ordinary, 3);
  assert.equal(untrustedSummary("one\ntwo\tthree"), "one two three");
});
