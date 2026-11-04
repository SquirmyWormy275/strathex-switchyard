/** Separate operator recovery bookkeeping; never manufactures a commit receipt. */
import { OperationSagaStore } from "../../packages/control-plane/src/operations.ts";
import { DurableBudgetManager } from "../../packages/control-plane/src/budgets.ts";
import { ReceiptLedger } from "../../packages/control-plane/src/receipts.ts";
import { repositoryEffectJournal } from "./repository-effect-journal.mjs";
const terminal = s => ["recorded", "failed", "cancelled"].includes(s);
export const recoveryBudget = { version: "suite-repository-recovery/v1", commandClasses: { repository_recovery: { maxConcurrent: 1, timeoutMs: 120000, maxAttempts: 1, windowMs: 3600000, maxClaimsPerWindow: 20, maxCostUnitsPerWindow: 20, defaultCostUnits: 1 } } };
export function recoveryLedger(store, c, provider, now = Date.now) {
  const journal = repositoryEffectJournal(store, c, { provider, now, domain: "recovery" }), clock = () => new Date(now()).toISOString();
  const operations = new OperationSagaStore(journal, { clock }), budgets = new DurableBudgetManager(journal, { clock }), receipts = new ReceiptLedger(journal, { clock });
  const assertRunning = async claimId => { const claim = await budgets.get(claimId); if (!claim || claim.state !== "running" || Date.parse(claim.expiresAt) <= now()) throw new Error("The exact recovery budget deadline expired or its running claim changed. Preserve remaining files and obtain a fresh review."); };
  return {
    assertRunning,
    async reserve(review) {
      await budgets.configure(recoveryBudget);
      // Only a new, separately approved observation may close an interrupted
      // metadata recovery. It never resumes that recovery's filesystem writes.
      for (const op of await operations.list()) if (op.details.repositoryEffectId === review.effectId && !terminal(op.state)) {
        if (op.state === "external_committed") await operations.advance(op.id, "compensating");
        await operations.advance(op.id, "failed", { commandStatus: "incomplete", recoveredWithoutReceipt: "true" });
        for (const claim of await budgets.list()) if (claim.operationId === op.id && ["claimed", "running", "cancelling", "timed_out"].includes(claim.state)) await budgets.settle(claim.id, "failed", "Interrupted metadata recovery observed; no replay.");
      }
      const begun = await operations.begin({ id: review.id, idempotencyKey: review.id, action: "repository_recovery", targetSnapshotId: review.scopeDigest, details: { repositoryEffectId: review.effectId } });
      if (begun.reused) throw new Error("This recovery generation already exists; filesystem writes cannot be replayed.");
      const claim = await budgets.claim({ operationId: review.id, commandClass: "repository_recovery", requestedBy: "operator-exact-scope-approval" });
      if (!claim.allowed) { await operations.advance(review.id, "failed"); throw new Error(claim.reason); }
      const started = await budgets.start(claim.claim.id); if (!started.allowed) throw new Error(started.reason);
      await operations.advance(review.id, "executing"); return claim.claim.id;
    },
    async finish(review, claimId, evidenceDigest, complete) {
      await assertRunning(claimId);
      const op = await operations.get(review.id);
      if (!op || op.state !== "executing") throw new Error("The exact recovery operation is no longer executing.");
      await operations.advance(review.id, "external_committed", { meaning: "Owned repository metadata reconciliation only; original commit outcome unchanged" });
      const receipt = await receipts.issue({ operationId: review.id, action: "repository_recovery", targetSnapshotId: review.scopeDigest, result: complete ? "passed" : "incomplete", completeness: complete ? "complete" : "incomplete", evidenceDigest, policyVersion: "suite-repository-recovery/v1", toolVersions: { host: "descriptor-bound-filesystem/v1" } });
      await operations.advance(review.id, "recorded", { receiptId: receipt.id }); await budgets.settle(claimId, "completed"); return receipt;
    }
  };
}
export async function settleOriginalRepositoryOperation(store, c, record, committed, now = Date.now) {
  const journal = repositoryEffectJournal(store, c, { provider: record.provider, now }), clock = () => new Date(now()).toISOString(), operations = new OperationSagaStore(journal, { clock });
  const root = await operations.get(record.id); if (!root) return { present: false };
  for (const child of await operations.list()) if (child.parentId === root.id && !terminal(child.state) && child.action === "git.local-commit") {
    if (child.details.repositoryRoot !== record.repositoryRoot || child.details.beforeHead !== record.preservation.beforeHead || child.details.expectedTree !== record.preservation.expectedTree) throw new Error("The original child operation does not match this exact preservation packet.");
    const details = { operatorRecoveryObserved: "true", originalReceiptUnchanged: "true" };
    if (committed) {
      if (child.state === "prepared") await operations.advance(child.id, "executing", details);
      if ((await operations.get(child.id)).state === "executing") await operations.advance(child.id, "external_committed", details);
      await operations.advance(child.id, "recorded", details);
    } else {
      // A prior external-commit witness and current old HEAD conflict. Keep
      // that child unresolved rather than guessing historical non-execution.
      if (!["prepared", "executing", "cancelling"].includes(child.state)) throw new Error("Historical commit evidence conflicts with the original HEAD; manual review is required.");
      if (child.state === "executing") await operations.advance(child.id, "cancelling", details);
      await operations.advance(child.id, "cancelled", details);
    }
  }
  await operations.settleRecoveredParents({ rootOperationId: root.id });
  const settled = await operations.get(root.id);
  if (!terminal(settled.state)) throw new Error("Other children of this original operation remain unresolved; preserve its recovery state.");
  for (const lease of await operations.activeLeases()) if (lease.operationId === root.id) await operations.releaseLease(lease.id, lease.holder);
  const budgets = new DurableBudgetManager(journal, { clock });
  for (const claim of await budgets.list()) if (claim.operationId === root.id && ["claimed", "running", "cancelling", "timed_out"].includes(claim.state)) await budgets.settle(claim.id, "failed", "Operator reconciled exact repository metadata; original command result and receipts unchanged.");
  return { present: true, state: settled.state, originalReceiptUnchanged: true };
}
