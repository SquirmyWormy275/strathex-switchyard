/** Internal Linux provider lifetime. Fixed restricted CLI, never a general command port. */
import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { constants } from "node:fs";
import { lstat, open, readFile, readdir, realpath } from "node:fs/promises";
import { userInfo } from "node:os";
import { isAbsolute, join } from "node:path";
import readline from "node:readline";
import { codexRestrictedProcessArguments } from "./agents.mjs";
import { desktopEnvironment } from "./process-environment.mjs";
import { directoryIdentity } from "./private-fs.mjs";

if (process.platform !== "linux") process.exit(2);
const uid = userInfo().uid, lines = readline.createInterface({ input: process.stdin, crlfDelay: Infinity });
let request, started = false, stopping, native, pinned, bytes = 0, ended = false;
const require = value => { if (!value) throw Error("Unconfirmed owned listener scope"); };
const write = value => new Promise(resolve => { process.stdout.write(JSON.stringify(value) + "\n", () => resolve()); });
process.stdout.on("error", () => {});
async function processInfo(pid) {
  try { const s = await lstat(`/proc/${pid}`), text = await readFile(`/proc/${pid}/stat`, "utf8"), f = text.slice(text.lastIndexOf(")") + 2).split(" "); return { pid, uid: s.uid, birth: f[19], group: +f[2], session: +f[3], state: f[0] }; }
  catch (error) { if (["ENOENT", "ESRCH"].includes(error.code)) return null; throw error; }
}
async function members() {
  const found = [];
  for (const name of await readdir("/proc")) if (/^[1-9][0-9]*$/.test(name) && +name !== process.pid) { const p = await processInfo(+name); if (p && p.state !== "Z" && (p.group === process.pid || p.session === process.pid)) found.push(p); }
  return found;
}
async function stopMembers() {
  const end = Date.now() + 3000;
  do {
    const active = await members(); if (!active.length) return true;
    for (const original of active) { const current = await processInfo(original.pid); if (current && current.birth === original.birth && (current.group === process.pid || current.session === process.pid)) try { process.kill(current.pid, "SIGKILL"); } catch (error) { if (error.code !== "ESRCH") throw error; } }
    await new Promise(resolve => setTimeout(resolve, 20));
  } while (Date.now() < end);
  return (await members()).length === 0;
}
function stop() {
  return stopping ??= (async () => {
    clearTimeout(startup);
    const exited = await stopMembers().catch(() => false);
    await pinned?.close().catch(() => {}); pinned = undefined;
    if (request) await write({ schema: request.schema, role: "codex-listener", id: request.id, event: "exit", treeExitVerified: exited });
    ended = true; lines.removeAllListeners("close"); lines.close(); process.stdin.destroy();
    process.exit(exited ? 0 : 3);
  })();
}
const startup = setTimeout(() => { void stop(); }, 10000);
process.stdin.on("data", chunk => { bytes += chunk.length; if (bytes > 65536) void stop(); });
lines.once("close", () => { void stop(); });
lines.on("line", line => { void (async () => {
  require(!ended && !stopping && Buffer.byteLength(line) <= 61440);
  if (!request) {
    const r = JSON.parse(line);
    require(r && Object.keys(r).sort().join() === "cwd,endpoint,executable,executableSha256,id,schema,serverNames");
    require(r.schema === "switchyard-runtime-command/v1" && /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/.test(r.id) && isAbsolute(r.executable) && isAbsolute(r.cwd) && /^[a-f0-9]{64}$/.test(r.executableSha256));
    codexRestrictedProcessArguments(r.executable, r.serverNames, { mode: "unix-listener", socketPath: r.endpoint });
    const startupDirectory = await directoryIdentity(r.cwd); require(Number(startupDirectory.uid) === uid && !(Number(startupDirectory.mode) & 0o077));
    for (const name of [".git", ".codex", "AGENTS.md"]) try { await lstat(join(r.cwd, name)); throw Error("Project startup is unavailable"); } catch (error) { if (error.code !== "ENOENT") throw error; }
    require(await realpath(r.executable) === r.executable);
    pinned = await open(r.executable, constants.O_RDONLY | constants.O_NOFOLLOW);
    const image = await pinned.stat(); require(image.isFile() && [0, uid].includes(image.uid) && !(image.mode & 0o6022) && image.size <= 512 * 1024 * 1024);
    const digest = createHash("sha256"); for await (const chunk of pinned.createReadStream({ autoClose: false })) digest.update(chunk); require(digest.digest("hex") === r.executableSha256);
    require(!stopping);
    const self = await processInfo(process.pid); require(self.uid === uid && self.group === process.pid && self.session === process.pid);
    request = r;
    await write({ schema: r.schema, role: "codex-listener", id: r.id, event: "ready", guardianPid: process.pid, birth: self.birth, containment: "owned-linux-session" });
  } else {
    const ack = JSON.parse(line); require(!started && Object.keys(ack).sort().join() === "id,schema,start" && ack.schema === request.schema && ack.id === request.id && ack.start === true);
    started = true; clearTimeout(startup);
    const args = [...codexRestrictedProcessArguments(request.executable, request.serverNames, { mode: "unix-listener", socketPath: request.endpoint }), "--startup-client-info", JSON.stringify({ name: "switchyard_design", title: "Switchyard design", version: "0.2.0" })];
    // Executing the already-hashed inherited descriptor closes the named-image
    // replacement race. setpriv installs parent death before checking ppid.
    const enter = "import os,sys,json; expected=int(sys.argv[1]); assert os.getppid()==expected; os.umask(0o077); os.execve(3,[sys.argv[2],*json.loads(sys.argv[3])],os.environ)";
    native = spawn("/usr/bin/setpriv", ["--no-new-privs", "--pdeathsig", "KILL", "--", "/usr/bin/python3", "-I", "-B", "-c", enter, String(process.pid), request.executable, JSON.stringify(args)], { cwd: request.cwd, env: desktopEnvironment(), shell: false, stdio: ["ignore", "ignore", "ignore", pinned.fd] });
    native.once("error", () => { void stop(); }); native.once("close", () => { void stop(); });
    const original = await processInfo(native.pid); require(original && original.uid === uid && original.group === process.pid && original.session === process.pid);
    await pinned.close(); pinned = undefined;
    await write({ schema: request.schema, role: "codex-listener", id: request.id, event: "native-started", pid: original.pid, birth: original.birth });
  }
})().catch(() => { void stop(); }); });
