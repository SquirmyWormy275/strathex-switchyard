import { constants, type BigIntStats } from "node:fs";
import { lstat, open, readFile, readlink } from "node:fs/promises";
import type { TerminalLike } from "./vscode-like.ts";

export const nativeImageIdentity = (s: BigIntStats): string => [s.dev, s.ino, s.size, s.uid, s.mode, s.mtimeNs, s.ctimeNs].join(":");
export interface StudioTerminalProcess {
  readonly pid: number; readonly birth: string; readonly executable: string; readonly executableIdentity: string;
}
function requireCurrent(value: unknown): asserts value { if (!value) throw Error("The exact terminal process is unavailable or changed."); }

/** Read the exact VS Code Terminal PID, never a title, child search or ancestor. */
export async function observeTerminalProcess(options: {
  terminal: TerminalLike; executable: string; executableIdentity: string;
  expected?: StudioTerminalProcess; assertCurrent: () => void | Promise<void>;
  signal: AbortSignal; timeoutMs?: number;
}): Promise<StudioTerminalProcess> {
  const timeoutMs = options.timeoutMs ?? 5000;
  requireCurrent(process.platform === "linux" && Number.isSafeInteger(timeoutMs) && timeoutMs >= 1 && timeoutMs <= 5000);
  let timer: ReturnType<typeof setTimeout> | undefined, abort: (() => void) | undefined, expired = false;
  const stopped = new Promise<never>((_, reject) => {
    abort = () => { expired = true; reject(Error("The terminal process observation was cancelled or timed out.")); };
    options.signal.addEventListener("abort", abort, { once: true });
    timer = setTimeout(abort, timeoutMs); if (options.signal.aborted) abort();
  });
  void stopped.catch(() => undefined);
  // Context reads are joined even on cancellation; no late callback is detached.
  const current = async () => { requireCurrent(!expired && !options.signal.aborted); await options.assertCurrent(); requireCurrent(!expired && !options.signal.aborted); };
  try {
    await current();
    const pid = await Promise.race([Promise.resolve(options.terminal.processId), stopped]);
    requireCurrent(Number.isSafeInteger(pid) && pid! > 0 && pid! <= 2147483647);
    const proc = `/proc/${pid}`, user = BigInt(process.getuid!());
    const identity = async (): Promise<StudioTerminalProcess> => {
      await current();
      const directory = await lstat(proc, { bigint: true });
      requireCurrent(directory.isDirectory() && !directory.isSymbolicLink() && directory.uid === user);
      const text = await readFile(proc + "/stat", "utf8"), end = text.lastIndexOf(") ");
      requireCurrent(Buffer.byteLength(text) <= 8192 && text.startsWith(`${pid} (`) && end > 0);
      const fields = text.slice(end + 2).trim().split(/\s+/), birth = fields[19];
      requireCurrent(fields.length >= 20 && /^[RSDTtWIP]$/.test(fields[0] ?? "") && /^[1-9][0-9]{0,19}$/.test(birth ?? ""));
      requireCurrent(await readlink(proc + "/exe") === options.executable);
      // /proc/PID/exe is a kernel link; pin its opened image, then recheck PID
      // birth and pathname after the asynchronous reads. Shell wrappers refuse.
      const image = await open(proc + "/exe", constants.O_RDONLY);
      try { const info = await image.stat({ bigint: true }); requireCurrent(info.isFile() && nativeImageIdentity(info) === options.executableIdentity); }
      finally { await image.close(); }
      return Object.freeze({ pid: pid!, birth: birth!, executable: options.executable, executableIdentity: options.executableIdentity });
    };
    const first = await identity();
    if (options.expected) requireCurrent(JSON.stringify(first) === JSON.stringify(options.expected));
    await current(); const last = await identity();
    requireCurrent(JSON.stringify(last) === JSON.stringify(first)); await current();
    // A final bounded result cannot manufacture protocol/account/task evidence.
    requireCurrent(!expired && !options.signal.aborted); return last;
  } finally { clearTimeout(timer); if (abort) options.signal.removeEventListener("abort", abort); }
}
