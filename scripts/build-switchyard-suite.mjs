#!/usr/bin/env node
import { execFileSync } from "node:child_process";
import { mkdir, mkdtemp, readFile, realpath, rm, writeFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { buildSuiteRelease } from "../deployment/suite/release.mjs";
const root = await realpath(fileURLToPath(new URL("../", import.meta.url))), args = process.argv.slice(2);
if (args.some((arg) => arg !== "--allow-dirty" && !arg.startsWith("--windows-hotkeys="))) throw new Error("Usage: npm run suite:package -- [--allow-dirty] [--windows-hotkeys=/absolute/native/helper.exe]");
const dirty = execFileSync("git", ["status", "--porcelain", "--untracked-files=normal"], { cwd: root, encoding: "utf8" }).trim().length > 0;
if (dirty && !args.includes("--allow-dirty")) throw new Error("Commit the tested checkpoint before packaging, or explicitly label an uncommitted development build with --allow-dirty.");
const sourceCommit = execFileSync("git", ["rev-parse", "HEAD"], { cwd: root, encoding: "utf8" }).trim();
const sourceFiles = execFileSync("git", ["ls-files", "-z"], { cwd: root, encoding: "utf8" }).split("\0").filter(Boolean);
const recipe = JSON.parse(await readFile(join(root, "deployment/suite/frontend-review.json"), "utf8")), outputRoot = join(root, "artifacts/switchyard-suite");
if (!/^[a-f0-9]{40}$/.test(recipe.sourceCommit)) throw new Error("The frozen frontend source revision is invalid.");
await mkdir(outputRoot, { recursive: true, mode: 0o700 });
const frontendRoot = await mkdtemp(join(outputRoot, ".review-input-"));
try {
  // Reconstruct the existing frozen review from committed bytes. This never
  // prepares, replaces or changes the user's live morning review artifact.
  for (const f of recipe.files) {
    if (!/^[A-Za-z0-9_.-]+$/.test(f.file) || /^\.+$/.test(f.file)) throw new Error("The frozen frontend filename is invalid.");
    const data = execFileSync("git", ["show", `${recipe.sourceCommit}:tools/layout-studio/${f.file}`], { cwd: root, maxBuffer: 2 * 1024 * 1024 });
    if (createHash("sha256").update(data).digest("hex") !== f.sha256) throw new Error("The committed frozen frontend differs from its recorded hash.");
    await writeFile(join(frontendRoot, f.file), data, { flag: "wx", mode: 0o600 });
  }
  await writeFile(join(frontendRoot, "manifest.json"), JSON.stringify(recipe), { mode: 0o600 });
  const result = await buildSuiteRelease({ sourceRoot: root, sourceFiles, outputRoot, frontendRoot, sourceCommit, development: dirty, windowsHotkeys: args.find((arg) => arg.startsWith("--windows-hotkeys="))?.slice("--windows-hotkeys=".length) });
  console.log(JSON.stringify(result, null, 2));
} finally { await rm(frontendRoot, { recursive: true, force: true }); }
