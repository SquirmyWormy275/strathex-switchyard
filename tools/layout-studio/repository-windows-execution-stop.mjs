/** Separate one-use admission and receipt for cancelling one exact Windows Run. */
import { createHash } from "node:crypto";
import { DurableBudgetManager } from "../../packages/control-plane/src/budgets.ts";
import { OperationSagaStore } from "../../packages/control-plane/src/operations.ts";
import { ReceiptLedger } from "../../packages/control-plane/src/receipts.ts";
import { repositoryEffectJournal } from "./repository-effect-journal.mjs";
import { scopeHash, suiteConfirmations } from "./confirmations.mjs";
const uuid = value => typeof value === "string" && /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/.test(value);
const tokenHash = value => createHash("sha256").update(value).digest("hex");
const engine = "windows-sandbox", schema = "switchyard-windows-execution-stop/v1";
const budget = { version: "suite-windows-execution-stop/v1", commandClasses: { stop_managed_run: { maxConcurrent: 1, timeoutMs: 120000, maxAttempts: 1, windowMs: 3600000, maxClaimsPerWindow: 60, maxCostUnitsPerWindow: 60, defaultCostUnits: 1 } } };
const exited = row => Boolean(row && row.status !== "executing" && (row.nativeExitVerified === true || row.cleanupPending === false));
const nativeBinding = row => [row.operationId, row.scopeDigest, row.planDigest];
const view = row => ({ engine, stopId: row.stopId, requestId: row.requestId, originalOperationId: row.originalOperationId, targetSnapshotId: row.targetSnapshotId, scopeDigest: row.scopeDigest, status: row.status, expiresAt: row.expiresAt, result: row.result ?? null });

export function createWindowsExecutionStops({ store, runner, isActive = async () => true, reconcile = async () => {}, now = Date.now, sleep = ms => new Promise(resolve => setTimeout(resolve, ms)) } = {}) {
  const pending = new Map(), generations = new Map(); let closed = false;
  const current = (c, g) => { if (closed || g !== (generations.get(c) ?? 0)) throw Error("This exact Windows stop review was invalidated."); };
  const update = (c, id, action, fn) => store.update(c, action, state => { const row = state.repositoryExecutionStops?.find(row => row.engine === engine && row.stopId === id); if (!row) throw Error("The protected Windows stop record changed."); return fn(row); });
  async function exclusive(c, fn) { if (pending.has(c)) throw Error("Wait for this workspace's Windows stop admission."); const g = generations.get(c) ?? 0, operation = Promise.resolve().then(() => fn(g)); pending.set(c, operation); try { return await operation; } finally { if (pending.get(c) === operation) pending.delete(c); } }
  function ledgers(c, transaction) {
    const journal = transaction ? { transaction: fn => fn(transaction), readEntries: transaction.readEntries } : repositoryEffectJournal(store, c, { domain: "execution-stop", now });
    const clock = () => new Date(now()).toISOString(); return { journal, operations: new OperationSagaStore(journal, { clock }), budgets: new DurableBudgetManager(journal, { clock }), receipts: new ReceiptLedger(journal, { clock }) };
  }
  async function inspect(c, requestId, g) {
    current(c, g); if (!await isActive(c)) throw Error("Select the original Windows execution workspace before reviewing its stop.");
    const state = await store.snapshot(c), review = state.repositoryExecutionReviews?.find(row => row.engine === engine && row.requestId === requestId), run = state.repositoryWindowsRuns?.find(row => row.operationId === review?.operationId);
    if (!review?.admission || !run || run.scopeDigest !== review.scopeDigest || !["codex", "claude-code"].includes(run.provider) || exited(run)) throw Error("Choose one retained Windows Run with exact ownership and unconfirmed exit.");
    if (state.policy !== "personal" || state.mode !== "personal-companion") throw Error("Windows stop approval requires its permitted Personal companion workspace.");
    await store.authorize(c, { provider: run.provider });
    const workspace = scopeHash([state.policy, state.mode, state.modeSelectedAt ?? null, state.accounts, state.taskAuthorityEpoch ?? 0]);
    return { state, review, run, scopeDigest: scopeHash([schema, c, review.requestId, review.operationId, review.authorityId, review.sessionId, review.targetSnapshotId, review.admission, nativeBinding(run), workspace]) };
  }
  async function recover(c) {
    if (pending.has(c)) return;
    const { operations, budgets, receipts } = ledgers(c);
    for (const row of (await store.snapshot(c)).repositoryExecutionStops ?? []) {
      if (row.engine !== engine || !["executing", "outcome-unconfirmed"].includes(row.status)) continue;
      const state = await store.snapshot(c), run = state.repositoryWindowsRuns?.find(run => run.operationId === row.originalOperationId), original = state.repositoryExecutionReviews?.find(review => review.engine === engine && review.requestId === row.requestId);
      if (!exited(run) || scopeHash(nativeBinding(run)) !== row.nativeBindingDigest || scopeHash(original?.admission) !== row.originalAdmissionDigest) continue;
      const operation = await operations.get(row.stopId), receipt = operation?.details.receiptId ? await receipts.get(operation.details.receiptId) : undefined;
      const recorded = operation?.state === "recorded" && operation.action === "stop_managed_run" && receipt?.operationId === row.stopId && receipt.action === "stop_managed_run" && receipt.targetSnapshotId === row.scopeDigest && receipt.result === "passed" && receipt.completeness === "complete";
      if (operation && !["recorded", "failed", "cancelled"].includes(operation.state)) { if (operation.state === "external_committed") await operations.advance(row.stopId, "compensating"); await operations.advance(row.stopId, "failed", { commandStatus: "incomplete", recoveredWithoutReplay: "true" }); }
      for (const claim of await budgets.list()) if (claim.operationId === row.stopId && ["claimed", "running", "cancelling", "timed_out"].includes(claim.state)) await budgets.settle(claim.id, recorded ? "completed" : "failed", "Only exact Windows exit was recovered; no cancellation or worker was replayed.");
      await update(c, row.stopId, "windows-stop-exit-recovered", row => { row.status = "settled"; row.result = { status: recorded ? "completed" : "incomplete", effectDisposition: recorded ? "committed" : "ambiguous", operationId: row.stopId, originalOperationId: row.originalOperationId, ...(recorded ? { receiptId: receipt.id } : {}), stoppedVerified: true, originalAdmissionUnchanged: true, providerTaskCompletionVerified: false, recoveredWithoutReplay: true, summary: "Exact Windows exit was recovered independently. The original stop outcome and Run admission remain unchanged; no program was replayed." }; });
    }
  }
  return {
    recover,
    async review(c, input) { return exclusive(c, async g => {
      if (!input || Object.keys(input).some(key => !["compartment", "requestId", "stopId"].includes(key)) || !uuid(input.requestId) || !uuid(input.stopId)) throw Error("Review only one original Windows Run and a new stop UUID; PIDs, guest IDs and commands are not accepted.");
      const observed = await inspect(c, input.requestId, g); if (observed.state.repositoryExecutionStops?.some(row => row.stopId === input.stopId)) throw Error("This stop UUID already has a protected record.");
      const confirmation = await suiteConfirmations(store, c, observed.run.provider, now).issue({ action: "stop_managed_run", sessionId: observed.review.sessionId, authorityId: observed.review.authorityId, targetSnapshotId: observed.review.targetSnapshotId, scopeDigest: observed.scopeDigest, reason: "Cancel only this exact owned Windows Run. Independently verify native/VM exit; preserve its original admission and any unknown program outcome.", reauthenticated: false });
      const fresh = await inspect(c, input.requestId, g); if (fresh.scopeDigest !== observed.scopeDigest) throw Error("The exact Windows stop scope changed during review.");
      const row = { schema, engine, ...input, originalOperationId: fresh.run.operationId, targetSnapshotId: fresh.review.targetSnapshotId, sessionId: fresh.review.sessionId, authorityId: fresh.review.authorityId, provider: fresh.run.provider, nativeBindingDigest: scopeHash(nativeBinding(fresh.run)), originalAdmissionDigest: scopeHash(fresh.review.admission), scopeDigest: fresh.scopeDigest, tokenDigest: tokenHash(confirmation.token), status: "reviewed", expiresAt: confirmation.record.expiresAt };
      await store.update(c, "windows-stop-review", state => { const rows = state.repositoryExecutionStops ?? [], retained = rows.filter(row => ["executing", "outcome-unconfirmed"].includes(row.status) || row.status === "reviewed" && Date.parse(row.expiresAt) > now()); state.repositoryExecutionStops = [...retained, ...rows.filter(row => !retained.includes(row)).slice(-16)]; if (state.repositoryExecutionStops.length >= 64 || rows.some(row => row.stopId === input.stopId)) throw Error("The protected stop inventory is full or changed."); current(c, g); state.repositoryExecutionStops.push(row); });
      return { status: "requires-confirmation", review: view(row), confirmation, budget: budget.commandClasses.stop_managed_run };
    }); },
    async apply(c, input) { return exclusive(c, async g => {
      if (!input || Object.keys(input).some(key => !["compartment", "stopId", "token"].includes(key)) || !uuid(input.stopId) || !uuid(input.token)) throw Error("Apply only one exact Windows stop review and one-use approval.");
      const row = (await store.snapshot(c)).repositoryExecutionStops?.find(row => row.engine === engine && row.stopId === input.stopId); if (!row || row.tokenDigest !== tokenHash(input.token)) throw Error("The exact Windows stop approval is unavailable.");
      if (row.status !== "reviewed") return { ...(row.result ?? { status: "incomplete", effectDisposition: "ambiguous", summary: "The original Windows stop remains unconfirmed; no replay was attempted." }), replayed: true };
      const check = async () => { const checked = await inspect(c, row.requestId, g); if (checked.scopeDigest !== row.scopeDigest || scopeHash(checked.review.admission) !== row.originalAdmissionDigest) throw Error("The exact Windows stop scope changed."); return checked; };
      await check(); const approved = await suiteConfirmations(store, c, row.provider, now).consume({ action: "stop_managed_run", sessionId: row.sessionId, authorityId: row.authorityId, targetSnapshotId: row.targetSnapshotId, scopeDigest: row.scopeDigest, token: input.token }); if (!approved.allowed) throw Error(approved.reason);
      await update(c, row.stopId, "windows-stop-reserve", row => { current(c, g); if (row.status !== "reviewed") throw Error("This Windows stop already has a reservation."); row.status = "executing"; });
      const { journal, operations, budgets, receipts } = ledgers(c); let claimId, attempted = false, stoppedVerified = false, result;
      try {
        claimId = await journal.transaction(async transaction => { const { operations, budgets } = ledgers(c, transaction); await budgets.configure(budget); const begun = await operations.begin({ id: row.stopId, idempotencyKey: row.stopId, action: "stop_managed_run", targetSnapshotId: row.scopeDigest, details: { originalOperationId: row.originalOperationId, engine } }); if (begun.reused) throw Error("The exact stop operation already exists."); const claim = await budgets.claim({ operationId: row.stopId, commandClass: "stop_managed_run", requestedBy: "authenticated-exact-Windows-stop" }); if (!claim.allowed) throw Error(claim.reason); const started = await budgets.start(claim.claim.id); if (!started.allowed) throw Error(started.reason); await operations.advance(row.stopId, "executing"); return claim.claim.id; });
        await check(); const claim = await budgets.get(claimId); if (claim?.state !== "running" || Date.parse(claim.expiresAt) <= now()) throw Error("The Windows stop budget expired before cancellation.");
        attempted = true; const requested = await runner.stopOperation(c, row.originalOperationId); if (requested.accepted !== true) throw Error("The exact Windows cancellation was not accepted.");
        const wallDeadline = Date.now() + 120000;
        while (now() < Date.parse(claim.expiresAt) && Date.now() < wallDeadline) {
          current(c, g); await runner.recover(c); const state = await store.snapshot(c), run = state.repositoryWindowsRuns?.find(run => run.operationId === row.originalOperationId), original = state.repositoryExecutionReviews?.find(review => review.engine === engine && review.requestId === row.requestId);
          if (!run || scopeHash(nativeBinding(run)) !== row.nativeBindingDigest || scopeHash(original?.admission) !== row.originalAdmissionDigest) throw Error("The original Windows ownership or admission changed during cancellation.");
          if (exited(run)) { stoppedVerified = true; break; } await sleep(250);
        }
        if (!stoppedVerified || now() >= Date.parse(claim.expiresAt)) throw Error("Independent Windows exit did not verify within the stop budget.");
        const evidenceDigest = scopeHash([row.scopeDigest, row.nativeBindingDigest, "independently-verified-Windows-native-and-guest-exit"]); await operations.advance(row.stopId, "external_committed");
        const receipt = await receipts.issue({ operationId: row.stopId, action: "stop_managed_run", targetSnapshotId: row.scopeDigest, result: "passed", completeness: "complete", evidenceDigest, policyVersion: "suite-windows-execution-stop/v1", toolVersions: { guest: "switchyard-windows-sandbox-guest/v1" } }); await operations.advance(row.stopId, "recorded", { receiptId: receipt.id, commandStatus: "completed" }); await budgets.settle(claimId, "completed");
        result = { status: "completed", effectDisposition: "committed", operationId: row.stopId, originalOperationId: row.originalOperationId, receiptId: receipt.id, stoppedVerified: true, originalAdmissionUnchanged: true, providerTaskCompletionVerified: false, summary: "This exact Windows Run has independently verified native and guest exit. Its original admission and prior program effects remain unchanged." }; await reconcile(c);
      } catch {
        if (!attempted || stoppedVerified) { const operation = await operations.get(row.stopId); if (operation && !["recorded", "failed", "cancelled"].includes(operation.state)) { if (operation.state === "external_committed") await operations.advance(row.stopId, "compensating"); await operations.advance(row.stopId, "failed", { commandStatus: "incomplete" }); } if (claimId) await budgets.settle(claimId, "failed", "Windows stop did not finish its durable result; no replay is permitted."); }
        const original = (await store.snapshot(c)).repositoryExecutionReviews?.find(review => review.engine === engine && review.requestId === row.requestId);
        result = { status: "incomplete", effectDisposition: attempted ? "ambiguous" : "not_started", operationId: row.stopId, originalOperationId: row.originalOperationId, stoppedVerified, originalAdmissionUnchanged: scopeHash(original?.admission) === row.originalAdmissionDigest, providerTaskCompletionVerified: false, summary: "The exact Windows stop remains unconfirmed. Preserve its owners and original admission; cancellation cannot be replayed." };
      }
      await update(c, row.stopId, "windows-stop-result", row => { row.status = result.status === "completed" ? "settled" : "outcome-unconfirmed"; row.result = result; }); return { ...result, replayed: false };
    }); },
    async list(c) { return ((await store.snapshot(c)).repositoryExecutionStops ?? []).filter(row => row.engine === engine).map(view); },
    async stopCompartment(c) { generations.set(c, (generations.get(c) ?? 0) + 1); await Promise.allSettled([pending.get(c)].filter(Boolean)); },
    async close() { closed = true; for (const c of pending.keys()) generations.set(c, (generations.get(c) ?? 0) + 1); await Promise.allSettled(pending.values()); }
  };
}
