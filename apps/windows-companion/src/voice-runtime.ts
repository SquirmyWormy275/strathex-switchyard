import type { VoiceBinding } from "../../../packages/control-plane/src/voice.ts";
import {
  VoiceGatewayError,
  type CanonicalVoiceContext,
  type VoiceBindingScope,
  type VoiceProviderTurnResult
} from "./voice-gateway.ts";

export interface VoiceConversationGateway {
  open(bindingId: string, options?: Readonly<{ signal?: AbortSignal; deadlineMs?: number }>): Promise<CanonicalVoiceContext | Record<string, never>>;
  runTurn(bindingId: string, options?: Readonly<{ signal?: AbortSignal; deadlineMs?: number }>): Promise<VoiceProviderTurnResult | Record<string, never>>;
  switchProvider(bindingId: string, input: Readonly<{ consentId: string; voiceSessionId: string }>, options?: Readonly<{ signal?: AbortSignal; deadlineMs?: number }>): Promise<VoiceBinding>;
  bindManagedSession(bindingId: string, managedSessionId: string, options?: Readonly<{ signal?: AbortSignal; deadlineMs?: number }>): Promise<VoiceBinding>;
  mute(bindingId: string, options?: Readonly<{ signal?: AbortSignal; deadlineMs?: number }>): Promise<VoiceBinding>;
  resume(bindingId: string, options?: Readonly<{ signal?: AbortSignal; deadlineMs?: number }>): Promise<VoiceBinding>;
  interrupt(bindingId: string, reason: string, options?: Readonly<{ signal?: AbortSignal; deadlineMs?: number }>): Promise<VoiceBinding>;
  end(bindingId: string, options?: Readonly<{ signal?: AbortSignal; deadlineMs?: number }>): Promise<VoiceBinding>;
  deleteTranscript(bindingId: string, options?: Readonly<{ signal?: AbortSignal; deadlineMs?: number }>): Promise<VoiceBinding>;
  reconcile(options?: Readonly<{ signal?: AbortSignal; deadlineMs?: number }>): Promise<VoiceBindingScope | undefined>;
}

export interface InstalledVoiceConversationRuntimeOptions {
  readonly gateway: VoiceConversationGateway;
  readonly turnDeadlineMs?: number;
  readonly silenceBackoffMs?: number;
}

interface ActiveLoop {
  readonly bindingId: string;
  readonly controller: AbortController;
  readonly finished: Promise<void>;
}

/**
 * Owns the one active two-way conversation loop. Lifecycle methods always
 * cancel and join the current turn before mutating provider/binding state.
 */
export class InstalledVoiceConversationRuntime {
  private readonly gateway: VoiceConversationGateway;
  private readonly turnDeadlineMs: number;
  private readonly silenceBackoffMs: number;
  private loop?: ActiveLoop;
  private lifecycleTail: Promise<void> = Promise.resolve();

  constructor(options: InstalledVoiceConversationRuntimeOptions) {
    this.gateway = options.gateway;
    this.turnDeadlineMs = bounded(options.turnDeadlineMs ?? 30_000, 5_000, 120_000, "voice turn deadline");
    this.silenceBackoffMs = bounded(options.silenceBackoffMs ?? 150, 1, 5_000, "voice silence backoff");
  }

  get activeBindingId(): string | undefined { return this.loop?.bindingId; }

  async open(bindingId: string): Promise<void> {
    return this.exclusive(async () => {
      if (this.loop) throw new VoiceGatewayError("busy", "A voice conversation loop is already active.");
      await this.gateway.open(bindingId, { deadlineMs: this.turnDeadlineMs });
      this.startLoop(bindingId);
    });
  }

  async switchProvider(bindingId: string, input: Readonly<{ consentId: string; voiceSessionId: string }>): Promise<VoiceBinding> {
    return this.exclusive(async () => {
      await this.stopLoop(bindingId);
      const next = await this.gateway.switchProvider(bindingId, input, { deadlineMs: this.turnDeadlineMs });
      this.startLoop(next.id);
      return next;
    });
  }

  async mute(bindingId: string): Promise<VoiceBinding> {
    return this.exclusive(async () => {
      await this.stopLoop(bindingId);
      return this.gateway.mute(bindingId, { deadlineMs: this.turnDeadlineMs });
    });
  }

  async bindManagedSession(bindingId: string, managedSessionId: string): Promise<VoiceBinding> {
    return this.exclusive(async () => {
      await this.stopLoop(bindingId);
      const binding = await this.gateway.bindManagedSession(bindingId, managedSessionId, { deadlineMs: this.turnDeadlineMs });
      this.startLoop(binding.id);
      return binding;
    });
  }

  async resume(bindingId: string): Promise<VoiceBinding> {
    return this.exclusive(async () => {
      if (this.loop) throw new VoiceGatewayError("busy", "A voice conversation loop is already active.");
      const binding = await this.gateway.resume(bindingId, { deadlineMs: this.turnDeadlineMs });
      this.startLoop(binding.id);
      return binding;
    });
  }

  async interrupt(bindingId: string, reason: string): Promise<VoiceBinding> {
    return this.exclusive(async () => {
      await this.stopLoop(bindingId);
      return this.gateway.interrupt(bindingId, reason, { deadlineMs: this.turnDeadlineMs });
    });
  }

  async end(bindingId: string): Promise<VoiceBinding> {
    return this.exclusive(async () => {
      await this.stopLoop(bindingId);
      return this.gateway.end(bindingId, { deadlineMs: this.turnDeadlineMs });
    });
  }

  async deleteTranscript(bindingId: string): Promise<VoiceBinding> {
    return this.exclusive(async () => {
      await this.stopLoop(bindingId);
      return this.gateway.deleteTranscript(bindingId, { deadlineMs: this.turnDeadlineMs });
    });
  }

  async reconcile(): Promise<VoiceBindingScope | undefined> {
    return this.exclusive(async () => {
      if (this.loop) throw new VoiceGatewayError("busy", "A voice conversation loop is already active.");
      const restored = await this.gateway.reconcile({ deadlineMs: this.turnDeadlineMs });
      if (restored) this.startLoop(restored.bindingId);
      return restored;
    });
  }

  async shutdown(): Promise<void> {
    return this.exclusive(async () => {
      const bindingId = this.loop?.bindingId;
      if (!bindingId) return;
      await this.stopLoop(bindingId);
      await this.gateway.end(bindingId, { deadlineMs: this.turnDeadlineMs }).catch(() => undefined);
    });
  }

  private exclusive<T>(action: () => Promise<T>): Promise<T> {
    const result = this.lifecycleTail.then(action, action);
    this.lifecycleTail = result.then(() => undefined, () => undefined);
    return result;
  }

  private startLoop(bindingId: string): void {
    if (this.loop) throw new VoiceGatewayError("busy", "A voice conversation loop is already active.");
    const controller = new AbortController();
    const finished = this.pump(bindingId, controller.signal).finally(() => {
      if (this.loop?.controller === controller) this.loop = undefined;
    });
    this.loop = { bindingId, controller, finished };
  }

  private async stopLoop(bindingId: string): Promise<void> {
    const loop = this.loop;
    if (!loop) return;
    if (loop.bindingId !== bindingId) throw new VoiceGatewayError("no_binding", "The active conversation belongs to a different exact voice binding.");
    this.loop = undefined;
    loop.controller.abort(new Error("voice lifecycle transition"));
    await loop.finished;
  }

  private async pump(bindingId: string, signal: AbortSignal): Promise<void> {
    while (!signal.aborted) {
      try {
        await this.gateway.runTurn(bindingId, { signal, deadlineMs: this.turnDeadlineMs });
      } catch (error) {
        if (signal.aborted || (error instanceof VoiceGatewayError && error.code === "cancelled")) return;
        if (error instanceof VoiceGatewayError && error.code === "no_input") {
          await delay(this.silenceBackoffMs, signal).catch(() => undefined);
          continue;
        }
        await this.gateway.interrupt(bindingId, "The bounded voice turn failed and requires explicit resume.", { deadlineMs: this.turnDeadlineMs }).catch(() => undefined);
        return;
      }
    }
  }
}

function delay(milliseconds: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolveDelay, reject) => {
    const finish = (): void => {
      signal.removeEventListener("abort", abort);
      resolveDelay();
    };
    const timer = setTimeout(finish, milliseconds);
    const abort = (): void => {
      clearTimeout(timer);
      signal.removeEventListener("abort", abort);
      reject(new VoiceGatewayError("cancelled", "Voice delay cancelled."));
    };
    if (signal.aborted) abort();
    else signal.addEventListener("abort", abort, { once: true });
  });
}

function bounded(value: number, minimum: number, maximum: number, label: string): number {
  if (!Number.isSafeInteger(value) || value < minimum || value > maximum) throw new Error(`${label} is outside its bounded range.`);
  return value;
}
