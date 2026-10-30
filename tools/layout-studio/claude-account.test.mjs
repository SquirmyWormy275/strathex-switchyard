import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { resolve } from "node:path";
import test from "node:test";
import { readClaudeMetadata } from "./claude-account.mjs";

function fixture(settings = {}) {
  const resource = { clients: new Set() }, calls = [], frames = [];
  const command = async (exe, args, options) => {
    calls.push({ exe, args, options });
    const frame = { schema: "switchyard-runtime-command/v1", id: randomUUID(), guardianPid: 1234, birth: "5", containment: "owned-linux-session" }; frames.push(frame);
    await settings.beforeReady?.(); await options.onGuardianReady(frame); settings.started = true;
    return { stdout: settings.stdout ?? "bounded metadata", stderr: "", status: settings.status ?? "completed", exitCode: settings.exitCode ?? 0, inputDelivered: true, treeExitVerified: settings.treeExitVerified !== false };
  };
  const options = { resource, command, guardianStopped: async () => settings.guardianStopped !== false, stopChild: async () => ({ stopped: true }) };
  return { resource, calls, frames, options };
}
test("shared metadata uses only fixed native argument vectors and releases each verified guardian resource", async () => {
  const f = fixture(), cwd = resolve("synthetic-repository");
  for (const operation of ["version", "account", "inventory"]) assert.equal(await readClaudeMetadata("/synthetic/claude", operation, cwd, f.options), "bounded metadata");
  assert.deepEqual(f.calls.map((c) => c.args), [["--version"], ["auth", "status", "--json"], ["agents", "--json", "--all", "--cwd", cwd]]);
  for (const { options } of f.calls) { assert.equal(options.detailed, true); assert.equal(options.timeout, 10000); assert.equal(options.inputText, undefined); assert.equal(options.captureStderrBytes, 0); assert.equal(options.env.ANTHROPIC_API_KEY, undefined); assert.equal(options.env.CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC, "1"); }
  assert.deepEqual(f.calls.map((c) => c.options.maxOutputBytes), [65536, 65536, 262144]); assert.equal(f.resource.clients.size, 0); assert.equal(new Set(f.frames.map((r) => r.id)).size, 3);
});
test("invalid metadata operations, paths and deadlines cannot start a guardian", async () => {
  const f = fixture();
  for (const [operation, cwd, timeoutMs] of [["print", undefined, 1000], ["inventory", "relative", 1000], ["version", undefined, 9], ["account", undefined, 20001]]) await assert.rejects(readClaudeMetadata("/synthetic/claude", operation, cwd, { ...f.options, timeoutMs }), /bounded native/);
  assert.equal(f.calls.length, 0);
});
test("revoked authorization at guardian readiness prevents native metadata execution", async () => {
  const settings = { permitted: true, beforeReady() { settings.permitted = false; } }, f = fixture(settings);
  await assert.rejects(readClaudeMetadata("/synthetic/claude", "account", undefined, { ...f.options, authorize: async () => { if (!settings.permitted) throw new Error("Synthetic revoked provider policy"); } }), /revoked provider/);
  assert.equal(settings.started, undefined); assert.equal(f.resource.clients.size, 0);
});
test("tracking failure occurs before command start and leaves no client or abort listener behind", async () => {
  const f = fixture(); let observed;
  await assert.rejects(readClaudeMetadata("/synthetic/claude", "version", undefined, { ...f.options, onClient(client) { observed = client; throw new Error("Synthetic failed ownership tracking"); } }), /failed ownership tracking/);
  assert.equal(f.calls.length, 0); assert.equal(f.resource.clients.size, 0); assert.equal(await observed.stop(), true);
});
test("unverified metadata exit retains its exact client until the native guardian is independently stopped", async () => {
  const settings = { treeExitVerified: false, guardianStopped: false }, f = fixture(settings); let error;
  try { await readClaudeMetadata("/synthetic/claude", "account", undefined, f.options); } catch (e) { error = e; }
  assert.match(error.message, /guardian.*not verified exit/); assert.equal(f.resource.clients.size, 1); assert.equal(error.ownedClient, [...f.resource.clients][0]); assert.equal(await error.ownedClient.stop(), false);
  settings.guardianStopped = true; assert.equal(await error.ownedClient.stop(), true); f.resource.clients.delete(error.ownedClient);
});
test("nonzero native metadata output is rejected without copying its sensitive content into the error", async () => {
  const f = fixture({ stdout: "synthetic-private-native-content", status: "failed", exitCode: 1 });
  await assert.rejects(readClaudeMetadata("/synthetic/claude", "account", undefined, f.options), (e) => /bounded contract/.test(e.message) && !e.message.includes("synthetic-private-native-content")); assert.equal(f.resource.clients.size, 0);
});
