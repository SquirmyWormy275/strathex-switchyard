import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import test from "node:test";

import { runB122RawHidSimulation } from "../src/raw-hid-simulator.ts";

test("the product Raw-HID simulator exercises every chord and the complete replay lifecycle without hardware", () => {
  const receipt = runB122RawHidSimulation();

  assert.equal(receipt.schema, "sxsy-b122.raw-hid-simulation");
  assert.equal(receipt.version, 1);
  assert.equal(receipt.status, "passed");
  assert.equal(receipt.hardwareAccessed, false);
  assert.equal(receipt.networkAccessed, false);
  assert.equal(receipt.chordsExercised, 22 * 8);
  assert.equal(receipt.assignedChords, 65);
  assert.equal(receipt.unassignedChords, (22 * 8) - 65);
  assert.equal(receipt.duplicateAcknowledgedWithoutRedispatch, true);
  assert.equal(receipt.staleEpochRejected, true);
  assert.equal(receipt.corruptFrameRejected, true);
  assert.deepEqual(receipt.statusesExercised, ["booting", "ready", "busy", "degraded"]);
  assert.match(receipt.mapFingerprint, /^[a-f0-9]{16}$/);
});

test("the packaged simulator command emits one bounded machine-readable receipt and rejects ambient arguments", async () => {
  const manifest = JSON.parse(await readFile(resolve("apps/windows-companion/package.json"), "utf8")) as { bin?: Record<string, string> };
  assert.equal(manifest.bin?.["sxsy-b122-hid-simulator"], "dist/apps/windows-companion/src/raw-hid-simulator.js");
  const entry = resolve("apps/windows-companion/src/raw-hid-simulator.ts");
  const successful = await run(process.execPath, ["--disable-warning=ExperimentalWarning", "--experimental-transform-types", entry, "--self-test"]);
  assert.equal(successful.code, 0, successful.stderr);
  assert.equal(successful.stderr, "");
  const lines = successful.stdout.trim().split(/\r?\n/);
  assert.equal(lines.length, 1);
  const receipt = JSON.parse(lines[0]!) as { status: string; hardwareAccessed: boolean; chordsExercised: number };
  assert.deepEqual(receipt, { ...JSON.parse(lines[0]!), status: "passed", hardwareAccessed: false, chordsExercised: 176 });
  assert.ok(Buffer.byteLength(successful.stdout, "utf8") < 8 * 1024);

  const rejected = await run(process.execPath, ["--disable-warning=ExperimentalWarning", "--experimental-transform-types", entry, "--self-test", "--device", "ambient"]);
  assert.notEqual(rejected.code, 0);
  assert.match(rejected.stderr, /exactly --self-test/i);
  assert.equal(rejected.stdout, "");
});

function run(command: string, args: readonly string[]): Promise<{ code: number | null; stdout: string; stderr: string }> {
  return new Promise((resolveRun, rejectRun) => {
    const child = spawn(command, [...args], {
      cwd: process.cwd(),
      env: strictEnvironment(process.env),
      shell: false,
      windowsHide: true,
      stdio: ["ignore", "pipe", "pipe"]
    });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (chunk: Buffer) => { if (stdout.length < 16_384) stdout += chunk.toString("utf8"); });
    child.stderr.on("data", (chunk: Buffer) => { if (stderr.length < 16_384) stderr += chunk.toString("utf8"); });
    child.once("error", rejectRun);
    child.once("close", (code) => resolveRun({ code, stdout, stderr }));
  });
}

function strictEnvironment(source: NodeJS.ProcessEnv): NodeJS.ProcessEnv {
  const result: NodeJS.ProcessEnv = {};
  for (const key of ["SystemRoot", "WINDIR", "TEMP", "TMP"]) if (source[key]) result[key] = source[key];
  return result;
}
