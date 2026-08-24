import assert from "node:assert/strict";
import test from "node:test";
import { assignments } from "../../protocol/src/b122.ts";
import { administrativeCommands, commandCatalog, commandFor, commandForAction } from "../src/command-catalog.ts";

test("the control-plane catalog gives every settled protocol chord one explicit software action", () => {
  assert.equal(commandCatalog.length, 65);
  assert.equal(new Set(commandCatalog.map((definition) => definition.action)).size, 65);

  for (const assignment of assignments) {
    const definition = commandFor(assignment.control, assignment.modifier);
    assert.ok(definition, `${assignment.control}:${assignment.modifier} must have a command definition`);
    assert.equal(definition.assignment, assignment);
  }
});

test("all high-consequence chord actions carry explicit gate requirements and confirmations", () => {
  for (const action of [
    "council_automatic", "pr_merge", "direct_main", "lfg", "repair_mission",
    "emergency_containment", "full_sandbox", "rebuild_full_sandbox", "quarantine"
  ] as const) {
    const definition = commandForAction(action);
    assert.ok(definition.highConsequence, `${action} must remain high consequence`);
    assert.ok(definition.requiresConfirmation, `${action} must require an explicit confirmation`);
    assert.ok(definition.acceptanceGates.length > 0, `${action} must name its acceptance evidence`);
  }
});

test("containment release exists as a separately gated administrative action, not a keyboard toggle", () => {
  const release = administrativeCommands.find((definition) => definition.action === "containment_release");
  assert.ok(release);
  assert.equal(release.assignment, undefined);
  assert.equal(release.highConsequence, true);
  assert.equal(release.requiresConfirmation, true);
  assert.ok(release.acceptanceGates.includes(20));
});

test("workflow navigation and Plan Approval declare the authority and confirmation needed by their durable coordinators", () => {
  assert.equal(commandForAction("plan_approval").requiresConfirmation, true);
  for (const action of ["handoff_immediate", "focus_blocked_agent", "focus_finished_agent"] as const) {
    assert.equal(commandForAction(action).requiresAuthority, true, `${action} must receive exact scoped authority before workflow preparation`);
  }
  assert.equal(commandForAction("handoff_immediate").executor, "agent");
});
