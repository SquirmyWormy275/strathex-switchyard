import assert from "node:assert/strict";
import test from "node:test";
import { randomUUID } from "node:crypto";
import { mkdtemp, mkdir, readFile, writeFile, readdir, rm, chmod, lstat } from "node:fs/promises";
import { join, dirname, basename } from "node:path";
import { tmpdir } from "node:os";
import { createRuntimeLifecycle } from "./runtime-lifecycle.mjs";
import { runtimeDigest, readRuntimeSelection, readRuntimeRelease, resolveRuntimePaths } from "./runtime-storage.mjs";
import { downloadRuntimeModel } from "./runtime-setup.mjs";

function specification(version = 1, modelVersion = 1) {
  const files = ["config.json", "model.bin", "tokenizer.json", "vocabulary.txt"].map(name => { const bytes = `${name}:${modelVersion}`; return { name, size: Buffer.byteLength(bytes), sha256: runtimeDigest(bytes) }; });
  const value = { schema: "switchyard-runtime-spec/v1", python: "3.12.14", requirements: `synthetic==${version} --hash=sha256:${"a".repeat(64)}`, probe: "# synthetic fixture probe", model: { schema: "switchyard-local-model/v1", repository: "Systran/faster-whisper-base.en", revision: String(modelVersion).repeat(40), files } };
  return { ...value, id: runtimeDigest(value) };
}
async function fixture(fn) {
  const directory = await mkdtemp(join(tmpdir(), "switchyard-maintenance-")), root = join(directory, "runtime"), commands = [], downloads = [];
  const python = async destination => { const path = join(destination, process.platform === "win32" ? "Scripts/python.exe" : "bin/python"); await mkdir(dirname(path), { recursive: true, mode: 0o700 }); await writeFile(path, "synthetic-python", { mode: 0o700 }); };
  let failCommand, corrupt = false, stopped = true;
  const command = async (exe, args, options = {}) => {
    commands.push({ exe, args });
    await options.onGuardianReady?.({ schema: "switchyard-runtime-command/v1", id: randomUUID(), event: "ready", guardianPid: process.pid, birth: "1234", containment: process.platform === "linux" ? "owned-linux-session" : "windows-job" });
    if (args[0] === "venv") await python(args.at(-1));
    if (failCommand?.(args)) throw Object.assign(new Error("Synthetic uncertain worker exit"), { code: "RUNTIME_STOP_UNCONFIRMED" });
    if (args[0] === "--version") return "uv synthetic";
    if (["venv", "pip"].includes(args[0])) return "";
    await readFile(exe);
    assert.deepEqual(args.slice(0, 2), ["-I", "-B"]);
    return JSON.stringify({ schema: "switchyard-runtime-probe/v1", python: "3.12.14", packages: { synthetic: "1.0" }, imports: ["av", "hid", "faster_whisper", "langchain_core"], extraDistributions: [], modelLoaded: args.length === 5, hidOpened: false, providerContacted: false });
  };
  const downloader = async (destination, model) => { downloads.push(destination); const version = model.revision[0]; return downloadRuntimeModel(destination, model, async url => new Response(`${basename(new URL(url).pathname)}:${corrupt ? "bad" : version}`)); };
  const manager = (spec = specification(), overrides = {}) => createRuntimeLifecycle({ root, spec, command, downloader, uvResolver: async () => "/synthetic/uv", guardianStopped: async () => stopped, ...overrides });
  try { await fn({ directory, root, commands, downloads, python, manager, downloader, corrupt: () => { corrupt = true; }, uncertain: predicate => { failCommand = predicate; stopped = false; }, verifyStopped: () => { stopped = true; failCommand = null; } }); }
  finally { await rm(directory, { recursive: true, force: true }); }
}
test("versioned runtime installs missing software once and checks/reuses the exact pinned environment", () => fixture(async ({ root, manager, commands, downloads }) => {
  const installed = await manager().install(); assert.deepEqual(installed.installedComponents, ["python", "model"]);
  const selected = await readRuntimeSelection(root), paths = await resolveRuntimePaths({ root, spec: specification() });
  assert.equal(paths.releaseId, selected.current); assert.ok(paths.python.includes("versions"));
  assert.equal((await manager().check()).modelLoaded, true);
  const reused = await manager().update(); assert.equal(reused.unchanged, true); assert.equal(downloads.length, 1); assert.equal(commands.filter(c => c.args[0] === "pip").length, 1);
}));
test("legacy runtime adoption reuses both components in place and preserves unrelated root content", () => fixture(async ({ root, manager, commands, downloads, python, downloader }) => {
  await mkdir(root, { mode: 0o700 }); await python(join(root, "venv")); await downloader(join(root, "base.en"), specification().model); await writeFile(join(root, "model-receipt.json"), "legacy receipt");
  const result = await manager().install(); assert.deepEqual(result.installedComponents, []); assert.deepEqual(result.reusedComponents, ["python", "model"]); assert.equal(downloads.length, 1); assert.ok(!commands.some(c => c.args[0] === "venv"));
  const paths = await resolveRuntimePaths({ root, spec: specification() }); assert.equal(paths.model, join(root, "base.en")); assert.equal(await readFile(join(root, "model-receipt.json"), "utf8"), "legacy receipt");
}));
test("legacy root adoption records a necessary Unix permission migration without changing existing content", () => fixture(async ({ root, manager, python, downloader }) => {
  await mkdir(root, { mode: 0o700 }); await python(join(root, "venv")); await downloader(join(root, "base.en"), specification().model); await writeFile(join(root, "user-note.txt"), "preserve this");
  if (process.platform !== "win32") await chmod(root, 0o755);
  const result = await manager().install(); assert.deepEqual(result.installedComponents, []); assert.equal(await readFile(join(root, "user-note.txt"), "utf8"), "preserve this");
  const receipts = (await readdir(join(root, ".maintenance"))).filter(name => name.startsWith("root-permissions-"));
  if (process.platform !== "win32") { assert.equal((await lstat(root)).mode & 0o777, 0o700); assert.equal(receipts.length, 1); const receipt = JSON.parse(await readFile(join(root, ".maintenance", receipts[0]))); assert.equal(receipt.before, 0o755); assert.equal(receipt.after, 0o700); }
  else assert.deepEqual(receipts, []);
}));
test("updates share an unchanged model, retain one previous environment and support matching application rollback", () => fixture(async ({ root, manager, downloads, commands }) => {
  const first = await manager().install(), second = await manager(specification(2)).update();
  assert.deepEqual(second.installedComponents, ["python"]); assert.equal(downloads.length, 1);
  const old = await resolveRuntimePaths({ root, spec: specification() }); assert.equal(old.releaseId, first.releaseId);
  await assert.rejects(manager(specification(2)).rollback(), /matching application/);
  assert.equal((await manager().rollback()).releaseId, first.releaseId);
  const restored = await manager(specification(2)).update(); assert.equal(restored.releaseId, second.releaseId); assert.deepEqual(restored.installedComponents, []);
  assert.equal(commands.filter(c => c.args[0] === "venv").length, 2);
}));
test("a third release prunes only obsolete generated software and keeps shared components", () => fixture(async ({ root, manager, downloads }) => {
  const first = await manager().install(), record = await readRuntimeRelease(root, first.releaseId), oldPython = join(root, record.components.python.location);
  await manager(specification(2)).update(); const third = await manager(specification(3)).update();
  assert.ok(third.removedComponents.includes(record.components.python.location)); await assert.rejects(readFile(join(oldPython, process.platform === "win32" ? "Scripts/python.exe" : "bin/python")), { code: "ENOENT" });
  assert.equal((await readdir(join(root, ".maintenance/releases"))).length, 2); assert.equal(downloads.length, 1);
}));
test("failed model verification removes only the unselected generated stage and leaves the working release selected", () => fixture(async ({ root, manager, corrupt }) => {
  await manager().install(); const before = await readRuntimeSelection(root); corrupt();
  await assert.rejects(manager(specification(2, 2)).update(), /pinned size|SHA-256/); assert.deepEqual(await readRuntimeSelection(root), before);
  assert.equal((await readdir(join(root, "versions"))).length, 1); assert.equal((await manager().check()).status, "verified");
}));
test("uncertain worker exit preserves the stage and prevents recovery until native exit is verified", () => fixture(async ({ root, manager, uncertain, verifyStopped }) => {
  await manager().install(); const before = await readRuntimeSelection(root); uncertain(args => args[0] === "venv");
  await assert.rejects(manager(specification(2)).update(), { code: "RUNTIME_STOP_UNCONFIRMED" });
  assert.ok(JSON.parse(await readFile(join(root, ".maintenance/pending.json"))).guardian); assert.equal((await readdir(join(root, "versions"))).length, 2);
  await assert.rejects(manager().recover(), /exit is unconfirmed/); assert.deepEqual(await readRuntimeSelection(root), before);
  verifyStopped(); assert.equal((await manager().recover()).outcome, "discarded-unselected-stage"); assert.equal((await readdir(join(root, "versions"))).length, 1);
}));
test("a crash after atomic selection preserves both releases and recovery finalizes the committed update", () => fixture(async ({ root, manager }) => {
  await manager().install();
  await assert.rejects(manager(specification(2), { afterSelection: () => { throw new Error("Synthetic crash after pointer"); } }).update(), /Synthetic crash/);
  const beforeRecovery = await readRuntimeSelection(root); assert.ok(beforeRecovery.previous);
  assert.equal((await manager(specification(2)).recover()).outcome, "committed"); assert.deepEqual(await readRuntimeSelection(root), beforeRecovery); assert.equal((await manager(specification(2)).check()).status, "verified");
}));
test("interrupted obsolete-file cleanup resumes from its durable inventory", () => fixture(async ({ root, manager }) => {
  await manager().install(); await manager(specification(2)).update(); let fail = true;
  await assert.rejects(manager(specification(3), { afterRemove: () => { if (fail) { fail = false; throw new Error("Synthetic cleanup interruption"); } } }).update(), /cleanup interruption/);
  assert.ok(await readFile(join(root, ".maintenance/cleanup.json"))); await manager(specification(3)).recover();
  await assert.rejects(readFile(join(root, ".maintenance/cleanup.json")), { code: "ENOENT" }); assert.equal((await readdir(join(root, ".maintenance/releases"))).length, 2); assert.equal((await manager(specification(3)).check()).status, "verified");
}));
test("changed obsolete software is preserved before any candidate cleanup begins", () => fixture(async ({ root, manager }) => {
  const first = await manager().install(), record = await readRuntimeRelease(root, first.releaseId);
  await manager(specification(2)).update(); const note = join(root, record.components.python.location, "user-note.txt"); await writeFile(note, "irreplaceable fixture note");
  await assert.rejects(manager(specification(3)).update(), /differs from its recorded inventory/); assert.equal(await readFile(note, "utf8"), "irreplaceable fixture note");
  assert.equal((await readdir(join(root, ".maintenance/releases"))).length, 3);
}));
test("optional runtime uninstall removes recorded software while preserving unrelated files and disabling legacy fallback", () => fixture(async ({ root, manager }) => {
  await manager().install(); await manager(specification(2)).update(); await writeFile(join(root, "user-note.txt"), "keep me");
  const result = await manager(specification(2)).uninstall(); assert.equal(result.status, "uninstalled"); assert.equal(result.protectedDataPreserved, true); assert.equal(await readFile(join(root, "user-note.txt"), "utf8"), "keep me");
  assert.deepEqual(await readdir(join(root, ".maintenance/releases")), []); await assert.rejects(resolveRuntimePaths({ root, spec: specification() }), /matching this application/);
}));
