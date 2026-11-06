import test from "node:test";
import { repositoryShieldFixture } from "./test-support/repository-shield-fixture.mjs";
import { assertCargoShield } from "./test-support/assert-cargo-shield.mjs";

for (const cargoVersion of ["1.2.3", "1.2.3-rc.2+001"]) for (const action of ["shield_supply_chain", "release_shield"]) test(`Linux ${action} ${cargoVersion} authenticates source-separated Cargo inventory after actual namespace exit`, { skip: process.platform !== "linux" }, async t => {
  await assertCargoShield(await repositoryShieldFixture(t, { action, cargoLock: true, cargoVersion }), { cargoVersion });
});
