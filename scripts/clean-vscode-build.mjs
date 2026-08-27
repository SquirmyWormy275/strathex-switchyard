import { rm } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const output = resolve(repositoryRoot, "apps", "vscode-extension", "dist");
const expected = resolve(repositoryRoot, "apps", "vscode-extension");
if (dirname(output) !== expected || output === repositoryRoot) {
  throw new Error("Refusing to clean an unexpected VS Code build path.");
}
await rm(output, { recursive: true, force: true });
