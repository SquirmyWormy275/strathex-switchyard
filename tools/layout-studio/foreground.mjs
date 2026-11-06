/** Consent-gated broad categories, with no window metadata crossing the native pipe. */
import { stopOwnedChild } from "./owned-process.mjs";
export const foregroundCategories = ["terminal", "vscode", "chatgpt", "claude", "codex", "browser", "other"];
export function createWindowsCategoryObserver({ driverFactory, stopChild = stopOwnedChild } = {}) {
  if (typeof driverFactory !== "function") throw new Error("A native read-only category driver is required.");
  const drivers = new Map(), generations = new Map(); let closed = false;
  const generation = (c) => generations.get(c) ?? 0;
  const unconfirmed = () => Object.assign(Error("The owned foreground helper exit is unconfirmed. No replacement was started."), { code: "FOREGROUND_HELPER_EXIT_UNCONFIRMED" });
  async function retire(compartment, entry) {
    if (entry.stopPromise) return entry.stopPromise;
    entry.stopping = true;
    const pending = (async () => {
      if (!entry.closeRequested) {
        entry.closeRequested = true;
        try { entry.driver.close(); } catch { /* Independent exact-child retirement still runs. */ }
      }
      let stopped = entry.retired;
      if (!stopped) {
        try { stopped = (await stopChild(entry.driver.child))?.stopped === true; } catch { /* Retain ownership without returning native diagnostics. */ }
      }
      stopped ||= entry.retired;
      if (stopped) {
        entry.retired = true;
        if (drivers.get(compartment) === entry) drivers.delete(compartment);
      }
      return { stopped, ownedProcesses: 1, evidence: stopped ? "owned foreground helper exited" : "owned foreground helper exit unconfirmed" };
    })();
    entry.stopPromise = pending;
    try { return await pending; } finally { entry.stopPromise = null; }
  }
  return {
    implemented: true,
    async read(compartment, beforeStart = async () => {}) {
      const fence = generation(compartment), current = () => { if (closed || generation(compartment) !== fence) throw new Error("Foreground observation was stopped."); };
      current(); await beforeStart(); current();
      let entry = drivers.get(compartment);
      while (entry && (entry.stopping || entry.retired || entry.driver.closed)) {
        if (!(await retire(compartment, entry)).stopped) throw unconfirmed();
        current(); entry = drivers.get(compartment);
      }
      if (!entry) {
        const driver = driverFactory({ readOnly: true });
        entry = { driver, stopping: false, retired: false, closeRequested: false, stopPromise: null };
        const owned = entry;
        driver.child?.once("close", () => { owned.retired = true; });
        drivers.set(compartment, entry);
      }
      const active = () => { current(); if (drivers.get(compartment) !== entry || entry.stopping || entry.retired || entry.driver.closed) throw Error("Foreground observation was stopped."); };
      try {
        await entry.driver.ready; active(); await beforeStart(); active();
        const result = await entry.driver.request("foreground-category"); active();
        if (!result || typeof result.available !== "boolean" || typeof result.provenance !== "string" || result.provenance !== "Windows foreground process filename; no task identity" || result.available && !foregroundCategories.includes(result.category) || !result.available && result.category !== null || Object.keys(result).some((k) => !["available", "category", "provenance", "reason"].includes(k))) throw new Error("The native category observation contract was rejected; no window metadata was saved.");
        return { available: result.available, category: result.category, provenance: result.provenance, ...(!result.available ? { reason: "Native foreground category is unavailable in this session." } : {}) };
      } catch (error) {
        if (!(await retire(compartment, entry)).stopped) throw unconfirmed();
        throw error;
      }
    },
    async stopCompartment(c) {
      generations.set(c, generation(c) + 1); const entry = drivers.get(c);
      return entry ? retire(c, entry) : { stopped: true, ownedProcesses: 0 };
    },
    async close() {
      closed = true;
      const results = await Promise.all([...drivers.keys()].map((c) => this.stopCompartment(c)));
      if (results.some(result => result.stopped !== true)) throw unconfirmed();
      return results;
    }
  };
}
