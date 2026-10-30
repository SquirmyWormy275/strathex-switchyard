/** Exact interactive Claude window focus on Linux. No title/foreground typing. */
import { readFile, readlink, lstat } from "node:fs/promises";
import { userInfo } from "node:os";
import { runHypr } from "./host.mjs";

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
const identity = (p) => [p.pid, p.parentPid, p.startTicks, p.executable, p.uid];
export function createTaskWindow({ platform = process.platform, readProcess = linuxProcess, hypr = runHypr, uid = userInfo().uid } = {}) {
  async function inspect(row, executable, repositoryRoot) {
    if (platform !== "linux") throw new Error("Native Claude task-window focus is implemented only for the verified Linux Foot path. Windows terminal/window integration remains unfinished.");
    if (row?.kind !== "interactive" || !Number.isSafeInteger(row.pid) || row.pid < 1) throw new Error("Native focus needs a live exact interactive Claude session. Background worker PIDs do not identify an attached terminal window.");
    const cli = await readProcess(row.pid);
    if (cli.uid !== uid || cli.executable !== executable || cli.cwd !== repositoryRoot || cli.state === "Z" || cli.tty === 0 || cli.foregroundGroup !== cli.groupId) throw new Error("The exact Claude CLI is not the foreground process in its verified directory and terminal.");
    const lineage = [cli]; let terminal = await readProcess(cli.parentPid);
    if (["/usr/bin/bash", "/usr/bin/zsh", "/usr/bin/fish"].includes(terminal.executable)) { lineage.push(terminal); terminal = await readProcess(terminal.parentPid); }
    if (terminal.executable !== "/usr/bin/foot" || terminal.uid !== uid || terminal.state === "Z" || lineage.some((p) => p.uid !== uid)) throw new Error("This session is not a direct Foot foreground CLI. Multiplexed, shared-server and other terminal hosts are not guessed.");
    lineage.push(terminal);
    const windows = JSON.parse(await hypr("clients", "-j"));
    if (!Array.isArray(windows)) throw new Error("Native task-window discovery is unavailable.");
    const matches = windows.filter((w) => w.pid === terminal.pid && w.mapped === true && w.hidden === false && /^0x[a-f0-9]{1,16}$/i.test(w.address));
    if (matches.length !== 1) throw new Error("One exact mapped Foot window is required. Shared terminals and ambiguous windows are not selected.");
    return { address: matches[0].address, terminalPid: terminal.pid, lineage: lineage.map(identity) };
  }
  return {
    async focus({ row, executable, repositoryRoot, verifySession }) {
      const before = await inspect(row, executable, repositoryRoot);
      await verifySession();
      const justBefore = await inspect(row, executable, repositoryRoot);
      if (JSON.stringify(before) !== JSON.stringify(justBefore)) throw new Error("The exact native process/window changed before focus.");
      const result = await hypr("dispatch", `hl.dsp.focus({ window = "address:${before.address}" })`);
      if (result.trim() !== "ok") throw new Error("The compositor did not acknowledge exact task-window focus.");
      const focused = JSON.parse(await hypr("activewindow", "-j")), after = await inspect(row, executable, repositoryRoot);
      await verifySession();
      if (focused.address !== before.address || focused.pid !== before.terminalPid || JSON.stringify(before) !== JSON.stringify(after)) throw new Error("Exact task-window focus was not verified after dispatch.");
      return { effect: "exact-interactive-session-focused", windowFocusVerified: true, taskResumptionVerified: false, modelPromptSubmitted: false, taskCompletionVerified: false, provenance: "Claude native inventory plus current-user process/foreground-group lineage and compositor readback; no terminal text submitted" };
    }
  };
}
