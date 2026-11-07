import test from "node:test";
import { repositoryShieldFixture } from "./test-support/repository-shield-fixture.mjs";
import { assertPypiShield, nonFinalPythonVersions } from "./test-support/assert-pypi-shield.mjs";
import { conditionalPythonMarker, conditionalPythonMarkerMetadata } from "./test-support/assert-pypi-shield.mjs";

for (const action of ["shield_supply_chain", "release_shield"]) test(`Linux ${action} retains conditional pins without evaluating markers after actual scanner exit`, { skip: process.platform !== "linux" }, async t => {
  await assertPypiShield(await repositoryShieldFixture(t, { action, requirements: true, pythonVersions: { ...nonFinalPythonVersions, marker: conditionalPythonMarker } }), { nonFinal: true, marker: conditionalPythonMarkerMetadata });
});

for (const action of ["shield_supply_chain", "release_shield"]) test(`Linux ${action} authenticates non-final Python requirement metadata and ecosystem-separated advisory findings after actual namespace exit`, { skip: process.platform !== "linux" }, async t => {
  await assertPypiShield(await repositoryShieldFixture(t, { action, requirements: true, pythonVersions: nonFinalPythonVersions }), { nonFinal: true });
});

for (const action of ["shield_supply_chain", "release_shield"]) test(`Linux ${action} retains pinned Python extras and unresolved dependencies after actual namespace exit`, { skip: process.platform !== "linux" }, async t => {
  await assertPypiShield(await repositoryShieldFixture(t, { action, requirements: true, pythonVersions: { ...nonFinalPythonVersions, extras: "[TLS,foo_bar,FOO.bar]" } }), { nonFinal: true, extras: ["foo-bar", "tls"] });
});
