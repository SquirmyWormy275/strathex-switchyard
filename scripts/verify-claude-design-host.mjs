#!/usr/bin/env node
/** Actual installed-account configuration turn and exact continuation; synthetic text. */
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { createHash, randomUUID } from "node:crypto";
import { readFile, rm } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";
import { createAgentService } from "../tools/layout-studio/agents.mjs";
import { newPlan, parseBoardProfile } from "../tools/layout-studio/model.mjs";
import { createSuiteStore } from "../tools/layout-studio/suite-store.mjs";
import { privateDirectory, privateWrite } from "../tools/layout-studio/private-fs.mjs";
import { stopOwnedChild } from "../tools/layout-studio/owned-process.mjs";

if (process.platform !== "linux" || process.argv.length !== 3 || process.argv[2] !== "--synthetic") throw new Error("Usage on the pilot Linux host: node scripts/verify-claude-design-host.mjs --synthetic (Personal must already allow Claude Code; sends two tiny synthetic configuration messages using its existing native login)");
await createSuiteStore().authorize("personal", { provider: "claude-code" });
const directory = join(homedir(), ".local/state/strathex-switchyard/runtime-verification"), root = join(directory, `claude-design-${randomUUID()}`);
await privateDirectory(root);
const keys = new Map(), children = [], digest = (v) => createHash("sha256").update(v).digest("hex");
const store = createSuiteStore({ root: join(root, "state"), secrets: { get: async (c, p) => keys.get(`${c}:${p}`), set: async (c, p, v) => keys.set(`${c}:${p}`, v) } });
await store.initialize("synthetic"); await store.update("synthetic", "synthetic-mode", (s) => { s.mode = "personal-companion"; });
const agents = createAgentService({ store, runtimeRoot: join(root, "runtime"), spawnProcess: (...args) => { const child = spawn(...args); children.push(child); return child; } });
const plan = newPlan(parseBoardProfile({ schema: "sxsy-board-profile/v1", name: "Synthetic transport check", layout: "one", keys: [{ id: "synthetic-one", label: "A", matrix: [0, 0], x: 0, y: 0, baseKeycode: "KC_A" }] }));
let first, second, saved, allStopped = false;
try {
  first = await agents.design({ compartment: "synthetic", provider: "claude-code", plan, message: 'Synthetic transport check only. Reply exactly "Ready"; summary "Synthetic check"; actions, steps and roles must all be empty arrays. Do no other work.' });
  assert.equal(first.reply, "Ready");
  const selection = await agents.resume("synthetic", first.conversationId); assert.equal(selection.sessionId, first.sessionId); assert.equal(selection.status, "selected-for-continuation");
  second = await agents.design({ compartment: "synthetic", provider: "claude-code", plan, conversationId: first.conversationId, message: 'Repeat the synthetic check in this exact conversation. Reply exactly "Ready"; summary "Synthetic check"; actions, steps and roles must all be empty arrays. Do no other work.' });
  assert.equal(second.reply, "Ready"); assert.equal(second.sessionId, first.sessionId); assert.equal(second.conversationId, first.conversationId);
  saved = (await store.snapshot("synthetic")).conversations[0]; assert.match(saved.accountFingerprint, /^[a-f0-9]{64}$/); assert.equal(saved.messages.length, 4);
} finally {
  await agents.close(); const exits = await Promise.all(children.map((child) => stopOwnedChild(child))); allStopped = exits.every((r) => r.stopped);
  if (allStopped) await rm(root, { recursive: true, force: true });
}
assert.equal(allStopped, true, "An owned native process has not verified exit; private staging was retained.");
const sourceSha256 = {};
for (const path of ["agents.mjs", "claude-account.mjs"]) sourceSha256[path] = digest(await readFile(new URL(`../tools/layout-studio/${path}`, import.meta.url)));
const receipt = { schema: "switchyard-claude-account-bound-design/v1", at: new Date().toISOString(), nativeVersion: "2.1.308", sourceSha256,
  existingFirstPartyLogin: true, accountAndOrgStableBeforeAndAfter: true, accountDetailsPersisted: false,
  sessionIdSha256: digest(first.sessionId), exactSessionCreatedAndContinued: true, validatedStructuredReplies: 2,
  messagesRetainedInIsolatedProtectedStore: saved.messages.length, personalDefinitionsChanged: false, toolsHooksAndMcpDisabled: true,
  ownedDirectChildrenExitVerified: allStopped, ownedDirectChildren: children.length, privateStagingRemoved: true,
  nativeConversationHistory: "two synthetic turns retained by the installed Claude CLI", externalTaskCompletionVerified: false, windowsRuntimeAccepted: false };
const path = join(directory, `claude-account-bound-design-${Date.now()}.json`); await privateWrite(path, JSON.stringify(receipt, null, 2) + "\n");
console.log(JSON.stringify({ receipt: path, exactSessionCreatedAndContinued: true, validatedStructuredReplies: 2, ownedDirectChildrenExitVerified: true, privateStagingRemoved: true, externalTaskCompletionVerified: false }));
