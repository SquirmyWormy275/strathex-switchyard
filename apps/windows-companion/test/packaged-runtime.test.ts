import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { access, mkdir, mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import test from "node:test";
// @ts-expect-error The repository-owned ESM verification harness is JavaScript.
import { createStrictTestEnvironment } from "../../../scripts/run-isolated-tests.mjs";
// @ts-expect-error The repository-owned process-tree supervisor is JavaScript.
import { terminateOwnedProcessTree } from "../../../scripts/test-support/process-tree.mjs";

async function run(executable: string, args: string[], cwd: string, environment: NodeJS.ProcessEnv): Promise<string> {
  return new Promise((resolveRun, rejectRun) => {
    const child = spawn(executable, args, { cwd, env: environment, shell: false, windowsHide: true, stdio: ["ignore", "pipe", "pipe"] });
    let stdout = "", stderr = "";
    child.stdout.on("data", (chunk: Buffer) => { stdout += chunk.toString(); });
    child.stderr.on("data", (chunk: Buffer) => { stderr += chunk.toString(); });
    child.once("error", rejectRun);
    child.once("close", (code) => code === 0 ? resolveRun(stdout) : rejectRun(new Error(`${executable} exited ${code}: ${stderr}`)));
  });
}

function npmCliPath(): string {
  const candidates = [
    process.env.npm_execpath,
    join(dirname(process.execPath), "node_modules", "npm", "bin", "npm-cli.js"),
    resolve(dirname(process.execPath), "..", "lib", "node_modules", "npm", "bin", "npm-cli.js")
  ].filter((candidate): candidate is string => Boolean(candidate));
  const npmCli = candidates.find((candidate) => existsSync(candidate));
  if (!npmCli) throw new Error("The packaged-runtime test requires a pinned npm CLI entrypoint.");
  return npmCli;
}

async function waitFor(path: string, milliseconds = 10_000): Promise<void> {
  const deadline = Date.now() + milliseconds;
  while (true) {
    try { await access(path); return; } catch { if (Date.now() >= deadline) throw new Error("The packaged companion did not create its local configuration."); await new Promise((done) => setTimeout(done, 25)); }
  }
}

test("JavaScript-only companion package declares its binary and fails closed without the verified native Windows bundle", { skip: process.platform !== "win32" }, async (context) => {
  const testRoot = await mkdtemp(join(tmpdir(), "sxsy-packaged-runtime-"));
  const state = join(testRoot, "state");
  const packDirectory = join(testRoot, "pack");
  const extractDirectory = join(testRoot, "extract");
  await Promise.all([mkdir(state), mkdir(packDirectory), mkdir(extractDirectory)]);
  // CurrentUser DPAPI requires the loaded Windows profile. All writable B122,
  // temporary, and npm state remains redirected to this test's own root.
  const environment = createStrictTestEnvironment(testRoot, process.env, { currentUserProfile: true });
  environment.SXSY_B122_STATE_DIR = state;
  const packed = JSON.parse(await run(process.execPath, [npmCliPath(), "pack", "--json", "--pack-destination", packDirectory, "--workspace", "@strathex/switchyard-companion"], process.cwd(), environment));
  assert.equal(packed.length, 1);
  const archive = join(packDirectory, packed[0].filename);
  const tar = join(environment.SystemRoot ?? "C:\\Windows", "System32", "tar.exe");
  await run(tar, ["-xzf", archive, "-C", extractDirectory], process.cwd(), environment);
  const packageRoot = join(extractDirectory, "package");
  const packageDocument = JSON.parse(await readFile(join(packageRoot, "package.json"), "utf8"));
  const declaredBin = typeof packageDocument.bin === "string" ? packageDocument.bin : packageDocument.bin?.["sxsy-b122-companion"];
  assert.equal(typeof declaredBin, "string");
  assert.equal(packageDocument.b122Distribution?.nativeHelpersIncluded, false);
  assert.equal(packageDocument.b122Distribution?.releaseEvidenceEligible, false);
  const entry = resolve(packageRoot, declaredBin);
  assert.equal(entry.startsWith(resolve(packageRoot)), true);
  assert.notEqual(entry, resolve("apps/windows-companion/dist/apps/windows-companion/src/main.js"));
  await access(entry);
  const child = spawn(process.execPath, [entry, "--isolated-test-state-directory", state], { cwd: process.cwd(), shell: false, windowsHide: true, env: environment });
  let stderr = ""; child.stderr.on("data", (chunk: Buffer) => { stderr += chunk.toString(); });
  context.after(async () => { if (child.exitCode === null) await terminateOwnedProcessTree(child, environment); await rm(testRoot, { recursive: true, force: true }); });
  const configurationPath = join(state, "authenticated-pipe.json");
  const exitCode = await new Promise<number>((resolveExit, rejectExit) => {
    const timeout = setTimeout(() => rejectExit(new Error("The JavaScript-only companion did not fail closed within the bounded interval.")), 10_000);
    child.once("close", (code) => { clearTimeout(timeout); resolveExit(code ?? -1); });
  });
  assert.equal(exitCode, 1, stderr);
  assert.match(stderr, /cannot start without the reviewed native supervisor helper/i);
  await assert.rejects(access(configurationPath));
});
