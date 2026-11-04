/** The control-plane journal lives inside the existing locked AEAD compartment. */
import { randomUUID } from "node:crypto";
import { journalEntryHash, stableJson } from "../../packages/control-plane/src/store.ts";
const field = "repositoryEffectJournal";
function verified(entries) {
  if (!Array.isArray(entries) || entries.length > 8192) throw new Error("The protected repository effect journal is invalid or full.");
  let previous;
  for (const e of entries) {
    if (e.schemaVersion !== 1 || e.sequence !== (previous?.sequence ?? 0) + 1 || e.previousHash !== previous?.hash || e.hash !== journalEntryHash(e)) throw new Error("The protected repository effect journal chain did not verify. Preserve it for recovery.");
    previous = e;
  }
  return structuredClone(entries);
}
export function repositoryEffectJournal(store, compartment, { now = Date.now, provider } = {}) {
  const journal = {
    filePath: `suite-aead:${compartment}:repository-effects`, hasAuthenticatedProtection: true,
    async readEntries() { return verified((await store.snapshot(compartment))[field] ?? []); },
    async verifyChain() { await journal.readEntries(); return true; },
    async transaction(fn) {
      return store.update(compartment, "repository-effect-journal", async state => {
        state[field] = verified(state[field] ?? []);
        return fn({
          readEntries: async () => structuredClone(state[field]),
          append: async (kind, payload) => {
            const previous = state[field].at(-1);
            const entry = { schemaVersion: 1, sequence: (previous?.sequence ?? 0) + 1, id: randomUUID(), kind, at: new Date(now()).toISOString(), payload: structuredClone(payload), ...(previous ? { previousHash: previous.hash } : {}) };
            entry.hash = journalEntryHash(entry);
            if (state[field].length >= 8192 || Buffer.byteLength(stableJson([...state[field], entry])) > 2 * 1024 * 1024) throw new Error("The protected repository effect journal is full; prior effects were preserved.");
            state[field].push(entry); return structuredClone(entry);
          }
        });
      }, { provider });
    },
    async append(kind, payload) { return journal.transaction(t => t.append(kind, payload)); }
  };
  return journal;
}
