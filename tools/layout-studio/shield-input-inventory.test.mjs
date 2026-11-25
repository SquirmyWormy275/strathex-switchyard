import test from "node:test";
import assert from "node:assert/strict";
import { mkdir, writeFile, open, access } from "node:fs/promises";
import { join } from "node:path";
import { buildShieldInputInventory, shieldInventoryQueries } from "./shield-input-inventory.mjs";
import { authorityFixture } from "./test-support/task-authority-fixture.mjs";
import { createTaskAuthority } from "./task-authority.mjs";
import { createRepositoryInspection } from "./repository-inspection.mjs";
import { createSuite } from "./suite.mjs";
import { createStudioServer } from "./serve.mjs";

const empty = () => ({ tracked: "", untracked: "", ignored: "", relevantIgnored: "" });
test("bounded metadata preview distinguishes relevant ignored names, grouped build trees and unknown directories without creating scan authority", () => {
  const input = { tracked: "app.js\0", untracked: "new.js\0", ignored: ".env\0private/\0node_modules/\0dist/\0opaque.bin\0", relevantIgnored: ".env\0private/.env.production\0" }, report = buildShieldInputInventory(input);
  assert.deepEqual(report.rows.filter(row => row.recommendation === "review-secret-input").map(row => row.path), [".env", "private/.env.production"]);
  assert.deepEqual(report.rows.filter(row => row.recommendation === "review-build-tree-exclusion").map(row => row.path), ["dist", "node_modules"]);
  assert.ok(report.rows.some(row => row.path === "private" && row.recommendation === "needs-classification")); assert.equal(report.rows.some(row => row.path === "node_modules/dependency"), false);
  assert.equal(report.completeness, "incomplete"); assert.equal(report.sourceBytesWitnessed, false); assert.equal(report.scanPerformed, false); assert.equal(report.authorityGranted, false); assert.equal(report.gateEligible, false); assert.ok(report.gaps.includes("ignored_build_tree_contents_not_inspected")); assert.match(report.metadataDigest, /^[a-f0-9]{64}$/); assert.deepEqual(buildShieldInputInventory(input), report);
  assert.ok(shieldInventoryQueries.relevantIgnored.includes(":(glob)**/.env.*")); assert.ok(shieldInventoryQueries.relevantIgnored.includes(":(exclude,glob)**/node_modules/**"));
});
test("inventory parser refuses malformed, oversized, platform-ambiguous, overlapping and invented relevant paths", () => {
  for (const path of ["../outside", "/absolute", "part\\file", "folder/.git/config", "NUL.txt", "name.", "control\nfile", "a:b", "a//b"]) assert.throws(() => buildShieldInputInventory({ ...empty(), tracked: path + "\0" }));
  for (const input of [
    { tracked: "unterminated" }, { tracked: "a\0A\0" }, { tracked: "a\0", untracked: "a\0" }, { tracked: "a\0", ignored: "a\0" },
    { ignored: "local/\0", relevantIgnored: "outside/.env\0" }, { ignored: "local/\0", relevantIgnored: "local/ordinary.js\0" },
    { ignored: "node_modules/\0", relevantIgnored: "node_modules/.env\0" }, { tracked: Array.from({ length: 4097 }, (_, i) => "file-" + i + "\0").join("") },
    { tracked: "x".repeat(262145) }, { tracked: "a\0", untracked: Array.from({ length: 4096 }, (_, i) => "new-" + i + "\0").join("") }
  ]) assert.throws(() => buildShieldInputInventory({ ...empty(), ...input }));
});
test("authenticated task-bound inventory discovers ignored secrets without hashing a large ignored build file or issuing grants", async t => {
  const f = await authorityFixture(t), secret = "SYNTHETIC_NEVER_RETURN_SECRET_BYTES";
  await writeFile(join(f.root, ".gitignore"), "cache.txt\n.env\n.npmrc\nprivate/\nnode_modules/\ndist/\n");
  await mkdir(join(f.root, "private")); await mkdir(join(f.root, "node_modules")); await mkdir(join(f.root, "dist"));
  await writeFile(join(f.root, ".env"), secret); await writeFile(join(f.root, ".npmrc"), secret); await writeFile(join(f.root, "private/.env.production"), secret); await writeFile(join(f.root, "private/unknown.txt"), secret); await writeFile(join(f.root, "node_modules/.env"), secret); await writeFile(join(f.root, "dist/.env"), secret); await writeFile(join(f.root, "new.js"), "synthetic new source");
  const large = await open(join(f.root, "node_modules/large.bin"), "wx"); try { await large.truncate(80 * 1024 * 1024); } finally { await large.close(); }
  const before = await f.run("status", "--porcelain=v1", "--untracked-files=all"), head = (await f.run("rev-parse", "HEAD")).trim();
  const suite = createSuite({ store: f.store, taskAuthority: f.service, agents: { close: async () => {} }, coding: { close: async () => {} } }); f.onCleanup(() => suite.close());
  const token = "I".repeat(43), server = createStudioServer({ suite, token, discover: async () => ({}) }); await new Promise(resolve => server.listen(0, "127.0.0.1", resolve)); f.onCleanup(() => new Promise(resolve => { server.closeAllConnections(); server.close(resolve); }));
  const origin = `http://127.0.0.1:${server.address().port}`, api = (body, authenticated = true) => fetch(origin + "/api/suite/coding/authority/scanner-inputs", { method: "POST", headers: { "Content-Type": "application/json", Origin: origin, ...(authenticated ? { Authorization: `Bearer ${token}` } : {}) }, body: JSON.stringify(body) });
  assert.equal((await api({ taskId: f.task.id }, false)).status, 401); assert.equal(f.counters().calls, 0);
  const response = await api({ taskId: f.task.id }), report = await response.json(); assert.equal(response.status, 200, JSON.stringify(report)); assert.equal(report.head, head); assert.equal(report.taskId, f.task.id); assert.equal(report.repositoryRoot, f.root); assert.equal(report.nativePermissionsChanged, false); assert.equal(report.observationOnly, true);
  assert.deepEqual(report.rows.filter(row => row.recommendation === "review-secret-input").map(row => row.path), [".env", ".npmrc", "private/.env.production"]); assert.ok(report.rows.some(row => row.path === "node_modules" && row.kind === "directory-prefix")); assert.equal(JSON.stringify(report).includes(secret), false); assert.equal(report.rows.some(row => row.path.includes("large.bin") || row.path === "node_modules/.env" || row.path === "dist/.env"), false); assert.ok(report.gaps.includes("ignored_build_tree_contents_not_inspected"));
  const state = await f.store.snapshot("personal"); assert.equal(state.taskAuthorities?.length ?? 0, 0); assert.equal(state.taskAuthorityJournal?.length ?? 0, 0); assert.equal(state.repositoryExecutionJournal?.length ?? 0, 0); assert.ok(state.repositoryProbes.every(probe => probe.stoppedVerified && probe.scratchCleanupPending === false)); for (const probe of state.repositoryProbes) await assert.rejects(access(probe.scratch), { code: "ENOENT" });
  assert.equal(await f.run("status", "--porcelain=v1", "--untracked-files=all"), before); assert.equal((await f.run("rev-parse", "HEAD")).trim(), head);
  const calls = f.counters().calls; assert.equal((await api({ taskId: f.task.id, paths: ["../outside"] })).status, 409); assert.equal((await api({ taskId: f.task.id, compartment: "work" })).status, 409); assert.equal(f.counters().calls, calls);
  await f.store.update("personal", "keyboard-only-inventory-test", state => { state.mode = "keyboard-only"; }); assert.equal((await api({ taskId: f.task.id })).status, 409); assert.equal(f.counters().calls, calls);
});
test("account drift after native inventory verification refuses the preview and revision drift never returns a current inventory", async t => {
  const f = await authorityFixture(t); let checks = 0;
  const service = createTaskAuthority({ store: f.store, inspection: f.inspection, now: f.now, checkNative: async () => { if (++checks === 2) await f.store.update("personal", "inventory-account-drift", state => { state.accounts.push("changed-account"); }); } }); f.onCleanup(() => service.close());
  await assert.rejects(service.scannerInputs("personal", { taskId: f.task.id }), /changed during scanner inventory/); assert.equal((await f.service.list("personal")).length, 0);
  let heads = 0;
  const inspection = createRepositoryInspection({ store: f.store, guardianStopped: async () => true, command: async (...args) => { const result = await f.command(...args); if (args[1].at(-2) === "rev-parse" && args[1].at(-1) === "HEAD" && ++heads === 2) return { ...result, stdout: "b".repeat(40) + "\n" }; return result; } }); f.onCleanup(() => inspection.close());
  await assert.rejects(inspection.scannerInputs("personal", f.task), /revision changed during scanner inventory/); assert.ok((await f.store.snapshot("personal")).repositoryProbes.every(probe => probe.stoppedVerified));
});
