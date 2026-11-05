/** Studio Windows Run admission through the shared policy/checkpoint/budget ledgers. */
import { createHash } from "node:crypto";
import { basename, join, relative } from "node:path";
import { DurableMediatedExecutor } from "../../packages/control-plane/src/runtime.ts";
import { InMemoryExecutionBroker } from "../../packages/control-plane/src/brokers.ts";
import { commandForAction } from "../../packages/control-plane/src/command-catalog.ts";
import { NodeFileDigestReader } from "../../packages/control-plane/src/git-inspector.ts";
import { redactText } from "../../packages/control-plane/src/redaction.ts";
import { createDurableAbortControl } from "../../apps/windows-companion/src/execution-cancellation.ts";
import { repositoryRuntimeExecutionRecipe } from "../../apps/windows-companion/src/repository-runtime-broker.ts";
import { repositoryEffectJournal } from "./repository-effect-journal.mjs";
import { validationPolicyDigest, validationReceiptGuard, validationReceiptStatus } from "./repository-validation-policy.mjs";
import { directoryIdentity } from "./private-fs.mjs";
import { scopeHash } from "./confirmations.mjs";
import { loadWindowsReviewedRun } from "./windows-reviewed-run.mjs";
import { createWindowsReviewedRunner } from "./windows-reviewed-runner.mjs";
import { connectedExecutionActions, windowsPipelineActions, windowsShieldActions } from "./repository-execution-actions.mjs";
import { validateWindowsShield, attestWindowsShield } from "./repository-windows-shield.mjs";
import { shieldReceiptEvidence } from "./repository-shield.mjs";
import { pipelineEvidence } from "./repository-pipeline.mjs";
import { attestWindowsPipeline, windowsPipelineDependencies } from "./repository-windows-pipeline.mjs";
import { createWindowsExecutionStops } from "./repository-windows-execution-stop.mjs";

const uuid = value => typeof value === "string" && /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/.test(value);
const digest = value => typeof value === "string" && /^[a-f0-9]{64}$/.test(value);
const tokenHash = value => createHash("sha256").update(value).digest("hex");
const engine = "windows-sandbox";
const attestedActions=[...windowsPipelineActions,...windowsShieldActions];
const executionPolicy = Object.freeze({ engine, workspace: "read-only-reviewed-snapshot", network: "denied", ambientCredentials: "denied", temporaryBytes: 67108864, temporaryQuotaScope: "bounded-exchange", guestOperatingSystemDiskQuota: "not-attested", hostRepositoryWritten: false });
const budget = { version: "suite-reviewed-windows-execution/v1", commandClasses: Object.fromEntries(connectedExecutionActions("win32").map(action => [action, { maxConcurrent: 1, timeoutMs: 600000, maxAttempts: 1, windowMs: 3600000, maxClaimsPerWindow: 20, maxCostUnitsPerWindow: 20, defaultCostUnits: 1 }])) };
const view = row => ({ engine, requestId: row.requestId, authorityId: row.authorityId, taskId: row.taskId, sessionId: row.sessionId, repositoryRoot: row.repositoryRoot, targetSnapshotId: row.targetSnapshotId, action: row.action, manifestPath: row.manifestPath, manifestSha256: row.manifestSha256, recipe: row.recipe, executableIdentity: row.executableIdentity, executionPolicy: row.executionPolicy, ...(row.validationPolicyDigest?{validationPolicyDigest:row.validationPolicyDigest}:{}), ...(row.shield?{shield:row.shield}:{}), scopeDigest: row.scopeDigest, status: row.status, operationId: row.operationId ?? null, outcome: row.outcome ?? null, expiresAt: row.expiresAt, providerTaskCompletionVerified: false });

export function createWindowsRepositoryExecution({ store, authority, stateDirectory, isActive = async () => true, runner = createWindowsReviewedRunner({ store, stateDirectory: join(stateDirectory, "windows"), isActive }), resolveScannerFixtures, resolveShieldExceptions, now = Date.now } = {}) {
  const pending = new Map(), generations = new Map(), seen = new Set(), hosts = new Map(), recovery = new Map(); let closed = false;
  const reader = new NodeFileDigestReader({ maxFileBytes: 1024 * 1024 });
  const current = (c, g) => { if (closed || g !== (generations.get(c) ?? 0)) throw Error("This Windows execution review was stopped."); };
  const update = (c, id, action, fn) => store.update(c, action, state => { const row = state.repositoryExecutionReviews?.find(row => row.requestId === id && row.engine === engine); if (!row) throw Error("The protected Windows execution review changed."); return fn(row); });
  async function exclusive(c, fn) { if (pending.has(c)) throw Error("Wait for this workspace's current Windows execution admission."); seen.add(c); const g = generations.get(c) ?? 0, operation = Promise.resolve().then(() => fn(g)); pending.set(c, operation); try { return await operation; } finally { if (pending.get(c) === operation) pending.delete(c); } }
  async function plan(resolved, proposal, prerequisites,c) {
    const ignored=windowsShieldActions.includes(proposal.action)?(resolved.files.ignored??[]).filter(file=>file.classification==="included"&&resolved.proposed.classifications.includedIgnored?.includes(file.path)):[];
    const allowedFiles = [...resolved.files.tracked, ...resolved.files.untracked,...ignored].filter(file => resolved.proposed.paths.includes(file.path)).map(file => ({ path: file.path, digest: file.digest }));
    const source = await directoryIdentity(resolved.task.repositoryRoot), sourceIdentity = { device: source.dev.toString(), inode: source.ino.toString() };
    const selected = { repositoryRoot: resolved.task.repositoryRoot, sourceIdentity, manifestPath: proposal.manifestPath, manifestSha256: proposal.manifestSha256, allowedFiles };
    const loaded = await loadWindowsReviewedRun({ ...selected, expectedAction: proposal.action, recipeRuntimeSha256: prerequisites.recipeRuntime.sha256 });
    const shield=await validateWindowsShield({loaded,repositoryRoot:resolved.task.repositoryRoot,action:proposal.action,resolveFixtures:resolveScannerFixtures?input=>resolveScannerFixtures(c,input):undefined,now});
    return { selected, loaded, ...(shield?{shield}:{}) };
  }
  async function output(c, review, run) {
    const result = run?.result, root = result?.diagnosticRoot ?? result?.resultRoot;
    const empty = { output: null, diagnostic: null, artifactStatus: "not-produced" };
    if (!root || !Array.isArray(result.validatedOutputs)) return empty;
    if (run.nativeExitVerified !== true) return { ...empty, artifactStatus: "awaiting-exit" };
    try {
      const parent = join(stateDirectory, "windows", c, "results", run.operationId);
      if (typeof root !== "string" || relative(parent, root) !== basename(root) || (!basename(root).startsWith("sandbox-") || !uuid(basename(root).slice(8))) || result.resultRoot && result.diagnosticRoot || result.validatedOutputs.length > 256) throw Error("Unverified output ownership");
      const before = await directoryIdentity(root), text = []; let total = 0;
      for (const path of ["process.stdout.txt", "process.stderr.txt"]) {
        const records = result.validatedOutputs.filter(file => file.path === path);
        if (records.length !== 1 || !digest(records[0].sha256) || !Number.isSafeInteger(records[0].size) || records[0].size < 0 || records[0].size > 524288) throw Error("Unverified output manifest");
        total += records[0].size; if (total > review.recipe.maxOutputBytes) throw Error("Unverified shared output bound");
        const read = await reader.read(root, path);
        try {
          if (read.bytes.length !== records[0].size || read.digest !== `sha256:${records[0].sha256}`) throw Error("Output changed after its verified copy");
          text.push(redactText(read.bytes.toString("utf8")));
        } finally { read.bytes.fill(0); }
      }
      const after = await directoryIdentity(root);
      if (before.dev !== after.dev || before.ino !== after.ino) throw Error("Output directory changed during inspection");
      return { output: text[0], diagnostic: text[1], artifactStatus: "available" };
    } catch { return { output: null, diagnostic: "Stored Windows program output is unavailable or changed. The original Run result is preserved.", artifactStatus: "unavailable" }; }
  }
  async function observation(c, binding) {
    const state = await store.snapshot(c), review = state.repositoryExecutionReviews?.find(row => row.engine === engine && row.operationId === binding.operationId), run = state.repositoryWindowsRuns?.find(row => row.operationId === binding.operationId);
    if (!review || !run || ["action", "targetSnapshotId", "repositoryRoot", "sessionId", "authorityId"].some(key => review[key] !== binding[key]) || run.scopeDigest !== review.scopeDigest) return { state: "not_owner", operationId: binding.operationId, summary: "No exact protected Windows execution ownership was found." };
    const base = { ...binding, effectDisposition: "ambiguous", summary: "Observe only the retained exact Windows operation; provider task completion remains unverified." };
    if (run.status === "executing" || run.cleanupPending && run.nativeExitVerified !== true) return { ...base, state: "active" };
    const status = attestedActions.includes(review.action) ? "incomplete" : ["completed", "failed", "timed_out", "cancelled"].includes(run.result?.status) ? run.result.status : "incomplete";
    return { ...base, state: "terminal", status, effectDisposition: status === "incomplete" ? "ambiguous" : "committed", evidenceDigest: scopeHash([run.operationId, run.planDigest, run.backendObservation, run.nativeExitVerified, run.result]), toolVersions: { guest: "switchyard-windows-sandbox-guest/v1", manifest: `sha256:${review.manifestSha256}` } };
  }
  async function runtimeFor(c, review, resolved, g) {
    const check = async () => {
      current(c, g); if (!await isActive(c)) throw Error("Select the exact reviewed Windows workspace before execution.");
      const fresh = await authority.assertCurrent(c, review.authorityId, review.action);
      if (fresh.record.taskDigest !== review.taskDigest || fresh.record.workspaceDigest !== review.workspaceDigest) throw Error("The Windows execution task/account/workspace scope changed.");
      const bytes = await reader.read(review.repositoryRoot, review.manifestPath); try { if (bytes.digest !== `sha256:${review.manifestSha256}`) throw Error("The exact Windows Run manifest changed."); } finally { bytes.bytes.fill(0); } current(c, g);
    };
    const payload = { schema: "switchyard-windows-execution-checkpoint/v1", scopeDigest: review.scopeDigest, targetSnapshotId: review.targetSnapshotId, manifestSha256: review.manifestSha256, recipe: review.recipe, inputs: review.plan.allowedFiles, prerequisites: review.executableIdentity, executionPolicy:review.executionPolicy }, checkpointDigest = scopeHash(payload), reference = `suite-windows-execution-checkpoint:${review.requestId}`;
    const rawReceiptEvidence = attestedActions.includes(review.action) ? await pipelineEvidence({ store, compartment: c, provider: resolved.task.provider, policyVersion: resolved.snapshot.policyVersion, now }) : undefined;
    const receiptEvidence=rawReceiptEvidence&&windowsShieldActions.includes(review.action)?shieldReceiptEvidence(rawReceiptEvidence):rawReceiptEvidence;
    const runtime = new DurableMediatedExecutor({ store: repositoryEffectJournal(store, c, { provider: resolved.task.provider, domain: "execution", now, receiptGuard: validationReceiptGuard(review.validationPolicyDigest) }), authorities: authority.authorityLedger(c), policyVersion: "switchyard-task-local-authority/v1", operationScopeDigest: review.scopeDigest, now: () => new Date(now()), budgetConfiguration: budget, additionalCheckpointActions: connectedExecutionActions("win32"), ...(receiptEvidence ? { receiptEvidence } : {}),
      operationControl: { observe: binding => observation(c, binding), cancel: async ({ operationId }) => { const row = (await store.snapshot(c)).repositoryExecutionReviews?.find(row => row.requestId === review.requestId && row.engine === engine); return row?.operationId === operationId ? runner.stopOperation(c, operationId) : { accepted: false, summary: "The exact Windows operation changed." }; } },
      checkpointCapture: { capture: async ({ operationId, definition, target }) => { await check(); if (definition.action !== review.action || target.id !== review.targetSnapshotId) throw Error("The exact Windows checkpoint target changed."); await update(c, review.requestId, "windows-execution-checkpoint", row => { if (row.status !== "executing" || row.operationId && row.operationId !== operationId) throw Error("The Windows operation checkpoint changed."); row.operationId = operationId; row.admission ??= { schema: "switchyard-windows-run-admission/v1", operationId, scopeDigest: review.scopeDigest, targetSnapshotId: review.targetSnapshotId, action: review.action, admittedAt: now() }; row.checkpoint = { payload, digest: checkpointDigest }; }); return { reason: "Preserve the exact Windows Run input/catalog/runtime scope and isolated boundary.", artifacts: [{ id: `windows-execution-${review.requestId}`, kind: "workspace_manifest", reference, sha256: checkpointDigest, bytes: Buffer.byteLength(JSON.stringify(payload)) }], recovery: { artifactIds: [`windows-execution-${review.requestId}`], steps: ["Independently reconcile the original native owners and exact guest ID; never replay the worker.", "Retain the original backend observation and admission result.", "Retire only the original bounded storage and unchanged inputs after native and guest exit verify."] } }; } },
      checkpointVerifier: { verify: async artifact => { const row = (await store.snapshot(c)).repositoryExecutionReviews?.find(row => row.requestId === review.requestId && row.engine === engine); const record = row?.checkpoint, valid = Boolean(artifact.reference === reference && record && record.digest === scopeHash(record.payload)); return { available: valid, ...(valid ? { sha256: row.checkpoint.digest } : {}), detail: valid ? "The protected Windows Run checkpoint verifies." : "The exact Windows checkpoint is unavailable." }; } },
      targetResolver: { resolve: async () => { await check(); const fresh = await authority.resolve(c, review.authorityId, review.action); if (fresh.snapshot.id !== review.targetSnapshotId || fresh.binding !== review.taskDigest || fresh.workspace !== review.workspaceDigest) throw Error("The Windows execution snapshot changed."); return fresh.snapshot; } },
      dependencies: context => {
        const execution = new InMemoryExecutionBroker(context.policy), marker = repositoryRuntimeExecutionRecipe(review.action, resolved.snapshot);
        execution.register(marker.id, async request => {
          await check(); if (request.action !== review.action || request.target.id !== review.targetSnapshotId || !request.effectGuard) return { status: "blocked", effectDisposition: "not_started", summary: "Windows Run requires its exact policy target and final effect guard." };
          const row = (await store.snapshot(c)).repositoryExecutionReviews?.find(row => row.requestId === review.requestId && row.engine === engine); if (row?.operationId !== request.operationId) throw Error("The checkpoint operation changed before Windows startup.");
          const control = await createDurableAbortControl(request.executionControl);
          try {
            if (control.signal.aborted) return { status: control.reason() === "deadline" ? "timed_out" : control.reason() === "unavailable" ? "unavailable" : "cancelled", effectDisposition: "not_started", summary: "Windows Run refused an expired, cancelled or unverifiable durable operation." };
            const guard = async () => { await check(); const checked = await request.effectGuard.assertCurrent({ action: request.action, operationId: request.operationId, target: request.target, ...(request.session ? { session: request.session } : {}), ...(request.authority ? { authority: request.authority } : {}) }); if (!checked.allowed) throw Error(checked.reason); };
            const result = await runner.run(c, { operationId: request.operationId, scopeDigest: review.scopeDigest, provider: resolved.task.provider }, review.plan, guard, control.signal, review.action);
            const state = await store.snapshot(c), guest = state.repositoryWindowsGuests?.find(row => row.operationId === request.operationId);
            const uncertainStart = state.repositoryWindowsGuestCommands?.some(row => row.operationId === request.operationId && row.action === "start" && row.startAcknowledged === true && row.result?.effectStarted !== false);
            const effectDisposition = result.status === "incomplete" ? "ambiguous" : ["blocked", "unavailable"].includes(result.status) ? guest?.startVerified === true ? "committed" : uncertainStart ? "ambiguous" : "not_started" : "committed";
            const attested = receiptEvidence ? await (windowsShieldActions.includes(review.action)?attestWindowsShield:attestWindowsPipeline)({ store, compartment: c, stateDirectory, review: { ...review, operationId: request.operationId }, request, result, receiptEvidence, resolveScannerFixtures: resolveScannerFixtures ? input => resolveScannerFixtures(c, input) : undefined, resolveShieldExceptions: resolveShieldExceptions ? input => resolveShieldExceptions(c,input) : undefined, guard, now }) : undefined;
            if (attested) await update(c, review.requestId, "windows-pipeline-observed", row => { row.pipelineObservation = attested; });
            return { status: attested?.status ?? result.status, summary: attested?.summary ?? result.summary, effectDisposition: attested?.effectDisposition ?? effectDisposition, data: { ...(attested?.data ?? {}), engine, ...(result.receiptPath ? { receiptPath: result.receiptPath } : {}), ...(result.resultRoot ? { resultRoot: result.resultRoot } : {}), ...(result.diagnosticRoot ? { diagnosticRoot: result.diagnosticRoot } : {}), ...(Number.isInteger(result.programExitCode) ? { programExitCode: result.programExitCode } : {}), providerTaskCompletionVerified: false } };
          } finally { control.dispose(); }
        });
        return { execution, ...(receiptEvidence ? windowsPipelineDependencies(context.policy, review, resolved.snapshot) : {}), executionRecipeFactory: { create: (definition, target) => definition.action === review.action && target.id === review.targetSnapshotId ? repositoryRuntimeExecutionRecipe(review.action, target) : undefined } };
      }
    });
    await check(); await runtime.sessions.upsert({ id: review.sessionId, provider: "generic", surface: "bridge", capabilities: ["registered", "mediated"], status: "running", workspaceRoot: review.repositoryRoot, targetSnapshotId: review.targetSnapshotId, taskId: review.taskId, planRevision: resolved.record.grant.planRevision, plannedFiles: resolved.proposed.paths, adapterVersion: "switchyard-windows-execution/v1", metadata: { meaning: "Host-mediated Windows execution; provider permissions and task completion remain unchanged", nativeProvider: resolved.task.provider, accountFingerprint: resolved.task.accountFingerprint } });
    return { runtime, check };
  }
  async function recoverCompartment(c) {
    seen.add(c); const native = await runner.recover(c); let host = recovery.get(c);
    if (!host) { host = new DurableMediatedExecutor({ store: repositoryEffectJournal(store, c, { domain: "execution", now }), policyVersion: "switchyard-task-local-authority/v1", now: () => new Date(now()), operationControl: { observe: binding => observation(c, binding), cancel: ({ operationId }) => runner.stopOperation(c, operationId) }, dependencies: () => ({}) }); recovery.set(c, host); }
    await host.recoverAfterRestart(); await stops.recover(c); return native;
  }
  const stops = createWindowsExecutionStops({ store, runner, isActive, now, reconcile: recoverCompartment });
  return {
    recoverCompartment,
    async review(c, input) { return exclusive(c, async g => {
      if (!input || Object.keys(input).some(key => !["compartment", "requestId", "authorityId", "manifestPath", "manifestSha256", "action"].includes(key)) || !uuid(input.requestId) || !uuid(input.authorityId) || !connectedExecutionActions("win32").includes(input.action) || !digest(input.manifestSha256) || typeof input.manifestPath !== "string" || input.manifestPath.length < 1 || input.manifestPath.length > 512) throw Error("Review one exact task-owned Windows Run manifest; commands and host executable paths are not accepted.");
      current(c, g); await recoverCompartment(c); const state = await store.snapshot(c); if (state.repositoryExecutionReviews?.some(row => row.requestId === input.requestId)) throw Error("This execution request already has a protected review; inspect its retained result.");
      if ((await runner.list(c)).some(row => row.cleanupPending)) throw Error("Reconcile the existing Windows Run and its native storage before another review.");
      const resolved = await authority.resolve(c, input.authorityId, input.action), prerequisites = await runner.prerequisites(), selected = await plan(resolved, input, prerequisites,c); current(c, g);
      const packet = { engine, requestId: input.requestId, authorityId: input.authorityId, manifestPath: input.manifestPath, manifestSha256: input.manifestSha256, action: input.action, taskId: resolved.task.id, sessionId: resolved.task.sessionId, provider: resolved.task.provider, repositoryRoot: resolved.task.repositoryRoot, targetSnapshotId: resolved.snapshot.id, taskDigest: resolved.binding, workspaceDigest: resolved.workspace, plan: selected.selected, recipe: selected.loaded.recipe, catalogSha256: selected.loaded.manifest.catalogSha256, executableIdentity: prerequisites, executionPolicy, ...(attestedActions.includes(input.action)?{validationPolicyDigest:validationPolicyDigest(await store.snapshot(c))}:{}), ...(selected.shield?{shield:selected.shield}:{}) }, row = { ...packet, scopeDigest: scopeHash(["switchyard-windows-execution-review/v1", c, packet]), status: "reviewed", createdAt: now() }, host = await runtimeFor(c, row, resolved, g);
      const confirmation = await host.runtime.confirmations.issue({ action: row.action, sessionId: row.sessionId, authorityId: row.authorityId, targetSnapshotId: row.targetSnapshotId, scopeDigest: row.scopeDigest, reason: "Run only this exact selected non-production input/catalog/runtime set inside the displayed bounded Windows guest. No provider permission or live-repository write is granted.", reauthenticated: false }); await host.check(); row.expiresAt = confirmation.record.expiresAt; row.tokenDigest = tokenHash(confirmation.token);
      await store.update(c, "windows-execution-review", state => { state.repositoryExecutionReviews = [...(state.repositoryExecutionReviews ?? []).slice(-127), row]; }); return { review: view(row), confirmation };
    }); },
    async apply(c, input) { return exclusive(c, async g => {
      if (!input || Object.keys(input).some(key => !["compartment", "requestId", "token"].includes(key)) || !uuid(input.requestId) || typeof input.token !== "string") throw Error("Use only the exact Windows execution review and its one-use approval.");
      const row = (await store.snapshot(c)).repositoryExecutionReviews?.find(row => row.engine === engine && row.requestId === input.requestId); if (!row || row.tokenDigest !== tokenHash(input.token)) throw Error("The exact Windows execution approval is unavailable.");
      if (row.status !== "reviewed") return { ...(row.outcome ?? { status: "incomplete", effectDisposition: "ambiguous", summary: "The original Windows execution remains unconfirmed; no replay was attempted." }), replayed: true, providerTaskCompletionVerified: false };
      const resolved = await authority.resolve(c, row.authorityId, row.action), prerequisites = await runner.prerequisites(), selected = await plan(resolved, row, prerequisites,c);
      if (resolved.snapshot.id !== row.targetSnapshotId || resolved.binding !== row.taskDigest || resolved.workspace !== row.workspaceDigest || scopeHash(prerequisites) !== scopeHash(row.executableIdentity) || scopeHash(selected.selected) !== scopeHash(row.plan)||scopeHash(selected.shield??null)!==scopeHash(row.shield??null)) throw Error("The exact reviewed Windows execution scope or prerequisite changed.");
      if(attestedActions.includes(row.action)&&row.validationPolicyDigest!==validationPolicyDigest(await store.snapshot(c)))throw Error("The reviewed validation policy changed; review the current signed registry again.");
      const host = await runtimeFor(c, row, resolved, g); await host.check(); const approved = await host.runtime.confirmations.consume({ action: row.action, sessionId: row.sessionId, authorityId: row.authorityId, targetSnapshotId: row.targetSnapshotId, scopeDigest: row.scopeDigest, token: input.token }); if (!approved.allowed) throw Error(approved.reason);
      await update(c, row.requestId, "windows-execution-admit", row => { current(c, g); if (row.status !== "reviewed") throw Error("This Windows execution already has a reservation."); row.status = "executing"; }); let outcome;
      try { const assignment = commandForAction(row.action).assignment; outcome = await host.runtime.execute({ assignment, control: assignment.control, modifier: assignment.modifier, sessionId: row.sessionId, authorityId: row.authorityId }); } catch { outcome = { status: "incomplete", effectDisposition: "ambiguous", summary: "The exact Windows execution did not settle. Preserve its ownership; no replay is allowed." }; }
      await update(c, row.requestId, "windows-execution-admission-result", row => { row.outcome = { ...outcome, providerTaskCompletionVerified: false, nativePermissionsChanged: false }; row.status = outcome.effectDisposition === "ambiguous" ? "outcome-unconfirmed" : "settled"; row.finishedAt = now(); }); hosts.set(`${c}:${row.requestId}`, host); return { ...outcome, replayed: false, providerTaskCompletionVerified: false, nativePermissionsChanged: false };
    }); },
    async list(c) { return ((await store.snapshot(c)).repositoryExecutionReviews ?? []).filter(row => row.engine === engine).map(view); },
    async status(c, id) { if (!uuid(id)) throw Error("Choose one exact Windows execution request UUID."); await recoverCompartment(c); await hosts.get(`${c}:${id}`)?.runtime.reconcileBudgetedOperations(); const state = await store.snapshot(c), row = state.repositoryExecutionReviews?.find(row => row.engine === engine && row.requestId === id); if (!row) throw Error("That Windows execution is unavailable in this workspace."); const run = state.repositoryWindowsRuns?.find(run => run.operationId === row.operationId); return { ...view(row), receipt: await validationReceiptStatus(store,c,row,now), nativeStatus: run?.status ?? "not-observed", nativeExitVerified: run?.nativeExitVerified === true, stagingCleanupPending: run?.cleanupPending ?? false, ...await output(c, row, run), programExitCode: Number.isInteger(run?.result?.programExitCode) ? run.result.programExitCode : null }; },
    async stopCompartment(c) { generations.set(c, (generations.get(c) ?? 0) + 1); const stopped = await runner.stopCompartment(c); await stops.stopCompartment(c); await Promise.allSettled([pending.get(c)].filter(Boolean)); for (const [id, host] of hosts) if (id.startsWith(c + ":")) await host.runtime.reconcileBudgetedOperations(); return stopped; },
    reviewStop: stops.review, applyStop: stops.apply, listStops: stops.list,
    async close() { closed = true; for (const c of seen) generations.set(c, (generations.get(c) ?? 0) + 1); let failure; try { await stops.close(); } catch (error) { failure = error; } try { await runner.close(); } catch (error) { failure ??= error; } await Promise.allSettled(pending.values()); for (const host of [...hosts.values(), ...recovery.values()]) { try { await host.runtime?.reconcileBudgetedOperations?.(); await host.reconcileBudgetedOperations?.(); } finally { host.runtime?.stopObservation?.(); host.stopObservation?.(); } } if (failure) throw failure; }
  };
}
