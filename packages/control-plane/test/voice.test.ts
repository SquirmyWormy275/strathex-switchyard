import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { ProtectedJsonStore } from "../src/store.ts";
import { VoiceCoordinator } from "../src/voice.ts";

const at = "2026-08-24T12:00:00.000Z";
async function fixture(run: (voice: VoiceCoordinator) => Promise<void>): Promise<void> {
  const directory = await mkdtemp(join(tmpdir(), "b122-voice-"));
  try {
    const store = new ProtectedJsonStore({ filePath: join(directory, "journal.jsonl") });
    let id = 0;
    await run(new VoiceCoordinator(store, { clock: () => at, idFactory: () => `voice-${++id}` }));
  } finally { await rm(directory, { recursive: true, force: true }); }
}

test("voice requires exact short-lived consent and permits only one active context binding", async () => {
  await fixture(async (voice) => {
    const consent = await voice.grantConsent({
      repositoryRoot: "C:\\repo", targetSnapshotId: "a".repeat(64), contextPackageId: "handoff-1", contextDigest: "b".repeat(64),
      provider: "claude", operatorPresenceId: "presence-1", transcript: "off", retentionMinutes: 0,
      expiresAt: "2026-08-24T12:15:00.000Z"
    });
    const binding = await voice.start({ consentId: consent.id, voiceSessionId: "voice-session-1", managedSessionId: "agent-1" });
    assert.equal(binding.status, "active");
    assert.equal(binding.contextDigest, "b".repeat(64));
    assert.equal(binding.transcript, "off");
    await assert.rejects(voice.start({ consentId: consent.id, voiceSessionId: "voice-session-2" }), /already active/i);
    await assert.rejects(voice.appendTranscript(binding.id, "secret token=abc"), /disabled/i);
  });
});

test("voice provider switch preserves exact context, requires fresh consent, and ends the previous binding", async () => {
  await fixture(async (voice) => {
    const base = { repositoryRoot: "C:\\repo", targetSnapshotId: "a".repeat(64), contextPackageId: "handoff-1", contextDigest: "b".repeat(64), operatorPresenceId: "presence-1", transcript: "redacted" as const, retentionMinutes: 10, expiresAt: "2026-08-24T12:15:00.000Z" };
    const firstConsent = await voice.grantConsent({ ...base, provider: "claude" });
    const first = await voice.start({ consentId: firstConsent.id, voiceSessionId: "voice-session-1", managedSessionId: "agent-1" });
    await voice.appendTranscript(first.id, "first provider summary");
    const nextConsent = await voice.grantConsent({ ...base, provider: "chatgpt", operatorPresenceId: "presence-2" });
    const next = await voice.switchProvider(first.id, { consentId: nextConsent.id, voiceSessionId: "voice-session-2" });
    assert.equal((await voice.getBinding(first.id))?.status, "ended");
    assert.equal(next.provider, "chatgpt");
    assert.equal(next.managedSessionId, "agent-1");
    assert.equal(next.contextDigest, first.contextDigest);
    assert.equal(next.previousBindingId, first.id);
    await voice.appendTranscript(next.id, "second provider summary");
    assert.deepEqual((await voice.transcript(next.id)).map((entry) => entry.text), ["first provider summary", "second provider summary"]);
    await voice.mute(next.id);
    assert.equal((await voice.getBinding(next.id))?.status, "muted");
    await voice.interrupt(next.id, "operator interruption");
    assert.equal((await voice.getBinding(next.id))?.status, "interrupted");
    await voice.deleteTranscript(next.id);
    assert.deepEqual(await voice.transcript(first.id), []);
    assert.deepEqual(await voice.transcript(next.id), []);
  });
});

test("redacted transcripts expire and can be durably deleted without retaining raw secret text", async () => {
  const directory = await mkdtemp(join(tmpdir(), "b122-voice-retention-"));
  try {
    let now = Date.parse(at);
    const store = new ProtectedJsonStore({ filePath: join(directory, "journal.jsonl") });
    const voice = new VoiceCoordinator(store, { clock: () => new Date(now).toISOString(), idFactory: (() => { let id = 0; return () => `voice-${++id}`; })() });
    const consent = await voice.grantConsent({ repositoryRoot: "C:\\repo", targetSnapshotId: "a".repeat(64), contextPackageId: "handoff-1", contextDigest: "b".repeat(64), provider: "chatgpt", operatorPresenceId: "presence-1", transcript: "redacted", retentionMinutes: 1, expiresAt: "2026-08-24T12:15:00.000Z" });
    const binding = await voice.start({ consentId: consent.id, voiceSessionId: "voice-session-1" });
    await voice.appendTranscript(binding.id, "Authorization: Bearer abc123456; contact alex@example.com or (406) 555-0199 at 123 Main Street; my name is Alex Kaper; account ID ACCT-9988; host 192.0.2.10; safe summary");
    const visible = await voice.transcript(binding.id);
    assert.equal(visible.length, 1);
    assert.doesNotMatch(visible[0]!.text, /abc123456/);
    assert.doesNotMatch(visible[0]!.text, /alex@example|406|Main Street|Alex Kaper|ACCT-9988|192\.0\.2\.10/i);
    assert.match(visible[0]!.text, /\[redacted-pii\]/);
    const journal = await readFile(join(directory, "journal.jsonl"), "utf8");
    assert.doesNotMatch(journal, /safe summary|abc123456|voice\.transcript\.appended/);
    now += 61_000;
    assert.deepEqual(await voice.transcript(binding.id), []);
    await voice.deleteTranscript(binding.id);
    assert.equal((await voice.getBinding(binding.id))?.transcriptDeletedAt, new Date(now).toISOString());
    await assert.rejects(voice.appendTranscript(binding.id, "must never return"), /deleted|live/i);
  } finally { await rm(directory, { recursive: true, force: true }); }
});
