/** Concrete, tool-restricted design adapters. Account state stays with installed CLIs. */
import { spawn } from "node:child_process";
import { EventEmitter } from "node:events";
import { lstat, realpath, readFile } from "node:fs/promises";
import { homedir, userInfo } from "node:os";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import { modifiers, families, consequences, parsePlan, analyzePlan } from "./model.mjs";
import { proposalSchema } from "./workspace.mjs";
import { privateDirectory } from "./suite-store.mjs";
import { stopOwnedChild } from "./owned-process.mjs";

const text = { type: "string" };
export const designResponseSchema = {
  type: "object", additionalProperties: false, required: ["reply", "summary", "actions", "steps", "roles"], properties: {
    reply: text, summary: text, steps: { type: "array", items: text }, roles: { type: "array", items: text },
    actions: { type: "array", items: { type: "object", additionalProperties: false,
      required: ["id", "label", "family", "consequence", "confirmation", "frequencyPerDay", "secondsSaved", "binding"], properties: {
        id: text, label: text, family: { type: "string", enum: [...families] }, consequence: { type: "string", enum: [...consequences] }, confirmation: { type: "boolean" }, frequencyPerDay: { type: "integer" }, secondsSaved: { type: "integer" },
        binding: { anyOf: [{ type: "null" }, { type: "object", additionalProperties: false, required: ["keyId", "modifier"], properties: { keyId: text, modifier: { type: "string", enum: [...modifiers] } } }] }
      }
    } }
  }
};

export async function trustedCli(provider) {
  const names = provider === "codex" ? [join(homedir(), ".local/share/mise/installs/codex/latest/bin/codex"), join(homedir(), ".local/bin/codex"), "/usr/local/bin/codex", "/usr/bin/codex"] : provider === "claude-code" ? [join(homedir(), ".local/share/mise/installs/claude/latest/claude"), join(homedir(), ".local/bin/claude"), "/usr/local/bin/claude", "/usr/bin/claude"] : [];
  if (process.platform === "win32") names.unshift(join(process.env.LOCALAPPDATA || homedir(), "Programs", provider === "codex" ? "Codex/codex.exe" : "Claude/claude.exe"), join(homedir(), ".local/bin", provider === "codex" ? "codex.exe" : "claude.exe"));
  for (const name of names) {
    try { const p = await realpath(name), s = await lstat(p); if (s.isFile() && (process.platform === "win32" || ([0, userInfo().uid].includes(s.uid) && !(s.mode & 0o022) && (s.mode & 0o111)))) return p; } catch { /* try the next fixed installation route */ }
  }
  throw new Error(`${provider} is not installed at a supported native location. The arrangement is preserved; choose another permitted connection or install the CLI.`);
}

export function validateDesignResponse(value, basePlan) {
  if (!value || typeof value.reply !== "string" || value.reply.length > 20000 || typeof value.summary !== "string" || value.summary.length > 500 || !Array.isArray(value.steps) || !Array.isArray(value.roles) || value.steps.length > 40 || value.roles.length > 16 || [...value.steps, ...value.roles].some((s) => typeof s !== "string" || !s.trim() || s.length > 160)) throw new Error("The assistant response failed the bounded design contract. The draft was preserved.");
  const candidate = parsePlan({ ...basePlan, actions: value.actions });
  const errors = analyzePlan(candidate).issues.filter((i) => i.severity === "error");
  if (errors.length) throw new Error(`The assistant proposed an unsafe layout: ${errors.map((i) => i.message).join(" ")}`);
  const operations = [
    ...basePlan.actions.filter((a) => !candidate.actions.some((b) => b.id === a.id)).map((a) => ({ type: "remove-action", actionId: a.id })),
    ...candidate.actions.map((action) => ({ type: "upsert-action", action }))
  ];
  return { reply: value.reply, workflow: { name: "Designed workflow", steps: value.steps, roles: value.roles }, proposal: operations.length ? { schema: proposalSchema, basePlan, summary: value.summary || "Review the proposed arrangement", operations } : null };
}

export function codexDesignConfig(serverNames = []) {
  if (!Array.isArray(serverNames) || serverNames.length > 128 || serverNames.some((n) => typeof n !== "string" || !/^[A-Za-z0-9_-]{1,80}$/.test(n))) throw new Error("Configured Codex MCP identities are unsupported. No design turn was submitted.");
  return { features: { shell_tool: false, plugins: false, apps: false, memories: false, multi_agent: false }, web_search: "disabled", mcp_servers: Object.fromEntries(serverNames.map((n) => [n, { enabled: false }])) };
}
export function assertCodexDesignConfig(config) {
  const expected = codexDesignConfig();
  if (!config || config.web_search !== "disabled" || Object.entries(expected.features).some(([name, value]) => config.features?.[name] !== value) || !config.mcp_servers || Object.values(config.mcp_servers).some((server) => server?.enabled !== false)) throw new Error("Codex did not enforce the restricted design configuration. No design turn was submitted.");
}
export async function readCodexMcpNames(executable, cwd) {
  // Inspect the app-server's actual effective configuration, without creating a
  // thread. `codex mcp list` also returns generated entries which cannot safely
  // be overridden as ordinary TOML transports. An empty table alone merges with
  // the user's configuration and therefore does not disable configured tools.
  const probe = new CodexClient(executable, cwd);
  try {
    const config = await probe.handshake();
    if (!config?.mcp_servers || typeof config.mcp_servers !== "object") throw new Error("Codex tool configuration is unavailable.");
    const names = Object.entries(config.mcp_servers).filter(([, s]) => s.enabled !== false).map(([name]) => name).sort();
    codexDesignConfig(names); return names;
  } finally { probe.close(); }
}
export class CodexClient extends EventEmitter {
  constructor(executable, cwd, serverNames = []) {
    super(); this.sequence = 0; this.pending = new Map(); this.buffer = ""; this.closed = false;
    codexDesignConfig(serverNames); this.serverNames = [...serverNames];
    const restrictions = ["features.shell_tool=false", "features.plugins=false", "features.apps=false", "features.memories=false", "features.multi_agent=false", "web_search=\"disabled\"", ...serverNames.map((name) => `mcp_servers.${name}.enabled=false`)];
    this.child = spawn(executable, ["app-server", "--stdio", ...restrictions.flatMap((c) => ["-c", c])], { cwd, shell: false, stdio: ["pipe", "pipe", "ignore"], windowsHide: true });
    this.child.stdout.setEncoding("utf8");
    this.child.stdout.on("data", (chunk) => {
      this.buffer += chunk;
      if (Buffer.byteLength(this.buffer) > 2 * 1024 * 1024) { this.close(); return; }
      let end;
      while ((end = this.buffer.indexOf("\n")) >= 0) {
        const line = this.buffer.slice(0, end); this.buffer = this.buffer.slice(end + 1);
        let m; try { m = JSON.parse(line); } catch { this.close(); return; }
        if (m.id !== undefined && !m.method) { const pending = this.pending.get(m.id); if (pending) { this.pending.delete(m.id); m.error ? pending.reject(new Error(`Codex rejected ${pending.method}: ${String(m.error.message).slice(0, 400)}`)) : pending.resolve(m.result); } }
        else if (m.id !== undefined && m.method) { this.send({ id: m.id, result: m.method.includes("requestApproval") ? { decision: "cancel" } : { success: false, contentItems: [{ type: "inputText", text: "Configuration design cannot execute tools or grant authority." }] } }); }
        else this.emit("notification", m);
      }
    });
    this.child.on("error", () => this.close()); this.child.on("close", () => this.close()); this.child.stdin.on("error", () => this.close());
  }
  send(message) { if (this.closed) throw new Error("The Codex connection is closed."); this.child.stdin.write(`${JSON.stringify(message)}\n`); }
  request(method, params) {
    return new Promise((resolve, reject) => {
      const id = ++this.sequence;
      const timer = setTimeout(() => { this.pending.delete(id); reject(new Error(`Codex ${method} timed out.`)); }, 20000);
      this.pending.set(id, { method, resolve: (r) => { clearTimeout(timer); resolve(r); }, reject: (e) => { clearTimeout(timer); reject(e); } });
      try { this.send({ id, method, params }); } catch (e) { this.pending.delete(id); clearTimeout(timer); reject(e); }
    });
  }
  async handshake() { await this.request("initialize", { clientInfo: { name: "switchyard_design", title: "Switchyard design", version: "0.2.0" } }); this.send({ method: "initialized", params: {} }); const { config } = await this.request("config/read", { includeLayers: false }); return config; }
  async initialize() { assertCodexDesignConfig(await this.handshake()); }
  close() { if (this.closed) return; this.closed = true; this.child.kill(); for (const p of this.pending.values()) p.reject(new Error("Codex disconnected. Your saved draft is preserved.")); this.pending.clear(); this.emit("disconnected"); }
}

export function createAgentService({ store, runtimeRoot, codexFactory = (exe, cwd, names) => new CodexClient(exe, cwd, names), spawnProcess = spawn, resolveCli = trustedCli, resolveMcp = readCodexMcpNames } = {}) {
  const busy = new Set(), clients = new Map(), connecting = new Map(), running = new Map(), generations = new Map();
  let closed = false;
  function currentGeneration(compartment, generation) { if (closed || generation !== (generations.get(compartment) ?? 0)) throw new Error("This compartment's design request was stopped. Your draft is preserved."); }
  async function codex(compartment) {
    if (closed) throw new Error("The design service is closed.");
    if (connecting.has(compartment)) return connecting.get(compartment);
    if (clients.get(compartment)?.closed === false) return clients.get(compartment);
    const generation = generations.get(compartment) ?? 0;
    const pending = (async () => {
      const cwd = join(runtimeRoot, compartment); await privateDirectory(cwd);
      const executable = await resolveCli("codex"), names = await resolveMcp(executable, cwd); codexDesignConfig(names);
      if (closed || generation !== (generations.get(compartment) ?? 0)) throw new Error("This compartment's design connection was stopped.");
      const client = codexFactory(executable, cwd, names); client.serverNames = [...names]; clients.set(compartment, client);
      try { await client.initialize(); if (closed || generation !== (generations.get(compartment) ?? 0)) throw new Error("This compartment's design connection was stopped."); return client; }
      catch (error) { client.close(); if (clients.get(compartment) === client) clients.delete(compartment); throw error; }
    })();
    connecting.set(compartment, pending);
    try { return await pending; } finally { if (connecting.get(compartment) === pending) connecting.delete(compartment); }
  }
  async function stopCompartment(compartment) {
    generations.set(compartment, (generations.get(compartment) ?? 0) + 1);
    const client = clients.get(compartment), children = new Set();
    if (client?.child) children.add(client.child);
    client?.close(); clients.delete(compartment); connecting.delete(compartment);
    for (const [key, r] of running) if (key.startsWith(`${compartment}:`) && r.child) children.add(r.child);
    const results = await Promise.all([...children].map((child) => stopOwnedChild(child)));
    return { stopped: results.every((r) => r.stopped), ownedProcesses: results.length, taskCompletionVerified: false };
  }
  return {
    stopCompartment,
    async discovery() {
      return Promise.all(["codex", "claude-code"].map(async (id) => { try { await resolveCli(id); return { id, installed: true, capabilities: ["design-conversation", "exact-owned-session", "status", "cancel"], auth: "checked-on-use", provenance: "fixed native CLI installation" }; } catch { return { id, installed: false, capabilities: [], auth: "unavailable" }; } }));
    },
    async design({ compartment, provider, message, plan: input, conversationId }) {
      const generation = generations.get(compartment) ?? 0; currentGeneration(compartment, generation);
      await store.authorize(compartment, { provider });
      if (typeof message !== "string" || !message.trim() || message.length > 12000) throw new Error("Describe the workflow in 1–12000 characters.");
      const plan = parsePlan(input), state = await store.snapshot(compartment);
      const conversation = conversationId ? state.conversations.find((c) => c.id === conversationId && c.provider === provider) : null;
      if (conversationId && !conversation) throw new Error("That conversation is not bound to this compartment and provider.");
      const id = conversation?.id ?? randomUUID(), key = `${compartment}:${id}`;
      if (busy.has(key)) throw new Error("This exact conversation is already running. Wait or cancel before sending again.");
      busy.add(key);
      const context = { instruction: "You are Switchyard's configuration designer. Improve the process before mapping it. Return only the response schema. Never run tools, read files, contact services, or apply a change. Use actual supplied key IDs. Preserve ordinary typing; use modified chords. Do not invent device, completion, time-saving or capability evidence. Estimates default to zero. Explain questions in reply. Return the full desired action list, editable process steps and agent role labels. Keep stable action IDs when revising. The output is an untrusted proposal requiring independent review.", currentPlan: plan, currentWorkflow: state.workflow, conversation: (conversation?.messages ?? []).slice(-12), request: message };
      let sessionId = conversation?.sessionId ?? null;
      try {
        await store.update(compartment, "design-draft", (s) => { s.conversations = [...s.conversations.filter((c) => c.id !== id), { id, provider, sessionId: conversation?.sessionId ?? null, updatedAt: Date.now(), messages: [...(conversation?.messages ?? []), { role: "user", text: message }].slice(-40), status: "pending" }]; }, { provider });
        currentGeneration(compartment, generation);
        let response;
        if (provider === "codex") {
          const client = await codex(compartment);
          currentGeneration(compartment, generation);
          const restricted = { sandbox: "read-only", approvalPolicy: "never", config: codexDesignConfig(client.serverNames), baseInstructions: "Only design a keyboard configuration from supplied text. Never call a tool. Return the required JSON schema." };
          if (sessionId) { const r = await client.request("thread/resume", { ...restricted, threadId: sessionId }); if (r.thread?.id !== sessionId) throw new Error("Codex resumed a different thread."); }
          else { const r = await client.request("thread/start", { ...restricted, cwd: join(runtimeRoot, compartment), serviceName: "switchyard-design" }); sessionId = r.thread?.id; }
          if (typeof sessionId !== "string" || !/^[A-Za-z0-9_-]{1,128}$/.test(sessionId)) throw new Error("Codex returned an invalid thread identity.");
          await store.update(compartment, "design-session-bind", (s) => { const c = s.conversations.find((c) => c.id === id); if (c) c.sessionId = sessionId; }, { provider });
          currentGeneration(compartment, generation);
          response = await new Promise((resolve, reject) => {
            const messages = [];
            const timer = setTimeout(() => { cleanup(); void this.cancel(compartment, id).catch(() => {}); reject(new Error("The design turn timed out. Your current layout and conversation draft are saved.")); }, 120000);
            const cleanup = () => { clearTimeout(timer); client.off("notification", listener); client.off("disconnected", disconnected); };
            const disconnected = () => { cleanup(); reject(new Error("Codex disconnected during design. Retry with your saved draft.")); };
            const listener = (m) => {
              if (m.params?.threadId !== sessionId) return;
              if (m.method === "item/completed" && m.params.item?.type === "agentMessage") messages.push(m.params.item.text);
              if (m.method === "turn/completed") { cleanup(); if (m.params.turn?.status !== "completed") { reject(new Error("Codex did not complete this proposal; the current layout is preserved.")); return; } try { resolve(JSON.parse(messages.at(-1))); } catch { reject(new Error("Codex did not return a valid structured proposal.")); } }
            };
            client.on("notification", listener); client.on("disconnected", disconnected);
            client.request("turn/start", { threadId: sessionId, input: [{ type: "text", text: JSON.stringify(context) }], approvalPolicy: "never", sandboxPolicy: { type: "readOnly" }, outputSchema: designResponseSchema }).then((r) => { running.set(key, { provider, sessionId, turnId: r.turn.id }); }, (e) => { cleanup(); reject(e); });
          });
        } else if (provider === "claude-code") {
          const cwd = join(runtimeRoot, compartment); await privateDirectory(cwd);
          const executable = await resolveCli("claude-code");
          await store.authorize(compartment, { provider }); currentGeneration(compartment, generation);
          const args = ["--safe-mode", "-p", "--output-format", "json", "--tools", "", "--strict-mcp-config", "--mcp-config", '{"mcpServers":{}}', "--settings", '{"disableAllHooks":true}', "--setting-sources", "", "--permission-mode", "dontAsk", "--permission-prompts", "none", "--json-schema", JSON.stringify(designResponseSchema), ...(sessionId ? ["--resume", sessionId] : ["--session-id", randomUUID()])];
          const value = await new Promise((resolve, reject) => {
            const child = spawnProcess(executable, args, { cwd, shell: false, windowsHide: true, stdio: ["pipe", "pipe", "ignore"] });
            running.set(key, { provider, child }); let output = "", settled = false;
            const timer = setTimeout(() => { child.kill(); finish(new Error("Claude Code timed out; your current draft is preserved.")); }, 120000);
            const finish = (error, result) => { if (settled) return; settled = true; clearTimeout(timer); error ? reject(error) : resolve(result); };
            child.on("error", () => finish(new Error("Claude Code could not start.")));
            child.stdout.on("data", (chunk) => { output += chunk; if (output.length > 2 * 1024 * 1024) { child.kill(); finish(new Error("Claude Code exceeded the response bound.")); } });
            child.stdin.on("error", () => {});
            child.on("close", (code) => { try { const r = JSON.parse(output); if (code || r.is_error || !r.structured_output) throw new Error(); finish(null, r); } catch { finish(new Error("Claude Code could not produce a proposal. Check its sign-in and account limits; the current layout is preserved.")); } });
            child.stdin.end(JSON.stringify(context));
          });
          response = value.structured_output; sessionId = value.session_id;
        } else throw new Error("This provider does not offer a configured design route. No fallback provider was selected.");
        const reviewed = validateDesignResponse(response, plan);
        const saved = { id, provider, sessionId, updatedAt: Date.now(), messages: [...(conversation?.messages ?? []), { role: "user", text: message }, { role: "assistant", text: reviewed.reply }].slice(-40), proposal: reviewed.proposal, workflow: reviewed.workflow };
        await store.update(compartment, "design-conversation", (s) => { s.conversations = [...s.conversations.filter((c) => c.id !== id), saved]; }, { provider });
        return { ...reviewed, conversationId: id, sessionId, provider, provenance: "provider-returned exact session; design output independently validated" };
      } catch (error) {
        await store.update(compartment, "design-failure", (s) => { const c = s.conversations.find((c) => c.id === id); if (c) { c.status = "failed"; c.updatedAt = Date.now(); } }).catch(() => {});
        throw error;
      } finally { busy.delete(key); running.delete(key); }
    },
    async cancel(compartment, id) {
      const matching = [...running.entries()].filter(([key]) => key.startsWith(`${compartment}:`));
      const current = id ? running.get(`${compartment}:${id}`) : matching.length === 1 ? matching[0][1] : null;
      if (!current) throw new Error("No exact active turn is owned by this conversation.");
      await store.authorize(compartment, { provider: current.provider });
      if (current.provider === "codex") { const client = clients.get(compartment); if (!client || client.closed) throw new Error("The original Codex runtime is unavailable; cancellation is unconfirmed. No replacement was launched."); await client.request("turn/interrupt", { threadId: current.sessionId, turnId: current.turnId }); }
      else await stopOwnedChild(current.child);
      return { status: "cancellation-requested", completionVerified: false };
    },
    async status(compartment, id) { const generation = generations.get(compartment) ?? 0; const state = await store.snapshot(compartment), c = state.conversations.find((c) => c.id === id); if (!c) throw new Error("That exact conversation is unavailable."); await store.authorize(compartment, { provider: c.provider }); currentGeneration(compartment, generation); if (c.provider === "codex") { const client = await codex(compartment); currentGeneration(compartment, generation); const r = await client.request("thread/read", { threadId: c.sessionId, includeTurns: false }); if (r.thread?.id !== c.sessionId) throw new Error("The exact thread changed."); return { sessionId: c.sessionId, status: r.thread.status, provenance: "Codex local runtime; not verified task completion" }; } return { sessionId: c.sessionId, status: running.has(`${compartment}:${id}`) ? "running-owned-process" : "not-observed", provenance: "Claude process lifecycle; not task completion" }; },
    async resume(compartment, id) {
      const generation = generations.get(compartment) ?? 0;
      const state = await store.snapshot(compartment), c = state.conversations.find((c) => c.id === id);
      if (!c?.sessionId) throw new Error("Choose an exact owned conversation before resuming.");
      await store.authorize(compartment, { provider: c.provider });
      currentGeneration(compartment, generation);
      if (c.provider === "codex") { const client = await codex(compartment); currentGeneration(compartment, generation); const r = await client.request("thread/resume", { threadId: c.sessionId, sandbox: "read-only", approvalPolicy: "never", config: codexDesignConfig(client.serverNames) }); if (r.thread?.id !== c.sessionId) throw new Error("The resumed thread identity did not match."); return { sessionId: c.sessionId, status: "resumed", provenance: "Exact Codex configuration conversation resumed; no prompt submitted or task outcome inferred" }; }
      return { sessionId: c.sessionId, status: "selected-for-continuation", provenance: "Exact Claude configuration conversation selected. Its next message uses --resume; external runtime state is not observed." };
    },
    async close() { closed = true; return Promise.all([...new Set([...clients.keys(), ...connecting.keys(), ...running.keys()].map((key) => key.split(":")[0]))].map(stopCompartment)); }
  };
}
