import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdtemp, realpath, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import type { VoiceProvider } from "../../../packages/control-plane/src/voice.ts";
import type {
  CanonicalVoiceContext,
  VoiceBindingScope,
  VoiceProviderTurnResult
} from "../src/voice-gateway.ts";
import {
  SafeUnavailableVoiceAudioPort,
  SafeUnavailableVoiceProviderPort,
  WindowsVoiceAudioPort,
  WindowsVoiceProviderPort,
  type WindowsVoiceHelperInvocation,
  type WindowsVoiceHelperTransport
} from "../src/windows-voice-port.ts";

const helperBody = "fixed voice helper";
const at = "2026-08-24T12:00:00.000Z";

const scope: VoiceBindingScope = {
  bindingId: "voice-binding-1",
  consentId: "voice-consent-1",
  voiceSessionId: "voice-session-1",
  managedSessionId: "managed-agent-1",
  repositoryRoot: "C:\\repo",
  targetSnapshotId: "a".repeat(64),
  contextPackageId: "handoff-1",
  contextDigest: "b".repeat(64),
  provider: "claude",
  operatorPresenceId: "presence-1",
  consentExpiresAt: "2026-08-24T12:15:00.000Z",
  transcript: "redacted"
};

const context: CanonicalVoiceContext = {
  schema: "sxsy-b122.voice-context",
  version: 1,
  packageId: scope.contextPackageId,
  digest: scope.contextDigest,
  repositoryRoot: scope.repositoryRoot,
  targetSnapshotId: scope.targetSnapshotId,
  taskId: "task-1",
  planRevision: "plan-1",
  plan: "Continue the reviewed task.",
  decisions: [],
  documentation: [],
  references: [],
  constraints: ["No authority widening."],
  openQuestions: [],
  nextActions: ["Run the next bounded step."],
  managedSessionId: scope.managedSessionId,
  executionAuthorized: false
};

class FakeTransport implements WindowsVoiceHelperTransport {
  readonly invocations: WindowsVoiceHelperInvocation[] = [];
  responder: (request: Record<string, unknown>) => Record<string, unknown> = (request) => response(request);

  async exchange(invocation: WindowsVoiceHelperInvocation, signal: AbortSignal): Promise<string> {
    assert.equal(signal.aborted, false);
    this.invocations.push(invocation);
    return JSON.stringify(this.responder(JSON.parse(invocation.requestLine) as Record<string, unknown>));
  }
}

function response(request: Record<string, unknown>, extra: Record<string, unknown> = {}): Record<string, unknown> {
  const requestScope = request.scope as Record<string, unknown>;
  return {
    schema: "sxsy-b122.voice-helper-response",
    version: 1,
    requestId: request.requestId,
    component: request.component,
    action: request.action,
    bindingId: requestScope.bindingId,
    targetSnapshotId: requestScope.targetSnapshotId,
    managedSessionId: requestScope.managedSessionId,
    provider: request.provider ?? null,
    status: "ok",
    ...extra
  };
}

async function fixture(context: test.TestContext): Promise<{ helperPath: string; helperSha256: string }> {
  const directory = await mkdtemp(join(tmpdir(), "b122-windows-voice-"));
  context.after(() => rm(directory, { recursive: true, force: true }));
  const helperPath = join(directory, "sxsy-b122-voice-helper.exe");
  await writeFile(helperPath, helperBody, "utf8");
  return { helperPath, helperSha256: createHash("sha256").update(helperBody).digest("hex") };
}

test("Windows audio and provider ports use exact routes, bounded frames, and a complete secret-free helper environment", async (testContext) => {
  const helper = await fixture(testContext);
  const transport = new FakeTransport();
  transport.responder = (request) => {
    if (request.action === "capture") {
      return response(request, {
        frames: [{ sequence: 0, capturedAt: at, sampleRateHz: 16_000, channels: 1, encoding: "pcm_s16le", dataBase64: "AQIDBA==" }]
      });
    }
    if (request.action === "provider_open") return response(request, { externalSessionId: "provider-session-1" });
    if (request.action === "respond") {
      return response(request, {
        externalSessionId: "provider-session-1",
        recognizedText: "bounded request",
        responseText: "bounded response"
      });
    }
    if (request.action === "observe") return response(request, { state: "active" });
    return response(request);
  };
  const shared = {
    ...helper,
    transport,
    hostEnvironment: {
      SystemRoot: "C:\\Windows",
      WINDIR: "C:\\Windows",
      PATH: "C:\\secret-tools",
      GH_TOKEN: "ghp_should_never_cross",
      OPENAI_API_KEY: "sk-should-never-cross"
    }
  };
  const audio = new WindowsVoiceAudioPort({ ...shared, routeId: "audio.winmm.current-user" });
  const provider = new WindowsVoiceProviderPort({
    ...shared,
    provider: "claude",
    routeId: "provider.claude.voice",
    authorizationReference: "credential-ref:claude-current-user"
  });
  const signal = new AbortController().signal;

  await audio.open(scope, signal);
  assert.deepEqual(await audio.capture(scope, signal), [{
    sequence: 0,
    capturedAt: at,
    sampleRateHz: 16_000,
    channels: 1,
    encoding: "pcm_s16le",
    data: Uint8Array.from([1, 2, 3, 4])
  }]);
  const externalSessionId = await provider.open(scope, context, signal);
  const turn = await provider.respond(scope, context, [{
    sequence: 0,
    capturedAt: at,
    sampleRateHz: 16_000,
    channels: 1,
    encoding: "pcm_s16le",
    data: Uint8Array.from([9, 8])
  }], signal);
  await audio.speak(scope, turn, signal);
  await audio.setMuted(scope, true, signal);
  await provider.interrupt(scope);
  assert.equal(await audio.observe(scope, signal), "active");
  assert.equal(await provider.observe(scope, signal), "active");
  await provider.close(scope);
  await provider.deleteTranscript(scope);
  await audio.deleteTranscript(scope);
  await audio.close(scope);

  assert.equal(externalSessionId, "provider-session-1");
  assert.equal(turn.responseText, "bounded response");
  assert.equal(transport.invocations.length, 13);
  for (const invocation of transport.invocations) {
    assert.equal(invocation.helperPath, await realpath(helper.helperPath));
    assert.equal(invocation.helperSha256, helper.helperSha256);
    assert.deepEqual(invocation.arguments, ["--stdio-v1"]);
    assert.deepEqual(invocation.environment, { SystemRoot: "C:\\Windows", WINDIR: "C:\\Windows" });
    assert.doesNotMatch(invocation.requestLine, /ghp_should|sk-should|secret-tools/);
  }
  const providerRequests = transport.invocations
    .map((invocation) => JSON.parse(invocation.requestLine) as Record<string, unknown>)
    .filter((request) => request.component === "provider");
  assert.equal(providerRequests.every((request) => request.provider === "claude"), true);
  assert.equal(providerRequests.every((request) => request.authorizationReference === "credential-ref:claude-current-user"), true);
  assert.deepEqual((providerRequests.find((request) => request.action === "respond")?.context as Record<string, unknown>).executionAuthorized, false);
});

test("provider replies are bound to the exact provider, target, session, and request with no fallback", async (testContext) => {
  const helper = await fixture(testContext);
  const transport = new FakeTransport();
  transport.responder = (request) => response(request, {
    provider: "chatgpt",
    externalSessionId: "provider-session-1"
  });
  const provider = new WindowsVoiceProviderPort({
    ...helper,
    transport,
    hostEnvironment: { SystemRoot: "C:\\Windows", WINDIR: "C:\\Windows" },
    provider: "claude",
    routeId: "provider.claude.voice",
    authorizationReference: "credential-ref:claude-current-user"
  });
  await assert.rejects(provider.open(scope, context, new AbortController().signal), /provider|exact|response/i);
  assert.equal(transport.invocations.length, 1);

  transport.responder = (request) => response(request, {
    targetSnapshotId: "f".repeat(64),
    externalSessionId: "provider-session-1"
  });
  await assert.rejects(provider.open(scope, context, new AbortController().signal), /target|exact|response/i);
});

test("the local speech boundary refuses unredacted response text even when called outside the gateway", async (testContext) => {
  const helper = await fixture(testContext);
  const transport = new FakeTransport();
  const audio = new WindowsVoiceAudioPort({
    ...helper,
    transport,
    hostEnvironment: { SystemRoot: "C:\\Windows", WINDIR: "C:\\Windows" },
    routeId: "audio.winmm.current-user"
  });
  await assert.rejects(audio.speak(scope, {
    externalSessionId: "provider-session-1",
    recognizedText: "",
    responseText: "Authorization: Bearer abcdefgh should not be spoken"
  }, new AbortController().signal), /redact|secret|spoken/i);
  assert.equal(transport.invocations.length, 0);
});

test("missing microphone routes and external credential references remain explicitly unavailable", async () => {
  const audio = new SafeUnavailableVoiceAudioPort("No reviewed Windows microphone route is installed.");
  const claude = new SafeUnavailableVoiceProviderPort("claude", "No current-user Claude credential reference is installed.");
  const chatgpt = new SafeUnavailableVoiceProviderPort("chatgpt", "No current-user ChatGPT credential reference is installed.");
  await assert.rejects(audio.open(scope, new AbortController().signal), /unavailable|microphone|route/i);
  await assert.rejects(claude.open(scope, context, new AbortController().signal), /unavailable|credential/i);
  await assert.rejects(chatgpt.open({ ...scope, provider: "chatgpt" }, context, new AbortController().signal), /unavailable|credential/i);
});

test("helper identity drift, cancellation, malformed base64, and oversized output fail closed", async (testContext) => {
  const helper = await fixture(testContext);
  const transport = new FakeTransport();
  const audio = new WindowsVoiceAudioPort({
    ...helper,
    transport,
    hostEnvironment: { SystemRoot: "C:\\Windows", WINDIR: "C:\\Windows" },
    routeId: "audio.winmm.current-user"
  });
  await writeFile(helper.helperPath, "tampered", "utf8");
  await assert.rejects(audio.open(scope, new AbortController().signal), /helper|digest|identity/i);
  assert.equal(transport.invocations.length, 0);

  await writeFile(helper.helperPath, helperBody, "utf8");
  transport.responder = (request) => response(request, {
    frames: [{ sequence: 0, capturedAt: at, sampleRateHz: 16_000, channels: 1, encoding: "pcm_s16le", dataBase64: "not base64!" }]
  });
  await assert.rejects(audio.capture(scope, new AbortController().signal), /base64|audio|frame/i);

  transport.responder = (request) => response(request, {
    frames: [{ sequence: 0, capturedAt: at, sampleRateHz: 16_000, channels: 1, encoding: "pcm_s16le", dataBase64: Buffer.alloc(64 * 1024 + 1).toString("base64") }]
  });
  await assert.rejects(audio.capture(scope, new AbortController().signal), /oversized|bounded|audio|frame/i);

  const controller = new AbortController();
  controller.abort();
  await assert.rejects(audio.open(scope, controller.signal), /cancel/i);
});
