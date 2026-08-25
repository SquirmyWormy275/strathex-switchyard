import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "../../..");
const deployment = join(root, "deployment", "windows");

test("the Windows release packages, self-tests, inventories, and provenance-checks the provider host", async () => {
  const build = await readFile(join(deployment, "Build-B122Release.ps1"), "utf8");
  const portable = await readFile(join(deployment, "Test-B122PortableBundle.ps1"), "utf8");
  const artifact = await readFile(join(deployment, "Test-B122ReleaseArtifact.ps1"), "utf8");

  for (const expected of [
    "package:provider-host:dry-run",
    "build:provider-host",
    "provider-adapter-host",
    "sxsy-b122.provider-host-self-test",
    "providerAdapterHost=[string]$providerPackageIdentity.version",
    "SPDXRef-Package-ProviderAdapterHost"
  ]) assert.equal(build.includes(expected), true, `release build is missing ${expected}`);

  for (const expected of [
    "providerHostMain",
    "sxsy-b122.provider-host-self-test",
    "providerHostSelfTest=$true",
    "proprietaryCredentialAccessed -ne $false",
    "networkAccessed -ne $false"
  ]) assert.equal(portable.includes(expected), true, `portable smoke is missing ${expected}`);

  for (const expected of [
    "@strathex/switchyard-provider-adapter-host",
    "providerAdapterHost",
    "SPDXRef-Package-ProviderAdapterHost",
    "apps/provider-adapter-host/src/main.ts",
    "apps/provider-adapter-host/src/service.ts",
    "apps/provider-adapter-host/src/backends.ts",
    "apps/provider-adapter-host/src/state.ts"
  ]) assert.equal(artifact.includes(expected), true, `release validation is missing ${expected}`);
});
