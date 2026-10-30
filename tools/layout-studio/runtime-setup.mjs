/** Reproducible optional runtime. Existing installations are verified, never overwritten. */
import { spawn } from "node:child_process";
import { createHash, randomUUID } from "node:crypto";
import { constants } from "node:fs";
import { lstat, mkdir, open, readFile, realpath, rename, rm } from "node:fs/promises";
import { homedir, userInfo } from "node:os";
import { join, isAbsolute } from "node:path";
import { fileURLToPath } from "node:url";
import { privateDirectory, privateWrite } from "./private-fs.mjs";
import { withStateLock } from "./state-lock.mjs";

export const runtimeRoot = () => join(homedir(), ".local/share/strathex-switchyard/voice");
const sourceRoot = fileURLToPath(new URL("./", import.meta.url));
export const runtimePython = (root) => join(root, process.platform === "win32" ? "venv/Scripts/python.exe" : "venv/bin/python");
const exists = async (p) => { try { await lstat(p); return true; } catch (e) { if (e.code === "ENOENT") return false; throw e; } };
async function ownedDirectory(path, create = false) {
  if (!isAbsolute(path) || /[\0\r\n]/.test(path)) throw new Error("The runtime needs an absolute local directory.");
  if (create) await mkdir(path, { recursive: true, mode: 0o700 });
  const s = await lstat(path);
  if (!s.isDirectory() || s.isSymbolicLink() || await realpath(path) !== path || (process.platform !== "win32" && (s.uid !== userInfo().uid || s.mode & 0o022))) throw new Error("The runtime directory has unsafe ownership, links or write permissions.");
}
export async function hashRuntimeFile(path, expectedSize) {
  const f = await open(path, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0));
  try {
    const s = await f.stat(), named = await lstat(path);
    if (!s.isFile() || named.isSymbolicLink() || s.ino !== named.ino || s.dev !== named.dev || s.size !== expectedSize || (process.platform !== "win32" && (s.uid !== userInfo().uid || s.mode & 0o022))) throw new Error("A runtime model file is unsafe or differs in size.");
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
export async function runtimeCommand(executable, args, { timeout = 120000, env = runtimeEnvironment() } = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(executable, args, { shell: false, windowsHide: true, stdio: ["ignore", "pipe", "pipe"], env });
    const chunks = []; let bytes = 0, settled = false;
    const finish = (error, value) => { if (settled) return; settled = true; clearTimeout(timer); error ? reject(error) : resolve(value); };
    const timer = setTimeout(() => { child.kill(); finish(new Error("The optional runtime operation timed out; existing installation was preserved.")); }, timeout);
    child.stdout.on("data", (chunk) => { bytes += chunk.length; if (bytes > 512 * 1024) { child.kill(); finish(new Error("Runtime verification exceeded its output bound.")); } else chunks.push(chunk); });
    child.stderr.on("data", () => {}); // Installer output can contain signed download URLs; never log it.
    child.once("error", () => finish(new Error("A required local runtime executable is unavailable.")));
    child.once("close", (code) => code ? finish(new Error("Optional runtime setup or verification failed. Existing components were preserved.")) : finish(null, Buffer.concat(chunks).toString("utf8")));
  });
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

export async function setupRuntime({ root = runtimeRoot(), install = false, command = runtimeCommand, uvResolver = trustedUv, downloader = downloadRuntimeModel, model = null, lock = join(sourceRoot, "runtime.requirements.lock"), lockOperation = (fn) => withStateLock(join(root, ".maintenance"), "runtime", fn) } = {}) {
  if (!["linux", "win32"].includes(process.platform)) throw new Error("The optional runtime installer supports Linux and Windows.");
  model = validateRuntimeModel(model ?? JSON.parse(await readFile(join(sourceRoot, "runtime-model.json"), "utf8")));
  await ownedDirectory(root, install);
  const probe = async (python, directory = null) => {
    const value = JSON.parse(await command(python, ["-I", join(sourceRoot, "runtime-probe.py"), lock, ...(directory ? [directory] : [])]));
    if (value.schema !== "switchyard-runtime-probe/v1" || value.python !== "3.12.14" || !Array.isArray(value.imports) || value.imports.length !== 4 || (directory && value.modelLoaded !== true)) throw new Error("The runtime probe did not verify its expected contract.");
    return value;
  };
  const inspect = async () => { await verifyRuntimeModel(join(root, "base.en"), model); return probe(runtimePython(root), join(root, "base.en")); };
  if (!install) return { status: "verified", ...(await inspect()), modelRevision: model.revision };
  return lockOperation(async (lease) => {
    const stage = join(root, `.install-${randomUUID()}`), promoted = [];
    await privateDirectory(stage);
    try {
      const hasPython = await exists(join(root, "venv")), hasModel = await exists(join(root, "base.en"));
      if (hasPython) { await ownedDirectory(join(root, "venv")); await probe(runtimePython(root)); }
      if (hasModel) await verifyRuntimeModel(join(root, "base.en"), model);
      let uvVersion = null;
      if (!hasPython) {
        const uv = await uvResolver(); uvVersion = (await command(uv, ["--version"])).trim();
        await command(uv, ["venv", "--no-config", "--no-cache", "--managed-python", "--relocatable", "--python", "3.12.14", join(stage, "venv")], { timeout: 600000 });
        await command(uv, ["pip", "sync", "--no-config", "--no-cache", "--require-hashes", "--only-binary", ":all:", "--index-url", "https://pypi.org/simple", "--python", runtimePython(stage), lock], { timeout: 600000 });
        await probe(runtimePython(stage));
      }
      if (!hasModel) await downloader(join(stage, "base.en"), model);
      for (const [component, present] of [["venv", hasPython], ["base.en", hasModel]]) if (!present) { lease.assert(); if (await exists(join(root, component))) throw new Error("Another runtime component appeared during setup. Existing content was preserved."); await rename(join(stage, component), join(root, component)); promoted.push(component); }
      const result = await inspect(); lease.assert();
      const receipt = { ...result, schema: "switchyard-runtime-install/v1", at: new Date().toISOString(), platform: process.platform, uvVersion, reusedExisting: hasPython && hasModel, requirementSha256: createHash("sha256").update(await readFile(lock)).digest("hex"), modelRevision: model.revision };
      await privateDirectory(join(root, ".maintenance")); await privateWrite(join(root, ".maintenance", "verified.json"), JSON.stringify(receipt));
      return { status: "verified", reusedExisting: receipt.reusedExisting, installedComponents: promoted, ...result, modelRevision: model.revision };
    } catch (error) {
      // Only this attempt's new components are removed. Pre-existing data is
      // never replaced or deleted, even when verification fails.
      for (const component of promoted.reverse()) await rename(join(root, component), join(stage, component));
      throw error;
    } finally { await rm(stage, { recursive: true, force: true }); }
  });
}
