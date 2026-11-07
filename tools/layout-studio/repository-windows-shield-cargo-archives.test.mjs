import test from "node:test";
import { windowsExecutionFixture } from "./test-support/windows-execution-fixture.mjs";
import { assertCargoArchiveShield } from "./test-support/assert-cargo-archive-shield.mjs";
for (const action of ["shield_supply_chain", "release_shield"]) test(`Windows guest-double ${action} binds Cargo archive identity and exact cleanup`, t => assertCargoArchiveShield(t, windowsExecutionFixture, action, true));
