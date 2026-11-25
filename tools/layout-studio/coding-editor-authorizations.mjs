/** One-use, reviewed permission for an exact editor launch. This service launches nothing. */
import { createHash, randomUUID } from "node:crypto";
import { suiteConfirmations } from "./confirmations.mjs";

const uuid = value => typeof value === "string" && /^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/.test(value);
const digest = value => createHash("sha256").update(JSON.stringify(value)).digest("hex");
const field = "codingEditorAuthorizations";
const selectionFields = ["ownerRequestId", "loadRequestId", "requestId", "editorId"];
function selection(input, extra = []) {
  if (!input || typeof input !== "object" || Array.isArray(input) || Object.keys(input).sort().join() !== [...selectionFields, ...extra].sort().join() || ![...selectionFields, ...extra].every(key => uuid(input[key]))) throw Error("Use the exact editor, owner, load and authorization UUIDs without unrelated fields.");
  return Object.freeze(Object.fromEntries(selectionFields.map(key => [key, input[key]])));
}
const view = row => ({ requestId: row.requestId, editorId: row.editorId, ownerRequestId: row.ownerRequestId, loadRequestId: row.loadRequestId, status: row.status,
  terminalLaunchAuthorized: false, terminalLaunched: false, ideAttached: false, modelPromptSubmitted: false, completionVerified: false });

export function createCodingEditorAuthorizations({ store, owners, isActive = async () => true, now = Date.now } = {}) {
  let closed = false; const pending = new Set();
  const current = async c => { if (closed || !await isActive(c)) throw Error("The original editor workspace is no longer active."); await store.authorize(c, { provider: "codex" }); if (closed) throw Error("Editor authorization stopped."); };
  const policy = state => digest([state.policy, state.mode, state.accounts]);
  async function capture(c, selected, returning = false) {
    await current(c);
    const observation = await owners[returning ? "editorReturnTarget" : "editorTarget"](c, { ownerRequestId: selected.ownerRequestId, loadRequestId: selected.loadRequestId });
    await current(c); const state = await store.snapshot(c);
    if (observation?.metadataObserved !== true || observation.nativeLoadAcknowledged !== true || observation.authorityGranted !== false || observation.terminalLaunched !== false || observation.ideAttached !== false || observation.modelPromptSubmitted !== false || observation.completionVerified !== false || observation.nativeTaskLoaded !== false || observation.targetDigest !== digest(observation.target) || observation.target.ownerRequestId !== selected.ownerRequestId || observation.target.loadRequestId !== selected.loadRequestId || !uuid(observation.target.taskId) || !uuid(observation.target.sessionId) || observation.target.permissions !== "read-only/on-request") throw Error("The exact acknowledged editor target is unavailable.");
    const result = { target: structuredClone(observation.target), targetDigest: observation.targetDigest, policyDigest: policy(state) };
    await current(c); return result;
  }
  const scope = (c, selected, observed) => ({ action: "launch_codex_editor", sessionId: observed.target.sessionId,
    targetSnapshotId: digest(["switchyard-editor-launch/v1", c, selected]), scopeDigest: digest([observed.targetDigest, observed.policyDigest, "read-only/on-request", "no-model-turn"]) });
  async function recheck(c, selected, observed) { if (digest(await capture(c, selected)) !== digest(observed)) throw Error("The reviewed editor target or policy changed."); }
  function track(fn) { const operation = fn(); pending.add(operation); operation.then(() => pending.delete(operation), () => pending.delete(operation)); return operation; }
  function retained(state, selected) {
    const row = state[field]?.find(row => row.requestId === selected.requestId);
    if (row && digest(Object.fromEntries(selectionFields.map(key => [key, row[key]]))) !== digest(selected)) throw Error("This editor request UUID already belongs to another exact selection.");
    return row;
  }
  return {
    review(c, input) { const selected = selection(input); return track(async () => {
      const observed = await capture(c, selected);
      if (retained(await store.snapshot(c), selected)) throw Error("This editor request already has a retained authorization; it cannot be reissued.");
      await store.claimSession(c, { provider: "codex", sessionId: observed.target.sessionId });
      const confirmation = await suiteConfirmations(store, c, "codex", now).issue({ ...scope(c, selected, observed), reason: "Open this exact saved task in this editor instance with read-only/on-request permissions. This grants no model turn, write permission or verified task completion.", reauthenticated: false });
      await recheck(c, selected, observed);
      return { status: "requires-confirmation", selection: selected, target: observed.target, confirmation, terminalLaunchAuthorized: false, terminalLaunched: false, ideAttached: false, modelPromptSubmitted: false, completionVerified: false };
    }); },
    issue(c, input) { const selected = selection(input, ["token"]), token = input.token; return track(async () => {
      await current(c); const prior = retained(await store.snapshot(c), selected);
      if (prior) return { ...view(prior), duplicatePrevented: true };
      const observed = await capture(c, selected);
      return store.withResourceLock("coding-task", `${c}:${observed.target.taskId}`, async lease => {
        await recheck(c, selected, observed); lease.assert();
        const duplicate = retained(await store.snapshot(c), selected); if (duplicate) return { ...view(duplicate), duplicatePrevented: true };
        const expected = scope(c, selected, observed), decision = await suiteConfirmations(store, c, "codex", now).consume({ ...expected, token });
        if (!decision.allowed) throw Error(decision.reason);
        await recheck(c, selected, observed); lease.assert();
        const permit = randomUUID(), createdAt = now(), expiresAt = createdAt + 30000;
        const row = { schema: "switchyard-editor-authorization/v1", ...selected, taskId: observed.target.taskId, targetDigest: observed.targetDigest, policyDigest: observed.policyDigest, scopeDigest: digest(expected), permitDigest: digest(permit), status: "issued", createdAt, expiresAt };
        await store.update(c, "coding-editor-authorization-issue", state => {
          if (closed || policy(state) !== observed.policyDigest || retained(state, selected)) throw Error("The editor authorization changed before reservation."); lease.assert();
          const rows = state[field] ??= []; if (rows.length >= 64) throw Error("Editor authorization history is full; retained no-replay records are preserved."); rows.push(row);
        }, { provider: "codex" });
        await recheck(c, selected, observed); lease.assert();
        return { ...view(row), permit, expiresAt, targetDigest: row.targetDigest };
      });
    }); },
    consume(c, input) { const selected = selection(input, ["permit"]), permit = input.permit; return track(async () => {
      const observed = await capture(c, selected);
      return store.withResourceLock("coding-task", `${c}:${observed.target.taskId}`, async lease => {
        await recheck(c, selected, observed); lease.assert();
        const row = retained(await store.snapshot(c), selected);
        if (!row || row.schema !== "switchyard-editor-authorization/v1" || row.permitDigest !== digest(permit) || row.taskId !== observed.target.taskId || row.targetDigest !== observed.targetDigest || row.policyDigest !== observed.policyDigest || row.scopeDigest !== digest(scope(c, selected, observed))) throw Error("The original reviewed editor authorization does not match.");
        if (row.status === "consumed") return { ...view(row), duplicatePrevented: true };
        if (row.status !== "issued" || !Number.isSafeInteger(row.createdAt) || row.expiresAt !== row.createdAt + 30000 || now() < row.createdAt || now() >= row.expiresAt) throw Error("The original editor authorization expired or changed.");
        await recheck(c, selected, observed); lease.assert();
        await store.update(c, "coding-editor-authorization-consume", state => {
          const saved = retained(state, selected);
          if (closed || policy(state) !== observed.policyDigest || digest(saved) !== digest(row) || now() < row.createdAt || now() >= row.expiresAt) throw Error("The editor authorization changed before consumption."); lease.assert();
          saved.status = "consumed"; saved.consumedAt = now();
        }, { provider: "codex" });
        // A lost or refused final reply leaves the permit spent. No retry can
        // manufacture a second terminal effect from this authorization.
        await recheck(c, selected, observed); lease.assert();
        if (now() >= row.expiresAt || now() < row.createdAt) throw Error("The consumed editor authorization expired before delivery.");
        return { ...view({ ...row, status: "consumed" }), terminalLaunchAuthorized: true, target: observed.target, targetDigest: observed.targetDigest, expiresAt: row.expiresAt };
      });
    }); },
    returnTarget(c, input) { const selected = selection(input); return track(async () => {
      await current(c);
      const original = retained(await store.snapshot(c), selected);
      if (!original || original.schema !== "switchyard-editor-authorization/v1" || original.status !== "consumed" || !uuid(original.taskId)
          || !Number.isSafeInteger(original.createdAt) || original.expiresAt !== original.createdAt + 30000
          || !Number.isSafeInteger(original.consumedAt) || original.consumedAt < original.createdAt || original.consumedAt >= original.expiresAt || now() < original.consumedAt) throw Error("Return requires the original consumed editor authorization.");
      return store.withResourceLock("coding-task", `${c}:${original.taskId}`, async lease => {
        const observed = await capture(c, selected, true); lease.assert();
        const matches = async () => {
          await current(c); const state = await store.snapshot(c), saved = retained(state, selected); lease.assert();
          if (closed || digest(saved) !== digest(original) || original.taskId !== observed.target.taskId || original.targetDigest !== observed.targetDigest || original.policyDigest !== observed.policyDigest || policy(state) !== observed.policyDigest || original.scopeDigest !== digest(scope(c, selected, observed)) || now() < original.consumedAt) throw Error("The original consumed editor selection or policy changed.");
        };
        await matches();
        if (digest(await capture(c, selected, true)) !== digest(observed)) throw Error("The original editor return target changed.");
        await matches();
        // Expiry bounds the original creation only. This read grants no new
        // permission, does not resume the task and does not mutate the journal.
        return { target: observed.target, targetDigest: observed.targetDigest, metadataObserved: true, nativeLoadAcknowledged: true,
          nativeTaskLoaded: false, authorityGranted: false, terminalLaunched: false, ideAttached: false, modelPromptSubmitted: false, completionVerified: false };
      });
    }); },
    async close() { closed = true; await Promise.allSettled([...pending]); }
  };
}
