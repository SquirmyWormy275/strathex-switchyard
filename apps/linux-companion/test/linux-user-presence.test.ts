import assert from "node:assert/strict";
import test from "node:test";

import { LinuxPolkitConfirmationAttestor, LinuxPolkitUserPresenceRunner } from "../src/linux-user-presence.ts";
import { commandForAction } from "../../../packages/control-plane/src/command-catalog.ts";

test("Linux polkit presence uses the closed auth_self action and exact process tuple", { skip: process.platform !== "linux" }, async () => {
  const calls: string[][] = [];
  const presence = new LinuxPolkitUserPresenceRunner(async (request) => { calls.push([...request.args]); return { exitCode: 0, stdout: "", stderr: "" }; });
  const result = await presence.verify("Approve a reviewed scope.");
  assert.equal(result.verified, true);
  assert.equal(calls[0]?.includes("org.strathex.switchyard.confirm"), true);
  assert.match(calls[0]?.[3] ?? "", /^[0-9]+,[0-9]+,[0-9]+$/);
});

test("Linux polkit presence rejects unexpected success output", { skip: process.platform !== "linux" }, async () => {
  const presence = new LinuxPolkitUserPresenceRunner(async () => ({ exitCode: 0, stdout: "", stderr: "unexpected warning" }));
  await assert.rejects(() => presence.verify("Approve a reviewed scope."), /unexpected output/i);
});

test("Linux confirmation attestor preserves refusal and validates reviewed digests", async () => {
  const denied = new LinuxPolkitConfirmationAttestor({ async verify() { return { verified: false }; } });
  const definition = commandForAction("local_commit");
  assert.equal(await denied.attest({ definition, reason: "reviewed", reviewedScopeDigest: "a".repeat(64), reviewedScopeSummary: "Exact local commit" }), undefined);
  await assert.rejects(() => denied.attest({ definition, reason: "reviewed", reviewedScopeDigest: "bad", reviewedScopeSummary: "Exact local commit" }), /digest/i);
});
