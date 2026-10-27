import { copyFile, mkdir } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const source = resolve(root, "apps/vscode-extension/src/codex-daemon-status.cjs");
const target = resolve(root, "apps/vscode-extension/dist/apps/vscode-extension/src/codex-daemon-status.cjs");
await mkdir(dirname(target), { recursive: true });
await copyFile(source, target);
