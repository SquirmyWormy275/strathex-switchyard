/** Read-only, no-replay observation of a retained host repository effect. */
import { createHash } from "node:crypto";
import { join, relative, isAbsolute, sep } from "node:path";
import { directoryIdentity } from "./private-fs.mjs";
import { verifyRepositoryIdentity } from "./coding-task-identity.mjs";
import { createRepositoryInspection } from "./repository-inspection.mjs";
import { runtimeGuardianStopped } from "./runtime-command.mjs";
import { captureGitFile } from "../../apps/windows-companion/src/git-index-lease.ts";
const equal = (a, b) => a && b && Object.keys(a).length === Object.keys(b).length && Object.keys(a).every(k => a[k] === b[k]);
const inside = (root, path) => { const r = relative(root, path); return r && !isAbsolute(r) && r !== ".." && !r.startsWith(`..${sep}`); };
const hash = value => createHash("sha256").update(value).digest("hex");
export function createRepositoryEffectRecovery({ store, stateDirectory, isActive = async () => true, inspection = createRepositoryInspection({ store }), guardianStopped = runtimeGuardianStopped } = {}) {
  const pending = new Set(), generations = new Map(); let closed = false;
  async function readFile(path) {
    try { const value = await captureGitFile(path); try { return { present: true, identity: value.identity, stamp: value.stamp, sha256: value.sha256 }; } finally { value.bytes.fill(0); } }
    catch (e) { if (e.code === "ENOENT") return { present: false }; throw e; }
  }
  return {
    async list(c) { return ((await store.snapshot(c)).repositoryEffects ?? []).map(r => ({ id: r.id, taskId: r.taskId, status: r.status, at: r.at, finishedAt: r.finishedAt ?? null, outcome: r.outcome ?? null, nativeOwnersRequiringVerification: r.commands.filter(n => !n.stoppedVerified).length, referenceMutationReplayed: false })); },
    async inspect(c, id) {
      if (!/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/.test(id ?? "")) throw new Error("Choose one exact retained repository operation UUID.");
      if (pending.has(c)) throw new Error("Wait for the current repository recovery observation."); pending.add(c);
      const generation = generations.get(c) ?? 0;
      try {
        let record = (await store.snapshot(c)).repositoryEffects?.find(r => r.id === id);
        if (!record || record.schema !== "switchyard-repository-effect/v1" || !["codex", "claude-code"].includes(record.provider)) throw new Error("That protected repository effect is unavailable in this workspace.");
        const task = { id: record.taskId, provider: record.provider, repositoryRoot: record.repositoryRoot, repositoryIdentity: record.repositoryIdentity };
        const authorize = async () => {
          if (closed || generation !== (generations.get(c) ?? 0) || !await isActive(c)) throw new Error("Select this workspace before observing repository recovery; stopped observations cannot resume.");
          const s = await store.snapshot(c); if (s.policy !== "personal" || s.mode !== "personal-companion") throw new Error("Repository recovery observation requires this Personal companion workspace.");
          await store.authorize(c, { provider: record.provider }); await verifyRepositoryIdentity(task);
          const actual = await directoryIdentity(record.gitDirectory);
          if (record.gitDirectory !== join(task.repositoryRoot, ".git") || actual.dev.toString() !== record.gitIdentity.device || actual.ino.toString() !== record.gitIdentity.inode) throw new Error("The original Git metadata directory changed. Preserve this effect for recovery.");
        };
        await authorize();
        return await store.withResourceLock("repository-effects", JSON.stringify(task.repositoryIdentity), async lease => {
          const check = async () => { lease.assert(); await authorize(); };
          await check();
          for (const command of record.commands) {
            if (!await guardianStopped(command.ownedRuntime)) throw new Error("A retained Git guardian has not independently verified exit. Recovery observations cannot start.");
            if (!command.stoppedVerified) await store.update(c, "repository-recovery-observed-exit", s => { const n = s.repositoryEffects?.find(r => r.id === id)?.commands.find(n => n.ownedRuntime.id === command.ownedRuntime.id); if (!n) throw new Error("The exact retained native ownership record changed."); n.stoppedVerified = true; });
          }
          const metadata = await inspection.observe(c, task, check); await check();
          for (const probe of (await store.snapshot(c)).repositoryProbes ?? []) if (probe.taskId === task.id && !await guardianStopped(probe.ownedRuntime)) throw new Error("The recovery metadata guardian has not independently verified exit.");
          record = (await store.snapshot(c)).repositoryEffects.find(r => r.id === id);
          if (metadata.root !== task.repositoryRoot || metadata.gitDirectory !== record.gitDirectory || metadata.indexPath !== join(record.gitDirectory, "index")) throw new Error("Recovery metadata resolves to a different worktree or index.");
          const p = record.preservation, observed = { metadata, index: await readFile(metadata.indexPath) };
          let recommendation = "manual-review", reason = "The retained operation has no complete index/lease preservation packet.";
          if (p) {
            const directory = join(stateDirectory, "git-operations", hash(id));
            if (p.operationId !== id || p.repositoryRoot !== record.repositoryRoot || p.sharedIndex.indexPath !== metadata.indexPath || p.sharedIndex.lockPath !== metadata.indexPath + ".lock" || !inside(join(stateDirectory, "git-locks"), p.worktreeLock.path) || p.privateIndex && !inside(directory, p.privateIndex)) throw new Error("The retained preservation paths do not belong to this exact operation.");
            observed.sharedLock = await readFile(p.sharedIndex.lockPath); observed.worktreeLock = await readFile(p.worktreeLock.path);
            if (p.privateIndex) observed.privateIndex = await readFile(p.privateIndex);
            const ownWorktree = observed.worktreeLock.present && equal(observed.worktreeLock.identity, p.worktreeLock.identity) && observed.worktreeLock.sha256 === p.worktreeLock.contentSha256;
            const ownIndex = observed.index.present && equal(observed.index.identity, p.sharedIndex.indexIdentity) && observed.index.sha256 === p.sharedIndex.originalIndexSha256;
            const ownLock = observed.sharedLock.present && equal(observed.sharedLock.identity, p.sharedIndex.lockIdentity) && equal(observed.sharedLock.stamp, p.sharedIndex.lockStamp);
            const privateIndex = observed.privateIndex?.present && equal(observed.privateIndex.identity, p.privateIndexProof?.identity) && observed.privateIndex.sha256 === p.privateIndexProof?.sha256;
            const intents = record.commands.filter(n => n.referenceIntent), args = intents.at(-1)?.referenceIntent.arguments;
            const exactIntent = intents.length === 1 && args?.length === 7 && args[0] === "update-ref" && args[1] === "--create-reflog" && args[4] === `refs/heads/${metadata.branch}` && args[6] === p.beforeHead && /^(?:[a-f0-9]{40}|[a-f0-9]{64})$/.test(args[5]);
            if (ownWorktree && ownIndex && ownLock && metadata.branch === p.beforeBranch && metadata.head === p.beforeHead && (!intents.length || exactIntent)) { recommendation = "review-owned-cleanup"; reason = "The original branch/index and exact unchanged owned locks remain present. No reference update will be replayed."; }
            else if (ownWorktree && ownIndex && ownLock && privateIndex && exactIntent && metadata.head === args[5] && metadata.headTree === p.expectedTree) { recommendation = "review-index-reconciliation"; reason = "The exact intended commit/tree is current, and the original index/locks plus private index still match their protected identities and digests."; }
            else { reason = "A reference, original index, private index or lease differs from the exact preservation packet. Preserve every different file for operator review."; }
          }
          if (record.status === "settled") { recommendation = "settled"; reason = "This operation already has its durable terminal result. The observation changed no repository files."; }
          await check();
          return { schema: "switchyard-repository-recovery-observation/v1", operationId: id, bindingDigest: record.bindingDigest, status: record.status, recommendation, reason, observed, nativeOwnersStoppedVerified: true, referenceMutationReplayed: false, repositoryWritten: false, recoveryApplyImplemented: false };
        });
      } finally { pending.delete(c); }
    },
    async stopCompartment(c) { generations.set(c, (generations.get(c) ?? 0) + 1); return inspection.stopCompartment(c); },
    async close() { closed = true; await inspection.close(); }
  };
}
