/** Consent-gated broad categories, with no window metadata crossing the native pipe. */
import { stopOwnedChild } from "./owned-process.mjs";
export const foregroundCategories = ["terminal", "vscode", "chatgpt", "claude", "codex", "browser", "other"];
export function createWindowsCategoryObserver({ driverFactory } = {}) {
  if (typeof driverFactory !== "function") throw new Error("A native read-only category driver is required.");
  const drivers = new Map(), generations = new Map(); let closed = false;
  const generation = (c) => generations.get(c) ?? 0;
  return {
    implemented: true,
    async read(compartment, beforeStart = async () => {}) {
      const fence = generation(compartment), current = () => { if (closed || generation(compartment) !== fence) throw new Error("Foreground observation was stopped."); };
      current(); await beforeStart(); current();
      let driver = drivers.get(compartment);
      if (!driver || driver.closed) { driver = driverFactory({ readOnly: true }); drivers.set(compartment, driver); }
      await driver.ready; current(); await beforeStart(); current();
      const result = await driver.request("foreground-category"); current();
      if (!result || typeof result.available !== "boolean" || typeof result.provenance !== "string" || result.provenance !== "Windows foreground process filename; no task identity" || result.available && !foregroundCategories.includes(result.category) || !result.available && result.category !== null || Object.keys(result).some((k) => !["available", "category", "provenance", "reason"].includes(k))) throw new Error("The native category observation contract was rejected; no window metadata was saved.");
      return { available: result.available, category: result.category, provenance: result.provenance, ...(!result.available ? { reason: "Native foreground category is unavailable in this session." } : {}) };
    },
    async stopCompartment(c) {
      generations.set(c, generation(c) + 1); const driver = drivers.get(c); drivers.delete(c);
      if (!driver) return { stopped: true, ownedProcesses: 0 };
      driver.close(); const result = await stopOwnedChild(driver.child); return { ...result, ownedProcesses: 1 };
    },
    async close() { closed = true; return Promise.all([...drivers.keys()].map((c) => this.stopCompartment(c))); }
  };
}
