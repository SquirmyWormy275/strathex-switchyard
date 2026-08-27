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

test("recursively redacts current provider tokens, authorization headers, DSNs, and credentialed URLs", () => {
  const nested = redactRecord({
    provider: {
      openai: "sk-proj-abcdefghijklmnopqrstuvwxyz",
      anthropic: "sk-ant-abcdefghijklmnopqrstuvwxyz",
      github: ["github_pat_abcdefghijklmnopqrstuvwxyz", { Authorization: "Bearer abcdefghijklmnopqrstuvwxyz" }]
    },
    url: "https://person:hunter2@example.invalid/path",
    jwt: "eyJabcdefghijk.eyJabcdefghijk.abcdefghijk"
  });
  const serialized = JSON.stringify(nested);
  assert.doesNotMatch(serialized, /sk-proj|sk-ant|github_pat|Bearer|hunter2|eyJabcdefghijk/);
  assert.match(serialized, /REDACTED/);
});

test("recursive redaction is cycle, depth, and size bounded", () => {
  const cyclic: Record<string, unknown> = {};
  cyclic.self = cyclic;
  let deep: Record<string, unknown> = { token: "secret" };
  for (let index = 0; index < 10; index += 1) deep = { next: deep };
  const value = redactRecord({ cyclic, deep });
  assert.match(JSON.stringify(value), /REDACTED:(?:CYCLE|DEPTH)/);
});
