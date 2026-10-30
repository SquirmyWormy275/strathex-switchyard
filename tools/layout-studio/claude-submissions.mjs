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
    reviewReason: "Send this exact text under this task's original verified Claude account. For a reserved new task, the first reply must verify its requested UUID before native creation is accepted; later turns resume that exact conversation. Stopped background tasks use their existing UUID. Safe mode, an empty tool/MCP set and denied permission prompts remain enforced. No execution authority, other provider or attached terminal is selected.",
    validateTask(task) {
      if (!/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/.test(task.sessionId) || (task.nativeTransport === "owned-print" ? task.backgroundId !== null || typeof task.nativeIdentityVerified !== "boolean" : !/^[a-f0-9]{8}$/.test(task.backgroundId ?? ""))) throw new Error("Choose an exact owned Claude task with its full native or explicitly reserved session UUID.");
    },
    acceptResult(task) { if (task.nativeTransport === "owned-print") task.nativeIdentityVerified = true; },
    recordUnconfirmed(task) { if (task?.nativeTransport === "owned-print" && task.nativeIdentityVerified === false) task.status = "creation-uncertain"; },
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
        if (task.nativeTransport === "owned-print") {
          if (rows.some((r) => r.sessionId === task.sessionId && (r.pid !== null || r.kind !== "background" || r.state !== "stopped"))) throw new Error("The exact Claude conversation has a live native client. Stop or detach it deliberately before reviewing text; no writer was displaced.");
          await authorize(); return;
        }
        const row = rows.find((r) => r.backgroundId === task.backgroundId);
        if (row?.sessionId !== task.sessionId || row.kind !== "background" || row.state !== "stopped" || row.pid !== null) throw new Error("Stop this exact owned Claude background task through its separate reviewed stop before sending text. Running, waiting and external clients were preserved.");
        await authorize();
      }
      await login(); await stoppedSession(); await login();
      return {
        async prepareTurn() { await login(); await stoppedSession(); await login(); },
        async runTurn({ text, signal, checkCurrent }) {
          await authorize(); await verifyRepositoryIdentity(task);
          const args = ["--safe-mode", "-p", "--output-format", "json", "--tools", "", "--strict-mcp-config", "--mcp-config", '{"mcpServers":{}}', "--settings", '{"disableAllHooks":true}', "--setting-sources", "", "--permission-mode", "plan", "--permission-prompts", "none", "--no-chrome", task.nativeTransport === "owned-print" && task.nativeIdentityVerified === false ? "--session-id" : "--resume", task.sessionId];
          const child = spawnProcess(executable, args, { cwd: task.repositoryRoot, shell: false, windowsHide: true, stdio: ["pipe", "pipe", "pipe"], env: { ...desktopEnvironment(), DISABLE_TELEMETRY: "1", DISABLE_ERROR_REPORTING: "1", CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC: "1" } }); register(child); child.stdout.setEncoding("utf8"); child.stderr.setEncoding("utf8");
          const value = await new Promise((resolve, reject) => {
            let output = "", stderr = "", bytes = 0, stderrBytes = 0, settled = false;
            const finish = (error, value) => { if (settled) return; settled = true; clearTimeout(timer); signal?.removeEventListener("abort", aborted); error ? reject(error) : resolve(value); };
            const fail = (message, code, metadata = {}) => { if (settled) return; children.get(child)?.close(); const error = new Error(message); error.code = code; Object.assign(error, metadata); finish(error); };
            const aborted = () => fail("Cancellation was requested for this exact owned Claude connection.", "CANCELLED");
            const timer = setTimeout(() => fail("The owned Claude text turn exceeded its bounded deadline.", "TURN_TIMEOUT"), 120000);
            signal?.addEventListener("abort", aborted, { once: true });
            child.once("error", () => fail("The owned Claude text process could not start. No replacement was launched.", "SUBMISSION_UNCONFIRMED"));
            child.stdin.on("error", () => fail("The exact Claude text submission was not confirmed. No replacement was launched.", "SUBMISSION_UNCONFIRMED"));
            child.stdout.on("data", (chunk) => { bytes += Buffer.byteLength(chunk); if (bytes > 2 * 1024 * 1024) fail("The Claude result exceeded its bounded envelope.", "OUTPUT_BOUND"); else output += chunk; });
            child.stderr.on("data", (chunk) => { stderrBytes += Buffer.byteLength(chunk); if (stderrBytes > 16384) fail("The Claude diagnostic stream exceeded its bounded envelope.", "OUTPUT_BOUND"); else stderr += chunk; });
            child.once("close", (code) => {
              if (settled) return;
              let r;
              try {
                checkCurrent(); r = JSON.parse(output);
                if (code !== 0 || r.type !== "result" || r.subtype !== "success" || r.is_error !== false || r.session_id !== task.sessionId || typeof r.result !== "string" || !r.result.trim() || Buffer.byteLength(r.result) > 32768 || r.permission_denials != null && (!Array.isArray(r.permission_denials) || r.permission_denials.length)) throw new Error();
                finish(null, r.result);
              } catch {
                const field = (v) => typeof v === "string" && /^[A-Za-z_-]{1,64}$/.test(v) ? v : "unverified";
                const summary = { schema: "switchyard-claude-result-shape/v1", exitCode: code, parsed: r != null, rootType: Array.isArray(r) ? "array" : r === null ? "null" : typeof r, frameCount: Array.isArray(r) ? r.length : null, terminalType: Array.isArray(r) ? field(r.at(-1)?.type) : null, type: field(r?.type), subtype: field(r?.subtype), isError: typeof r?.is_error === "boolean" ? r.is_error : null, exactSessionMatched: r?.session_id === task.sessionId, resultType: typeof r?.result, resultBytes: typeof r?.result === "string" ? Buffer.byteLength(r.result) : null, permissionDenials: Array.isArray(r?.permission_denials) ? r.permission_denials.length : null };
                summary.stdoutBytes = bytes; summary.stderrBytes = stderrBytes;
                summary.stderrCategories = [["workspace-trust", /workspace not trusted/i], ["session-unavailable", /no conversation|no session|session.*not found|invalid session/i], ["session-in-use", /session.*in use|already.*running|active.*writer|resum.*copy|\b(?:use|using)\b.*\battach\b/i], ["invalid-cli-option", /unknown option|invalid.*option|unsupported.*option|cannot be used|requires.*--|must.*--/i], ["permission-target", /permission.prompts|permission.prompt.tool/i], ["native-auth", /not logged in|authenticate|authentication|unauthorized|API.?key/i], ["account-limit", /quota|rate.limit|credit|usage limit|spending limit/i], ["native-error", /error/i]].filter(([, pattern]) => pattern.test(stderr)).map(([name]) => name);
                summary.referencedFlags = ["--safe-mode", "--output-format", "--tools", "--strict-mcp-config", "--mcp-config", "--settings", "--setting-sources", "--permission-mode", "--permission-prompts", "--no-chrome", "--resume", "--session-id"].filter((flag) => stderr.includes(flag));
                const observedSessionId = /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/.test(r?.session_id ?? "") ? r.session_id : null;
                fail("The owned Claude result did not verify its exact native session and successful bounded reply. The original request remains for review.", "NATIVE_RESULT_UNCONFIRMED", { nativeResultSummary: summary, observedSessionId });
              }
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
