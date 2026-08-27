import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import test from "node:test";

test("firmware verification distinguishes static-only checks from evidence-eligible C execution", () => {
  const root = resolve(import.meta.dirname, "..");
  const temporary = mkdtempSync(join(tmpdir(), "b122-compiler-receipt-"));
  const missingCompiler = join(temporary, "missing-c-compiler.exe");
  try {
    const staticReceipt = join(temporary, "static.json");
    const staticOnly = spawnSync(process.execPath, ["firmware/verify.mjs", "--c-compiler", missingCompiler, "--receipt", staticReceipt], { cwd: root, encoding: "utf8" });
    assert.equal(staticOnly.status, 0, staticOnly.stderr);
    assert.deepEqual(JSON.parse(readFileSync(staticReceipt, "utf8")), {
      schema: "sxsy-b122.firmware-verification",
      version: 1,
      status: "static-only",
      compilerRequired: false,
      compiled: false,
      protocolSelfTest: false,
      compiler: null,
      hardwareAccessed: false,
    });

    const requiredReceipt = join(temporary, "required.json");
    const required = spawnSync(process.execPath, ["firmware/verify.mjs", "--require-c-compiler", "--c-compiler", missingCompiler, "--receipt", requiredReceipt], { cwd: root, encoding: "utf8" });
    assert.notEqual(required.status, 0);
    assert.match(required.stderr, /requires a working C11 compiler/i);
    const failed = JSON.parse(readFileSync(requiredReceipt, "utf8"));
    assert.equal(failed.compilerRequired, true);
    assert.equal(failed.status, "static-only");
    assert.equal(failed.compiled, false);
    assert.equal(failed.hardwareAccessed, false);
  } finally {
    rmSync(temporary, { recursive: true, force: true });
  }
});
