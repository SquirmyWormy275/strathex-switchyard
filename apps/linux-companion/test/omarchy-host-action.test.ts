import assert from "node:assert/strict";
import test from "node:test";

import type { OmarchyHostEvidence } from "../src/omarchy-capabilities.ts";
import { planOmarchyFocus } from "../src/omarchy-host-action.ts";

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
    arguments: ["dispatch", "focuswindow", "class:^(code)$"],
    shell: false
  });

  const terminal = planOmarchyFocus("focus_external_terminal", evidence, {
    terminal: { version: 1, surface: "terminal", initialClass: "com.mitchellh.ghostty" }
  });
  assert.equal(terminal.arguments[2], "class:^(com\\.mitchellh\\.ghostty)$");
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
