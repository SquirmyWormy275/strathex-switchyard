import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

import {
  AtomicPythonVenvLifecycle,
  type AtomicPythonVenvRequest,
  type PythonDependencyLock
} from "./atomic-python-venv.ts";

/**
 * Fixed release-bundle entry point for repository runtime manifests.
 *
 * Rebuild intentionally remains fail-closed unless the installed companion
 * injects its authenticated VS Code terminal coordinator. The CLI alone can
 * safely create/reuse an environment but cannot claim an editor terminal was
 * detached.
 */
export async function runAtomicPythonVenvCli(
  args: readonly string[],
  dependencies: Readonly<{ lifecycle?: AtomicPythonVenvLifecycle; repositoryRoot?: string }> = {}
): Promise<number> {
  try {
    const request = parseAtomicPythonVenvCliArguments(args, dependencies.repositoryRoot ?? process.cwd());
    const result = await (dependencies.lifecycle ?? new AtomicPythonVenvLifecycle()).execute(request);
    process.stdout.write(`${JSON.stringify(result)}\n`);
    if (result.status === "completed") return 0;
    return result.status === "blocked" ? 75 : 1;
  } catch (error) {
    const summary = error instanceof Error ? error.message.replace(/[\0\r\n]+/g, " ").slice(0, 1_024) : "Invalid Python environment helper request.";
    process.stdout.write(`${JSON.stringify({ status: "blocked", summary })}\n`);
    return 64;
  }
}

export function parseAtomicPythonVenvCliArguments(args: readonly string[], repositoryRoot: string): AtomicPythonVenvRequest {
  const values = new Map<string, string>();
  let confirmed = false;
  for (let index = 0; index < args.length; index += 1) {
    const name = args[index];
    if (name === "--confirmed") {
      if (confirmed) throw new Error("Duplicate --confirmed flag.");
      confirmed = true;
      continue;
    }
    if (!name || !name.startsWith("--") || !allowedValueNames.has(name) || values.has(name)) throw new Error("Python environment helper arguments are invalid or duplicated.");
    const value = args[index + 1];
    if (!value || value.startsWith("--") || /[\0\r\n]/.test(value) || value.length > 4_096) throw new Error(`Python environment helper ${name} value is invalid.`);
    values.set(name, value);
    index += 1;
  }
  const mode = values.get("--mode");
  const operationId = values.get("--operation-id");
  const basePython = values.get("--python");
  const basePythonSha256 = values.get("--python-sha256");
  if ((mode !== "ensure" && mode !== "rebuild") || !operationId || !basePython || !basePythonSha256) throw new Error("Python environment helper requires exact mode, operation, Python path, and Python digest fields.");

  const dependencyValues = [values.get("--requirements"), values.get("--requirements-sha256"), values.get("--wheelhouse")];
  if (dependencyValues.some(Boolean) && !dependencyValues.every(Boolean)) throw new Error("Pinned offline dependencies require requirements path, requirements digest, and wheelhouse path together.");
  const dependencies: PythonDependencyLock | undefined = dependencyValues.every(Boolean)
    ? {
        requirementsPath: dependencyValues[0]!,
        requirementsSha256: dependencyValues[1]!,
        wheelhousePath: dependencyValues[2]!
      }
    : undefined;
  return {
    mode,
    operationId,
    repositoryRoot: resolve(repositoryRoot),
    basePython,
    basePythonSha256,
    ...(dependencies ? { dependencies } : {}),
    ...(confirmed ? { confirmed: true } : {})
  };
}

const allowedValueNames = new Set([
  "--mode",
  "--operation-id",
  "--python",
  "--python-sha256",
  "--requirements",
  "--requirements-sha256",
  "--wheelhouse"
]);

const launchedDirectly = process.argv[1] !== undefined && resolve(process.argv[1]) === resolve(fileURLToPath(import.meta.url));
if (launchedDirectly) {
  runAtomicPythonVenvCli(process.argv.slice(2)).then((code) => { process.exitCode = code; }).catch(() => { process.exitCode = 1; });
}
