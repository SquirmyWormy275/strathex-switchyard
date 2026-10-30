/** One resource-owned supervised native command; no provider/account selection here. */
import { runRuntimeCommand, runtimeGuardianStopped } from "./runtime-command.mjs";
import { stopOwnedChild } from "./owned-process.mjs";

export function guardianScope(frame) {
  if (frame?.schema !== "switchyard-runtime-command/v1" || !/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/.test(frame.id ?? "") || !Number.isSafeInteger(frame.guardianPid) || frame.guardianPid < 1 || !/^[0-9]+$/.test(frame.birth ?? "") || !["owned-linux-session", "windows-job"].includes(frame.containment)) throw new Error("The exact owned native guardian scope did not verify.");
  return { schema: frame.schema, id: frame.id, guardianPid: frame.guardianPid, birth: frame.birth, containment: frame.containment };
}

export async function runOwnedNativeCommand({ executable, args, cwd, env, text, signal, resource, timeout = 120000, maxOutputBytes = 524288, captureStderrBytes = 16384, onReady = async () => {}, onStopped = async () => {}, command = runRuntimeCommand, guardianStopped = runtimeGuardianStopped, stopChild = stopOwnedChild } = {}) {
  const controller = new AbortController(); let scope, settled = false, operation;
  const aborted = () => controller.abort(); signal?.addEventListener("abort", aborted, { once: true }); if (signal?.aborted) aborted();
  const client = {
    child: null, closed: false,
    close() { if (!this.closed) controller.abort(); },
    async stop() {
      if (this.closed) return true;
      controller.abort();
      if (!settled) { let timer; try { await Promise.race([operation.catch(() => {}), new Promise(r => { timer = setTimeout(r, 5000); })]); } finally { clearTimeout(timer); } }
      if (this.child && !(await stopChild(this.child)).stopped) return false;
      if (!settled || scope && !await guardianStopped(scope)) return false;
      if (scope) await onStopped(scope);
      this.closed = true; return true;
    }
  };
  try { resource.clients.add(client); }
  catch (error) { controller.abort(); settled = true; signal?.removeEventListener("abort", aborted); throw error; }
  operation = Promise.resolve().then(() => command(executable, args, { cwd, env, inputText: text, signal: controller.signal, captureStderrBytes, maxOutputBytes, detailed: true, timeout,
    onGuardianChild: child => { client.child = child; },
    onGuardianReady: async frame => { scope = guardianScope(frame); await onReady(scope); }
  })).then(async result => {
    if (result?.treeExitVerified !== true || result.inputDelivered !== true) throw new Error("The owned native command did not verify complete input and process exit.");
    if (!scope) throw new Error("The owned native command returned no verified guardian identity.");
    await onStopped(scope); client.closed = true; return result;
  }).finally(() => { settled = true; signal?.removeEventListener("abort", aborted); });
  return operation;
}
