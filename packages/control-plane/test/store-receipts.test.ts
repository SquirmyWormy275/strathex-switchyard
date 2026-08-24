import assert from "node:assert/strict";
import { appendFile, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { defaultControlPlaneStorePath, ProtectedJsonStore, StoreIntegrityError, type JournalAuthenticator } from "../src/store.ts";
import { ReceiptLedger } from "../src/receipts.ts";

async function withStore(run: (store: ProtectedJsonStore, directory: string) => Promise<void>): Promise<void> {
  const directory = await mkdtemp(join(tmpdir(), "sxsy-b122-control-plane-test-"));
  try {
    await run(new ProtectedJsonStore({ filePath: join(directory, "protected-audit.jsonl") }), directory);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
}

test("the default protected store location is outside the current repository", () => {
  const defaultPath = defaultControlPlaneStorePath({ LOCALAPPDATA: join(tmpdir(), "b122-store") });
  assert.notEqual(defaultPath.startsWith(process.cwd()), true);
  assert.match(defaultPath, /switchyard/i);
});

test("append-only records are sequence-numbered and hash chained", async () => {
  await withStore(async (store) => {
    const first = await store.append("test.first", { message: "one", nested: { b: 2, a: 1 } });
    const second = await store.append("test.second", { message: "two" });

    assert.equal(first.sequence, 1);
    assert.equal(second.sequence, 2);
    assert.equal(second.previousHash, first.hash);
    assert.equal((await store.readEntries()).length, 2);
    assert.equal(await store.verifyChain(), true);
  });
});

test("tampering with a protected journal fails closed", async () => {
  await withStore(async (store) => {
    await store.append("test.first", { message: "one" });
    await appendFile(store.filePath, '{"not":"a valid chained entry"}\n', "utf8");
    await assert.rejects(store.readEntries(), StoreIntegrityError);
  });
});

test("required host authentication rejects a journal whose chain could otherwise be recomputed", async (context) => {
  const directory = await mkdtemp(join(tmpdir(), "sxsy-b122-authenticated-store-"));
  context.after(async () => { await rm(directory, { recursive: true, force: true }); });
  const authenticator: JournalAuthenticator = {
    provider: "isolated-host-key",
    async seal(hash) { return `isolated-secret:${hash}`; },
    async verify(hash, tag) { return tag === `isolated-secret:${hash}`; }
  };
  const path = join(directory, "protected.jsonl");
  const store = new ProtectedJsonStore({ filePath: path, authenticator, requireAuthenticatedProtection: true });
  await store.append("test.authenticated", { value: "one" });
  const raw = await readFile(path, "utf8");
  await writeFile(path, raw.replace("isolated-secret:", "forged:"), "utf8");
  await assert.rejects(new ProtectedJsonStore({ filePath: path, authenticator, requireAuthenticatedProtection: true }).readEntries(), /authenticator/i);
  assert.throws(() => new ProtectedJsonStore({ filePath: join(directory, "missing.jsonl"), requireAuthenticatedProtection: true }), /authenticator/i);
});

test("receipts and audits share the protected chain and invalidation is append-only", async () => {
  await withStore(async (store) => {
    const ledger = new ReceiptLedger(store, {
      clock: () => "2026-08-23T10:00:00.000Z",
      idFactory: (() => {
        let index = 0;
        return () => `id-${++index}`;
      })()
    });

    const receipt = await ledger.issue({
      operationId: "op-1",
      action: "shield.release",
      targetSnapshotId: "snapshot-1",
      authorityId: "authority-1",
      result: "passed",
      completeness: "complete",
      evidenceDigest: "evidence-digest",
      policyVersion: "policy-v1",
      toolVersions: { scanner: "1.0.0" },
      expiresAt: "2026-08-23T11:00:00.000Z"
    });
    const audit = await ledger.audit({
      action: "shield.release",
      status: "completed",
      operationId: "op-1",
      targetSnapshotId: "snapshot-1",
      detail: "Sanitized completion record."
    });

    assert.equal(audit.previousHash, receipt.hash);
    assert.equal(await ledger.isFresh(receipt, "snapshot-1", "2026-08-23T10:30:00.000Z"), true);
    await ledger.invalidate(receipt.id, "snapshot-changed");
    const invalidated = await ledger.get(receipt.id);
    assert.equal(invalidated?.invalidatedBy, "snapshot-changed");
    assert.equal(await ledger.isFresh(invalidated!, "snapshot-1", "2026-08-23T10:30:00.000Z"), false);
    assert.equal(await ledger.verify(), true);
  });
});
