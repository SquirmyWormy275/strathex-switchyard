import { createHash, randomUUID } from "node:crypto";
import { spawn } from "node:child_process";
import { mkdir, rename, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { dirname, join, resolve } from "node:path";

export const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
export const receiptDirectory = join(root, ".sxsy-verification");
const localRuntime = "apps/windows-companion/test/local-runtime.test.ts";
export const requiredGroups = [
  { file: "packages/protocol/test/b122.test.ts" }, { file: "apps/windows-companion/test/control-plane.test.ts" },
  ...["live Git snapshots, exact-target review, and mutation policy are concrete and fail closed", "filesystem, isolated-test, and sandbox brokers contain local state", "authenticated local IPC has a local health path", "named local controls use concrete broker paths and inspect staged changes", "companion IPC supplies the complete manifest and records a VS Code Git workspace safely"].map((pattern) => ({ file: localRuntime, pattern }))
];
const limit = 64 * 1024;
const digest = (value) => createHash("sha256").update(value).digest("hex");
const patternArgument = (pattern) => pattern ? `^${pattern.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}$` : undefined;

/** A result is recorded only after close proves this owned child has exited. */
export async function runChild(group, { cwd = root, executable = process.execPath, timeoutMs = 45_000 } = {}) {
  const args = group.args ? [...group.args] : ["--experimental-strip-types", "--test"]; const pattern = group.args ? undefined : patternArgument(group.pattern); if (pattern) args.push("--test-name-pattern", pattern); if (!group.args) args.push(group.file);
  const startedAt = new Date().toISOString(); const started = Date.now();
  return new Promise((resolveChild) => {
    const child = spawn(executable, args, { cwd, shell: false, windowsHide: true, stdio: ["ignore", "pipe", "pipe"] }); let output = "", timedOut = false, spawnError = null;
    const add = (chunk) => { if (output.length < limit) output += chunk.toString().slice(0, limit - output.length); };
    child.stdout.on("data", add); child.stderr.on("data", add);
    const timer = setTimeout(() => { timedOut = true; child.kill(); }, timeoutMs);
    child.once("error", (error) => { spawnError = error.message; });
    child.once("close", (exitCode, signal) => { clearTimeout(timer); resolveChild({ file: group.file, pattern: group.pattern ?? null, command: [executable, ...args], startedAt, endedAt: new Date().toISOString(), durationMs: Date.now() - started, exitCode, signal: signal ?? null, timeout: timedOut, outputDigest: digest(output), outputBytes: Buffer.byteLength(output), spawnError, success: !timedOut && !spawnError && exitCode === 0 }); });
  });
}

async function writeReceipt(directory, receipt) { await mkdir(directory, { recursive: true }); const finalPath = join(directory, `isolated-test-${receipt.runId}.json`); const temporaryPath = `${finalPath}.${randomUUID()}.tmp`; await writeFile(temporaryPath, JSON.stringify(receipt, null, 2), { encoding: "utf8", mode: 0o600 }); await rename(temporaryPath, finalPath); return finalPath; }
export async function runVerification({ groups = requiredGroups, cwd = root, outputDirectory = receiptDirectory, executable = process.execPath, timeoutMs } = {}) {
  const runId = randomUUID(); const startedAt = new Date().toISOString(); const children = []; for (const group of groups) children.push(await runChild(group, { cwd, executable, timeoutMs }));
  const passed = children.filter((item) => item.success).length; const receipt = { version: 1, runId, startedAt, endedAt: new Date().toISOString(), requiredGroups: groups, children, totals: { required: groups.length, passed, failed: groups.length - passed }, success: passed === groups.length };
  return { receipt, receiptPath: await writeReceipt(outputDirectory, receipt) };
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) { const { receipt, receiptPath } = await runVerification(); for (const child of receipt.children) process.stdout.write(`${child.success ? "PASS" : "FAIL"} ${child.file}${child.pattern ? ` :: ${child.pattern}` : ""}\n`); process.stdout.write(`RECEIPT ${receipt.runId} ${receiptPath}\n`); process.exitCode = receipt.success ? 0 : 1; }
