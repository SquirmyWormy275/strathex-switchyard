#!/usr/bin/env node
/** Stable installed entry point; arguments choose only closed lifecycle operations. */
import { spawn } from "node:child_process";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { launchApplication, stopApplication, applicationStatus } from "./application.mjs";
import { dispatchPhysicalIntent } from "../../tools/layout-studio/physical-intent.mjs";
export async function runApplicationCli(args = process.argv.slice(2), bundleRoot = fileURLToPath(new URL("../../", import.meta.url)).replace(/[\\/]$/, ""), options = {}) {
  if (args[0] === "intent") { if (args.length === 2) await dispatchPhysicalIntent({ implementation: args[1] }); else if (args.length === 4) await dispatchPhysicalIntent({ implementation: args[1], roleId: args[2], intent: args[3] }); else throw new Error("Only closed physical intents are accepted."); return; }
  if (["update", "rollback", "uninstall", "recover"].includes(args[0])) { const { runInstallationCli } = await import("./manage.mjs"); await runInstallationCli(args, options.installationRoot ? { root: options.installationRoot } : {}); return; }
  const operation = args.find((a) => ["launch", "status", "stop"].includes(a)) ?? "launch", noOpen = args.includes("--no-open");
  if (args.some((a) => ![operation, "--no-open"].includes(a)) || args.filter((a) => a === operation).length > 1 || args.filter((a) => a === "--no-open").length > 1) throw new Error("Usage: switchyard [launch|status|stop] [--no-open]");
  if (operation === "status") { console.log(JSON.stringify(await applicationStatus())); return; }
  if (operation === "stop") { console.log(JSON.stringify(await stopApplication())); return; }
  const result = await launchApplication({ bundleRoot, installationRoot: options.installationRoot });
  if (noOpen) { console.log(result.url); return; }
  const executable = process.platform === "win32" ? join(process.env.SystemRoot || "C:\\Windows", "System32/rundll32.exe") : "/usr/bin/xdg-open";
  const argv = process.platform === "win32" ? ["url.dll,FileProtocolHandler", result.url] : [result.url];
  const child = spawn(executable, argv, { shell: false, detached: true, windowsHide: true, stdio: "ignore" });
  child.once("error", () => { console.error("Switchyard is running, but the normal URL opener failed. Run switchyard launch --no-open for its private link."); process.exitCode = 1; }); child.unref();
  console.log("Switchyard is running.");
}
if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) await runApplicationCli();
