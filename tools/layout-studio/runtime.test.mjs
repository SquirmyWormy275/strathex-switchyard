import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdtemp, mkdir, writeFile, readFile, readdir, rm, symlink } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, basename, dirname } from "node:path";
import test from "node:test";
import { setupRuntime, runtimePython, downloadRuntimeModel, verifyRuntimeModel, validateRuntimeModel, runtimeEnvironment } from "./runtime-setup.mjs";

const sha = (v) => createHash("sha256").update(v).digest("hex");
test("optional setup omits provider credentials, custom package indexes and Python injection while disabling external tracing", () => {
  const names = ["OPENAI_API_KEY", "UV_PYTHON_PREFERENCE", "PIP_EXTRA_INDEX_URL", "PYTHONPATH", "HF_TOKEN", "LANGSMITH_API_KEY"], before = Object.fromEntries(names.map((n) => [n, process.env[n]]));
  try {
    for (const n of names) process.env[n] = "synthetic-sensitive-value";
    const env = runtimeEnvironment(); for (const n of names.filter((n) => n !== "LANGSMITH_API_KEY")) assert.ok(!Object.hasOwn(env, n));
    assert.equal(env.LANGSMITH_API_KEY, ""); assert.equal(env.HF_HUB_OFFLINE, "1"); assert.equal(env.LANGSMITH_TRACING, "false");
  } finally { for (const n of names) if (before[n] === undefined) delete process.env[n]; else process.env[n] = before[n]; }
});
async function fixture(fn) {
  const directory = await mkdtemp(join(tmpdir(), "switchyard-runtime-")), root = join(directory, "runtime"), lock = join(directory, "requirements.lock");
  await writeFile(lock, "synthetic==1.0 --hash=sha256:" + "a".repeat(64));
  const files = ["config.json", "model.bin", "tokenizer.json", "vocabulary.txt"].map((name) => ({ name, size: Buffer.byteLength(name), sha256: sha(name) }));
  const model = { schema: "switchyard-local-model/v1", repository: "Systran/faster-whisper-base.en", revision: "a".repeat(40), files };
  let corrupt = false, failFinal = false; const commands = [];
  const fetcher = async (url) => { const name = basename(new URL(url).pathname), value = Buffer.from(name); if (corrupt) value[0] ^= 1; return new Response(value); };
  const downloader = (d, m) => downloadRuntimeModel(d, m, fetcher);
  const command = async (exe, args) => {
    commands.push({ exe, args });
    if (args[0] === "--version") return "uv synthetic";
    if (args[0] === "pip") return "";
    await readFile(exe);
    if (args.length > 3 && failFinal) throw new Error("Synthetic final load failure");
    return JSON.stringify({ schema: "switchyard-runtime-probe/v1", python: "3.12.14", packages: { synthetic: "1.0" }, extraDistributions: [], imports: ["av", "hid", "faster_whisper", "langchain_core"], modelLoaded: args.length > 3 });
  };
  const python = async (base = root) => { const path = runtimePython(base); await mkdir(dirname(path), { recursive: true, mode: 0o700 }); await writeFile(path, "synthetic-python", { mode: 0o600 }); };
  const run = async (exe, args) => { if (args[0] === "venv") { commands.push({ exe, args }); await python(dirname(args.at(-1))); return ""; } return command(exe, args); };
  const options = { root, lock, model, downloader, command: run, uvResolver: async () => "/synthetic/uv" };
  try { await fn({ directory, root, model, options, commands, python, downloader, corrupt: () => { corrupt = true; }, failFinal: () => { failFinal = true; } }); }
  finally { await rm(directory, { recursive: true, force: true }); }
}

test("optional runtime setup installs only verified components with exact hashes and binary wheels, then reuses them without downloads", () => fixture(async ({ root, options, commands }) => {
  const installed = await setupRuntime({ ...options, install: true });
  assert.deepEqual(installed.installedComponents, ["venv", "base.en"]);
  const pip = commands.find((c) => c.args[0] === "pip"); assert.ok(pip.args.includes("--require-hashes")); assert.ok(pip.args.includes("--only-binary")); assert.ok(pip.args.includes("--no-cache"));
  assert.equal(JSON.parse(await readFile(join(root, ".maintenance/verified.json"))).schema, "switchyard-runtime-install/v1");
  const reused = await setupRuntime({ ...options, install: true, downloader: () => { throw new Error("Unexpected duplicate download"); }, uvResolver: () => { throw new Error("Unexpected dependency rebuild"); } });
  assert.equal(reused.reusedExisting, true); assert.deepEqual(reused.installedComponents, []);
  assert.ok(!(await readdir(root)).some((n) => n.startsWith(".install-")));
}));

test("a corrupt model download cannot promote a new interpreter or leave staging artifacts", () => fixture(async ({ root, options, corrupt }) => {
  corrupt(); await assert.rejects(setupRuntime({ ...options, install: true }), /SHA-256/);
  assert.deepEqual((await readdir(root)).filter((n) => n !== ".maintenance"), []);
}));

test("existing model content survives a final runtime load failure and only the new interpreter is rolled back", () => fixture(async ({ root, model, options, downloader, failFinal }) => {
  await mkdir(root, { mode: 0o700 }); await downloader(join(root, "base.en"), model); failFinal();
  await assert.rejects(setupRuntime({ ...options, install: true }), /final load failure/);
  await verifyRuntimeModel(join(root, "base.en"), model);
  assert.deepEqual((await readdir(root)).filter((n) => n !== ".maintenance"), ["base.en"]);
}));

test("a mismatched existing runtime is preserved, with no dependency sync or model replacement", () => fixture(async ({ root, options, python }) => {
  await python();
  const before = await readFile(runtimePython(root));
  await assert.rejects(setupRuntime({ ...options, install: true, command: async () => { throw new Error("Synthetic dependency version mismatch"); } }), /version mismatch/);
  assert.deepEqual(await readFile(runtimePython(root)), before);
}));

test("model manifests reject arbitrary repositories, duplicate/path names and distribution-host redirects", () => fixture(async ({ root, model }) => {
  for (const bad of [{ ...model, repository: "untrusted/repository" }, { ...model, files: model.files.map((f, i) => i ? f : { ...f, name: "../model.bin" }) }]) assert.throws(() => validateRuntimeModel(bad), /unsupported/);
  await assert.rejects(downloadRuntimeModel(join(root, "model"), model, async () => new Response(null, { status: 302, headers: { Location: "https://example.com/model" } })), /outside/);
}));

test("model verification rejects symlinked content without following it", { skip: process.platform === "win32" ? "Native Unix link rejection" : false }, () => fixture(async ({ directory, root, model, downloader }) => {
  await mkdir(root, { mode: 0o700 }); await downloader(join(root, "base.en"), model);
  const path = join(root, "base.en/model.bin"), elsewhere = join(directory, "model.bin");
  await writeFile(elsewhere, "model.bin"); await rm(path); await symlink(elsewhere, path);
  await assert.rejects(verifyRuntimeModel(join(root, "base.en"), model));
}));
