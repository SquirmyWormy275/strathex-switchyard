import test from "node:test";
import { repositoryShieldFixture } from "./test-support/repository-shield-fixture.mjs";
import { assertLicenseShield } from "./test-support/assert-license-shield.mjs";

for (const action of ["shield_supply_chain", "release_shield"]) test(`Linux ${action} authenticates declared license alternatives, required obligations and unsupported syntax after real namespace exit`, { skip: process.platform !== "linux" }, async t => {
  await assertLicenseShield(await repositoryShieldFixture(t, { action, licenseExpressions: true }));
});
