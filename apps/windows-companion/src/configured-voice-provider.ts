import type { VoiceProvider } from "../../../packages/control-plane/src/voice.ts";
import type { ProviderCommandTransport } from "./remote-adapters.ts";
import {
  VoiceGatewayError,
  type CanonicalVoiceContext,
  type VoiceAudioFrame,
  type VoiceBindingScope,
  type VoicePortObservation,
  type VoiceProviderPort,
  type VoiceProviderTurnResult
} from "./voice-gateway.ts";

const schema = "sxsy-b122.voice-provider-request" as const;
const responseSchema = "sxsy-b122.voice-provider-response" as const;
const maximumBodyBytes = 2 * 1024 * 1024;
const maximumFrames = 256;
const maximumFrameBytes = 64 * 1024;
const maximumTurnBytes = 1024 * 1024;
const maximumText = 4_096;

type VoiceProviderAction = "open" | "respond" | "interrupt" | "close" | "delete_transcript" | "observe";

/**
 * Provider-neutral voice egress over the same exact-route, DPAPI credential,
 * DNS/TLS, cancellation, and containment boundary as every other provider call.
 */
export class ConfiguredVoiceProviderPort implements VoiceProviderPort {
  readonly provider: VoiceProvider;
  private readonly network: ProviderCommandTransport;

  constructor(provider: Extract<VoiceProvider, "claude" | "chatgpt">, network: ProviderCommandTransport) {
    this.provider = provider;
    this.network = network;
  }

  async open(scope: VoiceBindingScope, context: CanonicalVoiceContext, signal: AbortSignal): Promise<string> {
    const response = await this.call("open", scope, { context: exactContext(context, scope) }, signal);
    return exactExternalSession(response, scope);
  }

  async respond(scope: VoiceBindingScope, context: CanonicalVoiceContext, frames: readonly VoiceAudioFrame[], signal: AbortSignal): Promise<VoiceProviderTurnResult> {
    const response = await this.call("respond", scope, { context: exactContext(context, scope), frames: exactFrames(frames) }, signal);
    const externalSessionId = exactExternalSession(response, scope);
    if (!exactKeys(response, [...responseKeys("respond"), "externalSessionId", "recognizedText", "responseText"])) invalidResponse();
    return {
      externalSessionId,
      recognizedText: boundedText(response.recognizedText, true),
      responseText: boundedText(response.responseText, false),
      spokenAudio: []
    };
  }

  async interrupt(scope: VoiceBindingScope, signal = new AbortController().signal): Promise<void> { await this.call("interrupt", scope, {}, signal); }
  async close(scope: VoiceBindingScope, signal = new AbortController().signal): Promise<void> { await this.call("close", scope, {}, signal); }
  async deleteTranscript(scope: VoiceBindingScope, signal = new AbortController().signal): Promise<void> { await this.call("delete_transcript", scope, {}, signal); }
  async observe(scope: VoiceBindingScope, signal = new AbortController().signal): Promise<VoicePortObservation> {
    const response = await this.call("observe", scope, {}, signal);
    if (response.state !== "active" && response.state !== "absent") invalidResponse();
    if (!exactKeys(response, [...responseKeys("observe"), "state"])) invalidResponse();
    return response.state;
  }

  private async call(action: VoiceProviderAction, scope: VoiceBindingScope, payload: Readonly<Record<string, unknown>>, signal: AbortSignal): Promise<Record<string, unknown>> {
    if (scope.provider !== this.provider || signal.aborted) throw new VoiceGatewayError("cancelled", "The exact configured voice request was cancelled or changed before dispatch.");
    const body = JSON.stringify({ schema, version: 1, action, provider: this.provider, scope: exactScope(scope), ...payload });
    if (Buffer.byteLength(body, "utf8") > maximumBodyBytes) throw new VoiceGatewayError("audio_invalid", "The configured voice request exceeds its bounded transport budget.");
    const result = await this.network.request({ routeId: `voice.${this.provider}.${action}`, repositoryRoot: scope.repositoryRoot, body, signal });
    if (result.outcome !== "passed" || !result.body) throw new VoiceGatewayError("provider_unavailable", "The exact configured voice route is unavailable or did not complete safely.");
    let parsed: unknown;
    try {
      if (result.body.byteLength > maximumBodyBytes) invalidResponse();
      parsed = JSON.parse(Buffer.from(result.body).toString("utf8"));
    } catch { invalidResponse(); }
    if (!record(parsed) || !responseBinding(parsed, action, scope, this.provider)) invalidResponse();
    if (action === "open") {
      if (!exactKeys(parsed, [...responseKeys(action), "externalSessionId"])) invalidResponse();
    } else if (action !== "respond" && action !== "observe" && !exactKeys(parsed, responseKeys(action))) invalidResponse();
    return parsed;
  }
}

function responseKeys(action: VoiceProviderAction): string[] {
  return ["schema", "version", "action", "provider", "bindingId", "voiceSessionId", "managedSessionId", "targetSnapshotId", "status"];
}

function responseBinding(value: Record<string, unknown>, action: VoiceProviderAction, scope: VoiceBindingScope, provider: VoiceProvider): boolean {
  return value.schema === responseSchema && value.version === 1 && value.action === action && value.provider === provider
    && value.bindingId === scope.bindingId && value.voiceSessionId === scope.voiceSessionId
    && value.managedSessionId === scope.managedSessionId && value.targetSnapshotId === scope.targetSnapshotId
    && value.status === "ok";
}

function exactExternalSession(value: Record<string, unknown>, scope: VoiceBindingScope): string {
  if (value.externalSessionId !== scope.voiceSessionId) invalidResponse();
  return scope.voiceSessionId;
}

function exactScope(scope: VoiceBindingScope): VoiceBindingScope {
  if (!identifier(scope.bindingId) || !identifier(scope.consentId) || !identifier(scope.voiceSessionId)
    || !identifier(scope.managedSessionId) || !identifier(scope.contextPackageId) || !identifier(scope.operatorPresenceId)
    || !digest(scope.targetSnapshotId) || !digest(scope.contextDigest) || !absolute(scope.repositoryRoot)
    || !Number.isFinite(Date.parse(scope.consentExpiresAt)) || (scope.transcript !== "off" && scope.transcript !== "redacted")) {
    throw new VoiceGatewayError("target_changed", "The configured voice scope is invalid.");
  }
  return { ...scope };
}

function exactContext(context: CanonicalVoiceContext, scope: VoiceBindingScope): CanonicalVoiceContext {
  if (context.schema !== "sxsy-b122.voice-context" || context.version !== 1 || context.executionAuthorized !== false
    || context.packageId !== scope.contextPackageId || context.digest !== scope.contextDigest
    || context.repositoryRoot.toLowerCase() !== scope.repositoryRoot.toLowerCase()
    || context.targetSnapshotId !== scope.targetSnapshotId || context.managedSessionId !== scope.managedSessionId) {
    throw new VoiceGatewayError("target_changed", "The configured voice context changed from its exact protected scope.");
  }
  return { ...context, decisions: [...context.decisions], documentation: [...context.documentation], references: [...context.references], constraints: [...context.constraints], openQuestions: [...context.openQuestions], nextActions: [...context.nextActions] };
}

function exactFrames(frames: readonly VoiceAudioFrame[]): readonly Record<string, unknown>[] {
  if (!Array.isArray(frames) || frames.length < 1 || frames.length > maximumFrames) throw new VoiceGatewayError("audio_invalid", "The configured voice frame set is invalid.");
  let total = 0;
  return frames.map((frame, index) => {
    if (frame.sequence !== index || !Number.isFinite(Date.parse(frame.capturedAt)) || ![8_000, 16_000, 24_000, 48_000].includes(frame.sampleRateHz)
      || (frame.channels !== 1 && frame.channels !== 2) || frame.encoding !== "pcm_s16le" || !(frame.data instanceof Uint8Array)
      || frame.data.byteLength < 1 || frame.data.byteLength > maximumFrameBytes) throw new VoiceGatewayError("audio_invalid", "The configured voice frame is invalid.");
    total += frame.data.byteLength;
    if (total > maximumTurnBytes) throw new VoiceGatewayError("audio_invalid", "The configured voice turn is oversized.");
    return { sequence: frame.sequence, capturedAt: frame.capturedAt, sampleRateHz: frame.sampleRateHz, channels: frame.channels, encoding: frame.encoding, dataBase64: Buffer.from(frame.data).toString("base64") };
  });
}

function boundedText(value: unknown, allowEmpty: boolean): string {
  if (typeof value !== "string" || (!allowEmpty && !value.trim()) || value.length > maximumText || /\0/.test(value)) invalidResponse();
  return value.replace(/[\r\n\t]+/g, " ").trim();
}

function invalidResponse(): never { throw new VoiceGatewayError("provider_invalid", "The configured voice provider returned an invalid or cross-bound response."); }
function exactKeys(value: Record<string, unknown>, keys: readonly string[]): boolean { return Object.keys(value).length === keys.length && keys.every((key) => Object.hasOwn(value, key)); }
function record(value: unknown): value is Record<string, unknown> { return typeof value === "object" && value !== null && !Array.isArray(value); }
function identifier(value: string): boolean { return /^[A-Za-z0-9:._-]{1,256}$/.test(value); }
function digest(value: string): boolean { return /^[a-f0-9]{64}$/.test(value); }
function absolute(value: string): boolean { return /^(?:[A-Za-z]:[\\/]|\\\\[^\\/]+[\\/][^\\]+[\\/])/.test(value); }
