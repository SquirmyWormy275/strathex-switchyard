/** Exact private-server tmux pane metadata and navigation; never terminal text. */
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { lstat } from "node:fs/promises";
import { dirname } from "node:path";
import { userInfo } from "node:os";
import { linuxProcess, linuxTmuxContext } from "./native-process.mjs";
import { desktopEnvironment } from "./process-environment.mjs";

const execute = promisify(execFile);
const paneFormat = "#{pid}\t#{session_id}\t#{window_id}\t#{pane_id}\t#{pane_pid}\t#{pane_tty}";
const clientFormat = "#{pid}\t#{client_pid}\t#{client_tty}\t#{session_id}\t#{window_id}\t#{pane_id}";
const terminals = { "/usr/bin/foot": "foot", "/usr/bin/alacritty": "alacritty" }, shells = ["/usr/bin/bash", "/usr/bin/zsh", "/usr/bin/fish"];
const identity = p => [p.pid, p.parentPid, p.startTicks, p.executable, p.uid, p.groupId, p.tty, p.foregroundGroup];
const positive = value => /^[1-9][0-9]{0,9}$/.test(value) && Number(value) <= 2147483647;
const id = (value, prefix) => value?.[0] === prefix && /^(?:0|[1-9][0-9]{0,9})$/.test(value.slice(1)) && Number(value.slice(1)) <= 2147483647;
const tty = value => typeof value === "string" && /^\/dev\/pts\/(?:0|[1-9][0-9]{0,5})$/.test(value);
function lines(text, fields, maximum) {
  if (typeof text !== "string" || Buffer.byteLength(text) > 65536 || /[\0\r]/.test(text)) throw Error("Unsupported bounded tmux metadata.");
  const rows = text.endsWith("\n") ? text.slice(0, -1).split("\n") : text.split("\n");
  if (!text || rows.length > maximum || rows.some(row => row.split("\t").length !== fields)) throw Error("Missing or ambiguous tmux metadata.");
  return rows.map(row => row.split("\t"));
}
async function runTmux(socket, args) {
  const { stdout } = await execute("/usr/bin/tmux", ["-N", "-S", socket, ...args], { shell: false, env: desktopEnvironment(), timeout: 3000, maxBuffer: 65536, encoding: "utf8" });
  return stdout;
}
export function createTmuxTaskWindow({ readProcess = linuxProcess, stat = lstat, command = runTmux, uid = userInfo().uid, readContext = linuxTmuxContext } = {}) {
  async function socketIdentity(socket) {
    const directory = await stat(dirname(socket)), file = await stat(socket);
    if (!directory.isDirectory() || directory.isSymbolicLink() || directory.uid !== uid || (directory.mode & 0o077) || !file.isSocket() || file.isSymbolicLink() || file.uid !== uid || (file.mode & 0o007)) throw Error("The selected tmux socket is not private to this user.");
    return [String(directory.dev), String(directory.ino), String(file.dev), String(file.ino)];
  }
  async function assertTty(path, process) {
    if (!tty(path)) throw Error("Unsupported exact tmux terminal identity.");
    const device = await stat(path);
    if (!device.isCharacterDevice() || device.isSymbolicLink() || device.uid !== uid || Number(BigInt.asIntN(32, BigInt(device.rdev))) !== process.tty) throw Error("The tmux terminal device differs from its native process.");
  }
  return {
    async inspect({ cli, lineage, server }) {
      if (server.executable !== "/usr/bin/tmux" || server.uid !== uid || server.state === "Z") throw Error("The exact tmux server process is unavailable.");
      const context = await readContext(cli.pid), { socket } = context;
      if (context.serverPid !== server.pid || !id(context.pane, "%")) throw Error("The native tmux coordinates differ from the exact server lineage.");
      const originalSocket = await socketIdentity(socket), root = lineage.at(-1);
      // show-hooks itself has no after-command hook. Check the exact target
      // scopes before querying commands which may have configured after hooks.
      for (const args of [["show-hooks", "-g"], ["show-hooks", "-gw"], ["show-hooks", "-gp"], ["show-hooks", "-t", context.pane], ["show-hooks", "-w", "-t", context.pane], ["show-hooks", "-p", "-t", context.pane]]) {
        const hooks = await command(socket, args);
        if (typeof hooks !== "string" || Buffer.byteLength(hooks) > 16384 || hooks.split("\n").some(line => line && !/^[a-z][a-z0-9-]{0,80}$/.test(line))) throw Error("Configured tmux hooks require separate integration; no navigation was dispatched.");
      }
      const panes = lines(await command(socket, ["display-message", "-p", "-t", context.pane, paneFormat]), 6, 1);
      const seen = new Set();
      for (const row of panes) {
        if (!positive(row[0]) || Number(row[0]) !== server.pid || !id(row[1], "$") || !id(row[2], "@") || !id(row[3], "%") || !positive(row[4]) || !tty(row[5]) || seen.has(row[3])) throw Error("Ambiguous exact tmux pane inventory.");
        seen.add(row[3]);
      }
      const matches = panes.filter(row => Number(row[4]) === root.pid && row[3] === context.pane);
      if (matches.length !== 1) throw Error("One exact tmux pane must own the native foreground lineage.");
      const pane = matches[0]; await assertTty(pane[5], cli);
      const clients = lines(await command(socket, ["list-clients", "-t", pane[1], "-F", clientFormat]), 6, 8);
      if (clients.length !== 1) throw Error("One attached tmux client is required; shared clients are not selected.");
      const client = clients[0];
      if (!positive(client[0]) || Number(client[0]) !== server.pid || !positive(client[1]) || !tty(client[2]) || !id(client[3], "$") || !id(client[4], "@") || !id(client[5], "%")) throw Error("Unsupported exact tmux client inventory.");
      const process = await readProcess(Number(client[1]));
      if (process.executable !== "/usr/bin/tmux" || process.uid !== uid || process.state === "Z" || process.tty === 0 || process.foregroundGroup !== process.groupId) throw Error("The attached tmux client is not an exact foreground process.");
      await assertTty(client[2], process);
      const attached = [process]; let terminal = await readProcess(process.parentPid);
      if (shells.includes(terminal.executable)) { attached.push(terminal); terminal = await readProcess(terminal.parentPid); }
      if (!Object.hasOwn(terminals, terminal.executable) || terminal.uid !== uid || terminal.state === "Z" || attached.some(p => p.uid !== uid || p.state === "Z")) throw Error("The tmux client has no exact supported direct terminal window.");
      const currentSocket = await socketIdentity(socket), currentServer = await readProcess(server.pid);
      if (JSON.stringify(originalSocket) !== JSON.stringify(currentSocket) || JSON.stringify(identity(server)) !== JSON.stringify(identity(currentServer)) || JSON.stringify(context) !== JSON.stringify(await readContext(cli.pid))) throw Error("The exact tmux socket or server changed during observation.");
      return { terminal, terminalKind: terminals[terminal.executable] + "+tmux", attached: [...attached, terminal], witness: { socket, socketIdentity: originalSocket, server: identity(server), client: identity(process), clientTty: client[2], paneTty: pane[5], session: pane[1], window: pane[2], pane: pane[3], paneRoot: identity(root) }, selection: { session: client[3], window: client[4], pane: client[5] } };
    },
    async select(observed) {
      if (!observed || !tty(observed.clientTty) || !id(observed.pane, "%") || JSON.stringify(await socketIdentity(observed.socket)) !== JSON.stringify(observed.socketIdentity)) throw Error("The exact witnessed tmux navigation target changed.");
      const result = await command(observed.socket, ["switch-client", "-E", "-c", observed.clientTty, "-t", observed.pane]);
      if (result !== "") throw Error("The exact tmux pane switch did not acknowledge navigation.");
    }
  };
}
