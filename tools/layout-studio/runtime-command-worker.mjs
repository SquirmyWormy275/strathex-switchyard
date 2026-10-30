/** Internal Linux installer guardian. Its own session anchors exact descendant ownership. */
import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { createReadStream } from "node:fs";
import { readFile, readdir, lstat, realpath } from "node:fs/promises";
import { isAbsolute } from "node:path";
import { userInfo } from "node:os";
import readline from "node:readline";
import { fileURLToPath } from "node:url";
if (process.platform !== "linux") throw new Error("The Linux runtime guardian requires its native session boundary.");
const lines = readline.createInterface({ input: process.stdin, crlfDelay: Infinity });
let request, child, parentGone = false, ready = false, started = false, finished = false, inputBytes = 0;
process.stdin.on("data", (b) => { inputBytes += b.length; if (inputBytes > 65536) loseParent(); });
function loseParent() { parentGone = true; if (started) process.kill(-process.pid, "SIGKILL"); else process.exit(2); }
lines.once("close", loseParent);
const write = (value) => new Promise((resolve) => process.stdout.write(JSON.stringify(value) + "\n", resolve));
async function members() {
  const found = [];
  for (const name of await readdir("/proc")) {
    if (!/^\d+$/.test(name) || +name === process.pid) continue;
    try {
      const s = await readFile(`/proc/${name}/stat`, "utf8"), f = s.slice(s.lastIndexOf(") ") + 2).split(" ");
      if (+f[2] === process.pid && +f[3] === process.pid && f[0] !== "Z") found.push({ pid: +name, birth: f[19] });
    } catch (e) { if (!["ENOENT", "ESRCH", "EACCES"].includes(e.code)) throw e; }
  }
  return found;
}
async function stopMembers() {
  const deadline = Date.now() + 3000;
  do {
    const active = await members(); if (!active.length) return true;
    for (const p of active) {
      try { const s = await readFile(`/proc/${p.pid}/stat`, "utf8"), f = s.slice(s.lastIndexOf(") ") + 2).split(" "); if (+f[2] === process.pid && +f[3] === process.pid && f[19] === p.birth) process.kill(p.pid, "SIGKILL"); }
      catch (e) { if (!["ENOENT", "ESRCH"].includes(e.code)) throw e; }
    }
    await new Promise((r) => setTimeout(r, 20));
  } while (Date.now() < deadline);
  return (await members()).length === 0;
}
async function run() {
  if (parentGone || started) return; started = true;
  const chunks = []; let bytes = 0, status = "completed", timeout;
  child = spawn("/usr/bin/setpriv", ["--no-new-privs", "--pdeathsig", "KILL", "--", process.execPath, fileURLToPath(new URL("./runtime-command-exec.mjs", import.meta.url)), String(process.pid), request.executable, JSON.stringify(request.args)], { cwd: request.cwd, env: request.environment, shell: false, detached: false, stdio: ["ignore", "pipe", "pipe"] });
  let stopping;
  const stop = () => stopping ??= stopMembers().catch(() => loseParent());
  child.stdout.on("data", (b) => { bytes += b.length; if (bytes > request.maxOutputBytes) { if (status === "completed") { status = "output-limit"; void stop(); } } else chunks.push(b); });
  child.stderr.on("data", () => {});
  const exited = new Promise((resolve) => { child.once("error", () => resolve(null)); child.once("exit", (code) => resolve(code)); });
  const drained = new Promise((resolve) => { child.once("error", resolve); child.once("close", resolve); });
  timeout = setTimeout(() => { if (status === "completed") status = "timed-out"; void stop(); }, request.timeoutMs);
  const exitCode = await exited; clearTimeout(timeout);
  const treeExitVerified = await stopMembers();
  let drainTimer;
  try { await Promise.race([drained, new Promise((_, reject) => { drainTimer = setTimeout(() => reject(new Error("Owned output pipe exit unconfirmed")), 3000); })]); } finally { clearTimeout(drainTimer); }
  if (status === "completed" && exitCode !== 0) status = "failed";
  finished = true;
  await write({ schema: request.schema, id: request.id, event: "result", status, exitCode, stdout: Buffer.concat(chunks).toString("base64"), treeExitVerified, containment: "owned-linux-session" });
  if (!treeExitVerified) process.kill(-process.pid, "SIGKILL");
  lines.removeAllListeners("close"); lines.close(); process.stdin.destroy();
  process.exit(treeExitVerified ? 0 : 3);
}
lines.on("line", (line) => { void (async () => {
  if (!request) {
    request = JSON.parse(line);
    const r = request;
    if (r.schema !== "switchyard-runtime-command/v1" || !/^[a-f0-9-]{36}$/.test(r.id) || !isAbsolute(r.executable) || !isAbsolute(r.cwd) || !/^[a-f0-9]{64}$/.test(r.executableSha256) || !Array.isArray(r.args) || r.args.length > 32 || r.args.some((a) => typeof a !== "string" || a.length > 8192 || /[\0\r\n]/.test(a)) || !Number.isSafeInteger(r.timeoutMs) || r.timeoutMs < 1 || r.timeoutMs > 600000 || !Number.isSafeInteger(r.maxOutputBytes) || r.maxOutputBytes < 1 || r.maxOutputBytes > 524288 || !r.environment || typeof r.environment !== "object" || Object.keys(r.environment).length > 64 || Object.entries(r.environment).some(([k,v]) => !/^[A-Za-z_][A-Za-z0-9_]*$/.test(k) || typeof v !== "string" || v.length > 8192 || v.includes("\0"))) throw new Error("Invalid runtime command scope");
    const self = await readFile(`/proc/${process.pid}/stat`, "utf8"), fields = self.slice(self.lastIndexOf(") ") + 2).split(" ");
    if (+fields[2] !== process.pid || +fields[3] !== process.pid) throw new Error("The guardian has no private native session");
    const executable = await realpath(r.executable), s = await lstat(executable);
    if (!s.isFile() || ![0, userInfo().uid].includes(s.uid) || s.mode & 0o6022) throw new Error("Unsafe native runtime executable");
    const hash = createHash("sha256"); for await (const b of createReadStream(executable)) hash.update(b);
    if (hash.digest("hex") !== r.executableSha256) throw new Error("Runtime executable identity changed");
    if (parentGone) return;
    ready = true;
    await write({ schema: r.schema, id: r.id, event: "ready", guardianPid: process.pid, birth: fields[19], containment: "owned-linux-session" });
  } else {
    const ack = JSON.parse(line);
    if (!ready || started || ack.schema !== request.schema || ack.id !== request.id || ack.start !== true) throw new Error("Invalid runtime start acknowledgement");
    await run();
  }
})().catch(async () => { if (!finished) { if (started) { try { await stopMembers(); } finally { process.kill(-process.pid, "SIGKILL"); } } process.exit(2); } }); });
