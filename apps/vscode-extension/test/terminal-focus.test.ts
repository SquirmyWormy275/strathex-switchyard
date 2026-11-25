import assert from "node:assert/strict";
import test from "node:test";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { revealExactTerminal } from "../src/terminal-focus.ts";
import type { TerminalLike } from "../src/vscode-like.ts";

test("the native verifier refuses missing, extra and unrecognized flags before desktop access", () => {
  const script = fileURLToPath(new URL("../../../scripts/verify-vscode-terminal-host.mjs", import.meta.url));
  for (const args of [[], ["--synthetic"], ["--synthetic-terminal-selection", "extra"]]) {
    const result = spawnSync(process.execPath, [script, ...args], { encoding: "utf8", timeout: 10_000 });
    assert.equal(result.error, undefined); assert.notEqual(result.status, 0); assert.equal(result.stdout, ""); assert.match(result.stderr, /Use on the Linux pilot/);
  }
});

function fixture() {
  const active = new Set<(terminal: TerminalLike | undefined) => unknown>();
  const closed = new Set<(terminal: TerminalLike) => unknown>();
  let shown = 0;
  const target: TerminalLike = { name: "Identical title", show: () => { shown++; } };
  const other: TerminalLike = { name: "Identical title", show: () => { throw new Error("Wrong terminal shown"); } };
  const window = {
    terminals: [target, other], activeTerminal: other as TerminalLike | undefined,
    onDidChangeActiveTerminal(listener: (terminal: TerminalLike | undefined) => unknown) { active.add(listener); return { dispose: () => { active.delete(listener); } }; },
    onDidCloseTerminal(listener: (terminal: TerminalLike) => unknown) { closed.add(listener); return { dispose: () => { closed.delete(listener); } }; }
  };
  return {
    window, target, other, get shown() { return shown; },
    activate(terminal: TerminalLike | undefined) { window.activeTerminal = terminal; for (const listener of active) listener(terminal); },
    close(terminal: TerminalLike) { window.terminals = window.terminals.filter(candidate => candidate !== terminal); for (const listener of closed) listener(terminal); },
    assertClean() { assert.equal(active.size, 0); assert.equal(closed.size, 0); }
  };
}

test("terminal selection accepts only the exact API object after asynchronous activation and current-context readback", async () => {
  const f = fixture(); let checks = 0;
  f.target.show = preserveFocus => { assert.equal(preserveFocus, false); queueMicrotask(() => f.activate(f.target)); };
  await revealExactTerminal(f.window, f.target, () => { checks++; });
  assert.equal(f.window.activeTerminal, f.target); assert.equal(checks, 3); f.assertClean();
});

test("an identical title and an activation event without matching readback cannot prove selection", async () => {
  const f = fixture();
  f.target.show = () => f.activate(f.other);
  await assert.rejects(revealExactTerminal(f.window, f.target, () => {}, 20), /bounded readback/); f.assertClean();
  f.target.show = () => { f.activate(f.target); f.window.activeTerminal = f.other; };
  await assert.rejects(revealExactTerminal(f.window, f.target, () => {}), /active terminal changed/); f.assertClean();
});

test("closed exact terminals refuse before show and while waiting without revealing a replacement", async () => {
  const f = fixture(); f.close(f.target);
  await assert.rejects(revealExactTerminal(f.window, f.target, () => {}), /closed before focus/);
  assert.equal(f.shown, 0); f.assertClean();
  f.window.terminals.push(f.target); f.target.show = () => f.close(f.target);
  await assert.rejects(revealExactTerminal(f.window, f.target, () => {}), /closed during focus/); f.assertClean();
});

test("context changes during activation or final asynchronous validation refuse success", async () => {
  const f = fixture(); let current = true;
  f.target.show = () => { f.activate(f.target); current = false; };
  await assert.rejects(revealExactTerminal(f.window, f.target, () => { if (!current) throw new Error("Authorization expired"); }), /expired/); f.assertClean();
  let checks = 0; current = true;
  f.target.show = () => f.activate(f.target);
  await assert.rejects(revealExactTerminal(f.window, f.target, async () => { if (++checks === 3) { await Promise.resolve(); f.activate(f.other); } }), /active terminal changed/); f.assertClean();
});

test("show and listener setup failures remove listeners without an unhandled readiness rejection", async () => {
  const f = fixture(); f.target.show = () => { throw new Error("Show failed"); };
  await assert.rejects(revealExactTerminal(f.window, f.target, () => {}), /Show failed/); f.assertClean();
  f.window.onDidCloseTerminal = () => { throw new Error("Listener setup failed"); };
  await assert.rejects(revealExactTerminal(f.window, f.target, () => {}), /Listener setup failed/); f.assertClean();
});

test("invalid or unbounded readback deadlines fail before context checks and effects", async () => {
  const f = fixture(); let checks = 0;
  for (const bound of [0, -1, 5_001, Infinity, NaN, 1.5]) await assert.rejects(revealExactTerminal(f.window, f.target, () => { checks++; }, bound), /bounded readback/);
  assert.equal(checks, 0); assert.equal(f.shown, 0); f.assertClean();
});
