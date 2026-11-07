/** Exact-scope operator recovery; no reference replay or worktree restoration. */
import { readdir, rmdir } from "node:fs/promises";
import { randomUUID, createHash } from "node:crypto";
import { join, relative, isAbsolute, sep } from "node:path";
import { directoryIdentity } from "./private-fs.mjs";
import { verifyRepositoryIdentity } from "./coding-task-identity.mjs";
import { createRepositoryInspection } from "./repository-inspection.mjs";
import { runtimeGuardianStopped } from "./runtime-command.mjs";
import { suiteConfirmations, scopeHash } from "./confirmations.mjs";
import { recoveryLedger, recoveryBudget, settleOriginalRepositoryOperation } from "./repository-recovery-ledger.mjs";
import { captureGitFile, OwnedGitIndexLease, reopenOwnedGitFileLock, removePreservedGitFile } from "../../apps/windows-companion/src/git-index-lease.ts";
const equal = (a, b) => a && b && scopeHash(a) === scopeHash(b);
const inside = (root, path) => { if (typeof path !== "string") return false; const r = relative(root, path); return r && !isAbsolute(r) && r !== ".." && !r.startsWith(`..${sep}`); };
const hash = value => createHash("sha256").update(value).digest("hex");
export function createRepositoryEffectRecovery({ store, stateDirectory, isActive = async () => true, inspection = createRepositoryInspection({ store, ownerKind: "repository-recovery" }), guardianStopped = runtimeGuardianStopped, now = Date.now } = {}) {
  const pending = new Map(), generations = new Map(); let closed = false;
  async function readFile(path) {
    try { const value = await captureGitFile(path); try { return { present: true, identity: value.identity, stamp: value.stamp, sha256: value.sha256 }; } finally { value.bytes.fill(0); } }
    catch (e) { if (e.code === "ENOENT") return { present: false }; throw e; }
  }
  const uuid = id => /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/.test(id ?? "");
  async function exclusive(c, fn) {
    if (closed || pending.has(c)) throw new Error("Wait for the current repository recovery operation; stopped requests cannot resume.");
    const generation = generations.get(c) ?? 0;
    const promise = Promise.resolve().then(() => fn(generation)); pending.set(c, promise);
    try { return await promise; } finally { if (pending.get(c) === promise) pending.delete(c); }
  }
  async function readDirectory(path) {
    try { const d = await directoryIdentity(path), entries = (await readdir(path)).sort(); if (entries.length > 32) throw new Error("Retained staging inventory exceeds the review bound."); return { present: true, identity: { device: d.dev.toString(), inode: d.ino.toString() }, entries }; }
    catch(e) { if (e.code === "ENOENT") return { present: false }; throw e; }
  }
  const workspace = s => scopeHash([s.policy, s.mode, s.modeSelectedAt ?? null, s.accounts, s.taskAuthorityEpoch ?? 0]);
  const reviewedScope = (c, view, cleanupPrivateStaging, state) => scopeHash(["repository-recovery/v1", c, view.operationId, view.bindingDigest, view.recommendation, view.observed, cleanupPrivateStaging, workspace(state)]);
  const actionable = v => ["review-owned-cleanup", "review-index-reconciliation"].includes(v.recommendation);
  async function update(c, id, action, fn) { return store.update(c, action, s => { const r = s.repositoryEffects?.find(r => r.id === id); if (!r) throw new Error("The exact retained repository effect changed."); return fn(r); }); }
  async function observe(c, id, generation, onObserved = async view => view) {
      if (!uuid(id)) throw new Error("Choose one exact retained repository operation UUID.");
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
          observed.staging = await readDirectory(join(stateDirectory, "git-operations", hash(id)));
          if (record.scratch && inside(join(stateDirectory, "native-scratch"), record.scratch)) observed.scratch = await readDirectory(record.scratch);
          if (p) {
            const directory = join(stateDirectory, "git-operations", hash(id));
            if (p.operationId !== id || p.repositoryRoot !== record.repositoryRoot || p.sharedIndex.indexPath !== metadata.indexPath || p.sharedIndex.lockPath !== metadata.indexPath + ".lock" || !inside(join(stateDirectory, "git-locks"), p.worktreeLock.path) || (p.privateIndex && !inside(directory, p.privateIndex) || !inside(directory, p.privateIndexCopy))) throw new Error("The retained preservation paths do not belong to this exact operation.");
            observed.sharedLock = await readFile(p.sharedIndex.lockPath); observed.worktreeLock = await readFile(p.worktreeLock.path);
            if (p.privateIndex) observed.privateIndex = await readFile(p.privateIndex);
            observed.privateIndexCopy = await readFile(p.privateIndexCopy);
            observed.emptyHooks = [];
            for (const name of observed.staging.entries ?? []) if (/^hooks-[a-f0-9-]{36}$/.test(name)) { const d = await readDirectory(join(directory, name)); if (d.present && !d.entries.length) observed.emptyHooks.push({ name, ...d }); }
            const ownWorktree = observed.worktreeLock.present && equal(observed.worktreeLock.identity, p.worktreeLock.identity) && observed.worktreeLock.sha256 === p.worktreeLock.contentSha256;
            const ownIndex = observed.index.present && equal(observed.index.identity, p.sharedIndex.indexIdentity) && observed.index.sha256 === p.sharedIndex.originalIndexSha256;
            const ownLock = observed.sharedLock.present && equal(observed.sharedLock.identity, p.sharedIndex.lockIdentity) && equal(observed.sharedLock.stamp, p.sharedIndex.lockStamp);
            const privateIndex = observed.privateIndex?.present && equal(observed.privateIndex.identity, p.privateIndexProof?.identity) && observed.privateIndex.sha256 === p.privateIndexProof?.sha256;
            const intents = record.commands.filter(n => n.referenceIntent), args = intents.at(-1)?.referenceIntent.arguments;
            const exactIntent = intents.length === 1 && args?.length === 7 && args[0] === "update-ref" && args[1] === "--create-reflog" && args[4] === `refs/heads/${metadata.branch}` && args[6] === p.beforeHead && /^(?:[a-f0-9]{40}|[a-f0-9]{64})$/.test(args[5]);
            const reconciledIndex = !observed.sharedLock.present && observed.index.present && equal(observed.index.identity, p.sharedIndex.lockIdentity) && observed.index.sha256 === p.privateIndexProof?.sha256;
            const previouslyReleased = !observed.worktreeLock.present && record.recoveryProgress?.readyToRelease === true && equal(record.recoveryProgress.finalIndex, observed.index) && equal(record.recoveryProgress.metadata, metadata);
            if ((ownWorktree || previouslyReleased) && reconciledIndex && exactIntent && metadata.head === args[5] && metadata.headTree === p.expectedTree) { recommendation = "review-owned-cleanup"; reason = "The intended commit/tree and the exact already-reconciled index remain current; no index replacement or reference replay is needed."; }
            else if (previouslyReleased && ownIndex && !observed.sharedLock.present && metadata.head === p.beforeHead && metadata.branch === p.beforeBranch) { recommendation = "review-owned-cleanup"; reason = "The prior approved recovery released only its exact locks; remaining bookkeeping or private staging can be reviewed separately."; }
            else if (ownWorktree && ownIndex && ownLock && metadata.branch === p.beforeBranch && metadata.head === p.beforeHead && (!intents.length || exactIntent)) { recommendation = "review-owned-cleanup"; reason = "The original branch/index and exact unchanged owned locks remain present. No reference update will be replayed."; }
            else if (ownWorktree && ownIndex && ownLock && privateIndex && exactIntent && metadata.head === args[5] && metadata.headTree === p.expectedTree) { recommendation = "review-index-reconciliation"; reason = "The exact intended commit/tree is current, and the original index/locks plus private index still match their protected identities and digests."; }
            else { reason = "A reference, original index, private index or lease differs from the exact preservation packet. Preserve every different file for operator review."; }
          }
          if (record.status === "settled" && !record.cleanupPending) { recommendation = "settled"; reason = "This operation already has its durable terminal result. The observation changed no repository files."; }
          await check();
          return onObserved({ schema: "switchyard-repository-recovery-observation/v1", operationId: id, bindingDigest: record.bindingDigest, status: record.status, recommendation, reason, observed, nativeOwnersStoppedVerified: true, referenceMutationReplayed: false, repositoryWritten: false, recoveryApplyImplemented: true }, { record, task, check, metadata, observeMetadata: async () => { await check(); const value = await inspection.observe(c, task, check); await check(); for (const probe of (await store.snapshot(c)).repositoryProbes ?? []) if (probe.taskId === task.id && !await guardianStopped(probe.ownedRuntime)) throw new Error("A recovery metadata guardian has not independently verified exit."); return value; } });
        });
      } finally { /* The caller retains the resource lease through its entire effect. */ }
  }
  return {
    async list(c) { return ((await store.snapshot(c)).repositoryEffects ?? []).map(r => ({ id: r.id, taskId: r.taskId, status: r.status, cleanupPending: r.cleanupPending ?? false, outcome: r.outcome ?? null, recoveryResult: r.recoveryResult ?? null, nativeOwnersRequiringVerification: r.commands.filter(n => !n.stoppedVerified).length, referenceMutationReplayed: false })); },
    async inspect(c, id) { return exclusive(c, generation => observe(c, id, generation)); },
    async review(c, input) { return exclusive(c, generation => {
      if (Object.keys(input).some(k => !["compartment", "id", "cleanupPrivateStaging"].includes(k)) || !uuid(input.id) || typeof input.cleanupPrivateStaging !== "boolean") throw new Error("Review one exact retained operation and an explicit private-staging cleanup choice.");
      return observe(c, input.id, generation, async (view, { record, check }) => {
        if (!actionable(view)) throw new Error("This observation cannot authorize automated recovery. Preserve it for manual review.");
        const state = await store.snapshot(c), scopeDigest = reviewedScope(c, view, input.cleanupPrivateStaging, state), id = randomUUID();
        const confirmation = await suiteConfirmations(store, c, record.provider, now).issue({ action: "reconcile_repository_effect", targetSnapshotId: record.id, scopeDigest, reason: "Approve only the exact observed owned index/locks and selected private staging cleanup. No reference replay, worktree restoration, push or original commit receipt change.", reauthenticated: false });
        await check();
        await update(c, record.id, "repository-recovery-review", r => {
          const all = r.recoveryReviews ?? [], live = all.filter(v => v.status === "executing" || v.status === "reviewed" && Date.parse(v.expiresAt) > now());
          r.recoveryReviews = [...live, ...all.filter(v => !live.includes(v)).slice(-4)];
          if (r.recoveryReviews.length >= 16) throw new Error("The retained recovery review inventory is full.");
          r.recoveryReviews.push({ id, effectId: record.id, scopeDigest, workspaceDigest: workspace(state), cleanupPrivateStaging: input.cleanupPrivateStaging, tokenDigest: hash(confirmation.token), expiresAt: confirmation.record.expiresAt, status: "reviewed" });
        });
        return { status: "requires-confirmation", review: { id, operationId: record.id, scopeDigest, cleanupPrivateStaging: input.cleanupPrivateStaging, observation: view }, confirmation, budget: recoveryBudget.commandClasses.repository_recovery };
      });
    }); },
    async apply(c, input) { return exclusive(c, generation => {
      if (Object.keys(input).some(k => !["compartment", "id", "reviewId", "token"].includes(k)) || !uuid(input.id) || !uuid(input.reviewId) || !uuid(input.token)) throw new Error("Apply only one exact recovery review and its one-use approval.");
      return observe(c, input.id, generation, async (view, context) => {
        const { record, check, metadata, observeMetadata } = context;
        const review = record.recoveryReviews?.find(r => r.id === input.reviewId);
        if (!review || review.tokenDigest !== hash(input.token)) throw new Error("The exact protected recovery approval is unavailable or does not match.");
        if (review.status !== "reviewed") return { ...(review.result ?? { status: "incomplete", operationId: review.id, originalOperationId: record.id, summary: "This recovery generation was already reserved. Observe again and review a new generation; no filesystem effect was replayed." }), replayed: true };
        if (Date.parse(review.expiresAt) <= now()) throw new Error("The exact recovery approval expired; observe and approve a fresh review.");
        if (!actionable(view) || review.scopeDigest !== reviewedScope(c, view, review.cleanupPrivateStaging, await store.snapshot(c))) throw new Error("The exact recovery scope changed; observe and approve a fresh review.");
        const approved = await suiteConfirmations(store, c, record.provider, now).consume({ token: input.token, action: "reconcile_repository_effect", targetSnapshotId: record.id, scopeDigest: review.scopeDigest });
        if (!approved.allowed) throw new Error(approved.reason);
        const ledger = recoveryLedger(store, c, record.provider, now); let claimId;
        const checked = async () => { await check(); if (workspace(await store.snapshot(c)) !== review.workspaceDigest) throw new Error("The approved recovery workspace/account scope changed."); if (claimId) await ledger.assertRunning(claimId); };
        await checked();
        await update(c, record.id, "repository-recovery-reserve", r => { const v = r.recoveryReviews.find(v => v.id === review.id); if (v.status !== "reviewed") throw new Error("The recovery review was already reserved."); v.status = "executing"; v.startedAt = now(); r.cleanupPending = true; });
        claimId = await ledger.reserve(review);
        const p = record.preservation, o = view.observed; let index, worktree;
        try {
          if (o.worktreeLock.present) worktree = await reopenOwnedGitFileLock({ filePath: p.worktreeLock.path, identity: p.worktreeLock.identity, contentSha256: p.worktreeLock.contentSha256 });
          if (o.sharedLock.present) index = await OwnedGitIndexLease.reopenPreserved(p.sharedIndex);
          await checked();
          if (!equal(await observeMetadata(), metadata)) throw new Error("Git references changed immediately before metadata recovery. Preserve all files.");
          if (!equal(await readFile(metadata.indexPath), o.index)) throw new Error("The reviewed shared index changed immediately before recovery.");
          const committed = metadata.head !== p.beforeHead;
          if (view.recommendation === "review-index-reconciliation") { await checked(); await index.replaceWith(p.privateIndex, { expectedPrivateIndexSha256: p.privateIndexProof.sha256 }); index = undefined; }
          const finalIndex = await readFile(metadata.indexPath);
          if (committed && (!equal(finalIndex.identity, p.sharedIndex.lockIdentity) || finalIndex.sha256 !== p.privateIndexProof.sha256) || !committed && !equal(finalIndex, o.index)) throw new Error("The recovered index did not independently verify against its exact intended bytes.");
          if (!equal(await observeMetadata(), metadata)) throw new Error("Git references changed during recovery. Preserve the owned worktree lease.");
          await checked();
          const original = await settleOriginalRepositoryOperation(store, c, record, committed, now);
          // Persist positive readback before deleting any critical lease. A
          // restart can identify an already-reconciled index without rewriting it.
          await update(c, record.id, "repository-recovery-readback", r => { r.recoveryProgress = { readyToRelease: true, finalIndex, metadata, original }; });
          await checked(); if (index) { await index.release(); index = undefined; }
          await checked(); if (worktree) { await worktree.release(); worktree = undefined; }
          if (review.cleanupPrivateStaging) {
            const directory = join(stateDirectory, "git-operations", hash(record.id));
            if (o.staging.present && !equal((await readDirectory(directory)).identity, o.staging.identity)) throw new Error("The private staging directory changed; preserve its contents.");
            for (const [path, proof, expected] of [[p.privateIndex, o.privateIndex, p.privateIndexProof], [p.privateIndexCopy, o.privateIndexCopy, p.privateIndexCopyProof ?? { sha256: p.sharedIndex.originalIndexSha256 }]]) {
              if (!path || !proof?.present || proof.sha256 !== expected?.sha256 || expected.identity && !equal(proof.identity, expected.identity)) continue;
              await checked(); await removePreservedGitFile(path, proof);
            }
            for (const hook of o.emptyHooks) { await checked(); const path = join(directory, hook.name), actual = await readDirectory(path); if (equal(actual, { present: hook.present, identity: hook.identity, entries: hook.entries })) await rmdir(path); }
            const remaining = await readDirectory(directory); if (remaining.present && !remaining.entries.length && equal(remaining.identity, o.staging.identity)) { await checked(); await rmdir(directory); }
            if (o.scratch?.present && equal(o.scratch.identity, record.scratchIdentity)) { const actual = await readDirectory(record.scratch); if (equal(actual.identity, o.scratch.identity) && !actual.entries.length) { await checked(); await rmdir(record.scratch); } }
          }
          const staging = await readDirectory(join(stateDirectory, "git-operations", hash(record.id))), scratch = record.scratch ? await readDirectory(record.scratch) : { present: false };
          const cleanupPending = staging.present || scratch.present;
          await checked();
          const receipt = await ledger.finish(review, claimId, scopeHash([review.scopeDigest, finalIndex, metadata, original, cleanupPending]), !cleanupPending);
          const result = { status: cleanupPending ? "incomplete" : "completed", operationId: review.id, originalOperationId: record.id, receiptId: receipt.id, cleanupPending, sharedIndexReconciled: committed, originalOutcomeUnchanged: true, referenceMutationReplayed: false, replayed: false };
          await update(c, record.id, "repository-recovery-result", r => { r.status = "settled"; r.cleanupPending = cleanupPending; r.recoveryResult = result; const v = r.recoveryReviews.find(v => v.id === review.id); v.status = "settled"; v.result = result; for (const old of r.recoveryReviews) if (old.status === "executing") old.status = "interrupted"; });
          await store.update(c, "repository-commit-reconciled", s => { for (const r of s.repositoryCommitReviews ?? []) if (r.operationId === record.id) { r.status = "settled"; r.recoveryResult = result; } });
          return result;
        } finally { await Promise.allSettled([index?.abandon(), worktree?.abandon()]); }
      });
    }); },
    async stopCompartment(c) { generations.set(c, (generations.get(c) ?? 0) + 1); const result = await inspection.stopCompartment(c); await Promise.allSettled([pending.get(c)].filter(Boolean)); return result; },
    async close() { closed = true; let error; try { await inspection.close(); } catch(e) { error = e; } await Promise.allSettled(pending.values()); if (error) throw error; }
  };
}
