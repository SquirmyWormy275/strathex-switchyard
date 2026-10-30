/** Windows implementation. Runtime acceptance requires an interactive Windows host. */
import { spawn } from "node:child_process";
import { randomUUID, createHash } from "node:crypto";
import { fileURLToPath } from "node:url";
import { compileConnection } from "./workspace.mjs";
import { closedIntent } from "./physical-intent.mjs";
import { desktopEnvironment } from "./process-environment.mjs";
const digest = (v) => createHash("sha256").update(JSON.stringify(v)).digest("hex");

export class WindowsNativeHotkeys {
  constructor({ origin, token, executable = fileURLToPath(new URL("../../runtime/hotkeys/Switchyard.Hotkeys.exe", import.meta.url)), spawnProcess = spawn, readOnly = false }) {
    this.sequence = 0; this.pending = new Map(); this.buffer = ""; this.closed = false;
    this.child = spawnProcess(executable, [], { shell: false, windowsHide: true, stdio: ["pipe", "pipe", "ignore"], env: desktopEnvironment() });
    this.child.stdout.setEncoding("utf8");
    this.child.stdout.on("data", (chunk) => { this.buffer += chunk; if (this.buffer.length > 65536) { this.close(); return; } let end; while ((end = this.buffer.indexOf("\n")) >= 0) { let m; try { m = JSON.parse(this.buffer.slice(0, end)); } catch { this.close(); return; } this.buffer = this.buffer.slice(end + 1); const p = this.pending.get(m.id); if (p) { this.pending.delete(m.id); clearTimeout(p.timer); m.error ? p.reject(new Error(m.error)) : p.resolve(m.result); } } });
    this.child.on("error", () => this.close()); this.child.on("close", () => this.close()); this.child.stdin.on("error", () => this.close());
    this.readOnly = readOnly;
    this.ready = this.request("initialize", { origin, token, parentPid: process.pid, readOnly }).then((r) => { if (readOnly && (r.readOnly !== true || r.protocolVersion !== 2)) { this.close(); throw new Error("The native helper did not verify its read-only observation contract."); } return r; });
    void this.ready.catch(() => {});
  }
  request(method, body = {}) { if (this.closed) return Promise.reject(new Error("The Windows hotkey helper is unavailable.")); return new Promise((resolve, reject) => { const id = ++this.sequence, timer = setTimeout(() => { this.pending.delete(id); reject(new Error("Windows hotkey helper timed out.")); }, 10000); this.pending.set(id, { resolve, reject, timer }); this.child.stdin.write(`${JSON.stringify({ id, method, ...body })}\n`); }); }
  async register(connection) { if (this.readOnly) throw new Error("This helper session permits category observation only."); await this.ready; return this.request("register", { bindingId: connection.nativeId, modifiers: connection.windowsModifiers, virtualKey: connection.virtualKey, body: { implementation: connection.implementation, ...(connection.roleId ? { roleId: connection.roleId, intent: connection.intent } : {}) } }); }
  async unregister(nativeId) { if (this.readOnly) throw new Error("This helper session permits category observation only."); await this.ready; return this.request("unregister", { bindingId: nativeId }); }
  async status() { await this.ready; return this.request("status"); }
  close() { if (this.closed) return; this.closed = true; this.child.kill(); for (const p of this.pending.values()) { clearTimeout(p.timer); p.reject(new Error("Windows hotkeys disconnected. Saved configuration remains available for recovery.")); } this.pending.clear(); }
}

export function windowsChord(connection) {
  const key = connection.key;
  const virtualKey = /^F\d+$/.test(key) ? 111 + Number(key.slice(1)) : key.charCodeAt(0);
  const windowsModifiers = (connection.modmask & 64 ? 8 : 0) | (connection.modmask & 8 ? 1 : 0) | (connection.modmask & 4 ? 2 : 0) | (connection.modmask & 1 ? 4 : 0);
  return { ...connection, virtualKey, windowsModifiers };
}

export function createWindowsHostBridge({ store, driverFactory, verifyTarget = async () => {}, dispatch, now = () => Date.now() }) {
  const reviews = new Map(); let driver, nextNativeId = 1, hydrated = false;
  const own = (s) => s.windowsHost ??= { bindings: [], transactions: [] };
  async function ensure() {
    if (!driver || driver.closed) { driver = driverFactory(); hydrated = false; }
    if (hydrated) return;
    await driver.ready;
    const s = await store.snapshot("personal"), config = own(s);
    nextNativeId = Math.max(nextNativeId, ...config.transactions.map((t) => t.connection.nativeId + 1), 1);
    try { for (const binding of config.bindings) { await driver.register(binding); nextNativeId = Math.max(nextNativeId, binding.nativeId + 1); } hydrated = true; }
    catch (error) { driver.close(); driver = null; throw new Error(`Saved Windows registrations could not be fully restored; the owned helper was stopped. ${error.message}`); }
  }
  const same = (b, c) => b.modifiers === c.windowsModifiers && b.virtualKey === c.virtualKey && JSON.stringify(closedIntent(b.body)) === JSON.stringify(closedIntent(c));
  async function readback(connection, present) { const r = await driver.status(); const matches = r.bindings.filter((b) => b.bindingId === connection.nativeId); if (present ? matches.length !== 1 || !same(matches[0], connection) : matches.length !== 0) throw new Error("Windows native shortcut readback does not match the transaction."); }
  const receipt = (tx) => ({ id: tx.id, status: tx.status, actionId: tx.connection.actionId, shortcut: tx.connection.shortcut, label: tx.connection.label, trial: tx.trial ?? "not-tried", detail: tx.detail ?? null });
  return {
    async review(plan, actionId, implementation, target) {
      const connection = windowsChord(compileConnection(plan, actionId, implementation, target));
      await verifyTarget(connection); await ensure();
      const state = await store.snapshot("personal"), config = own(state);
      if (config.bindings.some((b) => b.windowsModifiers === connection.windowsModifiers && b.virtualKey === connection.virtualKey)) throw new Error("This chord is already configured. Restore it or choose another chord.");
      const id = randomUUID(); reviews.set(id, { connection, expires: now() + 120000, baselineHash: digest(config.bindings) });
      return { reviewId: id, shortcut: connection.shortcut, label: connection.label, changes: [`Register ${connection.shortcut} → ${connection.label} for this Windows user.`, "Save the previous local bindings with an independent protected compartment key.", "Windows checks reserved or occupied shortcuts at application time; existing registrations are preserved.", "No firmware flash or foreground typing. Restore unregisters only the owned hotkey."] };
    },
    async apply(reviewId) {
      const review = reviews.get(reviewId); reviews.delete(reviewId);
      if (!review || now() > review.expires) throw new Error("This Windows shortcut review expired or was already used.");
      await ensure(); await verifyTarget(review.connection);
      const s = await store.snapshot("personal"), current = own(s);
      if (digest(current.bindings) !== review.baselineHash) throw new Error("Local Windows shortcuts changed after review. Review again.");
      const connection = { ...review.connection, nativeId: nextNativeId++ }, tx = { id: randomUUID(), connection, status: "applying", createdAt: now(), baseline: structuredClone(current.bindings) };
      await store.update("personal", "windows-shortcut-baseline", (s) => { own(s).transactions.push(tx); });
      let registered = false;
      try {
        const r = await driver.register(connection); registered = r.registered === true;
        if (!registered) throw new Error("Windows did not register this hotkey."); await readback(connection, true);
        tx.status = "applied";
        await store.update("personal", "windows-shortcut-apply", (s) => { const c = own(s); c.bindings.push(connection); c.transactions.find((t) => t.id === tx.id).status = tx.status; });
        return receipt(tx);
      } catch (error) {
        try { if (registered) { await driver.unregister(connection.nativeId); await readback(connection, false); } tx.status = "rolled-back"; tx.detail = "Application failed; the owned registration was removed and previous configuration preserved."; }
        catch { tx.status = "recovery-pending"; tx.detail = "Native restoration could not be verified. Restart the owned helper and restore from the saved baseline."; }
        await store.update("personal", "windows-shortcut-failure", (s) => { const c = own(s); Object.assign(c.transactions.find((t) => t.id === tx.id), tx); if (tx.status === "recovery-pending" && !c.bindings.some((b) => b.nativeId === connection.nativeId)) c.bindings.push(connection); });
        throw new Error(`${error.message} ${tx.detail}`);
      }
    },
    async transactions() { await ensure(); return own(await store.snapshot("personal")).transactions.slice(-64).reverse().map(receipt); },
    async trial(id) { await ensure(); const tx = own(await store.snapshot("personal")).transactions.find((t) => t.id === id); if (!tx || !["applied", "kept"].includes(tx.status)) throw new Error("Apply this exact Windows connection before trying it."); await readback(tx.connection, true); await dispatch(tx.connection); await store.update("personal", "windows-shortcut-trial", (s) => { own(s).transactions.find((t) => t.id === id).trial = "verified"; }); return receipt({ ...tx, trial: "verified" }); },
    async keep(id) { await ensure(); const tx = own(await store.snapshot("personal")).transactions.find((t) => t.id === id); if (tx?.status !== "applied" || tx.trial !== "verified") throw new Error("Try and verify the exact action before keeping it."); await readback(tx.connection, true); await store.update("personal", "windows-shortcut-keep", (s) => { own(s).transactions.find((t) => t.id === id).status = "kept"; }); return receipt({ ...tx, status: "kept" }); },
    async restore(id) {
      await ensure(); const tx = own(await store.snapshot("personal")).transactions.find((t) => t.id === id);
      if (!tx || !["applied", "kept", "applying", "recovery-pending"].includes(tx.status)) throw new Error("This Windows transaction is not active.");
      const existing = (await driver.status()).bindings.find((b) => b.bindingId === tx.connection.nativeId);
      if (existing) { if (!same(existing, tx.connection)) throw new Error("That native ID belongs to a different registration. Unrelated shortcuts were preserved."); await driver.unregister(tx.connection.nativeId); }
      await readback(tx.connection, false);
      await store.update("personal", "windows-shortcut-restore", (s) => { const c = own(s); c.bindings = c.bindings.filter((b) => b.nativeId !== tx.connection.nativeId); c.transactions.find((t) => t.id === id).status = "restored"; });
      return receipt({ ...tx, status: "restored", detail: "Owned registration removed; later unrelated registrations preserved." });
    },
    close() { driver?.close(); }
  };
}
