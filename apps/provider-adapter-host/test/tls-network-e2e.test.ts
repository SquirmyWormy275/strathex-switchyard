import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { copyFile, cp, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
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

const repository = resolve(dirname(fileURLToPath(import.meta.url)), "../../..");
const powershell = "pwsh.exe";
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

test("packaged provider host lifecycle and the production pinned network broker interoperate over exact loopback TLS", { skip: process.platform !== "win32" }, async (context) => {
  // The production PowerShell tools use the Windows Known Folder API rather
  // than mutable environment variables. The isolated runner deliberately
  // redirects LOCALAPPDATA, so query the same authority and still create only
  // one unique receipt-owned child beneath it.
  const protectedBase = join(await windowsKnownLocalAppData(), "STRATHEX", "switchyard", "provider-host");
  await mkdir(protectedBase, { recursive: true });
  const root = await mkdtemp(join(protectedBase, "e2e-"));
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
  const backendPlan = join(root, "backend-plan.json");
  const stateFile = join(root, "provider-state.jsonl");
  const networkPolicyPath = join(root, "network-policy.json");
  const firstPort = await freePort();
  const replacementPort = await freePort();
  await runExecutable(process.execPath, [join(repository, "deployment/windows/New-B122LoopbackTlsIdentity.mjs"), "--certificate", certificate, "--private-key", privateKey]);
  await runPowerShell(join(repository, "deployment/windows/Protect-B122ProviderHostSecret.ps1"), ["-Action", "GenerateAuthenticationToken", "-ProtectedStateRoot", root, "-EnvelopePath", tokenEnvelope, "-ConfirmCurrentUser"]);
  await runPowerShell(join(repository, "deployment/windows/Protect-B122ProviderHostSecret.ps1"), ["-Action", "GenerateJournalAuthenticationKey", "-ProtectedStateRoot", root, "-EnvelopePath", journalEnvelope, "-ConfirmCurrentUser"]);
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
    "-AuthenticationTokenEnvelopeFile", tokenEnvelope, "-JournalAuthenticationEnvelopeFile", journalEnvelope, "-StateFile", stateFile, "-ListenHost", "127.0.0.1", "-AllowFixtureBackends"
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
  const started = parseReceipt(await runPowerShell(join(repository, "deployment/windows/Manage-B122ProviderHost.ps1"), ["-Action", "Start", "-BundleRoot", bundle, "-ConfigurationPath", config, "-WaitForHealth"]));
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
  const status = parseReceipt(await runPowerShell(join(repository, "deployment/windows/Manage-B122ProviderHost.ps1"), ["-Action", "Status", "-BundleRoot", bundle, "-ConfigurationPath", config]));
  assert.equal(status.status, "running");
  assert.equal(Number(status.processId), processId);
  trace("managed-status-passed");
  const stopped = parseReceipt(await runPowerShell(join(repository, "deployment/windows/Manage-B122ProviderHost.ps1"), ["-Action", "Stop", "-BundleRoot", bundle, "-ConfigurationPath", config]));
  lifecycleReady = false;
  assert.equal(stopped.status, "stopped");
  trace("managed-stop-passed");
  assert.equal((stopped.processes as Array<Record<string, unknown>>)[0]?.gracefulShutdownAcknowledged, true);
  assert.equal(stopped.survivorCount, 0);
  await assert.rejects(async () => process.kill(processId, 0), /ESRCH|not found|no such process/i);
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
async function windowsKnownLocalAppData(): Promise<string> {
  const systemRoot = process.env.SystemRoot ?? process.env.WINDIR;
  if (!systemRoot || !isAbsolute(systemRoot) || /[\0\r\n]/.test(systemRoot)) throw new Error("Windows SystemRoot is unavailable.");
  const executable = join(resolve(systemRoot), "System32", "WindowsPowerShell", "v1.0", "powershell.exe");
  const command = `$sid=[Security.Principal.WindowsIdentity]::GetCurrent().User.Value;$profile=[string](Get-ItemPropertyValue -LiteralPath ('Registry::HKEY_LOCAL_MACHINE\\SOFTWARE\\Microsoft\\Windows NT\\CurrentVersion\\ProfileList\\'+$sid) -Name ProfileImagePath);$local=[string](Get-ItemPropertyValue -LiteralPath 'Registry::HKEY_CURRENT_USER\\Software\\Microsoft\\Windows\\CurrentVersion\\Explorer\\User Shell Folders' -Name 'Local AppData');if([string]::IsNullOrWhiteSpace($profile)-or[string]::IsNullOrWhiteSpace($local)){exit 1};if($local.StartsWith('%USERPROFILE%',[StringComparison]::OrdinalIgnoreCase)){$local=Join-Path $profile $local.Substring(13).TrimStart([char]92,[char]47)}elseif($local.Contains('%')-or-not[IO.Path]::IsPathRooted($local)){exit 1};[Console]::Out.Write([IO.Path]::GetFullPath($local))`;
  const value = (await runExecutable(executable, ["-NoLogo", "-NoProfile", "-NonInteractive", "-Command", command], { SystemRoot: resolve(systemRoot), WINDIR: resolve(systemRoot) })).trim();
  if (!isAbsolute(value) || /[\0\r\n]/.test(value)) throw new Error("Windows LocalApplicationData Known Folder is unavailable.");
  return resolve(value);
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
function freePort(): Promise<number> { return new Promise((resolvePort, rejectPort) => { const server = createServer(); server.once("error", rejectPort); server.listen(0, "127.0.0.1", () => { const address = server.address(); if (!address || typeof address === "string") return rejectPort(new Error("missing port")); server.close((error) => error ? rejectPort(error) : resolvePort(address.port)); }); }); }
function runPowerShell(script: string, arguments_: readonly string[]): Promise<string> {
  return new Promise((resolveRun, rejectRun) => {
    const child = spawn(powershell, ["-NoLogo", "-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass", "-File", script, ...arguments_], { cwd: repository, windowsHide: true, stdio: ["ignore", "pipe", "pipe"] });
    const stdout: Buffer[] = []; const stderr: Buffer[] = [];
    child.stdout.on("data", (chunk) => stdout.push(Buffer.from(chunk))); child.stderr.on("data", (chunk) => stderr.push(Buffer.from(chunk)));
    child.once("error", rejectRun);
    child.once("close", (code) => code === 0 ? resolveRun(Buffer.concat(stdout).toString("utf8")) : rejectRun(new Error(`PowerShell ${script} failed (${code}): ${Buffer.concat(stderr).toString("utf8")}`)));
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
