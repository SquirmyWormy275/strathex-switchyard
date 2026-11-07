import test from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFile, writeFile, access } from "node:fs/promises";
import { join } from "node:path";
import { withShieldGitInputs } from "./shield-git-inputs.mjs";
import { bindShieldIndexWitness } from "./shield-index-inputs.mjs";
import { bindShieldHistoryWitness } from "./shield-history-inputs.mjs";
import { buildWindowsIndexPacket } from "./windows-index-inputs.mjs";
import { buildWindowsHistoryPacket, windowsCombinedGitRequest } from "./windows-history-inputs.mjs";
import { repositoryShieldFixture } from "./test-support/repository-shield-fixture.mjs";
import { windowsExecutionFixture } from "./test-support/windows-execution-fixture.mjs";
import { scannerDraftFixture, draftInput } from "./test-support/scanner-draft-fixture.mjs";
import { runtimeGuardianStopped } from "./runtime-command.mjs";
const sha = value => createHash("sha256").update(value).digest("hex");
function borrowed(size = 32) {
  const head = "a".repeat(40), index = Buffer.alloc(size, 1), history = Buffer.alloc(size, 2);
  const row = bytes => ({ path: "app.js", mode: "100644", objectId: createHash("sha1").update(`blob ${bytes.length}\0`).update(bytes).digest("hex"), size: bytes.length, sha256: sha(bytes) });
  const i = row(index), h = { commit: head, ...row(history) }, request = { files: [
    { path: ".switchyard-index/app.js", sha256: i.sha256, size, source: { kind: "git-index", path: i.path, mode: i.mode, objectId: i.objectId } },
    { path: ".switchyard-history/" + head + "/app.js", sha256: h.sha256, size, source: { kind: "git-history", path: h.path, mode: h.mode, objectId: h.objectId, commit: head, depth: 1 } }
  ] };
  const common = { sourceBytesWitnessed: true, sourceBytesReturned: false, head }, ir = { ...common, schema: "switchyard-git-index-inputs/v1", indexMetadataSha256: "b".repeat(64), rows: [i] }, hr = { ...common, schema: "switchyard-git-history-inputs/v1", paths: ["app.js"], requestedDepth: 1, historyMetadataSha256: "c".repeat(64), stopping: { kind: "root", nextFirstParent: null }, shallow: false, versions: [h] };
  const shield = { request, indexWitness: bindShieldIndexWitness(request, ir), historyWitness: bindShieldHistoryWitness(request, hr) };
  let reader = false;
  const ports = {
    async useIndexInputs(paths, consume) { assert.deepEqual(paths, ["app.js"]); assert.equal(reader, false); reader = true; try { return await consume(ir, new Map([["app.js", index]])); } finally { reader = false; index.fill(0); } },
    async useHistoryInputs(paths, depth, consume) { assert.deepEqual(paths, ["app.js"]); assert.equal(depth, 1); assert.equal(reader, false); assert.ok(index.every(b => b === 0)); try { return await consume(hr, new Map([[h.objectId, history]])); } finally { history.fill(0); } }
  };
  return { shield, ports, index, history };
}
test("mixed Git borrowing never nests readers and erases retained bytes after success or refusal", async () => {
  for (const fail of [false, true]) {
    const f = borrowed(); let retained;
    const work = withShieldGitInputs(f.shield, f.ports, async ({ indexBytes, historyBytes }) => {
      retained = indexBytes.values().next().value.bytes;
      assert.ok(retained.every(b => b === 1)); assert.ok(historyBytes.values().next().value.bytes.every(b => b === 2));
      if (fail) throw Error("synthetic consumer refusal"); return "verified";
    });
    if (fail) await assert.rejects(work, /consumer refusal/); else assert.equal(await work, "verified");
    assert.ok(retained.every(b => b === 0)); assert.ok(f.index.every(b => b === 0)); assert.ok(f.history.every(b => b === 0));
  }
});
test("mixed Git borrowing refuses different HEADs and changed historical witnesses without consumption", async () => {
  const f = borrowed(); let consumed = false;
  await assert.rejects(withShieldGitInputs({ ...f.shield, historyWitness: { ...f.shield.historyWitness, head: "d".repeat(40) } }, f.ports, () => { consumed = true; }), /one reviewed HEAD/);
  await assert.rejects(withShieldGitInputs({ ...f.shield, historyWitness: { ...f.shield.historyWitness, historyMetadataSha256: "d".repeat(64) } }, f.ports, () => { consumed = true; }), /changed/);
  assert.equal(consumed, false); assert.ok(f.index.every(b => b === 0));
});
test("combined Windows transport retains one aggregate 320 KiB limit and binds both packet digests", async () => {
  for (const size of [160 * 1024, 160 * 1024 + 1]) {
    const f = borrowed(size);
    await withShieldGitInputs(f.shield, f.ports, options => {
      const inputFiles = f.shield.request.files.map(({ path, sha256, size }) => ({ path, sha256, size, classification: "non-production" })), input = { ...options, ...f.shield, action: "shield_codebase_audit", inputFiles };
      const index = buildWindowsIndexPacket(input), history = buildWindowsHistoryPacket(input);
      if (size > 160 * 1024) assert.throws(() => windowsCombinedGitRequest({ inputFiles }, index, history), /original 320 KiB/);
      else {
        const packet = windowsCombinedGitRequest({ inputFiles }, index, history);
        assert.equal(packet.proof.indexPacketSha256, sha(JSON.stringify(index))); assert.equal(packet.proof.historyPacketSha256, sha(JSON.stringify(history)));
        assert.throws(() => windowsCombinedGitRequest({ padding: "x".repeat(512 * 1024) }, index, history), /original 512 KiB/);
        assert.throws(() => windowsCombinedGitRequest({}, index, { ...history, witness: { ...history.witness, head: "f".repeat(40) } }), /HEAD/);
      }
    });
  }
});
test("automatic draft assembly binds current, staged and historical versions without changing the repository", async t => {
  const f = await scannerDraftFixture(t);
  for (const text of ["old synthetic source", "clean committed source"]) { await writeFile(join(f.root, "app.js"), text); await f.run("add", "app.js"); await f.run("-c", "commit.gpgsign=false", "commit", "-m", "synthetic version"); }
  await writeFile(join(f.root, "app.js"), "staged synthetic source"); await f.run("add", "app.js"); await writeFile(join(f.root, "app.js"), "current clean source");
  const before = await readFile(join(f.root, ".git/index")), head = await f.run("rev-parse", "HEAD"), draft = await f.service.prepareScannerDraft("personal", { ...draftInput(f), includeIndex: true, historyDepth: 4 });
  assert.equal(draft.preparation.policy, "bounded-current-index-and-history/v1");
  const request = JSON.parse(draft.files.find(row => row.path.endsWith("/request.json")).content);
  assert.ok(request.files.some(row => row.source?.kind === "git-index")); assert.ok(request.files.some(row => row.source?.kind === "git-history"));
  assert.equal(JSON.stringify(draft).includes("old synthetic source"), false); assert.equal(JSON.stringify(draft).includes("staged synthetic source"), false);
  assert.deepEqual(await readFile(join(f.root, ".git/index")), before); assert.equal(await f.run("rev-parse", "HEAD"), head);
});
for (const windows of [false, true]) test(`one ${windows ? "Windows guest-double" : "actual Linux"} scan finds staged-only and historical-only secrets and preserves all original sources`, { skip: !windows && process.platform !== "linux" }, async t => {
  const options = { action: "shield_codebase_audit", clean: true, stagedIndex: true, historyInputs: true }, f = windows ? await windowsExecutionFixture(t, { ...options, shield: true }) : await repositoryShieldFixture(t, options);
  const index = await readFile(join(f.root, ".git/index")), current = await readFile(join(f.root, "app.js")), head = await f.run("rev-parse", "HEAD");
  const review = await f.execution.review("personal", f.proposed); assert.ok(review.review.shield.indexWitness); assert.ok(review.review.shield.historyWitness);
  const input = { requestId: f.proposed.requestId, token: review.confirmation.token }, result = await f.execution.apply("personal", input);
  assert.equal(result.status, "failed", JSON.stringify(result)); assert.ok(result.receiptId);
  const report = result.data.shieldReport; assert.equal(report.completeness, "incomplete");
  for (const prefix of [".switchyard-index/", ".switchyard-history/"]) assert.ok(report.findings.some(row => row.path.startsWith(prefix) && row.ruleId === "secret.private-key"));
  assert.equal(report.findings.some(row => row.path === "app.js"), false);
  for (const field of ["gitIndexInputs", "gitHistoryInputs"]) assert.match(result.data.receiptEvidenceEnvelope.evidence.toolVersions[field], /^sha256:/);
  assert.equal((await f.execution.apply("personal", input)).receiptId, result.receiptId);
  const state = await f.store.snapshot("personal");
  if (windows) { assert.equal(f.effects(), 1); assert.equal(state.repositoryWindowsRuns[0].cleanupPending, false); }
  else { assert.equal(await runtimeGuardianStopped(state.repositoryExecutions[0].ownedRuntime), true); assert.equal(state.repositoryExecutionStaging[0].cleanupPending, false); await assert.rejects(access(state.repositoryExecutionStaging[0].path), { code: "ENOENT" }); }
  assert.deepEqual(await readFile(join(f.root, ".git/index")), index); assert.deepEqual(await readFile(join(f.root, "app.js")), current); assert.equal(await f.run("rev-parse", "HEAD"), head);
});

test("mixed automatic review enforces the combined file ceiling before confirmation",async t=>{
 const f=await scannerDraftFixture(t);
 for(const text of ["first","second"]){await writeFile(join(f.root,"app.js"),text);await f.run("add","app.js");await f.run("-c","commit.gpgsign=false","commit","-m","synthetic version");}
 for(let i=0;i<244;i++)await writeFile(join(f.root,"u"+i),"small");
 const before=(await f.store.snapshot("personal")).confirmationJournal?.length??0;
 await assert.rejects(f.service.reviewScanner("personal",{taskId:f.task.id,action:"shield_codebase_audit",planRevision:"mixed-overflow",includeIndex:true,historyDepth:4}),/256-file bound/);
 assert.equal((await f.store.snapshot("personal")).confirmationJournal?.length??0,before);
});
