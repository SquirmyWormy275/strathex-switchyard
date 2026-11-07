/** Read-only current-user process identities shared by exact native targets. */
import { readFile, readlink, lstat, open } from "node:fs/promises";
import { constants } from "node:fs";

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

/** Extract only tmux's two native coordinates; never decode other environment values. */
export function parseTmuxContext(bytes) {
  if (!Buffer.isBuffer(bytes) || !bytes.length || bytes.length > 65536 || bytes.at(-1) !== 0) throw Error("Unsupported bounded tmux process coordinates.");
  const found = new Map(), keys = [Buffer.from("TMUX="), Buffer.from("TMUX_PANE=")];
  for (let start = 0; start < bytes.length;) {
    const end = bytes.indexOf(0, start), entry = bytes.subarray(start, end);
    for (const key of keys) if (entry.subarray(0, key.length).equals(key)) {
      const name = key.toString("ascii"); if (found.has(name)) throw Error("Duplicate tmux process coordinates.");
      found.set(name, new TextDecoder("utf-8", { fatal: true }).decode(entry.subarray(key.length)));
    }
    start = end + 1;
  }
  const value = found.get("TMUX="), pane = found.get("TMUX_PANE="), parts = value?.split(",");
  if (parts?.length !== 3 || !parts[0].startsWith("/") || Buffer.byteLength(parts[0]) > 107 || /[\\\x00-\x1f\x7f]/.test(parts[0]) || parts[0].split("/").slice(1).some(part => !part || part === "." || part === "..") || !/^[1-9][0-9]{0,9}$/.test(parts[1]) || Number(parts[1]) > 2147483647 || !/^(?:0|[1-9][0-9]{0,9})$/.test(parts[2]) || Number(parts[2]) > 2147483647 || !/^%(?:0|[1-9][0-9]{0,9})$/.test(pane ?? "") || Number(pane.slice(1)) > 2147483647) throw Error("Missing or invalid exact tmux process coordinates.");
  return { socket: parts[0], serverPid: Number(parts[1]), pane };
}
export async function linuxTmuxContext(pid) {
  if (!Number.isSafeInteger(pid) || pid < 1) throw Error("An exact native PID is required.");
  const file = await open(`/proc/${pid}/environ`, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0)), bytes = Buffer.alloc(65537);
  try {
    let size = 0;
    while (size < bytes.length) { const read = await file.read(bytes, size, bytes.length - size, size); if (!read.bytesRead) break; size += read.bytesRead; }
    return parseTmuxContext(bytes.subarray(0, size));
  } finally { bytes.fill(0); await file.close(); }
}
