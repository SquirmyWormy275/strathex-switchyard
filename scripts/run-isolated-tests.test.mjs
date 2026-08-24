import assert from "node:assert/strict";
import test from "node:test";
import { mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createStrictTestEnvironment, runVerification } from "./run-isolated-tests.mjs";
const executable = process.execPath;
async function group(directory, name, code) { const file = join(directory, `${name}.test.mjs`); await writeFile(file, code, "utf8"); return { file }; }
async function verify(groups, outputDirectory, timeoutMs = 1_000) { return runVerification({ groups, outputDirectory, timeoutMs, executable: process.execPath }); }
test("atomic receipt records current successful child exits", async () => { const directory = await mkdtemp(join(tmpdir(), "sxsy-receipt-")); try { const result = await verify([await group(directory, "pass", "")], directory); const saved = JSON.parse(await readFile(result.receiptPath, "utf8")); assert.equal(saved.runId, result.receipt.runId); assert.equal(saved.success, true); assert.equal(saved.children[0].exitCode, 0); assert.equal(saved.children[0].timeout, false); assert.deepEqual(saved.children[0].testCounts, { total: 1, passed: 1, failed: 0 }); assert.equal(saved.totals.tests, 1); assert.deepEqual((await readdir(directory)).filter((name) => name.endsWith(".tmp")), []); } finally { await rm(directory, { recursive: true, force: true }); } });
test("receipt records failure, timeout, bounded output, and exited children", async () => { const directory = await mkdtemp(join(tmpdir(), "sxsy-receipt-")); try { const failed = await runVerification({ groups: [{ file: "inline-failure", args: ["-e", "process.stderr.write('x'.repeat(100000)); process.exit(7)"] }], outputDirectory: directory, executable }); assert.equal(failed.receipt.success, false); assert.equal(failed.receipt.children[0].exitCode, 7); assert.equal(failed.receipt.children[0].outputBytes <= 65536, true); const timed = await runVerification({ groups: [{ file: "inline-timeout", args: ["-e", "setInterval(() => {}, 1000)"] }], outputDirectory: directory, timeoutMs: 25, executable }); assert.equal(timed.receipt.success, false); assert.equal(timed.receipt.children[0].timeout, true); assert.equal(timed.receipt.children[0].signal !== null || timed.receipt.children[0].exitCode !== null, true); } finally { await rm(directory, { recursive: true, force: true }); } });

test("strict child environments allowlist operating-system inputs and isolate test state", async () => {
  const directory = await mkdtemp(join(tmpdir(), "sxsy-environment-"));
  try {
    const environment = createStrictTestEnvironment(join(directory, "child"), {
      PATH: process.env.PATH,
      SystemRoot: process.env.SystemRoot,
      SXSY_AMBIENT_SECRET: "must-not-cross",
      DATABASE_URL: "postgres://production.example/live",
      GH_TOKEN: "must-not-cross",
      NODE_OPTIONS: "--inspect"
    });
    assert.equal(environment.SXSY_AMBIENT_SECRET, undefined);
    assert.equal(environment.DATABASE_URL, undefined);
    assert.equal(environment.GH_TOKEN, undefined);
    assert.equal(environment.NODE_OPTIONS, undefined);
    assert.equal(environment.NODE_ENV, "test");
    assert.equal(environment.SXSY_TEST_MODE, "1");
    assert.equal(environment.SXSY_NETWORK, "deny");
    assert.match(environment.SXSY_TEST_DATABASE, /^sxsy_test_/);
    assert.equal(environment.TEMP, join(directory, "child"));

    process.env.SXSY_AMBIENT_SECRET = "must-not-cross";
    const code = "if(process.env.SXSY_AMBIENT_SECRET||process.env.DATABASE_URL||process.env.GH_TOKEN||process.env.NODE_OPTIONS||process.env.SXSY_TEST_MODE!=='1'||process.env.SXSY_NETWORK!=='deny'||!process.env.SXSY_TEST_ROOT||!process.env.SXSY_TEST_DATABASE)process.exit(19)";
    const result = await runVerification({ groups: [{ file: "strict-environment", args: ["-e", code] }], outputDirectory: directory, executable });
    assert.equal(result.receipt.success, true);
    assert.equal(result.receipt.children[0].environmentPolicy, "strict-test-v1");
  } finally {
    delete process.env.SXSY_AMBIENT_SECRET;
    await rm(directory, { recursive: true, force: true });
  }
});

test("timeout terminates and awaits the entire task-owned descendant tree", async () => {
  const directory = await mkdtemp(join(tmpdir(), "sxsy-tree-"));
  const pidFile = join(directory, "descendant.pid");
  try {
    const code = `const{spawn}=require('node:child_process'),{writeFileSync}=require('node:fs');const c=spawn(process.execPath,['-e','setInterval(()=>{},1000)'],{stdio:'ignore'});writeFileSync(${JSON.stringify(pidFile)},String(c.pid));setInterval(()=>{},1000)`;
    const result = await runVerification({ groups: [{ file: "descendant-timeout", args: ["-e", code] }], outputDirectory: directory, timeoutMs: 500, executable });
    assert.equal(result.receipt.success, false);
    assert.equal(result.receipt.children[0].timeout, true);
    assert.equal(result.receipt.children[0].processTreeTermination.completed, true);
    const descendantPid = Number(await readFile(pidFile, "utf8"));
    await new Promise((done) => setTimeout(done, 100));
    assert.throws(() => process.kill(descendantPid, 0));
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
