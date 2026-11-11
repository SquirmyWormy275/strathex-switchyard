import test from "node:test";
import assert from "node:assert/strict";
import { captureWindowsScannerRuntime, assertWindowsScannerRuntime } from "./windows-scanner-runtime.mjs";

const identity = () => ({ canonicalPath: "C:\\fixed\\node.exe", sha256: "a".repeat(64), device: "1", inode: "2", size: 123, modifiedMs: 456 });
const options = capture => ({ platform: "win32", nodeVersion: "24.14.0", executable: identity().canonicalPath, capture });

test("Windows scanner runtime hashes the fixed executable twice and preserves exact file identity", async () => {
  const seen = [], value = await captureWindowsScannerRuntime(options(async path => { seen.push(path); return identity(); }));
  assert.deepEqual(seen, [identity().canonicalPath, identity().canonicalPath]);
  assert.deepEqual(value, { nodeVersion: "24.14.0", identity: identity() });
});
test("runtime version, platform, identity replacement and canonical alias are refused without fallback", async () => {
  let reads = 0; const read = async () => { reads++; return identity(); };
  for (const override of [{ platform: "linux" }, { nodeVersion: "24.14.1" }]) await assert.rejects(captureWindowsScannerRuntime({ ...options(read), ...override }));
  assert.equal(reads, 0);
  for (const field of ["sha256", "inode", "device", "size", "modifiedMs"]) {
    let calls = 0;
    await assert.rejects(captureWindowsScannerRuntime(options(async () => { const value = identity(); if (++calls === 2) value[field] = field === "sha256" ? "b".repeat(64) : typeof value[field] === "number" ? value[field] + 1 : "9"; return value; })), /identity changed/);
  }
  await assert.rejects(captureWindowsScannerRuntime({ ...options(read), executable: "C:\\alias\\node.exe" }), /identity changed/);
  await assert.rejects(captureWindowsScannerRuntime({ ...options(read), executable: "C:\\alias\\node.exe", resolveLinks: () => "C:\\fixed\\node.exe" }), /identity changed/);
  await assert.rejects(captureWindowsScannerRuntime({ ...options(read), executable: "C:\\alias\\node.exe", resolveLinks: () => { throw Error("missing"); } }), /identity changed/);
  for (const edit of [v => { v.identity.canonicalPath = "node.exe"; }, v => { v.identity.sha256 = "bad"; }, v => { v.identity.size = 0; }, v => { v.identity.inode = "-1"; }, v => { v.identity.modifiedMs = NaN; }]) {
    const value = { nodeVersion: "24.14.0", identity: identity() }; edit(value); assert.throws(() => assertWindowsScannerRuntime(value), /runtime identity/);
  }
});

test("a drive mapping without links reaches the same pinned runtime; its canonical identity is retained", async () => {
  const value = await captureWindowsScannerRuntime({ ...options(async () => identity()), executable: "B:\\fixed\\node.exe", resolveLinks: path => path });
  assert.deepEqual(value, { nodeVersion: "24.14.0", identity: identity() });
  let calls = 0;
  await assert.rejects(captureWindowsScannerRuntime({ ...options(async () => { const v = identity(); if (++calls === 2) v.inode = "9"; return v; }), executable: "B:\\fixed\\node.exe", resolveLinks: path => path }), /identity changed/);
});
