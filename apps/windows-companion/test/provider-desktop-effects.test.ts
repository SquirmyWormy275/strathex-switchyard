import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { ProtectedJsonStore, type JournalAuthenticator } from "../../../packages/control-plane/src/store.ts";
import { DurableProviderDesktopEffectLedger } from "../src/provider-desktop-effects.ts";

const authenticator: JournalAuthenticator = {
  provider: "isolated-provider-effect-test",
  async seal(hash) { return createHash("sha256").update(`effect:${hash}`).digest("hex"); },
  async verify(hash, tag) { return tag === await this.seal(hash); }
};

async function ledgerFixture(context: test.TestContext) {
  const directory = await mkdtemp(join(tmpdir(), "b122-provider-effects-"));
  context.after(async () => rm(directory, { recursive: true, force: true }));
  const store = new ProtectedJsonStore({ filePath: join(directory, "protected.jsonl"), authenticator });
  return { store, ledger: new DurableProviderDesktopEffectLedger(store) };
}

test("a started provider desktop effect survives restart as manual reconciliation, never replay permission", async (context) => {
  const { store, ledger } = await ledgerFixture(context);
  const binding = { operationId: "operation-provider-started", action: "fresh_claude", provider: "claude_desktop", mode: "fresh" } as const;
  await ledger.begin(binding);

  const restarted = new DurableProviderDesktopEffectLedger(store);
  const observed = await restarted.observeOperation(binding.operationId, binding.action);
  assert.equal(observed.outcome, "unresolved");
  assert.equal(observed.details?.manualReconciliation, "required");
  assert.match(observed.note, /manual reconciliation.*retry/i);

  await assert.rejects(() => ledger.begin(binding), /already started.*reconciliation/i);

  await assert.rejects(
    () => ledger.begin({ ...binding, provider: "chatgpt_desktop" }),
    /another effect/i
  );
});

test("settled exact provider effects distinguish committed, refused, and ambiguous outcomes", async (context) => {
  const { ledger } = await ledgerFixture(context);
  const completed = { operationId: "operation-provider-completed", action: "open_chatgpt", provider: "chatgpt_desktop", mode: "normal" } as const;
  await ledger.begin(completed);
  await ledger.settle(completed, { status: "completed", summary: "Focused exact surface.", effect: "focused", processId: 122 });
  assert.deepEqual(await ledger.observeOperation(completed.operationId, completed.action), {
    outcome: "committed",
    note: "The authenticated provider desktop ledger recorded the exact completed effect.",
    details: { action: "open_chatgpt", provider: "chatgpt_desktop", mode: "normal", manualReconciliation: "not_required", processId: "122" }
  });
  await assert.rejects(() => ledger.begin(completed), /already settled/i);

  const refused = { operationId: "operation-provider-refused", action: "open_claude", provider: "claude_desktop", mode: "normal" } as const;
  await ledger.begin(refused);
  await ledger.settle(refused, { status: "blocked", summary: "Final target fence changed." });
  assert.equal((await ledger.observeOperation(refused.operationId, refused.action)).outcome, "failed");

  const uncertain = { operationId: "operation-provider-uncertain", action: "fresh_chatgpt", provider: "chatgpt_desktop", mode: "fresh" } as const;
  await ledger.begin(uncertain);
  await ledger.settle(uncertain, { status: "timed_out", summary: "Native launch acknowledgement was lost." });
  const ambiguous = await ledger.observeOperation(uncertain.operationId, uncertain.action);
  assert.equal(ambiguous.outcome, "unresolved");
  assert.equal(ambiguous.details?.manualReconciliation, "required");
});

test("provider desktop effect ledger requires host-authenticated storage", async (context) => {
  const directory = await mkdtemp(join(tmpdir(), "b122-provider-effects-unprotected-"));
  context.after(async () => rm(directory, { recursive: true, force: true }));
  assert.throws(() => new DurableProviderDesktopEffectLedger(new ProtectedJsonStore({ filePath: join(directory, "plain.jsonl") })), /authenticated/i);
});
