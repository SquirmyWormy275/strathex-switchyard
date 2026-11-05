/** The control-plane journal lives inside the existing locked AEAD compartment. */
import { randomUUID } from "node:crypto";
import { journalEntryHash, stableJson } from "../../packages/control-plane/src/store.ts";
function verified(entries) {
  if (!Array.isArray(entries) || entries.length > 8192) throw new Error("The protected repository effect journal is invalid or full.");
  let previous;
  for (const e of entries) {
    if (e.schemaVersion !== 1 || e.sequence !== (previous?.sequence ?? 0) + 1 || e.previousHash !== previous?.hash || e.hash !== journalEntryHash(e)) throw new Error("The protected repository effect journal chain did not verify. Preserve it for recovery.");
    previous = e;
  }
  return structuredClone(entries);
}
const fields = { effects: "repositoryEffectJournal", recovery: "repositoryRecoveryJournal", execution: "repositoryExecutionJournal", "execution-stop": "repositoryExecutionStopJournal", storage: "windowsStorageJournal", fixtures: "scannerFixtureJournal", "shield-policy": "shieldExceptionJournal" };
const fieldFor = domain => { if (!Object.hasOwn(fields, domain)) throw new Error("Unsupported protected repository journal domain."); return fields[domain]; };
/** Use only inside an existing locked store.update; the outer transaction owns commit/rollback. */
export function repositoryEffectTransaction(state, domain, { now = Date.now, receiptGuard } = {}) {
  const field = fieldFor(domain); state[field] = verified(state[field] ?? []);
  return {
    readEntries: async () => structuredClone(state[field]),
    append: async (kind, payload) => {
      if (kind === "receipt.issued") await receiptGuard?.(state, payload.receipt);
      const previous = state[field].at(-1);
      const entry = { schemaVersion: 1, sequence: (previous?.sequence ?? 0) + 1, id: randomUUID(), kind, at: new Date(now()).toISOString(), payload: structuredClone(payload), ...(previous ? { previousHash: previous.hash } : {}) };
      entry.hash = journalEntryHash(entry);
      if (state[field].length >= 8192 || Buffer.byteLength(stableJson([...state[field], entry])) > 2 * 1024 * 1024) throw new Error("The protected repository effect journal is full; prior effects were preserved.");
      state[field].push(entry); return structuredClone(entry);
    }
  };
}
export function repositoryEffectJournal(store, compartment, { now = Date.now, provider, domain = "effects", guard, receiptGuard } = {}) {
  const field = fieldFor(domain);
  const journal = {
    filePath: `suite-aead:${compartment}:repository-${domain}`, hasAuthenticatedProtection: true,
    async readEntries() { return verified((await store.snapshot(compartment))[field] ?? []); },
    async verifyChain() { await journal.readEntries(); return true; },
    async transaction(fn) {
      return store.update(compartment, "repository-effect-journal", async state => {
        await guard?.(state);
        const result = await fn(repositoryEffectTransaction(state, domain, { now, receiptGuard }));
        await guard?.(state); return result;
      }, { provider });
    },
    async append(kind, payload) { return journal.transaction(t => t.append(kind, payload)); }
  };
  return journal;
}
