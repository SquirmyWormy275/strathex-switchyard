/** Explicit one-shot lock metadata. Never inject input, set LEDs or infer a device. */
import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { desktopEnvironment } from "./process-environment.mjs";
import { runOwnedNativeCommand } from "./owned-native-command.mjs";

const locks = { numlock: "numLock", capslock: "capsLock", scrolllock: "scrollLock" };
const nativeProvenance = "Windows GetKeyboardState calling-thread snapshot";
export function createKeyboardIndicators({ platform = process.platform, list = readdir, read = readFile, command, guardianStopped, stopChild, executable = fileURLToPath(new URL("../../runtime/hotkeys/Switchyard.Hotkeys.exe", import.meta.url)), now = () => Date.now() } = {}) {
  const resource = { clients: new Set() }; let active, controller, closed = false;
  async function settle() {
    let stopped = true;
    for (const client of resource.clients) { if (!await client.stop()) stopped = false; else resource.clients.delete(client); }
    return stopped;
  }
  async function inspect() {
    if (!await settle()) throw new Error("An owned indicator probe has not verified exit; no replacement was started.");
    if (closed) throw new Error("Keyboard indicator observation is stopped.");
    const base = { schema: "switchyard-keyboard-indicators/v1", platform, physicalDeviceLinked: false, physicalLightVerified: false, liveDesktopStateVerified: false, keyboardWritten: false };
    if (platform === "linux") {
      let names;
      try { names = (await list("/sys/class/leds")).filter(name => /^input[0-9]+::(?:numlock|capslock|scrolllock)$/.test(name)).sort(); }
      catch { return { ...base, available: false, observedAt: now(), observations: [], provenance: "Linux LED class brightness", reason: "Kernel lock indicator nodes are unavailable." }; }
      if (names.length > 192) throw new Error("Kernel lock indicator enumeration exceeded its supported bound.");
      const grouped = new Map();
      await Promise.all(names.map(async name => {
        const [instance, kind] = name.split("::"), key = locks[kind];
        let row = grouped.get(instance); if (!row) { row = { instance, numLock: null, capsLock: null, scrollLock: null }; grouped.set(instance, row); }
        try {
          const options = { encoding: "utf8", signal: controller.signal }, [raw, max] = await Promise.all([read(join("/sys/class/leds", name, "brightness"), options), read(join("/sys/class/leds", name, "max_brightness"), options)]);
          if (typeof raw !== "string" || typeof max !== "string" || raw.length > 16 || max.length > 16 || !/^\d+\n?$/.test(raw) || !/^[1-9]\d*\n?$/.test(max) || !Number.isSafeInteger(Number(raw)) || !Number.isSafeInteger(Number(max)) || Number(max) > 65535 || Number(raw) > Number(max)) throw new Error();
          row[key] = Number(raw) !== 0;
        } catch { /* Missing, stale or malformed nodes remain unknown, never false. */ }
      }));
      if (closed || controller.signal.aborted) throw new Error("Keyboard indicator observation was stopped.");
      const observations = [...grouped.values()].sort((a, b) => a.instance.localeCompare(b.instance));
      return { ...base, available: observations.some(row => [row.numLock, row.capsLock, row.scrollLock].some(value => typeof value === "boolean")), observedAt: now(), observations, provenance: "Linux LED class brightness", scope: "Kernel output indicators by input instance; no firmware or physical-light attestation" };
    }
    if (platform === "win32") {
      const result = await runOwnedNativeCommand({ executable, args: ["--keyboard-indicators"], cwd: process.cwd(), env: desktopEnvironment(), resource, signal: controller.signal, command, guardianStopped, stopChild, timeout: 5000, maxOutputBytes: 8192, captureStderrBytes: 0 });
      if (result.status !== "completed" || result.exitCode !== 0) throw new Error("The native Windows indicator contract is unavailable; no state was guessed.");
      let value; try { value = JSON.parse(result.stdout); } catch { throw new Error("The native indicator response did not verify."); }
      const fields = ["schema", "available", "numLock", "capsLock", "scrollLock", "provenance", "physicalDeviceLinked", "physicalLightVerified", "liveDesktopStateVerified", "keyboardWritten"];
      if (!value || typeof value !== "object" || Array.isArray(value) || Object.keys(value).length !== fields.length || Object.keys(value).some(key => !fields.includes(key)) || value.schema !== "switchyard-windows-keyboard-indicators/v1" || typeof value.available !== "boolean" || value.provenance !== nativeProvenance || ["physicalDeviceLinked", "physicalLightVerified", "liveDesktopStateVerified", "keyboardWritten"].some(key => value[key] !== false) || ["numLock", "capsLock", "scrollLock"].some(key => value.available ? typeof value[key] !== "boolean" : value[key] !== null)) throw new Error("The native indicator scope was rejected; no state was guessed.");
      return { ...base, available: value.available, observedAt: now(), observations: [{ instance: "calling-thread", numLock: value.numLock, capsLock: value.capsLock, scrollLock: value.scrollLock }], provenance: nativeProvenance, scope: "Calling-thread snapshot; live desktop toggles require separate interactive acceptance" };
    }
    return { ...base, available: false, observedAt: now(), observations: [], reason: "Keyboard indicator observation is not implemented on this platform." };
  }
  return {
    read() {
      if (closed) return Promise.reject(new Error("Keyboard indicator observation is stopped."));
      if (active) return active;
      controller = new AbortController();
      active = inspect().finally(() => { active = null; }); return active;
    },
    async close() { closed = true; controller?.abort(); for (const client of resource.clients) client.close(); await active?.catch(() => {}); return { stopped: await settle(), keyboardWritten: false }; }
  };
}
