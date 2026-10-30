/** First-party identity only; never return native email, org or credential data. */
import { createHash } from "node:crypto";
import { spawn } from "node:child_process";
import { desktopEnvironment } from "./process-environment.mjs";
import { stopOwnedChild } from "./owned-process.mjs";
const bounded = (v, max) => typeof v === "string" && v.trim().length > 0 && v.length <= max && !/[\0\r\n]/.test(v);
export function claudeAccount(value) {
  if (value?.loggedIn !== true || value.authMethod !== "claude.ai" || value.apiProvider !== "firstParty" || !bounded(value.email, 320) || !bounded(value.orgId, 128)) throw new Error("Claude did not identify a supported first-party login. No API-key or alternate-provider account was guessed.");
  return createHash("sha256").update(JSON.stringify(["claude-code", value.authMethod, value.apiProvider, value.email.trim().toLowerCase(), value.orgId])).digest("hex");
}
export async function readClaudeDesignLogin(executable, cwd, { spawnProcess = spawn, stopChild = stopOwnedChild, onChild = () => {}, onStopped = () => {}, checkCurrent = () => {}, timeoutMs = 10000 } = {}) {
  async function probe(args) {
    checkCurrent();
    const child = spawnProcess(executable, args, { cwd, shell: false, windowsHide: true, stdio: ["ignore", "pipe", "ignore"], env: { ...desktopEnvironment(), DISABLE_TELEMETRY: "1", DISABLE_ERROR_REPORTING: "1", CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC: "1" } });
    try {
      onChild(child);
      const output = await new Promise((resolve, reject) => {
        let value = "", bytes = 0, settled = false;
        const finish = (error) => { if (settled) return; settled = true; clearTimeout(timer); error ? reject(error) : resolve(value); };
        const failure = () => finish(new Error("The native Claude login check did not complete within its bounded contract. Saved context was preserved."));
        const timer = setTimeout(failure, timeoutMs);
        child.stdout.on("data", (chunk) => { bytes += Buffer.byteLength(chunk); if (bytes > 65536) failure(); else value += chunk; });
        child.once("error", failure); child.once("close", (code) => { if (code === 0) finish(); else failure(); });
      });
      checkCurrent(); return output;
    } finally {
      let stopped = false; try { stopped = (await stopChild(child)).stopped === true; } catch { /* retain the owned identity below */ }
      if (stopped) onStopped(child);
      else { const error = new Error("The owned Claude login probe has not verified exit. No replacement was launched."); error.ownedChild = child; throw error; }
    }
  }
  const version = (await probe(["--version"])).trim();
  if (version !== "2.1.308 (Claude Code)") throw new Error("This Claude design adapter requires its reviewed native version (2.1.308). Saved context was preserved.");
  let value; try { value = JSON.parse(await probe(["auth", "status", "--json"])); } catch (error) { if (error instanceof SyntaxError) throw new Error("Claude returned an unsupported login status. No context was submitted."); throw error; }
  checkCurrent(); return { version: "2.1.308", fingerprint: claudeAccount(value) };
}
