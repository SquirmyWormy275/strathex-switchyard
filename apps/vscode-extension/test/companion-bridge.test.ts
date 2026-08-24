import assert from "node:assert/strict";
import test from "node:test";

import {
  JsonLineCompanionBridge,
  type ExtensionManagedSession,
  type JsonLineTransport
} from "../src/companion-bridge.ts";

const session: ExtensionManagedSession = {
  id: "vscode-window-1",
  provider: "generic",
  surface: "vscode_window",
  capabilities: ["registered"],
  status: "unknown",
  workspaceRoot: "C:/isolated/repo",
  plannedFiles: [],
  lastHeartbeat: "2026-08-23T00:00:00.000Z",
  adapterVersion: "test",
  metadata: {}
};

test("the VS Code JSON-lines client sends bounded companion methods and preserves matching responses", async () => {
  const seen: Array<{ id: string; method: string; payload: unknown }> = [];
  const transport: JsonLineTransport = {
    async request(line) {
      const request = JSON.parse(line) as { version: number; id: string; method: string; payload: unknown };
      seen.push({ id: request.id, method: request.method, payload: request.payload });
      if (request.method === "command.dispatch") {
        return JSON.stringify({ version: 1, id: request.id, ok: true, result: { command: { status: "unavailable", summary: "No mediated execution broker is attached." } } });
      }
      return JSON.stringify({ version: 1, id: request.id, ok: true, result: (request.payload as { session: ExtensionManagedSession }).session });
    }
  };
  const bridge = new JsonLineCompanionBridge(transport, "isolated-vscode");

  const registered = await bridge.registerSession(session);
  assert.equal(registered.ok, true);
  if (registered.ok) assert.equal(registered.value.id, session.id);

  const dispatched = await bridge.dispatch({ control: "RUN", modifier: "normal", sessionId: session.id });
  assert.equal(dispatched.ok, true);
  if (dispatched.ok) assert.equal(dispatched.value.status, "unavailable");
  assert.deepEqual(seen.map((entry) => entry.method), ["session.register", "command.dispatch"]);
  assert.equal(seen.every((entry) => entry.id.startsWith("isolated-vscode-")), true);
});

test("malformed or mismatched local-companion replies fail closed in the extension bridge", async () => {
  const malformed = new JsonLineCompanionBridge({ request: async () => "not json" });
  const malformedResult = await malformed.dispatch({ control: "RUN", modifier: "normal" });
  assert.equal(malformedResult.ok, false);
  if (!malformedResult.ok) assert.equal(malformedResult.code, "invalid_response");

  const mismatched = new JsonLineCompanionBridge({
    request: async () => JSON.stringify({ version: 1, id: "other-request", ok: true, result: {} })
  });
  const mismatchedResult = await mismatched.dispatch({ control: "RUN", modifier: "normal" });
  assert.equal(mismatchedResult.ok, false);
  if (!mismatchedResult.ok) assert.equal(mismatchedResult.code, "invalid_response");
});
