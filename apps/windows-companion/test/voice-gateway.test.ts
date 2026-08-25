import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { HandoffPackageStore, type HandoffPackage } from "../../../packages/control-plane/src/context-packages.ts";
import { ProtectedJsonStore } from "../../../packages/control-plane/src/store.ts";
import { VoiceCoordinator, type VoiceProvider } from "../../../packages/control-plane/src/voice.ts";
import {
  HybridVoiceGateway,
  VoiceGatewayError,
  type CanonicalVoiceContext,
  type VoiceAudioFrame,
  type VoiceAudioPort,
  type VoiceBindingScope,
  type VoiceProviderPort,
  type VoiceProviderTurnResult
} from "../src/voice-gateway.ts";

const at = "2026-08-24T12:00:00.000Z";
const expiresAt = "2026-08-24T12:15:00.000Z";

class FakeAudioPort implements VoiceAudioPort {
  readonly calls: string[] = [];
  frames: readonly VoiceAudioFrame[] = [{
    sequence: 0,
    capturedAt: at,
    sampleRateHz: 16_000,
    channels: 1,
    encoding: "pcm_s16le",
    data: Uint8Array.from([1, 2, 3, 4])
  }];
  observation: "active" | "absent" = "active";

  async open(scope: VoiceBindingScope, signal: AbortSignal): Promise<void> {
    assert.equal(signal.aborted, false);
    this.calls.push(`open:${scope.bindingId}:${scope.consentId}`);
  }
  async capture(scope: VoiceBindingScope, signal: AbortSignal): Promise<readonly VoiceAudioFrame[]> {
    assert.equal(signal.aborted, false);
    this.calls.push(`capture:${scope.bindingId}`);
    return this.frames;
  }
  async speak(scope: VoiceBindingScope, response: VoiceProviderTurnResult, signal: AbortSignal): Promise<void> {
    assert.equal(signal.aborted, false);
    this.calls.push(`speak:${scope.bindingId}:${response.responseText}`);
  }
  async setMuted(scope: VoiceBindingScope, muted: boolean): Promise<void> { this.calls.push(`${muted ? "mute" : "resume"}:${scope.bindingId}`); }
  async interrupt(scope: VoiceBindingScope): Promise<void> { this.calls.push(`interrupt:${scope.bindingId}`); }
  async close(scope: VoiceBindingScope): Promise<void> { this.calls.push(`close:${scope.bindingId}`); }
  async deleteTranscript(scope: VoiceBindingScope): Promise<void> { this.calls.push(`delete:${scope.bindingId}`); }
  async observe(scope: VoiceBindingScope): Promise<"active" | "absent"> { this.calls.push(`observe:${scope.bindingId}`); return this.observation; }
}

class FakeProviderPort implements VoiceProviderPort {
  readonly calls: string[] = [];
  readonly provider: VoiceProvider;
  observation: "active" | "absent" = "active";
  beforeResponse?: () => Promise<void>;
  beforeDelete?: () => Promise<void>;
  deleteFailure?: Error;
  turn: VoiceProviderTurnResult = {
    externalSessionId: "provider-session-1",
    recognizedText: "Authorization: Bearer abcdefgh safe request",
    responseText: "token=supersecret completed safely"
  };

  constructor(provider: VoiceProvider) { this.provider = provider; }
  async open(scope: VoiceBindingScope, context: CanonicalVoiceContext, signal: AbortSignal): Promise<string> {
    assert.equal(signal.aborted, false);
    this.calls.push(`open:${scope.bindingId}:${context.digest}`);
    return "provider-session-1";
  }
  async respond(scope: VoiceBindingScope, context: CanonicalVoiceContext, frames: readonly VoiceAudioFrame[], signal: AbortSignal): Promise<VoiceProviderTurnResult> {
    assert.equal(signal.aborted, false);
    this.calls.push(`respond:${scope.bindingId}:${context.managedSessionId}:${frames.length}`);
    await this.beforeResponse?.();
    return this.turn;
  }
  async interrupt(scope: VoiceBindingScope): Promise<void> { this.calls.push(`interrupt:${scope.bindingId}`); }
  async close(scope: VoiceBindingScope): Promise<void> { this.calls.push(`close:${scope.bindingId}`); }
  async deleteTranscript(scope: VoiceBindingScope): Promise<void> { this.calls.push(`delete:${scope.bindingId}`); await this.beforeDelete?.(); if (this.deleteFailure) throw this.deleteFailure; }
  async observe(scope: VoiceBindingScope): Promise<"active" | "absent"> { this.calls.push(`observe:${scope.bindingId}`); return this.observation; }
}

async function fixture(
  context: test.TestContext,
  provider: VoiceProvider = "claude",
  transcript: "off" | "redacted" = "redacted"
): Promise<{
  voice: VoiceCoordinator;
  handoff: HandoffPackage;
  bindingId: string;
  audio: FakeAudioPort;
  route: FakeProviderPort;
  alternate: FakeProviderPort;
  sessionScope: { current: boolean };
  gateway: HybridVoiceGateway;
}> {
  const directory = await mkdtemp(join(tmpdir(), "b122-voice-gateway-"));
  context.after(() => rm(directory, { recursive: true, force: true }));
  const store = new ProtectedJsonStore({ filePath: join(directory, "journal.jsonl") });
  let id = 0;
  const handoffs = new HandoffPackageStore(store, { clock: () => at, idFactory: () => "handoff-1" });
  const handoff = await handoffs.create({
    repositoryRoot: "C:\\repo",
    targetSnapshotId: "a".repeat(64),
    taskId: "task-1",
    planRevision: "plan-7",
    authorityId: "authority-3",
    plan: "Preserve the reviewed target.",
    decisions: ["Use the canonical handoff."],
    documentation: ["docs/spec.md"],
    references: ["receipt-1"],
    constraints: ["No authority widening."],
    openQuestions: [],
    nextActions: ["Continue the bounded task."],
    recipientSessionId: "managed-agent-1"
  });
  const voice = new VoiceCoordinator(store, { clock: () => at, idFactory: () => `voice-${++id}` });
  const consent = await voice.grantConsent({
    repositoryRoot: handoff.repositoryRoot,
    targetSnapshotId: handoff.targetSnapshotId,
    contextPackageId: handoff.id,
    contextDigest: handoff.digest,
    provider,
    operatorPresenceId: "presence-1",
    transcript,
    retentionMinutes: transcript === "off" ? 0 : 10,
    expiresAt
  });
  const binding = await voice.start({ consentId: consent.id, voiceSessionId: "voice-session-1", managedSessionId: "managed-agent-1" });
  const audio = new FakeAudioPort();
  const route = new FakeProviderPort(provider);
  const alternate = new FakeProviderPort(provider === "claude" ? "chatgpt" : "claude");
  const sessionScope = { current: true };
  const gateway = new HybridVoiceGateway({
    voice,
    contexts: handoffs,
    audio,
    providers: [route, alternate],
    sessionScopeVerifier: { async assertCurrent() { if (!sessionScope.current) throw new Error("managed session changed"); } },
    now: () => at,
    defaultDeadlineMs: 1_000
  });
  return { voice, handoff, bindingId: binding.id, audio, route, alternate, sessionScope, gateway };
}

test("hybrid gateway injects the exact canonical context, bounds audio, speaks the exact response, and stores only redacted text", async (context) => {
  const setup = await fixture(context);
  const opened = await setup.gateway.open(setup.bindingId);
  assert.equal(opened.digest, setup.handoff.digest);
  assert.equal(opened.managedSessionId, "managed-agent-1");
  assert.equal(opened.executionAuthorized, false);

  const result = await setup.gateway.runTurn(setup.bindingId);
  assert.equal(result.externalSessionId, "provider-session-1");
  assert.deepEqual(setup.route.calls, [
    `open:${setup.bindingId}:${setup.handoff.digest}`,
    `respond:${setup.bindingId}:managed-agent-1:1`
  ]);
  assert.equal(setup.audio.calls.includes(`speak:${setup.bindingId}:[REDACTED] completed safely`), true);
  const transcript = await setup.voice.transcript(setup.bindingId);
  assert.equal(transcript.length, 2);
  assert.equal(transcript.every((entry) => !/abcdefgh|supersecret/.test(entry.text)), true);
});

test("provider selection is exact and never falls back when the consented route is unavailable", async (context) => {
  const setup = await fixture(context, "chatgpt");
  const wrong = new FakeProviderPort("claude");
  const gateway = new HybridVoiceGateway({
    voice: setup.voice,
    contexts: { get: async () => setup.handoff },
    audio: setup.audio,
    providers: [wrong],
    now: () => at
  });
  await assert.rejects(gateway.open(setup.bindingId), (error: unknown) => error instanceof VoiceGatewayError && error.code === "provider_unavailable");
  assert.deepEqual(wrong.calls, []);
  assert.deepEqual(setup.audio.calls, []);
});

test("explicit provider switch closes the old exact route and opens only the freshly consented route", async (context) => {
  const setup = await fixture(context);
  await setup.gateway.open(setup.bindingId);
  const consent = await setup.voice.grantConsent({
    repositoryRoot: setup.handoff.repositoryRoot,
    targetSnapshotId: setup.handoff.targetSnapshotId,
    contextPackageId: setup.handoff.id,
    contextDigest: setup.handoff.digest,
    provider: "chatgpt",
    operatorPresenceId: "presence-2",
    transcript: "redacted",
    retentionMinutes: 10,
    expiresAt
  });
  const switched = await setup.gateway.switchProvider(setup.bindingId, { consentId: consent.id, voiceSessionId: "voice-session-2" });
  assert.equal(switched.provider, "chatgpt");
  assert.equal(setup.route.calls.includes(`close:${setup.bindingId}`), true);
  assert.equal(setup.alternate.calls.some((call) => call.startsWith(`open:${switched.id}:`)), true);
  await setup.gateway.runTurn(switched.id);
  assert.equal(setup.alternate.calls.some((call) => call.startsWith(`respond:${switched.id}:`)), true);
  await setup.gateway.deleteTranscript(switched.id);
  assert.equal(setup.route.calls.includes(`delete:${setup.bindingId}`), true);
  assert.equal(setup.alternate.calls.includes(`delete:${switched.id}`), true);
  assert.deepEqual(await setup.voice.transcript(setup.bindingId), []);
  assert.deepEqual(await setup.voice.transcript(switched.id), []);
});

test("gateway blocks changed context or session state at the final response-routing barrier", async (context) => {
  const setup = await fixture(context);
  await setup.gateway.open(setup.bindingId);
  setup.route.beforeResponse = async () => { await setup.voice.bindManagedSession(setup.bindingId, "managed-agent-2"); };
  await assert.rejects(setup.gateway.runTurn(setup.bindingId), /changed|session|binding/i);
  assert.equal(setup.audio.calls.some((call) => call.startsWith("speak:")), false);
  assert.deepEqual(await setup.voice.transcript(setup.bindingId), []);
  assert.equal(setup.route.calls.some((call) => call.startsWith("interrupt:")), true);
});

test("mute, interruption, end, deletion, and deterministic restart reconciliation stay bound to one exact session", async (context) => {
  const setup = await fixture(context);
  await setup.gateway.open(setup.bindingId);
  await setup.gateway.mute(setup.bindingId);
  assert.equal((await setup.voice.getBinding(setup.bindingId))?.status, "muted");
  await setup.gateway.resume(setup.bindingId);
  await setup.gateway.interrupt(setup.bindingId, "operator requested interruption");
  assert.equal((await setup.voice.getBinding(setup.bindingId))?.status, "interrupted");
  await setup.gateway.resume(setup.bindingId);

  const restarted = new HybridVoiceGateway({
    voice: setup.voice,
    contexts: { get: async () => setup.handoff },
    audio: setup.audio,
    providers: [setup.route],
    now: () => at
  });
  assert.equal((await restarted.reconcile())?.bindingId, setup.bindingId);
  setup.route.observation = "absent";
  assert.equal(await restarted.reconcile(), undefined);
  assert.equal((await setup.voice.getBinding(setup.bindingId))?.status, "ended");
  await restarted.deleteTranscript(setup.bindingId);
  assert.deepEqual(await setup.voice.transcript(setup.bindingId), []);
  assert.equal(setup.audio.calls.includes(`delete:${setup.bindingId}`), true);
  assert.equal(setup.route.calls.includes(`delete:${setup.bindingId}`), true);
});

test("local transcript keys are destroyed even when an external provider cannot confirm deletion", async (context) => {
  const setup = await fixture(context);
  await setup.gateway.open(setup.bindingId);
  await setup.gateway.runTurn(setup.bindingId);
  setup.route.deleteFailure = new Error("provider unavailable");
  await assert.rejects(
    setup.gateway.deleteTranscript(setup.bindingId),
    (error: unknown) => error instanceof VoiceGatewayError && error.code === "deletion_incomplete"
  );
  assert.deepEqual(await setup.voice.transcript(setup.bindingId), []);
  assert.ok((await setup.voice.getBinding(setup.bindingId))?.transcriptDeletedAt);
});

test("local transcript keys are destroyed before a hung external deletion reaches its deadline", async (context) => {
  const setup = await fixture(context);
  await setup.gateway.open(setup.bindingId);
  await setup.gateway.runTurn(setup.bindingId);
  setup.route.beforeDelete = async () => new Promise<void>(() => undefined);
  await assert.rejects(
    setup.gateway.deleteTranscript(setup.bindingId, { deadlineMs: 20 }),
    (error: unknown) => error instanceof VoiceGatewayError && error.code === "deletion_incomplete"
  );
  assert.deepEqual(await setup.voice.transcript(setup.bindingId), []);
  assert.ok((await setup.voice.getBinding(setup.bindingId))?.transcriptDeletedAt);
});

test("live managed-session churn interrupts routing before speech or transcript persistence", async (context) => {
  const setup = await fixture(context);
  await setup.gateway.open(setup.bindingId);
  setup.route.beforeResponse = async () => { setup.sessionScope.current = false; };
  await assert.rejects(
    setup.gateway.runTurn(setup.bindingId),
    (error: unknown) => error instanceof VoiceGatewayError && error.code === "target_changed"
  );
  assert.equal(setup.audio.calls.some((call) => call.startsWith("speak:")), false);
  assert.deepEqual(await setup.voice.transcript(setup.bindingId), []);
});

test("restart recovery preserves muted state without starting a turn loop", async (context) => {
  const setup = await fixture(context);
  await setup.gateway.open(setup.bindingId);
  await setup.gateway.mute(setup.bindingId);
  const restarted = new HybridVoiceGateway({
    voice: setup.voice,
    contexts: { get: async () => setup.handoff },
    audio: setup.audio,
    providers: [setup.route],
    sessionScopeVerifier: { async assertCurrent() {} },
    now: () => at
  });
  assert.equal(await restarted.reconcile(), undefined);
  assert.equal((await setup.voice.getBinding(setup.bindingId))?.status, "muted");
  const resumed = await restarted.resume(setup.bindingId);
  assert.equal(resumed.status, "active");
});

test("oversized frames and expired deadlines fail closed without reaching or falling back to a provider", async (context) => {
  const setup = await fixture(context);
  await setup.gateway.open(setup.bindingId);
  setup.audio.frames = [{
    sequence: 0,
    capturedAt: at,
    sampleRateHz: 16_000,
    channels: 1,
    encoding: "pcm_s16le",
    data: new Uint8Array(64 * 1024 + 1)
  }];
  await assert.rejects(setup.gateway.runTurn(setup.bindingId), /audio|frame|bounded|oversized/i);
  assert.equal(setup.route.calls.some((call) => call.startsWith("respond:")), false);

  const controller = new AbortController();
  controller.abort();
  await assert.rejects(setup.gateway.runTurn(setup.bindingId, { signal: controller.signal }), /cancel|deadline/i);

  setup.audio.frames = [{ sequence: 0, capturedAt: at, sampleRateHz: 16_000, channels: 1, encoding: "pcm_s16le", data: Uint8Array.from([1, 2]) }];
  setup.route.beforeResponse = async () => new Promise<void>(() => undefined);
  await assert.rejects(
    setup.gateway.runTurn(setup.bindingId, { deadlineMs: 20 }),
    (error: unknown) => error instanceof VoiceGatewayError && error.code === "deadline"
  );
});
