import { randomUUID } from "node:crypto";
import { mkdir, open, readFile, realpath, rm } from "node:fs/promises";
import { isAbsolute, join, resolve } from "node:path";

const schema = "sxsy-b122.companion-instance";
export interface CompanionInstanceRecord { readonly schema: typeof schema; readonly version: 1; readonly nonce: string; readonly pid: number; readonly startedAt: string; readonly mainPath: string; readonly processPath: string; }
export interface CompanionInstanceLease { readonly record: CompanionInstanceRecord; readonly filePath: string; release(): Promise<void>; }

/** Exact per-user single-instance lease. Stale files are removed only after the recorded PID is proven absent. */
export async function acquireCompanionInstance(stateDirectory: string, mainPath: string): Promise<CompanionInstanceLease> {
  if (!isAbsolute(stateDirectory) || !isAbsolute(mainPath) || /[\r\n\0]/.test(stateDirectory + mainPath)) throw new Error("Companion instance paths must be fixed and absolute.");
  const directory = resolve(stateDirectory);
  await mkdir(directory, { recursive: true, mode: 0o700 });
  const canonicalMain = await realpath(mainPath);
  const canonicalProcess = await realpath(process.execPath);
  const filePath = join(directory, "companion-instance.json");
  const record: CompanionInstanceRecord = { schema, version: 1, nonce: randomUUID(), pid: process.pid, startedAt: new Date().toISOString(), mainPath: canonicalMain, processPath: canonicalProcess };
  for (let attempt = 0; attempt < 2; attempt += 1) {
    try {
      const handle = await open(filePath, "wx", 0o600);
      try { await handle.writeFile(`${JSON.stringify(record)}\n`, "utf8"); await handle.sync(); } finally { await handle.close(); }
      return { record, filePath, async release() { let current: CompanionInstanceRecord | undefined; try { current = parseInstance(await readFile(filePath, "utf8")); } catch { return; } if (current.nonce === record.nonce && current.pid === record.pid) await rm(filePath, { force: true }); } };
    } catch (error) {
      if (!alreadyExists(error)) throw error;
      const current = await readFile(filePath, "utf8").then(parseInstance).catch(() => undefined);
      if (!current) throw new Error("The companion instance record is malformed; refusing automatic replacement.");
      if (processExists(current.pid)) throw new Error("Another SXSY-B122 companion instance is already active.");
      if (attempt > 0) throw new Error("The stale companion instance record could not be replaced safely.");
      await rm(filePath, { force: true });
    }
  }
  throw new Error("The companion instance lease could not be acquired.");
}

export function parseInstance(text: string): CompanionInstanceRecord {
  let value: unknown; try { value = JSON.parse(text); } catch { throw new Error("Companion instance record is not JSON."); }
  if (!record(value) || Object.keys(value).length !== 7 || value.schema !== schema || value.version !== 1 || typeof value.nonce !== "string" || !/^[a-f0-9-]{36}$/i.test(value.nonce) || !Number.isSafeInteger(value.pid) || (value.pid as number) <= 0 || typeof value.startedAt !== "string" || !Number.isFinite(Date.parse(value.startedAt)) || typeof value.mainPath !== "string" || !isAbsolute(value.mainPath) || typeof value.processPath !== "string" || !isAbsolute(value.processPath)) throw new Error("Companion instance record is invalid.");
  return value as unknown as CompanionInstanceRecord;
}
function processExists(pid: number): boolean { try { process.kill(pid, 0); return true; } catch (error) { return !(record(error) && error.code === "ESRCH"); } }
function alreadyExists(error: unknown): boolean { return record(error) && error.code === "EEXIST"; }
function record(value: unknown): value is Record<string, unknown> { return typeof value === "object" && value !== null && !Array.isArray(value); }
