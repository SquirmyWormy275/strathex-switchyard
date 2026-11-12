import test from "node:test";
import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { mkdtemp, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const execute = promisify(execFile);
test("the installed tmux verifier refuses missing, broadened and relative arguments before creating application or account state", async () => {
  const root = await mkdtemp(join(tmpdir(), "sx-tmux-verifier-guard-")), script = fileURLToPath(new URL("./verify-tmux-focus-host.mjs", import.meta.url));
  try {
    for (const args of [[], ["--synthetic"], ["--synthetic", "--repository=relative"], ["--force", "--repository=/tmp"], ["--synthetic", "--repository=/tmp", "--approve"], ["--synthetic", "--repository=/tmp", "--synthetic"]]) {
      await assert.rejects(execute(process.execPath, [script, ...args], { env: { ...process.env, HOME: root, XDG_STATE_HOME: root, XDG_CACHE_HOME: root, LOCALAPPDATA: root, USERPROFILE: root }, timeout: 5000, maxBuffer: 16384 }), error => error.code === 1 && error.stderr.includes("Use on the pilot:") && error.stdout === "");
      assert.deepEqual(await readdir(root), []);
    }
  } finally { await rm(root, { recursive: true }); }
});
