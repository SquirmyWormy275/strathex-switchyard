import { fileURLToPath } from "node:url";

import { collectOmarchyHostEvidence } from "./omarchy-capabilities.ts";

export async function printOmarchyHostEvidence(): Promise<void> {
  process.stdout.write(`${JSON.stringify(await collectOmarchyHostEvidence(), null, 2)}\n`);
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) await printOmarchyHostEvidence();
