/** Receipt-time policy binding shared by the Linux and Windows execution hosts. */
import { ReceiptLedger } from "../../packages/control-plane/src/receipts.ts";
import { repositoryEffectJournal } from "./repository-effect-journal.mjs";
import { linuxPipelineActions, linuxShieldActions } from "./repository-execution-actions.mjs";
import { scopeHash } from "./confirmations.mjs";
import { assertTaskAuthorityReceiptState } from "./task-authority.mjs";

export const validationActions = Object.freeze([...linuxPipelineActions, ...linuxShieldActions]);

export function validationPolicyDigest(state) {
  if (state.scannerFixtureReviews?.some(row => row.status === "applying" || row.status === "outcome-unconfirmed" && row.maintenanceStoppedVerified !== true)) throw Error("Settle or reconcile the exact signed fixture maintenance operation before validation can establish evidence.");
  return scopeHash(["switchyard-validation-policy/v1",
    (state.scannerFixtureJournal ?? []).filter(entry => entry.kind.startsWith("b122.scanner-")),
    (state.shieldExceptionJournal ?? []).filter(entry => entry.kind.startsWith("shield.exception-")),
    (state.repositoryExecutionJournal ?? []).filter(entry => entry.kind === "receipt.actions-invalidated").map(entry => entry.hash)]);
}

export const validationReceiptGuard = (expected, review, now = Date.now) => async (state, receipt) => {
  if (!validationActions.includes(receipt.action)) return;
  if (!/^[a-f0-9]{64}$/.test(expected ?? "") || validationPolicyDigest(state) !== expected) throw Error("The reviewed validation policy changed before the protected receipt commit; no current gate is established.");
  if (review) await assertTaskAuthorityReceiptState(state, review, receipt, now);
};

/** Historical results are displayed separately from present receipt validity. */
export async function validationReceiptStatus(store, compartment, row, now = Date.now) {
  const id = row.outcome?.receiptId;
  if (!id) return null;
  const receipt = await new ReceiptLedger(repositoryEffectJournal(store, compartment, { domain: "execution", now })).get(id);
  if (!receipt || receipt.operationId !== row.operationId || receipt.action !== row.action || receipt.targetSnapshotId !== row.targetSnapshotId) throw Error("The exact protected execution receipt is unavailable or changed.");
  return { id, historicalResult: receipt.result, completeness: receipt.completeness, invalidatedBy: receipt.invalidatedBy ?? null,
    expiresAt: receipt.expiresAt ?? null, expired: receipt.expiresAt ? Date.parse(receipt.expiresAt) <= now() : false,
    scopeRevalidated: false, gateEligible: false };
}
