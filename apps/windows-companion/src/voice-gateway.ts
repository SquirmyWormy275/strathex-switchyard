import { resolve } from "node:path";

import type { HandoffPackage } from "../../../packages/control-plane/src/context-packages.ts";
import { redactText } from "../../../packages/control-plane/src/redaction.ts";
import { sha256, stableJson } from "../../../packages/control-plane/src/store.ts";
import {
  VoiceCoordinator,
  type VoiceBinding,
  type VoiceConsent,
  type VoiceProvider,
  type VoiceTranscriptPolicy
} from "../../../packages/control-plane/src/voice.ts";

const maximumFrameBytes = 64 * 1024;
const maximumTurnBytes = 1024 * 1024;
const maximumFrames = 256;
const maximumContextBytes = 64 * 1024;
const maximumResponseText = 4_096;

export type VoiceGatewayErrorCode =
  | "audio_invalid"
  | "busy"
  | "cancelled"
  | "consent_invalid"
  | "deletion_incomplete"
  | "deadline"
  | "effect_blocked"
  | "no_input"
  | "no_binding"
  | "provider_invalid"
  | "provider_unavailable"
  | "target_changed";

export class VoiceGatewayError extends Error {
  readonly code: VoiceGatewayErrorCode;

  constructor(code: VoiceGatewayErrorCode, message: string) {
    super(message);
    this.name = "VoiceGatewayError";
    this.code = code;
  }
}

export interface VoiceContextSource {
  get(id: string): Promise<HandoffPackage | undefined>;
}

export interface VoiceSessionScopeVerifier {
  assertCurrent(scope: VoiceBindingScope, context: CanonicalVoiceContext): Promise<void>;
}

export type VoiceEffect =
  | "audio_open" | "audio_capture" | "audio_speak" | "audio_mute" | "audio_resume"
  | "audio_interrupt" | "audio_close" | "audio_delete" | "audio_observe"
  | "provider_open" | "provider_respond" | "provider_interrupt" | "provider_close"
  | "provider_delete" | "provider_observe";

export interface VoiceEffectGuard {
  assertAllowed(input: Readonly<{ scope: VoiceBindingScope; effect: VoiceEffect; remediation: boolean }>): Promise<void>;
}

/** Canonical, non-authorizing context injected on every provider turn. */
export interface CanonicalVoiceContext {
  readonly schema: "sxsy-b122.voice-context";
  readonly version: 1;
  readonly packageId: string;
  readonly digest: string;
  readonly repositoryRoot: string;
  readonly targetSnapshotId: string;
  readonly taskId: string;
  readonly planRevision: string;
  readonly authorityId?: string;
  readonly plan: string;
  readonly decisions: readonly string[];
  readonly documentation: readonly string[];
  readonly references: readonly string[];
  readonly constraints: readonly string[];
  readonly openQuestions: readonly string[];
  readonly nextActions: readonly string[];
  readonly managedSessionId: string;
  readonly executionAuthorized: false;
}

export interface VoiceBindingScope {
  readonly bindingId: string;
  readonly consentId: string;
  readonly voiceSessionId: string;
  readonly managedSessionId: string;
  readonly repositoryRoot: string;
  readonly targetSnapshotId: string;
  readonly contextPackageId: string;
  readonly contextDigest: string;
  readonly provider: VoiceProvider;
  readonly operatorPresenceId: string;
  readonly consentExpiresAt: string;
  readonly transcript: VoiceTranscriptPolicy;
}

export interface VoiceAudioFrame {
  readonly sequence: number;
  readonly capturedAt: string;
  readonly sampleRateHz: 8_000 | 16_000 | 24_000 | 48_000;
  readonly channels: 1 | 2;
  readonly encoding: "pcm_s16le";
  readonly data: Uint8Array;
}

export interface VoiceSpokenAudio {
  readonly encoding: "pcm_s16le";
  readonly sampleRateHz: 8_000 | 16_000 | 24_000 | 48_000;
  readonly channels: 1 | 2;
  readonly data: Uint8Array;
}

export interface VoiceProviderTurnResult {
  readonly externalSessionId: string;
  readonly recognizedText: string;
  readonly responseText: string;
  /** Optional fixed-format audio. Gateways may discard it and synthesize redacted responseText locally. */
  readonly spokenAudio?: readonly VoiceSpokenAudio[];
}

export type VoicePortObservation = "active" | "absent";

export interface VoiceAudioPort {
  open(scope: VoiceBindingScope, signal: AbortSignal): Promise<void>;
  capture(scope: VoiceBindingScope, signal: AbortSignal): Promise<readonly VoiceAudioFrame[]>;
  /** Implementations speak responseText after gateway redaction. */
  speak(scope: VoiceBindingScope, response: VoiceProviderTurnResult, signal: AbortSignal): Promise<void>;
  setMuted(scope: VoiceBindingScope, muted: boolean, signal?: AbortSignal): Promise<void>;
  interrupt(scope: VoiceBindingScope, signal?: AbortSignal): Promise<void>;
  close(scope: VoiceBindingScope, signal?: AbortSignal): Promise<void>;
  deleteTranscript(scope: VoiceBindingScope, signal?: AbortSignal): Promise<void>;
  observe(scope: VoiceBindingScope, signal?: AbortSignal): Promise<VoicePortObservation>;
}

export interface VoiceProviderPort {
  readonly provider: VoiceProvider;
  open(scope: VoiceBindingScope, context: CanonicalVoiceContext, signal: AbortSignal): Promise<string>;
  respond(
    scope: VoiceBindingScope,
    context: CanonicalVoiceContext,
    frames: readonly VoiceAudioFrame[],
    signal: AbortSignal
  ): Promise<VoiceProviderTurnResult>;
  interrupt(scope: VoiceBindingScope, signal?: AbortSignal): Promise<void>;
  close(scope: VoiceBindingScope, signal?: AbortSignal): Promise<void>;
  deleteTranscript(scope: VoiceBindingScope, signal?: AbortSignal): Promise<void>;
  observe(scope: VoiceBindingScope, signal?: AbortSignal): Promise<VoicePortObservation>;
}

export interface HybridVoiceGatewayOptions {
  readonly voice: VoiceCoordinator;
  readonly contexts: VoiceContextSource;
  readonly audio: VoiceAudioPort;
  readonly providers: readonly VoiceProviderPort[];
  readonly sessionScopeVerifier?: VoiceSessionScopeVerifier;
  readonly effectGuard?: VoiceEffectGuard;
  readonly now?: () => string;
  readonly defaultDeadlineMs?: number;
}

interface ExactVoiceState {
  readonly binding: VoiceBinding;
  readonly consent: VoiceConsent;
  readonly scope: VoiceBindingScope;
  readonly context: CanonicalVoiceContext;
}

interface RuntimeBinding extends ExactVoiceState {
  readonly providerPort: VoiceProviderPort;
  readonly externalSessionId: string;
}

interface ActiveTurn {
  readonly bindingId: string;
  readonly controller: AbortController;
}

/**
 * Provider-neutral hybrid coordinator. It owns exact context injection and
 * privacy/state barriers while Windows ports own microphone, speech, and the
 * provider-specific external route.
 */
export class HybridVoiceGateway {
  private readonly voice: VoiceCoordinator;
  private readonly contexts: VoiceContextSource;
  private readonly audio: VoiceAudioPort;
  private readonly providers = new Map<VoiceProvider, VoiceProviderPort>();
  private readonly sessionScopeVerifier?: VoiceSessionScopeVerifier;
  private readonly effectGuard?: VoiceEffectGuard;
  private readonly now: () => string;
  private readonly defaultDeadlineMs: number;
  private runtime?: RuntimeBinding;
  private activeTurn?: ActiveTurn;

  constructor(options: HybridVoiceGatewayOptions) {
    this.voice = options.voice;
    this.contexts = options.contexts;
    this.audio = options.audio;
    this.now = options.now ?? (() => new Date().toISOString());
    this.defaultDeadlineMs = deadline(options.defaultDeadlineMs ?? 30_000);
    this.sessionScopeVerifier = options.sessionScopeVerifier;
    this.effectGuard = options.effectGuard;
    for (const provider of options.providers) {
      if (this.providers.has(provider.provider)) {
        throw new VoiceGatewayError("provider_invalid", `Duplicate voice provider route: ${provider.provider}`);
      }
      this.providers.set(provider.provider, provider);
    }
  }

  async open(bindingId: string, options: Readonly<{ signal?: AbortSignal; deadlineMs?: number }> = {}): Promise<CanonicalVoiceContext> {
    if (this.activeTurn) throw new VoiceGatewayError("busy", "A voice turn is already in progress.");
    const exact = await this.exactState(bindingId, "active");
    if (this.runtime) {
      if (sameScope(this.runtime.scope, exact.scope)) return cloneContext(this.runtime.context);
      throw new VoiceGatewayError("busy", "A different voice runtime is already active.");
    }
    const providerPort = this.exactProvider(exact.scope.provider);
    const controller = linkedController(options.signal, options.deadlineMs ?? this.defaultDeadlineMs);
    let audioOpened = false;
    try {
      if (controller.signal.aborted) throw abortError(controller);
      await this.assertEffectAllowed(exact.scope, "audio_open");
      await raced(this.audio.open(exact.scope, controller.signal), controller);
      audioOpened = true;
      await this.assertEffectAllowed(exact.scope, "provider_open");
      const externalSessionId = boundedIdentifier(
        await raced(providerPort.open(exact.scope, exact.context, controller.signal), controller),
        "provider voice session"
      );
      const final = await this.exactState(bindingId, "active");
      if (!sameScope(exact.scope, final.scope) || final.context.digest !== exact.context.digest) {
        throw new VoiceGatewayError("target_changed", "The exact voice target or session changed before provider startup completed.");
      }
      this.runtime = { ...final, providerPort, externalSessionId };
      return cloneContext(final.context);
    } catch (error) {
      if (audioOpened) await this.remediate(exact.scope, "audio_close", () => this.audio.close(exact.scope));
      await this.remediate(exact.scope, "provider_close", () => providerPort.close(exact.scope));
      throw normalizeAbort(error, controller);
    } finally {
      controller.dispose();
    }
  }

  async runTurn(
    bindingId: string,
    options: Readonly<{ signal?: AbortSignal; deadlineMs?: number }> = {}
  ): Promise<VoiceProviderTurnResult> {
    if (this.activeTurn) throw new VoiceGatewayError("busy", "A voice turn is already in progress.");
    const controller = linkedController(options.signal, options.deadlineMs ?? this.defaultDeadlineMs);
    this.activeTurn = { bindingId, controller };
    try {
      const runtime = await this.freshRuntime(bindingId, "active");
      if (controller.signal.aborted) throw abortError(controller);
      await this.assertEffectAllowed(runtime.scope, "audio_capture");
      const captured = await raced(this.audio.capture(runtime.scope, controller.signal), controller);
      if (captured.length === 0) throw new VoiceGatewayError("no_input", "No bounded voice activity was captured.");
      const frames = validateFrames(captured);
      const beforeProvider = await this.freshRuntime(bindingId, "active");
      if (controller.signal.aborted) throw abortError(controller);
      await this.assertEffectAllowed(beforeProvider.scope, "provider_respond");
      const response = validateResponse(await raced(
        runtime.providerPort.respond(beforeProvider.scope, beforeProvider.context, frames, controller.signal),
        controller
      ), runtime.externalSessionId);
      const final = await this.freshRuntime(bindingId, "active");
      if (controller.signal.aborted) throw abortError(controller);
      const routed: VoiceProviderTurnResult = {
        externalSessionId: response.externalSessionId,
        recognizedText: redactText(response.recognizedText),
        responseText: redactText(response.responseText),
        // Opaque provider audio cannot be privacy-redacted. The audio port must
        // synthesize the redacted responseText on the trusted local boundary.
        spokenAudio: []
      };
      await this.assertEffectAllowed(final.scope, "audio_speak");
      await raced(this.audio.speak(final.scope, routed, controller.signal), controller);
      await this.freshRuntime(bindingId, "active");
      if (controller.signal.aborted) throw abortError(controller);
      if (final.binding.transcript === "redacted") {
        if (routed.recognizedText.trim()) await this.voice.appendTranscript(bindingId, routed.recognizedText);
        if (routed.responseText.trim()) await this.voice.appendTranscript(bindingId, routed.responseText);
      }
      return routed;
    } catch (error) {
      const runtime = this.runtime;
      if (!(error instanceof VoiceGatewayError && error.code === "no_input") && runtime?.scope.bindingId === bindingId) {
        await Promise.allSettled([
          this.remediate(runtime.scope, "provider_interrupt", () => runtime.providerPort.interrupt(runtime.scope)),
          this.remediate(runtime.scope, "audio_interrupt", () => this.audio.interrupt(runtime.scope))
        ]);
      }
      throw normalizeAbort(error, controller);
    } finally {
      if (this.activeTurn?.controller === controller) this.activeTurn = undefined;
      controller.dispose();
    }
  }

  async switchProvider(
    bindingId: string,
    input: Readonly<{ consentId: string; voiceSessionId: string }>,
    options: Readonly<{ signal?: AbortSignal; deadlineMs?: number }> = {}
  ): Promise<VoiceBinding> {
    if (this.activeTurn) throw new VoiceGatewayError("busy", "A voice turn is already in progress.");
    const runtime = await this.freshRuntime(bindingId, "live");
    const next = await this.voice.switchProvider(bindingId, input);
    const controller = linkedController(options.signal, options.deadlineMs ?? this.defaultDeadlineMs);
    try {
      await this.assertEffectAllowed(runtime.scope, "provider_close", true);
      await this.assertEffectAllowed(runtime.scope, "audio_close", true);
      await raced(Promise.all([
        runtime.providerPort.close(runtime.scope, controller.signal),
        this.audio.close(runtime.scope, controller.signal)
      ]), controller);
      this.runtime = undefined;
      await this.open(next.id, { signal: controller.signal, deadlineMs: options.deadlineMs ?? this.defaultDeadlineMs });
      return (await this.voice.getBinding(next.id)) ?? next;
    } catch (error) {
      this.runtime = undefined;
      await this.voice.end(next.id).catch(() => undefined);
      throw normalizeAbort(error, controller);
    } finally {
      controller.dispose();
    }
  }

  async bindManagedSession(
    bindingId: string,
    managedSessionId: string,
    options: Readonly<{ signal?: AbortSignal; deadlineMs?: number }> = {}
  ): Promise<VoiceBinding> {
    if (this.activeTurn) throw new VoiceGatewayError("busy", "A voice turn is already in progress.");
    const current = await this.voice.getBinding(boundedIdentifier(bindingId, "voice binding"));
    if (!current || !["active", "muted", "interrupted"].includes(current.status)) throw new VoiceGatewayError("no_binding", "Only the current live voice binding can be rebound.");
    const exactSessionId = boundedIdentifier(managedSessionId, "managed session");
    if (current.managedSessionId === exactSessionId && this.runtime?.scope.bindingId === bindingId) return current;
    const prior = this.runtime?.scope.bindingId === bindingId ? this.runtime : undefined;
    const controller = linkedController(options.signal, options.deadlineMs ?? this.defaultDeadlineMs);
    try {
      if (prior) {
        await this.assertEffectAllowed(prior.scope, "provider_close", true);
        await this.assertEffectAllowed(prior.scope, "audio_close", true);
        await raced(Promise.all([
          prior.providerPort.close(prior.scope, controller.signal),
          this.audio.close(prior.scope, controller.signal)
        ]), controller);
      }
      this.runtime = undefined;
      const rebound = await this.voice.bindManagedSession(bindingId, exactSessionId);
      if (rebound.status !== "active") await this.voice.resume(bindingId);
      await this.open(bindingId, { signal: controller.signal, deadlineMs: options.deadlineMs ?? this.defaultDeadlineMs });
      return (await this.voice.getBinding(bindingId)) ?? rebound;
    } catch (error) {
      this.runtime = undefined;
      await this.voice.end(bindingId).catch(() => undefined);
      throw normalizeAbort(error, controller);
    } finally {
      controller.dispose();
    }
  }

  async mute(bindingId: string, options: Readonly<{ signal?: AbortSignal; deadlineMs?: number }> = {}): Promise<VoiceBinding> {
    const controller = linkedController(options.signal, options.deadlineMs ?? this.defaultDeadlineMs);
    try {
      const runtime = await this.freshRuntime(bindingId, "active");
      if (controller.signal.aborted) throw abortError(controller);
      const binding = await this.voice.mute(bindingId);
      await this.assertEffectAllowed(runtime.scope, "audio_mute");
      await raced(this.audio.setMuted(runtime.scope, true, controller.signal), controller);
      return binding;
    } catch (error) {
      throw normalizeAbort(error, controller);
    } finally {
      controller.dispose();
    }
  }

  async resume(bindingId: string, options: Readonly<{ signal?: AbortSignal; deadlineMs?: number }> = {}): Promise<VoiceBinding> {
    const controller = linkedController(options.signal, options.deadlineMs ?? this.defaultDeadlineMs);
    try {
      const runtime = await this.freshRuntime(bindingId, "muted_or_interrupted");
      if (controller.signal.aborted) throw abortError(controller);
      const binding = await this.voice.resume(bindingId);
      await this.assertEffectAllowed(runtime.scope, "audio_resume");
      await raced(this.audio.setMuted(runtime.scope, false, controller.signal), controller);
      this.runtime = { ...runtime, binding, scope: scope(binding, runtime.consent) };
      return binding;
    } catch (error) {
      throw normalizeAbort(error, controller);
    } finally {
      controller.dispose();
    }
  }

  async interrupt(bindingId: string, reason: string, options: Readonly<{ signal?: AbortSignal; deadlineMs?: number }> = {}): Promise<VoiceBinding> {
    const runtime = await this.freshRuntime(bindingId, "live");
    if (this.activeTurn?.bindingId === bindingId) this.activeTurn.controller.abort(new Error("voice interrupted"));
    const binding = await this.voice.interrupt(bindingId, reason);
    const controller = linkedController(options.signal, options.deadlineMs ?? this.defaultDeadlineMs);
    try {
      await this.assertEffectAllowed(runtime.scope, "provider_interrupt", true);
      await this.assertEffectAllowed(runtime.scope, "audio_interrupt", true);
      await raced(Promise.all([
        runtime.providerPort.interrupt(runtime.scope, controller.signal),
        this.audio.interrupt(runtime.scope, controller.signal)
      ]), controller);
      this.runtime = { ...runtime, binding, scope: scope(binding, runtime.consent) };
      return binding;
    } catch (error) {
      throw normalizeAbort(error, controller);
    } finally {
      controller.dispose();
    }
  }

  async end(bindingId: string, options: Readonly<{ signal?: AbortSignal; deadlineMs?: number }> = {}): Promise<VoiceBinding> {
    const runtime = this.runtime?.scope.bindingId === bindingId ? this.runtime : undefined;
    if (this.activeTurn?.bindingId === bindingId) this.activeTurn.controller.abort(new Error("voice ended"));
    const binding = await this.voice.end(bindingId);
    if (runtime) {
      const controller = linkedController(options.signal, options.deadlineMs ?? this.defaultDeadlineMs);
      try {
        await this.assertEffectAllowed(runtime.scope, "provider_close", true);
        await this.assertEffectAllowed(runtime.scope, "audio_close", true);
        await raced(Promise.all([
          runtime.providerPort.close(runtime.scope, controller.signal),
          this.audio.close(runtime.scope, controller.signal)
        ]), controller);
      } catch (error) {
        throw normalizeAbort(error, controller);
      } finally {
        this.runtime = undefined;
        controller.dispose();
      }
    }
    return binding;
  }

  async deleteTranscript(bindingId: string, options: Readonly<{ signal?: AbortSignal; deadlineMs?: number }> = {}): Promise<VoiceBinding> {
    const history = await this.voice.bindingLineage(bindingId);
    const exactHistory = await Promise.all(history.map((binding) => this.deletionState(binding.id)));
    // Local key destruction is the privacy invariant. Do it before waiting on
    // any provider/device boundary, which may be unavailable or hang until its
    // deadline. External deletion is then reported independently.
    const deleted = await this.voice.deleteTranscript(bindingId);
    const ended = deleted.status === "ended" ? deleted : await this.voice.end(bindingId);
    if (this.runtime?.scope.bindingId === bindingId) this.runtime = undefined;
    const controller = linkedController(options.signal, options.deadlineMs ?? this.defaultDeadlineMs);
    try {
      let external: readonly PromiseSettledResult<void>[];
      try {
        for (const exact of exactHistory) {
          await this.assertEffectAllowed(exact.scope, "provider_delete", true);
          await this.assertEffectAllowed(exact.scope, "audio_delete", true);
        }
        external = await raced(Promise.allSettled([
          ...exactHistory.map((exact) => this.exactProvider(exact.scope.provider).deleteTranscript(exact.scope, controller.signal)),
          ...exactHistory.map((exact) => this.audio.deleteTranscript(exact.scope, controller.signal))
        ]), controller);
      } catch {
        throw new VoiceGatewayError("deletion_incomplete", "Local transcript keys were destroyed, but bounded external deletion did not complete.");
      }
      if (external.some((result) => result.status === "rejected")) {
        throw new VoiceGatewayError("deletion_incomplete", "Local transcript keys were destroyed, but at least one external deletion could not be confirmed.");
      }
      return ended;
    } catch (error) {
      throw normalizeAbort(error, controller);
    } finally {
      controller.dispose();
    }
  }

  /**
   * A restart never guesses or recreates a route. It restores only when both
   * exact native scopes attest active; every partial/ambiguous state is ended.
   */
  async reconcile(options: Readonly<{ signal?: AbortSignal; deadlineMs?: number }> = {}): Promise<VoiceBindingScope | undefined> {
    const active = await this.voice.active();
    if (!active) {
      this.runtime = undefined;
      return undefined;
    }
    let exact: ExactVoiceState;
    let providerPort: VoiceProviderPort;
    try {
      exact = await this.exactState(active.id, "live");
      providerPort = this.exactProvider(exact.scope.provider);
    } catch {
      await this.voice.end(active.id).catch(() => undefined);
      this.runtime = undefined;
      return undefined;
    }
    const controller = linkedController(options.signal, options.deadlineMs ?? this.defaultDeadlineMs);
    try {
      await this.assertEffectAllowed(exact.scope, "audio_observe");
      await this.assertEffectAllowed(exact.scope, "provider_observe");
      const [audio, provider] = await raced(Promise.all([
        this.audio.observe(exact.scope, controller.signal),
        providerPort.observe(exact.scope, controller.signal)
      ]), controller);
      if (audio === "active" && provider === "active") {
        this.runtime = { ...exact, providerPort, externalSessionId: exact.scope.voiceSessionId };
        // Paused/interrupted state remains recoverable but must not restart the
        // microphone turn loop until the operator explicitly resumes it.
        return active.status === "active" ? cloneScope(exact.scope) : undefined;
      }
      await Promise.allSettled([
        this.remediate(exact.scope, "provider_close", () => providerPort.close(exact.scope)),
        this.remediate(exact.scope, "audio_close", () => this.audio.close(exact.scope))
      ]);
      await this.voice.end(active.id);
      this.runtime = undefined;
      return undefined;
    } catch (error) {
      await Promise.allSettled([
        this.remediate(exact.scope, "provider_close", () => providerPort.close(exact.scope)),
        this.remediate(exact.scope, "audio_close", () => this.audio.close(exact.scope))
      ]);
      await this.voice.end(active.id).catch(() => undefined);
      this.runtime = undefined;
      throw normalizeAbort(error, controller);
    } finally {
      controller.dispose();
    }
  }

  async containRepository(repositoryRoot: string, reason: string, options: Readonly<{ deadlineMs?: number }> = {}): Promise<number> {
    const runtime = this.runtime;
    if (!runtime || !sameRoot(runtime.scope.repositoryRoot, repositoryRoot)) return 0;
    if (this.activeTurn?.bindingId === runtime.scope.bindingId) this.activeTurn.controller.abort(new Error(reason));
    await this.end(runtime.scope.bindingId, { deadlineMs: options.deadlineMs ?? this.defaultDeadlineMs }).catch(async () => {
      await this.voice.end(runtime.scope.bindingId).catch(() => undefined);
      this.runtime = undefined;
    });
    return 1;
  }

  private async assertEffectAllowed(scopeValue: VoiceBindingScope, effect: VoiceEffect, remediation = false): Promise<void> {
    if (!this.effectGuard) throw new VoiceGatewayError("effect_blocked", "The voice route has no final host effect guard.");
    try {
      await this.effectGuard.assertAllowed({ scope: cloneScope(scopeValue), effect, remediation });
    } catch {
      throw new VoiceGatewayError("effect_blocked", remediation
        ? "The exact voice remediation route is unavailable."
        : "The exact voice effect is blocked by the current target or containment fence.");
    }
  }

  private async remediate(scopeValue: VoiceBindingScope, effect: VoiceEffect, action: () => Promise<void>): Promise<void> {
    try {
      await this.assertEffectAllowed(scopeValue, effect, true);
      await action();
    } catch {
      // Cleanup is best-effort after local state has been fenced. The caller
      // records ambiguity; it never reopens or replays a blocked voice route.
    }
  }

  private exactProvider(provider: VoiceProvider): VoiceProviderPort {
    const route = this.providers.get(provider);
    if (!route) {
      throw new VoiceGatewayError(
        "provider_unavailable",
        `The consented ${provider} voice route is unavailable; no provider fallback is permitted.`
      );
    }
    return route;
  }

  private async freshRuntime(
    bindingId: string,
    expected: "active" | "live" | "muted_or_interrupted"
  ): Promise<RuntimeBinding> {
    const runtime = this.runtime;
    if (!runtime || runtime.scope.bindingId !== bindingId) {
      throw new VoiceGatewayError("no_binding", "The exact voice runtime is not open.");
    }
    const exact = await this.exactState(bindingId, expected);
    if (!sameScope(runtime.scope, exact.scope) || runtime.context.digest !== exact.context.digest) {
      throw new VoiceGatewayError("target_changed", "The exact voice target, consent, or managed session changed.");
    }
    return { ...exact, providerPort: runtime.providerPort, externalSessionId: runtime.externalSessionId };
  }

  private async exactState(
    bindingId: string,
    expected: "active" | "live" | "muted_or_interrupted"
  ): Promise<ExactVoiceState> {
    const binding = await this.voice.getBinding(boundedIdentifier(bindingId, "voice binding"));
    const active = await this.voice.active();
    if (!binding || active?.id !== binding.id) {
      throw new VoiceGatewayError("no_binding", "Only the single current voice binding may use the gateway.");
    }
    if ((expected === "active" && binding.status !== "active")
      || (expected === "live" && !["active", "muted", "interrupted"].includes(binding.status))
      || (expected === "muted_or_interrupted" && binding.status !== "muted" && binding.status !== "interrupted")) {
      throw new VoiceGatewayError("no_binding", `The voice binding is ${binding.status}, not ${expected}.`);
    }
    const consent = await this.voice.getConsent(binding.consentId);
    if (!consent || Date.parse(consent.expiresAt) <= nowMs(this.now())) {
      throw new VoiceGatewayError("consent_invalid", "Microphone/provider use requires the binding's unexpired exact consent.");
    }
    if (consent.id !== binding.consentId
      || consent.repositoryRoot !== binding.repositoryRoot
      || consent.targetSnapshotId !== binding.targetSnapshotId
      || consent.contextPackageId !== binding.contextPackageId
      || consent.contextDigest !== binding.contextDigest
      || consent.provider !== binding.provider
      || consent.transcript !== binding.transcript
      || consent.retentionMinutes !== binding.retentionMinutes) {
      throw new VoiceGatewayError("consent_invalid", "The microphone consent no longer exactly matches the voice binding.");
    }
    if (!binding.managedSessionId) {
      throw new VoiceGatewayError("target_changed", "The voice gateway requires one exact managed-session binding.");
    }
    const packet = await this.contexts.get(binding.contextPackageId);
    if (!packet || !validPacketDigest(packet)
      || packet.id !== binding.contextPackageId
      || packet.digest !== binding.contextDigest
      || packet.targetSnapshotId !== binding.targetSnapshotId
      || !sameRoot(packet.repositoryRoot, binding.repositoryRoot)
      || packet.recipientSessionId !== binding.managedSessionId
      || packet.executionAuthorized !== false) {
      throw new VoiceGatewayError("target_changed", "The canonical context package does not match the exact target and managed session.");
    }
    const context = canonicalContext(packet, binding.managedSessionId);
    if (Buffer.byteLength(stableJson(context), "utf8") > maximumContextBytes) {
      throw new VoiceGatewayError("target_changed", "The canonical voice context exceeds its bounded transport size.");
    }
    const exactScope = scope(binding, consent);
    if (this.sessionScopeVerifier) {
      try { await this.sessionScopeVerifier.assertCurrent(exactScope, context); }
      catch { throw new VoiceGatewayError("target_changed", "The selected managed session is no longer current for the exact voice target."); }
    }
    return { binding, consent, scope: exactScope, context };
  }

  private async deletionState(bindingId: string): Promise<Readonly<{ binding: VoiceBinding; consent: VoiceConsent; scope: VoiceBindingScope }>> {
    const binding = await this.voice.getBinding(boundedIdentifier(bindingId, "voice binding"));
    if (!binding?.managedSessionId) throw new VoiceGatewayError("no_binding", "Transcript deletion requires the exact managed voice binding.");
    const consent = await this.voice.getConsent(binding.consentId);
    if (!consent
      || consent.repositoryRoot !== binding.repositoryRoot
      || consent.targetSnapshotId !== binding.targetSnapshotId
      || consent.contextPackageId !== binding.contextPackageId
      || consent.contextDigest !== binding.contextDigest
      || consent.provider !== binding.provider) {
      throw new VoiceGatewayError("consent_invalid", "Transcript deletion could not verify the binding's original exact consent scope.");
    }
    return { binding, consent, scope: scope(binding, consent) };
  }
}

function canonicalContext(packet: HandoffPackage, managedSessionId: string): CanonicalVoiceContext {
  return {
    schema: "sxsy-b122.voice-context",
    version: 1,
    packageId: packet.id,
    digest: packet.digest,
    repositoryRoot: packet.repositoryRoot,
    targetSnapshotId: packet.targetSnapshotId,
    taskId: packet.taskId,
    planRevision: packet.planRevision,
    ...(packet.authorityId ? { authorityId: packet.authorityId } : {}),
    plan: packet.plan,
    decisions: [...packet.decisions],
    documentation: [...packet.documentation],
    references: [...packet.references],
    constraints: [...packet.constraints],
    openQuestions: [...packet.openQuestions],
    nextActions: [...packet.nextActions],
    managedSessionId,
    executionAuthorized: false
  };
}

function validPacketDigest(packet: HandoffPackage): boolean {
  return packet.digest === sha256(stableJson({
    id: packet.id,
    repositoryRoot: packet.repositoryRoot,
    targetSnapshotId: packet.targetSnapshotId,
    taskId: packet.taskId,
    planRevision: packet.planRevision,
    ...(packet.authorityId ? { authorityId: packet.authorityId } : {}),
    plan: packet.plan,
    decisions: packet.decisions,
    documentation: packet.documentation,
    references: packet.references,
    constraints: packet.constraints,
    openQuestions: packet.openQuestions,
    nextActions: packet.nextActions,
    ...(packet.recipientSessionId ? { recipientSessionId: packet.recipientSessionId } : {})
  }));
}

function scope(binding: VoiceBinding, consent: VoiceConsent): VoiceBindingScope {
  return {
    bindingId: binding.id,
    consentId: binding.consentId,
    voiceSessionId: binding.voiceSessionId,
    managedSessionId: binding.managedSessionId!,
    repositoryRoot: binding.repositoryRoot,
    targetSnapshotId: binding.targetSnapshotId,
    contextPackageId: binding.contextPackageId,
    contextDigest: binding.contextDigest,
    provider: binding.provider,
    operatorPresenceId: consent.operatorPresenceId,
    consentExpiresAt: consent.expiresAt,
    transcript: binding.transcript
  };
}

function sameScope(left: VoiceBindingScope, right: VoiceBindingScope): boolean {
  return stableJson(left) === stableJson(right);
}

function cloneScope(value: VoiceBindingScope): VoiceBindingScope {
  return { ...value };
}

function cloneContext(value: CanonicalVoiceContext): CanonicalVoiceContext {
  return {
    ...value,
    decisions: [...value.decisions],
    documentation: [...value.documentation],
    references: [...value.references],
    constraints: [...value.constraints],
    openQuestions: [...value.openQuestions],
    nextActions: [...value.nextActions]
  };
}

function validateFrames(frames: readonly VoiceAudioFrame[]): readonly VoiceAudioFrame[] {
  if (!Array.isArray(frames) || frames.length < 1 || frames.length > maximumFrames) {
    throw new VoiceGatewayError("audio_invalid", "The microphone returned an invalid bounded frame count.");
  }
  let total = 0;
  return frames.map((frame, index) => {
    if (frame.sequence !== index
      || !Number.isFinite(Date.parse(frame.capturedAt))
      || ![8_000, 16_000, 24_000, 48_000].includes(frame.sampleRateHz)
      || (frame.channels !== 1 && frame.channels !== 2)
      || frame.encoding !== "pcm_s16le"
      || !(frame.data instanceof Uint8Array)
      || frame.data.byteLength < 1
      || frame.data.byteLength > maximumFrameBytes) {
      throw new VoiceGatewayError("audio_invalid", "The microphone returned an invalid or oversized audio frame.");
    }
    total += frame.data.byteLength;
    if (total > maximumTurnBytes) {
      throw new VoiceGatewayError("audio_invalid", "The microphone turn exceeded its bounded audio budget.");
    }
    return { ...frame, data: Uint8Array.from(frame.data) };
  });
}

function validateResponse(value: VoiceProviderTurnResult, externalSessionId: string): VoiceProviderTurnResult {
  if (boundedIdentifier(value.externalSessionId, "provider voice session") !== externalSessionId) {
    throw new VoiceGatewayError("provider_invalid", "The provider response changed the exact external voice session.");
  }
  const recognizedText = boundedText(value.recognizedText, "recognized voice text", maximumResponseText, true);
  const responseText = boundedText(value.responseText, "provider response text", maximumResponseText, false);
  if (value.spokenAudio && (!Array.isArray(value.spokenAudio) || value.spokenAudio.length > 0)) {
    throw new VoiceGatewayError("provider_invalid", "Opaque provider audio cannot bypass redaction-aware local speech routing.");
  }
  return { externalSessionId, recognizedText, responseText, spokenAudio: [] };
}

function boundedIdentifier(value: unknown, label: string): string {
  if (typeof value !== "string" || !/^[A-Za-z0-9:._-]{1,256}$/.test(value)) {
    throw new VoiceGatewayError("provider_invalid", `${label} is invalid.`);
  }
  return value;
}

function boundedText(value: unknown, label: string, maximum: number, allowEmpty: boolean): string {
  if (typeof value !== "string" || (!allowEmpty && !value.trim()) || value.length > maximum || /\0/.test(value)) {
    throw new VoiceGatewayError("provider_invalid", `${label} is invalid or oversized.`);
  }
  return value.replace(/[\r\n\t]+/g, " ").trim();
}

function sameRoot(left: string, right: string): boolean {
  return resolve(left).toLowerCase() === resolve(right).toLowerCase();
}

function nowMs(value: string): number {
  const parsed = Date.parse(value);
  if (!Number.isFinite(parsed)) throw new VoiceGatewayError("consent_invalid", "The voice clock is invalid.");
  return parsed;
}

function deadline(value: number): number {
  if (!Number.isSafeInteger(value) || value < 1 || value > 120_000) {
    throw new VoiceGatewayError("deadline", "The voice deadline is outside its bounded window.");
  }
  return value;
}

interface LinkedController {
  readonly signal: AbortSignal;
  timedOut: () => boolean;
  dispose(): void;
}

function linkedController(parent: AbortSignal | undefined, timeoutMs: number): AbortController & LinkedController {
  const bounded = deadline(timeoutMs);
  const controller = new AbortController() as AbortController & LinkedController;
  let expired = false;
  const abort = (): void => controller.abort(parent?.reason ?? new Error("voice cancelled"));
  if (parent?.aborted) abort();
  else parent?.addEventListener("abort", abort, { once: true });
  const timer = setTimeout(() => {
    expired = true;
    controller.abort(new Error("voice deadline exceeded"));
  }, bounded);
  controller.timedOut = () => expired;
  controller.dispose = () => {
    clearTimeout(timer);
    parent?.removeEventListener("abort", abort);
  };
  return controller;
}

async function raced<T>(operation: Promise<T>, controller: LinkedController): Promise<T> {
  if (controller.signal.aborted) throw abortError(controller);
  let rejectAbort!: (error: Error) => void;
  const cancelled = new Promise<never>((_resolve, reject) => { rejectAbort = reject; });
  const abort = (): void => rejectAbort(abortError(controller));
  controller.signal.addEventListener("abort", abort, { once: true });
  operation.catch(() => undefined);
  try {
    return await Promise.race([operation, cancelled]);
  } finally {
    controller.signal.removeEventListener("abort", abort);
  }
}

function abortError(controller: LinkedController): VoiceGatewayError {
  return controller.timedOut()
    ? new VoiceGatewayError("deadline", "The voice operation exceeded its deadline.")
    : new VoiceGatewayError("cancelled", "The voice operation was cancelled.");
}

function normalizeAbort(error: unknown, controller: LinkedController): Error {
  if (error instanceof VoiceGatewayError) return error;
  if (controller.signal.aborted) return abortError(controller);
  return error instanceof Error ? error : new VoiceGatewayError("provider_invalid", "The voice port failed closed.");
}
