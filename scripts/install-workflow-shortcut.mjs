#!/usr/bin/env node
/** Install the opt-in Omarchy workflow shortcut without replacing another binding. */
import { randomBytes } from "node:crypto";
import { execFileSync } from "node:child_process";
import { constants, realpathSync } from "node:fs";
import { chmod, copyFile, lstat, mkdir, open, readFile, rename, rm, writeFile } from "node:fs/promises";
import { homedir, platform, userInfo } from "node:os";
import { dirname, isAbsolute, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const shortcut = "SUPER + ALT + R";
const description = "Toggle Switchyard workflow study";

function shellQuote(value) { return `'${value.replaceAll("'", `'"'"'`)}'`; }
function exactBinding(togglePath) { return `o.bind(${JSON.stringify(shortcut)}, ${JSON.stringify(description)}, ${JSON.stringify(shellQuote(togglePath))})`; }
function conflictingSource(text) { return /\bo\.bind\s*\(\s*["']SUPER\s*\+\s*ALT\s*\+\s*R["']/i.test(text); }
function conflictingLive(bindings) {
  if (!Array.isArray(bindings)) throw new Error("Hyprland did not return a binding list.");
  return bindings.some((binding) => binding && binding.modmask === 72 && String(binding.key).toUpperCase() === "R");
}

/** Dependency injection keeps config writes and Hyprland reloads testable. */
export async function installWorkflowShortcut({ configPath, togglePath, backupRoot, hyprctl }) {
  if (![configPath, togglePath, backupRoot].every((value) => typeof value === "string" && isAbsolute(value) && !/[\0\r\n]/.test(value))) {
    throw new Error("The shortcut installer requires exact absolute paths.");
  }
  const parent = await lstat(dirname(configPath));
  const info = await lstat(configPath);
  if (!parent.isDirectory() || parent.isSymbolicLink() || parent.uid !== userInfo().uid
    || !info.isFile() || info.isSymbolicLink() || info.uid !== userInfo().uid) {
    throw new Error("The Omarchy bindings file must be an owner-controlled regular file.");
  }
  const original = await readFile(configPath, "utf8");
  const line = exactBinding(togglePath);
  if (original.split("\n").some((entry) => entry.trim() === line)) return { changed: false, backup: null };
  if (original.split("\n").some((entry) => entry.includes('o.bind("SUPER + ALT + R"') && entry.includes(description) && entry.includes(togglePath))) return { changed: false, backup: null };
  if (conflictingSource(original)) throw new Error("Super+Alt+R is already assigned in bindings.lua; review that binding before installing Switchyard.");
  const toggle = await lstat(togglePath);
  if (!toggle.isFile() || toggle.isSymbolicLink() || toggle.uid !== userInfo().uid || !(toggle.mode & 0o111)) {
    throw new Error("The Switchyard workflow-toggle.sh must be an owner-controlled executable file.");
  }
  if (String(await hyprctl("configerrors")).trim()) throw new Error("Hyprland has existing config errors; resolve them before installing a shortcut.");
  if (conflictingLive(JSON.parse(String(await hyprctl("binds", "-j"))))) {
    throw new Error("Super+Alt+R is already active in Hyprland; review its current assignment before installing Switchyard.");
  }
  await mkdir(backupRoot, { recursive: true, mode: 0o700 });
  const backupInfo = await lstat(backupRoot);
  if (!backupInfo.isDirectory() || backupInfo.isSymbolicLink() || backupInfo.uid !== userInfo().uid || (backupInfo.mode & 0o077)) {
    throw new Error("The shortcut backup directory is not private to the current user.");
  }
  const dated = join(backupRoot, `${new Date().toISOString().replaceAll(/[:.]/g, "-")}-${randomBytes(4).toString("hex")}`);
  await mkdir(dated, { mode: 0o700 });
  const backup = join(dated, "bindings.lua.before");
  await copyFile(configPath, backup, constants.COPYFILE_EXCL);
  await chmod(backup, 0o600);
  await writeFile(join(dated, "reason.txt"), "Install the opt-in Switchyard workflow-study shortcut at Super+Alt+R; preserve the prior Omarchy bindings for rollback.\n", { mode: 0o600, flag: "wx" });
  const temporary = join(dirname(configPath), `.bindings.lua.sxsy-${randomBytes(8).toString("hex")}`);
  let changed = false;
  try {
    const handle = await open(temporary, constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | constants.O_NOFOLLOW, info.mode & 0o777);
    try { await handle.writeFile(`${original.replace(/\n?$/, "\n")}\n-- Switchyard opt-in workflow study; remove this line to uninstall.\n${line}\n`); await handle.sync(); }
    finally { await handle.close(); }
    await rename(temporary, configPath);
    changed = true;
    await hyprctl("reload");
    if (String(await hyprctl("configerrors")).trim()) throw new Error("Hyprland reported a config error after the shortcut was installed.");
    const active = JSON.parse(String(await hyprctl("binds", "-j")));
    if (!Array.isArray(active) || !active.some((binding) => binding?.modmask === 72 && String(binding.key).toUpperCase() === "R" && binding.description === description)) {
      throw new Error("Hyprland did not activate the Switchyard shortcut.");
    }
    return { changed: true, backup };
  } catch (error) {
    if (changed) {
      await copyFile(backup, temporary, constants.COPYFILE_EXCL);
      await chmod(temporary, info.mode & 0o777);
      await rename(temporary, configPath);
      try { await hyprctl("reload"); } catch { /* The saved config is still restored on disk. */ }
    }
    throw error;
  } finally {
    await rm(temporary, { force: true });
  }
}

if (process.argv[1] && realpathSync(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    if (platform() !== "linux" || process.argv.length !== 2) throw new Error("Usage: node scripts/install-workflow-shortcut.mjs (Omarchy Linux only)");
    const configRoot = process.env.XDG_CONFIG_HOME || join(homedir(), ".config");
    const stateRoot = process.env.XDG_STATE_HOME || join(homedir(), ".local", "state");
    const sourceRoot = resolve(dirname(process.argv[1]), "..");
    const result = await installWorkflowShortcut({
      configPath: join(configRoot, "hypr", "bindings.lua"),
      togglePath: join(sourceRoot, "scripts", "workflow-toggle.sh"),
      backupRoot: join(stateRoot, "strathex-switchyard", "shortcut-backups"),
      hyprctl: (...args) => execFileSync("/usr/bin/hyprctl", args, { encoding: "utf8", timeout: 5_000, maxBuffer: 256 * 1024 })
    });
    process.stdout.write(result.changed ? `Installed ${shortcut}; backup: ${result.backup}\n` : `${shortcut} is already installed.\n`);
  } catch (error) {
    process.stderr.write(`Switchyard shortcut was not installed: ${error instanceof Error ? error.message : String(error)}\n`);
    process.exitCode = 1;
  }
}
