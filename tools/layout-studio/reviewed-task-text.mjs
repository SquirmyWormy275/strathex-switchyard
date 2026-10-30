/** Reviewed text-only coding turns on private owned native connections. No tool authority. */
import { lstat } from "node:fs/promises";
import { join } from "node:path";
import { verifyRepositoryIdentity } from "./coding-task-identity.mjs";
import { scopeHash, suiteConfirmations } from "./confirmations.mjs";
import { stopOwnedChild } from "./owned-process.mjs";
import { guardianScope } from "./owned-native-command.mjs";

const uuid = (v) => typeof v === "string" && /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/.test(v);
const unresolved = new Set(["reserved", "submitting", "submitted", "outcome-unconfirmed", "cancellation-requested", "interrupted"]);
const taskDigest = (t) => scopeHash([t.id, t.provider, t.sessionId, t.accountFingerprint, t.repositoryRoot, t.repositoryIdentity, t.launchPolicy, t.nativeTransport, t.backgroundId, t.startedAt, t.status, t.nativeIdentityVerified, t.creationOutcomeReviewedAt]);
function prompt(value) {
  if (typeof value !== "string" || !value.trim() || Buffer.byteLength(value) > 12000 || value.includes("\0")) throw new Error("Review 1–12000 UTF-8 bytes of text for this exact task.");
  return value;
}
export function createReviewedTaskText({ store, adapter, stopChild = stopOwnedChild, now = () => Date.now() } = {}) {
  if (!["codex", "claude-code"].includes(adapter?.provider) || typeof adapter.openTask !== "function" || typeof adapter.validateTask !== "function") throw new Error("A reviewed native text adapter is required.");
  const { provider } = adapter;
  const belongs = (t) => t != null && (t.provider ?? "codex") === provider;
  function taskIn(state, id, recovery = false) {
    const t = state.codingSessions?.find((t) => t.id === id);
    if (!t || t.schema !== "switchyard-coding-session/v1" || t.provider !== provider || (t.status !== "registered" && !(recovery && adapter.canRecoverTask?.(t))) || t.launchPolicy !== adapter.launchPolicy || !/^[A-Za-z0-9_-]{1,128}$/.test(t.sessionId ?? "") || !/^[a-f0-9]{64}$/.test(t.accountFingerprint ?? "")) throw new Error("Choose an exact registered task created by Switchyard. External or uncertain tasks cannot receive text here.");
    if (!t.repositoryIdentity) throw new Error("Explicitly bind this exact task again to review its current repository directory identity before submitting text.");
    adapter.validateTask(t); return t;
  }
  const running = new Map(), generations = new Map(), unconfirmed = new Map(), seen = new Set(); let closed = false;
  const generation = (c) => generations.get(c) ?? 0;
  const stop = async (client) => { try { return typeof client.stop === "function" ? await client.stop() === true : (await stopChild(client.child)).stopped === true; } catch { return false; } };
  async function settle(c) {
    const remaining = new Set(); for (const client of unconfirmed.get(c) ?? []) if (!(await stop(client))) remaining.add(client);
    if (remaining.size) { unconfirmed.set(c, remaining); throw new Error("A previous owned text-task process has not verified exit. No replacement was launched."); }
    unconfirmed.delete(c);
  }
  async function dispose(c, resource) {
    for (const client of resource.clients) if (!client.closed) client.close();
    let stopped = true;
    for (const client of resource.clients) if (!(await stop(client))) { stopped = false; const pending = unconfirmed.get(c) ?? new Set(); pending.add(client); unconfirmed.set(c, pending); } else unconfirmed.get(c)?.delete(client);
    if (!unconfirmed.get(c)?.size) unconfirmed.delete(c);
    return stopped;
  }
  async function use(c, taskId, operation, requestId = null, recovery = false) {
    const fence = generation(c); await store.authorize(c, { provider }); seen.add(c); await settle(c);
    const key = `${c}:${taskId}`;
    if (running.has(key)) throw new Error("A review or text turn is already running for this exact task. Wait or cancel it before sending again.");
    const resource = { clients: new Set(), controller: new AbortController(), cancelled: false, requestId };
    const current = () => { if (closed || generation(c) !== fence || resource.cancelled) throw new Error("This owned text request was stopped. Saved context was preserved."); };
    const authorize = async () => { current(); await store.authorize(c, { provider }); current(); };
    running.set(key, resource);
    try {
      await authorize(); const state = await store.snapshot(c), task = taskIn(state, taskId, recovery);
      if (recovery) { if (!adapter.canRecoverTask?.(task)) throw new Error("This exact task does not have an uncertain first creation to recover."); adapter.validateRecovery?.(task, state); }
      await verifyRepositoryIdentity(task);
      const git = await lstat(join(task.repositoryRoot, ".git")); if (git.isSymbolicLink() || !git.isDirectory() && !git.isFile()) throw new Error("The exact task directory has unsupported Git metadata.");
      const native = await adapter.openTask({ compartment: c, task, resource, current, authorize, dispose: () => dispose(c, resource) });
      await store.claimSession(c, { provider, sessionId: task.sessionId }); await authorize();
      const latest = await store.snapshot(c); if (taskDigest(taskIn(latest, taskId, recovery)) !== taskDigest(task)) throw new Error("The exact task binding changed before review or submission.");
      if (recovery) adapter.validateRecovery?.(task, latest);
      return await operation({ task, native, current, authorize, resource, state: latest });
    } finally {
      const stopped = await dispose(c, resource); running.delete(key);
      if (!stopped) throw new Error("Owned native process exit is unconfirmed. Saved request identities remain; no automatic retry is allowed.");
    }
  }
  function reviewed(c, task, state, text, recovery = false) {
    return { action: adapter.submitAction, sessionId: task.sessionId,
      targetSnapshotId: scopeHash([`${provider}-reviewed-text/v1`, c, taskDigest(task), recovery ? "recover-exact-native-session" : "continue"]),
      scopeDigest: scopeHash([text, state.policy, state.mode, state.accounts, adapter.permissions, adapter.nativeVersion]) };
  }
  const active = (c, id) => [...running.entries()].some(([key, r]) => key.startsWith(`${c}:`) && r.requestId === id);
  const view = (t) => ({ ...t, provider: t.provider ?? "codex", taskCompletionVerified: false, provenance: "Owned restricted native text turn; provider completion does not verify its coding task" });
  async function stopCompartment(c) {
    generations.set(c, generation(c) + 1); const resources = [...running.entries()].filter(([key]) => key.startsWith(`${c}:`)).map(([, r]) => r);
    const stopped = await Promise.all(resources.map(async (r) => { r.cancelled = true; r.controller.abort(); return dispose(c, r); }));
    await settle(c); const savedStopped = adapter.verifySavedStop ? await adapter.verifySavedStop(c) : true; return { stopped: stopped.every(Boolean) && savedStopped === true, taskCompletionVerified: false };
  }
  async function reviewText(c, { taskId, text }, recovery = false) {
      text = prompt(text);
      return use(c, taskId, async ({ task, state, current }) => {
        const confirmation = await suiteConfirmations(store, c, provider, now).issue({ ...reviewed(c, task, state, text, recovery),
          reason: recovery ? adapter.recoveryReason : adapter.reviewReason, reauthenticated: false }); current();
        return { status: "requires-confirmation", confirmation, scope: { operation: recovery ? "recover-exact-native-session" : "continue", taskId, sessionId: task.sessionId, nativeIdentityVerified: task.nativeIdentityVerified !== false, label: task.label, repositoryRoot: task.repositoryRoot, repositoryIdentity: task.repositoryIdentity, text, accountFingerprint: task.accountFingerprint, permissions: adapter.permissions }, modelPromptSubmitted: false, taskCompletionVerified: false };
      }, null, recovery);
  }
  async function submitText(c, { taskId, text, requestId, token }, recovery = false) {
      const operation = recovery ? "recover-exact-native-session" : "continue";
      text = prompt(text); if (!uuid(requestId) || !uuid(token)) throw new Error("Use a stable request UUID and the exact one-use approval token from reviewing this text.");
      await store.authorize(c, { provider });
      const previous = (await store.snapshot(c)).codingTurns?.find((t) => t.id === requestId);
      if (previous) { if (!belongs(previous) || previous.taskId !== taskId || previous.promptSha256 !== scopeHash(text) || (previous.operation ?? "continue") !== operation) throw new Error("This request UUID already names different reviewed text or another task."); return { ...view(previous), duplicatePrevented: true }; }
      return use(c, taskId, async ({ task, native, state, current, authorize, resource }) => {
        const decision = await suiteConfirmations(store, c, provider, now).consume({ ...reviewed(c, task, state, text, recovery), token }); if (!decision.allowed) throw new Error(decision.reason);
        resource.requestId = requestId;
        const reserved = await store.update(c, "coding-text-reserve", (s) => {
          current(); if (taskDigest(taskIn(s, taskId, recovery)) !== taskDigest(task) || reviewed(c, task, s, text, recovery).scopeDigest !== reviewed(c, task, state, text, recovery).scopeDigest) throw new Error("The reviewed task or workspace policy changed before submission.");
          s.codingTurns ??= [];
          const duplicate = s.codingTurns.find((t) => t.id === requestId);
          if (duplicate) { if (!belongs(duplicate) || duplicate.taskId !== taskId || duplicate.promptSha256 !== scopeHash(text) || (duplicate.operation ?? "continue") !== operation) throw new Error("This request UUID already names different reviewed text or another task."); return false; }
          if (s.codingTurns.some((t) => t.taskId === taskId && unresolved.has(t.status))) throw new Error("This task has an unresolved previous submission. Review its outcome before starting another.");
          const cutoff = now() - (s.policy === "work" ? 7 : 30) * 86400000;
          s.codingTurns = s.codingTurns.filter((t) => unresolved.has(t.status) || t.ownedRuntime && t.ownedRuntimeStoppedVerified !== true || t.updatedAt >= cutoff);
          if (s.codingTurns.length >= 32 || Buffer.byteLength(JSON.stringify(s)) > 3 * 1024 * 1024) throw new Error("Review or delete older completed text turns before sending more. Saved context was preserved.");
          s.codingTurns.push({ schema: "switchyard-coding-text-turn/v1", id: requestId, provider, operation, taskId, sessionId: task.sessionId, taskDigest: taskDigest(task), accountFingerprint: task.accountFingerprint, prompt: text, promptSha256: scopeHash(text), status: "reserved", turnId: null, reply: null, createdAt: now(), updatedAt: now(), taskCompletionVerified: false }); return true;
        }, { provider });
        if (!reserved) return { ...view((await store.snapshot(c)).codingTurns.find((t) => t.id === requestId)), duplicatePrevented: true };
        let attempted = false;
        try {
          await native.prepareTurn(); await authorize();
          await store.update(c, "coding-text-submitting", (s) => { current(); const t = s.codingTurns.find((t) => t.id === requestId); t.status = "submitting"; t.updatedAt = now(); }, { provider }); attempted = true;
          const result = await native.runTurn({ recovery, text, signal: resource.controller.signal, checkCurrent: current,
            onContainment: async frame => { const scope = guardianScope(frame); await store.update(c, "coding-text-guardian", (s) => { current(); const t = s.codingTurns.find((t) => t.id === requestId); if (t.ownedRuntime && scopeHash(t.ownedRuntime) !== scopeHash(scope)) throw new Error("The saved owned guardian identity changed before start."); t.ownedRuntime = scope; t.ownedRuntimeStoppedVerified = false; }, { provider }); },
            onContainmentStopped: async frame => { const scope = guardianScope(frame); await store.update(c, "coding-text-guardian-exit", (s) => { const t = s.codingTurns.find((t) => t.id === requestId); if (!t || scopeHash(t.ownedRuntime) !== scopeHash(scope)) throw new Error("The exact saved guardian exit could not be recorded."); t.ownedRuntimeStoppedVerified = true; }); },
            onStarted: async (turnId) => { await store.update(c, "coding-text-identity", (s) => { const t = s.codingTurns.find((t) => t.id === requestId); t.turnId = turnId; t.status = "submitted"; t.updatedAt = now(); }); } });
          if (typeof result.text !== "string" || Buffer.byteLength(result.text) > 32768 || result.nativeStatus !== "completed" || result.nativeSessionVerified !== true || result.nativeTurnIdSupported === true && !/^[A-Za-z0-9_-]{1,128}$/.test(result.turnId ?? "")) throw new Error("The native reply did not verify its bounded session contract. Saved request identity was retained.");
          await authorize(); await verifyRepositoryIdentity(task);
          return await store.update(c, "coding-text-reply", (s) => { current(); const bound = taskIn(s, taskId, recovery); if (taskDigest(bound) !== taskDigest(task)) throw new Error("The original task binding changed before retaining its reply."); adapter.acceptResult?.(bound, result); const t = s.codingTurns.find((t) => t.id === requestId); t.reply = result.text; t.status = "provider-turn-completed"; t.nativeStatus = result.nativeStatus; t.nativeTurnIdSupported = result.nativeTurnIdSupported === true; t.nativeSessionVerified = true; t.updatedAt = now(); return view(t); }, { provider });
        } catch (error) {
          await store.update(c, "coding-text-uncertain", (s) => { const t = s.codingTurns?.find((t) => t.id === requestId); if (t) { t.turnId ??= error.turnId ?? null; t.status = attempted ? "outcome-unconfirmed" : "failed-before-turn"; t.failureCode = /^[A-Z_]{1,40}$/.test(error.code ?? "") ? error.code : "NATIVE_CONTRACT_UNCONFIRMED"; if (error.nativeResultSummary?.schema === "switchyard-claude-result-shape/v1" && JSON.stringify(error.nativeResultSummary).length < 2048) t.nativeResultSummary = error.nativeResultSummary; if (/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/.test(error.observedSessionId ?? "")) t.observedSessionId = error.observedSessionId; t.updatedAt = now(); } if (attempted) adapter.recordUnconfirmed?.(s.codingSessions?.find((t) => t.id === taskId)); }).catch(() => {});
          throw error;
        }
      }, requestId, recovery);
  }
  return {
    async list(c) { await store.authorize(c, { provider }); return ((await store.snapshot(c)).codingTurns ?? []).filter(belongs).map(view); },
    review: (c, input) => reviewText(c, input),
    reviewRecovery: (c, input) => reviewText(c, input, true),
    async reviewOutcome(c, id) {
      const state = await store.snapshot(c), turn = state.codingTurns?.find((t) => t.id === id);
      if (!belongs(turn) || !unresolved.has(turn.status) || active(c, id)) throw new Error("Wait or stop the active owned connection before reviewing its unresolved saved outcome.");
      const confirmation = await suiteConfirmations(store, c, undefined, now).issue({ action: adapter.resolveAction, sessionId: turn.sessionId,
        targetSnapshotId: scopeHash([`${provider}-text-outcome/v1`, c, id]), scopeDigest: scopeHash([turn, state.policy, state.mode, state.accounts]),
        reason: "Record that this uncertain outcome was reviewed. This does not retry a request, cancel external work, reverse effects or verify task completion. Future text still requires a new exact review and verified idle native task.", reauthenticated: false });
      return { status: "requires-confirmation", confirmation, turn: view(turn), modelPromptSubmitted: false };
    },
    async resolveOutcome(c, { id, token }) {
      if (!uuid(token)) throw new Error("Use the exact one-use approval from reviewing this saved outcome.");
      const state = await store.snapshot(c), turn = state.codingTurns?.find((t) => t.id === id);
      if (!belongs(turn) || !unresolved.has(turn.status) || active(c, id)) throw new Error("The exact saved outcome is unavailable or still active.");
      const digest = scopeHash([turn, state.policy, state.mode, state.accounts]);
      const decision = await suiteConfirmations(store, c, undefined, now).consume({ action: adapter.resolveAction, sessionId: turn.sessionId, targetSnapshotId: scopeHash([`${provider}-text-outcome/v1`, c, id]), scopeDigest: digest, token });
      if (!decision.allowed) throw new Error(decision.reason);
      return store.update(c, "coding-text-outcome-review", (s) => { const t = s.codingTurns?.find((t) => t.id === id); if (!t || scopeHash([t, s.policy, s.mode, s.accounts]) !== digest || active(c, id)) throw new Error("The reviewed outcome or workspace changed. Saved context was preserved."); t.status = "reviewed-unconfirmed"; t.outcomeReviewedAt = now(); t.updatedAt = now(); adapter.recordOutcomeReview?.(s.codingSessions?.find(task => task.id === t.taskId), t); return { ...view(t), modelPromptSubmitted: false }; });
    },
    submit: (c, input) => submitText(c, input),
    submitRecovery: (c, input) => submitText(c, input, true),
    async cancel(c, requestId) {
      await store.snapshot(c);
      const entry = [...running.entries()].find(([key, r]) => key.startsWith(`${c}:`) && r.requestId === requestId);
      if (!entry) throw new Error("No exact owned text submission is active. No external task or provider was cancelled.");
      const resource = entry[1]; resource.cancelled = true; resource.controller.abort(); const stopped = await dispose(c, resource);
      return { status: stopped ? "owned-connection-stopped" : "stop-unconfirmed", taskCompletionVerified: false, originalEffectsReversed: false };
    },
    async remove(c, id) {
      return store.update(c, "coding-text-delete", (s) => { const t = s.codingTurns?.find((t) => t.id === id); if (!belongs(t) || unresolved.has(t.status) || t.ownedRuntime && t.ownedRuntimeStoppedVerified !== true) throw new Error("Only completed, failed-before-turn or deliberately resolved text records with verified owned process exit can be deleted."); s.codingTurns = s.codingTurns.filter((t) => t.id !== id); return { deleted: true }; });
    },
    stopCompartment,
    async close() { closed = true; return Promise.all([...new Set([...seen, ...[...running.keys()].map((key) => key.split(":")[0]), ...unconfirmed.keys()])].map((c) => stopCompartment(c))); }
  };
}
