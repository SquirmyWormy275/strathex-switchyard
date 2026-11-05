import test from "node:test";
import { windowsExecutionFixture } from "./test-support/windows-execution-fixture.mjs";
import { assertPypiShield } from "./test-support/assert-pypi-shield.mjs";

for (const action of ["shield_supply_chain", "release_shield"]) test(`Windows guest-double ${action} authenticates exact Python requirement metadata without granting complete coverage`, async t => {
  await assertPypiShield(await windowsExecutionFixture(t, { action, shield: true, requirements: true }), { windows: true });
});
