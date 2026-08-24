import assert from "node:assert/strict";
import test from "node:test";
import { chordCommands, chordFor } from "../src/commands.ts";

test("the extension exposes each of the 65 settled chord assignments exactly once", () => {
  assert.equal(chordCommands.length, 65);
  assert.equal(new Set(chordCommands.map((command) => command.command)).size, 65);
  assert.equal(new Set(chordCommands.map((command) => `${command.control}:${command.modifier}`)).size, 65);
  assert.equal(new Set(chordCommands.map((command) => command.control)).size, 22);
  assert.equal(chordFor("REANCHOR", "ctrl"), undefined);
  assert.equal(chordFor("PIPELINE", "ctrl_shift_alt")?.title, "SXSY-B122: Repair Mission");
});
