/** One persistent restricted provider session, independent of bounded command deadlines. */
import { spawn } from "node:child_process";
import { createHash, randomUUID } from "node:crypto";
import { createReadStream } from "node:fs";
import { lstat, mkdtemp, readFile, readlink, readdir, realpath, rm, rmdir } from "node:fs/promises";
import { userInfo } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { codexRestrictedProcessArguments } from "./agents.mjs";
import { createPinnedCodexUnixClient } from "./codex-unix-transport.mjs";
import { directoryIdentity } from "./private-fs.mjs";
import { desktopEnvironment } from "./process-environment.mjs";
import { runtimeGuardianStopped } from "./runtime-command.mjs";
import { stopOwnedChild } from "./owned-process.mjs";

const sha = bytes => createHash("sha256").update(bytes).digest("hex");
const require = value => { if (!value) throw Error("The original owned Codex listener identity did not verify."); };
async function identity(path) { const s = await lstat(path); return { device: String(s.dev), inode: String(s.ino), uid: s.uid, mode: s.mode }; }
const same = (a, b) => a && b && ["device", "inode", "uid", "mode"].every(key => a[key] === b[key]);
async function processInfo(pid) { try { const s = await lstat(`/proc/${pid}`), text = await readFile(`/proc/${pid}/stat`, "utf8"), f = text.slice(text.lastIndexOf(")") + 2).split(" "); return { pid, uid: s.uid, birth: f[19], group: +f[2], session: +f[3] }; } catch (error) { if (["ENOENT", "ESRCH"].includes(error.code)) return null; throw error; } }
async function waitFor(check, timeoutMs, stopped) { const end = Date.now() + timeoutMs; while (Date.now() < end) { if (stopped?.()) throw Error("The owned listener startup was stopped."); const value = await check(); if (value) return value; await new Promise(resolve => setTimeout(resolve, 20)); } throw Error("The owned listener did not reach its bounded startup or exit checkpoint."); }

/** Recovery consumes previously recorded private identities; it never kills or adopts a process. */
export async function retireStoppedCodexListener(scope, ownership) {
  require(process.platform === "linux" && ownership && typeof ownership.root === "string");
  const { root, rootIdentity, endpoint, socketPath, socketIdentity, socketParent, aliasIdentity } = ownership, uid = userInfo().uid;
  require(endpoint === join(root, "s") && socketPath === join("/tmp", `codex-daemon-${uid}`, sha(endpoint)) && /^syl-[A-Za-z0-9]{6}$/.test(root.split("/").at(-1)));
  if (scope) require(await runtimeGuardianStopped(scope));
  else require(!socketIdentity && !aliasIdentity);
  require(same(await identity(root), rootIdentity) && rootIdentity.uid === uid && !(rootIdentity.mode & 0o077));
  await directoryIdentity(root);
  if (socketIdentity) {
    require(scope && same(await identity(dirname(socketPath)), socketParent));
    require(!(await readFile("/proc/net/unix", "utf8")).split("\n").some(line => line.trim().split(/\s+/).at(-1) === socketPath));
    try { require(same(await identity(socketPath), socketIdentity) && (await lstat(socketPath)).isSocket()); await rm(socketPath); } catch (error) { if (error.code !== "ENOENT") throw error; }
  }
  if (aliasIdentity) { try { require(same(await identity(endpoint), aliasIdentity) && (await lstat(endpoint)).isSymbolicLink() && await readlink(endpoint) === socketPath); await rm(endpoint); } catch (error) { if (error.code !== "ENOENT") throw error; } }
  require((await readdir(root)).length === 0); await rmdir(root);
  return { stopped: true, evidence: "exact owned guardian, bridges, socket, alias and private directory retired" };
}

export async function openOwnedCodexListener({ executable, cwd, serverNames = [], runtimeRoot = process.env.XDG_RUNTIME_DIR, authorize = async () => {}, onOwner = () => {}, onReady = async () => {} } = {}) {
  if (process.platform !== "linux") throw Error("Owned Codex Unix listeners require Linux; no daemon or network fallback is available.");
  const uid = userInfo().uid; await authorize(); const runtime = await directoryIdentity(runtimeRoot); require(Number(runtime.uid) === uid && !(Number(runtime.mode) & 0o077));
  const startupDirectory = await directoryIdentity(cwd); require(Number(startupDirectory.uid) === uid && !(Number(startupDirectory.mode) & 0o077));
  // Project configuration is inspected later through explicit metadata requests.
  // Starting a provider never adopts a repository or project instructions.
  for (const name of [".git", ".codex", "AGENTS.md"]) try { await lstat(join(cwd, name)); throw Error("Choose a neutral private provider startup directory; no project was adopted."); } catch (error) { if (error.code !== "ENOENT") throw error; }
  const root = await mkdtemp(join(runtimeRoot, "syl-")), rootIdentity = await identity(root), endpoint = join(root, "s"), socketPath = join("/tmp", `codex-daemon-${uid}`, sha(endpoint));
  let child, closed = false, stopPending, guardian, native, socketIdentity, socketParent, aliasIdentity, binding, accountFingerprint, workerClosed = false, failure, acknowledged = false;
  const clients = new Set(), requestId = randomUUID();
  const current = () => { if (closed || failure || workerClosed) throw failure ?? Error("The owned Codex listener is closed."); };
  const admission = async () => { current(); await authorize(); current(); };
  const owner = {
    get scope() { return guardian ? { ...guardian } : null; },
    get binding() { return !closed && !workerClosed && !failure && binding && accountFingerprint && [...clients].some(client => !client.closed && client.restrictionsVerified && client.accountFingerprint === accountFingerprint) ? { ...binding } : null; },
    get accountFingerprint() { return accountFingerprint ?? null; },
    get privateOwnership() { return { root, rootIdentity: { ...rootIdentity }, endpoint, socketPath, socketIdentity: socketIdentity && { ...socketIdentity }, socketParent: socketParent && { ...socketParent }, aliasIdentity: aliasIdentity && { ...aliasIdentity } }; },
    get closed() { return closed || workerClosed; },
    async connect() {
      await admission();
      for (const client of clients) if (client.closed) { require((await stopOwnedChild(client.child)).stopped); clients.delete(client); }
      require(binding && clients.size < 4);
      const client = createPinnedCodexUnixClient(executable, cwd, serverNames, binding); clients.add(client);
      client.on("disconnected", reason => {
        if (reason?.code === "ACCOUNT_UNCONFIRMED") { failure ??= reason; owner.close(); }
        else if (accountFingerprint && [...clients].every(client => client.closed)) owner.close();
      });
      try {
        await admission(); await client.initialize(); await admission(); require(!client.closed && client.restrictionsVerified);
        if (accountFingerprint && accountFingerprint !== client.accountFingerprint) { const error = Object.assign(Error("The owned listener account changed. No task or connection was rerouted."), { code: "ACCOUNT_UNCONFIRMED" }); failure ??= error; owner.close(); throw error; }
        accountFingerprint ??= client.accountFingerprint; return client;
      }
      catch (error) { owner.close(); client.close(); const result = await stopOwnedChild(client.child); if (result.stopped) clients.delete(client); throw error; }
    },
    close() { closed = true; for (const client of clients) client.close(); child?.stdin.end(); },
    async stop() {
      if (stopPending) return stopPending;
      owner.close();
      stopPending = (async () => {
        let confirmed = true;
        for (const client of clients) { try { if (!(await stopOwnedChild(client.child)).stopped) confirmed = false; } catch { confirmed = false; } }
        if (confirmed) clients.clear();
        if (child) {
          try { await waitFor(() => workerClosed, 4000); }
          catch { if (guardian) { const p = await processInfo(guardian.guardianPid); if (p && p.birth === guardian.birth && p.group === p.pid && p.session === p.pid) try { process.kill(-p.pid, "SIGKILL"); } catch (error) { if (error.code !== "ESRCH") confirmed = false; } } await stopOwnedChild(child); }
          if (!workerClosed || guardian && !await runtimeGuardianStopped(guardian) || !guardian && acknowledged) confirmed = false;
        }
        if (!confirmed) return { stopped: false, evidence: "original owned listener exit unconfirmed; private ownership preserved" };
        try { return await retireStoppedCodexListener(guardian, owner.privateOwnership); }
        catch { return { stopped: false, evidence: "owned exit observed but exact private retirement is unconfirmed" }; }
      })();
      const result = await stopPending; if (!result.stopped) stopPending = undefined; return result;
    }
  };
  try {
    await onOwner(owner); await admission(); executable = await realpath(executable); const digest = createHash("sha256"); for await (const bytes of createReadStream(executable)) digest.update(bytes); const executableSha256 = digest.digest("hex");
    codexRestrictedProcessArguments(executable, serverNames, { mode: "unix-listener", socketPath: endpoint });
    try { await lstat(socketPath); throw Error("The reserved native socket already exists; preserve its original owner."); } catch (error) { if (error.code !== "ENOENT") throw error; }
    await admission();
    child = spawn(process.execPath, [fileURLToPath(new URL("./codex-listener-worker.mjs", import.meta.url))], { cwd, env: desktopEnvironment(), shell: false, detached: true, stdio: ["pipe", "pipe", "ignore"] });
    child.stdin.on("error", () => {}); child.once("error", () => { workerClosed = true; failure ??= Error("The owned provider guardian is unavailable."); }); child.once("close", () => { workerClosed = true; });
    let buffer = "", received = 0;
    child.stdout.setEncoding("utf8"); child.stdout.on("data", chunk => {
      received += Buffer.byteLength(chunk); if (received > 8192) { failure ??= Error("The owned listener protocol exceeded its bound."); owner.close(); return; }
      buffer += chunk; let end;
      while ((end = buffer.indexOf("\n")) >= 0) {
        const line = buffer.slice(0, end); buffer = buffer.slice(end + 1);
        try {
          const frame = JSON.parse(line); require(frame.schema === "switchyard-runtime-command/v1" && frame.role === "codex-listener" && frame.id === requestId);
          if (frame.event === "ready" && !guardian) {
            require(frame.guardianPid === child.pid && /^[0-9]+$/.test(frame.birth) && frame.containment === "owned-linux-session"); guardian = { schema: frame.schema, id: frame.id, guardianPid: frame.guardianPid, birth: frame.birth, containment: frame.containment };
            void (async () => { await admission(); const p = await processInfo(child.pid); require(p && p.uid === uid && p.birth === guardian.birth && p.group === p.pid && p.session === p.pid); await onReady({ ...guardian }, owner); await admission(); acknowledged = true; child.stdin.write(JSON.stringify({ schema: frame.schema, id: requestId, start: true }) + "\n"); })().catch(error => { failure ??= error; owner.close(); });
          } else if (frame.event === "native-started" && acknowledged && !native) { require(Number.isSafeInteger(frame.pid) && frame.pid > 0 && /^[0-9]+$/.test(frame.birth)); native = { pid: frame.pid, birth: frame.birth }; }
          else if (frame.event !== "exit") throw Error("Unexpected listener lifetime frame");
        } catch { failure ??= Error("The original listener lifetime frame did not verify."); owner.close(); }
      }
    });
    child.stdin.write(JSON.stringify({ schema: "switchyard-runtime-command/v1", id: requestId, executable, executableSha256, cwd, endpoint, serverNames }) + "\n");
    await waitFor(() => { current(); if (workerClosed) throw Error("The owned listener exited during startup."); return native; }, 15000, () => closed);
    await waitFor(async () => {
      current(); if (workerClosed) throw Error("The owned listener exited before its private socket and alias.");
      try {
        require((await lstat(socketPath)).isSocket());
        require((await lstat(endpoint)).isSymbolicLink() && await readlink(endpoint) === socketPath);
        return true;
      } catch (error) { if (error.code === "ENOENT") return false; throw error; }
    }, 15000, () => closed);
    socketIdentity = await identity(socketPath); socketParent = await identity(dirname(socketPath)); require(socketIdentity.uid === uid && !(socketIdentity.mode & 0o077) && socketParent.uid === uid && !(socketParent.mode & 0o077));
    require((await lstat(endpoint)).isSymbolicLink() && await readlink(endpoint) === socketPath); aliasIdentity = await identity(endpoint); require(aliasIdentity.uid === uid);
    const p = await processInfo(native.pid); require(p && p.uid === uid && p.birth === native.birth && p.group === guardian.guardianPid && p.session === guardian.guardianPid && await realpath(`/proc/${p.pid}/exe`) === executable);
    binding = { socketPath, socketDevice: socketIdentity.device, socketInode: socketIdentity.inode, peerPid: p.pid, peerBirth: p.birth, peerExecutableSha256: executableSha256 };
    await admission(); return owner;
  } catch (error) { await owner.stop(); throw Object.assign(error, { ownedListener: owner }); }
}
