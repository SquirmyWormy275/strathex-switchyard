import test from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdtemp, mkdir, readFile, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { LinuxDisposableExecutionRootProvider, LinuxBubblewrapRepositoryProcessSupervisor } from "../../apps/linux-companion/src/linux-repository-runtime.ts";
import { runRuntimeCommand, runtimeGuardianStopped } from "./runtime-command.mjs";
const sha = v => createHash("sha256").update(v).digest("hex");

test("actual Linux namespace locks root/device writes and nested namespaces while enforcing aggregate temporary ENOSPC", { skip: process.platform !== "linux" }, async t => {
  const root = await mkdtemp(join(tmpdir(), "sx-namespace-budget-")), repository = join(root, "repository"), state = join(root, "state"), owners = [];
  await mkdir(repository); await mkdir(state, { mode: 0o700 }); let lease;
  t.after(async () => { for (const owner of owners) assert.equal(await runtimeGuardianStopped(owner), true); await lease?.release(); await rm(root, { recursive: true, force: true }); });
  const hostLimit = await readFile("/proc/sys/user/max_user_namespaces", "utf8");
  const program = `import assert from 'node:assert/strict';import{writeFile,open,statfs,readFile}from'node:fs/promises';import{spawnSync}from'node:child_process';
  assert.equal(await readFile('input.txt','utf8'),'exact reviewed input');await assert.rejects(writeFile('input.txt','no host write'));
  for(const path of ['/outside-budget','/etc/outside-budget','/dev/outside-budget','/dev/shm/outside-budget'])await assert.rejects(writeFile(path,'no unbounded temporary files'),{code:'EROFS'});
  await writeFile('/dev/null','character devices remain usable');const nested=spawnSync('/usr/bin/unshare',['--user','--map-root-user','/usr/bin/true'],{encoding:'utf8',timeout:1000,maxBuffer:4096});assert.equal(nested.error,undefined);assert.notEqual(nested.status,0);assert.match(nested.stderr,/Operation not permitted|No space left on device/);
  const fs=await statfs('/tmp');assert.equal(fs.bsize*fs.blocks,67108864);let written=0,full=false;const chunk=Buffer.alloc(1048576);
  for(const path of ['/tmp/first.bin','/tmp/second.bin','/tmp/third.bin']){const file=await open(path,'wx');try{for(let n=0;n<24;n++){await file.writeFile(chunk);written+=chunk.length;}}catch(error){assert.equal(error.code,'ENOSPC');full=true;}finally{await file.close();}if(full)break;}
  assert.equal(full,true);assert.ok(written>=48*1048576&&written<=67108864);process.stdout.write(JSON.stringify({rootAndDeviceReadOnly:true,nestedNamespacesDenied:true,temporaryBytes:67108864,aggregateEnospc:true}));`;
  await writeFile(join(repository, "probe.mjs"), program); await writeFile(join(repository, "input.txt"), "exact reviewed input");
  const inputs = [["probe.mjs", program], ["input.txt", "exact reviewed input"]].map(([path, bytes]) => ({ path, sha256: sha(bytes), size: Buffer.byteLength(bytes), classification: "non-production" }));
  lease = await new LinuxDisposableExecutionRootProvider(state).prepare({ action: "run_target", repositoryRoot: repository, isolation: "disposable", inputFiles: inputs });
  let result;
  const supervisor = new LinuxBubblewrapRepositoryProcessSupervisor({ start: async request => {
    result = await runRuntimeCommand(request.executable, request.args, { cwd: request.cwd, env: request.environment, linuxExecutable: request.linuxExecutable, timeout: 10000, maxOutputBytes: 16384, captureStderrBytes: 4096, detailed: true, onGuardianReady: async frame => { owners.push(frame); } });
    return { wait: async () => ({ code: result.exitCode, signal: null, terminalEvidence: "trusted" }) };
  } }, { additionalActions: ["run_target"], readOnlyDisposable: true });
  await supervisor.start({ action: "run_target", operationId: "synthetic-namespace-budget", targetSnapshotId: "a".repeat(64), repositoryRoot: repository, executionRoot: lease.root, isolation: "disposable", manifestSha256: "b".repeat(64), executable: process.execPath, executableSha256: sha(await readFile(process.execPath)), args: ["probe.mjs"], cwd: lease.root, environment: { LANG: "C" }, lifecycle: "foreground", timeoutMs: 10000, maxOutputBytes: 16384 });
  assert.equal(result.exitCode, 0, result.stderr); assert.deepEqual(JSON.parse(result.stdout), { rootAndDeviceReadOnly: true, nestedNamespacesDenied: true, temporaryBytes: 67108864, aggregateEnospc: true });
  assert.equal(await readFile(join(repository, "input.txt"), "utf8"), "exact reviewed input"); assert.equal(await readFile("/proc/sys/user/max_user_namespaces", "utf8"), hostLimit);
  assert.equal(owners.length, 1); assert.equal(await runtimeGuardianStopped(owners[0]), true);
});
