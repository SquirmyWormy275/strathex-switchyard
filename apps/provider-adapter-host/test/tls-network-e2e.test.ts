import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import { copyFile, cp, mkdir, mkdtemp, readFile, realpath, rm, writeFile } from "node:fs/promises";
import { createServer } from "node:net";
import { dirname, isAbsolute, join, resolve } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import { ProtectedJsonStore } from "../../../packages/control-plane/src/store.ts";
import {
  createDirectConfiguredNetworkBroker,
  loadConfiguredNetworkPolicy,
  type ConfiguredNetworkRequest,
  type ConfiguredNetworkResult,
  type ConfiguredNetworkPolicy,
  type ConfiguredNetworkRoute,
  type NetworkContainmentFence
} from "../../windows-companion/src/configured-network.ts";
import { DurableCredentialReferenceVault, type CredentialContainmentFence } from "../../windows-companion/src/durable-credentials.ts";
import { WindowsDpapiCurrentUserProtector, type UserSecretProtector } from "../../windows-companion/src/windows-secret.ts";
import { providerDispatchProfileIdentityDigest, type ProviderDispatchLeaseProfile } from "../../windows-companion/src/provider-dispatch-lease.ts";

const repository = resolve(dirname(fileURLToPath(import.meta.url)), "../../..");
const powershell = "pwsh.exe";
const windowsPowerShell = "C:\\Windows\\System32\\WindowsPowerShell\\v1.0\\powershell.exe";
const trace = (label: string) => { if (process.env.SXSY_PROVIDER_E2E_TRACE === "1") process.stderr.write(`SXSY_PROVIDER_E2E_TRACE=${label}\n`); };

class MemoryProtector implements UserSecretProtector {
  readonly provider = "provider-e2e-test";
  private readonly values = new Map<string, Uint8Array>();
  async seal(cleartext: Uint8Array): Promise<string> { const id = `sealed-${this.values.size + 1}`; this.values.set(id, new Uint8Array(cleartext)); return id; }
  async open(sealed: string): Promise<Uint8Array> { const value = this.values.get(sealed); if (!value) throw new Error("missing"); return new Uint8Array(value); }
}

class ClearFence implements CredentialContainmentFence, NetworkContainmentFence {
  async check() { return { allowed: true, reason: "clear" }; }
}

test("provider secret generation validates and Initialize emits its exact ready-to-provision receipt", { skip: process.platform !== "win32" }, async (context) => {
  const local = process.env.LOCALAPPDATA;
  if (!local || !isAbsolute(local) || /[\0\r\n]/.test(local)) throw new Error("The isolated LocalApplicationData fixture is unavailable.");
  const suffix = randomUUID().replaceAll("-", "").slice(0, 12);
  const secretRoot = join(resolve(local), "STRATHEX", "switchyard", "provider-host", `test-secret-${suffix}`);
  const initializedRoot = join(resolve(local), "STRATHEX", "switchyard", "provider-host", `test-compat-${suffix}`);
  const initializationBundle = await mkdtemp(join(resolve(process.env.TEMP ?? local), "b122-init-bundle-"));
  const envelope = join(secretRoot, "authentication-token.envelope.json");
  context.after(async () => {
    await removeWithRetry(secretRoot);
    await removeWithRetry(initializedRoot);
    await removeWithRetry(initializationBundle);
  });

  const secretTool = join(repository, "deployment/windows/Protect-B122ProviderHostSecret.ps1");
  const generated = parseReceipt(await runPowerShell(secretTool, ["-Action", "GenerateAuthenticationToken", "-ProtectedStateRoot", secretRoot, "-EnvelopePath", envelope, "-ConfirmCurrentUser"]));
  assert.equal(generated.schema, "sxsy-b122.provider-host-secret-operation");
  assert.equal(generated.action, "generate-authentication-token");
  assert.equal(generated.status, "sealed");
  assert.equal(generated.cleartextOutput, false);
  const validated = parseReceipt(await runPowerShell(secretTool, ["-Action", "Validate", "-ProtectedStateRoot", secretRoot, "-EnvelopePath", envelope, "-ConfirmCurrentUser"]));
  assert.equal(validated.schema, "sxsy-b122.provider-host-secret-operation");
  assert.equal(validated.action, "validate");
  assert.equal(validated.status, "passed");
  assert.equal(validated.cleartextRead, false);

  const initializeScript = join(repository, "deployment/windows/Initialize-B122ProviderHost.ps1");
  const listenPort = String(await freePort());
  const instanceArguments = ["-RepositoryRoot", repository, "-InstanceName", `test-compat-${suffix}`, "-ListenPort", listenPort] as const;
  const windowsInitialized = parseReceipt(await runPowerShellExecutable(windowsPowerShell, initializeScript, [
    ...instanceArguments
  ], 60_000));
  const canonicalInitializedRoot = await realpath(initializedRoot);
  await assertInitializeReceipt(windowsInitialized, canonicalInitializedRoot);
  const expectedPolicy = await loadConfiguredNetworkPolicy(join(initializedRoot, "network-policy.json"));
  assertScopedProviderCredential(expectedPolicy);

  const initialized = parseReceipt(await runPowerShell(initializeScript, [...instanceArguments, "-Replace"]));
  await assertInitializeReceipt(initialized, canonicalInitializedRoot);
  assertEquivalentProviderPolicy(await loadConfiguredNetworkPolicy(join(initializedRoot, "network-policy.json")), expectedPolicy, "pwsh and Windows PowerShell 5.1 must emit the same parsed source policy");

  await createInitializationBundle(initializationBundle);
  const packagedInitialize = join(initializationBundle, "scripts", "Initialize-B122ProviderHost.ps1");
  const packagedInitialized = parseReceipt(await runPowerShellExecutable(windowsPowerShell, packagedInitialize, [
    ...instanceArguments, "-BundleRoot", initializationBundle, "-Replace"
  ], 60_000));
  await assertInitializeReceipt(packagedInitialized, canonicalInitializedRoot);
  assertEquivalentProviderPolicy(await loadConfiguredNetworkPolicy(join(initializedRoot, "network-policy.json")), expectedPolicy, "the packaged Windows PowerShell 5.1 policy must preserve the exact parsed source policy");

  const packagedPwsh = parseReceipt(await runPowerShellExecutable(powershell, packagedInitialize, [
    ...instanceArguments, "-BundleRoot", initializationBundle, "-Replace"
  ], 60_000));
  await assertInitializeReceipt(packagedPwsh, canonicalInitializedRoot);
  const finalPolicy = await loadConfiguredNetworkPolicy(join(initializedRoot, "network-policy.json"));
  assertEquivalentProviderPolicy(finalPolicy, expectedPolicy, "the packaged pwsh policy must preserve the exact parsed source policy");
  await assertDispatchProvisioningArtifact(initializedRoot, repository, finalPolicy);
});

test("packaged provider host lifecycle and the production pinned network broker interoperate over exact loopback TLS", { skip: process.platform !== "win32" }, async (context) => {
  const local = process.env.LOCALAPPDATA;
  if (!local || !isAbsolute(local) || /[\0\r\n]/.test(local)) throw new Error("The isolated LocalApplicationData fixture is unavailable.");
  const protectedBase = join(resolve(local), "STRATHEX", "switchyard", "provider-host");
  const root = join(protectedBase, `e2e-${randomUUID().replaceAll("-", "")}`);
  const bundle = join(root, "bundle");
  const config = join(root, "provider-host.json");
  let lifecycleReady = false;
  context.after(async () => {
    if (lifecycleReady) await runPowerShell(join(repository, "deployment/windows/Manage-B122ProviderHost.ps1"), ["-Action", "Stop", "-BundleRoot", bundle, "-ConfigurationPath", config]).catch(() => undefined);
    await removeWithRetry(root);
  });

  const certificate = join(root, "provider-certificate.pem");
  const privateKey = join(root, "provider-private-key.pem");
  const replacementCertificate = join(root, "provider-certificate-rotated.pem");
  const replacementPrivateKey = join(root, "provider-private-key-rotated.pem");
  const tokenEnvelope = join(root, "authentication-token.envelope.json");
  const journalEnvelope = join(root, "journal-authentication.envelope.json");
  const dispatchLeaseEnvelope = join(root, "dispatch-lease-authentication.envelope.json");
  const backendPlan = join(root, "backend-plan.json");
  const stateFile = join(root, "provider-state.jsonl");
  const networkPolicyPath = join(root, "network-policy.json");
  const firstPort = await freePort();
  const replacementPort = await freePort();
  await runPowerShell(join(repository, "deployment/windows/Protect-B122ProviderHostSecret.ps1"), ["-Action", "GenerateAuthenticationToken", "-ProtectedStateRoot", root, "-EnvelopePath", tokenEnvelope, "-ConfirmCurrentUser"]);
  await runPowerShell(join(repository, "deployment/windows/Protect-B122ProviderHostSecret.ps1"), ["-Action", "GenerateJournalAuthenticationKey", "-ProtectedStateRoot", root, "-EnvelopePath", journalEnvelope, "-ConfirmCurrentUser"]);
  await runPowerShell(join(repository, "deployment/windows/Protect-B122ProviderHostSecret.ps1"), ["-Action", "GenerateDispatchLeaseAuthenticationKey", "-ProtectedStateRoot", root, "-EnvelopePath", dispatchLeaseEnvelope, "-ConfirmCurrentUser"]);
  await runExecutable(process.execPath, [join(repository, "deployment/windows/New-B122LoopbackTlsIdentity.mjs"), "--certificate", certificate, "--private-key", privateKey]);
  await writeFile(backendPlan, JSON.stringify({ schema: "sxsy-b122.provider-host-backend-plan", version: 1, providers: [{ provider: "codex", kind: "fixture" }] }), { mode: 0o600 });
  const tls = JSON.parse(await runExecutable(process.execPath, [join(repository, "deployment/windows/Get-B122TlsIdentity.mjs"), "--certificate", certificate, "--private-key", privateKey]));
  const sealedToken = JSON.parse(await readFile(tokenEnvelope, "utf8"));
  const clearToken = await new WindowsDpapiCurrentUserProtector().open(sealedToken.sealed);
  const token = Buffer.from(clearToken).toString("ascii");
  clearToken.fill(0);
  assert.match(token, /^[a-f0-9]{64}$/);

  const configurationGenerator = join(repository, "deployment/windows/New-B122ProviderHostConfiguration.ps1");
  const configurationArguments = (certificatePath: string, privateKeyPath: string) => [
    "-OutputPath", config, "-ProtectedStateRoot", root, "-BackendPlanPath", backendPlan, "-CertificateFile", certificatePath, "-PrivateKeyFile", privateKeyPath,
    "-AuthenticationTokenEnvelopeFile", tokenEnvelope, "-JournalAuthenticationEnvelopeFile", journalEnvelope,
    "-DispatchLeaseAuthenticationEnvelopeFile", dispatchLeaseEnvelope, "-StateFile", stateFile, "-ListenHost", "127.0.0.1", "-AllowFixtureBackends"
  ];
  await runPowerShell(configurationGenerator, [...configurationArguments(certificate, privateKey), "-ListenPort", String(firstPort)]);
  await runExecutable(process.execPath, [join(repository, "deployment/windows/New-B122LoopbackTlsIdentity.mjs"), "--certificate", replacementCertificate, "--private-key", replacementPrivateKey]);
  const rotatedTls = JSON.parse(await runExecutable(process.execPath, [join(repository, "deployment/windows/Get-B122TlsIdentity.mjs"), "--certificate", replacementCertificate, "--private-key", replacementPrivateKey]));
  assert.notEqual(rotatedTls.tlsSpkiSha256, tls.tlsSpkiSha256, "a TLS rotation must establish a new exact public-key identity");
  await runPowerShell(configurationGenerator, [...configurationArguments(replacementCertificate, replacementPrivateKey), "-ListenPort", String(replacementPort), "-Replace"]);
  const rotated = JSON.parse(await readFile(config, "utf8"));
  assert.equal(rotated.tls.tlsSpkiSha256, rotatedTls.tlsSpkiSha256);
  await runPowerShell(join(repository, "deployment/windows/Restore-B122ProviderHostConfiguration.ps1"), ["-ConfigurationPath", config, "-Force"]);
  const restored = JSON.parse(await readFile(config, "utf8"));
  assert.equal(restored.listen.port, firstPort, "configuration rollback restores the previously validated exact listener");
  assert.equal(restored.tls.tlsSpkiSha256, tls.tlsSpkiSha256);
  trace("configuration-ready");

  await runPowerShell(join(repository, "deployment/windows/New-B122NetworkPolicy.ps1"), [
    "-GitHubOwner", "fixture", "-GitHubRepository", "fixture", "-ProviderConfigurationPath", config, "-OutputPath", networkPolicyPath
  ]);
  const policy = await loadConfiguredNetworkPolicy(networkPolicyPath);
  trace("network-policy-ready");
  const healthRoute = route(policy, "provider.health");
  assert.equal(healthRoute.boundary, "provider-host-loopback");
  assert.equal(healthRoute.tlsSpkiSha256, tls.tlsSpkiSha256);
  assert.equal(new URL(healthRoute.url).port, String(firstPort));

  await createFixtureBundle(bundle);
  lifecycleReady = true;
  const started = parseReceipt(await runPowerShellExecutable(windowsPowerShell, join(repository, "deployment/windows/Manage-B122ProviderHost.ps1"), ["-Action", "Start", "-BundleRoot", bundle, "-ConfigurationPath", config, "-WaitForHealth"], 240_000));
  trace("provider-started");
  assert.equal(started.status, "running");
  assert.equal(started.tlsIdentityPinned, true);
  assert.equal(started.authenticated, true);
  const processId = Number(started.processId);
  assert.ok(Number.isSafeInteger(processId) && processId > 0);

  const fence = new ClearFence();
  const vault = new DurableCredentialReferenceVault(new ProtectedJsonStore({ filePath: join(root, "credential-vault.jsonl") }), new MemoryProtector(), fence);
  await vault.provision({ reference: "b122-provider-token", scopes: [{ repositoryRoot: root, adapterId: "configured-network", purpose: "provider-api" }] }, Buffer.from(token, "ascii"));
  trace("credential-provisioned");
  const broker = createDirectConfiguredNetworkBroker(policy, fence, vault.createAdapter("configured-network"));
  const health = await boundedBrokerRequest(broker, { routeId: "provider.health", repositoryRoot: root }, "provider health");
  assert.equal(health.outcome, "passed");
  assert.equal(JSON.parse(Buffer.from(health.body!).toString("utf8")).status, "ready");
  trace("broker-health-passed");

  const handshakeBody = {
    schema: "sxsy-b122.provider-handshake-request", version: 1, sessionId: "codex-e2e-session", provider: "codex",
    targetSnapshotId: "b".repeat(64), repositoryRoot: root, branch: "feature/provider-e2e", head: "d".repeat(40), requestedAt: new Date().toISOString()
  };
  const handshake = await boundedBrokerRequest(broker, { routeId: "provider.handshake.codex", repositoryRoot: root, body: JSON.stringify(handshakeBody) }, "diagnostic-only handshake");
  assert.equal(handshake.outcome, "failed", "a package-configurable credential-free fixture must never claim mediated capability");
  assert.equal(handshake.status, 503);
  assert.equal(JSON.parse(Buffer.from(handshake.body!).toString("utf8")).schema, "sxsy-b122.provider-host-error");
  trace("handshake-failed-closed");

  const wrongPinPolicy = replaceRoute(policy, "provider.health", { tlsSpkiSha256: "0".repeat(64) });
  assert.notEqual((await boundedBrokerRequest(createDirectConfiguredNetworkBroker(wrongPinPolicy, fence, vault.createAdapter("configured-network")), { routeId: "provider.health", repositoryRoot: root }, "wrong TLS pin")).outcome, "passed");
  const wrongPortPolicy = replaceRoute(policy, "provider.health", { url: healthRoute.url.replace(`:${firstPort}/`, `:${replacementPort}/`) });
  assert.notEqual((await boundedBrokerRequest(createDirectConfiguredNetworkBroker(wrongPortPolicy, fence, vault.createAdapter("configured-network")), { routeId: "provider.health", repositoryRoot: root }, "wrong provider port")).outcome, "passed");
  const unapprovedPrivatePolicy: ConfiguredNetworkPolicy = { version: 1, proxy: "direct", routes: [{ ...healthRoute, url: `https://10.0.0.8:${firstPort}/v1/b122/health`, boundary: undefined, tlsCaCertificatePem: undefined }] };
  assert.equal((await boundedBrokerRequest(createDirectConfiguredNetworkBroker(unapprovedPrivatePolicy, fence, vault.createAdapter("configured-network")), { routeId: "provider.health", repositoryRoot: root }, "unapproved private address")).outcome, "blocked");
  assert.throws(() => createDirectConfiguredNetworkBroker(replaceRoute(policy, "provider.health", { url: `https://10.0.0.8:${firstPort}/v1/b122/health` }), fence, vault.createAdapter("configured-network")), /loopback/i);

  const missingCredential = createDirectConfiguredNetworkBroker(policy, fence);
  assert.equal((await boundedBrokerRequest(missingCredential, { routeId: "provider.health", repositoryRoot: root }, "missing credential adapter")).outcome, "unavailable");
  assert.equal(await vault.revoke("b122-provider-token", "provider E2E revocation"), true);
  assert.equal((await boundedBrokerRequest(broker, { routeId: "provider.health", repositoryRoot: root }, "revoked credential")).outcome, "blocked");
  trace("negative-network-cases-passed");

  const healthReceipt = parseReceipt(await runPowerShell(join(repository, "deployment/windows/Manage-B122ProviderHost.ps1"), ["-Action", "Health", "-BundleRoot", bundle, "-ConfigurationPath", config]));
  assert.equal(healthReceipt.status, "passed");
  assert.equal(healthReceipt.tlsIdentityPinned, true);
  trace("managed-health-passed");
  const lifecycleArguments = ["-BundleRoot", bundle, "-ConfigurationPath", config] as const;
  const packagedManage = join(bundle, "scripts", "Manage-B122ProviderHost.ps1");
  const status = parseReceipt(await runPowerShellExecutable(windowsPowerShell, packagedManage, ["-Action", "Status", ...lifecycleArguments]));
  assert.equal(status.status, "running");
  assert.equal(Number(status.processId), processId);
  trace("packaged-windows-powershell-status-passed");
  const packagedHealth = parseReceipt(await runPowerShellExecutable(powershell, packagedManage, ["-Action", "Health", ...lifecycleArguments]));
  assert.equal(packagedHealth.status, "passed");
  assert.equal(packagedHealth.tlsIdentityPinned, true);
  trace("packaged-pwsh-health-passed");
  const stopped = parseReceipt(await runPowerShellExecutable(powershell, packagedManage, ["-Action", "Stop", ...lifecycleArguments]));
  lifecycleReady = false;
  assert.equal(stopped.status, "stopped");
  trace("packaged-pwsh-stop-passed");
  assert.equal((stopped.processes as Array<Record<string, unknown>>)[0]?.gracefulShutdownAcknowledged, true);
  // The signed lifecycle receipt is scoped to the owned process tree. A
  // subsequent PID-only probe is not valid evidence on Windows because the OS
  // may reuse that PID immediately after this process-heavy suite.
  assert.equal(stopped.survivorCount, 0);
});

async function createFixtureBundle(bundle: string): Promise<void> {
  await Promise.all([
    mkdir(join(bundle, "runtime"), { recursive: true }), mkdir(join(bundle, "provider-adapter-host"), { recursive: true }),
    mkdir(join(bundle, "scripts", "provisioning"), { recursive: true })
  ]);
  await Promise.all([
    copyFile(process.execPath, join(bundle, "runtime", "node.exe")),
    cp(join(repository, "apps/provider-adapter-host/dist"), join(bundle, "provider-adapter-host/dist"), { recursive: true }),
    copyFile(join(repository, "apps/provider-adapter-host/package.json"), join(bundle, "provider-adapter-host/package.json")),
    copyFile(join(repository, "deployment/windows/Manage-B122ProviderHost.ps1"), join(bundle, "scripts/Manage-B122ProviderHost.ps1")),
    copyFile(join(repository, "deployment/windows/Test-B122ProviderHostHealth.mjs"), join(bundle, "scripts/Test-B122ProviderHostHealth.mjs")),
    copyFile(join(repository, "deployment/windows/Get-B122TlsIdentity.mjs"), join(bundle, "scripts/Get-B122TlsIdentity.mjs")),
    copyFile(join(repository, "deployment/windows/Test-B122ProviderHostConfiguration.ps1"), join(bundle, "scripts/provisioning/Test-B122ProviderHostConfiguration.ps1")),
    writeFile(join(bundle, "release.json"), JSON.stringify({ schema: "sxsy-b122.windows-release", version: 1, sourceCommit: "a".repeat(40) }))
  ]);
}

async function createInitializationBundle(bundle: string): Promise<void> {
  await Promise.all([
    mkdir(join(bundle, "runtime"), { recursive: true }),
    mkdir(join(bundle, "scripts", "provisioning"), { recursive: true })
  ]);
  await Promise.all([
    copyFile(process.execPath, join(bundle, "runtime", "node.exe")),
    ...["Initialize-B122ProviderHost.ps1", "Protect-B122ProviderHostSecret.ps1", "New-B122LoopbackTlsIdentity.mjs", "Get-B122TlsIdentity.mjs", "New-B122NetworkPolicy.ps1"]
      .map((name) => copyFile(join(repository, "deployment", "windows", name), join(bundle, "scripts", name))),
    ...["New-B122ProviderHostConfiguration.ps1", "Test-B122ProviderHostConfiguration.ps1"]
      .map((name) => copyFile(join(repository, "deployment", "windows", name), join(bundle, "scripts", "provisioning", name)))
  ]);
}

function replaceRoute(policy: ConfiguredNetworkPolicy, routeId: string, replacement: Partial<ConfiguredNetworkRoute>): ConfiguredNetworkPolicy {
  return { ...policy, routes: policy.routes.map((candidate) => candidate.id === routeId ? { ...candidate, ...replacement } : candidate) };
}
async function boundedBrokerRequest(
  broker: { request(input: ConfiguredNetworkRequest): Promise<ConfiguredNetworkResult> },
  input: ConfiguredNetworkRequest,
  label: string,
  abortAfterMs = 8_000
): Promise<ConfiguredNetworkResult> {
  const controller = new AbortController();
  let rejectDeadline: ((error: Error) => void) | undefined;
  const deadline = new Promise<never>((_resolve, reject) => { rejectDeadline = reject; });
  const abortTimer = setTimeout(() => controller.abort(), abortAfterMs);
  const settleTimer = setTimeout(() => rejectDeadline?.(new Error(`${label} did not settle within ${abortAfterMs + 1_000}ms after cancellation.`)), abortAfterMs + 1_000);
  try {
    return await Promise.race([broker.request({ ...input, signal: controller.signal }), deadline]);
  } finally {
    clearTimeout(abortTimer);
    clearTimeout(settleTimer);
  }
}
function route(policy: ConfiguredNetworkPolicy, routeId: string): ConfiguredNetworkRoute { const value = policy.routes.find((candidate) => candidate.id === routeId); if (!value) throw new Error(`missing ${routeId}`); return value; }
function parseReceipt(value: string): Record<string, unknown> { const line = value.trim().split(/\r?\n/).filter(Boolean).at(-1); if (!line) throw new Error("missing lifecycle receipt"); return JSON.parse(line); }
async function assertInitializeReceipt(receipt: Record<string, unknown>, expectedRoot: string): Promise<void> {
  assert.equal(receipt.schema, "sxsy-b122.provider-host-bootstrap");
  assert.equal(receipt.status, "ready-to-provision");
  assert.equal((await realpath(resolve(String(receipt.protectedStateRoot)))).toLowerCase(), (await realpath(resolve(expectedRoot))).toLowerCase());
  assert.equal(receipt.fixtureDiagnosticOnly, true);
  assert.equal(receipt.providerEffectsEnabled, false);
  assert.equal(receipt.journalAuthenticationStable, true);
  assert.equal(receipt.dispatchLeaseAuthenticationStable, true);
  assert.equal(receipt.authenticationTokenExposed, false);
  assert.equal(receipt.dispatchLeaseKeyExposed, false);
  assert.equal(receipt.proprietaryCredentialsAccessed, false);
}
function assertScopedProviderCredential(policy: ConfiguredNetworkPolicy): string {
  const references = new Set(policy.routes.filter((candidate) => candidate.credential?.purpose === "provider-api").map((candidate) => candidate.credential!.reference));
  assert.equal(references.size, 1, "all provider-host routes must share one exact repository-scoped bearer reference");
  const reference = [...references][0]!;
  assert.match(reference, /^b122-provider-bearer-[a-f0-9]{64}$/);
  return reference;
}
function assertEquivalentProviderPolicy(actual: ConfiguredNetworkPolicy, expected: ConfiguredNetworkPolicy, message: string): void {
  assertScopedProviderCredential(actual);
  assertScopedProviderCredential(expected);
  const normalize = (policy: ConfiguredNetworkPolicy): ConfiguredNetworkPolicy => ({
    ...policy,
    routes: policy.routes.map((candidate) => candidate.credential?.purpose === "provider-api"
      ? { ...candidate, credential: { ...candidate.credential, reference: "b122-provider-bearer-<repository-scoped>" } }
      : candidate)
  });
  assert.deepEqual(normalize(actual), normalize(expected), message);
}
async function assertDispatchProvisioningArtifact(initializedRoot: string, expectedRepositoryRoot: string, policy: ConfiguredNetworkPolicy): Promise<void> {
  const artifact = JSON.parse(await readFile(join(initializedRoot, "companion-provisioning.json"), "utf8")) as Record<string, unknown>;
  assert.equal(artifact.schema, "sxsy-b122.provider-host-companion-provisioning");
  assert.equal(artifact.version, 2);
  assert.ok(Array.isArray(artifact.credentials) && artifact.credentials.length === 2);
  const profile = artifact.profile as ProviderDispatchLeaseProfile;
  assert.equal(resolve(profile.repositoryRoot).toLowerCase(), resolve(expectedRepositoryRoot).toLowerCase());
  assert.equal(profile.profileDigest, providerDispatchProfileIdentityDigest(profile));
  assert.ok(profile.generation >= 1);
  if (profile.generation === 1) {
    assert.equal(profile.expectedPriorConfigurationSha256, null);
    assert.equal(profile.expectedPriorProfileDigest, null);
  } else {
    assert.match(profile.expectedPriorConfigurationSha256!, /^[a-f0-9]{64}$/);
    assert.match(profile.expectedPriorProfileDigest!, /^[a-f0-9]{64}$/);
  }
  const credentials = artifact.credentials as Array<Record<string, unknown>>;
  const bearer = credentials.find((candidate) => candidate.role === "bearer");
  const dispatch = credentials.find((candidate) => candidate.role === "dispatch-lease");
  assert.equal(bearer?.reference, profile.bearerCredentialReference);
  assert.equal(dispatch?.reference, profile.dispatchLeaseCredentialReference);
  assert.notEqual(bearer?.reference, dispatch?.reference);
  assert.equal(profile.bearerCredentialReference, assertScopedProviderCredential(policy));
  const config = JSON.parse(await readFile(profile.configurationPath, "utf8")) as Record<string, unknown>;
  assert.equal(
    (await realpath(String(config.dispatchLeaseAuthenticationEnvelopeFile))).toLowerCase(),
    (await realpath(join(initializedRoot, "dispatch-lease-authentication.envelope.json"))).toLowerCase(),
    "the dispatch-lease envelope must resolve to the exact initialized artifact even when Windows returns an 8.3 alias"
  );
}
async function removeWithRetry(path: string): Promise<void> {
  let failure: unknown;
  for (let attempt = 0; attempt < 6; attempt += 1) {
    try { await rm(path, { recursive: true, force: true }); return; }
    catch (error) { failure = error; }
    await new Promise((done) => setTimeout(done, 25 * 2 ** attempt));
  }
  throw failure;
}
const reservedFixturePorts = new Set<number>();

async function freePort(): Promise<number> {
  // Do not ask Windows for port 0 here. It normally returns a port from the
  // outbound ephemeral range, and this fixture performs certificate/DPAPI
  // provisioning after releasing the probe listener. A busy aggregate run can
  // legitimately reuse that ephemeral port before the provider binds it.
  const first = 20_000 + Math.floor(Math.random() * 20_000);
  for (let offset = 0; offset < 20_000; offset += 1) {
    const candidate = 20_000 + ((first - 20_000 + offset) % 20_000);
    if (!reservedFixturePorts.has(candidate) && await canListen(candidate)) {
      reservedFixturePorts.add(candidate);
      return candidate;
    }
  }
  throw new Error("No non-ephemeral loopback port is available for the provider fixture.");
}

function canListen(port: number): Promise<boolean> {
  return new Promise((resolvePort) => {
    const server = createServer();
    server.once("error", () => resolvePort(false));
    server.listen(port, "127.0.0.1", () => server.close((error) => resolvePort(!error)));
  });
}
function runPowerShell(script: string, arguments_: readonly string[]): Promise<string> {
  return runPowerShellExecutable(powershell, script, arguments_);
}
function runPowerShellExecutable(executable: string, script: string, arguments_: readonly string[], timeoutMs = 120_000): Promise<string> {
  return new Promise((resolveRun, rejectRun) => {
    const childEnvironment: NodeJS.ProcessEnv = { ...process.env, SXSY_PROVIDER_E2E_TRACE: "1" };
    if (resolve(executable).toLowerCase() === resolve(windowsPowerShell).toLowerCase()) {
      for (const name of Object.keys(childEnvironment)) if (name.toLowerCase() === "psmodulepath") delete childEnvironment[name];
    }
    const child = spawn(executable, ["-NoLogo", "-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass", "-File", script, ...arguments_], {
      cwd: repository,
      env: childEnvironment,
      windowsHide: true,
      stdio: ["ignore", "pipe", "pipe"]
    });
    const stdout: Buffer[] = []; const stderr: Buffer[] = [];
    let timedOut = false;
    child.stdout.on("data", (chunk) => stdout.push(Buffer.from(chunk))); child.stderr.on("data", (chunk) => stderr.push(Buffer.from(chunk)));
    const timer = setTimeout(() => {
      timedOut = true;
      if (!child.pid) { child.kill(); return; }
      const killer = spawn("C:\\Windows\\System32\\taskkill.exe", ["/PID", String(child.pid), "/T", "/F"], { windowsHide: true, stdio: "ignore" });
      killer.once("error", () => child.kill());
      killer.once("close", (code) => { if (code !== 0) child.kill(); });
      setTimeout(() => child.kill(), 5_000).unref();
    }, timeoutMs);
    child.once("error", rejectRun);
    child.once("close", (code) => {
      clearTimeout(timer);
      const errorText = Buffer.concat(stderr).toString("utf8");
      const safeTrace = [...errorText.matchAll(/SXSY_PROVIDER_E2E_TRACE=([a-z0-9-]{1,64})/g)].map((match) => match[1]).slice(-32);
      if (timedOut) { rejectRun(new Error(`PowerShell ${script} timed out; safeTrace=${safeTrace.join(",") || "none"}.`)); return; }
      code === 0 ? resolveRun(Buffer.concat(stdout).toString("utf8")) : rejectRun(new Error(`PowerShell ${script} failed (${code}): ${errorText}`));
    });
  });
}

function runExecutable(executable: string, arguments_: readonly string[], environment?: NodeJS.ProcessEnv): Promise<string> {
  return new Promise((resolveRun, rejectRun) => {
    const child = spawn(executable, arguments_, { cwd: repository, windowsHide: true, ...(environment ? { env: environment } : {}), stdio: ["ignore", "pipe", "pipe"] });
    const stdout: Buffer[] = []; const stderr: Buffer[] = [];
    child.stdout.on("data", (chunk) => stdout.push(Buffer.from(chunk))); child.stderr.on("data", (chunk) => stderr.push(Buffer.from(chunk)));
    child.once("error", rejectRun);
    child.once("close", (code) => code === 0 ? resolveRun(Buffer.concat(stdout).toString("utf8")) : rejectRun(new Error(`Command failed (${code}): ${Buffer.concat(stderr).toString("utf8")}`)));
  });
}
