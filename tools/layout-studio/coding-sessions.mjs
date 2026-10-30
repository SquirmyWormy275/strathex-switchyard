/** Exact coding-task identities, separate from keyboard configuration conversations. */
import { createRequire } from "node:module";
import { randomUUID } from "node:crypto";
import { lstat, realpath } from "node:fs/promises";
import { homedir } from "node:os";
import { isAbsolute, join } from "node:path";
import { trustedCli } from "./agents.mjs";
import { directoryIdentity } from "./private-fs.mjs";

const { readCodexDaemonThreads, readExactCodexDaemonThread, readCodexDaemonAccount, resumeExactCodexDaemonThread, startCodexDaemonThread } = createRequire(import.meta.url)("../../apps/vscode-extension/src/codex-daemon-status.cjs");
const uuid = /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/;
const thread = /^[A-Za-z0-9_-]{1,128}$/;
const fingerprint = /^[a-f0-9]{64}$/;
const states = ["not-observed", "idle", "error", "waiting-on-approval", "active", "unknown"];
const adapter = { id: "switchyard.codex-daemon", version: 1, platform: "linux", testedApplicationVersion: "0.165.0", detection: "installed native CLI and private current-user daemon socket", accountScope: "local login fingerprint; organization unverified" };
async function repository(value) {
  if (typeof value !== "string" || !isAbsolute(value) || value.length > 4096 || /[\0\r\n]/.test(value)) throw new Error("Choose an exact local working directory with Git metadata.");
  await directoryIdentity(value); const root = await realpath(value), git = await lstat(join(root, ".git"));
  if (git.isSymbolicLink() || (!git.isDirectory() && !git.isFile())) throw new Error("The selected directory has unsupported Git metadata.");
  return root;
}
export function createCodingSessions({ store, resolveCli = trustedCli, platform = process.platform, now = () => Date.now(), daemon, socketPath = join(homedir(), ".codex/app-server-control/app-server-control.sock") } = {}) {
  daemon ??= { list: () => readCodexDaemonThreads(socketPath), account: () => readCodexDaemonAccount(socketPath), read: (sessionId, root) => readExactCodexDaemonThread(socketPath, sessionId, { expectedRepositoryRoot: root }), resume: (sessionId, root) => resumeExactCodexDaemonThread(socketPath, sessionId, root), start: (root, taskId) => startCodexDaemonThread(socketPath, root, taskId, { readOnly: true }) };
  const resuming = new Map();
  async function access(compartment) {
    await store.authorize(compartment, { provider: "codex" });
    if (platform !== "linux") throw new Error("General Codex task bindings currently use its supported local Unix daemon contract. The Windows coding-task transport is unfinished.");
    await resolveCli("codex");
  }
  async function account(compartment) {
    await access(compartment); const value = await daemon.account();
    if (value.type !== "chatgpt" || !fingerprint.test(value.fingerprint ?? "")) throw new Error("The local Codex contract did not identify this login. No account or organization was guessed; no task was opened.");
    return value;
  }
  async function exact(sessionId, root) {
    const value = await daemon.read(sessionId, root);
    if (value.id !== sessionId || value.repositoryRoot !== root || !states.includes(value.observation)) throw new Error("The provider did not verify the exact thread and working directory.");
    return { status: value.observation, observedAt: now(), provenance: "Codex local daemon runtime; idle/not-observed is not verified task completion", completionVerified: false };
  }
  function view(task) {
    const fresh = Boolean(task.observation && now() - task.observation.observedAt >= 0 && now() - task.observation.observedAt <= 30000);
    return { ...task, observation: fresh ? task.observation : { status: "stale", observedAt: task.observation?.observedAt ?? null, provenance: "Refresh this exact binding; no runtime state inferred", completionVerified: false }, capabilities: { sessionIdentifiable: Boolean(task.sessionId), observable: Boolean(task.sessionId), focusable: false, launchable: false, resumable: task.status === "registered" && task.launchPolicy === "read-only/on-request", controllable: false, cancellable: false, mediated: false }, accountScope: { type: "local ChatGPT login fingerprint", organizationVerified: false } };
  }
  return {
    async discovery(compartment) {
      const result = { adapter, provider: "codex", installed: null, running: null, available: false, capabilities: [] };
      try { await store.authorize(compartment, { provider: "codex" }); } catch (e) { return { ...result, permitted: false, reason: e.message }; }
      if (platform !== "linux") return { ...result, permitted: true, reason: "The Windows general coding-task transport is unfinished." };
      try { await resolveCli("codex"); } catch (e) { return { ...result, permitted: true, installed: false, running: false, reason: e.message }; }
      try { const rows = await daemon.list(); return { ...result, permitted: true, installed: true, running: true, available: true, recentThreads: rows.length, capabilities: ["exact-coding-task-bind", "runtime-status", "create-empty-thread", "resume-owned-read-only-runtime"], provenance: "Supported local daemon inventory; no thread content, model prompt or outcome inferred" }; }
      catch (e) { return { ...result, permitted: true, installed: true, running: false, reason: e.message }; }
    },
    async list(compartment) { await access(compartment); return ((await store.snapshot(compartment)).codingSessions ?? []).map(view); },
    async bind(compartment, { sessionId, repositoryRoot, label }) {
      const login = await account(compartment);
      if (typeof sessionId !== "string" || !thread.test(sessionId) || typeof label !== "string" || !label.trim() || label.length > 100 || /[\0\r\n]/.test(label)) throw new Error("Choose an exact Codex session and a short local task label.");
      const root = await repository(repositoryRoot), observation = await exact(sessionId, root);
      if ((await account(compartment)).fingerprint !== login.fingerprint) throw new Error("The local login changed while binding the task.");
      await store.claimSession(compartment, { provider: "codex", sessionId });
      return store.update(compartment, "coding-session-bind", (s) => {
        s.codingSessions ??= []; const existing = s.codingSessions.find((t) => t.provider === "codex" && t.sessionId === sessionId);
        if (existing) { if (existing.repositoryRoot !== root || existing.accountFingerprint !== login.fingerprint) throw new Error("This saved binding changed its working directory or local login. Review it deliberately."); existing.observation = observation; return { ...view(existing), duplicatePrevented: true }; }
        if (s.codingSessions.length >= 64) throw new Error("Saved coding-task limit reached. Existing bindings are preserved.");
        const task = { schema: "switchyard-coding-session/v1", id: randomUUID(), provider: "codex", label: label.trim(), repositoryRoot: root, sessionId, accountFingerprint: login.fingerprint, status: "registered", createdAt: now(), observation };
        s.codingSessions.push(task); return view(task);
      }, { provider: "codex" });
    },
    async create(compartment, { requestId, repositoryRoot, label }) {
      const login = await account(compartment);
      if (!uuid.test(requestId ?? "") || typeof label !== "string" || !label.trim() || label.length > 100 || /[\0\r\n]/.test(label)) throw new Error("An empty task needs a stable request UUID and a short local label.");
      const root = await repository(repositoryRoot);
      const reserved = await store.update(compartment, "coding-create-reserve", (s) => {
        s.codingSessions ??= []; const found = s.codingSessions.find((t) => t.id === requestId);
        if (found) { if (found.provider !== "codex" || found.repositoryRoot !== root || found.accountFingerprint !== login.fingerprint) throw new Error("This request identity already names a different task or login."); return { task: view(found), duplicate: true }; }
        if (s.codingSessions.length >= 64) throw new Error("Saved coding-task limit reached.");
        const task = { schema: "switchyard-coding-session/v1", id: requestId, provider: "codex", label: label.trim(), repositoryRoot: root, sessionId: null, accountFingerprint: login.fingerprint, launchPolicy: "read-only/on-request", status: "creating", createdAt: now(), observation: null };
        s.codingSessions.push(task); return { duplicate: false };
      }, { provider: "codex" });
      if (reserved.duplicate) return { ...reserved.task, duplicatePrevented: true };
      try {
        const result = await daemon.start(root, `switchyard-${requestId}`), sessionId = result.threadId;
        if (typeof sessionId !== "string" || !thread.test(sessionId)) throw new Error("The new thread identity is invalid.");
        // Save the returned identity before a later read/account/claim can fail.
        await store.update(compartment, "coding-create-identity", (s) => { s.codingSessions.find((t) => t.id === requestId).sessionId = sessionId; }, { provider: "codex" });
        const observation = await exact(sessionId, root), current = await account(compartment);
        if (current.fingerprint !== login.fingerprint) throw new Error("The local login changed while creating the task.");
        await store.claimSession(compartment, { provider: "codex", sessionId });
        return store.update(compartment, "coding-create-bind", (s) => { const task = s.codingSessions.find((t) => t.id === requestId); task.status = "registered"; task.observation = observation; return { ...view(task), modelPromptSubmitted: false }; }, { provider: "codex" });
      } catch (error) {
        await store.update(compartment, "coding-create-uncertain", (s) => { const task = s.codingSessions.find((t) => t.id === requestId); if (!task.sessionId && typeof error.createdThreadId === "string" && thread.test(error.createdThreadId)) task.sessionId = error.createdThreadId; task.status = "creation-uncertain"; }).catch(() => {});
        throw new Error(`${error.message} Creation is uncertain; this request will not launch another thread automatically.`);
      }
    },
    async status(compartment, id) {
      const login = await account(compartment), task = (await store.snapshot(compartment)).codingSessions?.find((t) => t.id === id);
      if (!task?.sessionId || task.schema !== "switchyard-coding-session/v1" || task.provider !== "codex") throw new Error("Select an exact saved coding task first.");
      if (task.accountFingerprint !== login.fingerprint) throw new Error("The local Codex login changed. This task was not redirected to another account.");
      await store.claimSession(compartment, { provider: "codex", sessionId: task.sessionId });
      const observation = await exact(task.sessionId, task.repositoryRoot);
      if ((await account(compartment)).fingerprint !== login.fingerprint) throw new Error("The local login changed during task observation.");
      return store.update(compartment, "coding-session-status", (s) => { const current = s.codingSessions.find((t) => t.id === id); if (current.sessionId !== task.sessionId || current.repositoryRoot !== task.repositoryRoot || current.accountFingerprint !== task.accountFingerprint) throw new Error("The exact task binding changed during observation."); current.observation = observation; if (["creating", "creation-uncertain"].includes(current.status)) current.status = "registered"; return view(current); }, { provider: "codex" });
    },
    async resume(compartment, id) {
      await store.authorize(compartment, { provider: "codex" });
      const key = `${compartment}:${id}`;
      if (resuming.has(key)) return resuming.get(key);
      const pending = (async () => {
        const login = await account(compartment), task = (await store.snapshot(compartment)).codingSessions?.find((t) => t.id === id);
        if (!task?.sessionId || task.schema !== "switchyard-coding-session/v1" || task.provider !== "codex" || task.status !== "registered" || task.launchPolicy !== "read-only/on-request") throw new Error("Runtime resume is implemented only for exact read-only tasks created by Switchyard. Existing task permissions are not changed.");
        if (task.accountFingerprint !== login.fingerprint) throw new Error("The local Codex login changed. This task was not resumed in another account.");
        await store.claimSession(compartment, { provider: "codex", sessionId: task.sessionId });
        const before = await exact(task.sessionId, task.repositoryRoot);
        if (["active", "waiting-on-approval"].includes(before.status)) throw new Error("This exact task is already active or awaiting approval. Its running permissions were preserved.");
        try {
          const result = await daemon.resume(task.sessionId, task.repositoryRoot);
          if (result.id !== task.sessionId || result.repositoryRoot !== task.repositoryRoot || result.permissions !== task.launchPolicy || result.modelPromptSubmitted !== false || !states.includes(result.observation)) throw new Error("Codex did not verify the exact resumed runtime and permissions.");
          if ((await account(compartment)).fingerprint !== login.fingerprint) throw new Error("The local login changed during resume.");
          return store.update(compartment, "coding-runtime-resume", (s) => {
            const current = s.codingSessions.find((t) => t.id === id);
            if (current.sessionId !== task.sessionId || current.repositoryRoot !== task.repositoryRoot || current.accountFingerprint !== task.accountFingerprint) throw new Error("The saved task binding changed during resume.");
            current.observation = { status: result.observation, observedAt: now(), provenance: "Exact Codex daemon thread resumed with read-only/on-request permissions; task completion unverified", completionVerified: false };
            current.lastResume = { at: now(), status: "acknowledged" };
            return { ...view(current), effect: "runtime-resumed", modelPromptSubmitted: false, windowFocusVerified: false };
          }, { provider: "codex" });
        } catch (error) {
          await store.update(compartment, "coding-resume-uncertain", (s) => { const current = s.codingSessions.find((t) => t.id === id); if (current) current.lastResume = { at: now(), status: "uncertain" }; }).catch(() => {});
          throw error;
        }
      })();
      resuming.set(key, pending);
      try { return await pending; } finally { if (resuming.get(key) === pending) resuming.delete(key); }
    }
  };
}
