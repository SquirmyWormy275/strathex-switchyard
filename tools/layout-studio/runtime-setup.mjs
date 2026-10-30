/** Reproducible optional runtime. Existing installations are verified, never overwritten. */
import { createHash } from "node:crypto";
import { constants } from "node:fs";
import { lstat, mkdir, open, realpath, rm } from "node:fs/promises";
import { homedir, userInfo } from "node:os";
import { join, isAbsolute } from "node:path";
import { fileURLToPath } from "node:url";
import { privateDirectory, directoryIdentity } from "./private-fs.mjs";
import { runRuntimeCommand } from "./runtime-command.mjs";

export const runtimeRoot = () => join(homedir(), ".local/share/strathex-switchyard/voice");
const sourceRoot = fileURLToPath(new URL("./", import.meta.url));
export const runtimePython = (root) => join(root, process.platform === "win32" ? "venv/Scripts/python.exe" : "venv/bin/python");
const exists = async (p) => { try { await lstat(p); return true; } catch (e) { if (e.code === "ENOENT") return false; throw e; } };
async function ownedDirectory(path, create = false) {
  if (!isAbsolute(path) || /[\0\r\n]/.test(path)) throw new Error("The runtime needs an absolute local directory.");
  if (create) await mkdir(path, { recursive: true, mode: 0o700 });
  const s = await directoryIdentity(path);
  if (process.platform !== "win32" && (Number(s.uid) !== userInfo().uid || Number(s.mode) & 0o022)) throw new Error("The runtime directory has unsafe ownership, links or write permissions.");
}
export async function hashRuntimeFile(path, expectedSize, { openFile = open, statName = lstat } = {}) {
  const f = await openFile(path, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0));
  try {
    const s = await f.stat({ bigint: true }), named = await statName(path, { bigint: true });
    if (!s.isFile() || !named.isFile() || named.isSymbolicLink() || s.ino !== named.ino || s.dev !== named.dev || s.size !== BigInt(expectedSize) || (process.platform !== "win32" && (Number(s.uid) !== userInfo().uid || Number(s.mode) & 0o022))) throw new Error("A runtime model file is unsafe or differs in size.");
    const hash = createHash("sha256");
    for await (const chunk of f.createReadStream({ autoClose: false })) hash.update(chunk);
    return hash.digest("hex");
  } finally { await f.close(); }
}
export function validateRuntimeModel(model) {
  const names = ["config.json", "model.bin", "tokenizer.json", "vocabulary.txt"];
  if (model?.schema !== "switchyard-local-model/v1" || model.repository !== "Systran/faster-whisper-base.en" || !/^[a-f0-9]{40}$/.test(model.revision) || !Array.isArray(model.files) || JSON.stringify(model.files.map((f) => f.name).sort()) !== JSON.stringify(names.sort()) || model.files.some((f) => !Number.isSafeInteger(f.size) || f.size < 1 || f.size > 200000000 || !/^[a-f0-9]{64}$/.test(f.sha256))) throw new Error("The pinned model manifest is unsupported.");
  return model;
}
export async function verifyRuntimeModel(directory, model) {
  validateRuntimeModel(model); await ownedDirectory(directory);
  for (const file of model.files) if (await hashRuntimeFile(join(directory, file.name), file.size) !== file.sha256) throw new Error("A local model file differs from its pinned SHA-256. Existing files were preserved.");
}
export function runtimeEnvironment() {
  const allowed = new Set(["PATH", "HOME", "USERPROFILE", "HOMEDRIVE", "HOMEPATH", "LOCALAPPDATA", "APPDATA", "SYSTEMROOT", "SYSTEMDRIVE", "TEMP", "TMP", "TMPDIR", "XDG_CACHE_HOME", "XDG_DATA_HOME", "LANG", "LC_ALL", "LC_CTYPE", "SSL_CERT_FILE", "SSL_CERT_DIR", "HTTPS_PROXY", "HTTP_PROXY", "ALL_PROXY", "NO_PROXY"]);
  const env = Object.fromEntries(Object.entries(process.env).filter(([name]) => allowed.has(name.toUpperCase())));
  return { ...env, UV_NO_CACHE: "1", HF_HUB_OFFLINE: "1", HF_HUB_DISABLE_TELEMETRY: "1", LANGSMITH_TRACING: "false", LANGCHAIN_TRACING_V2: "false", LANGSMITH_API_KEY: "", LANGCHAIN_API_KEY: "" };
}
export async function runtimeCommand(executable, args, { env = runtimeEnvironment(), ...options } = {}) {
  return runRuntimeCommand(executable, args, { ...options, env });
}
export async function trustedUv() {
  const candidates = process.platform === "win32" ? [join(homedir(), ".local/bin/uv.exe"), join(process.env.LOCALAPPDATA || homedir(), "Programs/uv/uv.exe")] : [join(homedir(), ".local/bin/uv"), "/usr/bin/uv", "/usr/local/bin/uv"];
  for (const path of candidates) { try { const p = await realpath(path), s = await lstat(p); if (s.isFile() && (process.platform === "win32" || ([0, userInfo().uid].includes(s.uid) && !(s.mode & 0o022) && s.mode & 0o111))) return p; } catch { /* next supported installation */ } }
  throw new Error("Install uv at a supported native location, then run runtime:install. No installer executable was downloaded or run automatically.");
}
export async function downloadRuntimeModel(directory, model, fetcher = fetch) {
  validateRuntimeModel(model); await privateDirectory(directory);
  for (const file of model.files) {
    let url = `https://huggingface.co/${model.repository}/resolve/${model.revision}/${file.name}`, response;
    for (let redirects = 0; redirects < 6; redirects++) {
      const target = new URL(url);
      if (target.protocol !== "https:" || target.username || target.password || !["huggingface.co", "hf.co"].some((d) => target.hostname === d || target.hostname.endsWith(`.${d}`))) throw new Error("The model download redirected outside its allowed distribution hosts.");
      response = await fetcher(url, { redirect: "manual", signal: AbortSignal.timeout(120000), headers: { "User-Agent": "Switchyard-local-runtime/0.2" } });
      if (![301, 302, 303, 307, 308].includes(response.status)) break;
      await response.body?.cancel(); url = new URL(response.headers.get("location"), url).href; response = null;
    }
    if (!response?.ok || !response.body) throw new Error("The pinned model download was unavailable.");
    const declared = response.headers.get("content-length");
    if (declared && Number(declared) !== file.size) { await response.body.cancel(); throw new Error("Model download size differs from the pinned manifest."); }
    const path = join(directory, file.name), handle = await open(path, "wx", 0o600), hash = createHash("sha256"); let bytes = 0;
    try {
      for await (const chunk of response.body) { bytes += chunk.length; if (bytes > file.size) throw new Error("Model download exceeded its pinned size."); hash.update(chunk); await handle.writeFile(chunk); }
      await handle.sync();
      if (bytes !== file.size || hash.digest("hex") !== file.sha256) throw new Error("The pinned model SHA-256 did not match. Nothing was installed.");
    } catch (error) { await handle.close(); await rm(path, { force: true }); throw error; }
    finally { await handle.close(); }
  }
  await verifyRuntimeModel(directory, model);
}

/** Compatibility entry; the same versioned lifecycle serves source and installed callers. */
export async function setupRuntime({ root = runtimeRoot(), install = false, command = runtimeCommand, uvResolver = trustedUv, downloader = downloadRuntimeModel, model, lock = join(sourceRoot, "runtime.requirements.lock"), coordinate } = {}) {
  const [{ createRuntimeLifecycle }, { requiredRuntimeSpec }] = await Promise.all([import("./runtime-lifecycle.mjs"), import("./runtime-storage.mjs")]);
  const spec = await requiredRuntimeSpec({ lock, model });
  if (!coordinate && root === runtimeRoot()) { const { runtimeMaintenanceCoordinator } = await import("../../deployment/suite/runtime-maintenance.mjs"); coordinate = runtimeMaintenanceCoordinator({ runtimeRoot: root }); }
  return createRuntimeLifecycle({ root, spec, command, uvResolver, downloader, ...(coordinate ? { coordinate } : {}) })[install ? "install" : "check"]();
}
