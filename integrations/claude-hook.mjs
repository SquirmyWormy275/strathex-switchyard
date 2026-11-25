#!/usr/bin/env node
/** Command hook: fixed local observation destination, empty stdout, no tool decisions. */
import { pathToFileURL } from "node:url";
import { createSuiteStore } from "../tools/layout-studio/suite-store.mjs";
import { claudeHookInputBytes, recordClaudeHook } from "../tools/layout-studio/claude-hook-observation.mjs";

export async function claudeHookMain(args, { input = process.stdin, errors = process.stderr, store, now = () => Date.now() } = {}) {
  const at = now();
  try {
    if (args.length !== 6 || args[0] !== "--workspace" || args[2] !== "--observation" || args[4] !== "--session"
        || !/^[a-z][a-z0-9-]{0,47}$/.test(args[1]) || !/^[a-f0-9-]{36}$/.test(args[3]) || !/^[A-Za-z0-9_.:-]{1,128}$/.test(args[5])) throw Error("Invalid hook scope.");
    let bytes = 0; const chunks = [];
    const timer = setTimeout(() => input.destroy(new Error("Hook input timed out.")), 5000);
    try {
      for await (const chunk of input) { const b = Buffer.from(chunk); bytes += b.length; if (bytes > claudeHookInputBytes) throw Error("Hook input too large."); chunks.push(b); }
    } finally { clearTimeout(timer); }
    const raw = Buffer.concat(chunks).toString("utf8");
    await recordClaudeHook({ store: store ?? createSuiteStore(), compartment: args[1], observationId: args[3], expectedSessionId: args[5], raw, at, now });
    return 0;
  } catch {
    // Never echo vendor input, filesystem paths, credentials or error stacks.
    // Exit 1 reports an observation failure; exit 2 would block some native hooks.
    errors.write("Switchyard hook observation unavailable. Check the selected workspace, exact session and recording consent. No automatic retry.\n");
    return 1;
  }
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) process.exitCode = await claudeHookMain(process.argv.slice(2));
