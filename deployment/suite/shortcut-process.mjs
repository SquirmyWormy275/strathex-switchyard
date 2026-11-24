/** An owned shortcut writer must exit before its temporary output is removed. */
import { spawn } from "node:child_process";
import { readFile, rm } from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { stopOwnedChild } from "../../tools/layout-studio/owned-process.mjs";

export const shortcutExecutionTimeoutMs = 10000;
const stages = ["script-started", "runtime-ready", "input-read", "input-decoded", "input-validated", "com-created", "shortcut-saved", "shortcut-reopened", "target-verified", "arguments-verified", "readback-verified"];
const progressLines = stages.map(stage => `SXSY-SHORTCUT/2 ${stage}`);
function shortcutInput(request) {
  if (Buffer.byteLength(JSON.stringify(request)) > 8192) throw Error("Native shortcut request exceeds its bound.");
  const fields = ["path", "nodePath", "loader", "directory"];
  if (!request || typeof request !== "object" || Array.isArray(request) || Object.keys(request).length !== fields.length || fields.some(key => !Object.hasOwn(request, key))) throw Error("Native shortcut needs exactly its four owned paths.");
  const values = fields.map(key => {
    const value = request[key];
    if (typeof value !== "string" || !value || /[\0\r\n"]/.test(value) || Buffer.from(value).toString("utf8") !== value) throw Error("Native shortcut requires exact UTF-8 paths.");
    return Buffer.from(value).toString("base64");
  });
  // A closed four-field wire avoids loading PowerShell's general JSON/utility
  // module on every install. Base64 carries literal paths, never script text.
  const wire = "SXSY-SHORTCUT/2\n" + values.join("\n") + "\n";
  if (Buffer.byteLength(wire) > 8192) throw Error("Native shortcut request exceeds its bound.");
  return wire;
}
export async function prepareWindowsShortcut(request, { spawnProcess = spawn, stopChild = stopOwnedChild, timeoutMs = shortcutExecutionTimeoutMs } = {}) {
  const input = shortcutInput(request);
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
          else reject(Error(`Native shortcut creation or exact readback failed. Last observed stage: ${stage}.`));
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
