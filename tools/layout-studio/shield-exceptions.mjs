/** Personal operator reviews for exceptions to exact protected findings. */
import { createHash } from "node:crypto";
import { DurableBudgetManager } from "../../packages/control-plane/src/budgets.ts";
import { ReceiptLedger } from "../../packages/control-plane/src/receipts.ts";
import { stableJson } from "../../packages/control-plane/src/store.ts";
import { repositoryEffectJournal, repositoryEffectTransaction } from "./repository-effect-journal.mjs";
import { ShieldExceptionLedger, validateException, exceptionReason } from "./shield-exception-ledger.mjs";
import { validationActions, validationPolicyDigest } from "./repository-validation-policy.mjs";
import { linuxShieldActions } from "./repository-execution-actions.mjs";
import { suiteConfirmations, scopeHash } from "./confirmations.mjs";

const action = "configure_shield_exceptions", version = "switchyard-shield-exception-review/v1";
const uuid = value => typeof value === "string" && /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/.test(value);
const digest = value => typeof value === "string" && /^[a-f0-9]{64}$/.test(value);
const exact = (value, fields) => value && typeof value === "object" && !Array.isArray(value) && Object.keys(value).sort().join() === fields.slice().sort().join();
const sha = value => createHash("sha256").update(value).digest("hex");
const workspace = state => scopeHash([state.id, state.policy, state.mode, state.modeSelectedAt ?? null, state.accounts]);
const limits = { version, commandClasses: { [action]: { maxConcurrent: 1, timeoutMs: 120000, maxAttempts: 1, windowMs: 3600000, maxClaimsPerWindow: 24, maxCostUnitsPerWindow: 24, defaultCostUnits: 1 } } };
const view = row => ({ requestId: row.requestId, action: row.action, summary: row.summary, scopeDigest: row.scopeDigest, receiptInvalidation: row.receiptInvalidation, status: row.status, expiresAt: row.expiresAt, result: row.result ?? null });

export function createShieldExceptions({ store, authority, isActive = async () => true, now = Date.now } = {}) {
  const pending = new Map(), generations = new Map(); let closed = false;
  const journal = c => repositoryEffectJournal(store, c, { domain: "shield-policy", now });
  const ledger = c => new ShieldExceptionLedger(journal(c), { now });
  const receipts = c => new ReceiptLedger(repositoryEffectJournal(store, c, { domain: "execution", now }), { clock: () => new Date(now()).toISOString() });
  async function state(c) { const current = await store.snapshot(c); if (closed || current.policy !== "personal" || current.mode !== "personal-companion" || !await isActive(c)) throw Error("Select an active Personal companion workspace for reviewed finding exceptions; Work and task content cannot grant overrides."); return current; }
  async function guard(c, current, expected, generation, lease) { lease.assert(); if (closed || generation !== (generations.get(c) ?? 0) || current.id !== c || workspace(current) !== expected || current.policy !== "personal" || current.mode !== "personal-companion" || !await isActive(c)) throw Error("The exact reviewed exception workspace changed or was stopped."); lease.assert(); }
  async function exclusive(c, fn) {
    await state(c); if (pending.has(c)) throw Error("Wait for this workspace's exact exception review or application.");
    const generation = generations.get(c) ?? 0, work = store.withResourceLock("repository-execution", scopeHash([version, c]), lease => fn(generation, lease)); pending.set(c, work);
    try { return await work; } finally { if (pending.get(c) === work) pending.delete(c); }
  }
  async function source(c, receiptId, fingerprint) {
    if (typeof receiptId !== "string" || receiptId.length > 160 || !digest(fingerprint)) throw Error("Select one protected source receipt and exact finding fingerprint.");
    const current = await state(c), row = current.repositoryExecutionReviews?.find(row => row.outcome?.receiptId === receiptId), receipt = await receipts(c).get(receiptId);
    if (!row || !linuxShieldActions.includes(row.action) || !receipt || receipt.result !== "failed" || receipt.completeness !== "incomplete" || receipt.invalidatedBy || !receipt.expiresAt || Date.parse(receipt.expiresAt) <= now() || receipt.operationId !== row.operationId || receipt.action !== row.action || receipt.targetSnapshotId !== row.targetSnapshotId) throw Error("Use a still-current protected failed finding receipt; expired or retired evidence needs a new scan.");
    const report = row.outcome.data?.shieldReport, envelope = row.outcome.data?.receiptEvidenceEnvelope, finding = report?.findings?.find(finding => finding.fingerprint === fingerprint);
    if (!finding || report.schema !== "switchyard-shield-findings/v1" || report.engine !== "switchyard-baseline-scanner/1" || report.action !== row.action || report.outcome !== "failed" || report.completeness !== "incomplete" || report.requestSha256 !== row.shield?.requestSha256 || envelope?.evidenceDigest !== receipt.evidenceDigest || envelope.targetSnapshotId !== receipt.targetSnapshotId || envelope.operationId !== receipt.operationId || envelope.action !== receipt.action || envelope.evidence?.toolVersions?.scannerSource !== `sha256:${row.shield?.engineSha256}` || envelope.evidence.resultSha256 !== sha(JSON.stringify(report)) || envelope.evidence.outputSha256 !== envelope.evidence.resultSha256) throw Error("The protected source finding, report or scanner binding is unavailable.");
    const { authenticationTag, evidenceDigest, ...unsigned } = envelope;
    if (sha(stableJson(unsigned)) !== evidenceDigest || !digest(authenticationTag) || envelope.producer !== "repository-runtime" || envelope.outcome !== "incomplete" || envelope.completeness !== "incomplete" || envelope.expiresAt !== receipt.expiresAt || envelope.policyVersion !== receipt.policyVersion) throw Error("The original host-authenticated evidence digest changed.");
    const resolved = await authority.resolve(c, row.authorityId, row.action);
    if (resolved.snapshot.id !== row.targetSnapshotId) throw Error("The original finding target changed; scan the current target before reviewing an exception.");
    const fresh = await receipts(c).get(receiptId);
    if (!fresh || fresh.hash !== receipt.hash || fresh.invalidatedBy || Date.parse(fresh.expiresAt) <= now()) throw Error("The source receipt expired or was retired during review.");
    return { action: row.action, targetSnapshotId: row.targetSnapshotId, scannerSourceSha256: row.shield.engineSha256, sourceReceiptId: receipt.id, fingerprint, ruleId: finding.ruleId, path: finding.path };
  }
  async function prepare(c, input, applying = false) {
    if (!uuid(input?.requestId) || !["grant", "revoke"].includes(input.action)) throw Error("Review one exact finding-exception request and action.");
    const keys = input.action === "grant" ? ["sourceReceiptId", "fingerprint", "reason", "expiresAt"] : ["exceptionId", "reason"];
    if (!exact(input, ["requestId", "action", ...keys, ...(Object.hasOwn(input, "compartment") ? ["compartment"] : [])])) throw Error("Finding exceptions accept only their closed operator fields; broad, task and approval overrides are refused.");
    if (input.action === "grant") return validateException({ ...await source(c, input.sourceReceiptId, input.fingerprint), reason: input.reason, expiresAt: input.expiresAt }, now(), { minimumLifetimeMs: applying ? 1 : 60000 });
    if (!uuid(input.exceptionId) || !(await ledger(c).list()).some(record => record.id === input.exceptionId && record.status !== "revoked")) throw Error("Choose one exact retained exception for withdrawal.");
    return { exceptionId: input.exceptionId, reason: exceptionReason(input.reason) };
  }
  return {
    async list(c) { const current = await state(c); return { exceptions: await ledger(c).list(), reviews: (current.shieldExceptionReviews ?? []).map(view), authorityGranted: false, completeShieldGateAvailable: false }; },
    async review(c, input) { input = structuredClone(input); return exclusive(c, async (generation, lease) => {
      const current = await state(c); if (current.shieldExceptionReviews?.some(row => row.requestId === input.requestId)) throw Error("The original exception review is retained; it cannot be replaced.");
      const policyDigest = validationPolicyDigest(current), payload = await prepare(c, input), latest = await state(c);
      if (validationPolicyDigest(latest) !== policyDigest || workspace(latest) !== workspace(current)) throw Error("The exact exception policy or workspace changed during review.");
      const receiptInvalidation = { actions: [...validationActions], scope: "all-prior-validation-receipts-in-this-workspace", beforePolicyEffect: true }, workspaceDigest = workspace(current), scopeDigest = scopeHash([version, c, input, payload, policyDigest, workspaceDigest, receiptInvalidation]);
      const confirmation = await suiteConfirmations(store, c, undefined, now).issue({ action, targetSnapshotId: scopeDigest, scopeDigest, reason: "Apply only this exact finding exception or withdrawal with its displayed reason and expiry. Retire prior pipeline/Shield receipts in this workspace. Missing coverage stays incomplete; no execution, provider or merge authority is granted.", reauthenticated: false });
      const row = { schema: version, requestId: input.requestId, action: input.action, proposal: input, payload, summary: payload, policyDigest, workspaceDigest, receiptInvalidation, scopeDigest, tokenDigest: sha(confirmation.token), expiresAt: confirmation.record.expiresAt, status: "reviewed" };
      await store.update(c, "shield-exception-review", async saved => { await guard(c, saved, workspaceDigest, generation, lease); if (validationPolicyDigest(saved) !== policyDigest) throw Error("The reviewed exception policy changed."); const rows = saved.shieldExceptionReviews ?? [], held = rows.filter(row => row.status === "reviewed" && Date.parse(row.expiresAt) > now()); saved.shieldExceptionReviews = [...held, ...rows.filter(row => !held.includes(row)).slice(-16)]; if (saved.shieldExceptionReviews.length >= 64 || saved.shieldExceptionReviews.some(old => old.requestId === row.requestId)) throw Error("The exception review inventory is full or changed."); saved.shieldExceptionReviews.push(row); });
      return { status: "requires-confirmation", review: view(row), confirmation, budget: limits.commandClasses[action], authorityGranted: false };
    }); },
    async apply(c, input) { if (!exact(input, ["requestId", "token", ...(Object.hasOwn(input ?? {}, "compartment") ? ["compartment"] : [])]) || !uuid(input.requestId) || !uuid(input.token)) throw Error("Apply only one exact exception review and its one-use approval."); return exclusive(c, async (generation, lease) => {
      const current = await state(c), row = current.shieldExceptionReviews?.find(row => row.requestId === input.requestId);
      if (!row || row.schema !== version || row.tokenDigest !== sha(input.token)) throw Error("The exact exception approval is unavailable.");
      if (row.status !== "reviewed") return { ...row.result, replayed: true, authorityGranted: false };
      await guard(c, current, row.workspaceDigest, generation, lease);
      if (Date.parse(row.expiresAt) <= now() || validationPolicyDigest(current) !== row.policyDigest || scopeHash(await prepare(c, row.proposal, true)) !== scopeHash(row.payload)) throw Error("The exact exception approval, source finding or policy changed; obtain a new review.");
      const approved = await suiteConfirmations(store, c, undefined, now).consume({ action, targetSnapshotId: row.scopeDigest, scopeDigest: row.scopeDigest, token: input.token }); if (!approved.allowed) throw Error(approved.reason);
      return store.update(c, "shield-exception-apply", async saved => {
        await guard(c, saved, row.workspaceDigest, generation, lease); const original = saved.shieldExceptionReviews?.find(candidate => candidate.requestId === row.requestId);
        if (!original || original.status !== "reviewed" || validationPolicyDigest(saved) !== row.policyDigest || Date.parse(row.expiresAt) <= now()) throw Error("The consumed exception review changed before policy commit; it was not replayed.");
        const port = domain => { const transaction = repositoryEffectTransaction(saved, domain, { now }); return { readEntries: transaction.readEntries, transaction: fn => fn(transaction) }; }, policy = port("shield-policy"), clock = () => new Date(now()).toISOString(), budgets = new DurableBudgetManager(policy, { clock }), receipts = new ReceiptLedger(policy, { clock });
        if (row.action === "grant") {
          const source = await new ReceiptLedger(port("execution"), { clock }).get(row.payload.sourceReceiptId);
          if (!source || source.invalidatedBy || source.result !== "failed" || source.targetSnapshotId !== row.payload.targetSnapshotId || source.action !== row.payload.action || !source.expiresAt || Date.parse(source.expiresAt) <= now()) throw Error("The original source receipt expired or was retired before atomic policy commit.");
        }
        await budgets.configure(limits); const claim = await budgets.claim({ operationId: row.requestId, commandClass: action, requestedBy: "authenticated-personal-exception-review" }); if (!claim.allowed) throw Error(claim.reason); const started = await budgets.start(claim.claim.id); if (!started.allowed) throw Error(started.reason);
        const by = `suite:${c}:review:${row.requestId}`; await new ReceiptLedger(port("execution"), { clock }).invalidateActions(validationActions, by);
        const exceptions = new ShieldExceptionLedger(policy, { now }), effect = row.action === "grant" ? await exceptions.grant(row.payload, by, row.requestId) : await exceptions.revoke(row.payload.exceptionId, row.payload.reason, by);
        const receipt = await receipts.issue({ operationId: row.requestId, action, targetSnapshotId: row.scopeDigest, result: "passed", completeness: "complete", evidenceDigest: scopeHash([row.scopeDigest, effect]), policyVersion: version, toolVersions: { exceptions: "exact-expiring-finding/v1" }, ...(row.action === "grant" ? { expiresAt: row.payload.expiresAt } : {}) });
        await receipts.audit({ action, status: "completed", operationId: row.requestId, targetSnapshotId: row.scopeDigest, detail: `Applied exact ${row.action} with reviewed reason: ${row.payload.reason}` }); await budgets.settle(claim.claim.id, "completed"); await guard(c, saved, row.workspaceDigest, generation, lease);
        original.status = "settled"; original.result = { status: "completed", effectDisposition: "committed", operationId: row.requestId, receiptId: receipt.id, maintenanceAction: row.action, exceptionId: effect.id, authorityGranted: false, completeShieldGateAvailable: false }; return { ...original.result, replayed: false };
      });
    }); },
    async evaluate(c, input) { await state(c); return ledger(c).evaluate(input); },
    async stopCompartment(c) { generations.set(c, (generations.get(c) ?? 0) + 1); await Promise.allSettled([pending.get(c)].filter(Boolean)); return { stopped: true }; },
    async close() { for (const c of pending.keys()) await this.stopCompartment(c); closed = true; }
  };
}
