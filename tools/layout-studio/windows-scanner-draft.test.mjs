import test from "node:test";
import assert from "node:assert/strict";
import { readFile, readdir } from "node:fs/promises";
import { join } from "node:path";
import { scannerDraftFixture, draftInput } from "./test-support/scanner-draft-fixture.mjs";
import { parseWindowsReviewedRun, parseWindowsRunCatalog } from "./windows-reviewed-run.mjs";
import { validateWindowsScannerDraft } from "./windows-scanner-recipe-files.mjs";
import { windowsShieldActions } from "./repository-execution-actions.mjs";

const runtime = () => ({ nodeVersion: "24.14.0", identity: { canonicalPath: "C:\\synthetic\\node.exe", sha256: "b".repeat(64), device: "1", inode: "2", size: 123, modifiedMs: 456 } });

test("Windows draft generation supplies the exact native catalog for every Shield action without writing or granting authority", async t => {
  let reads = 0;
  const f = await scannerDraftFixture(t, { platform: "win32", readWindowsScannerRuntime: async () => { reads++; return runtime(); } });
  const before = { names: await readdir(f.root), index: await readFile(join(f.root, ".git/index")), head: await f.run("rev-parse", "HEAD") };
  for (const action of windowsShieldActions) {
    const selection = { ...draftInput(f), action }; if (action === "shield_change_scan") delete selection.advisoryFixtureId;
    const draft = await f.service.prepareScannerDraft("personal", selection), byName = name => draft.files.find(file => file.path === `${draft.directory}/${name}`);
    assert.equal(draft.files.length, selection.advisoryFixtureId ? 6 : 5);
    validateWindowsScannerDraft(draft);
    const manifest = parseWindowsReviewedRun(Buffer.from(byName("recipe.json").content), draft.manifestSha256, action);
    const recipe = parseWindowsRunCatalog(Buffer.from(byName("catalog.json").content), manifest, runtime().identity.sha256);
    assert.deepEqual(recipe, draft.recipe);
    assert.equal(recipe.executable, "C:\\B122\\tools\\node.exe");
    assert.deepEqual(recipe.arguments, [`{INPUT_ROOT}\\${draft.directory}\\engine.mjs`, `${draft.directory}/request.json`]);
    assert.equal(recipe.workingRoot, "input"); assert.equal(recipe.workingDirectory, ".");
    assert.deepEqual(recipe.environment, { NODE_ENV: "test" }); assert.deepEqual(recipe.artifacts, []);
    assert.equal(recipe.timeoutMs, 10000); assert.equal(recipe.maxOutputBytes, 524288);
    assert.ok(manifest.inputFiles.some(file => file.path === byName("catalog.json").path && file.sha256 === byName("catalog.json").sha256));
    assert.ok(draft.authorityProposal.paths.includes(byName("catalog.json").path));
    assert.ok(draft.authorityProposal.classifications.includedUntracked.includes(byName("catalog.json").path));
    assert.equal(JSON.stringify(manifest).includes(process.execPath), false);
    assert.equal(JSON.stringify(draft).includes(runtime().identity.canonicalPath), false);
    for (const field of ["filesWritten", "authorityGranted", "scanPerformed", "sourceBytesReturned"]) assert.equal(draft[field], false);
    assert.throws(() => parseWindowsRunCatalog(Buffer.from(byName("catalog.json").content), manifest, "c".repeat(64)), /pinned guest Node/);
  }
  assert.equal(reads, windowsShieldActions.length * 2);
  assert.deepEqual(await readdir(f.root), before.names); assert.deepEqual(await readFile(join(f.root, ".git/index")), before.index); assert.equal(await f.run("rev-parse", "HEAD"), before.head);
  assert.deepEqual(await f.service.list("personal"), []);
});

test("Windows draft refuses runtime drift, an unsupported version or invalid identity before a save review", async t => {
  let calls = 0, mode = "drift";
  const f = await scannerDraftFixture(t, { platform: "win32", readWindowsScannerRuntime: async () => {
    const value = runtime(); calls++;
    if (mode === "drift" && calls % 2 === 0) value.identity.inode = "3";
    if (mode === "version") value.nodeVersion = "24.14.1";
    if (mode === "hash") value.identity.sha256 = "unverified";
    if (mode === "path") value.identity.canonicalPath = "/tmp/node";
    return value;
  } });
  const before = await readdir(f.root);
  for (mode of ["drift", "version", "hash", "path"]) await assert.rejects(f.service.prepareScannerDraft("personal", draftInput(f)), /runtime|Node|identity/i);
  assert.deepEqual(await readdir(f.root), before); assert.deepEqual(await f.service.list("personal"), []);
  assert.equal((await f.store.snapshot("personal")).scannerRecipeSaves?.length ?? 0, 0);
});

test("a platform without a scanner executor cannot silently generate a portable recipe", async t => {
  const f = await scannerDraftFixture(t, { platform: "darwin" });
  await assert.rejects(f.service.prepareScannerDraft("personal", draftInput(f)), /platform|Linux or Windows/);
  assert.deepEqual(await f.service.list("personal"), []);
});
