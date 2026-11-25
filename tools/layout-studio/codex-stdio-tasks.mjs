/** Owned app-server task metadata; no model turns or shell requests. */
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
  const clients = new Map(), connecting = new Map(), constructing = new Map(), generations = new Map(), unconfirmed = new Map(), probes = new Map(); let closed = false;
  const generation = (c) => generations.get(c) ?? 0;
  async function dispose(c, client) {
    unconfirmed.set(c, client); client.close();
    const result = typeof client.stop === "function" ? await client.stop() : await stopChild(client.child);
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
          try { names = await resolveMcp(executable, cwd, { authorize, compartment: c, onProbe: (probe) => { probes.set(c, probe); } }); }
          finally { const probe = probes.get(c); if (probe) { const result = await dispose(c, probe); if (result.stopped && probes.get(c) === probe) probes.delete(c); if (!result.stopped) throw new Error("The owned Codex configuration probe has not verified exit. No replacement was launched."); } }
          await authorize();
          let owned;
          const onClient = value => {
            if (owned && owned !== value) throw new Error("An owned task factory cannot replace its registered client.");
            owned = value; constructing.set(c, owned);
            try { current(); } catch (error) { owned.close(); throw error; }
          };
          try {
            const created = await clientFactory(executable, cwd, names, { compartment: c, authorize, onClient });
            onClient(created); await authorize(); await owned.initialize(); await authorize(); clients.set(c, owned); return owned;
          }
          catch (e) { if (owned) await dispose(c, owned); throw e; }
          finally { if (constructing.get(c) === owned) constructing.delete(c); }
        })(); connecting.set(c, pending);
        void pending.finally(() => { if (connecting.get(c) === pending) connecting.delete(c); }).catch(() => {});
      }
      client = await connecting.get(c);
    }
    await authorize(); return { client, authorize };
  }
  async function use(c, operation) {
    const fence = generation(c), { client, authorize } = await connected(c, fence);
    const epoch = client.accountEpoch ?? 0;
    await authorize(); const result = await operation(client, authorize); await authorize();
    if (client.closed || (client.accountEpoch ?? 0) !== epoch) throw client.closeReason ?? Object.assign(new Error("The exact native Codex account connection changed during metadata access."), { code: "ACCOUNT_UNCONFIRMED" });
    return result;
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
    const starting = constructing.get(c); if (starting) await dispose(c, starting);
    const client = clients.get(c); if (client) await dispose(c, client);
    await connecting.get(c)?.catch(() => {});
    const pending = clients.get(c) ?? unconfirmed.get(c);
    return pending ? dispose(c, pending) : { stopped: true, evidence: "owned Codex connection exited or never started" };
  }
  return {
    async account(c) {
      return use(c, async (client) => {
        const fingerprint = await client.recheckAccount();
        return { type: "chatgpt", fingerprint, organizationVerified: false };
      });
    },
    async list(c) {
      return use(c, async (client) => { const value = await client.request("thread/list", { limit: 25, sortKey: "recency_at", sourceKinds: ["cli", "vscode", "appServer", "unknown"] }); if (!Array.isArray(value.data) || value.data.length > 25) throw new Error("Codex returned an invalid bounded inventory."); return value.data.map(observed); });
    },
    async read(id, expectedRoot, c) {
      if (!validId(id)) throw new Error("Choose an exact thread identity."); await directoryIdentity(expectedRoot);
      return use(c, async (client) => { const value = await client.request("thread/read", { threadId: id, includeTurns: false }); if (value.thread?.id !== id) throw new Error("Codex returned a different thread."); await exactRoot(value.thread.cwd, expectedRoot); return { ...observed(value.thread), repositoryRoot: expectedRoot }; });
    },
    async start(expectedRoot, taskId, c, { beforeEffect = async () => {} } = {}) {
      if (typeof beforeEffect !== "function") throw new Error("An owned task needs a callable effect boundary.");
      if (!validId(taskId)) throw new Error("Choose a bounded task binding identity."); await directoryIdentity(expectedRoot);
      let createdThreadId;
      try {
        return await use(c, async (client, authorize) => {
          await restrictedRoot(client, expectedRoot, authorize);
          await beforeEffect(); await authorize();
          const value = await client.request("thread/start", { cwd: expectedRoot, serviceName: "strathex-switchyard", sandbox: "read-only", approvalPolicy: "on-request", config: codexDesignConfig(client.serverNames) });
          if (validId(value.thread?.id)) createdThreadId = value.thread.id;
          if (!createdThreadId || value.cwd !== expectedRoot || value.thread.cwd !== expectedRoot || value.sandbox?.type !== "readOnly" || value.approvalPolicy !== "on-request") throw new Error("The empty Codex thread did not verify its exact identity and read-only permissions.");
          await restrictedRoot(client, expectedRoot, authorize);
          await beforeEffect(); await authorize();
          // Persist a local assistant marker without sending a model/user turn.
          await client.request("thread/inject_items", { threadId: createdThreadId, items: [{ type: "message", role: "assistant", content: [{ type: "output_text", text: `Switchyard task binding: ${taskId}. No user request has been submitted. Await the operator's instructions.` }] }] });
          return { threadId: createdThreadId };
        });
      } catch (e) { if (createdThreadId) e.createdThreadId = createdThreadId; throw e; }
    },
    async resume(id, expectedRoot, c, { beforeEffect = async () => {} } = {}) {
      if (typeof beforeEffect !== "function") throw new Error("An owned task needs a callable effect boundary.");
      if (!validId(id)) throw new Error("Choose an exact thread identity."); await directoryIdentity(expectedRoot);
      let acknowledged = false;
      try {
        return await use(c, async (client, authorize) => {
          await restrictedRoot(client, expectedRoot, authorize);
          await beforeEffect(); await authorize();
          const value = await client.request("thread/resume", { threadId: id, excludeTurns: true, cwd: expectedRoot, sandbox: "read-only", approvalPolicy: "on-request", config: codexDesignConfig(client.serverNames) });
          if (value.thread?.id === id) acknowledged = true;
          if (value.thread?.id !== id || value.cwd !== expectedRoot || value.sandbox?.type !== "readOnly" || value.approvalPolicy !== "on-request") throw new Error("Codex did not verify the resumed thread and permissions.");
          await exactRoot(value.thread.cwd, expectedRoot);
          await restrictedRoot(client, expectedRoot, authorize);
          await beforeEffect(); await authorize();
          return { ...observed(value.thread), repositoryRoot: expectedRoot, permissions: "read-only/on-request", modelPromptSubmitted: false };
        });
      } catch (error) { if (acknowledged) error.resumedThreadId = id; throw error; }
    },
    stopCompartment,
    async close() { closed = true; return Promise.all([...new Set([...clients.keys(), ...connecting.keys(), ...constructing.keys(), ...unconfirmed.keys(), ...probes.keys()])].map(stopCompartment)); }
  };
}
