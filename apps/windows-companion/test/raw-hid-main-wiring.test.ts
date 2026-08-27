import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import test from "node:test";

import { installedHelperIdentity, packagedRawHidHelperPath, packagedRepositoryRuntimeHelperPath } from "../src/main.ts";

test("packaged Raw-HID helper path is derived only from the installed main module location", () => {
  const mainPath = resolve("C:\\Program Files\\STRATHEX\\app\\dist\\apps\\windows-companion\\src\\main.js");
  assert.equal(
    packagedRawHidHelperPath(mainPath),
    resolve("C:\\Program Files\\STRATHEX\\app\\dist\\apps\\windows-companion\\raw-hid\\strathex-b122-hid-helper.exe")
  );
});

test("packaged repository supervisor path is derived only from the installed main module location", () => {
  const mainPath = resolve("C:\\Program Files\\STRATHEX\\app\\dist\\apps\\windows-companion\\src\\main.js");
  assert.equal(
    packagedRepositoryRuntimeHelperPath(mainPath),
    resolve("C:\\Program Files\\STRATHEX\\app\\dist\\apps\\windows-companion\\repository-runtime\\b122-repository-runner.exe")
  );
});

test("packaged helper identity pins a regular file and rejects an internal filesystem alias", async (context) => {
  const root = await mkdtemp(resolve(tmpdir(), "sxsy-b122-helper-identity-"));
  context.after(async () => { await rm(root, { recursive: true, force: true }); });
  const target = resolve(root, "target");
  const alias = resolve(root, "alias");
  const helper = resolve(target, "helper.exe");
  await mkdir(target);
  await writeFile(helper, "reviewed helper", "utf8");
  assert.match(await installedHelperIdentity(helper), /^sha256:[0-9a-f]{64}$/);
  await symlink(target, alias, "junction");
  await assert.rejects(installedHelperIdentity(resolve(alias, "helper.exe")), /reparse point|bounded regular file/i);
});
