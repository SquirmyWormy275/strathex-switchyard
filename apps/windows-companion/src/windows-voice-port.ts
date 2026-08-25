import { spawn } from "node:child_process";
import { createHash, randomBytes } from "node:crypto";
import { createReadStream } from "node:fs";
import { lstat, realpath, stat } from "node:fs/promises";
import { dirname, isAbsolute, resolve } from "node:path";

import { redactText } from "../../../packages/control-plane/src/redaction.ts";
import type { VoiceProvider } from "../../../packages/control-plane/src/voice.ts";
import {
  VoiceGatewayError,
  type CanonicalVoiceContext,
  type VoiceAudioFrame,
  type VoiceAudioPort,
  type VoiceBindingScope,
  type VoicePortObservation,
  type VoiceProviderPort,
  type VoiceProviderTurnResult,
  type VoiceSpokenAudio
} from "./voice-gateway.ts";

const requestSchema = "sxsy-b122.voice-helper-request" as const;
const responseSchema = "sxsy-b122.voice-helper-response" as const;
const helperArguments = ["--stdio-v1"] as const;
const digestPattern = /^[a-f0-9]{64}$/;
const identifierPattern = /^[A-Za-z0-9:._-]{1,256}$/;
const routePattern = /^[a-z0-9][a-z0-9._:-]{2,127}$/;
const maximumHelperBytes = 256 * 1024 * 1024;
const maximumProtocolBytes = 2 * 1024 * 1024;
const maximumFrameBytes = 64 * 1024;
const maximumTurnBytes = 1024 * 1024;
const maximumFrames = 256;
const maximumText = 4_096;

export interface WindowsVoiceHelperInvocation {
  readonly helperPath: string;
  readonly helperSha256: string;
  readonly arguments: readonly string[];
  /** Complete environment. PATH, credentials, and workspace values are absent. */
  readonly environment: Readonly<Record<string, string>>;
  readonly requestLine: string;
}

export interface WindowsVoiceHelperTransport {
  exchange(invocation: WindowsVoiceHelperInvocation, signal: AbortSignal): Promise<string>;
}

export interface WindowsVoiceRouteOptions {
  readonly helperPath: string;
  readonly helperSha256: string;
  readonly routeId: string;
  readonly transport?: WindowsVoiceHelperTransport;
  /** Injectable only so tests can prove ambient secrets are not inherited. */
  readonly hostEnvironment?: NodeJS.ProcessEnv;
}

export interface WindowsVoiceProviderOptions extends WindowsVoiceRouteOptions {
  readonly provider: VoiceProvider;
  /** Opaque durable reference; it is resolved by the trusted helper, never placed in env. */
  readonly authorizationReference: string;
}

/** One-shot, bounded native-helper transport used by the installed companion. */
export class NodeWindowsVoiceHelperTransport implements WindowsVoiceHelperTransport {
  async exchange(invocation: WindowsVoiceHelperInvocation, signal: AbortSignal): Promise<string> {
    if (signal.aborted) throw cancelled();
    const child = spawn(invocation.helperPath, [...invocation.arguments], {
      cwd: dirname(invocation.helperPath),
      env: { ...invocation.environment },
      shell: false,
      windowsHide: true,
      stdio: ["pipe", "pipe", "pipe"]
    });
    if (!child.stdin || !child.stdout || !child.stderr) {
      child.kill();
      throw new Error("The fixed voice helper did not expose bounded protocol streams.");
    }
    let stdout = "";
    let stderrBytes = 0;
    let failure: Error | undefined;
    child.stdout.setEncoding("utf8");
    child.stdout.on("data", (chunk: string) => {
      stdout += chunk;
      if (Buffer.byteLength(stdout, "utf8") > maximumProtocolBytes) {
        failure = new Error("The voice helper emitted an oversized response.");
        child.kill();
      }
    });
    child.stderr.on("data", (chunk: Buffer) => {
      stderrBytes += chunk.byteLength;
      if (stderrBytes > 4_096) {
        failure = new Error("The voice helper exceeded its bounded diagnostic output.");
        child.kill();
      }
    });
    const exit = new Promise<{ readonly code: number; readonly signal: NodeJS.Signals | null }>((settle) => {
      child.once("error", () => {
        failure ??= new Error("The fixed voice helper could not be started.");
      });
      child.once("close", (code, childSignal) => settle({ code: code ?? -1, signal: childSignal }));
    });
    const abort = (): void => {
      failure = cancelled();
      child.kill();
    };
    signal.addEventListener("abort", abort, { once: true });
    try {
      if (signal.aborted) abort();
      else child.stdin.end(`${invocation.requestLine}\n`, "utf8");
      const result = await exit;
      if (failure) throw failure;
      if (result.code !== 0 || result.signal) throw new Error("The fixed voice helper failed closed.");
      const lines = stdout.split(/\r?\n/).filter((line) => line.length > 0);
      if (lines.length !== 1) throw new Error("The voice helper did not emit exactly one bounded response.");
      return lines[0]!;
    } finally {
      signal.removeEventListener("abort", abort);
      if (child.exitCode === null && child.signalCode === null) child.kill();
    }
  }
}

export class SafeUnavailableVoiceAudioPort implements VoiceAudioPort {
  private readonly reason: string;

  constructor(reason = "The reviewed Windows microphone route is unavailable.") { this.reason = reason; }
  async open(_scope: VoiceBindingScope, _signal: AbortSignal): Promise<void> { throw new VoiceGatewayError("provider_unavailable", this.reason); }
  async capture(_scope: VoiceBindingScope, _signal: AbortSignal): Promise<readonly VoiceAudioFrame[]> { throw new VoiceGatewayError("provider_unavailable", this.reason); }
  async speak(_scope: VoiceBindingScope, _response: VoiceProviderTurnResult, _signal: AbortSignal): Promise<void> { throw new VoiceGatewayError("provider_unavailable", this.reason); }
  async setMuted(_scope: VoiceBindingScope, _muted: boolean, _signal?: AbortSignal): Promise<void> { throw new VoiceGatewayError("provider_unavailable", this.reason); }
  async interrupt(_scope: VoiceBindingScope, _signal?: AbortSignal): Promise<void> {}
  async close(_scope: VoiceBindingScope, _signal?: AbortSignal): Promise<void> {}
  async deleteTranscript(_scope: VoiceBindingScope, _signal?: AbortSignal): Promise<void> { throw new VoiceGatewayError("provider_unavailable", this.reason); }
  async observe(_scope: VoiceBindingScope, _signal?: AbortSignal): Promise<VoicePortObservation> { return "absent"; }
}

export class SafeUnavailableVoiceProviderPort implements VoiceProviderPort {
  readonly provider: VoiceProvider;
  private readonly reason: string;

  constructor(provider: VoiceProvider, reason = `The reviewed ${provider} voice route is unavailable.`) {
    this.provider = provider;
    this.reason = reason;
  }
  async open(_scope: VoiceBindingScope, _context: CanonicalVoiceContext, _signal: AbortSignal): Promise<string> { throw new VoiceGatewayError("provider_unavailable", this.reason); }
  async respond(_scope: VoiceBindingScope, _context: CanonicalVoiceContext, _frames: readonly VoiceAudioFrame[], _signal: AbortSignal): Promise<VoiceProviderTurnResult> { throw new VoiceGatewayError("provider_unavailable", this.reason); }
  async interrupt(_scope: VoiceBindingScope, _signal?: AbortSignal): Promise<void> {}
  async close(_scope: VoiceBindingScope, _signal?: AbortSignal): Promise<void> {}
  async deleteTranscript(_scope: VoiceBindingScope, _signal?: AbortSignal): Promise<void> { throw new VoiceGatewayError("provider_unavailable", this.reason); }
  async observe(_scope: VoiceBindingScope, _signal?: AbortSignal): Promise<VoicePortObservation> { return "absent"; }
}

export class WindowsVoiceAudioPort implements VoiceAudioPort {
  private readonly boundary: WindowsVoiceHelperBoundary;

  constructor(options: WindowsVoiceRouteOptions) {
    this.boundary = new WindowsVoiceHelperBoundary(options);
  }

  async open(scope: VoiceBindingScope, signal: AbortSignal): Promise<void> {
    await this.boundary.call("audio", "audio_open", scope, {}, signal);
  }

  async capture(scope: VoiceBindingScope, signal: AbortSignal): Promise<readonly VoiceAudioFrame[]> {
    const response = await this.boundary.call("audio", "capture", scope, {}, signal);
    return parseFrames(response.frames);
  }

  async speak(scope: VoiceBindingScope, response: VoiceProviderTurnResult, signal: AbortSignal): Promise<void> {
    if (redactText(response.responseText) !== response.responseText) {
      throw new Error("The local spoken-response boundary requires already-redacted text.");
    }
    await this.boundary.call("audio", "speak", scope, {
      externalSessionId: identifier(response.externalSessionId, "provider voice session"),
      responseText: text(response.responseText, "spoken response", false)
    }, signal);
  }

  async setMuted(scope: VoiceBindingScope, muted: boolean, signal = new AbortController().signal): Promise<void> {
    await this.boundary.call("audio", "set_muted", scope, { muted }, signal);
  }

  async interrupt(scope: VoiceBindingScope, signal = new AbortController().signal): Promise<void> {
    await this.boundary.call("audio", "interrupt", scope, {}, signal);
  }

  async close(scope: VoiceBindingScope, signal = new AbortController().signal): Promise<void> {
    await this.boundary.call("audio", "close", scope, {}, signal);
  }

  async deleteTranscript(scope: VoiceBindingScope, signal = new AbortController().signal): Promise<void> {
    await this.boundary.call("audio", "delete_transcript", scope, {}, signal);
  }

  async observe(scope: VoiceBindingScope, signal = new AbortController().signal): Promise<VoicePortObservation> {
    return observation((await this.boundary.call("audio", "observe", scope, {}, signal)).state);
  }
}

export class WindowsVoiceProviderPort implements VoiceProviderPort {
  readonly provider: VoiceProvider;
  private readonly authorizationReference: string;
  private readonly boundary: WindowsVoiceHelperBoundary;

  constructor(options: WindowsVoiceProviderOptions) {
    this.provider = voiceProvider(options.provider);
    this.authorizationReference = authorizationReference(options.authorizationReference);
    this.boundary = new WindowsVoiceHelperBoundary(options);
  }

  async open(scope: VoiceBindingScope, context: CanonicalVoiceContext, signal: AbortSignal): Promise<string> {
    this.assertScope(scope);
    const response = await this.boundary.call("provider", "provider_open", scope, {
      provider: this.provider,
      authorizationReference: this.authorizationReference,
      context: exactContext(context, scope)
    }, signal, this.provider);
    return identifier(response.externalSessionId, "provider voice session");
  }

  async respond(
    scope: VoiceBindingScope,
    context: CanonicalVoiceContext,
    frames: readonly VoiceAudioFrame[],
    signal: AbortSignal
  ): Promise<VoiceProviderTurnResult> {
    this.assertScope(scope);
    const response = await this.boundary.call("provider", "respond", scope, {
      provider: this.provider,
      authorizationReference: this.authorizationReference,
      context: exactContext(context, scope),
      frames: encodeFrames(frames)
    }, signal, this.provider);
    return {
      externalSessionId: identifier(response.externalSessionId, "provider voice session"),
      recognizedText: text(response.recognizedText, "recognized voice text", true),
      responseText: text(response.responseText, "provider response text", false),
      ...(response.spokenAudio === undefined ? {} : { spokenAudio: parseSpokenAudio(response.spokenAudio) })
    };
  }

  async interrupt(scope: VoiceBindingScope, signal = new AbortController().signal): Promise<void> {
    this.assertScope(scope);
    await this.boundary.call("provider", "interrupt", scope, {
      provider: this.provider,
      authorizationReference: this.authorizationReference
    }, signal, this.provider);
  }

  async close(scope: VoiceBindingScope, signal = new AbortController().signal): Promise<void> {
    this.assertScope(scope);
    await this.boundary.call("provider", "close", scope, {
      provider: this.provider,
      authorizationReference: this.authorizationReference
    }, signal, this.provider);
  }

  async deleteTranscript(scope: VoiceBindingScope, signal = new AbortController().signal): Promise<void> {
    this.assertScope(scope);
    await this.boundary.call("provider", "delete_transcript", scope, {
      provider: this.provider,
      authorizationReference: this.authorizationReference
    }, signal, this.provider);
  }

  async observe(scope: VoiceBindingScope, signal = new AbortController().signal): Promise<VoicePortObservation> {
    this.assertScope(scope);
    const response = await this.boundary.call("provider", "observe", scope, {
      provider: this.provider,
      authorizationReference: this.authorizationReference
    }, signal, this.provider);
    return observation(response.state);
  }

  private assertScope(scope: VoiceBindingScope): void {
    if (scope.provider !== this.provider) {
      throw new VoiceGatewayError("provider_unavailable", `The ${this.provider} voice route cannot fall back to ${scope.provider}.`);
    }
  }
}

class WindowsVoiceHelperBoundary {
  private readonly helperPath: string;
  private readonly helperSha256: string;
  private readonly routeId: string;
  private readonly transport: WindowsVoiceHelperTransport;
  private readonly environment: Readonly<Record<string, string>>;

  constructor(options: WindowsVoiceRouteOptions) {
    if (!isAbsolute(options.helperPath) || !/\.exe$/i.test(options.helperPath) || !digestPattern.test(options.helperSha256)) {
      throw new Error("The voice port requires an exact absolute helper path and SHA-256 digest.");
    }
    if (!routePattern.test(options.routeId)) throw new Error("The voice route identity is invalid.");
    this.helperPath = resolve(options.helperPath);
    this.helperSha256 = options.helperSha256.toLowerCase();
    this.routeId = options.routeId;
    this.transport = options.transport ?? new NodeWindowsVoiceHelperTransport();
    this.environment = strictEnvironment(options.hostEnvironment ?? process.env);
  }

  async call(
    component: "audio" | "provider",
    action: string,
    scope: VoiceBindingScope,
    payload: Readonly<Record<string, unknown>>,
    signal: AbortSignal,
    provider?: VoiceProvider
  ): Promise<Record<string, unknown>> {
    if (signal.aborted) throw cancelled();
    const canonicalHelper = await this.assertHelperIdentity();
    if (signal.aborted) throw cancelled();
    const requestId = randomBytes(24).toString("hex");
    const request = {
      schema: requestSchema,
      version: 1,
      requestId,
      component,
      action,
      routeId: this.routeId,
      scope: exactScope(scope),
      ...payload
    };
    const requestLine = JSON.stringify(request);
    if (Buffer.byteLength(requestLine, "utf8") > maximumProtocolBytes || /\r|\n/.test(requestLine)) {
      throw new Error("The bounded voice-helper request is oversized or invalid.");
    }
    const responseLine = await this.transport.exchange({
      helperPath: canonicalHelper,
      helperSha256: this.helperSha256,
      arguments: helperArguments,
      environment: this.environment,
      requestLine
    }, signal);
    return parseResponse(responseLine, requestId, component, action, scope, provider);
  }

  private async assertHelperIdentity(): Promise<string> {
    const link = await lstat(this.helperPath).catch(() => { throw new Error("The fixed voice helper identity is unavailable."); });
    if (link.isSymbolicLink()) throw new Error("The fixed voice helper identity cannot be a redirect.");
    const canonical = await realpath(this.helperPath).catch(() => { throw new Error("The fixed voice helper identity cannot be canonicalized."); });
    const metadata = await stat(canonical);
    if (!metadata.isFile() || metadata.size < 1 || metadata.size > maximumHelperBytes) {
      throw new Error("The fixed voice helper identity is not a bounded file.");
    }
    if (await fileSha256(canonical) !== this.helperSha256) throw new Error("The fixed voice helper digest changed.");
    return canonical;
  }
}

function parseResponse(
  line: string,
  requestId: string,
  component: "audio" | "provider",
  action: string,
  scope: VoiceBindingScope,
  provider?: VoiceProvider
): Record<string, unknown> {
  if (typeof line !== "string" || Buffer.byteLength(line, "utf8") > maximumProtocolBytes) {
    throw new Error("The voice helper emitted an oversized response.");
  }
  let value: unknown;
  try { value = JSON.parse(line); } catch { throw new Error("The voice helper emitted an invalid response."); }
  if (!record(value)
    || value.schema !== responseSchema
    || value.version !== 1
    || value.requestId !== requestId
    || value.component !== component
    || value.action !== action
    || value.bindingId !== scope.bindingId
    || value.targetSnapshotId !== scope.targetSnapshotId
    || value.managedSessionId !== scope.managedSessionId
    || value.provider !== (provider ?? null)) {
    throw new Error("The voice helper response was not bound to the exact request, provider, target, and managed session.");
  }
  if (value.status === "unavailable") throw new VoiceGatewayError("provider_unavailable", "The exact Windows voice route is unavailable.");
  if (value.status !== "ok") throw new Error("The exact Windows voice route failed closed.");
  return value;
}

function exactScope(scope: VoiceBindingScope): VoiceBindingScope {
  if (!identifierPattern.test(scope.bindingId)
    || !identifierPattern.test(scope.consentId)
    || !identifierPattern.test(scope.voiceSessionId)
    || !identifierPattern.test(scope.managedSessionId)
    || !identifierPattern.test(scope.contextPackageId)
    || !digestPattern.test(scope.targetSnapshotId)
    || !digestPattern.test(scope.contextDigest)
    || !isAbsolute(scope.repositoryRoot)
    || !Number.isFinite(Date.parse(scope.consentExpiresAt))
    || !identifierPattern.test(scope.operatorPresenceId)
    || (scope.transcript !== "off" && scope.transcript !== "redacted")) {
    throw new Error("The exact voice helper scope is malformed.");
  }
  return { ...scope, repositoryRoot: resolve(scope.repositoryRoot) };
}

function exactContext(context: CanonicalVoiceContext, scope: VoiceBindingScope): CanonicalVoiceContext {
  if (context.schema !== "sxsy-b122.voice-context"
    || context.version !== 1
    || context.packageId !== scope.contextPackageId
    || context.digest !== scope.contextDigest
    || context.targetSnapshotId !== scope.targetSnapshotId
    || resolve(context.repositoryRoot).toLowerCase() !== resolve(scope.repositoryRoot).toLowerCase()
    || context.managedSessionId !== scope.managedSessionId
    || context.executionAuthorized !== false) {
    throw new Error("The provider context is not bound to the exact voice scope.");
  }
  return {
    ...context,
    decisions: [...context.decisions],
    documentation: [...context.documentation],
    references: [...context.references],
    constraints: [...context.constraints],
    openQuestions: [...context.openQuestions],
    nextActions: [...context.nextActions]
  };
}

function encodeFrames(frames: readonly VoiceAudioFrame[]): readonly Record<string, unknown>[] {
  return validateFrameSet(frames, (frame) => ({
    sequence: frame.sequence,
    capturedAt: frame.capturedAt,
    sampleRateHz: frame.sampleRateHz,
    channels: frame.channels,
    encoding: frame.encoding,
    dataBase64: Buffer.from(frame.data).toString("base64")
  }));
}

function parseFrames(value: unknown): readonly VoiceAudioFrame[] {
  if (!Array.isArray(value)) throw new Error("The voice helper returned invalid audio frames.");
  if (value.length === 0) return [];
  return validateFrameSet(value.map((item) => parseFrame(item)), (frame) => frame);
}

function parseFrame(value: unknown): VoiceAudioFrame {
  if (!record(value)) throw new Error("The voice helper returned an invalid audio frame.");
  const encoded = base64(value.dataBase64, "audio frame");
  return {
    sequence: value.sequence as number,
    capturedAt: value.capturedAt as string,
    sampleRateHz: value.sampleRateHz as VoiceAudioFrame["sampleRateHz"],
    channels: value.channels as VoiceAudioFrame["channels"],
    encoding: value.encoding as VoiceAudioFrame["encoding"],
    data: Uint8Array.from(encoded)
  };
}

function validateFrameSet<T>(frames: readonly VoiceAudioFrame[], convert: (frame: VoiceAudioFrame) => T): readonly T[] {
  if (frames.length < 1 || frames.length > maximumFrames) throw new Error("The voice audio frame count is outside its bounded range.");
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
      throw new Error("The voice helper returned an invalid or oversized audio frame.");
    }
    total += frame.data.byteLength;
    if (total > maximumTurnBytes) throw new Error("The voice helper exceeded its bounded audio-turn budget.");
    return convert({ ...frame, data: Uint8Array.from(frame.data) });
  });
}

function parseSpokenAudio(value: unknown): readonly VoiceSpokenAudio[] {
  if (!Array.isArray(value) || value.length > maximumFrames) throw new Error("The provider returned invalid spoken audio.");
  let total = 0;
  return value.map((item) => {
    if (!record(item)) throw new Error("The provider returned invalid spoken audio.");
    const data = base64(item.dataBase64, "spoken audio");
    if (![8_000, 16_000, 24_000, 48_000].includes(item.sampleRateHz as number)
      || (item.channels !== 1 && item.channels !== 2)
      || item.encoding !== "pcm_s16le"
      || data.byteLength < 1
      || data.byteLength > maximumFrameBytes) {
      throw new Error("The provider returned invalid or oversized spoken audio.");
    }
    total += data.byteLength;
    if (total > maximumTurnBytes) throw new Error("The provider exceeded its bounded spoken-audio budget.");
    return {
      encoding: "pcm_s16le",
      sampleRateHz: item.sampleRateHz as VoiceSpokenAudio["sampleRateHz"],
      channels: item.channels as VoiceSpokenAudio["channels"],
      data: Uint8Array.from(data)
    };
  });
}

function base64(value: unknown, label: string): Buffer {
  if (typeof value !== "string" || value.length < 4 || value.length > Math.ceil(maximumFrameBytes / 3) * 4 + 4
    || !/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(value)) {
    throw new Error(`The ${label} base64 is invalid or oversized.`);
  }
  const decoded = Buffer.from(value, "base64");
  if (decoded.toString("base64") !== value) throw new Error(`The ${label} base64 is not canonical.`);
  return decoded;
}

function observation(value: unknown): VoicePortObservation {
  if (value === "active" || value === "absent") return value;
  throw new Error("The voice helper returned an invalid lifecycle observation.");
}

function voiceProvider(value: unknown): VoiceProvider {
  if (value === "claude" || value === "chatgpt" || value === "system") return value;
  throw new Error("The Windows voice provider identity is invalid.");
}

function authorizationReference(value: unknown): string {
  if (typeof value !== "string" || !/^credential-ref:[A-Za-z0-9._:-]{1,224}$/.test(value)) {
    throw new Error("The Windows voice provider requires one opaque durable credential reference.");
  }
  return value;
}

function identifier(value: unknown, label: string): string {
  if (typeof value !== "string" || !identifierPattern.test(value)) throw new Error(`The ${label} is invalid.`);
  return value;
}

function text(value: unknown, label: string, allowEmpty: boolean): string {
  if (typeof value !== "string" || (!allowEmpty && !value.trim()) || value.length > maximumText || /\0/.test(value)) {
    throw new Error(`The ${label} is invalid or oversized.`);
  }
  return value.replace(/[\r\n\t]+/g, " ").trim();
}

function strictEnvironment(source: NodeJS.ProcessEnv): Readonly<Record<string, string>> {
  const systemRoot = source.SystemRoot ?? source.SYSTEMROOT;
  const windir = source.WINDIR ?? systemRoot;
  if (!systemRoot || !windir || /[\0\r\n]/.test(systemRoot) || /[\0\r\n]/.test(windir)) {
    throw new Error("The fixed voice helper requires exact Windows system directories.");
  }
  return Object.freeze({ SystemRoot: systemRoot, WINDIR: windir });
}

async function fileSha256(path: string): Promise<string> {
  const hash = createHash("sha256");
  await new Promise<void>((resolveHash, rejectHash) => {
    const stream = createReadStream(path);
    stream.on("data", (chunk) => hash.update(chunk));
    stream.once("error", rejectHash);
    stream.once("end", resolveHash);
  });
  return hash.digest("hex");
}

function record(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function cancelled(): VoiceGatewayError {
  return new VoiceGatewayError("cancelled", "The exact Windows voice operation was cancelled.");
}
