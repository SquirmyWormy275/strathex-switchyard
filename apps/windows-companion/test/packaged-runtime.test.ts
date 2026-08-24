import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { access, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import test from "node:test";
import { AuthenticatedLocalPipeTransport, JsonLineCompanionBridge, readLocalCompanionConfiguration } from "../../vscode-extension/src/companion-bridge.ts";

async function waitFor(path: string, milliseconds = 10_000): Promise<void> {
  const deadline = Date.now() + milliseconds;
  while (true) {
    try { await access(path); return; } catch { if (Date.now() >= deadline) throw new Error("The packaged companion did not create its local configuration."); await new Promise((done) => setTimeout(done, 25)); }
  }
}

async function registerWhenReady(bridge: JsonLineCompanionBridge): Promise<Awaited<ReturnType<JsonLineCompanionBridge["registerSession"]>>> {
  const deadline = Date.now() + 5_000;
  while (true) {
    const result = await bridge.registerSession({ id: "installed-extension", provider: "generic", surface: "vscode_window", capabilities: ["registered"], status: "unknown", plannedFiles: [], lastHeartbeat: new Date().toISOString(), adapterVersion: "installed-smoke", metadata: {} });
    if (result.ok || Date.now() >= deadline) return result;
    await new Promise((done) => setTimeout(done, 25));
  }
}

test("packaged Windows companion starts with DPAPI protection and accepts configured extension registration", { skip: process.platform !== "win32" }, async (context) => {
  const state = await mkdtemp(join(tmpdir(), "sxsy-packaged-runtime-"));
  const entry = resolve("apps/windows-companion/dist/apps/windows-companion/src/main.js");
  const child = spawn(process.execPath, [entry], { cwd: process.cwd(), shell: false, windowsHide: true, env: { ...process.env, SXSY_B122_STATE_DIR: state } });
  let stderr = ""; child.stderr.on("data", (chunk: Buffer) => { stderr += chunk.toString(); });
  context.after(async () => { if (child.exitCode === null) { child.kill(); await new Promise<void>((done) => child.once("close", () => done())); } await rm(state, { recursive: true, force: true }); });
  await waitFor(join(state, "config.json"));
  const bridge = new JsonLineCompanionBridge(new AuthenticatedLocalPipeTransport(await readLocalCompanionConfiguration(join(state, "config.json"))));
  const registered = await registerWhenReady(bridge);
  assert.equal(registered.ok, true, registered.ok ? stderr : `${registered.code}: ${registered.message}\n${stderr}`);
  const ping = await bridge.dispatch({ control: "VSCODE", modifier: "normal", sessionId: "installed-extension" });
  assert.equal(ping.ok, true, stderr);
});
