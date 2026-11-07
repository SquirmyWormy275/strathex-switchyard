import test from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { mkdtemp, mkdir, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fixedGitExecutable } from "./repository-inspection.mjs";
import { gitIndexLimits, gitIndexPaths, selectGitIndexEntries, gitIndexBatchInput, gitIndexTreeFromEntries, witnessGitIndexBatch, gitIndexWitnessReport } from "./git-index-inputs.mjs";
const sha = bytes => createHash("sha256").update(bytes).digest("hex");
function blob(path, text, algorithm = "sha1", mode = "100644") {
  const bytes = Buffer.from(text), objectId = createHash(algorithm).update(`blob ${bytes.length}\0`).update(bytes).digest("hex");
  return { entry: { path, mode, objectId }, listing: `${mode} ${objectId} 0\t${path}\0`, output: `${objectId} blob ${bytes.length}\n${text}\n`, bytes };
}
test("index witnesses preserve exact UTF-8, NUL, empty and executable blob bytes for SHA-1 and SHA-256 repositories", async () => {
  for (const algorithm of ["sha1", "sha256"]) {
    const a = blob("app.mjs", "line one\n☃\0tail", algorithm, "100755"), b = blob("empty.txt", "", algorithm);
    const entries = selectGitIndexEntries(a.listing + b.listing, ["empty.txt", "app.mjs"], a.entry.objectId.length);
    assert.deepEqual(entries, [a.entry, b.entry]); assert.equal(gitIndexBatchInput(entries), a.entry.objectId + "\n" + b.entry.objectId + "\n");
    const borrowed = [], rows = await witnessGitIndexBatch(a.output + b.output, entries, (row, bytes) => { borrowed.push(bytes); assert.equal(sha(bytes), row.sha256); });
    assert.deepEqual(rows, [{ ...a.entry, size: a.bytes.length, sha256: sha(a.bytes) }, { ...b.entry, size: 0, sha256: sha(b.bytes) }]);
    assert.ok(borrowed.every(b => b.every(n => n === 0)));
    const report = gitIndexWitnessReport({ head: "a".repeat(a.entry.objectId.length), listing: a.listing + b.listing, rows, observedAt: "2026-11-05T00:00:00.000Z" });
    assert.equal(report.sourceBytesWitnessed, true); assert.equal(report.sourceBytesReturned, false); assert.equal(report.scanPerformed, false); assert.equal(report.authorityGranted, false); assert.equal(report.gateEligible, false); assert.equal(report.completeness, "incomplete"); assert.ok(!JSON.stringify(report).includes("line one")); assert.equal(report.indexMetadataSha256, sha(a.listing + b.listing));
  }
});
test("index selections and listings reject malformed, unmerged, colliding, linked, missing and unbounded inputs", () => {
  const a = blob("app.mjs", "safe"), id = a.entry.objectId;
  for (const paths of [[], ["../foreign"], [".git/config"], ["NUL.txt"], ["dir\\file"], ["line\nfile"], ["a:b"], ["a//b"], ["trailing."], ["a", "A"], Array.from({ length: 65 }, (_, i) => "p" + i)]) assert.throws(() => gitIndexPaths(paths));
  for (const output of ["", a.listing.slice(0, -1), a.listing + a.listing, a.listing + a.listing.replace("app.mjs", "APP.mjs"), `100644 ${id} 1\tapp.mjs\0`, `040000 ${id} 0\tapp.mjs\0`, `100644 ${"0".repeat(40)} 0\tapp.mjs\0`, `100644 ${id} 0\t../app.mjs\0`, a.listing.repeat(4097), `120000 ${id} 0\tapp.mjs\0`, `160000 ${id} 0\tapp.mjs\0`]) assert.throws(() => selectGitIndexEntries(output, ["app.mjs"], 40));
  assert.throws(() => selectGitIndexEntries(a.listing, ["missing"], 40)); assert.throws(() => selectGitIndexEntries(a.listing, ["app.mjs"], 64)); assert.throws(() => gitIndexBatchInput([{ objectId: "HEAD:foreign" }]));
});
test("index blob witness refuses altered hashes, wrong types, truncation, extra objects and declared or combined size overflows", async () => {
  const a = blob("app.mjs", "safe"), b = blob("other.txt", "safe"), large = blob("large.txt", "x".repeat(gitIndexLimits.fileBytes));
  for (const output of [a.output.replace("safe", "evil"), a.output.replace(" blob ", " tree "), a.output.slice(0, -1), a.output + "extra", a.output.replace(" blob 4", " blob 04"), a.output.replace(a.entry.objectId, "a".repeat(40)), `${a.entry.objectId} blob 999999999999999999999999\n\n`, `${a.entry.objectId} missing\n`]) await assert.rejects(witnessGitIndexBatch(output, [a.entry]));
  await assert.rejects(witnessGitIndexBatch(a.output + b.output, [a.entry]));
  const tooLarge = blob("large.txt", "x".repeat(gitIndexLimits.fileBytes + 1)); await assert.rejects(witnessGitIndexBatch(tooLarge.output, [tooLarge.entry]));
  await assert.rejects(witnessGitIndexBatch(large.output + large.output, [large.entry, large.entry]));
  const remainder = blob("remainder.txt", "x".repeat(gitIndexLimits.totalBytes - large.bytes.length + 1)); await assert.rejects(witnessGitIndexBatch(large.output + remainder.output, [large.entry, remainder.entry]));
});
test("private borrowed index bytes are zeroed when a consumer fails", async () => {
  const a = blob("app.mjs", "SYNTHETIC_PRIVATE_SOURCE"); let held;
  await assert.rejects(witnessGitIndexBatch(a.output, [a.entry], (_row, bytes) => { held = bytes; throw Error("synthetic consumer failure"); }), /consumer failure/);
  assert.ok(held.every(n => n === 0));
});
test("complete index trees match real Git SHA-1 and SHA-256 object framing and directory byte order", async t => {
  const root = await mkdtemp(join(tmpdir(), "switchyard-index-tree-")); t.after(() => rm(root, { recursive: true, force: true }));
  const git = await fixedGitExecutable(), execute = promisify(execFile);
  for (const format of ["sha1", "sha256"]) {
    const cwd = join(root, format); await mkdir(cwd);
    const run = async (...args) => (await execute(git, args, { cwd, timeout: 10000, env: { ...process.env, GIT_CONFIG_NOSYSTEM: "1", GIT_CONFIG_GLOBAL: process.platform === "win32" ? "NUL" : "/dev/null", GIT_TERMINAL_PROMPT: "0" } })).stdout;
    await run("init", "--object-format=" + format);
    const paths = ["foo.bar", "foo/child", "foo0", "foo/sub/empty", "Zebra", "ábacus", "é/child", "Ω", "executable"];
    for (const path of paths) { await mkdir(dirname(join(cwd, path)), { recursive: true }); await writeFile(join(cwd, path), path.endsWith("empty") ? "" : "exact " + path + "\n"); }
    await run("add", "--all"); await run("update-index", "--chmod=+x", "executable");
    const entries = selectGitIndexEntries(await run("ls-files", "--stage", "-z"), paths, format === "sha1" ? 40 : 64), expected = (await run("write-tree")).trim();
    assert.equal(gitIndexTreeFromEntries(entries), expected); assert.equal(gitIndexTreeFromEntries([...entries].reverse()), expected);
    assert.equal(entries.find(row => row.path === "executable").mode, "100755");
  }
});
test("complete index trees refuse file-directory collisions, directory aliases and malformed identities", () => {
  const entry = path => ({ path, mode: "100644", objectId: "a".repeat(40) });
  for (const paths of [["a", "a/b"], ["a/b", "a"], ["A/one", "a/two"], ["a/one", "a/ONE"], ["bad\ud800"]]) assert.throws(() => gitIndexTreeFromEntries(paths.map(entry)));
  for (const entries of [[], Array.from({ length: 65 }, (_, i) => entry("f" + i)), [{ ...entry("a"), mode: "120000" }], [{ ...entry("a"), extra: true }], [{ ...entry("a"), objectId: "0".repeat(40) }], [entry("a"), { ...entry("b"), objectId: "b".repeat(64) }]]) assert.throws(() => gitIndexTreeFromEntries(entries));
});
