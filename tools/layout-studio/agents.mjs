/** Concrete, tool-restricted design adapters. Account state stays with installed CLIs. */
import { spawn } from "node:child_process";
import { EventEmitter } from "node:events";
import { deniedCodexServerRequest } from "./codex-requests.mjs";
import { runRestrictedCodexTurn } from "./codex-turn.mjs";
import { readClaudeDesignLogin } from "./claude-account.mjs";
import { runRuntimeCommand, runtimeGuardianStopped } from "./runtime-command.mjs";
import { runOwnedNativeCommand, guardianScope } from "./owned-native-command.mjs";
import { scopeHash, suiteConfirmations } from "./confirmations.mjs";
import { lstat, realpath, readFile } from "node:fs/promises";
import { homedir, userInfo } from "node:os";
import { join } from "node:path";
import { randomUUID, createHash } from "node:crypto";
import { modifiers, families, consequences, parsePlan, analyzePlan } from "./model.mjs";
import { proposalSchema } from "./workspace.mjs";
import { privateDirectory } from "./suite-store.mjs";
import { stopOwnedChild } from "./owned-process.mjs";
import { desktopEnvironment } from "./process-environment.mjs";

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
  const disabled = ["shell_tool", "unified_exec", "shell_snapshot", "computer_use", "browser_use", "browser_use_external", "browser_use_full_cdp_access", "browser_annotation_api", "in_app_browser", "in_app_local_automation", "in_app_voice", "in_app_dictation", "code_mode", "code_mode_host", "hooks", "plugins", "plugin_discovery_prefetch", "remote_plugin", "apps", "memories", "multi_agent", "multi_agent_v2", "view_image", "image_generation", "sleep_tool", "tool_suggest", "workspace_dependencies", "skill_search", "skill_mcp_dependency_install", "auth_elicitation", "guardian_approval", "daemon_auto_start", "goals", "unbounded_connection_retries"];
  return { features: Object.fromEntries(disabled.map((name) => [name, false])), project_doc_max_bytes: 0, approvals_reviewer: "user", web_search: "disabled", mcp_servers: Object.fromEntries(serverNames.map((n) => [n, { enabled: false }])) };
}
export function assertCodexDesignConfig(config) {
  const expected = codexDesignConfig();
  let officialBackend = config?.chatgpt_base_url == null;
  if (!officialBackend) try { const u = new URL(config.chatgpt_base_url); officialBackend = u.origin === "https://chatgpt.com" && /^\/backend-api\/?$/.test(u.pathname) && !u.search && !u.hash && !u.username && !u.password; } catch { /* unknown endpoints are refused */ }
  if (!config || !officialBackend || config.openai_base_url != null || config.model_providers?.openai != null || config.model_provider != null && config.model_provider !== "openai" || config.approvals_reviewer !== "user" || config.web_search !== "disabled" || config.project_doc_max_bytes !== 0 || Object.entries(expected.features).some(([name, value]) => config.features?.[name] !== value) || !config.mcp_servers || Object.values(config.mcp_servers).some((server) => server?.enabled !== false)) throw new Error("Codex did not enforce the restricted design configuration and first-party route. No design turn was submitted.");
}
export function codexAccountFingerprint(account) {
  if (account?.type !== "chatgpt" || typeof account.email !== "string" || !account.email.trim() || account.email.length > 320 || /[\0\r\n]/.test(account.email)) throw new Error("The native Codex login has no verified first-party account identity. No API-key or alternate-provider fallback was selected.");
  return createHash("sha256").update(JSON.stringify([account.type, account.email.trim().toLowerCase()])).digest("hex");
}
export async function readCodexMcpNames(executable, cwd, { onProbe = () => {} } = {}) {
  // Inspect the app-server's actual effective configuration, without creating a
  // thread. `codex mcp list` also returns generated entries which cannot safely
  // be overridden as ordinary TOML transports. An empty table alone merges with
  // the user's configuration and therefore does not disable configured tools.
  const probe = new CodexClient(executable, cwd);
  try {
    onProbe(probe);
    const config = await probe.handshake();
    if (!config?.mcp_servers || typeof config.mcp_servers !== "object") throw new Error("Codex tool configuration is unavailable.");
    const names = Object.entries(config.mcp_servers).filter(([, s]) => s.enabled !== false).map(([name]) => name).sort();
    codexDesignConfig(names); return names;
  } finally { probe.close(); if (!(await stopOwnedChild(probe.child)).stopped) throw new Error("The native configuration probe did not verify exit. No replacement was launched."); }
}
function reviewedCodexVersion(hello, name) {
  const agent = hello?.userAgent, prefix = `${name}/`;
  if (typeof agent !== "string" || agent.length > 512 || /[\0\r\n]/.test(agent) || !agent.startsWith(prefix)) throw new Error("Codex did not identify a verified native adapter version. Saved work was preserved.");
  const version = /^(\d+\.\d+\.\d+) \(/.exec(agent.slice(prefix.length))?.[1];
  if (version !== "0.166.0") throw new Error("This Codex version is not verified by the restricted adapter (0.166.0). Saved work was preserved.");
  return version;
}
export class CodexClient extends EventEmitter {
  constructor(executable, cwd, serverNames = [], { spawnProcess = spawn, clientInfo = { name: "switchyard_design", title: "Switchyard design", version: "0.2.0" } } = {}) {
    super(); this.sequence = 0; this.pending = new Map(); this.buffer = ""; this.closed = false;
    this.clientInfo = clientInfo;
    codexDesignConfig(serverNames); this.serverNames = [...serverNames];
    // Generated native MCP entries need a complete parseable transport override;
    // adding only `.enabled=false` can create a table with no transport. Replace
    // it with an explicitly disabled fixed native command; it is never launched.
    const restrictions = [...Object.entries(codexDesignConfig().features).map(([name, value]) => `features.${name}=${value}`), "project_doc_max_bytes=0", "approvals_reviewer=\"user\"", "web_search=\"disabled\"", ...serverNames.map((name) => `mcp_servers.${name}={command=${JSON.stringify(executable)},args=[\"--version\"],enabled=false}`)];
    this.child = spawnProcess(executable, ["app-server", "--stdio", ...restrictions.flatMap((c) => ["-c", c])], { cwd, shell: false, stdio: ["pipe", "pipe", "ignore"], windowsHide: true, env: desktopEnvironment() });
    this.child.stdout.setEncoding("utf8");
    this.child.stdout.on("data", (chunk) => {
      if (this.closed) return;
      this.buffer += chunk;
      if (Buffer.byteLength(this.buffer) > 2 * 1024 * 1024) { this.close(); return; }
      let end;
      while (!this.closed && (end = this.buffer.indexOf("\n")) >= 0) {
        const line = this.buffer.slice(0, end); this.buffer = this.buffer.slice(end + 1);
        let m; try { m = JSON.parse(line); } catch { this.close(); return; }
        if (!m || typeof m !== "object" || Array.isArray(m) || m.method !== undefined && (typeof m.method !== "string" || !m.method.length || m.method.length > 128 || /[\0\r\n]/.test(m.method)) || m.id !== undefined && !(Number.isSafeInteger(m.id) || typeof m.id === "string" && m.id.length > 0 && m.id.length <= 128 && !/[\0\r\n]/.test(m.id)) || m.id === undefined && m.method === undefined) { this.close(); return; }
        if (m.id !== undefined && m.method === undefined) { const pending = this.pending.get(m.id); if (pending) { this.pending.delete(m.id); m.error ? pending.reject(new Error(`Codex rejected ${pending.method}: ${String(m.error.message).slice(0, 400)}`)) : pending.resolve(m.result); } }
        else if (m.id !== undefined && m.method) this.send(deniedCodexServerRequest(m));
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
  async handshake() { const hello = await this.request("initialize", { clientInfo: this.clientInfo }); try { this.nativeVersion = reviewedCodexVersion(hello, this.clientInfo.name); } catch (error) { this.close(); throw error; } this.send({ method: "initialized", params: {} }); const { config } = await this.request("config/read", { includeLayers: false }); return config; }
  async initialize() { assertCodexDesignConfig(await this.handshake()); this.accountFingerprint = codexAccountFingerprint((await this.request("account/read", { refreshToken: false })).account); this.restrictionsVerified = true; }
  async recheckAccount() { if (codexAccountFingerprint((await this.request("account/read", { refreshToken: false })).account) !== this.accountFingerprint) { this.close(); throw new Error("The native Codex login changed. Saved context was not rerouted."); } return this.accountFingerprint; }
  close() { if (this.closed) return; this.closed = true; this.child.kill(); for (const p of this.pending.values()) p.reject(new Error("Codex disconnected. Your saved draft is preserved.")); this.pending.clear(); this.emit("disconnected"); }
}

export function createAgentService({ store, runtimeRoot, codexFactory = (exe, cwd, names) => new CodexClient(exe, cwd, names), resolveCli = trustedCli, resolveMcp = readCodexMcpNames, stopChild = stopOwnedChild, readClaudeLogin = readClaudeDesignLogin, command = runRuntimeCommand, guardianStopped = runtimeGuardianStopped, now = () => Date.now() } = {}) {
  const busy = new Set(), clients = new Map(), connecting = new Map(), running = new Map(), generations = new Map(), probes = new Map(), unconfirmed = new Map(), auxiliaryChildren = new Map();
  let closed = false;
  const confirmStop = async (child) => { try { return typeof child?.stop === "function" ? await child.stop() === true : (await stopChild(child)).stopped === true; } catch { return false; } };
  function retainUnconfirmed(compartment, child) { if (!child) return; const pending = unconfirmed.get(compartment) ?? new Set(); pending.add(child); unconfirmed.set(compartment, pending); }
  async function settleUnconfirmed(compartment) {
    const remaining = new Set(); for (const child of unconfirmed.get(compartment) ?? []) { if (!(await confirmStop(child))) remaining.add(child); else auxiliaryChildren.get(compartment)?.delete(child); }
    if (!auxiliaryChildren.get(compartment)?.size) auxiliaryChildren.delete(compartment);
    if (remaining.size) { unconfirmed.set(compartment, remaining); throw new Error("A previous owned provider process has not verified exit. No replacement was launched."); }
    unconfirmed.delete(compartment);
    for (const saved of (await store.snapshot(compartment)).conversations) if (saved.ownedRuntime && saved.ownedRuntimeStoppedVerified !== true) {
      const scope = guardianScope(saved.ownedRuntime);
      if (!await guardianStopped(scope)) throw new Error("A previous exact design guardian has not verified exit. No replacement was launched.");
      await store.update(compartment, "design-saved-guardian-exit", (s) => { const c = s.conversations.find((c) => c.id === saved.id); if (!c || scopeHash(c.ownedRuntime) !== scopeHash(scope)) throw new Error("The saved design guardian changed during recovery."); c.ownedRuntimeStoppedVerified = true; });
    }
  }
  async function claudeLogin(compartment, executable, cwd, generation) {
    try { return await readClaudeLogin(executable, cwd, { command, guardianStopped, stopChild, authorize: () => store.authorize(compartment, { provider: "claude-code" }), checkCurrent: () => currentGeneration(compartment, generation),
      onClient: (child) => { const owned = auxiliaryChildren.get(compartment) ?? new Set(); owned.add(child); auxiliaryChildren.set(compartment, owned); },
      onStoppedClient: (child) => { const owned = auxiliaryChildren.get(compartment); owned?.delete(child); if (!owned?.size) auxiliaryChildren.delete(compartment); }
    }); } catch (error) { retainUnconfirmed(compartment, error.ownedClient ?? error.ownedChild); throw error; }
  }
  function currentGeneration(compartment, generation) { if (closed || generation !== (generations.get(compartment) ?? 0)) throw new Error("This compartment's design request was stopped. Your draft is preserved."); }
  async function codex(compartment) {
    if (closed) throw new Error("The design service is closed.");
    if (connecting.has(compartment)) return connecting.get(compartment);
    if (clients.get(compartment)?.closed === false) return clients.get(compartment);
    const generation = generations.get(compartment) ?? 0;
    const pending = (async () => {
      await settleUnconfirmed(compartment);
      for (const [map, previous] of [[clients, clients.get(compartment)], [probes, probes.get(compartment)]]) if (previous) {
        if (!previous.closed) previous.close();
        if (!(await confirmStop(previous.child))) { retainUnconfirmed(compartment, previous.child); throw new Error("The previous owned Codex process has not verified exit. No replacement was launched."); }
        if (map.get(compartment) === previous) map.delete(compartment);
      }
      currentGeneration(compartment, generation);
      const cwd = join(runtimeRoot, compartment); await privateDirectory(cwd);
      const executable = await resolveCli("codex"); currentGeneration(compartment, generation);
      let names;
      try { names = await resolveMcp(executable, cwd, { onProbe: (probe) => { probes.set(compartment, probe); } }); }
      finally { const probe = probes.get(compartment); if (probe) { if (!probe.closed) probe.close(); if (await confirmStop(probe.child)) { if (probes.get(compartment) === probe) probes.delete(compartment); } else { retainUnconfirmed(compartment, probe.child); throw new Error("The owned Codex configuration probe has not verified exit. No replacement was launched."); } } }
      codexDesignConfig(names);
      if (closed || generation !== (generations.get(compartment) ?? 0)) throw new Error("This compartment's design connection was stopped.");
      const client = codexFactory(executable, cwd, names); client.serverNames = [...names]; clients.set(compartment, client);
      try { await client.initialize(); if (closed || generation !== (generations.get(compartment) ?? 0)) throw new Error("This compartment's design connection was stopped."); return client; }
      catch (error) { if (!client.closed) client.close(); if (await confirmStop(client.child)) { if (clients.get(compartment) === client) clients.delete(compartment); } else retainUnconfirmed(compartment, client.child); throw error; }
    })();
    connecting.set(compartment, pending);
    try { return await pending; } finally { if (connecting.get(compartment) === pending) connecting.delete(compartment); }
  }
  async function stopCompartment(compartment) {
    generations.set(compartment, (generations.get(compartment) ?? 0) + 1);
    const client = clients.get(compartment), probe = probes.get(compartment), children = new Set();
    if (client?.child) children.add(client.child);
    if (probe?.child) children.add(probe.child);
    for (const child of unconfirmed.get(compartment) ?? []) children.add(child);
    for (const child of auxiliaryChildren.get(compartment) ?? []) children.add(child);
    if (client && !client.closed) client.close(); if (probe && !probe.closed) probe.close();
    for (const [key, r] of running) if (key.startsWith(`${compartment}:`)) { r.controller?.abort(); if (r.child) children.add(r.child); for (const client of r.resource?.clients ?? []) children.add(client); }
    const ordered = [...children], results = await Promise.all(ordered.map(async (child) => ({ stopped: await confirmStop(child) })));
    const remaining = new Set(ordered.filter((_, i) => !results[i].stopped)); if (remaining.size) unconfirmed.set(compartment, remaining); else unconfirmed.delete(compartment);
    for (const [map, owned] of [[clients, client], [probes, probe]]) if (owned && (!owned.child || results[ordered.indexOf(owned.child)]?.stopped) && map.get(compartment) === owned) map.delete(compartment);
    for (const child of auxiliaryChildren.get(compartment) ?? []) if (results[ordered.indexOf(child)]?.stopped) auxiliaryChildren.get(compartment).delete(child);
    if (!auxiliaryChildren.get(compartment)?.size) auxiliaryChildren.delete(compartment);
    return { stopped: results.every((r) => r.stopped), ownedProcesses: results.length, taskCompletionVerified: false };
  }
  function legacyConversation(state, id) {
    const c = state.conversations.find((c) => c.id === id);
    if (!c || !["codex", "claude-code"].includes(c.provider) || typeof c.sessionId !== "string" || !/^[A-Za-z0-9_-]{1,128}$/.test(c.sessionId)) throw new Error("Choose an exact saved native configuration conversation.");
    if (c.accountFingerprint != null) throw new Error("This conversation already has an account binding. A different login cannot replace it through legacy review.");
    return c;
  }
  const legacyDigest = (state, c) => scopeHash(["legacy-context/v1", c, state.policy, state.mode, state.accounts]);
  async function legacyScope(compartment, id) {
    const generation = generations.get(compartment) ?? 0; currentGeneration(compartment, generation);
    if ([...busy].some((key) => key.startsWith(`${compartment}:`))) throw new Error("Wait or cancel the active design request before reviewing a legacy binding.");
    const state = await store.snapshot(compartment), conversation = legacyConversation(state, id), provider = conversation.provider;
    await store.authorize(compartment, { provider }); await settleUnconfirmed(compartment); currentGeneration(compartment, generation);
    let fingerprint;
    if (provider === "codex") { const client = await codex(compartment); await client.recheckAccount(); fingerprint = client.accountFingerprint; }
    else { const cwd = join(runtimeRoot, compartment); await privateDirectory(cwd); fingerprint = (await claudeLogin(compartment, await resolveCli(provider), cwd, generation)).fingerprint; }
    currentGeneration(compartment, generation);
    if (!/^[a-f0-9]{64}$/.test(fingerprint ?? "")) throw new Error("The current native account identity did not verify.");
    const digest = legacyDigest(state, conversation);
    return { conversation, provider, fingerprint, digest, generation,
      confirmationScope: { action: "bind_legacy_conversation", sessionId: conversation.sessionId,
        targetSnapshotId: scopeHash(["legacy-conversation-binding/v1", compartment, provider, id, conversation.sessionId, fingerprint]), scopeDigest: digest } };
  }
  return {
    stopCompartment,
    async reviewLegacyBinding(compartment, id) {
      const scope = await legacyScope(compartment, id);
      const confirmation = await suiteConfirmations(store, compartment, scope.provider, now).issue({ ...scope.confirmationScope,
        reason: "The original account is unknown. Review this saved context before allowing its exact native conversation to continue under the currently verified login. This does not verify an employer, transfer a known account binding, submit context or grant tools.", reauthenticated: false });
      currentGeneration(compartment, scope.generation);
      return { status: "requires-confirmation", confirmation, scope: { conversationId: id, provider: scope.provider, sessionId: scope.conversation.sessionId,
        currentAccountFingerprint: scope.fingerprint, originalAccountVerified: false, contextDigest: scope.digest,
        messages: structuredClone(scope.conversation.messages ?? []), proposal: structuredClone(scope.conversation.proposal ?? null) }, modelPromptSubmitted: false };
    },
    async bindLegacy(compartment, { conversationId, token }) {
      if (!/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/.test(token ?? "")) throw new Error("Use the exact one-use token from reviewing this legacy conversation and current native account.");
      const scope = await legacyScope(compartment, conversationId);
      const decision = await suiteConfirmations(store, compartment, scope.provider, now).consume({ ...scope.confirmationScope, token });
      if (!decision.allowed) throw new Error(decision.reason);
      currentGeneration(compartment, scope.generation);
      await store.claimSession(compartment, { provider: scope.provider, sessionId: scope.conversation.sessionId });
      return store.update(compartment, "legacy-conversation-binding", (s) => {
        currentGeneration(compartment, scope.generation); const c = legacyConversation(s, conversationId);
        if (legacyDigest(s, c) !== scope.digest) throw new Error("The reviewed legacy context or workspace policy changed. Review it again; saved context was preserved.");
        c.accountFingerprint = scope.fingerprint; c.legacyBindingReviewedAt = now(); c.originalAccountVerified = false;
        return { status: "bound-after-review", conversationId, sessionId: c.sessionId, provider: c.provider, originalAccountVerified: false, modelPromptSubmitted: false };
      }, { provider: scope.provider });
    },
    async discovery() {
      return Promise.all(["codex", "claude-code"].map(async (id) => { try { await resolveCli(id); return { id, installed: true, capabilities: ["design-conversation", "exact-owned-session", "status", "cancel"], auth: "checked-on-use", provenance: "fixed native CLI installation" }; } catch { return { id, installed: false, capabilities: [], auth: "unavailable" }; } }));
    },
    async design({ compartment, provider, message, plan: input, conversationId }) {
      const generation = generations.get(compartment) ?? 0; currentGeneration(compartment, generation);
      await store.authorize(compartment, { provider });
      await settleUnconfirmed(compartment);
      currentGeneration(compartment, generation);
      if (typeof message !== "string" || !message.trim() || message.length > 12000) throw new Error("Describe the workflow in 1–12000 characters.");
      const plan = parsePlan(input), state = await store.snapshot(compartment);
      currentGeneration(compartment, generation);
      const conversation = conversationId ? state.conversations.find((c) => c.id === conversationId && c.provider === provider) : null;
      if (conversationId && !conversation) throw new Error("That conversation is not bound to this compartment and provider.");
      const id = conversation?.id ?? randomUUID(), key = `${compartment}:${id}`;
      if ([...busy].some((k) => k.startsWith(`${compartment}:`))) throw new Error("A design turn is already running in this workspace. Wait or cancel before sending again.");
      const context = { instruction: "You are Switchyard's configuration designer. Improve the process before mapping it. Return only the response schema. Never run tools, read files, contact services, or apply a change. Use actual supplied key IDs. Preserve ordinary typing; use modified chords. Do not invent device, completion, time-saving or capability evidence. Estimates default to zero. Explain questions in reply. Return the full desired action list, editable process steps and agent role labels. Keep stable action IDs when revising. The output is an untrusted proposal requiring independent review.", currentPlan: plan, currentWorkflow: state.workflow, conversation: (conversation?.messages ?? []).slice(-12), request: message };
      const contextText = JSON.stringify(context);
      if (provider === "claude-code" && Buffer.byteLength(contextText) > 524288) throw new Error("The complete designer context exceeds 512 KiB. Shorten the saved conversation or workflow before sending; no model prompt was submitted.");
      busy.add(key);
      let sessionId = conversation?.sessionId ?? null, accountFingerprint = conversation?.accountFingerprint ?? null, ownedRuntime = null;
      try {
        await store.update(compartment, "design-draft", (s) => { currentGeneration(compartment, generation); s.conversations = [...s.conversations.filter((c) => c.id !== id), { ...conversation, id, provider, sessionId: conversation?.sessionId ?? null, updatedAt: Date.now(), messages: [...(conversation?.messages ?? []), { role: "user", text: message }].slice(-40), status: "pending" }]; }, { provider });
        currentGeneration(compartment, generation);
        let response;
        if (provider === "codex") {
          const client = await codex(compartment);
          currentGeneration(compartment, generation);
          await client.recheckAccount(); currentGeneration(compartment, generation);
          if (conversation && conversation.accountFingerprint !== client.accountFingerprint) throw new Error("This conversation has no verified binding to the current native login. Its context was preserved; review the legacy binding or choose a new conversation.");
          accountFingerprint = client.accountFingerprint;
          const restricted = { sandbox: "read-only", approvalPolicy: "never", config: codexDesignConfig(client.serverNames), baseInstructions: "Only design a keyboard configuration from supplied text. Never call a tool. Return the required JSON schema." };
          let native;
          if (sessionId) { native = await client.request("thread/resume", { ...restricted, threadId: sessionId }); if (native.thread?.id !== sessionId) throw new Error("Codex resumed a different thread."); }
          else { native = await client.request("thread/start", { ...restricted, cwd: join(runtimeRoot, compartment), serviceName: "switchyard-design" }); sessionId = native.thread?.id; }
          if (typeof sessionId !== "string" || !/^[A-Za-z0-9_-]{1,128}$/.test(sessionId)) throw new Error("Codex returned an invalid thread identity.");
          await store.update(compartment, "design-session-bind", (s) => { const c = s.conversations.find((c) => c.id === id); if (c) { c.sessionId = sessionId; c.accountFingerprint = accountFingerprint; } });
          if (native.sandbox?.type !== "readOnly" || native.approvalPolicy !== "never" || native.modelProvider !== "openai") throw new Error("The native thread did not verify read-only permissions and the first-party provider. Its returned identity was retained; no model prompt was submitted.");
          await store.claimSession(compartment, { provider, sessionId });
          currentGeneration(compartment, generation);
          const controller = new AbortController(); running.set(key, { provider, sessionId, controller, turnId: null });
          const turn = await runRestrictedCodexTurn({ client, threadId: sessionId, text: contextText, outputSchema: designResponseSchema, signal: controller.signal, stopChild, checkCurrent: () => currentGeneration(compartment, generation), onStarted: async (turnId) => { running.get(key).turnId = turnId; } });
          try { response = JSON.parse(turn.text); } catch { throw new Error("Codex did not return a valid structured proposal."); }
        } else if (provider === "claude-code") {
          const cwd = join(runtimeRoot, compartment); await privateDirectory(cwd);
          const executable = await resolveCli("claude-code");
          await store.authorize(compartment, { provider }); currentGeneration(compartment, generation);
          const login = await claudeLogin(compartment, executable, cwd, generation);
          if (conversation && conversation.accountFingerprint !== login.fingerprint) throw new Error("This conversation has no verified binding to the current native Claude login. Its context was preserved; review the legacy binding or choose a new conversation.");
          accountFingerprint = login.fingerprint;
          const continuing = Boolean(sessionId); sessionId ??= randomUUID();
          if (!/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/.test(sessionId)) throw new Error("Choose an exact supported native Claude conversation.");
          await store.update(compartment, "design-session-bind", (s) => { currentGeneration(compartment, generation); const c = s.conversations.find((c) => c.id === id); if (c) { c.sessionId = sessionId; c.accountFingerprint = accountFingerprint; } }, { provider });
          await store.claimSession(compartment, { provider, sessionId }); currentGeneration(compartment, generation);
          const args = ["--safe-mode", "-p", "--output-format", "json", "--tools", "", "--strict-mcp-config", "--mcp-config", '{"mcpServers":{}}', "--settings", '{"disableAllHooks":true}', "--setting-sources", "", "--permission-mode", "dontAsk", "--permission-prompts", "none", "--json-schema", JSON.stringify(designResponseSchema), ...(continuing ? ["--resume", sessionId] : ["--session-id", sessionId])];
          const resource = { clients: new Set() }, controller = new AbortController();
          running.set(key, { provider, sessionId, resource, controller });
          const result = await runOwnedNativeCommand({ executable, args, cwd, text: contextText, resource, signal: controller.signal, command, guardianStopped, stopChild, timeout: 120000, maxOutputBytes: 524288, captureStderrBytes: 16384, env: desktopEnvironment(),
            onReady: async (scope) => {
              currentGeneration(compartment, generation); await store.authorize(compartment, { provider }); currentGeneration(compartment, generation);
              await store.update(compartment, "design-guardian-ready", (s) => { currentGeneration(compartment, generation); const c = s.conversations.find((c) => c.id === id); if (!c || c.sessionId !== sessionId || c.accountFingerprint !== accountFingerprint) throw new Error("The exact designer conversation changed before start."); c.ownedRuntime = scope; c.ownedRuntimeStoppedVerified = false; }, { provider });
              ownedRuntime = scope;
              await store.authorize(compartment, { provider }); currentGeneration(compartment, generation);
            },
            onStopped: async (scope) => {
              await store.update(compartment, "design-guardian-stopped", (s) => { const c = s.conversations.find((c) => c.id === id); if (!c?.ownedRuntime) return; if (scopeHash(c.ownedRuntime) !== scopeHash(scope)) throw new Error("The exact designer guardian changed before exit acknowledgement."); c.ownedRuntimeStoppedVerified = true; });
            }
          });
          let value;
          try {
            value = JSON.parse(result.stdout);
            if (result.status !== "completed" || result.exitCode !== 0 || value?.type !== "result" || value.subtype !== "success" || value.is_error !== false || !value.structured_output || !Array.isArray(value.permission_denials ?? []) || (value.permission_denials ?? []).length) throw new Error();
          } catch { throw new Error("Claude Code could not produce a verified proposal. Check its sign-in and account limits; the current layout and exact conversation were preserved."); }
          if (value.session_id !== sessionId) throw new Error("Claude returned a different native session. Saved context was preserved; no replacement was submitted.");
          if ((await claudeLogin(compartment, executable, cwd, generation)).fingerprint !== accountFingerprint) throw new Error("The native Claude login changed before retaining the reply. Saved context was preserved.");
          response = value.structured_output;
        } else throw new Error("This provider does not offer a configured design route. No fallback provider was selected.");
        const reviewed = validateDesignResponse(response, plan);
        const saved = { id, provider, sessionId, accountFingerprint, ...(ownedRuntime ? { ownedRuntime, ownedRuntimeStoppedVerified: true } : {}), updatedAt: Date.now(), messages: [...(conversation?.messages ?? []), { role: "user", text: message }, { role: "assistant", text: reviewed.reply }].slice(-40), proposal: reviewed.proposal, workflow: reviewed.workflow };
        await store.update(compartment, "design-conversation", (s) => { currentGeneration(compartment, generation); s.conversations = [...s.conversations.filter((c) => c.id !== id), saved]; }, { provider });
        return { ...reviewed, conversationId: id, sessionId, provider, ...(ownedRuntime ? { ownedRuntime, ownedRuntimeStoppedVerified: true } : {}), provenance: "provider-returned exact session; design output independently validated" };
      } catch (error) {
        const uncertain = provider === "codex" && error.stopVerified === false ? clients.get(compartment)?.child : null;
        retainUnconfirmed(compartment, uncertain);
        await store.update(compartment, "design-failure", (s) => { const c = s.conversations.find((c) => c.id === id); if (c) { c.status = "failed"; c.updatedAt = Date.now(); } }).catch(() => {});
        throw error;
      } finally { const active = running.get(key); const owned = [...(active?.resource?.clients ?? []), ...(active?.child ? [active.child] : [])]; for (const client of owned) if (!(await confirmStop(client))) retainUnconfirmed(compartment, client); busy.delete(key); running.delete(key); }
    },
    async cancel(compartment, id) {
      const matching = [...running.entries()].filter(([key]) => key.startsWith(`${compartment}:`));
      const current = id ? running.get(`${compartment}:${id}`) : matching.length === 1 ? matching[0][1] : null;
      if (!current) { const pending = [...busy].filter((key) => key.startsWith(`${compartment}:`) && (!id || key === `${compartment}:${id}`)); if (pending.length !== 1) throw new Error("No exact active turn is owned by this conversation."); await store.snapshot(compartment); const result = await stopCompartment(compartment); return { status: result.stopped ? "owned-startup-stopped" : "stop-unconfirmed", completionVerified: false }; }
      await store.snapshot(compartment);
      if (current.provider === "codex") { const client = clients.get(compartment); if (!client || client.closed || !current.controller) throw new Error("The original Codex runtime is unavailable; cancellation is unconfirmed. No replacement was launched."); current.controller.abort(); }
      else { current.controller?.abort(); for (const client of current.resource?.clients ?? []) if (!await confirmStop(client)) { retainUnconfirmed(compartment, client); throw new Error("The exact owned Claude design guardian has not verified exit. Cancellation is unconfirmed."); } }
      return { status: "cancellation-requested", completionVerified: false };
    },
    async status(compartment, id) {
      const generation = generations.get(compartment) ?? 0;
      const state = await store.snapshot(compartment), c = state.conversations.find((c) => c.id === id);
      if (!c?.sessionId) throw new Error("That exact conversation is unavailable.");
      await store.authorize(compartment, { provider: c.provider }); currentGeneration(compartment, generation);
      if (c.provider === "codex") {
        if (!/^[a-f0-9]{64}$/.test(c.accountFingerprint ?? "")) throw new Error("Review this legacy conversation's native account binding before querying its runtime. Saved context is preserved.");
        const client = await codex(compartment); await client.recheckAccount(); currentGeneration(compartment, generation);
        if (c.accountFingerprint !== client.accountFingerprint) throw new Error("The native account changed. No saved conversation was redirected.");
        const r = await client.request("thread/read", { threadId: c.sessionId, includeTurns: false });
        if (r.thread?.id !== c.sessionId) throw new Error("The exact thread changed.");
        return { sessionId: c.sessionId, status: r.thread.status, provenance: "Codex local runtime; not verified task completion" };
      }
      return { sessionId: c.sessionId, status: running.has(`${compartment}:${id}`) ? "running-owned-process" : "not-observed", provenance: "Claude process lifecycle; not task completion" };
    },
    async resume(compartment, id) {
      const generation = generations.get(compartment) ?? 0;
      const state = await store.snapshot(compartment), c = state.conversations.find((c) => c.id === id);
      if (!c?.sessionId) throw new Error("Choose an exact owned conversation before resuming.");
      if ([...busy].some((key) => key.startsWith(`${compartment}:`))) throw new Error("A design turn is already running in this workspace. Wait or cancel before resuming.");
      await store.authorize(compartment, { provider: c.provider });
      await settleUnconfirmed(compartment);
      currentGeneration(compartment, generation);
      if (c.provider === "codex") { if (!/^[a-f0-9]{64}$/.test(c.accountFingerprint ?? "")) throw new Error("Review this legacy conversation's native account binding before resuming. Its saved context is preserved."); const client = await codex(compartment); await client.recheckAccount(); currentGeneration(compartment, generation); if (c.accountFingerprint !== client.accountFingerprint) throw new Error("The native account changed. No saved context was resumed or rerouted."); await store.claimSession(compartment, { provider: c.provider, sessionId: c.sessionId }); const r = await client.request("thread/resume", { threadId: c.sessionId, sandbox: "read-only", approvalPolicy: "never", config: codexDesignConfig(client.serverNames) }); if (r.thread?.id !== c.sessionId || r.sandbox?.type !== "readOnly" || r.approvalPolicy !== "never" || r.modelProvider !== "openai") throw new Error("The resumed thread identity, first-party provider or permissions did not match."); return { sessionId: c.sessionId, status: "resumed", provenance: "Exact account-bound Codex configuration conversation resumed; no prompt submitted or task outcome inferred" }; }
      if (c.provider !== "claude-code" || !/^[a-f0-9]{64}$/.test(c.accountFingerprint ?? "")) throw new Error("Review this legacy conversation's native account binding before continuing. Saved context is preserved.");
      const cwd = join(runtimeRoot, compartment); await privateDirectory(cwd);
      const executable = await resolveCli("claude-code"), login = await claudeLogin(compartment, executable, cwd, generation);
      currentGeneration(compartment, generation);
      if (c.accountFingerprint !== login.fingerprint) throw new Error("The native Claude account changed. No saved context was resumed or rerouted.");
      await store.claimSession(compartment, { provider: c.provider, sessionId: c.sessionId });
      return { sessionId: c.sessionId, status: "selected-for-continuation", provenance: "Exact account-bound Claude configuration conversation selected. Its next message uses --resume; external runtime state is not observed." };
    },
    async close() { closed = true; const results = await Promise.all([...new Set([...clients.keys(), ...probes.keys(), ...unconfirmed.keys(), ...connecting.keys(), ...auxiliaryChildren.keys(), ...running.keys()].map((key) => key.split(":")[0]))].map(stopCompartment)); if (results.some((r) => r.stopped !== true)) throw new Error("An owned design process has not verified exit during shutdown."); return results; }
  };
}
