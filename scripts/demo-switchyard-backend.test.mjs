import test from "node:test";
import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { fileURLToPath } from "node:url";

const execute = promisify(execFile);
const script = fileURLToPath(new URL("./demo-switchyard-backend.mjs", import.meta.url));

test("the public synthetic command completes a connected backend journey and retires its own servers and encrypted state", async () => {
  const result = await execute(process.execPath, [script, "--synthetic"], { timeout: 40000, maxBuffer: 32768 });
  const report = JSON.parse(result.stdout);
  assert.equal(report.schema, "switchyard-backend-demo/v1"); assert.equal(report.success, true); assert.equal(report.synthetic, true);
  assert.deepEqual(report.stages.map(stage => stage.id), ["start-with-preset", "connect-a-role", "observe-and-use-control", "review-and-refine", "save-export-and-reopen", "move-to-a-second-host", "respect-work-policy"]);
  assert(report.stages.every(stage => stage.passed));
  assert.deepEqual(report.cleanup, { serversClosed: true, temporaryEncryptedStateRemoved: true, newDependencies: false });
  assert.equal(report.stages.find(stage => stage.id === "move-to-a-second-host").connectionsTransferred, 0);
  assert.equal(report.stages.find(stage => stage.id === "observe-and-use-control").taskCompletionVerified, false);
  assert.equal(result.stderr, "");
});

test("the demonstration refuses installed-state, credential, device and missing opt-in arguments", async () => {
  for (const args of [[], ["--installed"], ["--synthetic", "--token=forbidden"], ["--synthetic", "--device=f77"]]) {
    await assert.rejects(execute(process.execPath, [script, ...args], { timeout: 10000, maxBuffer: 32768 }), error => {
      assert.equal(error.code, 1); assert.equal(error.stdout, ""); assert.match(error.stderr, /Use exactly --synthetic/); return true;
    });
  }
});
