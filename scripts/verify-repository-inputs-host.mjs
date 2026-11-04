#!/usr/bin/env node
/** Explicit actual Linux namespace proof; disposable synthetic inputs only. */
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { mkdtemp, mkdir, writeFile, readFile, access, rm, readdir } from "node:fs/promises";
import { tmpdir, homedir } from "node:os";
import { join } from "node:path";
import { createServer } from "node:net";
import { once } from "node:events";
import { LinuxDisposableExecutionRootProvider, LinuxBubblewrapRepositoryProcessSupervisor } from "../apps/linux-companion/src/linux-repository-runtime.ts";
import { privateWrite } from "../tools/layout-studio/private-fs.mjs";
if (process.platform !== "linux" || process.argv.length !== 3 || process.argv[2] !== "--synthetic") throw Error("Usage: node --experimental-transform-types scripts/verify-repository-inputs-host.mjs --synthetic (bounded actual Bubblewrap proof with synthetic files)");
const stage = await mkdtemp(join(tmpdir(), "switchyard-inputs-native-")), repository = join(stage, "repository"), state = join(stage, "state"), checks = [];
const listener = createServer(socket => socket.destroy()); listener.listen(0, "127.0.0.1"); await once(listener, "listening");
let lease, failure;
try {
  await mkdir(repository); await mkdir(state, { mode: 0o700 });
  const outside = join(stage, "private-synthetic"), program = `import assert from 'node:assert/strict'; import {access} from 'node:fs/promises'; import {createConnection} from 'node:net';
for(const path of ['.env','/etc/passwd',${JSON.stringify(outside)},${JSON.stringify(homedir())}]) await assert.rejects(access(path));
for(const name of ['HOME','SSH_AUTH_SOCK','DBUS_SESSION_BUS_ADDRESS','OPENAI_API_KEY','ANTHROPIC_API_KEY']) assert.equal(process.env[name],undefined);
const connected=await new Promise(resolve=>{const socket=createConnection({host:'127.0.0.1',port:${listener.address().port}}); const finish=value=>{socket.destroy();resolve(value)};socket.once('connect',()=>finish(true));socket.once('error',()=>finish(false));socket.setTimeout(1000,()=>finish(false))});assert.equal(connected,false);
process.stdout.write(JSON.stringify({success:true,inputRead:true,unselectedFilesDenied:true,hostHomeDenied:true,hostEtcDenied:true,ambientCredentialsDenied:true,hostLoopbackDenied:true}));`;
  await writeFile(join(repository, "probe.mjs"), program); await writeFile(join(repository, ".env"), "synthetic credential"); await writeFile(outside, "synthetic private data");
  const provider = new LinuxDisposableExecutionRootProvider(state), input = { path: "probe.mjs", sha256: createHash("sha256").update(program).digest("hex"), size: Buffer.byteLength(program), classification: "non-production" };
  lease = await provider.prepare({ action: "pipeline_local_gate", repositoryRoot: repository, isolation: "disposable", inputFiles: [input] });
  assert.deepEqual(await readdir(lease.root), ["probe.mjs"]); checks.push("only the one exact reviewed file was staged; unselected synthetic credentials remained outside");
  let result;
  const inner = { start: async request => { result = await promisify(execFile)(request.executable, request.args, { cwd: request.cwd, env: request.environment, timeout: 15000, maxBuffer: 16384, encoding: "utf8" }); return {}; } };
  const supervisor = new LinuxBubblewrapRepositoryProcessSupervisor(inner);
  await supervisor.start({ action: "pipeline_local_gate", operationId: "synthetic-input-namespace", targetSnapshotId: "a".repeat(64), repositoryRoot: repository, executionRoot: lease.root, isolation: "disposable", manifestSha256: "b".repeat(64), executable: process.execPath, executableSha256: createHash("sha256").update(await readFile(process.execPath)).digest("hex"), args: ["probe.mjs"], cwd: lease.root, environment: { LANG: "C" }, lifecycle: "foreground", timeoutMs: 15000, maxOutputBytes: 16384 });
  assert.equal(result.stderr, ""); const observed = JSON.parse(result.stdout); assert.equal(Object.values(observed).every(v => v === true), true);
  checks.push("actual fixed Bubblewrap namespace denied host home, host /etc, unselected files, ambient credential variables and a live host loopback listener");
  await lease.release(); await assert.rejects(access(lease.root), { code: "ENOENT" }); lease = null;
  assert.equal(await readFile(join(repository, ".env"), "utf8"), "synthetic credential"); assert.equal(await readFile(outside, "utf8"), "synthetic private data");
  checks.push("owned disposable inputs were removed and original synthetic files were unchanged; no runtime was copied");
} catch (error) { failure = error; }
finally { await new Promise(resolve => listener.close(resolve)); try { await lease?.release(); if (!failure) await rm(stage, { recursive: true }); } catch (error) { failure ??= error; } }
const receipt = join(homedir(), ".local/state/strathex-switchyard/runtime-verification", `repository-inputs-native-${Date.now()}.json`);
await privateWrite(receipt, JSON.stringify({ schema: "switchyard-repository-inputs-native/v1", at: new Date().toISOString(), success: !failure, checks, failure: failure?.message ?? null, generalExecutionSuiteConnected: false, windowsSandboxVerified: false, frontendChanged: false, ...(failure ? { retainedSyntheticStage: stage } : {}) }, null, 2) + "\n");
console.log(JSON.stringify({ receipt, success: !failure, checks: checks.length, retainedSyntheticStage: Boolean(failure) })); if (failure) throw failure;
