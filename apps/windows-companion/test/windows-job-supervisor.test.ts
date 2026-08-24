import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Readable } from "node:stream";
import test from "node:test";

import type { RepositoryProcessStartRequest } from "../src/repository-runtime.ts";
import {
  WindowsJobObjectProcessSupervisor,
  type RepositorySupervisorHelperInvocation,
  type RepositorySupervisorHelperTransport
} from "../src/windows-job-supervisor.ts";

const digest = (value: string | Buffer): string => createHash("sha256").update(value).digest("hex");

class FakeTransport implements RepositorySupervisorHelperTransport {
  readonly invocations: RepositorySupervisorHelperInvocation[] = [];
  async invoke(invocation: RepositorySupervisorHelperInvocation) {
    this.invocations.push(invocation);
    const request = JSON.parse(await readFile(invocation.requestPath, "utf8")) as Record<string, unknown>;
    if (invocation.mode === "supervise") {
      await writeFile(invocation.statePath, JSON.stringify({
        schema: "sxsy-b122.repository-supervisor-state",
        version: 1,
        supervisorId: request.supervisorId,
        operationId: request.operationId,
        action: request.action,
        repositoryRoot: request.repositoryRoot,
        manifestSha256: request.manifestSha256,
      helperPath: invocation.helperPath,
      helperSha256: invocation.helperSha256,
      requestSha256: digest(await readFile(invocation.requestPath)),
      controlTokenSha256: digest(String(request.controlToken)),
      jobName: `Local\\SxsyB122-${String(request.supervisorId).slice("managed:".length)}`,
        supervisorPid: 41230,
        childPid: 41231,
        startedAt: "2026-08-24T00:00:00.000Z",
        state: "running",
        exitCode: null,
        outputTruncated: false
      }), "utf8");
    } else if (invocation.mode === "terminate") {
      const state = JSON.parse(await readFile(invocation.statePath, "utf8")) as Record<string, unknown>;
      await writeFile(invocation.statePath, JSON.stringify({ ...state, state: "cancelled", exitCode: 130 }), "utf8");
    }
    return {
      stdout: Readable.from(invocation.mode === "supervise" ? ["bounded"] : []),
      stderr: Readable.from([]),
      wait: async () => ({ code: 0, signal: null as NodeJS.Signals | null })
    };
  }
}

async function setup(context: test.TestContext) {
  const base = await mkdtemp(join(tmpdir(), "sxsy-b122-job-supervisor-"));
  const repositoryRoot = join(base, "repository");
  const stateRoot = join(base, "host-state");
  const helperPath = join(base, "b122-repository-runner.exe");
  const executable = join(base, "target.exe");
  await Promise.all([mkdir(repositoryRoot), mkdir(stateRoot)]);
  await writeFile(helperPath, "reviewed-helper", "utf8");
  await writeFile(executable, "reviewed-target", "utf8");
  context.after(async () => { await rm(base, { recursive: true, force: true }); });
  return { base, repositoryRoot, stateRoot, helperPath, executable };
}

function request(values: Awaited<ReturnType<typeof setup>>): RepositoryProcessStartRequest {
  return {
    action: "run_target",
    operationId: "operation-job-test",
    repositoryRoot: values.repositoryRoot,
    manifestSha256: "a".repeat(64),
    executable: values.executable,
    executableSha256: digest("reviewed-target"),
    args: ["--fixed"],
    cwd: values.repositoryRoot,
    environment: { SystemRoot: "C:\\Windows", SXSY_MODE: "test" },
    lifecycle: "managed",
    timeoutMs: 10_000,
    maxOutputBytes: 4_096
  };
}

test("Windows supervisor persists an exact hash-bound launch and never sends ambient environment or a shell", async (context) => {
  const values = await setup(context);
  const transport = new FakeTransport();
  const supervisor = new WindowsJobObjectProcessSupervisor({
    helperPath: values.helperPath,
    helperSha256: digest("reviewed-helper"),
    stateRoot: values.stateRoot,
    transport
  });
  const process = await supervisor.start(request(values));

  assert.equal(process.action, "run_target");
  assert.equal(process.pid, 41231);
  assert.equal((await readFile(transport.invocations[0]!.requestPath, "utf8")).includes("PATH"), false);
  assert.deepEqual(transport.invocations[0]?.environment, {});
  assert.deepEqual(transport.invocations[0]?.arguments.slice(0, 1), ["--supervise"]);
  await process.terminateTree(50, 100);
  assert.deepEqual(transport.invocations.map((item) => item.mode), ["supervise", "terminate"]);
});

test("restart recovery accepts only matching live helper state and rejects tamper or stale helper digests", async (context) => {
  const values = await setup(context);
  const transport = new FakeTransport();
  const options = { helperPath: values.helperPath, helperSha256: digest("reviewed-helper"), stateRoot: values.stateRoot, transport };
  const first = new WindowsJobObjectProcessSupervisor(options);
  const started = await first.start(request(values));

  const restarted = new WindowsJobObjectProcessSupervisor(options);
  const recovered = await restarted.recover({ repositoryRoot: values.repositoryRoot, manifestSha256: "a".repeat(64) });
  assert.equal(recovered.length, 1);
  assert.equal(recovered[0]?.supervisorId, started.supervisorId);
  assert.equal(recovered[0]?.recovered, true);

  await writeFile(values.helperPath, "tampered-helper", "utf8");
  await assert.rejects(restarted.recover({ repositoryRoot: values.repositoryRoot, manifestSha256: "a".repeat(64) }), /helper.*digest|changed/i);
});
