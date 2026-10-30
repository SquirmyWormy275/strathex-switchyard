/** Closed, reversible host configuration. No arbitrary command/device endpoint. */
import { createHash, randomUUID } from "node:crypto";
import { execFile } from "node:child_process";
import { constants } from "node:fs";
import { lstat, mkdir, open, readFile, readdir, readlink, realpath, rename, rm, writeFile } from "node:fs/promises";
import { homedir, userInfo } from "node:os";
import { dirname, join, isAbsolute } from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import { compileConnection } from "./workspace.mjs";
import { closedIntent, dispatchPhysicalIntent, intentArguments, waitIntentReceipt } from "./physical-intent.mjs";
import { withStateLock } from "./state-lock.mjs";

const exec = promisify(execFile);
const uid = userInfo().uid;
const hash = (s) => createHash("sha256").update(s).digest("hex");
const quote = (s) => `'${s.replaceAll("'", `'"'"'`)}'`;
const txPattern = /^\d{4}-\d{2}-\d{2}T[\d-]+Z-[a-f0-9-]{36}$/;
const activeStates = new Set(["prepared", "applying", "applied", "kept", "recovery-pending"]);

export async function runHypr(...args) {
  const r = await exec("/usr/bin/hyprctl", args, { encoding: "utf8", timeout: 5000, maxBuffer: 512 * 1024 });
  if (r.stderr.trim()) throw new Error("The compositor returned an error. Your plan is preserved.");
  return r.stdout;
}

export async function nativeChatgptWindow(hypr = runHypr) {
  const expected = join(homedir(), ".local/lib/chatgpt-visible-voice/native/ChatGPT");
  const clients = JSON.parse(await hypr("clients", "-j"));
  if (!Array.isArray(clients)) throw new Error("Window discovery is unavailable.");
  const candidates = [];
  for (const w of clients) {
    if (w?.mapped !== true || w.initialClass !== "chatgpt" || w.floating || !Number.isSafeInteger(w.pid) || !/^0x[0-9a-f]+$/i.test(w.address)) continue;
    try { if (await readlink(`/proc/${w.pid}/exe`) === expected) candidates.push({ address: w.address, pid: w.pid }); } catch { /* exited windows are unavailable */ }
  }
  if (candidates.length !== 1) throw new Error("Open one native ChatGPT main window using your safe launcher. Its identity must be verified before this action is available.");
  return candidates[0];
}

export async function focusNativeChatgpt(hypr = runHypr) {
  const before = await nativeChatgptWindow(hypr);
  const answer = await hypr("dispatch", 'hl.dsp.focus({ window = "initialclass:^(chatgpt)$" })');
  if (answer.trim() !== "ok") throw new Error("The compositor did not acknowledge focus.");
  const after = JSON.parse(await hypr("activewindow", "-j"));
  const current = await nativeChatgptWindow(hypr);
  if (after.address !== before.address || after.pid !== before.pid || current.address !== before.address || current.pid !== before.pid) throw new Error("The exact ChatGPT main window was not verified after focus.");
  return { status: "verified", summary: "Native ChatGPT main window focused and read back. Exact task resumption is not established." };
}

async function ownedFile(path, privateFile = false) {
  const meta = await lstat(path, { bigint: true });
  if (!meta.isFile() || meta.isSymbolicLink() || Number(meta.uid) !== uid || (Number(meta.mode) & 0o022) || (privateFile && (Number(meta.mode) & 0o077))) throw new Error("The configuration or recovery file is not an owner-controlled regular file.");
  if (meta.size > 1024n * 1024n) throw new Error("The local file exceeds the supported size.");
  const handle = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW);
  try {
    const opened = await handle.stat({ bigint: true });
    if (opened.ino !== meta.ino || opened.dev !== meta.dev) throw new Error("The local file changed while it was opened.");
    const bytes = Buffer.alloc(1024 * 1024 + 1); let length = 0;
    while (length < bytes.length) { const read = await handle.read(bytes, length, bytes.length - length); if (!read.bytesRead) break; length += read.bytesRead; }
    if (length > 1024 * 1024) throw new Error("The local file exceeds the supported size.");
    const after = await handle.stat({ bigint: true }), named = await lstat(path, { bigint: true });
    if (opened.size !== after.size || opened.mtimeNs !== after.mtimeNs || opened.ctimeNs !== after.ctimeNs || named.ino !== opened.ino || named.dev !== opened.dev || !named.isFile()) throw new Error("The local file changed while it was read.");
    const text = bytes.subarray(0, length).toString("utf8");
    if (!Buffer.from(text).equals(bytes.subarray(0, length))) throw new Error("The local configuration must be valid UTF-8; its bytes were preserved.");
    return { text, mode: Number(meta.mode) & 0o777 };
  } finally { await handle.close(); }
}

async function ownedDirectory(path, privateDirectory = false) {
  const meta = await lstat(path);
  if (!meta.isDirectory() || meta.isSymbolicLink() || await realpath(path) !== path || meta.uid !== uid || (meta.mode & 0o022) || (privateDirectory && (meta.mode & 0o077))) throw new Error("The configuration or recovery directory is not privately owner-controlled.");
}

async function atomicFile(path, text, mode = 0o600) {
  await ownedDirectory(dirname(path));
  const temporary = join(dirname(path), `.switchyard-${randomUUID()}.tmp`);
  try {
    const f = await open(temporary, constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | constants.O_NOFOLLOW, mode);
    try { await f.writeFile(text); await f.sync(); } finally { await f.close(); }
    await rename(temporary, path);
  } finally { await rm(temporary, { force: true }); }
}

export async function discoverHost(hypr = runHypr, sysRoot = "/sys/bus/usb/devices") {
  const checkedAt = new Date().toISOString();
  const result = { platform: process.platform, checkedAt, keyboard: { status: "unavailable", message: "USB discovery is unavailable on this platform." }, chatgpt: { status: "unavailable" }, shortcuts: false, hostLayouts: [] };
  if (process.platform !== "linux") return result;
  try {
    let found = false;
    for (const entry of await readdir(sysRoot)) {
      const p = join(sysRoot, entry);
      try {
        if ((await readFile(join(p, "idVendor"), "utf8")).trim() === "1209" && (await readFile(join(p, "idProduct"), "utf8")).trim() === "4704") found = true;
      } catch { /* interfaces without USB identity are irrelevant */ }
    }
    result.keyboard = found
      ? { status: "candidate", message: "F77 USB candidate detected. Firmware, controller, matrix and configuration interface are not verified; device writes are unavailable." }
      : { status: "disconnected", message: "F77 is disconnected. You can design a layout and try host shortcuts now. Connect the keyboard for a fresh device read." };
  } catch { /* preserve unavailable */ }
  try {
    const devices = JSON.parse(await hypr("devices", "-j"));
    result.hostLayouts = [...new Set(devices.keyboards.map((k) => `${k.layout}${k.variant ? ` (${k.variant})` : ""}`))];
    result.shortcuts = !(await hypr("configerrors")).trim();
    await nativeChatgptWindow(hypr);
    result.chatgpt = { status: "focusable", message: "Verified native ChatGPT main window. Focus only; no session observation or task resumption." };
  } catch { result.chatgpt = { status: "unavailable", message: "Native ChatGPT focus is unavailable until one verified main window is open." }; }
  return result;
}

export function createHostBridge({
  configPath = join(process.env.XDG_CONFIG_HOME || join(homedir(), ".config"), "hypr/bindings.lua"),
  stateRoot = join(process.env.XDG_STATE_HOME || join(homedir(), ".local/state"), "strathex-switchyard/configuration-transactions"),
  hypr = runHypr, verifyTarget = (connection) => connection.implementation === "native-chatgpt.focus/v1" ? nativeChatgptWindow(hypr) : Promise.reject(new Error("Role configuration requires the suite policy verifier.")), focus, now = () => Date.now(), intentEntry, afterRestoreWrite = async () => {}
} = {}) {
  const reviews = new Map();
  const script = fileURLToPath(import.meta.url);
  if ([script, process.execPath].some((s) => /[\0\r\n]/.test(s))) throw new Error("The application path is unsupported.");
  const entry = intentEntry ?? [process.execPath, script];
  if (!Array.isArray(entry) || entry.length !== 2 || entry[0] !== process.execPath || entry.some((s) => typeof s !== "string" || !isAbsolute(s) || /[\0\r\n]/.test(s))) throw new Error("The stable intent entry did not verify.");
  const command = (connection) => [...entry, ...intentArguments(connection)].map(quote).join(" ");
  const live = async () => {
    const list = JSON.parse(await hypr("binds", "-j"));
    if (!Array.isArray(list)) throw new Error("The compositor shortcut list is unavailable.");
    return list;
  };
  const matches = (b, c) => b.modmask === c.modmask && String(b.key).toUpperCase() === c.key;
  const ours = (b, c) => matches(b, c) && b.description === c.label && (b.dispatcher === "exec" && b.arg === command(c) || b.dispatcher === "__lua" && /^\d+$/.test(b.arg));
  const config = async () => { await ownedDirectory(dirname(configPath)); return ownedFile(configPath); };
  async function root() {
    await mkdir(stateRoot, { recursive: true, mode: 0o700 });
    await ownedDirectory(stateRoot, true);
  }
  async function lock(fn) {
    await root();
    return withStateLock(stateRoot, "host", async lease => { const recovered = await recoverRestoration(lease); return fn(lease, recovered); });
  }
  const save = async (tx) => atomicFile(join(stateRoot, tx.id, "receipt.json"), `${JSON.stringify(tx, null, 2)}\n`);
  async function load(id) {
    if (!txPattern.test(id)) throw new Error("Unknown transaction.");
    await root(); await ownedDirectory(join(stateRoot, id), true);
    const tx = JSON.parse((await ownedFile(join(stateRoot, id, "receipt.json"), true)).text);
    if (tx.schema !== "switchyard-host-transaction/v1" || tx.id !== id) throw new Error("Recovery record version or identity is invalid.");
    return tx;
  }
  const publicReceipt = (tx) => ({ id: tx.id, status: tx.status, shortcut: tx.connection.shortcut, label: tx.connection.label, actionId: tx.connection.actionId, trial: tx.trial ?? "not-tried", detail: tx.detail ?? null });
  const callbackName = (c) => { if (!/^__strathex_switchyard_[a-f0-9]{32}$/.test(c.callbackName)) throw new Error("The owned Lua callback identity is invalid. Restore and review the connection again."); return c.callbackName; };
  async function verify(c, present) {
    if ((await hypr("reload")).trim() !== "ok" || (await hypr("configerrors")).trim()) throw new Error("The compositor could not validate the configuration.");
    const bindings = await live();
    const count = bindings.filter((b) => matches(b, c));
    if (present ? count.length !== 1 || !ours(count[0], c) : count.some((b) => ours(b, c))) throw new Error("Live shortcut readback does not match the reviewed change.");
    if (present && c.callbackName && (await hypr("repl", `type(${callbackName(c)})`)).trim() !== "function") throw new Error("The owned Lua shortcut callback was not loaded.");
  }
  async function restoredText(tx, text) {
    const baseline = (await ownedFile(join(stateRoot, tx.id, "bindings.lua.before"), true)).text;
    if (hash(baseline) !== tx.beforeHash || typeof tx.block !== "string" || hash(baseline + tx.block) !== tx.afterHash) throw new Error("The saved baseline failed verification. No restoration was attempted.");
    closedIntent(tx.connection);
    if (tx.connection.callbackName) callbackName(tx.connection);
    let restored;
    if (hash(text) === tx.beforeHash) restored = text;
    else if (hash(text) === tx.afterHash) restored = baseline;
    else {
      const first = text.indexOf(tx.block);
      if (first < 0 || text.indexOf(tx.block, first + 1) >= 0) throw new Error("The owned shortcut was edited or removed. Review the saved baseline before restoring; unrelated changes are preserved.");
      restored = text.slice(0, first) + text.slice(first + tx.block.length);
    }
    return restored;
  }
  const restorationIdentity = tx => hash(JSON.stringify({ id: tx.id, connection: tx.connection, beforeHash: tx.beforeHash, afterHash: tx.afterHash, block: tx.block }));
  async function verifyRemoved(connections) {
    if ((await hypr("reload")).trim() !== "ok" || (await hypr("configerrors")).trim()) throw new Error("The compositor could not validate the restored configuration.");
    const bindings = await live();
    for (const connection of connections) if (bindings.some(binding => matches(binding, connection) && binding.description === connection.label)) throw new Error("An owned or ambiguous matching shortcut remains in live compositor readback; restoration is unconfirmed.");
    for (const connection of connections) if (connection.callbackName) {
      const name = callbackName(connection);
      if ((await hypr("eval", `${name} = nil`)).trim() !== "ok" || (await hypr("repl", `type(${name})`)).trim() !== "nil") throw new Error("The owned shortcut callback removal was not read back.");
    }
  }
  async function recoverRestoration(lease) {
    const marker = join(stateRoot, "restore-pending.json"); let pending;
    try { pending = JSON.parse((await ownedFile(marker, true)).text); } catch (error) { if (error.code === "ENOENT") return null; throw error; }
    if (pending.schema !== "switchyard-host-batch-restoration/v1" || !txPattern.test(pending.id) || !/^[a-f0-9]{64}$/.test(pending.beforeHash) || !/^[a-f0-9]{64}$/.test(pending.afterHash) || !Array.isArray(pending.transactions) || !pending.transactions.length || pending.transactions.length > 4096 || pending.transactions.some(tx => !txPattern.test(tx.id) || !/^[a-f0-9]{64}$/.test(tx.identity)) || new Set(pending.transactions.map(tx => tx.id)).size !== pending.transactions.length) throw new Error("The interrupted host restoration record is invalid. Configuration and program files were preserved.");
    const directory = join(stateRoot, "restorations", pending.id); await ownedDirectory(directory, true);
    const before = (await ownedFile(join(directory, "bindings.lua.before"), true)).text, after = (await ownedFile(join(directory, "bindings.lua.after"), true)).text;
    if (hash(before) !== pending.beforeHash || hash(after) !== pending.afterHash) throw new Error("The batch restoration baseline changed; configuration and program files were preserved.");
    const transactions = [];
    for (const descriptor of pending.transactions) { const tx = await load(descriptor.id); if (restorationIdentity(tx) !== descriptor.identity || !activeStates.has(tx.status) && tx.status !== "restored") throw new Error("A recorded host transaction changed during batch recovery. Its files were preserved."); closedIntent(tx.connection); if (tx.connection.callbackName) callbackName(tx.connection); transactions.push(tx); }
    const current = await config(), currentHash = hash(current.text);
    if (currentHash !== pending.beforeHash && currentHash !== pending.afterHash) throw new Error("Host configuration changed outside both recorded restoration states. Review the dated backup; unrelated changes were preserved.");
    if (currentHash !== pending.afterHash) { lease.assert(); await atomicFile(configPath, after, current.mode); await afterRestoreWrite(); }
    await verifyRemoved(transactions.map(tx => tx.connection));
    if ((await config()).text !== after) throw new Error("The final restored file differs from the exact batch plan.");
    for (const tx of transactions) { lease.assert(); tx.status = "restored"; tx.detail = "Owned shortcut and callback removed with live readback; unrelated current bindings and dated recovery copies preserved."; await save(tx); }
    lease.assert(); await atomicFile(join(directory, "result.json"), JSON.stringify({ schema: "switchyard-host-batch-restoration-result/v1", at: new Date().toISOString(), restored: transactions.map(tx => tx.id), afterHash: pending.afterHash })); await rm(marker);
    return { restored: transactions.map(publicReceipt), backup: directory, readbackVerified: true };
  }
  async function restoreTx(tx) {
    const current = await config(), restored = await restoredText(tx, current.text);
    if ((await config()).text !== current.text) throw new Error("The configuration changed during restoration. Retry after reviewing it.");
    if (restored !== current.text) {
      const directory = join(stateRoot, "restorations", `${new Date().toISOString().replaceAll(/[:.]/g, "-")}-${randomUUID()}`);
      await mkdir(directory, { recursive: true, mode: 0o700 }); await ownedDirectory(directory, true);
      await writeFile(join(directory, "bindings.lua.before"), current.text, { flag: "wx", mode: 0o600 });
      await writeFile(join(directory, "reason.json"), JSON.stringify({ schema: "switchyard-host-restoration/v1", at: new Date().toISOString(), transaction: tx.id, beforeHash: hash(current.text), afterHash: hash(restored), mode: current.mode, reason: "Remove the exact owned Switchyard shortcut while preserving all unrelated current bindings." }), { flag: "wx", mode: 0o600 });
      if ((await ownedFile(join(directory, "bindings.lua.before"), true)).text !== current.text || (await config()).text !== current.text) throw new Error("The restoration backup or current configuration changed; its bytes were preserved.");
      await atomicFile(configPath, restored, current.mode);
    }
    await verifyRemoved([tx.connection]);
    if ((await config()).text !== restored) throw new Error("Restored file readback failed.");
    tx.status = "restored"; tx.detail = "Owned shortcut removed; previous configuration verified. Later unrelated edits are preserved.";
    await save(tx);
    return publicReceipt(tx);
  }
  return {
    /** Keep the host lease through the caller's application-removal commit. */
    async restoreAll(continueRemoval = async result => result) {
      return lock(async (lease, recovered) => {
        const ids = (await readdir(stateRoot)).filter(id => txPattern.test(id)).sort().reverse();
        if (ids.length > 4096) throw new Error("Host transaction history exceeds its bounded restoration inventory. Program files were preserved.");
        const transactions = [];
        for (const id of ids) { const tx = await load(id); if (activeStates.has(tx.status)) transactions.push(tx); }
        if (!transactions.length) return continueRemoval(recovered ?? { restored: [], readbackVerified: true });
        const current = await config(); let after = current.text;
        // Preflight every baseline/block against the simulated final file before
        // the first configuration write or application-file removal.
        for (const tx of transactions) after = await restoredText(tx, after);
        const id = `${new Date().toISOString().replaceAll(/[:.]/g, "-")}-${randomUUID()}`, directory = join(stateRoot, "restorations", id);
        await mkdir(directory, { recursive: true, mode: 0o700 }); await ownedDirectory(directory, true);
        await writeFile(join(directory, "bindings.lua.before"), current.text, { flag: "wx", mode: 0o600 }); await writeFile(join(directory, "bindings.lua.after"), after, { flag: "wx", mode: 0o600 });
        await writeFile(join(directory, "reason.txt"), "Restore every exact active Switchyard host shortcut before application removal. Preserve later unrelated bindings and private transaction baselines.\n", { flag: "wx", mode: 0o600 });
        if ((await config()).text !== current.text) throw new Error("Host bindings changed during batch review. Program files were preserved.");
        lease.assert(); await atomicFile(join(stateRoot, "restore-pending.json"), JSON.stringify({ schema: "switchyard-host-batch-restoration/v1", id, beforeHash: hash(current.text), afterHash: hash(after), transactions: transactions.map(tx => ({ id: tx.id, identity: restorationIdentity(tx) })) }));
        const result = await recoverRestoration(lease); lease.assert(); return continueRemoval({ ...result, restored: [...(recovered?.restored ?? []), ...result.restored], ...(recovered?.backup ? { recoveredBackup: recovered.backup } : {}) });
      });
    },
    async review(plan, actionId, implementation, target = null) {
      if (process.platform !== "linux") throw new Error("Host application is currently implemented only for Omarchy Linux. Portable design remains available.");
      const connection = compileConnection(plan, actionId, implementation, target);
      await verifyTarget(connection);
      if ((await hypr("configerrors")).trim()) throw new Error("Resolve existing compositor errors before applying a shortcut.");
      const before = await config();
      if ((await live()).some((b) => matches(b, connection))) throw new Error(`${connection.shortcut} is already assigned. Choose another chord; the existing binding will be preserved.`);
      const id = randomUUID();
      connection.callbackName = `__strathex_switchyard_${id.replaceAll("-", "")}`;
      const line = `function ${connection.callbackName}()\n  hl.dispatch(hl.dsp.exec_cmd(${JSON.stringify(command(connection))}))\nend\no.bind(${JSON.stringify(connection.shortcut)}, ${JSON.stringify(connection.label)}, ${connection.callbackName})`;
      const review = { id, connection, line, beforeHash: hash(before.text), expires: now() + 120000 };
      if (reviews.size >= 16) reviews.delete(reviews.keys().next().value);
      reviews.set(id, review);
      return { reviewId: id, expiresAt: review.expires, shortcut: connection.shortcut, label: connection.label, changes: [`Add ${connection.shortcut} → ${connection.label} to your desktop shortcuts.`, "Save and verify a dated private baseline before writing.", "Enter the running suite's active-compartment policy. Missing or prohibited targets never fall back.", "Restore removes this shortcut and preserves unrelated later edits."] };
    },
    async apply(reviewId) {
      const review = reviews.get(reviewId);
      reviews.delete(reviewId); // attempted reviews cannot be replayed
      if (!review || now() > review.expires) throw new Error("This review expired or was already used. Review the current change again.");
      return lock(async () => {
        const before = await config();
        if (hash(before.text) !== review.beforeHash) throw new Error("Desktop shortcuts changed after review. Review again; no changes were applied.");
        await verifyTarget(review.connection);
        if ((await hypr("configerrors")).trim() || (await live()).some((b) => matches(b, review.connection))) throw new Error("The shortcut is no longer available. Review again; no changes were applied.");
        const id = `${new Date().toISOString().replaceAll(/[:.]/g, "-")}-${randomUUID()}`;
        await mkdir(join(stateRoot, id), { mode: 0o700 });
        const block = `\n-- Switchyard ${id}: begin\n${review.line}\n-- Switchyard ${id}: end\n`;
        const after = before.text + block;
        const tx = { schema: "switchyard-host-transaction/v1", id, status: "prepared", connection: review.connection, beforeHash: hash(before.text), afterHash: hash(after), block, createdAt: new Date().toISOString() };
        await writeFile(join(stateRoot, id, "bindings.lua.before"), before.text, { flag: "wx", mode: 0o600 });
        await writeFile(join(stateRoot, id, "reason.txt"), `Review and trial ${review.connection.shortcut} for ${review.connection.label} through the authenticated active-compartment policy. Preserve ordinary typing and save the complete prior host bindings.\n`, { flag: "wx", mode: 0o600 });
        if ((await ownedFile(join(stateRoot, id, "bindings.lua.before"), true)).text !== before.text) throw new Error("Baseline verification failed; no configuration was changed.");
        await save(tx);
        try {
          if ((await config()).text !== before.text) throw new Error("The configuration changed before application.");
          tx.status = "applying"; await save(tx);
          await atomicFile(configPath, after, before.mode);
          await verify(tx.connection, true);
          if ((await config()).text !== after) throw new Error("Applied file readback failed.");
          tx.status = "applied"; await save(tx);
          return publicReceipt(tx);
        } catch (error) {
          try { await restoreTx(tx); tx.status = "rolled-back"; tx.detail = "Application failed; the prior host configuration was restored and verified."; }
          catch { tx.status = "recovery-pending"; tx.detail = "Application failed and restoration could not be verified. Review the private baseline and retry Restore."; }
          await save(tx);
          throw new Error(`${error.message} ${tx.detail}`);
        }
      });
    },
    async transactions() {
      await root();
      const ids = (await readdir(stateRoot)).filter((id) => txPattern.test(id)).sort().reverse().slice(0, 64);
      const result = [];
      for (const id of ids) { const tx = await load(id); result.push(publicReceipt(tx)); }
      return result;
    },
    async restore(id) { return lock(async () => { const tx = await load(id); if (!activeStates.has(tx.status)) throw new Error("That transaction is not active."); return restoreTx(tx); }); },
    async keep(id) { return lock(async () => { const tx = await load(id); if (tx.status !== "applied" || tx.trial !== "verified") throw new Error("Try and verify the applied action before keeping it."); await verify(tx.connection, true); tx.status = "kept"; await save(tx); return publicReceipt(tx); }); },
    async trial(id) { return lock(async () => {
      const tx = await load(id); if (!["applied", "kept"].includes(tx.status)) throw new Error("Apply this connection before trying it.");
      const binding = (await live()).find((b) => ours(b, tx.connection));
      if (!(await config()).text.includes(tx.block) || !binding) throw new Error("This connection changed since application. Review it before trying.");
      await verifyTarget(tx.connection);
      if (focus) await focus(tx.connection);
      else { const since = Date.now(); const result = await hypr("eval", `${callbackName(tx.connection)}()`); if (result.trim() !== "ok") throw new Error("The compositor rejected the owned registered Lua callback."); await waitIntentReceipt(tx.connection, since); }
      tx.trial = "verified"; tx.trialEvidence = "owned named Lua callback bound to the chord and authenticated intent receipt; physical keyboard event and external task completion not established"; await save(tx); return publicReceipt(tx);
    }); }
  };
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const args = process.argv.slice(2);
  try {
    if (args.length === 1 && args[0] === "focus-chatgpt") await dispatchPhysicalIntent({ implementation: "native-chatgpt.focus/v1" });
    else if (args[0] === "intent" && args.length === 2 && args[1] === "native-chatgpt.focus/v1") await dispatchPhysicalIntent({ implementation: args[1] });
    else if (args[0] === "intent" && args.length === 4) await dispatchPhysicalIntent({ implementation: args[1], roleId: args[2], intent: args[3] });
    else throw new Error("Only closed physical intents are supported.");
  } catch { process.stderr.write("Switchyard: physical intent unavailable or rejected by the active workspace. Open the app and review its exact target and policy.\n"); process.exitCode = 1; }
}
