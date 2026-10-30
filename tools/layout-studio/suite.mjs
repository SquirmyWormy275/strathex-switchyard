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
import { runHypr } from "./host.mjs";
import { createDeviceService } from "./devices.mjs";
import { createCopilot } from "./copilot.mjs";
import { createCustomAgents, agentIntents } from "./custom-agents.mjs";

const kinds = ["interruption", "resume", "switch", "handoff", "status", "review", "approval", "failure", "recovery", "other"];
export function createSuite({ store = createSuiteStore(), agents, voice = localVoice(), hypr = runHypr, devices, copilot } = {}) {
  agents ??= createAgentService({ store, runtimeRoot: join(process.env.XDG_RUNTIME_DIR || process.env.LOCALAPPDATA || join(homedir(), ".local/state"), "switchyard-design") });
  devices ??= createDeviceService({ store });
  copilot ??= createCopilot({ store });
  const custom = createCustomAgents({ store });
  const examples = new Map();
  const started = new Set(), monitors = new Map();
  let activeCompartment = "personal";
  let selectionLoaded = false;
  async function initialize(id, policy = id === "work" ? "work" : "personal") {
    if (started.has(id)) return;
    await store.initialize(id, policy);
    await store.update(id, "restart-recovery", (s) => { for (const o of s.observations) if (["recording", "paused"].includes(o.status)) o.status = "interrupted"; for (const v of s.voice) if (v.status === "recording") v.status = "paused"; for (const c of s.conversations) if (c.status === "pending") c.status = "interrupted"; for (const t of s.deviceTransactions ?? []) if (t.status === "applying") t.status = "recovery-pending"; });
    started.add(id);
  }
  const session = (s, id) => { const found = s.observations.find((o) => o.id === id); if (!found) throw new Error("That observation session is unavailable in this compartment."); return found; };
  const voiceSession = (s, id) => { const found = s.voice.find((o) => o.id === id); if (!found) throw new Error("That voice session is unavailable in this compartment."); return found; };
  function monitor(compartment, id) {
    if (monitors.has(compartment)) clearInterval(monitors.get(compartment));
    let pending = false, last = Date.now();
    const timer = setInterval(async () => {
      if (pending) return; pending = true;
      try {
        const category = surfaceForClass(JSON.parse(await hypr("activewindow", "-j")).class), at = Date.now();
        await store.update(compartment, "focus-category", (s) => { const o = session(s, id); if (o.status !== "recording" || !o.sources.includes("foreground-category") || o.exclusions.includes(category)) return; o.focusCategories[category] = (o.focusCategories[category] ?? 0) + Math.max(0, Math.min(60000, at - last)); o.updatedAt = at; }, { operation: "record" }); last = at;
      } catch { clearInterval(timer); monitors.delete(compartment); }
      finally { pending = false; }
    }, 2000);
    timer.unref(); monitors.set(compartment, timer);
  }
  return {
    store, agents,
    agentMessage: (path, body, signature) => custom.message(path, body, signature),
    async handle(path, body = {}) {
      const compartment = body.compartment ?? "personal";
      if (path === "/api/suite/bootstrap") {
        await initialize("personal");
        if (!selectionLoaded) { activeCompartment = await store.selection(); await initialize(activeCompartment); selectionLoaded = true; }
        return { compartments: await store.list(), activeCompartment, agents: await agents.discovery(), voice: await voice.discovery() };
      }
      if (path === "/api/suite/compartment/create") { await initialize(compartment, body.policy); return { id: compartment }; }
      if (!started.has(compartment)) { const list = await store.list(); if (!list.some((c) => c.id === compartment)) throw new Error("Choose or create this compartment first."); await initialize(compartment); }
      if (path === "/api/suite/compartment/select") {
        if (activeCompartment !== compartment) {
          clearInterval(monitors.get(activeCompartment)); monitors.delete(activeCompartment);
          await store.update(activeCompartment, "compartment-suspend-sources", (s) => { for (const o of s.observations) if (o.status === "recording") o.status = "paused"; for (const v of s.voice) if (v.status === "recording") v.status = "paused"; });
        }
        await store.selection(compartment); activeCompartment = compartment; return { id: compartment };
      }
      if (path === "/api/suite/mode") { if (!["keyboard-only", "personal-companion", "managed-companion"].includes(body.mode)) throw new Error("Choose an explicit supported operating mode."); return store.update(compartment, "mode-select", (s) => { s.mode = body.mode; return { mode: s.mode, policyStillEnforced: true }; }); }
      if (path === "/api/suite/agents/enroll") return custom.enroll(compartment, body);
      if (path === "/api/suite/agents/dispatch") return custom.dispatch(compartment, body);
      if (path === "/api/suite/agents/example") {
        await store.authorize(compartment, { provider: "custom-agent" });
        if (!["custom", "langchain"].includes(body.example)) throw new Error("Choose the bundled custom or LangChain example.");
        const key = `${compartment}:${body.example}`, existing = examples.get(key);
        if (existing && existing.exitCode === null) return { status: "already-running", duplicatePrevented: true };
        const id = `${body.example}-example`, state = await store.snapshot(compartment);
        let enrollment;
        if (state.agents.some((a) => a.id === id)) enrollment = { compartment, agentId: id, token: await store.credential(compartment, `agent-${id}`, undefined, { provider: "custom-agent" }), initialSequence: state.agents.find((a) => a.id === id).sequence };
        else enrollment = await custom.enroll(compartment, { id, name: body.example === "custom" ? "Synthetic custom agent" : "Synthetic LangChain Runnable", capabilities: agentIntents });
        const base = new URL(body.workspaceBaseUrl);
        if (base.protocol !== "http:" || !["127.0.0.1", "localhost"].includes(base.hostname) || base.pathname !== "/" || base.username || base.password) throw new Error("The example requires this workspace's loopback origin.");
        const file = fileURLToPath(new URL(body.example === "custom" ? "../../examples/custom-agent/agent.mjs" : "../../examples/langchain-agent/agent.py", import.meta.url));
        const executable = body.example === "custom" ? process.execPath : join(homedir(), ".local/share/strathex-switchyard/voice", process.platform === "win32" ? "venv/Scripts/python.exe" : "venv/bin/python");
        const child = spawn(executable, [file], { shell: false, windowsHide: true, stdio: ["pipe", "ignore", "ignore"], env: { ...process.env, LANGSMITH_TRACING: "false", LANGCHAIN_TRACING_V2: "false", LANGSMITH_API_KEY: "", LANGCHAIN_API_KEY: "" } });
        examples.set(key, child); child.stdin.on("error", () => {}); child.on("error", () => { examples.delete(key); }); child.stdin.end(JSON.stringify({ ...enrollment, baseUrl: base.href }));
        return { status: "starting", agentId: id, provenance: "Wait for authenticated ready event before claiming availability" };
      }
      if (path === "/api/suite/roles/bind") {
        if (!agentIntents.includes(body.intent)) throw new Error("Choose a stable supported intent.");
        return store.update(compartment, "role-bind", (s) => {
          const role = s.workflow.roles.find((r) => r.id === body.roleId); if (!role) throw new Error("Save an agent role in your workflow first.");
          const provider = body.provider;
          if (!s.policy || !["codex", "claude-code", "microsoft-365-copilot", "custom-agent"].includes(provider)) throw new Error("Unknown role provider.");
          const target = provider === "custom-agent" ? s.agents.find((a) => a.id === body.targetId) : s.conversations.find((c) => c.id === body.targetId && c.provider === provider);
          if (!target?.sessionId) throw new Error("The role needs an exact connected session, not a window title or missing tool.");
          s.roleBindings ??= []; const binding = { roleId: role.id, provider, targetId: body.targetId, sessionId: target.sessionId, intent: body.intent };
          s.roleBindings = [...s.roleBindings.filter((b) => b.roleId !== role.id || b.intent !== body.intent), binding]; return binding;
        }, { provider: body.provider });
      }
      if (path === "/api/suite/roles/dispatch") return this.dispatchRole(compartment, body.roleId, body.intent, body.content);
      if (path === "/api/suite/intent") {
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
      if (path === "/api/suite/devices/read") return devices.read(compartment, body.deviceId);
      if (path === "/api/suite/devices/review") return devices.review(compartment, body.deviceId, body.changes);
      if (path === "/api/suite/devices/apply") return devices.apply(compartment, body.reviewId);
      if (path === "/api/suite/devices/restore") return devices.restore(compartment, body.id);
      if (path === "/api/suite/devices/unlock") return devices.unlock(body.deviceId, body.operation);
      if (path === "/api/suite/profile/export") return store.exportProfile(compartment);
      if (path === "/api/suite/workflow/save") { const workflow = parseWorkflow(body.workflow); return store.update(compartment, "workflow-save", (s) => { s.workflow = workflow; return workflow; }); }
      if (path === "/api/suite/copilot/discovery") return copilot.discovery(compartment);
      if (path === "/api/suite/copilot/login") return copilot.beginLogin(compartment, body);
      if (path === "/api/suite/copilot/poll") return copilot.pollLogin(compartment, body.loginId);
      if (path === "/api/suite/design") return (body.provider === "microsoft-365-copilot" ? copilot : agents).design({ compartment, provider: body.provider, message: body.message, plan: body.plan, conversationId: body.conversationId });
      if (path === "/api/suite/design/cancel") return agents.cancel(compartment, body.conversationId);
      if (path === "/api/suite/design/status") return agents.status(compartment, body.conversationId);
      if (path === "/api/suite/conversation/delete") return store.update(compartment, "conversation-delete", (s) => { s.conversations = s.conversations.filter((c) => c.id !== body.id); return { deleted: true }; });
      if (path === "/api/suite/observation/start") {
        const sources = body.sources;
        if (body.consent !== true || !Array.isArray(sources) || !sources.length || sources.some((s) => !["deliberate", "foreground-category", "agent-events"].includes(s)) || !Array.isArray(body.exclusions) || body.exclusions.some((s) => !["terminal", "vscode", "chatgpt", "claude", "codex", "browser", "other"].includes(s))) throw new Error("Choose observation sources and exclusions and explicitly start a session.");
        if (process.platform !== "linux" && sources.includes("foreground-category")) throw new Error("Foreground category sampling is not yet implemented on this platform. Deliberate and agent-event observation remain available.");
        const o = { id: randomUUID(), status: "recording", sources, exclusions: body.exclusions, events: [], focusCategories: {}, createdAt: Date.now(), updatedAt: Date.now() };
        await store.update(compartment, "observation-start", (s) => { if (s.observations.some((o) => ["recording", "paused"].includes(o.status))) throw new Error("Stop or resume the existing session first."); s.observations.push(o); }, { operation: "record" });
        if (sources.includes("foreground-category")) monitor(compartment, o.id);
        return o;
      }
      if (path === "/api/suite/observation/mark") return store.update(compartment, "observation-mark", (s) => { const o = session(s, body.id); if (o.status !== "recording" || !o.sources.includes("deliberate") || !kinds.includes(body.kind)) throw new Error("Start deliberate observation and choose a supported event kind."); if (o.events.length >= 2000) throw new Error("Session event limit reached. Stop and review this session."); o.events.push({ kind: body.kind, provenance: "user-marked", at: Date.now() }); o.updatedAt = Date.now(); return observationSummary(o); }, { operation: "record" });
      if (path === "/api/suite/observation/state") return store.update(compartment, "observation-state", (s) => { const o = session(s, body.id); if (!["paused", "recording", "stopped"].includes(body.status) || (o.status === "stopped" && body.status !== "stopped")) throw new Error("That session transition is unavailable."); o.status = body.status; o.updatedAt = Date.now(); clearInterval(monitors.get(compartment)); monitors.delete(compartment); if (o.status === "recording" && o.sources.includes("foreground-category")) monitor(compartment, o.id); return observationSummary(o); }, body.status === "recording" ? { operation: "record" } : {});
      if (path === "/api/suite/observation/delete") return store.update(compartment, "observation-delete", (s) => { const o = session(s, body.id); if (o.status === "recording") throw new Error("Stop the session before deleting its data."); s.observations = s.observations.filter((o) => o.id !== body.id); return { deleted: true }; });
      if (path === "/api/suite/voice/start") {
        await store.authorize(compartment, { operation: "record", provider: "local-transcription" });
        if (body.consent !== true) throw new Error("Review the local audio destination before starting voice.");
        const available = await voice.discovery(); if (!available.available) throw new Error(available.reason);
        const v = { id: randomUUID(), status: "recording", destination: "local-transcription", chunks: [], transcript: "", reviewedTranscript: "", updatedAt: Date.now() };
        return store.update(compartment, "voice-start", (s) => { if (s.voice.some((v) => v.status === "recording")) throw new Error("Pause the current voice session first."); s.voice.push(v); return v; }, { operation: "record", provider: "local-transcription" });
      }
      if (path === "/api/suite/voice/segment") {
        if (typeof body.audio !== "string" || body.audio.length > 240000 || !/^[A-Za-z0-9+/]*={0,2}$/.test(body.audio) || !/^[a-zA-Z0-9_-]{1,64}$/.test(body.chunkId)) throw new Error("Audio segments must be bounded and have a unique identity.");
        let chunk;
        await store.update(compartment, "voice-segment", (s) => { const v = voiceSession(s, body.id); const existing = v.chunks.find((c) => c.id === body.chunkId); if (existing) { chunk = existing; return; } if (!["recording", "paused"].includes(v.status)) throw new Error("This voice session cannot accept new audio."); if (v.chunks.length >= 1000) throw new Error("Voice session limit reached. Review this transcript and start a new session."); chunk = { id: body.chunkId, audio: body.audio, text: null, status: "pending" }; v.chunks.push(chunk); v.updatedAt = Date.now(); }, { operation: "record", provider: "local-transcription" });
        if (chunk.status === "transcribed") return { text: chunk.text, duplicate: true };
        const transcription = await voice.transcribe(chunk.audio);
        return store.update(compartment, "voice-transcribe", (s) => { const v = voiceSession(s, body.id), c = v.chunks.find((c) => c.id === body.chunkId); if (!c) throw new Error("Audio was deleted while transcription was running."); c.text = transcription.text; c.audio = null; c.status = "transcribed"; v.transcript = v.chunks.map((c) => c.text ?? "").join(" ").trim().slice(0, 160000); v.updatedAt = Date.now(); return { transcript: v.transcript, text: c.text, destination: "Local CPU; audio removed after successful transcription" }; }, { provider: "local-transcription" });
      }
      if (path === "/api/suite/voice/retry") { const s = await store.snapshot(compartment), v = voiceSession(s, body.id); for (const chunk of v.chunks.filter((c) => c.audio && c.status === "pending")) await this.handle("/api/suite/voice/segment", { compartment, id: v.id, audio: chunk.audio, chunkId: chunk.id }); return { retried: true }; }
      if (path === "/api/suite/voice/state") return store.update(compartment, "voice-state", (s) => { const v = voiceSession(s, body.id); if (!["recording", "paused", "stopped"].includes(body.status) || v.status === "stopped") throw new Error("That voice transition is unavailable."); v.status = body.status; v.updatedAt = Date.now(); return { id: v.id, status: v.status }; }, body.status === "recording" ? { operation: "record", provider: "local-transcription" } : {});
      if (path === "/api/suite/voice/review") return store.update(compartment, "voice-review", (s) => { const v = voiceSession(s, body.id); if (typeof body.transcript !== "string" || body.transcript.length > 160000) throw new Error("The reviewed transcript exceeds the session limit."); v.reviewedTranscript = body.transcript; v.updatedAt = Date.now(); return { reviewed: true }; });
      if (path === "/api/suite/voice/delete") return store.update(compartment, "voice-delete", (s) => { const v = voiceSession(s, body.id); if (v.status === "recording") throw new Error("Pause or stop voice before deleting its data."); s.voice = s.voice.filter((v) => v.id !== body.id); return { deleted: true }; });
      if (path === "/api/suite/route/check") { await store.route(compartment, body.destination, "synthetic-boundary-check", body.provider); return { allowed: true }; }
      throw new Error("That suite operation is unavailable. No alternate action was executed.");
    },
    async dispatchRole(compartment, roleId, intent, content) {
      if (!agentIntents.includes(intent)) throw new Error("That role intent is unsupported.");
      const s = await store.snapshot(compartment), b = s.roleBindings?.find((b) => b.roleId === roleId && b.intent === intent);
      if (!b) throw new Error("Bind this role and intent to an exact permitted session first.");
      await store.authorize(compartment, { provider: b.provider });
      let result;
      if (b.provider === "custom-agent") result = await custom.dispatch(compartment, { agentId: b.targetId, intent, sessionId: b.sessionId, content });
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
      await store.update(compartment, "role-intent-result", (state) => { state.activeConversationId = b.provider === "custom-agent" ? state.activeConversationId ?? null : b.targetId; state.intentResults = [...(state.intentResults ?? []).slice(-31), { at: Date.now(), roleId, intent, result }]; }, { provider: b.provider });
      return result;
    },
    async authorizeConnection(compartment = activeCompartment) { if (!started.has(compartment)) await initialize(compartment); return store.authorize(compartment, { provider: "native-chatgpt" }); },
    async close() { for (const timer of monitors.values()) clearInterval(timer); for (const child of examples.values()) child.kill(); agents.close(); }
  };
}
