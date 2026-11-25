import test from "node:test";
import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { fileURLToPath } from "node:url";
const execute = promisify(execFile);
test("installed license verification rejects ambiguous, combined or unsupported selections before accessing installed state or accounts", async () => {
  const script = fileURLToPath(new URL("./verify-shield-host.mjs", import.meta.url));
  for (const flags of [
    ["--synthetic", "--license-expressions"], ["--license-expressions", "--action=shield_supply_chain"],
    ["--synthetic", "--license-expressions", "--one-action"], ["--synthetic", "--license-expressions", "--action=shield_change_scan"],
    ["--synthetic", "--license-expressions", "--action=shield_codebase_audit"],
    ["--synthetic", "--license-expressions", "--action=shield_supply_chain", "--osv-advisory"],
    ["--synthetic", "--license-expressions", "--action=release_shield", "--pypi-requirements"],
    ["--synthetic", "--license-expressions", "--action=shield_supply_chain", "--workspace-lock"],
    ["--synthetic", "--license-expressions", "--action=shield_supply_chain", "--license-expressions"],
    ["--synthetic", "--license-expressions", "--action=shield_supply_chain", "--unknown"]
  ]) {
    await assert.rejects(execute(process.execPath, [script, ...flags], { timeout: 5000, maxBuffer: 32768 }), error => error.code === 1 && error.stdout === "" && /Usage: node scripts\/verify-shield-host\.mjs/.test(error.stderr));
  }
});
