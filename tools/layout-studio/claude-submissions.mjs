/** Claude-specific stopped-session continuation; no native turn ID is invented. */
import { spawn } from "node:child_process";
import { trustedCli } from "./agents.mjs";
import { readClaudeDesignLogin, readClaudeMetadata } from "./claude-account.mjs";
import { claudeInventory } from "./claude-coding.mjs";
import { verifyRepositoryIdentity } from "./coding-task-identity.mjs";
import { createReviewedTaskText } from "./reviewed-task-text.mjs";
import { desktopEnvironment } from "./process-environment.mjs";
import { stopOwnedChild } from "./owned-process.mjs";
export function createClaudeSubmissions({ store, resolveCli = trustedCli, spawnProcess = spawn, stopChild = stopOwnedChild, now = () => Date.now() } = {}) {
  return createReviewedTaskText({ store, stopChild, now, adapter: {
    provider: "claude-code", nativeVersion: "2.1.308", launchPolicy: "tools-disabled/plan", permissions: "native tools disabled; plan mode; permission prompts denied",
    submitAction: "submit_claude_text", resolveAction: "resolve_claude_text",
    reviewReason: "Send this exact text to this stopped owned Claude session under its original verified account. Safe mode, an empty tool/MCP set and denied permission prompts remain enforced. Saved native context may be used. No execution authority, other provider or attached terminal is selected.",
    validateTask(task) {
      if (!/^[a-f0-9]{8}$/.test(task.backgroundId ?? "") || !/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/.test(task.sessionId)) throw new Error("Choose an exact owned Claude background task with its full native session UUID.");
    },
    async openTask({ task, resource, current, authorize }) {
      const executable = await resolveCli("claude-code"); await authorize();
      const children = new Map();
      const register = (child) => { const owned = { child, closed: false, close() { if (this.closed) return; this.closed = true; try { child.kill(); } catch { /* bounded owned stop determines exit */ } } }; children.set(child, owned); resource.clients.add(owned); };
      const options = { spawnProcess, stopChild, checkCurrent: current, onChild: register, onStopped: (child) => { const owned = children.get(child); if (owned) { owned.closed = true; resource.clients.delete(owned); children.delete(child); } } };
      async function login() {
        await authorize(); const login = await readClaudeDesignLogin(executable, task.repositoryRoot, options); await authorize();
        if (login.fingerprint !== task.accountFingerprint) throw new Error("The native Claude account changed. No task context was redirected.");
      }
      async function stoppedSession() {
        await authorize(); await verifyRepositoryIdentity(task);
        let rows; try { rows = claudeInventory(JSON.parse(await readClaudeMetadata(executable, "inventory", task.repositoryRoot, options)), task.repositoryRoot); } catch (error) { if (error instanceof SyntaxError) throw new Error("The native Claude inventory did not verify. No task was guessed."); throw error; }
        const row = rows.find((r) => r.backgroundId === task.backgroundId);
        if (row?.sessionId !== task.sessionId || row.kind !== "background" || row.state !== "stopped" || row.pid !== null) throw new Error("Stop this exact owned Claude background task through its separate reviewed stop before sending text. Running, waiting and external clients were preserved.");
        await authorize();
      }
      await login(); await stoppedSession(); await login();
      return {
        async prepareTurn() { await login(); await stoppedSession(); await login(); },
        async runTurn({ text, signal, checkCurrent }) {
          await authorize(); await verifyRepositoryIdentity(task);
          const args = ["--safe-mode", "-p", "--output-format", "json", "--tools", "", "--strict-mcp-config", "--mcp-config", '{"mcpServers":{}}', "--settings", '{"disableAllHooks":true}', "--setting-sources", "", "--permission-mode", "plan", "--permission-prompts", "none", "--no-chrome", "--resume", task.sessionId];
          const child = spawnProcess(executable, args, { cwd: task.repositoryRoot, shell: false, windowsHide: true, stdio: ["pipe", "pipe", "ignore"], env: { ...desktopEnvironment(), DISABLE_TELEMETRY: "1", DISABLE_ERROR_REPORTING: "1", CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC: "1" } }); register(child); child.stdout.setEncoding("utf8");
          const value = await new Promise((resolve, reject) => {
            let output = "", bytes = 0, settled = false;
            const finish = (error, value) => { if (settled) return; settled = true; clearTimeout(timer); signal?.removeEventListener("abort", aborted); error ? reject(error) : resolve(value); };
            const fail = (message, code) => { if (settled) return; children.get(child)?.close(); const error = new Error(message); error.code = code; finish(error); };
            const aborted = () => fail("Cancellation was requested for this exact owned Claude connection.", "CANCELLED");
            const timer = setTimeout(() => fail("The owned Claude text turn exceeded its bounded deadline.", "TURN_TIMEOUT"), 120000);
            signal?.addEventListener("abort", aborted, { once: true });
            child.once("error", () => fail("The owned Claude text process could not start. No replacement was launched.", "SUBMISSION_UNCONFIRMED"));
            child.stdin.on("error", () => fail("The exact Claude text submission was not confirmed. No replacement was launched.", "SUBMISSION_UNCONFIRMED"));
            child.stdout.on("data", (chunk) => { bytes += Buffer.byteLength(chunk); if (bytes > 2 * 1024 * 1024) fail("The Claude result exceeded its bounded envelope.", "OUTPUT_BOUND"); else output += chunk; });
            child.once("close", (code) => {
              if (settled) return;
              try {
                checkCurrent(); const r = JSON.parse(output);
                if (code !== 0 || r.type !== "result" || r.subtype !== "success" || r.is_error !== false || r.session_id !== task.sessionId || typeof r.result !== "string" || !r.result.trim() || Buffer.byteLength(r.result) > 32768 || r.permission_denials != null && (!Array.isArray(r.permission_denials) || r.permission_denials.length)) throw new Error();
                finish(null, r.result);
              } catch { fail("The owned Claude result did not verify its exact native session and successful bounded reply. The original request remains for review.", "NATIVE_RESULT_UNCONFIRMED"); }
            });
            if (signal?.aborted) { aborted(); return; }
            try { checkCurrent(); child.stdin.end(text); } catch { fail("The exact Claude request was stopped before its input was confirmed.", "SUBMISSION_UNCONFIRMED"); }
          });
          await login(); await authorize(); await verifyRepositoryIdentity(task);
          return { text: value, nativeStatus: "completed", nativeSessionVerified: true, nativeTurnIdSupported: false, turnId: null, taskCompletionVerified: false };
        }
      };
    }
  } });
}
