import test from "node:test";
import { windowsExecutionFixture } from "./test-support/windows-execution-fixture.mjs";
import { assertPypiShield, nonFinalPythonVersions } from "./test-support/assert-pypi-shield.mjs";
import { conditionalPythonMarker, conditionalPythonMarkerMetadata } from "./test-support/assert-pypi-shield.mjs";

for (const action of ["shield_supply_chain", "release_shield"]) test(`Windows guest-double ${action} retains conditional pins and unevaluated marker evidence`, async t => {
  await assertPypiShield(await windowsExecutionFixture(t, { action, shield: true, requirements: true, pythonVersions: { ...nonFinalPythonVersions, marker: conditionalPythonMarker } }), { windows: true, nonFinal: true, marker: conditionalPythonMarkerMetadata });
});

for (const action of ["shield_supply_chain", "release_shield"]) test(`Windows guest-double ${action} authenticates non-final Python requirement metadata without granting complete coverage`, async t => {
  await assertPypiShield(await windowsExecutionFixture(t, { action, shield: true, requirements: true, pythonVersions: nonFinalPythonVersions }), { windows: true, nonFinal: true });
});

for (const action of ["shield_supply_chain", "release_shield"]) test(`Windows guest-double ${action} retains pinned Python extras without claiming dependency resolution`, async t => {
  await assertPypiShield(await windowsExecutionFixture(t, { action, shield: true, requirements: true, pythonVersions: { ...nonFinalPythonVersions, extras: "[TLS,foo_bar,FOO.bar]" } }), { windows: true, nonFinal: true, extras: ["foo-bar", "tls"] });
});
