import test from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdir, writeFile, readFile, readdir } from "node:fs/promises";
import { join } from "node:path";
import { scannerDraftFixture } from "./test-support/scanner-draft-fixture.mjs";
import { withBrowserSurface, until } from "./test-support/browser-ui.mjs";
import { createScannerRecipeSave } from "./scanner-recipe-save.mjs";
import { createSuite } from "./suite.mjs";
import { createRepositoryExecution } from "./repository-execution.mjs";

const sha = data => createHash("sha256").update(data).digest("hex");
async function fixture(t, fn, { failWrite = false } = {}) {
  const f = await scannerDraftFixture(t), notices = []; let writes = 0, lastDraft;
  // Explicit portable filesystem boundary double. Production Linux/NTFS
  // identity/anchoring is covered by the original scanner-save test groups.
  const filesystem = {
    root: async root => ({ syntheticRoot: root }),
    async write(draft, _root, record, authorize) {
      writes++; lastDraft = draft; await authorize(); await record({ kind: "directory-intent" }); await mkdir(join(draft.repositoryRoot, draft.directory)); await record({ kind: "directory-created", identity: { synthetic: draft.directory } });
      if (failWrite) throw Error("Synthetic interruption after directory creation");
      for (const file of draft.files) { await authorize(); await record({ kind: "file-intent", path: file.path }); await writeFile(join(draft.repositoryRoot, file.path), file.content, { flag: "wx" }); await record({ kind: "file-created", path: file.path, identity: { synthetic: file.sha256 } }); assert.equal(sha(await readFile(join(draft.repositoryRoot, file.path))), file.sha256); await record({ kind: "file-verified", path: file.path, identity: { synthetic: file.sha256 } }); }
    },
    async inspect(draft, _root, progress, { authorize }) {
      await authorize(); if (!progress.directoryIdentity || draft.files.some(f => progress.files[f.path]?.status !== "verified")) return { complete: false };
      for (const file of draft.files) if (sha(await readFile(join(draft.repositoryRoot, file.path))) !== file.sha256) return { complete: false };
      return { complete: true };
    }
  };
  const saver = createScannerRecipeSave({ store: f.store, authority: f.service, platform: "linux", filesystem, now: f.now }); f.onCleanup(() => saver.close());
  // Review the Linux policy with an explicit unused native port on every OS;
  // no process is started here and this is not Windows guest acceptance.
  const execution = createRepositoryExecution({ store: f.store, authority: f.service, stateDirectory: join(f.stage, "execution"), platform: "linux", namespaceFactory: port => port, resolveScannerFixtures: (c, input) => f.feeds.resolve(c, input) }); f.onCleanup(() => execution.close());
  const suite = createSuite({ store: f.store, repositoryExecution: { ...execution, close: async () => {} }, taskAuthority: { ...f.service, close: async () => {} }, fixtureAdministration: { ...f.feeds, close: async () => {} }, scannerRecipeSave: { ...saver, close: async () => {} }, agents: { discovery: async () => [], close: async () => {} }, voice: { discovery: async () => ({ available: false }) } }); f.onCleanup(() => suite.close());
  await withBrowserSurface({ ...f, suite }, async c => {
    const { mountScanner } = await import("./scanner-ui.mjs"); const { mountAuthority } = await import("./authority-ui.mjs"); const { mountExecution } = await import("./execution-ui.mjs");
    mountScanner({ notify: value => notices.push(value) }); mountAuthority({ notify: value => notices.push(value) }); mountExecution({ notify: value => notices.push(value) }); await c.refresh(); assert.equal(c.calls.length, 0);
    c.change("scanner-action", "shield_codebase_audit"); c.click("load-scanner-setup"); await c.responses.findLast(r => r.path.endsWith("scanner-fixtures/list")).response; await until(() => !c.$("load-scanner-setup").disabled); c.change("scanner-advisory", "synthetic-advisory");
    await fn({ ...c, saver, notices, writes: () => writes, draft: () => lastDraft });
  });
}
async function review(c) { c.click("review-scanner-save"); await c.responses.findLast(r => r.path.endsWith("scanner-save/review")).response; await until(() => c.$("scanner-review-dialog").open && !c.$("confirm-scanner-save").disabled); }
async function save(c) { c.click("confirm-scanner-save"); c.$("confirm-scanner-save").dispatchEvent(new Event("click")); await c.responses.findLast(r => r.path.endsWith("scanner-save/apply")).response; await until(() => !c.$("load-scanner-setup").disabled); }

test("scanner preparation exposes exact new control bytes and can be cancelled without a write or permission", async t => fixture(t, async c => {
  const before = await readdir(c.root); await review(c); assert.equal(c.$("scanner-review-files").children.length, 5); assert.match(c.$("scanner-review-summary").textContent, /synthetic-scanner/); assert.match(c.$("scanner-review-summary").textContent, /new directory/);
  assert.equal(c.writes(), 0); assert.deepEqual(await readdir(c.root), before); assert.equal((await c.service.list("personal")).length, 0); c.click("cancel-scanner-save"); await until(() => c.$("scanner-review-files").children.length === 0);
  assert.equal(c.writes(), 0);
}));

test("saved scanner setup crosses separate permission and execution reviews without automatically scanning", async t => fixture(t, async c => {
  const index = await readFile(join(c.root, ".git/index")), head = await c.run("rev-parse", "HEAD"); await review(c); await save(c); assert.equal(c.writes(), 1); assert.equal((await c.service.list("personal")).length, 0);
  for (const file of c.draft().files) assert.equal(await readFile(join(c.root, file.path), "utf8"), file.content); assert.match(c.$("scanner-status").textContent, /Nothing has executed/);
  c.click("use-scanner-scope"); assert.equal(c.$("authority-controls").open, true); assert.ok(c.$("authority-paths").value.includes(c.draft().manifestPath)); assert.equal(c.calls.some(r => r.path.endsWith("authority/issue")), false);
  c.click("review-authority"); await c.responses.findLast(r => r.path.endsWith("authority/review")).response; await until(() => c.$("authority-review-dialog").open && !c.$("confirm-authority").disabled);
  c.click("confirm-authority"); await c.responses.findLast(r => r.path.endsWith("authority/issue")).response; await until(() => !c.$("refresh-authorities").disabled && !c.$("refresh-executions").disabled);
  assert.equal((await c.service.list("personal")).length, 1); c.click("use-scanner-recipe"); await until(() => !c.$("review-execution").disabled); assert.equal(c.$("execution-controls").open, true); assert.equal(c.$("execution-manifest").value, c.draft().manifestPath); assert.equal(c.$("execution-review-dialog").open, false);
  c.click("review-execution"); await c.responses.findLast(r => r.path.endsWith("execution/review")).response; await until(() => c.$("execution-review-dialog").open && !c.$("confirm-execution").disabled); assert.match(c.$("execution-review-summary").textContent, /Scanner scope and evidence/);
  assert.equal(c.calls.some(r => r.path.endsWith("execution/apply")), false); assert.equal((await c.store.snapshot("personal")).repositoryExecutions?.length ?? 0, 0); assert.deepEqual(await readFile(join(c.root, ".git/index")), index); assert.equal(await c.run("rev-parse", "HEAD"), head);
}));

test("source drift before saving refuses writes and cannot enable a permission handoff", async t => fixture(t, async c => {
  await review(c); await writeFile(join(c.root, "task.txt"), "changed after save review\n"); await save(c); assert.equal(c.writes(), 0); assert.equal(c.$("use-scanner-scope").disabled, true); assert.match(c.$("scanner-status").textContent, /No automatic retry/);
}));

test("an interrupted save retains uncertain output and observational recovery never repeats writes", async t => fixture(t, async c => {
  await review(c); await save(c); assert.equal(c.writes(), 1); assert.match(c.$("scanner-save-result").textContent, /outcome-unconfirmed/); assert.equal(c.$("use-scanner-scope").disabled, true); assert.equal(c.$("use-scanner-recipe").disabled, true);
  const names = await readdir(c.root); c.click("recover-scanner-saves"); await c.responses.findLast(r => r.path.endsWith("scanner-save/recover")).response; await until(() => !c.$("recover-scanner-saves").disabled); assert.equal(c.writes(), 1); assert.deepEqual(await readdir(c.root), names); assert.match(c.$("scanner-save-result").textContent, /outcome-unconfirmed/);
}, { failWrite: true }));

test("a lost successful save reply is recovered from its original history without another write", async t => fixture(t, async c => {
  await review(c); const original = globalThis.fetch;
  globalThis.fetch = async (path, options) => { const response = await original(path, options); if (path.endsWith("scanner-save/apply")) { await response.text(); throw Error("Synthetic lost save reply"); } return response; };
  try { await save(c); } finally { globalThis.fetch = original; }
  assert.equal(c.writes(), 1); assert.match(c.$("scanner-status").textContent, /Save outcome unconfirmed/); assert.equal(c.$("use-scanner-scope").disabled, false); assert.match(c.$("scanner-save-result").textContent, /Status: saved/);
  c.click("load-scanner-setup"); await until(() => !c.$("load-scanner-setup").disabled); assert.equal(c.writes(), 1); assert.equal(c.calls.filter(r => r.path.endsWith("scanner-save/apply")).length, 1);
}));

test("selection and workspace changes discard generated content and cannot carry a save approval", async t => fixture(t, async c => {
  await review(c); c.change("scanner-index", ""); assert.equal(c.$("scanner-review-dialog").open, false); assert.equal(c.$("scanner-review-files").children.length, 0); assert.equal(c.$("confirm-scanner-save").disabled, true);
  await review(c); c.document.dispatchEvent(new Event("switchyard-workspace-changing")); c.document.dispatchEvent(new CustomEvent("switchyard-compartment-state", { detail: await c.store.snapshot("work") }));
  assert.equal(c.$("scanner-task").options.length, 0); assert.equal(c.$("scanner-review-files").children.length, 0); assert.equal(c.$("load-scanner-setup").disabled, true); const calls = c.calls.length; c.$("confirm-scanner-save").dispatchEvent(new Event("click")); assert.equal(c.calls.length, calls); assert.equal(c.writes(), 0);
}));


test("staged and bounded history selections reach the exact review without exposing source bytes", async t => fixture(t, async c => {
  const privateText = "PRIVATE_SOURCE_ONLY_HASHED_IN_SCANNER_UI_72f993"; await writeFile(join(c.root, "task.txt"), privateText);
  c.$("scanner-index").checked = true; c.change("scanner-index", ""); c.change("scanner-depth", "1"); await review(c);
  const input = c.calls.findLast(r => r.path.endsWith("scanner-save/review")).body; assert.equal(input.includeIndex, true); assert.equal(input.historyDepth, 1); assert.equal(input.action, "shield_codebase_audit");
  const summary = c.$("scanner-review-summary").textContent; assert.match(summary, /indexInputs/); assert.match(summary, /historyInputs/); assert.equal(summary.includes(privateText), false); assert.equal(c.$("scanner-review-files").children.some(e => e.children[1].textContent.includes(privateText)), false); assert.equal(c.writes(), 0);
  c.change("scanner-action", "shield_supply_chain"); assert.equal(c.$("scanner-depth").value, "0"); assert.equal(c.$("scanner-depth").disabled, true); assert.equal(c.$("scanner-review-dialog").open, false);
}));
