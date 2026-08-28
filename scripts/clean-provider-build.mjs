import { rm } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const packageRoot = resolve(repositoryRoot, "apps", "provider-adapter-host");
const output = resolve(packageRoot, "dist");
if (dirname(output) !== packageRoot || output === repositoryRoot) throw new Error("Refusing to clean an unexpected provider-host build path.");
await rm(output, { recursive: true, force: true });
