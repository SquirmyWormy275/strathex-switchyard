import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const companionRoot = join(dirname(fileURLToPath(import.meta.url)), "..");

test("native voice helper source implements the exact audio/provider protocol and a hardware-independent self-test", async () => {
  const source = await readFile(join(companionRoot, "voice-helper", "Program.cs"), "utf8");
  const project = await readFile(join(companionRoot, "voice-helper", "Sxsy.B122.VoiceHelper.csproj"), "utf8");
  assert.match(project, /<TargetFramework>net8\.0-windows<\/TargetFramework>/);
  assert.match(project, /<AssemblyName>sxsy-b122-voice-helper<\/AssemblyName>/);
  for (const token of [
    "sxsy-b122.voice-helper-request",
    "sxsy-b122.voice-helper-response",
    "sxsy-b122.voice-helper-self-test",
    "audio_open",
    "capture",
    "speak",
    "set_muted",
    "interrupt",
    "close",
    "delete_transcript",
    "observe",
    "provider_open",
    "respond",
    "CryptProtectData",
    "CryptUnprotectData",
    "waveInOpen",
    "HasVoiceActivity",
    "SAPI.SpVoice",
    "AllowAutoRedirect = false",
    "UseProxy = false",
    "--provision-route-v1",
    "--remove-route-v1",
    "executionAuthorized"
  ]) assert.equal(source.includes(token), true, `missing native voice helper token ${token}`);
  assert.doesNotMatch(source, /Environment\.GetEnvironmentVariable\("(?:PATH|GH_TOKEN|OPENAI_API_KEY|ANTHROPIC_API_KEY)"/);
});

test("native route administration keeps secrets off argv and persists only current-user DPAPI ciphertext", async () => {
  const source = await readFile(join(companionRoot, "voice-helper", "Program.cs"), "utf8");
  assert.match(source, /ReadBoundedLine\(Console\.In/);
  assert.match(source, /WriteProtectedAtomic/);
  assert.match(source, /authorizationReference/);
  assert.match(source, /MaximumSecretChars/);
  assert.doesNotMatch(source, /args\[[0-9]+\].*(?:secret|token|credential)/i);
});

test("standalone startup always stops retention and voice after a later startup failure", async () => {
  const source = await readFile(join(companionRoot, "src", "main.ts"), "utf8");
  assert.match(source, /await transcriptVault\.startRetentionEnforcement/);
  assert.match(source, /transcriptVault\?\.stopRetentionEnforcement\(\)/);
  assert.match(source, /await voiceRuntime\?\.shutdown\(\)\.catch/);
  assert.match(source, /await companion\.voiceRuntime\.shutdown\(\)/);
});
