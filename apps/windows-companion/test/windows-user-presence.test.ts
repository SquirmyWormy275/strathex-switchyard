import assert from "node:assert/strict";
import test from "node:test";

import { commandForAction } from "../../../packages/control-plane/src/command-catalog.ts";
import { WindowsHelloConfirmationAttestor, type WindowsUserPresenceRunner } from "../src/windows-user-presence.ts";

test("Windows user-presence attestor displays only catalog-bound text and returns verified operator evidence", async () => {
  const prompts: string[] = [];
  const runner: WindowsUserPresenceRunner = {
    async verify(prompt) { prompts.push(prompt); return { verified: true, operator: "TEST\\operator" }; }
  };
  const attestor = new WindowsHelloConfirmationAttestor(runner);
  const result = await attestor.attest({
    definition: commandForAction("local_commit"),
    reason: "untrusted\nreason token=must-not-be-shown"
  });
  assert.deepEqual(result, { reauthenticated: true, operator: "TEST\\operator" });
  assert.equal(prompts.length, 1);
  assert.match(prompts[0]!, /Scoped local commit/);
  assert.equal(prompts[0]!.includes("must-not-be-shown"), false);
});

test("denied Windows user presence never becomes a reauthentication assertion", async () => {
  const attestor = new WindowsHelloConfirmationAttestor({ verify: async () => ({ verified: false }) });
  assert.equal(await attestor.attest({ definition: commandForAction("fresh_claude"), reason: "review" }), undefined);
});

test("Plan Approval Windows Hello repeats the exact host-created review digest and bounded plan summary", async () => {
  const prompts: string[] = [];
  const attestor = new WindowsHelloConfirmationAttestor({ verify: async (prompt) => { prompts.push(prompt); return { verified: true, operator: "TEST\\operator" }; } });
  const scope = "a".repeat(64);
  await attestor.attest({
    definition: commandForAction("plan_approval"),
    reason: "untrusted client text must-not-be-shown",
    reviewedScopeDigest: scope,
    reviewedScopeSummary: "Review exact plan plan-7 with two approved steps."
  });
  assert.match(prompts[0]!, new RegExp(scope));
  assert.match(prompts[0]!, /Review exact plan plan-7/);
  assert.equal(prompts[0]!.includes("must-not-be-shown"), false);
  assert.ok(prompts[0]!.length <= 240);
});
