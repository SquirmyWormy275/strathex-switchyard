import test from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { once } from "node:events";
import { mkdtemp, rm, symlink, readFile, readdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createSuiteStore } from "./suite-store.mjs";
import { withStateLock } from "./state-lock.mjs";

test("independent store instances serialize initialization and updates without replacing a compartment key or losing writes", async () => {
  const root = await mkdtemp(join(tmpdir(), "switchyard-multi-store-")), keys = new Map(); let created = 0;
  const secrets = { get: async (id, purpose) => { await new Promise((r) => setTimeout(r, 2)); return keys.get(`${id}:${purpose}`); }, set: async (id, purpose, value) => { created++; keys.set(`${id}:${purpose}`, value); } };
  const a = createSuiteStore({ root, secrets }), b = createSuiteStore({ root, secrets });
  try {
    await Promise.all([a.initialize("personal"), b.initialize("personal")]);
    assert.equal(created, 1);
    await Promise.all(Array.from({ length: 12 }, (_, i) => (i % 2 ? a : b).update("personal", "concurrent-increment", (s) => { s.testCount = (s.testCount ?? 0) + 1; })));
    assert.equal((await a.snapshot("personal")).testCount, 12);
    assert.equal((await b.snapshot("personal")).audit.length, 12);
    const raw = await readFile(join(root, "personal.sealed.json"), "utf8"); assert.equal(raw.includes("testCount"), false);
    assert.deepEqual((await readdir(join(root, "locks"))).sort(), ["personal.lock"]);
  } finally { await rm(root, { recursive: true, force: true }); }
});

test("kernel lock releases after its owner crashes and a separate process can acquire the same lock", async () => {
  const root = await mkdtemp(join(tmpdir(), "switchyard-crash-lock-"));
  const moduleUrl = new URL("./state-lock.mjs", import.meta.url).href;
  const code = `import {withStateLock} from ${JSON.stringify(moduleUrl)}; await withStateLock(${JSON.stringify(root)}, 'personal', async () => { process.stdout.write('HELD\\n'); await new Promise(resolve => { process.stdin.on('end', resolve); process.stdin.resume(); }); });`;
  const child = spawn(process.execPath, ["--input-type=module", "-e", code], { stdio: ["pipe", "pipe", "pipe"] });
  try {
    await new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error("Synthetic lock owner did not become ready")), 15000);
      child.on("error", (e) => { clearTimeout(timer); reject(e); }); child.stdout.on("data", (b) => { if (b.toString().includes("HELD")) { clearTimeout(timer); resolve(); } }); child.once("exit", () => { clearTimeout(timer); reject(new Error("Synthetic lock owner exited before acquiring")); });
    });
    const exited = once(child, "close"); child.kill("SIGKILL"); await exited;
    let entered = false; await withStateLock(root, "personal", async () => { entered = true; }); assert.equal(entered, true);
  } finally { child.stdin.end(); if (child.exitCode === null) child.kill(); await rm(root, { recursive: true, force: true }); }
});

test("lock identity and symlink root are rejected before a protected mutation", { skip: process.platform !== "linux" }, async () => {
  const root = await mkdtemp(join(tmpdir(), "switchyard-rejected-lock-")); let entered = false;
  try {
    await assert.rejects(withStateLock(root, "../escape", async () => { entered = true; }), /identity/);
    await symlink(root, join(root, "locks"));
    await assert.rejects(withStateLock(root, "personal", async () => { entered = true; }), /ownership|permissions/);
    assert.equal(entered, false);
  } finally { await rm(root, { recursive: true, force: true }); }
});
