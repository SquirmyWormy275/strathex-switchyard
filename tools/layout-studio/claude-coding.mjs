/** Actual Claude Code CLI inventory and owned background sessions; no title matching. */
import { randomUUID } from "node:crypto";
import { claudeAccount } from "./claude-account.mjs";
export { claudeAccount } from "./claude-account.mjs";
import { spawn } from "node:child_process";
import { lstat, realpath } from "node:fs/promises";
import { isAbsolute, join } from "node:path";
import { trustedCli } from "./agents.mjs";
import { directoryIdentity } from "./private-fs.mjs";
import { runtimeEnvironment } from "./runtime-setup.mjs";
import { scopeHash, suiteConfirmations } from "./confirmations.mjs";
import { stopOwnedChild } from "./owned-process.mjs";
import { createTaskWindow } from "./task-window.mjs";
import { repositoryIdentity, verifyRepositoryIdentity } from "./coding-task-identity.mjs";

const uuid = /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/;
const shortId = /^[a-f0-9]{8}$/;
const bounded = (v, max) => typeof v === "string" && v.trim().length > 0 && v.length <= max && !/[\0\r\n]/.test(v);
const adapter = { id: "switchyard.claude-code-cli", version: 1, platforms: ["linux", "win32"], testedApplicationVersion: "2.1.308", detection: "native CLI auth status and agents --json", accountScope: "fingerprint of local first-party login and provider-reported org ID; organization policy unverified" };
function supportedVersion(value) { const version = value.trim(); if (!/^2\.1\.(?:30[8-9]|3[1-9]\d|[4-9]\d\d|\d{4,}) \(Claude Code\)$/.test(version)) throw new Error("This native CLI version has not established the required agent inventory contract."); return version; }
export function claudeInventory(value, root) {
  if (!Array.isArray(value) || value.length > 256) throw new Error("Claude inventory exceeds its supported contract.");
  const rows = value.filter((v) => v?.cwd === root).map((v) => {
    const invalid = [
      !["interactive", "background"].includes(v.kind) && "session kind",
      (!Number.isSafeInteger(v.startedAt) || v.startedAt < 0) && "start time",
      v.sessionId != null && !uuid.test(v.sessionId) && "session UUID",
      v.kind === "background" && !shortId.test(v.id ?? "") && "background ID",
      v.kind === "background" && !["working", "blocked", "done", "failed", "stopped"].includes(v.state) && "background runtime state",
      v.pid != null && (!Number.isSafeInteger(v.pid) || v.pid < 1) && "process ID",
      v.pid != null && !["busy", "waiting", "idle"].includes(v.status) && "process runtime state"
    ].filter(Boolean);
    if (invalid.length) throw new Error(`Claude returned an unsupported or not-yet-verified ${invalid.join(", ")}. Refresh native inventory after startup; no session was guessed.`);
    return { kind: v.kind, sessionId: v.sessionId ?? null, backgroundId: v.kind === "background" ? v.id : null, repositoryRoot: root, startedAt: v.startedAt, pid: v.pid ?? null, processStatus: v.pid == null ? null : v.status, state: v.kind === "background" ? v.state : null, waitingFor: v.status === "waiting" && ["permission prompt", "input needed", "sandbox request", "worker request", "dialog open"].includes(v.waitingFor) ? v.waitingFor : null };
  });
  if (new Set(rows.filter((r) => r.sessionId).map((r) => r.sessionId)).size !== rows.filter((r) => r.sessionId).length || new Set(rows.filter((r) => r.backgroundId).map((r) => r.backgroundId)).size !== rows.filter((r) => r.backgroundId).length) throw new Error("Claude returned ambiguous exact session identities.");
  return rows;
}
async function repository(value) {
  if (!bounded(value, 4096) || !isAbsolute(value)) throw new Error("Choose an exact local working directory with Git metadata.");
  await directoryIdentity(value); const root = await realpath(value), git = await lstat(join(root, ".git"));
  if (git.isSymbolicLink() || !git.isDirectory() && !git.isFile()) throw new Error("The selected directory has unsupported Git metadata.");
  return root;
}
export function createClaudeCoding({ store, resolveCli = trustedCli, run, platform = process.platform, now = () => Date.now(), windows = createTaskWindow({ platform }) } = {}) {
  const children = new Set(), generations = new Map(), seen = new Set(); let closed = false;
  const fence = (c) => generations.get(c) ?? 0;
  function current(c, generation) { if (closed || fence(c) !== generation) throw new Error("This Claude operation was stopped before its next effect."); }
  async function access(c) { await store.authorize(c, { provider: "claude-code" }); if (!adapter.platforms.includes(platform)) throw new Error("Claude coding-task control is not implemented on this platform."); seen.add(c); return resolveCli("claude-code"); }
  async function execute(c, args, cwd, generation = fence(c), cleanup = false) {
    const executable = cleanup ? await resolveCli("claude-code") : await access(c);
    if (!cleanup) current(c, generation);
    if (run) return run(executable, args, { cwd });
    return new Promise((resolve, reject) => {
      const child = spawn(executable, args, { cwd, shell: false, windowsHide: true, stdio: ["ignore", "pipe", "pipe"], env: { ...runtimeEnvironment(), DISABLE_TELEMETRY: "1", DISABLE_ERROR_REPORTING: "1", CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC: "1" } });
      child.stdout.setEncoding("utf8"); child.stderr.setEncoding("utf8");
      const owned = { child, compartment: c }; children.add(owned);
      let stdout = "", stderr = "", failed = false;
      const fail = () => { if (!failed) { failed = true; reject(new Error("The native Claude command did not complete within its bounded contract. Its outcome is uncertain; no fallback or automatic retry was selected.")); void stopOwnedChild(child); } };
      const timer = setTimeout(fail, 20000);
      child.stdout.on("data", (b) => { stdout += b; if (Buffer.byteLength(stdout) > 256 * 1024) fail(); });
      child.stderr.on("data", (b) => { stderr += b; if (Buffer.byteLength(stderr) > 65536) fail(); });
      child.on("error", fail);
      child.on("close", (code) => { clearTimeout(timer); children.delete(owned); if (failed) return; if (code !== 0) { const trustRejected = args[0] === "--background" && !stdout.trim() && /Workspace not trusted/.test(stderr); reject(Object.assign(new Error(trustRejected ? "Open Claude in this exact directory once and review its native workspace trust dialog before starting a background task." : "The native Claude command was rejected. Check the installed CLI and its local account; no provider fallback was selected."), trustRejected ? { code: "CLAUDE_WORKSPACE_TRUST_REQUIRED", noEffectVerified: true } : {})); } else resolve(stdout); });
    });
  }
  async function account(c, generation = fence(c)) { supportedVersion(await execute(c, ["--version"], undefined, generation)); const result = claudeAccount(JSON.parse(await execute(c, ["auth", "status", "--json"], undefined, generation))); current(c, generation); return result; }
  async function inventory(c, root, generation = fence(c), cleanup = false) { return claudeInventory(JSON.parse(await execute(c, ["agents", "--json", "--all", "--cwd", root], root, generation, cleanup)), root); }
  function observation(row) {
    const status = !row ? "not-observed" : row.state === "stopped" ? "stopped" : row.state === "failed" ? "error" : row.state === "done" ? "provider-turn-finished" : row.state === "blocked" || row.processStatus === "waiting" ? row.waitingFor === "permission prompt" ? "waiting-on-approval" : "waiting-for-input" : row.state === "working" || row.processStatus === "busy" ? "active" : row.processStatus === "idle" ? "idle" : "unknown";
    return { status, observedAt: now(), providerState: row?.state ?? null, processStatus: row?.processStatus ?? null, processId: row?.pid ?? null, processStartedAt: row?.pid ? row.startedAt : null, sessionKind: row?.kind ?? null, provenance: "Claude Code native CLI inventory; provider turn state is not independent task-completion evidence", completionVerified: false };
  }
  function view(t) {
    const fresh = t.observation && now() - t.observation.observedAt >= 0 && now() - t.observation.observedAt <= 30000;
    const focused = fresh && t.lastWindowFocus?.status === "verified" && t.lastWindowFocus.sessionId === t.sessionId && t.lastWindowFocus.processId === t.observation.processId && t.lastWindowFocus.processStartedAt === t.observation.processStartedAt && now() - t.lastWindowFocus.at >= 0 && now() - t.lastWindowFocus.at <= 30000;
    return { ...t, observation: fresh ? t.observation : { status: "stale", observedAt: t.observation?.observedAt ?? null, completionVerified: false }, capabilities: { sessionIdentifiable: Boolean(t.sessionId) && t.nativeIdentityVerified !== false, observable: Boolean(t.sessionId || t.backgroundId), textReviewAvailable: t.status === "registered" && t.launchPolicy === "tools-disabled/plan", focusable: Boolean(focused), launchable: false, resumable: false, controllable: false, cancellable: t.status === "registered" && t.launchPolicy === "tools-disabled/plan" && Boolean(t.backgroundId), mediated: false }, accountScope: { type: "local first-party login fingerprint", organizationVerified: false } };
  }
  function taskIn(s, id) { const task = s.codingSessions?.find((t) => t.id === id && t.provider === "claude-code" && t.schema === "switchyard-coding-session/v1"); if (!task) throw new Error("Choose an exact saved Claude coding task."); return task; }
  async function exact(c, id, generation = fence(c)) {
    const login = await account(c, generation), task = taskIn(await store.snapshot(c), id);
    if (task.accountFingerprint !== login) throw new Error("The local Claude login changed. This task was not redirected to another account.");
    await verifyRepositoryIdentity(task);
    if (!task.sessionId && !task.backgroundId) throw new Error("No exact Claude session identity was returned. Review native inventory and deliberately bind an identified session; this request will not guess or relaunch.");
    const rows = await inventory(c, task.repositoryRoot, generation), row = rows.find((r) => task.backgroundId ? r.backgroundId === task.backgroundId : r.sessionId === task.sessionId);
    if (row && task.sessionId && row.sessionId !== task.sessionId) throw new Error("The exact Claude session identity changed; review this binding deliberately.");
    if (row?.sessionId) await store.claimSession(c, { provider: "claude-code", sessionId: row.sessionId });
    if (await account(c, generation) !== login) throw new Error("The local Claude login changed during observation.");
    await verifyRepositoryIdentity(task);
    current(c, generation); return { task, row };
  }
  const reviewed = (c, t, r) => ({ action: "stop_managed_run", sessionId: t.sessionId, targetSnapshotId: scopeHash(["claude-owned-background-stop/v1", c, t.id, t.sessionId, t.backgroundId, t.repositoryRoot, t.accountFingerprint, t.startedAt, r.pid]), scopeDigest: scopeHash([t.launchPolicy, r]) });
  async function cleanupCompartment(c) {
    generations.set(c, fence(c) + 1);
    const stopped = await Promise.all([...children].filter((r) => r.compartment === c).map((r) => stopOwnedChild(r.child)));
    let backgroundTasksStopped = true, backgroundTasks = 0;
    const tasks = ((await store.snapshot(c)).codingSessions ?? []).filter((t) => t.provider === "claude-code" && t.launchPolicy === "tools-disabled/plan" && t.nativeTransport !== "owned-print");
    for (const t of tasks) {
      if (!t.backgroundId || !t.sessionId || t.startedAt == null) { if (["creating", "creation-uncertain"].includes(t.status)) backgroundTasksStopped = false; continue; }
      try {
        supportedVersion(await execute(c, ["--version"], undefined, fence(c), true));
        const before = (await inventory(c, t.repositoryRoot, fence(c), true)).find((r) => r.backgroundId === t.backgroundId);
        if (!before || before.sessionId !== t.sessionId) throw new Error("Owned Claude background identity could not be verified for cleanup.");
        if (before.state !== "stopped" || before.pid !== null) await execute(c, ["stop", t.backgroundId], t.repositoryRoot, fence(c), true);
        const after = (await inventory(c, t.repositoryRoot, fence(c), true)).find((r) => r.backgroundId === t.backgroundId);
        if (!after || after.sessionId !== t.sessionId || after.state !== "stopped" || after.pid !== null) throw new Error("Owned Claude background cleanup was not confirmed.");
        backgroundTasks++;
        await store.update(c, "claude-owned-cleanup", (s) => { taskIn(s, t.id).observation = observation(after); });
      } catch { backgroundTasksStopped = false; }
    }
    return { stopped: stopped.every((r) => r.stopped) && backgroundTasksStopped, ownedCommandChildren: stopped.length, backgroundTasks, backgroundTasksStopped, externalTaskCompletionVerified: false };
  }
  return {
    async discovery(c) {
      const result = { adapter, provider: "claude-code", installed: null, available: false };
      try { await store.authorize(c, { provider: "claude-code" }); } catch (e) { return { ...result, permitted: false, reason: e.message }; }
      try { await access(c); result.installed = true; const version = supportedVersion(await execute(c, ["--version"])); await account(c); return { ...result, available: true, permitted: true, version, capabilities: ["exact-coding-task-bind", "runtime-status", "reserve-reviewed-text-task", "create-empty-tools-disabled-background", "reviewed-owned-background-stop", ...(platform === "linux" ? ["focus-live-interactive-foot-window"] : [])] }; }
      catch (e) { return { ...result, permitted: true, reason: e.message }; }
    },
    async inventory(c, { repositoryRoot }) { const root = await repository(repositoryRoot); await account(c); return inventory(c, root); },
    async list(c) { await access(c); return ((await store.snapshot(c)).codingSessions ?? []).filter((t) => t.provider === "claude-code").map(view); },
    async bind(c, { sessionId, repositoryRoot, label }) {
      const generation = fence(c), login = await account(c, generation), root = await repository(repositoryRoot), identity = await repositoryIdentity(root);
      if (!uuid.test(sessionId ?? "") || !bounded(label, 100)) throw new Error("Choose a full Claude session UUID and a short local task label.");
      const row = (await inventory(c, root, generation)).find((r) => r.sessionId === sessionId);
      if (!row) throw new Error("Claude did not report that exact session in the selected directory. No title or most-recent session was guessed.");
      if (await account(c, generation) !== login) throw new Error("The local Claude login changed while binding.");
      await verifyRepositoryIdentity({ repositoryRoot: root, repositoryIdentity: identity });
      await store.claimSession(c, { provider: "claude-code", sessionId }); current(c, generation);
      return store.update(c, "claude-coding-bind", (s) => {
        s.codingSessions ??= []; const found = s.codingSessions.find((t) => t.provider === "claude-code" && t.sessionId === sessionId);
        if (found) { if (found.repositoryRoot !== root || found.accountFingerprint !== login || found.backgroundId !== row.backgroundId || found.repositoryIdentity && (found.repositoryIdentity.device !== identity.device || found.repositoryIdentity.inode !== identity.inode)) throw new Error("This saved Claude task changed its exact local context."); found.repositoryIdentity ??= identity; found.observation = observation(row); return { ...view(found), duplicatePrevented: true }; }
        if (s.codingSessions.length >= 64) throw new Error("Saved coding-task limit reached.");
        const task = { schema: "switchyard-coding-session/v1", id: randomUUID(), provider: "claude-code", label: label.trim(), repositoryRoot: root, repositoryIdentity: identity, accountFingerprint: login, sessionId, backgroundId: row.backgroundId, startedAt: row.startedAt, status: "registered", createdAt: now(), observation: observation(row) };
        s.codingSessions.push(task); return view(task);
      }, { provider: "claude-code" });
    },
    async createText(c, { requestId, repositoryRoot, label }) {
      const generation = fence(c), login = await account(c, generation), root = await repository(repositoryRoot), identity = await repositoryIdentity(root);
      if (!uuid.test(requestId ?? "") || !bounded(label, 100)) throw new Error("A reviewed Claude text task needs a stable request UUID and a short local label.");
      current(c, generation); await verifyRepositoryIdentity({ repositoryRoot: root, repositoryIdentity: identity });
      return store.update(c, "claude-text-task-reserve", (s) => {
        current(c, generation); s.codingSessions ??= []; const found = s.codingSessions.find((t) => t.id === requestId);
        if (found) { if (found.provider !== "claude-code" || found.nativeTransport !== "owned-print" || found.repositoryRoot !== root || found.accountFingerprint !== login || found.label !== label.trim() || found.repositoryIdentity?.device !== identity.device || found.repositoryIdentity?.inode !== identity.inode) throw new Error("This request already names another task, account or directory identity."); return { ...view(found), duplicatePrevented: true }; }
        if (s.codingSessions.length >= 64) throw new Error("Saved coding-task limit reached.");
        const task = { schema: "switchyard-coding-session/v1", id: requestId, provider: "claude-code", label: label.trim(), repositoryRoot: root, repositoryIdentity: identity, accountFingerprint: login, sessionId: randomUUID(), backgroundId: null, nativeTransport: "owned-print", nativeIdentityVerified: false, launchPolicy: "tools-disabled/plan", status: "registered", createdAt: now(), observation: { status: "reserved-locally", observedAt: now(), completionVerified: false, provenance: "Requested UUID only; native conversation creation requires its first reviewed reply" } };
        s.codingSessions.push(task); return { ...view(task), modelPromptSubmitted: false, nativeConversationCreated: false };
      }, { provider: "claude-code" });
    },
    async create(c, { requestId, repositoryRoot, label }) {
      const generation = fence(c), login = await account(c, generation), root = await repository(repositoryRoot), identity = await repositoryIdentity(root);
      if (!uuid.test(requestId ?? "") || !bounded(label, 100)) throw new Error("An empty Claude task needs a stable request UUID and a short local label.");
      const reserved = await store.update(c, "claude-create-reserve", (s) => {
        s.codingSessions ??= []; const found = s.codingSessions.find((t) => t.id === requestId);
        if (found) { if (found.provider !== "claude-code" || found.repositoryRoot !== root || found.accountFingerprint !== login) throw new Error("This request identity already names another task or local account."); return view(found); }
        if (s.codingSessions.length >= 64) throw new Error("Saved coding-task limit reached.");
        s.codingSessions.push({ schema: "switchyard-coding-session/v1", id: requestId, provider: "claude-code", label: label.trim(), repositoryRoot: root, repositoryIdentity: identity, accountFingerprint: login, sessionId: null, backgroundId: null, launchPolicy: "tools-disabled/plan", status: "creating", createdAt: now(), observation: null }); return null;
      }, { provider: "claude-code" });
      if (reserved) return { ...reserved, duplicatePrevented: true };
      try {
        current(c, generation);
        const stdout = await execute(c, ["--background", "--name", `switchyard-${requestId}`, "--safe-mode", "--tools", "", "--strict-mcp-config", "--mcp-config", '{"mcpServers":{}}', "--setting-sources", "", "--settings", '{"disableAllHooks":true}', "--permission-mode", "plan", "--no-chrome"], root, generation);
        const matches = [...stdout.matchAll(/(?:^|\n)backgrounded · ([a-f0-9]{8})(?:[ \n·(]|$)/g)];
        if (matches.length !== 1) throw new Error("Claude did not return one exact background-session ID.");
        const backgroundId = matches[0][1];
        await store.update(c, "claude-create-identity", (s) => { taskIn(s, requestId).backgroundId = backgroundId; });
        const row = (await inventory(c, root, generation)).find((r) => r.backgroundId === backgroundId);
        if (!row?.sessionId) throw new Error("The new Claude background session has no verified full session UUID yet.");
        await store.update(c, "claude-create-full-identity", (s) => { const t = taskIn(s, requestId); t.sessionId = row.sessionId; t.startedAt = row.startedAt; });
        if (await account(c, generation) !== login) throw new Error("The local Claude login changed during creation.");
        await verifyRepositoryIdentity({ repositoryRoot: root, repositoryIdentity: identity });
        await store.claimSession(c, { provider: "claude-code", sessionId: row.sessionId }); current(c, generation);
        return store.update(c, "claude-create-bind", (s) => { const t = taskIn(s, requestId); t.status = "registered"; t.observation = observation(row); return { ...view(t), modelPromptSubmitted: false }; }, { provider: "claude-code" });
      } catch (e) {
        const rejected = e.code === "CLAUDE_WORKSPACE_TRUST_REQUIRED" && e.noEffectVerified === true;
        await store.update(c, "claude-create-uncertain", (s) => { const t = taskIn(s, requestId); if (rejected && !t.sessionId && !t.backgroundId) { t.status = "creation-rejected"; t.noEffectVerified = true; t.creationRejection = "native-workspace-trust-required"; } else t.status = "creation-uncertain"; }).catch(() => {});
        throw new Error(`${e.message} ${rejected ? "The native workspace gate rejected creation before a job identity was returned; native trust settings were preserved." : "Creation is uncertain; this request will not create another background session automatically."}`);
      }
    },
    async status(c, id) {
      const saved = taskIn(await store.snapshot(c), id);
      if (saved.nativeTransport === "owned-print") {
        const generation = fence(c); if (await account(c, generation) !== saved.accountFingerprint) throw new Error("The local Claude login changed. This task was not redirected to another account.");
        await verifyRepositoryIdentity(saved); current(c, generation);
        return { ...view(saved), observation: { status: saved.nativeIdentityVerified ? "saved-conversation" : saved.status === "creation-uncertain" ? "creation-unconfirmed" : "reserved-locally", observedAt: now(), completionVerified: false, provenance: "Protected local reviewed-turn record; no live provider activity or task completion is inferred" } };
      }
      const { task, row } = await exact(c, id);
      return store.update(c, "claude-coding-status", (s) => { const t = taskIn(s, id); if (t.sessionId !== task.sessionId || t.backgroundId !== task.backgroundId || t.accountFingerprint !== task.accountFingerprint) throw new Error("The saved Claude task changed during observation."); t.observation = observation(row); if (row?.sessionId) { t.sessionId = row.sessionId; t.startedAt = row.startedAt; t.status = "registered"; } return view(t); }, { provider: "claude-code" });
    },
    async reviewStop(c, id) {
      const { task, row } = await exact(c, id);
      if (task.launchPolicy !== "tools-disabled/plan" || task.status !== "registered" || !task.backgroundId || !row?.sessionId) throw new Error("Reviewed stop is limited to exact background tasks created by Switchyard. External sessions are observation-only.");
      if (row.state === "stopped" && row.pid === null) return { effect: "already-stopped", taskCompletionVerified: false };
      const confirmation = await suiteConfirmations(store, c, "claude-code", now).issue({ ...reviewed(c, task, row), reason: "Stop this exact owned Claude background session; retain its conversation. Previous effects and task completion remain unverified.", reauthenticated: false });
      return { status: "requires-confirmation", taskId: id, confirmation, scope: { provider: "claude-code", label: task.label, repositoryRoot: task.repositoryRoot, sessionId: task.sessionId, backgroundId: task.backgroundId, processId: row.pid }, taskCompletionVerified: false };
    },
    async focus(c, id) {
      const generation = fence(c), { task, row } = await exact(c, id, generation), executable = await access(c);
      if (row?.kind !== "interactive" || !row.pid) throw new Error("Only a live exact interactive Claude session can be focused. Background worker PIDs are not attached-terminal identities.");
      const result = await windows.focus({ row, executable, repositoryRoot: task.repositoryRoot, verifySession: async () => { const check = await exact(c, id, generation); if (!check.row || check.row.kind !== row.kind || check.row.sessionId !== row.sessionId || check.row.pid !== row.pid || check.row.startedAt !== row.startedAt) throw new Error("Claude's exact interactive session changed during native window focus."); } });
      return store.update(c, "claude-window-focus", (s) => { const t = taskIn(s, id); t.lastWindowFocus = { at: now(), status: "verified", sessionId: task.sessionId, processId: row.pid, processStartedAt: row.startedAt }; t.observation = observation(row); return { id, sessionId: task.sessionId, ...result }; }, { provider: "claude-code" });
    },
    async stop(c, { id, token }) {
      if (!uuid.test(token ?? "")) throw new Error("Use the exact one-use confirmation token from reviewing this owned session stop.");
      const generation = fence(c), { task, row } = await exact(c, id, generation);
      if (task.launchPolicy !== "tools-disabled/plan" || task.status !== "registered" || !task.backgroundId || !row?.sessionId) throw new Error("Only an exact owned Claude background session can be stopped here.");
      const decision = await suiteConfirmations(store, c, "claude-code", now).consume({ ...reviewed(c, task, row), token });
      if (!decision.allowed) throw new Error(decision.reason);
      current(c, generation);
      try {
        await execute(c, ["stop", task.backgroundId], task.repositoryRoot, generation);
        const after = (await inventory(c, task.repositoryRoot, generation)).find((r) => r.backgroundId === task.backgroundId);
        if (!after || after.sessionId !== task.sessionId || after.state !== "stopped" || after.pid !== null) throw new Error("Claude did not read back the exact stopped session; its stop remains uncertain.");
        return store.update(c, "claude-owned-stop", (s) => { const t = taskIn(s, id); t.observation = observation(after); t.lastStop = { at: now(), status: "provider-reported-stopped" }; return { ...view(t), effect: "provider-reported-stopped", taskCompletionVerified: false }; }, { provider: "claude-code" });
      } catch (e) { await store.update(c, "claude-stop-uncertain", (s) => { taskIn(s, id).lastStop = { at: now(), status: "uncertain" }; }).catch(() => {}); throw e; }
    },
    stopCompartment: cleanupCompartment,
    async close() { closed = true; return Promise.all([...seen].map(cleanupCompartment)); }
  };
}
