#!/usr/bin/env node
import { homedir } from "node:os";
import { join } from "node:path";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const { readCodexDaemonThreads } = require("../apps/vscode-extension/src/codex-daemon-status.cjs");

try {
  const args = process.argv.slice(2);
  if (args.length && (args.length !== 2 || args[0] !== "--socket")) throw new Error("Usage: node scripts/codex-daemon-status.mjs [--socket ABSOLUTE_PATH]");
  const socketPath = args.length ? args[1] : join(homedir(), ".codex", "app-server-control", "app-server-control.sock");
  const threads = await readCodexDaemonThreads(socketPath);
  process.stdout.write(`Codex daemon runtime inventory (${threads.length} recent threads)\n`);
  for (const thread of threads) process.stdout.write(`${thread.id}\t${thread.observation}\n`);
  process.stdout.write("These are local Codex runtime observations. No thread is bound to a Switchyard task or promoted to a verified managed session.\n");
} catch (error) {
  process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
  process.exitCode = 1;
}
