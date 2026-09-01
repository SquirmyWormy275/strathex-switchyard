import assert from "node:assert/strict";
import { chmod, mkdtemp, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { loadFixedOmarchySurfaceIdentities } from "../src/omarchy-identity.ts";

test("Omarchy identities load only from an exact owner-only artifact", async (context) => {
  const root = await mkdtemp(join(tmpdir(), "b122-omarchy-identities-"));
  context.after(() => rm(root, { recursive: true, force: true }));
  const path = join(root, "omarchy-surfaces.json");
  await writeFile(path, JSON.stringify({ version: 1, vscode: { version: 1, surface: "vscode", initialClass: "code" }, terminal: { version: 1, surface: "terminal", initialClass: "foot" } }), { mode: 0o600 });

  if (process.platform !== "linux") {
    await assert.rejects(loadFixedOmarchySurfaceIdentities(path), /requires Linux/i);
    return;
  }

  assert.deepEqual(await loadFixedOmarchySurfaceIdentities(path), { version: 1, vscode: { version: 1, surface: "vscode", initialClass: "code" }, terminal: { version: 1, surface: "terminal", initialClass: "foot" } });
  assert.equal(await loadFixedOmarchySurfaceIdentities(join(root, "missing.json")), undefined);

  await chmod(path, 0o644);
  await assert.rejects(loadFixedOmarchySurfaceIdentities(path), /unsafe/i);
  await chmod(path, 0o600);
  const link = join(root, "link.json"); await symlink(path, link);
  await assert.rejects(loadFixedOmarchySurfaceIdentities(link), /symbolic|loop|unsafe/i);
});

test("Omarchy identities reject unknown fields, swapped surfaces, and injection", async (context) => {
  const root = await mkdtemp(join(tmpdir(), "b122-omarchy-identities-invalid-"));
  context.after(() => rm(root, { recursive: true, force: true }));

  if (process.platform !== "linux") {
    const path = join(root, "unsupported.json");
    await writeFile(path, JSON.stringify({ version: 1, terminal: { version: 1, surface: "terminal", initialClass: "foot" } }), { mode: 0o600 });
    await assert.rejects(loadFixedOmarchySurfaceIdentities(path), /requires Linux/i);
    return;
  }

  for (const [name, value] of Object.entries({
    unknown: { version: 1, terminal: { version: 1, surface: "terminal", initialClass: "foot" }, fallback: "code" },
    swapped: { version: 1, terminal: { version: 1, surface: "vscode", initialClass: "code" } },
    injected: { version: 1, vscode: { version: 1, surface: "vscode", initialClass: "code") })" } }
  })) {
    const path = join(root, name + ".json"); await writeFile(path, JSON.stringify(value), { mode: 0o600 });
    await assert.rejects(loadFixedOmarchySurfaceIdentities(path), /invalid/i);
  }
});
