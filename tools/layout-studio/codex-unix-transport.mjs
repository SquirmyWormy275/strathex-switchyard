/** Explicit pinned Unix transport; the existing Codex client retains protocol/account authority. */
import { spawn } from "node:child_process";
import { isAbsolute } from "node:path";
import { fileURLToPath } from "node:url";
import { CodexClient, codexRestrictedProcessArguments } from "./agents.mjs";

export function createPinnedCodexUnixClient(executable, cwd, serverNames, binding) {
  if (process.platform !== "linux" || !binding || typeof binding !== "object" || Array.isArray(binding) || Object.keys(binding).sort().join() !== "peerBirth,peerExecutableSha256,peerPid,socketDevice,socketInode,socketPath") throw Error("Choose one exact owned Linux Codex socket and native process identity.");
  codexRestrictedProcessArguments(executable, serverNames, { mode: "unix-listener", socketPath: binding.socketPath });
  if (!isAbsolute(executable) || !Number.isSafeInteger(binding.peerPid) || binding.peerPid < 1 || binding.peerPid > 2147483647 || typeof binding.peerBirth !== "string" || !/^[1-9][0-9]{0,19}$/.test(binding.peerBirth) || typeof binding.peerExecutableSha256 !== "string" || !/^[a-f0-9]{64}$/.test(binding.peerExecutableSha256) || ![binding.socketDevice, binding.socketInode].every(value => typeof value === "string" && /^[0-9]{1,20}$/.test(value))) throw Error("The exact owned Codex peer or socket identity is invalid.");
  const request = { schema: "switchyard-pinned-codex-unix/v1", parentPid: process.pid, peerExecutable: executable, ...binding };
  if (Buffer.byteLength(JSON.stringify(request)) > 16384) throw Error("The pinned local connection exceeds its bounded identity contract.");
  return new CodexClient(executable, cwd, serverNames, { spawnProcess: (_native, _args, options) => {
    const child = spawn("/usr/bin/setpriv", ["--no-new-privs", "--pdeathsig", "KILL", "--", "/usr/bin/python3", "-I", "-B", fileURLToPath(new URL("./codex-unix-bridge.py", import.meta.url))], { ...options, detached: false });
    child.stdin.on("error", () => {}); child.stdin.write(JSON.stringify(request) + "\n");
    return child;
  } });
}
