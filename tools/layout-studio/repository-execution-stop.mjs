/** One-use operator approval to stop one exact host-owned execution. */
import { createHash } from "node:crypto";
import { DurableBudgetManager } from "../../packages/control-plane/src/budgets.ts";
import { OperationSagaStore } from "../../packages/control-plane/src/operations.ts";
import { ReceiptLedger } from "../../packages/control-plane/src/receipts.ts";
import { repositoryEffectJournal } from "./repository-effect-journal.mjs";
import { scopeHash, suiteConfirmations } from "./confirmations.mjs";

const uuid = value => typeof value === "string" && /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/.test(value);
const tokenHash = value => createHash("sha256").update(value).digest("hex");
const workspace = state => scopeHash([state.policy, state.mode, state.modeSelectedAt ?? null, state.accounts, state.taskAuthorityEpoch ?? 0]);
const budget = { version: "suite-execution-stop/v1", commandClasses: { stop_managed_run: { maxConcurrent: 1, timeoutMs: 15000, maxAttempts: 1, windowMs: 3600000, maxClaimsPerWindow: 60, maxCostUnitsPerWindow: 60, defaultCostUnits: 1 } } };
const view = row => ({ stopId: row.stopId, requestId: row.requestId, originalOperationId: row.originalOperationId, managedProcessId: row.managedProcessId, targetSnapshotId: row.targetSnapshotId, scopeDigest: row.scopeDigest, status: row.status, expiresAt: row.expiresAt, result: row.result ?? null });

export function createRepositoryExecutionStops({ store, supervisors, isActive = async () => true, reconcile = async () => {}, now = Date.now } = {}) {
  const pending = new Map(), generations = new Map();
  let closed = false;
  const current = (compartment, generation) => {
    if (closed || generation !== (generations.get(compartment) ?? 0)) throw Error("This reviewed execution stop was invalidated.");
  };
  async function exclusive(compartment, fn) {
    if (pending.has(compartment)) throw Error("Wait for this workspace's current execution stop review.");
    const generation = generations.get(compartment) ?? 0;
    const operation = Promise.resolve().then(() => fn(generation));
    pending.set(compartment, operation);
    try { return await operation; }
    finally { if (pending.get(compartment) === operation) pending.delete(compartment); }
  }
  async function update(compartment, stopId, action, fn) {
    return store.update(compartment, action, state => {
      const row = state.repositoryExecutionStops?.find(row => row.stopId === stopId);
      if (!row) throw Error("The protected execution stop review changed.");
      return fn(row);
    });
  }
  function scope(compartment, state, run, native) {
    return scopeHash(["switchyard-execution-stop/v1", compartment, run.requestId, run.operationId, run.sessionId, run.authorityId, run.targetSnapshotId, run.manifestSha256, native.supervisorId, native.commandDigest, native.ownedRuntime, workspace(state)]);
  }
  async function inspect(compartment, requestId, generation) {
    current(compartment, generation);
    if (!await isActive(compartment)) throw Error("Select this workspace before reviewing its owned execution stop.");
    const state = await store.snapshot(compartment);
    const run = state.repositoryExecutionReviews?.find(row => row.requestId === requestId);
    const native = state.repositoryExecutions?.find(row => row.operationId === run?.operationId);
    if (!run || !native?.ownedRuntime || !run.outcome || !["codex", "claude-code"].includes(native.provider)) throw Error("Choose an exact protected execution with its native ownership identity.");
    if (state.policy !== "personal" || state.mode !== "personal-companion") throw Error("Reviewed execution stop requires this permitted Personal companion workspace.");
    await store.authorize(compartment, { provider: native.provider });
    if (!await supervisors.canStop(compartment, native.operationId)) throw Error("This host has no live exact execution handle. Observe retained ownership; no PID-based substitute or replay is available.");
    current(compartment, generation);
    return { state, run, native, scopeDigest: scope(compartment, state, run, native) };
  }
  function ledger(compartment) {
    const journal = repositoryEffectJournal(store, compartment, { domain: "execution-stop", now });
    const clock = () => new Date(now()).toISOString();
    return { operations: new OperationSagaStore(journal, { clock }), budgets: new DurableBudgetManager(journal, { clock }), receipts: new ReceiptLedger(journal, { clock }) };
  }
  async function recover(compartment) {
    if (pending.has(compartment)) return;
    const { operations, budgets, receipts } = ledger(compartment);
    for (const row of (await store.snapshot(compartment)).repositoryExecutionStops ?? []) {
      if (!["executing", "outcome-unconfirmed"].includes(row.status)) continue;
      const state = await store.snapshot(compartment), native = state.repositoryExecutions?.find(native => native.operationId === row.originalOperationId), original = state.repositoryExecutionReviews?.find(run => run.requestId === row.requestId);
      if (native?.stoppedVerified !== true || scopeHash([native.supervisorId, native.commandDigest, native.ownedRuntime]) !== row.nativeBindingDigest || scopeHash(original?.outcome) !== row.originalOutcomeDigest) continue;
      const operation = await operations.get(row.stopId), receipt = operation?.details.receiptId ? await receipts.get(operation.details.receiptId) : undefined;
      const recorded = operation?.state === "recorded" && operation.action === "stop_managed_run" && receipt?.operationId === row.stopId && receipt.action === "stop_managed_run" && receipt.targetSnapshotId === row.scopeDigest && receipt.result === "passed" && receipt.completeness === "complete";
      if (operation && !["recorded", "failed", "cancelled"].includes(operation.state)) {
        if (operation.state === "external_committed") await operations.advance(row.stopId, "compensating");
        await operations.advance(row.stopId, "failed", { commandStatus: "incomplete", recoveredWithoutReplay: "true" });
      }
      for (const claim of await budgets.list()) if (claim.operationId === row.stopId && ["claimed", "running", "cancelling", "timed_out"].includes(claim.state)) await budgets.settle(claim.id, recorded ? "completed" : "failed", "Observed independent exit after an interrupted stop; no stop or program was replayed.");
      await update(compartment, row.stopId, "repository-execution-stop-recovered", currentRow => {
        currentRow.status = "settled";
        currentRow.result = { status: recorded ? "completed" : "incomplete", effectDisposition: recorded ? "committed" : "ambiguous", operationId: row.stopId, originalOperationId: row.originalOperationId, ...(recorded ? { receiptId: receipt.id } : {}), stoppedVerified: true, originalOutcomeUnchanged: true, providerTaskCompletionVerified: false, recoveredWithoutReplay: true, summary: recorded ? "The protected stop receipt and independently verified exit were recovered without another stop." : "Native exit is verified; the interrupted stop's original outcome remains unconfirmed. No stop or program was replayed." };
      });
    }
  }
  return {
    recover,
    async review(compartment, input) {
      return exclusive(compartment, async generation => {
        if (Object.keys(input).some(key => !["compartment", "requestId", "stopId"].includes(key)) || !uuid(input.requestId) || !uuid(input.stopId)) throw Error("Review one original execution request and one new stop UUID; commands and process IDs are not accepted.");
        const observed = await inspect(compartment, input.requestId, generation);
        if (observed.state.repositoryExecutionStops?.some(row => row.stopId === input.stopId)) throw Error("This protected stop request already exists; inspect its retained result.");
        const confirmation = await suiteConfirmations(store, compartment, observed.native.provider, now).issue({ action: "stop_managed_run", sessionId: observed.run.sessionId, authorityId: observed.run.authorityId, targetSnapshotId: observed.run.targetSnapshotId, scopeDigest: observed.scopeDigest, reason: "Stop only this exact owned execution. Prior program effects are not rolled back, and unknown program results remain unknown.", reauthenticated: false });
        const fresh = await inspect(compartment, input.requestId, generation);
        if (fresh.scopeDigest !== observed.scopeDigest) throw Error("The exact execution or workspace changed during stop review.");
        const row = { schema: "switchyard-execution-stop/v1", ...input, originalOperationId: fresh.run.operationId, managedProcessId: fresh.native.supervisorId, targetSnapshotId: fresh.run.targetSnapshotId, sessionId: fresh.run.sessionId, authorityId: fresh.run.authorityId, provider: fresh.native.provider, scopeDigest: fresh.scopeDigest, nativeBindingDigest: scopeHash([fresh.native.supervisorId, fresh.native.commandDigest, fresh.native.ownedRuntime]), tokenDigest: tokenHash(confirmation.token), originalOutcomeDigest: scopeHash(fresh.run.outcome), status: "reviewed", expiresAt: confirmation.record.expiresAt };
        await store.update(compartment, "repository-execution-stop-review", state => {
          const rows = state.repositoryExecutionStops ?? [], retained = rows.filter(row => ["executing", "outcome-unconfirmed"].includes(row.status) || row.status === "reviewed" && Date.parse(row.expiresAt) > now());
          state.repositoryExecutionStops = [...retained, ...rows.filter(row => !retained.includes(row)).slice(-16)];
          if (state.repositoryExecutionStops.length >= 64 || state.repositoryExecutionStops.some(row => row.stopId === input.stopId)) throw Error("The protected stop inventory is full or changed; prior evidence was preserved.");
          current(compartment, generation);
          state.repositoryExecutionStops.push(row);
        });
        return { status: "requires-confirmation", review: view(row), confirmation, budget: budget.commandClasses.stop_managed_run };
      });
    },
    async apply(compartment, input) {
      return exclusive(compartment, async generation => {
        if (Object.keys(input).some(key => !["compartment", "stopId", "token"].includes(key)) || !uuid(input.stopId) || !uuid(input.token)) throw Error("Apply one exact stop review and its one-use approval.");
        const row = (await store.snapshot(compartment)).repositoryExecutionStops?.find(row => row.stopId === input.stopId);
        if (!row || row.tokenDigest !== tokenHash(input.token)) throw Error("The exact execution stop approval is unavailable.");
        if (row.status !== "reviewed") return { ...(row.result ?? { status: "incomplete", effectDisposition: "ambiguous", summary: "The prior stop outcome remains unconfirmed; no stop was replayed." }), replayed: true };
        const check = async () => {
          const observed = await inspect(compartment, row.requestId, generation);
          if (observed.scopeDigest !== row.scopeDigest || scopeHash(observed.run.outcome) !== row.originalOutcomeDigest) throw Error("The exact reviewed stop or workspace scope changed.");
          return observed;
        };
        await check();
        const approved = await suiteConfirmations(store, compartment, row.provider, now).consume({ action: "stop_managed_run", sessionId: row.sessionId, authorityId: row.authorityId, targetSnapshotId: row.targetSnapshotId, scopeDigest: row.scopeDigest, token: input.token });
        if (!approved.allowed) throw Error(approved.reason);
        await update(compartment, row.stopId, "repository-execution-stop-reserve", currentRow => {
          current(compartment, generation);
          if (currentRow.status !== "reviewed") throw Error("This stop approval was already reserved.");
          currentRow.status = "executing";
        });
        const { operations, budgets, receipts } = ledger(compartment);
        let claimId, effectAttempted = false, stoppedVerified = false, result;
        try {
          await budgets.configure(budget);
          const begun = await operations.begin({ id: row.stopId, idempotencyKey: row.stopId, action: "stop_managed_run", targetSnapshotId: row.scopeDigest, details: { originalOperationId: row.originalOperationId, managedProcessId: row.managedProcessId } });
          if (begun.reused) throw Error("This protected stop operation already exists; it cannot be replayed.");
          const claimed = await budgets.claim({ operationId: row.stopId, commandClass: "stop_managed_run", requestedBy: "authenticated-exact-stop-review" });
          if (!claimed.allowed) throw Error(claimed.reason);
          claimId = claimed.claim.id;
          const started = await budgets.start(claimId);
          if (!started.allowed) throw Error(started.reason);
          await operations.advance(row.stopId, "executing");
          const before = await check(), claim = await budgets.get(claimId);
          if (claim?.state !== "running" || Date.parse(claim.expiresAt) <= now()) throw Error("The exact stop budget expired before the effect.");
          effectAttempted = true;
          const stopped = await supervisors.stopOperation(compartment, row.originalOperationId);
          stoppedVerified = stopped.accepted === true;
          await reconcile(compartment);
          const state = await store.snapshot(compartment), original = state.repositoryExecutionReviews?.find(run => run.requestId === row.requestId);
          if (scopeHash(original?.outcome) !== row.originalOutcomeDigest) throw Error("The original admission outcome changed; preserve both stop and program evidence.");
          if (!stoppedVerified || Date.parse(claim.expiresAt) <= now()) throw Error("The exact stop did not verify native exit within its budget; prior outcomes remain preserved.");
          const evidenceDigest = scopeHash([row.scopeDigest, before.native.ownedRuntime, before.native.commandDigest, "independently-verified-native-exit"]);
          await operations.advance(row.stopId, "external_committed");
          const receipt = await receipts.issue({ operationId: row.stopId, action: "stop_managed_run", targetSnapshotId: row.scopeDigest, result: "passed", completeness: "complete", evidenceDigest, policyVersion: "suite-reviewed-execution-stop/v1", toolVersions: { nativeGuardian: "switchyard-runtime-command/v1" } });
          await operations.advance(row.stopId, "recorded", { receiptId: receipt.id, commandStatus: "completed" });
          await budgets.settle(claimId, "completed");
          result = { status: "completed", effectDisposition: "committed", operationId: row.stopId, originalOperationId: row.originalOperationId, receiptId: receipt.id, stoppedVerified: true, originalOutcomeUnchanged: true, providerTaskCompletionVerified: false, summary: "The exact owned execution has independently verified exit. Prior program effects and unknown program results remain preserved." };
        } catch {
          if (!effectAttempted || stoppedVerified) {
            const operation = await operations.get(row.stopId);
            if (operation && !["recorded", "failed", "cancelled"].includes(operation.state)) {
              if (operation.state === "external_committed") await operations.advance(row.stopId, "compensating");
              await operations.advance(row.stopId, "failed", { commandStatus: "incomplete", originalOutcomeUnchanged: "true" });
            }
            if (claimId) await budgets.settle(claimId, "failed", "The reviewed stop did not finish its durable result; no replay is permitted.");
          }
          const original = (await store.snapshot(compartment)).repositoryExecutionReviews?.find(run => run.requestId === row.requestId);
          result = { status: "incomplete", effectDisposition: effectAttempted ? "ambiguous" : "not_started", operationId: row.stopId, originalOperationId: row.originalOperationId, stoppedVerified, originalOutcomeUnchanged: scopeHash(original?.outcome) === row.originalOutcomeDigest, providerTaskCompletionVerified: false, summary: "The exact stop result is unconfirmed. Preserve its ownership and prior program outcome; no automatic replay is permitted." };
        }
        await update(compartment, row.stopId, "repository-execution-stop-result", currentRow => {
          currentRow.status = result.status === "completed" ? "settled" : "outcome-unconfirmed";
          currentRow.result = result;
        });
        return { ...result, replayed: false };
      });
    },
    async list(compartment) { return ((await store.snapshot(compartment)).repositoryExecutionStops ?? []).map(view); },
    async stopCompartment(compartment) {
      generations.set(compartment, (generations.get(compartment) ?? 0) + 1);
      await Promise.allSettled([pending.get(compartment)].filter(Boolean));
    },
    async close() { closed = true; for (const compartment of pending.keys()) generations.set(compartment, (generations.get(compartment) ?? 0) + 1); await Promise.allSettled(pending.values()); }
  };
}
