import { pathToFileURL } from "node:url";

import { evaluateContainmentRemoteChallenge } from "./containment-remote-evaluator.ts";

export async function runContainmentRemoteEvaluatorCli(argv: readonly string[]): Promise<number> {
  if (argv.length === 1 && (argv[0] === "--help" || argv[0] === "-h")) {
    process.stdout.write("Usage: sxsy-b122-containment-remote-evaluator --challenge <absolute-json> --private-key <absolute-pem> --output <absolute-json> --git-executable <absolute-pinned-git>\n");
    return 0;
  }
  const allowed = new Set(["--challenge", "--private-key", "--output", "--git-executable"]);
  const values = new Map<string, string>();
  for (let index = 0; index < argv.length; index += 2) {
    const key = argv[index]; const value = argv[index + 1];
    if (!key || !allowed.has(key) || !value || values.has(key) || value.startsWith("--")) {
      process.stderr.write("The remote evaluator requires exact challenge, private-key, output, and pinned Git executable arguments.\n");
      return 2;
    }
    values.set(key, value);
  }
  if (values.size !== allowed.size) {
    process.stderr.write("The remote evaluator requires exact challenge, private-key, output, and pinned Git executable arguments.\n");
    return 2;
  }
  try {
    const evidence = await evaluateContainmentRemoteChallenge({
      challengePath: values.get("--challenge")!, privateKeyPath: values.get("--private-key")!, outputPath: values.get("--output")!,
      gitExecutablePath: values.get("--git-executable")!
    });
    process.stdout.write(`Signed remote evidence ${evidence.evidenceId} was written without secret values.\n`);
    return 0;
  } catch {
    process.stderr.write("The exact remote-evidence evaluation failed; no result was inferred.\n");
    return 1;
  }
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) process.exitCode = await runContainmentRemoteEvaluatorCli(process.argv.slice(2));
