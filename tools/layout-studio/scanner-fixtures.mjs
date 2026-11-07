/** Compartment-local operator maintenance for signed, non-executable evidence feeds. */
import { createHash } from "node:crypto";
import { join, isAbsolute } from "node:path";
import { DurableScannerFixtureRegistry, inspectScannerFixtureTrust } from "../../apps/windows-companion/src/scanner-fixtures.ts";
import { DurableBudgetManager } from "../../packages/control-plane/src/budgets.ts";
import { OperationSagaStore } from "../../packages/control-plane/src/operations.ts";
import { ReceiptLedger } from "../../packages/control-plane/src/receipts.ts";
import { repositoryEffectJournal } from "./repository-effect-journal.mjs";
import { validationActions } from "./repository-validation-policy.mjs";
import { suiteConfirmations, scopeHash } from "./confirmations.mjs";

const action = "configure_scanner_fixtures", version = "suite-scanner-fixtures/v2";
// Preserve the original cross-process kernel lease across the review upgrade.
const legacyVersion = "suite-scanner-fixtures/v1";
const uuid = v => typeof v === "string" && /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/.test(v);
const identifier = v => typeof v === "string" && /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/.test(v);
const digest = v => typeof v === "string" && /^[a-f0-9]{64}$/.test(v);
const hash = v => createHash("sha256").update(v).digest("hex");
const exact = (v, keys) => v && typeof v === "object" && !Array.isArray(v) && Object.keys(v).sort().join() === keys.slice().sort().join();
const workspace = s => scopeHash([s.id, s.policy, s.mode, s.modeSelectedAt ?? null, s.accounts]);
const limits = { version, commandClasses: { [action]: { maxConcurrent: 1, timeoutMs: 120000, maxAttempts: 1, windowMs: 3600000, maxClaimsPerWindow: 24, maxCostUnitsPerWindow: 24, defaultCostUnits: 1 } } };
const view = r => ({ requestId: r.requestId, action: r.action, scopeDigest: r.scopeDigest, summary: r.summary, receiptInvalidation: r.receiptInvalidation ?? null, status: r.status, expiresAt: r.expiresAt, result: r.result ?? null });

export function createScannerFixtures({ store, stateDirectory, isActive = async () => true, now = Date.now } = {}) {
  if (typeof stateDirectory !== "string" || !isAbsolute(stateDirectory)) throw Error("Use the fixed private scanner-fixture state directory.");
  const pending = new Map(), generations = new Map(), seen = new Set(); let closed = false;
  const journal = (c, guard) => repositoryEffectJournal(store, c, { domain: "fixtures", now, guard });
  const registry = (c, guard) => new DurableScannerFixtureRegistry(journal(c, guard), join(stateDirectory, c), () => new Date(now()));
  const registryDigest = async c => scopeHash((await journal(c).readEntries()).filter(e => e.kind.startsWith("b122.scanner-")));
  function ledger(port) { const clock = () => new Date(now()).toISOString(); return { operations: new OperationSagaStore(port, { clock }), budgets: new DurableBudgetManager(port, { clock }), receipts: new ReceiptLedger(port, { clock }) }; }
  async function state(c, requireMode = true) {
    const current = await store.snapshot(c);
    if (closed || current.policy !== "personal" || requireMode && current.mode !== "personal-companion" || !await isActive(c)) throw Error("Select an active Personal companion workspace for signed fixture maintenance; Work and task authority cannot approve it.");
    seen.add(c); return current;
  }
  async function exclusive(c, fn) {
    await state(c); if (pending.has(c)) throw Error("Wait for this workspace's exact fixture maintenance operation.");
    const generation = generations.get(c) ?? 0, work = Promise.resolve().then(() => store.withResourceLock("repository-execution", scopeHash([legacyVersion, stateDirectory, c]), lease => fn(generation, lease)));
    pending.set(c, work); try { return await work; } finally { if (pending.get(c) === work) pending.delete(c); }
  }
  async function assertState(c, current, row, generation, lease) {
    lease.assert(); if (closed || generation !== (generations.get(c) ?? 0) || current.id !== c || current.policy !== "personal" || current.mode !== "personal-companion" || workspace(current) !== row.workspaceDigest || !await isActive(c)) throw Error("The exact reviewed fixture workspace changed or was stopped.");
    lease.assert();
  }
  const update = (c, id, event, fn) => store.update(c, event, s => {
    const row = s.scannerFixtureReviews?.find(r => r.requestId === id); if (!row || ![version, legacyVersion].includes(row.schema)) throw Error("The protected fixture review changed."); return fn(row, s);
  });
  async function proposal(c, input) {
    if (!uuid(input?.requestId) || typeof input.action !== "string") throw Error("Review one exact fixture maintenance action and request UUID.");
    const keys = { "install-trust": ["policy"], "install-fixture": ["manifestPath"], "revoke-trust": ["authorityId", "keyId", "reason"], "revoke-fixture": ["fixtureId", "reason"], "remove-fixture": ["fixtureId", "reason"] }[input.action];
    if (!keys || !exact(input, ["requestId", "action", ...keys, ...(Object.hasOwn(input, "compartment") ? ["compartment"] : [])])) throw Error("Fixture maintenance accepts only its closed operator fields; task, shell and approval overrides are refused.");
    const r = registry(c);
    if (input.action === "install-trust") {
      const policy = inspectScannerFixtureTrust(input.policy, new Date(now()));
      if ((await r.listTrust()).some(t => t.authorityId === policy.authorityId && t.status === "active")) throw Error("This fixture authority is already active; revoke it deliberately before replacement.");
      return { payload: { policy }, summary: { authorityId: policy.authorityId, keyId: policy.keyId, allowedKinds: policy.allowedKinds, expiresAt: policy.expiresAt } };
    }
    if (input.action === "install-fixture") {
      if (typeof input.manifestPath !== "string" || input.manifestPath.length > 4096 || !isAbsolute(input.manifestPath) || /[\x00-\x1f\x7f]/.test(input.manifestPath)) throw Error("Choose an exact absolute signed fixture manifest path.");
      if (process.platform === "win32" && !/^[A-Za-z]:[\\/]/.test(input.manifestPath)) throw Error("Select a local drive manifest path; UNC and device-namespace paths are outside fixture maintenance.");
      const inspected = await r.inspectFixture(input.manifestPath), m = inspected.manifest;
      if ((await r.storageUsage()).allocations.some(f => f.id === m.id) || (await r.listFixtures()).some(f => f.id === m.id)) throw Error("The original fixture identity is already retained; it cannot be replaced in place.");
      return { payload: { manifestPath: inspected.sourcePath, manifestSha256: inspected.manifestSha256 }, summary: { id: m.id, kind: m.kind, authorityId: m.authorityId, keyId: m.keyId, feedVersion: m.feedVersion, toolName: m.toolName, toolVersion: m.toolVersion, contentSha256: m.contentSha256, contentBytes: inspected.contentBytes, storageBytes: inspected.contentBytes + inspected.manifestBytes, manifestSha256: inspected.manifestSha256, generatedAt: m.generatedAt, expiresAt: m.expiresAt } };
    }
    if (typeof input.reason !== "string" || !input.reason.trim() || input.reason.length > 512 || /[\x00-\x1f\x7f]/.test(input.reason)) throw Error("Provide a bounded single-line fixture revocation reason.");
    if (input.action === "revoke-trust") {
      if (!identifier(input.authorityId) || !digest(input.keyId) || !(await r.listTrust()).some(t => t.authorityId === input.authorityId && t.keyId === input.keyId && t.status === "active")) throw Error("Choose the exact active fixture authority and public key.");
      return { payload: { authorityId: input.authorityId, keyId: input.keyId, reason: input.reason }, summary: { authorityId: input.authorityId, keyId: input.keyId, reason: input.reason } };
    }
    if (input.action === "remove-fixture") {
      if (!identifier(input.fixtureId)) throw Error("Choose the exact retained fixture allocation.");
      const snapshot = await r.inspectRemoval(input.fixtureId);
      return { payload: { snapshot, reason: input.reason }, summary: { fixtureId: input.fixtureId, reason: input.reason, manifestSha256: snapshot.manifestSha256, contentSha256: snapshot.contentSha256, remainingFiles: snapshot.files.map(({ name, bytes, sha256 }) => ({ name, bytes, sha256 })), originalDirectoryAbsent: snapshot.rootIdentity === null, reconcilesPriorRemoval: snapshot.originalRemovalSha256 !== null } };
    }
    if (!identifier(input.fixtureId) || !(await r.listFixtures()).some(f => f.id === input.fixtureId && f.status === "active")) throw Error("Choose the exact active signed fixture.");
    return { payload: { fixtureId: input.fixtureId, reason: input.reason }, summary: { fixtureId: input.fixtureId, reason: input.reason } };
  }
  async function recover(c) {
    const initial = await store.snapshot(c), rows = initial.scannerFixtureReviews ?? [];
    if (!rows.some(r => ["applying", "outcome-unconfirmed"].includes(r.status))) return { stopped: true, recoveredWithoutReplay: true };
    if (initial.policy !== "personal") throw Error("Preserve unfamiliar fixture ownership outside Personal policy.");
    if (pending.has(c)) return { stopped: false, recoveredWithoutReplay: true };
    const observed = await store.tryWithResourceLock("repository-execution", scopeHash([legacyVersion, stateDirectory, c]), async lease => {
      for (const row of (await store.snapshot(c)).scannerFixtureReviews ?? []) {
        if (!["applying", "outcome-unconfirmed"].includes(row.status)) continue;
        if (![version, legacyVersion].includes(row.schema) || !uuid(row.requestId) || !digest(row.scopeDigest)) throw Error("Preserve an unfamiliar original fixture maintenance record.");
        lease.assert();
        await journal(c).transaction(async transaction => {
          const { operations, budgets } = ledger({ transaction: fn => fn(transaction), readEntries: transaction.readEntries }), op = await operations.get(row.requestId);
          if (op && (op.action !== action || op.targetSnapshotId !== row.scopeDigest)) throw Error("The original fixture operation scope changed.");
          if (op && !["recorded", "failed", "cancelled"].includes(op.state)) { if (op.state === "external_committed") await operations.advance(row.requestId, "compensating"); await operations.advance(row.requestId, "failed", { commandStatus: "incomplete" }); }
          for (const claim of await budgets.list(action)) if (claim.operationId === row.requestId && ["claimed", "running", "cancelling", "timed_out"].includes(claim.state)) await budgets.settle(claim.id, "failed", "The original host filesystem operation no longer holds its kernel lease; its effect outcome is not upgraded.");
        });
        await update(c, row.requestId, "scanner-fixture-host-exit-observed", saved => {
          saved.maintenanceStoppedVerified = true; saved.recoveredWithoutReplay = true;
          if (saved.status === "applying") { saved.status = "outcome-unconfirmed"; saved.result ??= { status: "incomplete", effectDisposition: "ambiguous", operationId: row.requestId, authorityGranted: false, summary: "The original host operation stopped without a retained result; no fixture action was replayed." }; }
        });
      }
      return { stopped: true, recoveredWithoutReplay: true };
    });
    return observed.acquired ? observed.value : { stopped: false, recoveredWithoutReplay: true };
  }
  return {
    recover,
    async list(c) {
      await state(c, false); const r = registry(c);
      return { storage: await r.storageUsage(), trusts: (await r.listTrust()).map(({ publicKeyPem, ...metadata }) => metadata), fixtures: (await r.listFixtures()).map(({ packageRoot, ...metadata }) => metadata), reviews: ((await store.snapshot(c)).scannerFixtureReviews ?? []).map(view), authorityGranted: false };
    },
    async review(c, input) {
      input = structuredClone(input); await recover(c);
      return exclusive(c, async (generation, lease) => {
        const current = await state(c); if (current.scannerFixtureReviews?.some(r => r.requestId === input.requestId)) throw Error("This exact fixture request already has a retained review; no replacement.");
        const before = await registryDigest(c), prepared = await proposal(c, input);
        if (await registryDigest(c) !== before) throw Error("The installed fixture/trust registry changed during review.");
        const receiptInvalidation = { actions: [...validationActions], scope: "all-prior-validation-receipts-in-this-workspace", beforeRegistryEffect: true };
        const workspaceDigest = workspace(current), scopeDigest = scopeHash([version, c, input.requestId, input.action, workspaceDigest, before, prepared, receiptInvalidation]);
        const row = { schema: version, requestId: input.requestId, action: input.action, ...prepared, receiptInvalidation, workspaceDigest, registryDigest: before, scopeDigest, status: "reviewed", at: now() };
        await assertState(c, await state(c), row, generation, lease);
        const confirmation = await suiteConfirmations(store, c, undefined, now).issue({ action, targetSnapshotId: scopeDigest, scopeDigest, reason: `Apply only this ${input.action} to this workspace's signed evidence registry. Invalidate all prior pipeline and Shield receipts in this workspace before the registry effect. Public trust is operator-selected; no task/provider authority, executable or scan result is granted.`, reauthenticated: false });
        row.tokenDigest = hash(confirmation.token); row.expiresAt = confirmation.record.expiresAt;
        await store.update(c, "scanner-fixture-review", async saved => {
          await assertState(c, saved, row, generation, lease); const rows = saved.scannerFixtureReviews ?? [], retained = rows.filter(r => ["applying", "outcome-unconfirmed"].includes(r.status) || r.status === "reviewed" && Date.parse(r.expiresAt) > now());
          saved.scannerFixtureReviews = [...retained, ...rows.filter(r => !retained.includes(r)).slice(-16)]; if (saved.scannerFixtureReviews.length >= 64 || saved.scannerFixtureReviews.some(r => r.requestId === row.requestId)) throw Error("The retained fixture review inventory is full or changed."); saved.scannerFixtureReviews.push(row);
        });
        return { status: "requires-confirmation", review: view(row), confirmation, budget: limits.commandClasses[action], authorityGranted: false };
      });
    },
    async apply(c, input) {
      if (!exact(input, ["requestId", "token", ...(Object.hasOwn(input ?? {}, "compartment") ? ["compartment"] : [])]) || !uuid(input.requestId) || !uuid(input.token)) throw Error("Apply only one exact fixture review and its one-use approval.");
      await recover(c);
      return exclusive(c, async (generation, lease) => {
        const current = await state(c), row = current.scannerFixtureReviews?.find(r => r.requestId === input.requestId);
        if (!row || row.schema !== version || row.tokenDigest !== hash(input.token)) throw Error("The exact fixture approval is unavailable.");
        if (row.status !== "reviewed") return { ...(row.result ?? { status: "incomplete", effectDisposition: "ambiguous", operationId: row.requestId }), replayed: true, authorityGranted: false };
        if (!Number.isFinite(Date.parse(row.expiresAt)) || Date.parse(row.expiresAt) <= now()) throw Error("The exact fixture approval expired; review the current state again.");
        let claimDeadline;
        const guard = async current => { await assertState(c, current, row, generation, lease); if (claimDeadline !== undefined && now() >= claimDeadline) throw Error("The original fixture maintenance budget expired; no passing effect acknowledgement is permitted."); };
        const check = async () => guard(await state(c)); await check();
        if (await registryDigest(c) !== row.registryDigest) throw Error("The installed trust/fixture state changed after review; create a new review.");
        if (row.action === "install-fixture") {
          const selected = await registry(c).inspectFixture(row.payload.manifestPath); if (selected.manifestSha256 !== row.payload.manifestSha256) throw Error("The exact signed fixture changed after review.");
        }
        if (row.action === "remove-fixture" && scopeHash(await registry(c).inspectRemoval(row.payload.snapshot.id)) !== scopeHash(row.payload.snapshot)) throw Error("The exact reviewed removal files changed; preserve them and obtain a fresh review.");
        const approved = await suiteConfirmations(store, c, undefined, now).consume({ action, targetSnapshotId: row.scopeDigest, scopeDigest: row.scopeDigest, token: input.token }); if (!approved.allowed) throw Error(approved.reason);
        await update(c, row.requestId, "scanner-fixture-admit", async (saved, latest) => { await guard(latest); if (saved.status !== "reviewed") throw Error("The fixture request was already admitted."); saved.status = "applying"; });
        const protectedJournal = journal(c, guard), unguarded = journal(c); let attempted = false, effect, claimId, result;
        try {
          claimId = await protectedJournal.transaction(async transaction => {
            const { operations, budgets } = ledger({ transaction: fn => fn(transaction), readEntries: transaction.readEntries });
            await budgets.configure(limits); const begun = await operations.begin({ id: row.requestId, idempotencyKey: row.requestId, action, targetSnapshotId: row.scopeDigest, details: { maintenanceAction: row.action } }); if (begun.reused) throw Error("The original fixture operation cannot be replayed.");
            const claim = await budgets.claim({ operationId: row.requestId, commandClass: action, requestedBy: "authenticated-personal-fixture-review" }); if (!claim.allowed) throw Error(claim.reason); const started = await budgets.start(claim.claim.id); if (!started.allowed) throw Error(started.reason); await operations.advance(row.requestId, "executing"); return claim.claim.id;
          });
          await check(); const claim = await ledger(unguarded).budgets.get(claimId); if (claim?.state !== "running" || Date.parse(claim.expiresAt) <= now()) throw Error("The exact fixture maintenance budget expired before effect.");
          claimDeadline = Date.parse(claim.expiresAt); await check();
          const r = registry(c, guard), by = `suite:${c}:review:${row.requestId}`; attempted = true;
          await new ReceiptLedger(repositoryEffectJournal(store, c, { domain: "execution", now, guard }), { clock: () => new Date(now()).toISOString() }).invalidateActions(validationActions, by);
          await check();
          if (row.action === "install-trust") effect = await r.installTrust(row.payload.policy, by);
          else if (row.action === "install-fixture") effect = await r.installFixture(row.payload.manifestPath, by, row.payload.manifestSha256);
          else if (row.action === "revoke-trust") { await r.revokeTrust(row.payload.authorityId, row.payload.keyId, row.payload.reason, by); effect = { authorityId: row.payload.authorityId, keyId: row.payload.keyId, status: "revoked" }; }
          else if (row.action === "remove-fixture") { await r.removeFixture(row.payload.snapshot, row.payload.reason, by, check); effect = { id: row.payload.snapshot.id, status: "removed", priorRemovalReconciled: row.payload.snapshot.originalRemovalSha256 !== null }; }
          else { await r.revokeFixture(row.payload.fixtureId, row.payload.reason, by); effect = { id: row.payload.fixtureId, status: "revoked" }; }
          await update(c, row.requestId, "scanner-fixture-effect-observed", saved => { saved.observedEffect = effect; }); await check();
          const receipt = await protectedJournal.transaction(async transaction => {
            const { operations, budgets, receipts } = ledger({ transaction: fn => fn(transaction), readEntries: transaction.readEntries }); await operations.advance(row.requestId, "external_committed");
            const receipt = await receipts.issue({ operationId: row.requestId, action, targetSnapshotId: row.scopeDigest, result: "passed", completeness: "complete", evidenceDigest: scopeHash([row.scopeDigest, effect]), policyVersion: version, toolVersions: { registry: "signed-p256-fixture/v1" } });
            await operations.advance(row.requestId, "recorded", { receiptId: receipt.id, commandStatus: "completed" }); await budgets.settle(claimId, "completed"); return receipt;
          });
          result = { status: "completed", effectDisposition: "committed", operationId: row.requestId, receiptId: receipt.id, maintenanceAction: row.action, authorityGranted: false };
        } catch {
          // A file reservation or journal append may have completed before its
          // acknowledgement was lost. Preserve it; never reinstall or erase it.
          result = { status: "incomplete", effectDisposition: attempted ? "ambiguous" : "not_started", operationId: row.requestId, authorityGranted: false, summary: "Preserve the exact fixture review, protected journal and any reserved package; this maintenance operation was not replayed." };
          if (!attempted) {
            const { operations, budgets } = ledger(unguarded), op = await operations.get(row.requestId);
            if (op && !["failed", "recorded", "cancelled"].includes(op.state)) await operations.advance(row.requestId, "failed", { commandStatus: "incomplete" });
            // Admission may have committed before its acknowledgement was lost.
            // This attempt never dispatched a file effect; settle only its own
            // durable claims, including a claim whose ID was not returned.
            for (const claim of await budgets.list(action)) if (claim.operationId === row.requestId && ["claimed", "running", "cancelling", "timed_out"].includes(claim.state)) await budgets.settle(claim.id, "failed");
          }
        }
        await update(c, row.requestId, "scanner-fixture-result", saved => { saved.status = result.status === "completed" || result.effectDisposition === "not_started" ? "settled" : "outcome-unconfirmed"; saved.result = result; });
        return { ...result, replayed: false };
      });
    },
    async resolve(c, input) {
      const initial = await state(c), before = await registryDigest(c); const result = await registry(c).resolve(input);
      if (workspace(await state(c)) !== workspace(initial) || await registryDigest(c) !== before) throw Error("The fixture evidence workspace or installed registry changed during resolution."); return result;
    },
    async readSources(c, input) {
      const initial = await state(c), before = await registryDigest(c), result = await registry(c).readResolvedContent(input);
      try {
        if (workspace(await state(c)) !== workspace(initial) || await registryDigest(c) !== before) throw Error("The draft feed workspace or installed registry changed while reading.");
        return result;
      } catch (error) { for (const item of result) item.bytes.fill(0); throw error; }
    },
    async stopCompartment(c) { generations.set(c, (generations.get(c) ?? 0) + 1); await Promise.allSettled([pending.get(c)].filter(Boolean)); return { stopped: true }; },
    async close() { if (closed) return; for (const c of seen) await this.stopCompartment(c); closed = true; }
  };
}
