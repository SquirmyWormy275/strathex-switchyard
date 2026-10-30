/** Bounded internal native metadata; exposed account identity is a fingerprint. */
import { createHash } from "node:crypto";
import { isAbsolute } from "node:path";
import { desktopEnvironment } from "./process-environment.mjs";
import { stopOwnedChild } from "./owned-process.mjs";
import { runRuntimeCommand, runtimeGuardianStopped } from "./runtime-command.mjs";
import { runOwnedNativeCommand } from "./owned-native-command.mjs";
const bounded = (v, max) => typeof v === "string" && v.trim().length > 0 && v.length <= max && !/[\0\r\n]/.test(v);
export function claudeAccount(value) {
  if (value?.loggedIn !== true || value.authMethod !== "claude.ai" || value.apiProvider !== "firstParty" || !bounded(value.email, 320) || !bounded(value.orgId, 128)) throw new Error("Claude did not identify a supported first-party login. No API-key or alternate-provider account was guessed.");
  return createHash("sha256").update(JSON.stringify(["claude-code", value.authMethod, value.apiProvider, value.email.trim().toLowerCase(), value.orgId])).digest("hex");
}
export async function readClaudeMetadata(executable, operation, cwd, { command = runRuntimeCommand, guardianStopped = runtimeGuardianStopped, stopChild = stopOwnedChild, resource, onClient = () => {}, onStoppedClient = () => {}, checkCurrent = () => {}, authorize = async () => {}, timeoutMs = 10000 } = {}) {
  if (!["version", "account", "inventory"].includes(operation) || !Number.isInteger(timeoutMs) || timeoutMs < 10 || timeoutMs > 20000 || operation === "inventory" && (!bounded(cwd, 4096) || !isAbsolute(cwd))) throw new Error("Choose a bounded native Claude metadata operation.");
  const args = operation === "version" ? ["--version"] : operation === "account" ? ["auth", "status", "--json"] : ["agents", "--json", "--all", "--cwd", cwd];
  checkCurrent(); await authorize(); checkCurrent();
  let client;
  const probe = { clients: { add(value) { client = value; resource?.clients.add(value); onClient(value); } } };
  try {
    const result = await runOwnedNativeCommand({ executable, args, cwd, command, guardianStopped, stopChild, resource: probe, timeout: timeoutMs, maxOutputBytes: operation === "inventory" ? 262144 : 65536, captureStderrBytes: 0,
      env: { ...desktopEnvironment(), DISABLE_TELEMETRY: "1", DISABLE_ERROR_REPORTING: "1", CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC: "1" },
      onReady: async () => { checkCurrent(); await authorize(); checkCurrent(); }
    });
    if (result.status !== "completed" || result.exitCode !== 0) throw new Error("The native Claude metadata check did not complete within its bounded contract. Saved context was preserved.");
    checkCurrent(); await authorize(); checkCurrent(); return result.stdout;
  } finally {
    let stopped = !client; try { if (client) { client.close(); stopped = await client.stop(); } } catch { /* retain the exact owned client below */ }
    if (stopped) { if (client) { resource?.clients.delete(client); onStoppedClient(client); } }
    else { const error = new Error("The owned Claude metadata probe guardian has not verified exit. No replacement was launched."); error.ownedClient = client; throw error; }
  }
}
export async function readClaudeDesignLogin(executable, cwd, options = {}) {
  const version = (await readClaudeMetadata(executable, "version", cwd, options)).trim();
  if (version !== "2.1.308 (Claude Code)") throw new Error("This Claude adapter requires its reviewed native version (2.1.308). Saved context was preserved.");
  let value; try { value = JSON.parse(await readClaudeMetadata(executable, "account", cwd, options)); } catch (error) { if (error instanceof SyntaxError) throw new Error("Claude returned an unsupported login status. No context was submitted."); throw error; }
  options.checkCurrent?.(); return { version: "2.1.308", fingerprint: claudeAccount(value) };
}
