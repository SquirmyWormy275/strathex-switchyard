import { spawn } from "node:child_process";
import { lstat } from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { runtimeEnvironment, runtimeRoot } from "./runtime-setup.mjs";
import { resolveRuntimePaths } from "./runtime-storage.mjs";
import { stopOwnedChild } from "./owned-process.mjs";

export function localVoice({ runtime = runtimeRoot(), spawnProcess = spawn, runtimeResolver = resolveRuntimePaths } = {}) {
  const active = new Map(), generations = new Map(), sessions = new Map(); let closed = false;
  const sessionKey = (compartment, id) => JSON.stringify([compartment, id]);
  async function stopCompartment(compartment) {
    generations.set(compartment, (generations.get(compartment) ?? 0) + 1);
    const results = await Promise.all([...active].filter(([, owner]) => owner.compartment === compartment).map(([child]) => stopOwnedChild(child)));
    return { stopped: results.every((r) => r.stopped), ownedProcesses: results.length };
  }
  return {
    stopCompartment,
    async stopSession(compartment, id) { const key = sessionKey(compartment, id); sessions.set(key, (sessions.get(key) ?? 0) + 1); const results = await Promise.all([...active].filter(([, o]) => o.compartment === compartment && o.sessionId === id).map(([child]) => stopOwnedChild(child))); return { stopped: results.every((r) => r.stopped), ownedProcesses: results.length }; },
    async close() { closed = true; return Promise.all([...new Set([...active.values()].map((o) => o.compartment))].map(stopCompartment)); },
    async discovery() { try { if (closed) throw new Error(); const { python, model } = await runtimeResolver({ root: runtime }); await lstat(python); await lstat(join(model, "model.bin")); if (closed) throw new Error(); return { available: true, destination: "Local CPU, faster-whisper base.en. Audio stays in the selected compartment; no external transcription service.", language: "English" }; } catch { return { available: false, destination: "Local CPU", reason: "Run switchyard runtime install/check to verify the optional local runtime. No transcription API key is required." }; } },
    async transcribe(audio, { compartment = "personal", sessionId = null, beforeStart = async () => {} } = {}) {
      const generation = generations.get(compartment) ?? 0, key = sessionKey(compartment, sessionId), sessionGeneration = sessions.get(key) ?? 0;
      if (typeof audio !== "string" || !/^[A-Za-z0-9+/]*={0,2}$/.test(audio) || audio.length < 4 || audio.length > 1400000) throw new Error("Choose an audio segment smaller than 1 MiB.");
      if (!(await this.discovery()).available) throw new Error("The local transcription runtime is unavailable. The encrypted audio draft is preserved for retry.");
      const { python: executable, model } = await runtimeResolver({ root: runtime });
      await beforeStart();
      const stopped = () => closed || generation !== (generations.get(compartment) ?? 0) || sessionGeneration !== (sessions.get(key) ?? 0);
      if (stopped()) throw new Error("Local transcription was stopped. The encrypted audio draft is preserved.");
      return new Promise((resolve, reject) => {
        const child = spawnProcess(executable, ["-I", "-B", fileURLToPath(new URL("./transcribe.py", import.meta.url)), model], { shell: false, windowsHide: true, stdio: ["pipe", "pipe", "ignore"], env: runtimeEnvironment() });
        let output = "", settled = false;
        active.set(child, { compartment, sessionId }); child.once("close", () => active.delete(child));
        const timer = setTimeout(() => { void stopOwnedChild(child); finish(new Error("Local transcription timed out. Keep the saved audio and retry.")); }, 90000);
        function finish(error, result) { if (settled) return; settled = true; clearTimeout(timer); error ? reject(error) : resolve(result); }
        child.on("error", () => finish(new Error("Local transcription could not start.")));
        child.stdout.on("data", (chunk) => { output += chunk; if (output.length > 32768) { void stopOwnedChild(child); finish(new Error("Transcription exceeded its response bound.")); } });
        child.stdin.on("error", () => {});
        child.on("close", (code) => { try { const r = JSON.parse(output); if (code || stopped() || typeof r.text !== "string") throw new Error(); finish(null, r); } catch { finish(new Error("Local transcription failed or was stopped. The saved audio can be retried.")); } });
        child.stdin.write(JSON.stringify({ audio, supervised: true }) + "\n");
      });
    }
  };
}
