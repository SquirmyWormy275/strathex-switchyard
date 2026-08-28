import assert from "node:assert/strict";
import test from "node:test";

import { LinuxPipeWireAudioPort, type LinuxPipeWirePort } from "../src/linux-pipewire-audio.ts";

const scope = { bindingId: "binding", consentId: "consent", voiceSessionId: "voice", managedSessionId: "managed", repositoryRoot: "/repo", targetSnapshotId: "target", contextPackageId: "context", contextDigest: "a".repeat(64), provider: "claude" as const, operatorPresenceId: "presence", consentExpiresAt: new Date(Date.now() + 60_000).toISOString(), transcript: "off" as const };

test("Linux PipeWire audio captures sequence zero and locally synthesizes redacted response text", async () => {
  let spoken = "";
  const fake: LinuxPipeWirePort = { async capture() { return Buffer.alloc(3200, 1); }, async speak(text) { spoken = text; }, async interrupt() {} };
  const audio = new LinuxPipeWireAudioPort(fake); const signal = new AbortController().signal;
  await audio.open(scope, signal);
  const frames = await audio.capture(scope, signal);
  assert.equal(frames[0]?.sampleRateHz, 16_000);
  assert.equal(frames[0]?.sequence, 0);
  await audio.speak(scope, { externalSessionId: "external", recognizedText: "", responseText: "redacted", spokenAudio: [] }, signal);
  assert.equal(spoken, "redacted");
  await audio.close(scope);
  assert.equal(await audio.observe(scope), "absent");
});

test("Linux PipeWire audio fails closed for muted, unopened, and wrong-format effects", async () => {
  const fake: LinuxPipeWirePort = { async capture() { return Buffer.alloc(3200); }, async speak() {}, async interrupt() {} };
  const audio = new LinuxPipeWireAudioPort(fake); const signal = new AbortController().signal;
  await assert.rejects(() => audio.capture(scope, signal), /not open/i);
  await audio.open(scope, signal); await audio.setMuted(scope, true);
  await assert.rejects(() => audio.capture(scope, signal), /muted/i);
  await assert.rejects(() => audio.speak(scope, { externalSessionId: "external", recognizedText: "", responseText: "" }, signal), /invalid/i);
});
