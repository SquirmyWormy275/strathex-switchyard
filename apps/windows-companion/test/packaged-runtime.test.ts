import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { access, mkdir, mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import test from "node:test";
import { JsonLineCompanionBridge } from "../../vscode-extension/src/companion-bridge.ts";
import { ProvisionedNamedPipeJsonLineTransport, WindowsDpapiSecretReader } from "../../vscode-extension/src/named-pipe-transport.ts";
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

async function registerWhenReady(bridge: JsonLineCompanionBridge): Promise<Awaited<ReturnType<JsonLineCompanionBridge["registerSession"]>>> {
  const deadline = Date.now() + 5_000;
  while (true) {
    const result = await bridge.registerSession({ id: "installed-extension", provider: "generic", surface: "vscode_window", capabilities: ["registered"], status: "unknown", plannedFiles: [], lastHeartbeat: new Date().toISOString(), adapterVersion: "installed-smoke", metadata: {} });
    if (result.ok || Date.now() >= deadline) return result;
    await new Promise((done) => setTimeout(done, 25));
  }
}

test("packed companion's declared binary starts with DPAPI protection and accepts configured extension registration", { skip: process.platform !== "win32" }, async (context) => {
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
  const entry = resolve(packageRoot, declaredBin);
  assert.equal(entry.startsWith(resolve(packageRoot)), true);
  assert.notEqual(entry, resolve("apps/windows-companion/dist/apps/windows-companion/src/main.js"));
  await access(entry);
  const child = spawn(process.execPath, [entry, "--isolated-test-state-directory", state], { cwd: process.cwd(), shell: false, windowsHide: true, env: environment });
  let stderr = ""; child.stderr.on("data", (chunk: Buffer) => { stderr += chunk.toString(); });
  context.after(async () => { if (child.exitCode === null) await terminateOwnedProcessTree(child, environment); await rm(testRoot, { recursive: true, force: true }); });
  const configurationPath = join(state, "authenticated-pipe.json");
  await waitFor(configurationPath).catch((error) => { throw new Error(`${error instanceof Error ? error.message : String(error)}\nchildExit=${child.exitCode}\n${stderr}`); });
  const receiptKeyPath = join(state, "receipt-evidence-key.json");
  await waitFor(receiptKeyPath).catch((error) => { throw new Error(`${error instanceof Error ? error.message : String(error)}\nchildExit=${child.exitCode}\n${stderr}`); });
  const receiptKey = JSON.parse(await readFile(receiptKeyPath, "utf8")) as Record<string, unknown>;
  assert.equal(receiptKey.schema, "sxsy-b122.receipt-evidence-key");
  assert.equal(receiptKey.protector, "windows-dpapi-current-user");
  assert.equal(typeof receiptKey.sealedKey, "string");
  assert.equal(Object.keys(receiptKey).includes("authenticationKey"), false);
  const bridge = new JsonLineCompanionBridge(new ProvisionedNamedPipeJsonLineTransport(configurationPath, new WindowsDpapiSecretReader()));
  const registered = await registerWhenReady(bridge);
  assert.equal(registered.ok, true, registered.ok ? stderr : `${registered.code}: ${registered.message}\n${stderr}`);
  const health = await bridge.health();
  assert.equal(health.ok, true, stderr);
});
