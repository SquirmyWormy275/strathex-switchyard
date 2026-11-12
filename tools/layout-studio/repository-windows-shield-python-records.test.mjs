import test from "node:test";
import { windowsExecutionFixture } from "./test-support/windows-execution-fixture.mjs";
import { assertPythonWheelShield } from "./test-support/assert-python-wheel-shield.mjs";
for (const action of ["shield_supply_chain", "release_shield"]) test(`Windows guest-double ${action} binds wheel RECORD hashes and exact cleanup`, t => assertPythonWheelShield(t, windowsExecutionFixture, action, true, true));
