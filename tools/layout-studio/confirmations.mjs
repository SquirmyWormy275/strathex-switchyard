/** Reuse the control plane's exact-scope ledger inside a locked AEAD compartment. */
import { createHash, randomUUID } from "node:crypto";
import { DurableConfirmationLedger } from "../../packages/control-plane/src/confirmations.ts";
export const scopeHash = (value) => createHash("sha256").update(JSON.stringify(value)).digest("hex");
export function suiteConfirmations(store, compartment, provider, now = () => Date.now()) {
  return new DurableConfirmationLedger({
    readEntries: async () => (await store.snapshot(compartment)).confirmationJournal ?? [],
    transaction: (fn) => store.update(compartment, "confirmation-transaction", async (s) => {
      const keep = new Set((s.confirmationJournal ?? []).filter((e) => e.kind === "confirmation.issued" && Date.parse(e.payload.confirmation.expiresAt) > now()).map((e) => e.payload.confirmation.id));
      s.confirmationJournal = (s.confirmationJournal ?? []).filter((e) => keep.has(e.payload.confirmation?.id ?? e.payload.confirmationId));
      return fn({
        readEntries: async () => structuredClone(s.confirmationJournal),
        append: async (kind, payload) => {
          if (s.confirmationJournal.length >= 512) throw new Error("Resolve or let older confirmations expire before requesting more.");
          const entry = { schemaVersion: 1, sequence: (s.confirmationJournal.at(-1)?.sequence ?? 0) + 1, id: randomUUID(), kind, at: new Date(now()).toISOString(), payload: structuredClone(payload) };
          entry.hash = scopeHash(entry); s.confirmationJournal.push(entry); return structuredClone(entry);
        }
      });
    }, { provider })
  }, { clock: () => new Date(now()).toISOString(), ttlMs: 5 * 60000 });
}
