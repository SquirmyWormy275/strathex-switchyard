/** Small, offline application bundles; protected data and optional runtimes stay separate. */
import { createHash, randomUUID } from "node:crypto";
import { constants } from "node:fs";
import { mkdir, lstat, open, readFile, readdir, realpath, rename, rm, writeFile } from "node:fs/promises";
import { dirname, join, relative, resolve, sep } from "node:path";
import { userInfo } from "node:os";

const schema = "switchyard-suite-release/v1", maxFiles = 512, maxTotal = 128 * 1024 * 1024;
export const nodeVersion = "24.14.0";
const hash = (data) => createHash("sha256").update(data).digest("hex");
const required = ["package.json", "tools/layout-studio/serve.mjs", "tools/layout-studio/suite.mjs", "deployment/suite/release.mjs", "deployment/suite/run.mjs", "apps/vscode-extension/src/codex-daemon-status.cjs", "packages/control-plane/src/confirmations.ts", "frontend/index.html"];
function portableName(name) {
  if (typeof name !== "string" || name.length > 240 || name.split("/").some((p) => !/^[A-Za-z0-9_.-]+$/.test(p) || /^\.+$/.test(p) || /[. ]$/.test(p) || /^(?:con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i.test(p))) throw new Error("A release path is not a portable relative file name.");
  return name;
}
async function directory(path) {
  const s = await lstat(path);
  if (!s.isDirectory() || s.isSymbolicLink() || (process.platform !== "win32" && (s.uid !== userInfo().uid && s.uid !== 0 || s.mode & 0o022))) throw new Error("Release directories must be local, owned and not writable by other users.");
}
export async function readReleaseFile(path, { openFile = open, statName = lstat } = {}) {
  const f = await openFile(path, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0));
  try {
    const s = await f.stat({ bigint: true }), named = await statName(path, { bigint: true });
    if (!s.isFile() || !named.isFile() || named.isSymbolicLink() || s.ino !== named.ino || s.dev !== named.dev || s.size > BigInt(maxTotal) || (process.platform !== "win32" && (Number(s.uid) !== userInfo().uid && Number(s.uid) !== 0 || Number(s.mode) & 0o022))) throw new Error("A release file is unsafe, changed or oversized.");
    const b = await f.readFile(); if (b.length > maxTotal) throw new Error("A release file is oversized."); return b;
  } finally { await f.close(); }
}
const bytes = readReleaseFile;
async function walk(root, at = "") {
  await directory(join(root, at)); const found = [];
  for (const entry of await readdir(join(root, at), { withFileTypes: true })) {
    const name = portableName(at ? `${at}/${entry.name}` : entry.name);
    if (entry.isDirectory()) found.push(...await walk(root, name));
    else if (entry.isFile()) found.push(name);
    else throw new Error("Release bundles cannot contain links or special files.");
    if (found.length > maxFiles) throw new Error("The release contains too many files.");
  }
  return found;
}
function validate(manifest) {
  if (manifest?.schema !== schema || !["linux", "win32"].includes(manifest.platform) || manifest.nodeVersion !== nodeVersion || manifest.runtime !== "external-pinned-node" || manifest.integrity !== "sha256-content-manifest-not-signed" || !/^[a-f0-9]{40}$/.test(manifest.sourceCommit) || typeof manifest.development !== "boolean" || manifest.frontend?.schema !== "switchyard-front-end-review/v1" || !/^[a-f0-9]{64}$/.test(manifest.frontend.digest) || !Array.isArray(manifest.frontend.files) || !Array.isArray(manifest.files) || manifest.files.length < required.length || manifest.files.length > maxFiles) throw new Error("The suite release manifest is unsupported.");
  const names = new Set(); let total = 0;
  for (const f of manifest.files) {
    const name = portableName(f.path), folded = name.toLowerCase();
    if (names.has(folded) || !/^[a-f0-9]{64}$/.test(f.sha256) || !Number.isSafeInteger(f.size) || f.size < 0 || (total += f.size) > maxTotal) throw new Error("The suite release file manifest is invalid or oversized.");
    names.add(folded);
  }
  if (required.some((name) => !manifest.files.some((f) => f.path === name)) || manifest.platform === "win32" && !manifest.files.some((f) => f.path === "runtime/hotkeys/Switchyard.Hotkeys.exe")) throw new Error("The suite release is missing a required application component.");
  if (JSON.stringify(manifest.files.map((f) => f.path)) !== JSON.stringify(manifest.files.map((f) => f.path).sort())) throw new Error("The suite release file manifest is not canonical.");
  const { id, ...identity } = manifest;
  if (!/^[a-f0-9]{64}$/.test(id) || hash(JSON.stringify(identity)) !== id) throw new Error("The suite release content identity did not verify.");
  return manifest;
}
export async function verifySuiteRelease(root, { expectedId, platform, checkRuntime = false } = {}) {
  root = resolve(root); await directory(root);
  if (await realpath(root) !== root) throw new Error("Resolve the actual release directory before verification; redirected roots are unsupported.");
  const manifest = validate(JSON.parse((await bytes(join(root, "switchyard-release.json"))).toString("utf8")));
  if (expectedId !== undefined && manifest.id !== expectedId) throw new Error("The suite release differs from the expected content identity.");
  if (platform !== undefined && manifest.platform !== platform) throw new Error("The suite release targets another operating system.");
  if (checkRuntime && process.versions.node !== manifest.nodeVersion) throw new Error(`Switchyard requires Node ${manifest.nodeVersion}; the existing installation was preserved.`);
  const actual = (await walk(root)).filter((name) => name !== "switchyard-release.json").sort(), expected = manifest.files.map((f) => f.path);
  if (JSON.stringify(actual) !== JSON.stringify(expected)) throw new Error("Suite release files are missing or include unmanifested content.");
  for (const f of manifest.files) { const b = await bytes(join(root, f.path)); if (b.length !== f.size || hash(b) !== f.sha256) throw new Error(`Suite release integrity failed: ${f.path}`); }
  const front = manifest.frontend;
  if (hash(JSON.stringify(front.files)) !== front.digest || front.files.length !== manifest.files.filter((f) => f.path.startsWith("frontend/")).length || front.files.some((f) => !manifest.files.some((entry) => entry.path === `frontend/${f.file}` && entry.sha256 === f.sha256))) throw new Error("The frozen frontend identity did not verify.");
  return manifest;
}
export async function buildSuiteRelease({ sourceRoot, sourceFiles, outputRoot, frontendRoot, sourceCommit, development = false, platform = process.platform, windowsHotkeys } = {}) {
  sourceRoot = await realpath(sourceRoot); outputRoot = resolve(outputRoot); frontendRoot = await realpath(frontendRoot);
  if (!["linux", "win32"].includes(platform) || !/^[a-f0-9]{40}$/.test(sourceCommit) || typeof development !== "boolean" || outputRoot === sourceRoot || !relative(sourceRoot, outputRoot).startsWith(`artifacts${sep}`)) throw new Error("Build the private suite bundle under this checkout's artifacts directory with an exact source revision.");
  const front = JSON.parse((await bytes(join(frontendRoot, "manifest.json"))).toString("utf8"));
  if (front.schema !== "switchyard-front-end-review/v1" || hash(JSON.stringify(front.files)) !== front.digest) throw new Error("Choose a verified frozen frontend review; preparing a new review is a separate action.");
  if (!Array.isArray(sourceFiles) || !sourceFiles.length || sourceFiles.some((name) => { try { portableName(name); return false; } catch { return true; } })) throw new Error("Provide the explicit tracked source inventory; untracked local files must never enter a bundle.");
  const tracked = new Set(sourceFiles), inputs = new Map(), add = async (from, to = from) => { portableName(to); if (!tracked.has(from)) return; if (inputs.has(to)) throw new Error("A release input was duplicated."); inputs.set(to, await bytes(join(sourceRoot, from))); };
  for (const name of await walk(join(sourceRoot, "tools/layout-studio"))) if (!name.endsWith(".test.mjs") && !name.endsWith(".pyc") && !name.startsWith("test-support/")) await add(`tools/layout-studio/${name}`);
  for (const prefix of ["integrations", "examples/custom-agent", "examples/langchain-agent", "deployment/suite", "third_party/model-f-catalog"]) for (const name of await walk(join(sourceRoot, prefix))) if (!name.endsWith(".test.mjs") && !name.endsWith(".pyc") && !name.startsWith("test-support/")) await add(`${prefix}/${name}`);
  for (const name of ["apps/vscode-extension/src/codex-daemon-status.cjs", "packages/control-plane/src/confirmations.ts", "packages/control-plane/src/store.ts", "packages/control-plane/src/redaction.ts", "scripts/setup-switchyard-runtime.mjs", "scripts/workflow-monitor.mjs", "scripts/workflow-capture.mjs", "ATTRIBUTION.md"]) await add(name);
  for (const name of ["pure-template.svg", "template-faces.json", "pure-template.pdf", "README.md", "ReadMe.txt"]) await add(`third-party/cyber_engineer/${name}`);
  // A minimal package boundary is sufficient: the application has no npm runtime dependencies.
  inputs.set("package.json", Buffer.from(JSON.stringify({ name: "strathex-switchyard-private-suite", type: "module", private: true, license: "UNLICENSED", engines: { node: nodeVersion } }) + "\n"));
  for (const f of front.files) { portableName(f.file); if (f.file.includes("/")) throw new Error("The frontend review file contract changed."); const b = await bytes(join(frontendRoot, f.file)); if (hash(b) !== f.sha256) throw new Error("A frozen frontend asset changed."); inputs.set(`frontend/${f.file}`, b); }
  if (platform === "win32") {
    if (!windowsHotkeys) throw new Error("The Windows suite bundle requires the built native hotkey helper.");
    inputs.set("runtime/hotkeys/Switchyard.Hotkeys.exe", await bytes(await realpath(windowsHotkeys)));
    for (const name of ["apps/desktop-hotkeys/Program.cs", "apps/desktop-hotkeys/RuntimeCommandRunner.cs", "apps/desktop-hotkeys/Switchyard.Hotkeys.csproj"]) await add(name);
    for (const name of await walk(join(sourceRoot, "deployment/windows/licenses"))) await add(`deployment/windows/licenses/${name}`);
  }
  const files = [...inputs].map(([path, b]) => ({ path, size: b.length, sha256: hash(b) }));
  // Use code-unit sorting consistently on every build platform.
  files.sort((a, b) => a.path < b.path ? -1 : a.path > b.path ? 1 : 0);
  const identity = { schema, platform, nodeVersion, runtime: "external-pinned-node", integrity: "sha256-content-manifest-not-signed", sourceCommit, development, frontend: { schema: front.schema, digest: front.digest, files: front.files }, files }, manifest = validate({ id: hash(JSON.stringify(identity)), ...identity });
  await mkdir(outputRoot, { recursive: true, mode: 0o700 }); await directory(outputRoot);
  const stage = join(outputRoot, `.stage-${randomUUID()}`), destination = join(outputRoot, manifest.id);
  try {
    await mkdir(stage, { mode: 0o700 });
    for (const [name, b] of inputs) { const path = join(stage, name); await mkdir(dirname(path), { recursive: true, mode: 0o700 }); await writeFile(path, b, { flag: "wx", mode: 0o600 }); }
    await writeFile(join(stage, "switchyard-release.json"), JSON.stringify(manifest, null, 2) + "\n", { flag: "wx", mode: 0o600 });
    await verifySuiteRelease(stage, { expectedId: manifest.id, platform });
    try { await lstat(destination); await verifySuiteRelease(destination, { expectedId: manifest.id, platform }); }
    catch (e) { if (e.code !== "ENOENT") throw e; await rename(stage, destination); }
    return { directory: destination, id: manifest.id, files: files.length, bytes: files.reduce((n, f) => n + f.size, 0), frontend: front.digest, development };
  } finally { await rm(stage, { recursive: true, force: true }); }
}
