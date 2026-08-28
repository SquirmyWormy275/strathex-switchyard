#!/usr/bin/env node
import { spawn } from "node:child_process";
import { cp, mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";

const [sourceInput, outputInput] = process.argv.slice(2);
if (!sourceInput || !outputInput) throw new Error("usage: build-vsix.mjs EXTENSION_DIRECTORY OUTPUT_VSIX");
const source = resolve(sourceInput);
const output = resolve(outputInput);
const stage = await mkdtemp(join(tmpdir(), "sxsy-b122-vsix-"));
try {
  const extension = join(stage, "extension");
  await mkdir(extension);
  await cp(join(source, "dist"), join(extension, "dist"), { recursive: true, force: false, errorOnExist: true });
  await cp(join(source, "README.md"), join(extension, "README.md"), { force: false, errorOnExist: true });
  const packageDocument = JSON.parse(await readFile(join(source, "package.json"), "utf8"));
  if (packageDocument.name !== "@strathex/switchyard-vscode" || packageDocument.publisher !== "SquirmyWormy275"
    || packageDocument.version !== "0.1.0" || packageDocument.main !== "./dist/apps/vscode-extension/src/extension.js") {
    throw new Error("The reviewed VS Code extension identity changed.");
  }
  packageDocument.name = "strathex-switchyard-b122";
  await writeFile(join(extension, "package.json"), `${JSON.stringify(packageDocument, null, 2)}\n`, { flag: "wx", mode: 0o600 });
  await cp(resolve("deployment/windows/extension.vsixmanifest"), join(stage, "extension.vsixmanifest"), { force: false, errorOnExist: true });
  await cp(resolve("deployment/windows/Content_Types.xml"), join(stage, "[Content_Types].xml"), { force: false, errorOnExist: true });
  await mkdir(dirname(output), { recursive: true });
  await command("/usr/bin/zip", ["-X", "-q", "-r", output, "."], stage);
  const entries = (await command("/usr/bin/unzip", ["-Z1", output], stage)).stdout.split("\n").filter(Boolean);
  for (const required of ["extension.vsixmanifest", "[Content_Types].xml", "extension/package.json", "extension/README.md", "extension/dist/apps/vscode-extension/src/extension.js"]) {
    if (entries.filter((entry) => entry === required).length !== 1) throw new Error(`VSIX entry is missing or duplicated: ${required}`);
  }
  if (entries.some((entry) => entry.startsWith("/") || entry.split("/").includes("..") || entry.includes("\\"))) throw new Error("VSIX contains an unsafe path.");
} finally {
  await rm(stage, { recursive: true, force: true });
}

function command(executable, args, cwd) {
  if (!["/usr/bin/zip", "/usr/bin/unzip"].includes(executable)) throw new Error("The VSIX builder received an unreviewed executable.");
  return new Promise((resolveCommand, rejectCommand) => {
    const child = spawn(executable, args, { cwd, shell: false, env: { PATH: "/usr/bin:/bin" }, stdio: ["ignore", "pipe", "pipe"] });
    let stdout = ""; let stderr = ""; let bytes = 0;
    const collect = (target) => (chunk) => { bytes += chunk.length; if (bytes > 256 * 1024) { child.kill("SIGKILL"); return; } if (target === "stdout") stdout += chunk; else stderr += chunk; };
    child.stdout.on("data", collect("stdout")); child.stderr.on("data", collect("stderr")); child.once("error", rejectCommand);
    child.once("close", (code) => code === 0 && bytes <= 256 * 1024 ? resolveCommand({ stdout, stderr }) : rejectCommand(new Error("The fixed VSIX archive tool failed.")));
  });
}
