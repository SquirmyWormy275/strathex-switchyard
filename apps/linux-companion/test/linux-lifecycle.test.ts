import assert from "node:assert/strict";
import { chmod, mkdtemp, mkdir, rm, symlink } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { acquireLinuxCompanionLease } from "../src/linux-lifecycle.ts";
import { provisionLinuxCompanionPaths } from "../src/linux-paths.ts";

test("Linux companion paths and exact process lease remain private and single-instance", { skip: process.platform !== "linux" }, async (context) => {
  const root = await mkdtemp(join(tmpdir(), "sxsy-linux-lifecycle-"));
  context.after(async () => rm(root, { recursive: true, force: true }));
  const home = join(root, "home"); const state = join(root, "state"); const runtime = join(root, "runtime");
  await Promise.all([mkdir(home, { mode: 0o700 }), mkdir(state, { mode: 0o700 }), mkdir(runtime, { mode: 0o700 })]);
  await Promise.all([chmod(home, 0o700), chmod(state, 0o700), chmod(runtime, 0o700)]);
  const paths = await provisionLinuxCompanionPaths({ HOME: home, XDG_STATE_HOME: state, XDG_RUNTIME_DIR: runtime });
  const lease = await acquireLinuxCompanionLease(paths.stateDirectory);
  await assert.rejects(() => acquireLinuxCompanionLease(paths.stateDirectory), /already active/i);
  await lease.release();
  const replacement = await acquireLinuxCompanionLease(paths.stateDirectory);
  await replacement.release();
});

test("Linux companion paths reject state symlink escape and broad runtime permissions", { skip: process.platform !== "linux" }, async (context) => {
  const root = await mkdtemp(join(tmpdir(), "sxsy-linux-path-escape-"));
  context.after(async () => rm(root, { recursive: true, force: true }));
  const state = join(root, "state"); const runtime = join(root, "runtime"); const outside = join(root, "outside");
  await Promise.all([mkdir(state, { mode: 0o700 }), mkdir(runtime, { mode: 0o700 }), mkdir(outside, { mode: 0o700 })]);
  await symlink(outside, join(state, "STRATHEX"), "dir");
  await assert.rejects(() => provisionLinuxCompanionPaths({ HOME: root, XDG_STATE_HOME: state, XDG_RUNTIME_DIR: runtime }), /escaped/i);
  await rm(join(state, "STRATHEX"));
  await chmod(runtime, 0o755);
  await assert.rejects(() => provisionLinuxCompanionPaths({ HOME: root, XDG_STATE_HOME: state, XDG_RUNTIME_DIR: runtime }), /private/i);
  await chmod(runtime, 0o700);
  await chmod(state, 0o755);
  await assert.rejects(() => provisionLinuxCompanionPaths({ HOME: root, XDG_STATE_HOME: state, XDG_RUNTIME_DIR: runtime }), /private/i);
});
