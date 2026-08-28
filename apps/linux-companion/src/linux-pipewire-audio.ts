import { spawn } from "node:child_process";
import { realpath } from "node:fs/promises";

import { VoiceGatewayError, type VoiceAudioFrame, type VoiceAudioPort, type VoiceBindingScope, type VoicePortObservation, type VoiceProviderTurnResult } from "../../windows-companion/src/voice-gateway.ts";

const recordPath = "/usr/bin/pw-record";
const playPath = "/usr/bin/pw-play";
const synthesizePath = "/usr/bin/espeak-ng";
const maxAudioBytes = 96_000;
const maxSynthesizedBytes = maxAudioBytes * 16;

export interface LinuxPipeWirePort {
  capture(signal: AbortSignal): Promise<Buffer>;
  speak(text: string, signal: AbortSignal): Promise<void>;
  interrupt(): Promise<void>;
}

/** Fixed-format current-user PipeWire audio; it never persists microphone or synthesized bytes. */
export class LinuxPipeWireAudioPort implements VoiceAudioPort {
  private readonly active = new Set<string>();
  private readonly muted = new Set<string>();
  constructor(private readonly port: LinuxPipeWirePort = new SpawnLinuxPipeWirePort()) {}

  async open(scope: VoiceBindingScope, signal: AbortSignal): Promise<void> { exactScope(scope); if (signal.aborted) throw aborted(); this.active.add(scope.bindingId); }
  async capture(scope: VoiceBindingScope, signal: AbortSignal): Promise<readonly VoiceAudioFrame[]> {
    this.requireActive(scope); if (this.muted.has(scope.bindingId)) throw new VoiceGatewayError("audio_invalid", "The Linux microphone route is muted.");
    const data = await this.port.capture(signal);
    if (data.length < 2 || data.length > maxAudioBytes || data.length % 2 !== 0) { data.fill(0); throw new VoiceGatewayError("provider_unavailable", "PipeWire returned an invalid bounded audio frame."); }
    return [{ sequence: 0, capturedAt: new Date().toISOString(), sampleRateHz: 16_000, channels: 1, encoding: "pcm_s16le", data }];
  }
  async speak(scope: VoiceBindingScope, response: VoiceProviderTurnResult, signal: AbortSignal): Promise<void> {
    this.requireActive(scope);
    if (!response.responseText.trim() || response.responseText.length > 4_096 || /[\0]/.test(response.responseText)) throw new VoiceGatewayError("provider_unavailable", "The redacted Linux voice response is invalid for local synthesis.");
    await this.port.speak(response.responseText, signal);
  }
  async setMuted(scope: VoiceBindingScope, muted: boolean): Promise<void> { this.requireActive(scope); if (muted) this.muted.add(scope.bindingId); else this.muted.delete(scope.bindingId); }
  async interrupt(scope: VoiceBindingScope): Promise<void> { this.requireActive(scope); await this.port.interrupt(); }
  async close(scope: VoiceBindingScope): Promise<void> { exactScope(scope); await this.port.interrupt(); this.active.delete(scope.bindingId); this.muted.delete(scope.bindingId); }
  async deleteTranscript(scope: VoiceBindingScope): Promise<void> { exactScope(scope); }
  async observe(scope: VoiceBindingScope): Promise<VoicePortObservation> { exactScope(scope); return this.active.has(scope.bindingId) ? "active" : "absent"; }
  private requireActive(scope: VoiceBindingScope): void { exactScope(scope); if (!this.active.has(scope.bindingId)) throw new VoiceGatewayError("no_binding", "The Linux voice route is not open for this exact binding."); }
}

interface ActiveChild { readonly child: ReturnType<typeof spawn>; readonly closed: Promise<void>; }

export class SpawnLinuxPipeWirePort implements LinuxPipeWirePort {
  private active?: ActiveChild;

  async capture(signal: AbortSignal): Promise<Buffer> {
    await fixedAudioExecutables();
    if (this.active) throw new Error("A Linux PipeWire effect is already active.");
    return new Promise<Buffer>((resolve, reject) => {
      const child = spawn(recordPath, ["--raw", "--format=s16", "--rate=16000", "--channels=1", "-"], { shell: false, env: audioEnvironment(), stdio: ["ignore", "pipe", "ignore"] });
      const closed = new Promise<void>((resolveClose) => child.once("close", () => resolveClose()));
      this.active = { child, closed };
      const chunks: Buffer[] = []; let bytes = 0; let failed = false;
      const stop = (): void => { void terminateBounded(child, closed); };
      signal.addEventListener("abort", stop, { once: true });
      child.stdout.on("data", (chunk: Buffer) => { bytes += chunk.length; if (bytes > maxAudioBytes) { failed = true; void terminateBounded(child, closed); } else chunks.push(Buffer.from(chunk)); });
      child.once("error", reject);
      const timer = setTimeout(stop, 1_500);
      child.once("close", () => { clearTimeout(timer); signal.removeEventListener("abort", stop); if (this.active?.child === child) this.active = undefined; if (signal.aborted) reject(aborted()); else if (failed) reject(new Error("PipeWire capture exceeded its bound.")); else resolve(Buffer.concat(chunks)); });
    });
  }

  async speak(text: string, signal: AbortSignal): Promise<void> {
    await fixedAudioExecutables();
    if (this.active) throw new Error("A Linux PipeWire effect is already active.");
    const audio = await this.synthesize(text, signal);
    try { await this.play(audio, signal); }
    finally { audio.fill(0); }
  }

  async interrupt(): Promise<void> {
    const active = this.active;
    if (active) await terminateBounded(active.child, active.closed);
  }

  private async synthesize(text: string, signal: AbortSignal): Promise<Buffer> {
    return new Promise<Buffer>((resolve, reject) => {
      const child = spawn(synthesizePath, ["--stdout", "--stdin"], { shell: false, env: audioEnvironment(), stdio: ["pipe", "pipe", "ignore"] });
      const closed = new Promise<void>((resolveClose) => child.once("close", () => resolveClose()));
      this.active = { child, closed };
      const chunks: Buffer[] = []; let bytes = 0; let overflow = false;
      const stop = (): void => { void terminateBounded(child, closed); };
      const timer = setTimeout(stop, 20_000); signal.addEventListener("abort", stop, { once: true });
      child.stdout.on("data", (chunk: Buffer) => { bytes += chunk.length; if (bytes > maxSynthesizedBytes) { overflow = true; stop(); } else chunks.push(Buffer.from(chunk)); });
      child.once("error", reject);
      child.once("close", (code) => { clearTimeout(timer); signal.removeEventListener("abort", stop); if (this.active?.child === child) this.active = undefined; if (signal.aborted) reject(aborted()); else if (overflow || code !== 0 || bytes < 45) reject(new Error("Local Linux speech synthesis failed closed.")); else resolve(Buffer.concat(chunks)); });
      child.stdin.end(text, "utf8");
    });
  }

  private async play(audio: Buffer, signal: AbortSignal): Promise<void> {
    await new Promise<void>((resolve, reject) => {
      const child = spawn(playPath, ["-"], { shell: false, env: audioEnvironment(), stdio: ["pipe", "ignore", "ignore"] });
      const closed = new Promise<void>((resolveClose) => child.once("close", () => resolveClose()));
      this.active = { child, closed };
      const stop = (): void => { void terminateBounded(child, closed); };
      const timer = setTimeout(stop, 30_000); signal.addEventListener("abort", stop, { once: true });
      child.once("error", reject);
      child.once("close", (code) => { clearTimeout(timer); signal.removeEventListener("abort", stop); if (this.active?.child === child) this.active = undefined; if (signal.aborted) reject(aborted()); else if (code === 0) resolve(); else reject(new Error("PipeWire playback failed closed.")); });
      child.stdin.end(audio);
    });
  }
}

async function terminateBounded(child: ReturnType<typeof spawn>, closed: Promise<void>): Promise<void> {
  if (child.exitCode !== null || child.signalCode !== null) return;
  child.kill("SIGTERM");
  if (await Promise.race([closed.then(() => true), delay(1_500).then(() => false)])) return;
  child.kill("SIGKILL");
  if (!await Promise.race([closed.then(() => true), delay(1_500).then(() => false)])) throw new Error("The Linux audio helper did not terminate.");
}

async function fixedAudioExecutables(): Promise<void> { if (process.platform !== "linux" || await realpath(recordPath) !== recordPath || await realpath(playPath) !== playPath || await realpath(synthesizePath) !== synthesizePath) throw new Error("The fixed Linux audio tools are unavailable."); }
function audioEnvironment(): NodeJS.ProcessEnv { const result: NodeJS.ProcessEnv = { PATH: "/usr/bin:/bin" }; for (const name of ["XDG_RUNTIME_DIR", "PIPEWIRE_REMOTE", "LANG", "LC_ALL"]) if (process.env[name]) result[name] = process.env[name]; return result; }
function exactScope(scope: VoiceBindingScope): void { if (!scope.bindingId || /[\0\r\n]/.test(scope.bindingId) || !scope.voiceSessionId) throw new VoiceGatewayError("no_binding", "The Linux voice binding is invalid."); }
function aborted(): VoiceGatewayError { return new VoiceGatewayError("cancelled", "The Linux audio effect was cancelled."); }
function delay(ms: number): Promise<void> { return new Promise((resolve) => setTimeout(resolve, ms)); }
