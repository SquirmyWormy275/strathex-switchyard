/** Compartment-scoped authenticated encryption and policy enforcement. */
import { createCipheriv, createDecipheriv, createHash, createHmac, timingSafeEqual, randomBytes, randomUUID } from "node:crypto";
import { spawn } from "node:child_process";
import { privateDirectory, privateRead, privateWrite } from "./private-fs.mjs";
import { withStateLock } from "./state-lock.mjs";
export { privateDirectory, privateRead, privateWrite } from "./private-fs.mjs";
import { lstat, readdir } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { importProfile } from "./workspace.mjs";
import { reconcileWorkflow } from "./workflow.mjs";
import { createPortablePackage, packageDefinition, portableDefinitionDigest, preparePortableImport } from "./portable-package.mjs";

const idPattern = /^[a-z][a-z0-9-]{0,47}$/;
const templates = {
  personal: { providers: ["codex", "claude-code", "native-chatgpt", "custom-agent", "local-transcription"], accounts: [], export: true, recording: true, crossCompartment: false, retentionDays: 30 },
  work: { providers: ["microsoft-365-copilot"], accounts: [], export: false, recording: false, crossCompartment: false, retentionDays: 7 }
};

async function boundedProcess(executable, args, input, timeout = 10000) {
  return new Promise((resolve, reject) => {
    const child = spawn(executable, args, { shell: false, windowsHide: true, stdio: ["pipe", "pipe", "pipe"] });
    let output = Buffer.alloc(0), stderrBytes = 0, done = false;
    const timer = setTimeout(() => { child.kill(); finish(new Error("The platform credential store timed out.")); }, timeout);
    function finish(error, result) { if (done) return; done = true; clearTimeout(timer); if (error) reject(error); else resolve(result); }
    child.on("error", () => finish(new Error("The platform credential store is unavailable.")));
    child.stdout.on("data", (chunk) => { output = Buffer.concat([output, chunk]); if (output.length > 32768) { child.kill(); finish(new Error("Credential response exceeded its bound.")); } });
    child.stderr.on("data", (chunk) => { stderrBytes += chunk.length; });
    child.stdin.on("error", () => {});
    child.on("close", (code) => finish(null, { code, text: output.toString("utf8").trim(), stderrBytes }));
    child.stdin.end(input);
  });
}

/** Secrets use a distinct OS-protected entry per compartment and purpose. */
export function platformSecrets({ root }) {
  async function windows(operation, id, purpose, value) {
    const executable = join(process.env.SystemRoot || "C:\\Windows", "System32/WindowsPowerShell/v1.0/powershell.exe");
    const script = fileURLToPath(new URL("./windows-protect.ps1", import.meta.url));
    const path = join(root, `${id}-${purpose}.dpapi`);
    if (operation === "lookup") {
      let sealed; try { sealed = await privateRead(path); } catch (error) { if (error.code === "ENOENT") return null; throw error; }
      const r = await boundedProcess(executable, ["-NoProfile", "-NonInteractive", "-File", script], JSON.stringify({ operation: "unprotect", value: sealed }));
      if (r.code || r.stderrBytes) throw new Error("Windows DPAPI could not open this credential.");
      return r.text;
    }
    const r = await boundedProcess(executable, ["-NoProfile", "-NonInteractive", "-File", script], JSON.stringify({ operation: "protect", value }));
    if (r.code || r.stderrBytes) throw new Error("Windows DPAPI could not protect this credential.");
    await privateWrite(path, r.text); return value;
  }
  async function run(operation, id, purpose, value) {
    if (!idPattern.test(id) || !idPattern.test(purpose)) throw new Error("Credential reference is invalid.");
    if (process.platform === "win32") return windows(operation, id, purpose, value);
    if (process.platform !== "linux") throw new Error("A supported platform credential store is required; there is no plaintext fallback.");
    const args = operation === "lookup" ? ["lookup"] : ["store", "--label=Switchyard private compartment credential"];
    args.push("application", "switchyard-suite-v1", "compartment", id, "purpose", purpose);
    const r = await boundedProcess("/usr/bin/secret-tool", args, operation === "store" ? value : "");
    if (operation === "lookup" && r.code === 1 && !r.text && !r.stderrBytes) return null;
    if (r.code || r.stderrBytes) throw new Error("Secret Service is locked or unavailable. Unlock it before saving; no plaintext fallback was used.");
    return operation === "lookup" ? r.text : value;
  }
  return { get: (id, purpose) => run("lookup", id, purpose), set: (id, purpose, value) => run("store", id, purpose, value) };
}

export function createSuiteStore({ root = join(process.env.XDG_STATE_HOME || (process.platform === "win32" ? process.env.LOCALAPPDATA || homedir() : join(homedir(), ".local/state")), "strathex-switchyard/suite"), secrets, clock = () => Date.now() } = {}) {
  secrets ??= platformSecrets({ root: join(root, "credentials") });
  const queues = new Map();
  const validate = (id) => { if (!idPattern.test(id)) throw new Error("Compartment identity is invalid."); };
  const path = (id) => join(root, `${id}.sealed.json`);
  async function key(id, create = false) {
    let encoded = await secrets.get(id, "storage-key");
    if (!encoded && create) { encoded = randomBytes(32).toString("base64"); await secrets.set(id, "storage-key", encoded); const readback = await secrets.get(id, "storage-key"); if (readback !== encoded) throw new Error("Credential-store readback failed."); }
    if (typeof encoded !== "string" || Buffer.from(encoded, "base64").length !== 32) throw new Error("The compartment key is unavailable. Restore its OS credential entry; do not replace the encrypted data.");
    return Buffer.from(encoded, "base64");
  }
  async function read(id) {
    validate(id); await privateDirectory(root);
    const envelope = JSON.parse(await privateRead(path(id)));
    if (envelope.schema !== "switchyard-compartment/v1" || envelope.id !== id || typeof envelope.data !== "string") throw new Error("Compartment envelope identity is invalid.");
    const k = await key(id);
    try {
      const d = createDecipheriv("aes-256-gcm", k, Buffer.from(envelope.nonce, "base64")); d.setAAD(Buffer.from(`switchyard-compartment/v1:${id}`)); d.setAuthTag(Buffer.from(envelope.tag, "base64"));
      const opened = Buffer.concat([d.update(Buffer.from(envelope.data, "base64")), d.final()]);
      try { return JSON.parse(opened.toString("utf8")); } finally { opened.fill(0); }
    } catch { throw new Error("Compartment data could not authenticate. Preserve the file and recover the matching key."); }
    finally { k.fill(0); }
  }
  async function write(id, value) {
    const k = await key(id), nonce = randomBytes(12), clear = Buffer.from(JSON.stringify(value));
    try {
      const c = createCipheriv("aes-256-gcm", k, nonce); c.setAAD(Buffer.from(`switchyard-compartment/v1:${id}`));
      const data = Buffer.concat([c.update(clear), c.final()]);
      await privateWrite(path(id), JSON.stringify({ schema: "switchyard-compartment/v1", id, nonce: nonce.toString("base64"), tag: c.getAuthTag().toString("base64"), data: data.toString("base64") }));
    } finally { k.fill(0); clear.fill(0); }
  }
  async function mutate(id, fn) {
    validate(id);
    const previous = queues.get(id) ?? Promise.resolve();
    const pending = previous.catch(() => {}).then(() => withStateLock(root, id, async (lease) => { const state = await read(id); const result = await fn(state); lease.assert(); await write(id, state); return result; }));
    queues.set(id, pending);
    try { return await pending; } finally { if (queues.get(id) === pending) queues.delete(id); }
  }
  function permit(state, { provider, account, operation, destination } = {}) {
    const policy = templates[state.policy];
    if (typeof state.policy !== "string" || !Object.hasOwn(templates, state.policy)) throw new Error("Compartment policy is unsupported.");
    if (provider && !policy.providers.includes(provider)) throw new Error("This provider is prohibited in the selected compartment.");
    if (account && !state.accounts.includes(account)) throw new Error("This account is not enrolled in the selected compartment.");
    if (operation === "export" && !policy.export) throw new Error("Exports are prohibited in this compartment.");
    if (operation === "record" && !policy.recording) throw new Error("Recording is prohibited in this compartment.");
    if (destination && destination !== state.id && !policy.crossCompartment) throw new Error("Cross-compartment content routing is prohibited.");
    const mode = state.mode ?? "keyboard-only";
    if (!["keyboard-only", "personal-companion", "managed-companion"].includes(mode)) throw new Error("The saved operating mode is unsupported. Preserve the original state.");
    if (mode === "keyboard-only" && (provider || operation === "record")) throw new Error("Keyboard-only mode has no provider or recording effects. Choose companion mode deliberately to connect local actions.");
    return true;
  }
  function prune(state) {
    const cutoff = clock() - templates[state.policy].retentionDays * 86400000;
    state.audit = state.audit.filter((e) => e.at >= cutoff).slice(-1000);
    state.observations = state.observations.filter((e) => e.updatedAt >= cutoff).slice(-100);
    state.conversations = state.conversations.filter((e) => e.updatedAt >= cutoff).slice(-100);
    state.voice = state.voice.filter((e) => e.updatedAt >= cutoff).slice(-100);
  }
  function putProfile(s, p) {
    s.profiles ??= []; s.profileHistory ??= [];
    const index = s.profiles.findIndex((entry) => entry.profile.id === p.id);
    if (index < 0 && s.profiles.length >= 32) throw new Error("The workspace already has 32 saved profiles. Export and manage them before adding another.");
    const next = { ...p, workflow: p.workflow ?? s.workflow }, previous = index >= 0 ? s.profiles[index].profile : s.profile?.id === p.id ? s.profile : null;
    if (previous && JSON.stringify(previous) !== JSON.stringify(next)) { s.profileHistory.push({ revision: randomUUID(), at: clock(), profile: previous }); s.profileHistory = s.profileHistory.slice(-20); }
    const entry = { profile: next, updatedAt: clock() };
    if (index >= 0) s.profiles[index] = entry; else s.profiles.push(entry);
    s.profile = next; s.workflow = next.workflow;
    if (JSON.stringify(s).length > 4 * 1024 * 1024) throw new Error("Saved profile storage limit reached. Existing state is preserved.");
    return s.profile;
  }
  return {
    async withResourceLock(kind, identity, fn) {
      if (kind !== "voice-cpu" || typeof identity !== "string" || identity.length > 1024) throw new Error("Unsupported private resource lease.");
      return withStateLock(root, `${kind}-${createHash("sha256").update(identity).digest("hex").slice(0, 40)}`, fn);
    },
    async selection(value) { const selected = join(root, "active-compartment.json"); if (value === undefined) { try { const s = JSON.parse(await privateRead(selected)); validate(s.id); return s.id; } catch (error) { if (error.code === "ENOENT") return "personal"; throw error; } } validate(value); await read(value); await privateWrite(selected, JSON.stringify({ id: value })); return value; },
    async initialize(id = "personal", policy) {
      validate(id); if (policy !== undefined && (typeof policy !== "string" || !Object.hasOwn(templates, policy))) throw new Error("Choose Personal or Copilot-only Work policy.");
      return withStateLock(root, id, async (lease) => {
        await privateDirectory(root);
        let exists = false; try { await lstat(path(id)); exists = true; } catch (e) { if (e.code !== "ENOENT") throw e; }
        if (exists) { const existing = await read(id); if (policy !== undefined && existing.policy !== policy) throw new Error("The stored compartment policy differs; it cannot be silently replaced."); return { id, policy: existing.policy }; }
        policy ??= id === "work" ? "work" : "personal";
        lease.assert(); await key(id, true);
        lease.assert();
        await write(id, { schema: "switchyard-suite-state/v1", id, policy, mode: "keyboard-only", accounts: [], profile: null, workflow: { name: "My workflow", steps: [], roles: [] }, conversations: [], observations: [], voice: [], agents: [], audit: [] });
        return { id, policy };
      });
    },
    async list() {
      await privateDirectory(root);
      const ids = (await readdir(root)).filter((n) => /^[a-z][a-z0-9-]{0,47}\.sealed\.json$/.test(n)).map((n) => n.replace(/\.sealed\.json$/, ""));
      return ids.slice(0, 32).map((id) => ({ id }));
    },
    async snapshot(id) { const s = await read(id); permit(s); prune(s); return { ...s, mode: s.mode ?? "keyboard-only", policyRules: templates[s.policy] }; },
    async authorize(id, request) { const s = await read(id); return permit(s, request); },
    async claimSession(id, { provider, sessionId }) {
      if (!["codex", "claude-code"].includes(provider) || typeof sessionId !== "string" || !/^[A-Za-z0-9_-]{1,128}$/.test(sessionId)) throw new Error("External session ownership requires a supported provider and exact session ID.");
      permit(await read(id), { provider });
      const sessionHash = createHash("sha256").update(JSON.stringify([provider, sessionId])).digest("hex"), ownerHash = createHash("sha256").update(id).digest("hex");
      return withStateLock(root, "external-sessions", async (lease) => {
        const directory = join(root, "external-sessions"), file = join(directory, `${sessionHash}.json`); await privateDirectory(directory);
        const k = await key(id);
        try {
          const tag = createHmac("sha256", k).update(JSON.stringify(["switchyard-session-owner/v1", sessionHash, ownerHash])).digest("hex");
          let existing; try { existing = JSON.parse(await privateRead(file)); } catch (error) { if (error.code !== "ENOENT") throw error; }
          if (existing) {
            if (existing.schema !== "switchyard-session-owner/v1" || existing.sessionHash !== sessionHash || existing.ownerHash !== ownerHash) throw new Error("This external session is already assigned outside this compartment or its ownership record is invalid. No content was routed.");
            if (typeof existing.tag !== "string" || !/^[a-f0-9]{64}$/.test(existing.tag) || !timingSafeEqual(Buffer.from(existing.tag), Buffer.from(tag))) throw new Error("External session ownership failed authentication. Preserve the ownership record.");
          } else {
            if ((await readdir(directory)).length >= 512) throw new Error("External session ownership limit reached. Existing bindings were preserved.");
            lease.assert(); await privateWrite(file, JSON.stringify({ schema: "switchyard-session-owner/v1", sessionHash, ownerHash, tag }));
          }
          return { claimed: true };
        } finally { k.fill(0); }
      });
    },
    async saveProfile(id, value) {
      const p = importProfile(value);
      return mutate(id, (s) => putProfile(s, p));
    },
    async saveWorkflow(id, value) { return mutate(id, (s) => { const workflow = reconcileWorkflow(value, s.workflow); if (s.profile) putProfile(s, { ...s.profile, workflow }); else s.workflow = workflow; return workflow; }); },
    async selectProfile(id, profileId, revision = null) {
      return mutate(id, (s) => {
        const target = revision ? s.profileHistory?.find((p) => p.revision === revision && p.profile.id === profileId)?.profile : s.profiles?.find((p) => p.profile.id === profileId)?.profile;
        if (!target) throw new Error("That saved profile or revision is unavailable in this workspace.");
        const p = importProfile(target);
        s.profile = p; s.workflow = p.workflow ?? s.workflow;
        return p;
      });
    },
    async exportProfile(id) { const s = await read(id); permit(s, { operation: "export" }); if (!s.profile) throw new Error("Save a profile first."); return importProfile(s.profile); },
    async reviewProfilePackage(id, value) {
      const s = await read(id); permit(s);
      return preparePortableImport(value, { currentProfile: s.profile, currentWorkflow: s.workflow, localBindings: s.roleBindings ?? [] });
    },
    async importProfilePackage(id, value, reviewId, { verifySource = () => {} } = {}) {
      return mutate(id, (s) => {
        permit(s);
        // A host-owned source check runs under the same state lease as adoption.
        // HTTP input cannot supply this callback or a source assertion.
        verifySource(s);
        const review = preparePortableImport(value, { currentProfile: s.profile, currentWorkflow: s.workflow, localBindings: s.roleBindings ?? [] });
        if (review.status !== "review-required" || typeof reviewId !== "string" || reviewId !== review.reviewId) throw new Error("Review this exact profile and current local connections before importing. Saved definitions are unchanged.");
        const p = packageDefinition(review.document);
        putProfile(s, p);
        // Foreign role IDs, including collisions with existing IDs, never
        // inherit an enrolled session from the destination workspace.
        s.roleBindings = [];
        s.portablePackages ??= [];
        s.portablePackages = [...s.portablePackages.filter((entry) => entry.document.id !== p.id), { definitionDigest: portableDefinitionDigest(p), document: review.document }].slice(-32);
        if (JSON.stringify(s).length > 4 * 1024 * 1024) throw new Error("Saved profile storage limit reached. Existing state is preserved.");
        return { imported: true, profile: s.profile, revision: review.document.revision, roleBindingsCleared: review.localConnections.disconnectedRoleBindings, localMode: s.mode ?? "keyboard-only", localConnectionsRequireReview: true };
      });
    },
    async exportProfilePackage(id, preferences = null) {
      const s = await read(id); permit(s, { operation: "export" });
      if (!s.profile) throw new Error("Save a profile first.");
      const saved = s.portablePackages?.find((p) => p.definitionDigest === portableDefinitionDigest(s.profile));
      return { document: preferences ? createPortablePackage(s.profile, preferences) : saved?.document ?? createPortablePackage(s.profile), metadataStatus: preferences ? "explicit-export-preferences" : saved ? "preserved" : "derived-requires-review", localConnectionsIncluded: false };
    },
    async update(id, operation, fn, request = {}) { return mutate(id, async (s) => { permit(s, request); prune(s); const result = await fn(s); if (JSON.stringify(s).length > 4 * 1024 * 1024) throw new Error("Compartment data limit reached. Review retention and delete older sessions."); s.audit.push({ at: clock(), operation: /^[a-z-]{1,40}$/.test(operation) ? operation : "operation", outcome: "completed" }); return result; }); },
    async credential(id, purpose, value, request) { await this.authorize(id, request); if (value === undefined) return secrets.get(id, purpose); if (typeof value !== "string" || value.length < 1 || value.length > 16000) throw new Error("Credential is invalid."); await secrets.set(id, purpose, value); return { reference: `${id}:${purpose}` }; },
    async route(source, destination, content, provider) { await this.authorize(source, { destination, provider }); await this.authorize(destination, { provider }); return { source, destination, content }; },
    async enforceRetention(id) { return mutate(id, (s) => { prune(s); return { retained: true }; }); }
  };
}
