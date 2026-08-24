import { fileURLToPath } from "node:url";
import { resolve } from "node:path";

import { createDurableWindowsCompanion } from "./bootstrap.ts";
import { runCompanionStdio } from "./stdio.ts";

/**
 * Deliberately launched local JSON-lines entry point. It does not spawn from
 * the extension, open a network listener, or install a fake journal key. A
 * reviewed Windows host must inject a DPAPI/NCrypt/service-backed journal
 * authenticator through `createDurableWindowsCompanion` when embedding this
 * module; the standalone process fails closed without one.
 */
export async function runStandaloneCompanion(): Promise<void> {
  const companion = createDurableWindowsCompanion({
    policyVersion: process.env.SXSY_B122_POLICY_VERSION?.trim() || "b122-local-v1"
  });
  await companion.endpoint.ready();
  await runCompanionStdio(companion.endpoint);
}

const launchedDirectly = process.argv[1] !== undefined && resolve(process.argv[1]) === resolve(fileURLToPath(import.meta.url));
if (launchedDirectly) {
  runStandaloneCompanion().catch((error: unknown) => {
    const message = error instanceof Error ? error.message : "The durable SXSY-B122 companion could not start.";
    process.stderr.write(`SXSY-B122 companion unavailable: ${message}\n`);
    process.exitCode = 1;
  });
}
