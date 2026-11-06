import test from "node:test";
import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { fileURLToPath } from "node:url";
const execute = promisify(execFile);
test("installed Copilot metadata proof rejects account, delivery, approval and ambiguous flags before installed-state access", async () => {
  const script = fileURLToPath(new URL("./verify-copilot-journal-host.mjs", import.meta.url));
  for (const flags of [[], ["--synthetic"], ["--read-only-metadata", "--tenant=NEVER_CONTACT"], ["--read-only-metadata", "--submit"], ["--read-only-metadata", "--approved"], ["--read-only-metadata", "--read-only-metadata"]]) await assert.rejects(execute(process.execPath, [script, ...flags], { timeout: 5000, maxBuffer: 32768 }), error => error.code === 1 && error.stdout === "" && /Usage on the pilot:/.test(error.stderr));
});

test("installed task-owner metadata proof rejects native loading, account and approval flags before installed-state access", async () => {
  const script=fileURLToPath(new URL("./verify-task-owner-host.mjs",import.meta.url));
  for(const flags of [[],["--load"],["--read-only-metadata","--resume"],["--read-only-metadata","--account=NEVER_CONTACT"],["--read-only-metadata","--approved"],["--read-only-metadata","--read-only-metadata"]]) await assert.rejects(execute(process.execPath,[script,...flags],{timeout:5000,maxBuffer:32768}),error=>error.code===1&&error.stdout===""&&/Usage on the pilot:/.test(error.stderr));
});
