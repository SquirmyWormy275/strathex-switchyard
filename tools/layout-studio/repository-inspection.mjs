/** Fixed read-only Git queries through owned native guardians; no repository scripts. */
import { realpath, stat, lstat, mkdtemp, rm } from "node:fs/promises";
import { join, dirname, basename, resolve } from "node:path";
import { homedir } from "node:os";
import { privateDirectory, directoryIdentity } from "./private-fs.mjs";
import { GitCliInspector, NodeFileDigestReader } from "../../packages/control-plane/src/git-inspector.ts";
import { TargetSnapshotFactory } from "../../packages/control-plane/src/snapshot.ts";
import { runOwnedNativeCommand } from "./owned-native-command.mjs";
import { runRuntimeCommand, runtimeGuardianStopped } from "./runtime-command.mjs";
import { verifyRepositoryIdentity } from "./coding-task-identity.mjs";

const queries = new Set([
  ["rev-parse", "--show-toplevel"], ["remote", "get-url", "origin"], ["branch", "--show-current"],
  ["symbolic-ref", "--quiet", "--short", "refs/remotes/origin/HEAD"],
  ["rev-parse", "--abbrev-ref", "--symbolic-full-name", "@{upstream}"], ["rev-parse", "HEAD"],
  ["write-tree"], ["rev-parse", "HEAD^{tree}"], ["rev-parse", "--absolute-git-dir"], ["rev-parse", "--git-path", "index"], ["ls-files", "-z"], ["ls-files", "--deleted", "-z"],
  ["ls-files", "--others", "--exclude-standard", "-z"],
  ["ls-files", "--others", "--ignored", "--exclude-standard", "-z"],
  ["submodule", "status", "--recursive"]
].map(v => JSON.stringify(v)));
export async function fixedGitExecutable() {
  for (const name of process.platform === "win32" ? ["C:\\Program Files\\Git\\cmd\\git.exe", "C:\\Program Files\\Git\\bin\\git.exe"] : ["/usr/bin/git"]) {
    try { if ((await stat(name)).isFile()) return realpath(name); } catch (e) { if (e.code !== "ENOENT") throw e; }
  }
  throw new Error("A fixed native Git installation is unavailable.");
}
export function inspectionEnvironment(scratch) {
  const windows = process.platform === "win32", system = process.env.SystemRoot || "C:\\Windows";
  return { ...(windows ? { SystemRoot: system, WINDIR: system, PATH: `${system}\\System32`, GIT_CONFIG_GLOBAL: "NUL" } : { PATH: "/usr/bin:/bin", HOME: "/nonexistent", GIT_CONFIG_GLOBAL: "/dev/null" }),
    GIT_CONFIG_NOSYSTEM: "1", GIT_OPTIONAL_LOCKS: "0", GIT_NO_REPLACE_OBJECTS: "1", GIT_TERMINAL_PROMPT: "0", GCM_INTERACTIVE: "Never", GIT_ALLOW_PROTOCOL: "", LC_ALL: "C", ...(scratch ? { TMPDIR: scratch, TMP: scratch, TEMP: scratch } : {}) };
}
function safeRemote(value) {
  if (!value) return;
  // A target must never expose credentials embedded in Git's configured URL.
  if (/^git@[A-Za-z0-9.-]+:[A-Za-z0-9_./-]+$/.test(value)) return value;
  try { const u = new URL(value); if (["https:", "ssh:"].includes(u.protocol) && !u.password && (!u.username || u.protocol === "ssh:" && u.username === "git") && !u.search && !u.hash) return value; } catch { /* local/opaque remotes are not consequential identities */ }
  throw new Error("Use a credential-free HTTPS or SSH origin before reviewing task authority.");
}
export function createRepositoryInspection({ store, command = runRuntimeCommand, guardianStopped = runtimeGuardianStopped, resolveGit = fixedGitExecutable, now = () => Date.now(), runtimeRoot = join(process.env.XDG_RUNTIME_DIR || process.env.LOCALAPPDATA || join(homedir(), ".local/state"), "switchyard-repository-probes") } = {}) {
  const running = new Map(), generations = new Map(), seen = new Set(); let closed = false;
  async function removeScratch(path, identity) {
    if (!path) return;
    if (dirname(path) !== runtimeRoot || !/^probe-[A-Za-z0-9]{6}$/.test(basename(path)) || !identity) throw new Error("Preserve repository scratch with an unrecognized ownership record.");
    let current; try { current = await directoryIdentity(path); } catch (e) { if (e.code === "ENOENT") return; throw e; }
    if (current.dev.toString() !== identity.device || current.ino.toString() !== identity.inode) throw new Error("The owned repository scratch directory changed; preserve it for recovery.");
    await rm(path, { recursive: true });
  }
  async function stopCompartment(c) {
    generations.set(c, (generations.get(c) ?? 0) + 1);
    const resources = [...(running.get(c) ?? [])]; resources.forEach(r => r.controller.abort());
    const stops = await Promise.all(resources.flatMap(r => [...r.clients].map(client => client.stop().catch(() => false))));
    return { stopped: stops.every(Boolean) };
  }
  return {
    async observe(c, task, authorize = async () => {}) { return this.capture(c, task, {}, authorize, { metadataOnly: true }); },
    async capture(c, task, classifications, authorize = async () => {}, { metadataOnly = false } = {}) {
      const generation = generations.get(c) ?? 0, resource = { controller: new AbortController(), clients: new Set() }; seen.add(c);
      const check = async () => { if (closed || generation !== (generations.get(c) ?? 0) || resource.controller.signal.aborted) throw new Error("Repository inspection was stopped."); await authorize(); };
      await check(); await store.authorize(c, { provider: task.provider }); await verifyRepositoryIdentity(task);
      // A restarted process must independently settle every retained guardian first.
      for (const record of (await store.snapshot(c)).repositoryProbes ?? []) if (record.stoppedVerified !== true) {
        if (!await guardianStopped(record.ownedRuntime)) throw new Error("A previous repository guardian has not verified exit. Its protected identity was preserved.");
        await removeScratch(record.scratch, record.scratchIdentity);
        await store.update(c, "repository-probe-reconcile", s => { const current = s.repositoryProbes?.find(p => p.ownedRuntime.id === record.ownedRuntime.id); if (current) current.stoppedVerified = true; });
      }
      await check(); const executable = await resolveGit(); await check();
      const members = running.get(c) ?? new Set(); members.add(resource); running.set(c, members);
      let fileCount = 0, totalBytes = 0, scratch, scratchIdentity;
      const digests = new NodeFileDigestReader({ maxFileBytes: 4 * 1024 * 1024 });
      const digestReader = {
        async digest(root, path) {
          await check(); if (++fileCount > 4096 || path.includes("\\")) throw new Error("Repository manifest exceeds its supported bound or contains an ambiguous path.");
          totalBytes += Number((await lstat(join(root, path))).size);
          if (!Number.isSafeInteger(totalBytes) || totalBytes > 64 * 1024 * 1024) throw new Error("Repository digest budget exceeded.");
          const result = await digests.digest(root, path); await check(); return result;
        },
        async state(root, path) { await check(); if (++fileCount > 4096 || path.includes("\\")) throw new Error("Repository manifest is unsupported."); return digests.state(root, path); }
      };
      const start = now();
      const runner = { async run(args, cwd = task.repositoryRoot) {
        await check(); if (now() - start > 45000 || !queries.has(JSON.stringify(args)) || cwd !== task.repositoryRoot) throw new Error("Only bounded exact-root Git inspection queries are permitted.");
        const result = await runOwnedNativeCommand({ executable, args: ["--no-pager", "-c", "core.fsmonitor=false", "-c", "core.untrackedCache=false", "-c", "protocol.allow=never", ...args], cwd,
          env: inspectionEnvironment(scratch), timeout: 10000, maxOutputBytes: 262144, captureStderrBytes: 4096, signal: resource.controller.signal, resource, command, guardianStopped,
          onReady: async scope => { await check(); await store.update(c, "repository-probe-ready", s => { s.repositoryProbes = (s.repositoryProbes ?? []).filter(p => !p.stoppedVerified).concat((s.repositoryProbes ?? []).filter(p => p.stoppedVerified).slice(-7)); if (s.repositoryProbes.length >= 16) throw new Error("Unsettled repository guardians require reconciliation."); s.repositoryProbes.push({ taskId: task.id, ownedRuntime: scope, stoppedVerified: false, scratch, scratchIdentity: { device: scratchIdentity.dev.toString(), inode: scratchIdentity.ino.toString() }, at: now() }); }, { provider: task.provider }); await check(); },
          onStopped: async scope => { await store.update(c, "repository-probe-exit", s => { const p = s.repositoryProbes?.find(p => p.ownedRuntime.id === scope.id); if (!p) throw new Error("The exact repository guardian record is unavailable."); p.stoppedVerified = true; }); }
        });
        await check();
        if (!["completed", "failed"].includes(result.status) || !Number.isSafeInteger(result.exitCode)) throw new Error("The repository query did not settle within its native bounds.");
        // Query diagnostics are never returned as credentials or authority material.
        let stdout = result.stdout;
        if (result.exitCode === 0 && JSON.stringify(args) === JSON.stringify(["rev-parse", "--show-toplevel"])) {
          // Native Git prints '/' on Windows; compare actual directory identity
          // through realpath before using one canonical spelling in later queries.
          const canonical = await realpath(stdout.trim());
          if (canonical !== await realpath(task.repositoryRoot)) throw new Error("Git reported a different repository root.");
          stdout = canonical + "\n";
        }
        return { exitCode: result.exitCode, stdout, stderr: result.exitCode ? "Native Git query unavailable" : "" };
      } };
      try {
        await privateDirectory(runtimeRoot); scratch = await mkdtemp(join(runtimeRoot, "probe-")); scratchIdentity = await directoryIdentity(scratch);
        if (metadataOnly) {
          const names = ["root", "branch", "head", "headTree", "gitDirectory", "indexPath"], fixed = [["rev-parse", "--show-toplevel"], ["branch", "--show-current"], ["rev-parse", "HEAD"], ["rev-parse", "HEAD^{tree}"], ["rev-parse", "--absolute-git-dir"], ["rev-parse", "--git-path", "index"]];
          const values = [];
          // Sequential probes keep their shared scratch alive until each exact
          // guardian has exited, and remain inside the same 45-second budget.
          for (const args of fixed) { const result = await runner.run(args); if (result.exitCode !== 0) throw new Error("The fixed repository recovery metadata is unavailable."); values.push(result.stdout.trim()); }
          const observed = Object.fromEntries(names.map((name, i) => [name, values[i]]));
          if (!/^(?:[a-f0-9]{40}|[a-f0-9]{64})$/.test(observed.head) || !/^(?:[a-f0-9]{40}|[a-f0-9]{64})$/.test(observed.headTree)) throw new Error("Repository recovery metadata contains an invalid object identity.");
          observed.gitDirectory = await realpath(observed.gitDirectory); observed.indexPath = resolve(task.repositoryRoot, observed.indexPath);
          await check(); await verifyRepositoryIdentity(task); return observed;
        }
        const included = new Set(classifications.includedUntracked), excluded = new Set(classifications.excludedUntracked), ignored = new Set(classifications.excludedIgnored);
        let inspection;
        const inspector = new GitCliInspector({ runner, digestReader, classifyUntracked: p => included.has(p) ? "included" : excluded.has(p) ? "excluded" : "unknown", classifyIgnored: p => ignored.has(p) ? "excluded" : "unknown" });
        const factory = new TargetSnapshotFactory({ async inspect(root) { inspection = await inspector.inspect(root); inspection.canonicalRemote = safeRemote(inspection.canonicalRemote); return inspection; } }, { clock: () => new Date(now()).toISOString() });
        const snapshot = await factory.capture({ targetHint: task.repositoryRoot, policyVersion: "switchyard-task-local-authority/v1", environment: { toolVersions: { node: process.versions.node }, values: { gitContract: "fixed-read-only-guardian/v1" } } });
        await check(); await verifyRepositoryIdentity(task);
        if (snapshot.repositoryRoot !== task.repositoryRoot) throw new Error("Git did not verify the exact bound repository root.");
        return { snapshot, files: { tracked: inspection?.trackedFiles ?? [], untracked: inspection?.untrackedFiles ?? [], ignored: inspection?.ignoredFiles ?? [] } };
      } finally {
        const stops = await Promise.all([...resource.clients].map(client => client.stop().catch(() => false)));
        members.delete(resource); if (!members.size) running.delete(c);
        if (!stops.every(Boolean)) throw new Error("Owned repository guardian exit is unconfirmed; protected recovery state and scratch were retained.");
        if (scratch) {
          await removeScratch(scratch, scratchIdentity && { device: scratchIdentity.dev.toString(), inode: scratchIdentity.ino.toString() });
        }
      }
    },
    stopCompartment,
    async close() { closed = true; const result = await Promise.all([...seen].map(stopCompartment)); if (result.some(r => !r.stopped)) throw new Error("A repository inspection guardian has not verified exit."); }
  };
}
