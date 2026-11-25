import test from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdtemp, mkdir, readFile, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { RepositoryRuntime, verifyRepositoryRuntimeManifest } from "../../apps/windows-companion/src/repository-runtime.ts";
import { LinuxDisposableExecutionRootProvider, LinuxBubblewrapRepositoryProcessSupervisor } from "../../apps/linux-companion/src/linux-repository-runtime.ts";
import { runRuntimeCommand, runtimeGuardianStopped } from "./runtime-command.mjs";
const sha = v => createHash("sha256").update(v).digest("hex"), input = (path, bytes) => ({ path, sha256: sha(bytes), size: Buffer.byteLength(bytes), classification: "non-production" });

test("temporary-build is an exact disposable-input permission and a manifest cannot enable an unconnected host runtime", async t => {
  const repository = await mkdtemp(join(tmpdir(), "sx-workspace-permission-")); t.after(() => rm(repository, { recursive: true, force: true }));
  await writeFile(join(repository, "input.txt"), "synthetic");
  const recipe = { kind: "process", executable: process.execPath, args: ["input.txt"], cwd: ".", environment: {}, lifecycle: "foreground", isolation: "disposable", workspaceMode: "temporary-build", timeoutMs: 1000, maxOutputBytes: 1024, inputFiles: [input("input.txt", "synthetic")] };
  const document = r => Buffer.from(JSON.stringify({ schema: "sxsy-b122.repository-runtime", version: 1, repositoryRoot: repository, allowedHttpsUrls: [], recipes: { pipeline_local_gate: r } }));
  const bytes = document(recipe), verified = await verifyRepositoryRuntimeManifest(bytes, { expectedSha256: sha(bytes), repositoryRoot: repository });
  let started = 0, staged = 0;
  const runtime = new RepositoryRuntime(verified, { executionRoots: { prepare: async () => { staged++; throw Error("unconnected copy"); } }, processSupervisor: { start: async () => { started++; throw Error("uncontained host"); } } });
  const result = await runtime.execute("pipeline_local_gate", { operationId: "synthetic-disabled-workspace", targetSnapshotId: "a".repeat(64), effectGuard: { check: async () => ({ allowed: true, reason: "synthetic exact grant" }) } });
  assert.equal(result.status, "unavailable"); assert.equal(result.effectDisposition, "not_started"); assert.equal(started, 0); assert.equal(staged, 0);
  const readonlyBytes = document({ ...recipe, workspaceMode: "read-only" }), readonlyManifest = await verifyRepositoryRuntimeManifest(readonlyBytes, { expectedSha256: sha(readonlyBytes), repositoryRoot: repository });
  const readonly = await new RepositoryRuntime(readonlyManifest).execute("pipeline_local_gate", { operationId: "synthetic-unconnected-readonly", targetSnapshotId: "a".repeat(64), effectGuard: { check: async () => ({ allowed: true, reason: "synthetic grant" }) } }); assert.equal(readonly.status, "unavailable");
  for (const invalid of [{ ...recipe, workspaceMode: "host" }, { ...recipe, workspaceMode: true }, { ...recipe, isolation: "repository" }, { ...recipe, inputFiles: undefined }]) {
    const bytes = document(invalid); await assert.rejects(verifyRepositoryRuntimeManifest(bytes, { expectedSha256: sha(bytes), repositoryRoot: repository }), /workspaceMode/);
  }
});
test("a namespace cannot accept writable copies without the host enabling that exact capability", async () => {
  let calls = 0; const supervisor = new LinuxBubblewrapRepositoryProcessSupervisor({ start: async () => { calls++; } }, { additionalActions: ["run_target"], readOnlyDisposable: true });
  await assert.rejects(supervisor.start({ action: "run_target", isolation: "disposable", workspaceMode: "temporary-build" }), /not enabled bounded/); assert.equal(calls, 0);
  const unconnected = new LinuxBubblewrapRepositoryProcessSupervisor({ start: async () => { calls++; } });
  await assert.rejects(unconnected.start({ action: "run_target", isolation: "disposable", workspaceMode: "read-only" }), /not connected to this action/); assert.equal(calls, 0);
});
test("actual bounded overlay builds in a writable copy, shares quota with temporary files and preserves original inputs", { skip: process.platform !== "linux" }, async t => {
  const root = await mkdtemp(join(tmpdir(), "sx-writable-workspace-")), repository = join(root, "repository"), state = join(root, "state"), owners = []; await mkdir(repository); await mkdir(state, { mode: 0o700 }); let lease;
  t.after(async () => { for (const owner of owners) assert.equal(await runtimeGuardianStopped(owner), true); await lease?.release(); await rm(root, { recursive: true, force: true }); });
  const hostLimit = await readFile("/proc/sys/user/max_user_namespaces", "utf8");
  const program = `import assert from 'node:assert/strict';import{readFile,writeFile,mkdir,access,open,statfs,readdir}from'node:fs/promises';import{spawnSync}from'node:child_process';
  assert.equal(await readFile('input.txt','utf8'),'exact reviewed input');await writeFile('input.txt','changed only in the writable copy');await mkdir('build');await writeFile('build/output.mjs',"process.stdout.write('built inside bounded copy')");
  const built=spawnSync(process.execPath,['build/output.mjs'],{encoding:'utf8',timeout:1000,maxBuffer:4096});assert.equal(built.error,undefined);assert.equal(built.status,0,built.stderr);assert.equal(built.stdout,'built inside bounded copy');
  for(const path of ['/b122-inputs','/b122-build-storage'])await assert.rejects(access(path));assert.deepEqual(await readdir('/tmp'),[]);
  for(const path of ['/outside-budget','/etc/outside-budget','/dev/outside-budget','/dev/shm/outside-budget'])await assert.rejects(writeFile(path,'no alternate filesystem'),{code:'EROFS'});
  const nested=spawnSync('/usr/bin/unshare',['--user','--map-root-user','/usr/bin/true'],{encoding:'utf8',timeout:1000,maxBuffer:4096});assert.equal(nested.error,undefined);assert.notEqual(nested.status,0);assert.match(nested.stderr,/Operation not permitted|No space left on device/);
  for(const path of ['/workspace','/tmp']){const fs=await statfs(path);assert.equal(fs.bsize*fs.blocks,67108864);}let full=false,written=0;const chunk=Buffer.alloc(1048576);
  for(const path of ['build/first.bin','/tmp/second.bin','build/third.bin']){const file=await open(path,'wx');try{for(let n=0;n<24;n++){await file.writeFile(chunk);written+=chunk.length;}}catch(error){assert.equal(error.code,'ENOSPC');full=true;}finally{await file.close();}if(full)break;}
  assert.equal(full,true);assert.ok(written>=48*1048576&&written<=67108864);process.stdout.write(JSON.stringify({writableBuildSucceeded:true,combinedQuotaEnforced:true,hiddenControlPathsDenied:true,nestedNamespacesDenied:true}));`;
  await writeFile(join(repository, "probe.mjs"), program); await writeFile(join(repository, "input.txt"), "exact reviewed input");
  lease = await new LinuxDisposableExecutionRootProvider(state).prepare({ action: "run_target", repositoryRoot: repository, isolation: "disposable", inputFiles: [input("probe.mjs", program), input("input.txt", "exact reviewed input")] });
  let result;
  const supervisor = new LinuxBubblewrapRepositoryProcessSupervisor({ start: async request => {
    result = await runRuntimeCommand(request.executable, request.args, { cwd: request.cwd, env: request.environment, linuxExecutable: request.linuxExecutable, timeout: 10000, maxOutputBytes: 16384, captureStderrBytes: 4096, detailed: true, onGuardianReady: async frame => { owners.push(frame); } });
    return { wait: async () => ({ code: result.exitCode, signal: null, terminalEvidence: "trusted" }) };
  } }, { additionalActions: ["run_target"], readOnlyDisposable: true, temporaryBuilds: true });
  await supervisor.start({ action: "run_target", workspaceMode: "temporary-build", operationId: "synthetic-writable-workspace", targetSnapshotId: "a".repeat(64), repositoryRoot: repository, executionRoot: lease.root, isolation: "disposable", manifestSha256: "b".repeat(64), executable: process.execPath, executableSha256: sha(await readFile(process.execPath)), args: ["probe.mjs"], cwd: lease.root, environment: { LANG: "C" }, lifecycle: "foreground", timeoutMs: 10000, maxOutputBytes: 16384 });
  assert.equal(result.exitCode, 0, result.stderr); assert.deepEqual(JSON.parse(result.stdout), { writableBuildSucceeded: true, combinedQuotaEnforced: true, hiddenControlPathsDenied: true, nestedNamespacesDenied: true });
  assert.equal(await readFile(join(repository, "input.txt"), "utf8"), "exact reviewed input"); assert.equal(await readFile(join(lease.root, "input.txt"), "utf8"), "exact reviewed input"); assert.equal(await readFile("/proc/sys/user/max_user_namespaces", "utf8"), hostLimit);
  assert.equal(owners.length, 1); assert.equal(await runtimeGuardianStopped(owners[0]), true);
  // An explicit read-only declaration also fences a legacy caller whose
  // constructor otherwise allows disposable workspace writes.
  const readOnly = new LinuxBubblewrapRepositoryProcessSupervisor({ start: async request => {
    const result = await runRuntimeCommand(request.executable, request.args, { cwd: request.cwd, env: request.environment, linuxExecutable: request.linuxExecutable, timeout: 10000, maxOutputBytes: 4096, captureStderrBytes: 4096, detailed: true, onGuardianReady: async frame => { owners.push(frame); } });
    assert.equal(result.exitCode, 0, result.stderr); return { wait: async () => ({ code: result.exitCode, signal: null, terminalEvidence: "trusted" }) };
  } }, { additionalActions: ["run_target"] });
  await readOnly.start({ action: "run_target", workspaceMode: "read-only", operationId: "synthetic-explicit-readonly", targetSnapshotId: "a".repeat(64), repositoryRoot: repository, executionRoot: lease.root, isolation: "disposable", manifestSha256: "b".repeat(64), executable: process.execPath, executableSha256: sha(await readFile(process.execPath)), args: ["--input-type=module", "-e", "import assert from 'node:assert/strict';import{writeFile}from'node:fs/promises';await assert.rejects(writeFile('input.txt','denied'),{code:'EROFS'});"], cwd: lease.root, environment: {}, lifecycle: "foreground", timeoutMs: 10000, maxOutputBytes: 4096 });
  assert.equal(owners.length, 2); assert.equal(await readFile(join(lease.root, "input.txt"), "utf8"), "exact reviewed input");
});
