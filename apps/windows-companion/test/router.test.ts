import assert from "node:assert/strict";
import test from "node:test";
import { encodeSignal, protocolVersion } from "../../../packages/protocol/src/b122.ts";
import { ControlRouter } from "../src/router.ts";

const packet = (control: Parameters<typeof encodeSignal>[0]["control"], modifier: Parameters<typeof encodeSignal>[0]["modifier"], sequence: number) =>
  encodeSignal({ version: protocolVersion, control, modifier, sequence });

test("a managed session cannot execute a mediation-required request", () => {
  const router = new ControlRouter();
  const intent = router.route(packet("PROOF", "normal", 1), { deviceId: "B122-A", connectionId: "one", sessionState: "managed" });
  assert.equal(intent.status, "requires_mediation");
});

test("every non-mediated session is denied a mediation-required request", () => {
  for (const sessionState of ["registered", "observable", "managed"] as const) {
    const router = new ControlRouter();
    assert.equal(router.route(packet("PROOF", "normal", 1), { deviceId: sessionState, connectionId: "connection-1", sessionState }).status, "requires_mediation");
  }
});

test("a mediated request is still preview-only in the baseline", () => {
  const router = new ControlRouter();
  const intent = router.route(packet("PROOF", "normal", 1), { deviceId: "B122-A", connectionId: "one", sessionState: "mediated" });
  assert.equal(intent.status, "preview_only");
  assert.match(intent.reason, /executes no external action/i);
});

test("high-consequence chords stay disabled even for mediated sessions", () => {
  const router = new ControlRouter();
  const intent = router.route(packet("COMMIT", "alt", 1), { deviceId: "B122-A", connectionId: "one", sessionState: "mediated" });
  assert.equal(intent.status, "disabled_pending_acceptance_gates");
});

test("router rejects repeated or stale packets but accepts sequence rollover", () => {
  const router = new ControlRouter();
  const context = { deviceId: "B122-A", connectionId: "one", sessionState: "mediated" } as const;
  assert.equal(router.route(packet("VSCODE", "normal", 65535), context).status, "preview_only");
  assert.equal(router.route(packet("VSCODE", "normal", 0), context).status, "preview_only");
  assert.equal(router.route(packet("VSCODE", "normal", 0), context).status, "rejected");
});

test("forgetting a disconnected device releases only its replay state", () => {
  const router = new ControlRouter();
  const context = { deviceId: "B122-disconnected", connectionId: "one", sessionState: "mediated" } as const;
  assert.equal(router.route(packet("VSCODE", "normal", 4), context).status, "preview_only");
  router.forgetDevice(context.deviceId);
  assert.equal(router.route(packet("VSCODE", "normal", 4), context).status, "preview_only");
});

test("a new connection epoch accepts a restarted firmware sequence", () => {
  const router = new ControlRouter();
  assert.equal(router.route(packet("VSCODE", "normal", 4), { deviceId: "B122-A", connectionId: "first", sessionState: "mediated" }).status, "preview_only");
  assert.equal(router.route(packet("VSCODE", "normal", 0), { deviceId: "B122-A", connectionId: "after-reconnect", sessionState: "mediated" }).status, "preview_only");
});

test("router isolates devices and rejects an ambiguous half-range sequence", () => {
  const router = new ControlRouter();
  assert.equal(router.route(packet("VSCODE", "normal", 0), { deviceId: "B122-A", connectionId: "a", sessionState: "mediated" }).status, "preview_only");
  assert.equal(router.route(packet("VSCODE", "normal", 0), { deviceId: "B122-B", connectionId: "b", sessionState: "mediated" }).status, "preview_only");
  assert.equal(router.route(packet("VSCODE", "normal", 0x8000), { deviceId: "B122-A", connectionId: "a", sessionState: "mediated" }).status, "rejected");
});

test("router preserves bad packets and intentionally unassigned chords as non-preview intents", () => {
  const router = new ControlRouter();
  const context = { deviceId: "B122-A", connectionId: "a", sessionState: "mediated" } as const;
  assert.equal(router.route(new Uint8Array(8), context).status, "rejected");
  assert.equal(router.route(packet("REANCHOR", "ctrl", 1), context).status, "unassigned");
});
