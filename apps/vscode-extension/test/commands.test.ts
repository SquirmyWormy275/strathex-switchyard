import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { chordCommands, chordFor } from "../src/commands.ts";

test("the extension exposes each of the 65 settled chord assignments exactly once", () => {
  assert.equal(chordCommands.length, 65);
  assert.equal(new Set(chordCommands.map((command) => command.command)).size, 65);
  assert.equal(new Set(chordCommands.map((command) => `${command.control}:${command.modifier}`)).size, 65);
  assert.equal(new Set(chordCommands.map((command) => command.control)).size, 22);
  assert.equal(chordFor("REANCHOR", "ctrl"), undefined);
  assert.equal(chordFor("PIPELINE", "ctrl_shift_alt")?.title, "SXSY-B122: Repair Mission");
});

test("the installed extension activates after startup so a focused window can claim physical signals", async () => {
  const packagePath = join(dirname(fileURLToPath(import.meta.url)), "..", "package.json");
  const manifest = JSON.parse(await readFile(packagePath, "utf8")) as { activationEvents?: readonly string[]; contributes?: { commands?: readonly { command?: string }[] } };
  assert.ok(manifest.activationEvents?.includes("onStartupFinished"));
  assert.ok(manifest.activationEvents?.includes("onCommand:sxsy-b122.chord.reanchor.normal"));
  for (const command of ["sxsy-b122.showQuickReference", "sxsy-b122.installRawHid", "sxsy-b122.listRawHid", "sxsy-b122.showRawHidStatus", "sxsy-b122.revokeRawHid", "sxsy-b122.chord.reanchor.normal"]) {
    assert.ok(manifest.contributes?.commands?.some((entry) => entry.command === command), command);
  }
});
