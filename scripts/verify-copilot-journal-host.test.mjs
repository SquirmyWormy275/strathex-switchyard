import test from "node:test";
import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { fileURLToPath } from "node:url";
const execute = promisify(execFile);
test("installed npm archive proof refuses package, network and execution flags before installed-state access", async () => {
  const script = fileURLToPath(new URL("./verify-npm-archive-host.mjs", import.meta.url));
  for (const flags of [[], ["--synthetic"], ["--read-only-metadata", "--install"], ["--read-only-metadata", "--scan"], ["--read-only-metadata", "--registry=NEVER_CONTACT"], ["--read-only-metadata", "--approved"], ["--read-only-metadata", "--read-only-metadata"]]) await assert.rejects(execute(process.execPath, [script, ...flags], { timeout: 5000, maxBuffer: 32768 }), error => error.code === 1 && error.stdout === "" && /Usage on the pilot:/.test(error.stderr));
});
test("installed workflow metadata proof refuses edit, import and broad flags before installed-state access", async () => {
  const script = fileURLToPath(new URL("./verify-workflow-host.mjs", import.meta.url));
  for (const flags of [[], ["--synthetic"], ["--read-only-metadata", "--edit"], ["--read-only-metadata", "--import=NEVER_OPEN"], ["--read-only-metadata", "--approved"], ["--read-only-metadata", "--read-only-metadata"]]) await assert.rejects(execute(process.execPath, [script, ...flags], { timeout: 5000, maxBuffer: 32768 }), error => error.code === 1 && error.stdout === "" && /Usage on the pilot:/.test(error.stderr));
});
test("installed Copilot metadata proof rejects account, delivery, approval and ambiguous flags before installed-state access", async () => {
  const script = fileURLToPath(new URL("./verify-copilot-journal-host.mjs", import.meta.url));
  for (const flags of [[], ["--synthetic"], ["--read-only-metadata", "--tenant=NEVER_CONTACT"], ["--read-only-metadata", "--submit"], ["--read-only-metadata", "--approved"], ["--read-only-metadata", "--read-only-metadata"]]) await assert.rejects(execute(process.execPath, [script, ...flags], { timeout: 5000, maxBuffer: 32768 }), error => error.code === 1 && error.stdout === "" && /Usage on the pilot:/.test(error.stderr));
});

test("installed task-owner metadata proof rejects native loading, account and approval flags before installed-state access", async () => {
  const script=fileURLToPath(new URL("./verify-task-owner-host.mjs",import.meta.url));
  for(const flags of [[],["--load"],["--read-only-metadata","--resume"],["--read-only-metadata","--attach"],["--read-only-metadata","--account=NEVER_CONTACT"],["--read-only-metadata","--approved"],["--read-only-metadata","--read-only-metadata"]]) await assert.rejects(execute(process.execPath,[script,...flags],{timeout:5000,maxBuffer:32768}),error=>error.code===1&&error.stdout===""&&/Usage on the pilot:/.test(error.stderr));
});

test("installed agent-security proof refuses live enrollment, revocation, outcome and broad flags before installed-state access", async () => {
  const script = fileURLToPath(new URL("./verify-agent-security-host.mjs", import.meta.url));
  for (const flags of [[], ["--synthetic"], ["--read-only-metadata", "--enroll"], ["--read-only-metadata", "--revoke"], ["--read-only-metadata", "--resolve"], ["--read-only-metadata", "--agent=NEVER_CONTACT"], ["--read-only-metadata", "--approved"], ["--read-only-metadata", "--read-only-metadata"]]) await assert.rejects(execute(process.execPath, [script, ...flags], { timeout: 5000, maxBuffer: 32768 }), error => error.code === 1 && error.stdout === "" && /Usage on the pilot:/.test(error.stderr));
});

test("installed Python metadata proof rejects evaluation, installation, network and execution flags before installed-state access", async () => {
  const script = fileURLToPath(new URL("./verify-python-inventory-host.mjs", import.meta.url));
  for (const flags of [[], ["--synthetic"], ["--read-only-metadata", "--evaluate"], ["--read-only-metadata", "--install"], ["--read-only-metadata", "--scan"], ["--read-only-metadata", "--index-url=NEVER_CONTACT"], ["--read-only-metadata", "--approved"], ["--read-only-metadata", "--read-only-metadata"]]) await assert.rejects(execute(process.execPath, [script, ...flags], { timeout: 5000, maxBuffer: 32768 }), error => error.code === 1 && error.stdout === "" && /Usage on the pilot:/.test(error.stderr));
});

test("installed Cargo metadata proof refuses resolution, builds, publication and network flags before installed-state access", async () => {
  const script = fileURLToPath(new URL("./verify-cargo-inventory-host.mjs", import.meta.url));
  for (const flags of [[], ["--synthetic"], ["--read-only-metadata", "--resolve"], ["--read-only-metadata", "--build"], ["--read-only-metadata", "--publish"], ["--read-only-metadata", "--registry=NEVER_CONTACT"], ["--read-only-metadata", "--approved"], ["--read-only-metadata", "--read-only-metadata"]]) await assert.rejects(execute(process.execPath, [script, ...flags], { timeout: 5000, maxBuffer: 32768 }), error => error.code === 1 && error.stdout === "" && /Usage on the pilot:/.test(error.stderr));
});
