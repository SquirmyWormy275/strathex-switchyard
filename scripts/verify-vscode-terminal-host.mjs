#!/usr/bin/env node
/** Real VS Code API proof; two cat terminals, no providers, no user profile changes. */
import assert from "node:assert/strict";
import { createHash, randomUUID } from "node:crypto";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { copyFile, lstat, mkdir, mkdtemp, readFile, readdir, realpath, rm, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { desktopEnvironment } from "../tools/layout-studio/process-environment.mjs";
import { linuxProcess } from "../tools/layout-studio/native-process.mjs";
import { runHypr } from "../tools/layout-studio/host.mjs";
import { privateDirectory, privateWrite } from "../tools/layout-studio/private-fs.mjs";

if (process.platform !== "linux" || process.argv.length !== 3 || process.argv[2] !== "--synthetic-terminal-selection") throw Error("Use on the Linux pilot after npm run build:vscode: node scripts/verify-vscode-terminal-host.mjs --synthetic-terminal-selection. Opens one disposable empty editor window and two cat terminals; no model prompt, terminal text, account or hardware request is made.");
const repo = resolve(dirname(fileURLToPath(import.meta.url)), ".."), execute = promisify(execFile);
const command = async (exe, args) => (await execute(exe, args, { timeout: 15_000, maxBuffer: 524288, encoding: "utf8" })).stdout;
const hash = bytes => createHash("sha256").update(bytes).digest("hex"), nonce = randomUUID();
const helper = join(repo, "apps/vscode-extension/dist/apps/vscode-extension/src/terminal-focus.js");
const helperBytes = await readFile(helper), helperSha256 = hash(helperBytes);
const originalWindow = JSON.parse(await runHypr("activewindow", "-j"));
const existingWindows = new Set(JSON.parse(await runHypr("clients", "-j")).map(window => window.address));
assert.match(originalWindow.address, /^0x[0-9a-f]+$/i);
const originalProcess = await linuxProcess(originalWindow.pid), uid = process.getuid(); assert.equal(originalProcess.uid, uid);
const stage = await mkdtemp(join(homedir(), ".cache/switchyard-vscode-selection-")), stageIdentity = await lstat(stage);
const unit = "switchyard-vscode-selection-" + nonce + ".service", captured = new Map();
const evidence = { schema: "switchyard-native-vscode-terminal-proof/v1", at: new Date().toISOString(), helperSha256, modelPromptsSubmitted: 0, terminalTextSubmitted: false, frontendChanged: false, userEditorProfileChanged: false, workspaceTrustBypassed: false, checks: [] };
let started = false, failure;
async function waitFile(name, timeoutMs = 60_000) {
  const deadline = Date.now() + timeoutMs;
  while (true) {
    try { const bytes = await readFile(join(stage, name)); assert.ok(bytes.length <= 65536); return JSON.parse(bytes); }
    catch (error) { if (error.code !== "ENOENT") throw error; }
    assert.ok(Date.now() < deadline, "The owned editor proof did not reach its bounded file checkpoint.");
    await new Promise(resolve => setTimeout(resolve, 100));
  }
}
async function unitPids(name) {
  const group = (await command("/usr/bin/systemctl", ["--user", "show", "--property=ControlGroup", "--value", name])).trim();
  assert.ok(group.startsWith("/user.slice/") && group.endsWith("/" + name), "The exact owned unit must retain its cgroup.");
  const pending = ["/sys/fs/cgroup" + group], pids = new Set(); let visited = 0;
  while (pending.length) {
    assert.ok(++visited <= 128, "The owned cgroup inventory exceeded its explicit bound."); const directory = pending.shift();
    for (const value of (await readFile(join(directory, "cgroup.procs"), "utf8")).split(/\s+/u).filter(Boolean)) { assert.match(value, /^[1-9][0-9]{0,9}$/); pids.add(Number(value)); }
    for (const entry of await readdir(directory, { withFileTypes: true })) if (entry.isDirectory()) pending.push(join(directory, entry.name));
  }
  return pids;
}
async function capture() {
  const pids = new Set();
  for (const pid of await unitPids(unit)) pids.add(pid);
  for (const pid of pids) try { const p = await linuxProcess(pid); assert.equal(p.uid, uid); if (captured.has(pid)) assert.equal(p.startTicks, captured.get(pid)); else captured.set(pid, p.startTicks); } catch (error) { if (!["ENOENT", "ESRCH"].includes(error.code)) throw error; }
  return pids;
}

try {
  const extension = join(stage, "fixture"); await mkdir(extension, { mode: 0o700 }); await mkdir(join(stage, "profile", "User"), { recursive: true, mode: 0o700 }); await mkdir(join(stage, "extensions"), { mode: 0o700 });
  await copyFile(new URL("./fixtures/vscode-terminal-selection.cjs", import.meta.url), join(extension, "extension.cjs"));
  await writeFile(join(extension, "terminal-focus.cjs"), helperBytes, { flag: "wx", mode: 0o600 });
  await writeFile(join(extension, "package.json"), JSON.stringify({ name: "switchyard-terminal-selection-proof", publisher: "switchyard-local-proof", version: "0.0.0", engines: { vscode: "^1.85.0" }, activationEvents: ["onStartupFinished"], main: "./extension.cjs" }), { flag: "wx", mode: 0o600 });
  await writeFile(join(extension, "proof.json"), JSON.stringify({ stage, nonce, helperSha256 }), { flag: "wx", mode: 0o600 });
  await writeFile(join(stage, "profile", "User", "settings.json"), JSON.stringify({ "telemetry.telemetryLevel": "off", "update.mode": "none", "extensions.autoCheckUpdates": false, "extensions.autoUpdate": false, "workbench.startupEditor": "none", "terminal.integrated.shellIntegration.enabled": false }), { flag: "wx", mode: 0o600 });
  const env = { ...desktopEnvironment(), XDG_CACHE_HOME: join(stage, "cache") };
  started = true;
  await command("/usr/bin/systemd-run", ["--user", "--expand-environment=no", "--unit=" + unit, "--collect", "--property=KillMode=control-group", "--property=RuntimeMaxSec=180", "/usr/bin/env", "-i", ...Object.entries(env).map(([key, value]) => key + "=" + value), "/usr/share/code/code", "--new-window", "--user-data-dir", join(stage, "profile"), "--extensions-dir", join(stage, "extensions"), "--disable-extensions", "--extensionDevelopmentPath=" + extension, "--skip-welcome", "--skip-release-notes", "--ozone-platform=wayland"]);
  const ready = await waitFile("ready.json"); assert.equal(ready.nonce, nonce); assert.equal(ready.processIds.length, 2); assert.notEqual(...ready.processIds);
  const owned = await capture(); const cat = await realpath("/usr/bin/cat");
  evidence.terminalOwnership = [];
  for (const pid of ready.processIds) {
    const p = await linuxProcess(pid); assert.equal(p.uid, uid); assert.equal(p.executable, cat); assert.equal(p.cwd, stage); assert.notEqual(p.state, "Z");
    if (captured.has(pid)) assert.equal(captured.get(pid), p.startTicks); else captured.set(pid, p.startTicks);
    evidence.terminalOwnership.push({ currentUser: true, catExecutable: true, uniquePrivateDirectory: true, protectedFixtureNonceAndApiPid: true, birthIdentityPinned: true, sameLauncherCgroup: owned.has(pid) });
  }
  evidence.checks.push("both protected fixture API terminal IDs independently match current-user cat processes and their unique private directory; exact native birth identities are pinned");
  let windows = []; const windowDeadline = Date.now() + 15_000;
  while (true) {
    const currentOwned = await capture(), clients = JSON.parse(await runHypr("clients", "-j"));
    windows = clients.filter(window => !existingWindows.has(window.address) && ["code", "com.microsoft.VSCode"].includes(window.initialClass) && window.mapped === true && window.hidden === false && /^0x[0-9a-f]+$/i.test(window.address));
    if (windows.length === 1) break;
    evidence.windowReadiness = clients.filter(window => ["code", "com.microsoft.VSCode"].includes(window.initialClass)).map(window => ({ preexisting: existingWindows.has(window.address), launcherCgroupPid: currentOwned.has(window.pid), mapped: window.mapped, hidden: window.hidden }));
    assert.ok(Date.now() < windowDeadline, "The exact owned editor window did not become uniquely mapped within its readiness bound.");
    await new Promise(resolve => setTimeout(resolve, 100));
  }
  const window = windows[0], identity = await linuxProcess(window.pid); assert.equal(identity.uid, uid); assert.equal(identity.executable, "/usr/share/code/code");
  if (captured.has(identity.pid)) assert.equal(captured.get(identity.pid), identity.startTicks); else captured.set(identity.pid, identity.startTicks);
  assert.equal((await runHypr("dispatch", `hl.dsp.focus({ window = "address:${window.address}" })`)).trim(), "ok");
  const focused = JSON.parse(await runHypr("activewindow", "-j")); assert.equal(focused.address, window.address); assert.equal(focused.pid, window.pid); assert.equal((await linuxProcess(window.pid)).startTicks, identity.startTicks);
  await writeFile(join(stage, "proceed"), nonce, { flag: "wx", mode: 0o600 });
  const result = await waitFile("result.json", 30_000); assert.equal(result.nonce, nonce); assert.equal(result.helperSha256, helperSha256); evidence.apiChecks = result.checks; if (result.failure) evidence.apiFailure = result.failure; assert.equal(result.success, true);
  assert.equal((await linuxProcess(window.pid)).startTicks, identity.startTicks);
  evidence.newNativeWindowAndProtectedExtensionFocusReadback = true;
  evidence.checks.push("the compiled source passes all three real VS Code object-selection and closure checks in the exact focused native window");
} catch (error) { failure = error; evidence.failure = { category: error.name, message: String(error.message).replaceAll(stage, "[owned staging]").slice(0, 512) }; }
finally {
  const safely = async (name, fn) => { try { await fn(); } catch (error) { failure ??= error; (evidence.cleanupFailures ??= []).push({ name, category: error.name }); } };
  if (started) {
    await safely("capture-owned-unit", capture);
    await safely("stop-owned-unit", () => command("/usr/bin/systemctl", ["--user", "stop", unit]));
    await safely("verify-owned-exit", async () => {
      assert.ok(captured.size > 0);
      for (const [pid, birth] of captured) {
        let gone = false; const deadline = Date.now() + 5000;
        while (Date.now() < deadline) { try { const p = await linuxProcess(pid); if (p.startTicks !== birth || p.state === "Z") { gone = true; break; } } catch (error) { if (["ENOENT", "ESRCH"].includes(error.code)) { gone = true; break; } throw error; } await new Promise(resolve => setTimeout(resolve, 50)); }
        assert.equal(gone, true, "The exact owned fixture process did not verify exit.");
      }
      evidence.ownedProcessExitsVerified = captured.size;
    });
  }
  await safely("restore-original-focus", async () => {
    assert.equal((await linuxProcess(originalProcess.pid)).startTicks, originalProcess.startTicks);
    const clients = JSON.parse(await runHypr("clients", "-j")); assert.ok(clients.some(window => window.address === originalWindow.address && window.pid === originalProcess.pid));
    assert.equal((await runHypr("dispatch", `hl.dsp.focus({ window = "address:${originalWindow.address}" })`)).trim(), "ok");
    const current = JSON.parse(await runHypr("activewindow", "-j")); assert.equal(current.address, originalWindow.address); assert.equal(current.pid, originalProcess.pid); evidence.originalFocusRestored = true;
  });
  if (!failure && evidence.ownedProcessExitsVerified) await safely("remove-owned-profile", async () => {
    const current = await lstat(stage); assert.equal(current.dev, stageIdentity.dev); assert.equal(current.ino, stageIdentity.ino); await rm(stage, { recursive: true }); evidence.ownedProfileRemoved = true;
  });
}
evidence.success = !failure;
const receipts = join(homedir(), ".local/state/strathex-switchyard/runtime-verification"); await privateDirectory(receipts);
const name = "native-vscode-terminal-" + Date.now() + ".json"; await privateWrite(join(receipts, name), JSON.stringify(evidence, null, 2) + "\n");
console.log(JSON.stringify({ success: evidence.success, receipt: name, checks: evidence.checks.length, apiChecks: evidence.apiChecks?.length ?? 0, ownedProcessExitsVerified: evidence.ownedProcessExitsVerified ?? 0, originalFocusRestored: evidence.originalFocusRestored ?? false, ownedProfileRemoved: evidence.ownedProfileRemoved ?? false, failure: evidence.failure ?? null })); if (failure) process.exitCode = 1;
