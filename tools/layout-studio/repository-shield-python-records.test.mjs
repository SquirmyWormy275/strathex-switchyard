import test from "node:test";
import { repositoryShieldFixture } from "./test-support/repository-shield-fixture.mjs";
import { assertPythonWheelShield } from "./test-support/assert-python-wheel-shield.mjs";
for (const action of ["shield_supply_chain", "release_shield"]) test(`actual Linux ${action} binds wheel RECORD hashes after verified scanner exit`, { skip: process.platform !== "linux" }, t => assertPythonWheelShield(t, repositoryShieldFixture, action, false, true));
