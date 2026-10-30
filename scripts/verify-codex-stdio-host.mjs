#!/usr/bin/env node
/** Read-only installed CLI check plus exact owned-native parent-loss verification. */
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { once } from "node:events";
import { randomUUID, createHash } from "node:crypto";
import { readFile, realpath, rm } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";
import { trustedCli } from "../tools/layout-studio/agents.mjs";
import { createSuiteStore } from "../tools/layout-studio/suite-store.mjs";
import { privateDirectory, privateWrite } from "../tools/layout-studio/private-fs.mjs";
import { desktopEnvironment } from "../tools/layout-studio/process-environment.mjs";
import { stopOwnedChild } from "../tools/layout-studio/owned-process.mjs";
if (process.platform !== "linux" || process.argv.length !== 3 || process.argv[2] !== "--read-only") throw new Error("Usage on the pilot Linux host: node scripts/verify-codex-stdio-host.mjs --read-only (Personal must already allow Codex; reads login/inventory, creates no thread and submits no model prompt)");
await createSuiteStore().authorize("personal", { provider: "codex" });
const directory = join(homedir(), ".local/state/strathex-switchyard/runtime-verification");
const root = join(directory, `stdio-parent-loss-${randomUUID()}`), executable = await trustedCli("codex");
await privateDirectory(root);
const versionChild = spawn(executable, ["--version"], { stdio: ["ignore", "pipe", "ignore"], env: desktopEnvironment() });
let version = ""; versionChild.stdout.on("data", (b) => { version += b; if (version.length > 4096) versionChild.kill(); });
const versionTimer = setTimeout(() => versionChild.kill(), 10000);
try { assert.equal((await once(versionChild, "close"))[0], 0); } finally { clearTimeout(versionTimer); }
const source = `
import { createSuiteStore } from ${JSON.stringify(new URL("../tools/layout-studio/suite-store.mjs", import.meta.url).href)};
import { createCodexStdioTasks } from ${JSON.stringify(new URL("../tools/layout-studio/codex-stdio-tasks.mjs", import.meta.url).href)};
import { CodexClient } from ${JSON.stringify(new URL("../tools/layout-studio/agents.mjs", import.meta.url).href)};
let owned;
const driver = createCodexStdioTasks({ store: createSuiteStore(), root: process.argv[1], resolveCli: async () => process.argv[2], clientFactory: (e,c,n) => { owned = new CodexClient(e,c,n); return owned; } });
const account = await driver.account("personal");
if (account.type !== "chatgpt" || !account.fingerprint) throw Error("The local login did not verify");
await driver.list("personal");
process.stdout.write(JSON.stringify({ pid: owned.child.pid }) + "\\n");
process.stdin.resume();
`;
const owner = spawn(process.execPath, ["--input-type=module", "-e", source, root, executable], { shell: false, stdio: ["pipe", "pipe", "ignore"], env: desktopEnvironment() });
async function processState(pid) {
  try { const s = await readFile(`/proc/${pid}/stat`, "utf8"), f = s.slice(s.lastIndexOf(") ") + 2).split(" "); return { state: f[0], birth: f[19] }; }
  catch (e) { if (e.code === "ENOENT") return null; throw e; }
}
let owned, exited = false, exitDelayMs;
try {
  owned = await new Promise((resolve, reject) => {
    let buffer = "", settled = false;
    const finish = (e, result) => { if (settled) return; settled = true; clearTimeout(timer); e ? reject(e) : resolve(result); };
    const timer = setTimeout(() => finish(new Error("The owned native readiness check timed out.")), 20000);
    owner.stdout.on("data", (chunk) => {
      buffer += chunk;
      if (buffer.length > 4096) { finish(new Error("The owned readiness frame exceeded its bound.")); return; }
      if (buffer.includes("\n")) { try { finish(null, JSON.parse(buffer.split("\n")[0])); } catch { finish(new Error("The owned readiness frame was invalid.")); } }
    });
    owner.once("error", () => finish(new Error("The exact owner could not start.")));
    owner.once("close", () => finish(new Error("The exact owner exited before readiness.")));
  });
  assert.ok(Number.isSafeInteger(owned.pid) && owned.pid > 1);
  assert.equal(await realpath(`/proc/${owned.pid}/exe`), executable);
  owned.birth = (await processState(owned.pid)).birth;
  const closed = once(owner, "close"); owner.kill("SIGKILL"); await closed;
  const started = Date.now();
  while (Date.now() - started < 10000) {
    const state = await processState(owned.pid);
    if (!state || state.state === "Z" || state.birth !== owned.birth) { exited = true; exitDelayMs = Date.now() - started; break; }
    await new Promise((r) => setTimeout(r, 30));
  }
  assert.equal(exited, true, "The exact owned native app-server did not exit after owner loss.");
} finally {
  await stopOwnedChild(owner);
  if (owned && !exited) { const s = await processState(owned.pid); if (s && s.state !== "Z" && s.birth === owned.birth) process.kill(owned.pid, "SIGKILL"); }
  // This exact UUID directory contains only this test's app-server cwd.
  await rm(root, { recursive: true, force: true });
}
const receipt = { schema: "switchyard-codex-stdio-parent-loss/v1", at: new Date().toISOString(), platform: process.platform, cliVersion: version.trim(), cliSha256: createHash("sha256").update(await readFile(executable)).digest("hex"), sourceSha256: createHash("sha256").update(await readFile(new URL("../tools/layout-studio/codex-stdio-tasks.mjs", import.meta.url))).digest("hex"), loginIdentified: true, metadataInventoryRead: true, parentKilled: "SIGKILL", ownedNativeExitVerified: true, exitDelayMs, modelPromptSubmitted: false, threadCreated: false, windowsRuntimeAccepted: false };
const path = join(directory, `codex-stdio-parent-loss-${Date.now()}.json`); await privateWrite(path, JSON.stringify(receipt, null, 2) + "\n");
console.log(JSON.stringify({ receipt: path, cliVersion: receipt.cliVersion, ownedNativeExitVerified: true, exitDelayMs, modelPromptSubmitted: false, threadCreated: false }));
