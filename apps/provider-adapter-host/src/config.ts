import { createHash, createPrivateKey, createPublicKey, timingSafeEqual, X509Certificate } from "node:crypto";
import { execFile } from "node:child_process";
import { readFile, writeFile } from "node:fs/promises";
import { dirname, isAbsolute, join, relative, resolve } from "node:path";

import { WindowsDpapiCurrentUserProtector, type UserSecretProtector } from "../../windows-companion/src/windows-secret.ts";
import {
  ClaudeProviderAdapterBackend,
  ConfiguredProviderMediatedEffectHostPort,
  CodexProviderAdapterBackend,
  FixtureProviderRuntimePort,
  type ProviderAdapterBackend,
  type ProviderMediatedEffectDriver,
  type ProviderMediatedEffectGuard,
  type ProviderMediatedEffectHostPort,
  type ProviderRuntimePort
} from "./backends.ts";
import { openProviderHostSecretEnvelope } from "./secret-envelope.ts";
import { WindowsCurrentUserProviderHostPathSecurity, type ProviderHostPathSecurity } from "./windows-path-security.ts";
import { LinuxCurrentUserProviderHostPathSecurity } from "./linux-path-security.ts";
import {
  InstalledProviderCouncilResourceLifecycle,
  wrapProviderRuntimeCouncilLifecycle,
  type ProviderCouncilResourceLifecycle
} from "./council-resources.ts";

const maximumConfigurationBytes = 256 * 1024;
const maximumTlsBytes = 2 * 1024 * 1024;
const maximumModuleBytes = 16 * 1024 * 1024;

export interface ProviderHostFixtureConfiguration {
  readonly provider: "claude" | "codex";
  readonly kind: "fixture";
}

export interface ProviderHostModuleConfiguration {
  readonly provider: "claude" | "codex";
  readonly kind: "module";
  readonly modulePath: string;
  readonly moduleSha256: string;
  readonly credentialEnvelopeFile: string;
  readonly credential: Uint8Array;
  /** Exact digest-verified source bytes; imported from memory to close path replacement TOCTOU. */
  readonly moduleSource: Uint8Array;
  readonly options: Readonly<Record<string, string>>;
}

export type LoadedProviderConfiguration = ProviderHostFixtureConfiguration | ProviderHostModuleConfiguration;

export interface LoadedProviderEffectDriverConfiguration {
  /** Provider/Council effects only. Automation execution is companion-owned and cannot be configured here. */
  readonly provider: "claude" | "codex";
  readonly kind: "module";
  readonly modulePath: string;
  readonly moduleSha256: string;
  /** Exact digest-verified host-driver source; never exposed to a provider runtime module. */
  readonly moduleSource: Uint8Array;
}

export interface LoadedProviderHostConfiguration {
  readonly configurationPath: string;
  readonly configurationSha256: string;
  readonly protectedStateRoot: string;
  readonly companionStateDirectory: string;
  readonly listen: Readonly<{ host: string; port: number }>;
  readonly tls: Readonly<{ certificate: Uint8Array; privateKey: Uint8Array; certificateSha256: string; privateKeySha256: string; tlsSpkiSha256: string }>;
  readonly authenticationToken: Uint8Array;
  readonly authenticationTokenText: string;
  readonly journalAuthenticationKey: Uint8Array;
  readonly journalAuthenticationKeyText: string;
  readonly dispatchLeaseAuthenticationKey: Uint8Array;
  readonly dispatchLeaseAuthenticationKeyText: string;
  readonly stateFile: string;
  readonly providers: readonly LoadedProviderConfiguration[];
  readonly effectDrivers: readonly LoadedProviderEffectDriverConfiguration[];
}

export interface ProviderHostConfigurationLoadOptions {
  readonly secretProtector?: UserSecretProtector;
  readonly pathSecurity?: ProviderHostPathSecurity;
  /** Test/installer override. Production defaults to the fixed LocalAppData provider-host base. */
  readonly allowedProtectedBaseRoot?: string;
}

export async function loadProviderHostConfiguration(configurationPath: string, options: ProviderHostConfigurationLoadOptions = {}): Promise<LoadedProviderHostConfiguration> {
  const absoluteConfigurationPath = absolutePath(configurationPath, "configuration path");
  await traceConfigurationStage(absoluteConfigurationPath, "config-read");
  const bytes = await boundedFile(absoluteConfigurationPath, maximumConfigurationBytes, "provider host configuration");
  const configurationSha256 = createHash("sha256").update(bytes).digest("hex");
  let value: unknown;
  try { value = JSON.parse(Buffer.from(bytes).toString("utf8")); }
  finally { bytes.fill(0); }
  if (!record(value) || value.schema !== "sxsy-b122.provider-host-config" || value.version !== 1 || !record(value.listen) || !record(value.tls)
    || !allowedKeys(value, ["schema", "version", "protectedStateRoot", "listen", "tls", "authenticationTokenEnvelopeFile", "journalAuthenticationEnvelopeFile", "dispatchLeaseAuthenticationEnvelopeFile", "stateFile", "providers"], ["allowFixtureBackends", "effectDrivers"])
    || !exactKeys(value.listen, ["host", "port"]) || !exactKeys(value.tls, ["certificateFile", "privateKeyFile", "certificateSha256", "privateKeySha256", "tlsSpkiSha256"])
    || !Array.isArray(value.providers) || value.providers.length < 1 || value.providers.length > 2
    || (value.effectDrivers !== undefined && (!Array.isArray(value.effectDrivers) || value.effectDrivers.length > 2))
    || typeof value.protectedStateRoot !== "string" || typeof value.authenticationTokenEnvelopeFile !== "string" || typeof value.journalAuthenticationEnvelopeFile !== "string" || typeof value.dispatchLeaseAuthenticationEnvelopeFile !== "string" || typeof value.stateFile !== "string"
    || !digest(value.tls.certificateSha256) || !digest(value.tls.privateKeySha256) || !digest(value.tls.tlsSpkiSha256)) {
    throw new Error("The provider host configuration schema is invalid.");
  }

  const protectedStateRoot = absolutePath(value.protectedStateRoot, "protected state root");
  await traceConfigurationStage(absoluteConfigurationPath, "config-paths");
  await traceWindowsTestBoundary(absoluteConfigurationPath);
  const allowedBase = resolve(options.allowedProtectedBaseRoot ?? await defaultProtectedBaseRoot());
  if (!inside(allowedBase, protectedStateRoot)) {
    const configurationDirectory = dirname(absoluteConfigurationPath);
    const classification = inside(allowedBase, configurationDirectory)
      ? "config-root-not-config-dir"
      : inside(protectedStateRoot, absoluteConfigurationPath)
        ? "config-file-and-root-outside-base"
        : "config-boundaries-diverged";
    await traceConfigurationStage(absoluteConfigurationPath, classification);
    throw new Error("The provider-host protected root must remain beneath the dedicated current-user LocalAppData boundary.");
  }
  await traceConfigurationStage(absoluteConfigurationPath, "config-allowed-base");
  const host = hostName(value.listen.host);
  if (!loopback(host)) throw new Error("The provider host listener is restricted to an exact loopback address.");
  const port = portNumber(value.listen.port);
  const certificateFile = absolutePath(value.tls.certificateFile, "TLS certificate path");
  const privateKeyFile = ownedPath(protectedStateRoot, value.tls.privateKeyFile, "TLS private-key path");
  const tokenEnvelopeFile = ownedPath(protectedStateRoot, value.authenticationTokenEnvelopeFile, "authentication token envelope path");
  const journalEnvelopeFile = ownedPath(protectedStateRoot, value.journalAuthenticationEnvelopeFile, "journal authentication envelope path");
  const dispatchLeaseEnvelopeFile = ownedPath(protectedStateRoot, value.dispatchLeaseAuthenticationEnvelopeFile, "dispatch-lease authentication envelope path");
  const stateFile = ownedPath(protectedStateRoot, value.stateFile, "provider state path");
  if (!inside(protectedStateRoot, absoluteConfigurationPath)) throw new Error("The provider-host configuration must remain beneath its protected state root.");
  await traceConfigurationStage(absoluteConfigurationPath, "config-owned-paths");

  if (process.platform === "linux" && !options.secretProtector) throw new Error("Linux provider-host configuration requires one lifecycle-owned Secret Service protector.");
  const protector = options.secretProtector ?? new WindowsDpapiCurrentUserProtector();
  const pathSecurity = options.pathSecurity ?? (process.platform === "linux" ? new LinuxCurrentUserProviderHostPathSecurity() : new WindowsCurrentUserProviderHostPathSecurity());
  const protectedExistingPaths = [absoluteConfigurationPath, privateKeyFile, tokenEnvelopeFile, journalEnvelopeFile, dispatchLeaseEnvelopeFile];
  const allowFixtureBackends = value.allowFixtureBackends === true;
  const providers: LoadedProviderConfiguration[] = [];
  const seen = new Set<string>();
  for (const entry of value.providers) {
    if (!record(entry) || (entry.provider !== "claude" && entry.provider !== "codex") || (entry.kind !== "fixture" && entry.kind !== "module") || seen.has(entry.provider)) {
      throw new Error("The provider host backend list is invalid or duplicated.");
    }
    seen.add(entry.provider);
    if (entry.kind === "fixture") {
      if (!exactKeys(entry, ["provider", "kind"])) throw new Error("A fixture provider backend contains unexpected configuration fields.");
      if (!allowFixtureBackends) throw new Error("Fixture provider backends require explicit diagnostic authorization.");
      if (!loopback(host)) throw new Error("Credential-free fixture provider backends are restricted to an exact loopback listener.");
      providers.push({ provider: entry.provider, kind: "fixture" });
      continue;
    }
    if (typeof entry.modulePath !== "string" || typeof entry.moduleSha256 !== "string" || typeof entry.credentialEnvelopeFile !== "string") {
      throw new Error("A module provider backend requires an exact module, digest, and protected credential envelope.");
    }
    if (!allowedKeys(entry, ["provider", "kind", "modulePath", "moduleSha256", "credentialEnvelopeFile"], ["options"])) throw new Error("A module provider backend contains unexpected configuration fields.");
    const modulePath = absolutePath(entry.modulePath, `${entry.provider} module path`);
    const credentialEnvelopeFile = ownedPath(protectedStateRoot, entry.credentialEnvelopeFile, `${entry.provider} credential envelope path`);
    protectedExistingPaths.push(credentialEnvelopeFile);
    if (!digest(entry.moduleSha256)) throw new Error("The provider backend module SHA-256 digest is invalid.");
    const moduleBytes = await boundedFile(modulePath, maximumModuleBytes, `${entry.provider} provider module`);
    const observedDigest = createHash("sha256").update(moduleBytes).digest("hex");
    if (observedDigest !== entry.moduleSha256) { moduleBytes.fill(0); throw new Error(`The ${entry.provider} provider module digest does not match the installed pin.`); }
    providers.push({ provider: entry.provider, kind: "module", modulePath, moduleSha256: entry.moduleSha256, credentialEnvelopeFile, credential: new Uint8Array(), moduleSource: moduleBytes, options: stringOptions(entry.options) });
  }

  const effectDrivers: LoadedProviderEffectDriverConfiguration[] = [];
  const seenDrivers = new Set<string>();
  for (const entry of value.effectDrivers ?? []) {
    if (!record(entry) || (entry.provider !== "claude" && entry.provider !== "codex") || entry.kind !== "module"
      || !exactKeys(entry, ["provider", "kind", "modulePath", "moduleSha256"]) || seenDrivers.has(entry.provider)) {
      throw new Error("The provider host effect driver list is invalid or duplicated.");
    }
    seenDrivers.add(entry.provider);
    const provider = providers.find((candidate) => candidate.provider === entry.provider);
    if (!provider || provider.kind !== "module") throw new Error("A host effect driver requires the exact configured module provider identity.");
    const modulePath = absolutePath(entry.modulePath, `${entry.provider} host effect driver module path`);
    if (!digest(entry.moduleSha256)) throw new Error("The host effect driver module digest is invalid.");
    if (resolve(modulePath) === resolve(provider.modulePath) || entry.moduleSha256 === provider.moduleSha256) {
      throw new Error("The host effect driver must be independently installed and digest-pinned from the provider runtime module.");
    }
    const moduleBytes = await boundedFile(modulePath, maximumModuleBytes, `${entry.provider} host effect driver module`);
    const observedDigest = createHash("sha256").update(moduleBytes).digest("hex");
    if (observedDigest !== entry.moduleSha256) {
      moduleBytes.fill(0);
      throw new Error(`The ${entry.provider} host effect driver module digest does not match the installed pin.`);
    }
    effectDrivers.push({ provider: entry.provider, kind: "module", modulePath, moduleSha256: entry.moduleSha256, moduleSource: moduleBytes });
  }
  await traceConfigurationStage(absoluteConfigurationPath, "config-providers");

  await traceConfigurationStage(absoluteConfigurationPath, "config-path-security");
  await pathSecurity.assertCurrentUserProtected(protectedStateRoot, protectedExistingPaths);
  await traceConfigurationStage(absoluteConfigurationPath, "config-bearer-secret");
  const tokenBytes = await openProviderHostSecretEnvelope(tokenEnvelopeFile, protector);
  let token: string;
  try {
    token = Buffer.from(tokenBytes).toString("ascii");
    if (!/^[a-f0-9]{64}$/.test(token)) throw new Error("The protected provider-host authentication token must contain exactly 256 canonical bits.");
  } finally { tokenBytes.fill(0); }
  await traceConfigurationStage(absoluteConfigurationPath, "config-journal-secret");
  const journalBytes = await openProviderHostSecretEnvelope(journalEnvelopeFile, protector);
  let journalAuthenticationKey: string;
  try {
    journalAuthenticationKey = Buffer.from(journalBytes).toString("ascii");
    if (!/^[a-f0-9]{64}$/.test(journalAuthenticationKey)) throw new Error("The protected provider-host journal authentication key must contain exactly 256 canonical bits.");
  } finally { journalBytes.fill(0); }
  await traceConfigurationStage(absoluteConfigurationPath, "config-dispatch-secret");
  const dispatchLeaseBytes = await openProviderHostSecretEnvelope(dispatchLeaseEnvelopeFile, protector);
  let dispatchLeaseAuthenticationKey: string;
  try {
    dispatchLeaseAuthenticationKey = Buffer.from(dispatchLeaseBytes).toString("ascii");
    if (!/^[a-f0-9]{64}$/.test(dispatchLeaseAuthenticationKey)) throw new Error("The protected provider-host dispatch-lease authentication key must contain exactly 256 canonical bits.");
  } finally { dispatchLeaseBytes.fill(0); }
  if (token === journalAuthenticationKey || token === dispatchLeaseAuthenticationKey || journalAuthenticationKey === dispatchLeaseAuthenticationKey) {
    throw new Error("The provider-host bearer, journal, and dispatch-lease authentication keys must be cryptographically independent.");
  }
  for (const provider of providers) {
    if (provider.kind !== "module") continue;
    const credential = await openProviderHostSecretEnvelope(provider.credentialEnvelopeFile, protector);
    if (!credential.byteLength || /[\0\r\n]/.test(Buffer.from(credential).toString("utf8"))) {
      credential.fill(0);
      throw new Error("The protected provider backend credential is invalid.");
    }
    (provider as { credential: Uint8Array }).credential = credential;
  }

  await traceConfigurationStage(absoluteConfigurationPath, "config-tls-material");
  const [certificate, privateKey] = await Promise.all([
    boundedFile(certificateFile, maximumTlsBytes, "TLS certificate"),
    boundedFile(privateKeyFile, maximumTlsBytes, "TLS private key")
  ]);
  if (createHash("sha256").update(certificate).digest("hex") !== value.tls.certificateSha256
    || createHash("sha256").update(privateKey).digest("hex") !== value.tls.privateKeySha256) {
    certificate.fill(0); privateKey.fill(0);
    throw new Error("The provider host TLS material does not match its exact SHA-256 pins.");
  }
  let observedSpki: Buffer;
  try {
    const parsedCertificate = new X509Certificate(certificate);
    const certificateSpki = parsedCertificate.publicKey.export({ type: "spki", format: "der" });
    observedSpki = createHash("sha256").update(certificateSpki).digest();
    const keySpki = createPublicKey(createPrivateKey(Buffer.from(privateKey))).export({ type: "spki", format: "der" });
    const validFrom = Date.parse(parsedCertificate.validFrom);
    const validTo = Date.parse(parsedCertificate.validTo);
    const now = Date.now();
    if (parsedCertificate.ca || parsedCertificate.keyUsage?.includes("1.3.6.1.5.5.7.3.1") !== true
      || parsedCertificate.checkIP("127.0.0.1") !== "127.0.0.1" || !Number.isFinite(validFrom) || !Number.isFinite(validTo)
      || validFrom > now || validTo < now + 5 * 60_000 || validTo - validFrom > 398 * 24 * 60 * 60_000
      || keySpki.byteLength !== certificateSpki.byteLength || !timingSafeEqual(Buffer.from(keySpki), Buffer.from(certificateSpki))) {
      throw new Error("The TLS material is not an exact, current, non-CA loopback server identity with its matching private key.");
    }
  } catch {
    certificate.fill(0); privateKey.fill(0);
    throw new Error("The provider host TLS certificate or private-key identity is invalid.");
  }
  if (!timingSafeEqual(Buffer.from(value.tls.tlsSpkiSha256, "hex"), observedSpki)) {
    certificate.fill(0); privateKey.fill(0);
    throw new Error("The provider host TLS certificate does not match its exact SPKI identity pin.");
  }
  return {
    configurationPath: absoluteConfigurationPath, configurationSha256,
    protectedStateRoot, companionStateDirectory: resolve(allowedBase, ".."), listen: { host, port },
    tls: { certificate, privateKey, certificateSha256: value.tls.certificateSha256, privateKeySha256: value.tls.privateKeySha256, tlsSpkiSha256: value.tls.tlsSpkiSha256 },
    authenticationToken: Buffer.from(token, "ascii"), authenticationTokenText: token,
    journalAuthenticationKey: Buffer.from(journalAuthenticationKey, "ascii"), journalAuthenticationKeyText: journalAuthenticationKey,
    dispatchLeaseAuthenticationKey: Buffer.from(dispatchLeaseAuthenticationKey, "ascii"), dispatchLeaseAuthenticationKeyText: dispatchLeaseAuthenticationKey,
    stateFile, providers, effectDrivers
  };
}

async function traceConfigurationStage(configurationPath: string, stage: string): Promise<void> {
  if (process.env.SXSY_PROVIDER_E2E_TRACE !== "1" || !/^config-(?:read|paths|test-mode-absent|test-root-missing|test-local-missing|test-root-rewritten|test-local-rewritten|test-boundary-rewritten|test-path-invalid|test-local-equals-root|test-local-sibling|test-drive-diverged|test-boundary-valid|root-not-config-dir|file-and-root-outside-base|boundaries-diverged|allowed-base|owned-paths|providers|path-security|bearer-secret|journal-secret|dispatch-secret|tls-material)$/.test(stage)) return;
  await writeFile(`${configurationPath}.startup-stage`, `${stage}\n`, { encoding: "ascii", mode: 0o600 }).catch(() => undefined);
}

async function traceWindowsTestBoundary(configurationPath: string): Promise<void> {
  if (process.platform !== "win32" || process.env.SXSY_PROVIDER_E2E_TRACE !== "1") return;
  if (process.env.SXSY_TEST_MODE !== "1") return traceConfigurationStage(configurationPath, "config-test-mode-absent");
  const rootValue = process.env.SXSY_TEST_ROOT;
  const localValue = process.env.LOCALAPPDATA;
  if (!rootValue) return traceConfigurationStage(configurationPath, "config-test-root-missing");
  if (!localValue) return traceConfigurationStage(configurationPath, "config-test-local-missing");
  const rootMatches = process.env.SXSY_TEST_ROOT_SHA256 === createHash("sha256").update(rootValue).digest("hex");
  const localMatches = process.env.SXSY_TEST_LOCAL_SHA256 === createHash("sha256").update(localValue).digest("hex");
  if (!rootMatches || !localMatches) return traceConfigurationStage(configurationPath, rootMatches ? "config-test-local-rewritten" : localMatches ? "config-test-root-rewritten" : "config-test-boundary-rewritten");
  if (/[^\S ]|[\0\r\n]/.test(rootValue + localValue) || !isAbsolute(rootValue) || !isAbsolute(localValue)) return traceConfigurationStage(configurationPath, "config-test-path-invalid");
  const suffix = relative(resolve(rootValue), resolve(localValue));
  if (!suffix) return traceConfigurationStage(configurationPath, "config-test-local-equals-root");
  if (suffix.startsWith("..")) return traceConfigurationStage(configurationPath, "config-test-local-sibling");
  if (isAbsolute(suffix)) return traceConfigurationStage(configurationPath, "config-test-drive-diverged");
  return traceConfigurationStage(configurationPath, "config-test-boundary-valid");
}

export interface LoadedProviderBackendRuntime {
  readonly backends: readonly ProviderAdapterBackend[];
  close(): Promise<void>;
}

export interface LoadProviderBackendOptions {
  readonly councilResources?: ProviderCouncilResourceLifecycle;
  /** Installed companion-authenticated final-current/containment decision port. */
  readonly mediatedFinalCurrent?: ProviderMediatedEffectGuard;
  /**
   * Separately installed host-owned provider effect drivers. These are never
   * passed to a digest-pinned module. Absence keeps that provider at or below
   * Controllable even when the module self-asserts Mediated.
   */
  readonly mediatedEffects?: Partial<Record<"claude" | "codex", Readonly<{
    guard: ProviderMediatedEffectGuard;
    driver: ProviderMediatedEffectDriver;
    driverModuleSha256: string;
  }>>>;
}

export async function loadProviderBackendRuntime(configuration: LoadedProviderHostConfiguration, options: LoadProviderBackendOptions = {}): Promise<LoadedProviderBackendRuntime> {
  const result: ProviderAdapterBackend[] = [];
  const ports: ProviderRuntimePort[] = [];
  const mediationPorts: ProviderMediatedEffectHostPort[] = [];
  const councilResources = options.councilResources ?? new InstalledProviderCouncilResourceLifecycle(configuration.companionStateDirectory);
  let closed = false;
  try {
    for (const provider of configuration.providers) {
      let port: ProviderRuntimePort;
      let mediation: ProviderMediatedEffectHostPort | undefined;
      if (provider.kind === "fixture") {
        port = new FixtureProviderRuntimePort(provider.provider);
      } else {
        const credential = new Uint8Array(provider.credential);
        try {
          const sourceUrl = `data:text/javascript;base64,${Buffer.from(provider.moduleSource).toString("base64")}`;
          const imported = await import(sourceUrl) as Readonly<Record<string, unknown>>;
          const factory = imported.createB122ProviderRuntimePort;
          if (typeof factory !== "function") throw new Error("The provider backend module does not export createB122ProviderRuntimePort.");
          port = await factory({ provider: provider.provider, options: provider.options, councilResources: councilResources.callbacks }) as ProviderRuntimePort;
          validateRuntimePort(port, provider.provider);
          port = wrapProviderRuntimeCouncilLifecycle(port, councilResources);
          const configuredDriver = configuration.effectDrivers.find((entry) => entry.provider === provider.provider);
          const installedMediation = options.mediatedEffects?.[provider.provider]
            ?? (configuredDriver && options.mediatedFinalCurrent
              ? {
                  guard: options.mediatedFinalCurrent,
                  driver: await loadConfiguredEffectDriver(configuration, provider, configuredDriver),
                  driverModuleSha256: configuredDriver.moduleSha256
                }
              : undefined);
          if (installedMediation) {
            mediation = new ConfiguredProviderMediatedEffectHostPort({
              configurationSha256: configuration.configurationSha256,
              provider: provider.provider,
              adapterId: `sxsy-b122.module.${provider.provider}`,
              moduleSha256: provider.moduleSha256,
              driverModuleSha256: installedMediation.driverModuleSha256,
              credential,
              guard: installedMediation.guard,
              driver: installedMediation.driver
            });
            mediationPorts.push(mediation);
          }
        } finally {
          credential.fill(0);
          provider.credential.fill(0);
          provider.moduleSource.fill(0);
          configuration.effectDrivers.find((entry) => entry.provider === provider.provider)?.moduleSource.fill(0);
        }
      }
      ports.push(port);
      const identity = provider.kind === "module"
        ? { adapterId: `sxsy-b122.module.${provider.provider}`, moduleSha256: provider.moduleSha256 }
        : undefined;
      result.push(provider.provider === "claude" ? new ClaudeProviderAdapterBackend(port, identity, mediation) : new CodexProviderAdapterBackend(port, identity, mediation));
    }
  } catch (error) {
    await closeProviderRuntime(ports, councilResources, mediationPorts).catch(() => undefined);
    throw error;
  }
  return Object.freeze({
    backends: result,
    async close() {
      if (closed) return;
      closed = true;
      await closeProviderRuntime(ports, councilResources, mediationPorts);
    }
  });
}

async function loadConfiguredEffectDriver(
  configuration: LoadedProviderHostConfiguration,
  provider: ProviderHostModuleConfiguration,
  driver: LoadedProviderEffectDriverConfiguration
): Promise<ProviderMediatedEffectDriver> {
  const sourceUrl = `data:text/javascript;base64,${Buffer.from(driver.moduleSource).toString("base64")}`;
  const imported = await import(sourceUrl) as Readonly<Record<string, unknown>>;
  const factory = imported.createB122ProviderMediatedEffectDriver;
  if (typeof factory !== "function") throw new Error("The host effect driver module does not export createB122ProviderMediatedEffectDriver.");
  const value = await factory(Object.freeze({
    provider: provider.provider,
    allowedSurfaces: Object.freeze(["provider", "council"] as const),
    configurationSha256: configuration.configurationSha256,
    adapterId: `sxsy-b122.module.${provider.provider}`,
    providerModuleSha256: provider.moduleSha256,
    driverModuleSha256: driver.moduleSha256
  })) as unknown;
  if (!record(value) || !["executeCommand", "executeCouncil", "observeCommand", "cancelCommand", "observeCouncil"].every((name) => typeof value[name] === "function")) {
    throw new Error("The host effect driver module did not return the exact closed driver contract.");
  }
  return value as unknown as ProviderMediatedEffectDriver;
}

export async function loadProviderBackends(configuration: LoadedProviderHostConfiguration, options: LoadProviderBackendOptions = {}): Promise<readonly ProviderAdapterBackend[]> {
  return (await loadProviderBackendRuntime(configuration, options)).backends;
}

function validateRuntimePort(value: unknown, provider: "claude" | "codex"): asserts value is ProviderRuntimePort {
  if (!record(value) || value.provider !== provider || ![
    "handshake", "execute", "observeSession", "observeWorkflowContext", "reanchor", "observeReanchor",
    "observeOperation", "cancelOperation", "council", "observeCouncil", "shutdown"
  ].every((name) => typeof value[name] === "function")) {
    throw new Error(`The ${provider} provider module did not return the exact runtime port contract.`);
  }
}

async function closeProviderRuntime(ports: readonly ProviderRuntimePort[], councilResources: ProviderCouncilResourceLifecycle, mediationPorts: readonly ProviderMediatedEffectHostPort[] = []): Promise<void> {
  const controller = new AbortController();
  let expire!: () => void;
  const expired = new Promise<never>((_resolve, reject) => { expire = () => { controller.abort(); reject(new Error("Provider module shutdown exceeded its fixed deadline.")); }; });
  const timer = setTimeout(expire, 5_000);
  const results = await Promise.allSettled([
    ...ports.map((port) => Promise.race([Promise.resolve().then(() => port.shutdown(controller.signal)), expired])),
    ...mediationPorts.map((port) => Promise.resolve().then(() => port.close())),
    councilResources.closeAll()
  ]).finally(() => clearTimeout(timer));
  if (results.some((result) => result.status === "rejected")) throw new Error("One or more provider runtime resources did not shut down cleanly.");
}

async function boundedFile(path: string, maximum: number, label: string): Promise<Uint8Array> {
  const bytes = await readFile(path);
  if (bytes.byteLength < 1 || bytes.byteLength > maximum) { bytes.fill(0); throw new Error(`The ${label} file is empty or oversized.`); }
  return new Uint8Array(bytes);
}
async function defaultProtectedBaseRoot(): Promise<string> {
  if (process.platform === "win32") return resolve(await windowsKnownLocalApplicationDataForRuntime(), "STRATHEX", "switchyard", "provider-host");
  if (process.platform === "linux") {
    const state = process.env.XDG_STATE_HOME ?? (process.env.HOME ? resolve(process.env.HOME, ".local", "state") : undefined);
    if (!state || /[\0\r\n]/.test(state) || !isAbsolute(state)) throw new Error("The Linux current-user state boundary is unavailable.");
    return resolve(state, "STRATHEX", "switchyard", "provider-host");
  }
  throw new Error("The provider host has no reviewed protected-state boundary on this platform.");
}

async function windowsKnownLocalApplicationDataForRuntime(): Promise<string> {
  if (process.env.SXSY_TEST_MODE !== "1") return windowsKnownLocalApplicationData();
  const testRootValue = process.env.SXSY_TEST_ROOT;
  const localValue = process.env.LOCALAPPDATA;
  if (!testRootValue || !localValue || /[\0\r\n]/.test(testRootValue) || /[\0\r\n]/.test(localValue)
    || !isAbsolute(testRootValue) || !isAbsolute(localValue)) {
    throw new Error("The isolated provider-host LocalAppData boundary is unavailable.");
  }
  const testRoot = resolve(testRootValue);
  const local = resolve(localValue);
  const suffix = relative(testRoot, local);
  if (!suffix || suffix.startsWith("..") || isAbsolute(suffix)) {
    throw new Error("The isolated provider-host LocalAppData boundary must be a strict child of the test root.");
  }
  return local;
}

function windowsKnownLocalApplicationData(): Promise<string> {
  const systemRoot = process.env.SystemRoot ?? process.env.WINDIR;
  if (!systemRoot || !isAbsolute(systemRoot) || /[\0\r\n]/.test(systemRoot)) {
    return Promise.reject(new Error("The Windows system root is unavailable."));
  }
  const executable = join(resolve(systemRoot), "System32", "WindowsPowerShell", "v1.0", "powershell.exe");
  const command = `$sid=[Security.Principal.WindowsIdentity]::GetCurrent().User.Value;$profile=[string](Get-ItemPropertyValue -LiteralPath ('Registry::HKEY_LOCAL_MACHINE\\SOFTWARE\\Microsoft\\Windows NT\\CurrentVersion\\ProfileList\\'+$sid) -Name ProfileImagePath);$local=[string](Get-ItemPropertyValue -LiteralPath 'Registry::HKEY_CURRENT_USER\\Software\\Microsoft\\Windows\\CurrentVersion\\Explorer\\User Shell Folders' -Name 'Local AppData');if([string]::IsNullOrWhiteSpace($profile)-or[string]::IsNullOrWhiteSpace($local)){exit 1};if($local.StartsWith('%USERPROFILE%',[StringComparison]::OrdinalIgnoreCase)){$local=Join-Path $profile $local.Substring(13).TrimStart([char]92,[char]47)}elseif($local.Contains('%')-or-not[IO.Path]::IsPathRooted($local)){exit 1};[Console]::Out.Write([IO.Path]::GetFullPath($local))`;
  return new Promise((resolveKnownFolder, rejectKnownFolder) => {
    execFile(executable, ["-NoLogo", "-NoProfile", "-NonInteractive", "-Command", command], {
      encoding: "utf8",
      env: { SystemRoot: resolve(systemRoot), WINDIR: resolve(systemRoot) },
      maxBuffer: 8 * 1024,
      timeout: 5_000,
      windowsHide: true
    }, (error, stdout) => {
      const value = stdout.trim();
      if (error || !value || !isAbsolute(value) || /[\0\r\n]/.test(value)) {
        rejectKnownFolder(new Error("The Windows current-user LocalAppData Known Folder is unavailable."));
        return;
      }
      resolveKnownFolder(resolve(value));
    });
  });
}
function absolutePath(value: unknown, label: string): string { if (typeof value !== "string" || !isAbsolute(value) || /[\0\r\n]/.test(value)) throw new Error(`The ${label} must be absolute.`); return resolve(value); }
function ownedPath(root: string, value: unknown, label: string): string { const path = absolutePath(value, label); if (!inside(root, path)) throw new Error(`The ${label} must remain beneath the protected provider-host root.`); return path; }
function inside(root: string, candidate: string): boolean { const suffix = relative(resolve(root), resolve(candidate)); return suffix === "" || (!suffix.startsWith("..") && !isAbsolute(suffix)); }
function hostName(value: unknown): string { if (typeof value !== "string" || value.length < 1 || value.length > 253 || (!/^[A-Za-z0-9.-]+$/.test(value) && value !== "::1")) throw new Error("The provider host listener name is invalid."); return value.toLowerCase(); }
function portNumber(value: unknown): number { if (!Number.isSafeInteger(value) || (value as number) < 1 || (value as number) > 65_535) throw new Error("The provider host listener port is invalid."); return value as number; }
function loopback(value: string): boolean { return value === "127.0.0.1" || value === "::1"; }
function digest(value: unknown): value is string { return typeof value === "string" && /^[a-f0-9]{64}$/.test(value); }
function stringOptions(value: unknown): Readonly<Record<string, string>> { if (value === undefined) return {}; if (!record(value) || Object.keys(value).length > 32 || !Object.entries(value).every(([key, entry]) => /^[A-Za-z0-9_.-]{1,80}$/.test(key) && typeof entry === "string" && entry.length <= 1_024 && !/[\0\r\n]/.test(entry))) throw new Error("The provider module options are invalid."); return { ...value } as Record<string, string>; }
function record(value: unknown): value is Record<string, unknown> { return typeof value === "object" && value !== null && !Array.isArray(value); }
function exactKeys(value: Record<string, unknown>, keys: readonly string[]): boolean { return Object.keys(value).length === keys.length && keys.every((key) => key in value); }
function allowedKeys(value: Record<string, unknown>, required: readonly string[], optional: readonly string[]): boolean { const allowed = new Set([...required, ...optional]); return required.every((key) => key in value) && Object.keys(value).every((key) => allowed.has(key)); }
