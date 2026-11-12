#!/usr/bin/env node
/** Opt-in foreground category sampler; never persists raw window metadata. */
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { recordFocus } from "./workflow-capture.mjs";

export function surfaceForClass(value) {
  if (typeof value !== "string") return "other";
  const name = value.toLowerCase();
  if (/^(foot|alacritty|kitty|org\.wezfurlong\.wezterm|com\.mitchellh\.ghostty)$/.test(name)) return "terminal";
  if (/^(code|code-oss|codium|vscodium|com\.visualstudio\.code)$/.test(name)) return "vscode";
  if (/^(chatgpt|com\.openai\.chatgpt)$/.test(name)) return "chatgpt";
  if (/^(claude|com\.anthropic\.claude)$/.test(name)) return "claude";
  if (/^(codex|com\.openai\.codex)$/.test(name)) return "codex";
  if (/^(brave-browser|firefox|chromium|google-chrome)$/.test(name)) return "browser";
  return "other";
}

function foregroundSurface() {
  try {
    const raw = execFileSync("/usr/bin/hyprctl", ["activewindow", "-j"], { encoding: "utf8", timeout: 2_000, maxBuffer: 64 * 1024 });
    return surfaceForClass(JSON.parse(raw).class);
  } catch { return "other"; }
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  let surface = foregroundSurface();
  let since = Date.now();
  let stopping = false;
  let pending = Promise.resolve();
  async function sample(final = false) {
    if (stopping && !final) return;
    const now = Date.now();
    const next = final ? surface : foregroundSurface();
    const duration = Math.max(0, Math.min(60_000, now - since));
    if (final || next !== surface || duration >= 60_000) {
      if (duration > 0) await recordFocus(surface, duration);
      surface = next;
      since = now;
    }
  }
  const timer = setInterval(() => {
    pending = pending.then(() => sample()).catch((error) => {
      process.stderr.write(`${error.message}\n`);
      process.exitCode = 1;
      clearInterval(timer);
    });
  }, 2_000);
  async function stop() {
    if (stopping) return;
    stopping = true;
    clearInterval(timer);
    try { await pending; await sample(true); } catch (error) { process.stderr.write(`${error.message}\n`); process.exitCode = 1; }
    process.exit();
  }
  process.on("SIGTERM", () => { void stop(); });
  process.on("SIGINT", () => { void stop(); });
}
