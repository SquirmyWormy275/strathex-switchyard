import test from "node:test";
import { repositoryShieldFixture } from "./test-support/repository-shield-fixture.mjs";
import { assertShieldExceptionJourney } from "./test-support/assert-shield-exception-journey.mjs";
test("real Linux Shield preserves raw findings and authenticates exact reviewed exceptions, withdrawal and incomplete receipts", { skip: process.platform !== "linux" }, async t => {
  const f = await repositoryShieldFixture(t, { ignoredSecrets: true, exceptions: true }); await assertShieldExceptionJourney(f);
});
