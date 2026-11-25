import test from "node:test";
import assert from "node:assert/strict";
import { taskHistoryScope, assertTaskHistoryWitness, taskOwnsScannerSource } from "./task-history-scope.mjs";
const scope = () => ({ paths: ["removed.env", "app.js"], depth: 4, head: "a".repeat(40), metadataSha256: "b".repeat(64) });
test("historical permission is closed, bounded and limited to read-only history actions", () => {
  const valid = taskHistoryScope(scope(), ["release_shield", "shield_codebase_audit"]);
  assert.deepEqual(valid.paths, ["app.js", "removed.env"]);
  for (const patch of [{ depth: undefined }, { depth: null }, { depth: "4" }, { depth: 7 }, { paths: [] }, { paths: ["../outside"] }, { paths: ["a", "a"] }, { paths: Array.from({length:9}, (_, i) => `file${i}`) }, { head: "HEAD" }, { head: "0".repeat(40) }, { metadataSha256: "invalid" }, { command: "log" }, { approved: true }]) assert.throws(() => taskHistoryScope({ ...scope(), ...patch }, ["release_shield"]));
  for (const actions of [[], ["local_commit"], ["run_target"], ["pipeline_local_gate"], ["shield_change_scan"], ["shield_supply_chain"], ["release_shield", "local_commit"]]) assert.throws(() => taskHistoryScope(scope(), actions));
  for (const value of [null, [], "history"]) assert.throws(() => taskHistoryScope(value, ["release_shield"]));
});
test("historical permission requires its complete matching witnessed versions before consumption", () => {
  const selected = taskHistoryScope(scope(), ["release_shield"]), report = { schema: "switchyard-git-history-inputs/v1", sourceBytesWitnessed: true, sourceBytesReturned: false, head: selected.head, requestedDepth: selected.depth, paths: selected.paths, historyMetadataSha256: selected.metadataSha256, versions: selected.paths.map(path => ({ path })) };
  assert.doesNotThrow(() => assertTaskHistoryWitness(selected, report));
  for (const patch of [{ schema: "unverified" }, { head: "c".repeat(40) }, { requestedDepth: 3 }, { historyMetadataSha256: "c".repeat(64) }, { sourceBytesReturned: true }, { sourceBytesWitnessed: false }, { paths: ["app.js"] }, { paths: [...selected.paths, "foreign.env"] }, { versions: [{ path: "app.js" }] }, { versions: null }]) assert.throws(() => assertTaskHistoryWitness(selected, { ...report, ...patch }));
});
test("a historical grant does not authorize staged or current copies of a deleted path", () => {
  const proposal = { paths: ["app.js"], history: taskHistoryScope(scope(), ["release_shield"]) };
  assert.equal(taskOwnsScannerSource(proposal, { kind: "git-history", path: "removed.env", depth: 4 }), true);
  for (const source of [{ kind: "git-index", path: "removed.env" }, { kind: "git-history", path: "removed.env", depth: 3 }, { kind: "git-history", path: "foreign.env", depth: 4 }, null]) assert.equal(taskOwnsScannerSource(proposal, source), false);
  assert.equal(taskOwnsScannerSource(proposal, { kind: "git-index", path: "app.js" }), true);
  assert.equal(taskOwnsScannerSource({ paths: ["app.js"] }, { kind: "git-history", path: "app.js", depth: 4 }), true);
});
