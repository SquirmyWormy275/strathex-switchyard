import assert from "node:assert/strict";
import test from "node:test";
import { PassThrough } from "node:stream";
import { CompanionService } from "../src/service.ts";
import { handleJsonLine, serveJsonLines } from "../src/stdio.ts";

test("JSON-lines handler replies to valid requests and keeps malformed input non-fatal", async () => {
  const service = new CompanionService({ now: () => "2026-08-23T00:00:00.000Z", idFactory: () => "audit" });
  const pong = await handleJsonLine('{"version":1,"id":"ping-1","method":"ping"}', service);
  assert.deepEqual(pong, { version: 1, id: "ping-1", ok: true, result: { state: "ready", version: 1 } });

  const malformed = await handleJsonLine("{not-json", service);
  assert.equal(malformed?.ok, false);
  assert.equal(malformed?.id, "invalid");
  assert.equal(malformed?.error?.code, "invalid_request");

  const unsupported = await handleJsonLine('{"version":99,"id":"old","method":"ping"}', service);
  assert.equal(unsupported?.ok, false);
  assert.equal(unsupported?.error?.code, "unsupported_version");

  assert.equal(await handleJsonLine("   ", service), undefined);
});

test("stdio server preserves one response per request and never opens a network listener", async () => {
  const input = new PassThrough();
  const output = new PassThrough();
  const chunks: Buffer[] = [];
  output.on("data", (chunk: Buffer) => chunks.push(chunk));
  const service = new CompanionService({ now: () => "2026-08-23T00:00:00.000Z", idFactory: () => "audit" });

  const serving = serveJsonLines(input, output, service);
  input.end([
    '{"version":1,"id":"one","method":"ping"}',
    '{"version":1,"id":"two","method":"command.dispatch","payload":{"control":"COMMIT","modifier":"alt"}}'
  ].join("\n") + "\n");
  await serving;

  const responses = Buffer.concat(chunks).toString("utf8").trim().split("\n").map((line) => JSON.parse(line) as { id: string; ok: boolean; result?: { command?: { status?: string } } });
  assert.equal(responses.length, 2);
  assert.deepEqual(responses[0], { version: 1, id: "one", ok: true, result: { state: "ready", version: 1 } });
  assert.equal(responses[1].id, "two");
  assert.equal(responses[1].ok, true);
  assert.equal(responses[1].result?.command?.status, "blocked");
});
