/** Immutable optional software records. Protected workspace data never enters this tree. */
import { createHash } from "node:crypto";
import { constants } from "node:fs";
import { lstat, open, readFile, readdir, readlink, realpath } from "node:fs/promises";
import { join, resolve } from "node:path";
import { userInfo } from "node:os";
import { fileURLToPath } from "node:url";
import { privateRead, privateWrite, directoryIdentity } from "./private-fs.mjs";
import { runtimeRoot, validateRuntimeModel } from "./runtime-setup.mjs";

export const runtimeDigest = value => createHash("sha256").update(typeof value === "string" || Buffer.isBuffer(value) ? value : JSON.stringify(value)).digest("hex");
export const runtimeId = value => typeof value === "string" && /^[a-f0-9]{64}$/.test(value);
export const runtimeLocation = value => typeof value === "string" && /^(venv|base\.en|versions\/[a-f0-9-]{36}\/(venv|base\.en))$/.test(value);
export const runtimeMetadata = root => join(root, ".maintenance");
const source = fileURLToPath(new URL("./", import.meta.url)), uid = userInfo().uid;
export async function requiredRuntimeSpec({ lock = join(source, "runtime.requirements.lock"), probe = join(source, "runtime-probe.py"), model } = {}) {
  const value = { schema: "switchyard-runtime-spec/v1", python: "3.12.14", requirements: await readFile(lock, "utf8"), probe: await readFile(probe, "utf8"), model: validateRuntimeModel(model ?? JSON.parse(await readFile(join(source, "runtime-model.json"), "utf8"))) };
  validateRuntimeSpec(value); return { ...value, id: runtimeDigest(value) };
}
export function validateRuntimeSpec(value) {
  if (value?.schema !== "switchyard-runtime-spec/v1" || value.python !== "3.12.14" || typeof value.requirements !== "string" || !value.requirements.length || value.requirements.length > 1024 * 1024 || typeof value.probe !== "string" || !value.probe.length || value.probe.length > 65536 || Object.keys(value).some(k => !["schema", "python", "requirements", "probe", "model", "id"].includes(k))) throw new Error("Unsupported runtime specification; existing components were preserved.");
  validateRuntimeModel(value.model);
  const { id, ...identity } = value;
  if (id !== undefined && id !== runtimeDigest(identity)) throw new Error("The runtime specification identity changed.");
  return value;
}
export function runtimeComponentKeys(spec) { validateRuntimeSpec(spec); return { python: runtimeDigest({ python: spec.python, requirements: spec.requirements }), model: runtimeDigest(spec.model.files) }; }

async function fileHash(path, { external = false, emptyAdvisoryLock = false } = {}) {
  const file = await open(path, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0));
  try {
    const actual = await file.stat({ bigint: true }), named = await lstat(path, { bigint: true });
    // Legacy uv/Hugging Face create empty advisory locks as 0666/0664 inside
    // the private runtime root. These are metadata, never executable/imported
    // content. No other writable file or nonempty lock gets this exception.
    const knownLock = emptyAdvisoryLock && actual.size === 0n && [0o666, 0o664].includes(Number(actual.mode) & 0o777);
    if (!actual.isFile() || !named.isFile() || named.isSymbolicLink() || actual.dev !== named.dev || actual.ino !== named.ino || actual.size < 0n || actual.size > 512n * 1024n * 1024n || process.platform !== "win32" && (!([uid, ...(external ? [0] : [])].includes(Number(actual.uid))) || Number(actual.mode) & 0o022 && !knownLock)) throw new Error("Runtime software contains an unsafe or changed file.");
    const hash = createHash("sha256"); for await (const block of file.createReadStream({ autoClose: false })) hash.update(block);
    const after = await file.stat({ bigint: true }), nameAfter = await lstat(path, { bigint: true });
    if (after.dev !== actual.dev || after.ino !== actual.ino || after.size !== actual.size || after.mtimeNs !== actual.mtimeNs || after.ctimeNs !== actual.ctimeNs || nameAfter.dev !== actual.dev || nameAfter.ino !== actual.ino || !nameAfter.isFile()) throw new Error("Runtime software changed while its digest was read.");
    return { size: Number(actual.size), sha256: hash.digest("hex"), mode: Number(actual.mode) & 0o777 };
  } finally { await file.close(); }
}
/** Links are inventoried without traversal; only uv's known interpreter/lib aliases are allowed. */
export async function inventoryRuntimeComponent(directory, kind) {
  if (!["venv", "base.en"].includes(kind)) throw new Error("Unknown runtime component.");
  const root = await directoryIdentity(directory), entries = []; let bytes = 0;
  async function visit(at = "") {
    const current = join(directory, at), stat = await directoryIdentity(current);
    if (stat.dev !== root.dev || process.platform !== "win32" && (Number(stat.uid) !== uid || Number(stat.mode) & 0o022)) throw new Error("Runtime software contains an unsafe directory or mount.");
    for (const name of (await readdir(current)).sort()) {
      if (!name || /[\0\r\n\\]/.test(name)) throw new Error("Runtime software contains an unsupported name.");
      const relative = at ? `${at}/${name}` : name, path = join(directory, relative), info = await lstat(path, { bigint: true });
      const modelFile = /^(config\.json|model\.bin|tokenizer\.json|vocabulary\.txt)$/;
      const modelCache = /^(\.cache|\.cache\/huggingface|\.cache\/huggingface\/(download|trees|CACHEDIR\.TAG|\.gitignore)|\.cache\/huggingface\/download\/(config\.json|model\.bin|tokenizer\.json|vocabulary\.txt)\.(lock|metadata)|\.cache\/huggingface\/trees\/[a-f0-9]{40}\.json)$/;
      if (kind === "base.en" && !modelFile.test(relative) && !modelCache.test(relative)) throw new Error("The model directory contains unrelated content; it was preserved.");
      if (entries.length >= 32768 || info.dev !== root.dev) throw new Error("Runtime software exceeds its bounded inventory or crosses a mount.");
      if (info.isSymbolicLink()) {
        const target = await readlink(path);
        if (kind !== "venv" || !(relative === "lib64" && target === "lib" || ["bin/python", "bin/python3", "bin/python3.12"].includes(relative) && !target.includes("\0"))) throw new Error("Runtime software contains an unknown link; it was preserved.");
        let executable;
        if (relative.startsWith("bin/")) executable = { resolved: await realpath(path), ...await fileHash(await realpath(path), { external: true }) };
        entries.push({ path: relative, type: "link", target, ...(executable ? { executable } : {}) });
      } else if (info.isDirectory()) { entries.push({ path: relative, type: "directory", mode: Number(info.mode) & 0o777 }); await visit(relative); }
      else if (info.isFile()) { const content = await fileHash(path, { emptyAdvisoryLock: kind === "venv" && relative === ".lock" || kind === "base.en" && modelCache.test(relative) && relative.endsWith(".lock") }); bytes += content.size; if (bytes > 2 * 1024 ** 3) throw new Error("Runtime software exceeds its bounded inventory."); entries.push({ path: relative, type: "file", ...content }); }
      else throw new Error("Runtime software contains a special file; it was preserved.");
    }
  }
  await visit(); return { schema: "switchyard-runtime-inventory/v1", kind, bytes, entries };
}
export async function verifyRuntimeComponent(root, component, { allowMissing = false } = {}) {
  if (!runtimeLocation(component?.location) || !runtimeId(component.key) || !["venv", "base.en"].includes(component.inventory?.kind) || !component.location.endsWith(component.inventory.kind)) throw new Error("The stored runtime component location is unsupported.");
  try { await directoryIdentity(join(root, component.location)); } catch (error) { if (allowMissing && error.code === "ENOENT") return component; throw error; }
  const current = await inventoryRuntimeComponent(join(root, component.location), component.inventory.kind);
  const expected = new Map(component.inventory.entries.map(entry => [entry.path, JSON.stringify(entry)]));
  if (allowMissing ? current.entries.some(entry => expected.get(entry.path) !== JSON.stringify(entry)) : JSON.stringify(current) !== JSON.stringify(component.inventory)) throw new Error("Runtime software differs from its recorded inventory. Its files were preserved.");
  return component;
}
export async function readRuntimeRelease(root, id) {
  if (!runtimeId(id)) throw new Error("Unsupported runtime release identity.");
  const record = JSON.parse(await privateRead(join(runtimeMetadata(root), "releases", `${id}.json`)));
  const { id: stored, ...identity } = record;
  if (record.schema !== "switchyard-runtime-release/v1" || stored !== id || runtimeDigest(identity) !== id || record.platform !== process.platform || !runtimeId(record.spec?.id)) throw new Error("The runtime release record changed or belongs to another platform.");
  validateRuntimeSpec(record.spec);
  const keys = runtimeComponentKeys(record.spec);
  if (Object.keys(record.components ?? {}).sort().join(",") !== "model,python" || Object.entries(record.components).some(([name, component]) => !runtimeLocation(component.location) || component.key !== keys[name] || component.inventory?.kind !== (name === "python" ? "venv" : "base.en"))) throw new Error("The runtime component record is invalid.");
  return record;
}
export function runtimeReleaseRecord(spec, components) {
  const identity = { schema: "switchyard-runtime-release/v1", platform: process.platform, spec: validateRuntimeSpec(spec), components: { python: components.python, model: components.model } };
  return { id: runtimeDigest(identity), ...identity };
}
export async function saveRuntimeRelease(root, spec, components) {
  const record = runtimeReleaseRecord(spec, components);
  await privateWrite(join(runtimeMetadata(root), "releases", `${record.id}.json`), JSON.stringify(record)); return readRuntimeRelease(root, record.id);
}
export async function readRuntimeSelection(root) {
  let selection;
  try { selection = JSON.parse(await privateRead(join(runtimeMetadata(root), "current.json"))); } catch (error) { if (error.code === "ENOENT") return null; throw error; }
  if (selection.schema !== "switchyard-runtime-selection/v1" || selection.current !== null && !runtimeId(selection.current) || selection.previous !== null && !runtimeId(selection.previous) || Object.keys(selection).sort().join(",") !== "current,previous,schema") throw new Error("The runtime selection is unsupported; its files were preserved.");
  return selection;
}
export async function resolveRuntimePaths({ root = runtimeRoot(), spec } = {}) {
  spec ??= await requiredRuntimeSpec();
  const selection = await readRuntimeSelection(root);
  if (!selection) return { python: join(root, process.platform === "win32" ? "venv/Scripts/python.exe" : "venv/bin/python"), model: join(root, "base.en"), legacy: true };
  for (const id of [selection.current, selection.previous].filter(Boolean)) {
    const record = await readRuntimeRelease(root, id);
    if (record.spec.id !== spec.id) continue;
    for (const component of Object.values(record.components)) await directoryIdentity(join(root, component.location));
    return { python: resolve(root, record.components.python.location, process.platform === "win32" ? "Scripts/python.exe" : "bin/python"), model: join(root, record.components.model.location), releaseId: id, legacy: false };
  }
  throw new Error("Install or select the optional runtime matching this application version. Existing versions were preserved.");
}
