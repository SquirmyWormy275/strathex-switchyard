import assert from "node:assert/strict";
import { chmod, mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { LinuxCurrentUserProviderHostPathSecurity } from "../src/linux-path-security.ts";

test("Linux provider path security accepts only private current-user files", { skip: process.platform !== "linux" }, async (context) => {
  const outer = await mkdtemp(join(tmpdir(), "sxsy-provider-linux-path-"));
  context.after(async () => rm(outer, { recursive: true, force: true }));
  const root = join(outer, "protected"); await mkdir(root, { mode: 0o700 }); await chmod(root, 0o700);
  const file = join(root, "secret.json"); await writeFile(file, "{}", { mode: 0o600 }); await chmod(file, 0o600);
  const security = new LinuxCurrentUserProviderHostPathSecurity();
  await security.assertCurrentUserProtected(root, [file]);
  await chmod(file, 0o644);
  await assert.rejects(() => security.assertCurrentUserProtected(root, [file]), /broad|private/i);
});
