#!/usr/bin/env node
/** Native persistent provider lifetime proof. Configuration/account reads only. */
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { lstat, mkdtemp, open, readFile, readdir, rmdir, rm } from "node:fs/promises";
import { homedir, userInfo } from "node:os";
import { basename, join } from "node:path";
import { openOwnedCodexListener, retireStoppedCodexListener } from "../tools/layout-studio/codex-owned-listener.mjs";
import { readCodexMcpNames, trustedCli } from "../tools/layout-studio/agents.mjs";
import { directoryIdentity, privateDirectory, privateWrite } from "../tools/layout-studio/private-fs.mjs";
import { desktopEnvironment } from "../tools/layout-studio/process-environment.mjs";
import { runtimeGuardianStopped } from "../tools/layout-studio/runtime-command.mjs";
import { stopOwnedChild } from "../tools/layout-studio/owned-process.mjs";

if (process.platform !== "linux" || process.argv.slice(2).join() !== "--read-only-lifetime") throw Error("Use --read-only-lifetime on the Linux pilot. Opens two owned provider lifetimes, reads metadata, and kills only its own wrapper. No thread, turn, login change or global daemon command.");
const marker = "/tmp/switchyard-codex-owned-lifecycle-path.json", markerFile = await open(marker, "wx", 0o600);
const evidence = { schema: "switchyard-owned-codex-lifecycle-proof/v1", success: false, checks: [], threadsCreated: 0, modelPromptsSubmitted: 0, accountLoginLogoutOrSwitch: false, hardwareOpened: false, frontendChanged: false, globalDaemonCommandUsed: false };
let stage, stageIdentity, owner, wrapper, wrapperClosed, savedScope, savedOwnership, wrapperRetired = false, failure, protocolFailure = false;
async function identity(path) { const s = await lstat(path); return { device: String(s.dev), inode: String(s.ino), uid: s.uid, mode: s.mode }; }
async function checkpoint() { await markerFile.truncate(0); await markerFile.write(JSON.stringify({ stage, stageIdentity, scope: owner?.scope ?? savedScope, ownership: owner?.privateOwnership ?? savedOwnership, wrapperPid: wrapper?.pid }), 0, "utf8"); await markerFile.sync(); }
async function waitFor(check, timeout = 15000) { const end = Date.now() + timeout; while (Date.now() < end) { if (protocolFailure) throw Error("The owned lifetime proof frame did not verify."); const value = await check(); if (value) return value; await new Promise(resolve => setTimeout(resolve, 20)); } throw Error("The bounded owned provider checkpoint did not settle."); }
async function gone(pid) { try { const text = await readFile(`/proc/${pid}/stat`, "utf8"); return text.slice(text.lastIndexOf(")") + 2).split(" ")[0] === "Z"; } catch (error) { if (["ENOENT", "ESRCH"].includes(error.code)) return true; throw error; } }
try {
  const runtime = process.env.XDG_RUNTIME_DIR, runtimeIdentity = await directoryIdentity(runtime); assert.equal(Number(runtimeIdentity.uid), userInfo().uid); assert.equal(Number(runtimeIdentity.mode) & 0o077, 0);
  stage = await mkdtemp(join(runtime, "syp-")); stageIdentity = await identity(stage); await checkpoint();
  const executable = await trustedCli("codex"), executableSha256 = createHash("sha256").update(await readFile(executable)).digest("hex");
  assert.equal(executableSha256, "b8a11fedf24b2dfb59a70c9e52b030f9a508dcd49cd2dd0d41956f4c785156b8"); evidence.nativeExecutableSha256 = executableSha256;
  const serverNames = await readCodexMcpNames(executable, stage); evidence.disabledMcpCount = serverNames.length;
  owner = await openOwnedCodexListener({ executable, cwd: stage, runtimeRoot: stage, serverNames, onOwner: value => { owner = value; return checkpoint(); }, onReady: async scope => { assert.equal(scope.containment, "owned-linux-session"); await checkpoint(); evidence.guardianRecordedBeforeStart = true; } }); await checkpoint();
  evidence.checks.push("original private directory and exact guardian were recorded before the fixed native CLI startup acknowledgement");
  const first = await owner.connect(), second = await owner.connect();
  assert.equal(first.nativeVersion, "0.166.0"); assert.equal(second.nativeVersion, "0.166.0"); assert.equal(first.restrictionsVerified, true); assert.equal(second.restrictionsVerified, true);
  assert.equal(await first.recheckAccount(), await second.recheckAccount()); assert.equal(owner.accountFingerprint, first.accountFingerprint); assert.ok(owner.binding);
  evidence.nativeReadOnlyAccountRequests = first.sequence + second.sequence - 4; evidence.twoPersistentConnectionsVerified = true; evidence.checks.push("two kernel-pinned persistent clients verify effective restrictions and the same original account without selecting a task or sending a model turn");
  const originalScope = owner.scope, originalOwnership = owner.privateOwnership; const stopped = await owner.stop(); assert.equal(stopped.stopped, true); assert.equal(await runtimeGuardianStopped(originalScope), true); assert.equal(await gone(originalScope.guardianPid), true);
  evidence.normalStopVerified = true; evidence.normalOwnershipRetired = true; owner = null; await checkpoint(); assert.equal((await readdir(stage)).length, 0);
  evidence.checks.push("normal stop independently retires the guardian, both bridges and only the exact socket, alias and private directory");
  const code = `import{openOwnedCodexListener}from${JSON.stringify(new URL("../tools/layout-studio/codex-owned-listener.mjs", import.meta.url).href)};let text="";for await(const b of process.stdin){text+=b;if(text.length>32768)throw Error("Oversized proof input");}const r=JSON.parse(text);let owner;const emit=event=>console.log(JSON.stringify({schema:"switchyard-owned-provider-proof/v1",event,scope:owner?.scope,ownership:owner?.privateOwnership}));try{owner=await openOwnedCodexListener({executable:r.executable,cwd:r.stage,runtimeRoot:r.stage,serverNames:r.serverNames,onOwner:value=>{owner=value;emit("owner");},onReady:()=>emit("prepared")});const c=await owner.connect();console.log(JSON.stringify({schema:"switchyard-owned-provider-proof/v1",event:"running",scope:owner.scope,ownership:owner.privateOwnership,binding:owner.binding,bridgePid:c.child.pid}));}catch{await owner?.stop();process.exit(2);}`;
  wrapper = spawn(process.execPath, ["--input-type=module", "-e", code], { env: desktopEnvironment(), shell: false, stdio: ["pipe", "pipe", "ignore"] });
  wrapperClosed = new Promise(resolve => { wrapper.once("error", resolve); wrapper.once("close", resolve); }); wrapper.stdin.on("error", () => {});
  let buffer = "", received = 0, running;
  wrapper.stdout.setEncoding("utf8"); wrapper.stdout.on("data", chunk => {
    received += Buffer.byteLength(chunk); if (received > 8192) { protocolFailure = true; return; } buffer += chunk; let end;
    while ((end = buffer.indexOf("\n")) >= 0) {
      try { const value = JSON.parse(buffer.slice(0, end)); assert.equal(value.schema, "switchyard-owned-provider-proof/v1"); assert.ok(["owner", "prepared", "running"].includes(value.event)); savedScope = value.scope ?? savedScope; savedOwnership = value.ownership ?? savedOwnership; if (value.event === "running") running = value; }
      catch { protocolFailure = true; }
      buffer = buffer.slice(end + 1);
    }
  });
  wrapper.stdin.end(JSON.stringify({ stage, executable, serverNames }));
  const active = await waitFor(() => { if (wrapper.exitCode !== null || wrapper.signalCode !== null) throw Error("The owned wrapper exited before its running checkpoint."); return running; }); await checkpoint();
  assert.ok(active.binding); wrapper.kill("SIGKILL"); await wrapperClosed;
  await waitFor(() => runtimeGuardianStopped(savedScope), 5000); for (const pid of [active.binding.peerPid, active.bridgePid]) await waitFor(() => gone(pid), 5000);
  assert.equal((await retireStoppedCodexListener(savedScope, savedOwnership)).stopped, true); wrapperRetired = true; evidence.parentLossTreeExitVerified = true; evidence.savedOwnershipRetired = true;
  evidence.checks.push("abrupt owned parent loss stops the native listener and bridge, and saved exact identities permit retirement only after independent session exit");
} catch (error) { failure = error; evidence.failure = String(error.message).replaceAll(stage ?? "[none]", "[owned stage]").slice(0, 1000); }
finally {
  let clean = true;
  if (owner) try { const result = await owner.stop(); if (!result.stopped) clean = false; } catch { clean = false; }
  if (wrapper) {
    if (!(await stopOwnedChild(wrapper)).stopped) clean = false;
    if (!wrapperRetired && savedScope && savedOwnership) try { await waitFor(() => runtimeGuardianStopped(savedScope), 5000); assert.equal((await retireStoppedCodexListener(savedScope, savedOwnership)).stopped, true); wrapperRetired = true; } catch { clean = false; }
    else if (!wrapperRetired && savedOwnership) clean = false;
  }
  if (clean && stage) try { assert.deepEqual(await identity(stage), stageIdentity); assert.deepEqual(await readdir(stage), []); await rmdir(stage); evidence.ownedStageRemoved = true; await rm(marker); evidence.markerRemoved = true; } catch { clean = false; }
  await markerFile.close(); if (!clean) { failure ??= Error("The exact owned lifetime cleanup is unconfirmed; preserve its marker and stage."); evidence.cleanupUnconfirmed = true; }
}
evidence.success = !failure;
const receipts = join(homedir(), ".local/state/strathex-switchyard/runtime-verification"); await privateDirectory(receipts);
const receipt = join(receipts, `codex-owned-lifecycle-${Date.now()}.json`); await privateWrite(receipt, JSON.stringify(evidence, null, 2) + "\n");
console.log(JSON.stringify({ receipt: basename(receipt), success: evidence.success, checks: evidence.checks.length, twoPersistentConnectionsVerified: evidence.twoPersistentConnectionsVerified ?? false, parentLossTreeExitVerified: evidence.parentLossTreeExitVerified ?? false, threadsCreated: 0, modelPromptsSubmitted: 0, cleanupUnconfirmed: evidence.cleanupUnconfirmed ?? false, failure: evidence.failure ?? (failure ? failure.message : null) }));
if (failure) process.exitCode = 1;
