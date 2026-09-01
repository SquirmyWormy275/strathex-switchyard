import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

import { ProtectedJsonStore } from "../../../packages/control-plane/src/store.ts";
import { createDurableWindowsCompanion } from "../../windows-companion/src/bootstrap.ts";
import { AuthenticatedPipeServer, createPipeConfiguration, loadPipeConfiguration, savePipeConfiguration } from "../../windows-companion/src/authenticated-pipe.ts";
import { loadConfiguredNetworkPolicy, type ConfiguredNetworkPolicy } from "../../windows-companion/src/configured-network.ts";
import { createLifecycleAwareHandler } from "../../windows-companion/src/main.ts";
import { loadOrCreateHostReceiptEvidenceFactory } from "../../windows-companion/src/receipt-evidence.ts";
import { SecretProtectorJournalAuthenticator } from "../../windows-companion/src/windows-secret.ts";
import { LinuxBubblewrapIsolationRuntime } from "./linux-isolation.ts";
import { acquireLinuxCompanionLease } from "./linux-lifecycle.ts";
import { provisionLinuxCompanionPaths } from "./linux-paths.ts";
import { LinuxLibsecretCurrentUserProtector } from "./linux-secret.ts";
import { LinuxPolkitConfirmationAttestor, LinuxPolkitUserPresenceRunner } from "./linux-user-presence.ts";
import { LinuxPipeWireAudioPort } from "./linux-pipewire-audio.ts";
import { LinuxHidrawTransport, loadLinuxHidrawIdentity } from "./linux-hidraw.ts";
import { LinuxProcessGroupSupervisor } from "./linux-process-supervisor.ts";
import { LinuxBubblewrapRepositoryProcessSupervisor, LinuxDisposableExecutionRootProvider, LinuxHostValidatedRepositoryRecipeRunner } from "./linux-repository-runtime.ts";
import { collectOmarchyHostEvidence } from "./omarchy-capabilities.ts";
import { CompanionOmarchyHostActionConsumer } from "./omarchy-host-action-consumer.ts";
import { NativeOmarchyHostActionAdapter } from "./omarchy-host-action.ts";
import { loadFixedOmarchySurfaceIdentities } from "./omarchy-identity.ts";

export async function runLinuxCompanion(): Promise<{ stop(): Promise<void> }> {
  if (process.platform !== "linux") throw new Error("The packaged Linux companion runs only on Linux.");
  const paths = await provisionLinuxCompanionPaths();
  const protector = new LinuxLibsecretCurrentUserProtector();
  const lease = await acquireLinuxCompanionLease(paths.stateDirectory);
  let pipe: AuthenticatedPipeServer | undefined;
  let companion: ReturnType<typeof createDurableWindowsCompanion> | undefined;
  let hidraw: LinuxHidrawTransport | undefined;
  let omarchyHostActions: CompanionOmarchyHostActionConsumer | undefined;
  let stopping: Promise<void> | undefined;
  const stop = (): Promise<void> => stopping ??= (async () => {
    const failures: unknown[] = [];
    for (const close of [
      () => pipe?.stop(),
      () => hidraw?.stop(),
      () => omarchyHostActions?.stop(),
      () => companion?.hardwareSignalDispatcher.stop(),
      () => companion?.voiceRuntime.shutdown(),
      () => { companion?.transcriptVault.stopRetentionEnforcement(); },
      () => companion?.councilLifecycle.dispose(),
      () => companion?.councilResources.shutdownForRestart()
    ]) { try { await close(); } catch (error) { failures.push(error); } }
    try { await lease.release(); } catch (error) { failures.push(error); }
    try { await protector.dispose(); } catch (error) { failures.push(error); }
    if (failures.length) throw new AggregateError(failures, "The Linux companion did not stop cleanly.");
  })();
  try {
    const store = new ProtectedJsonStore({ filePath: join(paths.stateDirectory, "protected-audit.jsonl"), authenticator: new SecretProtectorJournalAuthenticator(protector), requireAuthenticatedProtection: true });
    const networkPolicy = await optionalNetworkPolicy(join(paths.stateDirectory, "network-policy.json"));
    const receiptEvidence = await loadOrCreateHostReceiptEvidenceFactory({ filePath: join(paths.stateDirectory, "receipt-evidence-key.json"), protector, policyVersion: "b122-linux-v1", exactVersions: { companion: "@strathex/switchyard-linux-companion@0.1.0", node: process.version, isolation: "bubblewrap:/usr/bin/bwrap" } });
    const userPresence = new LinuxPolkitUserPresenceRunner();
    const processSupervisor = new LinuxProcessGroupSupervisor(store);
    companion = createDurableWindowsCompanion({ policyVersion: "b122-linux-v1", store, localStateDirectory: paths.stateDirectory, localGitStateDirectory: paths.stateDirectory, credentialProtector: protector, receiptEvidence, ...(networkPolicy ? { networkPolicy } : {}), runtime: { confirmationAttestor: new LinuxPolkitConfirmationAttestor(userPresence) }, runtimePinPresence: userPresence, repositoryProcessSupervisor: new LinuxBubblewrapRepositoryProcessSupervisor(processSupervisor), repositoryExecutionRoots: new LinuxDisposableExecutionRootProvider(paths.stateDirectory), repositorySandboxFactory: ({ runtimes, issuer, scannerFixtures }) => new LinuxHostValidatedRepositoryRecipeRunner(runtimes, issuer, scannerFixtures), hostIsolationRuntime: new LinuxBubblewrapIsolationRuntime(), voiceAudioPort: new LinuxPipeWireAudioPort(), snapshotEnvironmentFor: () => ({ toolVersions: { companion: "linux-0.1.0", node: process.version } }) });
    await companion.endpoint.ready();
    const omarchyIdentities = await loadFixedOmarchySurfaceIdentities(join(paths.stateDirectory, "omarchy-surfaces.json"));
    if (omarchyIdentities) {
      omarchyHostActions = new CompanionOmarchyHostActionConsumer(store, companion.hostActions, companion.executor, new NativeOmarchyHostActionAdapter(), {
        evidence: await collectOmarchyHostEvidence(), identities: omarchyIdentities
      });
      await omarchyHostActions.start();
    }
    await companion.transcriptVault.startRetentionEnforcement({ onFailure: () => { void stop(); } });
    await companion.voiceRuntime.reconcile();
    await companion.hardwareSignalDispatcher.start();
    const hidrawIdentity = await loadLinuxHidrawIdentity(join(paths.stateDirectory, "linux-hidraw.json"));
    if (hidrawIdentity) { hidraw = new LinuxHidrawTransport(hidrawIdentity, companion.hardwareSignals); await hidraw.start(); }
    const configurationPath = join(paths.stateDirectory, "authenticated-pipe.json");
    let configuration;
    try { configuration = await loadPipeConfiguration(configurationPath); }
    catch (error) {
      if (!missing(error)) throw error;
      configuration = await createPipeConfiguration(paths.runtimeDirectory, protector);
      await savePipeConfiguration(configurationPath, configuration);
    }
    if (dirname(configuration.pipePath) !== paths.runtimeDirectory) throw new Error("The provisioned Linux companion socket escaped XDG_RUNTIME_DIR.");
    pipe = new AuthenticatedPipeServer(configuration, protector, createLifecycleAwareHandler(companion.endpoint, stop));
    await pipe.start();
    return { stop };
  } catch (error) { await stop().catch(() => undefined); throw error; }
}

async function optionalNetworkPolicy(path: string): Promise<ConfiguredNetworkPolicy | undefined> {
  try { return await loadConfiguredNetworkPolicy(path); }
  catch (error) { if (missing(error)) return undefined; throw error; }
}

function missing(error: unknown): boolean { return typeof error === "object" && error !== null && "code" in error && (error as { code?: string }).code === "ENOENT"; }

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const running = await runLinuxCompanion();
  const shutdown = (): void => { void running.stop().then(() => { process.exitCode = 0; }, () => { process.exitCode = 1; }); };
  process.once("SIGTERM", shutdown); process.once("SIGINT", shutdown);
}
