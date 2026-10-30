/** Codex-specific native contract for the shared protected text-turn lifecycle. */
import { CodexClient, assertCodexDesignConfig, codexDesignConfig, readCodexMcpNames, trustedCli } from "./agents.mjs";
import { verifyRepositoryIdentity } from "./coding-task-identity.mjs";
import { runRestrictedCodexTurn } from "./codex-turn.mjs";
import { createReviewedTaskText } from "./reviewed-task-text.mjs";
import { stopOwnedChild } from "./owned-process.mjs";
export function createCodexSubmissions({ store, resolveCli = trustedCli, resolveMcp = readCodexMcpNames, clientFactory = (exe, cwd, names) => new CodexClient(exe, cwd, names, { clientInfo: { name: "switchyard_reviewed_text", title: "Switchyard reviewed text", version: "0.1.0" } }), stopChild = stopOwnedChild, now = () => Date.now() } = {}) {
  return createReviewedTaskText({ store, stopChild, now, adapter: {
    provider: "codex", nativeVersion: "0.166.0", launchPolicy: "read-only/on-request", permissions: "read-only/restricted-native/never",
    submitAction: "submit_codex_text", resolveAction: "resolve_codex_text",
    reviewReason: "Send this exact reviewed text to this exact account-bound task. The native read-only sandbox and explicit shell, browser and MCP restrictions remain enforced. Saved native conversation context may be used. No execution authority or other task/provider is selected.",
    validateTask(task) { if (task.nativeTransport !== "owned-stdio") throw new Error("This task belongs to its original runtime. Create a dedicated owned task for reviewed text; no existing writer or client was displaced."); },
    async openTask({ task, resource, authorize, dispose }) {
      const executable = await resolveCli("codex"); await authorize();
      let names;
      try { names = await resolveMcp(executable, task.repositoryRoot, { onProbe: (probe) => { resource.clients.add(probe); } }); }
      finally { if (!await dispose()) throw new Error("The owned tool-configuration probe has not verified exit."); }
      await authorize();
      const client = clientFactory(executable, task.repositoryRoot, names); resource.clients.add(client); await client.initialize(); await authorize();
      await client.recheckAccount(); if (client.accountFingerprint !== task.accountFingerprint) throw new Error("The native Codex account changed. No task context was redirected.");
      const checkRoot = async () => { await authorize(); await verifyRepositoryIdentity(task); const { config } = await client.request("config/read", { cwd: task.repositoryRoot, includeLayers: false }); assertCodexDesignConfig(config); await authorize(); };
      await checkRoot();
      const metadata = await client.request("thread/read", { threadId: task.sessionId, includeTurns: false }), thread = metadata.thread;
      if (thread?.id !== task.sessionId || thread.cwd !== task.repositoryRoot || !["idle", "notLoaded"].includes(thread.status?.type) || thread.turns !== undefined && (!Array.isArray(thread.turns) || thread.turns.length)) throw new Error("The exact metadata-only task is not verified idle. Running or waiting tasks were preserved.");
      return {
        async prepareTurn() {
          await checkRoot();
          const resumed = await client.request("thread/resume", { threadId: task.sessionId, excludeTurns: true, cwd: task.repositoryRoot, sandbox: "read-only", approvalPolicy: "never", approvalsReviewer: "user", config: codexDesignConfig(client.serverNames), baseInstructions: "Answer the supplied text in this exact conversation. Do not call tools, execute commands, browse, inspect files or claim independently verified task completion." });
          if (resumed.thread?.id !== task.sessionId || resumed.thread.cwd !== task.repositoryRoot || resumed.cwd !== task.repositoryRoot || resumed.sandbox?.type !== "readOnly" || resumed.approvalPolicy !== "never" || resumed.modelProvider !== "openai") throw new Error("The resumed native identity, root, first-party provider or permissions did not verify. No model prompt was submitted.");
          await checkRoot(); await client.recheckAccount(); await authorize();
        },
        async runTurn(options) { return { ...await runRestrictedCodexTurn({ client, threadId: task.sessionId, ...options, stopChild, maxOutputBytes: 32768 }), nativeSessionVerified: true, nativeTurnIdSupported: true }; }
      };
    }
  } });
}
