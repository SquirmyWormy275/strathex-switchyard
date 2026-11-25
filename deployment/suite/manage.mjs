#!/usr/bin/env node
/** Explicit installation operations; no automatic downloads or public release. */
import { fileURLToPath } from "node:url";
import { realpath } from "node:fs/promises";
import { createInstallation } from "./installation.mjs";
export async function runInstallationCli(args = process.argv.slice(2), options = {}) {
  const [action, ...rest] = args, noStart = rest.includes("--no-start"), values = rest.filter((v) => v !== "--no-start");
  if (!["install", "update", "rollback", "uninstall", "recover"].includes(action) || rest.filter((v) => v === "--no-start").length > 1 || (["install", "update"].includes(action) ? values.length !== 2 : values.length !== 0)) throw new Error("Usage: node manage.mjs install|update /absolute/bundle EXPECTED_SHA256 [--no-start], or switchyard rollback|uninstall|recover");
  const install = createInstallation(options); let result;
  if (["install", "update"].includes(action)) result = await install.install(await realpath(values[0]), values[1], { start: !noStart });
  else if (action === "rollback") result = await install.rollback({ start: !noStart });
  else if (action === "recover") result = await install.recover();
  else result = await install.uninstall();
  console.log(JSON.stringify(result));
}
if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) await runInstallationCli();
