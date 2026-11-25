/** Internal removal hook. Caller must stop/verify the app and hold its owner/start leases. */
import { createHash } from "node:crypto";
import { createHostBridge } from "../../tools/layout-studio/host.mjs";
import { createSuiteStore } from "../../tools/layout-studio/suite-store.mjs";
import { closedIntent } from "../../tools/layout-studio/physical-intent.mjs";

const active = new Set(["prepared", "applying", "applied", "kept", "recovery-pending"]);
const digest = value => createHash("sha256").update(JSON.stringify(value)).digest("hex");
function windowsConfiguration(value) {
  if (!value) return { bindings: [], transactions: [] };
  if (!Array.isArray(value.bindings) || value.bindings.length > 1024 || !Array.isArray(value.transactions) || value.transactions.length > 4096) throw new Error("Saved Windows host configuration is unsupported; program files were preserved.");
  const ids = new Set();
  for (const tx of value.transactions.filter(tx => active.has(tx.status))) {
    if (!/^[a-f0-9-]{36}$/.test(tx.id) || !Number.isInteger(tx.connection?.nativeId) || tx.connection.nativeId < 1 || tx.connection.nativeId > 1024 || ids.has(tx.id)) throw new Error("A Windows recovery transaction is invalid; its program and protected baseline were preserved.");
    closedIntent(tx.connection); ids.add(tx.id);
  }
  const nativeIds = new Set();
  for (const binding of value.bindings) {
    if (!Number.isInteger(binding.nativeId) || nativeIds.has(binding.nativeId) || !value.transactions.some(tx => active.has(tx.status) && digest(tx.connection) === digest(binding))) throw new Error("A saved Windows binding has no exact owned transaction. Its configuration and program were preserved.");
    nativeIds.add(binding.nativeId);
  }
  return value;
}
/** No helper is created or rehydrated here: verified owner exit released native registrations. */
export function connectionRestoration({ platform = process.platform, linuxBridge, store } = {}) {
  if (platform === "linux") return async continueRemoval => (linuxBridge ?? createHostBridge()).restoreAll(continueRemoval);
  if (platform !== "win32") throw new Error("This platform has no supported host-connection removal contract.");
  return async continueRemoval => {
    store ??= createSuiteStore();
    const compartments = await store.list();
    if (compartments.length > 64) throw new Error("The protected compartment inventory exceeds its removal bound.");
    const candidates = [];
    // Decrypt/validate every compartment before changing the first preference.
    // Missing keys and unknown bindings preserve the application and baselines.
    for (const compartment of compartments) {
      const snapshot = await store.snapshot(compartment.id), config = windowsConfiguration(snapshot.windowsHost);
      if (config.bindings.length || config.transactions.some(tx => active.has(tx.status))) candidates.push({ compartment: compartment.id, identity: digest(config), ids: config.transactions.filter(tx => active.has(tx.status)).map(tx => tx.id) });
    }
    const restored = [];
    for (const candidate of candidates) {
      await store.update(candidate.compartment, "windows-uninstall-restore", state => {
        const config = windowsConfiguration(state.windowsHost);
        if (digest(config) !== candidate.identity) throw new Error("Windows host preferences changed after removal review. Program files and remaining baselines were preserved.");
        config.bindings = [];
        for (const tx of config.transactions) if (candidate.ids.includes(tx.id)) { tx.status = "restored"; tx.detail = "The owned application/helper exited before uninstall; saved re-registration was disabled. Protected original baselines remain available."; restored.push({ id: tx.id, compartment: candidate.compartment, status: "restored" }); }
      });
    }
    for (const candidate of candidates) { const config = windowsConfiguration((await store.snapshot(candidate.compartment)).windowsHost); if (config.bindings.length || config.transactions.some(tx => candidate.ids.includes(tx.id) && tx.status !== "restored")) throw new Error("Windows host preference restoration readback failed; program files were preserved."); }
    return continueRemoval({ restored, readbackVerified: true, evidence: "Persisted owned preferences read back after caller-verified app/helper exit; no new native registration or account session was created." });
  };
}
