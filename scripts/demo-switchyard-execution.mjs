#!/usr/bin/env node
/** Source-only Linux execution walkthrough. Synthetic provider; actual owned namespace/process. */
import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import { once } from "node:events";
import { readFile, lstat } from "node:fs/promises";
import { join } from "node:path";
import { executionFixture } from "../tools/layout-studio/test-support/execution-fixture.mjs";
import { createSuite } from "../tools/layout-studio/suite.mjs";
import { createStudioServer } from "../tools/layout-studio/serve.mjs";

if (process.argv.slice(2).join(" ") !== "--synthetic" || process.platform !== "linux") throw Error("Usage from a Linux source checkout: node --experimental-transform-types scripts/demo-switchyard-execution.mjs --synthetic");
const cleanups = [], checks = []; let f, server, suite, failure;
try {
  f = await executionFixture({ after: fn => cleanups.push(fn) }, { native: true });
  const head = await f.run("rev-parse", "HEAD"), index = await readFile(join(f.root, ".git/index")), original = await readFile(join(f.root, "task.txt"));
  suite = createSuite({ store: f.store, agents: { discovery: async () => [], close: async () => {} }, voice: { discovery: async () => ({ available: false }) }, taskAuthority: { ...f.service, close: async () => {} }, repositoryExecution: { ...f.execution, close: async () => {} } });
  const token = randomBytes(32).toString("base64url");
  server = createStudioServer({ suite: { ...suite, close: async () => {} }, token, bridge: { close() {} } }); server.listen(0, "127.0.0.1"); await once(server, "listening");
  const origin = `http://127.0.0.1:${server.address().port}`;
  const api = async (route, body) => {
    const response = await fetch(origin + "/api/suite/coding/" + route, { method: "POST", redirect: "error", headers: { Origin: origin, Authorization: "Bearer " + token, "Content-Type": "application/json" }, body: JSON.stringify({ compartment: "personal", ...body }), signal: AbortSignal.timeout(15000) });
    const value = await response.json(); assert.equal(response.status, 200, value.error); return value;
  };
  assert.equal((await api("authority/list", {})).length, 1); checks.push("saved synthetic task authority is listed without a provider request");
  const review = await api("execution/review", f.proposed); assert.equal(review.status, "requires-confirmation"); assert.equal(review.review.executionPolicy.network, "denied"); assert.equal(review.review.executionPolicy.hostRepositoryWritten, false); checks.push("exact recipe, input hashes, namespace and budget reviewed separately");
  const approval = { requestId: f.proposed.requestId, token: review.confirmation.token }, admission = await api("execution/apply", approval); assert.equal(admission.status, "running"); checks.push("one actual owned Linux program admitted through the authenticated API");
  let observed; const deadline = Date.now() + 10000;
  do { observed = await api("execution/status", { requestId: f.proposed.requestId }); if (observed.nativeExitVerified && !observed.stagingCleanupPending) break; await new Promise(resolve => setTimeout(resolve, 20)); } while (Date.now() < deadline);
  assert.equal(observed.nativeExitVerified, true); assert.equal(observed.stagingCleanupPending, false); assert.equal(observed.programExitCode, 0); assert.equal(observed.output, "exact reviewed run output"); assert.equal(observed.providerTaskCompletionVerified, false); assert.equal(observed.outcome.status, "running"); checks.push("independent process exit, original admission and cleanup remain separate facts");
  const duplicate = await api("execution/apply", approval); assert.equal(duplicate.replayed, true); assert.equal(duplicate.operationId, admission.operationId); assert.equal((await api("execution/list", {})).length, 1); checks.push("duplicate approval returns the original result without another execution");
  assert.equal(await f.run("rev-parse", "HEAD"), head); assert.deepEqual(await readFile(join(f.root, ".git/index")), index); assert.deepEqual(await readFile(join(f.root, "task.txt")), original); checks.push("original repository files, index and HEAD remain unchanged");
} catch (error) { failure = error; }
finally {
  try {
    if (server) { server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); await server.cleanup(); }
    await suite?.close();
    for (const cleanup of cleanups.reverse()) await cleanup();
    if (f) await assert.rejects(lstat(f.stage), { code: "ENOENT" });
  } catch (error) { failure ??= error; }
}
if (failure) throw failure;
console.log(JSON.stringify({ demonstration: "reviewed-execution", checks, success: true, syntheticProvider: true, actualLinuxProgram: true, existingAccountsUsed: false, modelRequests: 0, hardwareOpened: false, userWorkspacesUsed: false, ownedStagingRemoved: true, taskCompletionVerified: false }));
