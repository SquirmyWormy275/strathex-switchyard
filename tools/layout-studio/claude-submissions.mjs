/** Claude-specific stopped-session continuation; no native turn ID is invented. */
import { spawn } from "node:child_process";
import { runRuntimeCommand, runtimeGuardianStopped } from "./runtime-command.mjs";
import { runOwnedNativeCommand, guardianScope } from "./owned-native-command.mjs";
import { verifiedClaudeTaskReply } from "./claude-task-result.mjs";
import { scopeHash } from "./confirmations.mjs";
import { trustedCli } from "./agents.mjs";
import { readClaudeDesignLogin, readClaudeMetadata } from "./claude-account.mjs";
import { claudeInventory } from "./claude-coding.mjs";
import { verifyRepositoryIdentity } from "./coding-task-identity.mjs";
import { createReviewedTaskText } from "./reviewed-task-text.mjs";
import { desktopEnvironment } from "./process-environment.mjs";
import { stopOwnedChild } from "./owned-process.mjs";
export function createClaudeSubmissions({ store, resolveCli = trustedCli, spawnProcess = spawn, stopChild = stopOwnedChild, command = runRuntimeCommand, guardianStopped = runtimeGuardianStopped, now = () => Date.now() } = {}) {
  async function reconcileSaved(compartment, authorize = async () => {}) {
    for (const saved of (await store.snapshot(compartment)).codingTurns ?? []) {
      if (saved.provider !== "claude-code" || !saved.ownedRuntime || saved.ownedRuntimeStoppedVerified === true) continue;
      const scope = guardianScope(saved.ownedRuntime);
      if (!await guardianStopped(scope)) throw new Error("A previous exact Claude guardian has not verified exit. No replacement was launched.");
      await store.update(compartment, "claude-saved-guardian-exit", (s) => { const t = s.codingTurns.find(t => t.id === saved.id); if (!t || scopeHash(t.ownedRuntime) !== scopeHash(scope)) throw new Error("The saved Claude guardian changed during recovery."); t.ownedRuntimeStoppedVerified = true; });
      await authorize();
    }
    return true;
  }
  const canRecoverTask = task => task?.nativeTransport === "owned-print" && task.nativeIdentityVerified === false && task.status === "creation-uncertain";
  return createReviewedTaskText({ store, stopChild, now, adapter: {
    verifySavedStop: reconcileSaved,
    provider: "claude-code", nativeVersion: "2.1.308", launchPolicy: "tools-disabled/plan", permissions: "native tools disabled; plan mode; permission prompts denied",
    submitAction: "submit_claude_text", resolveAction: "resolve_claude_text",
    reviewReason: "Send this exact text under this task's original verified Claude account. For a reserved new task, the first reply must verify its requested UUID before native creation is accepted; later turns resume that exact conversation. Stopped background tasks use their existing UUID. Safe mode, an empty tool/MCP set and denied permission prompts remain enforced. No execution authority, other provider or attached terminal is selected.",
    canRecoverTask,
    recoveryReason: "Recover only this task's original requested Claude UUID through native resume. This sends the exact reviewed text and may use the existing native conversation. The prior uncertain outcome must already be reviewed and owned exit verified. If native history is unavailable, preserve the uncertainty; never create or fork a replacement conversation. Tools remain disabled and permission prompts denied.",
    validateRecovery(task, state) {
      if (!Number.isSafeInteger(task.creationOutcomeReviewedAt) || task.creationOutcomeReviewedAt < 0 || (state.codingTurns ?? []).some(t => t.taskId === task.id && ["reserved", "submitting", "submitted", "outcome-unconfirmed", "cancellation-requested", "interrupted"].includes(t.status))) throw new Error("Deliberately review the previous uncertain outcome before reviewing resume-only recovery.");
    },
    recordOutcomeReview(task, turn) { if (canRecoverTask(task) && task.sessionId === turn.sessionId) task.creationOutcomeReviewedAt = now(); },
    validateTask(task) {
      if (!/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/.test(task.sessionId) || (task.nativeTransport === "owned-print" ? task.backgroundId !== null || typeof task.nativeIdentityVerified !== "boolean" : !/^[a-f0-9]{8}$/.test(task.backgroundId ?? ""))) throw new Error("Choose an exact owned Claude task with its full native or explicitly reserved session UUID.");
    },
    acceptResult(task) { if (task.nativeTransport === "owned-print") { task.nativeIdentityVerified = true; task.status = "registered"; } },
    recordUnconfirmed(task) { if (task?.nativeTransport === "owned-print" && task.nativeIdentityVerified === false) task.status = "creation-uncertain"; },
    async openTask({ compartment, task, resource, current, authorize }) {
      await reconcileSaved(compartment, authorize);
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
        async runTurn({ recovery, text, signal, checkCurrent, onContainment, onContainmentStopped }) {
          await authorize(); await verifyRepositoryIdentity(task);
          const args = ["--safe-mode", "-p", "--output-format", "json", "--tools", "", "--strict-mcp-config", "--mcp-config", '{"mcpServers":{}}', "--settings", '{"disableAllHooks":true}', "--setting-sources", "", "--permission-mode", "plan", "--permission-prompts", "none", "--no-chrome", !recovery && task.nativeTransport === "owned-print" && task.nativeIdentityVerified === false ? "--session-id" : "--resume", task.sessionId];
          const result = await runOwnedNativeCommand({ executable, args, cwd: task.repositoryRoot, text, signal, resource, command, guardianStopped, stopChild,
            env: { ...desktopEnvironment(), DISABLE_TELEMETRY: "1", DISABLE_ERROR_REPORTING: "1", CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC: "1" },
            onReady: async scope => { checkCurrent(); await authorize(); await onContainment(scope); checkCurrent(); }, onStopped: onContainmentStopped });
          checkCurrent(); const value = verifiedClaudeTaskReply(result, task.sessionId);
          await login(); await authorize(); await verifyRepositoryIdentity(task);
          return { text: value, nativeStatus: "completed", nativeSessionVerified: true, nativeTurnIdSupported: false, turnId: null, taskCompletionVerified: false };
        }
      };
    }
  } });
}
