import { fileURLToPath } from "node:url";
import { dirname, join, resolve } from "node:path";

import { createDurableWindowsCompanion } from "./bootstrap.ts";
import { AuthenticatedPipeServer, createPipeConfiguration, loadPipeConfiguration, savePipeConfiguration } from "./authenticated-pipe.ts";
import { defaultControlPlaneStorePath } from "../../../packages/control-plane/src/store.ts";
import { DpapiJournalAuthenticator, WindowsDpapiCurrentUserProtector } from "./windows-secret.ts";

/**
 * Deliberately launched local named-pipe entry point. It does not spawn from
 * the extension, open a network listener, or write a clear IPC credential.
 * The sealed endpoint record is extension-bootstrap input, not a workspace
 * setting; an unprovisioned extension remains unavailable.
 */
export async function runStandaloneCompanion(): Promise<void> {
  const protector = new WindowsDpapiCurrentUserProtector();
  const storePath = defaultControlPlaneStorePath();
  const stateDirectory = dirname(storePath);
  const companion = createDurableWindowsCompanion({
    policyVersion: process.env.SXSY_B122_POLICY_VERSION?.trim() || "b122-local-v1",
    journalAuthenticator: new DpapiJournalAuthenticator(protector),
    localGitStateDirectory: stateDirectory,
    // The environment fingerprint is host-owned static evidence, not a
    // caller-supplied terminal environment.  Without it consequential routes
    // intentionally remain incomplete.
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
