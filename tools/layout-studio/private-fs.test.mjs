import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm, open, lstat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { directoryIdentity, privateWrite, privateRead } from "./private-fs.mjs";

const stats = (ino = 1, link = false) => ({ isDirectory: () => true, isSymbolicLink: () => link, dev: 1, ino });
test("Windows private storage accepts DOS short-name/case aliases only after checking every ancestor and filesystem identity", async () => {
  const seen = [], path = "c:\\Users\\RUNNER~1\\AppData\\Local\\Temp\\private", canonical = "C:\\Users\\runneradmin\\AppData\\Local\\Temp\\private";
  await directoryIdentity(path, { platform: "win32", readStats: async (p) => { seen.push(p); return stats(); }, resolvePath: async () => canonical });
  assert.ok(seen.includes("c:\\Users\\RUNNER~1")); assert.ok(seen.includes("c:\\")); assert.ok(seen.includes(canonical));
});
test("Windows private storage rejects ancestor junctions, network roots, path traversal and different filesystem objects", async () => {
  const path = "C:\\Users\\name\\private", base = { platform: "win32", readStats: async () => stats(), resolvePath: async () => path };
  await assert.rejects(directoryIdentity(path, { ...base, readStats: async (p) => stats(1, p === "C:\\Users\\name") }), /links are prohibited/);
  for (const invalid of ["\\\\server\\share\\private", "C:\\Users\\..\\private", "C:\\private:stream"]) await assert.rejects(directoryIdentity(invalid, { ...base, readStats: async () => { throw new Error("Unsafe paths must not reach filesystem access"); }, resolvePath: async () => invalid }), /local drive/);
  await assert.rejects(directoryIdentity(path, { ...base, resolvePath: async () => "C:\\other", readStats: async (p) => stats(p === "C:\\other" ? 2 : 1) }), /identity changed/);
  await assert.rejects(directoryIdentity(path, { ...base, resolvePath: async () => "D:\\other" }), /local drive/);
});
test("Unix private storage retains exact canonical-path requirements", async () => {
  await assert.rejects(directoryIdentity("/private/alias", { platform: "linux", readStats: async () => stats(), resolvePath: async () => "/elsewhere" }), /ownership or permissions/);
});
test("native temporary storage writes atomically and reads back without assuming its path spelling", async () => {
  const root = await mkdtemp(join(tmpdir(), "switchyard-private-native-"));
  try { const path = join(root, "record.json"); await privateWrite(path, '{"value":1}'); await privateWrite(path, '{"value":2}'); assert.equal(await privateRead(path), '{"value":2}'); }
  finally { await rm(root, { recursive: true, force: true }); }
});

test("a private read retries a real atomic replacement without treating the old descriptor as current", async () => {
  const root = await mkdtemp(join(tmpdir(), "switchyard-private-replace-")); let calls = 0;
  try {
    const path = join(root, "record.json"); await privateWrite(path, '{"value":"before"}');
    const value = await privateRead(path, { openFile: async (...args) => { const f = await open(...args); if (++calls === 1) await privateWrite(path, '{"value":"after"}'); return f; } });
    assert.equal(value, '{"value":"after"}'); assert.equal(calls, 2);
    let attempts = 0;
    await assert.rejects(privateRead(path, { statName: async (p) => { attempts++; const s = await lstat(p); s.ino += 1; return s; } }), /changed repeatedly/);
    assert.equal(attempts, 4);
    await assert.rejects(privateRead(path, { statName: async (p) => { const s = await lstat(p); s.isSymbolicLink = () => true; return s; } }), /unsafe/);
  } finally { await rm(root, { recursive: true, force: true }); }
});
