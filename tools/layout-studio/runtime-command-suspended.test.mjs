import assert from "node:assert/strict";
import test from "node:test";
import { spawn } from "node:child_process";
import { createHash, randomUUID } from "node:crypto";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { runRuntimeCommand, runtimeGuardianStopped, runtimeSuspendedWorkerEvidence, runtimeWorkerStartFailureEvidence } from "./runtime-command.mjs";
import { desktopEnvironment } from "./process-environment.mjs";
import { runtimeEnvironment } from "./runtime-setup.mjs";

test("suspended-worker evidence binds one closed process identity to the reviewed executable and guardian", () => {
  const expected = { schema: "switchyard-runtime-command/v1", id: randomUUID(), guardianPid: 123, birth: "638000000000000000", executableSha256: "a".repeat(64) };
  const frame = { ...expected, event: "worker-suspended", containment: "windows-job", workerPid: 456, workerBirth: "638000000010000000" };
  const copy = runtimeSuspendedWorkerEvidence(frame, expected);
  assert.deepEqual(copy, frame); copy.workerPid = 789; assert.equal(frame.workerPid, 456);
  for (const change of [
    { schema: "other" }, { id: randomUUID() }, { guardianPid: 124 }, { birth: "638000000000000001" }, { executableSha256: "b".repeat(64) },
    { event: "ready" }, { containment: "owned-linux-session" }, { workerPid: 123 }, { workerPid: 0 }, { workerPid: 0x100000000 }, { workerPid: 1.5 },
    { workerBirth: "0" }, { workerBirth: "01" }, { workerBirth: 1 }, { workerBirth: "-1" }, { workerBirth: "1e3" }, { workerBirth: "1".repeat(20) },
    { path: "private-image" }, { tokenAccess: 8 }
  ]) assert.equal(runtimeSuspendedWorkerEvidence({ ...frame, ...change }, expected), undefined);
  for (const key of Object.keys(frame)) { const missing = { ...frame }; delete missing[key]; assert.equal(runtimeSuspendedWorkerEvidence(missing, expected), undefined); }
  for (const value of [null, [], {}, "worker"]) assert.equal(runtimeSuspendedWorkerEvidence(value, expected), undefined);
  for (const change of [{ id: "not-a-guid" }, { guardianPid: -1 }, { guardianPid: 1.5 }, { birth: "00" }, { executableSha256: "A".repeat(64) }]) {
    assert.equal(runtimeSuspendedWorkerEvidence({ ...frame, ...change }, { ...expected, ...change }), undefined);
  }
});

test("invalid or non-Windows worker callbacks refuse before a guardian can start", async () => {
  let started = false;
  for (const onWorkerSuspended of [null, true, {}, ...(process.platform === "win32" ? [] : [() => {}])]) {
    await assert.rejects(runRuntimeCommand(process.execPath, ["--version"], { onWorkerSuspended, onGuardianChild: () => { started = true; } }), /explicit Windows callback/);
  }
  assert.equal(started, false);
});

test("worker-start failure evidence admits only fixed stages and their numeric API errors", () => {
  for (const phase of ["stdin-pipe", "stdout-pipe", "stderr-pipe", "stdin-inheritance", "stdout-inheritance", "stderr-inheritance", "attribute-size", "attribute-initialize", "handles-attribute", "job-attribute", "process-create", "worker-id", "worker-birth"]) {
    for (const nativeCode of [null, 0, 5, 267, 0xffffffff]) {
      const value = { phase, nativeCode }, copy = runtimeWorkerStartFailureEvidence(value); assert.deepEqual(copy, value); copy.phase = "changed"; assert.equal(value.phase, phase);
    }
  }
  for (const phase of ["attribute-allocation", "handle-storage", "environment-block", "worker-streams"]) {
    assert.deepEqual(runtimeWorkerStartFailureEvidence({ phase, nativeCode: null }), { phase, nativeCode: null });
    assert.equal(runtimeWorkerStartFailureEvidence({ phase, nativeCode: 5 }), undefined);
  }
  for (const value of [null, [], {}, { phase: "process-create" }, { phase: "NEVER_RETAIN", nativeCode: null },
    ...["5", -1, 1.5, 0x100000000].map(nativeCode => ({ phase: "process-create", nativeCode })),
    { phase: "process-create", nativeCode: 5, path: "NEVER_RETAIN" }, { phase: "ready-write", nativeCode: null }, { phase: "process-create", nativeCode: null, treeExitVerified: true }
  ]) assert.equal(runtimeWorkerStartFailureEvidence(value), undefined);
});

const windowsHelper = process.env.SWITCHYARD_TEST_RUNTIME_HELPER;
const skip = process.platform !== "win32" ? "Requires actual Windows suspended-process and Job Object APIs" : !windowsHelper ? "Built helper runs in the native Windows guardian workflow step" : false;
const options = { windowsHelper, env: runtimeEnvironment(), timeout: 10000 };
const pause = ms => new Promise(resolve => setTimeout(resolve, ms));
async function fixture(fn) {
  const root = await mkdtemp(join(tmpdir(), "switchyard-suspended-"));
  try { await fn(root); } finally { await rm(root, { recursive: true, force: true }); }
}
async function stopped(scope) {
  for (let attempt = 0; attempt < 50; attempt++) {
    if (await runtimeGuardianStopped(scope, options)) return;
    await pause(100);
  }
  assert.fail("The exact suspended-worker guardian did not independently verify exit.");
}
const absent = path => assert.rejects(readFile(path), { code: "ENOENT" });

test("Windows worker creation failure reports only its fixed API stage after readiness and cannot authorize execution", { skip }, () => fixture(async root => {
  const marker = join(root, "must-not-run"); let scope, suspended = false;
  await assert.rejects(runRuntimeCommand(process.execPath, ["-e", `require('node:fs').writeFileSync(${JSON.stringify(marker)},'unexpected')`], {
    ...options, cwd: join(root, "missing-working-directory"), onGuardianReady: frame => { scope = frame; }, onWorkerSuspended: () => { suspended = true; }
  }), error => {
    assert.ok(scope); assert.equal(error.code, "RUNTIME_STOP_UNCONFIRMED");
    assert.deepEqual(error.runtimeWorkerStartFailure, { phase: "process-create", nativeCode: 267 });
    assert.equal(JSON.stringify(error).includes(root), false); return true;
  });
  assert.equal(suspended, false); await stopped(scope); await absent(marker);
}));

test("Windows holds the exact worker suspended until its identity acknowledgement completes", { skip }, () => fixture(async root => {
  const marker = join(root, "ran"), digest = createHash("sha256").update(await readFile(process.execPath)).digest("hex");
  let scope, calls = 0;
  const output = await runRuntimeCommand(process.execPath, ["-e", `require('node:fs').writeFileSync(${JSON.stringify(marker)},'yes');process.stdout.write(String(process.pid))`], {
    ...options, expectedExecutableSha256: digest, onGuardianReady: frame => { scope = frame; },
    onWorkerSuspended: async frame => {
      calls++; assert.ok(Object.isFrozen(frame)); assert.equal(frame.guardianPid, scope.guardianPid); assert.equal(frame.birth, scope.birth);
      assert.equal(frame.executableSha256, digest); assert.ok(frame.workerPid > 0); assert.notEqual(frame.workerPid, scope.guardianPid);
      assert.match(frame.workerBirth, /^[1-9][0-9]{0,18}$/); process.kill(frame.workerPid, 0);
      await absent(marker); await pause(150); await absent(marker);
      scope.workerPid = frame.workerPid;
    }
  });
  assert.equal(calls, 1); assert.equal(Number(output), scope.workerPid); assert.equal(await readFile(marker, "utf8"), "yes");
  let statusChildren = 0;
  assert.equal(await runtimeGuardianStopped(scope, { ...options, onGuardianChild: child => { assert.ok(child.pid > 0); statusChildren++; } }), true);
  assert.equal(statusChildren, 1);
  assert.equal(await runtimeGuardianStopped(scope, { ...options, onGuardianChild: () => { throw Error("synthetic registration refusal"); } }), false);
  await stopped(scope);
}));

test("Windows rejects a failed suspended-worker acknowledgement without executing its command", { skip }, () => fixture(async root => {
  const marker = join(root, "must-not-run"); let scope, calls = 0;
  await assert.rejects(runRuntimeCommand(process.execPath, ["-e", `require('node:fs').writeFileSync(${JSON.stringify(marker)},'unexpected')`], {
    ...options, onGuardianReady: frame => { scope = frame; }, onWorkerSuspended: async () => { calls++; await absent(marker); throw Error("synthetic registration refusal"); }
  }), error => { assert.match(error.message, /suspended native worker acknowledgement/); assert.equal(error.code, "RUNTIME_STOP_UNCONFIRMED"); return true; });
  assert.equal(calls, 1); await stopped(scope); await absent(marker);
}));

test("Windows cancellation during suspended-worker registration prevents execution and verifies exact Job exit", { skip }, () => fixture(async root => {
  const marker = join(root, "must-not-run"), controller = new AbortController(); let scope, calls = 0;
  await assert.rejects(runRuntimeCommand(process.execPath, ["-e", `require('node:fs').writeFileSync(${JSON.stringify(marker)},'unexpected')`], {
    ...options, signal: controller.signal, onGuardianReady: frame => { scope = frame; },
    onWorkerSuspended: async () => { calls++; await absent(marker); controller.abort(); await pause(50); }
  }), error => { assert.match(error.message, /Cancellation/); assert.equal(error.code, "RUNTIME_STOP_UNCONFIRMED"); return true; });
  assert.equal(calls, 1); await stopped(scope); await absent(marker);
}));

test("Windows refuses changed, duplicate, missing, absent and overdue suspended-worker acknowledgements", { skip }, () => fixture(async root => {
  const digest = createHash("sha256").update(await readFile(process.execPath)).digest("hex");
  const changes = [
    value => ({ ...value, schema: "other" }), value => ({ ...value, id: randomUUID() }), value => ({ ...value, workerPid: value.workerPid + 1 }),
    value => ({ ...value, workerBirth: "1" }), value => ({ ...value, executableSha256: "0".repeat(64) }), value => ({ ...value, startWorker: false }),
    value => ({ ...value, extra: true }), value => { const copy = { ...value }; delete copy.workerBirth; return copy; },
    value => JSON.stringify(value).replace(/}$/, ',"startWorker":true}'), () => null, () => "timeout"
  ];
  for (const [index, change] of changes.entries()) {
    const marker = join(root, `must-not-run-${index}`), id = randomUUID();
    const child = spawn(windowsHelper, ["--runtime-command"], { shell: false, windowsHide: true, stdio: ["pipe", "pipe", "ignore"], env: desktopEnvironment() });
    let scope, suspended = false, buffer = "", failed;
    child.stdin.on("error", () => {}); child.stdout.setEncoding("utf8");
    const exit = new Promise((resolve, reject) => { child.once("error", reject); child.once("close", code => resolve(code)); });
    const timer = setTimeout(() => { failed = Error("The native acknowledgement refusal exceeded 15 seconds."); child.kill(); }, 15000);
    child.stdout.on("data", chunk => {
      buffer += chunk;
      try {
        assert.ok(buffer.length <= 4096);
        let end;
        while ((end = buffer.indexOf("\n")) >= 0) {
          const frame = JSON.parse(buffer.slice(0, end)); buffer = buffer.slice(end + 1);
          if (frame.event === "ready" && !scope) {
            scope = frame; assert.equal(frame.guardianPid, child.pid);
            child.stdin.write(JSON.stringify({ schema: frame.schema, id, start: true }) + "\n");
          } else {
            assert.ok(scope); assert.equal(suspended, false);
            assert.ok(runtimeSuspendedWorkerEvidence(frame, { schema: scope.schema, id, guardianPid: child.pid, birth: scope.birth, executableSha256: digest }));
            suspended = true;
            const value = change({ schema: scope.schema, id, workerPid: frame.workerPid, workerBirth: frame.workerBirth, executableSha256: digest, startWorker: true });
            if (value === null) child.stdin.end();
            else if (value !== "timeout") child.stdin.write((typeof value === "string" ? value : JSON.stringify(value)) + "\n");
          }
        }
      } catch (error) { failed = error; child.stdin.end(); }
    });
    child.stdin.write(JSON.stringify({ schema: "switchyard-runtime-command/v1", id, executable: process.execPath, executableSha256: digest,
      args: ["-e", `require('node:fs').writeFileSync(${JSON.stringify(marker)},'unexpected')`], cwd: root, environment: runtimeEnvironment(), timeoutMs: 1000, maxOutputBytes: 1024, workerAcknowledgement: true }) + "\n");
    try {
      assert.equal(await exit, 2); if (failed) throw failed; assert.equal(suspended, true); await stopped(scope); await absent(marker);
    } finally { clearTimeout(timer); if (child.exitCode === null && child.signalCode === null) child.kill(); }
  }
}));
