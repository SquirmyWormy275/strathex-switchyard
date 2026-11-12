import test from "node:test";
import assert from "node:assert/strict";
import { createHash, randomUUID } from "node:crypto";
import { mkdir, writeFile, readFile, readdir, lstat, rename, symlink, link } from "node:fs/promises";
import { join } from "node:path";
import { scannerDraftFixture, draftInput } from "./test-support/scanner-draft-fixture.mjs";
import { createWindowsScannerRecipeFiles, validateWindowsScannerDraft } from "./windows-scanner-recipe-files.mjs";
import { createScannerRecipeSave } from "./scanner-recipe-save.mjs";

const sha = value => createHash("sha256").update(value).digest("hex");
const identity = async path => { const s = await lstat(path, { bigint: true }); return { device: String(s.dev), inode: String(s.ino) }; };
import { windowsScannerSaveFixture as fixture } from "./test-support/windows-scanner-save-fixture.mjs";

const save = (f, review) => f.saver.apply("personal", { id: review.draft.id, token: review.confirmation.token });

test("Windows save composition binds every helper and file before fresh authority; repeated apply does not spawn again", async t => {
  const f = await fixture(t), before = await readFile(join(f.root, ".git/index")), head = await f.run("rev-parse", "HEAD"), review = await f.prepare();
  assert.deepEqual(f.commands, []); assert.equal((await save(f, review)).status, "saved");
  assert.deepEqual(f.commands, ["create-directory", ...Array(5).fill("write-file"), "inspect-files"]); assert.equal(f.effects.length, 6);
  for (const file of review.draft.files) assert.equal(await readFile(join(f.root, file.path), "utf8"), file.content);
  const count = f.commands.length; assert.equal((await save(f, review)).status, "saved"); assert.equal(f.commands.length, count);
  const state = await f.store.snapshot("personal"), owner = state.scannerRecipeNativeOwners[0]; assert.equal(owner.stoppedVerified, true); assert.equal(owner.status, "stopped"); assert.equal(JSON.stringify(owner).includes("contentBase64"), false); assert.equal(JSON.stringify(owner).includes("token"), false);
  assert.equal((await f.service.list("personal")).length, 0); assert.deepEqual(await readFile(join(f.root, ".git/index")), before); assert.equal(await f.run("rev-parse", "HEAD"), head);
  assert.equal((await f.service.review("personal", review.draft.authorityProposal)).status, "requires-confirmation");
});

for (const kind of ["request", "root", "directory", "extra-field", "file-hash", "file-identity", "authority"]) test(`Windows save refuses a ${kind} proof substitution without replay`, async t => {
  const f = await fixture(t, { transform: proof => {
    if (kind === "request") proof.requestSha256 = "a".repeat(64);
    if (kind === "root") proof.rootIdentity = { device: "0", inode: "0" };
    if (kind === "directory" && proof.operation === "write-file") proof.directoryIdentity = { device: "0", inode: "0" };
    if (kind === "extra-field") proof.approved = true;
    if (kind === "file-hash" && proof.files.length) proof.files.at(-1).sha256 = "a".repeat(64);
    if (kind === "file-identity" && proof.files.length) proof.files.at(-1).identity = { device: "0", inode: "not-an-inode" };
    if (kind === "authority") proof.authorityGranted = true;
    return proof;
  } });
  const review = await f.prepare(); assert.equal((await save(f, review)).status, "outcome-unconfirmed"); const count = f.commands.length;
  assert.equal((await save(f, review)).status, "outcome-unconfirmed"); assert.equal(f.commands.length, count); assert.ok(f.effects.length <= 2); assert.equal((await f.service.list("personal")).length, 0);
});

test("Windows save recovers a known complete lost acknowledgement through inspection without recreating files", async t => {
  const f = await fixture(t, { writer: async (filesystem, ...args) => { await filesystem.write(...args); throw Error("Synthetic host acknowledgement loss"); } }), review = await f.prepare();
  assert.equal((await save(f, review)).status, "outcome-unconfirmed"); const effects = [...f.effects], before = await Promise.all(review.draft.files.map(file => identity(join(f.root, file.path))));
  assert.deepEqual(await f.saver.recover("personal"), { stopped: true, replayed: false }); assert.equal((await f.saver.list("personal"))[0].status, "saved"); assert.deepEqual(f.effects, effects); assert.equal(f.commands.at(-1), "inspect-files");
  assert.deepEqual(await Promise.all(review.draft.files.map(file => identity(join(f.root, file.path)))), before);
});

test("unconfirmed Windows helper exit blocks replacement and recovery until its exact owner retires", async t => {
  const f = await fixture(t, { uncertain: true }), review = await f.prepare(); assert.equal((await save(f, review)).status, "outcome-unconfirmed"); assert.equal(f.commands.length, 1);
  assert.equal((await f.saver.recover("personal")).stopped, false); assert.equal((await f.saver.stopCompartment("personal")).stopped, false); assert.equal(f.commands.length, 1);
  for (const id of f.owners.keys()) f.owners.set(id, true);
  assert.equal((await f.saver.stopCompartment("personal")).stopped, true); assert.equal((await f.saver.list("personal"))[0].status, "outcome-unconfirmed"); assert.deepEqual(f.effects, []);
});

test("Windows preflight refuses oversized, missing, aliased or changed controls before native effects", async () => {
  const id = randomUUID(), directory = "switchyard-scan-" + id, content = "synthetic", draft = { id, directory, repositoryRoot: "C:\\synthetic", files: ["engine.mjs", "scanner.json", "request.json", "recipe.json"].map(name => ({ path: directory + "/" + name, content, size: Buffer.byteLength(content), sha256: sha(content) })) };
  validateWindowsScannerDraft(draft);
  for (const change of [d => { d.files[0].size = 320 * 1024 + 1; }, d => { d.files.pop(); }, d => { d.files[0].path = directory + "/../engine.mjs"; }, d => { d.files[0].path = directory + "/ENGINE.MJS"; }, d => { d.files[0].content = "changed"; }, d => { d.files[0].sha256 = "bad"; }]) { const altered = structuredClone(draft); change(altered); assert.throws(() => validateWindowsScannerDraft(altered)); }
});

test("native Windows helper saves and verifies exact controls without touching original source or index", { skip: process.platform !== "win32" }, async t => {
  const f = await scannerDraftFixture(t, { platform: "win32" }), saver = createScannerRecipeSave({ store: f.store, authority: f.service, now: f.now }); f.onCleanup(() => saver.close());
  const before = await readFile(join(f.root, ".git/index")), source = await readFile(join(f.root, "task.txt")), head = await f.run("rev-parse", "HEAD");
  const review = await saver.review("personal", draftInput(f)), result = await saver.apply("personal", { id: review.draft.id, token: review.confirmation.token });
  assert.equal(result.status, "saved", JSON.stringify(result));
  assert.equal(review.draft.files.length, 6); assert.ok(review.draft.files.some(file => file.path.endsWith("/catalog.json")));
  for (const file of review.draft.files) assert.equal(await readFile(join(f.root, file.path), "utf8"), file.content);
  assert.equal((await f.store.snapshot("personal")).scannerRecipeNativeOwners.every(row => row.stoppedVerified === true && row.ownedRuntime?.containment === "windows-job"), true);
  assert.deepEqual(await readFile(join(f.root, ".git/index")), before); assert.deepEqual(await readFile(join(f.root, "task.txt")), source); assert.equal(await f.run("rev-parse", "HEAD"), head);
});

for (const change of ["existing-directory", "junction", "hardlink"]) test(`native Windows helper refuses ${change} substitution and preserves unrelated output`, { skip: process.platform !== "win32" }, async t => {
  const f = await scannerDraftFixture(t, { platform: "win32" }), filesystem = createWindowsScannerRecipeFiles({ store: f.store }), outside = join(f.stage, "outside"); await mkdir(outside);
  const saver = createScannerRecipeSave({ store: f.store, authority: f.service, filesystem, now: f.now, writer: async (draft, root, record, authorize, context) => {
    const directory = join(f.root, draft.directory);
    if (change === "existing-directory") { await mkdir(directory); await writeFile(join(directory, "keep.txt"), "preserve"); }
    return filesystem.write(draft, root, async event => {
      await record(event);
      if (change === "junction" && event.kind === "directory-created") { await rename(directory, directory + "-moved"); await symlink(outside, directory, "junction"); }
      if (change === "hardlink" && event.kind === "file-verified") await link(join(f.root, event.path), join(outside, "linked-control"));
    }, authorize, context);
  } }); f.onCleanup(() => saver.close());
  const review = await saver.review("personal", draftInput(f)), result = await saver.apply("personal", { id: review.draft.id, token: review.confirmation.token });
  assert.equal(result.status, "outcome-unconfirmed", JSON.stringify(result));
  const directory = join(f.root, review.draft.directory);
  if (change === "existing-directory") { assert.deepEqual(await readdir(directory), ["keep.txt"]); assert.equal(await readFile(join(directory, "keep.txt"), "utf8"), "preserve"); }
  if (change === "junction") { assert.deepEqual(await readdir(outside), []); assert.deepEqual(await readdir(directory + "-moved"), []); }
  if (change === "hardlink") { assert.deepEqual(await readdir(directory), ["engine.mjs"]); assert.equal((await lstat(join(directory, "engine.mjs"))).nlink, 2); }
  assert.equal((await f.store.snapshot("personal")).scannerRecipeNativeOwners.every(row => row.stoppedVerified), true);
});
