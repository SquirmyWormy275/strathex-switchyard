import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import test from "node:test";

import { providerDispatchProfileIdentityDigest } from "../src/provider-dispatch-lease.ts";

const root = join(import.meta.dirname, "..", "..", "..");
const deployment = join(root, "deployment", "windows");

test("provider-host Windows scripts generate, bind, and validate an independent dispatch-lease key role", async () => {
  const protect = await readFile(join(deployment, "Protect-B122ProviderHostSecret.ps1"), "utf8");
  const create = await readFile(join(deployment, "New-B122ProviderHostConfiguration.ps1"), "utf8");
  const validate = await readFile(join(deployment, "Test-B122ProviderHostConfiguration.ps1"), "utf8");
  const initialize = await readFile(join(deployment, "Initialize-B122ProviderHost.ps1"), "utf8");
  assert.match(protect, /GenerateDispatchLeaseAuthenticationKey/);
  assert.match(protect, /generate-dispatch-lease-authentication-key/);
  for (const source of [create, validate]) {
    assert.match(source, /dispatchLeaseAuthenticationEnvelopeFile/);
    assert.match(source, /Assert-KeyRoleSeparation/);
    assert.match(source, /Assert-NoReparseSegments/);
    assert.match(source, /DPAPI CurrentUser/i);
  }
  assert.match(create, /DispatchLeaseAuthenticationEnvelopeFile/);
  assert.match(initialize, /dispatch-lease-authentication\.envelope\.json/);
  assert.match(initialize, /GenerateDispatchLeaseAuthenticationKey/);
  assert.match(initialize, /-DispatchLeaseAuthenticationEnvelopeFile/);
  assert.match(initialize, /b122-provider-dispatch-lease-/);
  assert.match(initialize, /b122-provider-bearer-/);
  assert.match(initialize, /-ProviderCredentialReference \$bearerReference/);
});

test("authenticated companion provisioning transfers two sealed references and one immutable exact host/module profile", async (context) => {
  const temporary = await mkdtemp(join(tmpdir(), "b122-dispatch-provisioning-"));
  context.after(async () => { await rm(temporary, { recursive: true, force: true }); });
  const bundle = join(temporary, "bundle");
  const extension = join(bundle, "extension", "dist", "apps", "vscode-extension", "src");
  await mkdir(extension, { recursive: true });
  await writeFile(join(bundle, "package.json"), JSON.stringify({ type: "module" }), "utf8");
  await writeFile(join(extension, "named-pipe-transport.js"), `
    import { appendFile } from "node:fs/promises";
    export class ProvisionedNamedPipeJsonLineTransport {
      constructor(configurationPath) { this.configurationPath = configurationPath; }
      async request(line) {
        await appendFile(this.configurationPath, line + "\\n", "utf8");
        const request = JSON.parse(line);
        const result = request.method === "credential.provision"
          ? { credential: { reference: request.payload.reference } }
          : request.method === "network-policy.install"
            ? { policy: { status: "active" } }
            : request.method === "provider-host.profile.install"
              ? { profile: { configurationSha256: request.payload.profile.configurationSha256 } }
              : undefined;
        return JSON.stringify({ version: 1, id: request.id, ok: result !== undefined, ...(result ? { result } : { error: { code: "unknown" } }) });
      }
    }
  `, "utf8");
  const repositoryRoot = join(temporary, "repository");
  const configurationPath = join(temporary, "provider-host.json");
  const networkPolicyPath = join(temporary, "network-policy.json");
  const artifactPath = join(temporary, "provisioning.json");
  const requestLog = join(temporary, "requests.jsonl");
  const dispatchReference = `b122-provider-dispatch-lease-${"d".repeat(32)}`;
  const bearerReference = `b122-provider-bearer-${"c".repeat(32)}`;
  const profileIdentity = {
    schema: "sxsy-b122.provider-host-dispatch-profile" as const,
    version: 1 as const,
    generation: 1,
    expectedPriorConfigurationSha256: null,
    expectedPriorProfileDigest: null,
    repositoryRoot,
    configurationPath,
    configurationSha256: "1".repeat(64),
    tlsSpkiSha256: "2".repeat(64),
    bearerCredentialReference: bearerReference,
    dispatchLeaseCredentialReference: dispatchReference,
    providers: [
      { provider: "claude" as const, adapterId: "sxsy-b122.module.claude", moduleSha256: "3".repeat(64) },
      { provider: "codex" as const, adapterId: "sxsy-b122.module.codex", moduleSha256: "4".repeat(64) }
    ]
  };
  const artifact = {
    schema: "sxsy-b122.provider-host-companion-provisioning",
    version: 2,
    credentials: [
      {
        role: "bearer",
        reference: bearerReference,
        scopes: [{ repositoryRoot, adapterId: "configured-network", purpose: "provider-api" }],
        protector: "windows-dpapi-current-user",
        sealedSecret: "YQ=="
      },
      {
        role: "dispatch-lease",
        reference: dispatchReference,
        scopes: [{ repositoryRoot, adapterId: "provider-dispatch-lease-issuer", purpose: "provider-dispatch-lease" }],
        protector: "windows-dpapi-current-user",
        sealedSecret: "Yg=="
      }
    ],
    networkPolicyPath,
    profile: { ...profileIdentity, profileDigest: providerDispatchProfileIdentityDigest(profileIdentity) }
  };
  await writeFile(artifactPath, JSON.stringify(artifact), "utf8");
  const script = join(deployment, "Provision-B122ProviderHostCompanion.mjs");
  const result = spawnSync(process.execPath, [script, "--artifact", artifactPath, "--bundle-root", bundle, "--configuration", requestLog], { encoding: "utf8", timeout: 10_000 });
  assert.equal(result.status, 0, result.stderr);
  const receipt = JSON.parse(result.stdout);
  assert.equal(receipt.status, "provisioned");
  assert.equal(receipt.sealedSecretCount, 2);
  assert.equal(receipt.cleartextSecretRead, false);
  const requests = (await readFile(requestLog, "utf8")).trim().split(/\r?\n/u).map((line) => JSON.parse(line));
  assert.deepEqual(requests.map((request) => request.method), [
    "credential.provision",
    "credential.provision",
    "network-policy.install",
    "provider-host.profile.install"
  ]);
  assert.equal(requests[0].payload.reference, bearerReference);
  assert.equal(requests[1].payload.reference, dispatchReference);
  assert.equal(requests[0].payload.sealedSecret, "YQ==");
  assert.equal(requests[1].payload.sealedSecret, "Yg==");
  assert.deepEqual(requests[2].payload, { sourcePath: networkPolicyPath, repositoryRoot });
  assert.equal(requests[3].payload.profile.configurationPath, configurationPath);
  assert.equal(requests[3].payload.profile.repositoryRoot, repositoryRoot);
  assert.equal(requests[3].payload.networkPolicyPath, networkPolicyPath);
  assert.equal(JSON.stringify(requests).includes("cleartext"), false);
});
