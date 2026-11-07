import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { readFile, writeFile, readdir, mkdir, rename, symlink, link, stat } from "node:fs/promises";
import { join } from "node:path";
import { scannerDraftFixture, draftInput } from "./test-support/scanner-draft-fixture.mjs";
import { createScannerRecipeSave } from "./scanner-recipe-save.mjs";
import { writeScannerRecipeFiles } from "./scanner-recipe-files.mjs";
import { createSuite } from "./suite.mjs";
import { createStudioServer } from "./serve.mjs";

const linux = (name, fn) => test(name, { skip: process.platform !== "linux" }, fn);
async function fixture(t, options = {}) {
  const f = await scannerDraftFixture(t), saver = createScannerRecipeSave({ store: f.store, authority: f.service, now: f.now, ...options });
  f.onCleanup(() => saver.close()); return { ...f, saver, prepare: () => saver.review("personal", draftInput(f)) };
}
const apply = (f, r) => f.saver.apply("personal", { id: r.draft.id, token: r.confirmation.token });

linux("authenticated save review writes nothing; exact save is durable and repeat calls never replay", async t => {
  const f = await fixture(t), secret = "PRIVATE_SOURCE_MUST_NOT_ENTER_SAVED_DRAFT"; await writeFile(join(f.root, "task.txt"), secret);
  const suite = createSuite({ store: f.store, taskAuthority: f.service, fixtureAdministration: f.feeds, scannerRecipeSave: f.saver, agents: { close: async () => {} }, coding: { close: async () => {} } }); f.onCleanup(() => suite.close());
  const token = "S".repeat(43), server = createStudioServer({ suite, token, discover: async () => ({}) }); await new Promise(resolve => server.listen(0, "127.0.0.1", resolve)); f.onCleanup(() => new Promise(resolve => { server.closeAllConnections(); server.close(resolve); }));
  const origin = `http://127.0.0.1:${server.address().port}`, call = (route, body, authenticated = true) => fetch(origin + "/api/suite/coding/scanner-save/" + route, { method: "POST", headers: { "Content-Type": "application/json", Origin: origin, ...(authenticated ? { Authorization: `Bearer ${token}` } : {}) }, body: JSON.stringify(body) });
  const before = { names: await readdir(f.root), index: await readFile(join(f.root, ".git/index")), head: await f.run("rev-parse", "HEAD") };
  assert.equal((await call("review", draftInput(f), false)).status, 401);
  const response = await call("review", draftInput(f)), r = await response.json(); assert.equal(response.status, 200, JSON.stringify(r));
  assert.equal(r.status, "requires-confirmation"); assert.equal(r.confirmation.record.action, "save_scanner_recipe"); assert.equal(JSON.stringify(r).includes(secret), false); assert.deepEqual(await readdir(f.root), before.names);
  const request = { id: r.draft.id, token: r.confirmation.token }; assert.equal((await call("apply", request, false)).status, 401);
  const result = await (await call("apply", request)).json(); assert.equal(result.status, "saved", JSON.stringify(result)); assert.equal(result.authorityGranted, false); assert.equal(result.scanPerformed, false);
  for (const file of r.draft.files) assert.equal(await readFile(join(f.root, file.path), "utf8"), file.content);
  const times = await Promise.all(r.draft.files.map(file => stat(join(f.root, file.path), { bigint: true }).then(s => [s.ino, s.mtimeNs, s.ctimeNs])));
  assert.deepEqual(await (await call("apply", request)).json(), result);
  assert.deepEqual(await Promise.all(r.draft.files.map(file => stat(join(f.root, file.path), { bigint: true }).then(s => [s.ino, s.mtimeNs, s.ctimeNs]))), times);
  const rows = await (await call("list", {})).json(); assert.equal(rows.length, 1); assert.equal(rows[0].status, "saved"); assert.ok(rows[0].draft.files.every(file => !Object.hasOwn(file, "content")));
  const state = await f.store.snapshot("personal"); assert.equal(state.scannerRecipeSaves.length, 1); assert.equal(JSON.stringify(state.scannerRecipeSaves).includes(secret), false); assert.equal(JSON.stringify(state.scannerRecipeSaves).includes("export async function"), false);
  assert.deepEqual(await readFile(join(f.root, ".git/index")), before.index); assert.equal(await f.run("rev-parse", "HEAD"), before.head); assert.equal((await f.service.list("personal")).length, 0);
});

test("Windows save is explicitly unavailable before native inspection or filesystem effects", async () => {
  let calls = 0; const saver = createScannerRecipeSave({ platform: "win32", store: { snapshot: async () => { calls++; } }, authority: { prepareScannerDraft: async () => { calls++; } } });
  await assert.rejects(saver.review("personal", {}), /only on Linux/); assert.equal(calls, 0); await saver.close();
});

linux("save rejects caller path, content, command and approval overrides", async t => {
  const f = await fixture(t), r = await f.prepare();
  for (const extra of [{ content: "changed" }, { files: [] }, { directory: "elsewhere" }, { executable: "sh" }, { approved: true }, { compartment: "work" }, { token: "not-issued" }]) await assert.rejects(f.saver.apply("personal", { id: r.draft.id, token: r.confirmation.token, ...extra }));
  for (const extra of [{ id: randomUUID() }, { directory: "elsewhere" }, { files: [] }]) await assert.rejects(f.saver.review("personal", { ...draftInput(f), ...extra }));
  assert.equal((await f.saver.list("personal"))[0].status, "reviewed"); assert.ok(!(await readdir(f.root)).includes(r.draft.directory));
});

linux("save confirmations cannot cross draft identities or authorize a task grant", async t => {
  const f = await fixture(t), a = await f.prepare(), b = await f.prepare();
  await assert.rejects(f.saver.apply("personal", { id: b.draft.id, token: a.confirmation.token }), /does not match/);
  await assert.rejects(f.service.issue("personal", { ...a.draft.authorityProposal, token: a.confirmation.token }));
  assert.equal((await apply(f, a)).status, "saved");
});

for (const change of ["worktree", "index", "account", "mode", "feed-revocation", "expiry"]) linux(`save refuses ${change} drift without repository effects`, async t => {
  const f = await fixture(t), r = await f.prepare();
  if (change === "worktree") await writeFile(join(f.root, "task.txt"), "changed");
  if (change === "index") await f.run("add", "task.txt");
  if (change === "account") await f.store.update("personal", "synthetic-change", s => { s.accounts.push("changed"); });
  if (change === "mode") await f.store.update("personal", "synthetic-change", s => { s.mode = "keyboard-only"; });
  if (change === "feed-revocation") await f.perform("revoke-fixture", { fixtureId: "synthetic-scanner", reason: "Synthetic save revocation" });
  if (change === "expiry") f.advance(300001);
  await assert.rejects(apply(f, r)); assert.ok(!(await readdir(f.root)).includes(r.draft.directory));
  const s = await f.store.snapshot("personal"); assert.equal(s.scannerRecipeSaves[0].status, "reviewed"); assert.equal(s.confirmationJournal.some(e => e.kind === "confirmation.consumed" && e.payload.confirmationId === r.confirmation.record.id), false);
});

linux("save never adopts an existing directory even when it appears after revalidation", async t => {
  const f = await fixture(t, { writer: async (draft, ...args) => { await mkdir(join(draft.repositoryRoot, draft.directory)); await writeFile(join(draft.repositoryRoot, draft.directory, "keep.txt"), "preserve"); return writeScannerRecipeFiles(draft, ...args); } });
  const r = await f.prepare(), result = await apply(f, r); assert.equal(result.status, "outcome-unconfirmed");
  assert.deepEqual(await readdir(join(f.root, r.draft.directory)), ["keep.txt"]); assert.equal(await readFile(join(f.root, r.draft.directory, "keep.txt"), "utf8"), "preserve");
  await f.saver.recover("personal"); assert.equal((await f.saver.list("personal"))[0].status, "outcome-unconfirmed");
});

for (const boundary of ["directory-created", "file-created", "file-verified", "all-files"]) linux(`interrupted save at ${boundary} is preserved and recovery never writes or replays`, async t => {
  let writes = 0;
  const f = await fixture(t, { writer: async (draft, root, record, authorize) => {
    writes++; await writeScannerRecipeFiles(draft, root, async event => { await record(event); if (event.kind === boundary) throw Error("Synthetic interruption after durable progress"); }, authorize);
    if (boundary === "all-files") throw Error("Synthetic lost final acknowledgement");
  } });
  const r = await f.prepare(); assert.equal((await apply(f, r)).status, "outcome-unconfirmed");
  const names = await readdir(join(f.root, r.draft.directory)), times = await Promise.all(names.map(name => stat(join(f.root, r.draft.directory, name), { bigint: true }).then(s => [s.ino, s.size, s.mtimeNs, s.ctimeNs])));
  const restarted = createScannerRecipeSave({ store: f.store, authority: { assertScannerDraftBinding: async () => { throw Error("Recovery must not query native accounts"); } }, now: f.now, writer: async () => { throw Error("Recovery must not replay writes"); } }); f.onCleanup(() => restarted.close());
  assert.deepEqual(await restarted.recover("personal"), { stopped: true, replayed: false });
  const row = (await restarted.list("personal"))[0]; assert.equal(row.status, boundary === "all-files" ? "saved" : "outcome-unconfirmed");
  assert.equal((await apply(f, r)).status, row.status); assert.equal(writes, 1); assert.deepEqual(await readdir(join(f.root, r.draft.directory)), names);
  assert.deepEqual(await Promise.all(names.map(name => stat(join(f.root, r.draft.directory, name), { bigint: true }).then(s => [s.ino, s.size, s.mtimeNs, s.ctimeNs]))), times);
});

for (const change of ["content", "hardlink", "extra-file", "directory-link"]) linux(`recovery refuses ${change} substitution after a lost save acknowledgement`, async t => {
  const f = await fixture(t, { writer: async (...args) => { await writeScannerRecipeFiles(...args); throw Error("Synthetic lost acknowledgement"); } });
  const r = await f.prepare(); await apply(f, r); const root = join(f.root, r.draft.directory), path = join(f.root, r.draft.files[0].path);
  if (change === "content") await writeFile(path, "changed");
  if (change === "hardlink") await link(path, join(f.stage, "linked-control"));
  if (change === "extra-file") await writeFile(join(root, "keep.txt"), "preserve");
  if (change === "directory-link") { await rename(root, root + "-moved"); await symlink(root + "-moved", root); }
  await f.saver.recover("personal"); assert.equal((await f.saver.list("personal"))[0].status, "outcome-unconfirmed");
  if (change === "content") assert.equal(await readFile(path, "utf8"), "changed");
  if (change === "extra-file") assert.equal(await readFile(join(root, "keep.txt"), "utf8"), "preserve");
});

linux("directory substitution during save cannot redirect control writes", async t => {
  let outside;
  const f = await fixture(t, { writer: async (draft, root, record, authorize) => writeScannerRecipeFiles(draft, root, async event => {
    await record(event); if (event.kind === "directory-created") { const path = join(draft.repositoryRoot, draft.directory); await rename(path, path + "-moved"); await symlink(outside, path); }
  }, authorize) });
  outside = join(f.stage, "outside"); await mkdir(outside); const r = await f.prepare(); assert.equal((await apply(f, r)).status, "outcome-unconfirmed"); assert.deepEqual(await readdir(outside), []); assert.deepEqual(await readdir(join(f.root, r.draft.directory + "-moved")), []);
});

linux("recovery cannot overtake an active owner's kernel lease; shutdown fences the remaining writes", async t => {
  let entered, release; const ready = new Promise(resolve => { entered = resolve; }), waiting = new Promise(resolve => { release = resolve; });
  const f = await fixture(t, { writer: async (draft, root, record, authorize) => writeScannerRecipeFiles(draft, root, async event => { await record(event); if (event.kind === "directory-created") { entered(); await waiting; } }, authorize) });
  const r = await f.prepare(), running = apply(f, r); await ready;
  const second = createScannerRecipeSave({ store: f.store, authority: f.service, now: f.now }); f.onCleanup(() => second.close());
  assert.equal((await second.recover("personal")).stopped, false);
  const stopping = f.saver.stopCompartment("personal"); release(); assert.equal((await running).status, "outcome-unconfirmed"); assert.equal((await stopping).stopped, true); assert.deepEqual(await readdir(join(f.root, r.draft.directory)), []);
});

for (const change of ["mode", "feed-revocation"]) linux(`a ${change} change during saving fences writes and still records the uncertain outcome`, async t => {
  const f = await scannerDraftFixture(t);
  const saver = createScannerRecipeSave({ store: f.store, authority: f.service, now: f.now, writer: async (draft, root, record, authorize) => writeScannerRecipeFiles(draft, root, async event => {
    await record(event);
    if (event.kind === "file-verified") {
      if (change === "mode") await f.store.update("personal", "synthetic-mode-change", s => { s.mode = "keyboard-only"; });
      else await f.perform("revoke-fixture", { fixtureId: "synthetic-scanner", reason: "Synthetic revocation during save" });
    }
  }, authorize) }); f.onCleanup(() => saver.close());
  const r = await saver.review("personal", draftInput(f)), result = await saver.apply("personal", { id: r.draft.id, token: r.confirmation.token });
  assert.equal(result.status, "outcome-unconfirmed"); assert.equal((await f.store.snapshot("personal")).scannerRecipeSaves[0].status, "outcome-unconfirmed"); assert.equal((await readdir(join(f.root, r.draft.directory))).length, 1);
});
