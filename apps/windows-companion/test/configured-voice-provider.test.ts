import assert from "node:assert/strict";
import test from "node:test";

import type { ConfiguredNetworkResult } from "../src/configured-network.ts";
import { ConfiguredVoiceProviderPort } from "../src/configured-voice-provider.ts";
import { VoiceGatewayError, type CanonicalVoiceContext, type VoiceBindingScope } from "../src/voice-gateway.ts";

const scope: VoiceBindingScope = {
  bindingId: "binding-1", consentId: "consent-1", voiceSessionId: "voice-session-1", managedSessionId: "managed-1",
  repositoryRoot: "C:\\repo", targetSnapshotId: "a".repeat(64), contextPackageId: "context-1", contextDigest: "b".repeat(64),
  provider: "claude", operatorPresenceId: "presence-1", consentExpiresAt: "2099-01-01T00:00:00.000Z", transcript: "redacted"
};
const context: CanonicalVoiceContext = {
  schema: "sxsy-b122.voice-context", version: 1, packageId: scope.contextPackageId, digest: scope.contextDigest,
  repositoryRoot: scope.repositoryRoot, targetSnapshotId: scope.targetSnapshotId, taskId: "task-1", planRevision: "plan-1",
  plan: "Continue the exact plan.", decisions: [], documentation: [], references: [], constraints: [], openQuestions: [], nextActions: [],
  managedSessionId: scope.managedSessionId, executionAuthorized: false
};

class Network {
  readonly requests: { routeId: string; body?: string | Uint8Array }[] = [];
  extra = false;
  fail = false;
  async request(input: { routeId: string; body?: string | Uint8Array }): Promise<ConfiguredNetworkResult> {
    this.requests.push(input);
    if (this.fail) return { outcome: "blocked", routeId: input.routeId, detail: "contained", effectDisposition: "not_started" };
    const action = input.routeId.split(".").at(-1)!;
    const base: Record<string, unknown> = {
      schema: "sxsy-b122.configured-voice-provider-response", version: 1, action, provider: "claude", bindingId: scope.bindingId,
      voiceSessionId: scope.voiceSessionId, managedSessionId: scope.managedSessionId, targetSnapshotId: scope.targetSnapshotId, status: "ok"
    };
    if (action === "open") base.externalSessionId = scope.voiceSessionId;
    if (action === "respond") Object.assign(base, { externalSessionId: scope.voiceSessionId, recognizedText: "request", responseText: "response" });
    if (action === "observe") base.state = "active";
    if (this.extra) base.untrusted = true;
    return { outcome: "passed", routeId: input.routeId, detail: "ok", effectDisposition: "ambiguous", body: Buffer.from(JSON.stringify(base)) };
  }
}

test("configured voice provider uses exact-route network mediation and strict scope-bound responses", async () => {
  const network = new Network();
  const port = new ConfiguredVoiceProviderPort("claude", network);
  const signal = new AbortController().signal;
  assert.equal(await port.open(scope, context, signal), scope.voiceSessionId);
  assert.deepEqual(await port.respond(scope, context, [{ sequence: 0, capturedAt: "2026-08-25T00:00:00.000Z", sampleRateHz: 16_000, channels: 1, encoding: "pcm_s16le", data: Uint8Array.from([1, 2]) }], signal), {
    externalSessionId: scope.voiceSessionId, recognizedText: "request", responseText: "response", spokenAudio: []
  });
  assert.equal(await port.observe(scope, signal), "active");
  await port.interrupt(scope, signal);
  await port.close(scope, signal);
  await port.deleteTranscript(scope, signal);
  assert.deepEqual(network.requests.map((request) => request.routeId), [
    "voice.claude.open", "voice.claude.respond", "voice.claude.observe", "voice.claude.interrupt", "voice.claude.close", "voice.claude.delete_transcript"
  ]);
  const respond = JSON.parse(String(network.requests[1]!.body)) as { frames: { dataBase64: string }[]; context: { executionAuthorized: boolean } };
  assert.equal(respond.frames[0]!.dataBase64, "AQI=");
  assert.equal(respond.context.executionAuthorized, false);
});

test("configured voice provider rejects unavailable routes and non-exact provider responses", async () => {
  const network = new Network();
  const port = new ConfiguredVoiceProviderPort("claude", network);
  network.extra = true;
  await assert.rejects(port.open(scope, context, new AbortController().signal), (error: unknown) => error instanceof VoiceGatewayError && error.code === "provider_invalid");
  network.extra = false;
  network.fail = true;
  await assert.rejects(port.open(scope, context, new AbortController().signal), (error: unknown) => error instanceof VoiceGatewayError && error.code === "provider_unavailable");
  assert.equal(network.requests.length, 2);
});
