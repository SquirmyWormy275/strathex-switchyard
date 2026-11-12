import test from "node:test";
import { windowsExecutionFixture } from "./test-support/windows-execution-fixture.mjs";
import { assertCargoShield } from "./test-support/assert-cargo-shield.mjs";

for (const cargoVersion of ["1.2.3", "1.2.3-rc.2+001"]) for (const action of ["shield_supply_chain", "release_shield"]) test(`Windows guest-double ${action} ${cargoVersion} authenticates Cargo declarations without granting complete coverage`, async t => {
  await assertCargoShield(await windowsExecutionFixture(t, { action, shield: true, cargoLock: true, cargoVersion }), { windows: true, cargoVersion });
});
