/** Exact reviewed local commits; no arbitrary command, push, merge or provider permission route. */
import { createHash } from "node:crypto";
import { DurableMediatedExecutor } from "../../packages/control-plane/src/runtime.ts";
import { InMemoryGitBroker } from "../../packages/control-plane/src/brokers.ts";
import { commandForAction } from "../../packages/control-plane/src/command-catalog.ts";
import { LocalMediatedGitHandler } from "../../apps/windows-companion/src/mediated-git.ts";
import { repositoryEffectJournal } from "./repository-effect-journal.mjs";
import { createRepositoryEffectCommands } from "./repository-effect-commands.mjs";
import { createRepositoryEffectCheckpoints } from "./repository-effect-checkpoints.mjs";
import { scopeHash } from "./confirmations.mjs";
const uuid = v => typeof v === "string" && /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/.test(v);
const tokenDigest = v => createHash("sha256").update(v).digest("hex");
const budgets = { version: "suite-reviewed-local-commit/v1", commandClasses: { local_commit: { maxConcurrent: 1, timeoutMs: 120000, maxAttempts: 1, windowMs: 3600000, maxClaimsPerWindow: 20, maxCostUnitsPerWindow: 20, defaultCostUnits: 1 } } };
function proposal(input) {
  if (Object.keys(input).some(k => !["compartment", "requestId", "authorityId", "message", "author"].includes(k)) || !uuid(input.requestId) || !uuid(input.authorityId)) throw new Error("Review one exact request UUID and task authority; broader operations or command fields are not accepted.");
  if (typeof input.message !== "string" || !input.message.trim() || input.message !== input.message.trim() || Buffer.byteLength(input.message) > 4096 || /[\0\r]/.test(input.message) || Buffer.from(input.message).toString("utf8") !== input.message) throw new Error("Review a nonempty UTF-8 commit message of at most 4096 bytes, without outer whitespace or carriage returns.");
  const author = input.author;
  if (!author || Object.keys(author).some(k => !["name", "email"].includes(k)) || typeof author.name !== "string" || !author.name.trim() || author.name !== author.name.trim() || Buffer.from(author.name).toString("utf8") !== author.name || author.name.length > 200 || /[<>\x00-\x1f\x7f]/.test(author.name) || typeof author.email !== "string" || author.email.length > 254 || !/^[A-Za-z0-9.!#$%&'*+\/=?^_`{|}~-]+@[A-Za-z0-9.-]+$/.test(author.email)) throw new Error("Review the exact commit author name and email; no identity is guessed from an account or global Git configuration.");
  return { requestId: input.requestId, authorityId: input.authorityId, message: input.message, author: { name: author.name, email: author.email } };
}
export function createRepositoryCommits({ store, authority, stateDirectory, commands = createRepositoryEffectCommands({ store, stateDirectory }), now = Date.now } = {}) {
  const pending = new Map(), generations = new Map(); let closed = false;
  const current = (c, generation) => { if (closed || generation !== (generations.get(c) ?? 0)) throw new Error("This reviewed repository operation was stopped."); };
  async function exclusive(c, fn) {
    if (pending.has(c)) throw new Error("Wait for the current reviewed repository operation to settle.");
    const promise = Promise.resolve().then(() => fn(generations.get(c) ?? 0)); pending.set(c, promise);
    try { return await promise; } finally { if (pending.get(c) === promise) pending.delete(c); }
  }
  const reviewView = r => ({ requestId: r.requestId, authorityId: r.authorityId, taskId: r.taskId, sessionId: r.sessionId, targetSnapshotId: r.targetSnapshotId, repositoryRoot: r.repositoryRoot, branch: r.branch, paths: r.paths, files: r.files, message: r.message, author: r.author, scopeDigest: r.scopeDigest, status: r.status, expiresAt: r.expiresAt, outcome: r.outcome ?? null, nativePermissionsChanged: false, providerTaskCompletionVerified: false });
  async function update(c, requestId, action, fn) { return store.update(c, action, s => { const r = s.repositoryCommitReviews?.find(r => r.requestId === requestId); if (!r) throw new Error("The exact protected commit review is unavailable."); return fn(r); }); }
  async function runtimeFor(c, review, resolved, generation) {
    const check = async () => { current(c, generation); const actual = await authority.assertCurrent(c, review.authorityId); if (actual.record.taskDigest !== review.taskDigest || actual.record.workspaceDigest !== review.workspaceDigest) throw new Error("The reviewed task/account or workspace scope changed."); current(c, generation); };
    const journal = repositoryEffectJournal(store, c, { provider: resolved.task.provider, now });
    const checkpoint = createRepositoryEffectCheckpoints({ store, compartment: c, task: resolved.task, authorize: check });
    const originalCapture = checkpoint.checkpointCapture.capture;
    checkpoint.checkpointCapture.capture = async input => { await check(); await update(c, review.requestId, "commit-checkpoint-binding", r => { if (r.status !== "executing" || r.scopeDigest !== review.scopeDigest || r.operationId && r.operationId !== input.operationId) throw new Error("The exact durable commit operation changed before checkpoint capture."); r.operationId = input.operationId; }); return originalCapture(input); };
    const runtime = new DurableMediatedExecutor({ store: journal, authorities: authority.authorityLedger(c), policyVersion: "switchyard-task-local-authority/v1", now: () => new Date(now()), budgetConfiguration: budgets, ...checkpoint,
      targetResolver: { resolve: async () => { current(c, generation); const actual = await authority.resolve(c, review.authorityId); current(c, generation); if (actual.snapshot.id !== review.targetSnapshotId || actual.binding !== review.taskDigest || actual.workspace !== review.workspaceDigest) throw new Error("The exact commit review target changed."); return actual.snapshot; } },
      dependencies: context => {
        const git = new InMemoryGitBroker(context.policy);
        git.register("local_commit", request => commands.execute(c, { task: resolved.task, operationId: request.operationId, bindingDigest: review.scopeDigest, author: review.author, authorize: check }, ports => new LocalMediatedGitHandler({ ...ports,
          classifyUntracked: p => resolved.proposed.classifications.includedUntracked.includes(p) ? "included" : resolved.proposed.classifications.excludedUntracked.includes(p) ? "excluded" : "unknown",
          classifyIgnored: p => resolved.proposed.classifications.excludedIgnored.includes(p) ? "excluded" : "unknown"
        }).execute(request)));
        return { git, gitMutationFactory: { create: (definition, target, session) => definition.action === "local_commit" && target.id === review.targetSnapshotId && session?.id === review.sessionId ? { kind: "local_commit", paths: review.paths, message: review.message } : undefined } };
      }
    });
    await check();
    await runtime.sessions.upsert({ id: review.sessionId, provider: "generic", surface: "bridge", capabilities: ["registered", "mediated"], status: "running", workspaceRoot: review.repositoryRoot, targetSnapshotId: review.targetSnapshotId, taskId: review.taskId, planRevision: resolved.record.grant.planRevision, plannedFiles: review.paths, adapterVersion: "switchyard-host-repository/v1", metadata: { meaning: "Active host repository broker context; no native provider lifecycle capability inferred", nativeProvider: resolved.task.provider, nativeSessionId: resolved.task.sessionId, accountFingerprint: resolved.task.accountFingerprint } });
    return { runtime, check };
  }
  return {
    async review(c, input) { return exclusive(c, async generation => {
      const proposed = proposal(input); current(c, generation);
      const initial = await store.snapshot(c);
      if ((initial.repositoryCommitReviews ?? []).some(r => ["executing", "recovery-required"].includes(r.status))) throw new Error("A previous commit requires explicit no-replay reconciliation before another review.");
      if (initial.repositoryCommitReviews?.some(r => r.requestId === proposed.requestId)) throw new Error("This commit request UUID already has a protected review. Use its recorded result or create a new review UUID.");
      const resolved = await authority.resolve(c, proposed.authorityId); current(c, generation);
      const files = resolved.proposed.paths.map(path => {
        const witness = [...resolved.files.tracked, ...resolved.files.untracked].find(f => f.path === path);
        if (!witness?.digest) throw new Error("A task-owned file has no exact content witness for this review.");
        return { path, digest: witness.digest, ...(witness.state ? { state: witness.state } : {}) };
      });
      const packet = { ...proposed, taskId: resolved.task.id, sessionId: resolved.task.sessionId, repositoryRoot: resolved.task.repositoryRoot, branch: resolved.snapshot.branch, targetSnapshotId: resolved.snapshot.id, taskDigest: resolved.binding, workspaceDigest: resolved.workspace, paths: [...resolved.proposed.paths], files };
      const scopeDigest = scopeHash(["switchyard-local-commit-review/v1", c, packet]);
      const review = { ...packet, scopeDigest, status: "reviewed", createdAt: now() };
      const { runtime, check } = await runtimeFor(c, review, resolved, generation);
      const confirmation = await runtime.confirmations.issue({ action: "local_commit", sessionId: review.sessionId, authorityId: review.authorityId, targetSnapshotId: review.targetSnapshotId, scopeDigest, reason: "Approve only the displayed exact task-owned files, snapshot, message and author for one host local commit; no push, merge or native provider permission change.", reauthenticated: false });
      await check(); review.expiresAt = confirmation.record.expiresAt; review.tokenDigest = tokenDigest(confirmation.token);
      await store.update(c, "local-commit-review", s => {
        current(c, generation); const all = s.repositoryCommitReviews ?? [], live = all.filter(r => ["executing", "recovery-required"].includes(r.status) || r.status === "reviewed" && Date.parse(r.expiresAt) > now());
        s.repositoryCommitReviews = [...live, ...all.filter(r => !live.includes(r)).slice(-16)];
        if (s.repositoryCommitReviews.length >= 64 || s.repositoryCommitReviews.some(r => r.requestId === review.requestId)) throw new Error("The exact commit review inventory is full or changed. Existing records were preserved.");
        s.repositoryCommitReviews.push(review);
      }, { provider: resolved.task.provider });
      return { status: "requires-confirmation", review: reviewView(review), confirmation, targetSnapshot: resolved.snapshot, budget: budgets.commandClasses.local_commit };
    }); },
    async execute(c, input) { return exclusive(c, async generation => {
      if (Object.keys(input).some(k => !["compartment", "requestId", "token"].includes(k)) || !uuid(input.requestId) || !uuid(input.token)) throw new Error("Execute only the exact reviewed request UUID and its one-use effect approval.");
      current(c, generation); let review = (await store.snapshot(c)).repositoryCommitReviews?.find(r => r.requestId === input.requestId);
      if (!review || review.tokenDigest !== tokenDigest(input.token)) throw new Error("The exact protected commit approval is unavailable or does not match.");
      if (review.status !== "reviewed") return { ...(review.outcome ?? { status: "incomplete", summary: "The previous commit request is unresolved. Inspect its protected operation; no automatic replay was attempted.", effectDisposition: "ambiguous", operationId: review.operationId ?? null }), replayed: true, nativePermissionsChanged: false, providerTaskCompletionVerified: false };
      const resolved = await authority.resolve(c, review.authorityId); current(c, generation);
      if (resolved.snapshot.id !== review.targetSnapshotId || resolved.binding !== review.taskDigest || resolved.workspace !== review.workspaceDigest) throw new Error("The reviewed commit scope changed; capture a new authority and effect review.");
      await update(c, review.requestId, "local-commit-reserve", r => { current(c, generation); if (r.status !== "reviewed" || r.scopeDigest !== review.scopeDigest) throw new Error("This commit review was already reserved."); r.status = "executing"; });
      let outcome;
      try {
        const { runtime, check } = await runtimeFor(c, review, resolved, generation); await check(); const assignment = commandForAction("local_commit").assignment;
        outcome = await runtime.execute({ assignment, control: assignment.control, modifier: assignment.modifier, sessionId: review.sessionId, authorityId: review.authorityId, confirmationToken: input.token, confirmationScopeDigest: review.scopeDigest });
      } catch (error) {
        const owned = (await store.snapshot(c)).repositoryEffects?.find(r => r.bindingDigest === review.scopeDigest);
        outcome = { status: "incomplete", summary: owned ? "The owned commit did not settle. Inspect its retained operation; no automatic replay is permitted." : "Admission stopped before a native repository effect was reserved. A fresh review is required.", effectDisposition: owned ? "ambiguous" : "not_started", ...(owned ? { operationId: owned.id } : {}) };
      }
      // The core can reject terminal result recording while an exact child
      // remains unresolved. That generic failure must not hide the host's
      // durable native effect or incorrectly settle the separate review.
      const retained = (await store.snapshot(c)).repositoryEffects?.find(r => r.bindingDigest === review.scopeDigest);
      if (retained?.status === "recovery-required") outcome = { ...outcome, status: "incomplete", summary: "The exact native repository effect requires explicit no-replay reconciliation. Its original result remains uncertain.", effectDisposition: "ambiguous", operationId: retained.id, data: { ...outcome.data, recoveryStatePreserved: true } };
      await update(c, review.requestId, "local-commit-result", r => { r.status = outcome.effectDisposition === "ambiguous" || outcome.data?.recoveryStatePreserved === true || outcome.effectDisposition === "committed" && outcome.status !== "completed" ? "recovery-required" : "settled"; r.outcome = structuredClone(outcome); if (outcome.operationId) r.operationId = outcome.operationId; r.finishedAt = now(); });
      return { ...outcome, replayed: false, nativePermissionsChanged: false, providerTaskCompletionVerified: false };
    }); },
    async list(c) { return ((await store.snapshot(c)).repositoryCommitReviews ?? []).map(reviewView); },
    async stopCompartment(c) { generations.set(c, (generations.get(c) ?? 0) + 1); return commands.stopCompartment(c); },
    async close() { closed = true; let stopError; try { await commands.close(); } catch (error) { stopError = error; } await Promise.allSettled(pending.values()); if (stopError) throw stopError; }
  };
}
