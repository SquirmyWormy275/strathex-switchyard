/** One-use reviewed scanner setup save; execution and task authority remain separate. */
import { scopeHash, suiteConfirmations } from "./confirmations.mjs";
import { scannerSaveRoot, writeScannerRecipeFiles, inspectScannerRecipeFiles } from "./scanner-recipe-files.mjs";

const version = "switchyard-scanner-recipe-save/v1", action = "save_scanner_recipe";
const uuid = v => typeof v === "string" && /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/.test(v);
const metadata = d => ({ schema: d.schema, id: d.id, action: d.action, binding: d.binding, targetSnapshotId: d.targetSnapshotId, repositoryRoot: d.repositoryRoot, directory: d.directory, files: d.files.map(({ path, sha256, size }) => ({ path, sha256, size })), manifestPath: d.manifestPath, manifestSha256: d.manifestSha256, feeds: d.feeds, authorityProposal: d.authorityProposal });
const scope = (c, d, root) => scopeHash([version, c, metadata(d), root]);
const view = r => ({ id: r.id, status: r.status, draft: structuredClone(r.draft), createdAt: r.createdAt, expiresAt: r.expiresAt, result: r.result ?? null });
const saved = r => ({ id: r.id, status: "saved", directory: r.draft.directory, manifestPath: r.draft.manifestPath, manifestSha256: r.draft.manifestSha256, authorityProposal: r.draft.authorityProposal, filesWritten: true, authorityGranted: false, scanPerformed: false, targetCurrentness: "requires-fresh-authority-review", nextStep: "Obtain fresh task authority, then a separate execution review. Saving never starts a scan." });
const uncertain = (r, reason) => ({ id: r.id, status: "outcome-unconfirmed", directory: r.draft.directory, filesWritten: "unconfirmed", reason, preserved: true, replayed: false, authorityGranted: false, scanPerformed: false });

export function createScannerRecipeSave({ store, authority, platform = process.platform, isActive = async () => true, now = Date.now, writer = writeScannerRecipeFiles, inspector = inspectScannerRecipeFiles } = {}) {
  const pending = new Map(), generations = new Map(); let closed = false;
  const key = c => scopeHash([version, c]);
  const rowIn = (s, id) => { const row = s.scannerRecipeSaves?.find(r => r.id === id); if (!row || row.schema !== version) throw Error("The exact protected scanner save review is unavailable."); return row; };
  async function active(c) {
    if (closed || !await isActive(c)) throw Error("Select the reviewed workspace before saving a scanner setup.");
    const s = await store.snapshot(c); if (s.policy !== "personal" || s.mode !== "personal-companion") throw Error("Scanner saving requires a Personal companion workspace.");
    return s;
  }
  async function exclusive(c, fn) {
    if (platform !== "linux") throw Error("Reviewed scanner saving is implemented only on Linux; Windows saving remains unavailable.");
    await active(c); if (pending.has(c)) throw Error("Wait for the current scanner save or review to settle.");
    const generation = generations.get(c) ?? 0;
    const work = store.withResourceLock("repository-execution", key(c), lease => fn(generation, lease));
    pending.set(c, work); try { return await work; } finally { if (pending.get(c) === work) pending.delete(c); }
  }
  const update = (c, row, event, fn) => store.update(c, event, s => { const actual = rowIn(s, row.id); if (actual.scopeDigest !== row.scopeDigest) throw Error("The scanner save scope changed."); return fn(actual, s); }, { provider: row.draft.binding.provider });
  async function guard(c, row, generation, lease) {
    lease.assert(); if (closed || generation !== (generations.get(c) ?? 0)) throw Error("This scanner save was stopped.");
    await active(c); await authority.assertScannerDraftBinding(c, row.draft.binding, row.draft.feeds); lease.assert();
  }
  async function recover(c) {
    const s = await store.snapshot(c);
    if (!(s.scannerRecipeSaves ?? []).some(r => ["applying", "outcome-unconfirmed"].includes(r.status))) return { stopped: true, replayed: false };
    if (platform !== "linux" || s.policy !== "personal") return { stopped: true, replayed: false, preserved: true, recoveryImplemented: false };
    if (pending.has(c)) return { stopped: false, replayed: false };
    const result = await store.tryWithResourceLock("repository-execution", key(c), async lease => {
      for (const row of (await store.snapshot(c)).scannerRecipeSaves ?? []) {
        if (!["applying", "outcome-unconfirmed"].includes(row.status)) continue;
        if (row.schema !== version || !uuid(row.id) || row.scopeDigest !== scope(c, row.draft, row.rootIdentity)) throw Error("Preserve the unfamiliar scanner save recovery record.");
        lease.assert(); let complete = false;
        try { complete = (await inspector(row.draft, row.rootIdentity, row.progress)).complete === true; } catch { /* Preserve changed, missing, linked or unknown output. */ }
        lease.assert();
        // Recovery needs no native account query and performs no repository mutation.
        await store.update(c, "scanner-save-recovery", s => {
          const current = rowIn(s, row.id); if (current.scopeDigest !== row.scopeDigest) throw Error("The original scanner save changed during recovery.");
          current.status = complete ? "saved" : "outcome-unconfirmed";
          current.result = complete ? { ...saved(current), recoveredWithoutReplay: true } : uncertain(current, "Interrupted or changed output is preserved. No files were written, removed or replayed during recovery.");
        });
      }
      return { stopped: true, replayed: false };
    });
    return result.acquired ? result.value : { stopped: false, replayed: false };
  }
  return {
    async review(c, input) { return exclusive(c, async (generation, lease) => {
      if (((await store.snapshot(c)).scannerRecipeSaves ?? []).length >= 32) throw Error("The scanner save history is full; existing reviews and uncertain output were preserved.");
      const draft = await authority.prepareScannerDraft(c, input), rootIdentity = await scannerSaveRoot(draft.repositoryRoot);
      const row = { schema: version, id: draft.id, status: "reviewed", selection: structuredClone(input), draft: metadata(draft), rootIdentity, scopeDigest: scope(c, draft, rootIdentity), createdAt: new Date(now()).toISOString(), expiresAt: new Date(now() + 300000).toISOString(), progress: { files: {} } };
      await guard(c, row, generation, lease);
      const confirmation = await suiteConfirmations(store, c, draft.binding.provider, now).issue({ action, targetSnapshotId: draft.targetSnapshotId, sessionId: draft.binding.sessionId, scopeDigest: row.scopeDigest, reason: "Save only these exact scanner control files into this new directory. Existing paths are never replaced. This grants no task authority and starts no scan; interrupted output is preserved without replay.", reauthenticated: false });
      await guard(c, row, generation, lease);
      await store.update(c, "scanner-save-reviewed", s => { s.scannerRecipeSaves ??= []; if (s.scannerRecipeSaves.length >= 32 || s.scannerRecipeSaves.some(r => r.id === row.id)) throw Error("The scanner save review cannot be retained."); s.scannerRecipeSaves.push(row); }, { provider: draft.binding.provider });
      return { status: "requires-confirmation", review: view(row), draft, confirmation, filesWritten: false, authorityGranted: false, scanPerformed: false };
    }); },
    async apply(c, input) {
      if (!input || Object.keys(input).some(k => !["id", "token", "compartment"].includes(k)) || !uuid(input.id) || !uuid(input.token) || input.compartment !== undefined && input.compartment !== c) throw Error("Save only one exact reviewed draft and its confirmation token; content, path and command overrides are refused.");
      return exclusive(c, async (generation, lease) => {
        const row = rowIn(await store.snapshot(c), input.id);
        if (row.status !== "reviewed") return row.result ?? uncertain(row, "This save has already started. Recover its original outcome without replay.");
        if (Date.parse(row.expiresAt) <= now()) throw Error("The scanner save review expired. Prepare a fresh review.");
        await guard(c, row, generation, lease);
        const draft = await authority.prepareScannerDraft(c, row.selection, { id: row.id });
        if (scope(c, draft, await scannerSaveRoot(draft.repositoryRoot)) !== row.scopeDigest) throw Error("The scanner save target, account, inputs, feed trust or exact generated bytes changed. Review again.");
        await guard(c, row, generation, lease);
        const decision = await suiteConfirmations(store, c, draft.binding.provider, now).consume({ token: input.token, action, sessionId: draft.binding.sessionId, targetSnapshotId: draft.targetSnapshotId, scopeDigest: row.scopeDigest });
        if (!decision.allowed) throw Error(decision.reason);
        // Persist intent after one-use consumption and before any repository write.
        await update(c, row, "scanner-save-applying", actual => { if (actual.status !== "reviewed") throw Error("The scanner save already started."); actual.status = "applying"; });
        try {
          const authorize = () => guard(c, row, generation, lease);
          const record = event => update(c, row, "scanner-save-progress", actual => {
            lease.assert(); if (actual.status !== "applying") throw Error("The original scanner save is no longer applying.");
            if (event.kind === "directory-intent") actual.progress.directoryIntent = true;
            else if (event.kind === "directory-created") actual.progress.directoryIdentity = event.identity;
            else if (event.kind === "file-intent") actual.progress.files[event.path] = { status: "intent" };
            else if (["file-created", "file-verified"].includes(event.kind)) actual.progress.files[event.path] = { status: event.kind === "file-created" ? "created" : "verified", identity: event.identity };
            else throw Error("Unsupported scanner save progress event.");
          });
          await writer(draft, row.rootIdentity, record, authorize); await authorize();
          const current = rowIn(await store.snapshot(c), row.id);
          if (!(await inspector(current.draft, current.rootIdentity, current.progress)).complete) throw Error("The exact saved control files could not be verified.");
          await authorize();
          return await update(c, row, "scanner-save-completed", actual => { actual.status = "saved"; return actual.result = saved(actual); });
        } catch {
          // Never retry filesystem effects, including when the final acknowledgement is lost.
          // Terminal bookkeeping must survive a switch to keyboard-only mode.
          // It cannot invoke a provider or create further repository effects.
          return store.update(c, "scanner-save-uncertain", s => { const actual = rowIn(s, row.id); if (actual.scopeDigest !== row.scopeDigest) throw Error("Preserve the changed scanner save record."); actual.status = "outcome-unconfirmed"; return actual.result = uncertain(actual, "The save did not confirm every file and final ownership check. Preserve its directory and recover the original outcome without replay."); });
        }
      });
    },
    async list(c) { await active(c); return ((await store.snapshot(c)).scannerRecipeSaves ?? []).map(view); },
    recover,
    async stopCompartment(c) { generations.set(c, (generations.get(c) ?? 0) + 1); await pending.get(c)?.catch(() => {}); return recover(c); },
    async close() { closed = true; for (const c of pending.keys()) generations.set(c, (generations.get(c) ?? 0) + 1); await Promise.allSettled(pending.values()); }
  };
}
