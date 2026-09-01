import assert from "node:assert/strict";
import test from "node:test";

import type { OmarchyHostEvidence } from "../src/omarchy-capabilities.ts";
import { NativeOmarchyHostActionAdapter, planOmarchyFocus } from "../src/omarchy-host-action.ts";

const evidence: OmarchyHostEvidence = {
  schemaVersion: 1,
  collectedAt: "2026-09-01T00:00:00.000Z",
  platform: "linux",
  capabilities: ["omarchy", "hyprland", "wayland", "tmux", "systemd-user"].map((id) => ({ id: id as "omarchy", available: true, evidence: [id] }))
};

test("Omarchy focus plans are closed, shell-free, and exact-class matched", () => {
  const vscode = planOmarchyFocus("focus_vscode", evidence, {
    vscode: { version: 1, surface: "vscode", initialClass: "code" }
  });
  assert.deepEqual(vscode, {
    action: "focus_vscode",
    surface: "vscode",
    executable: "/usr/bin/hyprctl",
    arguments: ["dispatch", "hl.dsp.focus({ window = \"initialclass:^(code)$\" })"],
    shell: false
  });

  const terminal = planOmarchyFocus("focus_external_terminal", evidence, {
    terminal: { version: 1, surface: "terminal", initialClass: "com.mitchellh.ghostty" }
  });
  assert.equal(terminal.arguments[1], "hl.dsp.focus({ window = \"initialclass:^(com\\.mitchellh\\.ghostty)$\" })");
});

test("Omarchy focus plans fail closed without capability evidence or fixed identity", () => {
  const missingWayland: OmarchyHostEvidence = {
    ...evidence,
    capabilities: evidence.capabilities.map((capability) => capability.id === "wayland" ? { ...capability, available: false } : capability)
  };
  assert.throws(() => planOmarchyFocus("focus_vscode", missingWayland, { vscode: { version: 1, surface: "vscode", initialClass: "code" } }), /missing capabilities: wayland/i);
  assert.throws(() => planOmarchyFocus("focus_vscode", evidence, {}), /identity is unavailable/i);
});

test("Omarchy focus plans reject class injection", () => {
  assert.throws(() => planOmarchyFocus("focus_external_terminal", evidence, {
    terminal: { version: 1, surface: "terminal", initialClass: "ghostty)|(.*" }
  }), /class is invalid/i);
});

test("native Omarchy focus executes only the fixed shell-free plan", async () => {
  const calls: unknown[][] = [];
  const adapter = new NativeOmarchyHostActionAdapter({
    timeoutMs: 750,
    async run(executable, args, options) {
      calls.push([executable, args, options.timeoutMs, options.maxBuffer, options.signal.aborted]);
      return { stdout: args[0] === "clients" ? '[{"mapped":true,"initialClass":"foot"}]' : args[0] === "activewindow" ? '{"initialClass":"foot"}' : "ok\n", stderr: "" };
    }
  });
  const result = await adapter.execute("focus_external_terminal", evidence, {
    terminal: { version: 1, surface: "terminal", initialClass: "foot" }
  }, new AbortController().signal);

  assert.deepEqual(calls, [
    ["/usr/bin/hyprctl", ["clients", "-j"], 750, 65536, false],
    ["/usr/bin/hyprctl", ["dispatch", "hl.dsp.focus({ window = \"initialclass:^(foot)$\" })"], 750, 4096, false],
    ["/usr/bin/hyprctl", ["activewindow", "-j"], 750, 16384, false]
  ]);
  assert.deepEqual(result, {
    action: "focus_external_terminal",
    surface: "terminal",
    disposition: "committed",
    summary: "Hyprland acknowledged the exact terminal initialClass focus request."
  });
});

test("native Omarchy focus fails closed before or after dispatch uncertainty", async () => {
  let calls = 0;
  const adapter = new NativeOmarchyHostActionAdapter({ async run(_executable, args) { calls += 1; return { stdout: args[0] === "clients" ? '[{"mapped":true,"initialClass":"foot"}]' : "unknown request", stderr: "" }; } });
  await assert.rejects(adapter.execute("focus_vscode", evidence, {}, new AbortController().signal), /identity is unavailable/i);
  assert.equal(calls, 0);

  await assert.rejects(adapter.execute("focus_external_terminal", evidence, {
    terminal: { version: 1, surface: "terminal", initialClass: "foot" }
  }, new AbortController().signal), /did not acknowledge/i);
  assert.equal(calls, 2);

  const cancelled = new AbortController();
  cancelled.abort(new Error("operator cancelled"));
  await assert.rejects(adapter.execute("focus_external_terminal", evidence, {
    terminal: { version: 1, surface: "terminal", initialClass: "foot" }
  }, cancelled.signal), /operator cancelled/i);
  assert.equal(calls, 2);
});

test("native Omarchy focus rejects a missing surface before its durable barrier", async () => {
  let barrier = 0;
  const adapter = new NativeOmarchyHostActionAdapter({ async run() { return { stdout: "[]", stderr: "" }; } });
  await assert.rejects(adapter.execute("focus_vscode", evidence, { vscode: { version: 1, surface: "vscode", initialClass: "code" } }, {
    signal: new AbortController().signal, async beforeEffect() { barrier += 1; }
  }), /mapped.*unavailable/i);
  assert.equal(barrier, 0);
});

test("native Omarchy focus rejects unsafe timeout configuration", () => {
  assert.throws(() => new NativeOmarchyHostActionAdapter({ timeoutMs: 99 }), /timeout is outside safe bounds/i);
  assert.throws(() => new NativeOmarchyHostActionAdapter({ timeoutMs: 30_001 }), /timeout is outside safe bounds/i);
});
