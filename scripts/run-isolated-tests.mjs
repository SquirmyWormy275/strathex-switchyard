import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const localRuntime = "apps/windows-companion/test/local-runtime.test.ts";
const cases = [
  { file: "packages/protocol/test/b122.test.ts" },
  { file: "apps/windows-companion/test/control-plane.test.ts" },
  ...[
    "live Git snapshots, exact-target review, and mutation policy are concrete and fail closed",
    "filesystem, isolated-test, and sandbox brokers contain local state",
    "authenticated local IPC has a local health path",
    "named local controls use concrete broker paths and inspect staged changes",
    "companion IPC supplies the complete manifest and records a VS Code Git workspace safely"
  ].map((pattern) => ({ file: localRuntime, pattern }))
];

const limit = 64 * 1024;
async function runTest({ file, pattern }) {
  const args = ["--experimental-strip-types", "--test"];
  if (pattern) args.push("--test-name-pattern", `^${pattern.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}$`);
  args.push(file);
  await new Promise((resolveRun, rejectRun) => {
    const child = spawn(process.execPath, args, { cwd: root, shell: false, windowsHide: true, stdio: ["ignore", "pipe", "pipe"] });
    let output = ""; let settled = false;
    const add = (chunk) => { if (output.length < limit) output += chunk.toString().slice(0, limit - output.length); };
    child.stdout.on("data", add); child.stderr.on("data", add);
    const timer = setTimeout(() => {
      if (!settled) { settled = true; child.kill(); rejectRun(new Error(`Timed out after 45s: ${file}${pattern ? ` :: ${pattern}` : ""}\n${output}`)); }
    }, 45_000);
    child.once("error", (error) => { if (!settled) { settled = true; clearTimeout(timer); rejectRun(error); } });
    child.once("close", (code, signal) => {
      if (!settled) { settled = true; clearTimeout(timer); code === 0 ? resolveRun() : rejectRun(new Error(`Failed: ${file}${pattern ? ` :: ${pattern}` : ""} (exit ${code}, signal ${signal ?? "none"})\n${output}`)); }
    });
  });
}

for (const testCase of cases) {
  await runTest(testCase);
  process.stdout.write(`PASS isolated child: ${testCase.file}${testCase.pattern ? ` :: ${testCase.pattern}` : ""}\n`);
}
process.stdout.write(`PASS clean child exit: ${cases.length}/${cases.length} isolated test processes exited\n`);
