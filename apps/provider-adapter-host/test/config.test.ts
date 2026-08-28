import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import type { UserSecretProtector } from "../../windows-companion/src/windows-secret.ts";
import { loadProviderBackendRuntime, loadProviderHostConfiguration, type ProviderHostConfigurationLoadOptions } from "../src/config.ts";
import { openProviderHostSecretEnvelope } from "../src/secret-envelope.ts";
import type { ProviderHostPathSecurity } from "../src/windows-path-security.ts";
import { createProviderHostStore } from "../src/state.ts";
import { createLoopbackTlsFixture } from "./support/tls-fixture.ts";

const tlsFixture = createLoopbackTlsFixture();
const protector: UserSecretProtector = {
  provider: "test-base64-protector",
  async seal(cleartext) { return Buffer.from(cleartext).toString("base64"); },
  async open(sealed) { return Buffer.from(sealed, "base64"); }
};

class RecordingPathSecurity implements ProviderHostPathSecurity {
  calls: Readonly<{ root: string; paths: readonly string[] }>[] = [];
  async assertCurrentUserProtected(root: string, paths: readonly string[]): Promise<void> { this.calls.push({ root, paths: [...paths] }); }
}

function pinnedTls(certificateFile: string, privateKeyFile: string) {
  return {
    certificateFile, privateKeyFile,
    certificateSha256: tlsFixture.certificateFileSha256,
    privateKeySha256: tlsFixture.privateKeyFileSha256,
    tlsSpkiSha256: tlsFixture.tlsSpkiSha256
  };
}

async function envelope(path: string, secret: string): Promise<void> {
  await writeFile(path, JSON.stringify({
    schema: "sxsy-b122.provider-host-secret-envelope", version: 1,
    protector: protector.provider, sealed: await protector.seal(Buffer.from(secret, "utf8"))
  }));
}

test("provider secret envelope returns the protector-owned buffer so caller zeroization leaves no duplicate", async (context) => {
  const root = await mkdtemp(join(tmpdir(), "b122-provider-secret-zero-"));
  context.after(async () => rm(root, { recursive: true, force: true }));
  const path = join(root, "secret.json");
  const protectorOwned = Buffer.from("provider-secret", "utf8");
  const trackingProtector: UserSecretProtector = {
    provider: "tracking-protector",
    async seal() { throw new Error("not used"); },
    async open() { return protectorOwned; }
  };
  await writeFile(path, JSON.stringify({ schema: "sxsy-b122.provider-host-secret-envelope", version: 1, protector: trackingProtector.provider, sealed: "YQ==" }));
  const opened = await openProviderHostSecretEnvelope(path, trackingProtector);
  assert.equal(opened, protectorOwned);
  opened.fill(0);
  assert.equal(protectorOwned.every((byte) => byte === 0), true);
});

function options(root: string, security = new RecordingPathSecurity()): ProviderHostConfigurationLoadOptions {
  return { secretProtector: protector, pathSecurity: security, allowedProtectedBaseRoot: root };
}

test("configuration requires digest-pinned modules and DPAPI-shaped protected credential references", async (context) => {
  const root = await mkdtemp(join(tmpdir(), "b122-provider-host-config-"));
  context.after(async () => rm(root, { recursive: true, force: true }));
  const configPath = join(root, "config.json");
  const tokenPath = join(root, "token.envelope.json");
  const journalPath = join(root, "journal.envelope.json");
  const dispatchLeasePath = join(root, "dispatch-lease.envelope.json");
  const credentialPath = join(root, "provider.envelope.json");
  const certPath = join(root, "cert.pem");
  const keyPath = join(root, "key.pem");
  const modulePath = join(root, "backend.mjs");
  await Promise.all([
    envelope(tokenPath, "a".repeat(64)), envelope(journalPath, "b".repeat(64)), envelope(dispatchLeasePath, "c".repeat(64)), envelope(credentialPath, "provider-secret"),
    writeFile(certPath, tlsFixture.certificatePem), writeFile(keyPath, tlsFixture.privateKeyPem),
    writeFile(modulePath, "export const value = 1;")
  ]);
  const base = {
    schema: "sxsy-b122.provider-host-config", version: 1, protectedStateRoot: root,
    listen: { host: "127.0.0.1", port: 4747 }, tls: pinnedTls(certPath, keyPath),
    authenticationTokenEnvelopeFile: tokenPath, journalAuthenticationEnvelopeFile: journalPath, dispatchLeaseAuthenticationEnvelopeFile: dispatchLeasePath, stateFile: join(root, "state.jsonl")
  };
  await writeFile(configPath, JSON.stringify({ ...base, providers: [{ provider: "codex", kind: "module", modulePath, moduleSha256: "0".repeat(64), credentialEnvelopeFile: credentialPath }] }));
  await assert.rejects(() => loadProviderHostConfiguration(configPath, options(root)), /digest|sha256/i);

  await writeFile(configPath, JSON.stringify({ ...base, authenticationTokenFile: tokenPath, providers: [{ provider: "codex", kind: "module", modulePath, moduleSha256: "0".repeat(64) }] }));
  await assert.rejects(() => loadProviderHostConfiguration(configPath, options(root)), /schema|credential/i);
});

test("configured Mediated effect drivers are separate digest-pinned host modules", async (context) => {
  const root = await mkdtemp(join(tmpdir(), "b122-provider-effect-driver-config-"));
  context.after(async () => rm(root, { recursive: true, force: true }));
  const paths = {
    config: join(root, "config.json"), token: join(root, "token.json"), journal: join(root, "journal.json"),
    dispatchLease: join(root, "dispatch-lease.json"), credential: join(root, "credential.json"),
    cert: join(root, "cert.pem"), key: join(root, "key.pem"), provider: join(root, "provider.mjs"), driver: join(root, "driver.mjs")
  };
  const providerSource = `export function createB122ProviderRuntimePort(input){
    globalThis.__b122ProviderFactoryKeys = Object.keys(input).sort();
    const observation = (request) => ({ ...request, capabilities:["registered","observable","controllable","mediated"], status:"running", adapterVersion:"provider-v1" });
    return { provider: input.provider,
      async handshake(request){ return observation(request); }, async observeSession(request){ return observation(request); },
      async prepareMediatedEffect(request,binding){ return {schema:"sxsy-b122.provider-mediated-effect-intent",version:1,authorizationId:binding.authorizationId,requestDigest:"0".repeat(64),operation:"execute_exact_request"}; },
      async prepareMediatedCouncilEffect(request,binding){ return {schema:"sxsy-b122.provider-mediated-council-intent",version:1,authorizationId:binding.authorizationId,requestDigest:"0".repeat(64),operation:"acknowledge_exact_phase"}; },
      async execute(){ throw new Error("mediated effect must not call provider execute"); }, async observeWorkflowContext(){}, async reanchor(){}, async observeReanchor(){}, async observeOperation(){}, async cancelOperation(){}, async council(){}, async observeCouncil(){}, async shutdown(){} };
  }`;
  const driverSource = `export function createB122ProviderMediatedEffectDriver(input){
    globalThis.__b122EffectDriverFactoryKeys = Object.keys(input).sort();
    globalThis.__b122EffectDriverAllowedSurfaces = input.allowedSurfaces;
    return { async executeCommand(){ throw new Error("not invoked"); }, async executeCouncil(){ throw new Error("not invoked"); },
      async observeCommand(){ throw new Error("not invoked"); }, async cancelCommand(){ throw new Error("not invoked"); }, async observeCouncil(){ throw new Error("not invoked"); } };
  }`;
  await Promise.all([
    envelope(paths.token, "a".repeat(64)), envelope(paths.journal, "b".repeat(64)), envelope(paths.dispatchLease, "c".repeat(64)),
    envelope(paths.credential, "provider-secret"), writeFile(paths.cert, tlsFixture.certificatePem), writeFile(paths.key, tlsFixture.privateKeyPem),
    writeFile(paths.provider, providerSource), writeFile(paths.driver, driverSource)
  ]);
  const configuration = {
    schema: "sxsy-b122.provider-host-config", version: 1, protectedStateRoot: root,
    listen: { host: "127.0.0.1", port: 4747 }, tls: pinnedTls(paths.cert, paths.key),
    authenticationTokenEnvelopeFile: paths.token, journalAuthenticationEnvelopeFile: paths.journal,
    dispatchLeaseAuthenticationEnvelopeFile: paths.dispatchLease, stateFile: join(root, "state.jsonl"),
    providers: [{ provider: "codex", kind: "module", modulePath: paths.provider, moduleSha256: createHash("sha256").update(providerSource).digest("hex"), credentialEnvelopeFile: paths.credential }],
    effectDrivers: [{ provider: "codex", kind: "module", modulePath: paths.driver, moduleSha256: createHash("sha256").update(driverSource).digest("hex") }]
  };
  await writeFile(paths.config, JSON.stringify({ ...configuration, effectDrivers: [{ ...configuration.effectDrivers[0], moduleSha256: "0".repeat(64) }] }));
  await assert.rejects(() => loadProviderHostConfiguration(paths.config, options(root)), /effect driver.*digest|digest.*effect driver/i);

  await writeFile(paths.config, JSON.stringify({
    ...configuration,
    effectDrivers: [{ ...configuration.effectDrivers[0], automation: true }]
  }));
  await assert.rejects(
    () => loadProviderHostConfiguration(paths.config, options(root)),
    /effect driver.*invalid|effect driver list/i,
    "automation-specific effect-driver configuration must never be accepted"
  );

  await writeFile(paths.config, JSON.stringify(configuration));
  const loaded = await loadProviderHostConfiguration(paths.config, options(root));
  assert.equal(loaded.effectDrivers.length, 1);
  assert.deepEqual({
    provider: loaded.effectDrivers[0]?.provider,
    kind: loaded.effectDrivers[0]?.kind,
    modulePath: loaded.effectDrivers[0]?.modulePath,
    moduleSha256: loaded.effectDrivers[0]?.moduleSha256
  }, {
    provider: "codex", kind: "module", modulePath: paths.driver,
    moduleSha256: createHash("sha256").update(driverSource).digest("hex")
  });
  assert.equal(Buffer.from(loaded.effectDrivers[0]!.moduleSource).toString("utf8"), driverSource);
  const runtime = await loadProviderBackendRuntime(loaded, {
    mediatedFinalCurrent: { async assertCurrent() { throw new Error("not invoked during handshake"); } }
  });
  const handshake = await runtime.backends[0]!.handshake({
    sessionId: "session-configured-driver", provider: "codex", targetSnapshotId: "a".repeat(64), repositoryRoot: "C:\\repo",
    branch: "feat/driver", head: "b".repeat(40)
  }, new AbortController().signal);
  assert.deepEqual(handshake.capabilities, ["registered", "observable", "controllable", "mediated"]);
  assert.deepEqual((globalThis as Record<string, unknown>).__b122ProviderFactoryKeys, ["councilResources", "options", "provider"]);
  assert.deepEqual((globalThis as Record<string, unknown>).__b122EffectDriverFactoryKeys, [
    "adapterId", "allowedSurfaces", "configurationSha256", "driverModuleSha256", "provider", "providerModuleSha256"
  ]);
  assert.deepEqual((globalThis as Record<string, unknown>).__b122EffectDriverAllowedSurfaces, ["provider", "council"]);
  delete (globalThis as Record<string, unknown>).__b122ProviderFactoryKeys;
  delete (globalThis as Record<string, unknown>).__b122EffectDriverFactoryKeys;
  delete (globalThis as Record<string, unknown>).__b122EffectDriverAllowedSurfaces;
  await runtime.close();
  loaded.effectDrivers[0]!.moduleSource.fill(0);
  loaded.authenticationToken.fill(0); loaded.journalAuthenticationKey.fill(0); loaded.dispatchLeaseAuthenticationKey.fill(0);
  if (loaded.providers[0]?.kind === "module") { loaded.providers[0].credential.fill(0); loaded.providers[0].moduleSource.fill(0); }
});

test("credential-free fixture mode is loopback diagnostic-only and all owned paths are fenced", async (context) => {
  const root = await mkdtemp(join(tmpdir(), "b122-provider-host-fixture-config-"));
  context.after(async () => rm(root, { recursive: true, force: true }));
  const configPath = join(root, "config.json");
  const tokenPath = join(root, "token.envelope.json");
  const journalPath = join(root, "journal.envelope.json");
  const dispatchLeasePath = join(root, "dispatch-lease.envelope.json");
  const certPath = join(root, "cert.pem");
  const keyPath = join(root, "key.pem");
  await Promise.all([envelope(tokenPath, "a".repeat(64)), envelope(journalPath, "b".repeat(64)), envelope(dispatchLeasePath, "c".repeat(64)), writeFile(certPath, tlsFixture.certificatePem), writeFile(keyPath, tlsFixture.privateKeyPem)]);
  const base = {
    schema: "sxsy-b122.provider-host-config", version: 1, protectedStateRoot: root,
    tls: pinnedTls(certPath, keyPath), authenticationTokenEnvelopeFile: tokenPath, journalAuthenticationEnvelopeFile: journalPath, dispatchLeaseAuthenticationEnvelopeFile: dispatchLeasePath,
    stateFile: join(root, "state.jsonl"), providers: [{ provider: "claude", kind: "fixture" }]
  };
  await writeFile(configPath, JSON.stringify({ ...base, listen: { host: "0.0.0.0", port: 4747 }, allowFixtureBackends: true }));
  await assert.rejects(() => loadProviderHostConfiguration(configPath, options(root)), /loopback/i);
  const security = new RecordingPathSecurity();
  await writeFile(configPath, JSON.stringify({ ...base, listen: { host: "127.0.0.1", port: 4747 }, allowFixtureBackends: true }));
  const loaded = await loadProviderHostConfiguration(configPath, options(root, security));
  assert.equal(loaded.providers[0]?.kind, "fixture");
  assert.equal(security.calls.length, 1);
  assert.deepEqual(new Set(security.calls[0]?.paths), new Set([configPath, keyPath, tokenPath, journalPath, dispatchLeasePath]));
  loaded.authenticationToken.fill(0);
  loaded.journalAuthenticationKey.fill(0);
  loaded.dispatchLeaseAuthenticationKey.fill(0);

  await envelope(dispatchLeasePath, "a".repeat(64));
  await assert.rejects(() => loadProviderHostConfiguration(configPath, options(root)), /independent/i);
  await envelope(dispatchLeasePath, "c".repeat(64));

  const mismatched = createLoopbackTlsFixture();
  await writeFile(keyPath, mismatched.privateKeyPem);
  await writeFile(configPath, JSON.stringify({ ...base, listen: { host: "127.0.0.1", port: 4747 }, tls: { ...base.tls, privateKeySha256: mismatched.privateKeyFileSha256 }, allowFixtureBackends: true }));
  await assert.rejects(() => loadProviderHostConfiguration(configPath, options(root)), /private-key identity|TLS certificate/i);

  const outside = join(root, "..", "outside-state.jsonl");
  await writeFile(configPath, JSON.stringify({ ...base, listen: { host: "127.0.0.1", port: 4747 }, stateFile: outside, allowFixtureBackends: true }));
  await assert.rejects(() => loadProviderHostConfiguration(configPath, options(root)), /protected provider-host root/i);
});

test("startup opens the three independent host secrets concurrently", async (context) => {
  const root = await mkdtemp(join(tmpdir(), "b122-provider-host-parallel-secrets-"));
  context.after(async () => rm(root, { recursive: true, force: true }));
  const paths = {
    config: join(root, "config.json"), token: join(root, "token.json"), journal: join(root, "journal.json"),
    dispatchLease: join(root, "dispatch-lease.json"), cert: join(root, "cert.pem"), key: join(root, "key.pem")
  };
  await Promise.all([
    envelope(paths.token, "a".repeat(64)), envelope(paths.journal, "b".repeat(64)), envelope(paths.dispatchLease, "c".repeat(64)),
    writeFile(paths.cert, tlsFixture.certificatePem), writeFile(paths.key, tlsFixture.privateKeyPem)
  ]);
  await writeFile(paths.config, JSON.stringify({
    schema: "sxsy-b122.provider-host-config", version: 1, protectedStateRoot: root,
    listen: { host: "127.0.0.1", port: 4747 }, tls: pinnedTls(paths.cert, paths.key),
    authenticationTokenEnvelopeFile: paths.token, journalAuthenticationEnvelopeFile: paths.journal,
    dispatchLeaseAuthenticationEnvelopeFile: paths.dispatchLease, stateFile: join(root, "state.jsonl"),
    providers: [{ provider: "codex", kind: "fixture" }], allowFixtureBackends: true
  }));
  let active = 0;
  let maximumActive = 0;
  const concurrentProtector: UserSecretProtector = {
    provider: protector.provider,
    async seal() { throw new Error("not used"); },
    async open(sealed) {
      active += 1;
      maximumActive = Math.max(maximumActive, active);
      await new Promise((resolveWait) => setTimeout(resolveWait, 25));
      active -= 1;
      return Buffer.from(sealed, "base64");
    }
  };
  const loaded = await loadProviderHostConfiguration(paths.config, {
    secretProtector: concurrentProtector, pathSecurity: new RecordingPathSecurity(), allowedProtectedBaseRoot: root
  });
  assert.equal(maximumActive, 3);
  loaded.authenticationToken.fill(0);
  loaded.journalAuthenticationKey.fill(0);
  loaded.dispatchLeaseAuthenticationKey.fill(0);
});

test("digest-pinned modules never receive the raw protected credential or an ambient effect capability", async (context) => {
  const root = await mkdtemp(join(tmpdir(), "b122-provider-module-config-"));
  context.after(async () => rm(root, { recursive: true, force: true }));
  const configPath = join(root, "config.json");
  const tokenPath = join(root, "token.envelope.json");
  const journalPath = join(root, "journal.envelope.json");
  const dispatchLeasePath = join(root, "dispatch-lease.envelope.json");
  const credentialPath = join(root, "provider.envelope.json");
  const certPath = join(root, "cert.pem");
  const keyPath = join(root, "key.pem");
  const modulePath = join(root, "backend.mjs");
  const moduleSource = `export async function createB122ProviderRuntimePort(input) { if (Object.hasOwn(input, "credential") || Object.hasOwn(input, "environment") || Object.hasOwn(input, "effectPort")) throw new Error("raw credential or ambient effect capability exposed"); if (Object.keys(input).sort().join(",") !== "councilResources,options,provider") throw new Error("unexpected module factory capability"); return { provider: input.provider, async handshake(){}, async execute(){}, async observeSession(){}, async observeWorkflowContext(){}, async reanchor(){}, async observeReanchor(){}, async observeOperation(){}, async cancelOperation(){}, async council(){}, async observeCouncil(){}, async shutdown(signal){ globalThis.__b122ProviderShutdown = signal.aborted ? "aborted" : "clean"; } }; }`;
  await Promise.all([
    envelope(tokenPath, "a".repeat(64)), envelope(journalPath, "b".repeat(64)), envelope(dispatchLeasePath, "c".repeat(64)), envelope(credentialPath, "provider-secret"),
    writeFile(certPath, tlsFixture.certificatePem), writeFile(keyPath, tlsFixture.privateKeyPem), writeFile(modulePath, moduleSource)
  ]);
  await writeFile(configPath, JSON.stringify({
    schema: "sxsy-b122.provider-host-config", version: 1, protectedStateRoot: root,
    listen: { host: "127.0.0.1", port: 4747 }, tls: pinnedTls(certPath, keyPath),
    authenticationTokenEnvelopeFile: tokenPath, journalAuthenticationEnvelopeFile: journalPath, dispatchLeaseAuthenticationEnvelopeFile: dispatchLeasePath, stateFile: join(root, "state.jsonl"),
    providers: [{ provider: "claude", kind: "module", modulePath, moduleSha256: createHash("sha256").update(moduleSource).digest("hex"), credentialEnvelopeFile: credentialPath }]
  }));
  const loaded = await loadProviderHostConfiguration(configPath, options(root));
  const runtime = await loadProviderBackendRuntime(loaded);
  assert.equal(runtime.backends[0]?.provider, "claude");
  assert.ok(loaded.providers[0]?.kind === "module" && loaded.providers[0].credential.every((byte) => byte === 0));
  await runtime.close();
  assert.equal((globalThis as Record<string, unknown>).__b122ProviderShutdown, "clean");
  delete (globalThis as Record<string, unknown>).__b122ProviderShutdown;
  loaded.authenticationToken.fill(0);
  loaded.journalAuthenticationKey.fill(0);
  loaded.dispatchLeaseAuthenticationKey.fill(0);
});

test("module providers must expose the typed Re-anchor observation contract", async (context) => {
  const root = await mkdtemp(join(tmpdir(), "b122-provider-module-shutdown-"));
  context.after(async () => rm(root, { recursive: true, force: true }));
  const paths = { config: join(root, "config.json"), token: join(root, "token.json"), journal: join(root, "journal.json"), dispatchLease: join(root, "dispatch-lease.json"), credential: join(root, "credential.json"), cert: join(root, "cert.pem"), key: join(root, "key.pem"), module: join(root, "backend.mjs") };
  const source = `export function createB122ProviderRuntimePort(input){ return { provider: input.provider, async handshake(){}, async execute(){}, async observeSession(){}, async observeWorkflowContext(){}, async observeOperation(){}, async cancelOperation(){}, async council(){}, async observeCouncil(){}, async shutdown(){} }; }`;
  await Promise.all([envelope(paths.token, "a".repeat(64)), envelope(paths.journal, "b".repeat(64)), envelope(paths.dispatchLease, "c".repeat(64)), envelope(paths.credential, "provider-secret"), writeFile(paths.cert, tlsFixture.certificatePem), writeFile(paths.key, tlsFixture.privateKeyPem), writeFile(paths.module, source)]);
  await writeFile(paths.config, JSON.stringify({ schema: "sxsy-b122.provider-host-config", version: 1, protectedStateRoot: root, listen: { host: "127.0.0.1", port: 4747 }, tls: pinnedTls(paths.cert, paths.key), authenticationTokenEnvelopeFile: paths.token, journalAuthenticationEnvelopeFile: paths.journal, dispatchLeaseAuthenticationEnvelopeFile: paths.dispatchLease, stateFile: join(root, "state.jsonl"), providers: [{ provider: "codex", kind: "module", modulePath: paths.module, moduleSha256: createHash("sha256").update(source).digest("hex"), credentialEnvelopeFile: paths.credential }] }));
  const loaded = await loadProviderHostConfiguration(paths.config, options(root));
  await assert.rejects(() => loadProviderBackendRuntime(loaded), /runtime port contract/i);
});

test("the rotatable bearer, durable journal, and single-use dispatch-lease keys have separate roles", async (context) => {
  const root = await mkdtemp(join(tmpdir(), "b122-provider-journal-key-"));
  context.after(async () => rm(root, { recursive: true, force: true }));
  const statePath = join(root, "state.jsonl");
  const stableJournalKey = "b".repeat(64);
  const beforeRotation = createProviderHostStore(statePath, stableJournalKey);
  await beforeRotation.append("provider-test", { bearerTokenDigest: createHash("sha256").update("a".repeat(64)).digest("hex") });

  // Rotating the listener bearer token does not re-key or orphan unresolved
  // durable provider/Council state.
  const afterRotation = createProviderHostStore(statePath, stableJournalKey);
  assert.equal((await afterRotation.readEntries()).length, 1);
  const wrongJournalKey = createProviderHostStore(statePath, "c".repeat(64));
  await assert.rejects(() => wrongJournalKey.readEntries(), /authentication|integrity|protected/i);
});
