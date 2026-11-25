import test from "node:test";
import { repositoryShieldFixture } from "./test-support/repository-shield-fixture.mjs";
import { assertCargoArchiveShield } from "./test-support/assert-cargo-archive-shield.mjs";
for (const action of ["shield_supply_chain", "release_shield"]) test(`actual Linux ${action} binds Cargo archive identity after verified scanner exit`, { skip: process.platform !== "linux" }, t => assertCargoArchiveShield(t, repositoryShieldFixture, action, false));
