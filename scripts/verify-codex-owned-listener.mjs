#!/usr/bin/env node
/** Owned native listener metadata and parent-loss proof; never starts a thread. */
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { lstat, mkdtemp, open, readFile, readdir, readlink, realpath, rm, rmdir } from "node:fs/promises";
import { homedir, userInfo } from "node:os";
import { basename, dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { assertCodexDesignConfig, codexRestrictedProcessArguments, readCodexMcpNames, trustedCli } from "../tools/layout-studio/agents.mjs";
import { desktopEnvironment } from "../tools/layout-studio/process-environment.mjs";
import { directoryIdentity, privateDirectory, privateWrite } from "../tools/layout-studio/private-fs.mjs";
import { runtimeGuardianStopped } from "../tools/layout-studio/runtime-command.mjs";
import daemon from "../apps/vscode-extension/src/codex-daemon-status.cjs";

if (process.platform !== "linux" || process.argv.slice(2).join() !== "--read-only-parent-loss") throw Error("Use --read-only-parent-loss on the Linux pilot. Reads existing account/config metadata, then kills only its own listener owner. No thread, model turn or account change.");
const repo = resolve(dirname(fileURLToPath(import.meta.url)), ".."), uid = userInfo().uid;
const hash = bytes => createHash("sha256").update(bytes).digest("hex");
const marker = "/tmp/switchyard-codex-guardian-probe-path.json", markerFile = await open(marker, "wx", 0o600);
const evidence = { schema: "switchyard-owned-codex-guardian-proof/v1", success: false, threadCreated: false, modelPromptsSubmitted: 0, accountLoginLogoutOrSwitch: false, globalDaemonCommandUsed: false, frontendChanged: false, hardwareOpened: false, checks: [] };
let root, rootIdentity, owner, ownerClosed, guardian, socketPath, socketIdentity, socketParentIdentity, aliasIdentity, failure;
const delay = () => new Promise(resolve => setTimeout(resolve, 20));
async function checkpoint() { await markerFile.truncate(0); await markerFile.write(JSON.stringify({ root, rootIdentity, owner: evidence.owner, guardian, socketPath, socketIdentity, socketParentIdentity, aliasIdentity }), 0, "utf8"); await markerFile.sync(); }
async function identity(path) { const s = await lstat(path); return { device: String(s.dev), inode: String(s.ino), uid: s.uid, mode: s.mode }; }
async function processInfo(pid) {
  try { const s = await lstat(`/proc/${pid}`), text = await readFile(`/proc/${pid}/stat`, "utf8"), f = text.slice(text.lastIndexOf(")") + 2).split(" "); return { pid, uid: s.uid, birth: f[19], group: Number(f[2]), session: Number(f[3]), state: f[0] }; }
  catch (error) { if (["ENOENT", "ESRCH"].includes(error.code)) return null; throw error; }
}
async function waitFor(fn, message, timeout = 15000) {
  const end = Date.now() + timeout;
  while (Date.now() < end) { const value = await fn(); if (value) return value; await delay(); }
  throw Error(message);
}
async function socketEntries() { return (await readFile("/proc/net/unix", "utf8")).split("\n").map(line => line.trim().split(/\s+/)).filter(f => f.at(-1) === socketPath); }
async function groupMembers() {
  const result = [];
  for (const name of await readdir("/proc")) if (/^[1-9][0-9]*$/.test(name)) { const p = await processInfo(Number(name)); if (p && p.state !== "Z" && (p.group === guardian.guardianPid || p.session === guardian.guardianPid)) result.push(p); }
  return result;
}
try {
  const runtime = process.env.XDG_RUNTIME_DIR; assert.equal(typeof runtime, "string");
  const runtimeIdentity = await directoryIdentity(runtime); assert.equal(Number(runtimeIdentity.uid), uid); assert.equal(Number(runtimeIdentity.mode) & 0o077, 0);
  root = await mkdtemp(join(runtime, "syg-")); rootIdentity = await identity(root); await checkpoint();
  const executable = await trustedCli("codex"), executableSha256 = hash(await readFile(executable));
  assert.equal(executableSha256, "b8a11fedf24b2dfb59a70c9e52b030f9a508dcd49cd2dd0d41956f4c785156b8"); evidence.nativeExecutableSha256 = executableSha256;
  const names = await readCodexMcpNames(executable, root); evidence.disabledMcpCount = names.length;
  const endpoint = join(root, "s"); socketPath = join("/tmp", `codex-daemon-${uid}`, hash(endpoint));
  try { await lstat(socketPath); throw Error("The exact derived socket already exists; preserve its original owner."); } catch (error) { if (error.code !== "ENOENT") throw error; }
  const args = [...codexRestrictedProcessArguments(executable, names, { mode: "unix-listener", socketPath: endpoint }), "--startup-client-info", JSON.stringify({ name: "switchyard_design", title: "Switchyard design", version: "0.2.0" })];
  const wrapper = `import{runRuntimeCommand}from${JSON.stringify(new URL("../tools/layout-studio/runtime-command.mjs", import.meta.url).href)};let text="";for await(const b of process.stdin){text+=b;if(text.length>65536)throw Error("Oversized owned probe request");}const r=JSON.parse(text);await runRuntimeCommand(r.executable,r.args,{cwd:r.cwd,expectedExecutableSha256:r.sha,timeout:15000,maxOutputBytes:4096,detailed:true,onGuardianReady:f=>process.stdout.write(JSON.stringify({guardian:f})+"\\n")});`;
  owner = spawn(process.execPath, ["--input-type=module", "-e", wrapper], { cwd: repo, env: desktopEnvironment(), shell: false, stdio: ["pipe", "pipe", "pipe"] });
  ownerClosed = new Promise(resolve => { owner.once("error", resolve); owner.once("close", resolve); }); owner.stdin.on("error", () => {}); owner.stderr.resume();
  let buffer = "", protocolFailure = false;
  owner.stdout.setEncoding("utf8"); owner.stdout.on("data", chunk => {
    buffer += chunk; if (Buffer.byteLength(buffer) > 4096) { protocolFailure = true; return; }
    let end;
    while ((end = buffer.indexOf("\n")) >= 0) { try { const value = JSON.parse(buffer.slice(0, end)); if (guardian || !value.guardian) protocolFailure = true; else guardian = value.guardian; } catch { protocolFailure = true; } buffer = buffer.slice(end + 1); }
  });
  evidence.owner = await processInfo(owner.pid); assert.equal(evidence.owner.uid, uid); await checkpoint();
  owner.stdin.end(JSON.stringify({ executable, args, cwd: root, sha: executableSha256 }));
  await waitFor(async () => { if (protocolFailure || owner.exitCode !== null || owner.signalCode !== null) throw Error("Owned guardian readiness failed."); return guardian; }, "Owned guardian readiness timed out.");
  assert.equal(guardian.schema, "switchyard-runtime-command/v1"); assert.equal(guardian.containment, "owned-linux-session");
  const g = await processInfo(guardian.guardianPid); assert.equal(g.uid, uid); assert.equal(g.birth, guardian.birth); assert.equal(g.group, g.pid); assert.equal(g.session, g.pid); await checkpoint();
  await waitFor(async () => { try { return (await lstat(socketPath)).isSocket(); } catch (error) { if (error.code === "ENOENT") return false; throw error; } }, "Owned native listener readiness timed out.");
  socketIdentity = await identity(socketPath); socketParentIdentity = await identity(dirname(socketPath));
  assert.equal(socketIdentity.uid, uid); assert.equal(socketIdentity.mode & 0o077, 0); assert.equal(socketParentIdentity.uid, uid); assert.equal(socketParentIdentity.mode & 0o077, 0);
  assert.ok((await lstat(endpoint)).isSymbolicLink()); assert.equal(await readlink(endpoint), socketPath); aliasIdentity = await identity(endpoint); assert.equal(aliasIdentity.uid, uid);
  const entries = await socketEntries(); assert.equal(entries.length, 1);
  const members = await groupMembers(), holders = [];
  for (const p of members) {
    const links = await Promise.all((await readdir(`/proc/${p.pid}/fd`)).map(async fd => { try { return await readlink(`/proc/${p.pid}/fd/${fd}`); } catch (error) { if (["ENOENT", "ESRCH"].includes(error.code)) return null; throw error; } }));
    if (links.includes(`socket:[${entries[0][6]}]`)) holders.push(p);
  }
  assert.equal(holders.length, 1); assert.equal(await realpath(`/proc/${holders[0].pid}/exe`), executable); assert.equal(hash(await readFile(executable)), executableSha256);
  evidence.nativeServer = holders[0]; await checkpoint(); evidence.checks.push("exact private socket belongs to the pinned native executable in the owned guardian session");
  const config = await daemon.readCodexDaemonConfiguration(socketPath); assertCodexDesignConfig(config); evidence.effectiveConfigurationRestricted = true; evidence.checks.push("effective native Unix configuration retains all disabled tools, hooks, MCP entries and first-party route");
  const first = await daemon.readCodexDaemonAccount(socketPath), second = await daemon.readCodexDaemonAccount(socketPath);
  assert.equal(first.type, "chatgpt"); assert.match(first.fingerprint, /^[a-f0-9]{64}$/); assert.equal(first.fingerprint, second.fingerprint); evidence.matchingAccountReads = 2; evidence.checks.push("two read-only account snapshots match without a login, refresh, thread or model request");
  const original = await processInfo(owner.pid); assert.equal(original.birth, evidence.owner.birth); assert.equal(original.uid, uid); assert.equal(owner.exitCode, null); assert.equal(owner.signalCode, null);
  owner.kill("SIGKILL"); await ownerClosed; evidence.ownerKilledForParentLoss = true;
  await waitFor(() => runtimeGuardianStopped(guardian), "Owned guardian and native process exit is unconfirmed.", 5000); assert.deepEqual(await groupMembers(), []);
  evidence.parentLossTreeExitVerified = true; evidence.checks.push("abrupt owned parent loss independently retires guardian, native process and every owned session member");
} catch (error) { failure = error; evidence.failure = error.code === "ENOENT" ? "A required owned native identity was unavailable." : String(error.message).replaceAll(root ?? "[none]", "[owned root]").slice(0, 1000); }
finally {
  try {
    if (owner && owner.exitCode === null && owner.signalCode === null) { const current = await processInfo(owner.pid); assert.equal(current?.birth, evidence.owner?.birth); owner.kill("SIGKILL"); await ownerClosed; }
    if (guardian) { await waitFor(() => runtimeGuardianStopped(guardian), "Owned guardian cleanup is unconfirmed.", 5000); assert.deepEqual(await groupMembers(), []); evidence.guardianExitVerified = true; }
    if (socketIdentity) {
      assert.deepEqual(await identity(dirname(socketPath)), socketParentIdentity); assert.equal((await socketEntries()).length, 0);
      try { assert.deepEqual(await identity(socketPath), socketIdentity); assert.ok((await lstat(socketPath)).isSocket()); await rm(socketPath); } catch (error) { if (error.code !== "ENOENT") throw error; }
      evidence.ownedSocketRetired = true;
    }
    if (aliasIdentity) { const endpoint = join(root, "s"); try { assert.deepEqual(await identity(endpoint), aliasIdentity); assert.equal(await readlink(endpoint), socketPath); await rm(endpoint); } catch (error) { if (error.code !== "ENOENT") throw error; } evidence.ownedAliasRetired = true; }
    if (root && (!owner || evidence.guardianExitVerified)) { assert.deepEqual(await identity(root), rootIdentity); assert.deepEqual(await readdir(root), []); await rmdir(root); evidence.ownedRootRemoved = true; }
    if (evidence.ownedRootRemoved || !root) { await rm(marker); evidence.markerRemoved = true; }
  } catch (error) { failure ??= Error("Exact owned native cleanup is unconfirmed; preserve its marker and stage."); evidence.cleanupUnconfirmed = true; evidence.cleanupFailureCode = typeof error.code === "string" && /^[A-Z_]{1,40}$/.test(error.code) ? error.code : "IDENTITY_OR_INVENTORY_MISMATCH"; }
  await markerFile.close();
}
evidence.success = !failure;
const receipts = join(homedir(), ".local/state/strathex-switchyard/runtime-verification"); await privateDirectory(receipts);
const receipt = join(receipts, `codex-owned-guardian-${Date.now()}.json`); await privateWrite(receipt, JSON.stringify(evidence, null, 2) + "\n");
console.log(JSON.stringify({ receipt: basename(receipt), success: evidence.success, checks: evidence.checks.length, parentLossTreeExitVerified: evidence.parentLossTreeExitVerified ?? false, modelPromptsSubmitted: 0, threadCreated: false, failure: evidence.failure ?? (failure ? failure.message : null), cleanupUnconfirmed: evidence.cleanupUnconfirmed ?? false }));
if (failure) process.exitCode = 1;
