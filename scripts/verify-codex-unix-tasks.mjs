#!/usr/bin/env node
/** Actual task-adapter account metadata; no native thread, turn or login mutation. */
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { lstat, mkdtemp, open, readFile, readdir, rmdir, rm } from "node:fs/promises";
import { homedir, userInfo } from "node:os";
import { basename, join } from "node:path";
import { createCodexUnixTasks } from "../tools/layout-studio/codex-unix-tasks.mjs";
import { openOwnedCodexListener } from "../tools/layout-studio/codex-owned-listener.mjs";
import { readCodexMcpNames, trustedCli } from "../tools/layout-studio/agents.mjs";
import { directoryIdentity, privateDirectory, privateWrite } from "../tools/layout-studio/private-fs.mjs";
import { runtimeGuardianStopped } from "../tools/layout-studio/runtime-command.mjs";

if (process.platform !== "linux" || process.argv.slice(2).join() !== "--read-only-account") throw Error("Use --read-only-account on Linux. Verifies one owned task adapter using native account/configuration reads only; no thread, model turn or login mutation.");
const marker = "/tmp/switchyard-codex-unix-tasks-path.json", markerFile = await open(marker, "wx", 0o600);
const evidence = { schema: "switchyard-owned-codex-task-adapter-proof/v1", success: false, checks: [], authorization: "explicit verifier-only compartment fence; production store composition separately tested", threadsCreated: 0, modelPromptsSubmitted: 0, accountLoginLogoutOrSwitch: false, hardwareOpened: false, frontendChanged: false };
let stage, stageIdentity, owner, driver, permitted = true, failure;
async function identity(path) { const s = await lstat(path); return { device: String(s.dev), inode: String(s.ino), uid: s.uid, mode: s.mode }; }
async function checkpoint() { await markerFile.truncate(0); await markerFile.write(JSON.stringify({ stage, stageIdentity, scope: owner?.scope, ownership: owner?.privateOwnership }), 0, "utf8"); await markerFile.sync(); }
try {
  const runtime = process.env.XDG_RUNTIME_DIR, stat = await directoryIdentity(runtime); assert.equal(Number(stat.uid), userInfo().uid); assert.equal(Number(stat.mode) & 0o077, 0);
  stage = await mkdtemp(join(runtime, "syt-")); stageIdentity = await identity(stage); await checkpoint();
  const executable = await trustedCli("codex"), digest = createHash("sha256").update(await readFile(executable)).digest("hex");
  assert.equal(digest, "b8a11fedf24b2dfb59a70c9e52b030f9a508dcd49cd2dd0d41956f4c785156b8"); evidence.nativeExecutableSha256 = digest;
  const names = await readCodexMcpNames(executable, stage); evidence.disabledMcpCount = names.length;
  const store = { async authorize(compartment, options) { assert.equal(compartment, "personal"); assert.deepEqual(options, { provider: "codex" }); if (!permitted) throw Error("Verifier compartment revoked"); } };
  driver = createCodexUnixTasks({ store, root: join(stage, "tasks"), runtimeRoot: stage, resolveCli: async () => executable, resolveMcp: async () => names,
    openListener: input => openOwnedCodexListener({ ...input, onOwner: async value => { owner = value; input.onOwner(value); await checkpoint(); } }),
    onReady: async (compartment, scope) => { assert.equal(compartment, "personal"); assert.equal(scope.containment, "owned-linux-session"); await checkpoint(); evidence.guardianRecordedBeforeStart = true; }
  });
  const first = await driver.account("personal"), second = await driver.account("personal");
  assert.equal(first.type, "chatgpt"); assert.match(first.fingerprint, /^[a-f0-9]{64}$/); assert.deepEqual(second, first); assert.equal(owner.accountFingerprint, first.fingerprint); assert.ok(owner.binding);
  evidence.checks.push("the task adapter reuses one restricted native lifetime and its exact kernel-pinned account for two metadata operations"); await checkpoint();
  permitted = false; await assert.rejects(driver.account("personal"), /Verifier compartment revoked/);
  evidence.checks.push("fresh compartment revocation rejects another task metadata operation without changing native login state");
  const scope = owner.scope; assert.equal((await driver.stopCompartment("personal")).stopped, true); assert.equal(await runtimeGuardianStopped(scope), true); assert.equal(owner.binding, null);
  evidence.checks.push("task shutdown independently retires its listener, bridge, private socket and alias");
} catch (error) { failure = error; evidence.failure = String(error.message).replaceAll(stage ?? "[none]", "[owned stage]").slice(0, 1000); }
finally {
  let clean = true;
  try { if (driver && !(await driver.close()).every(value => value.stopped)) clean = false; if (owner && !(await owner.stop()).stopped) clean = false; } catch { clean = false; }
  if (clean && stage) try {
    assert.deepEqual(await identity(stage), stageIdentity);
    for (const path of [join(stage, "tasks/personal"), join(stage, "tasks"), stage]) {
      try { assert.deepEqual(await readdir(path), []); await rmdir(path); } catch (error) { if (error.code !== "ENOENT") throw error; }
    }
    evidence.ownedStageRemoved = true; await rm(marker); evidence.markerRemoved = true;
  } catch { clean = false; }
  await markerFile.close(); if (!clean) { evidence.cleanupUnconfirmed = true; failure ??= Error("Exact task-adapter cleanup is unconfirmed; preserve its marker and stage."); }
}
evidence.success = !failure;
const receipts = join(homedir(), ".local/state/strathex-switchyard/runtime-verification"); await privateDirectory(receipts);
const receipt = join(receipts, `codex-unix-tasks-${Date.now()}.json`); await privateWrite(receipt, JSON.stringify(evidence, null, 2) + "\n");
console.log(JSON.stringify({ receipt: basename(receipt), success: evidence.success, checks: evidence.checks.length, threadsCreated: 0, modelPromptsSubmitted: 0, cleanupUnconfirmed: evidence.cleanupUnconfirmed ?? false, failure: evidence.failure ?? (failure ? failure.message : null) }));
if (failure) process.exitCode = 1;
