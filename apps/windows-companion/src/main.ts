import { fileURLToPath } from "node:url";
import { dirname, isAbsolute, join, resolve } from "node:path";
import { createHash } from "node:crypto";
import { lstat, readFile, realpath } from "node:fs/promises";

import { createDurableWindowsCompanion } from "./bootstrap.ts";
import { AuthenticatedPipeServer, createPipeConfiguration, loadPipeConfiguration, savePipeConfiguration } from "./authenticated-pipe.ts";
import { defaultControlPlaneStorePath, ProtectedJsonStore } from "../../../packages/control-plane/src/store.ts";
import { DpapiJournalAuthenticator, WindowsDpapiCurrentUserProtector } from "./windows-secret.ts";
import { loadConfiguredNetworkPolicy, type ConfiguredNetworkPolicy } from "./configured-network.ts";
import { PowerShellWindowsUserPresenceRunner, WindowsHelloConfirmationAttestor } from "./windows-user-presence.ts";
import { acquireCompanionInstance } from "./instance-lifecycle.ts";
import type { InstalledRawHidSupervisor } from "./raw-hid-installation.ts";
import { loadOrCreateHostReceiptEvidenceFactory } from "./receipt-evidence.ts";
import { WindowsJobObjectProcessSupervisor } from "./windows-job-supervisor.ts";
import { protocolVersion } from "../../../packages/protocol/src/b122.ts";
import { mapFingerprint } from "../../../packages/protocol/src/raw-hid.ts";
import { loadProviderDesktopPaths } from "./provider-desktop-configuration.ts";

/**
 * Deliberately launched local named-pipe entry point. It does not spawn from
 * the extension, open a network listener, or write a clear IPC credential.
 * The sealed endpoint record is extension-bootstrap input, not a workspace
 * setting; an unprovisioned extension remains unavailable.
 */
export async function runStandaloneCompanion(options: Readonly<{ stateDirectory?: string }> = {}): Promise<{ stop(): Promise<void> }> {
  if (process.platform !== "win32") throw new Error("The packaged SXSY-B122 companion is supported on Windows only.");
  const protector = new WindowsDpapiCurrentUserProtector();
  const stateDirectory = resolve(options.stateDirectory ?? dirname(defaultControlPlaneStorePath()));
  const mainPath = fileURLToPath(import.meta.url);
  const instance = await acquireCompanionInstance(stateDirectory, mainPath);
  let pipe: AuthenticatedPipeServer | undefined;
  let rawHidSupervisor: InstalledRawHidSupervisor | undefined;
  let voiceRuntime: { shutdown(): Promise<void> } | undefined;
  let transcriptVault: { startRetentionEnforcement(options?: Readonly<{ onFailure?: (error: Error) => void }>): Promise<void>; stopRetentionEnforcement(): void } | undefined;
  let stopped = false;
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
  const exactVersions = {
    companion: "@strathex/switchyard-companion@0.2.0",
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
  voiceRuntime = companion.voiceRuntime;
  transcriptVault = companion.transcriptVault;
  await companion.endpoint.ready();
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
  pipe = new AuthenticatedPipeServer(configuration, protector, companion.endpoint);
  await pipe.start();
  return { async stop() { if (stopped) return; stopped = true; transcriptVault?.stopRetentionEnforcement(); await companion.voiceRuntime.shutdown(); await rawHidSupervisor?.stop(); await pipe?.stop().finally(() => instance.release()); } };
  } catch (error) {
    transcriptVault?.stopRetentionEnforcement();
    await voiceRuntime?.shutdown().catch(() => undefined);
    await rawHidSupervisor?.stop().catch(() => undefined);
    await pipe?.stop().catch(() => undefined);
    await instance.release();
    throw error;
  }
}

/** Fixed packaged location; no command line, environment, or workspace input participates. */
export function packagedRawHidHelperPath(mainModulePath: string): string {
  return resolve(dirname(mainModulePath), "..", "raw-hid", "strathex-b122-hid-helper.exe");
}

/** Fixed Windows release-bundle location; no workspace or environment input participates. */
export function packagedRepositoryRuntimeHelperPath(mainModulePath: string): string {
  return resolve(dirname(mainModulePath), "..", "repository-runtime", "b122-repository-runner.exe");
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

const launchedDirectly = process.argv[1] !== undefined && resolve(process.argv[1]) === resolve(fileURLToPath(import.meta.url));
if (launchedDirectly) {
  let running: Awaited<ReturnType<typeof runStandaloneCompanion>> | undefined;
  runStandaloneCompanion(parseDirectOptions(process.argv.slice(2))).then((instance) => {
    running = instance;
    const stop = (): void => { void running?.stop().finally(() => { process.exitCode = 0; }); };
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
