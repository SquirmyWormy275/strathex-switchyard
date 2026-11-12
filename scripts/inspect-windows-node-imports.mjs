/** CI-only projection of fixed dumpbin output; no executable, SDK or runtime is installed. */
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { lstat, readFile, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { parseNodeRngImports } from "./windows-restricted-owner-report.mjs";
const [flag, input, expected] = process.argv.slice(2);
assert.ok(process.platform === "win32" && process.env.GITHUB_ACTIONS === "true" && process.env.RUNNER_OS === "Windows" && flag === "--fixed-ci-dump" && process.argv.length === 5 && /^[a-f0-9]{64}$/.test(expected ?? ""));
const path = resolve(input), parent = join(process.env.RUNNER_TEMP, "switchyard-windows-hotkeys");
assert.equal(dirname(path), parent); assert.equal(path, join(parent, "node-imports.txt"));
const stat = await lstat(path); assert.ok(stat.isFile() && !stat.isSymbolicLink() && stat.size > 0 && stat.size <= 1048576);
assert.equal(createHash("sha256").update(await readFile(process.execPath)).digest("hex"), expected);
const report = parseNodeRngImports(await readFile(path, "utf8"), expected);
await writeFile(join(parent, "Switchyard.NodeRngImports.json"), JSON.stringify(report, null, 2) + "\n", { flag: "wx", mode: 0o600 });
console.log(JSON.stringify(report));
