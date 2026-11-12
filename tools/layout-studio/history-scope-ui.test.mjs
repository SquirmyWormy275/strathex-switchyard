import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { withBrowserSurface, until } from "./test-support/browser-ui.mjs";
const taskId = "11111111-1111-4111-8111-111111111111";
const history = { paths: ["removed.env", "task.txt"], depth: 4, head: "a".repeat(40), metadataSha256: "b".repeat(64) };
const proposal = { taskId, planRevision: "scan-1", actions: ["shield_codebase_audit"], lifetimeMinutes: 15, paths: ["task.txt", "scan/request.json"], classifications: { includedUntracked: ["scan/request.json"], excludedUntracked: [], excludedIgnored: [] }, history };
// UI interaction and authenticated HTTP contract only. Git, native identities,
// writes and scan effects are explicit doubles; backend journeys test those.
async function fixture(fn) {
  const state = { id: "personal", policy: "personal", mode: "personal-companion", codingSessions: [{ schema: "switchyard-coding-session/v1", id: taskId, provider: "codex", status: "registered", nativeTransport: "owned-stdio", sessionId: "synthetic", repositoryRoot: "/synthetic/project" }] };
  const draft = { id: "22222222-2222-4222-8222-222222222222", action: "shield_codebase_audit", repositoryRoot: "/synthetic/project", directory: "scan", manifestPath: "scan/request.json", manifestSha256: "c".repeat(64), binding: { taskId }, authorityProposal: proposal,
    files: [{ path: "scan/request.json", sha256: "c".repeat(64), size: 2, content: "{}" }], feeds: [{ id: "scanner-feed", kind: "scanner" }], request: { files: [{ path: "task.txt", size: 1 }, { path: ".switchyard-history/" + history.head + "/removed.env", size: 2, source: { kind: "git-history", path: "removed.env", commit: history.head } }] },
    preparation: { historyDepth: 4, includedRemovedHistoryPaths: ["removed.env"], historyPathDiscovery: { count: 0, rows: [] } } };
  let saved = false;
  const suite = { async handle(path, input) {
    if (path.endsWith("scanner-fixtures/list")) return { fixtures: [{ id: "scanner-feed", kind: "scanner", status: "active", manifestSha256: "d".repeat(64) }] };
    if (path.endsWith("scanner-save/list")) return saved ? [{ id: draft.id, draft, status: "saved", result: { status: "saved", authorityProposal: proposal } }] : [];
    if (path.endsWith("scanner-save/review")) return { draft, review: { expiresAt: "synthetic-expiry" }, confirmation: { token: taskId, record: { reason: "Review these new files." } } };
    if (path.endsWith("scanner-save/apply")) { saved = true; return { status: "saved" }; }
    if (path.endsWith("authority/review")) return { scope: { ...input, repositoryRoot: draft.repositoryRoot, provider: "codex", sessionId: "synthetic", allowedActions: input.actions }, confirmation: { token: taskId, record: { reason: "Synthetic permission review only." } } };
    throw Error("Unexpected UI effect " + path);
  } };
  await withBrowserSurface({ suite, store: { snapshot: async () => structuredClone(state) } }, async c => {
    const { mountScanner } = await import("./scanner-ui.mjs"), { mountAuthority } = await import("./authority-ui.mjs");
    mountScanner({ notify() {} }); mountAuthority({ notify() {} }); await c.refresh(); await fn(c);
  });
}
test("deleted history selection and saved handoff retain their separate permission through the real controls", async () => fixture(async c => {
  const html = await readFile(new URL("./index.html", import.meta.url), "utf8");
  for (const id of ["scanner-removed-history", "authority-history-selection", "authority-history-scope", "clear-authority-history"]) assert.ok(html.includes(`id="${id}"`));
  assert.equal(c.$("scanner-removed-history").disabled, true);
  c.change("scanner-action", "shield_codebase_audit"); c.change("scanner-depth", "4"); assert.equal(c.$("scanner-removed-history").disabled, false);
  c.$("scanner-removed-history").checked = true; c.change("scanner-removed-history", "");
  c.click("load-scanner-setup"); await until(() => !c.$("load-scanner-setup").disabled);
  c.click("review-scanner-save"); await until(() => c.$("scanner-review-dialog").open && !c.$("confirm-scanner-save").disabled);
  const selection = c.calls.findLast(row => row.path.endsWith("scanner-save/review")).body;
  assert.equal(selection.includeRemovedHistory, true); assert.equal(selection.historyDepth, 4);
  assert.match(c.$("scanner-review-summary").textContent, /Deleted files included as historical versions:\nremoved.env/);
  c.click("confirm-scanner-save"); await until(() => !c.$("use-scanner-scope").disabled);
  c.click("use-scanner-scope"); assert.equal(c.$("authority-history-selection").hidden, false);
  assert.equal(c.$("authority-paths").value.includes("removed.env"), false);
  assert.match(c.$("authority-history-scope").textContent, /removed.env/); assert.match(c.$("authority-history-scope").textContent, /no current-file ownership/);
  c.change("authority-plan", "review-2"); c.click("review-authority"); await until(() => c.$("authority-review-dialog").open && !c.$("confirm-authority").disabled);
  assert.deepEqual(c.calls.findLast(row => row.path.endsWith("authority/review")).body.history, history);
  assert.match(c.$("authority-review-summary").textContent, /Read-only historical files/);
  assert.equal(c.calls.some(row => row.path.endsWith("authority/issue") || row.path.endsWith("execution/apply")), false);
  c.click("clear-authority-history"); await until(() => !c.$("authority-review-dialog").open);
  assert.equal(c.$("authority-history-selection").hidden, true); assert.equal(c.$("authority-history-scope").textContent, ""); assert.equal(c.$("confirm-authority").disabled, true);
}));
test("task, action and workspace changes cannot carry a historical permission or deleted-file selection", async () => fixture(async c => {
  const load = () => c.document.dispatchEvent(new CustomEvent("switchyard-authority-proposal", { detail: { compartment: "personal", proposal } }));
  for (const id of ["authority-task", "authority-action"]) { load(); assert.equal(c.$("authority-history-selection").hidden, false); c.change(id, c.$(id).value); assert.equal(c.$("authority-history-scope").textContent, ""); }
  c.change("scanner-action", "shield_codebase_audit"); c.change("scanner-depth", "4"); c.$("scanner-removed-history").checked = true;
  c.change("scanner-action", "shield_supply_chain"); assert.equal(c.$("scanner-removed-history").checked, false); assert.equal(c.$("scanner-removed-history").disabled, true);
  load(); c.document.dispatchEvent(new Event("switchyard-workspace-changing")); assert.equal(c.$("authority-history-scope").textContent, ""); assert.equal(c.$("authority-history-selection").hidden, true); assert.equal(c.$("scanner-removed-history").checked, false);
  assert.equal(c.calls.length, 0);
}));
