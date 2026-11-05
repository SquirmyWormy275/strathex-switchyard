import test from "node:test";
import { windowsExecutionFixture } from "./test-support/windows-execution-fixture.mjs";
import { assertLicenseShield } from "./test-support/assert-license-shield.mjs";

for (const action of ["shield_supply_chain", "release_shield"]) test(`Windows guest-double ${action} authenticates license metadata without choosing terms or granting complete coverage`, async t => {
  await assertLicenseShield(await windowsExecutionFixture(t, { action, shield: true, licenseExpressions: true }), { windows: true });
});
