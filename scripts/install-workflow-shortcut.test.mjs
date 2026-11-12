import assert from "node:assert/strict";
import { chmod, mkdir, mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { installWorkflowShortcut } from "./install-workflow-shortcut.mjs";

test("portable Omarchy installer saves the old bindings and verifies the live shortcut", { skip: process.platform !== "linux" }, async () => {
  const root = await mkdtemp(join(tmpdir(), "sxsy-shortcut-"));
  const config = join(root, "hypr", "bindings.lua");
  const toggle = join(root, "workflow-toggle.sh");
  const backupRoot = join(root, "backups");
  await mkdir(join(root, "hypr"));
  await writeFile(config, "-- existing user bindings\n");
  await writeFile(toggle, "#!/bin/sh\nexit 0\n");
  await chmod(toggle, 0o700);
  let reloaded = false;
  const hyprctl = (command) => command === "configerrors" ? "" : command === "reload" ? (reloaded = true, "ok")
    : JSON.stringify(reloaded ? [{ modmask: 72, key: "R", description: "Toggle Switchyard workflow study" }] : []);
  try {
    const installed = await installWorkflowShortcut({ configPath: config, togglePath: toggle, backupRoot, hyprctl });
    assert.equal(installed.changed, true);
    assert.equal(await readFile(installed.backup, "utf8"), "-- existing user bindings\n");
    assert.equal((await stat(installed.backup)).mode & 0o777, 0o600);
    assert.match(await readFile(config, "utf8"), /o\.bind\("SUPER \+ ALT \+ R".*workflow-toggle\.sh/);
    assert.deepEqual(await installWorkflowShortcut({ configPath: config, togglePath: toggle, backupRoot, hyprctl }), { changed: false, backup: null });
  } finally { await rm(root, { recursive: true, force: true }); }
});

test("portable Omarchy installer refuses a collision and restores a failed reload", { skip: process.platform !== "linux" }, async () => {
  const root = await mkdtemp(join(tmpdir(), "sxsy-shortcut-"));
  const config = join(root, "hypr", "bindings.lua");
  const toggle = join(root, "workflow-toggle.sh");
  const backupRoot = join(root, "backups");
  await mkdir(join(root, "hypr"));
  await writeFile(toggle, "#!/bin/sh\nexit 0\n");
  await chmod(toggle, 0o700);
  try {
    await writeFile(config, 'o.bind("SUPER + ALT + R", "Other", "other-command")\n');
    await assert.rejects(installWorkflowShortcut({ configPath: config, togglePath: toggle, backupRoot, hyprctl: () => "" }), /already assigned/);
    await writeFile(config, "-- original\n");
    let reloads = 0;
    const hyprctl = (command) => command === "reload" ? (reloads++, "ok") : command === "configerrors" ? "" : "[]";
    await assert.rejects(installWorkflowShortcut({ configPath: config, togglePath: toggle, backupRoot, hyprctl }), /did not activate/);
    assert.equal(await readFile(config, "utf8"), "-- original\n");
    assert.equal(reloads, 2);
  } finally { await rm(root, { recursive: true, force: true }); }
});
