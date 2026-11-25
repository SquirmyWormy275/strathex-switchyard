#!/usr/bin/env node
/** Read-only Codex App Server thread inventory. No prompts, turns, or effects. */
import { spawn } from "node:child_process";
import { stat, realpath } from "node:fs/promises";
import { homedir, platform } from "node:os";
import { isAbsolute, join } from "node:path";
import { createInterface } from "node:readline";
import { fileURLToPath } from "node:url";

const maxResponseBytes = 1024 * 1024;
const timeoutMs = 8_000;

export function normalizeThreadList(value) {
  if (!value || typeof value !== "object" || !Array.isArray(value.data) || value.data.length > 25) throw new Error("Codex returned an invalid bounded thread list.");
  return value.data.map((entry) => {
    if (!entry || typeof entry !== "object" || typeof entry.id !== "string" || !/^[A-Za-z0-9_-]{1,128}$/.test(entry.id)) throw new Error("Codex returned an invalid thread identity.");
    const status = entry.status;
    let observation = "unknown";
    if (status?.type === "notLoaded") observation = "not-observed";
    else if (status?.type === "idle") observation = "idle";
    else if (status?.type === "systemError") observation = "error";
    else if (status?.type === "active") observation = Array.isArray(status.activeFlags) && status.activeFlags.includes("waitingOnApproval") ? "waiting-on-approval" : "active";
    return Object.freeze({ id: entry.id, observation });
  });
}

export async function listCodexThreads(executable, { spawnProcess = spawn, deadlineMs = timeoutMs } = {}) {
  if (typeof executable !== "string" || !isAbsolute(executable)) throw new Error("Codex executable must be an absolute path.");
  const path = await realpath(executable);
  if (!(await stat(path)).isFile()) throw new Error("Codex executable must be a regular file.");
  if (!Number.isSafeInteger(deadlineMs) || deadlineMs < 100 || deadlineMs > 30_000) throw new Error("Codex observation deadline is invalid.");
  return new Promise((resolve, reject) => {
    const child = spawnProcess(path, ["app-server", "--stdio"], { stdio: ["pipe", "pipe", "ignore"], shell: false, windowsHide: true });
    let settled = false;
    let phase = "initialize";
    let outputBytes = 0;
    const lines = createInterface({ input: child.stdout });
    const timeout = setTimeout(() => finish(new Error("Codex read-only observation timed out.")), deadlineMs);
    function finish(error, result) {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      lines.close();
      child.stdin.end();
      child.kill("SIGTERM");
      if (error) reject(error); else resolve(result);
    }
    function send(message) { child.stdin.write(`${JSON.stringify(message)}\n`); }
    child.on("error", () => finish(new Error("Codex App Server could not start.")));
    child.stdin.on("error", () => finish(new Error("Codex App Server closed its request channel.")));
    child.stdout.on("error", () => finish(new Error("Codex App Server closed its response channel.")));
    child.on("exit", () => { if (!settled) finish(new Error("Codex App Server exited before the thread list arrived.")); });
    lines.on("line", (line) => {
      if (settled) return;
      outputBytes += Buffer.byteLength(line);
      if (outputBytes > maxResponseBytes) { finish(new Error("Codex App Server exceeded the bounded response size.")); return; }
      let message;
      try { message = JSON.parse(line); } catch { finish(new Error("Codex App Server returned malformed JSON.")); return; }
      if (phase === "initialize" && message.id === 1) {
        if (message.error || !message.result) { finish(new Error("Codex App Server initialization was unavailable.")); return; }
        phase = "list";
        send({ method: "initialized", params: {} });
        send({ id: 2, method: "thread/list", params: { limit: 25, sortKey: "recency_at", sourceKinds: ["cli", "vscode", "appServer"] } });
      } else if (phase === "list" && message.id === 2) {
        if (message.error) { finish(new Error("Codex App Server thread listing was unavailable.")); return; }
        try { finish(undefined, Object.freeze(normalizeThreadList(message.result))); }
        catch (error) { finish(error); }
      }
    });
    send({ id: 1, method: "initialize", params: { clientInfo: { name: "sxsy_readonly_thread_inventory", title: "Switchyard read-only thread inventory", version: "0.1.0" } } });
  });
}

function configuredExecutable(args) {
  if (args.length === 2 && args[0] === "--codex" && isAbsolute(args[1])) return args[1];
  if (args.length !== 0) throw new Error("Usage: node scripts/codex-thread-status.mjs [--codex ABSOLUTE_PATH]");
  if (platform() === "linux") return join(homedir(), ".local", "share", "mise", "installs", "codex", "latest", "bin", "codex");
  throw new Error("Supply the exact Codex executable with --codex on this host.");
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) try {
  const threads = await listCodexThreads(configuredExecutable(process.argv.slice(2)));
  process.stdout.write(`Codex local thread inventory (${threads.length} recent threads)\n`);
  for (const thread of threads) process.stdout.write(`${thread.id}\t${thread.observation}\n`);
  process.stdout.write("Runtime state is local to this App Server process. A saved thread marked not-observed is not evidence of completion or inactivity in another app.\n");
} catch (error) {
  process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
  process.exitCode = 1;
}
