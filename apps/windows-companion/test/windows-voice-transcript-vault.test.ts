import assert from "node:assert/strict";
import { mkdtemp, readFile, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import type { VoiceTranscriptEntry } from "../../../packages/control-plane/src/voice.ts";
import { FakeUserSecretProtector } from "../src/windows-secret.ts";
import { WindowsErasableVoiceTranscriptVault } from "../src/windows-voice-transcript-vault.ts";

const at = "2026-08-24T12:00:00.000Z";
const entry = (id: string, text: string, expiresAt = "2026-08-24T12:10:00.000Z"): VoiceTranscriptEntry => ({
  id,
  bindingId: "voice-binding-1",
  text,
  recordedAt: at,
  expiresAt
});

test("Windows transcript vault survives restart without storing plaintext and deletion destroys every wrapping key", async (context) => {
  const directory = await mkdtemp(join(tmpdir(), "b122-voice-vault-"));
  context.after(() => rm(directory, { recursive: true, force: true }));
  const protector = new FakeUserSecretProtector();
  const first = new WindowsErasableVoiceTranscriptVault(directory, protector);
  await first.append(entry("entry-1", "redacted but still personally identifying summary"));

  const rawFiles = await allFiles(directory);
  assert.equal(rawFiles.some((value) => value.includes("personally identifying")), false);
  assert.equal((await new WindowsErasableVoiceTranscriptVault(directory, protector).list("voice-binding-1", at))[0]?.text, "redacted but still personally identifying summary");

  await first.delete("voice-binding-1");
  assert.deepEqual(await first.list("voice-binding-1", at), []);
  assert.equal((await fileNames(directory)).some((name) => name.endsWith(".key")), false);
});

test("expired transcript entry keys are shredded without affecting a later live entry", async (context) => {
  const directory = await mkdtemp(join(tmpdir(), "b122-voice-expiry-"));
  context.after(() => rm(directory, { recursive: true, force: true }));
  const vault = new WindowsErasableVoiceTranscriptVault(directory, new FakeUserSecretProtector());
  await vault.append(entry("entry-expired", "expired summary", "2026-08-24T12:01:00.000Z"));
  await vault.append(entry("entry-live", "live summary", "2026-08-24T12:20:00.000Z"));
  await vault.purgeExpired("2026-08-24T12:02:00.000Z");
  assert.deepEqual((await vault.list("voice-binding-1", "2026-08-24T12:02:00.000Z")).map((value) => value.id), ["entry-live"]);
  const names = await fileNames(directory);
  assert.equal(names.filter((name) => name.endsWith(".key")).length, 1);
  assert.equal(names.filter((name) => name.endsWith(".cipher.json")).length, 1);
});

test("retention enforcement shreds expired keys while voice remains idle", async (context) => {
  const directory = await mkdtemp(join(tmpdir(), "b122-voice-idle-expiry-"));
  context.after(() => rm(directory, { recursive: true, force: true }));
  const vault = new WindowsErasableVoiceTranscriptVault(directory, new FakeUserSecretProtector());
  let clock = at;
  await vault.append(entry("entry-idle", "idle summary", "2026-08-24T12:01:00.000Z"));
  await vault.startRetentionEnforcement({ clock: () => clock, intervalMs: 10 });
  context.after(() => vault.stopRetentionEnforcement());
  clock = "2026-08-24T12:02:00.000Z";
  await waitFor(async () => (await fileNames(directory)).every((name) => !name.endsWith(".key")));
  assert.deepEqual(await vault.list("voice-binding-1", clock), []);
});

async function fileNames(root: string): Promise<string[]> {
  const names: string[] = [];
  for (const directory of await readdir(root, { withFileTypes: true })) {
    if (!directory.isDirectory()) continue;
    for (const file of await readdir(join(root, directory.name))) names.push(file);
  }
  return names;
}

async function allFiles(root: string): Promise<string[]> {
  const values: string[] = [];
  for (const directory of await readdir(root, { withFileTypes: true })) {
    if (!directory.isDirectory()) continue;
    for (const file of await readdir(join(root, directory.name))) {
      values.push(await readFile(join(root, directory.name, file), "utf8"));
    }
  }
  return values;
}

async function waitFor(predicate: () => Promise<boolean>): Promise<void> {
  const deadline = Date.now() + 1_000;
  while (!(await predicate())) {
    if (Date.now() >= deadline) throw new Error("retention enforcement did not shred the expired key");
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
}
