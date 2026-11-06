/** Owned OS credential helpers: no partial result or replacement after uncertain exit. */
import { spawn } from "node:child_process";
import { stopOwnedChild } from "./owned-process.mjs";

export function createCredentialProcessRunner({ spawnProcess = spawn, stopChild = stopOwnedChild } = {}) {
  const uncertain = new Set(), retired = new WeakSet(), retirements = new WeakMap();
  const unconfirmed = () => Object.assign(Error("The platform credential worker exit is unconfirmed. No replacement was started."), { code: "CREDENTIAL_PROCESS_EXIT_UNCONFIRMED" });
  async function retire(child) {
    if (!child) return true;
    if (retired.has(child)) return true;
    if (retirements.has(child)) return retirements.get(child);
    uncertain.add(child);
    const pending = (async () => {
      let stopped = false;
      try { stopped = (await stopChild(child))?.stopped === true; } catch { /* Keep exact ownership; never expose native error text. */ }
      stopped ||= retired.has(child);
      if (stopped) uncertain.delete(child); else uncertain.add(child);
      return stopped;
    })();
    retirements.set(child, pending);
    try { return await pending; } finally { retirements.delete(child); }
  }
  return async function boundedCredentialProcess(executable, args, input, timeout = 10000) {
    if (!Number.isSafeInteger(timeout) || timeout < 1 || timeout > 10000) throw Error("The credential operation requires its original bounded deadline.");
    await Promise.all([...uncertain].map(retire));
    if (uncertain.size) throw unconfirmed();
    let child, timer;
    try {
      return await new Promise((resolve, reject) => {
        try { child = spawnProcess(executable, args, { shell: false, windowsHide: true, stdio: ["pipe", "pipe", "pipe"] }); }
        catch { throw Error("The platform credential store is unavailable."); }
        const chunks = []; let outputBytes = 0, stderrBytes = 0, settled = false;
        const finish = (error, value) => { if (settled) return; settled = true; clearTimeout(timer); if (error && !retired.has(child)) uncertain.add(child); error ? reject(error) : resolve(value); };
        timer = setTimeout(() => finish(Error("The platform credential store timed out.")), timeout);
        child.on("error", () => finish(Error("The platform credential store is unavailable.")));
        child.stdout.on("data", chunk => {
          if (settled) return;
          outputBytes += chunk.length;
          if (outputBytes > 32768) { finish(Error("Credential response exceeded its bound.")); return; }
          chunks.push(Buffer.from(chunk));
        });
        child.stderr.on("data", chunk => { if (!settled) stderrBytes += chunk.length; });
        child.stdin.on("error", () => finish(Error("The platform credential request could not be delivered.")));
        child.once("close", (code, signal) => {
          retired.add(child);
          uncertain.delete(child);
          if (signal || !Number.isInteger(code) || code < 0) { finish(Error("The platform credential worker exited without a verified status.")); return; }
          finish(null, { code, text: Buffer.concat(chunks).toString("utf8").trim(), stderrBytes });
        });
        try { child.stdin.end(input); } catch { finish(Error("The platform credential request could not be delivered.")); }
      });
    } catch (error) {
      clearTimeout(timer);
      if (!await retire(child)) throw unconfirmed();
      throw error;
    } finally { clearTimeout(timer); }
  };
}

export const boundedCredentialProcess = createCredentialProcessRunner();
