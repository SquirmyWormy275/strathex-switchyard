import { spawn } from "node:child_process";
import { lstat } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

export function localVoice({ runtime = join(homedir(), ".local/share/strathex-switchyard/voice"), spawnProcess = spawn } = {}) {
  const executable = join(runtime, process.platform === "win32" ? "venv/Scripts/python.exe" : "venv/bin/python");
  const model = join(runtime, "base.en");
  return {
    async discovery() { try { await lstat(executable); await lstat(join(model, "model.bin")); return { available: true, destination: "Local CPU, faster-whisper base.en. Audio stays in the selected compartment; no external transcription service.", language: "English" }; } catch { return { available: false, destination: "Local CPU", reason: "Install the documented local voice runtime. No transcription API key is required." }; } },
    async transcribe(audio) {
      if (typeof audio !== "string" || !/^[A-Za-z0-9+/]*={0,2}$/.test(audio) || audio.length < 4 || audio.length > 1400000) throw new Error("Choose an audio segment smaller than 1 MiB.");
      if (!(await this.discovery()).available) throw new Error("The local transcription runtime is unavailable. The encrypted audio draft is preserved for retry.");
      return new Promise((resolve, reject) => {
        const child = spawnProcess(executable, [fileURLToPath(new URL("./transcribe.py", import.meta.url)), model], { shell: false, windowsHide: true, stdio: ["pipe", "pipe", "ignore"], env: { ...process.env, HF_HUB_OFFLINE: "1", HF_HUB_DISABLE_TELEMETRY: "1" } });
        let output = "", settled = false;
        const timer = setTimeout(() => { child.kill(); finish(new Error("Local transcription timed out. Keep the saved audio and retry.")); }, 90000);
        function finish(error, result) { if (settled) return; settled = true; clearTimeout(timer); error ? reject(error) : resolve(result); }
        child.on("error", () => finish(new Error("Local transcription could not start.")));
        child.stdout.on("data", (chunk) => { output += chunk; if (output.length > 32768) { child.kill(); finish(new Error("Transcription exceeded its response bound.")); } });
        child.stdin.on("error", () => {});
        child.on("close", (code) => { try { const r = JSON.parse(output); if (code || typeof r.text !== "string") throw new Error(); finish(null, r); } catch { finish(new Error("Local transcription failed. The saved audio can be retried.")); } });
        child.stdin.end(JSON.stringify({ audio }));
      });
    }
  };
}
