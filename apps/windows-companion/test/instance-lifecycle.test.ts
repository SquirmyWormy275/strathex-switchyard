import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { acquireCompanionInstance, parseInstance } from "../src/instance-lifecycle.ts";

test("companion instance lease is exact, exclusive, and recoverably released", async () => {
  const directory = await mkdtemp(join(tmpdir(), "b122-instance-"));
  try {
    const lease = await acquireCompanionInstance(directory, process.execPath);
    const stored = parseInstance(await readFile(lease.filePath, "utf8"));
    assert.equal(stored.pid, process.pid);
    assert.equal(stored.nonce, lease.record.nonce);
    await assert.rejects(() => acquireCompanionInstance(directory, process.execPath), /already active/);
    await lease.release();
    const replacement = await acquireCompanionInstance(directory, process.execPath);
    await replacement.release();
  } finally { await rm(directory, { recursive: true, force: true }); }
});

test("malformed instance state is never automatically replaced", async () => {
  const directory = await mkdtemp(join(tmpdir(), "b122-instance-bad-"));
  try {
    await writeFile(join(directory, "companion-instance.json"), "{}\n");
    await assert.rejects(() => acquireCompanionInstance(directory, process.execPath), /malformed/);
  } finally { await rm(directory, { recursive: true, force: true }); }
});
