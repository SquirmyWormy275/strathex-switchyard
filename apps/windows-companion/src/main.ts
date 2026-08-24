import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

import { createDurableWindowsCompanion } from "./bootstrap.ts";
import { DurableLocalIpcServer } from "./durable-ipc.ts";
import { createCompanionConfiguration } from "./local-runtime.ts";
import { ProtectedJsonStore } from "../../../packages/control-plane/src/store.ts";
import { WindowsDpapiJournalAuthenticator } from "./windows-authenticator.ts";

/**
 * Deliberately launched local JSON-lines entry point. It does not spawn from
 * the extension, open a network listener, or install a fake journal key. A
 * reviewed Windows host must inject a DPAPI/NCrypt/service-backed journal
 * authenticator through `createDurableWindowsCompanion` when embedding this
 * module; the standalone process fails closed without one.
 */
export async function runStandaloneCompanion(): Promise<{ stop(): Promise<void> }> {
  if (process.platform !== "win32") throw new Error("The packaged SXSY-B122 companion is supported on Windows only.");
  const stateDirectory = resolve(process.env.SXSY_B122_STATE_DIR?.trim() || dirname(new ProtectedJsonStore().filePath));
  const configuration = await createCompanionConfiguration(stateDirectory);
  const store = new ProtectedJsonStore({ filePath: resolve(stateDirectory, "protected-audit.jsonl"), authenticator: new WindowsDpapiJournalAuthenticator(), requireAuthenticatedProtection: true });
  const companion = createDurableWindowsCompanion({
    policyVersion: process.env.SXSY_B122_POLICY_VERSION?.trim() || "b122-local-v1", store, localStateDirectory: stateDirectory
  });
  await companion.endpoint.ready();
  const server = new DurableLocalIpcServer(configuration, companion.endpoint);
  await server.start();
  return { stop: () => server.stop() };
}

const launchedDirectly = process.argv[1] !== undefined && resolve(process.argv[1]) === resolve(fileURLToPath(import.meta.url));
if (launchedDirectly) {
  runStandaloneCompanion().catch((error: unknown) => {
    const message = error instanceof Error ? error.message : "The durable SXSY-B122 companion could not start.";
    process.stderr.write(`SXSY-B122 companion unavailable: ${message}\n`);
    process.exitCode = 1;
  });
}
