#!/usr/bin/env node
/** One synthetic, ephemeral text-only turn using the existing native login. */
import assert from "node:assert/strict";
import { createHash, randomUUID } from "node:crypto";
import { readFile, rm } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";
import { CodexClient, codexDesignConfig, readCodexMcpNames, trustedCli } from "../tools/layout-studio/agents.mjs";
import { runRestrictedCodexTurn } from "../tools/layout-studio/codex-turn.mjs";
import { stopOwnedChild } from "../tools/layout-studio/owned-process.mjs";
import { privateDirectory, privateWrite } from "../tools/layout-studio/private-fs.mjs";
import { createSuiteStore } from "../tools/layout-studio/suite-store.mjs";

if (process.platform !== "linux" || process.argv.length !== 3 || process.argv[2] !== "--synthetic") throw new Error("Usage on the pilot Linux host: node scripts/verify-codex-turn-host.mjs --synthetic (Personal must already allow Codex; submits one tiny ephemeral text-only prompt through its existing login)");
await createSuiteStore().authorize("personal", { provider: "codex" });
const directory = join(homedir(), ".local/state/strathex-switchyard/runtime-verification");
const root = join(directory, `codex-turn-${randomUUID()}`);
await privateDirectory(root);
const executable = await trustedCli("codex");
let client, turn, acknowledgement, nativeVersion, stopVerified = false;
const digest = (v) => createHash("sha256").update(v).digest("hex");
try {
  const names = await readCodexMcpNames(executable, root);
  client = new CodexClient(executable, root, names);
  await client.initialize(); nativeVersion = client.nativeVersion;
  const started = await client.request("thread/start", {
    cwd: root, ephemeral: true, sandbox: "read-only", approvalPolicy: "never", approvalsReviewer: "user",
    config: codexDesignConfig(names), serviceName: "switchyard-synthetic-turn-check",
    baseInstructions: "This is a synthetic text transport check. Return only the required JSON. Do not use tools, access files, browse or perform any other work."
  });
  assert.match(started.thread?.id ?? "", /^[A-Za-z0-9_-]{1,128}$/);
  assert.equal(started.sandbox?.type, "readOnly"); assert.equal(started.approvalPolicy, "never"); assert.equal(started.modelProvider, "openai");
  turn = await runRestrictedCodexTurn({
    client, threadId: started.thread.id, text: 'Return exactly {"message":"Ready"}.', maxOutputBytes: 2048,
    outputSchema: { type: "object", additionalProperties: false, required: ["message"], properties: { message: { type: "string", enum: ["Ready"] } } },
    onStarted: async (id) => { acknowledgement = id; }
  });
  assert.equal(turn.turnId, acknowledgement); assert.equal(turn.threadId, started.thread.id);
  assert.deepEqual(JSON.parse(turn.text), { message: "Ready" });
  assert.equal(turn.taskCompletionVerified, false); assert.equal(turn.nativeStatus, "completed");
} finally {
  if (client) { client.close(); stopVerified = (await stopOwnedChild(client.child)).stopped; }
  else stopVerified = true;
  if (stopVerified) await rm(root, { recursive: true, force: true });
}
assert.equal(stopVerified, true, "The exact owned native child did not verify exit; its private staging was retained.");
const sourceSha256 = {};
for (const path of ["agents.mjs", "codex-turn.mjs", "codex-requests.mjs"]) sourceSha256[path] = digest(await readFile(new URL(`../tools/layout-studio/${path}`, import.meta.url)));
const receipt = {
  schema: "switchyard-codex-restricted-turn/v1", at: new Date().toISOString(), platform: process.platform, nativeVersion, sourceSha256,
  cliSha256: digest(await readFile(executable)), existingFirstPartyLogin: true, accountStableBeforeAndAfter: true,
  requiredDisabledFeatureCount: Object.keys(codexDesignConfig().features).length, effectiveRootRestrictionsVerified: true,
  ephemeralThread: true, readOnlyThreadPermissionsVerified: true, exactAcknowledgementRetained: true,
  threadIdSha256: digest(turn.threadId), turnIdSha256: digest(turn.turnId), responseSchemaMatched: true,
  nativeTurnCompleted: true, taskCompletionVerified: false, toolActivityAccepted: false,
  ownedDirectChildExitVerified: stopVerified, privateStagingRemoved: true, windowsRuntimeAccepted: false
};
const path = join(directory, `codex-restricted-turn-${Date.now()}.json`);
await privateWrite(path, JSON.stringify(receipt, null, 2) + "\n");
console.log(JSON.stringify({ receipt: path, nativeVersion, responseSchemaMatched: true, ephemeralThread: true, ownedDirectChildExitVerified: true, taskCompletionVerified: false }));
