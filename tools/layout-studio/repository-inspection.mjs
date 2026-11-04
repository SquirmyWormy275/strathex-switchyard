/** Fixed read-only Git queries through owned native guardians; no repository scripts. */
import { realpath, stat, lstat } from "node:fs/promises";
import { join } from "node:path";
import { GitCliInspector, NodeFileDigestReader } from "../../packages/control-plane/src/git-inspector.ts";
import { TargetSnapshotFactory } from "../../packages/control-plane/src/snapshot.ts";
import { runOwnedNativeCommand } from "./owned-native-command.mjs";
import { runRuntimeCommand, runtimeGuardianStopped } from "./runtime-command.mjs";
import { verifyRepositoryIdentity } from "./coding-task-identity.mjs";

const queries = new Set([
  ["rev-parse", "--show-toplevel"], ["remote", "get-url", "origin"], ["branch", "--show-current"],
  ["symbolic-ref", "--quiet", "--short", "refs/remotes/origin/HEAD"],
  ["rev-parse", "--abbrev-ref", "--symbolic-full-name", "@{upstream}"], ["rev-parse", "HEAD"],
  ["write-tree"], ["ls-files", "-z"], ["ls-files", "--deleted", "-z"],
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
export function inspectionEnvironment() {
  const windows = process.platform === "win32", system = process.env.SystemRoot || "C:\\Windows";
  return { ...(windows ? { SystemRoot: system, WINDIR: system, PATH: `${system}\\System32`, GIT_CONFIG_GLOBAL: "NUL" } : { PATH: "/usr/bin:/bin", HOME: "/nonexistent", GIT_CONFIG_GLOBAL: "/dev/null" }),
    GIT_CONFIG_NOSYSTEM: "1", GIT_OPTIONAL_LOCKS: "0", GIT_TERMINAL_PROMPT: "0", GCM_INTERACTIVE: "Never", GIT_ALLOW_PROTOCOL: "", LC_ALL: "C" };
}
function safeRemote(value) {
  if (!value) return;
  // A target must never expose credentials embedded in Git's configured URL.
  if (/^git@[A-Za-z0-9.-]+:[A-Za-z0-9_./-]+$/.test(value)) return value;
  try { const u = new URL(value); if (["https:", "ssh:"].includes(u.protocol) && !u.password && (!u.username || u.protocol === "ssh:" && u.username === "git") && !u.search && !u.hash) return value; } catch { /* local/opaque remotes are not consequential identities */ }
  throw new Error("Use a credential-free HTTPS or SSH origin before reviewing task authority.");
}
export function createRepositoryInspection({ store, command = runRuntimeCommand, guardianStopped = runtimeGuardianStopped, resolveGit = fixedGitExecutable, now = () => Date.now() } = {}) {
  const running = new Map(), generations = new Map(), seen = new Set(); let closed = false;
  async function stopCompartment(c) {
    generations.set(c, (generations.get(c) ?? 0) + 1);
    const resources = [...(running.get(c) ?? [])]; resources.forEach(r => r.controller.abort());
    const stops = await Promise.all(resources.flatMap(r => [...r.clients].map(client => client.stop().catch(() => false))));
    return { stopped: stops.every(Boolean) };
  }
  return {
    async capture(c, task, classifications, authorize = async () => {}) {
      const generation = generations.get(c) ?? 0, resource = { controller: new AbortController(), clients: new Set() }; seen.add(c);
      const check = async () => { if (closed || generation !== (generations.get(c) ?? 0) || resource.controller.signal.aborted) throw new Error("Repository inspection was stopped."); await authorize(); };
      await check(); await store.authorize(c, { provider: task.provider }); await verifyRepositoryIdentity(task);
      // A restarted process must independently settle every retained guardian first.
      for (const record of (await store.snapshot(c)).repositoryProbes ?? []) if (record.stoppedVerified !== true) {
        if (!await guardianStopped(record.ownedRuntime)) throw new Error("A previous repository guardian has not verified exit. Its protected identity was preserved.");
        await store.update(c, "repository-probe-reconcile", s => { const current = s.repositoryProbes?.find(p => p.ownedRuntime.id === record.ownedRuntime.id); if (current) current.stoppedVerified = true; });
      }
      await check(); const executable = await resolveGit(); await check();
      const members = running.get(c) ?? new Set(); members.add(resource); running.set(c, members);
      let fileCount = 0, totalBytes = 0;
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
          env: inspectionEnvironment(), timeout: 10000, maxOutputBytes: 262144, captureStderrBytes: 4096, signal: resource.controller.signal, resource, command, guardianStopped,
          onReady: async scope => { await check(); await store.update(c, "repository-probe-ready", s => { s.repositoryProbes = (s.repositoryProbes ?? []).filter(p => !p.stoppedVerified).concat((s.repositoryProbes ?? []).filter(p => p.stoppedVerified).slice(-7)); if (s.repositoryProbes.length >= 16) throw new Error("Unsettled repository guardians require reconciliation."); s.repositoryProbes.push({ taskId: task.id, ownedRuntime: scope, stoppedVerified: false, at: now() }); }, { provider: task.provider }); await check(); },
          onStopped: async scope => { await store.update(c, "repository-probe-exit", s => { const p = s.repositoryProbes?.find(p => p.ownedRuntime.id === scope.id); if (!p) throw new Error("The exact repository guardian record is unavailable."); p.stoppedVerified = true; }); }
        });
        await check();
        if (result.status !== "completed") throw new Error("The repository query did not complete within its native bounds.");
        // Query diagnostics are never returned as credentials or authority material.
        return { exitCode: result.exitCode, stdout: result.stdout, stderr: result.exitCode ? "Native Git query unavailable" : "" };
      } };
      try {
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
        if (!stops.every(Boolean)) throw new Error("Owned repository guardian exit is unconfirmed; protected recovery state was retained.");
      }
    },
    stopCompartment,
    async close() { closed = true; const result = await Promise.all([...seen].map(stopCompartment)); if (result.some(r => !r.stopped)) throw new Error("A repository inspection guardian has not verified exit."); }
  };
}
