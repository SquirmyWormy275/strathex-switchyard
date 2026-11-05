import test from "node:test";
import { repositoryShieldFixture } from "./test-support/repository-shield-fixture.mjs";
import { assertPypiShield } from "./test-support/assert-pypi-shield.mjs";

for (const action of ["shield_supply_chain", "release_shield"]) test(`Linux ${action} authenticates exact Python requirement metadata and ecosystem-separated advisory findings after actual namespace exit`, { skip: process.platform !== "linux" }, async t => {
  await assertPypiShield(await repositoryShieldFixture(t, { action, requirements: true }));
});
