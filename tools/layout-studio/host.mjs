/** Closed, reversible host configuration. No arbitrary command/device endpoint. */
import { createHash, randomUUID } from "node:crypto";
import { execFile } from "node:child_process";
import { constants } from "node:fs";
import { lstat, mkdir, open, readFile, readdir, readlink, realpath, rename, rm, writeFile } from "node:fs/promises";
import { homedir, userInfo } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import { compileConnection } from "./workspace.mjs";

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
  const meta = await lstat(path);
  if (!meta.isFile() || meta.isSymbolicLink() || meta.uid !== uid || (meta.mode & 0o022) || (privateFile && (meta.mode & 0o077))) throw new Error("The configuration or recovery file is not an owner-controlled regular file.");
  if (meta.size > 1024 * 1024) throw new Error("The local file exceeds the supported size.");
  const handle = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW);
  try {
    const opened = await handle.stat();
    if (opened.ino !== meta.ino || opened.dev !== meta.dev) throw new Error("The local file changed while it was opened.");
    return { text: await handle.readFile("utf8"), mode: meta.mode & 0o777 };
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
  hypr = runHypr, verifyTarget = () => nativeChatgptWindow(hypr), focus = () => focusNativeChatgpt(hypr), now = () => Date.now()
} = {}) {
  const reviews = new Map();
  const script = fileURLToPath(import.meta.url);
  if ([script, process.execPath].some((s) => /[\0\r\n]/.test(s))) throw new Error("The application path is unsupported.");
  const command = `${quote(process.execPath)} ${quote(script)} focus-chatgpt`;
  const live = async () => {
    const list = JSON.parse(await hypr("binds", "-j"));
    if (!Array.isArray(list)) throw new Error("The compositor shortcut list is unavailable.");
    return list;
  };
  const matches = (b, c) => b.modmask === c.modmask && String(b.key).toUpperCase() === c.key;
  const ours = (b, c) => matches(b, c) && b.description === c.label && b.dispatcher === "exec" && b.arg === command;
  const config = async () => { await ownedDirectory(dirname(configPath)); return ownedFile(configPath); };
  async function root() {
    await mkdir(stateRoot, { recursive: true, mode: 0o700 });
    await ownedDirectory(stateRoot, true);
  }
  async function lock(fn) {
    await root();
    let handle;
    try { handle = await open(join(stateRoot, "transaction.lock"), "wx", 0o600); }
    catch { throw new Error("Another configuration operation owns the recovery lock. Inspect private transaction state before retrying."); }
    try { await handle.writeFile(String(process.pid)); return await fn(); }
    finally { await handle.close(); await rm(join(stateRoot, "transaction.lock")); }
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
  async function verify(c, present) {
    if ((await hypr("reload")).trim() !== "ok" || (await hypr("configerrors")).trim()) throw new Error("The compositor could not validate the configuration.");
    const bindings = await live();
    const count = bindings.filter((b) => matches(b, c));
    if (present ? count.length !== 1 || !ours(count[0], c) : count.some((b) => ours(b, c))) throw new Error("Live shortcut readback does not match the reviewed change.");
  }
  async function restoreTx(tx) {
    const current = await config();
    const baseline = (await ownedFile(join(stateRoot, tx.id, "bindings.lua.before"), true)).text;
    if (hash(baseline) !== tx.beforeHash) throw new Error("The saved baseline failed verification. No restoration was attempted.");
    let restored;
    if (hash(current.text) === tx.beforeHash) restored = current.text;
    else if (hash(current.text) === tx.afterHash) restored = baseline;
    else {
      const first = current.text.indexOf(tx.block);
      if (first < 0 || current.text.indexOf(tx.block, first + 1) >= 0) throw new Error("The owned shortcut was edited or removed. Review the saved baseline before restoring; unrelated changes are preserved.");
      restored = current.text.slice(0, first) + current.text.slice(first + tx.block.length);
    }
    if ((await config()).text !== current.text) throw new Error("The configuration changed during restoration. Retry after reviewing it.");
    await atomicFile(configPath, restored, current.mode);
    await verify(tx.connection, false);
    if ((await config()).text !== restored) throw new Error("Restored file readback failed.");
    tx.status = "restored"; tx.detail = "Owned shortcut removed; previous configuration verified. Later unrelated edits are preserved.";
    await save(tx);
    return publicReceipt(tx);
  }
  return {
    async review(plan, actionId, implementation) {
      if (process.platform !== "linux") throw new Error("Host application is currently implemented only for Omarchy Linux. Portable design remains available.");
      const connection = compileConnection(plan, actionId, implementation);
      await verifyTarget();
      if ((await hypr("configerrors")).trim()) throw new Error("Resolve existing compositor errors before applying a shortcut.");
      const before = await config();
      if ((await live()).some((b) => matches(b, connection))) throw new Error(`${connection.shortcut} is already assigned. Choose another chord; the existing binding will be preserved.`);
      const id = randomUUID();
      const line = `o.bind(${JSON.stringify(connection.shortcut)}, ${JSON.stringify(connection.label)}, ${JSON.stringify(command)})`;
      const review = { id, connection, line, beforeHash: hash(before.text), expires: now() + 120000 };
      if (reviews.size >= 16) reviews.delete(reviews.keys().next().value);
      reviews.set(id, review);
      return { reviewId: id, expiresAt: review.expires, shortcut: connection.shortcut, label: connection.label, changes: [`Add ${connection.shortcut} → Show ChatGPT to your desktop shortcuts.`, "Save and verify a dated private baseline before writing.", "Focus the existing native main window; no firmware, launch, prompt, or exact task resume.", "Restore removes this shortcut and preserves unrelated later edits."] };
    },
    async apply(reviewId) {
      const review = reviews.get(reviewId);
      reviews.delete(reviewId); // attempted reviews cannot be replayed
      if (!review || now() > review.expires) throw new Error("This review expired or was already used. Review the current change again.");
      return lock(async () => {
        const before = await config();
        if (hash(before.text) !== review.beforeHash) throw new Error("Desktop shortcuts changed after review. Review again; no changes were applied.");
        await verifyTarget();
        if ((await hypr("configerrors")).trim() || (await live()).some((b) => matches(b, review.connection))) throw new Error("The shortcut is no longer available. Review again; no changes were applied.");
        const id = `${new Date().toISOString().replaceAll(/[:.]/g, "-")}-${randomUUID()}`;
        await mkdir(join(stateRoot, id), { mode: 0o700 });
        const block = `\n-- Switchyard ${id}: begin\n${review.line}\n-- Switchyard ${id}: end\n`;
        const after = before.text + block;
        const tx = { schema: "switchyard-host-transaction/v1", id, status: "prepared", connection: review.connection, beforeHash: hash(before.text), afterHash: hash(after), block, createdAt: new Date().toISOString() };
        await writeFile(join(stateRoot, id, "bindings.lua.before"), before.text, { flag: "wx", mode: 0o600 });
        await writeFile(join(stateRoot, id, "reason.txt"), `Review and trial ${review.connection.shortcut} to focus the verified native ChatGPT main window. Preserve ordinary typing and save the complete prior host bindings.\n`, { flag: "wx", mode: 0o600 });
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
    async trial(id) { return lock(async () => { const tx = await load(id); if (!["applied", "kept"].includes(tx.status)) throw new Error("Apply this connection before trying it."); if (!(await config()).text.includes(tx.block) || !(await live()).some((b) => ours(b, tx.connection))) throw new Error("This connection changed since application. Review it before trying."); await focus(); tx.trial = "verified"; await save(tx); return publicReceipt(tx); }); }
  };
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  if (process.argv.length === 3 && process.argv[2] === "focus-chatgpt") {
    try { await focusNativeChatgpt(); }
    catch { process.stderr.write("Switchyard: native ChatGPT focus unavailable; open its safe main window.\n"); process.exitCode = 1; }
  } else { process.stderr.write("This entry point supports only focus-chatgpt.\n"); process.exitCode = 1; }
}
