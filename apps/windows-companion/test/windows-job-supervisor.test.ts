import assert from "node:assert/strict";
import { createHash, generateKeyPairSync, sign } from "node:crypto";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Readable } from "node:stream";
import test from "node:test";

import { ProtectedJsonStore, stableJson, type JournalAuthenticator } from "../../../packages/control-plane/src/store.ts";
import type { RepositoryProcessStartRequest } from "../src/repository-runtime.ts";
import {
  WindowsJobObjectProcessSupervisor,
  type RepositorySupervisorHelperInvocation,
  type RepositorySupervisorHelperTransport
} from "../src/windows-job-supervisor.ts";

const digest = (value: string | Buffer): string => createHash("sha256").update(value).digest("hex");
const isolatedAuthenticator: JournalAuthenticator = {
  provider: "isolated-supervisor-test-authenticator",
  async seal(hash) { return `sealed:${hash}`; },
  async verify(hash, tag) { return tag === `sealed:${hash}`; }
};

class FakeTransport implements RepositorySupervisorHelperTransport {
  readonly invocations: RepositorySupervisorHelperInvocation[] = [];
  observeExitCode = 0;
  private readonly signing = generateKeyPairSync("ec", { namedCurve: "P-256" });
  private superviseResult?: { readonly code: number; readonly signal: NodeJS.Signals | null };
  private readonly superviseWaiters: Array<(result: { readonly code: number; readonly signal: NodeJS.Signals | null }) => void> = [];

  async finishSupervise(code: number, state: "completed" | "failed" | "timed_out" = code === 0 ? "completed" : "failed"): Promise<void> {
    const supervise = this.invocations.find((item) => item.mode === "supervise");
    if (!supervise) throw new Error("supervise invocation is absent");
    const request = JSON.parse(await readFile(supervise.requestPath, "utf8")) as Record<string, unknown>;
    const publicKeySpki = this.signing.publicKey.export({ type: "spki", format: "der" }).toString("base64");
    const unsigned = {
      schema: "sxsy-b122.repository-supervisor-terminal",
      version: 1,
      supervisorId: request.supervisorId,
      operationId: request.operationId,
      action: request.action,
      targetSnapshotId: request.targetSnapshotId,
      sessionId: request.sessionId,
      authorityId: request.authorityId,
      repositoryRoot: request.repositoryRoot,
      manifestSha256: request.manifestSha256,
      helperSha256: supervise.helperSha256,
      requestSha256: digest(await readFile(supervise.requestPath)),
      signingPublicKeySha256: digest(Buffer.from(publicKeySpki, "base64")),
      startedAt: "2026-08-24T00:00:00.000Z",
      finishedAt: "2026-08-24T00:00:05.000Z",
      state,
      exitCode: code,
      outputTruncated: false,
      effectDisposition: "committed"
    };
    const signature = sign("sha256", Buffer.from(stableJson(unsigned), "utf8"), this.signing.privateKey).toString("base64");
    await writeFile(String(request.terminalPath), `${JSON.stringify({ ...unsigned, signature })}\n`, "utf8");
    const result = { code, signal: null as NodeJS.Signals | null };
    this.superviseResult = result;
    for (const waiter of this.superviseWaiters.splice(0)) waiter(result);
  }

  async invoke(invocation: RepositorySupervisorHelperInvocation) {
    this.invocations.push(invocation);
    const request = JSON.parse(await readFile(invocation.requestPath, "utf8")) as Record<string, unknown>;
    if (invocation.mode === "supervise") {
      const publicKeySpki = this.signing.publicKey.export({ type: "spki", format: "der" }).toString("base64");
      await writeFile(invocation.statePath, JSON.stringify({
        schema: "sxsy-b122.repository-supervisor-state",
        version: 3,
        supervisorId: request.supervisorId,
        operationId: request.operationId,
        action: request.action,
        targetSnapshotId: request.targetSnapshotId,
        sessionId: request.sessionId,
        authorityId: request.authorityId,
        repositoryRoot: request.repositoryRoot,
        manifestSha256: request.manifestSha256,
        helperPath: invocation.helperPath,
        helperSha256: invocation.helperSha256,
        requestSha256: digest(await readFile(invocation.requestPath)),
        signingPublicKeySpki: publicKeySpki,
        signingPublicKeySha256: digest(Buffer.from(publicKeySpki, "base64")),
        jobName: `Local\\SxsyB122-${String(request.supervisorId).slice("managed:".length)}`,
        supervisorPid: 41230,
        childPid: 41231,
        startedAt: "2026-08-24T00:00:00.000Z",
        state: "running",
        exitCode: null,
        outputTruncated: false
      }), "utf8");
    } else if (invocation.mode === "terminate") {
      await this.finishSupervise(130, "failed");
    }
    return {
      stdout: Readable.from(invocation.mode === "supervise" ? ["bounded"] : []),
      stderr: Readable.from([]),
      wait: async () => {
        if (invocation.mode !== "supervise") return { code: invocation.mode === "observe" ? this.observeExitCode : 0, signal: null as NodeJS.Signals | null };
        const ready = this.superviseResult;
        if (ready) return ready;
        return new Promise<{ readonly code: number; readonly signal: NodeJS.Signals | null }>((resolveResult) => { this.superviseWaiters.push(resolveResult); });
      }
    };
  }
}

async function setup(context: test.TestContext) {
  const base = await mkdtemp(join(tmpdir(), "sxsy-b122-job-supervisor-"));
  const repositoryRoot = join(base, "repository");
  const stateRoot = join(base, "host-state");
  const helperPath = join(base, "b122-repository-runner.exe");
  const executable = join(base, "target.exe");
  const protectedStore = new ProtectedJsonStore({
    filePath: join(base, "protected.jsonl"),
    authenticator: isolatedAuthenticator,
    requireAuthenticatedProtection: true
  });
  await Promise.all([mkdir(repositoryRoot), mkdir(stateRoot)]);
  await writeFile(helperPath, "reviewed-helper", "utf8");
  await writeFile(executable, "reviewed-target", "utf8");
  context.after(async () => { await rm(base, { recursive: true, force: true }); });
  return { base, repositoryRoot, stateRoot, helperPath, executable, protectedStore };
}

function request(values: Awaited<ReturnType<typeof setup>>): RepositoryProcessStartRequest {
  return {
    action: "run_target",
    operationId: "operation-job-test",
    targetSnapshotId: "b".repeat(64),
    sessionId: "session-job-test",
    authorityId: "authority-job-test",
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
    protectedStore: values.protectedStore,
    transport
  });
  const process = await supervisor.start(request(values));

  assert.equal(process.action, "run_target");
  assert.equal(process.targetSnapshotId, "b".repeat(64));
  assert.equal(process.pid, 41231);
  assert.equal((await readFile(transport.invocations[0]!.requestPath, "utf8")).includes("PATH"), false);
  assert.deepEqual(transport.invocations[0]?.environment, {});
  const requestSha256 = digest(await readFile(transport.invocations[0]!.requestPath));
  assert.deepEqual(transport.invocations[0]?.arguments, [
    "--supervise",
    transport.invocations[0]!.requestPath,
    transport.invocations[0]!.statePath,
    requestSha256
  ], "the helper must parse only the exact request bytes pinned before spawn");
  const persisted = JSON.parse(await readFile(transport.invocations[0]!.requestPath, "utf8")) as Record<string, unknown>;
  assert.equal(persisted.version, 3);
  assert.equal(persisted.targetSnapshotId, "b".repeat(64));
  assert.equal(persisted.sessionId, "session-job-test");
  assert.equal(persisted.authorityId, "authority-job-test");
  const protectedEntries = await values.protectedStore.readEntries();
  assert.equal(protectedEntries.filter((entry) => entry.kind === "b122.repository-supervisor.binding.v1").length, 1,
    "the full immutable launch binding must be authenticated before the child is released");
  assert.equal(await readFile(String(persisted.bindingAckPath), "utf8").then((value) => value.trim()), requestSha256);
  await process.terminateTree(50, 100);
  assert.deepEqual(transport.invocations.map((item) => item.mode), ["supervise", "terminate"]);
  assert.deepEqual(transport.invocations[1]?.arguments, [
    "--terminate",
    transport.invocations[1]!.requestPath,
    transport.invocations[1]!.statePath,
    requestSha256,
    "50",
    "100"
  ], "termination must retain the same immutable operation/action/target/root request binding");
  const cancelled = await supervisor.observeOperation({
    operationId: process.operationId,
    action: process.action,
    targetSnapshotId: process.targetSnapshotId,
    repositoryRoot: values.repositoryRoot,
    manifestSha256: "a".repeat(64),
    sessionId: "session-job-test",
    authorityId: "authority-job-test"
  });
  assert.equal(cancelled.state, "terminal");
  if (cancelled.state !== "terminal") throw new Error("expected current-host termination evidence");
  assert.equal(cancelled.status, "cancelled");
  assert.equal(cancelled.effectDisposition, "committed", "killing a process tree does not prove rollback of prior repository effects");
});

test("restart recovery accepts only matching live helper state and rejects tamper or stale helper digests", async (context) => {
  const values = await setup(context);
  const transport = new FakeTransport();
  const options = { helperPath: values.helperPath, helperSha256: digest("reviewed-helper"), stateRoot: values.stateRoot, protectedStore: values.protectedStore, transport };
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

test("restart observation rejects forged terminal files and keeps an inactive exact Job ambiguous without replay", async (context) => {
  const values = await setup(context);
  const transport = new FakeTransport();
  const options = { helperPath: values.helperPath, helperSha256: digest("reviewed-helper"), stateRoot: values.stateRoot, protectedStore: values.protectedStore, transport };
  const first = new WindowsJobObjectProcessSupervisor(options);
  const started = await first.start(request(values));
  const statePath = transport.invocations[0]!.statePath;
  const requestPath = transport.invocations[0]!.requestPath;
  const binding = {
    operationId: "operation-job-test",
    action: "run_target" as const,
    targetSnapshotId: "b".repeat(64),
    repositoryRoot: values.repositoryRoot,
    manifestSha256: "a".repeat(64),
    sessionId: "session-job-test",
    authorityId: "authority-job-test"
  };

  const restartedLive = new WindowsJobObjectProcessSupervisor(options);
  const live = await restartedLive.observeOperation(binding);
  assert.equal(live.state, "active");
  assert.equal(live.operationId, binding.operationId);
  assert.equal(live.action, binding.action);
  assert.equal(live.targetSnapshotId, binding.targetSnapshotId);
  assert.equal(live.sessionId, binding.sessionId);
  assert.equal(live.authorityId, binding.authorityId);

  const exactRequest = JSON.parse(await readFile(requestPath, "utf8")) as Record<string, unknown>;
  await writeFile(requestPath, JSON.stringify({ ...exactRequest, supervisorId: `managed:${"f".repeat(64)}` }), "utf8");
  await assert.rejects(
    restartedLive.observeOperation(binding),
    /supervisor.*(?:file|path|identity)|request.*(?:file|path|identity|digest)|authenticated|immutable/i,
    "a same-user request rewrite cannot redirect trusted terminal lookup to another Job identity"
  );
  await writeFile(requestPath, `${JSON.stringify(exactRequest)}\n`, "utf8");

  const terminalState = JSON.parse(await readFile(statePath, "utf8")) as Record<string, unknown>;
  await writeFile(statePath, JSON.stringify({ ...terminalState, state: "completed", exitCode: 0 }), "utf8");
  const restartedTerminal = new WindowsJobObjectProcessSupervisor(options);
  const forgedWhileLive = await restartedTerminal.observeOperation(binding);
  assert.equal(forgedWhileLive.state, "active", "a same-user repository child must not forge completion by replacing its readable state JSON");

  transport.observeExitCode = 3;
  const inactiveAfterRestart = await restartedTerminal.observeOperation(binding);
  assert.equal(inactiveAfterRestart.state, "active", "an inactive exact Job plus untrusted disk state cannot prove success, no-effect failure, or compensation");
  assert.equal(inactiveAfterRestart.effectDisposition, "ambiguous");
  assert.match(inactiveAfterRestart.summary, /inactive|terminal evidence|ambiguous|cannot prove/i);
  assert.equal((await restartedTerminal.observeOperation({ ...binding, operationId: "another-operation" })).state, "not_owner");
  assert.equal((await restartedTerminal.observeOperation({ ...binding, targetSnapshotId: "c".repeat(64) })).state, "not_owner");
  assert.equal((await restartedTerminal.observeOperation({ ...binding, sessionId: "other-session" })).state, "not_owner");
  assert.equal((await restartedTerminal.observeOperation({ ...binding, authorityId: "other-authority" })).state, "not_owner");

  await transport.finishSupervise(0);
  await started.wait();
  const trustedCurrentHost = await first.observeOperation(binding);
  assert.equal(trustedCurrentHost.state, "terminal", "the current host may accept the live helper process exit it directly owns");
  if (trustedCurrentHost.state !== "terminal") throw new Error("expected current-host helper terminal evidence");
  assert.equal(trustedCurrentHost.status, "completed");
  assert.equal(trustedCurrentHost.effectDisposition, "committed");
  assert.equal(trustedCurrentHost.sessionId, binding.sessionId);
  assert.equal(trustedCurrentHost.authorityId, binding.authorityId);
  assert.match(trustedCurrentHost.evidenceDigest!, /^[a-f0-9]{64}$/);

  transport.observeExitCode = 70;
  const unknown = await new WindowsJobObjectProcessSupervisor(options).observeOperation(binding);
  assert.equal(unknown.state, "terminal", "the authenticated helper terminal receipt must dominate a later unavailable/stale kernel observation");
  if (unknown.state !== "terminal") throw new Error("expected persisted helper terminal truth");
  assert.equal(unknown.status, "completed");
  assert.equal(unknown.effectDisposition, "committed");
});

test("restart accepts only the authenticated original request and a signed helper terminal receipt", async (context) => {
  const values = await setup(context);
  const transport = new FakeTransport();
  const options = { helperPath: values.helperPath, helperSha256: digest("reviewed-helper"), stateRoot: values.stateRoot, protectedStore: values.protectedStore, transport };
  const first = new WindowsJobObjectProcessSupervisor(options);
  const started = await first.start(request(values));
  const requestPath = transport.invocations[0]!.requestPath;
  const original = await readFile(requestPath);
  const parsed = JSON.parse(original.toString("utf8")) as Record<string, unknown>;
  const binding = {
    operationId: "operation-job-test",
    action: "run_target" as const,
    targetSnapshotId: "b".repeat(64),
    repositoryRoot: values.repositoryRoot,
    manifestSha256: "a".repeat(64),
    sessionId: "session-job-test",
    authorityId: "authority-job-test"
  };

  for (const replacement of [
    { operationId: "substituted-operation" },
    { action: "launch_web_app" },
    { targetSnapshotId: "c".repeat(64) },
    { sessionId: "substituted-session" },
    { authorityId: "substituted-authority" },
    { repositoryRoot: values.base }
  ]) {
    await writeFile(requestPath, `${JSON.stringify({ ...parsed, ...replacement })}\n`, "utf8");
    await assert.rejects(() => new WindowsJobObjectProcessSupervisor(options).observeOperation(binding), /authenticated|immutable|request.*digest|binding/i);
  }
  await writeFile(requestPath, original);

  transport.observeExitCode = 3;
  await transport.finishSupervise(0);
  const statePath = String(parsed.statePath);
  const untrustedState = JSON.parse(await readFile(statePath, "utf8")) as Record<string, unknown>;
  await writeFile(statePath, `${JSON.stringify({ ...untrustedState, operationId: "state-file-substitution" })}\n`, "utf8");
  const restarted = new WindowsJobObjectProcessSupervisor(options);
  const terminal = await restarted.observeOperation(binding);
  assert.equal(terminal.state, "terminal", "a protected public-key pin plus exact signed terminal receipt must survive companion restart and an untrusted state-file rewrite");
  if (terminal.state !== "terminal") throw new Error("expected signed terminal evidence");
  assert.equal(terminal.status, "completed");
  assert.equal(terminal.effectDisposition, "committed");
  assert.equal(terminal.sessionId, binding.sessionId);
  assert.equal(terminal.authorityId, binding.authorityId);

  const terminalPath = String(parsed.terminalPath);
  const forged = JSON.parse(await readFile(terminalPath, "utf8")) as Record<string, unknown>;
  await writeFile(terminalPath, `${JSON.stringify({ ...forged, operationId: "substituted-operation" })}\n`, "utf8");
  const rejected = await new WindowsJobObjectProcessSupervisor(options).observeOperation(binding);
  assert.equal(rejected.state, "active", "an untrusted or mismatched terminal receipt must never settle the durable operation");
  assert.equal(rejected.effectDisposition, "ambiguous");
  await started.wait();
});
