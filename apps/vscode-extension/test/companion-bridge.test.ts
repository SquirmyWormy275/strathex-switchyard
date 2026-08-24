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
      if (request.method === "command.prepare") {
        return JSON.stringify({ version: 1, id: request.id, ok: true, result: { preparation: { status: "prepared", summary: "Exact scope prepared.", authorityId: "authority" } } });
      }
      if (request.method === "git.review.submit") {
        return JSON.stringify({ version: 1, id: request.id, ok: true, result: { review: { status: "approved", summary: "Exact Git mutation reviewed." } } });
      }
      return JSON.stringify({ version: 1, id: request.id, ok: true, result: (request.payload as { session: ExtensionManagedSession }).session });
    }
  };
  const bridge = new JsonLineCompanionBridge(transport, "isolated-vscode");

  const registered = await bridge.registerSession(session);
  assert.equal(registered.ok, true);
  if (registered.ok) assert.equal(registered.value.id, session.id);

  const prepared = await bridge.prepareCommand({ control: "RUN", modifier: "normal", sessionId: session.id, reason: "operator requested run" });
  assert.equal(prepared.ok, true);
  if (prepared.ok) assert.equal(prepared.value.authorityId, "authority");

  const reviewed = await bridge.reviewGitMutation({ action: "local_commit", sessionId: session.id, mutation: { kind: "local_commit", paths: ["src/safe.ts"], message: "safe" } });
  assert.equal(reviewed.ok, true);
  if (reviewed.ok) assert.equal(reviewed.value.status, "approved");

  const dispatched = await bridge.dispatch({ control: "RUN", modifier: "normal", sessionId: session.id });
  assert.equal(dispatched.ok, true);
  if (dispatched.ok) assert.equal(dispatched.value.status, "unavailable");
  assert.deepEqual(seen.map((entry) => entry.method), ["session.register", "command.prepare", "git.review.submit", "command.dispatch"]);
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

test("hardware bridge never sends a client-selected chord and carries the server dispatch receipt into completion", async () => {
  const seen: Array<{ method: string; payload: Record<string, unknown> | undefined }> = [];
  const signalId = `hardware-signal:${"a".repeat(64)}`;
  const claimToken = "claim-token-bridge";
  const dispatchReceiptId = `hardware-dispatch:${"b".repeat(64)}`;
  const bridge = new JsonLineCompanionBridge({
    async request(line) {
      const request = JSON.parse(line) as { id: string; method: string; payload?: Record<string, unknown> };
      seen.push({ method: request.method, payload: request.payload });
      if (request.method === "hardware-signal.claim") return JSON.stringify({ version: 1, id: request.id, ok: true, result: { claim: { signalId, claimToken, deviceId: "c".repeat(64), connectionEpoch: 1, bootNonce: 2, counter: 3, control: "SHIELD", modifier: "normal", acceptedAt: "2026-08-24T00:00:00.000Z", claimedAt: "2026-08-24T00:00:01.000Z", attempt: 1, windowSessionId: session.id, workspaceRoots: ["C:/isolated/repo"] } } });
      if (request.method === "hardware-signal.prepare") return JSON.stringify({ version: 1, id: request.id, ok: true, result: { preparation: { status: "prepared", summary: "prepared", authorityId: "authority" } } });
      if (request.method === "hardware-signal.dispatch") return JSON.stringify({ version: 1, id: request.id, ok: true, result: { command: { status: "completed", summary: "handled" }, dispatchReceiptId } });
      if (request.method === "hardware-signal.complete") return JSON.stringify({ version: 1, id: request.id, ok: true, result: { completion: { signalId, outcome: "handled" } } });
      return JSON.stringify({ version: 1, id: request.id, ok: false, error: { code: "unknown_method", message: "unexpected" } });
    }
  });
  const claim = await bridge.claimHardwareSignal({ windowSessionId: session.id, workspaceRoots: ["C:/isolated/repo"], focused: true });
  assert.equal(claim.ok, true);
  assert.ok(claim.ok && claim.value);
  if (!claim.ok || !claim.value) return;
  const prepared = await bridge.prepareHardwareSignal(claim.value, session.id, "Focused physical chord");
  assert.equal(prepared.ok, true);
  const dispatched = await bridge.dispatchHardwareSignal(claim.value, { sessionId: session.id, authorityId: "authority" });
  assert.equal(dispatched.ok, true);
  if (!dispatched.ok) return;
  await bridge.completeHardwareSignal(claim.value, { outcome: "handled", summary: "Mediated dispatch returned.", dispatchReceiptId: dispatched.value.dispatchReceiptId, dispatchSessionId: session.id, repositoryRoot: "C:/isolated/repo" });

  const dispatchPayload = seen.find((entry) => entry.method === "hardware-signal.dispatch")?.payload;
  assert.equal("control" in (dispatchPayload ?? {}), false);
  assert.equal("modifier" in (dispatchPayload ?? {}), false);
  assert.equal(seen.find((entry) => entry.method === "hardware-signal.complete")?.payload?.dispatchReceiptId, dispatchReceiptId);
});

test("Raw-HID and hardware response schemas fail closed on malformed or mismatched durable identities", async () => {
  const signalId = `hardware-signal:${"a".repeat(64)}`;
  const claimToken = "claim-token-schema";
  let responseKind: "bad-claim" | "bad-dispatch" | "bad-completion" | "bad-list" = "bad-claim";
  const bridge = new JsonLineCompanionBridge({
    async request(line) {
      const request = JSON.parse(line) as { id: string; method: string };
      const result = responseKind === "bad-claim"
        ? { claim: { signalId, claimToken, deviceId: "c".repeat(64), connectionEpoch: 1, bootNonce: 2, counter: 3, control: "NOT_A_CHORD", modifier: "normal", acceptedAt: "2026-08-24T00:00:00.000Z", claimedAt: "2026-08-24T00:00:01.000Z", attempt: 1, windowSessionId: session.id, workspaceRoots: ["C:/isolated/repo"] } }
        : responseKind === "bad-dispatch"
          ? { command: { status: "completed", summary: "handled" }, dispatchReceiptId: "client-forged" }
          : responseKind === "bad-completion"
            ? { completion: { signalId: `hardware-signal:${"d".repeat(64)}`, outcome: "handled" } }
            : { installations: {} };
      return JSON.stringify({ version: 1, id: request.id, ok: true, result });
    }
  });

  const malformedClaim = await bridge.claimHardwareSignal({ windowSessionId: session.id, workspaceRoots: ["C:/isolated/repo"], focused: true });
  assert.equal(malformedClaim.ok, false);
  if (!malformedClaim.ok) assert.equal(malformedClaim.code, "invalid_response");

  const claim = { signalId, claimToken, deviceId: "c".repeat(64), connectionEpoch: 1, bootNonce: 2, counter: 3, control: "SHIELD", modifier: "normal", acceptedAt: "2026-08-24T00:00:00.000Z", claimedAt: "2026-08-24T00:00:01.000Z", attempt: 1, windowSessionId: session.id, workspaceRoots: ["C:/isolated/repo"] } as const;
  responseKind = "bad-dispatch";
  const malformedDispatch = await bridge.dispatchHardwareSignal(claim, { sessionId: session.id });
  assert.equal(malformedDispatch.ok, false);
  responseKind = "bad-completion";
  const mismatchedCompletion = await bridge.completeHardwareSignal(claim, { outcome: "handled", summary: "done", dispatchReceiptId: `hardware-dispatch:${"b".repeat(64)}` });
  assert.equal(mismatchedCompletion.ok, false);
  responseKind = "bad-list";
  const malformedList = await bridge.listRawHid();
  assert.equal(malformedList.ok, false);
});
