import assert from "node:assert/strict";
import test from "node:test";

import { collectOmarchyHostEvidence } from "../src/omarchy-capabilities.ts";

test("Omarchy evidence identifies the platform without leaking unrelated environment values", async () => {
  const commands = new Map([
    ["omarchy-version ", "Omarchy 4.0.1-1\n"],
    ["hyprctl version -j", '{"tag":"v0.56.2"}\n'],
    ["tmux -V", "tmux 3.5a\n"],
    ["systemctl --user show-environment", "PATH=/usr/bin\n"]
  ]);
  const evidence = await collectOmarchyHostEvidence({
    platform: "linux",
    environment: { WAYLAND_DISPLAY: "wayland-1", XDG_SESSION_TYPE: "wayland", SECRET_TOKEN: "must-not-appear" },
    now: () => new Date("2026-09-01T00:00:00.000Z"),
    readText: async () => 'NAME="Arch Linux"\nVERSION_ID="rolling"\n',
    run: async (executable, args) => {
      const value = commands.get(`${executable} ${args.join(" ")}`);
      if (!value) throw new Error("missing");
      return value;
    }
  });
  assert.deepEqual(evidence.capabilities.map(({ id, available }) => ({ id, available })), [
    { id: "omarchy", available: true }, { id: "hyprland", available: true }, { id: "wayland", available: true }, { id: "tmux", available: true }, { id: "systemd-user", available: true }
  ]);
  assert.doesNotMatch(JSON.stringify(evidence), /must-not-appear/);
});

test("Omarchy evidence fails closed when commands and session markers are absent", async () => {
  const evidence = await collectOmarchyHostEvidence({ platform: "linux", environment: {}, readText: async () => "NAME=Arch Linux\n", run: async () => { throw new Error("missing"); } });
  assert.ok(evidence.capabilities.every((capability) => !capability.available && capability.reason));
});

test("Omarchy evidence does not probe a non-Linux host", async () => {
  let probes = 0;
  const evidence = await collectOmarchyHostEvidence({ platform: "win32", readText: async () => { probes += 1; return ""; }, run: async () => { probes += 1; return ""; } });
  assert.equal(probes, 0);
  assert.ok(evidence.capabilities.every((capability) => !capability.available));
});
