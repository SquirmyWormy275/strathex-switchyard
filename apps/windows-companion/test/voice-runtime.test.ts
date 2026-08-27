import assert from "node:assert/strict";
import test from "node:test";

import type { VoiceBinding } from "../../../packages/control-plane/src/voice.ts";
import { VoiceGatewayError, type VoiceBindingScope } from "../src/voice-gateway.ts";
import { InstalledVoiceConversationRuntime, type VoiceConversationGateway } from "../src/voice-runtime.ts";

const binding = (id: string, status: VoiceBinding["status"] = "active"): VoiceBinding => ({
  id,
  consentId: `consent-${id}`,
  voiceSessionId: `session-${id}`,
  managedSessionId: "managed-1",
  repositoryRoot: "C:\\repo",
  targetSnapshotId: "a".repeat(64),
  contextPackageId: "handoff-1",
  contextDigest: "b".repeat(64),
  provider: "claude",
  transcript: "off",
  retentionMinutes: 0,
  status,
  createdAt: "2026-08-24T12:00:00.000Z",
  updatedAt: "2026-08-24T12:00:00.000Z"
});

class FakeGateway implements VoiceConversationGateway {
  readonly calls: string[] = [];
  turns = 0;
  failTurn?: Error;
  switchBarrier?: Promise<void>;
  activeRepositoryRoot = "C:\\repo";

  async open(id: string): Promise<Record<string, never>> { this.calls.push(`open:${id}`); return {}; }
  async runTurn(id: string, options?: { signal?: AbortSignal }): Promise<Record<string, never>> {
    this.calls.push(`turn:${id}`);
    this.turns += 1;
    if (this.failTurn) throw this.failTurn;
    if (this.turns === 1) throw new VoiceGatewayError("no_input", "silence");
    await abortableWait(10_000, options?.signal);
    return {};
  }
  async switchProvider(id: string): Promise<VoiceBinding> {
    this.calls.push(`switch:${id}`);
    await this.switchBarrier;
    return binding("voice-2");
  }
  async bindManagedSession(id: string, managedSessionId: string): Promise<VoiceBinding> { this.calls.push(`bind:${id}:${managedSessionId}`); return { ...binding(id), managedSessionId }; }
  async mute(id: string): Promise<VoiceBinding> { this.calls.push(`mute:${id}`); return binding(id, "muted"); }
  async resume(id: string): Promise<VoiceBinding> { this.calls.push(`resume:${id}`); return binding(id); }
  async interrupt(id: string): Promise<VoiceBinding> { this.calls.push(`interrupt:${id}`); return binding(id, "interrupted"); }
  async end(id: string): Promise<VoiceBinding> { this.calls.push(`end:${id}`); return binding(id, "ended"); }
  async deleteTranscript(id: string): Promise<VoiceBinding> { this.calls.push(`delete:${id}`); return { ...binding(id, "ended"), transcriptDeletedAt: "2026-08-24T12:01:00.000Z" }; }
  async reconcile(): Promise<VoiceBindingScope | undefined> { return undefined; }
  async containRepository(repositoryRoot: string, reason: string): Promise<number> {
    this.calls.push(`contain:${repositoryRoot}:${reason}`);
    if (repositoryRoot.toLowerCase() !== this.activeRepositoryRoot.toLowerCase()) return 0;
    const active = [...this.calls].reverse().find((call) => call.startsWith("turn:"))?.slice("turn:".length);
    if (!active) return 0;
    return 1;
  }
}

test("installed voice runtime runs one bounded conversation loop and stops it before mute, switch, and end", async () => {
  const gateway = new FakeGateway();
  const runtime = new InstalledVoiceConversationRuntime({ gateway, silenceBackoffMs: 1 });
  await runtime.open("voice-1");
  await waitFor(() => gateway.turns >= 2);
  const muted = await runtime.mute("voice-1");
  assert.equal(muted.status, "muted");
  assert.equal(gateway.calls.includes("mute:voice-1"), true);
  assert.equal(runtime.activeBindingId, undefined);

  await runtime.resume("voice-1");
  await waitFor(() => gateway.calls.filter((call) => call === "turn:voice-1").length >= 3);
  const switched = await runtime.switchProvider("voice-1", { consentId: "consent-2", voiceSessionId: "session-2" });
  assert.equal(switched.id, "voice-2");
  await waitFor(() => gateway.calls.includes("turn:voice-2"));
  await runtime.end("voice-2");
  assert.equal(runtime.activeBindingId, undefined);
  assert.equal(gateway.calls.includes("end:voice-2"), true);
});

test("unexpected turn failure interrupts the exact binding and does not create an unhandled retry storm", async () => {
  const gateway = new FakeGateway();
  gateway.failTurn = new VoiceGatewayError("provider_unavailable", "provider unavailable");
  const runtime = new InstalledVoiceConversationRuntime({ gateway, silenceBackoffMs: 1 });
  await runtime.open("voice-failed");
  await waitFor(() => gateway.calls.includes("interrupt:voice-failed"));
  await new Promise((resolve) => setTimeout(resolve, 20));
  assert.equal(gateway.calls.filter((call) => call === "turn:voice-failed").length, 1);
  assert.equal(runtime.activeBindingId, undefined);
});

test("concurrent lifecycle requests are serialized so an older transition cannot race a later one", async () => {
  const gateway = new FakeGateway();
  let releaseSwitch = (): void => undefined;
  gateway.switchBarrier = new Promise<void>((resolve) => { releaseSwitch = resolve; });
  const runtime = new InstalledVoiceConversationRuntime({ gateway, silenceBackoffMs: 1 });
  await runtime.open("voice-1");
  await waitFor(() => gateway.turns >= 1);

  const switching = runtime.switchProvider("voice-1", { consentId: "consent-2", voiceSessionId: "session-2" });
  await waitFor(() => gateway.calls.includes("switch:voice-1"));
  const ending = runtime.end("voice-2");
  await new Promise((resolve) => setTimeout(resolve, 10));
  assert.equal(gateway.calls.includes("end:voice-2"), false);

  releaseSwitch();
  await switching;
  await ending;
  assert.deepEqual(gateway.calls.filter((call) => call.startsWith("switch:") || call.startsWith("end:")), [
    "switch:voice-1",
    "end:voice-2"
  ]);
  assert.equal(runtime.activeBindingId, undefined);
});

test("containment cancels and joins only the active exact-repository voice loop", async () => {
  const gateway = new FakeGateway();
  const runtime = new InstalledVoiceConversationRuntime({ gateway, silenceBackoffMs: 1 });
  await runtime.open("voice-1");
  await waitFor(() => gateway.turns >= 1);
  assert.equal(await runtime.cancelRepository("C:\\other", "fence 1"), 0);
  assert.equal(runtime.activeBindingId, "voice-1");
  assert.equal(await runtime.cancelRepository("C:\\repo", "fence 2"), 1);
  assert.equal(runtime.activeBindingId, undefined);
  assert.equal(gateway.calls.includes("contain:C:\\repo:fence 2"), true);
});

async function waitFor(predicate: () => boolean): Promise<void> {
  const deadline = Date.now() + 1_000;
  while (!predicate()) {
    if (Date.now() >= deadline) throw new Error("voice runtime condition timed out");
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
}

function abortableWait(milliseconds: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(resolve, milliseconds);
    const abort = (): void => { clearTimeout(timer); reject(new VoiceGatewayError("cancelled", "cancelled")); };
    if (signal?.aborted) abort();
    else signal?.addEventListener("abort", abort, { once: true });
  });
}
