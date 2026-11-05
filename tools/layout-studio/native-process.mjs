/** Read-only current-user process identities shared by exact native targets. */
import { readFile, readlink, lstat } from "node:fs/promises";

export function processStat(text, pid) {
  const end = text.lastIndexOf(")"), fields = text.slice(end + 2).trim().split(/\s+/);
  if (!text.startsWith(`${pid} (`) || end < 0 || fields.length < 20 || !/^[A-Za-z]$/.test(fields[0]) || !/^\d+$/.test(fields[19])) throw new Error("The native process identity could not be read.");
  const numbers = [1, 2, 4, 5].map((i) => Number(fields[i]));
  if (numbers.some((v) => !Number.isSafeInteger(v)) || numbers[0] < 1 || numbers[1] < 1) throw new Error("The native process group is unsupported.");
  return { pid, state: fields[0], parentPid: numbers[0], groupId: numbers[1], tty: numbers[2], foregroundGroup: numbers[3], startTicks: fields[19] };
}
export async function linuxProcess(pid) {
  if (!Number.isSafeInteger(pid) || pid < 1) throw new Error("An exact native PID is required.");
  const root = `/proc/${pid}`, [stat, owner, executable, cwd] = await Promise.all([readFile(`${root}/stat`, "utf8"), lstat(root), readlink(`${root}/exe`), readlink(`${root}/cwd`)]);
  return { ...processStat(stat, pid), uid: owner.uid, executable, cwd };
}
