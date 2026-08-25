import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { acquireCompanionInstance, parseInstance, type CompanionInstanceRecord } from "../src/instance-lifecycle.ts";
import { FakeUserSecretProtector } from "../src/windows-secret.ts";

function staleSupervisedRecord(pid = process.pid): CompanionInstanceRecord {
  const supervisorId = `companion:${"a".repeat(64)}`;
  return {
    schema: "sxsy-b122.companion-instance",
    version: 2,
    nonce: "11111111-2222-3333-4444-555555555555",
    pid,
    startedAt: "2026-08-25T00:00:00.000Z",
    mainPath: process.execPath,
    processPath: process.execPath,
    supervisorId,
    supervisorRequestPath: join(tmpdir(), "companion-supervisor.request.json"),
    supervisorStatePath: join(tmpdir(), "companion-supervisor.state.json"),
    supervisorHelperPath: process.execPath,
    supervisorHelperSha256: "b".repeat(64),
    supervisorJobName: `Global\\SxsyB122Companion-${supervisorId.slice("companion:".length)}`,
    supervisorCreationFileTimeUtc: "134000000000000001",
    childCreationFileTimeUtc: "134000000000000002"
  };
}

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

test("oversized instance state is never read or automatically replaced", async () => {
  const directory = await mkdtemp(join(tmpdir(), "b122-instance-oversized-"));
  try {
    await writeFile(join(directory, "companion-instance.json"), Buffer.alloc(256 * 1024 + 1, 0x61));
    await assert.rejects(() => acquireCompanionInstance(directory, process.execPath), /unsafe, or oversized/);
    assert.equal((await readFile(join(directory, "companion-instance.json"))).byteLength, 256 * 1024 + 1);
  } finally { await rm(directory, { recursive: true, force: true }); }
});

test("a terminal authenticated supervisor generation can replace a dead-parent lease even if its PID was reused", async () => {
  const directory = await mkdtemp(join(tmpdir(), "b122-instance-terminal-"));
  const stale = staleSupervisedRecord(process.pid);
  try {
    await writeFile(join(directory, "companion-instance.json"), `${JSON.stringify(stale)}\n`, "utf8");
    let observed: CompanionInstanceRecord | undefined;
    const replacement = await acquireCompanionInstance(directory, process.execPath, { observeSupervisor: async (record) => { observed = record; return "terminal"; } });
    assert.equal(observed?.nonce, stale.nonce);
    assert.notEqual(replacement.record.nonce, stale.nonce);
    await replacement.release();
  } finally { await rm(directory, { recursive: true, force: true }); }
});

test("an active or ambiguous supervised generation is retained without replacement", async () => {
  for (const disposition of ["active", "ambiguous"] as const) {
    const directory = await mkdtemp(join(tmpdir(), `b122-instance-${disposition}-`));
    const stale = staleSupervisedRecord(999_999);
    try {
      await writeFile(join(directory, "companion-instance.json"), `${JSON.stringify(stale)}\n`, "utf8");
      await assert.rejects(
        () => acquireCompanionInstance(directory, process.execPath, { observeSupervisor: async () => disposition }),
        disposition === "active" ? /still owns an active process tree/ : /lacks an exact terminal containment receipt/
      );
      assert.equal(parseInstance(await readFile(join(directory, "companion-instance.json"), "utf8")).nonce, stale.nonce);
    } finally { await rm(directory, { recursive: true, force: true }); }
  }
});

test("authenticated failed-shutdown evidence is reconciled only after exact terminal supervisor proof", async () => {
  const directory = await mkdtemp(join(tmpdir(), "b122-instance-shutdown-recovery-"));
  const stale = staleSupervisedRecord(999_998);
  const protector = new FakeUserSecretProtector();
  try {
    await writeFile(join(directory, "companion-instance.json"), `${JSON.stringify(stale)}\n`, "utf8");
    const recovery = {
      schema: "sxsy-b122.shutdown-recovery",
      version: 2,
      status: "recovery_required",
      leaseNonce: stale.nonce,
      pid: stale.pid,
      supervisorId: stale.supervisorId,
      failedResources: ["voice"],
      blockedResources: ["hid"],
      recordedAt: "2026-08-25T00:00:01.000Z"
    };
    const clear = Buffer.from(JSON.stringify(recovery), "utf8");
    const sealed = await protector.seal(clear); clear.fill(0);
    await writeFile(join(directory, "shutdown-recovery.json"), JSON.stringify({ schema: "sxsy-b122.dpapi-shutdown-recovery", version: 1, protector: protector.provider, sealed }), "utf8");
    await assert.rejects(() => acquireCompanionInstance(directory, process.execPath, { protector, observeSupervisor: async () => "active" }), /active process tree/);
    const replacement = await acquireCompanionInstance(directory, process.execPath, { protector, observeSupervisor: async () => "terminal" });
    await assert.rejects(readFile(join(directory, "shutdown-recovery.json"), "utf8"), (error: unknown) => typeof error === "object" && error !== null && "code" in error && (error as { code?: unknown }).code === "ENOENT");
    await replacement.release();
  } finally { await rm(directory, { recursive: true, force: true }); }
});
