#!/usr/bin/env node
/** Real native metadata under guardians plus installed discovery; no model prompt. */
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdtemp, rm } from "node:fs/promises";
import { homedir, tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { applicationStateRoot, applicationStatus } from "../deployment/suite/application.mjs";
import { privateRead, privateWrite } from "../tools/layout-studio/private-fs.mjs";
import { createSuiteStore } from "../tools/layout-studio/suite-store.mjs";
import { createClaudeCoding } from "../tools/layout-studio/claude-coding.mjs";
import { runRuntimeCommand, runtimeGuardianStopped } from "../tools/layout-studio/runtime-command.mjs";
import { guardianScope } from "../tools/layout-studio/owned-native-command.mjs";
const [flag, expectedRelease] = process.argv.slice(2);
if (process.platform !== "linux" || flag !== "--read-only" || !/^[a-f0-9]{64}$/.test(expectedRelease ?? "") || process.argv.length !== 4) throw new Error("Usage: node scripts/verify-claude-commands-host.mjs --read-only EXPECTED_INSTALLED_RELEASE (native account/version/inventory only; no model prompt)");
assert.equal((await applicationStatus()).build, expectedRelease);
const endpoint = JSON.parse(await privateRead(join(applicationStateRoot(), "endpoint.json"))), url = new URL(endpoint.url), token = /^#access=([A-Za-z0-9_-]{43})$/.exec(url.hash)?.[1]; assert.ok(token && url.hostname === "127.0.0.1" && url.protocol === "http:");
const realStore = createSuiteStore(), selected = await realStore.selection(), digest = (v) => createHash("sha256").update(JSON.stringify(v)).digest("hex"), checks = [], frames = [], commands = [];
async function api(path) {
  const response = await fetch(new URL(`/api/suite/${path}`, url.origin), { method: "POST", redirect: "error", headers: { "Content-Type": "application/json", Origin: url.origin, Authorization: `Bearer ${token}` }, body: JSON.stringify({ compartment: "personal" }), signal: AbortSignal.timeout(60000) });
  assert.equal(response.status, 200, `Installed ${path} did not verify.`); return response.json();
}
const before = digest(await api("snapshot")), root = await mkdtemp(join(tmpdir(), "switchyard-native-metadata-")), keys = new Map();
const store = createSuiteStore({ root: join(root, "state"), secrets: { get: async (c, p) => keys.get(`${c}:${p}`), set: async (c, p, value) => { keys.set(`${c}:${p}`, value); } } });
await store.initialize("personal"); await store.initialize("work", "work"); await store.update("personal", "mode-select", (s) => { s.mode = "personal-companion"; });
const service = createClaudeCoding({ store, command: async (exe, args, options) => {
  assert.ok(args[0] === "--version" || args.join(" ") === "auth status --json" || args[0] === "agents" && args[1] === "--json"); commands.push(args[0]);
  return runRuntimeCommand(exe, args, { ...options, onGuardianReady: async (frame) => { frames.push(guardianScope(frame)); await options.onGuardianReady(frame); } });
} });
let failure;
try {
  const installed = await api("coding/claude/discovery"); assert.equal(installed.available, true); assert.equal(installed.permitted, true); checks.push("normal installed Claude discovery verifies the native supported version and account");
  assert.equal((await service.discovery("personal")).available, true); checks.push("actual native version and first-party account verified through supervised commands");
  const rows = await service.inventory("personal", { repositoryRoot: fileURLToPath(new URL("../", import.meta.url)) }); assert.ok(Array.isArray(rows)); checks.push("actual native inventory queried for the exact repository without exposing session content");
  assert.ok(frames.length >= 6); assert.equal(frames.length, commands.length); assert.equal(new Set(frames.map((f) => f.id)).size, frames.length);
  for (const frame of frames) assert.equal(await runtimeGuardianStopped(frame), true); checks.push("every distinct recorded native guardian independently verified stopped");
  const count = commands.length; assert.equal((await service.discovery("work")).permitted, false); assert.equal(commands.length, count); checks.push("Work policy rejected native metadata before launching a command");
  await service.close(); for (const frame of frames) assert.equal(await runtimeGuardianStopped(frame), true); checks.push("service shutdown verified all recorded guardians exited");
  assert.equal(digest(await api("snapshot")), before); assert.equal(await realStore.selection(), selected); assert.equal(JSON.parse(await privateRead(join(applicationStateRoot(), "endpoint.json"))).url, endpoint.url); assert.equal((await applicationStatus()).build, expectedRelease); checks.push("normal installed state, selection and private endpoint preserved");
} catch (error) { failure = error; }
finally { try { await service.close(); } catch (error) { failure ??= error; } await rm(root, { recursive: true, force: true }); keys.clear(); }
const path = join(homedir(), ".local/state/strathex-switchyard/runtime-verification", `installed-claude-commands-${Date.now()}.json`);
await privateWrite(path, JSON.stringify({ schema: "switchyard-installed-claude-commands/v1", at: new Date().toISOString(), applicationRelease: expectedRelease, checks, guardians: frames, nativeCommandCount: commands.length, temporaryStateRemoved: true, modelPromptSubmitted: false, backgroundTaskStarted: false, externalSessionsStopped: false, failure: failure?.message ?? null }, null, 2)+"\n");
console.log(JSON.stringify({ receipt: path, checks: checks.length, nativeCommandCount: commands.length, modelPromptSubmitted: false, temporaryStateRemoved: true, failure: failure?.message ?? null })); if (failure) throw failure;
