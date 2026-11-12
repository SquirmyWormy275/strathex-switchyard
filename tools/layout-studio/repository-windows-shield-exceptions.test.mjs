import test from "node:test";
import { windowsExecutionFixture } from "./test-support/windows-execution-fixture.mjs";
import { assertShieldExceptionJourney } from "./test-support/assert-shield-exception-journey.mjs";
test("Windows Shield connects exact reviewed exceptions without modifying raw findings or upgrading mandatory missing coverage", async t => {
  const f = await windowsExecutionFixture(t, { action: "shield_change_scan", shield: true, ignoredSecrets: true, exceptions: true }); await assertShieldExceptionJourney(f);
});
