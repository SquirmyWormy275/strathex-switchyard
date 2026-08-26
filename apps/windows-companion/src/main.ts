import { fileURLToPath } from "node:url";
import { dirname, isAbsolute, join, resolve } from "node:path";
import { createHash } from "node:crypto";
import { spawn } from "node:child_process";
import { lstat, mkdir, open, readFile, realpath, rename, rm } from "node:fs/promises";

import { createDurableWindowsCompanion } from "./bootstrap.ts";
import { AuthenticatedPipeServer, createPipeConfiguration, loadPipeConfiguration, savePipeConfiguration } from "./authenticated-pipe.ts";
import { defaultControlPlaneStorePath, ProtectedJsonStore } from "../../../packages/control-plane/src/store.ts";
import { DpapiJournalAuthenticator, WindowsDpapiCurrentUserProtector, type UserSecretProtector } from "./windows-secret.ts";
import { loadConfiguredNetworkPolicy, type ConfiguredNetworkPolicy } from "./configured-network.ts";
import { PowerShellWindowsUserPresenceRunner, WindowsHelloConfirmationAttestor } from "./windows-user-presence.ts";
import { acquireCompanionInstance, type CompanionInstanceRecord } from "./instance-lifecycle.ts";
import type { InstalledRawHidSupervisor } from "./raw-hid-installation.ts";
import type { CompanionHardwareSignalDispatcher } from "./hardware-signal-dispatcher.ts";
import { loadOrCreateHostReceiptEvidenceFactory } from "./receipt-evidence.ts";
import { WindowsJobObjectProcessSupervisor } from "./windows-job-supervisor.ts";
import { protocolVersion } from "../../../packages/protocol/src/b122.ts";
import { mapFingerprint } from "../../../packages/protocol/src/raw-hid.ts";
import { loadProviderDesktopPaths } from "./provider-desktop-configuration.ts";
import type { CompanionRequest, CompanionResponse } from "./bridge.ts";
import type { CompanionRequestHandler } from "./stdio.ts";
import { CompanionWindowsHostActionConsumer } from "./windows-host-action-consumer.ts";
import { PinnedWindowsHostActionEffectPort, provisionWindowsHostActionApplications } from "./windows-host-action-effects.ts";

export interface StandaloneCloseResource { readonly name: string; close(): Promise<void> | void; }
export interface WindowsProcessIdentity {
  readonly pid: number;
  readonly creationFileTimeUtc: string;
  readonly executablePath: string;
  readonly arguments: readonly string[];
  readonly parentProcessId: number;
  readonly sessionId: number;
}

/** Starts background hardware consumption only after durable startup recovery and session refresh succeed. */
export async function startStandaloneHardwareSignalDispatch(input: Readonly<{
  endpoint: Readonly<{ ready(): Promise<void> }>;
  hardwareSignalDispatcher: Readonly<{ start(): Promise<void> }>;
  windowsHostActionConsumer?: Readonly<{ start(): Promise<void> }>;
}>): Promise<void> {
  await input.endpoint.ready();
  await input.windowsHostActionConsumer?.start();
  await input.hardwareSignalDispatcher.start();
}

/**
 * An ordinary closer rejection does not short-circuit independent later
 * resources. A timeout leaves that closer potentially live, so every
 * dependent later owner remains intact for the persistent Job supervisor.
 * The exact failed-resource receipt is durable before the single-instance
 * lease can be released. A partial shutdown retains the lease and process
 * identity, so no second companion can start while a failed resource may
 * still be live.
 */
export async function closeStandaloneResources(input: Readonly<{
  stateDirectory: string;
  resources: readonly StandaloneCloseResource[];
  protector: UserSecretProtector;
  instance: CompanionInstanceRecord;
  closeTimeoutMs?: number;
  releaseLease(): Promise<void>;
}>): Promise<void> {
  const closeTimeoutMs = input.closeTimeoutMs ?? 5_000;
  if (!Number.isSafeInteger(closeTimeoutMs) || closeTimeoutMs < 100 || closeTimeoutMs > 30_000) throw new Error("The B122 resource-close timeout is invalid.");
  const failedResources: string[] = [];
  const blockedResources: string[] = [];
  // Order is intentional: callers list ingress first, effect runtimes next,
  // and lifecycle/resource owners last. Every closer is attempted, but a
  // later owner can never race a still-closing dependent resource.
  for (let index = 0; index < input.resources.length; index += 1) {
    const resource = input.resources[index]!;
    const outcome = await closeResourceWithinBound(resource, closeTimeoutMs);
    if (outcome !== "closed") {
      failedResources.push(resource.name);
      // Ingress owns the active-handler drain. If it cannot prove that the
      // admitted request set settled, effect runtimes must remain intact until
      // this process is contained by its persistent Job supervisor.
      if (index === 0 || outcome === "timed_out") {
        blockedResources.push(...input.resources.slice(index + 1).map((item) => item.name));
        break;
      }
    }
  }
  const recoveryPath = join(input.stateDirectory, "shutdown-recovery.json");
  if (failedResources.length) {
    const clear = Buffer.from(JSON.stringify({
      schema: "sxsy-b122.shutdown-recovery",
      version: 2,
      status: "recovery_required",
      leaseNonce: input.instance.nonce,
      pid: input.instance.pid,
      supervisorId: input.instance.supervisorId ?? null,
      failedResources,
      blockedResources,
      recordedAt: new Date().toISOString()
    }), "utf8");
    let sealed: string;
    try { sealed = await input.protector.seal(clear); }
    finally { clear.fill(0); }
    await writeDurableJson(recoveryPath, {
      schema: "sxsy-b122.dpapi-shutdown-recovery",
      version: 1,
      protector: input.protector.provider,
      sealed
    });
    throw new Error(`Failed to close B122 resources: ${failedResources.join(", ")}.`);
  } else {
    await rm(recoveryPath, { force: true });
  }
  await input.releaseLease();
}

async function closeResourceWithinBound(resource: StandaloneCloseResource, timeoutMs: number): Promise<"closed" | "failed" | "timed_out"> {
  let timer: NodeJS.Timeout | undefined;
  const attempt = Promise.resolve()
    .then(() => resource.close())
    .then((): "closed" => "closed")
    .catch((): "failed" => "failed");
  const timeout = new Promise<"timed_out">((resolveTimeout) => { timer = setTimeout(() => resolveTimeout("timed_out"), timeoutMs); });
  try { return await Promise.race([attempt, timeout]); }
  finally { if (timer) clearTimeout(timer); }
}

/** The outer named-pipe server authenticates this exact lifecycle request. */
export function createLifecycleAwareHandler(delegate: CompanionRequestHandler, requestStop: () => Promise<void>): CompanionRequestHandler {
  let stopping = false;
  return {
    async handle(request: CompanionRequest, context): Promise<CompanionResponse> {
      if (request.method === "ping" && exactShutdownPayload(request.payload)) {
        if (!stopping) {
          // Fence ordinary effects synchronously, before acknowledging shutdown.
          // The pipe remains open briefly only so this authenticated receipt can
          // be flushed; no later request can cross into the delegate.
          stopping = true;
          setTimeout(() => { void requestStop().catch(() => { process.exitCode = 1; }); }, 50);
        }
        return { version: 1, id: request.id, ok: true, result: { state: "stopping" } };
      }
      if (stopping) return { version: 1, id: request.id, ok: false, error: { code: "companion_unavailable", message: "The companion is stopping and refuses new effects." } };
      return delegate.handle(request, context);
    }
  };
}

/**
 * Deliberately launched local named-pipe entry point. It does not spawn from
 * the extension, open a network listener, or write a clear IPC credential.
 * The sealed endpoint record is extension-bootstrap input, not a workspace
 * setting; an unprovisioned extension remains unavailable.
 */
export async function runStandaloneCompanion(options: Readonly<{
  stateDirectory?: string;
  processIdentityWriter?: typeof writeAuthenticatedCompanionProcessIdentity;
}> = {}): Promise<{ stop(): Promise<void> }> {
  if (process.platform !== "win32") throw new Error("The packaged SXSY-B122 companion is supported on Windows only.");
  const protector = new WindowsDpapiCurrentUserProtector();
  const stateDirectory = resolve(options.stateDirectory ?? dirname(defaultControlPlaneStorePath()));
  const mainPath = fileURLToPath(import.meta.url);
  const instance = await acquireCompanionInstance(stateDirectory, mainPath, { protector });
  const identityHelperPath = instance.record.supervisorHelperPath ?? packagedCompanionLifecycleHelperPath(mainPath);
  const identityHelperSha256 = instance.record.supervisorHelperSha256 ?? (await installedHelperIdentity(identityHelperPath)).replace(/^sha256:/, "");
  let processIdentityPath: string;
  try {
    processIdentityPath = await (options.processIdentityWriter ?? writeAuthenticatedCompanionProcessIdentity)({
      stateDirectory,
      nonce: instance.record.nonce,
      mainPath,
      processPath: process.execPath,
      protector,
      supervisorHelperPath: identityHelperPath,
      supervisorHelperSha256: identityHelperSha256
    });
  } catch (error) {
    await instance.release();
    throw error;
  }
  let pipe: AuthenticatedPipeServer | undefined;
  let rawHidSupervisor: InstalledRawHidSupervisor | undefined;
  let hardwareSignalDispatcher: CompanionHardwareSignalDispatcher | undefined;
  let windowsHostActionConsumer: CompanionWindowsHostActionConsumer | undefined;
  let voiceRuntime: { shutdown(): Promise<void> } | undefined;
  let councilLifecycle: { dispose(): Promise<void> } | undefined;
  let councilResources: { shutdownForRestart(): Promise<void> } | undefined;
  let transcriptVault: { startRetentionEnforcement(options?: Readonly<{ onFailure?: (error: Error) => void }>): Promise<void>; stopRetentionEnforcement(): void } | undefined;
  let stopped = false;
  let stopPromise: Promise<void> | undefined;
  const stopAll = (): Promise<void> => {
    if (stopPromise) return stopPromise;
    stopped = true;
    stopPromise = closeStandaloneResources({
      stateDirectory,
      protector,
      instance: instance.record,
      resources: [
        { name: "authenticated-pipe", close: () => pipe?.stop() },
        { name: "hardware-signal-dispatcher", close: () => hardwareSignalDispatcher?.stop() },
        { name: "windows-host-action-consumer", close: () => windowsHostActionConsumer?.stop() },
        { name: "transcript-retention", close: () => { transcriptVault?.stopRetentionEnforcement(); } },
        { name: "voice-runtime", close: () => voiceRuntime?.shutdown() },
        { name: "raw-hid", close: () => rawHidSupervisor?.stop() },
        { name: "council-lifecycle", close: () => councilLifecycle?.dispose() },
        { name: "council-resources", close: () => councilResources?.shutdownForRestart() }
      ],
      releaseLease: async () => {
        await rm(processIdentityPath, { force: true });
        await instance.release();
      }
    });
    return stopPromise;
  };
  try {
  const store = new ProtectedJsonStore({
    filePath: resolve(stateDirectory, "protected-audit.jsonl"),
    authenticator: new DpapiJournalAuthenticator(protector),
    requireAuthenticatedProtection: true
  });
  const networkPolicy = await loadNetworkPolicy(join(stateDirectory, "network-policy.json"));
  const userPresence = new PowerShellWindowsUserPresenceRunner();
  const sandboxHelperPath = resolve(dirname(fileURLToPath(import.meta.url)), "..", "sandbox-helper", "b122-sandbox-worker.exe");
  const rawHidHelperPath = packagedRawHidHelperPath(mainPath);
  const repositoryRuntimeHelperPath = packagedRepositoryRuntimeHelperPath(mainPath);
  const providerDesktopHelperPath = packagedProviderDesktopHelperPath(mainPath);
  const voiceHelperPath = packagedVoiceHelperPath(mainPath);
  const [sandboxHelperIdentity, rawHidHelperIdentity, repositoryRuntimeHelperIdentity, providerDesktopHelperIdentity, voiceHelperIdentity] = await Promise.all([
    installedHelperIdentity(sandboxHelperPath),
    installedHelperIdentity(rawHidHelperPath),
    installedHelperIdentity(repositoryRuntimeHelperPath),
    installedHelperIdentity(providerDesktopHelperPath),
    installedHelperIdentity(voiceHelperPath)
  ]);
  const providerDesktopPaths = await loadProviderDesktopPaths(join(stateDirectory, "provider-desktop-paths.json"));
  if (providerDesktopPaths && !providerDesktopHelperIdentity.startsWith("sha256:")) throw new Error("Configured provider applications require the fixed packaged provider-desktop helper.");
  const packageIdentity = await loadCompanionPackageIdentity(mainPath);
  const exactVersions = {
    companion: `${packageIdentity.name}@${packageIdentity.version}`,
    node: process.version,
    sandboxHelper: sandboxHelperIdentity,
    rawHidHelper: rawHidHelperIdentity,
    repositoryRuntimeHelper: repositoryRuntimeHelperIdentity,
    providerDesktopHelper: providerDesktopHelperIdentity,
    voiceHelper: voiceHelperIdentity,
    repositoryRuntimeHelperVersion: "sxsy-b122-repository-runner-v1",
    rawHidProtocol: String(protocolVersion),
    rawHidMap: Buffer.from(mapFingerprint).toString("hex")
  };
  const receiptEvidence = await loadOrCreateHostReceiptEvidenceFactory({
    filePath: join(stateDirectory, "receipt-evidence-key.json"),
    protector,
    policyVersion: "b122-local-v1",
    exactVersions
  });
  const repositoryProcessSupervisor = repositoryRuntimeHelperIdentity.startsWith("sha256:")
    ? new WindowsJobObjectProcessSupervisor({
        helperPath: repositoryRuntimeHelperPath,
        helperSha256: repositoryRuntimeHelperIdentity.slice("sha256:".length),
        stateRoot: join(stateDirectory, "repository-supervisors")
      })
    : undefined;
  const companion = createDurableWindowsCompanion({
    policyVersion: "b122-local-v1",
    store,
    localStateDirectory: stateDirectory,
    localGitStateDirectory: stateDirectory,
    credentialProtector: protector,
    networkPolicy,
    receiptEvidence,
    runtime: { confirmationAttestor: new WindowsHelloConfirmationAttestor(userPresence) },
    runtimePinPresence: userPresence,
    sandboxHelperPath,
    rawHidHelperPath,
    ...(voiceHelperIdentity.startsWith("sha256:") ? {
      voiceHelperPath,
      voiceHelperSha256: voiceHelperIdentity.slice("sha256:".length)
    } : {}),
    ...(providerDesktopPaths ? {
      providerDesktopPaths,
      providerDesktopHelperPath,
      providerDesktopHelperSha256: providerDesktopHelperIdentity.slice("sha256:".length)
    } : {}),
    ...(repositoryProcessSupervisor ? { repositoryProcessSupervisor } : {}),
    snapshotEnvironmentFor: () => ({ toolVersions: exactVersions })
  });
  rawHidSupervisor = companion.rawHidSupervisor;
  hardwareSignalDispatcher = companion.hardwareSignalDispatcher;
  voiceRuntime = companion.voiceRuntime;
  councilLifecycle = companion.councilLifecycle;
  councilResources = companion.councilResources;
  transcriptVault = companion.transcriptVault;
  const windowsHostApplications = await provisionWindowsHostActionApplications();
  windowsHostActionConsumer = new CompanionWindowsHostActionConsumer(
    store,
    companion.hostActions,
    companion.executor,
    new PinnedWindowsHostActionEffectPort({ applications: windowsHostApplications }),
    { applications: windowsHostApplications }
  );
  await startStandaloneHardwareSignalDispatch({ ...companion, windowsHostActionConsumer });
  await transcriptVault.startRetentionEnforcement({
    onFailure: () => { void voiceRuntime?.shutdown(); }
  });
  await companion.voiceRuntime.reconcile();
  await rawHidSupervisor?.startConfigured();
  const configurationPath = join(stateDirectory, "authenticated-pipe.json");
  let configuration;
  try {
    configuration = await loadPipeConfiguration(configurationPath);
  } catch (error) {
    if (!isMissingFile(error)) throw error;
    configuration = await createPipeConfiguration(stateDirectory, protector);
    await savePipeConfiguration(configurationPath, configuration);
  }
  pipe = new AuthenticatedPipeServer(configuration, protector, createLifecycleAwareHandler(companion.endpoint, stopAll));
  await pipe.start();
  return { async stop() { if (stopped && !stopPromise) return; await stopAll(); } };
  } catch (error) {
    await stopAll().catch(() => undefined);
    throw error;
  }
}

/**
 * Binds the lease nonce and immutable executable/module digests to the exact
 * Windows process creation identity. The clear identity is never persisted;
 * uninstall/update can open it only as the same CurrentUser through DPAPI.
 */
export async function writeAuthenticatedCompanionProcessIdentity(input: Readonly<{
  stateDirectory: string;
  nonce: string;
  mainPath: string;
  processPath: string;
  protector: UserSecretProtector;
  supervisorHelperPath?: string;
  supervisorHelperSha256?: string;
  capture?: () => Promise<WindowsProcessIdentity>;
}>): Promise<string> {
  if (!/^[a-f0-9-]{36}$/i.test(input.nonce)) throw new Error("The companion lease nonce is invalid.");
  const [stateDirectory, mainPath, processPath] = await Promise.all([
    realpath(resolve(input.stateDirectory)),
    realpath(resolve(input.mainPath)),
    realpath(resolve(input.processPath))
  ]);
  const identity = await (input.capture ?? (() => captureCurrentWindowsProcessIdentity(input.supervisorHelperPath, input.supervisorHelperSha256)))();
  if (identity.pid !== process.pid || !Number.isSafeInteger(identity.parentProcessId) || identity.parentProcessId < 0 || !Number.isSafeInteger(identity.sessionId) || identity.sessionId < 0
    || !/^[1-9][0-9]{10,19}$/.test(identity.creationFileTimeUtc) || /[\r\n\0]/.test(identity.executablePath) || identity.arguments.length < 1 || identity.arguments.some((argument) => /[\r\n\0]/.test(argument))
    || resolve(identity.executablePath).toLowerCase() !== resolve(processPath).toLowerCase()) throw new Error("The exact companion process identity is invalid.");
  const payload = {
    schema: "sxsy-b122.companion-process-identity",
    version: 1,
    nonce: input.nonce.toLowerCase(),
    stateDirectory,
    pid: identity.pid,
    creationFileTimeUtc: identity.creationFileTimeUtc,
    executablePath: processPath,
    executableSha256: createHash("sha256").update(await readFile(processPath)).digest("hex"),
    mainPath,
    mainSha256: createHash("sha256").update(await readFile(mainPath)).digest("hex"),
    arguments: [...identity.arguments],
    parentProcessId: identity.parentProcessId,
    sessionId: identity.sessionId
  } as const;
  const sealed = await input.protector.seal(Buffer.from(JSON.stringify(payload), "utf8"));
  const path = join(stateDirectory, "companion-process-identity.json");
  await writeDurableJson(path, {
    schema: "sxsy-b122.dpapi-companion-process-identity",
    version: 1,
    protector: input.protector.provider,
    sealed
  });
  return path;
}

async function captureCurrentWindowsProcessIdentity(helperPath: string | undefined, helperSha256: string | undefined): Promise<WindowsProcessIdentity> {
  if (process.platform !== "win32") throw new Error("Exact companion process identity requires Windows.");
  if (!helperPath || !helperSha256) throw new Error("Exact companion process identity requires the reviewed packaged supervisor helper.");
  const output = await runCompanionIdentityProbe(helperPath, helperSha256, process.pid, 10_000);
  try {
    const observed = JSON.parse(output) as Record<string, unknown>;
    if (Object.keys(observed).sort().join(",") !== "creationFileTimeUtc,pid,schema,sessionId,version" || observed.schema !== "sxsy-b122.windows-process-identity" || observed.version !== 1 || observed.pid !== process.pid || typeof observed.creationFileTimeUtc !== "string" || !/^[1-9][0-9]{10,19}$/.test(observed.creationFileTimeUtc) || !Number.isSafeInteger(observed.sessionId) || Number(observed.sessionId) < 0) throw new Error("invalid receipt");
    return { pid: process.pid, creationFileTimeUtc: String(observed.creationFileTimeUtc), sessionId: Number(observed.sessionId), executablePath: process.execPath, arguments: process.argv.slice(1), parentProcessId: process.ppid };
  } catch { throw new Error("The exact companion process identity probe returned invalid JSON."); }
}

export async function runCompanionIdentityProbe(helperPath: string, helperSha256: string, pid: number, timeoutMs: number): Promise<string> {
  if (!isAbsolute(helperPath) || /[\r\n\0]/.test(helperPath) || !/^[a-f0-9]{64}$/.test(helperSha256) || !Number.isSafeInteger(pid) || pid < 1 || !Number.isSafeInteger(timeoutMs) || timeoutMs < 100 || timeoutMs > 30_000) throw new Error("The companion identity probe request is invalid.");
  const identity = await installedHelperIdentity(helperPath);
  if (identity !== `sha256:${helperSha256}`) throw new Error("The companion identity probe helper changed before launch.");
  const child = spawn(helperPath, ["--process-identity", String(pid)], { shell: false, windowsHide: true, env: {}, stdio: ["ignore", "pipe", "pipe"] });
  let stdout = ""; let stderr = ""; let outputBytes = 0; let overflow = false;
  const collect = (target: "stdout" | "stderr") => (chunk: Buffer): void => { outputBytes += chunk.length; if (outputBytes > 16 * 1024) { overflow = true; return; } if (target === "stdout") stdout += chunk.toString("utf8"); else stderr += chunk.toString("utf8"); };
  child.stdout.on("data", collect("stdout")); child.stderr.on("data", collect("stderr"));
  const close = new Promise<number>((resolveClose, rejectClose) => { child.once("error", rejectClose); child.once("close", (code) => resolveClose(code ?? -1)); });
  let timeoutHandle: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<"timeout">((resolveTimeout) => { timeoutHandle = setTimeout(() => resolveTimeout("timeout"), timeoutMs); });
  const outcome = await Promise.race([close, timeout]);
  if (timeoutHandle) clearTimeout(timeoutHandle);
  if (outcome === "timeout" || overflow) {
    try { child.kill("SIGKILL"); } catch { /* exact non-spawning helper already exited */ }
    const closed = await Promise.race([close.then(() => true, () => true), new Promise<false>((resolveTimeout) => setTimeout(() => resolveTimeout(false), 5_000))]);
    if (!closed) throw new Error("The exact non-spawning companion identity helper could not be proven stopped.");
    throw new Error(outcome === "timeout" ? "The companion identity probe exceeded its bounded timeout." : "The companion identity probe exceeded its output bound.");
  }
  if (outcome !== 0) throw new Error(stderr.trim() || "The companion identity probe failed.");
  return stdout.trim();
}

export async function loadCompanionPackageIdentity(mainModulePath: string): Promise<Readonly<{ name: "@strathex/switchyard-companion"; version: string }>> {
  const base = dirname(resolve(mainModulePath));
  const candidates = [
    resolve(base, "..", "package.json"),
    resolve(base, "../../../..", "package.json"),
    resolve(base, "../../../../..", "app", "package.json")
  ];
  for (const candidate of candidates) {
    try {
      const value: unknown = JSON.parse(await readFile(candidate, "utf8"));
      if (typeof value === "object" && value !== null && !Array.isArray(value)
        && (value as { name?: unknown }).name === "@strathex/switchyard-companion"
        && typeof (value as { version?: unknown }).version === "string"
        && /^\d+\.\d+\.\d+(?:-[A-Za-z0-9.-]+)?$/.test((value as { version: string }).version)) {
        return { name: "@strathex/switchyard-companion", version: (value as { version: string }).version };
      }
    } catch (error) {
      if (!isMissingFile(error) && !(error instanceof SyntaxError)) throw error;
    }
  }
  throw new Error("The exact SXSY-B122 companion package identity is unavailable.");
}

/** Fixed packaged location; no command line, environment, or workspace input participates. */
export function packagedRawHidHelperPath(mainModulePath: string): string {
  return resolve(dirname(mainModulePath), "..", "raw-hid", "strathex-b122-hid-helper.exe");
}

/** Fixed Windows release-bundle location; no workspace or environment input participates. */
export function packagedRepositoryRuntimeHelperPath(mainModulePath: string): string {
  return resolve(dirname(mainModulePath), "..", "repository-runtime", "b122-repository-runner.exe");
}

/** Fixed Windows release-bundle location for the native companion Job supervisor. */
export function packagedCompanionLifecycleHelperPath(mainModulePath: string): string {
  return resolve(dirname(mainModulePath), "..", "companion-lifecycle", "b122-companion-supervisor.exe");
}

/** Fixed Windows release-bundle location; no workspace or bridge input participates. */
export function packagedProviderDesktopHelperPath(mainModulePath: string): string {
  return resolve(dirname(mainModulePath), "..", "provider-desktop", "sxsy-b122-provider-desktop-helper.exe");
}

/** Fixed Windows release-bundle location; no command, workspace, or environment input participates. */
export function packagedVoiceHelperPath(mainModulePath: string): string {
  return resolve(dirname(mainModulePath), "..", "voice", "sxsy-b122-voice-helper.exe");
}

async function installedHelperIdentity(path: string): Promise<string> {
  try {
    const metadata = await lstat(path);
    if (!metadata.isFile() || metadata.isSymbolicLink() || metadata.size <= 0 || metadata.size > 256 * 1024 * 1024) {
      throw new Error("A packaged B122 helper is not a bounded regular file.");
    }
    const canonical = await realpath(path);
    if (resolve(canonical).toLowerCase() !== resolve(path).toLowerCase()) throw new Error("A packaged B122 helper path traverses an unexpected filesystem alias.");
    return `sha256:${createHash("sha256").update(await readFile(canonical)).digest("hex")}`;
  } catch (error) {
    if (isMissingFile(error)) return "unavailable:not-installed";
    throw error;
  }
}

async function loadNetworkPolicy(path: string): Promise<ConfiguredNetworkPolicy> {
  try {
    return await loadConfiguredNetworkPolicy(path);
  } catch (error) {
    if (!isMissingFile(error)) throw error;
    return { version: 1, proxy: "direct", routes: [] };
  }
}

function isMissingFile(error: unknown): boolean {
  return typeof error === "object" && error !== null && "code" in error && (error as { code?: unknown }).code === "ENOENT";
}

function exactShutdownPayload(value: unknown): value is Readonly<{ lifecycle: "shutdown" }> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    && Object.keys(value).length === 1 && (value as { lifecycle?: unknown }).lifecycle === "shutdown";
}

async function writeDurableJson(path: string, value: unknown): Promise<void> {
  await mkdir(dirname(path), { recursive: true, mode: 0o700 });
  const temporary = `${path}.${process.pid}.${Date.now()}.tmp`;
  const handle = await open(temporary, "wx", 0o600);
  try { await handle.writeFile(`${JSON.stringify(value)}\n`, "utf8"); await handle.sync(); }
  finally { await handle.close(); }
  await rename(temporary, path);
}

const launchedDirectly = process.argv[1] !== undefined && resolve(process.argv[1]) === resolve(fileURLToPath(import.meta.url));
if (launchedDirectly) {
  let running: Awaited<ReturnType<typeof runStandaloneCompanion>> | undefined;
  runStandaloneCompanion(parseDirectOptions(process.argv.slice(2))).then((instance) => {
    running = instance;
    const stop = (): void => { void running?.stop().then(() => process.exit(0), () => process.exit(1)); };
    process.once("SIGINT", stop);
    process.once("SIGTERM", stop);
  }).catch((error: unknown) => {
    const message = error instanceof Error ? error.message : "The durable SXSY-B122 companion could not start.";
    process.stderr.write(`SXSY-B122 companion unavailable: ${message}\n`);
    process.exitCode = 1;
  });
}

function parseDirectOptions(args: readonly string[]): Readonly<{ stateDirectory?: string }> {
  if (args.length === 0) return {};
  if (args.length === 2 && args[0] === "--isolated-test-state-directory" && typeof args[1] === "string" && isAbsolute(args[1]) && !/[\r\n\0]/.test(args[1])) return { stateDirectory: args[1] };
  throw new Error("The companion accepts no production command-line options; only the explicit isolated-test state directory is supported.");
}
