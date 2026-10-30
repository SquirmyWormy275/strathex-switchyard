/** Owned app-server transport for Windows tasks; no model turns or shell requests. */
import { createHash } from "node:crypto";
import { homedir } from "node:os";
import { isAbsolute, join } from "node:path";
import { realpath } from "node:fs/promises";
import { CodexClient, readCodexMcpNames, trustedCli, assertCodexDesignConfig, codexDesignConfig } from "./agents.mjs";
import { directoryIdentity, privateDirectory } from "./private-fs.mjs";
import { stopOwnedChild } from "./owned-process.mjs";
const threadId = /^[A-Za-z0-9_-]{1,128}$/;
const validId = (v) => typeof v === "string" && threadId.test(v);
function observed(t) {
  if (!t || !validId(t.id) || t.turns !== undefined && (!Array.isArray(t.turns) || t.turns.length)) throw new Error("Codex did not return metadata-only thread identity.");
  const type = t.status?.type;
  return { id: t.id, observation: type === "notLoaded" ? "not-observed" : type === "idle" ? "idle" : type === "systemError" ? "error" : type === "active" ? Array.isArray(t.status.activeFlags) && t.status.activeFlags.includes("waitingOnApproval") ? "waiting-on-approval" : "active" : "unknown" };
}
async function exactRoot(value, expected) {
  if (typeof value !== "string" || !isAbsolute(value) || value.length > 4096 || /[\0\r\n]/.test(value)) throw new Error("Codex did not return an exact local working directory.");
  await directoryIdentity(value); const canonical = await realpath(value);
  if (canonical !== expected) throw new Error("Codex returned another working directory. No task was redirected.");
}
export function createCodexStdioTasks({ store, root = join(process.env.XDG_STATE_HOME || process.env.LOCALAPPDATA || join(homedir(), ".local/state"), "strathex-switchyard/codex-tasks"), resolveCli = trustedCli, resolveMcp = readCodexMcpNames, clientFactory = (exe, cwd, names) => new CodexClient(exe, cwd, names, { clientInfo: { name: "switchyard_tasks", title: "Switchyard exact tasks", version: "0.1.0" } }), stopChild = stopOwnedChild } = {}) {
  const clients = new Map(), connecting = new Map(), generations = new Map(), unconfirmed = new Map(), probes = new Map(); let closed = false;
  const generation = (c) => generations.get(c) ?? 0;
  async function dispose(c, client) {
    client.close(); const result = await stopChild(client.child);
    if (!result.stopped) unconfirmed.set(c, client); else if (unconfirmed.get(c) === client) unconfirmed.delete(c);
    if (clients.get(c) === client) clients.delete(c);
    return result;
  }
  async function connected(c, fence) {
    const current = () => { if (closed || generation(c) !== fence) throw new Error("This owned Codex task connection was stopped."); };
    const authorize = async () => { current(); await store.authorize(c, { provider: "codex" }); current(); };
    await authorize();
    if (unconfirmed.has(c)) {
      if (!(await dispose(c, unconfirmed.get(c))).stopped) throw new Error("The previous owned Codex process has not verified exit. No replacement was launched.");
    }
    let client = clients.get(c);
    if (client?.closed) { if (!(await dispose(c, client)).stopped) throw new Error("Owned Codex process exit is unconfirmed."); client = null; }
    if (!client) {
      if (!connecting.has(c)) {
        const pending = (async () => {
          const cwd = join(root, c); await privateDirectory(cwd); await authorize();
          const executable = await resolveCli("codex"); await authorize();
          let names;
          try { names = await resolveMcp(executable, cwd, { onProbe: (probe) => { probes.set(c, probe); } }); }
          finally { const probe = probes.get(c); if (probe) { const result = await dispose(c, probe); if (result.stopped && probes.get(c) === probe) probes.delete(c); if (!result.stopped) throw new Error("The owned Codex configuration probe has not verified exit. No replacement was launched."); } }
          await authorize();
          const owned = clientFactory(executable, cwd, names);
          try { await owned.initialize(); await authorize(); clients.set(c, owned); return owned; }
          catch (e) { await dispose(c, owned); throw e; }
        })(); connecting.set(c, pending);
        void pending.finally(() => { if (connecting.get(c) === pending) connecting.delete(c); }).catch(() => {});
      }
      client = await connecting.get(c);
    }
    await authorize(); return { client, authorize };
  }
  async function use(c, operation) {
    const fence = generation(c), { client, authorize } = await connected(c, fence);
    await authorize(); const result = await operation(client, authorize); await authorize(); return result;
  }
  async function restrictedRoot(client, expectedRoot, authorize) {
    // A different repository may contribute tools/configuration which were not
    // visible in the private startup directory. Metadata reads do not load it.
    // Refuse an unverified effective configuration before creating/resuming a
    // runtime, and repeat the check after the native acknowledgement.
    await authorize();
    const { config } = await client.request("config/read", { cwd: expectedRoot, includeLayers: false });
    assertCodexDesignConfig(config); await authorize();
  }
  async function stopCompartment(c) {
    generations.set(c, generation(c) + 1);
    const probe = probes.get(c); if (probe) { if ((await dispose(c, probe)).stopped && probes.get(c) === probe) probes.delete(c); }
    const client = clients.get(c); if (client) await dispose(c, client);
    await connecting.get(c)?.catch(() => {});
    const pending = clients.get(c) ?? unconfirmed.get(c);
    return pending ? dispose(c, pending) : { stopped: true, evidence: "owned Codex connection exited or never started" };
  }
  return {
    async account(c) {
      return use(c, async (client) => {
        const { account } = await client.request("account/read", { refreshToken: false });
        const identified = account?.type === "chatgpt" && typeof account.email === "string" && account.email.trim() && account.email.length <= 320 && !/[\0\r\n]/.test(account.email);
        return { type: identified ? "chatgpt" : "unavailable", fingerprint: identified ? createHash("sha256").update(JSON.stringify([account.type, account.email.trim().toLowerCase()])).digest("hex") : null, organizationVerified: false };
      });
    },
    async list(c) {
      return use(c, async (client) => { const value = await client.request("thread/list", { limit: 25, sortKey: "recency_at", sourceKinds: ["cli", "vscode", "appServer", "unknown"] }); if (!Array.isArray(value.data) || value.data.length > 25) throw new Error("Codex returned an invalid bounded inventory."); return value.data.map(observed); });
    },
    async read(id, expectedRoot, c) {
      if (!validId(id)) throw new Error("Choose an exact thread identity."); await directoryIdentity(expectedRoot);
      return use(c, async (client) => { const value = await client.request("thread/read", { threadId: id, includeTurns: false }); if (value.thread?.id !== id) throw new Error("Codex returned a different thread."); await exactRoot(value.thread.cwd, expectedRoot); return { ...observed(value.thread), repositoryRoot: expectedRoot }; });
    },
    async start(expectedRoot, taskId, c) {
      if (!validId(taskId)) throw new Error("Choose a bounded task binding identity."); await directoryIdentity(expectedRoot);
      let createdThreadId;
      try {
        return await use(c, async (client, authorize) => {
          await restrictedRoot(client, expectedRoot, authorize);
          const value = await client.request("thread/start", { cwd: expectedRoot, serviceName: "strathex-switchyard", sandbox: "read-only", approvalPolicy: "on-request", config: codexDesignConfig(client.serverNames) });
          if (validId(value.thread?.id)) createdThreadId = value.thread.id;
          if (!createdThreadId || value.cwd !== expectedRoot || value.thread.cwd !== expectedRoot || value.sandbox?.type !== "readOnly" || value.approvalPolicy !== "on-request") throw new Error("The empty Codex thread did not verify its exact identity and read-only permissions.");
          await restrictedRoot(client, expectedRoot, authorize);
          // Persist a local assistant marker without sending a model/user turn.
          await client.request("thread/inject_items", { threadId: createdThreadId, items: [{ type: "message", role: "assistant", content: [{ type: "output_text", text: `Switchyard task binding: ${taskId}. No user request has been submitted. Await the operator's instructions.` }] }] });
          return { threadId: createdThreadId };
        });
      } catch (e) { if (createdThreadId) e.createdThreadId = createdThreadId; throw e; }
    },
    async resume(id, expectedRoot, c) {
      if (!validId(id)) throw new Error("Choose an exact thread identity."); await directoryIdentity(expectedRoot);
      return use(c, async (client, authorize) => {
        await restrictedRoot(client, expectedRoot, authorize);
        const value = await client.request("thread/resume", { threadId: id, excludeTurns: true, cwd: expectedRoot, sandbox: "read-only", approvalPolicy: "on-request", config: codexDesignConfig(client.serverNames) });
        if (value.thread?.id !== id || value.cwd !== expectedRoot || value.sandbox?.type !== "readOnly" || value.approvalPolicy !== "on-request") throw new Error("Codex did not verify the resumed thread and permissions.");
        await exactRoot(value.thread.cwd, expectedRoot);
        await restrictedRoot(client, expectedRoot, authorize);
        return { ...observed(value.thread), repositoryRoot: expectedRoot, permissions: "read-only/on-request", modelPromptSubmitted: false };
      });
    },
    stopCompartment,
    async close() { closed = true; return Promise.all([...new Set([...clients.keys(), ...connecting.keys(), ...unconfirmed.keys(), ...probes.keys()])].map(stopCompartment)); }
  };
}
