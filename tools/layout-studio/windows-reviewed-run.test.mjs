import test from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdtemp, writeFile, readFile, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { NodeFileDigestReader } from "../../packages/control-plane/src/git-inspector.ts";
import { windowsReviewedRunSchema, parseWindowsReviewedRun, parseWindowsRunCatalog, loadWindowsReviewedRun } from "./windows-reviewed-run.mjs";

const sha = value => createHash("sha256").update(value).digest("hex"), runtime = "b".repeat(64);
function documents(change = recipe => recipe) {
  const program = Buffer.from("process.stdout.write('synthetic guest input')");
  const recipe = change({ id: "run_target", executable: "C:\\B122\\tools\\node.exe", executableSha256: runtime, arguments: ["{INPUT_ROOT}\\program.mjs"], workingRoot: "work", workingDirectory: ".", environment: {}, timeoutMs: 5000, maxOutputBytes: 4096, artifacts: [] });
  const catalog = Buffer.from(JSON.stringify({ schema: "sxsy-b122.windows-sandbox-catalog", version: 1, recipes: [recipe] }));
  const input = (path, bytes) => ({ path, sha256: sha(bytes), size: bytes.length, classification: "non-production" });
  const manifest = { schema: windowsReviewedRunSchema, version: 1, recipeId: "run_target", catalogPath: "guest.json", catalogSha256: sha(catalog), inputFiles: [input("program.mjs", program), input("guest.json", catalog)] };
  const bytes = Buffer.from(JSON.stringify(manifest));
  return { program, recipe, catalog, manifest, bytes, manifestSha256: sha(bytes) };
}
test("the Windows Run contract binds one selected script, exact catalog and trusted fixed Node runtime", () => {
  const d = documents(), manifest = parseWindowsReviewedRun(d.bytes, d.manifestSha256), recipe = parseWindowsRunCatalog(d.catalog, manifest, runtime);
  assert.deepEqual(recipe, d.recipe); assert.deepEqual(manifest, d.manifest);
  recipe.arguments[0] = "changed"; assert.equal(d.recipe.arguments[0], "{INPUT_ROOT}\\program.mjs");
  assert.throws(() => parseWindowsReviewedRun(d.bytes, "c".repeat(64)), /bytes changed/);
  assert.throws(() => parseWindowsRunCatalog(d.catalog, manifest, "c".repeat(64)), /pinned guest Node/);
});
test("host commands, runtime substitution, inline code and unsupported resource/recipe fields cannot enter a guest Run", () => {
  for (const change of [r => ({ ...r, executable: "C:\\Windows\\System32\\cmd.exe" }), r => ({ ...r, executableSha256: "f".repeat(64) }), r => ({ ...r, arguments: ["--eval", "unreviewed"] }), r => ({ ...r, arguments: ["{INPUT_ROOT}\\absent.mjs"] }), r => ({ ...r, timeoutMs: 540001 }), r => ({ ...r, maxOutputBytes: 524289 }), r => ({ ...r, workingDirectory: "not-created" }), r => ({ ...r, command: "injected" }), r => ({ ...r, id: "full_sandbox" })]) {
    const d = documents(change); assert.throws(() => parseWindowsRunCatalog(d.catalog, d.manifest, runtime));
  }
});
test("secret values, fixed environment overrides, unknown tokens and ambiguous artifact paths are refused", () => {
  for (const change of [r => ({ ...r, environment: { API_KEY: "synthetic" } }), r => ({ ...r, environment: { TEMP: "elsewhere" } }), r => ({ ...r, environment: { NODE_OPTIONS: "--require injected" } }), r => ({ ...r, environment: { Name: "one", NAME: "two" } }), r => ({ ...r, arguments: [...r.arguments, "token=synthetic-value"] }), r => ({ ...r, arguments: [...r.arguments, "{UNKNOWN_ROOT}\\data"] }), r => ({ ...r, artifacts: ["../outside"] }), r => ({ ...r, artifacts: ["report.txt", "REPORT.TXT"] })]) {
    const d = documents(change); assert.throws(() => parseWindowsRunCatalog(d.catalog, d.manifest, runtime));
  }
  const d = documents(r => ({ ...r, environment: { MODE: "synthetic", RESULT: "{WORK_ROOT}\\report.txt" }, artifacts: ["report.txt"] }));
  assert.deepEqual(parseWindowsRunCatalog(d.catalog, d.manifest, runtime), d.recipe);
});
test("the selected catalog and every exact input require bounded non-production metadata", () => {
  const d = documents();
  for (const value of [{ ...d.manifest, shell: true }, { ...d.manifest, catalogPath: "../guest.json" }, { ...d.manifest, inputFiles: d.manifest.inputFiles.slice(0, 1) }, { ...d.manifest, inputFiles: d.manifest.inputFiles.map(f => ({ ...f, classification: "production" })) }, { ...d.manifest, inputFiles: [...d.manifest.inputFiles, d.manifest.inputFiles[0]] }]) {
    const bytes = Buffer.from(JSON.stringify(value)); assert.throws(() => parseWindowsReviewedRun(bytes, sha(bytes)));
  }
  const duplicateCatalog = Buffer.from(JSON.stringify({ schema: "sxsy-b122.windows-sandbox-catalog", version: 1, recipes: [d.recipe, d.recipe] }));
  assert.throws(() => parseWindowsRunCatalog(duplicateCatalog, { ...d.manifest, catalogSha256: sha(duplicateCatalog) }, runtime), /one displayed/);
});
async function fixture(t) {
  const root = await mkdtemp(join(tmpdir(), "switchyard-windows-run-contract-")), d = documents();
  t.after(() => rm(root, { recursive: true, force: true }));
  for (const [path, bytes] of [["run.json", d.bytes], ["guest.json", d.catalog], ["program.mjs", d.program], ["unselected.env", "synthetic private bytes"]]) await writeFile(join(root, path), bytes);
  const allowedFiles = [{ path: "run.json", digest: `sha256:${d.manifestSha256}` }, ...d.manifest.inputFiles.map(f => ({ path: f.path, digest: `sha256:${f.sha256}` }))];
  const options = { repositoryRoot: root, manifestPath: "run.json", manifestSha256: d.manifestSha256, allowedFiles, recipeRuntimeSha256: runtime };
  return { ...d, root, options };
}
test("real reviewed file loading reads only the granted manifest/catalog/input set and clears temporary byte buffers", async t => {
  const f = await fixture(t), reader = new NodeFileDigestReader({ maxFileBytes: 4 * 1024 * 1024 }), reads = [], buffers = [];
  const result = await loadWindowsReviewedRun({ ...f.options, reader: { read: async (...args) => { reads.push(args[1]); const r = await reader.read(...args); buffers.push(r.bytes); return r; } } });
  assert.deepEqual(reads, ["run.json", "program.mjs", "guest.json"]); assert.ok(buffers.every(bytes => bytes.every(value => value === 0)));
  assert.equal(result.timeoutMs, 65000); assert.deepEqual(result.recipe, f.recipe);
  assert.equal(await readFile(join(f.root, "unselected.env"), "utf8"), "synthetic private bytes");
});
test("changed input bytes and absent task witnesses cannot use an otherwise valid manifest as authority", async t => {
  const f = await fixture(t);
  await assert.rejects(loadWindowsReviewedRun({ ...f.options, allowedFiles: f.options.allowedFiles.slice(1) }), /task-owned file grant/);
  await assert.rejects(loadWindowsReviewedRun({ ...f.options, allowedFiles: f.options.allowedFiles.slice(0, 2) }), /task-owned snapshot/);
  await assert.rejects(loadWindowsReviewedRun({ ...f.options, allowedFiles: [...f.options.allowedFiles, f.options.allowedFiles[0]] }), /duplicate file witnesses/);
  await writeFile(join(f.root, "program.mjs"), "changed after review");
  await assert.rejects(loadWindowsReviewedRun(f.options), /input changed/);
  assert.equal(await readFile(join(f.root, "program.mjs"), "utf8"), "changed after review");
});

test("invalid UTF-8 cannot produce a different host review from the native guest reader",()=>{
 const d=documents(),invalid=Buffer.concat([d.bytes.subarray(0,-1),Buffer.from([0xff]),d.bytes.subarray(-1)]);
 assert.throws(()=>parseWindowsReviewedRun(invalid,sha(invalid)));
});
