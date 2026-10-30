/** Shared product state and bounded operations behind the authenticated origin. */
import { randomUUID } from "node:crypto";
import { homedir } from "node:os";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import { join } from "node:path";
import { createSuiteStore } from "./suite-store.mjs";
import { createAgentService } from "./agents.mjs";
import { localVoice } from "./voice.mjs";
import { parseWorkflow, observationSummary } from "./workflow.mjs";
import { surfaceForClass } from "../../scripts/workflow-monitor.mjs";
import { runHypr, nativeChatgptWindow } from "./host.mjs";
import { createDeviceService } from "./devices.mjs";
import { createCopilot } from "./copilot.mjs";
import { createCustomAgents, agentIntents } from "./custom-agents.mjs";
import { runtimeEnvironment } from "./runtime-setup.mjs";
import { resolveRuntimePaths } from "./runtime-storage.mjs";
import { createCodingSessions } from "./coding-sessions.mjs";
import { createCodexSubmissions } from "./codex-submissions.mjs";
import { createClaudeSubmissions } from "./claude-submissions.mjs";
import { stopOwnedChild } from "./owned-process.mjs";
import { createClaudeCoding } from "./claude-coding.mjs";
import { createVoiceQueue, reviewTranscript } from "./voice-queue.mjs";
import { exportAssignmentLegends } from "./legend-export.mjs";
import { identifyCatalogSnapshot } from "./catalog-identity.mjs";
import sourceCatalog from "./model-f-catalog.json" with { type: "json" };
import { createReadoutProfiles } from "./readout-profiles.mjs";
import { createKeyboardIndicators } from "./keyboard-indicators.mjs";

const kinds = ["interruption", "resume", "switch", "handoff", "status", "review", "approval", "failure", "recovery", "other"];
export function createSuite({ store = createSuiteStore(), agents, voice = localVoice(), hypr = runHypr, devices, copilot, coding, codexSubmissions, claudeCoding, claudeSubmissions, keyboardIndicators = createKeyboardIndicators(), spawnExample = spawn, foreground, scheduleForeground = setInterval, clearForeground = clearInterval } = {}) {
  agents ??= createAgentService({ store, runtimeRoot: join(process.env.XDG_RUNTIME_DIR || process.env.LOCALAPPDATA || join(homedir(), ".local/state"), "switchyard-design") });
  devices ??= createDeviceService({ store });
  copilot ??= createCopilot({ store });
  coding ??= createCodingSessions({ store });
  codexSubmissions ??= createCodexSubmissions({ store });
  claudeSubmissions ??= createClaudeSubmissions({ store });
  claudeCoding ??= createClaudeCoding({ store });
  const custom = createCustomAgents({ store });
  const voiceQueue = createVoiceQueue({ store, voice });
  const readoutProfiles = createReadoutProfiles({ store, catalog: sourceCatalog });
  foreground ??= process.platform === "linux" ? { implemented: true, read: async (c, beforeStart) => { await beforeStart(); return { available: true, category: surfaceForClass(JSON.parse(await hypr("activewindow", "-j")).class), provenance: "Hyprland application class; no task identity" }; }, stopCompartment: async () => ({ stopped: true }), close: async () => {} } : { implemented: false };
  const examples = new Map(), exampleGenerations = new Map(), exampleStarts = new Map();
  const started = new Set(), initializing = new Map(), monitors = new Map();
  let activeCompartment = "personal";
  let selectionLoaded = false;
  let selectionLoading;
  let closed = false;
  async function stopExample(compartment, example) {
    const key = `${compartment}:${example}`, child = examples.get(key);
    exampleGenerations.set(key, (exampleGenerations.get(key) ?? 0) + 1);
    await exampleStarts.get(key)?.catch(() => {});
    const result = await stopOwnedChild(child);
    if (child && result.stopped && examples.get(key) === child) examples.delete(key);
    await store.update(compartment, "example-stopped", (s) => {
      const a = s.agents.find((a) => a.id === `${example}-example`);
      if (a) { a.reportedStatus = child && result.stopped ? "stopped" : "unknown"; a.lastSeen = null; a.provenance = child && result.stopped ? "owned bundled example process exited; external task outcome unverified" : "no owned example process observed in this runtime"; }
    });
    return { status: result.stopped ? (child ? "stopped" : "not-observed") : "stop-unconfirmed", evidence: result.evidence, taskCompletionVerified: false };
  }
  async function initialize(id, policy) {
    if (started.has(id)) { if (policy !== undefined) await store.initialize(id, policy); return; }
    if (initializing.has(id)) { await initializing.get(id); if (policy !== undefined) await store.initialize(id, policy); return; }
    const pending = (async () => {
      await store.initialize(id, policy);
      await store.update(id, "restart-recovery", (s) => { for (const o of s.observations) if (["recording", "paused"].includes(o.status)) o.status = "interrupted"; for (const v of s.voice) if (v.status === "recording") v.status = "paused"; for (const c of s.conversations) if (c.status === "pending") c.status = "interrupted"; for (const t of s.deviceTransactions ?? []) if (t.status === "applying") t.status = "recovery-pending"; for (const t of s.codingSessions ?? []) if (t.status === "creating") t.status = "creation-uncertain"; for (const t of s.codingTurns ?? []) if (["reserved", "submitting", "submitted", "cancellation-requested"].includes(t.status)) t.status = "outcome-unconfirmed"; });
      await store.update(id, "claude-creation-recovery", (s) => { for (const task of s.codingSessions ?? []) if (task.provider === "claude-code" && task.nativeTransport === "owned-print" && task.nativeIdentityVerified === false && (s.codingTurns ?? []).some((turn) => turn.taskId === task.id && !["failed-before-turn"].includes(turn.status))) task.status = "creation-uncertain"; });
      started.add(id);
    })();
    initializing.set(id, pending);
    try { await pending; } finally { if (initializing.get(id) === pending) initializing.delete(id); }
  }
  async function loadSelection() {
    if (selectionLoaded) return;
    selectionLoading ??= (async () => { await initialize("personal"); activeCompartment = await store.selection(); await initialize(activeCompartment); selectionLoaded = true; })().finally(() => { selectionLoading = null; });
    await selectionLoading;
  }
  function roleTarget(state, roleId, intent) {
    if (!agentIntents.includes(intent) || !state.workflow.roles.some((r) => r.id === roleId)) throw new Error("Choose an existing workflow role and supported intent.");
    const binding = state.roleBindings?.find((b) => b.roleId === roleId && b.intent === intent);
    if (!binding) throw new Error("Bind this role and intent to an exact permitted session first.");
    if (binding.provider === "microsoft-365-copilot" && intent === "cancel") throw new Error("The selected Graph contract does not provide cancellation. Choose a supported role intent.");
    if (binding.targetKind === "coding-task") {
      const task = state.codingSessions?.find((t) => t.id === binding.targetId && t.provider === binding.provider && t.sessionId === binding.sessionId && t.schema === "switchyard-coding-session/v1");
      if (!task || !(intent === "status" && ["codex", "claude-code"].includes(binding.provider) || binding.provider === "claude-code" && intent === "summon" && task.backgroundId === null && task.status === "registered" || binding.provider === "codex" && intent === "resume" && task.launchPolicy === "read-only/on-request" && task.nativeTransport !== "owned-stdio" && task.status === "registered")) throw new Error("This exact coding-task binding supports runtime status only, plus verified live Claude focus or legacy owned read-only Codex daemon resume. Dedicated tasks continue through explicit text review. No alternate session action was selected.");
    } else if (binding.provider === "custom-agent") {
      const a = state.agents.find((a) => a.id === binding.targetId && a.sessionId === binding.sessionId);
      if (!a || !a.capabilities.includes(intent) || !a.lastSeen || Date.now() - a.lastSeen > 30000 || a.reportedStatus === "stopped") throw new Error("This exact custom-agent target is missing, stale or does not support that intent.");
    } else if (!state.conversations.some((c) => c.id === binding.targetId && c.provider === binding.provider && c.sessionId === binding.sessionId)) throw new Error("This exact role target changed or disappeared. Rebind it deliberately.");
    return binding;
  }
  const session = (s, id) => { const found = s.observations.find((o) => o.id === id); if (!found) throw new Error("That observation session is unavailable in this compartment."); return found; };
  const voiceSession = (s, id) => { const found = s.voice.find((o) => o.id === id); if (!found) throw new Error("That voice session is unavailable in this compartment."); return found; };
  function pauseMonitor(compartment) { if (monitors.has(compartment)) clearForeground(monitors.get(compartment)); monitors.delete(compartment); }
  function monitor(compartment, id) {
    pauseMonitor(compartment);
    let pending = false, last = Date.now(), unavailable = 0;
    const current = () => !closed && monitors.get(compartment) === timer;
    const authorize = async () => { if (!current()) throw new Error("Observation stopped."); await store.authorize(compartment, { operation: "record" }); if (!current()) throw new Error("Observation stopped."); };
    const timer = scheduleForeground(async () => {
      if (pending) return; pending = true;
      try {
        await authorize(); const result = await foreground.read(compartment, authorize), at = Date.now(); await authorize();
        if (!result.available) { last = at; if (++unavailable < 3) return; throw new Error("Foreground unavailable."); }
        if (!["terminal", "vscode", "chatgpt", "claude", "codex", "browser", "other"].includes(result.category)) throw new Error("Unsupported foreground category.");
        unavailable = 0;
        await store.update(compartment, "focus-category", (s) => { const o = session(s, id); if (!current() || o.status !== "recording" || !o.sources.includes("foreground-category")) return; o.sourceStates ??= {}; o.sourceStates["foreground-category"] = { status: "sampling", provenance: result.provenance, at, timing: "two-second sampled category estimate; no task or content inference" }; if (!o.exclusions.includes(result.category)) o.focusCategories[result.category] = (o.focusCategories[result.category] ?? 0) + Math.max(0, Math.min(60000, at - last)); o.updatedAt = at; }, { operation: "record" }); last = at;
      } catch {
        if (current()) {
          pauseMonitor(compartment);
          try { await store.update(compartment, "focus-unavailable", (s) => { const o = session(s, id); o.sourceStates ??= {}; o.sourceStates["foreground-category"] = { status: "unavailable", reason: "Foreground categories are unavailable. Pause and deliberately resume to retry.", at: Date.now() }; if (o.sources.length === 1 && o.status === "recording") o.status = "paused"; }, { operation: "record" }); } catch { /* A policy change or deletion wins over a late sample. */ }
          try { await foreground.stopCompartment?.(compartment); } catch { /* The source is already marked unavailable; no automatic restart. */ }
        }
      }
      finally { pending = false; }
    }, 2000);
    timer.unref?.(); monitors.set(compartment, timer);
  }
  return {
    store, agents,
    agentMessage: (path, body, signature, raw) => custom.message(path, body, signature, raw),
    async handle(path, body = {}) {
      if (closed) throw new Error("This local suite is closed.");
      const compartment = body.compartment ?? "personal";
      if (path === "/api/suite/bootstrap") {
        await loadSelection();
        return { compartments: await store.list(), activeCompartment, agents: await agents.discovery(), voice: await voice.discovery() };
      }
      if (path === "/api/suite/compartment/create") { await initialize(compartment, body.policy); return { id: compartment }; }
      if (!started.has(compartment)) { const list = await store.list(); if (!list.some((c) => c.id === compartment)) throw new Error("Choose or create this compartment first."); await initialize(compartment); }
      if (path === "/api/suite/compartment/select") {
        if (activeCompartment !== compartment) {
          pauseMonitor(activeCompartment); await foreground.stopCompartment?.(activeCompartment);
          await store.update(activeCompartment, "compartment-suspend-sources", (s) => { for (const o of s.observations) if (o.status === "recording") o.status = "paused"; for (const v of s.voice) if (v.status === "recording") v.status = "paused"; });
        }
        await store.selection(compartment); activeCompartment = compartment; return { id: compartment };
      }
      if (path === "/api/suite/mode") {
        const result = await store.update(compartment, "mode-select", (s) => {
          if (!["keyboard-only", s.policy === "work" ? "managed-companion" : "personal-companion"].includes(body.mode)) throw new Error("Choose keyboard-only or the companion mode matching this workspace's policy.");
          s.mode = body.mode; s.modeSelectedAt = Date.now();
          if (body.mode === "keyboard-only") { for (const o of s.observations) if (o.status === "recording") o.status = "paused"; for (const v of s.voice) if (v.status === "recording") v.status = "paused"; }
          return { mode: s.mode, policyStillEnforced: true };
        });
        if (body.mode === "keyboard-only") {
          pauseMonitor(compartment);
          // Stop the exact print continuation before reconciling the original
          // background inventory, which can briefly report the same session.
          const claudeTextStop = await claudeSubmissions.stopCompartment(compartment).catch(() => ({ stopped: false }));
          const stopped = await Promise.all([foreground.stopCompartment?.(compartment), agents.stopCompartment?.(compartment), coding.stopCompartment?.(compartment), codexSubmissions.stopCompartment(compartment), claudeTextStop, voiceQueue.stopCompartment(compartment), claudeCoding.stopCompartment?.(compartment), ...["custom", "langchain"].map((kind) => stopExample(compartment, kind))]);
          result.ownedProcessesStopped = stopped.every((r) => !r || r.stopped !== false && r.status !== "stop-unconfirmed");
          if (!result.ownedProcessesStopped) throw new Error("Keyboard-only mode was saved, but an owned process stop is unconfirmed. No new provider or recording operation is permitted.");
        }
        return result;
      }
      if (path === "/api/suite/coding/codex/discovery") return coding.discovery(compartment);
      if (path === "/api/suite/coding/codex/list") return coding.list(compartment);
      if (path === "/api/suite/coding/codex/bind") return coding.bind(compartment, body);
      if (path === "/api/suite/coding/codex/create") return coding.create(compartment, body);
      if (path === "/api/suite/coding/codex/status") return coding.status(compartment, body.id);
      if (path === "/api/suite/coding/codex/resume") return coding.resume(compartment, body.id);
      if (path === "/api/suite/coding/codex/turns/list") return codexSubmissions.list(compartment);
      if (path === "/api/suite/coding/codex/turns/review") return codexSubmissions.review(compartment, body);
      if (path === "/api/suite/coding/codex/turns/submit") return codexSubmissions.submit(compartment, body);
      if (path === "/api/suite/coding/codex/turns/cancel") return codexSubmissions.cancel(compartment, body.requestId);
      if (path === "/api/suite/coding/codex/turns/outcome/review") return codexSubmissions.reviewOutcome(compartment, body.id);
      if (path === "/api/suite/coding/codex/turns/outcome/resolve") return codexSubmissions.resolveOutcome(compartment, body);
      if (path === "/api/suite/coding/codex/turns/delete") return codexSubmissions.remove(compartment, body.id);
      if (path === "/api/suite/coding/claude/discovery") return claudeCoding.discovery(compartment);
      if (path === "/api/suite/coding/claude/inventory") return claudeCoding.inventory(compartment, body);
      if (path === "/api/suite/coding/claude/list") return claudeCoding.list(compartment);
      if (path === "/api/suite/coding/claude/bind") return claudeCoding.bind(compartment, body);
      if (path === "/api/suite/coding/claude/create") return claudeCoding.create(compartment, body);
      if (path === "/api/suite/coding/claude/text/create") return claudeCoding.createText(compartment, body);
      if (path === "/api/suite/coding/claude/status") return claudeCoding.status(compartment, body.id);
      if (path === "/api/suite/coding/claude/focus") return claudeCoding.focus(compartment, body.id);
      if (path === "/api/suite/coding/claude/stop/review") return claudeCoding.reviewStop(compartment, body.id);
      if (path === "/api/suite/coding/claude/stop") return claudeCoding.stop(compartment, body);
      if (path === "/api/suite/coding/claude/turns/list") return claudeSubmissions.list(compartment);
      if (path === "/api/suite/coding/claude/turns/review") return claudeSubmissions.review(compartment, body);
      if (path === "/api/suite/coding/claude/turns/submit") return claudeSubmissions.submit(compartment, body);
      if (path === "/api/suite/coding/claude/turns/recovery/review") return claudeSubmissions.reviewRecovery(compartment, body);
      if (path === "/api/suite/coding/claude/turns/recovery/submit") return claudeSubmissions.submitRecovery(compartment, body);
      if (path === "/api/suite/coding/claude/turns/cancel") return claudeSubmissions.cancel(compartment, body.requestId);
      if (path === "/api/suite/coding/claude/turns/outcome/review") return claudeSubmissions.reviewOutcome(compartment, body.id);
      if (path === "/api/suite/coding/claude/turns/outcome/resolve") return claudeSubmissions.resolveOutcome(compartment, body);
      if (path === "/api/suite/coding/claude/turns/delete") return claudeSubmissions.remove(compartment, body.id);
      if (path === "/api/suite/agents/enroll") return custom.enroll(compartment, body);
      if (path === "/api/suite/agents/dispatch") return custom.dispatch(compartment, body);
      if (path === "/api/suite/agents/example/stop") {
        if (!["custom", "langchain"].includes(body.example)) throw new Error("Choose a bundled owned example.");
        return stopExample(compartment, body.example);
      }
      if (path === "/api/suite/agents/example") {
        if (!["custom", "langchain"].includes(body.example)) throw new Error("Choose the bundled custom or LangChain example.");
        const key = `${compartment}:${body.example}`, fence = exampleGenerations.get(key) ?? 0;
        await store.authorize(compartment, { provider: "custom-agent" });
        if (closed || fence !== (exampleGenerations.get(key) ?? 0)) throw new Error("This example request was invalidated before startup.");
        if (exampleStarts.has(key)) { await exampleStarts.get(key); return { status: "already-starting", duplicatePrevented: true }; }
        const existing = examples.get(key);
        if (existing && existing.exitCode === null && existing.signalCode == null) return { status: "already-running", duplicatePrevented: true };
        const generation = fence;
        const starting = (async () => {
        const id = `${body.example}-example`, state = await store.snapshot(compartment);
        let enrollment;
        if (state.agents.some((a) => a.id === id)) enrollment = { compartment, agentId: id, token: await store.credential(compartment, `agent-${id}`, undefined, { provider: "custom-agent" }), initialSequence: state.agents.find((a) => a.id === id).sequence };
        else enrollment = await custom.enroll(compartment, { id, name: body.example === "custom" ? "Synthetic custom agent" : "Synthetic LangChain Runnable", capabilities: agentIntents });
        const base = new URL(body.workspaceBaseUrl);
        if (base.protocol !== "http:" || !["127.0.0.1", "localhost"].includes(base.hostname) || base.pathname !== "/" || base.username || base.password || base.search || base.hash) throw new Error("The example requires this workspace's loopback origin.");
        const file = fileURLToPath(new URL(body.example === "custom" ? "../../examples/custom-agent/agent.mjs" : "../../examples/langchain-agent/agent.py", import.meta.url));
        const executable = body.example === "custom" ? process.execPath : (await resolveRuntimePaths()).python;
        await store.authorize(compartment, { provider: "custom-agent" });
        if (closed || generation !== (exampleGenerations.get(key) ?? 0)) throw new Error("This example launch was stopped before startup.");
        const child = spawnExample(executable, [...(body.example === "langchain" ? ["-I", "-B"] : []), file], { shell: false, windowsHide: true, stdio: ["pipe", "ignore", "ignore"], env: runtimeEnvironment() });
        examples.set(key, child); child.stdin.on("error", () => {});
        child.on("close", () => { if (examples.get(key) === child) examples.delete(key); });
        await new Promise((resolve, reject) => { child.once("spawn", resolve); child.once("error", reject); });
        if (closed || generation !== (exampleGenerations.get(key) ?? 0)) { await stopOwnedChild(child); throw new Error("This example launch was stopped during startup."); }
        child.stdin.write(JSON.stringify({ ...enrollment, baseUrl: base.href, supervised: true }) + "\n");
        return { status: "starting", agentId: id, provenance: "Wait for authenticated ready event before claiming availability" };
        })();
        exampleStarts.set(key, starting);
        try { return await starting; } finally { if (exampleStarts.get(key) === starting) exampleStarts.delete(key); }
      }
      if (path === "/api/suite/roles/bind") {
        if (!agentIntents.includes(body.intent)) throw new Error("Choose a stable supported intent.");
        return store.update(compartment, "role-bind", (s) => {
          const role = s.workflow.roles.find((r) => r.id === body.roleId); if (!role) throw new Error("Save an agent role in your workflow first.");
          const provider = body.provider;
          if (!s.policy || !["codex", "claude-code", "microsoft-365-copilot", "custom-agent"].includes(provider)) throw new Error("Unknown role provider.");
          const targetKind = body.targetKind ?? (provider === "custom-agent" ? "custom-agent" : "conversation");
          if (!["coding-task", "custom-agent", "conversation"].includes(targetKind) || (targetKind === "custom-agent") !== (provider === "custom-agent")) throw new Error("Choose the exact target kind supported by this provider.");
          const target = targetKind === "coding-task" ? s.codingSessions?.find((t) => t.id === body.targetId && t.provider === provider) : provider === "custom-agent" ? s.agents.find((a) => a.id === body.targetId) : s.conversations.find((c) => c.id === body.targetId && c.provider === provider);
          if (!target?.sessionId) throw new Error("The role needs an exact connected session, not a window title or missing tool.");
          s.roleBindings ??= []; const binding = { roleId: role.id, provider, targetKind, targetId: body.targetId, sessionId: target.sessionId, intent: body.intent };
          s.roleBindings = [...s.roleBindings.filter((b) => b.roleId !== role.id || b.intent !== body.intent), binding]; roleTarget(s, role.id, body.intent); return binding;
        }, { provider: body.provider });
      }
      if (path === "/api/suite/roles/dispatch") return this.dispatchRole(compartment, body.roleId, body.intent, body.content);
      if (path === "/api/suite/intent") {
        await loadSelection();
        if (body.implementation === "native-chatgpt.focus/v1") { await this.authorizeConnection(activeCompartment); const { focusNativeChatgpt } = await import("./host.mjs"); return focusNativeChatgpt(); }
        if (body.implementation === "switchyard.role/v1") return this.dispatchRole(activeCompartment, body.roleId, body.intent);
        throw new Error("The physical intent is outside the closed implementation map.");
      }
      if (path === "/api/suite/snapshot") {
        const s = await store.snapshot(compartment);
        return { ...s, voice: s.voice.map((v) => ({ ...v, chunks: v.chunks.map(({ audio, ...c }) => ({ ...c, pendingAudio: Boolean(audio) })) })), observationSummaries: s.observations.map(observationSummary) };
      }
      if (path === "/api/suite/profile/save") return store.saveProfile(compartment, body.profile);
      if (path === "/api/suite/profile/select") return store.selectProfile(compartment, body.profileId, body.revision ?? null);
      if (path === "/api/suite/devices/list") return devices.list();
      if (path === "/api/suite/host/keyboard-indicators") return keyboardIndicators.read();
      if (path === "/api/suite/devices/identify") {
        if (typeof body.deviceId !== "string" || !/^[a-f0-9]{64}$/.test(body.deviceId)) throw new Error("Choose an exact previously read configuration interface.");
        const snapshots = ((await store.snapshot(compartment)).deviceSnapshots ?? []).filter((s) => s.identity.deviceId === body.deviceId);
        if (snapshots.length !== 1) throw new Error("Read this exact device in this workspace before reconciling source identity.");
        const result = identifyCatalogSnapshot(sourceCatalog, snapshots[0]), observed = Date.parse(result.capturedAt), ageMs = Date.now() - observed;
        return { ...result, snapshotStatus: Number.isFinite(ageMs) && ageMs >= 0 && ageMs <= 120000 ? "recent-readout" : "historical-readout", applied: false, note: "This compares the protected readout to source references. It performs no HID operation, changes no profile and grants no host/device authority." };
      }
      if (path === "/api/suite/devices/read") return devices.read(compartment, body.deviceId);
      if (path === "/api/suite/devices/profile/review") return readoutProfiles.review(compartment, body);
      if (path === "/api/suite/devices/profile/adopt") return readoutProfiles.adopt(compartment, body);
      if (path === "/api/suite/devices/review") return devices.review(compartment, body.deviceId, body.configuration ?? body.changes);
      if (path === "/api/suite/devices/apply") return devices.apply(compartment, body.reviewId);
      if (path === "/api/suite/devices/restore") return devices.restore(compartment, body.id);
      if (path === "/api/suite/devices/unlock") return devices.unlock(body.deviceId, body.operation);
      if (path === "/api/suite/profile/export") return store.exportProfile(compartment);
      if (path === "/api/suite/profile/legends/export") return exportAssignmentLegends((await store.exportProfilePackage(compartment)).document, body.options);
      if (path === "/api/suite/profile/package/export") return store.exportProfilePackage(compartment, body.preferences ?? null);
      if (path === "/api/suite/profile/package/review") return store.reviewProfilePackage(compartment, body.document);
      if (path === "/api/suite/profile/package/import") return store.importProfilePackage(compartment, body.document, body.reviewId);
      if (path === "/api/suite/workflow/save") return store.saveWorkflow(compartment, body.workflow);
      if (path === "/api/suite/copilot/discovery") return copilot.discovery(compartment);
      if (path === "/api/suite/copilot/login") return copilot.beginLogin(compartment, body);
      if (path === "/api/suite/copilot/poll") return copilot.pollLogin(compartment, body.loginId);
      if (path === "/api/suite/design") { await store.authorize(compartment, { provider: body.provider }); return (body.provider === "microsoft-365-copilot" ? copilot : agents).design({ compartment, provider: body.provider, message: body.message, plan: body.plan, conversationId: body.conversationId }); }
      if (path === "/api/suite/design/cancel") return agents.cancel(compartment, body.conversationId);
      if (path === "/api/suite/design/status") return agents.status(compartment, body.conversationId);
      if (path === "/api/suite/conversation/binding/review") return agents.reviewLegacyBinding(compartment, body.conversationId);
      if (path === "/api/suite/conversation/binding/bind") return agents.bindLegacy(compartment, body);
      if (path === "/api/suite/conversation/delete") return store.update(compartment, "conversation-delete", (s) => { s.conversations = s.conversations.filter((c) => c.id !== body.id); return { deleted: true }; });
      if (path === "/api/suite/observation/start") {
        const sources = body.sources;
        if (body.consent !== true || !Array.isArray(sources) || !sources.length || sources.some((s) => !["deliberate", "foreground-category", "agent-events"].includes(s)) || !Array.isArray(body.exclusions) || body.exclusions.some((s) => !["terminal", "vscode", "chatgpt", "claude", "codex", "browser", "other"].includes(s))) throw new Error("Choose observation sources and exclusions and explicitly start a session.");
        if (!foreground.implemented && sources.includes("foreground-category")) throw new Error("Foreground category sampling requires the supported native platform adapter. Deliberate and agent-event observation remain available.");
        const o = { id: randomUUID(), status: "recording", sources, exclusions: body.exclusions, events: [], focusCategories: {}, createdAt: Date.now(), updatedAt: Date.now() };
        await store.update(compartment, "observation-start", (s) => { if (s.observations.some((o) => ["recording", "paused"].includes(o.status))) throw new Error("Stop or resume the existing session first."); s.observations.push(o); }, { operation: "record" });
        if (sources.includes("foreground-category")) monitor(compartment, o.id);
        return o;
      }
      if (path === "/api/suite/observation/mark") return store.update(compartment, "observation-mark", (s) => { const o = session(s, body.id); if (o.status !== "recording" || !o.sources.includes("deliberate") || !kinds.includes(body.kind)) throw new Error("Start deliberate observation and choose a supported event kind."); if (o.events.length >= 2000) throw new Error("Session event limit reached. Stop and review this session."); o.events.push({ kind: body.kind, provenance: "user-marked", at: Date.now() }); o.updatedAt = Date.now(); return observationSummary(o); }, { operation: "record" });
      if (path === "/api/suite/observation/state") { let shouldMonitor = false; const result = await store.update(compartment, "observation-state", (s) => { const o = session(s, body.id); if (!["paused", "recording", "stopped"].includes(body.status) || (o.status === "stopped" && body.status !== "stopped")) throw new Error("That session transition is unavailable."); o.status = body.status; o.updatedAt = Date.now(); shouldMonitor = o.status === "recording" && o.sources.includes("foreground-category"); return observationSummary(o); }, body.status === "recording" ? { operation: "record" } : {}); pauseMonitor(compartment); if (shouldMonitor) monitor(compartment, body.id); else await foreground.stopCompartment?.(compartment); return result; }
      if (path === "/api/suite/observation/delete") return store.update(compartment, "observation-delete", (s) => { const o = session(s, body.id); if (o.status === "recording") throw new Error("Stop the session before deleting its data."); s.observations = s.observations.filter((o) => o.id !== body.id); return { deleted: true }; });
      if (path === "/api/suite/voice/start") {
        await store.authorize(compartment, { operation: "record", provider: "local-transcription" });
        if (body.consent !== true) throw new Error("Review the local audio destination before starting voice.");
        const available = await voice.discovery(); if (!available.available) throw new Error(available.reason);
        const v = { id: randomUUID(), status: "recording", destination: "local-transcription", chunks: [], transcript: "", reviewedTranscript: "", updatedAt: Date.now() };
        return store.update(compartment, "voice-start", (s) => { if (s.voice.some((v) => v.status === "recording")) throw new Error("Pause the current voice session first."); s.voice.push(v); return v; }, { operation: "record", provider: "local-transcription" });
      }
      if (path === "/api/suite/voice/segment") return voiceQueue.segment(compartment, body);
      if (path === "/api/suite/voice/retry") { const s = await store.snapshot(compartment), v = voiceSession(s, body.id); for (const chunk of v.chunks.filter((c) => c.audio && c.status === "pending")) await this.handle("/api/suite/voice/segment", { compartment, id: v.id, audio: chunk.audio, chunkId: chunk.id }); return { retried: true }; }
      if (path === "/api/suite/voice/state") return store.update(compartment, "voice-state", (s) => { const v = voiceSession(s, body.id); if (!["recording", "paused", "stopped"].includes(body.status) || v.status === "stopped") throw new Error("That voice transition is unavailable."); v.status = body.status; v.updatedAt = Date.now(); return { id: v.id, status: v.status }; }, body.status === "recording" ? { operation: "record", provider: "local-transcription" } : {});
      if (path === "/api/suite/voice/review") return store.update(compartment, "voice-review", (s) => reviewTranscript(voiceSession(s, body.id), body.transcript));
      if (path === "/api/suite/voice/delete") { const result = await store.update(compartment, "voice-delete", (s) => { const v = voiceSession(s, body.id); if (v.status === "recording") throw new Error("Pause or stop voice before deleting its data."); s.voice = s.voice.filter((v) => v.id !== body.id); return { deleted: true }; }); const stopped = await voiceQueue.stopSession(compartment, body.id); if (stopped.stopped === false) throw new Error("Voice data was deleted, but its owned local worker stop is unconfirmed."); return result; }
      if (path === "/api/suite/route/check") { await store.route(compartment, body.destination, "synthetic-boundary-check", body.provider); return { allowed: true }; }
      throw new Error("That suite operation is unavailable. No alternate action was executed.");
    },
    async dispatchRole(compartment, roleId, intent, content) {
      const s = await store.snapshot(compartment), b = roleTarget(s, roleId, intent);
      await store.authorize(compartment, { provider: b.provider });
      let result;
      if (b.targetKind === "coding-task") result = b.provider === "claude-code" ? await (intent === "summon" ? claudeCoding.focus(compartment, b.targetId) : claudeCoding.status(compartment, b.targetId)) : await (intent === "resume" ? coding.resume(compartment, b.targetId) : coding.status(compartment, b.targetId));
      else if (b.provider === "custom-agent") result = await custom.dispatch(compartment, { agentId: b.targetId, intent, sessionId: b.sessionId, content });
      else {
        const c = s.conversations.find((c) => c.id === b.targetId && c.provider === b.provider && c.sessionId === b.sessionId);
        if (!c) throw new Error("This exact role target changed or disappeared. Rebind it deliberately.");
        if (["summon", "resume"].includes(intent)) result = b.provider === "microsoft-365-copilot" ? { status: "selected-for-continuation", sessionId: b.sessionId, provenance: "Owned Graph conversation selected; next message continues it. Desktop focus and runtime completion are not observed." } : await agents.resume(compartment, c.id);
        else if (intent === "status") result = b.provider === "microsoft-365-copilot" ? { status: "not-observed", sessionId: b.sessionId, provenance: "Stored Graph conversation identity, not live task status" } : await agents.status(compartment, c.id);
        else if (intent === "cancel") { if (b.provider === "microsoft-365-copilot") throw new Error("The selected Graph contract does not provide task cancellation. No cancellation was claimed."); result = await agents.cancel(compartment, c.id); }
        else {
          if (!s.profile) throw new Error("Save the current profile before reviewing or handing off its workflow.");
          const message = intent === "review" ? "Review this configuration workflow and key arrangement. Propose improvements without applying anything." : `Review this deliberate handoff within the same compartment: ${typeof content === "string" ? content.slice(0, 12000) : "Continue from the saved workflow, roles and key arrangement."}`;
          result = await (b.provider === "microsoft-365-copilot" ? copilot : agents).design({ compartment, provider: b.provider, message, plan: s.profile.plan, conversationId: c.id });
        }
      }
      await store.update(compartment, "role-intent-result", (state) => { if (b.targetKind === "coding-task") state.activeCodingSessionId = b.targetId; else if (b.provider !== "custom-agent") state.activeConversationId = b.targetId; state.intentResults = [...(state.intentResults ?? []).slice(-31), { at: Date.now(), roleId, intent, result }]; }, { provider: b.provider });
      return result;
    },
    async authorizeConnection(compartment, connection = { implementation: "native-chatgpt.focus/v1" }) {
      await loadSelection(); compartment ??= activeCompartment;
      if (compartment !== activeCompartment) throw new Error("Select this workspace before reviewing a physical shortcut. The active workspace policy controls every invocation.");
      if (connection.implementation === "native-chatgpt.focus/v1") { await store.authorize(compartment, { provider: "native-chatgpt" }); if (process.platform !== "linux") throw new Error("Verified native ChatGPT window focus is not implemented on this platform. Bind a supported agent role instead."); return nativeChatgptWindow(hypr); }
      if (connection.implementation !== "switchyard.role/v1") throw new Error("This physical connection is outside the closed action map.");
      const state = await store.snapshot(compartment), binding = roleTarget(state, connection.roleId, connection.intent);
      await store.authorize(compartment, { provider: binding.provider });
      return { available: true, implementation: connection.implementation, provider: binding.provider, roleId: binding.roleId, intent: binding.intent, evidence: binding.targetKind === "coding-task" ? "exact coding-task identity; runtime status or owned read-only daemon resume, without window focus, completion or mediated-control authority" : "exact owned configuration conversation or authenticated adapter session; not general coding-task control" };
    },
    async close() { closed = true; readoutProfiles.close(); for (const timer of monitors.values()) clearForeground(timer); monitors.clear(); for (const key of new Set([...examples.keys(), ...exampleStarts.keys()])) exampleGenerations.set(key, (exampleGenerations.get(key) ?? 0) + 1); await Promise.allSettled(exampleStarts.values()); let claudeStopError; try { await claudeSubmissions.close(); } catch (error) { claudeStopError = error; } await Promise.all([foreground.close?.(), agents.close(), coding.close?.(), codexSubmissions.close(), voiceQueue.close(), claudeCoding.close?.(), keyboardIndicators.close().then(result => { if (result.stopped !== true) throw new Error("Owned indicator probe exit is unconfirmed."); }), ...[...examples.values()].map((child) => stopOwnedChild(child))]); if (claudeStopError) throw claudeStopError; }
  };
}
