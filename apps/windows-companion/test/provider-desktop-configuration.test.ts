import assert from "node:assert/strict";
import { mkdtemp, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { loadProviderDesktopPaths } from "../src/provider-desktop-configuration.ts";

test("provider desktop bootstrap configuration accepts only compiled identities and exact absolute executables", async (context) => {
  const root = await mkdtemp(join(tmpdir(), "sxsy-provider-paths-"));
  context.after(async () => { await rm(root, { recursive: true, force: true }); });
  const file = join(root, "provider-desktop-paths.json");
  const claude = join(root, "Claude.exe");
  const trust = (path: string) => ({ path, signerSubject: "CN=Isolated Provider Test", signerThumbprint: "a".repeat(40) });
  await writeFile(file, JSON.stringify({ schema: "sxsy-b122.provider-desktop-paths", version: 2, providers: { claude_desktop: trust(claude), codex: trust(join(root, "codex.exe")) } }), "utf8");
  assert.deepEqual(await loadProviderDesktopPaths(file), { claude_desktop: trust(claude), codex: trust(join(root, "codex.exe")) });
  assert.equal(await loadProviderDesktopPaths(join(root, "absent.json")), undefined);
});

test("provider desktop bootstrap configuration rejects unknown, relative, linked, and malformed records", async (context) => {
  const root = await mkdtemp(join(tmpdir(), "sxsy-provider-paths-negative-"));
  context.after(async () => { await rm(root, { recursive: true, force: true }); });
  const file = join(root, "provider-desktop-paths.json");
  const trust = (path: string) => ({ path, signerSubject: "CN=Isolated Provider Test", signerThumbprint: "a".repeat(40) });
  await writeFile(file, JSON.stringify({ schema: "sxsy-b122.provider-desktop-paths", version: 2, providers: { arbitrary: trust(join(root, "evil.exe")) } }), "utf8");
  await assert.rejects(() => loadProviderDesktopPaths(file), /unknown|empty/i);
  await writeFile(file, JSON.stringify({ schema: "sxsy-b122.provider-desktop-paths", version: 2, providers: { codex: trust("codex.exe") } }), "utf8");
  await assert.rejects(() => loadProviderDesktopPaths(file), /invalid/i);
  await writeFile(file, "{}", "utf8");
  await assert.rejects(() => loadProviderDesktopPaths(file), /schema/i);
  const target = join(root, "target.json"); const linked = join(root, "linked.json");
  await writeFile(target, JSON.stringify({ schema: "sxsy-b122.provider-desktop-paths", version: 2, providers: { codex: trust(join(root, "codex.exe")) } }), "utf8");
  try { await symlink(target, linked, "file"); await assert.rejects(() => loadProviderDesktopPaths(linked), /linked/i); } catch (error) { if (!(error instanceof Error) || !/privilege|permitted|operation/i.test(error.message)) throw error; }
});
