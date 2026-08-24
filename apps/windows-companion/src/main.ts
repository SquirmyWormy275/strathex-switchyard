import { fileURLToPath } from "node:url";
import { dirname, join, resolve } from "node:path";

import { createDurableWindowsCompanion } from "./bootstrap.ts";
import { AuthenticatedPipeServer, createPipeConfiguration, loadPipeConfiguration, savePipeConfiguration } from "./authenticated-pipe.ts";
import { defaultControlPlaneStorePath, ProtectedJsonStore } from "../../../packages/control-plane/src/store.ts";
import { DpapiJournalAuthenticator, WindowsDpapiCurrentUserProtector } from "./windows-secret.ts";
import { loadConfiguredNetworkPolicy, type ConfiguredNetworkPolicy } from "./configured-network.ts";
import { PowerShellWindowsUserPresenceRunner, WindowsHelloConfirmationAttestor } from "./windows-user-presence.ts";

/**
 * Deliberately launched local named-pipe entry point. It does not spawn from
 * the extension, open a network listener, or write a clear IPC credential.
 * The sealed endpoint record is extension-bootstrap input, not a workspace
 * setting; an unprovisioned extension remains unavailable.
 */
export async function runStandaloneCompanion(): Promise<{ stop(): Promise<void> }> {
  if (process.platform !== "win32") throw new Error("The packaged SXSY-B122 companion is supported on Windows only.");
  const protector = new WindowsDpapiCurrentUserProtector();
  const stateDirectory = resolve(process.env.SXSY_B122_STATE_DIR?.trim() || dirname(defaultControlPlaneStorePath()));
  const store = new ProtectedJsonStore({
    filePath: resolve(stateDirectory, "protected-audit.jsonl"),
    authenticator: new DpapiJournalAuthenticator(protector),
    requireAuthenticatedProtection: true
  });
  const networkPolicy = await loadNetworkPolicy(join(stateDirectory, "network-policy.json"));
  const userPresence = new PowerShellWindowsUserPresenceRunner();
  const companion = createDurableWindowsCompanion({
    policyVersion: process.env.SXSY_B122_POLICY_VERSION?.trim() || "b122-local-v1",
    store,
    localStateDirectory: stateDirectory,
    localGitStateDirectory: stateDirectory,
    credentialProtector: protector,
    networkPolicy,
    runtime: { confirmationAttestor: new WindowsHelloConfirmationAttestor(userPresence) },
    runtimePinPresence: userPresence,
    snapshotEnvironmentFor: () => ({ toolVersions: { companion: "b122-windows-local-v1" } })
  });
  await companion.endpoint.ready();
  const configurationPath = join(stateDirectory, "authenticated-pipe.json");
  let configuration;
  try {
    configuration = await loadPipeConfiguration(configurationPath);
  } catch (error) {
    if (!isMissingFile(error)) throw error;
    configuration = await createPipeConfiguration(stateDirectory, protector);
    await savePipeConfiguration(configurationPath, configuration);
  }
  const pipe = new AuthenticatedPipeServer(configuration, protector, companion.endpoint);
  await pipe.start();
  return { stop: () => pipe.stop() };
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
  runStandaloneCompanion().catch((error: unknown) => {
    const message = error instanceof Error ? error.message : "The durable SXSY-B122 companion could not start.";
    process.stderr.write(`SXSY-B122 companion unavailable: ${message}\n`);
    process.exitCode = 1;
  });
}
