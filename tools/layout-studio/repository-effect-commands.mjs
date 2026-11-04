/** Host-only Git transport. No HTTP, SDK or provider payload can select argv. */
import { createHash } from "node:crypto";
import { lstat, mkdtemp, rm } from "node:fs/promises";
import { join, relative, isAbsolute, sep } from "node:path";
import { privateDirectory, directoryIdentity } from "./private-fs.mjs";
import { verifyRepositoryIdentity } from "./coding-task-identity.mjs";
import { fixedGitExecutable, inspectionEnvironment } from "./repository-inspection.mjs";
import { runOwnedNativeCommand } from "./owned-native-command.mjs";
import { runRuntimeCommand, runtimeGuardianStopped } from "./runtime-command.mjs";
import { captureGitFile } from "../../apps/windows-companion/src/git-index-lease.ts";
const digest = v => createHash("sha256").update(JSON.stringify(v)).digest("hex");
const operationHash = v => createHash("sha256").update(v).digest("hex");
const uuid = v => typeof v === "string" && /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/.test(v);
const identity = s => ({ device: s.dev.toString(), inode: s.ino.toString() });
const same = (a, b) => a.device === b.device && a.inode === b.inode;
const inside = (root, name) => { const r = relative(root, name); return r && !isAbsolute(r) && r !== ".." && !r.startsWith(`..${sep}`); };
const verbs = new Set(["rev-parse", "remote", "branch", "symbolic-ref", "write-tree", "ls-files", "submodule", "read-tree", "diff", "hash-object", "update-index", "commit-tree", "update-ref", "show-ref"]);
export function createRepositoryEffectCommands({ store, stateDirectory, command = runRuntimeCommand, guardianStopped = runtimeGuardianStopped, resolveGit = fixedGitExecutable, now = Date.now } = {}) {
  const resources = new Map(), generations = new Map(), seen = new Set(); let closed = false;
  async function update(c, id, action, fn) {
    return store.update(c, action, s => { const record = s.repositoryEffects?.find(r => r.id === id); if (!record) throw new Error("The protected repository effect identity is unavailable."); return fn(record); });
  }
  async function stopCompartment(c) {
    seen.add(c);
    generations.set(c, (generations.get(c) ?? 0) + 1);
    const current = [...(resources.get(c) ?? [])]; current.forEach(r => r.controller.abort());
    const stopped = await Promise.all(current.flatMap(r => [...r.clients].map(p => p.stop().catch(() => false))));
    let retainedStopped = true;
    for (const record of (await store.snapshot(c)).repositoryEffects ?? []) for (const native of record.commands) if (!native.stoppedVerified) {
      if (!await guardianStopped(native.ownedRuntime)) { retainedStopped = false; continue; }
      await update(c, record.id, "repository-effect-stop-readback", r => { const n = r.commands.find(n => n.ownedRuntime.id === native.ownedRuntime.id); if (!n) throw new Error("The retained Git guardian ownership record changed."); n.stoppedVerified = true; });
    }
    if (stopped.every(Boolean) && retainedStopped) { for (const r of current) if ([...r.clients].every(p => p.closed)) resources.get(c)?.delete(r); if (!resources.get(c)?.size) resources.delete(c); }
    return { stopped: stopped.every(Boolean) && retainedStopped };
  }
  return {
    async execute(c, { task, operationId, bindingDigest, author, authorize }, fn) {
      seen.add(c);
      if (!uuid(operationId) || !/^[a-f0-9]{64}$/.test(bindingDigest ?? "") || typeof authorize !== "function" || typeof fn !== "function") throw new Error("Use one protected host effect binding and operation UUID.");
      if (!author || typeof author.name !== "string" || !author.name.trim() || author.name !== author.name.trim() || Buffer.from(author.name).toString("utf8") !== author.name || author.name.length > 200 || /[<>\x00-\x1f\x7f]/.test(author.name) || typeof author.email !== "string" || author.email.length > 254 || !/^[A-Za-z0-9.!#$%&'*+\/=?^_`{|}~-]+@[A-Za-z0-9.-]+$/.test(author.email)) throw new Error("Review the exact local commit author name and email.");
      if (typeof store.withResourceLock !== "function") throw new Error("Repository effects require the protected cross-process resource lease.");
      const generation = generations.get(c) ?? 0, resource = { controller: new AbortController(), clients: new Set() };
      const check = async () => { if (closed || resource.controller.signal.aborted || generation !== (generations.get(c) ?? 0)) throw new Error("This repository effect was stopped."); await authorize(); await store.authorize(c, { provider: task.provider }); await verifyRepositoryIdentity(task); };
      await check();
      return store.withResourceLock("repository-effects", JSON.stringify(task.repositoryIdentity), async lease => {
        const current = resources.get(c) ?? new Set(); current.add(resource); resources.set(c, current);
        let scratch, scratchIdentity, recordStarted = false, outcome;
        const checked = async () => { lease.assert(); await check(); };
        try {
          await checked(); await privateDirectory(stateDirectory);
          const gitDirectory = join(task.repositoryRoot, ".git"), gitIdentity = identity(await directoryIdentity(gitDirectory));
          try { await lstat(join(gitDirectory, "commondir")); throw new Error("Linked Git common directories are not supported by this effect transport."); } catch (e) { if (e.code !== "ENOENT") throw e; }
          const old = (await store.snapshot(c)).repositoryEffects ?? [];
          for (const record of old) if (record.status !== "settled") {
            for (const native of record.commands) if (!native.stoppedVerified) {
              if (!await guardianStopped(native.ownedRuntime)) throw new Error("A retained Git guardian has not independently verified exit. Its recovery state was preserved.");
              await update(c, record.id, "repository-effect-observed-exit", r => { const n = r.commands.find(n => n.ownedRuntime.id === native.ownedRuntime.id); if (!n) throw new Error("The exact Git guardian record changed."); n.stoppedVerified = true; });
            }
            throw new Error("A previous repository effect needs explicit no-replay reconciliation before another effect can start.");
          }
          if (old.some(r => r.id === operationId)) throw new Error("This repository effect operation already exists and cannot be replayed.");
          const scratchRoot = join(stateDirectory, "native-scratch"); await privateDirectory(scratchRoot);
          scratch = await mkdtemp(join(scratchRoot, "git-")); scratchIdentity = identity(await directoryIdentity(scratch));
          await store.update(c, "repository-effect-reserve", s => {
            s.repositoryEffects = (s.repositoryEffects ?? []).filter(r => r.status !== "settled" || r.cleanupPending).concat((s.repositoryEffects ?? []).filter(r => r.status === "settled" && !r.cleanupPending).slice(-7));
            if (s.repositoryEffects.length >= 32) throw new Error("The repository effect inventory is full. Existing recovery records were preserved.");
            s.repositoryEffects.push({ schema: "switchyard-repository-effect/v1", id: operationId, taskId: task.id, provider: task.provider, bindingDigest, repositoryRoot: task.repositoryRoot, repositoryIdentity: task.repositoryIdentity, gitDirectory, gitIdentity, author: structuredClone(author), scratch, scratchIdentity, commands: [], status: "reserved", at: now() });
          }, { provider: task.provider }); recordStarted = true;
          const executable = await resolveGit(); let count = 0; const started = now();
          const runner = { run: async (args, options) => {
            await checked();
            if (options.cwd !== task.repositoryRoot || ++count > 128 || now() - started > 120000 || !Array.isArray(args) || args.some(a => typeof a !== "string" || a.includes("\0"))) throw new Error("The exact Git effect command exceeds its root or native bounds.");
            let offset = args[0] === "--literal-pathspecs" ? 1 : 0;
            while (args[offset] === "-c") { const config = args[offset + 1]; if (config !== "commit.gpgSign=false" && !(config?.startsWith("core.hooksPath=") && inside(join(stateDirectory, "git-operations", operationHash(operationId)), config.slice(15)))) throw new Error("Unreviewed Git configuration cannot enter this native effect."); offset += 2; }
            if (!verbs.has(args[offset])) throw new Error("This host transport does not admit that Git command.");
            const environment = options.environment ?? {};
            if (Object.keys(environment).some(k => k !== "GIT_INDEX_FILE") || environment.GIT_INDEX_FILE !== undefined && !inside(join(stateDirectory, "git-operations", operationHash(operationId)), environment.GIT_INDEX_FILE)) throw new Error("Only this exact operation's private Git index is supported.");
            if (!same(identity(await directoryIdentity(gitDirectory)), gitIdentity)) throw new Error("The original Git metadata directory changed. Preserve this effect for recovery.");
            let readyPersisted = false;
            const result = await runOwnedNativeCommand({ executable, args: ["--no-pager", "-c", "core.fsmonitor=false", "-c", "core.untrackedCache=false", "-c", "protocol.allow=never", "-c", `user.name=${author.name}`, "-c", `user.email=${author.email}`, ...args], cwd: task.repositoryRoot,
              env: { ...inspectionEnvironment(scratch), GIT_DIR: gitDirectory, GIT_WORK_TREE: task.repositoryRoot, ...environment }, bytes: options.input, timeout: 10000, maxOutputBytes: 262144, captureStderrBytes: 4096, signal: resource.controller.signal, resource, command, guardianStopped,
              onReady: async scope => { await checked(); await update(c, operationId, "repository-effect-native-ready", r => { r.status = "executing"; r.commands.push({ argvDigest: digest(args), ownedRuntime: scope, stoppedVerified: false, at: now(), ...(args[offset] === "update-ref" ? { referenceIntent: { arguments: args.slice(offset), ...(options.input ? { stdinBase64: Buffer.from(options.input).toString("base64") } : {}) } } : {}) }); }); readyPersisted = true; await checked(); },
              onStopped: async scope => { if (!await guardianStopped(scope)) throw Object.assign(new Error("The exact Git guardian has not independently verified exit."), { code: "RUNTIME_STOP_UNCONFIRMED" }); if (!readyPersisted) return; await update(c, operationId, "repository-effect-native-exit", r => { const n = r.commands.find(n => n.ownedRuntime.id === scope.id); if (!n) throw new Error("The exact Git guardian ownership record is unavailable."); n.stoppedVerified = true; }); }
            }).catch(error => { throw Object.assign(new Error("The owned Git command did not settle with durable exit proof."), { code: readyPersisted ? "RUNTIME_STOP_UNCONFIRMED" : "RUNTIME_COMMAND_NOT_STARTED", cause: error }); });
            await checked();
            if (!["completed", "failed"].includes(result.status) || !Number.isInteger(result.exitCode)) throw new Error("The native Git command did not produce one exact terminal result.");
            return { exitCode: result.exitCode, stdout: result.stdout, stderr: result.exitCode ? "Native Git command rejected the reviewed effect" : "" };
          } };
          outcome = await fn({ runner, stateDirectory, onPreservation: async value => {
            if (value.operationId !== operationId || value.repositoryRoot !== task.repositoryRoot) throw new Error("Preservation belongs to a different repository effect.");
            let privateIndexProof;
            if (value.privateIndex) {
              if (!inside(join(stateDirectory, "git-operations", operationHash(operationId)), value.privateIndex)) throw new Error("The preserved private index belongs to another operation.");
              const captured = await captureGitFile(value.privateIndex);
              try { privateIndexProof = { identity: captured.identity, sha256: captured.sha256 }; } finally { captured.bytes.fill(0); }
            }
            if (!inside(join(stateDirectory, "git-operations", operationHash(operationId)), value.privateIndexCopy)) throw new Error("The preserved inspection index belongs to another operation.");
            const copy = await captureGitFile(value.privateIndexCopy); let privateIndexCopyProof;
            try { privateIndexCopyProof = { identity: copy.identity, sha256: copy.sha256 }; } finally { copy.bytes.fill(0); }
            await update(c, operationId, "repository-effect-preservation", r => { r.preservation = { ...structuredClone(value), privateIndexCopyProof, ...(privateIndexProof ? { privateIndexProof } : {}) }; });
          } });
          if (!outcome || !["completed", "failed", "blocked", "unavailable", "incomplete", "cancelled", "running"].includes(outcome.status) || !["not_started", "committed", "ambiguous", "compensated"].includes(outcome.effectDisposition)) throw new Error("The host Git effect did not return one typed effect disposition.");
          lease.assert();
          return outcome;
        } finally {
          const stops = await Promise.all([...resource.clients].map(p => p.stop().catch(() => false)));
          if (stops.every(Boolean)) { current.delete(resource); if (!current.size) resources.delete(c); }
          const settled = stops.every(Boolean) && outcome && outcome.effectDisposition !== "ambiguous" && outcome.data?.recoveryStatePreserved !== true && !(outcome.effectDisposition === "committed" && outcome.status !== "completed");
          if (recordStarted) await update(c, operationId, "repository-effect-result", r => { r.status = settled ? "settled" : "recovery-required"; r.outcome = outcome ? structuredClone(outcome) : { status: "incomplete", effectDisposition: "ambiguous", summary: "The host effect did not settle. No automatic replay is permitted." }; r.finishedAt = now(); });
          if (scratch && (settled || !recordStarted)) { if (!same(identity(await directoryIdentity(scratch)), scratchIdentity)) throw new Error("The native scratch ownership changed. Preserve it for recovery."); await rm(scratch, { recursive: true }); }
        }
      });
    },
    stopCompartment,
    async close() { closed = true; const results = await Promise.all([...new Set([...seen, ...resources.keys()])].map(stopCompartment)); if (results.some(r => !r.stopped)) throw new Error("A repository effect guardian still needs independent exit verification."); }
  };
}
