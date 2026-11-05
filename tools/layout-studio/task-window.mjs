/** Exact interactive Claude window focus on Linux. No title/foreground typing. */
import { linuxProcess } from "./native-process.mjs";
export { linuxProcess, processStat } from "./native-process.mjs";
import { userInfo } from "node:os";
import { runHypr } from "./host.mjs";

export const directTaskTerminals = Object.freeze({ "/usr/bin/foot": "foot", "/usr/bin/alacritty": "alacritty" });
const identity = (p) => [p.pid, p.parentPid, p.startTicks, p.executable, p.uid, p.groupId, p.tty, p.foregroundGroup];
export function createTaskWindow({ platform = process.platform, readProcess = linuxProcess, hypr = runHypr, uid = userInfo().uid } = {}) {
  async function inspect(row, executable, repositoryRoot) {
    if (platform !== "linux") throw new Error("Native Claude task-window focus requires a supported direct Linux terminal. Windows terminal/window integration remains unfinished.");
    if (row?.kind !== "interactive" || !Number.isSafeInteger(row.pid) || row.pid < 1) throw new Error("Native focus needs a live exact interactive Claude session. Background worker PIDs do not identify an attached terminal window.");
    const cli = await readProcess(row.pid);
    if (cli.uid !== uid || cli.executable !== executable || cli.cwd !== repositoryRoot || cli.state === "Z" || cli.tty === 0 || cli.foregroundGroup !== cli.groupId) throw new Error("The exact Claude CLI is not the foreground process in its verified directory and terminal.");
    const lineage = [cli]; let terminal = await readProcess(cli.parentPid);
    if (["/usr/bin/bash", "/usr/bin/zsh", "/usr/bin/fish"].includes(terminal.executable)) { lineage.push(terminal); terminal = await readProcess(terminal.parentPid); }
    if (!Object.hasOwn(directTaskTerminals, terminal.executable) || terminal.uid !== uid || terminal.state === "Z" || lineage.some((p) => p.uid !== uid)) throw new Error("This session is not a direct supported terminal foreground CLI. Multiplexed, shared-server and other terminal hosts are not guessed.");
    lineage.push(terminal);
    const windows = JSON.parse(await hypr("clients", "-j"));
    if (!Array.isArray(windows)) throw new Error("Native task-window discovery is unavailable.");
    // Alacritty supports multiple OS windows in one process. Count even hidden
    // or unmapped windows: one visible match cannot disambiguate that process.
    const matches = windows.filter((w) => w.pid === terminal.pid);
    if (matches.length !== 1 || matches[0].mapped !== true || matches[0].hidden !== false || !/^0x[a-f0-9]{1,16}$/i.test(matches[0].address)) throw new Error("One exact mapped direct terminal window is required. Shared terminals and ambiguous windows are not selected.");
    return { address: matches[0].address, terminalPid: terminal.pid, terminalKind: directTaskTerminals[terminal.executable], lineage: lineage.map(identity) };
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
      return { effect: "exact-interactive-session-focused", terminalKind: before.terminalKind, windowFocusVerified: true, taskResumptionVerified: false, modelPromptSubmitted: false, taskCompletionVerified: false, provenance: "Claude native inventory plus current-user process/foreground-group lineage and one exact compositor window with readback; no terminal text submitted" };
    }
  };
}
