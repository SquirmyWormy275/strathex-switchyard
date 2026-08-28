import { constants } from "node:fs";
import { lstat, open, readFile, realpath, rm } from "node:fs/promises";
import { join } from "node:path";
import { acquireLinuxExclusiveLock } from "./linux-exclusive-lock.ts";

interface LeaseRecord { readonly schema: "sxsy-b122.linux-companion-lease"; readonly version: 1; readonly pid: number; readonly procStartTicks: string; readonly executable: string; readonly startedAt: string; }

export interface LinuxCompanionLease { readonly record: LeaseRecord; release(): Promise<void>; }

export async function acquireLinuxCompanionLease(stateDirectory: string): Promise<LinuxCompanionLease> {
  if (process.platform !== "linux" || !process.getuid) throw new Error("The Linux companion lease is unavailable on this platform.");
  const canonicalState = await realpath(stateDirectory);
  const path = join(canonicalState, "linux-companion.lease.json");
  const acquisition = await acquireLinuxExclusiveLock(join(canonicalState, "linux-companion-lease.lock"));
  const record: LeaseRecord = { schema: "sxsy-b122.linux-companion-lease", version: 1, pid: process.pid, procStartTicks: await procStartTicks(process.pid), executable: await realpath(process.execPath), startedAt: new Date().toISOString() };
  try {
    try {
      const handle = await open(path, constants.O_CREAT | constants.O_EXCL | constants.O_WRONLY | constants.O_NOFOLLOW, 0o600);
      try { await handle.writeFile(`${JSON.stringify(record)}\n`, "utf8"); await handle.sync(); } finally { await handle.close(); }
      return { record, release: () => releaseLease(canonicalState, path, record) };
    } catch (error) {
      if (!exists(error)) throw error;
      const current = await readOwnedLease(path);
      if (await exactProcessAlive(current)) throw new Error("Another SXSY-B122 Linux companion instance is already active.");
      await rm(path);
      const handle = await open(path, constants.O_CREAT | constants.O_EXCL | constants.O_WRONLY | constants.O_NOFOLLOW, 0o600);
      try { await handle.writeFile(`${JSON.stringify(record)}\n`, "utf8"); await handle.sync(); } finally { await handle.close(); }
      return { record, release: () => releaseLease(canonicalState, path, record) };
    }
  } finally { await acquisition.release(); }
}

async function releaseLease(stateDirectory: string, path: string, record: LeaseRecord): Promise<void> {
  const lock = await acquireLinuxExclusiveLock(join(stateDirectory, "linux-companion-lease.lock"));
  try {
    const current = await readOwnedLease(path).catch(() => undefined);
    if (current?.pid === record.pid && current.procStartTicks === record.procStartTicks && current.executable === record.executable) await rm(path);
  } finally { await lock.release(); }
}

async function readOwnedLease(path: string): Promise<LeaseRecord> {
  const metadata = await lstat(path);
  if (!metadata.isFile() || metadata.isSymbolicLink() || metadata.uid !== process.getuid!() || metadata.size < 2 || metadata.size > 8192 || (metadata.mode & 0o077) !== 0) throw new Error("The Linux companion lease is unsafe.");
  const value: unknown = JSON.parse(await readFile(path, "utf8"));
  if (!record(value) || exactKeys(value, ["schema", "version", "pid", "procStartTicks", "executable", "startedAt"]) === false || value.schema !== "sxsy-b122.linux-companion-lease" || value.version !== 1 || !Number.isSafeInteger(value.pid) || Number(value.pid) < 1 || typeof value.procStartTicks !== "string" || !/^[0-9]+$/.test(value.procStartTicks) || typeof value.executable !== "string" || !value.executable.startsWith("/") || typeof value.startedAt !== "string") throw new Error("The Linux companion lease is malformed.");
  return value as unknown as LeaseRecord;
}

async function exactProcessAlive(record: LeaseRecord): Promise<boolean> {
  try { return await procStartTicks(record.pid) === record.procStartTicks && await realpath(`/proc/${record.pid}/exe`) === record.executable; }
  catch { return false; }
}

async function procStartTicks(pid: number): Promise<string> {
  const fields = (await readFile(`/proc/${pid}/stat`, "utf8")).trim().replace(/^\d+ \([^)]*\) /, "").split(" ");
  const start = fields[19];
  if (!start || !/^[0-9]+$/.test(start)) throw new Error("The Linux process start identity is unavailable.");
  return start;
}

function exists(error: unknown): boolean { return typeof error === "object" && error !== null && "code" in error && (error as { code?: string }).code === "EEXIST"; }
function record(value: unknown): value is Record<string, unknown> { return typeof value === "object" && value !== null && !Array.isArray(value); }
function exactKeys(value: Record<string, unknown>, keys: readonly string[]): boolean { return Object.keys(value).length === keys.length && keys.every((key) => key in value); }
