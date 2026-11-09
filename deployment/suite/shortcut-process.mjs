/** An owned shortcut writer must exit before its temporary output is removed. */
import { spawn } from "node:child_process";
import { readFile, rm } from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { stopOwnedChild } from "../../tools/layout-studio/owned-process.mjs";

export const shortcutExecutionTimeoutMs = 10000;
const stages = ["script-started", "utility-loaded", "input-read", "input-decoded", "input-validated", "com-created", "shortcut-saved", "readback-verified"];
const progressLines = stages.map(stage => `SXSY-SHORTCUT/1 ${stage}`);
export async function prepareWindowsShortcut(request, { spawnProcess = spawn, stopChild = stopOwnedChild, timeoutMs = shortcutExecutionTimeoutMs } = {}) {
  const input = JSON.stringify(request);
  if (Buffer.byteLength(input) > 8192) throw Error("Native shortcut request exceeds its bound.");
  let child, timer, removable = true;
  try {
    try {
      await new Promise((resolve, reject) => {
        const exe = join(process.env.SystemRoot || "C:\\Windows", "System32/WindowsPowerShell/v1.0/powershell.exe"), script = fileURLToPath(new URL("./shortcut.ps1", import.meta.url));
        child = spawnProcess(exe, ["-NoLogo", "-NoProfile", "-NonInteractive", "-File", script], { shell: false, windowsHide: true, stdio: ["pipe", "pipe", "ignore"] });
        let length = 0, stage = "not-observed"; const chunks = [];
        const output = () => Buffer.concat(chunks).toString("utf8").replaceAll("\r\n", "\n");
        timer = setTimeout(() => reject(Error(`Native shortcut creation timed out. Last observed stage: ${stage}.`)), timeoutMs);
        child.stdout.on("data", bytes => {
          length += bytes.length;
          if (length > 1024) { reject(Error("Native shortcut response exceeds its bound.")); return; }
          chunks.push(Buffer.from(bytes));
          const lines = output().split("\n");
          // Only a contiguous, closed vocabulary can enter a diagnostic. Never
          // return native output, paths or PowerShell error text to the caller.
          for (let i = 0; i < stages.length && i < lines.length - 1 && lines[i] === progressLines[i]; i++) stage = stages[i];
        });
        child.stdin.on("error", () => {});
        // Keep the error listener during joined shutdown: a failed kill can
        // itself emit an error, which must never escape as an unhandled event.
        child.on("error", () => reject(Error("Native shortcut writer could not run.")));
        child.once("close", code => {
          clearTimeout(timer);
          const value = output().trim();
          if (code === 0 && length <= 1024 && ["VERIFIED", progressLines.join("\n") + "\nVERIFIED"].includes(value)) resolve();
          else reject(Error("Native shortcut creation or exact readback failed."));
        });
        child.stdin.end(input);
      });
    } catch (error) {
      clearTimeout(timer);
      let stopped = false;
      try { stopped = (await stopChild(child)).stopped === true; } catch { /* Preserve the exact owned output if exit cannot be confirmed. */ }
      if (!stopped) {
        removable = false;
        throw Object.assign(Error("Native shortcut writer exit is unconfirmed; its owned staging was preserved."), { code: "NATIVE_SHORTCUT_EXIT_UNCONFIRMED" });
      }
      throw error;
    }
    return await readFile(request.path);
  } finally {
    clearTimeout(timer);
    if (removable) await rm(request.path, { force: true });
  }
}
